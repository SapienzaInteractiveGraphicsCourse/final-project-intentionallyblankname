import { LeggedManipulatorModelMaker } from './ModelMakers/LeggedManipulatorModelMaker.js'
import { RobotBase, RobotState } from './RobotBase.js'

// Slower than MANIPULATOR (legs, not wheels), better at shooting/defense
export const LEGGED_MANIPULATOR_STATS = { speed: 2, shooting: 3, steal: 2, block: 5 }

// Jump: one vertical hop, 1 charge, cooldown longer than Dash (shouldn't be
// spammable). Phases: crouch (anticipation) → air (pure parabola, legs
// extend mid-air) → land (impact compression, back to neutral)
const JUMP_COOLDOWN = 5
const JUMP_CROUCH_DURATION = 0.15
const JUMP_AIR_DURATION = 0.4
const JUMP_LAND_DURATION = 0.15
const JUMP_HEIGHT = 170
const JUMP_CROUCH_BEND = -0.35 // rad, hip+knee together (setLegBend)
const JUMP_AIR_BEND = 0.25 // rad, peak at mid-air

// Walk cycle only advances while actually moving (no signal for that in
// RobotBase, deduced here from frame-to-frame root.position)
const WALK_MIN_SPEED = 1 // world units/s, below this = float jitter at rest, not real movement
const WALK_CYCLE_SPEED = 6 // rad/s, first-pass value

export class LeggedManipulator extends RobotBase 
{
  constructor(team)
  {
    super({ factory: LeggedManipulatorModelMaker, stats: LEGGED_MANIPULATOR_STATS, type: 'LEGGED_MANIPULATOR', team })
    this._prevPosition = this.root.position.clone()
    this._walkPhase = 0
    // More Energetic Dribble for this Robot
    this.dribbleTuning.bounceSpeedScale = 1.4
  }

  // Rigid pivot inherited from RobotBase (super), plus a real trot cycle on
  // top, suspended during Jump (same joint) and while standing still
  updateLocomotionAnimation(targetYaw, delta, turnSpeed) 
  {
    super.updateLocomotionAnimation(targetYaw, delta, turnSpeed) //Animation Update

    //Position difference
    const dx = this.root.position.x - this._prevPosition.x
    const dz = this.root.position.z - this._prevPosition.z
    this._prevPosition.copy(this.root.position) //REMEMBERE THOSE ARE REFERENCESE I HAVE TO COPY


    if (this.specialMoveState.phase !== 'idle' || delta <= 0) return


    const speedNow = Math.hypot(dx, dz) / delta //Velocity Computation
    
    //Update Leg Cycle based on speed 
    if (speedNow > WALK_MIN_SPEED) 
    {
      this._walkPhase += delta * WALK_CYCLE_SPEED
      this.controls.setLegWalkCycle(this._walkPhase)
    } else if (this._walkPhase !== 0) {
      this._walkPhase = 0
      this.controls.setLegWalkCycle(0)
    }
  }

  get specialMoveMaxCharges() { return 1 }
  get specialMoveCooldownTime() { return JUMP_COOLDOWN }



  // Jump only with no ball in hand 

  canUseSpecialMove() 
  {
    return this.state === RobotState.NO_BALL && super.canUseSpecialMove()
  }

  onSpecialMoveStart() 
  {
    this.specialMoveState.phase = 'crouch'
    this.specialMoveState.phaseT = 0
  }

  // in AIR; Pure parabola, no physics
  onSpecialMoveUpdate(delta) 
  {
    const s = this.specialMoveState
    if (s.phase === 'idle') return
    s.phaseT += delta
    if (s.phase === 'crouch') {
      const t = Math.min(s.phaseT / JUMP_CROUCH_DURATION, 1)
      this.controls.setLegBend(JUMP_CROUCH_BEND * t)
      if (t >= 1) { s.phase = 'air'; s.phaseT = 0 }
    } else if (s.phase === 'air') {
      const t = Math.min(s.phaseT / JUMP_AIR_DURATION, 1)
      this.root.position.y = JUMP_HEIGHT * 4 * t * (1 - t)
      this.controls.setLegBend(JUMP_AIR_BEND * Math.sin(t * Math.PI))
      if (t >= 1) { s.phase = 'land'; s.phaseT = 0 }
    } else { // 'land'
      const t = Math.min(s.phaseT / JUMP_LAND_DURATION, 1)
      this.root.position.y = 0
      this.controls.setLegBend(JUMP_CROUCH_BEND * (1 - t))
      if (t >= 1) { s.phase = 'idle'; s.phaseT = 0; this.controls.setLegBend(0) }
    }
  }
}
