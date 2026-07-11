import * as THREE from 'three'
import { createProceduralPBRMaps, drawBrushedMetal, drawOrganicGrain, createArmAccentMaterials } from './AMRManipulatorModelMaker.js'
import { makeScaleSetter, makeLinkGeometry, makeTaperedLinkGeometry, createLinkControls, createColorControls } from './geometryControlHelpers.js'

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
// AMRManipulatorModelMaker.js, mai riscritto) — flip dell'INTERA sotto-gerarchia in un
// solo punto della catena invece di ridiscutere il segno di ogni angolo di
// riposo a mano: la yaw (sul genitore `base`, MAI flippato) ruota quindi
// esattamente come per gli altri robot (nessun mirroring), mentre tutto
// ciò che sta sotto `armFlip` eredita l'inversione in blocco, restando
// internamente coerente perché è lo stesso identico codice/stessi angoli
// relativi di AMRManipulatorModelMaker.js — semplicemente capovolto in massa.
//
// wheelsGroup (stesso contratto di LeggedManipulatorModelMaker.js — vedi commento
// lì): qui punta al CORPO del drone (bodyGroup), non a ruote/gambe. Yaw =
// orientamento di volo. Drone (RobotBase subclass) sovrascrive
// updateLocomotionAnimation per far girare DAVVERO le eliche ad ogni frame
// (non solo quando ci si muove) e un piccolo bank/inclinazione in virata —
// "walking animation" del drone: non cammina, si inclina e le pale girano.
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

  // --- Corpo: scafo + canopy, ispirato a robot_factory ma coi materiali
  // procedurali del progetto invece di tinte piatte ---
  const bodyGroup = new THREE.Group()
  root.add(bodyGroup)

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 1.1), bodyMat)
  bodyGroup.add(hull)
  const noseLight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), glowMat)
  noseLight.position.set(0.92, 0, 0)
  bodyGroup.add(noseLight)

  // --- 4 bracci-rotore: braccio sottile (pipe) + pivot con anello
  // paraelica + pale a X + mozzo motore — stesso schema di robot_factory ---
  const ARM_OFFSET_X = 1.1
  const ARM_OFFSET_Z = 1.1
  // pivot più in basso (Y negativo, sotto il livello del corpo) di quanto
  // fosse (0.06, quasi a centro corpo): con l'anello paraelica ingrandito
  // quel livello faceva sembrare il rotore "staccato" dal resto, sospeso a
  // parte invece che ancorato in fondo al braccio
  const PIVOT_Y = -0.1
  const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8)
  const armUpAxis = new THREE.Vector3(0, 1, 0)
  const rotorPivots = []
  ;[
    [-ARM_OFFSET_X, -ARM_OFFSET_Z],
    [ARM_OFFSET_X, -ARM_OFFSET_Z],
    [-ARM_OFFSET_X, ARM_OFFSET_Z],
    [ARM_OFFSET_X, ARM_OFFSET_Z],
  ].forEach(([x, z]) => {
    // braccio: cilindro dal centro al pivot (ora anche in discesa di
    // PIVOT_Y, non più puramente orizzontale), orientato lungo la propria
    // direzione via quaternion invece della coppia rotation.z/y a due assi
    // (che bastava quando il pivot era alla stessa quota del centro) —
    // CylinderGeometry nasce verticale (asse Y), va ruotato per giacere
    // lungo il segmento centro→pivot
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
    // anello paraelica MOLTO ingrandito (raggio E spessore del tubo, non
    // solo uno dei due) — un anello sottile a raggio piccolo si perdeva
    // visivamente contro il corpo, andava reso un elemento riconoscibile
    // del silhouette del drone, non un dettaglio
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.1, 12, 28), armMat)
    guard.rotation.x = Math.PI / 2
    pivot.add(guard)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), armMat)
    pivot.add(hub)
    // pale a X: due box sottili incrociati, stesso schema di robot_factory
    // (non gira solo l'anello, girano davvero le pale — Drone lo anima).
    // Allungate e allargate in proporzione al nuovo anello più grande
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

  // niente più gambe/pattini di atterraggio visibili (rimossi): il drone
  // non atterra mai in partita (resta sempre in volo/hover), quindi le
  // "asticelle" scese dal corpo erano solo decorative e senza funzione —
  // GROUND_CLEARANCE_REF resta come riferimento numerico puro (l'altezza
  // da terra che AVREBBE il fondo dei pattini, se ci fossero) per il
  // calcolo dell'hovering sotto, senza dover ritarare quel calcolo
  const GROUND_CLEARANCE_REF = 0.75 + 0.045 / 2
  // quota di volo NORMALE (non landed): un drone che gioca a palla deve
  // planare sopra il campo — l'altezza va sommata a GROUND_CLEARANCE_REF,
  // non sostituirla, altrimenti il braccio appeso sotto (reach fino a
  // link1Length+link2Length=3.3, verificato empiricamente con
  // stepDribble) non ha spazio per raggiungere la palla senza sprofondare
  // sotto il pavimento (y<0) a riposo. Ridotta all'80% (5.5→4.4... ora
  // 4.4→3.52) per un volo un filo più basso, l'animazione del palleggio
  // (BallPossession.js/dribbleTuning) non dipende da un valore assoluto
  // fisso quindi segue da sola il nuovo hover
  const HOVER_HEIGHT = 3.52
  bodyGroup.position.y = GROUND_CLEARANCE_REF + HOVER_HEIGHT

  // --- Manipolatore 3R rovesciato: stesso codice di AMRManipulatorModelMaker.js,
  // invariato, appeso sotto il corpo tramite armFlip (vedi commento in
  // cima al file) ---
  const jointRadius = 0.22
  // base è FIGLIO DI ROOT (come in AMRManipulatorModelMaker.js: wheelsGroup
  // e base sono SIBLING indipendenti), MAI di bodyGroup — bug reale
  // trovato: bodyGroup.add(base) faceva sì che lo yaw di VOLO/movimento
  // (bodyGroup.rotation.y, scritto da setWheelsYaw) si sommasse allo yaw
  // di MIRA (base.rotation.y, scritto da setAimYaw) invece di restarne
  // indipendente — esattamente il motivo per cui il braccio appariva
  // "sempre di lato" rispetto alla direzione di marcia: mirare dritto
  // mentre ci si muoveva in una direzione diversa faceva sommare i due
  // yaw invece di isolarli, come invece accade per MANIPULATOR/LEGGED
  // MANIPULATOR (dove base non è mai figlio di wheelsGroup)
  const base = new THREE.Group()
  base.position.y = bodyGroup.position.y - 0.2 // stessa quota mondo di "appena sotto il corpo" di prima, ora espressa nel frame di root invece che di bodyGroup
  root.add(base)

  // UNICO punto di inversione: rotation.z = π fisso, mai più toccato. La
  // yaw (su `base`, sopra) resta un vero giro attorno all'asse verticale
  // del mondo — nessun mirroring, solo tutto ciò che sta sotto è capovolto.
  // Z (non X): un flip di 180° attorno a un asse ne inverte SEMPRE esattamente
  // gli altri due — serve invertire Y (l'altezza, per appendere il braccio
  // sotto invece che sopra), ma quello capita con QUALUNQUE asse di flip
  // scelto; la vera differenza è quale dei restanti due assi finisce
  // invertito insieme a Y. rotation.x = π (primo tentativo) inverte anche Z
  // (avanti/dietro): il braccio finiva a puntare all'INDIETRO rispetto a
  // dove guarda/mira il resto del robot (yaw, sopra il flip, mai toccato).
  // rotation.z = π inverte X (sinistra/destra) al posto di Z — impercettibile
  // su una geometria sostanzialmente simmetrica sinistra-destra (braccio/
  // paletta), e lascia "avanti" davvero avanti
  const armFlip = new THREE.Group()
  armFlip.rotation.z = Math.PI
  base.add(armFlip)

  const baseJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 16, 16), armMat)
  armFlip.add(baseJoint)

  // makeLinkGeometry/makeTaperedLinkGeometry ora in geometryControlHelpers.js
  // (condivise dai 3 ModelMaker — vedi import in cima)

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

  // formula DIVERSA da AMRManipulatorModelMaker.js (non condivisa apposta):
  // lì è -(link1+elbow+WRIST_REST) + tilt, qui il segno di tilt è invertito.
  // Il braccio appeso capovolto (armFlip, vedi sopra) inverte il senso in
  // cui gomito/link1/polso spostano la paletta in verticale — un primo
  // tentativo basato solo su misure ASTRATTE (una normale di test generica
  // trasformata attraverso la catena) sembrava tornare, ma dal vivo in
  // partita la "coppa" della paletta risultava capovolta: appoggiata SOPRA
  // la palla come una tesa di cappello (apertura verso l'alto, verso il
  // braccio) invece che sotto, ad accoglierla (apertura verso il basso,
  // verso dove sta davvero la palla) — verificato con screenshot reali
  // durante il palleggio automatico, non solo con un vettore isolato. Il
  // segno di tilt invertito qui è quello che ha corretto il verso davvero
  // osservato in game
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
  function applyArmPitch() {
    // NON -(REST+offset): negare un angolo dentro un coseno non cambia
    // nulla (cos è pari, cos(-θ)=cos(θ)) — verificato empiricamente,
    // quella "correzione" non spostava la palla di un solo millimetro.
    // Quello che serve è SOTTRARRE l'offset da una costante positiva
    // (REST): con l'asse capovolto, l'altezza del braccio è -cos(angolo
    // totale) — una funzione pari, minima (più in basso) ad angolo=0 e
    // che risale allontanandosi da 0 in QUALUNQUE verso. Partendo da un
    // angolo di riposo positivo (REST) e sottraendo l'offset lo si
    // avvicina a 0 quando l'offset cresce → l'altezza scende verso il
    // pavimento, esattamente il comportamento del palleggio/tiro
    elbow.rotation.x = ELBOW_REST_PITCH - (aimPitchOffset + dribbleElbowOffset)
    levelPaddle()
  }
  levelPaddle()
  applyPaddleAngle()

  // replaceGeometry/makeScaleSetter/createLinkControls ora in
  // geometryControlHelpers.js (condivise dai 3 ModelMaker) — prendono
  // `state` esplicito come primo argomento invece di chiuderlo

  // rotazione propeller: fase indipendente per pivot, avanzata da
  // Drone.updateLocomotionAnimation ad ogni frame (mai in pausa,
  // anche da fermo — un drone acceso tiene le eliche in moto)
  function spinRotors(dt, speed) {
    rotorPivots.forEach((pivot, i) => { pivot.rotation.y += dt * speed * (i % 2 === 0 ? 1 : -1) })
  }

  // Yaw/bank/pitch del CORPO combinati via QUATERNIONE invece che coi 3
  // campi Euler bodyGroup.rotation.x/y/z direttamente — bug reale trovato
  // dal vivo: il naso del drone punta a +X locale (noseLight sopra), quindi
  // "forward" è X, non Z. bodyGroup.rotation usa l'ordine Euler di default
  // 'XYZ' (intrinseco: prima X, poi Y, infine Z) — qualunque componente
  // applicato DOPO lo yaw (Y) finisce per ruotare attorno a un asse già
  // deformato dallo yaw stesso, non attorno al vero asse locale del naso in
  // quel momento. Risultato osservato: un tentativo di "pitch" (impennata)
  // messo su rotation.x/z appariva come un'inclinazione LATERALE appena lo
  // yaw non era esattamente 0/multiplo di 90°, invece di un'impennata
  // consistente in qualunque direzione stia volando. Fix: comporre
  // esplicitamente pitch/roll nel frame LOCALE (attorno agli assi veri
  // avanti=X/lato=Z, PRIMA dello yaw), poi applicare lo yaw come rotazione
  // ESTERNA attorno all'asse verticale del mondo — l'intero corpo già
  // inclinato ruota in blocco, la direzione dell'inclinazione resta sempre
  // relativa al naso qualunque sia l'orientamento di volo
  const BODY_FORWARD_AXIS = new THREE.Vector3(1, 0, 0)
  const BODY_UP_AXIS = new THREE.Vector3(0, 1, 0)
  const BODY_SIDE_AXIS = new THREE.Vector3(0, 0, 1)
  let yawAngle = 0
  let bankAngle = 0
  let bodyPitchAngle = 0
  const scratchYawQuat = new THREE.Quaternion()
  const scratchRollQuat = new THREE.Quaternion()
  const scratchPitchQuat = new THREE.Quaternion()
  function applyBodyOrientation() {
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
      // stesso segno invertito di applyArmPitch (vedi commento lì) — link1
      // passa dallo stesso "asse capovolto" del gomito
      link1Group.rotation.x = -link1Offset
      applyArmPitch()
    },
    setGrip(offset) { gripOffset = offset; applyPaddleAngle() },
    setShootTilt(offset) { shootTiltOffset = offset; levelPaddle() },
    setBallRestOffset(extra) { ballRestExtraOffset = extra; updatePaddleCenter() },
    paddleAngle(a) { state.paddleAngle = a; applyPaddleAngle(); updatePaddleCenter() },
    paddleTilt(angle) { state.paddleTilt = angle; levelPaddle() },
    // wheelsGroup qui è il CORPO (vedi commento in cima al file): yaw =
    // orientamento di volo, non c'entrano ruote/gambe
    setWheelsYaw(angle) { yawAngle = angle; applyBodyOrientation() },
    // bank/inclinazione in virata — chiamato da Drone, non tracciato
    // in state/Copy Config: è posa, non forma
    setBank(angle) { bankAngle = angle; applyBodyOrientation() },
    // pitch del corpo (impennata) — mirare in alto in HANDLING E/O spinta in
    // avanti durante il movimento (Drone.updateAimPosture/updateLocomotionAnimation
    // sommano i due contributi PRIMA di chiamare questo setter con un unico
    // valore combinato)
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
