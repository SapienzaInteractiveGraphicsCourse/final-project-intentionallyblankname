import * as THREE from 'three'

// Classe MANIPULATOR: locomozione a ruote, manipolatore 3R sopra un disco.
// R1 (base) ruota su asse verticale (yaw). R2/R3 (gomito/polso) ruotano
// su asse orizzontale (pitch), come un braccio planare montato su una
// base rotante. Bracci dimensionati per sporgere oltre il bordo del
// disco a riposo, per poter palleggiare senza scontrarsi con lo chassis.
//
// Geometrie non ridimensionabili "in place" in Three.js: length/thickness/
// radius vanno ricostruite (dispose + nuova geometry) a ogni cambio. La
// posizione dei giunti a valle (gomito/polso) dipende dalla lunghezza del
// link a monte e va ricalcolata quando questa cambia.
export function createManipulatorRobot() {
  const root = new THREE.Group()

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.4 })
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.1 })
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.4, metalness: 0.5 })
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xe8942c, roughness: 0.3, metalness: 0.3 })

  // stato corrente dei parametri modificabili da debug, usato sia per
  // ricostruire le geometrie sia per COPY config. Valori di partenza presi
  // da "Copy config" dopo tuning visivo via pannello DEBUG (tasto P)
  const state = {
    manipulatorScale: 45,
    wheelsScale: 0.55,
    discScale: 0.9,
    discRadius: 1,
    link1Scale: 1,
    link1Length: 1.8,
    link1Thickness: 0.18,
    link2Scale: 1,
    link2Length: 1.5,
    link2Thickness: 0.17,      // spessore alla base (lato gomito)
    link2TipThickness: 0.05,   // spessore in punta (lato polso) — trapezoidale, molto più sottile della base
    baseJointScale: 1,
    elbowJointScale: 0.75,
    endEffectorScale: 0.25,
  }
  const INITIAL_DISC_RADIUS = state.discRadius

  // --- Ruote: 4 mini tori neri verticali, in gruppo (relative al disco) ---
  // il toro giace nel piano XY (centro→bordo esterno = wheelRadius+wheelTube
  // in ogni direzione), quindi il centro va messo a raggio esterno da terra
  // perché il bordo inferiore tocchi y=0, non a wheelRadius da solo
  const wheelRadius = 0.4
  const wheelTube = 0.15
  const wheelOuterRadius = wheelRadius + wheelTube
  const wheelGeo = new THREE.TorusGeometry(wheelRadius, wheelTube, 12, 24)
  const wheelOffsetX = 0.9
  const wheelOffsetZ = 0.9
  const wheelsGroup = new THREE.Group()
  const wheels = []
  ;[
    [-wheelOffsetX, -wheelOffsetZ],
    [wheelOffsetX, -wheelOffsetZ],
    [-wheelOffsetX, wheelOffsetZ],
    [wheelOffsetX, wheelOffsetZ],
  ].forEach(([x, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat)
    wheel.position.set(x, wheelOuterRadius, z)
    wheelsGroup.add(wheel)
    wheels.push(wheel)
  })
  root.add(wheelsGroup)

  // --- Chassis: piattaforma a disco sopra le ruote ---
  const discHeight = 0.1875 // 75% di 0.25
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(state.discRadius, state.discRadius, discHeight, 32),
    bodyMat
  )
  root.add(disc)

  // --- Manipolatore 3R sul disco ---
  const jointRadius = 0.22

  // R1: base del manipolatore, yaw attorno a Y, in cima al disco
  // (position.y assegnata più sotto da syncChassisHeight, dipende dalla
  // scala effettiva delle ruote)
  const base = new THREE.Group()
  root.add(base)

  const baseJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 16, 16), armMat)
  base.add(baseJoint)

  function makeLinkGeometry(length, thickness) {
    const geo = new THREE.BoxGeometry(thickness, length, thickness)
    geo.translate(0, length / 2, 0) // pivot all'estremità inferiore
    return geo
  }

  // link rastremato (base ≠ punta): CylinderGeometry con radialSegments=4
  // è un prisma a base quadrata invece che rotondo; top/bottom radius
  // diversi = tronco di piramide, cioè un parallelepipedo trapezoidale.
  // radius = thickness/√2 per far coincidere la larghezza faccia-a-faccia
  // (non spigolo-a-spigolo) con lo spessore, coerente col BoxGeometry
  function makeTaperedLinkGeometry(length, baseThickness, tipThickness) {
    const rBase = baseThickness / Math.SQRT2
    const rTip = tipThickness / Math.SQRT2
    const geo = new THREE.CylinderGeometry(rTip, rBase, length, 4)
    geo.rotateY(Math.PI / 4) // allinea le facce piatte agli assi X/Z
    geo.translate(0, length / 2, 0) // pivot all'estremità inferiore (base)
    return geo
  }

  const link1 = new THREE.Mesh(makeLinkGeometry(state.link1Length, state.link1Thickness), armMat)
  base.add(link1)

  // R2: gomito, pitch attorno a X, all'estremità del link1
  // rest pose: braccio piegato in avanti così sporge oltre il disco
  const ELBOW_REST_PITCH = Math.PI / 2.4
  const elbow = new THREE.Group()
  elbow.position.y = state.link1Length
  elbow.rotation.x = ELBOW_REST_PITCH
  base.add(elbow)

  const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius * 0.85, 16, 16), armMat)
  elbow.add(elbowJoint)

  const link2 = new THREE.Mesh(
    makeTaperedLinkGeometry(state.link2Length, state.link2Thickness, state.link2TipThickness),
    armMat
  )
  elbow.add(link2)

  // R3: polso, pitch attorno a X, all'estremità del link2
  const WRIST_REST_PITCH = -Math.PI / 6
  const wrist = new THREE.Group()
  wrist.position.y = state.link2Length
  wrist.rotation.x = WRIST_REST_PITCH
  elbow.add(wrist)

  // End effector: sfera (placeholder giunto finale) + piccola paletta
  const endEffector = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), accentMat)
  wrist.add(endEffector)

  const paddleWidth = 0.35 // lato corto (Z)
  const paddleGeo = new THREE.BoxGeometry(0.5, 0.05, paddleWidth)
  // sposta il pivot dal centro della paletta al centro del lato lungo
  // (bordo Z), così la sfera end-effector risulta attaccata lì, non al
  // centro della paletta — segno positivo: la paletta si estende verso
  // l'esterno del braccio, non verso il corpo del robot
  paddleGeo.translate(0, 0, paddleWidth / 2)
  const paddle = new THREE.Mesh(paddleGeo, accentMat)
  // gomito e polso ruotano sullo stesso asse (X) quindi i pitch si
  // sommano: senza contro-rotazione la paletta erediterebbe l'inclinazione
  // netta del braccio invece di restare piatta/orizzontale, pronta a
  // palleggiare
  paddle.rotation.x = -(ELBOW_REST_PITCH + WRIST_REST_PITCH)
  // nessun offset di posizione: il pivot (ora sul bordo lungo) coincide
  // con l'end effector, così la sfera è connessa lì
  wrist.add(paddle)

  // combina scala manuale ruote × rapporto raggio disco/iniziale, così le
  // ruote seguono automaticamente l'espansione/contrazione del disco
  function applyWheelsGroupScale() {
    wheelsGroup.scale.setScalar(state.wheelsScale * (state.discRadius / INITIAL_DISC_RADIUS))
  }

  // il disco deve appoggiare sul bordo superiore reale delle ruote: dato
  // che wheelsGroup ha una propria scala (regolabile da debug), l'altezza
  // delle ruote non è più un valore fisso — va ricalcolata ogni volta che
  // cambia la scala del gruppo ruote, altrimenti disco/ruote si staccano
  function syncChassisHeight() {
    // centro ruota a wheelOuterRadius da terra + estensione verso l'alto
    // pari a wheelOuterRadius = bordo superiore reale del toro
    const wheelTopLocal = wheelOuterRadius * 2
    const wheelTopWorld = wheelTopLocal * wheelsGroup.scale.y
    // leggera compenetrazione nel disco (35% dello spessore) per un
    // aggancio più solido, senza sbucare sopra (35% < 100% = resta margine)
    const embed = discHeight * 0.35
    const discY = wheelTopWorld + discHeight / 2 - embed
    disc.position.y = discY
    base.position.y = discY + discHeight / 2
  }

  // ruote/chassis agganciati subito alla scala iniziale (le altre parti si
  // auto-applicano più sotto, richiamando i setter di controls)
  applyWheelsGroupScale()
  syncChassisHeight()

  // dispose + riassegna: le geometrie non sono ridimensionabili "in place"
  function replaceGeometry(mesh, newGeo) {
    mesh.geometry.dispose()
    mesh.geometry = newGeo
  }

  // setter "scale" generico: stessa forma per disc/link1/link2/giunti,
  // cambia solo la state-key e la mesh target
  function makeScaleSetter(key, mesh) {
    return s => {
      state[key] = s
      mesh.scale.setScalar(s)
    }
  }

  // genera Scale/Length/Thickness(+TipThickness) per un link, parametrico
  // su mesh, funzione di geometria e giunto a valle da riposizionare —
  // link1 e link2 differiscono solo per questi 4 argomenti
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
    wheelsScale(s) {
      state.wheelsScale = s
      applyWheelsGroupScale()
      syncChassisHeight()
    },
    discScale: makeScaleSetter('discScale', disc),
    discRadius(r) {
      state.discRadius = r
      replaceGeometry(disc, new THREE.CylinderGeometry(r, r, discHeight, 32))
      applyWheelsGroupScale()
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

    // --- Posa (mira/sterzata), non tracciata in state: cambia ogni frame,
    // non è pensata per "Copy config" come le dimensioni sopra ---
    setAimYaw(angle) {
      base.rotation.y = angle
    },
    // offset di pitch relativo al riposo: la cinematica (gomito+polso sullo
    // stesso asse si sommano, la paletta va rilivellata di conseguenza)
    // resta qui, invece che duplicata anche in main.js
    setAimPitch(pitchOffset) {
      elbow.rotation.x = ELBOW_REST_PITCH + pitchOffset
      paddle.rotation.x = -(elbow.rotation.x + WRIST_REST_PITCH)
    },
    setWheelsYaw(angle) {
      wheelsGroup.rotation.y = angle
    },
  }

  // applica gli scale iniziali (disc/link1/link2/giunti) richiamando gli
  // stessi setter esposti in controls, invece di duplicarne la logica
  controls.discScale(state.discScale)
  controls.link1Scale(state.link1Scale)
  controls.link2Scale(state.link2Scale)
  controls.baseJointScale(state.baseJointScale)
  controls.elbowJointScale(state.elbowJointScale)
  controls.endEffectorScale(state.endEffectorScale)

  function getConfig() {
    return { ...state }
  }

  return {
    root,
    wheels,
    wheelsGroup,
    disc,
    link1,
    link2,
    joints: { base, elbow, wrist },
    endEffector,
    paddle,
    controls,
    getConfig,
  }
}
