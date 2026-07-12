import * as THREE from 'three'

// Rim torus (XZ plane), radii from the GLTF accessors.
// needs RIM_RING_RADIUS for the hoop-assist cone, CollisionDebugView.js
// needs both to draw the exact same torus the physics uses.
export const RIM_RING_RADIUS = 40
export const RIM_TUBE_RADIUS = 4

// All static court collisions (backboard/rim/walls/poles/benches): owns the
// geometry arrays (extracted from GLTF accessors) and
// resolve(), which checks them all at once. No physics engine, sphere vs
// AABB/torus with velocity reflection v' = v - (1+e)(v·n)n.
export class CollisionWorld 
{
  constructor() {
    // Backboard boxes: world-space bounds from the GLTF accessors
    const BACKBOARD_HALF_THICKNESS = 4  // the real panel is a zero-thickness plane; the AABB test needs some
    this.BACKBOARD_RESTITUTION = 0.15   // heavily damped, livelier values made scoring nearly impossible
    this.BACKBOARD_TOP_Y = 340          // real top edge, also used by the hoop-assist cone

    this.backboardBoxes = 
    [
      new THREE.Box3
      (
        new THREE.Vector3(1139.8 - BACKBOARD_HALF_THICKNESS, 230, -75),
        new THREE.Vector3(1139.8 + BACKBOARD_HALF_THICKNESS, this.BACKBOARD_TOP_Y, 75)
      ),
      new THREE.Box3
      (
        new THREE.Vector3(-1134.2 - BACKBOARD_HALF_THICKNESS, 230, -75),
        new THREE.Vector3(-1134.2 + BACKBOARD_HALF_THICKNESS, this.BACKBOARD_TOP_Y, 75)
      ),
    ]

    this.RIM_RESTITUTION = 0.3

    // Score-detection radius: the full geometric opening of the rim

    const hoopDetectionRadius = RIM_RING_RADIUS - RIM_TUBE_RADIUS
    this.hoops = 
    [
      { center: new THREE.Vector3(1079.85, 262.55, 2.5), radius: hoopDetectionRadius },
      { center: new THREE.Vector3(-1074.15, 262.55, -2.5), radius: hoopDetectionRadius },
    ]

    // Walls: all 66 real meshes of the GLTF 'walls' subtree (panels +
    // bleacher steps), extracted one by one via a Node script, a per-side
    // aggregate rectangle left holes the ball flew through

    this.WALL_RESTITUTION = 0.55
    this.wallBoxes = 
    [
      new THREE.Box3(new THREE.Vector3(-1731, 0, -1579), new THREE.Vector3(1265, 400, -1027)), // Cube_5_wall_0
      new THREE.Box3(new THREE.Vector3(-1731, 0, -1047), new THREE.Vector3(945, 400, -1047)), // Cube_5_floor_0
      new THREE.Box3(new THREE.Vector3(1245, 200, -1579), new THREE.Vector3(1445, 400, -1347)), // Cube_4_5_wall_0
      new THREE.Box3(new THREE.Vector3(1245, 200, -1347), new THREE.Vector3(1445, 400, -1047)), // Cube_3_6__0
      new THREE.Box3(new THREE.Vector3(945, 0, -1047), new THREE.Vector3(1245, 200, -847)), // Cube_2_6_wall_0
      new THREE.Box3(new THREE.Vector3(1232, 0, -1579), new THREE.Vector3(1457, 200, -847)), // Cube_1_11_wall_0
      new THREE.Box3(new THREE.Vector3(1468, -1, 1373), new THREE.Vector3(1488, 399, 1873)), // Cube_1_12_floor_0
      new THREE.Box3(new THREE.Vector3(1465, 0, 832), new THREE.Vector3(1485, 400, 1332)), // Cube_1_0_3_floor_0
      new THREE.Box3(new THREE.Vector3(1465, 0, 114), new THREE.Vector3(1485, 400, 614)), // Cube_1_1_3_floor_0
      new THREE.Box3(new THREE.Vector3(1465, 0, -603), new THREE.Vector3(1485, 400, -103)), // Cube_1_2_4_floor_0
      new THREE.Box3(new THREE.Vector3(1465, 0, -1321), new THREE.Vector3(1485, 400, -821)), // Cube_1_3_4_floor_0
      new THREE.Box3(new THREE.Vector3(1445, 0, 1291), new THREE.Vector3(1465, 400, 1591)), // Cube_1_0_4_wall_0
      new THREE.Box3(new THREE.Vector3(1445, 0, 573), new THREE.Vector3(1465, 400, 873)), // Cube_1_1_4_wall_0
      new THREE.Box3(new THREE.Vector3(1445, 0, -144), new THREE.Vector3(1465, 400, 156)), // Cube_1_2_5_wall_0
      new THREE.Box3(new THREE.Vector3(1445, 0, -862), new THREE.Vector3(1465, 400, -562)), // Cube_1_3_5_wall_0
      new THREE.Box3(new THREE.Vector3(1445, 0, -1580), new THREE.Vector3(1465, 400, -1280)), // Cube_1_4_2_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 199, -1067), new THREE.Vector3(1444, 214, -1047)), // Cube_6_0_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 212, -1087), new THREE.Vector3(1444, 227, -1067)), // Cube_6_1_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 226, -1107), new THREE.Vector3(1444, 241, -1087)), // Cube_6_2_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 239, -1127), new THREE.Vector3(1444, 254, -1107)), // Cube_6_3_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 252, -1147), new THREE.Vector3(1444, 267, -1127)), // Cube_6_4_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 266, -1167), new THREE.Vector3(1444, 281, -1147)), // Cube_6_5_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 279, -1187), new THREE.Vector3(1444, 294, -1167)), // Cube_6_6_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 292, -1207), new THREE.Vector3(1444, 307, -1187)), // Cube_6_7_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 305, -1227), new THREE.Vector3(1444, 320, -1207)), // Cube_6_8_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 319, -1247), new THREE.Vector3(1444, 334, -1227)), // Cube_6_9_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 332, -1267), new THREE.Vector3(1444, 347, -1247)), // Cube_6_10_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 345, -1287), new THREE.Vector3(1444, 360, -1267)), // Cube_6_11_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 359, -1307), new THREE.Vector3(1444, 374, -1287)), // Cube_6_12_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 372, -1327), new THREE.Vector3(1444, 387, -1307)), // Cube_6_13_wall_0
      new THREE.Box3(new THREE.Vector3(1266, 385, -1347), new THREE.Vector3(1444, 400, -1327)), // Cube_6_14_wall_0
      new THREE.Box3(new THREE.Vector3(945, -1, -1026), new THREE.Vector3(965, 14, -848)), // Cube_6_0_2_wall_0
      new THREE.Box3(new THREE.Vector3(965, 12, -1026), new THREE.Vector3(985, 27, -848)), // Cube_6_1_2_wall_0
      new THREE.Box3(new THREE.Vector3(985, 26, -1026), new THREE.Vector3(1005, 41, -848)), // Cube_6_2_2_wall_0
      new THREE.Box3(new THREE.Vector3(1005, 39, -1026), new THREE.Vector3(1025, 54, -848)), // Cube_6_3_2_wall_0
      new THREE.Box3(new THREE.Vector3(1025, 52, -1026), new THREE.Vector3(1045, 67, -848)), // Cube_6_4_2_wall_0
      new THREE.Box3(new THREE.Vector3(1045, 66, -1026), new THREE.Vector3(1065, 81, -848)), // Cube_6_5_2_wall_0
      new THREE.Box3(new THREE.Vector3(1065, 79, -1026), new THREE.Vector3(1085, 94, -848)), // Cube_6_6_2_wall_0
      new THREE.Box3(new THREE.Vector3(1085, 92, -1026), new THREE.Vector3(1105, 107, -848)), // Cube_6_7_2_wall_0
      new THREE.Box3(new THREE.Vector3(1105, 105, -1026), new THREE.Vector3(1125, 120, -848)), // Cube_6_8_2_wall_0
      new THREE.Box3(new THREE.Vector3(1125, 119, -1026), new THREE.Vector3(1145, 134, -848)), // Cube_6_9_2_wall_0
      new THREE.Box3(new THREE.Vector3(1145, 132, -1026), new THREE.Vector3(1165, 147, -848)), // Cube_6_10_2_wall_0
      new THREE.Box3(new THREE.Vector3(1165, 145, -1026), new THREE.Vector3(1185, 160, -848)), // Cube_6_11_2_wall_0
      new THREE.Box3(new THREE.Vector3(1185, 159, -1026), new THREE.Vector3(1205, 174, -848)), // Cube_6_12_2_wall_0
      new THREE.Box3(new THREE.Vector3(1205, 172, -1026), new THREE.Vector3(1225, 187, -848)), // Cube_6_13_2_wall_0
      new THREE.Box3(new THREE.Vector3(1225, 185, -1026), new THREE.Vector3(1245, 200, -848)), // Cube_6_14_2_wall_0
      new THREE.Box3(new THREE.Vector3(-1734, -1, -1580), new THREE.Vector3(-1714, 399, -1080)), // Cube_1_13_floor_0
      new THREE.Box3(new THREE.Vector3(-1731, 0, -1040), new THREE.Vector3(-1711, 400, -540)), // Cube_1_0_5_floor_0
      new THREE.Box3(new THREE.Vector3(-1731, 0, -322), new THREE.Vector3(-1711, 400, 178)), // Cube_1_1_5_floor_0
      new THREE.Box3(new THREE.Vector3(-1731, 0, 395), new THREE.Vector3(-1711, 400, 895)), // Cube_1_2_6_floor_0
      new THREE.Box3(new THREE.Vector3(-1731, 0, 1113), new THREE.Vector3(-1711, 400, 1613)), // Cube_1_3_6_floor_0
      new THREE.Box3(new THREE.Vector3(-1711, 0, -1299), new THREE.Vector3(-1691, 400, -999)), // Cube_1_0_6_wall_0
      new THREE.Box3(new THREE.Vector3(-1711, 0, -581), new THREE.Vector3(-1691, 400, -281)), // Cube_1_1_6_wall_0
      new THREE.Box3(new THREE.Vector3(-1711, 0, 137), new THREE.Vector3(-1691, 400, 437)), // Cube_1_2_7_wall_0
      new THREE.Box3(new THREE.Vector3(-1711, 0, 854), new THREE.Vector3(-1691, 400, 1154)), // Cube_1_3_7_wall_0
      new THREE.Box3(new THREE.Vector3(-1711, 0, 1572), new THREE.Vector3(-1691, 400, 1872)), // Cube_1_4_3_wall_0
      new THREE.Box3(new THREE.Vector3(-1706, -1, 1850), new THREE.Vector3(-1672, 399, 1870)), // Cube_1_14_floor_0
      new THREE.Box3(new THREE.Vector3(-1422, 0, 1870), new THREE.Vector3(-922, 400, 1890)), // Cube_1_0_7_floor_0
      new THREE.Box3(new THREE.Vector3(-704, 0, 1870), new THREE.Vector3(-204, 400, 1890)), // Cube_1_1_7_floor_0
      new THREE.Box3(new THREE.Vector3(14, 0, 1870), new THREE.Vector3(514, 400, 1890)), // Cube_1_2_8_floor_0
      new THREE.Box3(new THREE.Vector3(732, 0, 1870), new THREE.Vector3(1232, 400, 1890)), // Cube_1_3_8_floor_0
      new THREE.Box3(new THREE.Vector3(-1681, 0, 1850), new THREE.Vector3(-1381, 400, 1870)), // Cube_1_0_8_wall_0
      new THREE.Box3(new THREE.Vector3(-963, 0, 1850), new THREE.Vector3(-663, 400, 1870)), // Cube_1_1_8_wall_0
      new THREE.Box3(new THREE.Vector3(-245, 0, 1850), new THREE.Vector3(55, 400, 1870)), // Cube_1_2_9_wall_0
      new THREE.Box3(new THREE.Vector3(473, 0, 1850), new THREE.Vector3(773, 400, 1870)), // Cube_1_3_9_wall_0
      new THREE.Box3(new THREE.Vector3(1190, 0, 1850), new THREE.Vector3(1490, 400, 1870)), // Cube_1_4_4_wall_0
    ]

    // Lamp poles: thin vertical AABBs at the 4 real lamp positions

    this.POLE_RESTITUTION = 0.55
    const POLE_HALF_WIDTH = 20
    const polePositionsXZ = [[615.87, -845], [615.87, 845], [-615.87, -845], [-615.87, 845]]

    this.poleBoxes = polePositionsXZ.map(([x, z]) => new THREE.Box3
    (
      new THREE.Vector3(x - POLE_HALF_WIDTH, 0, z - POLE_HALF_WIDTH),
      new THREE.Vector3(x + POLE_HALF_WIDTH, 300, z + POLE_HALF_WIDTH)
    ))

    // Benches: real bounding boxes of the GLTF bench subtrees
    this.BENCH_RESTITUTION = 0.5
    this.benchBoxes = [
      new THREE.Box3(new THREE.Vector3(412, 0, 821), new THREE.Vector3(814, 50, 890)),
      new THREE.Box3(new THREE.Vector3(-815, 0, 822), new THREE.Vector3(-413, 50, 891)),
    ]

    // Post-hit cooldown PER OBJECT (the cooldownMap passed to resolve()):
    // a single global cooldown let a rim bounce disable the backboard
    // check right when the deflected ball reached it. Short (0.05s vs an
    // initial 0.3s) because position is already pushed to the volume edge
    // in the same step, and rim→same-backboard rebounds within 0.3s are
    // common at game shot speeds
    this.COLLISION_COOLDOWN = 0.05

    // Scratch objects reused every call (hot path, no per-call allocation)
    this._scratchBox = new THREE.Box3()
    this._scratchNormal = new THREE.Vector3()
    this._scratchRimPlanar = new THREE.Vector3()
    this._scratchRimNearest = new THREE.Vector3()
    this._scratchRimNormal = new THREE.Vector3()
  }

  // Sphere vs AABB: exit through the face with the smallest penetration,
  // reflect only the velocity component going INTO the surface. Returns
  // true on real contact (the trajectory preview uses it too)
  resolveSphereBoxCollision(position, velocity, box, radius, restitution) 
  {

    /*
    Parameters:
    - position: THREE.Vector3, ball center in world space, MUTATED in place (pushed out of the box on contact)
    - velocity: THREE.Vector3, ball velocity, MUTATED in place (normal component reflected on contact)
    - box: THREE.Box3, the collidable AABB (never modified, copied into the scratch)
    - radius: ball radius, used to expand the box so the sphere test becomes a point test
    - restitution: coefficient e in v' = v - (1+e)(v·n)n

    Returns:
    - true if a real contact happened (position/velocity were corrected), false otherwise
    */

    const scratchBox = this._scratchBox.copy(box).expandByScalar(radius) //used the scratch box
    if (!scratchBox.containsPoint(position)) return false

    //List of distances from edges (from inside)
    //WE ARE ASSUMING a slight intersection so we can find the MINIMAL distance as exit
    const dists = 
    [
      position.x - scratchBox.min.x, scratchBox.max.x - position.x,
      position.y - scratchBox.min.y, scratchBox.max.y - position.y,
      position.z - scratchBox.min.z, scratchBox.max.z - position.z,
    ]
    let minIdx = 0
    for (let i = 1; i < 6; i++) if (dists[i] < dists[minIdx]) minIdx = i // find the min index
    const axis = Math.floor(minIdx / 2) // 0=x, 1=y, 2=z get axis
    const sign = minIdx % 2 === 0 ? -1 : 1 // min face → negative normal, max face → positive
    const normal = this._scratchNormal.set(0, 0, 0).setComponent(axis, sign)
    // push the ball exactly onto the expanded volume's edge (de-penetrate)
    position.addScaledVector(normal, dists[minIdx])
    // This is mathematically equivalent to v' = v - (1+e)(v·n)n
    const vDotN = velocity.dot(normal)
    if (vDotN < 0) velocity.addScaledVector(normal, -(1 + restitution) * vDotN)
    return true
  }

  // Sphere vs torus (the rim, XZ plane): project the ball center onto the
  // main ring to find the nearest tube point, then it reduces to a
  // sphere-sphere hit with the same reflection formula
  resolveSphereTorusCollision(position, velocity, center, ringRadius, tubeRadius, radius, restitution) {
    const planar = this._scratchRimPlanar.set(position.x - center.x, 0, position.z - center.z)
    const planarDist = planar.length()

    if (planarDist < 1e-6) return false // exactly on the rim axis: no sensible radial direction
    planar.multiplyScalar(ringRadius / planarDist)
    const nearest = this._scratchRimNearest.set(center.x + planar.x, center.y, center.z + planar.z)
    const normal = this._scratchRimNormal.copy(position).sub(nearest)
    const dist = normal.length()
    const minDist = tubeRadius + radius
    if (dist >= minDist || dist < 1e-6) return false
    normal.multiplyScalar(1 / dist)
    position.addScaledVector(normal, minDist - dist)
    const vDotN = velocity.dot(normal)
    if (vDotN < 0) velocity.addScaledVector(normal, -(1 + restitution) * vDotN)
    return true
  }

  // True if the object is still on cooldown (also decrements it).
  // cooldownMap is caller-owned: the trajectory preview simulates a
  // hypothetical shot every frame and must not consume the real flight's
  // cooldowns while merely aiming
  isOnCooldown(obj, dt, cooldownMap) 
  {
    const remaining = cooldownMap.get(obj)
    if (!remaining) return false
    const next = remaining - dt
    if (next > 0) { cooldownMap.set(obj, next); return true }
    cooldownMap.delete(obj)
    return false
  }

  // Shared by the 4 box loops in resolve(). A real prototype method, not a
  // closure recreated per call: resolve() runs up to 2400x/frame in the
  resolveBoxAt(box, restitution, position, velocity, dt, cooldownMap, ballRadius) 
  {
    if (this.isOnCooldown(box, dt, cooldownMap)) return false
    if (this.resolveSphereBoxCollision(position, velocity, box, ballRadius, restitution)) {
      cooldownMap.set(box, this.COLLISION_COOLDOWN)
      return true
    }
    return false
  } 

  // One pass over every collidable, shared by the real shot flight AND the
  // trajectory preview, new collidable types get added here only.
  // Returns true if at least one hit occurred
  resolve(position, velocity, dt, cooldownMap, ballRadius) 
  {
    let hit = false
    for (const box of this.backboardBoxes) {
      if (this.resolveBoxAt(box, this.BACKBOARD_RESTITUTION, position, velocity, dt, cooldownMap, ballRadius)) hit = true
    }
    for (const hoop of this.hoops) {
      if (this.isOnCooldown(hoop, dt, cooldownMap)) continue
      if (this.resolveSphereTorusCollision(position, velocity, hoop.center, RIM_RING_RADIUS, RIM_TUBE_RADIUS, ballRadius, this.RIM_RESTITUTION)) {
        hit = true
        cooldownMap.set(hoop, this.COLLISION_COOLDOWN)
      }
    }
    for (const box of this.wallBoxes) {
      if (this.resolveBoxAt(box, this.WALL_RESTITUTION, position, velocity, dt, cooldownMap, ballRadius)) hit = true
    }
    for (const box of this.poleBoxes) {
      if (this.resolveBoxAt(box, this.POLE_RESTITUTION, position, velocity, dt, cooldownMap, ballRadius)) hit = true
    }
    for (const box of this.benchBoxes) {
      if (this.resolveBoxAt(box, this.BENCH_RESTITUTION, position, velocity, dt, cooldownMap, ballRadius)) hit = true
    }
    return hit
  }
}
