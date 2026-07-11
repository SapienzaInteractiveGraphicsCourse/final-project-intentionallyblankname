import * as THREE from 'three'
import { DroneModelMaker } from './ModelMakers/DroneModelMaker.js'
import { RobotBase } from './RobotBase.js'
import { lerpAngle } from '../utils/mathUtils.js'

// Fastest of the roster (flies, no wheels/legs to turn), worst STEAL/BLOCK (light body, no grip/mass)
export const DRONE_STATS = { speed: 5, shooting: 2, steal: 1, block: 1 }

// All tunable Drone numbers (locomotion/bank + Flight) in one mutable
// object, same reasoning as dribbleTuning/shootTuning elsewhere
export const droneTuning = {}
droneTuning.rotorSpinSpeed = 24   // rad/s, spins even standing still
droneTuning.bankGain = 0.15       // bank per yaw rate
droneTuning.bankMax = 0.35
droneTuning.bankSmoothSpeed = 8

// Body tilts back while aiming up in HANDLING (not during Flight) to clear the view
droneTuning.aimBodyTiltGain = 0.5
droneTuning.aimBodyTiltMax = 0.4
droneTuning.aimBodyTiltSmoothSpeed = 8

// Body noses down while moving (real quadcopter thrust tilt), proportional to real measured speed
droneTuning.thrustTiltGain = 0.0025
droneTuning.thrustTiltMax = 0.25
droneTuning.thrustTiltSmoothSpeed = 6

// Flight: long cooldown, 1 charge. Immune to STEAL simply because its
// bounding box is too high up to overlap the stealer's reach at flightHeight.
// Phases: grab (0.15s) → rise (1s) → hold (4s) → descend (1s)
droneTuning.flightCooldown = 17
droneTuning.flightRiseDuration = 1
droneTuning.flightHoldDuration = 4
droneTuning.flightDescendDuration = 1
droneTuning.flightHeight = 400
droneTuning.flightSpeedScale = 0.2 // movement heavily slowed while elevated
droneTuning.flightGrabDuration = 0.15
// Matches handlingTuning.gripOffset (0.5) — verified live, no reason for a tighter V just in Flight
droneTuning.flightGrabTarget = 0.5
droneTuning.flightBallRestOffset = 0.1

export class Drone extends RobotBase 
{
  constructor(team) 
  {
    super({ factory: DroneModelMaker, stats: DRONE_STATS, type: 'DRONE', team })
    this._bank = 0
    this._aimBodyTilt = 0
    this._thrustTilt = 0
    this._prevPosForThrustTilt = this.root.position.clone()

    // Paddle is flipped (armFlip)
    // that +12 is the value that rests the ball cleanly without overlap
    this.ballOffsetDown = 12
    this.ballRestExtraOffset = 0.15

    //  bounce needs scaling down to stay in sync
    this.dribbleTuning.bounceSpeedScale = 0.88

    // RobotBase's shootTuning is tuned for the arm hanging below the body
    // (correct while isElevated/Flight). On the ground the same motion would
    // intersect the body, so elevatedShootTuning keeps the Flight-good pose
    // and shootTuning gets windup/release swapped for the ground case
    this.elevatedShootTuning = { ...this.shootTuning }
    ;[this.shootTuning.elbowWindupDeg, this.shootTuning.elbowReleaseDeg] = [this.shootTuning.elbowReleaseDeg, this.shootTuning.elbowWindupDeg]
    ;[this.shootTuning.link1WindupDeg, this.shootTuning.link1ReleaseDeg] = [this.shootTuning.link1ReleaseDeg, this.shootTuning.link1WindupDeg]
    ;[this.shootTuning.tiltWindupPeak, this.shootTuning.tiltTarget] = [this.shootTuning.tiltTarget, this.shootTuning.tiltWindupPeak]
    // Magnitudes re-tuned after the swap (verified live): bigger windup, shorter release recoil
    this.shootTuning.elbowWindupDeg = 25
    this.shootTuning.link1WindupDeg = 30
    this.shootTuning.elbowReleaseDeg = -20
    this.shootTuning.link1ReleaseDeg = -15
  }

  // Doesn't walk: rotors always spin, body banks into turns instead of the rigid pivot RobotBase inherits by default
  updateLocomotionAnimation(targetYaw, delta, turnSpeed) // OVERRIDING CAUSE DRONE IS DIFFERENT
  {
    const prevYaw = this.locomotionYaw

    // (real bug: drone looked "turned sideways" while moving). Same lerp formula, routed through setWheelsYaw instead.
    this.locomotionYaw = lerpAngle(this.locomotionYaw, targetYaw, 1 - Math.exp(-turnSpeed * delta))
    this.controls.setWheelsYaw(this.locomotionYaw)

    const yawRate = delta > 0 ? (this.locomotionYaw - prevYaw) / delta : 0
    const bankTarget = THREE.MathUtils.clamp(-yawRate * droneTuning.bankGain, -droneTuning.bankMax, droneTuning.bankMax)
    this._bank += (bankTarget - this._bank) * (1 - Math.exp(-droneTuning.bankSmoothSpeed * delta))
    this.controls.setBank(this._bank)
    this.controls.spinRotors(delta, droneTuning.rotorSpinSpeed)

    // Thrust tilt: real speed from root.position delta (covers Dash too), always nose-down toward heading
    const movedSpeed = delta > 0 ? this.root.position.distanceTo(this._prevPosForThrustTilt) / delta : 0
    this._prevPosForThrustTilt.copy(this.root.position)
    const thrustTarget = THREE.MathUtils.clamp(movedSpeed * droneTuning.thrustTiltGain, 0, droneTuning.thrustTiltMax)
    this._thrustTilt += (thrustTarget - this._thrustTilt) * (1 - Math.exp(-droneTuning.thrustTiltSmoothSpeed * delta))
    this._applyBodyPitch()
  }

  // Called every frame in HANDLING (never Flight): body tilts to clear the view while aiming up
  updateAimPosture(aimPitchOffset, delta) {
    const target = THREE.MathUtils.clamp(-aimPitchOffset * droneTuning.aimBodyTiltGain, -droneTuning.aimBodyTiltMax, droneTuning.aimBodyTiltMax)
    this._aimBodyTilt += (target - this._aimBodyTilt) * (1 - Math.exp(-droneTuning.aimBodyTiltSmoothSpeed * delta))
    this._applyBodyPitch()
  }

  // aim and thrust tilt share the same physical axis — combined into one setBodyPitch call
  _applyBodyPitch() {
    this.controls.setBodyPitch(this._aimBodyTilt + this._thrustTilt)
  }

  get specialMoveMaxCharges() { return 1 }
  get specialMoveCooldownTime() { return droneTuning.flightCooldown }

  // True for the whole move (rise/hold/descend), not just the peak
  get isElevated() {
    return this.specialMoveState.phase !== 'idle'
  }

  // 20% speed while elevated — stacks with RobotBase's HANDLING reduction, never conflicts in practice
  get speed() {
    return this.isElevated ? super.speed * droneTuning.flightSpeedScale : super.speed
  }

  onSpecialMoveStart() {
    // 'grab' before 'rise': quick paddle close around the ball so takeoff
    // doesn't leave it behind — just the visual gesture, not a real HANDLING state
    this.specialMoveState.phase = 'grab'
    this.specialMoveState.phaseT = 0
    // ballRestExtraOffset swap NOT done here (real bug): doing
    // it at t=0 while grip is still 0 made ballRestPoint jump away from the
    // ball instantly. Eased in onSpecialMoveUpdate instead, synced to the same t as the grip.
  }

  // root.position.y follows a 4-phase profile (grab→rise→hold→descend), not
  // a parabola like Jump — a real "hold" in the air is wanted here, timer-driven, no physics engine
  onSpecialMoveUpdate(delta) {
    const s = this.specialMoveState
    if (s.phase === 'idle') return
    s.phaseT += delta
    if (s.phase === 'grab') {
      const t = Math.min(s.phaseT / droneTuning.flightGrabDuration, 1)
      this.controls.setGrip(droneTuning.flightGrabTarget * t)
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
      // Grip reopens in sync with the descent, not snapped to 0 at the end
      this.controls.setGrip(droneTuning.flightGrabTarget * (1 - THREE.MathUtils.smoothstep(t, 0, 1)))
      if (t >= 1) {
        s.phase = 'idle'; s.phaseT = 0; this.root.position.y = 0
        this.controls.setBallRestOffset(this.ballRestExtraOffset)
      }
    }
  }
}
