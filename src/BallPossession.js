import * as THREE from 'three'
import { RobotState } from './robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { angleToForward, rotateRight } from './mathUtils.js'
import { BALL_BOUNCE_SPEED, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX } from './constants.js'

// Terzo pezzo del refactor modulare (dopo mathUtils/debugPanelHelpers,
// prima di MainMenu): come il robot possiede/palleggia/afferra la palla —
// palleggio automatico, presa (HANDLING) e pickup automatico. Stesso
// principio di MainMenu.js: zero import da main.js, tutto ricevuto come
// context o parametro esplicito.
//
// paddleWorldPos è ESPORTATO (non solo interno): serve anche a main.js per
// il pannello debug (readout "paddle-y"/"ball-paddle-gap") e allo Shooting
// System (updateShootAnimation) — condiviso invece di duplicato, un solo
// punto di verità su "dove sta la paletta in questo istante".
export const paddleWorldPos = new THREE.Vector3()

// updateWorldMatrix(true,...) + getWorldPosition: pattern ripetuto ovunque
// serva la posizione MONDO reale di un nodo della gerarchia del robot in
// questo stesso frame (matrixWorld si aggiorna di norma solo durante il
// render, quindi senza sarebbe in ritardo di un frame) — object3D e out
// espliciti (non un accessor sul robot) perché serve sia per la paletta
// sia per ballRestPoint sia, in CombatMoves.js, di nuovo per la paletta ma
// su un'istanza robot diversa (nemico) con un proprio scratch
export function getObjectWorldPosition(object3D, out) {
  object3D.updateWorldMatrix(true, false)
  return object3D.getWorldPosition(out)
}
// bounding box VERA del robot (non la distanza dal solo centro/root — il
// corpo è largo e basso, non uno sferoide, un raggio da un punto solo non
// rappresenta bene quando la palla è davvero "a portata") — ricalcolata
// dalla geometria reale ogni volta, si adatta a qualunque posa/rotazione.
// Esportata come funzione (non solo interna a checkForPickup): il readout
// debug "pickup-dist" in main.js deve mostrare ESATTAMENTE lo stesso test,
// non una sua approssimazione a parte
const scratchRobotBox = new THREE.Box3()
export function isRobotTouchingBall(manipulator, basketball, ballRadius, margin) {
  manipulator.getBodyBox(scratchRobotBox)
  scratchRobotBox.expandByScalar(ballRadius + margin)
  return scratchRobotBox.containsPoint(basketball.position)
}
// SOLO per stepDribble (palleggio automatico), dove il tilt della paletta
// resta sempre costante (yaw+giù fisso basta) — updateHandling/tiro NON
// usano questi offset, lì il tilt cambia e la palla segue direttamente il
// centro vero della paletta
const paddleForwardDir = new THREE.Vector3()
const paddleSideDir = new THREE.Vector3()
const paddleDownDir = new THREE.Vector3(0, -1, 0) // costante: "giù" è sempre il basso reale del mondo

// entrambe tunabili da slider: niente cache module-scope, ricalcolate ad
// ogni chiamata — usata da stepDribble/updateHandling/updatePickup/il
// trigger del tiro invece di ripetere la stessa coppia di degToRad in ognuno
export function dribbleAmplitudesRad(dribbleTuning) {
  return [THREE.MathUtils.degToRad(dribbleTuning.elbowAmplitudeDeg), THREE.MathUtils.degToRad(dribbleTuning.link1AmplitudeDeg)]
}

// "incolla" la palla al vero punto di convergenza della V della paletta
// (manipulator.ballRestPoint, non .paddle — quello è il centro piatto usato
// dal palleggio automatico, causerebbe compenetrazione visiva) — condivisa
// da updateHandling/updatePickup qui e da updateShootAnimation in
// ShootingSystem.js, invece di ripetere le stesse 3 righe in tre punti
export function snapBallToRestPoint(manipulator, basketball) {
  getObjectWorldPosition(manipulator.ballRestPoint, paddleWorldPos)
  basketball.position.copy(paddleWorldPos)
}

// riporta un robot a "possiede la palla, in palleggio pulito, niente
// residuo di HANDLING/tiro/mossa in corso" — stessa sequenza di 6 righe
// che finiva ritypata a mano in updatePickup qui sotto E in
// CombatMoves.js (fine di un furto riuscito): shootingState.released e
// handlingState.grip/tiltOffset sono gli esatti campi che, se lasciati
// "sporchi" da un giro precedente (HANDLING interrotto da un furto, un
// tiro mai ripreso di persona), causavano rispettivamente la palla che
// "cadeva"/spariva invece di palleggiare, e la paletta che restava storta
export function resetToNeutralPossession(manipulator, { dribbleState, handlingState, shootingState }, resetDribbleState) {
  dribbleState.armEase = 0
  manipulator.setState(RobotState.DRIBBLE)
  resetDribbleState()
  shootingState.released = false
  handlingState.grip = 0
  handlingState.tiltOffset = 0
  manipulator.controls.setGrip(0)
  // mancava: azzerava la VARIABILE tracciata (tiltOffset) ma mai il JOINT
  // vero — stepDribble non tocca MAI il tilt (solo elbow/link1), quindi la
  // paletta restava storta al valore lasciato da un HANDLING precedente
  // per tutto il palleggio successivo, finché non si rientrava in HANDLING
  // (che rifà setShootTilt da capo, "aggiustandola" dopo un istante)
  manipulator.controls.setShootTilt(0)
  // difensivo, stesso principio: elbow/link1 dovrebbero già essere a 0
  // (STEAL/BLOCK/pickup finiscono la propria animazione esattamente lì
  // prima di arrivare qui), ma esplicito invece di assunto — stesso
  // pattern già usato da MainMenu.js per il reset completo
  manipulator.controls.setDribbleOffsets(0, 0)
}

// riporta cameraState.orbitPitch dentro il range normale (fuori da
// HANDLING): il clamp esteso di HANDLING (fino a valori estremi, per poter
// puntare in alto verso il canestro) è valido SOLO mentre si è in
// HANDLING — appena si esce (rilascio del tasto destro o fine tiro) la
// camera passa alla formula normale (orbita+lookAt), che con un pitch
// così estremo manda la camera sotto il pavimento (mai riclampata
// altrimenti fino al prossimo movimento del mouse). Condivisa da
// releaseBallHandling() qui e da updateShootAnimation in ShootingSystem.js.
// ORBIT_PITCH_MIN/MAX importate direttamente (vere costanti, mai
// riassegnate) — il range HANDLING-esteso resta invece locale a main.js,
// è specifico della camera in Play mode
export function clampOrbitPitchToNormalRange(cameraState) {
  cameraState.orbitPitch = THREE.MathUtils.clamp(cameraState.orbitPitch, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX)
}

// rete di sicurezza per 'drop' (vedi commento dentro stepDribble): una
// vera caduta è sempre molto più breve di questo
const DRIBBLE_DROP_SAFETY_TIMEOUT = 2

// Costruisce un oggetto-state pulito per stepDribble — stessa forma
// scritta a mano in 4 punti prima di questa estrazione (giocatore/nemico
// in main.js, preview card del Main Menu, modal di zoom): un solo posto
// di verità sulla forma dello state, invece di 4 letterali che potrebbero
// disallinearsi silenziosamente se un campo viene aggiunto/rinominato in
// futuro. Campi:
// - phase/phaseT: fase corrente ('push'|'drop'|'rise') e relativo timer
// - armEase: 0 = braccio a riposo (in cima), 1 = spinta al massimo —
//   persiste anche durante 'drop' (il braccio resta fermo dov'è arrivato),
//   aggiornata solo in 'push'/'rise'
// - ballVelocityY: velocità verticale vera della palla in 'drop'/'rise'
// - riseBallisticY: fisica balistica pura di 'rise', SEPARATA dalla Y
//   renderizzata — se si sottraesse dribbleTuning.riseYCorrection direttamente
//   dalla Y renderizzata ogni frame, il frame successivo ripartirebbe già
//   "corretto" e la sottrazione si accumulerebbe frame dopo frame invece
//   di restare un piccolo offset costante
// - previousPushPaddleY: Y della PALETTA (non della palla) al frame
//   precedente, solo durante 'push' — serve a dedurre la velocità reale
//   che la spinta impartisce (differenza finita), così 'drop' riparte da
//   quella invece che da un azzeramento secco. null = "appena entrati in
//   push, nessuna storia da cui dedurla"
// - lockOffset (Vector3): offset palla↔paletta congelato nell'istante in
//   cui la palla si "riaggancia" (fine 'rise' → 'push') — il lock parte
//   esattamente da lì (nessuno scatto), poi si riassorbe verso 0 nel corso
//   della spinta
export function createDribbleState() {
  return {
    phase: 'push', phaseT: 0, armEase: 0,
    ballVelocityY: 0, riseBallisticY: 0, previousPushPaddleY: null,
    lockOffset: new THREE.Vector3(),
  }
}

// Simulazione del palleggio, macchina a stati push/drop/rise — parametrizzata
// su un robot/bersaglio-palla/oggetto-stato qualunque (non solo i
// manipulator/basketball reali), riusata IDENTICA anche dalla preview robot
// del Main Menu (vedi renderRobotCardPreview in main.js), che deve mostrare
// il vero palleggio, non un'imitazione con un timing indovinato a parte.
// state è un oggetto { phase, phaseT, armEase, ballVelocityY,
// previousPushPaddleY, riseBallisticY, lockOffset (Vector3) } — mutato in
// place, chi chiama decide come/se leggerne i campi dopo. physics è
// { ballRadius } — non più dribbleTuning (letto da robot.dribbleTuning, PER
// ISTANZA — vedi RobotBase.js — non più un unico oggetto condiviso da
// tutte le classi): ballRadius resta passato ad ogni chiamata (non fissato
// una volta) perché resta regolabile da debug a runtime. onBounce
// (opzionale) scatta solo al tocco del pavimento in 'drop': il gioco vero
// ci suona sfx.playBounce, la preview del menu resta silenziosa (nessun
// suono atteso sfogliando i menu)
export function stepDribble(state, robot, ballPositionTarget, dt, physics, onBounce) {
  const { ballRadius } = physics
  const dribbleTuning = robot.dribbleTuning
  state.phaseT += dt
  const [elbowAmplitude, link1Amplitude] = dribbleAmplitudesRad(dribbleTuning)
  // armEase aggiornata solo in 'push'/'rise' — in 'drop' resta quella di
  // fine 'push' (il braccio è fermo in fondo, non tocca nulla)
  if (state.phase === 'push') {
    const t = Math.min(state.phaseT / dribbleTuning.pushDuration, 1)
    state.armEase = t * t // ease-IN: velocità massima (non zero) proprio al rilascio, sempre da 0 (pose pulita, niente scatto residuo)
  } else if (state.phase === 'rise') {
    // dribbleTuning.bounceSpeedScale (RobotBase.js, default 1, per istanza):
    // classi più alte di MANIPULATOR (LEGGED MANIPULATOR) rimbalzano più
    // forte per raggiungere comunque la paletta più in alto — il rimbalzo
    // vero (dove ballVelocityY viene impostata) scala già questa velocità,
    // quindi anche la durata prevista del rise deve scalare di pari passo.
    // dribbleGravity (non la BALL_GRAVITY vera del volo di tiro, quella
    // resta un'unica costante fisica condivisa): il palleggio automatico è
    // solo un'animazione locale, ogni classe ha la propria per correggere
    // quanto in alto/veloce rimbalza senza toccare la fisica reale del tiro
    const riseDuration = (BALL_BOUNCE_SPEED * dribbleTuning.bounceSpeedScale) / dribbleTuning.dribbleGravity // tempo per decelerare a v=0 sotto gravità
    const t = Math.min(state.phaseT / riseDuration, 1)
    state.armEase = 1 - t * t * (3 - 2 * t) // da 1 a 0: il braccio torna su mentre la palla risale
  }
  // applicata PRIMA di leggere la world position della paletta, altrimenti
  // sarebbe in ritardo di un frame rispetto alla posa appena decisa sopra
  robot.controls.setDribbleOffsets(state.armEase * elbowAmplitude, state.armEase * link1Amplitude)

  getObjectWorldPosition(robot.paddle, paddleWorldPos)
  // il punto di tracking (centro geometrico della paletta) non è dove
  // dovrebbe stare la palla a occhio: 3 offset (Forward/Side/Down,
  // tarabili da debug → Basketball → Ball Offset) spostano quel punto.
  // NON relativi alla rotazione dell'end effector (gomito/link1/polso/
  // tilt): con Forward=40 e il gomito che spazza 40° durante il push,
  // un offset che ruotasse CON quella pitch disegnerebbe un arco da 40
  // unità di raggio, staccando visibilmente la palla dalla paletta —
  // solo lo yaw della base (dove punta il braccio orizzontalmente) è
  // rilevante, Down è sempre il basso reale del mondo. SOLO qui (dribble
  // automatico): il tilt della paletta resta costante in questa fase
  // (state.paddleTilt, mai toccato da setShootTilt), quindi la formula
  // yaw-only che ha sempre funzionato resta corretta invariata
  angleToForward(robot.joints.base.rotation.y, paddleForwardDir)
  rotateRight(paddleForwardDir, paddleSideDir)
  // ballOffsetForward/Side/Down: campi di ISTANZA sul robot (RobotBase.js),
  // non più valori condivisi in dribbleTuning — ogni classe ha la propria
  // geometria/orientamento del braccio (vedi commento su RobotBase per il
  // perché), lo stesso numero assoluto non si traduce nello stesso punto
  // visivo per MANIPULATOR/LEGGED/DRONE
  paddleWorldPos
    .addScaledVector(paddleForwardDir, robot.ballOffsetForward)
    .addScaledVector(paddleSideDir, robot.ballOffsetSide)
    .addScaledVector(paddleDownDir, robot.ballOffsetDown)

  if (state.phase === 'push') {
    // lockOffset si riassorbe in lockAbsorbTime (breve, non sull'intera
    // spinta): al frame del "riaggancio" la palla resta esattamente dov'era
    // (nessuno scatto), poi converge in fretta sulla paletta — per il resto
    // della spinta la segue esattamente, offset zero
    const lockBlend = Math.min(state.phaseT / dribbleTuning.lockAbsorbTime, 1)
    ballPositionTarget.copy(paddleWorldPos).addScaledVector(state.lockOffset, 1 - lockBlend)
    // velocità dedotta dal movimento REALE della paletta (paddleWorldPos),
    // non da ballPositionTarget: quella include anche il riassorbimento di
    // lockOffset, che con Lock Absorb Time pari all'intera Push Duration
    // contribuisce un termine costante alla velocità per tutta la spinta —
    // compreso l'ultimo passo, quello del rilascio. lockOffset varia
    // leggermente da ciclo a ciclo, quindi ogni tanto quel termine
    // annullava quasi del tutto la velocità vera della paletta proprio al
    // rilascio, dando l'impressione di un azzeramento/rallentamento a
    // inizio 'drop'. Con dt fisso questa lettura per-passo è stabile: non
    // c'è più un delta variabile/anomalo che possa farla collassare vicino
    // a zero
    if (state.previousPushPaddleY !== null) state.ballVelocityY = (paddleWorldPos.y - state.previousPushPaddleY) / dt
    state.previousPushPaddleY = paddleWorldPos.y
    // tolleranza, non ">= 1" stretto: phaseT accumula dt (1/120, non
    // rappresentabile esattamente in binario) per ~30 passi, quindi arriva
    // a un pelo SOTTO 0.25 invece che esattamente uguale — armEase tocca
    // 0.999999999999998 invece di 1, e senza tolleranza serve un passo
    // fisso intero "sprecato" in più prima che la transizione scatti
    // davvero. In quel passo la paletta è già a fine corsa e non si muove
    // per niente (Δy = 0 esatto) → l'ultima ballVelocityY calcolata è
    // sempre zero, ad ogni singolo ciclo (deterministico, non casuale)
    if (state.armEase >= 1 - 1e-6) { state.phase = 'drop'; state.phaseT = 0 }
  } else if (state.phase === 'drop') {
    // rete di sicurezza: una vera caduta sotto questa gravità, da qualunque
    // altezza plausibile del braccio, tocca terra ben sotto 1s — se 'drop'
    // dura anomalmente a lungo (es. basketball.position è stata spostata
    // altrove nel frattempo da un pickup/steal/block concorrente, mai
    // scendendo sotto ballRadius per davvero), armEase resta congelato a 1
    // per sempre invece di limitarsi a "un attimo in più": la paletta
    // sembra bloccata aperta a tempo indefinito. Oltre questa soglia si
    // forza un rientro pulito invece di aspettare una condizione che
    // potrebbe non verificarsi mai
    if (state.phaseT > DRIBBLE_DROP_SAFETY_TIMEOUT) {
      state.phase = 'push'
      state.phaseT = 0
      state.armEase = 0
      state.ballVelocityY = 0
      state.previousPushPaddleY = null
      return
    }
    state.ballVelocityY -= dribbleTuning.dribbleGravity * dt
    let ballY = ballPositionTarget.y + state.ballVelocityY * dt
    if (ballY <= ballRadius) {
      ballY = ballRadius
      // scalato per classe (vedi dribbleTuning.bounceSpeedScale/
      // dribbleGravity su RobotBase.js): chi ha la paletta più in alto
      // (manipulatorScale maggiore, o semplicemente una geometria che
      // traduce meno lo swing angolare in escursione verticale) deve
      // rimbalzare più forte per riagganciarsi lì naturalmente invece che
      // con un salto residuo riassorbito a scatti da lockOffset durante 'push'
      state.ballVelocityY = BALL_BOUNCE_SPEED * dribbleTuning.bounceSpeedScale
      state.riseBallisticY = ballY // stato fisico vero di 'rise', riparte dal punto di rimbalzo
      state.phase = 'rise'
      state.phaseT = 0
      if (onBounce) onBounce()
    }
    ballPositionTarget.set(paddleWorldPos.x, ballY, paddleWorldPos.z)
  } else { // 'rise'
    state.ballVelocityY -= dribbleTuning.dribbleGravity * dt
    // riseBallisticY integra la fisica pura, MAI la Y già corretta (che
    // altrimenti si accumulerebbe frame dopo frame) — la correzione è un
    // piccolo offset costante applicato solo qui, in fase di render
    state.riseBallisticY += state.ballVelocityY * dt
    // clampata a non superare MAI la paletta (max un margine trascurabile
    // sopra di essa): bounceSpeedScale/riseYCorrection/ampiezze/ball
    // offset sono 5+ manopole che interagiscono, e una combinazione
    // "sbagliata" di una qualunque (segnalato dal vivo: bounceSpeedScale
    // tarato per un set di parametri, poi ballOffsetDown/link1AmplitudeDeg
    // cambiati da un'altra parte) può far risalire la palla oltre la
    // paletta indipendentemente da quanto la velocità di rimbalzo fosse
    // stata calibrata. Invariante strutturale invece di una calibrazione
    // che si rompe ad ogni giro di tuning: qualunque combinazione di
    // dribbleTuning/ballOffset venga impostata, la palla non attraverserà
    // mai visivamente la paletta durante 'rise' — il resto della curva
    // (drop, la parte bassa di rise) resta fisica pura, invariata
    const ballY = Math.min(state.riseBallisticY - dribbleTuning.riseYCorrection, paddleWorldPos.y)
    ballPositionTarget.set(paddleWorldPos.x, ballY, paddleWorldPos.z)
    // riaggancio al vero apice balistico (v=0): il riaggancio esattamente
    // lì, non prima, è ciò che minimizza lo scatto (sia la velocità della
    // palla sia il ritorno del braccio sono più piatti in quel punto)
    if (state.armEase <= 0 || state.ballVelocityY <= 0) {
      // congela l'offset palla↔paletta nell'istante esatto del riaggancio,
      // così 'push' riparte dalla posizione reale della palla, non da uno
      // scatto verso la paletta
      state.lockOffset.copy(ballPositionTarget).sub(paddleWorldPos)
      state.previousPushPaddleY = null // nessuna storia di velocità pregressa per il nuovo 'push'
      state.phase = 'push'
      state.phaseT = 0
    }
  }
  // tocco visivo supplementare per classe (gambe che si accovacciano,
  // drone che fluttua...) — DOPO che palla/braccio sono già posizionati
  // per questo passo fisso, mai PRIMA (altrimenti leggerebbe la fase/posa
  // del passo precedente). Default vuoto su RobotBase: non cambia nulla
  // per chi non lo sovrascrive
  robot.onDribbleTick(state, dt)
}

export function initBallPossession(ctx) {
  const {
    getManipulator, dribbleState, handlingState, pickupState, shootingState,
    cameraState,
    getBallRadius,
    computeAimPitchOffset, sfx, dribbleBounceSoundVolume,
    pickupDuration, pickupMargin, pickupCoarseRadius,
  } = ctx

  // riparte da un 'push' pulito, non da dove si era fermata la palla prima
  // della transizione — condivisa da releaseBallHandling() e da updatePickup()
  function resetDribbleState() {
    dribbleState.phase = 'push'
    dribbleState.phaseT = 0
    dribbleState.armEase = 0
    dribbleState.ballVelocityY = 0
    dribbleState.previousPushPaddleY = null
    dribbleState.lockOffset.set(0, 0, 0)
  }

  function releaseBallHandling() {
    const robot = getManipulator()
    robot.setState(RobotState.DRIBBLE)
    clampOrbitPitchToNormalRange(cameraState)
    resetDribbleState()
    handlingState.grip = 0
    robot.controls.setGrip(0)
    handlingState.tiltOffset = 0
    robot.controls.setShootTilt(0)
    // HANDLING lascia elbow/link1 a un'ampiezza qualunque (dribbleState.
    // armEase interpolato verso handlingTuning.ease, quasi mai 0) — resetDribbleState()
    // azzera la VARIABILE, ma il joint vero resterebbe a quella posa per un
    // frame intero finché il prossimo stepDribble non applica armEase=0
    robot.controls.setDribbleOffsets(0, 0)
    // stesso motivo di setGrip(0)/setShootTilt(0) sopra: updateAimPosture
    // (RobotBase default vuoto, override Drone) non viene più chiamato una
    // volta usciti da HANDLING — senza questo resterebbe congelato
    // all'ultima inclinazione invece di tornare alla posa base
    robot.updateAimPosture(0, 1)
  }

  // Palleggio: unica funzione chiamata a passo fisso (vedi accumulator in
  // animate() dentro main.js), a 120Hz — physics/onBounce riusati da qui
  // invece di essere ricostruiti (nuovo oggetto + nuova arrow function) ad
  // ogni singola chiamata: solo ballRadius può cambiare (slider debug), e
  // viene aggiornato in place appena prima di ogni step
  const dribblePhysics = { ballRadius: getBallRadius() }
  const onDribbleBounce = () => sfx.playBounce(dribbleBounceSoundVolume)
  function updateDribble(dt) {
    dribblePhysics.ballRadius = getBallRadius()
    stepDribble(dribbleState, getManipulator(), ctx.getBasketball().position, dt, dribblePhysics, onDribbleBounce)
  }

  // RobotState.HANDLING (tasto destro tenuto premuto): posa di presa fissa,
  // niente accumulator/timestep fisso (non è una simulazione, è una posa
  // interpolata) — la palla resta incollata alla paletta con lo stesso
  // offset usato in 'push'. dribbleState.armEase/handlingState.grip si
  // avvicinano rapidamente ai target invece di scattarci sopra di colpo
  // (stesso schema esponenziale framerate-independent usato per sterzata
  // ruote e zoom camera)
  function updateHandling(delta) {
    const robot = getManipulator()
    const handlingTuning = robot.handlingTuning
    const lerpFactor = 1 - Math.exp(-handlingTuning.transitionSpeed * delta)
    dribbleState.armEase += (handlingTuning.ease - dribbleState.armEase) * lerpFactor
    handlingState.grip += (handlingTuning.gripOffset - handlingState.grip) * lerpFactor
    robot.controls.setGrip(handlingState.grip)

    // gomito già agganciato al pitch della camera QUI, non solo durante il
    // tiro (updateShootAnimation usa la stessa formula): così quando si
    // preme il sinistro per tirare il braccio è già orientato dove si sta
    // mirando, nessun salto quando parte il windup
    const aimPitchOffset = computeAimPitchOffset()
    robot.controls.setAimPitch(aimPitchOffset)
    // hook per-classe (RobotBase default vuoto) — solo il Drone lo usa per
    // inclinare il CORPO mentre si mira in alto, vedi Drone.js
    robot.updateAimPosture(aimPitchOffset, delta)

    // getPaddleTilt() letto ogni frame (non una snapshot vecchia): paddleTilt
    // è regolabile da debug, il bersaglio deve restare in sync se cambia —
    // getConfig() farebbe una clone completa dello state solo per un campo
    const targetHandlingTilt = -robot.getPaddleTilt()
    handlingState.tiltOffset += (targetHandlingTilt - handlingState.tiltOffset) * lerpFactor
    robot.controls.setShootTilt(handlingState.tiltOffset)

    const [handlingElbowAmplitude, handlingLink1Amplitude] = dribbleAmplitudesRad(robot.dribbleTuning)
    robot.controls.setDribbleOffsets(dribbleState.armEase * handlingElbowAmplitude, dribbleState.armEase * handlingLink1Amplitude)

    // niente BALL_OFFSET_*/tilt qui: manipulator.ballRestPoint (non .paddle) è
    // già il punto geometricamente corretto — dove le normali delle due metà
    // della V si incontrerebbero se estruse, non il centro "piatto" usato dal
    // palleggio (quello assume un tilt sempre costante, qui varia)
    snapBallToRestPoint(robot, ctx.getBasketball())
  }

  // avvia il pickup (non durante un altro pickup già in corso, né se la
  // palla non è libera). Chiamata da updateShotFlight (Shooting System)
  // ogni frame mentre lo stato è NO_BALL. Scarto grossolano (solo distanza
  // al quadrato dal root, nessuna allocazione né traversal) prima del test
  // preciso (isRobotTouchingBall, che sì alloca/traversa) — scarta solo i
  // casi ovviamente lontani, non introduce falsi negativi vicino al bordo reale
  function checkForPickup() {
    const ball = ctx.getBasketball()
    const robot = getManipulator()
    if (pickupState.phase !== 'idle' || !ball || ball.state !== BallState.FREE) return
    if (robot.state !== RobotState.NO_BALL) return
    // STEAL/BLOCK propri devono essere finiti (idle), non solo iniziati —
    // altrimenti un pickup poteva partire mentre il resolve di un BLOCK
    // stava ancora rientrando: due animazioni sugli stessi joint
    // (setDribbleOffsets) nello stesso frame, la paletta finiva "aperta"
    // come nella posa di block invece di interpolare verso il dribble
    if (ctx.stealState && ctx.stealState.phase !== 'idle') return
    if (ctx.blockState && ctx.blockState.phase !== 'idle') return
    if (robot.root.position.distanceToSquared(ball.position) > pickupCoarseRadius * pickupCoarseRadius) return
    if (!isRobotTouchingBall(robot, ball, getBallRadius(), pickupMargin)) return
    // possesso ATOMICO qui, non a fine animazione (t>=1 in updatePickup):
    // in 1v1 due robot possono passare entrambi questo stesso controllo
    // nello STESSO frame (entrambi vedono ancora ball.state===FREE finché
    // nessuno dei due l'ha rivendicata) — chi arriva qui per primo deve
    // segnare SUBITO la palla come non più libera, così il secondo
    // checkForPickup (giocatore o nemico, eseguito dopo nello stesso
    // frame) la trova già presa e si ferma da solo. Senza questo, due
    // pickup partivano insieme e per 0.3s si contendevano la stessa
    // basketball.position ogni frame (snapBallToRestPoint di updatePickup
    // gira per ENTRAMBI) — la palla sembrava vibrare a terra invece di
    // finire pulita in una mano sola
    ball.setState(BallState.HANDLED)
    ball.setOwner(robot)
    pickupState.phase = 'active'
    pickupState.phaseT = 0
  }

  // la palla si blocca SUBITO alla paletta (primo frame, nessun lerp da dove
  // si trovava) — se restasse ancora "libera" per la durata del pickup
  // poteva sembrare sfuggire mentre rimbalzava via; il braccio fa comunque un
  // piccolo "tuffo" di raccolta (0→1→0, non 0→1) come flourish visivo, ma la
  // presa è immediata. Il tuffo torna a 0 PRIMA che finisca il pickup apposta:
  // il palleggio automatico che riprende subito dopo parte anche lui da
  // dribbleState.armEase=0 ('push' pulito) — senza questo la mano sarebbe
  // rimasta ad ampiezza piena (1.0) fino all'ultimo frame, con uno scatto a
  // 0 nel momento esatto dell'aggancio invece di un passaggio smooth
  function updatePickup(delta) {
    const ball = ctx.getBasketball()
    const robot = getManipulator()
    // durante questi 0.3s manipulator.state resta NO_BALL (passa a DRIBBLE
    // solo a fine animazione, sotto) mentre ball.owner/state sono GIÀ
    // "presi" (claim atomico in checkForPickup) — una finestra in cui uno
    // STEAL avversario può rubare la palla appena reclamata (controlla solo
    // ball.owner/state, non pickupState). Se succede, abortire pulito qui
    // invece di continuare ad agganciarla alla PROPRIA paletta e poi
    // passare comunque a DRIBBLE a fine animazione senza possederla più —
    // altrimenti due robot si contendevano la posizione della palla ogni
    // frame, sembrava "rotolare via" pur risultando tecnicamente posseduta
    if (!ball || ball.owner !== robot) {
      pickupState.phase = 'idle'
      dribbleState.armEase = 0
      robot.controls.setDribbleOffsets(0, 0)
      return
    }

    pickupState.phaseT += delta
    const t = Math.min(pickupState.phaseT / pickupDuration, 1)
    const dipT = Math.sin(t * Math.PI) // 0 -> 1 -> 0, non 0 -> 1

    dribbleState.armEase = dipT
    const [pickupElbowAmplitude, pickupLink1Amplitude] = dribbleAmplitudesRad(robot.dribbleTuning)
    robot.controls.setDribbleOffsets(dribbleState.armEase * pickupElbowAmplitude, dribbleState.armEase * pickupLink1Amplitude)

    // ballRestPoint (non paddle/paddleCenter): quello è il centro piatto
    // usato dal palleggio automatico, sta sulla superficie della paletta e
    // causava compenetrazione visiva — ballRestPoint è il punto corretto già
    // usato da HANDLING/tiro, spostato fuori lungo la convergenza della V
    snapBallToRestPoint(robot, ball)

    if (t >= 1) {
      pickupState.phase = 'idle'
      // BallState/owner già impostati in checkForPickup (claim atomico,
      // non qui a fine animazione — vedi commento lì), niente da rifare.
      // resetToNeutralPossession chiude anche shootingState.released
      // (altrimenti resta true dal tiro che ha liberato la palla: animate()
      // instraderebbe su updateShotFlight invece di far ripartire il
      // palleggio) e grip/tilt (difensivo, HANDLING-specifici)
      resetToNeutralPossession(robot, { dribbleState, handlingState, shootingState }, resetDribbleState)
    }
  }

  return { resetDribbleState, releaseBallHandling, updateDribble, updateHandling, checkForPickup, updatePickup }
}
