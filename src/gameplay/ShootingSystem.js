import * as THREE from 'three'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { clampOrbitPitchToNormalRange, dribbleAmplitudesRad, getObjectWorldPosition, paddleWorldPos } from './BallPossession.js'
import { BALL_GRAVITY, BALL_BOUNCE_SPEED } from '../utils/constants.js'

// Shooting, hoop assist, scoring and trajectory preview — kept together
// because they share isHoopCrossing/applyHoopAssist/collisionWorld.hoops
// too tightly to split. Context-object pattern, zero imports from main.js.

const SHOT_FLOOR_BOUNCE_SPEED_FACTOR = 0.7 // missed-shot floor bounce: slightly softer than the dribble bounce
const FLOOR_HORIZONTAL_DAMPING = 0.9
const THREE_POINT_RADIUS = 677 // real rim-to-arc distance (GLTF accessors)
// Fraction of windup+release during which the ball stays RIGIDLY attached
// to the paddle; only the last (1-this) slice converges toward the frozen
// preview origin (see updateShootAnimation)
const BLEND_START_FRACTION = 0.85
const THREE_POINT_SPEED_REDUCTION = 0.6 // 60% launch speed inside the arc: close shots need less push
// Hoop-assist cone (SHOOTING stat): rim radius exactly at rim level,
// widening up to the top of the backboard
const HOOP_ASSIST_TOP_RADIUS = 90
// Correction rate (1/s). POSITION correction, not an acceleration — an
// acceleration accumulates with time spent in the cone and overshot the
// center on slow close-range shots
const HOOP_ASSIST_PULL_RATE = 4
// Fine enough not to tunnel through the thin backboard at max shot speed
const SHOT_PHYSICS_SUBSTEP_DT = 1 / 240
const SHOOT_EASE = t => t * t * (3 - 2 * t) // smoothstep
const TRAJECTORY_DT = 0.005 // as fine as the real flight — 0.02 was too coarse
const TRAJECTORY_MAX_STEPS = 2400 // ~12s at this dt
const TRAJECTORY_TUBE_RADIUS = 4
const TRAJ_COLOR_BLACK = 0x111111
const TRAJ_COLOR_BLUE = 0x1b3a6b
const TRAJ_COLOR_GREEN = 0x2e7d32
const TRAJECTORY_OPACITY = 0.5

// Shared by getEffectiveShotSpeed (power reduction) and the Point System
// (2 vs 3 points), one criterion, not two that could drift apart
export function isInsideThreePointArc(worldPosition, hoops) 
{
  let nearestDistSq = Infinity
  for (const hoop of hoops) {
    const dx = worldPosition.x - hoop.center.x
    const dz = worldPosition.z - hoop.center.z
    nearestDistSq = Math.min(nearestDistSq, dx * dx + dz * dz)
  }
  return nearestDistSq < THREE_POINT_RADIUS * THREE_POINT_RADIUS
}

// Score detection: downward crossing of the rim's horizontal plane within
// the rim radius. Interpolates the EXACT crossing point between the two
// samples,  testing only the end-of-step sample missed genuine makes,
// especially steep close-range shots
export function isHoopCrossing(previousPos, position, hoop) {
  if (previousPos.y <= hoop.center.y || position.y > hoop.center.y) return false
  const t = (previousPos.y - hoop.center.y) / (previousPos.y - position.y)
  const crossX = THREE.MathUtils.lerp(previousPos.x, position.x, t)
  const crossZ = THREE.MathUtils.lerp(previousPos.z, position.z, t)
  const dx = crossX - hoop.center.x
  const dz = crossZ - hoop.center.z
  return Math.hypot(dx, dz) <= hoop.radius
}

// Called by BOTH the real flight and the trajectory preview, so the
// preview shows exactly the curve that will actually happen
function applyHoopAssist(position, velocity, dt, strength, hoops, backboardTopY, rimRingRadius) {
  if (strength <= 0) return
  for (const hoop of hoops) {
    const heightAboveRim = position.y - hoop.center.y
    // Cone height = up to the real backboard top
    const assistHeight = backboardTopY - hoop.center.y
    if (heightAboveRim < 0 || heightAboveRim > assistHeight) continue
    const coneT = heightAboveRim / assistHeight
    const coneRadius = THREE.MathUtils.lerp(rimRingRadius, HOOP_ASSIST_TOP_RADIUS, coneT)
    const dx = hoop.center.x - position.x
    const dz = hoop.center.z - position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-6 || dist > coneRadius) continue
    // Position pull clamped at 1: can never overshoot the center
    const pull = Math.min(strength * (dist / coneRadius) * HOOP_ASSIST_PULL_RATE * dt, 1)
    position.x += dx * pull
    position.z += dz * pull
  }
}

// SHOOTING 1-3: 1 = no correction, 2/3 = progressively stronger —
// quadratic fit over the historical values: (stat-1)(stat+4)/8
export function shootingStatToAssistStrength(shootingStat) {
  return (shootingStat - 1) * (shootingStat + 4) / 8
}

export function initShootingSystem(ctx) 
{
  const {
    getManipulator, collisionWorld, sfx, scene,
    shootingState, cameraState, dribbleState, handlingState,
    computeAimPitchOffset, getShotDirection, getBallRadius,
    scoreElementId = 'score-value',
    // Function, not a fixed value: in PRACTICE either hoop scores (null =
    // no restriction); in 1V1 each robot has ITS hoop. Read fresh because
    // gameMode may not be decided yet at init time
    getTargetHoopIndex = () => null,
    // Called with THIS manipulator on every made basket — main.js uses it
    // for the 1V1 possession turnover; no-op in PRACTICE
    onScore = () => {},
  } = ctx
  // getBasketball is NOT destructured: it must be called fresh each time
  // (basketball is assigned asynchronously on GLTF load). A function, not
  // a getter, because ctx comes from a spread — a getter would be
  // evaluated at spread time, freezing null forever.
  // getShotDirection/computeAimPitchOffset come from outside: crosshair/
  // camera for the player, AI aim for the enemy — this module doesn't care

  const shotFloorBounceSpeed = BALL_BOUNCE_SPEED * SHOT_FLOOR_BOUNCE_SPEED_FACTOR

  // The 3-point arc must be judged against the TARGET hoop, not the
  // geometrically nearest one: near mid-court the nearest hoop could be
  // the WRONG one, halving the launch speed (and scoring 2 instead of 3)
  // on a genuine long shot at one's own basket. null (PRACTICE) = both
  function hoopsForArcCheck() {
    const targetHoopIndex = getTargetHoopIndex()
    return targetHoopIndex == null ? collisionWorld.hoops : [collisionWorld.hoops[targetHoopIndex]]
  }

  function getEffectiveShotSpeed(worldPosition) {
    // shootTuning is per-instance (RobotBase); resolveShootTuning swaps in
    // elevatedShootTuning while the Drone is airborne
    const { shotSpeed } = resolveShootTuning(getManipulator())
    return isInsideThreePointArc(worldPosition, hoopsForArcCheck()) ? shotSpeed * THREE_POINT_SPEED_REDUCTION : shotSpeed
  }

  // Point System: 2 points from inside the arc, 3 from outside —
  // wasInsideArc captured at RELEASE, not where the ball lands
  let score = 0
  // 'score-value' (player) or 'enemy-score-value': two separate counters
  const scoreValueEl = document.getElementById(scoreElementId)
  function addScore(points) {
    score += points
    scoreValueEl.textContent = String(score)
  }
  // Resets score and DOM together (used by BACK TO MAIN MENU)
  function resetScore() {
    score = 0
    scoreValueEl.textContent = String(score)
  }

  // No temporary array: runs at 240Hz for the whole flight
  function checkHoopScore(previousPos, position) {
    const targetHoopIndex = getTargetHoopIndex()
    if (targetHoopIndex == null) {
      for (const hoop of collisionWorld.hoops) checkSingleHoopScore(previousPos, position, hoop)
    } else {
      checkSingleHoopScore(previousPos, position, collisionWorld.hoops[targetHoopIndex])
    }
  }

  function checkSingleHoopScore(previousPos, position, hoop) {
    if (isHoopCrossing(previousPos, position, hoop)) {
      console.log('[Score] basket made')
      addScore(shootingState.wasInsideArc ? 2 : 3)
      sfx.playScore()
      onScore(getManipulator())
    }
  }

  // Per-object post-hit cooldowns — see CollisionWorld.js for the why
  const shotCollisionCooldowns = new Map()
  function clearAllCollisionCooldowns() {
    shotCollisionCooldowns.clear()
  }

  // Start the shot windup — shared by player mousedown and EnemyAI.
  // Preconditions stay with the callers (genuinely different conditions)
  function triggerShoot() {
    const manipulator = getManipulator()
    const [elbowAmp, link1Amp] = dribbleAmplitudesRad(manipulator.dribbleTuning)
    shootingState.startElbowOffset = dribbleState.armEase * elbowAmp
    shootingState.startLink1Offset = dribbleState.armEase * link1Amp
    shootingState.startGrip = handlingState.grip
    shootingState.startTilt = handlingState.tiltOffset
    shootingState.phase = 'windup'
    shootingState.phaseT = 0
    shootingState.timeSinceTrigger = 0
    shootingState.released = false
    shootingState.hasBounced = false
    clearAllCollisionCooldowns()
    // Freeze the EXACT point the preview was drawing from at click time:
    // windup/release drag the ball with the arm, so without this the real
    // flight started from where the paddle ended up AFTER the windup —
    // "green" preview but the shot missed
    const ball = ctx.getBasketball()
    if (ball) shootingState.releaseOrigin.copy(ball.position)
  }

  const shotVelocity = new THREE.Vector3()
  const scratchPreviousShotPos = new THREE.Vector3()
  function stepShotFlight(dt) {
    const ball = ctx.getBasketball()
    const ballRadius = getBallRadius()
    // Full vector, not just Y: isHoopCrossing needs previous X/Z too
    scratchPreviousShotPos.copy(ball.position)
    shotVelocity.y -= BALL_GRAVITY * dt
    ball.position.addScaledVector(shotVelocity, dt)
    applyHoopAssist(
      ball.position, shotVelocity, dt,
      shootingStatToAssistStrength(getManipulator().stats.shooting),
      collisionWorld.hoops, collisionWorld.BACKBOARD_TOP_Y, ctx.rimRingRadius,
    )

    // Score is judged on the PURE ballistic path, before any collision
    // deflection in this same step — same order the preview uses
    checkHoopScore(scratchPreviousShotPos, ball.position)
    const hitVisible = collisionWorld.resolve(ball.position, shotVelocity, dt, shotCollisionCooldowns, ballRadius)
    if (hitVisible) sfx.playBounce()

    let hitFloor = false
    if (ball.position.y <= ballRadius) {
      ball.position.y = ballRadius
      sfx.playBounce()
      shotVelocity.y = shotFloorBounceSpeed
      // Without X/Z damping the ball would slide horizontally forever
      shotVelocity.x *= FLOOR_HORIZONTAL_DAMPING
      shotVelocity.z *= FLOOR_HORIZONTAL_DAMPING
      hitFloor = true
    }

    // FIRST FLOOR touch only (rim/backboard hits don't count): until then
    // the shot stays FREE_SHOT — blockable, not pickable
    if (!shootingState.hasBounced && hitFloor) {
      shootingState.hasBounced = true
      ball.setState(BallState.FREE)
    }
  }
  function updateShotFlight(delta) {
    let remaining = delta
    while (remaining > 0) {
      stepShotFlight(Math.min(SHOT_PHYSICS_SUBSTEP_DT, remaining))
      remaining -= SHOT_PHYSICS_SUBSTEP_DT
    }
  }

  // Shot animation: elbow tracks camera pitch every frame; 'windup' pulls
  // elbow/link1 back, 'release' snaps them forward (elbow starts late and
  // covers its full range in less time — the whip effect), 'recover'
  // returns to neutral. elevatedShootTuning replaces shootTuning while
  // the Drone is airborne (the grounded pose would clip the body)
  function resolveShootTuning(manipulator) {
    return (manipulator.isElevated && manipulator.elevatedShootTuning) || manipulator.shootTuning
  }

  function updateShootAnimation(delta) 
  {
    const manipulator = getManipulator()
    const shootTuning = resolveShootTuning(manipulator)
    shootingState.phaseT += delta
    shootingState.timeSinceTrigger += delta
    const elbowWindupTarget = THREE.MathUtils.degToRad(shootTuning.elbowWindupDeg)
    const link1WindupTarget = THREE.MathUtils.degToRad(shootTuning.link1WindupDeg)
    const aimPitchOffset = computeAimPitchOffset()

    // Countdown ALWAYS active, not only inside the 'release' branch: the
    // phase can move on to 'recover' with the timer still mid-way — if it
    // lived only in that branch, NO_BALL would never fire
    if (shootingState.released && shootingState.stateTransitionTimer > 0) {
      shootingState.stateTransitionTimer -= delta
      if (shootingState.stateTransitionTimer <= 0) {
        manipulator.setState(RobotState.NO_BALL)
        // Ball lifecycle is untouched here (already FREE_SHOT at physical
        // release); this timer only concerns robot state + camera
        clampOrbitPitchToNormalRange(cameraState)
      }
    }

    if (shootingState.phase === 'windup') {
      const t = SHOOT_EASE(Math.min(shootingState.phaseT / shootTuning.windupDuration, 1))
      const elbowOffset = THREE.MathUtils.lerp(shootingState.startElbowOffset, elbowWindupTarget, t)
      const link1Offset = THREE.MathUtils.lerp(shootingState.startLink1Offset, link1WindupTarget, t)
      manipulator.controls.setAimPitch(aimPitchOffset)
      manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
      // Three tilt phases, not two: flat → up past level (windup peak),
      // then 'release' brings it forward to the release pose
      manipulator.controls.setShootTilt(THREE.MathUtils.lerp(shootingState.startTilt, shootTuning.tiltWindupPeak, t))
      if (shootingState.phaseT >= shootTuning.windupDuration) { shootingState.phase = 'release'; shootingState.phaseT = 0 }
    } else if (shootingState.phase === 'release') {
      const t = Math.min(shootingState.phaseT / shootTuning.releaseDuration, 1)
      const easeT = SHOOT_EASE(t)
      const link1Offset = THREE.MathUtils.lerp(link1WindupTarget, THREE.MathUtils.degToRad(shootTuning.link1ReleaseDeg), easeT)
      // Elbow starts late, covers its full range in the remaining time —
      // higher angular speed, the whip effect
      const elbowT = SHOOT_EASE(THREE.MathUtils.clamp((t - shootTuning.releaseLead) / (1 - shootTuning.releaseLead), 0, 1))
      const elbowOffset = THREE.MathUtils.lerp(elbowWindupTarget, THREE.MathUtils.degToRad(shootTuning.elbowReleaseDeg), elbowT)
      manipulator.controls.setAimPitch(aimPitchOffset)
      manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
      // From the windup peak toward the release pose, in sync with link1
      manipulator.controls.setShootTilt(THREE.MathUtils.lerp(shootTuning.tiltWindupPeak, shootTuning.tiltTarget, easeT))

      if (!shootingState.released && t >= shootTuning.releasePoint) {
        getShotDirection(shotVelocity).multiplyScalar(getEffectiveShotSpeed(manipulator.root.position))
        shootingState.wasInsideArc = isInsideThreePointArc(manipulator.root.position, hoopsForArcCheck())
        shootingState.released = true
        // FREE_SHOT, not FREE: in flight only BLOCK can intercept it;
        // pickup stays blind until the first floor touch
        ctx.getBasketball().setState(BallState.FREE_SHOT)
        // Nobody owns it in flight (ball.team is preserved by setOwner(null))
        ctx.getBasketball().setOwner(null)
        sfx.playShoot()
        // NOT setState(NO_BALL) here: that would detach the free HANDLING
        // camera the same instant the ball leaves the hand, making the
        // crosshair jump — the real state change fires after the delay
        shootingState.stateTransitionTimer = shootTuning.stateTransitionDelay
      }
      if (shootingState.phaseT >= shootTuning.releaseDuration) {
        shootingState.phase = 'recover'
        shootingState.phaseT = 0
        shootingState.recoverStartAimPitch = aimPitchOffset
      }
    } else { // 'recover'
      const t = SHOOT_EASE(Math.min(shootingState.phaseT / shootTuning.recoverDuration, 1))
      const elbowOffset = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(shootTuning.elbowReleaseDeg), 0, t)
      const link1Offset = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(shootTuning.link1ReleaseDeg), 0, t)
      const recoverAimPitch = THREE.MathUtils.lerp(shootingState.recoverStartAimPitch, 0, t)
      const tiltOffset = THREE.MathUtils.lerp(shootTuning.tiltTarget, 0, t)
      const gripOffset = THREE.MathUtils.lerp(shootingState.startGrip, 0, t)
      manipulator.controls.setAimPitch(recoverAimPitch)
      manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
      manipulator.controls.setShootTilt(tiltOffset)
      manipulator.controls.setGrip(gripOffset)
      handlingState.grip = gripOffset

      if (shootingState.phaseT >= shootTuning.recoverDuration) {
        shootingState.phase = 'idle'
        // Reset armEase only NOW that the visual pose is already at 0 —
        // no snap, armEase=0 reproduces the exact pose just reached
        dribbleState.armEase = 0
      }
    }

    // Until physical release the ball stays on the paddle — rigidly for
    // most of the animation, converging toward the frozen releaseOrigin
    // only in the last slice (past BLEND_START_FRACTION) so the real
    // flight starts exactly where the preview drew it. An early version
    // blended linearly over ~90% of the animation and the ball visibly
    // detached from the paddle for most of the motion
    if (!shootingState.released) {
      getObjectWorldPosition(manipulator.ballRestPoint, paddleWorldPos)
      const timeToRelease = shootTuning.windupDuration + shootTuning.releasePoint * shootTuning.releaseDuration
      const linearT = timeToRelease > 0 ? Math.min(shootingState.timeSinceTrigger / timeToRelease, 1) : 1
      const originBlend = Math.min(Math.max((linearT - BLEND_START_FRACTION) / (1 - BLEND_START_FRACTION), 0), 1)
      ctx.getBasketball().position.lerpVectors(paddleWorldPos, shootingState.releaseOrigin, originBlend)
    }
  }

  // --- Trajectory preview (only while aiming in HANDLING) ---
  const trajectoryBlackMaterial = new THREE.MeshBasicMaterial({ color: TRAJ_COLOR_BLACK, transparent: true, opacity: TRAJECTORY_OPACITY })
  const trajectoryColoredMaterial = new THREE.MeshBasicMaterial({ color: TRAJ_COLOR_BLUE, transparent: true, opacity: TRAJECTORY_OPACITY })
  let trajectoryBlackMesh = null
  let trajectoryColoredMesh = null

  // Rebuild (dispose + new, TubeGeometry can't update in place) the tube
  // mesh for a point run — null if fewer than 2 points
  function rebuildTrajectoryTube(existingMesh, points, material) {
    if (existingMesh) {
      scene.remove(existingMesh)
      existingMesh.geometry.dispose()
    }
    if (points.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(points)
    const tubularSegments = Math.min(points.length * 3, 150)
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, TRAJECTORY_TUBE_RADIUS, 6, false)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    scene.add(mesh)
    return mesh
  }

  // Remove both tube meshes (outside HANDLING, or once the shot is away)
  function hideTrajectoryPreview() {
    if (trajectoryBlackMesh) { scene.remove(trajectoryBlackMesh); trajectoryBlackMesh.geometry.dispose(); trajectoryBlackMesh = null }
    if (trajectoryColoredMesh) { scene.remove(trajectoryColoredMesh); trajectoryColoredMesh.geometry.dispose(); trajectoryColoredMesh = null }
  }

  const trajPos = new THREE.Vector3()
  const trajVel = new THREE.Vector3()
  const trajBlackPoints = []
  const trajColoredPoints = []
  // Diagnostics for the debug panel (key P)
  const trajDebug = { count: 0, stopReason: '—' }
  // Reused scratch (runs every frame while aiming, up to MAX_STEPS each):
  // cooldown Map cleared, not recreated — SEPARATE from the real flight's
  const previewScratchPreviousPos = new THREE.Vector3()
  const previewCollisionCooldowns = new Map()

  function updateTrajectoryPreview() {
    const manipulator = getManipulator()
    // Uses the CURRENT aim pose — simulating the exact release pose was
    // tried and discarded (unnatural origin at low/side aim)
    trajPos.copy(ctx.getBasketball().position)
    getShotDirection(trajVel).multiplyScalar(getEffectiveShotSpeed(manipulator.root.position))

    trajBlackPoints.length = 0
    trajColoredPoints.length = 0
    let coloredMaterialColor = TRAJ_COLOR_BLUE
    let collided = false
    // Full vector: isHoopCrossing interpolates the exact crossing point
    const previousTrajPos = previewScratchPreviousPos.copy(trajPos)
    trajBlackPoints.push(trajPos.clone())

    const hoopAssistStrength = shootingStatToAssistStrength(manipulator.stats.shooting)
    const ballRadius = getBallRadius()
    // Separate cooldown map: the hypothetical preview must not consume
    // the real objects' cooldowns while merely aiming
    previewCollisionCooldowns.clear()
    for (let i = 0; i < TRAJECTORY_MAX_STEPS; i++) {
      trajVel.y -= BALL_GRAVITY * TRAJECTORY_DT
      trajPos.addScaledVector(trajVel, TRAJECTORY_DT)
      applyHoopAssist(trajPos, trajVel, TRAJECTORY_DT, hoopAssistStrength, collisionWorld.hoops, collisionWorld.BACKBOARD_TOP_Y, ctx.rimRingRadius)

      // Score checked ALWAYS, even after a rim/backboard touch (a shot
      // can graze the rim and still go in)
      let hitScore = false
      for (const hoop of collisionWorld.hoops) {
        if (isHoopCrossing(previousTrajPos, trajPos, hoop)) hitScore = true
      }
      // Collidables only decide where the black run ends
      const hitVisible = !collided && collisionWorld.resolve(trajPos, trajVel, TRAJECTORY_DT, previewCollisionCooldowns, ballRadius)
      // Floor: hard stop here (the real flight bounces instead)
      let hitFloor = false
      if (!hitScore && !hitVisible && trajPos.y <= ballRadius) {
        trajPos.y = ballRadius
        trajVel.set(0, 0, 0)
        hitFloor = true
      }
      previousTrajPos.copy(trajPos)

      if (hitScore) {
        // Green always wins: a make recolors the run even after a rim touch
        coloredMaterialColor = TRAJ_COLOR_GREEN
        if (!collided) { trajBlackPoints.push(trajPos.clone()); collided = true }
        trajColoredPoints.push(trajPos.clone())
      } else if (hitVisible) {
        coloredMaterialColor = TRAJ_COLOR_BLUE
        trajBlackPoints.push(trajPos.clone())
        collided = true
        trajColoredPoints.push(trajPos.clone())
      } else if (!collided) {
        trajBlackPoints.push(trajPos.clone())
      } else {
        trajColoredPoints.push(trajPos.clone())
      }

      if (hitFloor) { trajDebug.stopReason = 'pavimento'; break }
      if (i === TRAJECTORY_MAX_STEPS - 1) trajDebug.stopReason = 'budget esaurito (mai toccato nulla)'
    }
    trajDebug.count = trajBlackPoints.length + trajColoredPoints.length

    trajectoryColoredMaterial.color.set(coloredMaterialColor)
    trajectoryBlackMesh = rebuildTrajectoryTube(trajectoryBlackMesh, trajBlackPoints, trajectoryBlackMaterial)
    trajectoryColoredMesh = rebuildTrajectoryTube(trajectoryColoredMesh, trajColoredPoints, trajectoryColoredMaterial)
  }

  return {
    getShotDirection, getEffectiveShotSpeed, isInsideThreePointArc: pos => isInsideThreePointArc(pos, hoopsForArcCheck()),
    addScore, resetScore, checkHoopScore, clearAllCollisionCooldowns, triggerShoot,
    updateShotFlight, updateShootAnimation, updateTrajectoryPreview, hideTrajectoryPreview,
    shotVelocity, trajDebug,
    // Read by main.js after each onScore for the 1V1 win check —
    // a function so it's always current, never a frozen snapshot
    getScore: () => score,
  }
}
