import * as THREE from 'three'
import { createSliderControl, createToggleSection, addComponentSection } from './debugPanelHelpers.js'
import { paddleWorldPos, isRobotTouchingBall } from './BallPossession.js'
import { BALL_GRAVITY, BALL_BOUNCE_SPEED } from './constants.js'

// Quinto pezzo del refactor modulare: il pannello debug (tasto P) vero e
// proprio — le liste di slider/readout, non gli helper DOM puri (già in
// debugPanelHelpers.js). Stesso principio di context-object di
// MainMenu/BallPossession/ShootingSystem.
//
// I 6 valori ancora `let` sciolti in main.js (BALL_RADIUS/
// HANDLING_HEIGHT_BOOST/HANDLING_CAMERA_SIDE_OFFSET/BALL_REST_EXTRA_OFFSET/
// ARM_YAW_OFFSET_DEG/CROSSHAIR_HEIGHT — usati anche altrove in main.js,
// non convertiti in oggetto come dribbleTuning/handlingTuning/shootTuning)
// arrivano come coppie getter+setter (`getX`/`setX`) invece che come
// valore semplice: un `export let` non è riassegnabile da chi importa, ma
// una funzione setter definita in main.js e chiamata da qui può sempre
// scrivere la variabile che chiude — stesso principio del `getBallRadius`
// già usato da BallPossession.js/ShootingSystem.js, esteso a un setter.
export function initDebugPanel(ctx) {
  const {
    manipulator, dribbleTuning, handlingTuning, shootTuning,
    camera, controls, dribbleState, pickupState, trajDebug,
    pickupMargin,
    getBallRadius, setBallRadius,
    getHandlingHeightBoost, setHandlingHeightBoost,
    getHandlingCameraSideOffset, setHandlingCameraSideOffset,
    getBallRestExtraOffset, setBallRestExtraOffset,
    getArmYawOffsetDeg, setArmYawOffsetDeg,
    getCrosshairHeight, setCrosshairHeight,
  } = ctx

  const debugPanel = document.getElementById('debug-panel')
  const cameraPanel = document.getElementById('camera-panel')
  const cfg = manipulator.getConfig()

  // range condiviso da tutti gli slider "Scale" per componente, invece della
  // stessa tripla min/max/step ripetuta 7 volte
  const SCALE_SLIDER_RANGE = { min: 0.2, max: 3, step: 0.05 }
  // estremi degli slider Paddle Angle/Tilt — baseline attuale tarata proprio
  // su questi massimi (vedi state.paddleAngle/paddleTilt in manipulator.js)
  const PADDLE_ANGLE_MAX = 2.4
  const PADDLE_TILT_MAX = 1.2

  // --- Manipulator Shape: dimensioni statiche (scale/length/thickness) ---
  const manipulatorShape = createToggleSection(debugPanel, 'Manipulator Shape')

  createSliderControl(manipulatorShape, {
    name: 'Manipulator Scale (overall)', min: 1, max: 50, step: 0.5,
    value: cfg.manipulatorScale, onChange: manipulator.controls.manipulatorScale,
  })

  const manipulatorConfig = createToggleSection(manipulatorShape, 'Manipulator Config')

  addComponentSection(manipulatorConfig, 'Wheels', [
    { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.wheelsScale, onChange: manipulator.controls.wheelsScale },
  ])
  addComponentSection(manipulatorConfig, 'Disc', [
    { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.discScale, onChange: manipulator.controls.discScale },
    { name: 'Radius', min: 0.5, max: 3, step: 0.05, value: cfg.discRadius, onChange: manipulator.controls.discRadius },
  ])
  addComponentSection(manipulatorConfig, 'Link 1', [
    { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link1Scale, onChange: manipulator.controls.link1Scale },
    { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link1Length, onChange: manipulator.controls.link1Length },
    { name: 'Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link1Thickness, onChange: manipulator.controls.link1Thickness },
  ])
  addComponentSection(manipulatorConfig, 'Link 2', [
    { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link2Scale, onChange: manipulator.controls.link2Scale },
    { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link2Length, onChange: manipulator.controls.link2Length },
    { name: 'Base Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link2Thickness, onChange: manipulator.controls.link2Thickness },
    { name: 'Tip Thickness', min: 0.02, max: 1, step: 0.01, value: cfg.link2TipThickness, onChange: manipulator.controls.link2TipThickness },
  ])
  addComponentSection(manipulatorConfig, 'Base Joint (sphere)', [
    { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.baseJointScale, onChange: manipulator.controls.baseJointScale },
  ])
  addComponentSection(manipulatorConfig, 'Elbow Joint (sphere)', [
    { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.elbowJointScale, onChange: manipulator.controls.elbowJointScale },
  ])
  addComponentSection(manipulatorConfig, 'End Effector (sphere)', [
    { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.endEffectorScale, onChange: manipulator.controls.endEffectorScale },
  ])
  addComponentSection(manipulatorConfig, 'Paddle (V)', [
    { name: 'Angle', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: cfg.paddleAngle, onChange: manipulator.controls.paddleAngle },
    { name: 'Tilt (down)', min: -PADDLE_TILT_MAX, max: PADDLE_TILT_MAX, step: 0.02, value: cfg.paddleTilt, onChange: manipulator.controls.paddleTilt },
  ])

  // --- Manipulator Animation: parametri delle animazioni (non la forma) ---
  const manipulatorAnimation = createToggleSection(debugPanel, 'Manipulator Animation')

  addComponentSection(manipulatorAnimation, 'Dribble', [
    { name: 'Push Duration (s)', min: 0.05, max: 1, step: 0.01, value: dribbleTuning.pushDuration, onChange: v => { dribbleTuning.pushDuration = v } },
    { name: 'Elbow Amplitude (deg)', min: 0, max: 45, step: 1, value: dribbleTuning.elbowAmplitudeDeg, onChange: v => { dribbleTuning.elbowAmplitudeDeg = v } },
    { name: 'Link 1 Amplitude (deg)', min: 0, max: 25, step: 0.5, value: dribbleTuning.link1AmplitudeDeg, onChange: v => { dribbleTuning.link1AmplitudeDeg = v } },
    { name: 'Lock Absorb Time (s)', min: 0.01, max: 0.3, step: 0.01, value: dribbleTuning.lockAbsorbTime, onChange: v => { dribbleTuning.lockAbsorbTime = v } },
    { name: 'Rise Y Correction', min: 0, max: 25, step: 1, value: dribbleTuning.riseYCorrection, onChange: v => { dribbleTuning.riseYCorrection = v } },
  ])
  addComponentSection(manipulatorAnimation, 'Shoot', [
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
  ])
  addComponentSection(manipulatorAnimation, 'Handling (right-click held)', [
    { name: 'Arm Ease', min: -1, max: 1, step: 0.02, value: handlingTuning.ease, onChange: v => { handlingTuning.ease = v } },
    { name: 'Grip Angle (rad)', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: handlingTuning.gripOffset, onChange: v => { handlingTuning.gripOffset = v } },
    { name: 'Transition Speed', min: 1, max: 30, step: 1, value: handlingTuning.transitionSpeed, onChange: v => { handlingTuning.transitionSpeed = v } },
    { name: 'Camera Height Boost', min: 0, max: 300, step: 5, value: getHandlingHeightBoost(), onChange: setHandlingHeightBoost },
    { name: 'Camera Side Offset', min: -150, max: 150, step: 5, value: getHandlingCameraSideOffset(), onChange: setHandlingCameraSideOffset },
    { name: 'Ball Rest Extra Offset', min: -5, max: 10, step: 0.05, value: getBallRestExtraOffset(), onChange: setBallRestExtraOffset },
  ])
  addComponentSection(manipulatorAnimation, 'Play Aim', [
    { name: 'Arm Yaw Offset (deg)', min: -180, max: 180, step: 1, value: getArmYawOffsetDeg(), onChange: setArmYawOffsetDeg },
    { name: 'Crosshair Height (px)', min: 0, max: 300, step: 5, value: getCrosshairHeight(), onChange: setCrosshairHeight },
  ])

  // --- Basketball ---
  const basketballConfig = createToggleSection(debugPanel, 'Basketball')
  createSliderControl(basketballConfig, {
    name: 'Scale', min: 5, max: 40, step: 1, value: getBallRadius(), onChange: setBallRadius,
  })
  addComponentSection(basketballConfig, 'Ball Offset (from paddle center)', [
    { name: 'Forward', min: -40, max: 40, step: 1, value: dribbleTuning.ballOffsetForward, onChange: v => { dribbleTuning.ballOffsetForward = v } },
    { name: 'Side', min: -40, max: 40, step: 1, value: dribbleTuning.ballOffsetSide, onChange: v => { dribbleTuning.ballOffsetSide = v } },
    { name: 'Down', min: -40, max: 40, step: 1, value: dribbleTuning.ballOffsetDown, onChange: v => { dribbleTuning.ballOffsetDown = v } },
  ])

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
      dribblePushDuration: dribbleTuning.pushDuration, dribbleElbowAmplitudeDeg: dribbleTuning.elbowAmplitudeDeg,
      dribbleLink1AmplitudeDeg: dribbleTuning.link1AmplitudeDeg, dribbleLockAbsorbTime: dribbleTuning.lockAbsorbTime,
      dribbleRiseYCorrection: dribbleTuning.riseYCorrection,
      handlingEase: handlingTuning.ease, handlingGripOffset: handlingTuning.gripOffset, handlingTransitionSpeed: handlingTuning.transitionSpeed,
      handlingHeightBoost: getHandlingHeightBoost(), handlingCameraSideOffset: getHandlingCameraSideOffset(),
      ballOffsetForward: dribbleTuning.ballOffsetForward, ballOffsetSide: dribbleTuning.ballOffsetSide, ballOffsetDown: dribbleTuning.ballOffsetDown,
      shootWindupDuration: shootTuning.windupDuration, shootReleaseDuration: shootTuning.releaseDuration,
      shootElbowWindupDeg: shootTuning.elbowWindupDeg, shootLink1WindupDeg: shootTuning.link1WindupDeg,
      shootElbowReleaseDeg: shootTuning.elbowReleaseDeg, shootLink1ReleaseDeg: shootTuning.link1ReleaseDeg,
      shootReleaseLead: shootTuning.releaseLead, shootReleasePoint: shootTuning.releasePoint, shotSpeed: shootTuning.shotSpeed,
      shootRecoverDuration: shootTuning.recoverDuration, shootElbowAimCoupling: shootTuning.elbowAimCoupling,
      shootTiltWindupPeak: shootTuning.tiltWindupPeak, shootTiltTarget: shootTuning.tiltTarget,
      ballRestExtraOffset: getBallRestExtraOffset(),
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
      return isRobotTouchingBall(manipulator, ball, getBallRadius(), pickupMargin) ? 'INSIDE (should trigger)' : 'outside'
    }],
    ['pickup-state', () => {
      const ball = ctx.getBasketball()
      return `ball=${ball ? ball.state : '—'} robot=${manipulator.state} phase=${pickupState.phase}`
    }],
  ].map(([id, get]) => [document.getElementById(id), get])

  document.addEventListener('keydown', e => {
    if (e.code !== 'KeyP' || e.repeat) return
    const opening = debugPanel.classList.contains('hidden')
    debugPanel.classList.toggle('hidden', !opening)
    cameraPanel.classList.toggle('hidden', !opening)
    // serve il cursore per usare lo slider, quindi si sblocca il pointer lock
    if (opening && controls.isLocked) controls.unlock()
  })

  function updateReadouts() {
    camReadouts.forEach(([el, get]) => { el.textContent = get() })
  }

  return { cameraPanel, updateReadouts }
}
