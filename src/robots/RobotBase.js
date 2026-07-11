// OOP wrapper over the robot factories (AMRManipulatorModelMaker(),
// LeggedManipulatorModelMaker(), DroneModelMaker()). Adds shared stats/type/
// behavior on top of what Object.assign(this, factory()) copies over.

import * as THREE from 'three'
import { lerpAngle } from '../utils/mathUtils.js'
import { BALL_GRAVITY } from '../utils/constants.js'
import { Team } from '../SharedEnums.js'

// Default accent color per team. Team.A keeps the factory orange.
const TEAM_ACCENT_COLOR = Object.freeze({ [Team.B]: 0xe83f3f })

// SPEED stat (1-5) to world units/s
function speedStatToUnitsPerSecond(speedStat) {
  return 50 + speedStat * 50
}

// JS "enum": frozen plain object
export const RobotState = Object.freeze({
  DRIBBLE: 'dribble',    // auto-dribble active
  HANDLING: 'handling',  // ball held, dribble paused
  NO_BALL: 'no_ball',    // ball shot/lost
})

export class RobotBase 
{
  constructor({ factory, stats, type, team }) {
    Object.assign(this, factory())
    this.stats = stats
    this.type = type
    this.team = team
    if (TEAM_ACCENT_COLOR[team] !== undefined) this.controls.setColors({ accent: TEAM_ACCENT_COLOR[team] })
    this.state = RobotState.DRIBBLE
    this.locomotionYaw = -Math.PI / 2
    this.specialMoveState = { phase: 'idle', phaseT: 0, charges: this.specialMoveMaxCharges, rechargeTimer: 0 }

    // Per-instance ball tracking offsets (BallPossession.js)
    this.ballOffsetForward = 6
    this.ballOffsetSide = 0
    this.ballOffsetDown = 12
    this.ballRestExtraOffset = 0.08

    // Per-instance tuning (was global in main.js) 
    this.dribbleTuning = 
    {
      pushDuration: 0.25, elbowAmplitudeDeg: 40, link1AmplitudeDeg: 10,
      lockAbsorbTime: 0.25, riseYCorrection: 7,
      bounceSpeedScale: 1,
      dribbleGravity: BALL_GRAVITY, // own gravity for the dribble animation only, not the real shot physics
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
    this.elevatedShootTuning = null // Drone-only override, see Drone.js
  }

  // Subclass override: max charges / recharge cooldown
  get specialMoveMaxCharges() { return 1 }
  get specialMoveCooldownTime() { return Infinity }

  canUseSpecialMove() {
    return this.specialMoveState.phase === 'idle' && this.specialMoveState.charges > 0
  }

  triggerSpecialMove() {
    if (!this.canUseSpecialMove()) return false
    this.specialMoveState.charges--
    if (this.specialMoveState.rechargeTimer <= 0) this.specialMoveState.rechargeTimer = this.specialMoveCooldownTime
    this.onSpecialMoveStart()
    return true
  }

  // isShooting freezes an already-active move so it doesn't fight the shot animation
  updateSpecialMove(delta, isShooting = false) 
  {
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

  // Subclass hooks, empty by default
  onSpecialMoveStart() {}
  onSpecialMoveUpdate() {}
  onDribbleTick(state, delta) {}
  updateAimPosture(aimPitchOffset, delta) {}

  // Real bounding box, shared by every touch/contact check
  getBodyBox(target = new THREE.Box3()) {
    return target.setFromObject(this.root)
  }

  setState(state) {
    this.state = state
  }

  // Default locomotion facing: lerp yaw onto wheelsGroup. Override for classes with different locomotion anim.
  updateLocomotionAnimation(targetYaw, delta, turnSpeed) {
    this.locomotionYaw = lerpAngle(this.locomotionYaw, targetYaw, 1 - Math.exp(-turnSpeed * delta))
    this.wheelsGroup.rotation.y = this.locomotionYaw
  }

  // Always-full speed, used by dash
  get baseSpeed() 
  {
    return speedStatToUnitsPerSecond(this.stats.speed)
  }

  // Real movement speed, 75% in HANDLING
  get speed() 
  {
    return this.state === RobotState.HANDLING ? this.baseSpeed * 0.75 : this.baseSpeed
  }

  move(moveVec, delta) 
  {
    this.root.position.addScaledVector(moveVec, this.speed * delta)
  }
}
