import * as THREE from 'three'
import { RobotState } from './robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { angleToForward, rotateRight } from './mathUtils.js'

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
  manipulator.ballRestPoint.updateWorldMatrix(true, false)
  manipulator.ballRestPoint.getWorldPosition(paddleWorldPos)
  basketball.position.copy(paddleWorldPos)
}

// riporta cameraState.orbitPitch dentro il range normale (fuori da
// HANDLING): il clamp esteso di HANDLING (fino a valori estremi, per poter
// puntare in alto verso il canestro) è valido SOLO mentre si è in
// HANDLING — appena si esce (rilascio del tasto destro o fine tiro) la
// camera passa alla formula normale (orbita+lookAt), che con un pitch
// così estremo manda la camera sotto il pavimento (mai riclampata
// altrimenti fino al prossimo movimento del mouse). Condivisa da
// releaseBallHandling() qui e da updateShootAnimation in ShootingSystem.js
export function clampOrbitPitchToNormalRange(cameraState, orbitPitchMin, orbitPitchMax) {
  cameraState.orbitPitch = THREE.MathUtils.clamp(cameraState.orbitPitch, orbitPitchMin, orbitPitchMax)
}

// Simulazione del palleggio, macchina a stati push/drop/rise — parametrizzata
// su un robot/bersaglio-palla/oggetto-stato qualunque (non solo i
// manipulator/basketball reali), riusata IDENTICA anche dalla preview robot
// del Main Menu (vedi renderRobotCardPreview in main.js), che deve mostrare
// il vero palleggio, non un'imitazione con un timing indovinato a parte.
// state è un oggetto { phase, phaseT, armEase, ballVelocityY,
// previousPushPaddleY, riseBallisticY, lockOffset (Vector3) } — mutato in
// place, chi chiama decide come/se leggerne i campi dopo. physics è
// { dribbleTuning, ballRadius, ballGravity, ballBounceSpeed } — un oggetto
// invece di 4 parametri sciolti, e ballRadius passato ad ogni chiamata (non
// fissato una volta) perché resta regolabile da debug a runtime. onBounce
// (opzionale) scatta solo al tocco del pavimento in 'drop': il gioco vero
// ci suona sfx.playBounce, la preview del menu resta silenziosa (nessun
// suono atteso sfogliando i menu)
export function stepDribble(state, robot, ballPositionTarget, dt, physics, onBounce) {
  const { dribbleTuning, ballRadius, ballGravity, ballBounceSpeed } = physics
  state.phaseT += dt
  const [elbowAmplitude, link1Amplitude] = dribbleAmplitudesRad(dribbleTuning)
  // armEase aggiornata solo in 'push'/'rise' — in 'drop' resta quella di
  // fine 'push' (il braccio è fermo in fondo, non tocca nulla)
  if (state.phase === 'push') {
    const t = Math.min(state.phaseT / dribbleTuning.pushDuration, 1)
    state.armEase = t * t // ease-IN: velocità massima (non zero) proprio al rilascio, sempre da 0 (pose pulita, niente scatto residuo)
  } else if (state.phase === 'rise') {
    const riseDuration = ballBounceSpeed / ballGravity // tempo per decelerare a v=0 sotto gravità
    const t = Math.min(state.phaseT / riseDuration, 1)
    state.armEase = 1 - t * t * (3 - 2 * t) // da 1 a 0: il braccio torna su mentre la palla risale
  }
  // applicata PRIMA di leggere la world position della paletta, altrimenti
  // sarebbe in ritardo di un frame rispetto alla posa appena decisa sopra
  robot.controls.setDribbleOffsets(state.armEase * elbowAmplitude, state.armEase * link1Amplitude)

  // updateWorldMatrix forza il ricalcolo subito (matrixWorld si aggiorna
  // di norma solo durante il render, quindi senza sarebbe in ritardo di
  // un frame rispetto alla posa appena applicata sopra)
  robot.paddle.updateWorldMatrix(true, false)
  robot.paddle.getWorldPosition(paddleWorldPos)
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
  paddleWorldPos
    .addScaledVector(paddleForwardDir, dribbleTuning.ballOffsetForward)
    .addScaledVector(paddleSideDir, dribbleTuning.ballOffsetSide)
    .addScaledVector(paddleDownDir, dribbleTuning.ballOffsetDown)

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
    state.ballVelocityY -= ballGravity * dt
    let ballY = ballPositionTarget.y + state.ballVelocityY * dt
    if (ballY <= ballRadius) {
      ballY = ballRadius
      state.ballVelocityY = ballBounceSpeed
      state.riseBallisticY = ballY // stato fisico vero di 'rise', riparte dal punto di rimbalzo
      state.phase = 'rise'
      state.phaseT = 0
      if (onBounce) onBounce()
    }
    ballPositionTarget.set(paddleWorldPos.x, ballY, paddleWorldPos.z)
  } else { // 'rise'
    state.ballVelocityY -= ballGravity * dt
    // riseBallisticY integra la fisica pura, MAI la Y già corretta (che
    // altrimenti si accumulerebbe frame dopo frame) — la correzione è un
    // piccolo offset costante applicato solo qui, in fase di render
    state.riseBallisticY += state.ballVelocityY * dt
    const ballY = state.riseBallisticY - dribbleTuning.riseYCorrection
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
}

export function initBallPossession(ctx) {
  const {
    manipulator, dribbleState, handlingState, pickupState, shootingState,
    dribbleTuning, handlingTuning, cameraState,
    getBallRadius, ballGravity, ballBounceSpeed,
    orbitPitchMin, orbitPitchMax,
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
    manipulator.setState(RobotState.DRIBBLE)
    clampOrbitPitchToNormalRange(cameraState, orbitPitchMin, orbitPitchMax)
    resetDribbleState()
    handlingState.grip = 0
    manipulator.controls.setGrip(0)
    handlingState.tiltOffset = 0
    manipulator.controls.setShootTilt(0)
  }

  // Palleggio: unica funzione chiamata a passo fisso (vedi accumulator in
  // animate() dentro main.js), a 120Hz — physics/onBounce riusati da qui
  // invece di essere ricostruiti (nuovo oggetto + nuova arrow function) ad
  // ogni singola chiamata: solo ballRadius può cambiare (slider debug), e
  // viene aggiornato in place appena prima di ogni step
  const dribblePhysics = { dribbleTuning, ballRadius: getBallRadius(), ballGravity, ballBounceSpeed }
  const onDribbleBounce = () => sfx.playBounce(dribbleBounceSoundVolume)
  function updateDribble(dt) {
    dribblePhysics.ballRadius = getBallRadius()
    stepDribble(dribbleState, manipulator, ctx.basketball.position, dt, dribblePhysics, onDribbleBounce)
  }

  // RobotState.HANDLING (tasto destro tenuto premuto): posa di presa fissa,
  // niente accumulator/timestep fisso (non è una simulazione, è una posa
  // interpolata) — la palla resta incollata alla paletta con lo stesso
  // offset usato in 'push'. dribbleState.armEase/handlingState.grip si
  // avvicinano rapidamente ai target invece di scattarci sopra di colpo
  // (stesso schema esponenziale framerate-independent usato per sterzata
  // ruote e zoom camera)
  function updateHandling(delta) {
    const lerpFactor = 1 - Math.exp(-handlingTuning.transitionSpeed * delta)
    dribbleState.armEase += (handlingTuning.ease - dribbleState.armEase) * lerpFactor
    handlingState.grip += (handlingTuning.gripOffset - handlingState.grip) * lerpFactor
    manipulator.controls.setGrip(handlingState.grip)

    // gomito già agganciato al pitch della camera QUI, non solo durante il
    // tiro (updateShootAnimation usa la stessa formula): così quando si
    // preme il sinistro per tirare il braccio è già orientato dove si sta
    // mirando, nessun salto quando parte il windup
    manipulator.controls.setAimPitch(computeAimPitchOffset())

    // getPaddleTilt() letto ogni frame (non una snapshot vecchia): paddleTilt
    // è regolabile da debug, il bersaglio deve restare in sync se cambia —
    // getConfig() farebbe una clone completa dello state solo per un campo
    const targetHandlingTilt = -manipulator.getPaddleTilt()
    handlingState.tiltOffset += (targetHandlingTilt - handlingState.tiltOffset) * lerpFactor
    manipulator.controls.setShootTilt(handlingState.tiltOffset)

    const [handlingElbowAmplitude, handlingLink1Amplitude] = dribbleAmplitudesRad(dribbleTuning)
    manipulator.controls.setDribbleOffsets(dribbleState.armEase * handlingElbowAmplitude, dribbleState.armEase * handlingLink1Amplitude)

    // niente BALL_OFFSET_*/tilt qui: manipulator.ballRestPoint (non .paddle) è
    // già il punto geometricamente corretto — dove le normali delle due metà
    // della V si incontrerebbero se estruse, non il centro "piatto" usato dal
    // palleggio (quello assume un tilt sempre costante, qui varia)
    snapBallToRestPoint(manipulator, ctx.basketball)
  }

  // bounding box VERA del robot (non la distanza dal solo centro/root — il
  // corpo è largo e basso, non uno sferoide, un raggio da un punto solo non
  // rappresenta bene quando la palla è davvero "a portata") — ricalcolata
  // dalla geometria reale ogni volta, si adatta a qualunque posa/rotazione
  const scratchRobotBox = new THREE.Box3()
  // avvia il pickup (non durante un altro pickup già in corso, né se la
  // palla non è libera). Chiamata da updateShotFlight (Shooting System)
  // ogni frame mentre lo stato è NO_BALL. Scarto grossolano (solo distanza
  // al quadrato dal root, nessuna allocazione né traversal) prima del test
  // preciso: setFromObject attraversa l'intera gerarchia del robot (ruote,
  // telaio, bracci) e aggiorna le matrici mondo di ognuna, costoso per
  // essere chiamato ogni frame mentre la palla è FREE. Il raggio è
  // ampiamente più largo del vero ingombro del robot (~60-70 unità +
  // margine): scarta solo i casi ovviamente lontani, non introduce falsi
  // negativi vicino al bordo reale
  function checkForPickup() {
    if (pickupState.phase !== 'idle' || !ctx.basketball || ctx.basketball.state !== BallState.FREE) return
    if (manipulator.state !== RobotState.NO_BALL) return
    if (manipulator.root.position.distanceToSquared(ctx.basketball.position) > pickupCoarseRadius * pickupCoarseRadius) return
    scratchRobotBox.setFromObject(manipulator.root)
    scratchRobotBox.expandByScalar(getBallRadius() + pickupMargin)
    if (!scratchRobotBox.containsPoint(ctx.basketball.position)) return
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
    pickupState.phaseT += delta
    const t = Math.min(pickupState.phaseT / pickupDuration, 1)
    const dipT = Math.sin(t * Math.PI) // 0 -> 1 -> 0, non 0 -> 1

    dribbleState.armEase = dipT
    const [pickupElbowAmplitude, pickupLink1Amplitude] = dribbleAmplitudesRad(dribbleTuning)
    manipulator.controls.setDribbleOffsets(dribbleState.armEase * pickupElbowAmplitude, dribbleState.armEase * pickupLink1Amplitude)

    // ballRestPoint (non paddle/paddleCenter): quello è il centro piatto
    // usato dal palleggio automatico, sta sulla superficie della paletta e
    // causava compenetrazione visiva — ballRestPoint è il punto corretto già
    // usato da HANDLING/tiro, spostato fuori lungo la convergenza della V
    snapBallToRestPoint(manipulator, ctx.basketball)

    if (t >= 1) {
      pickupState.phase = 'idle'
      ctx.basketball.setState(BallState.HANDLED)
      manipulator.setState(RobotState.DRIBBLE)
      resetDribbleState()
      // senza questo resta true dal tiro che ha liberato la palla: animate()
      // instrada su updateShotFlight finché manipulator.state===NO_BALL O
      // shootingState.released — con questo flag ancora true il palleggio
      // non riparte mai anche se lo stato è già tornato DRIBBLE
      shootingState.released = false
    }
  }

  return { resetDribbleState, releaseBallHandling, updateDribble, updateHandling, checkForPickup, updatePickup }
}
