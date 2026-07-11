import * as THREE from 'three'
import { createProceduralPBRMaps, drawBrushedMetal, drawOrganicGrain, createArmAccentMaterials } from './AMRManipulatorModelMaker.js'
import { makeScaleSetter, makeLinkGeometry, makeTaperedLinkGeometry, createLinkControls, createColorControls } from './geometryControlHelpers.js'

// DRONE: flight locomotion (4 rotors), same 3R arm as AMR but FLIPPED —
// hangs below the body instead of sitting above a disc, so it can dribble/
// shoot while hovering over the ball. 
//
// Flip: `armFlip` is one group with a fixed rotation.z = π, inserted between
// `base` (yaw, never flipped) and `link1Group` (identical code to AMR). Flips
// the whole sub-hierarchy at one point instead of re-deriving every rest
// angle's sign by hand — yaw stays a normal world-up rotation, everything
// under armFlip inherits the inversion as a block.
//
// wheelsGroup (same contract as Legged): points at the body here. Yaw =
// flight heading. Drone overrides updateLocomotionAnimation to keep the
// rotors spinning every frame and bank/tilt in turns/movement.


export function DroneModelMaker() {
  const root = new THREE.Group()

  const bodyMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 350), baseRoughness: 0.35, roughnessVariation: 0.1 })

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.35, metalness: 0.6, normalMap: bodyMaps.normalMap, roughnessMap: bodyMaps.roughnessMap })
  const { armMat, accentMat } = createArmAccentMaterials()
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x3fa9ff, emissive: 0x3fa9ff, emissiveIntensity: 1.4, roughness: 0.4 })

  const state = {
    manipulatorScale: 45,
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

  // --- Body: hull + nose light ---
  const bodyGroup = new THREE.Group()
  root.add(bodyGroup)

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 1.1), bodyMat)
  bodyGroup.add(hull)
  const noseLight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), glowMat)
  noseLight.position.set(0.92, 0, 0)
  bodyGroup.add(noseLight)

  // --- 4 rotor arms: thin pipe + pivot with prop guard ring + X-blades + hub ---
  const ARM_OFFSET_X = 1.1
  const ARM_OFFSET_Z = 1.1
  const PIVOT_Y = -0.1 // below body level, anchors the rotor to the arm instead of floating at hull height
  const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8)
  const armUpAxis = new THREE.Vector3(0, 1, 0)
  const rotorPivots = []
  ;[
    [-ARM_OFFSET_X, -ARM_OFFSET_Z],
    [ARM_OFFSET_X, -ARM_OFFSET_Z],
    [-ARM_OFFSET_X, ARM_OFFSET_Z],
    [ARM_OFFSET_X, ARM_OFFSET_Z],
  ].forEach(([x, z]) => {
    // Arm: cylinder from center to pivot, oriented via quaternion (needed since pivot isn't level with center)

    const armVector = new THREE.Vector3(x, PIVOT_Y, z)
    const armLength = armVector.length()
    const arm = new THREE.Mesh(armGeo, armMat)
    arm.scale.y = armLength
    arm.position.copy(armVector).multiplyScalar(0.5)
    arm.quaternion.setFromUnitVectors(armUpAxis, armVector.clone().normalize())
    bodyGroup.add(arm)

    const pivot = new THREE.Group()
    pivot.position.set(x, PIVOT_Y, z)
    bodyGroup.add(pivot)
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.1, 12, 28), armMat)
    guard.rotation.x = Math.PI / 2
    pivot.add(guard)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), armMat)
    pivot.add(hub)
    // X-blades: two crossed thin boxes, actually spun by Drone (not just the guard ring)
    const bladeGeo = new THREE.BoxGeometry(1.3, 0.03, 0.07)
    const bladeA = new THREE.Mesh(bladeGeo, accentMat)
    bladeA.position.y = 0.09
    pivot.add(bladeA)
    const bladeB = new THREE.Mesh(bladeGeo, accentMat)
    bladeB.position.y = 0.09
    bladeB.rotation.y = Math.PI / 2
    pivot.add(bladeB)
    rotorPivots.push(pivot)
  })

  // GROUND_CLEARANCE_REF is just a numeric reference for the hover calc below.
  const GROUND_CLEARANCE_REF = 0.75 + 0.045 / 2
  const HOVER_HEIGHT = 3.52
  bodyGroup.position.y = GROUND_CLEARANCE_REF + HOVER_HEIGHT // world Y of the bottom of the hull, pre-manipulatorScale

  // --- Flipped 3R arm: same code as AMR, hung under the body via armFlip ---
  const jointRadius = 0.22
  // base is a child of root (sibling of bodyGroup), NEVER of bodyGroup — real bug found:
  // parenting base under bodyGroup summed flight yaw (bodyGroup.rotation.y) with aim yaw
  // (base.rotation.y), so the arm always pointed sideways relative to the direction of travel.
  const base = new THREE.Group()
  base.position.y = bodyGroup.position.y - 0.2
  root.add(base)

  // Single flip point: rotation.z = π, fixed. Yaw (on base above) stays a real
  const armFlip = new THREE.Group()
  armFlip.rotation.z = Math.PI
  base.add(armFlip)

  const baseJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 16, 16), armMat)
  armFlip.add(baseJoint)

  const link1Group = new THREE.Group()
  armFlip.add(link1Group)
  const link1 = new THREE.Mesh(makeLinkGeometry(state.link1Length, state.link1Thickness), armMat)
  link1Group.add(link1)

  const ELBOW_REST_PITCH = Math.PI / 2.4
  const elbow = new THREE.Group()
  elbow.position.y = state.link1Length
  elbow.rotation.x = ELBOW_REST_PITCH
  link1Group.add(elbow)
  const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius * 0.85, 16, 16), armMat)
  elbow.add(elbowJoint)
  const link2 = new THREE.Mesh(makeTaperedLinkGeometry(state.link2Length, state.link2Thickness, state.link2TipThickness), armMat)
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
  function effectivePaddleAngle() { return Math.max(state.paddleAngle - gripOffset, 0) }
  let shootTiltOffset = 0
  let ballRestExtraOffset = 0
  function updatePaddleCenter() {
    const halfAngle = effectivePaddleAngle() / 2
    const d = paddleWidth / 2
    paddleCenter.position.set(0, 0, d * Math.cos(halfAngle))
    ballRestPoint.position.set(0, 0, d / Math.cos(halfAngle) + ballRestExtraOffset)
  }
  updatePaddleCenter()

  // Sign DIFFERENT from AMR on purpose: the flipped arm reverses which way
  // elbow/link1/wrist move the paddle vertically i guess
  function levelPaddle() {
    paddleGroup.rotation.x = -(link1Group.rotation.x + elbow.rotation.x + WRIST_REST_PITCH) - (state.paddleTilt + shootTiltOffset)
  }
  function applyPaddleAngle() {
    const angle = effectivePaddleAngle()
    paddleLeft.rotation.x = angle / 2
    paddleRight.rotation.x = -angle / 2
    updatePaddleCenter()
  }
  let aimPitchOffset = 0
  let dribbleElbowOffset = 0
  function applyArmPitch() 
  {
    // Subtracting the offset from REST 
    elbow.rotation.x = ELBOW_REST_PITCH - (aimPitchOffset + dribbleElbowOffset)
    levelPaddle()
  }
  levelPaddle()
  applyPaddleAngle()

  // Rotor spin: independent phase per pivot, advanced every frame by
  // Drone.updateLocomotionAnimation (never paused, even standing still)
  function spinRotors(dt, speed) {
    rotorPivots.forEach((pivot, i) => { pivot.rotation.y += dt * speed * (i % 2 === 0 ? 1 : -1) })
  }

  //Three Local fixed axis
  const BODY_FORWARD_AXIS = new THREE.Vector3(1, 0, 0)
  const BODY_UP_AXIS = new THREE.Vector3(0, 1, 0)
  const BODY_SIDE_AXIS = new THREE.Vector3(0, 0, 1)

  let yawAngle = 0
  let bankAngle = 0       
  let bodyPitchAngle = 0

  // Using quaternion fixed a bug 
  const scratchYawQuat = new THREE.Quaternion()
  const scratchRollQuat = new THREE.Quaternion()
  const scratchPitchQuat = new THREE.Quaternion()

  function applyBodyOrientation() 
  {
    scratchYawQuat.setFromAxisAngle(BODY_UP_AXIS, yawAngle)
    scratchRollQuat.setFromAxisAngle(BODY_FORWARD_AXIS, bankAngle)
    scratchPitchQuat.setFromAxisAngle(BODY_SIDE_AXIS, bodyPitchAngle)
    bodyGroup.quaternion.copy(scratchYawQuat).multiply(scratchRollQuat).multiply(scratchPitchQuat)
  }

  const controls = {
    manipulatorScale: makeScaleSetter(state, 'manipulatorScale', root),
    link1: createLinkControls(state, { statePrefix: 'link1', mesh: link1, downstreamJoint: elbow, buildGeometry: makeLinkGeometry, thicknessNames: ['Thickness'] }),
    link2: createLinkControls(state, { statePrefix: 'link2', mesh: link2, downstreamJoint: wrist, buildGeometry: makeTaperedLinkGeometry, thicknessNames: ['Thickness', 'TipThickness'] }),
    baseJointScale: makeScaleSetter(state, 'baseJointScale', baseJoint),
    elbowJointScale: makeScaleSetter(state, 'elbowJointScale', elbowJoint),
    endEffectorScale: makeScaleSetter(state, 'endEffectorScale', endEffector),
    setAimYaw(angle) { base.rotation.y = angle },
    setAimPitch(pitchOffset) { aimPitchOffset = pitchOffset; applyArmPitch() },
    setDribbleOffsets(elbowOffset, link1Offset) {
      dribbleElbowOffset = elbowOffset
      // Same inverted sign as applyArmPitch (flipped axis)
      link1Group.rotation.x = -link1Offset
      applyArmPitch()
    },
    setGrip(offset) { gripOffset = offset; applyPaddleAngle() },
    setShootTilt(offset) { shootTiltOffset = offset; levelPaddle() },
    setBallRestOffset(extra) { ballRestExtraOffset = extra; updatePaddleCenter() },
    paddleAngle(a) { state.paddleAngle = a; applyPaddleAngle(); updatePaddleCenter() },
    paddleTilt(angle) { state.paddleTilt = angle; levelPaddle() },
    // wheelsGroup is the body here: yaw = flight heading
    setWheelsYaw(angle) { yawAngle = angle; applyBodyOrientation() },
    // Bank in turns — pose only, not tracked in state/Copy Config
    setBank(angle) { bankAngle = angle; applyBodyOrientation() },
    // Body pitch (nose tilt) — aim tilt in HANDLING and/or thrust tilt while
    // moving, summed by Drone before calling this with one combined value
    setBodyPitch(angle) { bodyPitchAngle = angle; applyBodyOrientation() },
    spinRotors,
    ...createColorControls({ body: bodyMat, arm: armMat, accent: accentMat }),
  }

  controls.link1.scale(state.link1Scale)
  controls.link2.scale(state.link2Scale)
  controls.baseJointScale(state.baseJointScale)
  controls.elbowJointScale(state.elbowJointScale)
  controls.endEffectorScale(state.endEffectorScale)

  function getConfig() { return { ...state } }
  function getPaddleTilt() { return state.paddleTilt }

  return {
    root,
    wheelsGroup: bodyGroup,
    joints: { base, elbow, wrist },
    paddle: paddleCenter,
    ballRestPoint,
    controls,
    getConfig,
    getPaddleTilt,
  }
}
