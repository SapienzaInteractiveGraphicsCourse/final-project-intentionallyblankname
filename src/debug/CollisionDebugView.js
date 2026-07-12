import * as THREE from 'three'
import { angleToForward, rotateRight } from '../utils/mathUtils.js'
import { getObjectWorldPosition } from '../gameplay/BallPossession.js'
import { blockBoxHalfSizeFor } from '../gameplay/CombatMoves.js'

// Wireframe overlay of every collision/contact volume, toggled with the
// number keys (KEY_BINDINGS below), to inspect the shapes by eye.
//
// FIXED shapes (backboard/walls/poles/benches/rim) reuse the same Box3/
// torus data of CollisionWorld, never a hand copy: Box3Helper reads its
// Box3 live every render, so the dynamic PICKUP box just mutates the same
// Box3 in place each frame. STEAL is an asymmetric ring oriented on the
// robot's aim yaw (a Box3Helper cannot represent it), rebuilt by hand each
// frame. Dynamic shapes update only while their category is visible.

const KEY_BINDINGS = {
  Digit1: 'backboard',
  Digit2: 'hoop',
  Digit3: 'walls',
  Digit4: 'poles',
  Digit5: 'benches',
  Digit6: 'steal',
  Digit7: 'block',
  Digit8: 'pickup',
  Digit9: 'body',
}

const CATEGORY_LABELS = {
  backboard: 'Backboard',
  hoop: 'Hoop/Rim',
  walls: 'Walls',
  poles: 'Lamp poles',
  benches: 'Benches',
  steal: 'STEAL (reach zone)',
  block: 'BLOCK (end effector box)',
  pickup: 'PICKUP (pickup zone)',
  body: 'BODY (body volume)',
}

const WIRE_COLORS = {
  backboard: 0xff2222,
  hoop: 0xffaa00,
  walls: 0x2288ff,
  poles: 0x22ffaa,
  benches: 0xaa22ff,
  steal: 0xffff00,
  block: 0xff00ff,
  pickup: 0x00ff88,
  body: 0x00aaff,
}

export function initCollisionDebugView(ctx) {
  const {
    scene, collisionWorld, rimRingRadius, rimTubeRadius,
    getManipulator, getEnemyManipulator,
    getPlayerAimYaw, getEnemyAimYaw, stealForwardMargin, stealBackwardMargin,
    pickupMargin,
  } = ctx

  const groups = {}
  function makeGroup(key) {
    const group = new THREE.Group()
    group.visible = false
    scene.add(group)
    groups[key] = group
    return group
  }

  // --- 1: Backboard ---
  const backboardGroup = makeGroup('backboard')
  for (const box of collisionWorld.backboardBoxes) backboardGroup.add(new THREE.Box3Helper(box, WIRE_COLORS.backboard))

  // --- 2: Hoop/rim (real torus, not a box) ---
  const hoopGroup = makeGroup('hoop')
  const hoopMaterial = new THREE.MeshBasicMaterial({ color: WIRE_COLORS.hoop, wireframe: true, toneMapped: false })
  for (const hoop of collisionWorld.hoops) {
    // rimRingRadius, not hoop.radius (already shrunk by the tube radius
    // for score detection): the physical torus, rotated into the XZ plane
    const torusMesh = new THREE.Mesh(new THREE.TorusGeometry(rimRingRadius, rimTubeRadius, 8, 24), hoopMaterial)
    torusMesh.rotation.x = Math.PI / 2
    torusMesh.position.copy(hoop.center)
    hoopGroup.add(torusMesh)
  }

  // --- 3: Walls ---
  const wallsGroup = makeGroup('walls')
  for (const box of collisionWorld.wallBoxes) wallsGroup.add(new THREE.Box3Helper(box, WIRE_COLORS.walls))

  // --- 4: Lamp poles ---
  const polesGroup = makeGroup('poles')
  for (const box of collisionWorld.poleBoxes) polesGroup.add(new THREE.Box3Helper(box, WIRE_COLORS.poles))

  // --- 5: Benches ---
  const benchesGroup = makeGroup('benches')
  for (const box of collisionWorld.benchBoxes) benchesGroup.add(new THREE.Box3Helper(box, WIRE_COLORS.benches))

  // --- 6: STEAL, asymmetric reach ring per robot: same cosine+lerp
  // formula as isTouchingOpponentBox in CombatMoves.js, not a separate
  // approximation. LineLoop rebuilt each frame (rotates with the aim yaw)
  const STEAL_RING_SEGMENTS = 48
  function createStealRing() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((STEAL_RING_SEGMENTS + 1) * 3), 3))
    return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: WIRE_COLORS.steal, toneMapped: false }))
  }
  const stealGroup = makeGroup('steal')
  const playerStealRing = createStealRing()
  const enemyStealRing = createStealRing()
  stealGroup.add(playerStealRing, enemyStealRing)

  const scratchStealForward = new THREE.Vector3()
  const scratchStealRight = new THREE.Vector3()
  function updateStealRing(ring, centerPos, aimYaw) {
    angleToForward(aimYaw, scratchStealForward)
    rotateRight(scratchStealForward, scratchStealRight)
    const positions = ring.geometry.attributes.position.array
    for (let i = 0; i <= STEAL_RING_SEGMENTS; i++) {
      const theta = (i / STEAL_RING_SEGMENTS) * Math.PI * 2
      const cosT = Math.cos(theta)
      const sinT = Math.sin(theta)
      const margin = cosT > 0 ? THREE.MathUtils.lerp(stealBackwardMargin, stealForwardMargin, cosT) : stealBackwardMargin
      positions[i * 3] = centerPos.x + (scratchStealForward.x * cosT + scratchStealRight.x * sinT) * margin
      positions[i * 3 + 1] = centerPos.y + 5 // slight lift off the floor
      positions[i * 3 + 2] = centerPos.z + (scratchStealForward.z * cosT + scratchStealRight.z * sinT) * margin
    }
    ring.geometry.attributes.position.needsUpdate = true
  }

  // --- 7: BLOCK, end effector box per robot, same blockBoxHalfSizeFor
  // sizing as the real contact test (scaled by that robot's BLOCK stat)
  const blockGroup = makeGroup('block')
  const playerBlockBox = new THREE.Box3()
  const enemyBlockBox = new THREE.Box3()
  blockGroup.add(new THREE.Box3Helper(playerBlockBox, WIRE_COLORS.block))
  blockGroup.add(new THREE.Box3Helper(enemyBlockBox, WIRE_COLORS.block))
  const scratchEndEffectorPos = new THREE.Vector3()
  function updateBlockBox(box, robot) {
    getObjectWorldPosition(robot.paddle, scratchEndEffectorPos)
    const halfSize = blockBoxHalfSizeFor(robot.stats.block)
    box.min.set(scratchEndEffectorPos.x - halfSize, scratchEndEffectorPos.y - halfSize, scratchEndEffectorPos.z - halfSize)
    box.max.set(scratchEndEffectorPos.x + halfSize, scratchEndEffectorPos.y + halfSize, scratchEndEffectorPos.z + halfSize)
  }

  // --- 8: PICKUP, own body box expanded by pickupMargin (see
  // isRobotTouchingBall in BallPossession.js)
  const pickupGroup = makeGroup('pickup')
  const playerPickupBox = new THREE.Box3()
  const enemyPickupBox = new THREE.Box3()
  pickupGroup.add(new THREE.Box3Helper(playerPickupBox, WIRE_COLORS.pickup))
  pickupGroup.add(new THREE.Box3Helper(enemyPickupBox, WIRE_COLORS.pickup))

  // --- 9: BODY, real bounding box per robot (RobotBase.getBodyBox, the
  // same source pickup/STEAL use)
  const bodyGroup = makeGroup('body')
  const playerBodyBox = new THREE.Box3()
  const enemyBodyBox = new THREE.Box3()
  bodyGroup.add(new THREE.Box3Helper(playerBodyBox, WIRE_COLORS.body))
  bodyGroup.add(new THREE.Box3Helper(enemyBodyBox, WIRE_COLORS.body))

  // Dynamic shapes recomputed only while visible (setFromObject walks the
  // whole robot hierarchy, not free)
  function update() {
    if (stealGroup.visible) {
      updateStealRing(playerStealRing, getManipulator().root.position, getPlayerAimYaw())
      updateStealRing(enemyStealRing, getEnemyManipulator().root.position, getEnemyAimYaw())
    }
    if (pickupGroup.visible) {
      playerPickupBox.setFromObject(getManipulator().root).expandByScalar(pickupMargin)
      enemyPickupBox.setFromObject(getEnemyManipulator().root).expandByScalar(pickupMargin)
    }
    if (blockGroup.visible) {
      updateBlockBox(playerBlockBox, getManipulator())
      updateBlockBox(enemyBlockBox, getEnemyManipulator())
    }
    if (bodyGroup.visible) {
      getManipulator().getBodyBox(playerBodyBox)
      getEnemyManipulator().getBodyBox(enemyBodyBox)
    }
  }

  document.addEventListener('keydown', e => {
    const category = KEY_BINDINGS[e.code]
    if (!category || e.repeat) return
    const group = groups[category]
    group.visible = !group.visible
    console.log(`[Collision Debug] ${CATEGORY_LABELS[category]}: ${group.visible ? 'ON' : 'OFF'}`)
  })

  return { update }
}
