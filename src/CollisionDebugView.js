import * as THREE from 'three'
import { angleToForward, rotateRight } from './mathUtils.js'

// Wireframe overlay dei volumi di collisione/contatto usati dal gioco, per
// ISPEZIONARLI a occhio invece di leggerne solo i numeri (quello resta il
// pannello debug, tasto P). Tasti numerici 1-8, ognuno alterna una
// categoria indipendente — vedi KEY_BINDINGS sotto.
//
// Le forme FISSE (backboard/muri/pali/panchine/ferro) riusano direttamente
// gli stessi Box3/torus di CollisionWorld invece di duplicarli a mano, così
// restano sempre sincronizzati se quelle coordinate cambiano in futuro.
// THREE.Box3Helper legge dal vivo (in updateMatrixWorld, chiamato dal
// renderer ad ogni frame) lo stesso oggetto Box3 passato al costruttore —
// per la zona DINAMICA PICKUP (box allineata agli assi mondo, segue solo
// la posizione del robot) basta quindi mutare IN PLACE lo stesso Box3 ogni
// frame (setFromObject + expandByScalar), mai sostituirlo con uno nuovo:
// l'helper lo riprende da solo al prossimo render. STEAL invece è un
// anello ASIMMETRICO orientato sull'aim yaw del robot (non allineato agli
// assi mondo, Box3Helper non può rappresentarlo) — ricostruito a mano ogni
// frame (updateStealRing sotto). Entrambe le zone dinamiche, in ogni caso,
// vengono ricalcolate solo per le categorie effettivamente visibili
// (niente setFromObject/traverse per una categoria spenta).

const KEY_BINDINGS = {
  Digit1: 'backboard',
  Digit2: 'hoop',
  Digit3: 'walls',
  Digit4: 'poles',
  Digit5: 'benches',
  Digit6: 'steal',
  Digit7: 'block',
  Digit8: 'pickup',
}

const CATEGORY_LABELS = {
  backboard: 'Backboard',
  hoop: 'Hoop/Ferro',
  walls: 'Muri',
  poles: 'Pali lampione',
  benches: 'Panchine',
  steal: 'STEAL (zona furto)',
  block: 'BLOCK (raggio contatto)',
  pickup: 'PICKUP (zona raccolta)',
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
}

export function initCollisionDebugView(ctx) {
  const {
    scene, collisionWorld, rimRingRadius, rimTubeRadius,
    manipulator, enemyManipulator, getBasketball,
    getPlayerAimYaw, getEnemyAimYaw, stealForwardMargin, stealBackwardMargin,
    blockContactRadius, pickupMargin,
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

  // --- 2: Hoop/ferro (torus reale, non solo un box) ---
  const hoopGroup = makeGroup('hoop')
  const hoopMaterial = new THREE.MeshBasicMaterial({ color: WIRE_COLORS.hoop, wireframe: true, toneMapped: false })
  for (const hoop of collisionWorld.hoops) {
    // il toro giace nel piano XZ nel gioco vero (asse Z lungo Y locale di
    // default in three.js) — ruotato di conseguenza, stessa convenzione
    // già documentata in CollisionWorld.resolveSphereTorusCollision.
    // rimRingRadius (non hoop.radius, che è già ridotto della tube radius
    // per il rilevamento canestro — vedi CollisionWorld.js): il RAGGIO
    // VERO del toro fisico, lo stesso passato a resolveSphereTorusCollision
    const torusMesh = new THREE.Mesh(new THREE.TorusGeometry(rimRingRadius, rimTubeRadius, 8, 24), hoopMaterial)
    torusMesh.rotation.x = Math.PI / 2
    torusMesh.position.copy(hoop.center)
    hoopGroup.add(torusMesh)
  }

  // --- 3: Muri ---
  const wallsGroup = makeGroup('walls')
  for (const box of collisionWorld.wallBoxes) wallsGroup.add(new THREE.Box3Helper(box, WIRE_COLORS.walls))

  // --- 4: Pali lampione ---
  const polesGroup = makeGroup('poles')
  for (const box of collisionWorld.poleBoxes) polesGroup.add(new THREE.Box3Helper(box, WIRE_COLORS.poles))

  // --- 5: Panchine ---
  const benchesGroup = makeGroup('benches')
  for (const box of collisionWorld.benchBoxes) benchesGroup.add(new THREE.Box3Helper(box, WIRE_COLORS.benches))

  // --- 6: STEAL — zona di reach ASIMMETRICA attorno a CIASCUN robot:
  // ampia (stealForwardMargin) nella direzione in cui sta guardando/
  // spazzando quel robot, quasi nulla (stealBackwardMargin) alle sue
  // spalle — stessa identica formula (coseno + lerp) di isTouchingOpponentBox
  // in CombatMoves.js, non un'approssimazione a parte. Disegnata come un
  // anello (LineLoop) invece di un Box3Helper: la forma non è più un
  // parallelepipedo allineato agli assi mondo, ruota con l'orientamento
  // del robot — va quindi ricostruita a mano ogni frame (updateStealRing
  // sotto), niente scorciatoia "mutare un Box3 e lasciare che l'helper lo
  // rilegga da solo" come per le forme fisse/PICKUP
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
  // ricostruisce l'anello attorno a centerPos, orientato su aimYaw — un
  // punto per grado di STEAL_RING_SEGMENTS, raggio dato dalla stessa
  // interpolazione coseno-pesata usata dalla logica vera
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
      positions[i * 3 + 1] = centerPos.y + 5 // leggero rialzo, non affonda nel pavimento
      positions[i * 3 + 2] = centerPos.z + (scratchStealForward.z * cosT + scratchStealRight.z * sinT) * margin
    }
    ring.geometry.attributes.position.needsUpdate = true
  }

  // --- 7: BLOCK — sfera di contatto attorno alla palla (paletta-vs-palla,
  // BLOCK_CONTACT_RADIUS), rilevante solo mentre la palla è FREE_SHOT ma
  // mostrata sempre finché il pallone esiste, per poterla ispezionare anche
  // da fermi
  const blockGroup = makeGroup('block')
  const blockSphere = new THREE.Mesh(
    new THREE.SphereGeometry(blockContactRadius, 16, 12),
    new THREE.MeshBasicMaterial({ color: WIRE_COLORS.block, wireframe: true, toneMapped: false })
  )
  blockGroup.add(blockSphere)

  // --- 8: PICKUP — zona attorno a CIASCUN robot (box propria espansa di
  // PICKUP_MARGIN): raccolta automatica quando la palla libera la tocca,
  // vedi isRobotTouchingBall in BallPossession.js
  const pickupGroup = makeGroup('pickup')
  const playerPickupBox = new THREE.Box3()
  const enemyPickupBox = new THREE.Box3()
  pickupGroup.add(new THREE.Box3Helper(playerPickupBox, WIRE_COLORS.pickup))
  pickupGroup.add(new THREE.Box3Helper(enemyPickupBox, WIRE_COLORS.pickup))

  // ricalcolate ogni frame SOLO se il gruppo relativo è visibile — niente
  // setFromObject/traverse (non gratis, cammina l'intera gerarchia del
  // robot) per una categoria spenta
  function update() {
    if (stealGroup.visible) {
      updateStealRing(playerStealRing, manipulator.root.position, getPlayerAimYaw())
      updateStealRing(enemyStealRing, enemyManipulator.root.position, getEnemyAimYaw())
    }
    if (pickupGroup.visible) {
      playerPickupBox.setFromObject(manipulator.root).expandByScalar(pickupMargin)
      enemyPickupBox.setFromObject(enemyManipulator.root).expandByScalar(pickupMargin)
    }
    if (blockGroup.visible) {
      const ball = getBasketball()
      blockSphere.visible = !!ball
      if (ball) blockSphere.position.copy(ball.position)
    }
  }

  document.addEventListener('keydown', e => {
    const category = KEY_BINDINGS[e.code]
    if (!category || e.repeat) return
    const group = groups[category]
    group.visible = !group.visible
    console.log(`%c[Collision Debug] ${CATEGORY_LABELS[category]}: ${group.visible ? 'ON' : 'OFF'}`, 'color: #00ff88; font-weight: bold')
  })

  return { update }
}
