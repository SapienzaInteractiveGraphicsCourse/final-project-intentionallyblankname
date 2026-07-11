// Wrapper OOP sopra le factory function dei robot (AMRManipulatorModelMaker(),
// LeggedManipulatorModelMaker(), DroneModelMaker()). Le factory
// restano la fonte di verità per la costruzione Three.js — non cambia nulla
// lì — questa classe aggiunge solo stat/tipo/comportamento condiviso.
// Object.assign copia root/wheelsGroup/joints/paddle/controls/getConfig
// sull'istanza, quindi tutto quello che main.js già usa (manipulator.root,
// manipulator.controls.X(), ecc.) continua a funzionare identico anche
// passando per questa classe — nessuna migrazione forzata del chiamante.

import * as THREE from 'three'
import { lerpAngle } from '../utils/mathUtils.js'
import { BALL_GRAVITY } from '../utils/constants.js'
import { Team } from '../state/Team.js'

// Colore ACCENT di default per squadra (paletta/end effector — il colore
// più "leggibile" a distanza) — solo questo canale differisce per team di
// default, arm/body restano gli stessi per entrambi (personalizzabili a
// parte dal Main Menu, solo per Team.A — vedi "Personalizza" in main.js).
// Team.A resta SEMPRE l'arancione di fabbrica (nessuna chiave qui sotto,
// invariato per definizione). Team.B (nemico) usa rosso invece
// dell'arancione di Team.A, così i due robot si distinguono a colpo
// d'occhio in 1v1 anche prima di leggere lo scoreboard (era viola in un
// primo tentativo, cambiato su richiesta esplicita)
const TEAM_ACCENT_COLOR = Object.freeze({ [Team.B]: 0xe83f3f })

// SPEED è uno stat 1-5 (stesso struct per ogni classe, cambiano solo i
// valori), convertito in unità mondo/secondo con questa formula: SPEED=3
// corrisponde a 200, il valore già tarato a occhio per MANIPULATOR prima
// che esistessero le stat.
function speedStatToUnitsPerSecond(speedStat) {
  return 50 + speedStat * 50
}

// "Enum" equivalente in JS: non esiste un costrutto enum nativo, il pattern
// idiomatico è un oggetto plain congelato — RobotState.DRIBBLE invece di
// stringhe sciolte in giro per il codice, autocomplete-friendly, e
// Object.freeze impedisce di riassegnare/aggiungere chiavi per sbaglio
export const RobotState = Object.freeze({
  DRIBBLE: 'dribble',    // palleggio automatico attivo (comportamento di default)
  HANDLING: 'handling',  // palla afferrata e ferma in mano, palleggio in pausa
  NO_BALL: 'no_ball',    // palla appena tirata, non più in mano/palleggio finché non viene ripresa
})

export class RobotBase {
  constructor({ factory, stats, type, team }) {
    Object.assign(this, factory())
    this.stats = stats
    this.type = type
    this.team = team // Team.A/Team.B (src/Team.js) — chi possiede la palla si legge da qui via Basketball.owner.team
    // default per-squadra applicato SUBITO alla costruzione — Team.A (nessuna
    // chiave in TEAM_ACCENT_COLOR) resta l'arancione di fabbrica del
    // ModelMaker, invariato
    if (TEAM_ACCENT_COLOR[team] !== undefined) this.controls.setColors({ accent: TEAM_ACCENT_COLOR[team] })
    this.state = RobotState.DRIBBLE
    // orientamento visivo della locomozione (yaw interpolato verso una
    // direzione bersaglio) — di proprietà del ROBOT, non più duplicato come
    // `let` sciolto in main.js (giocatore) ED EnemyAI.js (nemico): stesso
    // smoothing esponenziale, stesso valore iniziale, prima scritto due volte
    this.locomotionYaw = -Math.PI / 2
    // stato generico della mossa speciale — la STRUTTURA (fase/tempo
    // residuo/cariche/ricarica) è condivisa, i NUMERI e cosa succede
    // davvero durante 'active' sono di ogni sottoclasse (onSpecialMove*
    // sotto). MANIPULATOR fa eccezione: il suo Dash resta il meccanismo
    // originale in main.js (accoppiato a movimento/camera/HUD, esistente
    // e testato), non migrato qui per non rischiare di romperlo — questo
    // hook è per le mosse NUOVE (Jump/Flight) che partono da zero
    this.specialMoveState = { phase: 'idle', phaseT: 0, charges: this.specialMoveMaxCharges, rechargeTimer: 0 }
    // Ball Offset (Forward/Side/Down, BallPossession.js/stepDribble): quanto
    // il punto tracciato dal palleggio automatico si sposta dal centro
    // geometrico grezzo della paletta (paddleCenter) — PER ISTANZA, non
    // condiviso tra classi: ognuna ha un braccio/orientamento diverso
    // (LEGGED più grande, DRONE capovolto e appeso sotto un corpo sospeso
    // invece che sopra un disco), lo stesso numero assoluto non produce lo
    // stesso punto visivo per tutte. Default = i valori storici (tarati a
    // occhio per MANIPULATOR quando questi erano ancora un'unica costante
    // globale in dribbleTuning, main.js) — ogni sottoclasse può
    // sovrascriverli nel proprio costruttore (vedi Drone.js: Down invertito,
    // la V capovolta rende "giù" la direzione sbagliata). Campi di ISTANZA
    // (non getter sul prototype): devono restare scrivibili a runtime dal
    // pannello debug (tasto P → Basketball) per la classe attiva in quel
    // momento — un accessor solo-getter ereditato lo impedirebbe
    // (assegnazione a un accessor senza setter lancia in strict mode)
    this.ballOffsetForward = 6
    this.ballOffsetSide = 0
    this.ballOffsetDown = 12
    // ballRestExtraOffset (controls.setBallRestOffset): distanza extra
    // lungo la convergenza della V oltre il punto geometricamente esatto,
    // SOLO per HANDLING/tiro (ballRestPoint, non paddleCenter) — PER
    // ISTANZA, stesso motivo di Ball Offset sopra. Bug reale trovato: con
    // una presa stretta (gripOffset alto) la V si chiude, il punto
    // geometrico si avvicina, e il default 0.08 (tarato per MANIPULATOR)
    // non basta a tenere la palla fuori dal solido delle due metà per
    // altre classi/pose — verificato con un test dedicato (bounding box
    // reale delle mesh paddleLeft/paddleRight vs sfera-palla), non solo
    // ad occhio
    this.ballRestExtraOffset = 0.08
    // Dribble/Shoot/Handling tuning: PER ISTANZA, stesso motivo di Ball
    // Offset sopra — MANIPULATOR/LEGGED/DRONE hanno braccio/scala/
    // orientamento diversi, gli stessi numeri di durata/ampiezza/velocità
    // non producono lo stesso risultato visivo per tutte. Prima erano tre
    // oggetti GLOBALI condivisi in main.js (dribbleTuning/shootTuning/
    // handlingTuning) — spostati qui come default (stessi valori, nessun
    // cambio di comportamento finché non vengono tarati diversamente per
    // classe dal pannello debug, tasto P). Oggetti pieni (non solo
    // scalari): un `Object.assign` o `{...instance.dribbleTuning}` altrove
    // continuerebbe a funzionare, e onChange degli slider muta una
    // PROPRIETÀ (sempre permesso) invece di riassegnare il campo intero
    // bounceSpeedScale: moltiplicatore SOLO sulla velocità di rimbalzo
    // (BALL_BOUNCE_SPEED, stepDribble/BallPossession.js) — BALL_GRAVITY/
    // BALL_BOUNCE_SPEED restano vere costanti condivise in constants.js
    // (la gravità è la gravità, non ha senso differenziarla per classe),
    // ma l'ALTEZZA del rimbalzo deve comunque raggiungere la paletta di
    // classi con manipulatorScale diversa (LEGGED, 25% più alta) — a
    // parità di gravità, l'apice (h = v²/2g) scala con v², quindi serve
    // scalare v di √1.25, non 1.25. Campo di ISTANZA (non un getter sul
    // prototype, era così prima): deve restare scrivibile a runtime dal
    // pannello debug per classe attiva, un accessor solo-getter ereditato
    // lo impedirebbe
    this.dribbleTuning = {
      pushDuration: 0.25, elbowAmplitudeDeg: 40, link1AmplitudeDeg: 10,
      lockAbsorbTime: 0.25, riseYCorrection: 7, bounceSpeedScale: 1,
      // dribbleGravity: PROPRIA del palleggio automatico, non la stessa
      // BALL_GRAVITY del volo di tiro vero (quella resta un'unica costante
      // fisica condivisa in constants.js — il tiro attraversa tutto il
      // campo/collisioni/canestro, deve restare fisicamente coerente per
      // tutti). Il palleggio invece è solo un'animazione locale vicino al
      // robot: darle una gravità PROPRIA per classe è un'alternativa più
      // pulita a bounceSpeedScale per correggere quanto in alto rimbalza —
      // stesso default (= BALL_GRAVITY) finché non viene tarata diversa
      dribbleGravity: BALL_GRAVITY,
    }
    this.shootTuning = {
      shotSpeed: 1100,
      windupDuration: 0.35, releaseDuration: 0.3, recoverDuration: 0.25,
      elbowWindupDeg: -55, link1WindupDeg: -40,
      elbowReleaseDeg: 5, link1ReleaseDeg: 15,
      releaseLead: 0.25, releasePoint: 0.8,
      stateTransitionDelay: 0.35,
      elbowAimCoupling: 1,
      tiltWindupPeak: -2.5, tiltTarget: -0.5,
    }
    this.handlingTuning = { ease: -0.3, gripOffset: 0.5, transitionSpeed: 12 }
    // override OPZIONALE di shootTuning usato SOLO mentre isElevated è vero
    // (Drone, durante Flight) — null di default: la maggior parte delle
    // classi non ha un concetto di "elevato" e usa sempre shootTuning sopra.
    // Il Drone ne ha bisogno perché la posa di windup/release che funziona
    // mentre è a terra (braccio appeso sotto il corpo) intersecherebbe il
    // corpo stesso se usata mentre è già sollevato con un braccio già
    // esteso in una posa diversa — vedi Drone.js
    this.elevatedShootTuning = null
  }

  // Override per sottoclasse: cariche massime e cooldown per ricaricarne
  // una. Default 1 carica, mai ricaricabile (Infinity) — una sottoclasse
  // senza mossa speciale vera non deve fare altro
  get specialMoveMaxCharges() { return 1 }
  get specialMoveCooldownTime() { return Infinity }

  canUseSpecialMove() {
    return this.specialMoveState.phase === 'idle' && this.specialMoveState.charges > 0
  }

  // Trigger condiviso: consuma una carica, avvia il cooldown di ricarica
  // se non già in corso, delega l'EFFETTO vero a onSpecialMoveStart()
  // (override di sottoclasse — imposta phase/phaseT, cattura direzione,
  // ecc.). Ritorna false senza fare nulla se non disponibile (fuori
  // cooldown/carica/già in corso), così main.js può limitarsi a
  // `if (!robot.triggerSpecialMove()) return`
  triggerSpecialMove() {
    if (!this.canUseSpecialMove()) return false
    this.specialMoveState.charges--
    if (this.specialMoveState.rechargeTimer <= 0) this.specialMoveState.rechargeTimer = this.specialMoveCooldownTime
    this.onSpecialMoveStart()
    return true
  }

  // Aggiornamento per-frame condiviso: ricarica cariche IN SEQUENZA (un
  // solo timer alla volta, non in parallelo — stesso pattern già in uso
  // per il Dash), poi delega l'animazione/effetto vero a
  // onSpecialMoveUpdate() (override di sottoclasse). `isShooting` (true
  // mentre shootingState.phase !== 'idle', passato da main.js) congela la
  // progressione di una mossa speciale già ATTIVA — es. l'Flight del
  // Drone non deve continuare a salire/scendere di quota mentre il tiro è
  // a metà animazione, altrimenti il gomito/la paletta (agganciati al
  // pitch della camera, non alla quota) si troverebbero a inseguire un
  // bersaglio che si sposta in verticale sotto di loro durante il windup/
  // release. Il tempo restante NON viene consumato mentre congelato — la
  // fase riprende esattamente da dove era arrivata (stesso `phaseT`,
  // stessa quota) appena il tiro torna a 'idle', nessuno scatto. La
  // ricarica delle cariche resta indipendente (continua comunque): non è
  // la mossa ATTIVA a congelarsi, è solo la ricarica di una futura non
  // ancora partita — nessun motivo per fermarla durante un tiro
  updateSpecialMove(delta, isShooting = false) {
    if (this.specialMoveState.charges < this.specialMoveMaxCharges) {
      this.specialMoveState.rechargeTimer -= delta
      if (this.specialMoveState.rechargeTimer <= 0) {
        this.specialMoveState.charges++
        this.specialMoveState.rechargeTimer = this.specialMoveState.charges < this.specialMoveMaxCharges ? this.specialMoveCooldownTime : 0
      }
    }
    if (isShooting && this.specialMoveState.phase !== 'idle') return
    this.onSpecialMoveUpdate(delta)
  }

  // Hook di sottoclasse — default vuoti (nessuna mossa speciale)
  onSpecialMoveStart() {}
  onSpecialMoveUpdate() {}

  // Hook di sottoclasse per il palleggio: stepDribble (BallPossession.js)
  // lo chiama ad ogni passo fisso, DOPO aver già posizionato palla/braccio
  // per quel tick — un tocco visivo supplementare per classe (es. le gambe
  // del Legged che si accovacciano leggermente a ritmo di palleggio, il
  // Drone che fluttua/si inclina) SENZA duplicare la macchina a stati
  // push/drop/rise stessa, che resta condivisa e identica per tutti.
  // Default vuoto: MANIPULATOR e LEGGED (per ora) non hanno nulla da
  // aggiungere lì
  onDribbleTick(state, delta) {}

  // Hook di sottoclasse chiamato da updateHandling (BallPossession.js) ogni
  // frame in HANDLING (mai durante Flight — i due stati sono mutuamente
  // esclusivi nel dispatch di main.js), con lo stesso aimPitchOffset già
  // passato a controls.setAimPitch(). Default vuoto: solo il Drone ne ha
  // bisogno (corpo che si inclina per liberare la visuale mentre si mira in
  // alto) — MANIPULATOR/LEGGED non hanno un corpo "in volo" da spostare
  updateAimPosture(aimPitchOffset, delta) {}

  // "volume corporeo standard" del robot — bounding box REALE (non una
  // forma approssimata a mano, che potrebbe disallinearsi dal modello vero
  // se la scala/geometria cambia da debug panel), condivisa da chi aveva
  // bisogno di testare "sto toccando questo robot?": prima calcolata in 3
  // punti diversi con la stessa formula (`new THREE.Box3().setFromObject(
  // root)`) — pickup (BallPossession.js), contatto STEAL (CombatMoves.js),
  // e il debug view (CollisionDebugView.js, tasto 9) — ora un solo metodo.
  // `target` opzionale (Box3 scratch riusato dal chiamante, hot path a
  // 60+Hz) invece di allocarne uno nuovo ad ogni chiamata
  getBodyBox(target = new THREE.Box3()) {
    return target.setFromObject(this.root)
  }

  setState(state) {
    this.state = state
  }

  // Aggiorna l'orientamento visivo della locomozione verso targetYaw (rad),
  // con lo stesso smoothing esponenziale framerate-independent usato da
  // sempre (lerpAngle prende la via breve sul wrap-around, es. da 350° a
  // 10° gira per 20°, non per 340°). Implementazione di default: applica lo
  // yaw a `wheelsGroup` — comportamento corretto per qualunque classe che
  // orienta un singolo gruppo rigido di locomozione (MANIPULATOR a ruote,
  // per ora anche LEGGED MANIPULATOR finché non ha un vero ciclo di passo
  // — vedi CLAUDE.md Section 4). Una classe con un'animazione di
  // locomozione realmente diversa (gambe che camminano, drone che si
  // inclina) sovrascrive questo metodo invece di duplicare la chiamata
  // altrove
  updateLocomotionAnimation(targetYaw, delta, turnSpeed) {
    this.locomotionYaw = lerpAngle(this.locomotionYaw, targetYaw, 1 - Math.exp(-turnSpeed * delta))
    this.wheelsGroup.rotation.y = this.locomotionYaw
  }

  // velocità di BASE (unità mondo/s), sempre piena — usata dal dash: uno
  // scatto resta lo stesso burst indipendentemente da HANDLING, non va
  // rallentato dalla stessa riduzione del movimento normale
  get baseSpeed() {
    return speedStatToUnitsPerSecond(this.stats.speed)
  }

  // velocità reale (unità mondo/s) derivata dallo stat SPEED — usata dal
  // movimento normale. Ridotta al 75% in HANDLING: si cammina un po' più
  // lenti mentre si tiene la palla ferma in mano, non dimezzata (troppo
  // penalizzante mentre si mira)
  get speed() {
    return this.state === RobotState.HANDLING ? this.baseSpeed * 0.75 : this.baseSpeed
  }

  // movimento condiviso da tutte le classi: la velocità viene dallo stat,
  // non da una costante fissa in main.js
  move(moveVec, delta) {
    this.root.position.addScaledVector(moveVec, this.speed * delta)
  }
}
