import * as THREE from 'three'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { isCombatMoveActive } from './CombatMoves.js'

// Enemy AI tactical FSM. Distinct from RobotState (physical possession/
// animation state of ANY robot): EnemyState is the AI decision only
export const EnemyState = Object.freeze({
  CHASE_BALL: 'chase_ball', // free ball: go get it
  ATTACK: 'attack',         // has the ball: drive to the hoop, shoot in range
  DEFEND: 'defend',         // player has the ball: get between him and his hoop
})

// Distance to the hoop under which the AI shoots instead of approaching
const AI_SHOOT_RANGE = 500
// Visible aim time (HANDLING) before the actual shot, not an instant shot
const AI_AIM_DURATION = 0.6
// "Arrived" radius: stops the AI vibrating back and forth around a target
const AI_ARRIVAL_RADIUS = 30
// Minimum distance to the PLAYER (wider than AI_ARRIVAL_RADIUS: this one
// means "never stand INSIDE the other robot"). Exported: main.js applies
// the same limit to the player's own movement, else the constraint would
// be one-way
export const AI_MIN_PLAYER_DISTANCE = 110
// Same wheel turn speed as the player (main.js WHEEL_TURN_SPEED)
const AI_WHEEL_TURN_SPEED = 18
// "Close enough to try" ranges: initCombatMoves still rejects the attempt
// if the real contact test or cooldown says no
const AI_STEAL_ATTEMPT_RANGE = 120
const AI_BLOCK_ATTEMPT_RANGE = 150

// 1v1 possession invariant: ball.owner === X must imply that ONLY X's
// dispatch writes basketball.position this frame. Every bug found in this
// subsystem was the same violation: a transition state (pickup active,
// shooting not idle, dash) ignored by whoever changes owner. Rule: check
// the OTHER robot's transition state BEFORE acting, and re-verify
// ownership when COMPLETING an animation, never assume it from its start.
//
// Navigation: straight line to the target, no obstacle avoidance. Both
// robots stay near mid-court (ball/hoop) and the real obstacles are all
// at the edges; waypoint avoidance (thehollowzone pattern, already
// scouted) only if it ever becomes a real problem
export function initEnemyAI(ctx) {
  const {
    getEnemyManipulator, getPlayerManipulator, getBasketball, collisionWorld,
    enemyShootingState,
    targetHoopIndex = 0,
    // The hoop the PLAYER attacks (for DEFEND positioning), passed
    // explicitly rather than assumed to be "the other one"
    playerTargetHoopIndex = 0,
    triggerSteal, triggerBlock, triggerShoot, canUseSteal,
    playerShootingState,
    enemyStealState, enemyBlockState,
  } = ctx

  let aiState = EnemyState.CHASE_BALL
  let aimTimer = 0

  const scratchDir = new THREE.Vector3()
  const scratchTarget = new THREE.Vector3()
  const scratchDefendPos = new THREE.Vector3()
  // FIXED distance from the player, DERIVED from AI_MIN_PLAYER_DISTANCE:
  // a hand-picked target below the physical minimum caused a tug of war
  // every frame (AI pushes closer, physics pushes back) that prevented
  // converging on the mark position
  const DEFEND_CLEARANCE_MARGIN = 5
  const DEFEND_OFFSET_DISTANCE = AI_MIN_PLAYER_DISTANCE + DEFEND_CLEARANCE_MARGIN

  // Steer wheels+arm toward a direction (atan2 is scale-invariant, no
  // need to normalize just for the angle)
  function steerToward(dirX, dirZ, delta) {
    const enemyManipulator = getEnemyManipulator()
    const targetAngle = Math.atan2(dirX, dirZ)
    // updateLocomotionAnimation (RobotBase) does the lerp and applies it
    // to wheelsGroup. The arm follows the same yaw: unlike the player
    // (camera aim), the enemy always aims where it moves
    enemyManipulator.updateLocomotionAnimation(targetAngle, delta, AI_WHEEL_TURN_SPEED)
    enemyManipulator.controls.setAimYaw(enemyManipulator.locomotionYaw)
  }

  // Rotate wheels+arm toward targetPos WITHOUT moving. Also used alone
  // while standing still (aiming/shooting), else the arm stays frozen at
  // the last movement direction instead of tracking the hoop
  function faceToward(targetPos, delta) {
    scratchDir.subVectors(targetPos, getEnemyManipulator().root.position)
    scratchDir.y = 0
    if (scratchDir.lengthSq() < 1) return
    steerToward(scratchDir.x, scratchDir.z, delta)
  }

  // Straight-line move toward targetPos (X/Z only). Optional faceTarget
  // for DEFEND: move to the mark position while facing the player
  function moveToward(targetPos, delta, faceTarget = targetPos) {
    const enemyManipulator = getEnemyManipulator()
    scratchDir.subVectors(targetPos, enemyManipulator.root.position)
    scratchDir.y = 0
    const dist = scratchDir.length()
    if (faceTarget === targetPos) {
      if (dist >= 1) steerToward(scratchDir.x, scratchDir.z, delta)
    } else {
      faceToward(faceTarget, delta)
    }
    if (dist > 1) scratchDir.normalize()
    if (dist < AI_ARRIVAL_RADIUS) return
    enemyManipulator.move(scratchDir, delta)
    // No player-distance correction here: the YIELDING side is always the
    // player (main.js moves only manipulator.root), an enemy that stopped
    // itself kept oscillating unnaturally near the player
  }

  function update(delta) {
    const ball = getBasketball()
    if (!ball) return
    const enemyManipulator = getEnemyManipulator()
    const playerManipulator = getPlayerManipulator()

    // No movement decisions while an own STEAL/BLOCK animation is running
    if (isCombatMoveActive(enemyStealState, enemyBlockState)) return

    // FREE_SHOT has no owner (cleared at release) and would be mistaken
    // for a free ball: it is a shot to intercept, only BLOCK applies
    if (ball.state === BallState.FREE_SHOT) {
      aimTimer = 0
      if (enemyManipulator.state === RobotState.NO_BALL) {
        if (enemyManipulator.root.position.distanceTo(ball.position) <= AI_BLOCK_ATTEMPT_RANGE) triggerBlock()
        else moveToward(ball.position, delta)
      }
      return
    }

    // Recomputed every frame from real possession, never sticky
    if (ball.owner === enemyManipulator) aiState = EnemyState.ATTACK
    else if (ball.owner === playerManipulator) aiState = EnemyState.DEFEND
    else aiState = EnemyState.CHASE_BALL

    if (aiState === EnemyState.ATTACK) {
      const hoop = collisionWorld.hoops[targetHoopIndex]
      scratchTarget.set(hoop.center.x, hoop.center.y, hoop.center.z)
      if (enemyManipulator.state === RobotState.HANDLING) {
        // Keep facing the hoop for the whole aim/shot, else the arm stays
        // frozen at the last movement direction
        faceToward(scratchTarget, delta)
        aimTimer += delta
        if (enemyShootingState.phase === 'idle' && aimTimer >= AI_AIM_DURATION) triggerShoot()
      } else if (enemyManipulator.state === RobotState.DRIBBLE) {
        if (enemyManipulator.root.position.distanceTo(scratchTarget) <= AI_SHOOT_RANGE) {
          enemyManipulator.setState(RobotState.HANDLING)
          enemyShootingState.released = false
          aimTimer = 0
        } else {
          moveToward(scratchTarget, delta)
        }
      }
    } else if (aiState === EnemyState.DEFEND) {
      aimTimer = 0
      const distToPlayer = enemyManipulator.root.position.distanceTo(playerManipulator.root.position)
      // BLOCK on shootingState.phase === 'release' only: HANDLING is true
      // whenever the player merely holds right mouse to look around,
      // 'release' means a shot is actually happening
      if (enemyManipulator.state === RobotState.NO_BALL && playerShootingState.phase === 'release'
        && distToPlayer <= AI_BLOCK_ATTEMPT_RANGE) {
        triggerBlock()
      }
      // Default DEFEND movement: always between the player and HIS hoop,
      // facing the player (not a fallback for STEAL on cooldown: that
      // made the enemy chase the player head-on almost always)
      const playerHoop = collisionWorld.hoops[playerTargetHoopIndex]
      scratchTarget.set(playerHoop.center.x, playerHoop.center.y, playerHoop.center.z)
      scratchDir.subVectors(scratchTarget, playerManipulator.root.position)
      scratchDir.y = 0
      if (scratchDir.lengthSq() > 1) scratchDir.normalize()
      scratchDefendPos.copy(playerManipulator.root.position).addScaledVector(scratchDir, DEFEND_OFFSET_DISTANCE)
      moveToward(scratchDefendPos, delta, playerManipulator.root.position)
      // STEAL attempted in parallel when ready and close enough
      if (canUseSteal() && enemyManipulator.state === RobotState.NO_BALL && distToPlayer <= AI_STEAL_ATTEMPT_RANGE) {
        triggerSteal()
      }
    } else { // CHASE_BALL
      aimTimer = 0
      moveToward(ball.position, delta)
    }
  }

  // Resync locomotionYaw after external setWheelsYaw writes (MainMenu on
  // BACK TO MAIN MENU), else the next lerp visibly slides from the old value
  function resetWheelsAngle(angle) {
    getEnemyManipulator().locomotionYaw = angle
  }

  return { update, getState: () => aiState, resetWheelsAngle }
}
