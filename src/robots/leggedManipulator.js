import * as THREE from 'three'
import { createProceduralPBRMaps, drawBrushedMetal, drawOrganicGrain } from './manipulator.js'

// Classe LEGGED MANIPULATOR: stesso modello del MANIPULATOR a ruote (stesso
// disco, stesso manipolatore 3R per palleggio/tiro — quella parte non
// cambia, letteralmente lo stesso codice), 25% più grande nel complesso
// (manipulatorScale), con le ruote sostituite da 4 gambe. Ogni gamba è un
// braccio R2 (anca + ginocchio, entrambi pitch attorno a un asse orizzontale
// — niente terzo giunto/polso, non serve: l'end effector non impugna nulla)
// che termina in un piede: un plane piatto con lo snodo sul bordo (non al
// centro), come una vera caviglia attaccata al retro della pianta del piede
// invece che al centro della suola. Lunghezza dei link di gamba = 35% dei
// link del braccio 3R (coscia da link1Length, stinco da link2Length) —
// un rapporto di design, non un vincolo live: i default sono numeri fissi
// calcolati una volta, non ricalcolati se il braccio cambia da debug panel
// (stesso principio di MANIPULATOR: i suoi numeri erano anch'essi tarati a
// occhio e poi congelati come default).
//
// wheelsGroup/controls.setWheelsYaw: il resto del gioco (main.js/EnemyAI.js/
// CombatMoves.js) orienta la locomozione tramite queste chiavi generiche
// (vedi RobotBase.updateLocomotionAnimation) assumendo un solo gruppo
// rigido da ruotare — qui la chiave "wheelsGroup" punta al gruppo delle
// gambe (`legsGroup`), non a delle ruote vere: stesso contratto, interno
// diverso. Finché le gambe non hanno un vero ciclo di passo (Section 4:
// Animation Tweaks), l'intero gruppo pivota rigidamente verso la direzione
// di marcia — un placeholder onesto, non un vero "cammino", ma visivamente
// comprensibile e a costo zero rispetto a MANIPULATOR.
export function createLeggedManipulatorRobot() {
  const root = new THREE.Group()

  // stessi materiali/texture procedurali di MANIPULATOR (stessa famiglia
  // visiva) + un materiale gomma dedicato ai piedi (stesso pattern di
  // wheelMat, riusa drawOrganicGrain esportata da manipulator.js)
  const bodyMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 350), baseRoughness: 0.5, roughnessVariation: 0.12 })
  const legMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 550), baseRoughness: 0.4, roughnessVariation: 0.1 })
  const footMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawOrganicGrain(ctx, s, 900, 2.5), baseRoughness: 0.85, roughnessVariation: 0.15 })
  const armMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 550), baseRoughness: 0.4, roughnessVariation: 0.1 })
  const accentMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawOrganicGrain(ctx, s, 1400, 1.4), baseRoughness: 0.3, roughnessVariation: 0.1 })

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.4, normalMap: bodyMaps.normalMap, roughnessMap: bodyMaps.roughnessMap })
  const legMat = new THREE.MeshStandardMaterial({ color: 0x515a63, roughness: 0.4, metalness: 0.5, normalMap: legMaps.normalMap, roughnessMap: legMaps.roughnessMap })
  const footMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85, metalness: 0.1, normalMap: footMaps.normalMap, roughnessMap: footMaps.roughnessMap })
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.4, metalness: 0.5, normalMap: armMaps.normalMap, roughnessMap: armMaps.roughnessMap })
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xe8942c, roughness: 0.3, metalness: 0.3, normalMap: accentMaps.normalMap, roughnessMap: accentMaps.roughnessMap })

  // stato: stessi campi/stessi default di MANIPULATOR per disco+braccio 3R
  // (vedi manipulator.js — "stesso modello"), manipulatorScale 25% più
  // grande (45 * 1.25), più i campi dedicati alle gambe
  const state = {
    manipulatorScale: 56.25, // 45 * 1.25 — 25% più grande dell'AMR, "stesso modello"
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

  // --- Gambe: 4 bracci R2 (anca+ginocchio) al posto delle ruote ---
  // stessi offset X/Z usati dalle ruote di MANIPULATOR (stessa "impronta a
  // terra"), lunghezza link = 35% dei link del braccio 3R sopra
  const LEG_OFFSET_X = 0.9
  const LEG_OFFSET_Z = 0.9
  const legLink1Length = state.link1Length * 0.35 // coscia
  const legLink2Length = state.link2Length * 0.35 // stinco
  const legLink1Thickness = 0.16
  const legLink2Thickness = 0.14
  const legJointRadius = 0.16
  // anca inclinata quasi verticale verso il basso (150°: 0° sarebbe "su",
  // 180° dritta in giù) — leggero splay per stabilità visiva; ginocchio la
  // richiude parzialmente (-30°) verso la verticale, "zampa" invece di
  // "bastone dritto". Angoli di riposo fissi per ora (nessuna animazione di
  // passo, vedi commento in cima al file) — quando arriverà un vero ciclo
  // di camminata questi diventano il punto di partenza dell'interpolazione
  const HIP_REST_PITCH = THREE.MathUtils.degToRad(150)
  const KNEE_REST_PITCH = THREE.MathUtils.degToRad(-30)

  function makeLinkGeometry(length, thickness) {
    const geo = new THREE.BoxGeometry(thickness, length, thickness)
    geo.translate(0, length / 2, 0) // pivot all'estremità superiore (anca/ginocchio)
    return geo
  }

  // altezza (world, pre-manipulatorScale) da dove si aggancia l'anca fino a
  // terra, derivata dalla vera geometria delle gambe (coscia+stinco alla
  // loro posa di riposo) — MAI un valore fisso a occhio, stesso principio
  // di syncChassisHeight in manipulator.js (lì derivato dal raggio ruota)
  function computeStandHeight() {
    return legLink1Length * -Math.cos(HIP_REST_PITCH)
      + legLink2Length * -Math.cos(HIP_REST_PITCH + KNEE_REST_PITCH)
  }
  const standHeight = computeStandHeight()

  const legsGroup = new THREE.Group()
  const feet = []
  ;[
    [-LEG_OFFSET_X, -LEG_OFFSET_Z],
    [LEG_OFFSET_X, -LEG_OFFSET_Z],
    [-LEG_OFFSET_X, LEG_OFFSET_Z],
    [LEG_OFFSET_X, LEG_OFFSET_Z],
  ].forEach(([x, z]) => {
    // orientamento fisso verso l'esterno (stesso verso di angleToForward:
    // yaw=0 → +Z), così anca/ginocchio (che ruotano solo su X, come
    // gomito/polso del braccio 3R) piegano la gamba radialmente lontano dal
    // corpo invece che tutte nella stessa direzione assoluta — 4 gambe che
    // sembrano davvero irradiarsi dai 4 angoli, non 4 copie identiche
    const outwardYaw = Math.atan2(x, z)
    const hipYaw = new THREE.Group()
    hipYaw.position.set(x, standHeight, z)
    hipYaw.rotation.y = outwardYaw
    legsGroup.add(hipYaw)

    // R2 primo giunto: anca, pitch
    const hip = new THREE.Group()
    hip.rotation.x = HIP_REST_PITCH
    hipYaw.add(hip)
    const hipJoint = new THREE.Mesh(new THREE.SphereGeometry(legJointRadius, 14, 14), legMat)
    hip.add(hipJoint)
    const thigh = new THREE.Mesh(makeLinkGeometry(legLink1Length, legLink1Thickness), legMat)
    hip.add(thigh)

    // R2 secondo giunto: ginocchio, pitch (si somma all'anca, stesso asse —
    // identico principio del gomito/polso del braccio 3R)
    const knee = new THREE.Group()
    knee.position.y = legLink1Length
    knee.rotation.x = KNEE_REST_PITCH
    hip.add(knee)
    const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(legJointRadius * 0.85, 14, 14), legMat)
    knee.add(kneeJoint)
    const shin = new THREE.Mesh(makeLinkGeometry(legLink2Length, legLink2Thickness), legMat)
    knee.add(shin)

    // Piede: plane piatto (BoxGeometry sottile, non PlaneGeometry — stesso
    // stile del resto del robot, dà anche un minimo di spessore/volto per
    // l'ombreggiatura) con lo snodo (caviglia) sul BORDO invece che al
    // centro — stessa tecnica del paddle in manipulator.js
    // (geo.translate sul bordo lungo): la caviglia sta al centro del lato
    // corto "posteriore", la pianta si estende in avanti da lì, come un
    // vero piede invece di un disco centrato sotto la caviglia
    const footLength = 0.55
    const footWidth = 0.32
    const footThickness = 0.04
    const footGeo = new THREE.BoxGeometry(footWidth, footThickness, footLength)
    footGeo.translate(0, 0, footLength / 2)
    const ankle = new THREE.Group()
    ankle.position.y = legLink2Length
    // livella il piede rispetto al cumulo di pitch anca+ginocchio (stesso
    // principio di levelPaddle() in manipulator.js: le rotazioni sullo
    // stesso asse si sommano lungo la catena, senza contro-rotazione la
    // pianta erediterebbe l'inclinazione invece di restare piatta a terra)
    ankle.rotation.x = -(HIP_REST_PITCH + KNEE_REST_PITCH)
    knee.add(ankle)
    const foot = new THREE.Mesh(footGeo, footMat)
    ankle.add(foot)
    feet.push(foot)
  })
  root.add(legsGroup)

  // --- Chassis: identico a MANIPULATOR (stesso modello) ---
  const discHeight = 0.1875
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(state.discRadius, state.discRadius, discHeight, 32),
    bodyMat
  )
  root.add(disc)

  // --- Manipolatore 3R sul disco: stesso codice di MANIPULATOR, invariato
  // (stesso modello — solo le gambe sotto cambiano) ---
  const jointRadius = 0.22

  const base = new THREE.Group()
  root.add(base)

  const baseJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 16, 16), armMat)
  base.add(baseJoint)

  function makeTaperedLinkGeometry(length, baseThickness, tipThickness) {
    const rBase = baseThickness / Math.SQRT2
    const rTip = tipThickness / Math.SQRT2
    const geo = new THREE.CylinderGeometry(rTip, rBase, length, 4)
    geo.rotateY(Math.PI / 4)
    geo.translate(0, length / 2, 0)
    return geo
  }

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
  function effectivePaddleAngle() {
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

  // --- Scala/altezza gambe: stesso principio di applyWheelsGroupScale/
  // syncChassisHeight in manipulator.js, derivato dalla vera geometria
  // delle gambe (standHeight) invece di un valore fisso ---
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

  function replaceGeometry(mesh, newGeo) {
    mesh.geometry.dispose()
    mesh.geometry = newGeo
  }
  function makeScaleSetter(key, mesh) {
    return s => {
      state[key] = s
      mesh.scale.setScalar(s)
    }
  }
  function createLinkControls({ statePrefix, mesh, downstreamJoint, buildGeometry, thicknessNames }) {
    const lengthKey = `${statePrefix}Length`
    function rebuild() {
      const thicknessArgs = thicknessNames.map(name => state[`${statePrefix}${name}`])
      replaceGeometry(mesh, buildGeometry(state[lengthKey], ...thicknessArgs))
    }
    const linkControls = {
      [`${statePrefix}Scale`]: makeScaleSetter(`${statePrefix}Scale`, mesh),
      [lengthKey](l) {
        state[lengthKey] = l
        rebuild()
        downstreamJoint.position.y = l
      },
    }
    thicknessNames.forEach(name => {
      linkControls[`${statePrefix}${name}`] = t => {
        state[`${statePrefix}${name}`] = t
        rebuild()
      }
    })
    return linkControls
  }

  const controls = {
    manipulatorScale: makeScaleSetter('manipulatorScale', root),
    legsScale(s) {
      state.legsScale = s
      applyLegsGroupScale()
      syncChassisHeight()
    },
    discScale: makeScaleSetter('discScale', disc),
    discRadius(r) {
      state.discRadius = r
      replaceGeometry(disc, new THREE.CylinderGeometry(r, r, discHeight, 32))
      applyLegsGroupScale()
      syncChassisHeight()
    },
    ...createLinkControls({
      statePrefix: 'link1', mesh: link1, downstreamJoint: elbow,
      buildGeometry: makeLinkGeometry, thicknessNames: ['Thickness'],
    }),
    ...createLinkControls({
      statePrefix: 'link2', mesh: link2, downstreamJoint: wrist,
      buildGeometry: makeTaperedLinkGeometry, thicknessNames: ['Thickness', 'TipThickness'],
    }),
    baseJointScale: makeScaleSetter('baseJointScale', baseJoint),
    elbowJointScale: makeScaleSetter('elbowJointScale', elbowJoint),
    endEffectorScale: makeScaleSetter('endEffectorScale', endEffector),

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
    // wheelsGroup è concettualmente legsGroup qui — vedi commento in cima
    // al file sul perché il nome resta "Wheels" (contratto condiviso con
    // RobotBase.updateLocomotionAnimation/main.js/EnemyAI.js/CombatMoves.js)
    setWheelsYaw(angle) {
      legsGroup.rotation.y = angle
    },
  }

  controls.discScale(state.discScale)
  controls.link1Scale(state.link1Scale)
  controls.link2Scale(state.link2Scale)
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
    // vedi commento sopra su controls.setWheelsYaw: stessa chiave, punta
    // alle gambe invece che a delle ruote
    wheelsGroup: legsGroup,
    joints: { base, elbow, wrist },
    paddle: paddleCenter,
    ballRestPoint,
    controls,
    getConfig,
    getPaddleTilt,
  }
}
