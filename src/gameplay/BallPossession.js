import * as THREE from 'three'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { angleToForward, rotateRight } from '../utils/mathUtils.js'
import { BALL_BOUNCE_SPEED, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX } from '../utils/constants.js'

// Ball possession: automatic dribble, HANDLING grip and automatic pickup.
// main.js (debug readouts) and ShootingSystem share this single
// source of truth for "where is the paddle right now".
export const paddleWorldPos = new THREE.Vector3()

// Fresh world position of a robot hierarchy node THIS frame (matrixWorld
// normally updates only at render time — without the explicit update it
// would lag one frame)
export function getObjectWorldPosition(object3D, out) 
{
  object3D.updateWorldMatrix(true, false)
  return object3D.getWorldPosition(out)
}


// Real robot bounding box (the body is wide and flat, a radius from the
// root center misrepresents reach). Exported so the debug "pickup-dist"
// readout shows exactly this test, not an approximation
const scratchRobotBox = new THREE.Box3()
export function isRobotTouchingBall(manipulator, basketball, ballRadius, margin) 
{
  manipulator.getBodyBox(scratchRobotBox)
  scratchRobotBox.expandByScalar(ballRadius + margin)
  return scratchRobotBox.containsPoint(basketball.position)
}

// stepDribble only (paddle tilt is constant there; HANDLING/shoot track
// the true paddle center instead)
const paddleForwardDir = new THREE.Vector3()
const paddleSideDir = new THREE.Vector3()
const paddleDownDir = new THREE.Vector3(0, -1, 0) // "down" is always world-down

// Recomputed per call (both values are live-tunable from sliders)
export function dribbleAmplitudesRad(dribbleTuning) {
  return [THREE.MathUtils.degToRad(dribbleTuning.elbowAmplitudeDeg), THREE.MathUtils.degToRad(dribbleTuning.link1AmplitudeDeg)]
}

// Pin the ball to the V-paddle convergence point (ballRestPoint, not
// .paddle — the flat center would visibly interpenetrate). Shared by
// handling, pickup and the shoot animation
export function snapBallToRestPoint(manipulator, basketball) {
  getObjectWorldPosition(manipulator.ballRestPoint, paddleWorldPos)
  basketball.position.copy(paddleWorldPos)
}

// Return a robot to "has the ball, clean dribble, no leftover
// HANDLING/shoot state" — shared by pickup completion and successful
// steals. Stale released/grip/tiltOffset caused a dropped ball or a
// crooked paddle in the next dribble
export function resetToNeutralPossession(manipulator, { dribbleState, handlingState, shootingState }, resetDribbleState) {
  dribbleState.armEase = 0
  manipulator.setState(RobotState.DRIBBLE)
  resetDribbleState()
  shootingState.released = false
  handlingState.grip = 0
  handlingState.tiltOffset = 0
  manipulator.controls.setGrip(0)
  // reset the real JOINT too, not just the tracked variable, stepDribble
  // never touches tilt, so a stale value survived the whole next dribble
  manipulator.controls.setShootTilt(0)
  // defensive: should already be 0, but explicit beats assumed
  manipulator.controls.setDribbleOffsets(0, 0)
}

// Clamp orbitPitch back to the normal range on leaving HANDLING: the
// extended HANDLING range would put the normal orbit camera under the
// floor. Shared by releaseBallHandling() and the shoot animation
export function clampOrbitPitchToNormalRange(cameraState) {
  cameraState.orbitPitch = THREE.MathUtils.clamp(cameraState.orbitPitch, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX)
}

// Safety net for 'drop' (see stepDribble): a real fall is far shorter
const DRIBBLE_DROP_SAFETY_TIMEOUT = 2

// Fresh state object for stepDribble (single source of truth for its
// shape, previously retyped in 4 call sites). Fields:
// - phase/phaseT: 'push'|'drop'|'rise' + its timer
// - armEase: 0 = arm at rest, 1 = full push; frozen during 'drop'
// - ballVelocityY: real vertical ball velocity in 'drop'/'rise'
// - riseBallisticY: pure ballistic Y for 'rise', kept separate from the
//   rendered Y so the riseYCorrection offset doesn't accumulate
// - previousPushPaddleY: paddle Y last frame during 'push'  finite
//   difference gives the release velocity; null = just entered push
// - lockOffset: ball↔paddle offset frozen at re-lock (end of 'rise'),
//   absorbed toward 0 during the next push (no visible snap)
export function createDribbleState() {
  return {
    phase: 'push', phaseT: 0, armEase: 0,
    ballVelocityY: 0, riseBallisticY: 0, previousPushPaddleY: null,
    lockOffset: new THREE.Vector3(),
  }
}

// Dribble simulation, push/drop/rise state machine — parameterized on any
// robot/ball-target/state object, so the Main Menu card preview reuses the
// exact same code as the real game. state is mutated in place. physics is
// { ballRadius } (passed fresh: live-tunable). onBounce fires on floor
// contact only; the menu preview omits it (silent)
export function stepDribble(state, robot, ballPositionTarget, dt, physics, onBounce) 
{
  const { ballRadius } = physics
  const dribbleTuning = robot.dribbleTuning
  state.phaseT += dt
  const [elbowAmplitude, link1Amplitude] = dribbleAmplitudesRad(dribbleTuning)
  // armEase only updates in 'push'/'rise' — during 'drop' the arm holds
  if (state.phase === 'push') {
    const t = Math.min(state.phaseT / dribbleTuning.pushDuration, 1)
    state.armEase = t * t // ease-in: max speed exactly at release
  } else if (state.phase === 'rise') {
    // Rise duration must scale with the per-class bounce speed/gravity
    // (dribbleGravity is a per-class animation knob; the real shot keeps
    // the single shared BALL_GRAVITY)
    const riseDuration = (BALL_BOUNCE_SPEED * dribbleTuning.bounceSpeedScale) / dribbleTuning.dribbleGravity // time to decelerate to v=0
    const t = Math.min(state.phaseT / riseDuration, 1)
    state.armEase = 1 - t * t * (3 - 2 * t) // 1 → 0: arm returns up as the ball rises
  }


  // Apply BEFORE reading the paddle world position, or it lags a frame
  robot.controls.setDribbleOffsets(state.armEase * elbowAmplitude, state.armEase * link1Amplitude)

  getObjectWorldPosition(robot.paddle, paddleWorldPos)
  // Per-instance world-space offsets move the tracking point off the
  // paddle center. Deliberately NOT rotated with elbow/wrist pitch: an
  // offset arcing with the 40-degree push sweep would visibly detach the
  // ball — only the base yaw matters, Down is always world-down. Valid
  // here only because the dribble keeps the paddle tilt constant
  angleToForward(robot.joints.base.rotation.y, paddleForwardDir)
  rotateRight(paddleForwardDir, paddleSideDir)
  paddleWorldPos
    .addScaledVector(paddleForwardDir, robot.ballOffsetForward)
    .addScaledVector(paddleSideDir, robot.ballOffsetSide)
    .addScaledVector(paddleDownDir, robot.ballOffsetDown)

  if (state.phase === 'push') 
    {
    // lockOffset absorbs over a short window: no snap at re-lock, exact
    // paddle tracking for the rest of the push
    const lockBlend = Math.min(state.phaseT / dribbleTuning.lockAbsorbTime, 1)
    ballPositionTarget.copy(paddleWorldPos).addScaledVector(state.lockOffset, 1 - lockBlend)
    // Release velocity from the REAL paddle motion, not ballPositionTarget
    // (which includes the lockOffset absorption term and could cancel the
    // true velocity right at release)
    if (state.previousPushPaddleY !== null) state.ballVelocityY = (paddleWorldPos.y - state.previousPushPaddleY) / dt
    state.previousPushPaddleY = paddleWorldPos.y
    // Tolerance, not strict >= 1: phaseT accumulates 1/120 (inexact in
    // binary), so armEase reaches 0.99999... — without tolerance an extra
    // wasted step ran with the paddle already still, making the last
    // measured velocity exactly zero every cycle
    if (state.armEase >= 1 - 1e-6) { state.phase = 'drop'; state.phaseT = 0 }
  } else if (state.phase === 'drop') {
    // Safety net: a real fall lands well under 1s. If the ball position
    // was hijacked elsewhere (concurrent pickup/steal/block) the floor
    // condition may never trigger and the paddle would stay frozen open —
    // force a clean re-entry instead
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
      // Per-class bounce speed: taller paddles need a stronger bounce to
      // re-lock naturally at the top
      state.ballVelocityY = BALL_BOUNCE_SPEED * dribbleTuning.bounceSpeedScale
      state.riseBallisticY = ballY // true physics state for 'rise', restarts at the bounce point
      state.phase = 'rise'
      state.phaseT = 0
      if (onBounce) onBounce()
    }
    ballPositionTarget.set(paddleWorldPos.x, ballY, paddleWorldPos.z)
  } else { // 'rise'
    state.ballVelocityY -= dribbleTuning.dribbleGravity * dt
    // Integrate pure physics, never the corrected Y (the correction would
    // accumulate frame after frame instead of staying a constant offset)
    state.riseBallisticY += state.ballVelocityY * dt
    // Structural invariant: never let the ball rise past the paddle,
    // whatever combination of the 5+ interacting tuning knobs is set —
    // a calibration-only guarantee broke on every retuning round
    const ballY = Math.min(state.riseBallisticY - dribbleTuning.riseYCorrection, paddleWorldPos.y)
    ballPositionTarget.set(paddleWorldPos.x, ballY, paddleWorldPos.z)
    // Re-lock exactly at the ballistic apex (v=0), where both ball speed
    // and arm return are flattest — minimizes the visible snap
    if (state.armEase <= 0 || state.ballVelocityY <= 0) {
      // Freeze the ball↔paddle offset at the re-lock instant so 'push'
      // restarts from the real ball position
      state.lockOffset.copy(ballPositionTarget).sub(paddleWorldPos)
      state.previousPushPaddleY = null // no velocity history for the new push
      state.phase = 'push'
      state.phaseT = 0
    }
  }
  // Per-class visual flourish (legs crouching, drone bobbing...) — AFTER
  // ball/arm are positioned for this step, never before. Empty default
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

  // Restart from a clean 'push', not from where the ball last stopped
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
    // Reset the real joints too — resetDribbleState() only clears the
    // variables, the joints would hold the HANDLING pose one more frame
    robot.controls.setDribbleOffsets(0, 0)
    // updateAimPosture stops being called outside HANDLING — without this
    // the Drone body would stay tilted at the last aim angle
    robot.updateAimPosture(0, 1)
  }

  // Called at the fixed 120Hz step (accumulator in main.js). physics/
  // onBounce are reused, not rebuilt per call; only ballRadius can change
  // (debug slider) and is refreshed in place
  const dribblePhysics = { ballRadius: getBallRadius() }
  const onDribbleBounce = () => sfx.playBounce(dribbleBounceSoundVolume)
  function updateDribble(dt) {
    dribblePhysics.ballRadius = getBallRadius()
    stepDribble(dribbleState, getManipulator(), ctx.getBasketball().position, dt, dribblePhysics, onDribbleBounce)
  }

  // HANDLING (right mouse held): an interpolated pose, not a simulation —
  // no fixed timestep. Ease/grip approach their targets with the usual
  // framerate-independent exponential smoothing
  function updateHandling(delta) {
    const robot = getManipulator()
    const handlingTuning = robot.handlingTuning
    const lerpFactor = 1 - Math.exp(-handlingTuning.transitionSpeed * delta)
    dribbleState.armEase += (handlingTuning.ease - dribbleState.armEase) * lerpFactor
    handlingState.grip += (handlingTuning.gripOffset - handlingState.grip) * lerpFactor
    robot.controls.setGrip(handlingState.grip)

    // Elbow already coupled to camera pitch HERE (same formula as the
    // shoot animation): no jump when the windup starts
    const aimPitchOffset = computeAimPitchOffset()
    robot.controls.setAimPitch(aimPitchOffset)
    // Per-class hook (empty default) — only the Drone tilts its body
    robot.updateAimPosture(aimPitchOffset, delta)

    // Read fresh every frame: paddleTilt is live-tunable from debug
    const targetHandlingTilt = -robot.getPaddleTilt()
    handlingState.tiltOffset += (targetHandlingTilt - handlingState.tiltOffset) * lerpFactor
    robot.controls.setShootTilt(handlingState.tiltOffset)

    const [handlingElbowAmplitude, handlingLink1Amplitude] = dribbleAmplitudesRad(robot.dribbleTuning)
    robot.controls.setDribbleOffsets(dribbleState.armEase * handlingElbowAmplitude, dribbleState.armEase * handlingLink1Amplitude)

    // No offsets here: ballRestPoint is already the geometrically correct
    // point (the V-plates' convergence), valid at any tilt
    snapBallToRestPoint(robot, ctx.getBasketball())
  }

  // Start a pickup if the free ball is in reach. Cheap squared-distance
  // reject before the precise bounding-box test (which allocates/traverses)
  function checkForPickup() {
    const ball = ctx.getBasketball()
    const robot = getManipulator()
    if (pickupState.phase !== 'idle' || !ball || ball.state !== BallState.FREE) return
    if (robot.state !== RobotState.NO_BALL) return
    // Own STEAL/BLOCK must be fully idle: two animations writing the same
    // joints in one frame left the paddle stuck in the block pose
    if (ctx.stealState && ctx.stealState.phase !== 'idle') return
    if (ctx.blockState && ctx.blockState.phase !== 'idle') return
    if (robot.root.position.distanceToSquared(ball.position) > pickupCoarseRadius * pickupCoarseRadius) return
    if (!isRobotTouchingBall(robot, ball, getBallRadius(), pickupMargin)) return
    // ATOMIC claim here, not at animation end: in 1v1 both robots can pass
    // this check in the SAME frame — the first claimant marks the ball
    // taken so the second one stops on its own. Without this, two pickups
    // fought over ball.position every frame (visible jitter on the floor)
    ball.setState(BallState.HANDLED)
    ball.setOwner(robot)
    pickupState.phase = 'active'
    pickupState.phaseT = 0
  }

  // Ball snaps to the paddle on the FIRST frame (no lerp — it looked like
  // it was escaping); the arm plays a short 0→1→0 dip as a visual
  // flourish, returning to 0 before the pickup ends so the resuming
  // dribble (which starts at armEase=0) attaches without a snap
  function updatePickup(delta) {
    const ball = ctx.getBasketball()
    const robot = getManipulator()
    // The claim is atomic but the state is still NO_BALL during these
    // 0.3s, an opponent STEAL can take the just-claimed ball. Abort
    // cleanly instead of finishing a pickup for a ball we no longer own
    if (!ball || ball.owner !== robot) {
      pickupState.phase = 'idle'
      dribbleState.armEase = 0
      robot.controls.setDribbleOffsets(0, 0)
      return
    }

    pickupState.phaseT += delta
    const t = Math.min(pickupState.phaseT / pickupDuration, 1)
    const dipT = Math.sin(t * Math.PI) // 0 -> 1 -> 0, not 0 -> 1

    dribbleState.armEase = dipT
    const [pickupElbowAmplitude, pickupLink1Amplitude] = dribbleAmplitudesRad(robot.dribbleTuning)
    robot.controls.setDribbleOffsets(dribbleState.armEase * pickupElbowAmplitude, dribbleState.armEase * pickupLink1Amplitude)

    snapBallToRestPoint(robot, ball)

    if (t >= 1) {
      pickupState.phase = 'idle'
      // BallState/owner already set by the atomic claim. This also clears
      // shootingState.released (else animate() would keep routing to
      // updateShotFlight instead of restarting the dribble)
      resetToNeutralPossession(robot, { dribbleState, handlingState, shootingState }, resetDribbleState)
    }
  }

  return { resetDribbleState, releaseBallHandling, updateDribble, updateHandling, checkForPickup, updatePickup }
}
