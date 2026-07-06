import * as THREE from 'three'

// collisione fisica col ferro stesso: il toro giace nel piano XZ — raggio
// principale/tubo derivati dagli stessi accessor GLTF di 'Torus_ring_0'/
// 'Torus_2_ring_0' (bounding box world ±43.75 in XZ, ±3.75 in Y attorno al
// centro). RIM_RING_RADIUS esportata (non solo interna alla classe): serve
// anche fuori, per il cono d'assistenza al canestro in main.js
// (HOOP_ASSIST_BASE_RADIUS) — RIM_TUBE_RADIUS invece resta solo interna,
// nessun altro file la importa davvero
export const RIM_RING_RADIUS = 40
const RIM_TUBE_RADIUS = 4

// Wrapper OOP sopra le collisioni ambientali (backboard/ferro/muri/pali/
// panchine): possiede gli array di geometria (estratti dagli accessor del
// GLTF, non stimati a occhio — vedi i commenti su ogni array) e il metodo
// resolve() che li controlla tutti in un colpo solo. Nessun motore fisico:
// sfera contro AABB/toro, riflessione della velocità sulla normale più
// vicina (v' = v - (1+restituzione)(v·n)n), stesso approccio a mano già
// usato per il palleggio.
export class CollisionWorld {
  constructor() {
    // Collisione backboard: coordinate NON stimate a occhio — estratte
    // analizzando gli accessor del GLTF (bounding box world-space delle
    // mesh 'Cube_2_5_Mat_0'/'Cube_3_5_Mat_0')
    const BACKBOARD_HALF_THICKNESS = 4 // il pannello reale ha spessore ~0 nel GLTF (piano perfetto): gliene serve uno per il test contro-AABB
    this.BACKBOARD_RESTITUTION = 0.15 // e=0.5 era troppo vivo (canestro quasi impossibile) — molto più smorzato
    this.BACKBOARD_TOP_Y = 340 // bordo superiore reale del pannello — riusato anche dal cono d'assistenza (applyHoopAssist in main.js)
    this.backboardBoxes = [
      new THREE.Box3(
        new THREE.Vector3(1139.8 - BACKBOARD_HALF_THICKNESS, 230, -75),
        new THREE.Vector3(1139.8 + BACKBOARD_HALF_THICKNESS, this.BACKBOARD_TOP_Y, 75)
      ),
      new THREE.Box3(
        new THREE.Vector3(-1134.2 - BACKBOARD_HALF_THICKNESS, 230, -75),
        new THREE.Vector3(-1134.2 + BACKBOARD_HALF_THICKNESS, this.BACKBOARD_TOP_Y, 75)
      ),
    ]

    this.RIM_RESTITUTION = 0.3
    // raggio di rilevamento canestro: il vero raggio geometrico
    // dell'APERTURA del ferro (RIM_RING_RADIUS - RIM_TUBE_RADIUS, il buco
    // vuoto al centro), non solo lo spazio in cui la palla non tocca MAI
    // il ferro (quello sarebbe più stretto, sottraendo anche il raggio
    // della palla) — un tiro che sfiora l'interno del ferro entra
    // comunque nella realtà, "tutto il rim" deve contare come canestro
    const hoopDetectionRadius = RIM_RING_RADIUS - RIM_TUBE_RADIUS
    this.hoops = [
      { center: new THREE.Vector3(1079.85, 262.55, 2.5), radius: hoopDetectionRadius },
      { center: new THREE.Vector3(-1074.15, 262.55, -2.5), radius: hoopDetectionRadius },
    ]

    // muri: TUTTE le 66 mesh reali del sottoalbero 'walls' nel GLTF
    // (pannelli verticali + gradoni delle tribune), non un'approssimazione
    // a rettangolo per lato — quella lasciava buchi ovunque i pannelli
    // reali non arrivavano fino all'estremo scelto, e la palla ci passava
    // attraverso esattamente lì. Bounding box world-space letti
    // direttamente dagli accessor del GLTF, uno ad uno, tramite script
    // Node dedicato — non un motore fisico che legge la scena da solo
    this.WALL_RESTITUTION = 0.55
    this.wallBoxes = [
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

    // pali lampione: piccola AABB verticale su ognuna delle 4 posizioni
    // reali (stesse di lampPositions in main.js), non un cilindro vero —
    // approssimazione sufficiente per un oggetto sottile che la palla
    // colpisce di rado
    this.POLE_RESTITUTION = 0.55
    const POLE_HALF_WIDTH = 20
    const polePositionsXZ = [[615.87, -845], [615.87, 845], [-615.87, -845], [-615.87, 845]]
    this.poleBoxes = polePositionsXZ.map(([x, z]) => new THREE.Box3(
      new THREE.Vector3(x - POLE_HALF_WIDTH, 0, z - POLE_HALF_WIDTH),
      new THREE.Vector3(x + POLE_HALF_WIDTH, 300, z + POLE_HALF_WIDTH)
    ))

    // panchine: bounding box reale dell'intero sottoalbero 'bench_1'/
    // 'bench' nel GLTF (assi in legno + telaio), stesso procedimento di
    // muri/pali/backboard
    this.BENCH_RESTITUTION = 0.5
    this.benchBoxes = [
      new THREE.Box3(new THREE.Vector3(412, 0, 821), new THREE.Vector3(814, 50, 890)),
      new THREE.Box3(new THREE.Vector3(-815, 0, 822), new THREE.Vector3(-413, 50, 891)),
    ]

    // dopo un urto, quanto ignorare NUOVE collisioni CON LO STESSO
    // OGGETTO: la posizione viene già respinta esattamente al bordo del
    // volume espanso nello stesso passo (vedi resolveSphereBoxCollision),
    // quindi bastano pochi passi fisici perché la velocità riflessa la
    // allontani abbastanza da non essere ricatturata subito — non serve
    // una finestra lunga. PER OGGETTO (la cooldownMap passata a
    // resolve(), non posseduta qui): un'unica mappa globale sospendeva
    // TUTTE le collisioni dopo un rimbalzo qualsiasi (un rimbalzo sul
    // ferro seguito da un volo verso la backboard attraversava la
    // backboard). 0.3s (primo tentativo) era comunque troppo lungo:
    // backboard e ferro sono fisicamente vicini, un rimbalzo sul ferro
    // seguito a ruota da un ritorno verso la STESSA backboard (entro
    // 0.3s, tutt'altro che raro alle velocità di tiro in gioco) restava
    // comunque in cooldown su quell'oggetto specifico e ci passava
    // attraverso
    this.COLLISION_COOLDOWN = 0.05

    // scratch (riusati ad ogni chiamata, non riallocati) per la matematica
    // di resolveSphereBoxCollision/resolveSphereTorusCollision
    this._scratchBox = new THREE.Box3()
    this._scratchNormal = new THREE.Vector3()
    this._scratchRimPlanar = new THREE.Vector3()
    this._scratchRimNearest = new THREE.Vector3()
    this._scratchRimNormal = new THREE.Vector3()
  }

  // sfera (pallone) contro AABB, senza motore fisico: trova la faccia con
  // la penetrazione minore (quella da cui "conviene" uscire) e la tratta
  // come normale di contatto, poi riflette solo la componente di velocità
  // che va VERSO la superficie — v' = v - (1+restituzione)(v·n)n, la
  // formula standard di rimbalzo elastico/anelastico. Ritorna true se
  // c'è stata davvero una collisione (usato anche dalla preview di
  // traiettoria per sapere dove si ferma il tratto nero)
  resolveSphereBoxCollision(position, velocity, box, radius, restitution) {
    const scratchBox = this._scratchBox.copy(box).expandByScalar(radius)
    if (!scratchBox.containsPoint(position)) return false
    const dists = [
      position.x - scratchBox.min.x, scratchBox.max.x - position.x,
      position.y - scratchBox.min.y, scratchBox.max.y - position.y,
      position.z - scratchBox.min.z, scratchBox.max.z - position.z,
    ]
    let minIdx = 0
    for (let i = 1; i < 6; i++) if (dists[i] < dists[minIdx]) minIdx = i
    const axis = Math.floor(minIdx / 2) // 0=x, 1=y, 2=z
    const sign = minIdx % 2 === 0 ? -1 : 1 // faccia min → normale negativa, faccia max → positiva
    const normal = this._scratchNormal.set(0, 0, 0).setComponent(axis, sign)
    // spinge la palla esattamente sul bordo del volume espanso (risolve la
    // compenetrazione) lungo la normale di uscita
    position.addScaledVector(normal, dists[minIdx])
    const vDotN = velocity.dot(normal)
    if (vDotN < 0) velocity.addScaledVector(normal, -(1 + restitution) * vDotN)
    return true
  }

  // sfera contro toro (il ferro): il toro giace nel piano XZ, quindi si
  // proietta il centro palla sul cerchio principale (raggio ringRadius)
  // per trovare il punto più vicino sul "tubo" — da lì è di nuovo un urto
  // sfera-sfera (raggio tubeRadius + radius), stessa formula di riflessione
  resolveSphereTorusCollision(position, velocity, center, ringRadius, tubeRadius, radius, restitution) {
    const planar = this._scratchRimPlanar.set(position.x - center.x, 0, position.z - center.z)
    const planarDist = planar.length()
    if (planarDist < 1e-6) return false // esattamente sull'asse verticale del ferro: nessuna direzione radiale sensata
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

  // true se l'oggetto è ancora in cooldown (e ne scala il tempo residuo).
  // cooldownMap è passata da fuori (non un campo dell'istanza) perché la
  // preview di traiettoria simula un tiro IPOTETICO ogni frame mentre si
  // mira — se scrivesse nella stessa mappa del volo reale, un urto
  // simulato durante la sola mira "occuperebbe" il cooldown di un oggetto
  // prima ancora che il tiro vero parta
  isOnCooldown(obj, dt, cooldownMap) {
    const remaining = cooldownMap.get(obj)
    if (!remaining) return false
    const next = remaining - dt
    if (next > 0) { cooldownMap.set(obj, next); return true }
    cooldownMap.delete(obj)
    return false
  }

  // backboard/ferro/muri/pali/panchine: stesso identico giro di controlli
  // per il volo fisico reale E la preview di traiettoria — un nuovo tipo
  // di collidable va aggiunto qui una volta sola, non in due posti
  // separati. Ritorna true se almeno un urto è avvenuto in questa chiamata
  resolve(position, velocity, dt, cooldownMap, ballRadius) {
    let hit = false
    const resolveBox = (box, restitution) => {
      if (this.isOnCooldown(box, dt, cooldownMap)) return
      if (this.resolveSphereBoxCollision(position, velocity, box, ballRadius, restitution)) {
        hit = true
        cooldownMap.set(box, this.COLLISION_COOLDOWN)
      }
    }
    for (const box of this.backboardBoxes) resolveBox(box, this.BACKBOARD_RESTITUTION)
    for (const hoop of this.hoops) {
      if (this.isOnCooldown(hoop, dt, cooldownMap)) continue
      if (this.resolveSphereTorusCollision(position, velocity, hoop.center, RIM_RING_RADIUS, RIM_TUBE_RADIUS, ballRadius, this.RIM_RESTITUTION)) {
        hit = true
        cooldownMap.set(hoop, this.COLLISION_COOLDOWN)
      }
    }
    // muri e pali: oggetti rigidi, restituzione più viva della backboard
    // (che è smorzata apposta)
    for (const box of this.wallBoxes) resolveBox(box, this.WALL_RESTITUTION)
    for (const box of this.poleBoxes) resolveBox(box, this.POLE_RESTITUTION)
    for (const box of this.benchBoxes) resolveBox(box, this.BENCH_RESTITUTION)
    return hit
  }
}
