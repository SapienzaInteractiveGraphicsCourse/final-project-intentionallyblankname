import * as THREE from 'three'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { dribbleAmplitudesRad, snapBallToRestPoint, getObjectWorldPosition, resetToNeutralPossession } from './BallPossession.js'
import { angleToForward } from '../utils/mathUtils.js'

// STEAL and BLOCK, shared by player (Q/E) and enemy AI. Both are arm
// reaches driven by the same setDribbleOffsets API as dribble/shoot, with
// the same structure (reach, contact, resolve, cooldown), usable only in
// RobotState.NO_BALL.
//
// STEAL: base (R1) sweeps while the arm stays extended. Contact is tested
// against the opponent's real body box with an ASYMMETRIC reach margin
// relative to where the STEALER aims (wide in front, near zero behind).
// Possession transfers only at the end of the sweep, with conditions
// re-checked fresh. The victim goes NO_BALL (else its dribble dispatch
// would keep fighting over basketball.position).
// BLOCK: arm points at the ball for the whole reach; success while the
// ball is FREE_SHOT (in flight, before the first floor bounce). No owner
// change, the shot is just deflected back to FREE.

// STEAL cooldown by stat: hand-tuned values, not a clean progression, so
// a table instead of a forced formula. BLOCK stays linear (7-stat)
const STEAL_COOLDOWN_BY_STAT = { 1: 6, 2: 5, 3: 4, 4: 3.5, 5: 3 }
// Exported: main.js uses them for the HUD cooldown bar fill
export function stealCooldownFor(stealStat) { return STEAL_COOLDOWN_BY_STAT[stealStat] }
export function blockCooldownFor(blockStat) { return 7 - blockStat }
// Anti steal-back lockout applied to the VICTIM of a successful steal,
// indexed on the victim's own STEAL stat
const VICTIM_STEAL_LOCKOUT_BY_STAT = { 1: 4, 2: 3, 3: 2, 4: 1.5, 5: 1 }
function victimStealLockoutFor(stealStat) { return VICTIM_STEAL_LOCKOUT_BY_STAT[stealStat] }
const STEAL_REACH_DURATION = 0.4
const BLOCK_REACH_DURATION = 0.375
// Return-to-neutral time after success OR failure (never a snap)
const RESOLVE_DURATION = 0.2
// Asymmetric STEAL reach margins beyond the opponent's body, relative to
// the stealer's aim. Exported: CollisionDebugView draws the same values
export const STEAL_FORWARD_MARGIN = 90
export const STEAL_BACKWARD_MARGIN = 20
// BLOCK contact box centered on the end effector, scaled by the blocker's
// BLOCK stat (+20% per level). Exported for CollisionDebugView (key 7)
export const BLOCK_BOX_BASE_HALF_SIZE = 30
export function blockBoxHalfSizeFor(blockStat) {
  return BLOCK_BOX_BASE_HALF_SIZE * (1 + 0.2 * (blockStat - 1))
}
const STEAL_ELBOW_DEG = -70
const STEAL_LINK1_DEG = 50
const STEAL_SWEEP_AMPLITUDE_DEG = 50 // base sweep, -X to +X around the current aim
// BLOCK pose reaches UP, not forward: link1 near vertical, elbow almost straight
const BLOCK_ELBOW_DEG = -65
const BLOCK_LINK1_DEG = 5
// Converted once, not per frame
const STEAL_ELBOW_TARGET = THREE.MathUtils.degToRad(STEAL_ELBOW_DEG)
const STEAL_LINK1_TARGET = THREE.MathUtils.degToRad(STEAL_LINK1_DEG)
const STEAL_SWEEP_AMPLITUDE = THREE.MathUtils.degToRad(STEAL_SWEEP_AMPLITUDE_DEG)
const BLOCK_ELBOW_TARGET = THREE.MathUtils.degToRad(BLOCK_ELBOW_DEG)
const BLOCK_LINK1_TARGET = THREE.MathUtils.degToRad(BLOCK_LINK1_DEG)

// Shared guard: EnemyAI and main.js freeze movement/decisions while a
// combat move animation is running
export function isCombatMoveActive(stealState, blockState) {
  return stealState.phase !== 'idle' || blockState.phase !== 'idle'
}

export function initCombatMoves(ctx) {
  const {
    getManipulator, getOtherManipulator, resetDribbleState, otherResetDribbleState,
    dribbleState, getBasketball, otherShootingState, otherDashState, sfx,
    otherHandlingState, otherStealState, otherPickupState, shootingState,
    pickupState, handlingState,
    // Optional: where this robot is aiming (player: camera crosshair;
    // enemy: undefined, falls back to wheels)
    getAimYaw,
    // Function, not a snapshot: live-tunable from the debug panel
    getBallRadius,
    // Always passed from main.js, never created here: each instance must
    // read the OTHER robot's stealState (anti steal-back lockout), which
    // would be a circular reference if created inside
    stealState, blockState,
  } = ctx

  const scratchOpponentBox = new THREE.Box3()
  const scratchNearestOnOpponent = new THREE.Vector3()
  const scratchStealDelta = new THREE.Vector3()
  const scratchStealForward = new THREE.Vector3()
  // Contact vs the opponent's real body box, with the asymmetric margin
  // blended by the cosine of the angle to the stealer's aim (no hard
  // front/back split)
  function isTouchingOpponentBox() {
    getOtherManipulator().getBodyBox(scratchOpponentBox)
    scratchOpponentBox.clampPoint(getManipulator().root.position, scratchNearestOnOpponent)
    scratchStealDelta.subVectors(scratchNearestOnOpponent, getManipulator().root.position)
    scratchStealDelta.y = 0
    const dist = scratchStealDelta.length()
    if (dist < 1e-4) return true // already inside the opponent's body
    angleToForward(resolveAimYaw(), scratchStealForward)
    const forwardAmount = scratchStealDelta.dot(scratchStealForward) / dist // cosine, [-1,1]
    const margin = forwardAmount > 0
      ? THREE.MathUtils.lerp(STEAL_BACKWARD_MARGIN, STEAL_FORWARD_MARGIN, forwardAmount)
      : STEAL_BACKWARD_MARGIN
    return dist <= margin
  }

  // Stealability, re-checked FRESH both at contact and at sweep end (the
  // opponent may have shot/lost the ball in between). Conditions:
  // - opponent shooting idle: stealing mid-windup left their shot
  //   animation running blind, forcing the stolen ball into flight
  // - dash immunity: a 0.15s 6x burst contact is a hitbox accident
  // - pickup idle: during the 0.3s claim the opponent is still NO_BALL
  //   but already owns the ball; stealing then double-drives the ball
  function canStealFrom(ball) {
    const otherIsDashing = otherDashState && otherDashState.timeRemaining > 0
    const otherIsPickingUp = otherPickupState && otherPickupState.phase === 'active'
    return !!ball && ball.owner === getOtherManipulator() && ball.state === BallState.HANDLED
      && otherShootingState.phase === 'idle' && !otherIsDashing && !otherIsPickingUp
  }

  const scratchAimDir = new THREE.Vector3()
  // Point the base (R1) at worldPos on the horizontal plane (BLOCK tracks
  // the ball in flight). No-op when too close: degenerate direction
  function aimBaseToward(worldPos) {
    const manipulator = getManipulator()
    scratchAimDir.subVectors(worldPos, manipulator.root.position)
    scratchAimDir.y = 0
    if (scratchAimDir.lengthSq() < 1) return
    manipulator.controls.setAimYaw(Math.atan2(scratchAimDir.x, scratchAimDir.z))
  }

  const scratchPaddlePos = new THREE.Vector3()
  function paddleWorldPosition() {
    return getObjectWorldPosition(getManipulator().paddle, scratchPaddlePos)
  }

  // Sphere (ball) vs box centered on the end effector, sized by the
  // blocker's BLOCK stat
  const scratchBlockBox = new THREE.Box3()
  const scratchBlockClamped = new THREE.Vector3()
  function isBallInBlockBox(ballPosition) {
    const center = paddleWorldPosition()
    const halfSize = blockBoxHalfSizeFor(getManipulator().stats.block)
    scratchBlockBox.min.set(center.x - halfSize, center.y - halfSize, center.z - halfSize)
    scratchBlockBox.max.set(center.x + halfSize, center.y + halfSize, center.z + halfSize)
    scratchBlockBox.clampPoint(ballPosition, scratchBlockClamped)
    return scratchBlockClamped.distanceTo(ballPosition) <= getBallRadius()
  }

  // Own pickup/shooting must also be idle, not just state === NO_BALL:
  // during pickup (0.3s) and shot 'recover' another animation is already
  // writing the same joints
  function canTrigger(moveState) {
    return getManipulator().state === RobotState.NO_BALL
      && stealState.phase === 'idle' && blockState.phase === 'idle'
      && pickupState.phase === 'idle' && shootingState.phase === 'idle'
      && moveState.cooldown <= 0
  }

  // Where this robot is AIMING now (player: camera; enemy: wheels). Used
  // for both the sweep pivot and the resolve return target: wheels alone
  // were wrong for the player, whose aim follows the camera
  function resolveAimYaw() {
    return getAimYaw ? getAimYaw() : getManipulator().wheelsGroup.rotation.y
  }

  function startReach(moveState) {
    const [elbowAmp, link1Amp] = dribbleAmplitudesRad(getManipulator().dribbleTuning)
    moveState.phase = 'reach'
    moveState.phaseT = 0
    moveState.startElbow = dribbleState.armEase * elbowAmp
    moveState.startLink1 = dribbleState.armEase * link1Amp
    moveState.startAimYaw = resolveAimYaw()
    // Reset at the start of EVERY reach: a previous reach interrupted
    // mid-way (e.g. BACK TO MAIN MENU) with contact already made would
    // otherwise make the next steal "succeed" without any real contact
    moveState.contactMade = false
  }

  function triggerSteal() {
    if (!canTrigger(stealState)) return
    startReach(stealState)
  }

  function triggerBlock() {
    if (!canTrigger(blockState)) return
    startReach(blockState)
  }

  function beginResolve(moveState, elbowAtEnd, link1AtEnd) {
    moveState.phase = 'resolve'
    moveState.phaseT = 0
    moveState.resolveFromElbow = elbowAtEnd
    moveState.resolveFromLink1 = link1AtEnd
  }

  // Re-check real ownership at resolve end instead of assuming it from
  // when the animation started
  function finishResolve() {
    const manipulator = getManipulator()
    if (manipulator.state === RobotState.NO_BALL) {
      const ball = getBasketball()
      if (ball && ball.owner === manipulator) {
        // Also clears shootingState.released (a stale true from an old
        // abandoned shot kept routing the ball to updateShotFlight)
        resetToNeutralPossession(manipulator, { dribbleState, handlingState, shootingState }, resetDribbleState)
      }
    }
  }

  function updateSteal(delta) {
    const manipulator = getManipulator()
    const otherManipulator = getOtherManipulator()
    if (stealState.cooldown > 0) stealState.cooldown -= delta
    if (stealState.phase === 'idle') return
    stealState.phaseT += delta

    if (stealState.phase === 'reach') {
      const t = Math.min(stealState.phaseT / STEAL_REACH_DURATION, 1)
      const elbowTarget = STEAL_ELBOW_TARGET
      const link1Target = STEAL_LINK1_TARGET
      const elbowNow = THREE.MathUtils.lerp(stealState.startElbow, elbowTarget, t)
      const link1Now = THREE.MathUtils.lerp(stealState.startLink1, link1Target, t)
      manipulator.controls.setDribbleOffsets(elbowNow, link1Now)
      // Base sweeps from -amplitude to +amplitude while the arm stays extended
      const sweepAngle = THREE.MathUtils.lerp(-1, 1, t) * STEAL_SWEEP_AMPLITUDE
      const aimYawNow = stealState.startAimYaw + sweepAngle
      manipulator.controls.setAimYaw(aimYawNow)

      const ball = getBasketball()
      // Contact is only TRACKED here: the sweep plays in full, possession
      // transfers at t>=1 below (transferring on first touch cut the
      // sweep short exactly when it succeeded)
      if (!stealState.contactMade && canStealFrom(ball) && isTouchingOpponentBox()) {
        stealState.contactMade = true
      }
      if (t >= 1) {
        if (stealState.contactMade) {
          if (canStealFrom(ball)) {
            ball.setOwner(manipulator)
            // Snap immediately: neither robot's dribble is driving the
            // ball during resolve (both NO_BALL), it froze in mid-air
            snapBallToRestPoint(manipulator, ball)
            otherManipulator.setState(RobotState.NO_BALL)
            otherResetDribbleState()
            // Victim's HANDLING grip/tilt: resetDribbleState never touches
            // them, a half-closed paddle survived into the next dribble
            otherHandlingState.grip = 0
            otherHandlingState.tiltOffset = 0
            otherManipulator.controls.setGrip(0)
            // Anti steal-back lockout (never shortens a longer cooldown)
            otherStealState.cooldown = Math.max(otherStealState.cooldown, victimStealLockoutFor(otherManipulator.stats.steal))
            sfx.playSteal()
          }
        }
        stealState.contactMade = false
        beginResolve(stealState, elbowTarget, link1Target)
        stealState.resolveFromAimYaw = aimYawNow
      }
    } else { // 'resolve'
      const t = Math.min(stealState.phaseT / RESOLVE_DURATION, 1)
      manipulator.controls.setDribbleOffsets(
        THREE.MathUtils.lerp(stealState.resolveFromElbow, 0, t),
        THREE.MathUtils.lerp(stealState.resolveFromLink1, 0, t),
      )
      // Keep the just-stolen ball attached for the whole resolve
      if (getBasketball()?.owner === manipulator) snapBallToRestPoint(manipulator, getBasketball())
      // Return toward resolveAimYaw() read fresh each frame (the player's
      // aim follows the camera, not the wheels)
      manipulator.controls.setAimYaw(THREE.MathUtils.lerp(stealState.resolveFromAimYaw, resolveAimYaw(), t))
      if (t >= 1) {
        stealState.phase = 'idle'
        stealState.cooldown = stealCooldownFor(manipulator.stats.steal)
        finishResolve()
      }
    }
  }

  function updateBlock(delta) {
    const manipulator = getManipulator()
    if (blockState.cooldown > 0) blockState.cooldown -= delta
    if (blockState.phase === 'idle') return
    blockState.phaseT += delta

    if (blockState.phase === 'reach') {
      const t = Math.min(blockState.phaseT / BLOCK_REACH_DURATION, 1)
      const elbowTarget = BLOCK_ELBOW_TARGET
      const link1Target = BLOCK_LINK1_TARGET
      const elbowNow = THREE.MathUtils.lerp(blockState.startElbow, elbowTarget, t)
      const link1Now = THREE.MathUtils.lerp(blockState.startLink1, link1Target, t)
      manipulator.controls.setDribbleOffsets(elbowNow, link1Now)

      const ball = getBasketball()
      // Track the moving ball every frame of the reach
      if (ball) aimBaseToward(ball.position)
      if (ball && ball.state === BallState.FREE_SHOT) {
        if (isBallInBlockBox(ball.position)) {
          // Deflected: no owner, ball is FREE and pickable by anyone
          ball.setState(BallState.FREE)
          sfx.playBlock()
          beginResolve(blockState, elbowNow, link1Now)
          return
        }
      }
      if (t >= 1) beginResolve(blockState, elbowTarget, link1Target)
    } else { // 'resolve'
      const t = Math.min(blockState.phaseT / RESOLVE_DURATION, 1)
      manipulator.controls.setDribbleOffsets(
        THREE.MathUtils.lerp(blockState.resolveFromElbow, 0, t),
        THREE.MathUtils.lerp(blockState.resolveFromLink1, 0, t),
      )
      if (t >= 1) {
        blockState.phase = 'idle'
        blockState.cooldown = blockCooldownFor(manipulator.stats.block)
        // BLOCK never touches possession: no finishResolve() needed
      }
    }
  }

  return {
    triggerSteal, triggerBlock, updateSteal, updateBlock,
    stealState, blockState,
    // HUD pill: available only without ball, off cooldown, no move running
    canUseSteal: () => canTrigger(stealState),
    canUseBlock: () => canTrigger(blockState),
  }
}
