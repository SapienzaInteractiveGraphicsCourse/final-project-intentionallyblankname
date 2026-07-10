import * as THREE from 'three'
import { DroneModelMaker } from './ModelMakers/DroneModelMaker.js'
import { RobotBase } from './RobotBase.js'
import { lerpAngle } from '../mathUtils.js'

// stat DRONE: il più veloce del roster (vola, non deve girare ruote/gambe
// per cambiare direzione) ma il peggiore in STEAL/BLOCK (corpo leggero,
// niente presa/massa per contrastare). Stessi valori già usati come
// placeholder in main.js per la card disabilitata del Main Menu
export const DRONE_STATS = { speed: 5, shooting: 2, steal: 1, block: 1 }

// Tutti i numeri tunabili del Drone (locomozione/bank + Flight), in un
// unico oggetto MUTABILE — stesso motivo di dribbleTuning/shootTuning/
// handlingTuning in main.js: un `export const X = 5` non è riassegnabile
// da chi importa (un `export let` nemmeno, un binding di sola lettura sui
// named import), un oggetto sì (si muta una PROPRIETÀ, non si riassegna
// l'import). Necessario per esporli come slider nel pannello debug (tasto
// P → Drone Animation), esattamente come già avviene per le altre classi
export const droneTuning = {}
// quanto velocemente girano le pale (rad/s) — sempre, anche da fermo (un
// drone acceso non spegne le eliche stando fermo)
droneTuning.rotorSpinSpeed = 24
// rad di bank per rad/s di velocità di imbardata — tarato perché una
// virata "decisa" (~2 rad/s, tipica quando lerpAngle rincorre un target
// lontano a inizio sterzata) arrivi vicino a bankMax, poi il clamp sotto
// impedisce comunque qualunque inclinazione eccessiva a virate più brusche
droneTuning.bankGain = 0.15
droneTuning.bankMax = 0.35
droneTuning.bankSmoothSpeed = 8

// inclinazione del CORPO mentre si mira in alto in HANDLING (non durante
// Flight — vedi Drone.updateAimPosture): guardare su alza il braccio
// verso il corpo (elbow.rotation.x cresce, applyArmPitch in
// DroneModelMaker.js), che tende a portare paletta+palla proprio nella
// zona che la camera in HANDLING inquadra — un'inclinazione simmetrica del
// corpo stesso (nose-down, si allontana dalla linea di mira) libera un po'
// di spazio invece di lasciare il corpo fisso a bloccare la visuale
droneTuning.aimBodyTiltGain = 0.5
droneTuning.aimBodyTiltMax = 0.4
droneTuning.aimBodyTiltSmoothSpeed = 8

// inclinazione del CORPO in avanti mentre ci si muove (un quadricottero
// vero si impenna in avanti per "spingersi" nella direzione di marcia,
// non trasla restando piatto) — magnitudine proporzionale alla velocità
// REALE misurata frame-su-frame (root.position, non lo stat SPEED: così
// riflette anche il dash), sempre nose-down nella direzione di marcia
// (bodyGroup è già orientato lì dallo yaw) e mai all'indietro/di lato.
// Combinata con aimBodyTilt sullo STESSO asse (setBodyPitch prende un
// singolo valore combinato, vedi Drone.js) — un drone può muoversi E
// mirare in alto insieme in HANDLING (velocità ridotta ma non zero)
droneTuning.thrustTiltGain = 0.0025
droneTuning.thrustTiltMax = 0.25
droneTuning.thrustTiltSmoothSpeed = 6

// Flight — cooldown lungo (1 carica, non spammabile come il Dash):
// innalzamento rapido di quota che rende immune a STEAL non tramite un
// flag di immunità dedicato, ma semplicemente perché il test di contatto
// di STEAL (CombatMoves.js) usa il vero bounding box del bersaglio — se
// il drone è 400+ unità più in alto, quel box non si sovrappone mai alla
// zona di reach dello stealer (margine ~90 unità), nessuna modifica
// necessaria altrove. Fasi: grab (0.15s, presa della palla) → rise (1s) →
// hold (4s, in quota) → descend (1s) — poi 17s di ricarica (hold +1s e
// cooldown +2s rispetto al tuning iniziale: più tempo utile in quota per
// mirare/tirare, compensato da un rientro in carica un po' più lento)
droneTuning.flightCooldown = 17
droneTuning.flightRiseDuration = 1
droneTuning.flightHoldDuration = 4
droneTuning.flightDescendDuration = 1
droneTuning.flightHeight = 400 // unità mondo — ben oltre qualunque raggio di reach STEAL/BLOCK
// mentre elevato, muoversi resta possibile ma molto rallentato (20% della
// velocità normale) — mirare con precisione da lassù è già difficile di
// suo, un movimento a piena velocità farebbe scivolare via il crosshair
// dal bersaglio troppo in fretta
droneTuning.flightSpeedScale = 0.2
// grab pre-decollo: veloce (0.15s, non percettibile come un'attesa) — solo
// il gesto della paletta, stesso ordine di grandezza di handlingTuning.gripOffset
// (0.5, main.js) usato dalla vera HANDLING, non importato qui perché
// RobotBase/Drone non hanno accesso al context di gioco (BallPossession.js)
droneTuning.flightGrabDuration = 0.15
// 0.5 (stesso valore di handlingTuning.gripOffset) sembrava naturale per
// coerenza con la vera HANDLING, ma verificato dal vivo (screenshot
// headless, camera zoomata su paletta+palla): a quel grip la V resta
// ancora molto aperta (paddleAngle base 2.4rad - 0.5 = 1.9rad) e la palla
// resta a distanza visibile, "non stretta". Controintuitivo: STRINGERE il
// grip NON avvicina il punto di aggancio (ballRestPoint) alla palla quanto
// ci si aspetterebbe — un test dedicato (bisezione sull'offset minimo che
// evita compenetrazione, per vari grip) mostra che il minSafeOffset CRESCE
// con il grip (0.313 a grip 0.5, fino a 0.446 a grip 1.3): chiudendo la V
// gli SPIGOLI esterni delle due metà roteano più vicino alla palla anche
// se il punto sul bisettore si avvicina, quindi serve PIÙ margine di
// sicurezza, non meno. Il pareggio netto è quasi nullo in termini di
// distanza pura — ma VISIVAMENTE le due metà avvolgono la palla molto di
// più (angolo di chiusura maggiore = "artiglio" più stretto attorno
// all'equatore), anche se la cima resta a distanza simile: confermato
// visivamente (grip 1.3/offset 0.45 nettamente più "agganciato" di grip
// 0.5/offset 0.35 nello stesso confronto). Oltre ~1.5 le due metà si
// sovrappongono a vicenda prima ancora di toccare la palla (overlap fisso
// a 15, il punto finisce dentro il solido stesso della paletta) — 1.3
// restava con margine sotto quella soglia degenere, ma verificato dal vivo
// coi bottoni "Animation Preview" (pannello P, vedi main.js) — troppo
// stretto/artigliato visivamente, riaperto (prima a 1.0, poi ulteriormente
// qui) fino ad allinearlo a handlingTuning.gripOffset (0.5, RobotBase.js) —
// stessa apertura della vera HANDLING, nessun motivo per una V più stretta
// solo in Flight
droneTuning.flightGrabTarget = 0.5
// offset ridotto in due passi (0.25 lasciava ancora un gap visibile,
// poi 0.15 allineato a ballRestExtraOffset sotto, poi ancora leggermente
// giù) — regolabile da debug (Drone Animation → Flight → Grab Ball Rest
// Offset) se servisse ancora ritararlo con feedback visivo immediato
droneTuning.flightBallRestOffset = 0.1

export class Drone extends RobotBase {
  constructor(team) {
    super({ factory: DroneModelMaker, stats: DRONE_STATS, type: 'DRONE', team })
    this._bank = 0
    this._aimBodyTilt = 0
    this._thrustTilt = 0
    // posizione del frame precedente, per dedurre la velocità REALE
    // (root.position, non lo stat SPEED) frame-su-frame — vedi
    // updateLocomotionAnimation/thrustTiltGain sotto. Clonato SUBITO (non
    // lasciato null) così il primo frame non produce un salto di velocità
    // fittizio (distanza da null trattata come "già a regime")
    this._prevPosForThrustTilt = this.root.position.clone()
    // vedi commento su RobotBase.ballOffsetDown (campo d'istanza, non un
    // getter, apposta per restare tunabile da debug per classe attiva): la
    // V della paletta è capovolta (armFlip in DroneModelMaker.js). Il primo
    // tentativo (-12, ragionamento astratto sul flip mai verificato dal
    // vivo) era SBAGLIATO — sweep visivo dedicato (screenshot headless,
    // stepDribble reale, camera zoomata su paletta+palla, valori -12/0/12/
    // 25/40 confrontati a due punti diversi del ciclo) mostra la palla
    // che INGOZZA la paletta (compenetrazione reale, non un'illusione) sia
    // a -12 sia a 0; +12 è il primo valore che mostra la palla appoggiata
    // pulita SOPRA la paletta senza overlap; +25/+40 sovracorreggono (gap
    // visibile, palla staccata). +12 confermato su entrambi i campioni
    this.ballOffsetDown = 12
    // ballRestExtraOffset (RobotBase.js, default 0.08): compenetrazione
    // REALE confermata con un test dedicato (bounding box vera di
    // paddleLeft/paddleRight vs sfera-palla, non solo la Y del punto
    // tracciato) durante HANDLING — con gripOffset alto (V stretta) il
    // punto ballRestPoint di default finiva DENTRO il solido delle due
    // metà della paletta per un'ampiezza/scala che il default 0.08 (tarato
    // per MANIPULATOR) non copre. 0.35 verificato via sweep (headless)
    // come il primo valore che porta l'overlap sotto zero con margine —
    // riportato a 0.15 dopo ispezione dal vivo coi bottoni "Animation
    // Preview" (pannello P): la palla restava visibilmente troppo lontana
    // dalla paletta in HANDLING rispetto alle altre due classi
    this.ballRestExtraOffset = 0.15
    // dribbleTuning.bounceSpeedScale (RobotBase.js, default 1): verificato
    // con una simulazione dedicata (stepDribble headless, 600 passi) che il
    // braccio appeso/capovolto del Drone traduce la STESSA ampiezza
    // angolare del palleggio in un'escursione VERTICALE della paletta
    // minore di quella di MANIPULATOR (~42 unità contro ~57, a parità di
    // scala/ampiezza) — mentre la palla rimbalza sempre alla STESSA altezza
    // assoluta (fisica condivisa, dipende solo da BALL_BOUNCE_SPEED/
    // BALL_GRAVITY). A scale=1 la palla superava la paletta di +16 unità
    // durante 'rise' (compenetrazione visibile, segnalata dal vivo) prima
    // di ricongiungersi — 0.9 è il punto di pareggio esatto (max +/-0 unità
    // di distacco), 0.88 lascia un margine di sicurezza (~-3.8, stesso
    // ordine di grandezza del gap naturale di MANIPULATOR) contro variazioni
    // di frame/arrotondamento
    this.dribbleTuning.bounceSpeedScale = 0.88
    // shootTuning di RobotBase (windup contrae elbow/link1 verso valori
    // molto negativi, poi release estende verso piccoli positivi) è
    // tarato per il braccio APPESO SOTTO un corpo alto — corretto mentre
    // isElevated (Flight: il corpo è già lontano da terra, contrarre il
    // braccio verso l'alto non tocca nulla). A TERRA invece lo stesso
    // "contrarsi verso l'alto" porta il braccio A INTERSECARE il corpo
    // (appeso proprio lì sotto, niente più margine come in volo) — segnalato
    // dal vivo. elevatedShootTuning conserva quella posa (clone dei
    // default, "buoni per l'Flight" secondo il test in game) PRIMA di
    // modificare shootTuning stesso per il caso a terra: i due movimenti
    // invertiti (release e windup scambiati) fanno sì che a terra il
    // braccio si ESTENDA per primo (verso il basso, lontano dal corpo) e
    // si contragga SOLO durante il rilascio, mai verso il corpo mentre è
    // ancora "aperto" — stesso principio, direzione opposta
    this.elevatedShootTuning = { ...this.shootTuning }
    ;[this.shootTuning.elbowWindupDeg, this.shootTuning.elbowReleaseDeg] = [this.shootTuning.elbowReleaseDeg, this.shootTuning.elbowWindupDeg]
    ;[this.shootTuning.link1WindupDeg, this.shootTuning.link1ReleaseDeg] = [this.shootTuning.link1ReleaseDeg, this.shootTuning.link1WindupDeg]
    ;[this.shootTuning.tiltWindupPeak, this.shootTuning.tiltTarget] = [this.shootTuning.tiltTarget, this.shootTuning.tiltWindupPeak]
    // lo scambio sopra da solo preserva la STESSA magnitudine di prima
    // (solo riordinata) — confermato che la direzione ora è corretta, ma
    // la flessione visibile era troppo poca: il windup si fermava a +5°
    // (il vecchio target di release, un angolo piccolo) prima dello scatto
    // secco fino a -55° in release. Ingrandita qui (non solo riordinata)
    // per un windup che si estenda davvero prima di richiamarsi indietro
    // con più forza — ancora tutto tunabile dal vivo (pannello P → Drone
    // Animation → Shoot, il numero non ha più min/max). Release portato
    // troppo indietro (-70/-55, segnalato dal vivo): a fine rilascio il
    // braccio rientrava di nuovo dentro il corpo — ridotto a un richiamo
    // più corto, ancora un "colpo di frusta" ma senza tornare a
    // intersecare il corpo esattamente nell'istante del rilascio
    this.shootTuning.elbowWindupDeg = 25
    this.shootTuning.link1WindupDeg = 30
    this.shootTuning.elbowReleaseDeg = -20
    this.shootTuning.link1ReleaseDeg = -15
  }

  // "walking animation" del drone: non cammina — le pale girano SEMPRE
  // (spinRotors, indipendente dallo yaw target/delta) e il corpo si
  // inclina (bank) in proporzione a quanto sta virando in questo frame,
  // invece del semplice pivot rigido ereditato di default da RobotBase
  // (quello resta corretto per MANIPULATOR/LEGGED — ruote/gambe girano
  // rigidamente verso la direzione di marcia, un drone vero si INCLINA)
  updateLocomotionAnimation(targetYaw, delta, turnSpeed) {
    const prevYaw = this.locomotionYaw
    // NON super.updateLocomotionAnimation(): quella imposta
    // this.wheelsGroup.rotation.y DIRETTAMENTE (bodyGroup è wheelsGroup per
    // il Drone), bypassando controls.setWheelsYaw — e quindi la variabile
    // yawAngle chiusa in DroneModelMaker.js/applyBodyOrientation resterebbe
    // ferma a 0 per sempre. bank/setBodyPitch (chiamati poco sotto)
    // ricompongono l'INTERO quaternione da yawAngle/bankAngle/bodyPitchAngle
    // ogni volta — con yawAngle mai aggiornato, quella chiamata cancellava
    // lo yaw appena impostato (bug reale: il drone sembrava "girato di
    // lato" muovendosi, perché restava fermo a yaw=0 con solo bank/pitch
    // applicati). Stessa identica formula del default di RobotBase, solo
    // instradata per controls.setWheelsYaw invece del campo grezzo
    this.locomotionYaw = lerpAngle(this.locomotionYaw, targetYaw, 1 - Math.exp(-turnSpeed * delta))
    this.controls.setWheelsYaw(this.locomotionYaw)
    // lerpAngle prende già la via breve sul wrap-around, quindi la
    // differenza qui resta piccola frame-su-frame — nessun bisogno di un
    // secondo unwrap
    const yawRate = delta > 0 ? (this.locomotionYaw - prevYaw) / delta : 0
    const bankTarget = THREE.MathUtils.clamp(-yawRate * droneTuning.bankGain, -droneTuning.bankMax, droneTuning.bankMax)
    this._bank += (bankTarget - this._bank) * (1 - Math.exp(-droneTuning.bankSmoothSpeed * delta))
    this.controls.setBank(this._bank)
    this.controls.spinRotors(delta, droneTuning.rotorSpinSpeed)

    // "spinta" in avanti: un quadricottero vero si impenna per accelerare,
    // non trasla restando piatto — velocità dedotta dallo spostamento REALE
    // di root.position (copre anche il Dash, non solo il movimento WASD
    // normale), sempre nose-down nella direzione di marcia (bodyGroup è già
    // orientato lì dallo yaw, vedi applyBodyOrientation in DroneModelMaker.js
    // — il pitch è composto PRIMA dello yaw, quindi resta relativo al naso
    // qualunque sia la direzione di volo) — mai un tilt negativo (indietro)
    const movedSpeed = delta > 0 ? this.root.position.distanceTo(this._prevPosForThrustTilt) / delta : 0
    this._prevPosForThrustTilt.copy(this.root.position)
    const thrustTarget = THREE.MathUtils.clamp(movedSpeed * droneTuning.thrustTiltGain, 0, droneTuning.thrustTiltMax)
    this._thrustTilt += (thrustTarget - this._thrustTilt) * (1 - Math.exp(-droneTuning.thrustTiltSmoothSpeed * delta))
    this._applyBodyPitch()
  }

  // chiamato da updateHandling (BallPossession.js) ogni frame in HANDLING
  // (mai in Flight, dispatch mutuamente esclusivo in main.js): guardare
  // in alto (aimPitchOffset negativo, vedi computeAimPitchOffset in main.js)
  // porta il braccio a ripiegarsi verso il corpo — un'inclinazione simmetrica
  // del corpo stesso libera un po' la visuale invece di lasciarlo fisso lì
  // in mezzo. Stesso smoothing esponenziale di setBank, mai uno scatto secco.
  // Chiamato anche con aimPitchOffset=0 quando si esce da HANDLING (vedi
  // main.js) per rilassare l'inclinazione invece di lasciarla congelata
  updateAimPosture(aimPitchOffset, delta) {
    const target = THREE.MathUtils.clamp(-aimPitchOffset * droneTuning.aimBodyTiltGain, -droneTuning.aimBodyTiltMax, droneTuning.aimBodyTiltMax)
    this._aimBodyTilt += (target - this._aimBodyTilt) * (1 - Math.exp(-droneTuning.aimBodyTiltSmoothSpeed * delta))
    this._applyBodyPitch()
  }

  // aim (mirare in alto) e thrust (spinta in movimento) condividono lo
  // stesso asse fisico (setBodyPitch prende un unico valore combinato, non
  // due chiamate separate che si sovrascriverebbero a vicenda)
  _applyBodyPitch() {
    this.controls.setBodyPitch(this._aimBodyTilt + this._thrustTilt)
  }

  get specialMoveMaxCharges() { return 1 }
  get specialMoveCooldownTime() { return droneTuning.flightCooldown }

  // true durante tutta la mossa (salita/in quota/discesa), non solo al
  // picco — "da sopra si mira meglio": bonus di mira/hoop-assist da
  // agganciare quando il Drone sarà davvero selezionabile in partita
  // (Section 4), non cablato qui per non toccare ShootingSystem.js per
  // una classe non ancora giocabile
  get isElevated() {
    return this.specialMoveState.phase !== 'idle'
  }

  // velocità ridotta al 20% mentre isElevated (rise/hold/descend) — override
  // dello stesso getter di RobotBase (HANDLING lo riduce al 75%, qui va
  // molto più giù): le due condizioni non sono mai in conflitto pratico
  // (Flight resta usabile anche in HANDLING), quindi il caso Flight
  // prevale semplicemente scalando il risultato di RobotBase invece di
  // reimplementare la logica HANDLING qui
  get speed() {
    return this.isElevated ? super.speed * droneTuning.flightSpeedScale : super.speed
  }

  onSpecialMoveStart() {
    // 'grab' PRIMA di 'rise': un rapido richiudersi della paletta attorno
    // alla palla (setGrip, la stessa V usata da HANDLING) così il drone
    // non decolla lasciandosi la palla dietro/sotto — non un vero
    // RobotState.HANDLING (nessun cambio di stato/camera/velocità legato a
    // quello, solo il gesto visivo della paletta), giusto abbastanza per
    // vendere l'idea che stia afferrando la palla prima di sollevarsi
    this.specialMoveState.phase = 'grab'
    this.specialMoveState.phaseT = 0
    // NON scambiato subito qui (bug reale, trovato con un test deterministico
    // headless): swappare ballRestExtraOffset all'ISTANTE t=0, mentre il
    // grip è ancora a 0, faceva SALTARE ballRestPoint immediatamente lontano
    // dalla palla appena afferrata — la distanza ball↔ballRestPoint
    // AUMENTAVA nei primissimi frame di 'grab' (invece di calare
    // monotonicamente verso 0), prima di convergere. Eased in onSpecialMoveUpdate
    // in sincrono con lo stesso t del grip, vedi sotto — a fine 'grab'
    // (t=1) arriva comunque esattamente a flightBallRestOffset
  }

  // Flight: root.position.y segue un profilo a 4 fasi (grab→rise→hold→
  // descend) invece di una parabola (a differenza del Jump del Legged
  // Manipulator, qui vogliamo un vero "hold" in quota, non un arco
  // continuo) — stesso stile imperativo a timer del resto del progetto,
  // nessun motore fisico
  onSpecialMoveUpdate(delta) {
    const s = this.specialMoveState
    if (s.phase === 'idle') return
    s.phaseT += delta
    if (s.phase === 'grab') {
      const t = Math.min(s.phaseT / droneTuning.flightGrabDuration, 1)
      this.controls.setGrip(droneTuning.flightGrabTarget * t)
      // eased con lo STESSO t del grip, non scambiato di colpo in
      // onSpecialMoveStart — vedi commento lì sopra sul bug che questo fix
      this.controls.setBallRestOffset(THREE.MathUtils.lerp(this.ballRestExtraOffset, droneTuning.flightBallRestOffset, t))
      if (t >= 1) { s.phase = 'rise'; s.phaseT = 0 }
    } else if (s.phase === 'rise') {
      const t = Math.min(s.phaseT / droneTuning.flightRiseDuration, 1)
      this.root.position.y = droneTuning.flightHeight * THREE.MathUtils.smoothstep(t, 0, 1)
      if (t >= 1) { s.phase = 'hold'; s.phaseT = 0 }
    } else if (s.phase === 'hold') {
      this.root.position.y = droneTuning.flightHeight
      if (s.phaseT >= droneTuning.flightHoldDuration) { s.phase = 'descend'; s.phaseT = 0 }
    } else { // 'descend'
      const t = Math.min(s.phaseT / droneTuning.flightDescendDuration, 1)
      this.root.position.y = droneTuning.flightHeight * (1 - THREE.MathUtils.smoothstep(t, 0, 1))
      // il rilascio della presa segue lo stesso t del ridiscendere, invece
      // di scattare a 0 di colpo a fine descend — riapre la paletta man
      // mano che si riappoggia, non dopo
      this.controls.setGrip(droneTuning.flightGrabTarget * (1 - THREE.MathUtils.smoothstep(t, 0, 1)))
      if (t >= 1) {
        s.phase = 'idle'; s.phaseT = 0; this.root.position.y = 0
        // ripristina l'offset normale (tarato per il grip di HANDLING, non
        // quello più stretto di Flight) — vedi onSpecialMoveStart sopra
        this.controls.setBallRestOffset(this.ballRestExtraOffset)
      }
    }
  }
}
