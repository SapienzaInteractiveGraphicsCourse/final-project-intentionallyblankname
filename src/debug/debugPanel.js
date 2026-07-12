import * as THREE from 'three'
import { createSliderControl, createToggleSection, addComponentSection } from './debugPanelHelpers.js'
import { paddleWorldPos, isRobotTouchingBall } from '../gameplay/BallPossession.js'
import { BALL_GRAVITY, BALL_BOUNCE_SPEED } from '../utils/constants.js'

// Debug panel (key P): slider/readout lists. Context-object pattern.
//
// The few values still living as loose `let` in main.js (genuinely global,
// not per-class) arrive as getter+setter pairs: an `export let` cannot be
// reassigned by the importer, but a setter closing over it can
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
  // Active instance at panel build time, used only by Copy Config below.
  // Shape/Animation sections bind explicitly to playerRobots.* instead
  // (tune all 3 classes without selecting each from the menu); live
  // readouts read getManipulator() fresh so they follow class switches
  const manipulator = getManipulator()

  // --- Animation Preview: force the ACTIVE class into a pose/animation,
  // usable in Play AND Spectate (leaving Play releases the ball, so poses
  // like HANDLING were never inspectable from a free camera). Always
  // visible, not collapsible: it is the main reason to open the panel
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

  // Shared range for every per-component Scale slider
  const SCALE_SLIDER_RANGE = { min: 0.2, max: 3, step: 0.05 }
  const PADDLE_ANGLE_MAX = 2.4
  const PADDLE_TILT_MAX = 1.2

  // --- Shape (static sizes): one shared builder, the 3 classes expose the
  // same setter vocabulary. Only the locomotion component name differs
  // (Wheels/Legs, Drone has neither) and whether a Disc exists. Bound to
  // the explicit instance, not the active one
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
      { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link1Scale, onChange: robot.controls.link1.scale },
      { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link1Length, onChange: robot.controls.link1.length },
      { name: 'Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link1Thickness, onChange: robot.controls.link1.thickness },
    ])
    addComponentSection(config, 'Link 2', [
      { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link2Scale, onChange: robot.controls.link2.scale },
      { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link2Length, onChange: robot.controls.link2.length },
      { name: 'Base Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link2Thickness, onChange: robot.controls.link2.thickness },
      { name: 'Tip Thickness', min: 0.02, max: 1, step: 0.01, value: cfg.link2TipThickness, onChange: robot.controls.link2.tipThickness },
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

  // --- Animation: dribble/shoot/handling tuning are per-instance fields
  // (RobotBase), one section per class bound to ITS instance.
  // Shoot slider list extracted: reused for both shootTuning and the
  // Drone's elevatedShootTuning (same fields, different target object)
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
    // Drone only: alternate pose while airborne (see Drone.js), same
    // sliders bound to the alternate object
    if (robot.elevatedShootTuning) {
      addComponentSection(animation, 'Shoot (elevated / Flight)', buildShootSliders(robot.elevatedShootTuning))
    }
    addComponentSection(animation, 'Handling (right-click held)', [
      { name: 'Arm Ease', min: -1, max: 1, step: 0.02, value: handlingTuning.ease, onChange: v => { handlingTuning.ease = v } },
      { name: 'Grip Angle (rad)', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: handlingTuning.gripOffset, onChange: v => { handlingTuning.gripOffset = v } },
      { name: 'Transition Speed', min: 1, max: 30, step: 1, value: handlingTuning.transitionSpeed, onChange: v => { handlingTuning.transitionSpeed = v } },
      // Per-instance: with a tight grip ballRestPoint can end up INSIDE
      // the paddle solid; the needed correction depends on the class
      { name: 'Ball Rest Extra Offset', min: -5, max: 10, step: 0.05, value: robot.ballRestExtraOffset, onChange: v => { robot.ballRestExtraOffset = v; robot.controls.setBallRestOffset(v) } },
    ])
  }

  buildAnimationSection(debugPanel, 'Manipulator', playerRobots.manipulator)
  buildAnimationSection(debugPanel, 'Legged', playerRobots.legged)
  buildAnimationSection(debugPanel, 'Drone', playerRobots.drone)

  // --- Camera / Aim: genuinely global (player camera/crosshair), not
  // per-class instance fields
  const cameraAim = createToggleSection(debugPanel, 'Camera / Aim')
  addComponentSection(cameraAim, 'Handling camera', [
    { name: 'Camera Height Boost', min: 0, max: 300, step: 5, value: getHandlingHeightBoost(), onChange: setHandlingHeightBoost },
    { name: 'Camera Side Offset', min: -150, max: 150, step: 5, value: getHandlingCameraSideOffset(), onChange: setHandlingCameraSideOffset },
  ])
  addComponentSection(cameraAim, 'Play Aim', [
    { name: 'Arm Yaw Offset (deg)', min: -180, max: 180, step: 1, value: getArmYawOffsetDeg(), onChange: setArmYawOffsetDeg },
    { name: 'Crosshair Height (px)', min: 0, max: 300, step: 5, value: getCrosshairHeight(), onChange: setCrosshairHeight },
  ])

  // --- Drone Animation: droneTuning is module-level (one playable Drone
  // per side, no need for per-instance)
  const droneAnimation = createToggleSection(debugPanel, 'Drone Animation')
  addComponentSection(droneAnimation, 'Flight (bank/rotors)', [
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
  // Per-instance fields: each class arm differs (LEGGED bigger, DRONE
  // flipped), the same absolute offset does not land the same. One
  // submenu per class so all 3 tune without switching the active one
  const ballOffsetSection = createToggleSection(basketballConfig, 'Ball Offset (from paddle center, per class)')
  const BALL_OFFSET_LABEL_BY_KEY = { manipulator: 'Manipulator', legged: 'Legged', drone: 'Drone' }
  for (const [key, robot] of Object.entries(playerRobots)) {
    addComponentSection(ballOffsetSection, BALL_OFFSET_LABEL_BY_KEY[key] ?? key, [
      { name: 'Forward', min: -40, max: 40, step: 1, value: robot.ballOffsetForward, onChange: v => { robot.ballOffsetForward = v } },
      { name: 'Side', min: -40, max: 40, step: 1, value: robot.ballOffsetSide, onChange: v => { robot.ballOffsetSide = v } },
      { name: 'Down', min: -40, max: 40, step: 1, value: robot.ballOffsetDown, onChange: v => { robot.ballOffsetDown = v } },
    ])
  }

  // Copy config: serialize every debug-tunable parameter, ready to paste
  // back as hardcoded defaults
  const copyConfigBtn = document.createElement('button')
  copyConfigBtn.id = 'copy-config-btn'
  copyConfigBtn.textContent = 'Copy config'
  const copyConfigFeedback = document.createElement('div')
  copyConfigFeedback.id = 'copy-config-feedback'
  debugPanel.append(copyConfigBtn, copyConfigFeedback)
  const COPY_CONFIG_FEEDBACK_DURATION = 2500 // ms before the "Copied" message fades

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

  // --- Camera panel (read-only readouts) ---
  // [element, getter] pairs instead of 6 variables + 6 mirrored assignments
  const camReadouts = [
    ['cam-x', () => camera.position.x.toFixed(1)],
    ['cam-y', () => camera.position.y.toFixed(1)],
    ['cam-z', () => camera.position.z.toFixed(1)],
    ['cam-pitch', () => THREE.MathUtils.radToDeg(camera.rotation.x).toFixed(1)],
    ['cam-yaw', () => THREE.MathUtils.radToDeg(camera.rotation.y).toFixed(1)],
    ['cam-roll', () => THREE.MathUtils.radToDeg(camera.rotation.z).toFixed(1)],
    ['dribble-phase', () => dribbleState.phase],
    ['dribble-arm-ease', () => dribbleState.armEase.toFixed(3)],
    ['ball-y', () => { const ball = ctx.getBasketball(); return ball ? ball.position.y.toFixed(1) : '—' }],
    ['paddle-y', () => paddleWorldPos.y.toFixed(1)],
    // Live gap is nonzero by design for most of the cycle; the useful
    // number is lockOffset.y, frozen at the re-lock instant. THAT should
    // tend to 0 when tuning Bounce Speed/Gravity
    ['ball-paddle-gap', () => { const ball = ctx.getBasketball(); return ball ? (ball.position.y - paddleWorldPos.y).toFixed(1) : '—' }],
    ['reconnect-gap', () => dribbleState.lockOffset.y.toFixed(1)],
    // Trajectory preview diagnostics: point count and stop reason
    ['traj-count', () => trajDebug.count],
    ['traj-stop', () => trajDebug.stopReason],
    // The EXACT test checkForPickup uses, not an approximation
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
    // Sliders need the cursor, so unlock the pointer, but flag it so the
    // unlock is not mistaken for "ESC pressed" (which opens the pause
    // menu). Same flag/reason as the M key in main.js
    if (opening && controls.isLocked) { setSuppressPauseOnUnlock(true); controls.unlock() }
  })

  function updateReadouts() {
    camReadouts.forEach(([el, get]) => { el.textContent = get() })
  }

  return { cameraPanel, updateReadouts }
}
