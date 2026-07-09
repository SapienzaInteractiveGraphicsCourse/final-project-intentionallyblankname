import * as THREE from 'three'
import { createProceduralPBRMaps, drawBrushedMetal, drawOrganicGrain } from './manipulator.js'

// Classe DRONE: locomozione a volo (4 rotori), manipolatore 3R identico a
// MANIPULATOR ma ROVESCIATO — appeso sotto il corpo invece che sopra un
// disco, per palleggiare/tirare mentre il drone plana sopra la palla.
// Corpo/bracci-rotore/gambe d'atterraggio ispirati allo scouting su
// `robot_factory` (vedi README → "Confronto con Altri Progetti"): il loro
// drone da magazzino ha lo stesso schema — corpo a scatole, bracci sottili
// verso 4 pivot con anello paraelica + pale a X che girano DAVVERO
// (`pivot.rotation.y += delta*speed`, verso alternato tra rotori adiacenti
// per il momento torcente contrapposto, realistico), pattini di atterraggio
// a barre. Qui rifatto con le texture procedurali PBR del progetto (non i
// materiali a tinta piatta dell'originale) e senza il rig di carico —
// sostituito dal nostro braccio.
//
// Braccio ROVESCIATO: `armFlip` è un unico gruppo con rotation.x = π FISSO,
// inserito tra `base` (yaw, normale) e `link1Group` (identico a
// manipulator.js, mai riscritto) — flip dell'INTERA sotto-gerarchia in un
// solo punto della catena invece di ridiscutere il segno di ogni angolo di
// riposo a mano: la yaw (sul genitore `base`, MAI flippato) ruota quindi
// esattamente come per gli altri robot (nessun mirroring), mentre tutto
// ciò che sta sotto `armFlip` eredita l'inversione in blocco, restando
// internamente coerente perché è lo stesso identico codice/stessi angoli
// relativi di manipulator.js — semplicemente capovolto in massa.
//
// wheelsGroup (stesso contratto di leggedManipulator.js — vedi commento
// lì): qui punta al CORPO del drone (bodyGroup), non a ruote/gambe. Yaw =
// orientamento di volo. DroneRobot (RobotBase subclass) sovrascrive
// updateLocomotionAnimation per far girare DAVVERO le eliche ad ogni frame
// (non solo quando ci si muove) e un piccolo bank/inclinazione in virata —
// "walking animation" del drone: non cammina, si inclina e le pale girano.
export function createDroneRobot() {
  const root = new THREE.Group()

  const bodyMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 350), baseRoughness: 0.35, roughnessVariation: 0.1 })
  const armMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 550), baseRoughness: 0.4, roughnessVariation: 0.1 })
  const accentMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawOrganicGrain(ctx, s, 1400, 1.4), baseRoughness: 0.3, roughnessVariation: 0.1 })
  const skidMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawOrganicGrain(ctx, s, 900, 2.5), baseRoughness: 0.85, roughnessVariation: 0.15 })

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.35, metalness: 0.6, normalMap: bodyMaps.normalMap, roughnessMap: bodyMaps.roughnessMap })
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.4, metalness: 0.5, normalMap: armMaps.normalMap, roughnessMap: armMaps.roughnessMap })
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xe8942c, roughness: 0.3, metalness: 0.3, normalMap: accentMaps.normalMap, roughnessMap: accentMaps.roughnessMap })
  const skidMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85, metalness: 0.1, normalMap: skidMaps.normalMap, roughnessMap: skidMaps.roughnessMap })
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

  // --- Corpo: scafo + canopy, ispirato a robot_factory ma coi materiali
  // procedurali del progetto invece di tinte piatte ---
  const bodyGroup = new THREE.Group()
  root.add(bodyGroup)

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 1.1), bodyMat)
  bodyGroup.add(hull)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.28, 0.66), accentMat)
  canopy.position.set(0.1, 0.24, 0)
  bodyGroup.add(canopy)
  const noseLight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), glowMat)
  noseLight.position.set(0.92, 0, 0)
  bodyGroup.add(noseLight)

  // --- 4 bracci-rotore: braccio sottile (pipe) + pivot con anello
  // paraelica + pale a X + mozzo motore — stesso schema di robot_factory ---
  const ARM_OFFSET_X = 1.1
  const ARM_OFFSET_Z = 1.1
  const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8)
  const rotorPivots = []
  ;[
    [-ARM_OFFSET_X, -ARM_OFFSET_Z],
    [ARM_OFFSET_X, -ARM_OFFSET_Z],
    [-ARM_OFFSET_X, ARM_OFFSET_Z],
    [ARM_OFFSET_X, ARM_OFFSET_Z],
  ].forEach(([x, z]) => {
    // braccio: cilindro orizzontale dal centro al pivot, orientato lungo
    // la propria direzione (ruotato/scalato invece di ricalcolare i
    // vertici) — CylinderGeometry nasce verticale (asse Y), va ruotato per
    // giacere lungo il segmento centro→pivot
    const armLength = Math.hypot(x, z)
    const arm = new THREE.Mesh(armGeo, armMat)
    arm.scale.y = armLength
    arm.position.set(x / 2, 0, z / 2)
    arm.rotation.z = Math.PI / 2
    arm.rotation.y = Math.atan2(x, z) + Math.PI / 2
    bodyGroup.add(arm)

    const pivot = new THREE.Group()
    pivot.position.set(x, 0.06, z)
    bodyGroup.add(pivot)
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 10, 24), armMat)
    guard.rotation.x = Math.PI / 2
    pivot.add(guard)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12), armMat)
    pivot.add(hub)
    // pale a X: due box sottili incrociati, stesso schema di robot_factory
    // (non gira solo l'anello, girano davvero le pale — DroneRobot lo anima)
    const bladeGeo = new THREE.BoxGeometry(0.6, 0.02, 0.05)
    const bladeA = new THREE.Mesh(bladeGeo, accentMat)
    bladeA.position.y = 0.06
    pivot.add(bladeA)
    const bladeB = new THREE.Mesh(bladeGeo, accentMat)
    bladeB.position.y = 0.06
    bladeB.rotation.y = Math.PI / 2
    pivot.add(bladeB)
    rotorPivots.push(pivot)
  })

  // --- Gambe/pattini di atterraggio: 2 barre orizzontali + 4 montanti,
  // stesso schema di robot_factory (skid, non zampe articolate: il drone
  // non cammina) ---
  const skidGroup = new THREE.Group()
  bodyGroup.add(skidGroup)
  const strutGeo = new THREE.BoxGeometry(0.06, 0.55, 0.05)
  ;[[-0.5, -0.35], [0.5, -0.35], [-0.5, 0.35], [0.5, 0.35]].forEach(([x, z]) => {
    const strut = new THREE.Mesh(strutGeo, skidMat)
    strut.position.set(x, -0.475, z)
    skidGroup.add(strut)
  })
  const skidBarGeo = new THREE.BoxGeometry(1.1, 0.045, 0.06)
  ;[-0.35, 0.35].forEach(z => {
    const bar = new THREE.Mesh(skidBarGeo, skidMat)
    bar.position.set(0, -0.75, z)
    skidGroup.add(bar)
  })
  // altezza reale dei pattini da terra (bordo inferiore della barra),
  // stesso principio di syncChassisHeight in manipulator.js — mai un
  // valore fisso indovinato, ricalcolato dalla vera geometria. bodyGroup
  // (root del drone, y=0 per convenzione di gioco = terra) viene spostato
  // in su di questa quantità così i pattini toccano terra invece di
  // sprofondarci — root stesso resta a y=0 come per gli altri robot
  const SKID_BOTTOM_Y = 0.75 + 0.045 / 2
  bodyGroup.position.y = SKID_BOTTOM_Y

  // --- Manipolatore 3R rovesciato: stesso codice di manipulator.js,
  // invariato, appeso sotto il corpo tramite armFlip (vedi commento in
  // cima al file) ---
  const jointRadius = 0.22
  const base = new THREE.Group()
  base.position.y = -0.2 // attacco appena sotto il corpo
  bodyGroup.add(base)

  // UNICO punto di inversione: rotation.x = π fisso, mai più toccato. La
  // yaw (su `base`, sopra) resta un vero giro attorno all'asse verticale
  // del mondo — nessun mirroring, solo tutto ciò che sta sotto è capovolto
  const armFlip = new THREE.Group()
  armFlip.rotation.x = Math.PI
  base.add(armFlip)

  const baseJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 16, 16), armMat)
  armFlip.add(baseJoint)

  function makeLinkGeometry(length, thickness) {
    const geo = new THREE.BoxGeometry(thickness, length, thickness)
    geo.translate(0, length / 2, 0)
    return geo
  }
  function makeTaperedLinkGeometry(length, baseThickness, tipThickness) {
    const rBase = baseThickness / Math.SQRT2
    const rTip = tipThickness / Math.SQRT2
    const geo = new THREE.CylinderGeometry(rTip, rBase, length, 4)
    geo.rotateY(Math.PI / 4)
    geo.translate(0, length / 2, 0)
    return geo
  }

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

  function replaceGeometry(mesh, newGeo) {
    mesh.geometry.dispose()
    mesh.geometry = newGeo
  }
  function makeScaleSetter(key, mesh) {
    return s => { state[key] = s; mesh.scale.setScalar(s) }
  }
  function createLinkControls({ statePrefix, mesh, downstreamJoint, buildGeometry, thicknessNames }) {
    const lengthKey = `${statePrefix}Length`
    function rebuild() {
      const thicknessArgs = thicknessNames.map(name => state[`${statePrefix}${name}`])
      replaceGeometry(mesh, buildGeometry(state[lengthKey], ...thicknessArgs))
    }
    const linkControls = {
      [`${statePrefix}Scale`]: makeScaleSetter(`${statePrefix}Scale`, mesh),
      [lengthKey](l) { state[lengthKey] = l; rebuild(); downstreamJoint.position.y = l },
    }
    thicknessNames.forEach(name => {
      linkControls[`${statePrefix}${name}`] = t => { state[`${statePrefix}${name}`] = t; rebuild() }
    })
    return linkControls
  }

  // rotazione propeller: fase indipendente per pivot, avanzata da
  // DroneRobot.updateLocomotionAnimation ad ogni frame (mai in pausa,
  // anche da fermo — un drone acceso tiene le eliche in moto)
  function spinRotors(dt, speed) {
    rotorPivots.forEach((pivot, i) => { pivot.rotation.y += dt * speed * (i % 2 === 0 ? 1 : -1) })
  }

  const controls = {
    manipulatorScale: makeScaleSetter('manipulatorScale', root),
    ...createLinkControls({ statePrefix: 'link1', mesh: link1, downstreamJoint: elbow, buildGeometry: makeLinkGeometry, thicknessNames: ['Thickness'] }),
    ...createLinkControls({ statePrefix: 'link2', mesh: link2, downstreamJoint: wrist, buildGeometry: makeTaperedLinkGeometry, thicknessNames: ['Thickness', 'TipThickness'] }),
    baseJointScale: makeScaleSetter('baseJointScale', baseJoint),
    elbowJointScale: makeScaleSetter('elbowJointScale', elbowJoint),
    endEffectorScale: makeScaleSetter('endEffectorScale', endEffector),
    setAimYaw(angle) { base.rotation.y = angle },
    setAimPitch(pitchOffset) { aimPitchOffset = pitchOffset; applyArmPitch() },
    setDribbleOffsets(elbowOffset, link1Offset) {
      dribbleElbowOffset = elbowOffset
      link1Group.rotation.x = link1Offset
      applyArmPitch()
    },
    setGrip(offset) { gripOffset = offset; applyPaddleAngle() },
    setShootTilt(offset) { shootTiltOffset = offset; levelPaddle() },
    setBallRestOffset(extra) { ballRestExtraOffset = extra; updatePaddleCenter() },
    paddleAngle(a) { state.paddleAngle = a; applyPaddleAngle(); updatePaddleCenter() },
    paddleTilt(angle) { state.paddleTilt = angle; levelPaddle() },
    // wheelsGroup qui è il CORPO (vedi commento in cima al file): yaw =
    // orientamento di volo, non c'entrano ruote/gambe
    setWheelsYaw(angle) { bodyGroup.rotation.y = angle },
    // bank/inclinazione in virata — chiamato da DroneRobot, non tracciato
    // in state/Copy Config: è posa, non forma
    setBank(angle) { bodyGroup.rotation.z = angle },
    spinRotors,
  }

  controls.link1Scale(state.link1Scale)
  controls.link2Scale(state.link2Scale)
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
    skidBottomY: SKID_BOTTOM_Y,
  }
}
