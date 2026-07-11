import * as THREE from 'three'
import { createSliderControl, createToggleSection, addComponentSection } from './debugPanelHelpers.js'
import { paddleWorldPos, isRobotTouchingBall } from '../gameplay/BallPossession.js'
import { BALL_GRAVITY, BALL_BOUNCE_SPEED } from '../utils/constants.js'

// Quinto pezzo del refactor modulare: il pannello debug (tasto P) vero e
// proprio — le liste di slider/readout, non gli helper DOM puri (già in
// debugPanelHelpers.js). Stesso principio di context-object di
// MainMenu/BallPossession/ShootingSystem.
//
// I 5 valori ancora `let` sciolti in main.js (BALL_RADIUS/
// HANDLING_HEIGHT_BOOST/HANDLING_CAMERA_SIDE_OFFSET/ARM_YAW_OFFSET_DEG/
// CROSSHAIR_HEIGHT — usati anche altrove in main.js, genuinamente globali
// non per-classe; BALL_REST_EXTRA_OFFSET è invece diventato un campo di
// istanza per-robot, vedi RobotBase.js/Drone.js)
// arrivano come coppie getter+setter (`getX`/`setX`) invece che come
// valore semplice: un `export let` non è riassegnabile da chi importa, ma
// una funzione setter definita in main.js e chiamata da qui può sempre
// scrivere la variabile che chiude — stesso principio del `getBallRadius`
// già usato da BallPossession.js/ShootingSystem.js, esteso a un setter.
export function initDebugPanel(ctx) {
  const {
    getManipulator,
    camera, controls, dribbleState, pickupState, trajDebug,
    pickupMargin, playerRobots, droneTuning,
    getBallRadius, setBallRadius,
    getHandlingHeightBoost, setHandlingHeightBoost,
    getHandlingCameraSideOffset, setHandlingCameraSideOffset,
    getArmYawOffsetDeg, setArmYawOffsetDeg,
    getCrosshairHeight, setCrosshairHeight,
    setSuppressPauseOnUnlock,
    debugPreviewDribble, debugPreviewHandling, debugPreviewShoot, debugPreviewSpecialMove,
  } = ctx

  const debugPanel = document.getElementById('debug-panel')
  const cameraPanel = document.getElementById('camera-panel')
  // "manipulator" qui resta l'istanza ATTIVA al momento in cui il pannello
  // viene costruito (usata solo dal bottone Copy Config sotto, che
  // serializza la forma di QUELLA classe) — gli slider Shape/Config per
  // le 3 classi sono invece generati da buildShapeSection più sotto,
  // legati esplicitamente a playerRobots.manipulator/legged/drone (non a
  // "quale sia attiva ora"), così si possono tarare tutte e tre senza
  // doverle selezionare una alla volta dal menu. I readout "live" più
  // sotto (pickup-dist/pickup-state) leggono invece getManipulator()
  // fresco ad ogni frame, così restano corretti anche se la classe attiva
  // cambia dal menu
  const manipulator = getManipulator()

  // --- Animation Preview: forza la classe ATTIVA in una posa/animazione a
  // scelta (DRIBBLE/HANDLING/SHOOT/mossa speciale), utilizzabile SIA in Play
  // SIA in Spectate — richiesto dal vivo: passare a Spectate per girare
  // liberamente attorno al robot e ispezionare una posa (es. HANDLING, o il
  // 'grab' del Flight) di lato/da dietro non funzionava, perché uscire da
  // Play forza il rilascio della palla (releaseBallHandling) e la mossa
  // speciale vera avanza solo dentro il blocco Play (vedi debugPreviewState/
  // debugPreview* in main.js). Sezione SEMPRE visibile (non un
  // createToggleSection collassabile): è il primo posto dove si finisce ad
  // aprire il pannello proprio per questo scopo, non va nascosta dietro un click extra
  const animationPreview = document.createElement('div')
  animationPreview.className = 'component-panel'
  const previewLabel = document.createElement('div')
  previewLabel.textContent = 'Animation Preview (Play + Spectate):'
  animationPreview.append(previewLabel)
  const PREVIEW_BUTTONS = [
    ['Dribble', () => debugPreviewDribble()],
    ['Handling', () => debugPreviewHandling()],
    ['Shoot', () => debugPreviewShoot()],
    ['Special Move (Jump/Flight)', () => debugPreviewSpecialMove()],
  ]
  for (const [label, onClick] of PREVIEW_BUTTONS) {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.addEventListener('click', onClick)
    animationPreview.append(btn)
  }
  debugPanel.append(animationPreview)

  // range condiviso da tutti gli slider "Scale" per componente, invece della
  // stessa tripla min/max/step ripetuta 7 volte
  const SCALE_SLIDER_RANGE = { min: 0.2, max: 3, step: 0.05 }
  // estremi degli slider Paddle Angle/Tilt — baseline attuale tarata proprio
  // su questi massimi (vedi state.paddleAngle/paddleTilt in manipulator.js)
  const PADDLE_ANGLE_MAX = 2.4
  const PADDLE_TILT_MAX = 1.2

  // --- Shape (dimensioni statiche: scale/length/thickness) — funzione
  // condivisa invece di un blocco copiato 3 volte: MANIPULATOR/LEGGED/DRONE
  // condividono lo stesso identico "vocabolario" di setter (manipulator.js/
  // leggedManipulator.js/drone.js espongono tutti manipulatorScale/link1*/
  // link2*/baseJointScale/elbowJointScale/endEffectorScale/paddleAngle/
  // paddleTilt con la stessa firma) — cambia solo il nome del componente
  // "locomozione" (Wheels/Legs, entrambi con solo Scale) e se esiste un
  // Disc vero (DRONE non ne ha uno, corpo+rotori a parte). Legata
  // all'ISTANZA passata esplicitamente (playerRobots[key], NON
  // getManipulator()): tarare la forma di LEGGED/DRONE non deve richiedere
  // di selezionarli attivamente prima — stesso principio già applicato a
  // Ball Offset sopra
  function buildShapeSection(parentContainer, label, robot, { locomotionLabel, locomotionSetterKey }) {
    const cfg = robot.getConfig()
    const shape = createToggleSection(parentContainer, `${label} Shape`)
    createSliderControl(shape, {
      name: `${label} Scale (overall)`, min: 1, max: 50, step: 0.5,
      value: cfg.manipulatorScale, onChange: robot.controls.manipulatorScale,
    })
    const config = createToggleSection(shape, `${label} Config`)
    if (locomotionSetterKey) {
      addComponentSection(config, locomotionLabel, [
        { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg[locomotionSetterKey], onChange: robot.controls[locomotionSetterKey] },
      ])
    }
    if ('discScale' in cfg) {
      addComponentSection(config, 'Disc', [
        { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.discScale, onChange: robot.controls.discScale },
        { name: 'Radius', min: 0.5, max: 3, step: 0.05, value: cfg.discRadius, onChange: robot.controls.discRadius },
      ])
    }
    addComponentSection(config, 'Link 1', [
      { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link1Scale, onChange: robot.controls.link1Scale },
      { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link1Length, onChange: robot.controls.link1Length },
      { name: 'Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link1Thickness, onChange: robot.controls.link1Thickness },
    ])
    addComponentSection(config, 'Link 2', [
      { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link2Scale, onChange: robot.controls.link2Scale },
      { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link2Length, onChange: robot.controls.link2Length },
      { name: 'Base Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link2Thickness, onChange: robot.controls.link2Thickness },
      { name: 'Tip Thickness', min: 0.02, max: 1, step: 0.01, value: cfg.link2TipThickness, onChange: robot.controls.link2TipThickness },
    ])
    addComponentSection(config, 'Base Joint (sphere)', [
      { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.baseJointScale, onChange: robot.controls.baseJointScale },
    ])
    addComponentSection(config, 'Elbow Joint (sphere)', [
      { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.elbowJointScale, onChange: robot.controls.elbowJointScale },
    ])
    addComponentSection(config, 'End Effector (sphere)', [
      { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.endEffectorScale, onChange: robot.controls.endEffectorScale },
    ])
    addComponentSection(config, 'Paddle (V)', [
      { name: 'Angle', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: cfg.paddleAngle, onChange: robot.controls.paddleAngle },
      { name: 'Tilt (down)', min: -PADDLE_TILT_MAX, max: PADDLE_TILT_MAX, step: 0.02, value: cfg.paddleTilt, onChange: robot.controls.paddleTilt },
    ])
  }

  buildShapeSection(debugPanel, 'Manipulator', playerRobots.manipulator, { locomotionLabel: 'Wheels', locomotionSetterKey: 'wheelsScale' })
  buildShapeSection(debugPanel, 'Legged', playerRobots.legged, { locomotionLabel: 'Legs', locomotionSetterKey: 'legsScale' })
  buildShapeSection(debugPanel, 'Drone', playerRobots.drone, { locomotionLabel: null, locomotionSetterKey: null })

  // --- Animation (Dribble/Shoot/Handling): dribbleTuning/shootTuning/
  // handlingTuning sono ora campi di ISTANZA sul robot (RobotBase.js),
  // stesso motivo di Ball Offset/Shape sopra — MANIPULATOR/LEGGED/DRONE
  // hanno braccio/scala/orientamento diversi, gli stessi numeri di durata/
  // ampiezza non producono lo stesso risultato per tutte. Una funzione
  // condivisa invece di un blocco copiato 3 volte, chiamata una volta per
  // classe con la SUA istanza (playerRobots[key], non "quella attiva ora")
  // lista slider "Shoot" estratta a parte (non solo inline in
  // buildAnimationSection): riusata identica sia per shootTuning sia per
  // elevatedShootTuning (Drone) — stessi campi, oggetto target diverso
  function buildShootSliders(shootTuning) {
    return [
      { name: 'Windup Duration (s)', min: 0.05, max: 1, step: 0.01, value: shootTuning.windupDuration, onChange: v => { shootTuning.windupDuration = v } },
      { name: 'Release Duration (s)', min: 0.05, max: 1, step: 0.01, value: shootTuning.releaseDuration, onChange: v => { shootTuning.releaseDuration = v } },
      { name: 'Recover Duration (s)', min: 0.05, max: 1, step: 0.01, value: shootTuning.recoverDuration, onChange: v => { shootTuning.recoverDuration = v } },
      { name: 'Elbow Windup (deg)', min: -90, max: 90, step: 1, value: shootTuning.elbowWindupDeg, onChange: v => { shootTuning.elbowWindupDeg = v } },
      { name: 'Link 1 Windup (deg)', min: -90, max: 90, step: 1, value: shootTuning.link1WindupDeg, onChange: v => { shootTuning.link1WindupDeg = v } },
      { name: 'Elbow Release (deg)', min: -90, max: 90, step: 1, value: shootTuning.elbowReleaseDeg, onChange: v => { shootTuning.elbowReleaseDeg = v } },
      { name: 'Link 1 Release (deg)', min: -90, max: 90, step: 1, value: shootTuning.link1ReleaseDeg, onChange: v => { shootTuning.link1ReleaseDeg = v } },
      { name: 'Elbow Release Lead', min: 0, max: 0.9, step: 0.05, value: shootTuning.releaseLead, onChange: v => { shootTuning.releaseLead = v } },
      { name: 'Release Point', min: 0.1, max: 1, step: 0.05, value: shootTuning.releasePoint, onChange: v => { shootTuning.releasePoint = v } },
      { name: 'Elbow Aim Coupling', min: 0, max: 2, step: 0.05, value: shootTuning.elbowAimCoupling, onChange: v => { shootTuning.elbowAimCoupling = v } },
      { name: 'Paddle Tilt Windup Peak', min: -3, max: 3, step: 0.05, value: shootTuning.tiltWindupPeak, onChange: v => { shootTuning.tiltWindupPeak = v } },
      { name: 'Paddle Tilt Target (release)', min: -3, max: 3, step: 0.05, value: shootTuning.tiltTarget, onChange: v => { shootTuning.tiltTarget = v } },
      { name: 'Shot Speed', min: 100, max: 2500, step: 10, value: shootTuning.shotSpeed, onChange: v => { shootTuning.shotSpeed = v } },
      { name: 'State Transition Delay (s)', min: 0, max: 1, step: 0.05, value: shootTuning.stateTransitionDelay, onChange: v => { shootTuning.stateTransitionDelay = v } },
    ]
  }

  function buildAnimationSection(container, label, robot) {
    const animation = createToggleSection(container, `${label} Animation`)
    const { dribbleTuning, shootTuning, handlingTuning } = robot
    addComponentSection(animation, 'Dribble', [
      { name: 'Push Duration (s)', min: 0.05, max: 1, step: 0.01, value: dribbleTuning.pushDuration, onChange: v => { dribbleTuning.pushDuration = v } },
      { name: 'Elbow Amplitude (deg)', min: 0, max: 45, step: 1, value: dribbleTuning.elbowAmplitudeDeg, onChange: v => { dribbleTuning.elbowAmplitudeDeg = v } },
      { name: 'Link 1 Amplitude (deg)', min: 0, max: 25, step: 0.5, value: dribbleTuning.link1AmplitudeDeg, onChange: v => { dribbleTuning.link1AmplitudeDeg = v } },
      { name: 'Lock Absorb Time (s)', min: 0.01, max: 0.3, step: 0.01, value: dribbleTuning.lockAbsorbTime, onChange: v => { dribbleTuning.lockAbsorbTime = v } },
      { name: 'Rise Y Correction', min: 0, max: 25, step: 1, value: dribbleTuning.riseYCorrection, onChange: v => { dribbleTuning.riseYCorrection = v } },
      { name: 'Bounce Speed Scale', min: 0, max: 2, step: 0.001, value: dribbleTuning.bounceSpeedScale, onChange: v => { dribbleTuning.bounceSpeedScale = v } },
      { name: 'Dribble Gravity (own, not shot)', min: 100, max: 5000, step: 10, value: dribbleTuning.dribbleGravity, onChange: v => { dribbleTuning.dribbleGravity = v } },
    ])
    addComponentSection(animation, 'Shoot', buildShootSliders(shootTuning))
    // elevatedShootTuning (RobotBase.js, default null): SOLO il Drone la
    // usa (Flight) — la posa di windup/release corretta a terra
    // interseca il corpo se riusata mentre già sollevato, e viceversa,
    // vedi Drone.js. Sottomenu extra, stessi identici slider di Shoot
    // sopra ma legati all'oggetto ALTERNATIVO invece di duplicare la lista
    if (robot.elevatedShootTuning) {
      addComponentSection(animation, 'Shoot (elevated / Flight)', buildShootSliders(robot.elevatedShootTuning))
    }
    addComponentSection(animation, 'Handling (right-click held)', [
      { name: 'Arm Ease', min: -1, max: 1, step: 0.02, value: handlingTuning.ease, onChange: v => { handlingTuning.ease = v } },
      { name: 'Grip Angle (rad)', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: handlingTuning.gripOffset, onChange: v => { handlingTuning.gripOffset = v } },
      { name: 'Transition Speed', min: 1, max: 30, step: 1, value: handlingTuning.transitionSpeed, onChange: v => { handlingTuning.transitionSpeed = v } },
      // ballRestExtraOffset (RobotBase.js/Drone.js): campo di ISTANZA, non
      // più un unico slider globale — bug reale trovato: con gripOffset
      // alto (V stretta) ballRestPoint può finire DENTRO il solido delle
      // due metà della paletta, l'entità della correzione necessaria
      // dipende da braccio/scala/geometria della classe (vedi Drone.js)
      { name: 'Ball Rest Extra Offset', min: -5, max: 10, step: 0.05, value: robot.ballRestExtraOffset, onChange: v => { robot.ballRestExtraOffset = v; robot.controls.setBallRestOffset(v) } },
    ])
  }

  buildAnimationSection(debugPanel, 'Manipulator', playerRobots.manipulator)
  buildAnimationSection(debugPanel, 'Legged', playerRobots.legged)
  buildAnimationSection(debugPanel, 'Drone', playerRobots.drone)

  // --- Camera / Aim: GLOBALI, non per-classe — non sono campi di istanza
  // sul robot (restano `let` sciolti in main.js), riguardano la camera/il
  // crosshair del giocatore in Play mode, non la geometria/animazione di
  // una classe specifica
  const cameraAim = createToggleSection(debugPanel, 'Camera / Aim')
  addComponentSection(cameraAim, 'Handling camera', [
    { name: 'Camera Height Boost', min: 0, max: 300, step: 5, value: getHandlingHeightBoost(), onChange: setHandlingHeightBoost },
    { name: 'Camera Side Offset', min: -150, max: 150, step: 5, value: getHandlingCameraSideOffset(), onChange: setHandlingCameraSideOffset },
  ])
  addComponentSection(cameraAim, 'Play Aim', [
    { name: 'Arm Yaw Offset (deg)', min: -180, max: 180, step: 1, value: getArmYawOffsetDeg(), onChange: setArmYawOffsetDeg },
    { name: 'Crosshair Height (px)', min: 0, max: 300, step: 5, value: getCrosshairHeight(), onChange: setCrosshairHeight },
  ])

  // --- Drone Animation: droneTuning (Drone.js) — oggetto MUTABILE di
  // proprietà della CLASSE (modulo Drone.js), non dell'istanza: un solo
  // Drone gioca alla volta lato giocatore, non serve un per-istanza come
  // dribbleTuning/shootTuning/handlingTuning sopra (quelli invece sono
  // campi di RobotBase, uno per istanza/classe). Solo il Drone vola/si
  // inclina/fa Flight — MANIPULATOR/LEGGED non hanno un equivalente
  const droneAnimation = createToggleSection(debugPanel, 'Drone Animation')
  addComponentSection(droneAnimation, 'Flight (bank/rotori)', [
    { name: 'Rotor Spin Speed', min: 0, max: 60, step: 1, value: droneTuning.rotorSpinSpeed, onChange: v => { droneTuning.rotorSpinSpeed = v } },
    { name: 'Bank Gain', min: 0, max: 1, step: 0.01, value: droneTuning.bankGain, onChange: v => { droneTuning.bankGain = v } },
    { name: 'Bank Max (rad)', min: 0, max: 1.2, step: 0.01, value: droneTuning.bankMax, onChange: v => { droneTuning.bankMax = v } },
    { name: 'Bank Smooth Speed', min: 1, max: 30, step: 1, value: droneTuning.bankSmoothSpeed, onChange: v => { droneTuning.bankSmoothSpeed = v } },
    { name: 'Aim Body Tilt Gain', min: 0, max: 2, step: 0.01, value: droneTuning.aimBodyTiltGain, onChange: v => { droneTuning.aimBodyTiltGain = v } },
    { name: 'Aim Body Tilt Max (rad)', min: 0, max: 1.2, step: 0.01, value: droneTuning.aimBodyTiltMax, onChange: v => { droneTuning.aimBodyTiltMax = v } },
    { name: 'Aim Body Tilt Smooth Speed', min: 1, max: 30, step: 1, value: droneTuning.aimBodyTiltSmoothSpeed, onChange: v => { droneTuning.aimBodyTiltSmoothSpeed = v } },
    { name: 'Thrust Tilt Gain', min: 0, max: 0.02, step: 0.0001, value: droneTuning.thrustTiltGain, onChange: v => { droneTuning.thrustTiltGain = v } },
    { name: 'Thrust Tilt Max (rad)', min: 0, max: 1.2, step: 0.01, value: droneTuning.thrustTiltMax, onChange: v => { droneTuning.thrustTiltMax = v } },
    { name: 'Thrust Tilt Smooth Speed', min: 1, max: 30, step: 1, value: droneTuning.thrustTiltSmoothSpeed, onChange: v => { droneTuning.thrustTiltSmoothSpeed = v } },
  ])
  addComponentSection(droneAnimation, 'Flight', [
    { name: 'Grab Duration (s)', min: 0.05, max: 1, step: 0.01, value: droneTuning.flightGrabDuration, onChange: v => { droneTuning.flightGrabDuration = v } },
    { name: 'Grab Grip Target (rad)', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: droneTuning.flightGrabTarget, onChange: v => { droneTuning.flightGrabTarget = v } },
    { name: 'Grab Ball Rest Offset', min: 0, max: 1, step: 0.01, value: droneTuning.flightBallRestOffset, onChange: v => { droneTuning.flightBallRestOffset = v } },
    { name: 'Rise Duration (s)', min: 0.1, max: 3, step: 0.05, value: droneTuning.flightRiseDuration, onChange: v => { droneTuning.flightRiseDuration = v } },
    { name: 'Hold Duration (s)', min: 0, max: 10, step: 0.1, value: droneTuning.flightHoldDuration, onChange: v => { droneTuning.flightHoldDuration = v } },
    { name: 'Descend Duration (s)', min: 0.1, max: 3, step: 0.05, value: droneTuning.flightDescendDuration, onChange: v => { droneTuning.flightDescendDuration = v } },
    { name: 'Height (world units)', min: 50, max: 800, step: 10, value: droneTuning.flightHeight, onChange: v => { droneTuning.flightHeight = v } },
    { name: 'Speed Scale (while elevated)', min: 0, max: 1, step: 0.01, value: droneTuning.flightSpeedScale, onChange: v => { droneTuning.flightSpeedScale = v } },
    { name: 'Cooldown (s)', min: 1, max: 30, step: 0.5, value: droneTuning.flightCooldown, onChange: v => { droneTuning.flightCooldown = v } },
  ])

  // --- Basketball ---
  const basketballConfig = createToggleSection(debugPanel, 'Basketball')
  createSliderControl(basketballConfig, {
    name: 'Scale', min: 5, max: 40, step: 1, value: getBallRadius(), onChange: setBallRadius,
  })
  // Ball Offset: campi di ISTANZA sul robot (RobotBase.js), non più valori
  // condivisi — ogni classe ha un braccio/orientamento diverso (LEGGED più
  // grande, DRONE capovolto appeso sotto il corpo), lo stesso numero
  // assoluto non produce lo stesso punto visivo per tutte. Un sottomenu per
  // classe (playerRobots, le 3 istanze precaricate — non solo quella
  // ATTIVA ORA, vedi commento su playerRobots in main.js): tarare
  // LEGGED/DRONE non deve richiedere di uscire e rientrare in partita
  // selezionandole una alla volta — si aprono e regolano tutte e tre nello
  // stesso pannello, a prescindere da quale si sta giocando in questo momento
  const ballOffsetSection = createToggleSection(basketballConfig, 'Ball Offset (from paddle center, per classe)')
  const BALL_OFFSET_LABEL_BY_KEY = { manipulator: 'Manipulator', legged: 'Legged', drone: 'Drone' }
  for (const [key, robot] of Object.entries(playerRobots)) {
    addComponentSection(ballOffsetSection, BALL_OFFSET_LABEL_BY_KEY[key] ?? key, [
      { name: 'Forward', min: -40, max: 40, step: 1, value: robot.ballOffsetForward, onChange: v => { robot.ballOffsetForward = v } },
      { name: 'Side', min: -40, max: 40, step: 1, value: robot.ballOffsetSide, onChange: v => { robot.ballOffsetSide = v } },
      { name: 'Down', min: -40, max: 40, step: 1, value: robot.ballOffsetDown, onChange: v => { robot.ballOffsetDown = v } },
    ])
  }

  // "Copy config": serializza TUTTI i parametri regolabili da debug pronti
  // da incollare nel codice (manipolatore + dribble + pallone, non solo la
  // forma del robot come prima — stesso schema usato finora per hardcodare
  // scala/spawn camera)
  const copyConfigBtn = document.createElement('button')
  copyConfigBtn.id = 'copy-config-btn'
  copyConfigBtn.textContent = 'Copy config'
  const copyConfigFeedback = document.createElement('div')
  copyConfigFeedback.id = 'copy-config-feedback'
  debugPanel.append(copyConfigBtn, copyConfigFeedback)
  const COPY_CONFIG_FEEDBACK_DURATION = 2500 // ms prima che il messaggio "Copied" sparisca

  copyConfigBtn.addEventListener('click', async () => {
    const c = {
      ...manipulator.getConfig(),
      ballRadius: getBallRadius(), ballGravity: BALL_GRAVITY, ballBounceSpeed: BALL_BOUNCE_SPEED,
      armYawOffsetDeg: getArmYawOffsetDeg(), crosshairHeight: getCrosshairHeight(),
      dribblePushDuration: manipulator.dribbleTuning.pushDuration, dribbleElbowAmplitudeDeg: manipulator.dribbleTuning.elbowAmplitudeDeg,
      dribbleLink1AmplitudeDeg: manipulator.dribbleTuning.link1AmplitudeDeg, dribbleLockAbsorbTime: manipulator.dribbleTuning.lockAbsorbTime,
      dribbleRiseYCorrection: manipulator.dribbleTuning.riseYCorrection,
      dribbleBounceSpeedScale: manipulator.dribbleTuning.bounceSpeedScale,
      dribbleGravity: manipulator.dribbleTuning.dribbleGravity,
      handlingEase: manipulator.handlingTuning.ease, handlingGripOffset: manipulator.handlingTuning.gripOffset, handlingTransitionSpeed: manipulator.handlingTuning.transitionSpeed,
      handlingHeightBoost: getHandlingHeightBoost(), handlingCameraSideOffset: getHandlingCameraSideOffset(),
      ballOffsetForward: manipulator.ballOffsetForward, ballOffsetSide: manipulator.ballOffsetSide, ballOffsetDown: manipulator.ballOffsetDown,
      shootWindupDuration: manipulator.shootTuning.windupDuration, shootReleaseDuration: manipulator.shootTuning.releaseDuration,
      shootElbowWindupDeg: manipulator.shootTuning.elbowWindupDeg, shootLink1WindupDeg: manipulator.shootTuning.link1WindupDeg,
      shootElbowReleaseDeg: manipulator.shootTuning.elbowReleaseDeg, shootLink1ReleaseDeg: manipulator.shootTuning.link1ReleaseDeg,
      shootReleaseLead: manipulator.shootTuning.releaseLead, shootReleasePoint: manipulator.shootTuning.releasePoint, shotSpeed: manipulator.shootTuning.shotSpeed,
      shootRecoverDuration: manipulator.shootTuning.recoverDuration, shootElbowAimCoupling: manipulator.shootTuning.elbowAimCoupling,
      shootTiltWindupPeak: manipulator.shootTuning.tiltWindupPeak, shootTiltTarget: manipulator.shootTuning.tiltTarget,
      ballRestExtraOffset: manipulator.ballRestExtraOffset,
    }
    const text = Object.entries(c).map(([k, v]) => `${k}: ${v}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      copyConfigFeedback.textContent = 'Copied to clipboard ✓'
    } catch {
      copyConfigFeedback.textContent = text
    }
    setTimeout(() => { copyConfigFeedback.textContent = '' }, COPY_CONFIG_FEEDBACK_DURATION)
  })

  // --- Pannello Camera (posizione + angoli, sola lettura) ---
  // [elemento, funzione che legge il valore corrente] invece di 6 variabili
  // + 6 assegnazioni .textContent speculari nel loop
  const camReadouts = [
    ['cam-x', () => camera.position.x.toFixed(1)],
    ['cam-y', () => camera.position.y.toFixed(1)],
    ['cam-z', () => camera.position.z.toFixed(1)],
    ['cam-pitch', () => THREE.MathUtils.radToDeg(camera.rotation.x).toFixed(1)],
    ['cam-yaw', () => THREE.MathUtils.radToDeg(camera.rotation.y).toFixed(1)],
    ['cam-roll', () => THREE.MathUtils.radToDeg(camera.rotation.z).toFixed(1)],
    // stato grezzo della macchina a stati del palleggio, per verificare a
    // occhio SE è davvero questo a scattare in anticipo (non solo i numeri
    // derivati sotto)
    ['dribble-phase', () => dribbleState.phase],
    ['dribble-arm-ease', () => dribbleState.armEase.toFixed(3)],
    ['ball-y', () => { const ball = ctx.getBasketball(); return ball ? ball.position.y.toFixed(1) : '—' }],
    ['paddle-y', () => paddleWorldPos.y.toFixed(1)],
    // "Gap (live)" è quasi sempre diverso da zero (palla e paletta seguono
    // curve diverse per la maggior parte del ciclo, per design) — non è il
    // numero utile. "Reconnect Gap" invece è lockOffset.y: congelato
    // esattamente nell'istante del riaggancio, resta leggibile tra un ciclo
    // e l'altro invece di sfarfallare — è QUESTO che deve tendere a 0
    // tarando Bounce Speed/Gravity
    ['ball-paddle-gap', () => { const ball = ctx.getBasketball(); return ball ? (ball.position.y - paddleWorldPos.y).toFixed(1) : '—' }],
    ['reconnect-gap', () => dribbleState.lockOffset.y.toFixed(1)],
    // diagnostica preview traiettoria: quanti punti ha scritto l'ultima volta
    // e PERCHÉ si è fermata (pavimento / esaurito il budget di passi / mai
    // aggiornata) — per capire a occhio, mentre si mira, cosa succede davvero
    // invece di indovinare dal solo aspetto della linea
    ['traj-count', () => trajDebug.count],
    ['traj-stop', () => trajDebug.stopReason],
    // true/false reale del test usato da checkForPickup (bounding box del
    // robot, non solo la distanza dal centro) e stato FSM, per verificare a
    // occhio se il pickup dovrebbe scattare invece di indovinare
    ['pickup-dist', () => {
      const ball = ctx.getBasketball()
      if (!ball) return '—'
      return isRobotTouchingBall(getManipulator(), ball, getBallRadius(), pickupMargin) ? 'INSIDE (should trigger)' : 'outside'
    }],
    ['pickup-state', () => {
      const ball = ctx.getBasketball()
      return `ball=${ball ? ball.state : '—'} robot=${getManipulator().state} phase=${pickupState.phase}`
    }],
  ].map(([id, get]) => [document.getElementById(id), get])

  document.addEventListener('keydown', e => {
    if (e.code !== 'KeyP' || e.repeat) return
    const opening = debugPanel.classList.contains('hidden')
    debugPanel.classList.toggle('hidden', !opening)
    cameraPanel.classList.toggle('hidden', !opening)
    // serve il cursore per usare lo slider, quindi si sblocca il pointer
    // lock — MA questo è un dettaglio del pannello debug, non "il
    // giocatore ha premuto Esc per mettere in pausa": senza
    // suppressPauseOnUnlock (stesso flag/motivo già usato dal tasto M in
    // main.js) l'unlock qui faceva scattare silenziosamente openPauseMenu()
    // (menuState.mode passava a 'menu'), bloccando movimento/mira/HANDLING
    // finché non ci si accorgeva di dover chiudere anche la pausa — bug
    // vero, non specifico di nessuna classe robot
    if (opening && controls.isLocked) { setSuppressPauseOnUnlock(true); controls.unlock() }
  })

  function updateReadouts() {
    camReadouts.forEach(([el, get]) => { el.textContent = get() })
  }

  return { cameraPanel, updateReadouts }
}
