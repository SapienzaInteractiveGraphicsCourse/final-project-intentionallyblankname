import * as THREE from 'three'
import { createProceduralPBRMaps, drawBrushedMetal, drawOrganicGrain, createArmAccentMaterials } from './AMRManipulatorModelMaker.js'
import { replaceGeometry, makeScaleSetter, makeLinkGeometry, makeTaperedLinkGeometry, createLinkControls, createColorControls } from './geometryControlHelpers.js'

// LEGGED MANIPULATOR: same disc + same 3R arm as AMR (identical code), scaled
// 25% bigger overall. Wheels replaced by 4 legs, each a 2-joint (hip+knee,
// both pitch) leg ending in a foot — no ankle/wrist joint needed, nothing to
// grip. Leg links are 35% of the arm's link lengths (fixed ratio, tuned once).
//
// wheelsGroup/setWheelsYaw: kept as the shared contract name (RobotBase/
// EnemyAI/CombatMoves all orient locomotion via this key) even though it
// points at legsGroup here, not real wheels. No real step cycle yet, the
// whole leg group pivots rigidly toward the movement direction.


export function LeggedManipulatorModelMaker() 
{
  /*
  Returns a 3D model of a legged manipulator robot, including its geometry, materials, 
  and controls for manipulating its parts. The model consists of a disc-shaped chassis, a 3R arm,
   and four legs with hip and knee joints. The function also provides methods to adjust the robot's configuration, 
   such as scaling, joint angles, and paddle tilt.

  The returned object contains:
  - root: The root THREE.Group containing the entire robot model.
  - wheelsGroup: A reference to the legs group (used for locomotion orientation).
  - joints: An object containing references to the base, elbow, and wrist joints of the arm.
  - paddle: A reference to the paddle center object.
  - ballRestPoint: A reference to the ball rest point object.
  - controls: An object containing methods to manipulate the robot's configuration.
  - getConfig: A method to retrieve the current configuration state of the robot.
  - getPaddleTilt: A method to retrieve the current paddle tilt value.
  */
  const root = new THREE.Group()

  // Same material family as AMR + a dedicated rubber-ish material for feet
  const bodyMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 350), baseRoughness: 0.5, roughnessVariation: 0.12 })
  const legMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 550), baseRoughness: 0.4, roughnessVariation: 0.1 })
  const footMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawOrganicGrain(ctx, s, 900, 2.5), baseRoughness: 0.85, roughnessVariation: 0.15 })

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.4, normalMap: bodyMaps.normalMap, roughnessMap: bodyMaps.roughnessMap })
  const legMat = new THREE.MeshStandardMaterial({ color: 0x515a63, roughness: 0.4, metalness: 0.5, normalMap: legMaps.normalMap, roughnessMap: legMaps.roughnessMap })
  const footMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85, metalness: 0.1, normalMap: footMaps.normalMap, roughnessMap: footMaps.roughnessMap })
  const { armMat, accentMat } = createArmAccentMaterials()

  // Same fields/defaults as AMR for disc+arm, manipulatorScale 25% bigger (45*1.25), plus leg fields
  const state = {
    manipulatorScale: 56.25, // 45 * 1.25
    legsScale: 1,
    discScale: 0.9,
    discRadius: 1,
    link1Scale: 1,
    link1Length: 1.8,
    link1Thickness: 0.18,
    link2Scale: 1,
    link2Length: 1.5,
    link2Thickness: 0.17,
    link2TipThickness: 0.05,
    baseJointScale: 1,
    elbowJointScale: 0.75,
    endEffectorScale: 0.25,
    paddleAngle: 2.4,
    paddleTilt: 1.2,
  }
  const INITIAL_DISC_RADIUS = state.discRadius

  // --- Legs: 4 hip+knee arms replacing the wheels ---
  // Hip joint radius must fit inside the disc (diagonal offset + joint radius < discRadius)
  const LEG_OFFSET_X = 0.55
  const LEG_OFFSET_Z = 0.55
  const legLink1Length = state.link1Length * 0.35 // thigh
  const legLink2Length = state.link2Length * 0.35 // shin
  const legLink1Thickness = 0.16
  const legLink2Thickness = 0.14
  const legJointRadius = 0.16


  // Hip points straight down (180°), knee folds it back inward (+30°) reads as a leg, not a straight rod

  const HIP_REST_PITCH = THREE.MathUtils.degToRad(180)
  const KNEE_REST_PITCH = THREE.MathUtils.degToRad(30)

  // Hip swing amplitude during trot (setLegWalkCycle below) — first-pass value, not yet visually tuned
  const WALK_SWING_AMPLITUDE = 0.3

  // Stand height (world, pre-manipulatorScale): derived from real leg geometry at rest pose, not a fixed guess
  function computeStandHeight() 
  {
    return legLink1Length * -Math.cos(HIP_REST_PITCH)
      + legLink2Length * -Math.cos(HIP_REST_PITCH + KNEE_REST_PITCH)
  }
  const standHeight = computeStandHeight() // world Y of the top of the hip joint, pre-manipulatorScale

  const legsGroup = new THREE.Group()
  const feet = []
 
  
  // Four legs, each with a hip and knee joint, positioned at the corners of the disc
  const legs = []
  const legOffsets = [
    [-LEG_OFFSET_X, -LEG_OFFSET_Z],
    [LEG_OFFSET_X, -LEG_OFFSET_Z],
    [-LEG_OFFSET_X, LEG_OFFSET_Z],
    [LEG_OFFSET_X, LEG_OFFSET_Z],
  ]

  // Build each leg with hip and knee joints, and add them to the legs group
  for (let legIndex = 0; legIndex < legOffsets.length; legIndex++) 
  {
    const [x, z] = legOffsets[legIndex]
    const outwardYaw = Math.atan2(x, z) // Angle to face outward from the center of the disc
    const hipYaw = new THREE.Group()
    hipYaw.position.set(x, standHeight, z)
    hipYaw.rotation.y = outwardYaw
    legsGroup.add(hipYaw)

    // Hip joint, pitch
    const hip = new THREE.Group()
    hip.rotation.x = HIP_REST_PITCH
    hipYaw.add(hip)
    const hipJoint = new THREE.Mesh(new THREE.SphereGeometry(legJointRadius, 14, 14), legMat)
    hip.add(hipJoint)
    const thigh = new THREE.Mesh(makeLinkGeometry(legLink1Length, legLink1Thickness), legMat)
    hip.add(thigh)

    // Knee joint, pitch (adds onto hip's, same axis — same idea as elbow/wrist on the 3R arm)
    const knee = new THREE.Group()
    knee.position.y = legLink1Length
    knee.rotation.x = KNEE_REST_PITCH
    hip.add(knee)
    const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(legJointRadius * 0.85, 14, 14), legMat)
    knee.add(kneeJoint)
    const shin = new THREE.Mesh(makeLinkGeometry(legLink2Length, legLink2Thickness), legMat)
    knee.add(shin)

    // Foot: flat box, ankle pivot on the back edge instead of centered — like a real ankle/sole
    const footLength = 0.55
    const footWidth = 0.32
    const footThickness = 0.04
    const footGeo = new THREE.BoxGeometry(footWidth, footThickness, footLength)
    footGeo.translate(0, 0, footLength / 2)
    const ankle = new THREE.Group()
    ankle.position.y = legLink2Length // position at the end of the shin

    // Counter-rotate to level the foot against the accumulated hip+knee pitch (same idea as levelPaddle())
    ankle.rotation.x = -(HIP_REST_PITCH + KNEE_REST_PITCH)
    knee.add(ankle)
    const foot = new THREE.Mesh(footGeo, footMat)
    ankle.add(foot)
    feet.push(foot)
    legs.push({ hip, knee })
  }
  root.add(legsGroup)

  // Chassis like AMR 
  const discHeight = 0.1875
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(state.discRadius, state.discRadius, discHeight, 32),
    bodyMat
  )
  root.add(disc)

  // 
  const jointRadius = 0.22

  const base = new THREE.Group()
  root.add(base)

  const baseJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 16, 16), armMat)
  base.add(baseJoint)

  const link1Group = new THREE.Group()
  base.add(link1Group)

  const link1 = new THREE.Mesh(makeLinkGeometry(state.link1Length, state.link1Thickness), armMat)
  link1Group.add(link1)

  const ELBOW_REST_PITCH = Math.PI / 2.4
  const elbow = new THREE.Group()
  elbow.position.y = state.link1Length
  elbow.rotation.x = ELBOW_REST_PITCH
  link1Group.add(elbow)

  const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius * 0.85, 16, 16), armMat)
  elbow.add(elbowJoint)

  const link2 = new THREE.Mesh(
    makeTaperedLinkGeometry(state.link2Length, state.link2Thickness, state.link2TipThickness),
    armMat
  )
  elbow.add(link2)

  const WRIST_REST_PITCH = -Math.PI / 6
  const wrist = new THREE.Group()
  wrist.position.y = state.link2Length
  wrist.rotation.x = WRIST_REST_PITCH
  elbow.add(wrist)

  const endEffector = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), accentMat)
  wrist.add(endEffector)

  const paddleWidth = 0.35
  const paddleGeo = new THREE.BoxGeometry(0.5, 0.05, paddleWidth)
  paddleGeo.translate(0, 0, paddleWidth / 2)

  const paddleGroup = new THREE.Group()
  wrist.add(paddleGroup)
  const paddleLeft = new THREE.Mesh(paddleGeo, accentMat)
  const paddleRight = new THREE.Mesh(paddleGeo, accentMat)
  paddleGroup.add(paddleLeft, paddleRight)

  const paddleCenter = new THREE.Object3D()
  paddleGroup.add(paddleCenter)
  const ballRestPoint = new THREE.Object3D()
  paddleGroup.add(ballRestPoint)

  let gripOffset = 0
  function effectivePaddleAngle() 
  {
    return Math.max(state.paddleAngle - gripOffset, 0)
  }
  let shootTiltOffset = 0
  let ballRestExtraOffset = 0
  function updatePaddleCenter() {
    const halfAngle = effectivePaddleAngle() / 2
    const d = paddleWidth / 2
    paddleCenter.position.set(0, 0, d * Math.cos(halfAngle))
    ballRestPoint.position.set(0, 0, d / Math.cos(halfAngle) + ballRestExtraOffset)
  }
  updatePaddleCenter()

  function levelPaddle() {
    paddleGroup.rotation.x = -(link1Group.rotation.x + elbow.rotation.x + WRIST_REST_PITCH) + state.paddleTilt + shootTiltOffset
  }
  function applyPaddleAngle() {
    const angle = effectivePaddleAngle()
    paddleLeft.rotation.x = angle / 2
    paddleRight.rotation.x = -angle / 2
    updatePaddleCenter()
  }

  let aimPitchOffset = 0
  let dribbleElbowOffset = 0
  function applyArmPitch() {
    elbow.rotation.x = ELBOW_REST_PITCH + aimPitchOffset + dribbleElbowOffset
    levelPaddle()
  }

  levelPaddle()
  applyPaddleAngle()

  // Apply the legs group scale based on the state and disc radius
  function applyLegsGroupScale() {
    legsGroup.scale.setScalar(state.legsScale * (state.discRadius / INITIAL_DISC_RADIUS))
  }
  function syncChassisHeight() {
    const legTopWorld = standHeight * legsGroup.scale.y
    const embed = discHeight * 0.35
    const discY = legTopWorld + discHeight / 2 - embed
    disc.position.y = discY
    base.position.y = discY + discHeight / 2
  }
  applyLegsGroupScale()
  syncChassisHeight()

  const controls = {
    manipulatorScale: makeScaleSetter(state, 'manipulatorScale', root),
    legsScale(s) {
      state.legsScale = s
      applyLegsGroupScale()
      syncChassisHeight()
    },
    discScale: makeScaleSetter(state, 'discScale', disc),
    discRadius(r) {
      state.discRadius = r
      replaceGeometry(disc, new THREE.CylinderGeometry(r, r, discHeight, 32))
      applyLegsGroupScale()
      syncChassisHeight()
    },
    link1: createLinkControls(state, {
      statePrefix: 'link1', mesh: link1, downstreamJoint: elbow,
      buildGeometry: makeLinkGeometry, thicknessNames: ['Thickness'],
    }),
    link2: createLinkControls(state, {
      statePrefix: 'link2', mesh: link2, downstreamJoint: wrist,
      buildGeometry: makeTaperedLinkGeometry, thicknessNames: ['Thickness', 'TipThickness'],
    }),
    baseJointScale: makeScaleSetter(state, 'baseJointScale', baseJoint),
    elbowJointScale: makeScaleSetter(state, 'elbowJointScale', elbowJoint),
    endEffectorScale: makeScaleSetter(state, 'endEffectorScale', endEffector),

    setAimYaw(angle) {
      base.rotation.y = angle
    },
    setAimPitch(pitchOffset) {
      aimPitchOffset = pitchOffset
      applyArmPitch()
    },
    setDribbleOffsets(elbowOffset, link1Offset) {
      dribbleElbowOffset = elbowOffset
      link1Group.rotation.x = link1Offset
      applyArmPitch()
    },
    setGrip(offset) {
      gripOffset = offset
      applyPaddleAngle()
    },
    setShootTilt(offset) {
      shootTiltOffset = offset
      levelPaddle()
    },
    setBallRestOffset(extra) {
      ballRestExtraOffset = extra
      updatePaddleCenter()
    },
    paddleAngle(a) {
      state.paddleAngle = a
      applyPaddleAngle()
      updatePaddleCenter()
    },
    paddleTilt(angle) {
      state.paddleTilt = angle
      levelPaddle()
    },
    // wheelsGroup is legsGroup here
    setWheelsYaw(angle) {
      legsGroup.rotation.y = angle
    },
    // Jump: one offset applied to hip+knee of all 4 legs together — negative to crouch, positive to extend.
    // Pose only, not tracked in state/Copy Config.
    setLegBend(offset) {
      for (let i = 0; i < legs.length; i++) {
        const { hip, knee } = legs[i]
        hip.rotation.x = HIP_REST_PITCH + offset
        knee.rotation.x = KNEE_REST_PITCH + offset
      }
    },
    // Trot gait: legs are at the same 4 offsets as AMR's wheels, so diagonal pairs are indices (0,3) and (1,2).
    // The two pairs swing in opposition (sin/-sin) like a real 4-leg trot. Not real IK, just enough to read as steps.
    setLegWalkCycle(phase) {
      for (let i = 0; i < legs.length; i++) {
        const { hip, knee } = legs[i]
        const pairSign = (i === 0 || i === 3) ? 1 : -1
        const swing = Math.sin(phase) * pairSign * WALK_SWING_AMPLITUDE
        hip.rotation.x = HIP_REST_PITCH + swing
        knee.rotation.x = KNEE_REST_PITCH - swing * 0.6
      }
    },
    ...createColorControls({ body: bodyMat, arm: armMat, accent: accentMat }),
  }

  controls.discScale(state.discScale)
  controls.link1.scale(state.link1Scale)
  controls.link2.scale(state.link2Scale)
  controls.baseJointScale(state.baseJointScale)
  controls.elbowJointScale(state.elbowJointScale)
  controls.endEffectorScale(state.endEffectorScale)

  function getConfig() {
    return { ...state }
  }
  function getPaddleTilt() {
    return state.paddleTilt
  }

  return {
    root,
    // Same key as AMR's wheelsGroup, points at the legs instead
    wheelsGroup: legsGroup,
    joints: { base, elbow, wrist },
    paddle: paddleCenter,
    ballRestPoint,
    controls,
    getConfig,
    getPaddleTilt,
  }
}
