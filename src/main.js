import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ManipulatorRobot, MANIPULATOR_STATS } from './robots/ManipulatorRobot.js'
import { Team } from './Team.js'
import { RobotState } from './robots/RobotBase.js'
import { createProceduralPBRMaps, drawBrushedMetal } from './robots/manipulator.js'
import { Basketball, BallState } from './Basketball.js'
import { GameMode } from './GameMode.js'
import { TimeOfDay } from './TimeOfDay.js'
import { SoundEffects } from './SoundEffects.js'
import { CollisionWorld, RIM_RING_RADIUS, RIM_TUBE_RADIUS } from './CollisionWorld.js'
import { initMainMenu } from './MainMenu.js'
import { angleToForward, rotateRight, lerpAngle } from './mathUtils.js'
import { initBallPossession, stepDribble, dribbleAmplitudesRad, getObjectWorldPosition } from './BallPossession.js'
import { initShootingSystem } from './ShootingSystem.js'
import { initEnemyAI, AI_MIN_PLAYER_DISTANCE } from './EnemyAI.js'
import { initCombatMoves, stealCooldownFor, blockCooldownFor, isCombatMoveActive, STEAL_FORWARD_MARGIN, STEAL_BACKWARD_MARGIN, BLOCK_CONTACT_RADIUS } from './CombatMoves.js'
import { initDebugPanel } from './debugPanel.js'
import { initCollisionDebugView } from './CollisionDebugView.js'
import { ORBIT_PITCH_MIN, ORBIT_PITCH_MAX, BALL_GRAVITY } from './constants.js'

// --- Renderer ---
// antialias:true qui non ha effetto: il rendering passa da EffectComposer
// (WebGLRenderTarget interno, no MSAA) e mai da renderer.render() diretto
// sul canvas → l'AA è delegato a SMAAPass in fondo alla pipeline
const renderer = new THREE.WebGLRenderer()
// pixelRatio 1: con SSAOPass attivo un devicePixelRatio 2 quadruplica il
// costo del pass (normal/depth + 32 sample + blur), causando lag
renderer.setPixelRatio(1)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

// --- Scene & Camera ---
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf0b8b8)

// near=0.1 su far=5000 (rapporto 1:50000) satura la precisione del depth
// buffer vicino alla camera e rende inutilizzabile la depth texture di
// SSAOPass a distanza (tutto il campo appare alla stessa profondità)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 5, 5000)
// ordine 'YXZ': stesso ordine usato internamente da PointerLockControls
// (yaw esterno attorno a Y, poi pitch attorno a X) — leggere/scrivere la
// rotazione con l'ordine di default 'XYZ' genera una componente "roll"
// spuria anche se questi controlli (solo mouse) non possono rollare
camera.rotation.order = 'YXZ'
// spawn preso dal pannello debug (P), arrotondato ai valori più sensati
camera.position.set(590, 540, 565)
camera.rotation.set(THREE.MathUtils.degToRad(-60), THREE.MathUtils.degToRad(35), 0)

// --- Audio ---
// SoundEffects (src/SoundEffects.js): wrapper OOP sopra AudioListener +
// suoni sintetizzati via Web Audio (nessun asset esterno, coerente col
// resto del progetto) — stesso spirito di RobotBase/Basketball, un'unica
// API (sfx.playX()) invece di funzioni globali sparse
const sfx = new SoundEffects(camera)

// --- Post-processing (SSAO) ---
// kernelRadius è in unità mondo (scena ~cm-scale, quindi valori grandi tipo
// 30 = 30cm di raggio di contatto). minDistance/maxDistance invece sono
// FRAZIONI NORMALIZZATE di profondità (0..1 su tutto near→far, vedi
// SSAOShader.js: delta = sampleDepth - realDepth in orthographic-depth
// space) → vanno derivate da kernelRadius / (camera.far - camera.near),
// non passate in unità mondo
const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight, 16)
// kernelRadius grande crea aloni scuri sospesi attorno ai bordi degli
// oggetti: i sample "vedono" superfici lontane dietro la silhouette e le
// confondono per occlusione locale. Ridotto ulteriormente per eliminare
// il residuo di alone ancora visibile a 20
ssaoPass.kernelRadius = 12
const depthRange = camera.far - camera.near
ssaoPass.maxDistance = (ssaoPass.kernelRadius / depthRange) * 1.5
ssaoPass.minDistance = ssaoPass.maxDistance / 20
composer.addPass(ssaoPass)

composer.addPass(new OutputPass())

// SMAA va per ultimo: lavora sull'immagine già composita/tone-mapped
const smaaPass = new SMAAPass(window.innerWidth, window.innerHeight)
composer.addPass(smaaPass)

// --- Lights ---
// toni caldi per approssimare l'environment lighting di Sketchfab
const hemi = new THREE.HemisphereLight(0xffd0c8, 0xc09080, 1.2)
scene.add(hemi)

const sun = new THREE.DirectionalLight(0xfff5ee, 1.2)
sun.position.set(1500, 1200, -800)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
sun.shadow.camera.near = 10
sun.shadow.camera.far = 6000
sun.shadow.camera.left = -2500
sun.shadow.camera.right = 2500
sun.shadow.camera.top = 2500
sun.shadow.camera.bottom = -2500
// fix shadow acne sui muri: frustum enorme (±2500) su 4096px = bassa densità
// texel, il depth-test si auto-ombreggia a chiazze sulle superfici quasi
// parallele alla luce senza bias
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 2
scene.add(sun)

// preset di illuminazione scelti nel main menu (fase del giorno) — colore
// e intensità di hemi/sun, più la posizione del sole (basso all'alba/
// tramonto, alto a mezzogiorno). Nessun ciclo/interpolazione dinamica,
// solo lo scatto al preset scelto una volta all'avvio
// bgColor: scene.background — un colore solido, non una vera skybox
// texturizzata (richiederebbe una HDR scaricata, in contrasto con
// l'approccio "tutto procedurale/nessun asset esterno" del progetto).
// NIGHT alzata rispetto al primo tentativo (hemi 0.35→0.6, sun 0.2→0.5):
// troppo scuro, quasi nero — resta comunque la più buia delle 4, ma con
// una luce blu lunare chiaramente presente, non pressoché assente
const TIME_OF_DAY_PRESETS = {
  [TimeOfDay.SUNRISE]: { hemiSky: 0xffb08a, hemiGround: 0x9a5a40, hemiIntensity: 0.9, sunColor: 0xffae5c, sunIntensity: 1.0, sunPos: [1500, 400, -800], bgColor: 0xffb379 },
  [TimeOfDay.DAY]:     { hemiSky: 0xffd0c8, hemiGround: 0xc09080, hemiIntensity: 1.2, sunColor: 0xfff5ee, sunIntensity: 1.2, sunPos: [1500, 1200, -800], bgColor: 0x8fc8f0 },
  [TimeOfDay.SUNSET]:  { hemiSky: 0xff8a5c, hemiGround: 0x7a3a2a, hemiIntensity: 0.85, sunColor: 0xff7040, sunIntensity: 0.9, sunPos: [-1500, 400, 800], bgColor: 0xd9502a },
  [TimeOfDay.NIGHT]:   { hemiSky: 0x3a4a7c, hemiGround: 0x10101c, hemiIntensity: 0.6, sunColor: 0x6a8fd0, sunIntensity: 0.5, sunPos: [1500, 1200, -800], bgColor: 0x0a1030 },
}
function applyTimeOfDayPreset(time) {
  const preset = TIME_OF_DAY_PRESETS[time]
  hemi.color.set(preset.hemiSky)
  hemi.groundColor.set(preset.hemiGround)
  hemi.intensity = preset.hemiIntensity
  sun.color.set(preset.sunColor)
  sun.intensity = preset.sunIntensity
  sun.position.set(...preset.sunPos)
  scene.background = new THREE.Color(preset.bgColor)
  // faretti canestro: accesi solo a SUNSET/NIGHT, di giorno la luce
  // naturale basta (asta e corpo del faretto restano visibili comunque)
  // MAI .visible = false: una luce con ombre che torna visibile per la
  // prima volta forza Three.js ad allocare la sua shadow map e compilare
  // gli shader shadow-casting sul momento, causando uno scatto percepibile
  // proprio nell'istante del cambio — intensità a 0 invece: la luce resta
  // sempre "attiva" nella pipeline (shadow map/shader già pronti dal primo
  // frame), a 0 semplicemente non illumina nulla, zero costo di setup
  const spotsOn = time === TimeOfDay.SUNSET || time === TimeOfDay.NIGHT
  hoopSpotlights.forEach(spot => { spot.intensity = spotsOn ? HOOP_SPOTLIGHT_INTENSITY : 0 })
}

// Lampioni: 4 punti luce alle posizioni dei globi del modello GLTF
// (nodo "lights" → Symmetry_3 → Null_1_7 → Sphere_1, mesh "Sphere_1_light_0"
// con materiale "light"). Posizioni ricavate analizzando i vertici del mesh
// (4 sfere unite in un unico mesh dall'export) e componendo le matrici
// mondo dell'intera catena di nodi GLTF, incluse scala/offset locali del
// nodo Sphere_1 (2x + traslazione Y) sopra a quelle di Null_1_7
const lampPositions = [
  [615.87, 268, -845],
  [615.87, 268, 845],
  [-615.87, 268, -845],
  [-615.87, 268, 845],
]
lampPositions.forEach(([x, y, z]) => {
  // PointLight.intensity è in candela con decay=2 (inverso-quadratico,
  // fisicamente corretto da three.js r155+). Alla distanza reale
  // lampione→terreno in questa scena (~200-270 unità) E = intensity/d²:
  // con 3000 l'illuminamento risultava ~0.04 lux, invisibile. Serve un
  // ordine di grandezza compatibile con la scala "grande" della scena
  const lamp = new THREE.PointLight(0xfff2c0, 130000, 400, 2)
  lamp.position.set(x, y, z)
  lamp.castShadow = true
  // mapSize contenuto (vs 4096 del sole): 4 point light = 24 render pass
  // cubemap/frame, va tenuto leggero per non sommarsi al costo di SSAO
  lamp.shadow.mapSize.set(512, 512)
  // near > raggio del globo (~26 unità, sfera scalata 2x dal nodo Sphere_1):
  // la luce sta al centro esatto della sfera solida, con near più piccolo
  // il depth-test dell'ombra vede subito il guscio interno in ogni
  // direzione e blocca tutta la luce in uscita (self-shadowing totale)
  lamp.shadow.camera.near = 30
  lamp.shadow.camera.far = 400
  // radius default (1) è quasi invisibile: alza il kernel di blur PCF
  // per un bordo ombra più morbido (blur a raggio fisso, non vera
  // penombra fisica, ma è il trucco economico standard)
  lamp.shadow.radius = 6
  // bias/normalBias a 0 (default) causavano lo stesso shadow acne già
  // visto sul sole (vedi sopra) ma qui sul muro vicino al lampione: un
  // pattern moiré/a onde per self-shadowing su superficie quasi parallela
  // alla luce, con mapSize 512 basso su un frustum near=30/far=400 —
  // stessa causa, stesso fix
  lamp.shadow.bias = -0.0005
  lamp.shadow.normalBias = 2
  scene.add(lamp)
})

// faretti sui canestri: SpotLight puntato sul ferro di ciascuno (stesse
// coordinate XZ di hoops/backboardBoxes più sotto, ripetute qui come
// letterali — hoops non esiste ancora a questo punto del file, stesso
// approccio già usato da polePositionsXZ ecc.), più una piccola mesh come
// corpo visibile del faretto — non solo una luce invisibile, stesso
// spirito dei lampioni sopra. Il CORPO del faretto usa lo stesso materiale
// grigio del "disc" (chassis) del robot (bodyMat in manipulator.js: color
// 0x8a8f96, roughness 0.5, metalness 0.4, brushed metal scale 350) — non
// esportato da manipulator.js, ricreato qui con la stessa identica ricetta.
// L'ASTA invece userà sharedWoodMaterial (panchine/tronchi) — non ancora
// pronto a questo punto del file (si popola dentro il loader del campo,
// asincrono): pole/arm partono con un materiale placeholder e vengono
// riassegnati a sharedWoodMaterial subito dopo che il campo ha finito di
// caricare (vedi hoopPoleMeshes più sotto, nel loader.load del campo).
// poleMetalMaps serve ANCORA per l'asta del lampione qui sotto nel
// traverse del GLTF (Cylinder_5_floor1_0) — NON va rimossa anche se il
// palo dei faretti canestro non la usa più
const poleMetalMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 400), baseRoughness: 0.5, roughnessVariation: 0.12 })
const hoopFixtureMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 350), baseRoughness: 0.5, roughnessVariation: 0.12 })
const hoopFixtureMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a8f96, roughness: 0.5, metalness: 0.4,
  normalMap: hoopFixtureMaps.normalMap, roughnessMap: hoopFixtureMaps.roughnessMap,
})
const HOOP_SPOTLIGHT_POSITIONS = [
  { x: 1079.85, z: 2.5 },
  { x: -1074.15, z: -2.5 },
]
const HOOP_SPOTLIGHT_Y = 450 // sopra il bordo della backboard (BACKBOARD_TOP_Y=340)
const HOOP_SPOTLIGHT_BACK_OFFSET = 150 // quanto indietro (lontano dal centro campo) rispetto al ferro
const HOOP_POLE_RADIUS = 8
// candela — nome condiviso perché applyTimeOfDayPreset deve poterci
// tornare (0 quando "spento", vedi sotto: mai spot.visible=false, quello
// forzerebbe Three.js a (ri)allocare shadow map/shader la prima volta che
// torna visibile, con uno scatto percepibile nel cambio fase del giorno)
const HOOP_SPOTLIGHT_INTENSITY = 180000
const hoopPolePlaceholderMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8 })
const hoopSpotlightFixtureGeometry = new THREE.BoxGeometry(24, 16, 30)
// pole+arm creati subito, riassegnati a sharedWoodMaterial più sotto
const hoopPoleMeshes = []
// accesi solo a SUNSET/NIGHT (vedi applyTimeOfDayPreset) — di giorno la
// luce naturale basta, asta e corpo del faretto restano comunque sempre visibili
const hoopSpotlights = []
HOOP_SPOTLIGHT_POSITIONS.forEach(({ x, z }) => {
  // asta a L: segmento verticale dietro la backboard (lontano dal centro
  // campo — il segno di x decide da che lato siamo) + un braccio
  // orizzontale che si allunga fin sopra al ferro, dove il faretto punta
  // dritto in basso — non più un faretto che spara in diagonale da dietro
  const poleX = x + Math.sign(x) * HOOP_SPOTLIGHT_BACK_OFFSET

  // segmento verticale: da terra fino all'altezza del braccio
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(HOOP_POLE_RADIUS, HOOP_POLE_RADIUS, HOOP_SPOTLIGHT_Y, 10), hoopPolePlaceholderMaterial)
  pole.position.set(poleX, HOOP_SPOTLIGHT_Y / 2, z)
  // niente ombra propria: asta/braccio/corpo sono troppo vicini al proprio
  // faretto (il braccio e il corpo condividono praticamente la stessa
  // posizione della luce) — si autoproietterebbero addosso artefatti
  pole.castShadow = false
  scene.add(pole)
  hoopPoleMeshes.push(pole)

  // segmento orizzontale: dalla cima dell'asta fino sopra al ferro —
  // CylinderGeometry di default è lungo l'asse Y locale, ruotato di 90°
  // su Z per giacere orizzontale lungo X
  const armLength = Math.abs(x - poleX)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(HOOP_POLE_RADIUS, HOOP_POLE_RADIUS, armLength, 10), hoopPolePlaceholderMaterial)
  arm.position.set((poleX + x) / 2, HOOP_SPOTLIGHT_Y, z)
  arm.rotation.z = Math.PI / 2
  arm.castShadow = false
  scene.add(arm)
  hoopPoleMeshes.push(arm)

  // stessa scala fotometrica "grande scena" dei lampioni sopra (candela
  // con decay=2, fisicamente corretto da three.js r155+) — a ~190 unità
  // di altezza (faretto→ferro) serve un ordine di grandezza simile
  const spot = new THREE.SpotLight(0xfff2c0, HOOP_SPOTLIGHT_INTENSITY, 900, THREE.MathUtils.degToRad(52), 0.8, 2)
  spot.position.set(x, HOOP_SPOTLIGHT_Y, z)
  spot.target.position.set(x, 262.55, z) // dritto in basso sul ferro, non in diagonale
  spot.castShadow = true
  spot.shadow.mapSize.set(512, 512)
  spot.shadow.camera.near = 50
  spot.shadow.camera.far = 900
  spot.shadow.bias = -0.0005
  spot.shadow.normalBias = 2
  scene.add(spot)
  scene.add(spot.target)
  hoopSpotlights.push(spot)

  const fixture = new THREE.Mesh(hoopSpotlightFixtureGeometry, hoopFixtureMaterial)
  fixture.position.set(x, HOOP_SPOTLIGHT_Y, z)
  fixture.castShadow = false // sta esattamente sulla luce stessa, si autoproietterebbe addosso
  scene.add(fixture)
})
// DAY di default all'avvio (sostituisce lo 0xf0b8b8 segnaposto sopra) — la
// variabile timeOfDay vera e propria è dichiarata più avanti nel file
// (vicino a mode), qui si passa direttamente l'enum per evitare di
// referenziarla prima della sua dichiarazione. Deve girare DOPO
// hoopSpotlights (sopra), non subito dopo la dichiarazione della funzione:
// applyTimeOfDayPreset legge quell'array
applyTimeOfDayPreset(TimeOfDay.DAY)

// --- Court ---
// Plugin per KHR_materials_pbrSpecularGlossiness, rimosso da Three.js r152+.
// Converte diffuseFactor→color, glossinessFactor→roughness, diffuseTexture→map.
class SpecularGlossinessPlugin {
  constructor(parser) {
    this.parser = parser
    this.name = 'KHR_materials_pbrSpecularGlossiness'
  }

  getMaterialType() {
    return THREE.MeshStandardMaterial
  }

  extendMaterialParams(materialIndex, materialParams) {
    const parser = this.parser
    const materialDef = parser.json.materials[materialIndex]
    const ext = materialDef?.extensions?.[this.name]
    if (!ext) return Promise.resolve()

    const pending = []

    if (ext.diffuseFactor) {
      materialParams.color = new THREE.Color().setRGB(
        ext.diffuseFactor[0],
        ext.diffuseFactor[1],
        ext.diffuseFactor[2]
      )
      materialParams.opacity = ext.diffuseFactor[3] ?? 1
    }

    if (ext.diffuseTexture !== undefined) {
      pending.push(parser.assignTexture(materialParams, 'map', ext.diffuseTexture, THREE.SRGBColorSpace))
    }

    materialParams.roughness = ext.glossinessFactor !== undefined ? 1 - ext.glossinessFactor : 1
    materialParams.metalness = 0

    return Promise.all(pending)
  }
}

const loader = new GLTFLoader()
loader.register(parser => new SpecularGlossinessPlugin(parser))

// --- Loading Screen ---
// solo 2 asset asincroni in tutto il progetto (campo + pallone, il robot è
// procedurale) — progresso REALE (conteggio dei loader.load() completati),
// non inventato: a differenza di thegoblinslayers (scouting, vedi README),
// l'unico altro repo del corso con un loading screen vero, che usa
// percentuali hardcoded per milestone invece di un conteggio vero, qui non
// serve fingere perché tracciare i 2 asset reali è altrettanto semplice
const TOTAL_ASSETS_TO_LOAD = 2
let assetsLoadedCount = 0
const loadingScreenEl = document.getElementById('loading-screen')
const loadingBarFillEl = document.getElementById('loading-bar-fill')
function markAssetLoaded() {
  assetsLoadedCount++
  loadingBarFillEl.style.width = `${Math.round((assetsLoadedCount / TOTAL_ASSETS_TO_LOAD) * 100)}%`
  if (assetsLoadedCount >= TOTAL_ASSETS_TO_LOAD) loadingScreenEl.classList.add('fade-out')
}

// stesso generatore procedurale (canvas → height-field → normal/roughness map)
// già usato per le texture del robot, riusato qui per panchine e palo
// lampione invece di scaricare texture pronte — coerente con "niente asset
// esterni" del resto del progetto. Costruite una volta sola, non per mesh
const benchWoodMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 300), baseRoughness: 0.75, roughnessVariation: 0.15 })
// panchine E tronchi degli alberi condividono lo stesso materiale "wood" del
// GLTF: un solo clone condiviso tra tutte le mesh che lo usano, invece di un
// clone+texture per mesh (8 mesh panchine + i tronchi)
let sharedWoodMaterial = null

loader.load('./models/court/basketball_court/scene.gltf', gltf => {
  gltf.scene.traverse(child => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    // z-fighting fix per le linee del campo (stesso piano del pavimento)
    if (child.material?.name === 'Basket_ball_lines') {
      child.material.polygonOffset = true
      child.material.polygonOffsetFactor = -1
      child.material.polygonOffsetUnits = -4
      child.renderOrder = 1
    }
    // panchine (assi in legno): materiale "wood" condiviso, va clonato una
    // volta sola prima di aggiungere le mappe (altrimenti si applicherebbero
    // anche a materiali diversi che puntano allo stesso oggetto)
    if (child.material?.name === 'wood') {
      if (!sharedWoodMaterial) {
        sharedWoodMaterial = child.material.clone()
        sharedWoodMaterial.normalMap = benchWoodMaps.normalMap
        sharedWoodMaterial.roughnessMap = benchWoodMaps.roughnessMap
        sharedWoodMaterial.bumpMap = benchWoodMaps.heightMap
        sharedWoodMaterial.bumpScale = 0.6
        sharedWoodMaterial.roughness = 0.75
      }
      child.material = sharedWoodMaterial
    }
    // asta lampione: usa il materiale "floor.1", condiviso col pavimento
    // (per questo sembrava "uguale al pavimento") — va clonato prima di
    // ricolorarlo, altrimenti si tingerebbe anche il pavimento stesso.
    // Nome senza punto: GLTFLoader sanitizza i nomi nodo rimuovendo
    // caratteri riservati per i path di animazione (. : / [ ]), quindi
    // "Cylinder_5_floor.1_0" nel GLTF diventa "Cylinder_5_floor1_0" qui
    if (child.name === 'Cylinder_5_floor1_0') {
      child.material = child.material.clone()
      // grigio scuro visibile, non nero: 0x2b2b2e leggeva come nero pieno
      // sotto le luci della scena
      child.material.color.set(0x55555a)
      child.material.normalMap = poleMetalMaps.normalMap
      child.material.roughnessMap = poleMetalMaps.roughnessMap
      child.material.bumpMap = poleMetalMaps.heightMap
      child.material.bumpScale = 0.4
      child.material.roughness = 0.5
      child.material.metalness = 0.5 // il plugin SpecularGlossiness azzera sempre metalness in conversione
    }
    // pallone incluso nel modello del campo (unico mesh con texture
    // immagine vera, Mat.3_diffuse.jpeg) — rimosso, ne usiamo uno dedicato
    if (child.name === 'Sphere_Mat3_0') {
      child.parent.remove(child)
    }
  })
  scene.add(gltf.scene)
  // asta+braccio dei faretti canestro: create prima con un materiale
  // placeholder (sharedWoodMaterial non esisteva ancora, si popola durante
  // il traverse appena fatto), ora riassegnate al vero legno condiviso
  if (sharedWoodMaterial) hoopPoleMeshes.forEach(mesh => { mesh.material = sharedWoodMaterial })
  markAssetLoaded()
})

// --- Pallone (modello dedicato: color map + normal map + metallic/roughness) ---
// let (non const): regolabili a runtime dal pannello debug (Basketball/
// Manipulator Animation → Dribble), dichiarate qui perché lette già dal
// setup del debug menu più sotto, prima del blocco fisica nel render loop
let BALL_RADIUS = 15 // unità mondo (~cm-scale) — sfera sorgente ha raggio 1
// fattore colore della color map del pallone — >1 schiarisce (il fattore
// moltiplica il texel, non è clampato a 1) senza tingere, a differenza di
// un colore/tint diverso da bianco
const BALL_COLOR_BRIGHTNESS = 1.15
// BALL_GRAVITY/BALL_BOUNCE_SPEED ora in src/constants.js: vere costanti, mai
// riassegnate — non più usate qui in main.js (importate direttamente da
// BallPossession.js/ShootingSystem.js/debugPanel.js invece di essere
// ripassate in ogni context)
// CollisionWorld (src/CollisionWorld.js): possiede backboard/ferro/muri/
// pali/panchine (coordinate estratte dagli accessor del GLTF, non stimate
// a occhio — vedi i commenti nel file) e il metodo resolve() che li
// controlla tutti in un colpo solo.
const collisionWorld = new CollisionWorld()
// isInsideThreePointArc/getEffectiveShotSpeed/HOOP_ASSIST_*/
// shootingStatToAssistStrength/SHOT_FLOOR_BOUNCE_SPEED/
// FLOOR_HORIZONTAL_DAMPING ora in src/ShootingSystem.js
// il punto di tracking (manipulator.paddle = paddleCenter) non coincide col
// centro visivo reale della paletta a occhio: questi 3 offset (unità
// mondo) si sommano in animate(), lungo gli assi LOCALI della paletta
// (non mondo, così restano corretti mentre si inclina/tilta) — Forward =
// lungo la paletta (asse locale Z), Side = di lato (asse locale X), Down =
// verso il basso reale della paletta (asse locale -Y). Tarati da debug
// (Basketball → Ball Offset), non da fisica/geometria
// parametri tunabili di palleggio/tracking-palla consolidati in un unico
// oggetto MUTABILE (stesso motivo di shootTuning: un `export let` non è
// riassegnabile da chi importa, un oggetto sì) invece di `let` sciolti a
// modulo, tutti scritti dagli onChange degli slider del pannello debug
const dribbleTuning = {}
dribbleTuning.ballOffsetForward = 6
dribbleTuning.ballOffsetSide = 0
dribbleTuning.ballOffsetDown = 12
// SOLO per HANDLING/tiro (ballRestPoint, non paddleCenter): il punto di
// convergenza delle normali è geometricamente corretto "di luogo" ma
// visivamente troppo vicino alla camera/al polso — extra distanza lungo la
// stessa direzione, non una nuova geometria (vedi setBallRestOffset)
let BALL_REST_EXTRA_OFFSET = 0.08
// offset yaw del braccio in Play (gradi, sommato a cameraState.orbitYaw ogni frame) e
// altezza del crosshair (px sopra il centro schermo) — anche questi
// dichiarati qui per lo stesso motivo di BALL_*: letti già dal setup del
// debug menu sotto
let ARM_YAW_OFFSET_DEG = -36
let CROSSHAIR_HEIGHT = 115
// palleggio: durata della spinta verso il basso (gomito+link1) e ampiezza
// del piegamento di ciascuno (gradi) — stessa ampiezza usata sia nella
// spinta (push) sia nella risalita in sincrono col rimbalzo (rise)
dribbleTuning.pushDuration = 0.25
dribbleTuning.elbowAmplitudeDeg = 40
dribbleTuning.link1AmplitudeDeg = 10
// dribbleAmplitudesRad ora in src/BallPossession.js (importata sotto,
// chiamata come dribbleAmplitudesRad(dribbleTuning))
// RobotState.HANDLING (tasto destro tenuto premuto): dichiarate qui (non
// vicino a updateHandling più in basso) perché usate come valore iniziale
// dello slider debug "Handling" costruito subito dopo questo blocco —
// prima di questo spostamento erano `let` più in basso nel file e lo
// slider le leggeva prima della dichiarazione (temporal dead zone,
// ReferenceError che crashava l'intero modulo prima di arrivare ad animate())
// parametri tunabili di HANDLING consolidati in un oggetto (stesso motivo
// di dribbleTuning sopra)
const handlingTuning = {}
handlingTuning.ease = -0.3 // quanto è "chiuso" il braccio nella presa (negativo=sopra il riposo/più in alto, 0=riposo, 1=fondo corsa push)
handlingTuning.gripOffset = 0.5 // quanto si stringe la V della paletta (rad, sottratto da paddleAngle)
handlingTuning.transitionSpeed = 12 // rad/s-equivalente: interpolazione rapida ma non istantanea
// più vicino = visuale più bassa/schiacciata: un rialzo extra in quota
// compensa, per non vedere la base ma il braccio (utile per mirare/tirare)
let HANDLING_HEIGHT_BOOST = 40
// scarto laterale della camera in HANDLING (asse camRightFlat), per una
// vista "di spalla" invece che dritta dietro il robot
let HANDLING_CAMERA_SIDE_OFFSET = -60
// quanto ci mette lockOffset (vedi sotto) a riassorbirsi a inizio 'push':
// finestra breve rispetto a dribbleTuning.pushDuration, così per il resto della
// spinta (mentre il link si piega, visibilmente) la palla è già a offset
// zero e segue ESATTAMENTE la paletta, invece di continuare a "cadere"
// per conto suo sull'intera durata della spinta
dribbleTuning.lockAbsorbTime = 0.25
// piccolo offset costante (unità mondo) sottratto dalla Y balistica pura
// di 'rise' (vedi riseBallisticY in animate()), non un clamp: a 0 la
// traiettoria è la fisica pura, invariata
dribbleTuning.riseYCorrection = 7
// RobotState.NO_BALL (tiro): velocità di lancio, ancora una costante piatta,
// Tutti i parametri tunabili dello Shooting System (via pannello debug →
// Shoot) consolidati in un unico oggetto MUTABILE — non solo per pulizia
// (stesso principio di shootingState/cameraState/menuState) ma per un
// motivo tecnico vero e proprio: sono `let` scalari riassegnati dagli
// onChange degli slider (v => { X = v }), e se questo modulo dovesse un
// giorno spostarsi in un file a parte, un binding importato con `export
// let` non è riassegnabile dal lato di chi importa (i moduli ES lo
// vietano) — un OGGETTO importato invece sì, le sue PROPRIETÀ restano
// mutabili. shotSpeed: non legata alla stat POWER né a una HUD di carica —
// quella (Shooting System con forza dipendente dalle stat) resta un task
// separato più avanti. windupDuration/releaseDuration/recoverDuration:
// durata delle tre fasi dell'animazione di tiro (windup → release →
// recover). elbowWindupDeg/link1WindupDeg: gradi di apertura ALL'INDIETRO
// oltre il riposo nel windup (opposto della spinta in giù del palleggio).
// elbowReleaseDeg/link1ReleaseDeg: posa di rilascio/follow-through — NON
// un valore grande come l'ampiezza del palleggio (quella spinge la
// paletta VERSO IL BASSO), qui resta vicino al riposo, altrimenti la
// palla sembra "cadere subito" indipendentemente dalla velocità reale
// (quella viene dal crosshair, non da questa posa). releaseLead: frazione
// di releaseDuration prima che il gomito inizi a muoversi — poi copre
// tutto il suo raggio nel tempo rimanente, partenza posticipata =
// velocità angolare maggiore, il "colpo di frusta" che rincorre e supera
// link1. releasePoint: frazione di 'release' a cui la palla lascia
// davvero la paletta. stateTransitionDelay: quanto resta manipulator.state
// = HANDLING DOPO il rilascio vero prima di passare a NO_BALL — per non
// sganciare di scatto la camera libera esattamente mentre la palla parte.
// elbowAimCoupling: quanto il gomito segue il pitch della camera durante
// TUTTO il tiro (1 = l'end effector matcha esattamente il pitch della
// mira). tiltWindupPeak/tiltTarget: il tilt della paletta passa per tre
// fasi (orizzontale → oltre il piatto nel windup → inclinata in avanti
// nel release), non un lerp diretto piatto→inclinata
const shootTuning = {
  shotSpeed: 1100,
  windupDuration: 0.35, releaseDuration: 0.3, recoverDuration: 0.25,
  elbowWindupDeg: -55, link1WindupDeg: -40,
  elbowReleaseDeg: 5, link1ReleaseDeg: 15,
  releaseLead: 0.25, releasePoint: 0.8,
  stateTransitionDelay: 0.35,
  elbowAimCoupling: 1,
  tiltWindupPeak: -2.5, tiltTarget: -0.5,
}
// stessa formula usata sia in updateHandling (gomito già agganciato al
// pitch della camera durante la presa) sia in updateShootAnimation (stessa
// formula durante il tiro vero) — un solo posto invece di due copie
function computeAimPitchOffset() {
  return (cameraState.orbitPitch - ORBIT_PITCH_REST) * shootTuning.elbowAimCoupling
}
// Basketball (src/Basketball.js): wrapper leggero con FSM HANDLED/FREE —
// basketball.position/scale restano proxy verso il mesh vero, il resto del
// file continua a usarli come prima; scene.add vuole il mesh, non il wrapper
let basketball = null
loader.load('./models/basketball_ball/scene.gltf', gltf => {
  gltf.scene.scale.setScalar(BALL_RADIUS)
  gltf.scene.traverse(child => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    // leggero schiarimento della color map (il fattore color di un
    // materiale moltiplica il texel, non è clampato a 1 — va oltre il
    // bianco pieno invece di tingere, che è esattamente "un po' più
    // luminoso" invece di un cambio di tonalità)
    if (child.material?.color) child.material.color.multiplyScalar(BALL_COLOR_BRIGHTNESS)
  })
  basketball = new Basketball(gltf.scene)
  // il giocatore parte già in possesso della palla (palleggio automatico da
  // subito, non un pickup da fare) — FREE è il default della classe per una
  // palla "generica", qui va corretto esplicitamente all'avvio. Riferimento
  // a `manipulator` sicuro anche se dichiarato più sotto nel file: questo
  // callback è asincrono (il GLTF carica in rete), l'intero script
  // sincrono (comprese le dichiarazioni di manipulator/enemyManipulator)
  // ha già finito di girare quando arriva davvero
  basketball.setState(BallState.HANDLED)
  basketball.setOwner(manipulator)
  scene.add(gltf.scene)
  markAssetLoaded()
})

// Preview di traiettoria (rebuildTrajectoryTube/hideTrajectoryPreview/
// updateTrajectoryPreview) ora in src/ShootingSystem.js — troppo
// strettamente accoppiata a isHoopCrossing/applyHoopAssist/collisionWorld
// per separarla dal resto dello Shooting System senza duplicare codice

// --- Robot (Step 4: solo modello statico, no animazione/movimento ancora) ---
const manipulator = new ManipulatorRobot(Team.A)
// unità locali (~1-4) → scala mondo: lampioni a Y=268, hoop reg. ~305cm,
// unità mondo ≈ 1cm → tarato a 45 dopo test visivi via slider debug (P).
// Passa da controls.manipulatorScale (non root.scale diretto) così lo
// stato tracciato resta coerente con "Copy config"
manipulator.controls.manipulatorScale(45)
manipulator.controls.setBallRestOffset(BALL_REST_EXTRA_OFFSET)
// dal proprio lato di campo (stessa X di resetGameplayState in
// MainMenu.js — PLAYER_SPAWN_X/ENEMY_SPAWN_X lì, ripetuta qui solo per il
// primissimo avvio prima che esista un menu da cui tornare)
manipulator.root.position.set(-300, 0, 0)
manipulator.root.traverse(child => {
  if (child.isMesh) {
    child.castShadow = true
    child.receiveShadow = true
  }
})
scene.add(manipulator.root)

// --- Nemico (1v1, Section 3): stesso identico modello procedurale, solo
// Team diverso e guidato dall'AI invece che dall'input — nessuna nuova
// classe robot, MANIPULATOR resta l'unica implementata (roadmap). Spawn a
// una distanza ragionevole dal giocatore, non sovrapposto: la posizione
// vera verrà gestita dall'AI (src/EnemyAI.js) una volta che PRACTICE/1v1
// distinguono davvero i due modi
const enemyManipulator = new ManipulatorRobot(Team.B)
enemyManipulator.controls.manipulatorScale(45)
enemyManipulator.controls.setBallRestOffset(BALL_REST_EXTRA_OFFSET)
enemyManipulator.root.position.set(300, 0, 0)
enemyManipulator.root.traverse(child => {
  if (child.isMesh) {
    child.castShadow = true
    child.receiveShadow = true
  }
})
// RobotBase parte di default in DRIBBLE (l'ipotesi valida finché esisteva
// un solo robot, sempre in possesso all'avvio) — il nemico invece NON
// possiede la palla all'avvio (il giocatore sì, vedi setOwner(manipulator)
// al caricamento del GLTF pallone): senza questa correzione esplicita,
// enemyUpdateDribble proverebbe comunque a muovere ogni tick la stessa
// basketball.position condivisa, in conflitto con quella del giocatore
enemyManipulator.setState(RobotState.NO_BALL)
scene.add(enemyManipulator.root)

// --- Spectator Camera ---
const controls = new PointerLockControls(camera, renderer.domElement)

const hint = document.getElementById('hint')
// guardia: senza questa, il tiro (click sinistro, vedi sezione Tiro più
// sotto) richiamerebbe lock() anche a pointer già agganciato ogni volta —
// innocuo di per sé ma non necessario
renderer.domElement.addEventListener('click', () => { if (!controls.isLocked && menuState.mode !== 'menu') controls.lock() })
controls.addEventListener('lock', () => hint.style.display = 'none')
// il tasto M (sotto) chiama anch'esso controls.unlock() per un motivo
// diverso (forzare un nuovo "click per entrare" nel cambio Spectate/Play,
// non "il giocatore vuole la pausa") — PointerLockControls non distingue
// la CAUSA dell'unlock (Esc intercettato dal browser vs unlock() chiamato
// da codice), quindi serve questo flag per non aprire la pausa anche lì
let suppressPauseOnUnlock = false
controls.addEventListener('unlock', () => {
  hint.style.display = ''
  if (suppressPauseOnUnlock) { suppressPauseOnUnlock = false; return }
  // col pointer agganciato, Esc viene intercettato dal browser (Pointer
  // Lock API) e sgancia PRIMA che il keydown arrivi alla pagina — questo è
  // l'unico punto che vede in modo affidabile "il pointer si è appena
  // sganciato mentre si giocava", openPauseMenu() più sotto è idempotente
  // (no-op se il menu è già aperto per un altro motivo)
  openPauseMenu()
})

const keys = {}
document.addEventListener('keydown', e => keys[e.code] = true)
document.addEventListener('keyup',   e => keys[e.code] = false)

// Pannello debug (tasto P) — costruzione slider/readout ora in
// src/debugPanel.js (initDebugPanel), chiamata più sotto dopo
// initShootingSystem (serve PICKUP_MARGIN, dichiarata più avanti nel file)

const camDir = new THREE.Vector3()
const camRight = new THREE.Vector3()

// --- Modalità Spectate/Play (tasto M) ---
// Spectate: free-fly esistente. Play: camera in terza persona che orbita
// il robot col mouse (stesso pointer lock del free-fly, ma qui muove un
// angolo cameraState.orbitYaw/cameraState.orbitPitch invece della camera direttamente); WASD è
// relativo a dove guarda ORA la camera (non assi mondo fissi). Le ruote
// (yaw dell'intero wheelsGroup) puntano comunque verso il vettore di
// movimento totale risultante via atan2.

// converte un angolo orizzontale (stessa convenzione di movementState.facing/
// cameraState.orbitYaw) in un vettore direzione — usato per camForward, dashDirection
// e l'offset della camera in Play, invece di scrivere sin/cos a mano ogni
// volta (un bug di segno su una di queste formule scritte a mano ha già
// causato l'inversione di A/D)
// angleToForward/rotateRight ora in src/mathUtils.js (helper puri, primo
// pezzo del refactor modulare a rischio zero)

// 'menu' è un terzo valore di mode (non una FSM/enum a parte — mode è
// sempre stata una semplice stringa, un terzo valore basta): mentre il
// main menu è aperto non si può passare a 'play' col tasto M, e la camera
// segue l'orbita lenta del menu invece della logica normale. Diventa
// 'spectate' quando il menu si chiude (fine flusso di selezione)
// stato del menu consolidato in un unico oggetto (stesso principio di
// shootingState/cameraState) invece di `let` sciolti a modulo — refactor
// puro di organizzazione, nessun cambio di comportamento. gameMode/
// timeOfDay: scelti nel main menu (GAMEMODES/robot/fase del giorno) prima
// di entrare in scena — solo PRACTICE è davvero implementata, 1v1/3v3
// richiedono nemici (Section 3)
const menuState = { mode: 'menu', gameMode: GameMode.PRACTICE, timeOfDay: TimeOfDay.DAY }
const modeIndicator = document.getElementById('mode-indicator')
// stato di movimento consolidato (stesso principio di shootingState/
// cameraState/menuState) — wheelsAngle assegnato più sotto, dove viene
// dichiarato il valore iniziale reale
const movementState = { facing: 0 } // facing: yaw ruote/robot (rad), persiste quando fermo
const moveVec = new THREE.Vector3()
const camForward = new THREE.Vector3()
const camRightFlat = new THREE.Vector3()
const targetCameraPos = new THREE.Vector3()
// scratch per il quaternione bersaglio della rotazione camera (vedi uso più
// sotto): riusati ogni frame invece di allocare oggetti nuovi nel loop
const targetCameraQuat = new THREE.Quaternion()
const scratchLookAtMatrix = new THREE.Matrix4()
const scratchLookAtTarget = new THREE.Vector3()
const scratchEuler = new THREE.Euler()
// niente più costante fissa: la velocità viene da manipulator.speed (stat
// SPEED della classe, vedi RobotBase.js)
const CHASE_DISTANCE = 350
// tasto destro tenuto premuto (Play mode): la camera si avvicina mentre il
// braccio afferra la palla (vedi RobotState.HANDLING) — stessa orbita, solo
// raggio più corto, interpolato con lo stesso schema esponenziale della
// sterzata ruote invece di scattare di colpo
const HANDLING_CHASE_DISTANCE = 150
// HANDLING_HEIGHT_BOOST dichiarata più in alto (vedi vicino a handlingTuning.ease)
// perché usata come valore iniziale dello slider debug "Handling", costruito
// prima di questo punto nel file (stessa ragione della nota lì sopra)
const CHASE_DISTANCE_LERP_SPEED = 6
// più lenta della CHASE_DISTANCE_LERP_SPEED condivisa (usata da quota/pitch):
// a 6 lo zoom si assestava così in fretta (~167ms) da sembrare uno scatto
// istantaneo — qui si vede scorrere davvero
const CHASE_DISTANCE_ZOOM_LERP_SPEED = 2.5
// DRIBBLE e HANDLING usano formule di posizione camera DIVERSE (orbita+lookAt
// vs orientamento libero) — anche con parametri smussati, passare dall'una
// all'altra è discontinuo (la formula stessa cambia da un frame al prossimo,
// non solo i numeri dentro). Si interpola la POSIZIONE VERA della camera
// verso il bersaglio calcolato ogni frame, non solo i parametri che lo
// alimentano — così lo scatto sparisce indipendentemente da quale formula è
// in uso
const CAMERA_POSITION_LERP_SPEED = 10
// stato camera consolidato in un unico oggetto (stesso principio di
// shootingState/realDribbleState) invece di `let` sciolti a modulo —
// refactor puro di organizzazione, nessun cambio di formula/comportamento
const cameraState = {}
cameraState.currentChaseDistance = CHASE_DISTANCE
cameraState.currentHeightBoost = 0
// in HANDLING niente offset laterale: il braccio va in linea con la
// visuale invece che di profilo, interpolato come il resto (vedi
// ARM_YAW_OFFSET_DEG sopra per l'offset normale fuori da HANDLING)
cameraState.currentArmYawOffsetDeg = ARM_YAW_OFFSET_DEG
const CHASE_HEIGHT = 180
const LOOK_HEIGHT = 80
const ORBIT_SENSITIVITY = 0.0025
// il braccio (base R1) seguiva l'orbit yaw 1:1, quindi puntava sempre
// esattamente lontano dalla camera (si vedeva il palleggio "di spalle").
// ARM_YAW_OFFSET_DEG (dichiarata più sopra, tarabile da debug → Play Aim)
// resta comunque agganciato all'orbit (gira insieme alla camera), ma
// sfalsato di lato — così il palleggio si vede di profilo
cameraState.orbitYaw = 0
// pitch iniziale che riproduce l'inquadratura di prima (stessa proporzione
// altezza/distanza), poi libero via mouse entro un range che non ribalta
const ORBIT_PITCH_REST = Math.atan2(CHASE_HEIGHT, CHASE_DISTANCE)
cameraState.orbitPitch = ORBIT_PITCH_REST
// ORBIT_PITCH_MIN/MAX ora in src/constants.js (importate sopra)
// cameraState.orbitPitch CRESCENTE porta la camera più in alto e vicina, sopra la testa
// del robot → guarda più IN GIÙ. Quindi "guarda su" è l'opposto: cameraState.orbitPitch
// che SCENDE verso lo zero (camera bassa/lontana, quasi alla pari del
// target) e oltre, in negativo (camera sotto il target, guarda in su per
// davvero). In HANDLING si abbassa il minimo (non si alza il massimo) per
// poter puntare il canestro
const ORBIT_PITCH_MIN_HANDLING = -0.9
// in HANDLING la camera è ormai a orientamento libero (non più orbita+lookAt
// fisso): senza limite proprio, guardare troppo in giù punta la vista dentro
// il pavimento/la base — un tetto più basso di ORBIT_PITCH_MAX qui
const ORBIT_PITCH_MAX_HANDLING = 0.9
// coupling pitch camera → gomito: guardare su/giù alza/abbassa l'end
// effector di poco, non tantissimo — fattore piccolo apposta. Disattivato
// per ora (messo a 0, non rimosso — resta la formula pronta a riattivarlo)
const ELBOW_PITCH_COUPLING = 0

// interpolazione angolare per la sterzata delle ruote: smoothing
// esponenziale (framerate-independent) con via breve sul wrap-around
// (es. da 350° a 10° gira per 20°, non per 340°)
movementState.wheelsAngle = -Math.PI / 2 // combacia col target a movementState.facing=0
const WHEEL_TURN_SPEED = 18 // rad/s equivalenti: "rapidissima" ma non istantanea
// lerpAngle ora in src/mathUtils.js

// --- Dash (Shift in Play) ---
const dashPanel = document.getElementById('dash-panel')
const dashChargeFillEls = [document.getElementById('dash-charge-fill-0'), document.getElementById('dash-charge-fill-1')]
// --- STEAL/BLOCK HUD (Q/E in Play) ---
const combatPanel = document.getElementById('combat-panel')
const stealBarFill = document.getElementById('steal-bar-fill')
const blockBarFill = document.getElementById('block-bar-fill')
const crosshair = document.getElementById('crosshair')
// riusata anche dallo slider "Crosshair Height" nel pannello debug, invece
// di ripetere la stessa formula in due punti
function updateCrosshairPosition() {
  crosshair.style.top = `calc(50% - ${CROSSHAIR_HEIGHT}px)`
}
updateCrosshairPosition()
const dashDirection = new THREE.Vector3()
const scratchPlayerVsEnemy = new THREE.Vector3()
const DASH_COOLDOWN_TIME = 4
const DASH_DURATION = 0.15
const DASH_SPEED_MULTIPLIER = 6.6 // +10% sulla distanza percorsa dal burst rispetto al valore originale (6)
// 2 cariche indipendenti invece di un solo cooldown: si può scattare due
// volte di fila (a cariche piene), poi si aspetta — le cariche si
// ricaricano IN SEQUENZA (un solo timer alla volta, non due in parallelo),
// ognuna alla stessa cadenza di prima (DASH_COOLDOWN_TIME)
const DASH_MAX_CHARGES = 2
const dashState = {
  charges: DASH_MAX_CHARGES,
  rechargeTimer: 0, // secondi alla PROSSIMA carica (0 se già a cariche piene)
  timeRemaining: 0, // secondi rimanenti dello scatto in corso
}

document.addEventListener('keydown', e => {
  if (e.code !== 'ShiftLeft' || e.repeat || menuState.mode !== 'play' || dashState.charges <= 0) return
  angleToForward(movementState.facing, dashDirection)
  dashState.timeRemaining = DASH_DURATION
  dashState.charges--
  if (dashState.rechargeTimer <= 0) dashState.rechargeTimer = DASH_COOLDOWN_TIME
})

document.addEventListener('keydown', e => {
  if (e.code !== 'KeyM' || e.repeat || menuState.mode === 'menu') return
  menuState.mode = menuState.mode === 'spectate' ? 'play' : 'spectate'
  modeIndicator.textContent = `MODE: ${menuState.mode.toUpperCase()}`
  dashPanel.classList.toggle('hidden', menuState.mode !== 'play')
  combatPanel.classList.toggle('hidden', menuState.mode !== 'play')
  crosshair.classList.toggle('hidden', menuState.mode !== 'play')
  // forza un nuovo click-per-entrare nel cambio modalità, per evitare
  // che un delta mouse residuo salti da uno schema di controllo all'altro
  // — suppressPauseOnUnlock: questo unlock è un dettaglio del cambio
  // modalità, non "il giocatore ha premuto Esc per mettere in pausa"
  if (controls.isLocked) { suppressPauseOnUnlock = true; controls.unlock() }
  // sicurezza: se si cambia modalità mentre si tiene il tasto destro
  // premuto, non restare bloccati in HANDLING senza modo di rilasciarlo
  // (non se un tiro è in corso: interromperlo a metà lascerebbe l'animazione
  // e lo stato palla in una via di mezzo incoerente)
  if (menuState.mode !== 'play' && manipulator.state === RobotState.HANDLING && shootingState.phase === 'idle') releaseBallHandling()
})

document.addEventListener('mousemove', e => {
  if (menuState.mode !== 'play' || !controls.isLocked) return
  cameraState.orbitYaw -= e.movementX * ORBIT_SENSITIVITY
  const isHandlingNow = manipulator.state === RobotState.HANDLING
  const pitchMin = isHandlingNow ? ORBIT_PITCH_MIN_HANDLING : ORBIT_PITCH_MIN
  const pitchMax = isHandlingNow ? ORBIT_PITCH_MAX_HANDLING : ORBIT_PITCH_MAX
  cameraState.orbitPitch = THREE.MathUtils.clamp(
    cameraState.orbitPitch + e.movementY * ORBIT_SENSITIVITY,
    pitchMin,
    pitchMax
  )
})

// --- Presa palla (tasto destro tenuto premuto, solo in Play) ---
// mentre è premuto: il palleggio si ferma, il braccio tiene la palla ferma
// in una posa di presa, la camera si avvicina (vedi HANDLING_CHASE_DISTANCE
// sopra). Al rilascio si torna al palleggio automatico, ripartendo da un
// 'push' pulito invece che da dove si era fermato prima della presa
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault())
// tracciato per il tasto R di test (vedi sezione Tiro sotto): sapere se il
// tasto destro è ANCORA giù in quel momento decide se si torna in HANDLING o
// in DRIBBLE dopo la "ricarica"
let rightMouseDown = false
document.addEventListener('mousedown', e => {
  if (e.button !== 2 || menuState.mode !== 'play') return
  rightMouseDown = true
  if (shootingState.phase !== 'idle') return // non interrompere un tiro in corso
  // senza la palla non c'è niente da stringere in mano: tasto destro non fa
  // nulla finché non la si raccoglie (pickup automatico toccandola a terra).
  // owner === manipulator, non solo state === HANDLED: in 1v1 la palla può
  // essere HANDLED dall'AVVERSARIO — senza questo controllo il tasto destro
  // faceva entrare in HANDLING anche senza possederla davvero (bug visibile
  // soprattutto dopo un contatto/steal dell'avversario)
  if (!basketball || basketball.state !== BallState.HANDLED || basketball.owner !== manipulator) return
  // cameraState.orbitPitch/orbitYaw NON vengono toccati qui: un tempo si
  // forzava orbitPitch a ORBIT_PITCH_REST all'ingresso in HANDLING, ma
  // questo scartava il punto che si stava mirando in DRIBBLE — il
  // crosshair saltava a puntare altrove (es. il pavimento) appena si
  // teneva il tasto destro. Il range pitch di HANDLING ([-0.9, 0.9], vedi
  // ORBIT_PITCH_MIN_HANDLING/MAX_HANDLING) contiene per intero quello di
  // DRIBBLE ([0.05, 0.9]), quindi non serve nessun clamp: lasciando
  // orbitPitch/orbitYaw invariati la DIREZIONE di mira resta esattamente
  // continua nella transizione (le due formule coincidono per lo stesso
  // yaw/pitch, vedi HANDLING_CAMERA_SIDE_OFFSET sopra) — solo la
  // POSIZIONE della camera si sposta, e quella è già interpolata sotto
  // (camera.position.lerp/quaternion.slerp in animate())
  manipulator.setState(RobotState.HANDLING)
  // altrimenti resterebbe bloccato a true per sempre dopo il primo tiro,
  // impedendo alla preview di traiettoria di riapparire quando si riafferra
  shootingState.released = false
})
document.addEventListener('mouseup', e => {
  if (e.button !== 2) return
  rightMouseDown = false
  if (manipulator.state !== RobotState.HANDLING || shootingState.phase !== 'idle') return
  releaseBallHandling()
})
// resetDribbleState/releaseBallHandling ora in src/BallPossession.js —
// riferimenti (resetDribbleState/releaseBallHandling) presi dal valore di
// ritorno di initBallPossession(), vedi poco più sotto dopo dribbleState/ecc.

// getShotDirection ora in src/ShootingSystem.js

// RobotState.NO_BALL si entra SOLO al momento del rilascio dentro 'release'
// (vedi updateShootAnimation), non subito al click: prima c'è tutta
// l'animazione di windup+rilascio, con la palla ancora incollata alla
// paletta come in HANDLING normale
// stato dello Shooting System consolidato in un unico oggetto (stesso
// principio di dribbleState/realDribbleState per il palleggio) invece di
// una dozzina di `let` sciolti a modulo — nessun cambio di comportamento,
// solo raccolti insieme
const shootingState = {
  phase: 'idle',      // 'idle' | 'windup' | 'release' | 'recover'
  phaseT: 0,
  released: false,    // per-tiro: true dal frame in cui la palla lascia davvero la paletta
  // per-tiro: true dal primo urto (backboard/ferro/muro/palo/panchina/
  // pavimento) dopo il rilascio — BallState passa da FREE_SHOT (bloccabile
  // con BLOCK, niente pickup automatico) a FREE (palla "sporca", pickup
  // normale) esattamente in quel momento, non prima
  hasBounced: false,
  // catturata al momento del rilascio (posizione del ROBOT, non della palla
  // quando arriva al canestro) — la regola dei 2/3 punti dipende da dove si
  // tirava, non da dove si trova la palla quando entra
  wasInsideArc: false,
  stateTransitionTimer: 0, // secondi rimanenti prima del vero cambio di stato (vedi shootTuning.stateTransitionDelay)
  // pose di gomito/link1/grip/tilt al momento del click, punto di partenza
  // del lerp di 'windup' — senza questo la prima svg dello windup
  // scatterebbe dalla posa di presa direttamente al target invece di
  // scorrere con continuità
  startElbowOffset: 0,
  startLink1Offset: 0,
  startGrip: 0,
  startTilt: 0,
  // aimPitchOffset "congelato" all'istante in cui parte 'recover' (vedi
  // sotto): il punto di partenza del suo lerp verso 0, calcolato una volta
  // sola invece di continuare a inseguire la camera anche durante il recupero
  recoverStartAimPitch: 0,
}
// shotVelocity ora dichiarato/posseduto da src/ShootingSystem.js (ritornato
// da initShootingSystem), non più qui
// dopo un urto (backboard/ferro/...), quanto ignorare NUOVE collisioni CON
// LO STESSO OGGETTO: con restituzione bassa (rimbalzo morbido voluto) la
// palla si allontana dalla superficie molto lentamente — così lentamente
// che senza questa pausa il check "sfera dentro il volume espanso" la
// ricattura ogni singolo frame (la spinge di nuovo esattamente sul bordo,
// riflette di nuovo una velocità già debole), restando visivamente
// "incollata" al punto d'urto per un bel po' invece di allontanarsene con
// shotCollisionCooldowns/clearAllCollisionCooldowns ora in
// src/ShootingSystem.js

// --- Pickup automatico (palla FREE toccata dal robot) ---
// nessun tasto: camminare abbastanza vicino a una palla libera (basketball.
// state === FREE, cioè manipulator.state === NO_BALL) la raccoglie da sola,
// con una piccola animazione interpolata (braccio che scende verso la posa
// di palleggio mentre la palla scivola da terra alla paletta), poi riparte
// il palleggio automatico normale
// margine extra oltre il bounding box reale del robot + BALL_RADIUS (vedi
// checkForPickup): un po' di tolleranza, non serve che la palla tocchi
// esattamente la carrozzeria
const PICKUP_MARGIN = 40
// la palla è già lockata alla paletta dal primo frame (vedi updatePickup):
// nessun rischio che "scappi" allungando questa durata — il braccio può
// permettersi un tuffo più leggibile, rapido ma non istantaneo
const PICKUP_DURATION = 0.3
const pickupState = { phase: 'idle', phaseT: 0 } // phase: 'idle' | 'active'

// wireframe di ispezione per i volumi di collisione/contatto (tasti
// numerici 1-8, vedi CollisionDebugView.js) — pensato per VEDERE le forme
// (backboard/ferro/muri/pali/panchine/zone STEAL-BLOCK-PICKUP) invece di
// leggerne solo i parametri nel pannello debug (tasto P). Costruito qui,
// non prima: serve collisionWorld (sopra) + manipulator/enemyManipulator
// (sopra) + PICKUP_MARGIN appena dichiarata
const { update: updateCollisionDebugView } = initCollisionDebugView({
  scene, collisionWorld, rimRingRadius: RIM_RING_RADIUS, rimTubeRadius: RIM_TUBE_RADIUS,
  manipulator, enemyManipulator, getBasketball: () => basketball,
  // stessa identica fonte di "dove sta guardando" usata da CombatMoves.js
  // (resolveAimYaw): il giocatore la camera/crosshair, il nemico le ruote
  // (niente camera) — la zona STEAL disegnata deve orientarsi esattamente
  // come quella vera, non una approssimazione a parte
  getPlayerAimYaw: () => cameraState.orbitYaw,
  getEnemyAimYaw: () => enemyManipulator.wheelsGroup.rotation.y,
  stealForwardMargin: STEAL_FORWARD_MARGIN, stealBackwardMargin: STEAL_BACKWARD_MARGIN,
  blockContactRadius: BLOCK_CONTACT_RADIUS, pickupMargin: PICKUP_MARGIN,
})

document.addEventListener('mousedown', e => {
  if (e.button !== 0 || menuState.mode !== 'play' || !controls.isLocked) return
  if (manipulator.state !== RobotState.HANDLING || shootingState.phase !== 'idle' || !basketball) return
  const [shootTriggerElbowAmplitude, shootTriggerLink1Amplitude] = dribbleAmplitudesRad(dribbleTuning)
  shootingState.startElbowOffset = dribbleState.armEase * shootTriggerElbowAmplitude
  shootingState.startLink1Offset = dribbleState.armEase * shootTriggerLink1Amplitude
  shootingState.startGrip = handlingState.grip
  shootingState.startTilt = handlingState.tiltOffset
  shootingState.phase = 'windup'
  shootingState.phaseT = 0
  shootingState.released = false
  shootingState.hasBounced = false
  clearAllCollisionCooldowns()
})

// tasto R: "ricarica" la palla per testare rapidamente il tiro senza dover
// rifare tutto il palleggio — interrompe qualunque tiro/volo in corso e la
// fa ricomparire in mano, in HANDLING se il tasto destro è ancora giù in
// quel momento, altrimenti in DRIBBLE (releaseBallHandling già fa reset
// pulito della macchina a stati del palleggio). Reset diretto (non
// interpolato) degli offset di tiro: è un tasto di test/debug, non fa parte
// del flusso di gioco normale
document.addEventListener('keydown', e => {
  // disabilitato in 1V1: "ricaricare" la palla in mano a comando sarebbe
  // un modo per aggirare STEAL/BLOCK contro un vero avversario — resta un
  // tasto di test valido solo in PRACTICE (nessuno da imbrogliare)
  if (e.code !== 'KeyR' || e.repeat || menuState.mode !== 'play' || menuState.gameMode === GameMode.ONE_V_ONE) return
  shootingState.phase = 'idle'
  shootingState.phaseT = 0
  shootingState.released = false
  shootingState.hasBounced = false
  shootingState.stateTransitionTimer = 0
  clearAllCollisionCooldowns()
  manipulator.controls.setAimPitch(0)
  manipulator.controls.setShootTilt(0)
  manipulator.controls.setDribbleOffsets(0, 0)
  dribbleState.armEase = 0
  handlingState.tiltOffset = 0
  pickupState.phase = 'idle'
  // il tasto di test "ricarica" la palla forzatamente in mano — deve anche
  // riportarla a HANDLED, altrimenti il tasto destro resterebbe bloccato
  // dal gate pensato per il pickup normale (basketball.state !== HANDLED)
  if (basketball) {
    basketball.setState(BallState.HANDLED)
    basketball.setOwner(manipulator)
  }
  if (rightMouseDown) {
    manipulator.setState(RobotState.HANDLING)
  } else {
    releaseBallHandling()
  }
})

// --- Palleggio (sempre attivo, non solo in Play) ---
// macchina a stati sincronizzata col gomito (no libreria fisica/tween):
// 'push'  → il gomito (+ link1, ampiezza minore) spinge la paletta verso
//           il basso; la palla è "incollata" alla sua posizione mondo
//           reale (X/Y/Z), non alla fisica libera
// 'drop'  → il gomito resta fermo dov'è arrivato; la palla, rilasciata,
//           continua a cadere da sola sotto gravità finché non tocca terra
// 'rise'  → la palla rimbalza e risale sotto gravità (fisica pura + una
//           piccola correzione costante in Y); il gomito (+ link1) risale
//           in parallelo, sincronizzato sulla stessa durata balistica, per
//           incontrarla di nuovo in cima e ricominciare con 'push'
// In X/Z il pallone segue sempre la posizione mondo reale della paletta.
// BALL_GRAVITY/BALL_BOUNCE_SPEED dichiarate più sopra (fisse); DRIBBLE_* regolabili da debug.
// Stato del palleggio vero, consolidato in un unico oggetto (stesso
// principio di shootingState/cameraState/menuState) — l'oggetto passato
// DIRETTAMENTE a stepDribble (vedi updateDribble più sotto), senza più il
// giro di sync-da/verso-let sciolti di prima di questa consolidazione:
// - phase/phaseT: fase corrente ('push'|'drop'|'rise') e relativo timer
// - armEase: 0 = braccio a riposo (in cima), 1 = spinta al massimo —
//   persiste anche durante 'drop' (il braccio resta fermo dov'è arrivato),
//   aggiornata solo in 'push'/'rise'
// - ballVelocityY: velocità verticale vera della palla in 'drop'/'rise'
// - riseBallisticY: fisica balistica pura di 'rise', SEPARATA dalla Y
//   renderizzata — se si sottraesse dribbleTuning.riseYCorrection direttamente
//   dalla Y renderizzata ogni frame, il frame successivo ripartirebbe già
//   "corretto" e la sottrazione si accumulerebbe frame dopo frame invece
//   di restare un piccolo offset costante
// - previousPushPaddleY: Y della PALETTA (non della palla) al frame
//   precedente, solo durante 'push' — serve a dedurre la velocità reale
//   che la spinta impartisce (differenza finita), così 'drop' riparte da
//   quella invece che da un azzeramento secco. null = "appena entrati in
//   push, nessuna storia da cui dedurla"
// - lockOffset (Vector3): offset palla↔paletta congelato nell'istante in
//   cui la palla si "riaggancia" (fine 'rise' → 'push') — il lock parte
//   esattamente da lì (nessuno scatto), poi si riassorbe verso 0 nel corso
//   della spinta
const dribbleState = {
  phase: 'push', phaseT: 0, armEase: 0,
  ballVelocityY: 0, riseBallisticY: 0, previousPushPaddleY: null,
  lockOffset: new THREE.Vector3(),
}
// paddleWorldPos ora in src/BallPossession.js (esportata — condivisa anche
// con ShootingSystem.js e col pannello debug in src/debugPanel.js)

// timestep fisso per la simulazione del palleggio, disaccoppiato dal
// framerate di rendering (accumulator pattern): il render loop gira a
// delta variabile (vsync/hitch/tab in background), ma updateDribble vede
// SEMPRE lo stesso dt piccolo e costante. Questo è ciò che rende la
// traiettoria riproducibile (stesse condizioni iniziali → stessa curva,
// indipendentemente da quanto è fluido il framerate quella volta) ed
// elimina alla radice — non solo attutisce — il caso patologico di un
// singolo frame con delta enorme che capita esattamente sul frame in cui
// dribbleState.armEase satura a 1: qui quel frame verrebbe semplicemente diviso
// in più passi da DRIBBLE_FIXED_DT, mai in un passo unico anomalo
const DRIBBLE_FIXED_DT = 1 / 120
let dribbleAccumulator = 0
let enemyDribbleAccumulator = 0 // stesso accumulator, tracciato a parte: il nemico palleggia in modo indipendente dal giocatore

// --- Loop ---
const clock = new THREE.Clock()
// tetto al delta per frame (tab in background, hitch): evita che un salto
// enorme faccia "saltare" fisica/animazioni in un colpo solo. Stesso valore
// usato anche dal clock indipendente della preview robot nel Main Menu
const MAX_DELTA = 0.1

// Simulazione del palleggio estratta a parte (non solo inline in
// updateDribble): stessa identica macchina a stati/fisica, ma parametrizzata
// su un robot/bersaglio-palla qualunque invece dei soli manipulator/
// basketball globali — riusata IDENTICA anche dalla preview robot del Main
// Menu (vedi renderRobotCardPreview), che deve mostrare il vero palleggio,
// non un'imitazione con un timing indovinato a parte.
// stepDribble/updateDribble/updateHandling/handlingState ora in
// src/BallPossession.js — handlingState resta bisognosa qui per il
// pannello debug (readout), passata dentro insieme a dribbleState
const handlingState = { grip: 0, tiltOffset: 0 }
// volume ridotto per il thump del palleggio automatico: non si ferma mai,
// a piena intensità (1) diventava fastidioso in loop continuo
const DRIBBLE_BOUNCE_SOUND_VOLUME = 0.35

// RobotState.NO_BALL: vi si entra a metà di updateShootAnimation, esattamente
// al momento del rilascio (vedi sotto) — da lì la palla vola come un vero
// proiettile sotto gravità pura (stessa BALL_GRAVITY del palleggio),
// staccata da qualunque tracking sulla paletta
// resolveSphereBoxCollision/resolveSphereTorusCollision/resolveEnvironmentCollisions
// spostate in CollisionWorld (src/CollisionWorld.js, istanziata più sotto
// come collisionWorld) — stesso comportamento, solo raccolto in una classe

// isHoopCrossing/score/addScore/checkHoopScore/applyHoopAssist/
// updateShotFlight/stepShotFlight ora in src/ShootingSystem.js

// checkForPickup/updatePickup ora in src/BallPossession.js
const PICKUP_COARSE_RADIUS = 300

// gameContext: un unico oggetto con tutto ciò che è genuinamente condiviso
// da 2 o più dei moduli estratti (BallPossession/ShootingSystem/
// debugPanel/MainMenu, sotto) — riferimenti stabili (manipulator/camera/
// scene/sfx/controls) e oggetti-stato mutabili (cameraState/dribbleState/
// handlingState/pickupState/shootingState/dribbleTuning/handlingTuning/
// shootTuning). Costruito una volta sola, poi ogni init riceve
// `{ ...gameContext, campiSuoi... }` invece di ricopiare a mano gli stessi
// nomi in 4 letterali paralleli — un futuro campo condiviso si aggiunge qui
// una volta, non in 4 punti che possono disallinearsi. collisionWorld NON
// è qui: lo usa solo ShootingSystem (1 consumer su 4), passato diretto lì
// invece di allargare "condiviso" a chi non lo tocca.
//
// getBasketball/getBallRadius sono FUNZIONI (non proprietà `get`/accessor):
// lo spread `{ ...gameContext }` nelle chiamate sotto copia il VALORE di
// ogni proprietà — per un accessor `get x() {...}` questo lo invoca subito e
// ne congela il risultato CORRENTE in una proprietà statica sul nuovo
// oggetto (verificato: `{...{get v(){return x}}}.v` non segue più
// aggiornamenti di `x`), mai più un getter. Una proprietà il cui VALORE è
// una funzione (`getBasketball: () => basketball`) non ha questo problema:
// lo spread copia il riferimento alla funzione, non il suo risultato — la
// stessa funzione richiamata più tardi legge sempre `basketball` fresco.
// basketball resta un `let` di modulo riassegnato in modo asincrono al
// caricamento del GLTF (è `null` all'avvio) — un valore catturato allo
// spread resterebbe `null` per sempre, da qui la necessità della funzione
// invece del valore diretto. BALL_RADIUS è un `let` condiviso con molto
// altro codice qui in main.js per lo stesso motivo di fondo (letto fresco
// ad ogni chiamata, non congelato allo spread)
// gameContext: campi VERAMENTE condivisi da entrambi i robot (giocatore E
// nemico) — un solo pallone/collisionWorld/audio in scena, stesso tuning
// fisico. NON qui: manipulator/dribbleState/handlingState/pickupState/
// shootingState/computeAimPitchOffset/getShotDirection — sono per-robot
// (ognuno pilotato in modo diverso, input utente vs AI, con la propria
// macchina a stati indipendente), passati espliciti ad ogni chiamata sotto
const gameContext = {
  getBasketball: () => basketball,
  camera, scene, sfx, controls,
  cameraState,
  dribbleTuning, handlingTuning, shootTuning,
  getBallRadius: () => BALL_RADIUS,
}

// stealState/blockState (e le versioni enemy): dichiarati QUI, PRIMA di
// initBallPossession — checkForPickup li legge (sotto) per non far partire
// un pickup mentre il proprio steal/block è ancora a metà del resolve (due
// animazioni sugli stessi joint nello stesso frame, la paletta finiva
// "aperta" come nella posa di block invece di interpolare verso il
// dribble). Anche initCombatMoves li userà più sotto: l'istanza del
// giocatore deve leggere/scrivere lo stealState del NEMICO (per il lockout
// anti-steal-back) e viceversa, il che servirebbe un riferimento
// circolare se nascessero dentro initCombatMoves stesso
const stealState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0, startAimYaw: 0, contactMade: false }
const blockState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0 }
const enemyStealState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0, startAimYaw: 0, contactMade: false }
const enemyBlockState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0 }

// --- Giocatore: palleggio/HANDLING/pickup/tiro pilotati da mouse+tastiera ---
// Ball Possession: palleggio automatico, HANDLING, pickup — estratti in
// src/BallPossession.js (stesso principio di MainMenu.js: un unico oggetto
// context, zero import circolari)
const {
  resetDribbleState, releaseBallHandling,
  updateDribble, updateHandling, checkForPickup, updatePickup,
} = initBallPossession({
  ...gameContext,
  manipulator, dribbleState, handlingState, pickupState, shootingState,
  stealState, blockState,
  computeAimPitchOffset,
  dribbleBounceSoundVolume: DRIBBLE_BOUNCE_SOUND_VOLUME,
  pickupDuration: PICKUP_DURATION, pickupMargin: PICKUP_MARGIN, pickupCoarseRadius: PICKUP_COARSE_RADIUS,
})

// Direzione di tiro del giocatore: raycast dalla camera attraverso il PIXEL
// del crosshair (non il centro schermo) — in HANDLING la camera ha un
// orientamento libero vero (quaternion, non lookAt), quindi quel raggio è
// esattamente dove si sta mirando. Spostata qui da ShootingSystem.js: quel
// modulo ora riceve getShotDirection dall'esterno (il nemico ne passa una
// diversa, basata sull'AI — vedi sotto), non deve sapere cos'è un crosshair
const shootRaycaster = new THREE.Raycaster()
const crosshairNDC = new THREE.Vector2()
function getShotDirection(out) {
  crosshairNDC.set(0, (2 * CROSSHAIR_HEIGHT) / window.innerHeight)
  shootRaycaster.setFromCamera(crosshairNDC, camera)
  return out.copy(shootRaycaster.ray.direction)
}

// Shooting System: tiro, hoop assist, punteggio, preview di traiettoria —
// estratti in src/ShootingSystem.js. rimRingRadius passato direttamente
// (const importata da CollisionWorld.js, mai riassegnata — nessun bisogno
// di getter). score/scoreboard restano UN SOLO contatore condiviso per ora
// (stile PRACTICE): il punteggio per-squadra arriva insieme alla vera
// modalità 1v1 nel menu (ancora disabilitata), non prima
const {
  addScore, checkHoopScore, clearAllCollisionCooldowns,
  updateShotFlight, updateShootAnimation, updateTrajectoryPreview, hideTrajectoryPreview,
  shotVelocity, trajDebug,
  resetScore: resetShootingScore,
} = initShootingSystem({
  ...gameContext,
  manipulator, dribbleState, handlingState, shootingState,
  computeAimPitchOffset, getShotDirection,
  collisionWorld,
  rimRingRadius: RIM_RING_RADIUS,
  getTargetHoopIndex: getPlayerTargetHoopIndex,
})

// --- Nemico (1v1, Section 3): stessa identica macchina a stati/fisica,
// pilotata dall'AI (src/EnemyAI.js) invece che da mouse/tastiera — un set
// di oggetti-stato indipendente, MAI condiviso col giocatore: i due robot
// palleggiano/mirano/tirano ognuno per conto proprio
const enemyShootingState = {
  phase: 'idle', phaseT: 0, released: false, hasBounced: false, wasInsideArc: false,
  stateTransitionTimer: 0,
  startElbowOffset: 0, startLink1Offset: 0, startGrip: 0, startTilt: 0,
  recoverStartAimPitch: 0,
}
const enemyPickupState = { phase: 'idle', phaseT: 0 }
const enemyDribbleState = {
  phase: 'push', phaseT: 0, armEase: 0,
  ballVelocityY: 0, riseBallisticY: 0, previousPushPaddleY: null,
  lockOffset: new THREE.Vector3(),
}
const enemyHandlingState = { grip: 0, tiltOffset: 0 }

const {
  resetDribbleState: enemyResetDribbleState,
  updateDribble: enemyUpdateDribble, updateHandling: enemyUpdateHandling,
  checkForPickup: enemyCheckForPickup, updatePickup: enemyUpdatePickup,
} = initBallPossession({
  ...gameContext,
  manipulator: enemyManipulator,
  dribbleState: enemyDribbleState, handlingState: enemyHandlingState,
  pickupState: enemyPickupState, shootingState: enemyShootingState,
  stealState: enemyStealState, blockState: enemyBlockState,
  // il nemico non ha una "camera" da inseguire (computeAimPitchOffset del
  // giocatore legge cameraState.orbitPitch) — l'inclinazione reale del tiro
  // viene comunque da getShotDirection, questo tocca solo il gomito visivo
  computeAimPitchOffset: () => 0,
  dribbleBounceSoundVolume: DRIBBLE_BOUNCE_SOUND_VOLUME,
  pickupDuration: PICKUP_DURATION, pickupMargin: PICKUP_MARGIN, pickupCoarseRadius: PICKUP_COARSE_RADIUS,
})

// canestro assegnato per squadra: Team.A (giocatore) mira/segna solo su
// hoops[0], Team.B (nemico) solo su hoops[1] — in 1V1 nessuno dei due può
// segnare "ovunque". In PRACTICE (nessuna squadra avversaria reale) resta
// libero: getTargetHoopIndex per il giocatore ritorna null finché
// menuState.gameMode non è davvero ONE_V_ONE, vedi sotto
const TEAM_HOOP_INDEX = { [Team.A]: 0, [Team.B]: 1 }
function getPlayerTargetHoopIndex() {
  return menuState.gameMode === GameMode.ONE_V_ONE ? TEAM_HOOP_INDEX[Team.A] : null
}
// il nemico esiste SOLO in 1V1 (in PRACTICE resta nascosto/inattivo).
// null qui non avrebbe senso pratico, ma niente vieta di restare coerenti
// con la stessa formula del giocatore
function getEnemyTargetHoopIndex() {
  return menuState.gameMode === GameMode.ONE_V_ONE ? TEAM_HOOP_INDEX[Team.B] : null
}

// direzione di tiro dell'AI: NON una linea retta verso il canestro (a
// velocità costante e una direzione piatta, la gravità la faceva cadere
// molto prima del bersaglio — "tirano tutti al suolo") — vera soluzione
// balistica: dati velocità (costante, come il giocatore) e gravità, quale
// ANGOLO di elevazione fa atterrare il proiettile esattamente sul
// bersaglio? Formula standard del tiro parabolico, risolta per l'angolo:
//   tan(θ) = (v² ± √(v⁴ - g(g·x² + 2·y·v²))) / (g·x)
// due soluzioni (arco basso/arco alto): presa quella ALTA (+), un vero
// tiro in arco verso il canestro invece di una linea quasi piatta. Se il
// discriminante è negativo, il bersaglio è fuori portata a questa
// velocità: 50° come ripiego ragionevole piuttosto che un errore
function solveBallisticElevation(horizontalDist, heightDiff, speed) {
  const v2 = speed * speed
  const discriminant = v2 * v2 - BALL_GRAVITY * (BALL_GRAVITY * horizontalDist * horizontalDist + 2 * heightDiff * v2)
  if (discriminant < 0 || horizontalDist < 1) return THREE.MathUtils.degToRad(50)
  const tanTheta = (v2 + Math.sqrt(discriminant)) / (BALL_GRAVITY * horizontalDist)
  return Math.atan(tanTheta)
}
const enemyAimTarget = new THREE.Vector3()
const enemyPaddleWorldPos = new THREE.Vector3()
function enemyGetShotDirection(out) {
  const hoop = collisionWorld.hoops[TEAM_HOOP_INDEX[Team.B]]
  enemyAimTarget.set(hoop.center.x, hoop.center.y, hoop.center.z)
  // dalla paletta reale (dove la palla lascia davvero la mano), non dal
  // root a terra — la differenza di altezza conta per l'angolo balistico
  getObjectWorldPosition(enemyManipulator.paddle, enemyPaddleWorldPos)
  const dx = enemyAimTarget.x - enemyPaddleWorldPos.x
  const dz = enemyAimTarget.z - enemyPaddleWorldPos.z
  const horizontalDist = Math.sqrt(dx * dx + dz * dz)
  const heightDiff = enemyAimTarget.y - enemyPaddleWorldPos.y
  const speed = enemyGetEffectiveShotSpeed(enemyManipulator.root.position)
  const elevation = solveBallisticElevation(horizontalDist, heightDiff, speed)
  const invDist = 1 / horizontalDist
  return out.set(dx * invDist * Math.cos(elevation), Math.sin(elevation), dz * invDist * Math.cos(elevation)).normalize()
}

// niente updateTrajectoryPreview/hideTrajectoryPreview per il nemico: non
// c'è una camera libera da inseguire mentre mira, quel concetto resta
// solo-giocatore
const {
  updateShotFlight: enemyUpdateShotFlight, updateShootAnimation: enemyUpdateShootAnimation,
  shotVelocity: enemyShotVelocity, clearAllCollisionCooldowns: enemyClearAllCollisionCooldowns,
  resetScore: resetEnemyShootingScore, getEffectiveShotSpeed: enemyGetEffectiveShotSpeed,
} = initShootingSystem({
  ...gameContext,
  manipulator: enemyManipulator,
  dribbleState: enemyDribbleState, handlingState: enemyHandlingState, shootingState: enemyShootingState,
  computeAimPitchOffset: () => 0, getShotDirection: enemyGetShotDirection,
  collisionWorld,
  rimRingRadius: RIM_RING_RADIUS,
  scoreElementId: 'enemy-score-value', // contatore separato dal giocatore — vedi Point System 1v1
  getTargetHoopIndex: getEnemyTargetHoopIndex,
})

// STEAL/BLOCK (src/CombatMoves.js): un'istanza per robot, ognuna sa solo
// del proprio manipulator e di "l'altro" — simmetrico, funziona identico
// se a rubare/bloccare è il giocatore o il nemico. Costruite PRIMA
// dell'AI (sotto): l'AI usa enemyTriggerSteal/enemyTriggerBlock
// (stealState/blockState/enemyStealState/enemyBlockState dichiarati più in
// alto, PRIMA di initBallPossession: checkForPickup li legge per non far
// partire un pickup mentre il proprio steal/block è ancora a metà)
const {
  triggerSteal, triggerBlock, updateSteal, updateBlock,
  canUseSteal, canUseBlock,
} = initCombatMoves({
  manipulator, otherManipulator: enemyManipulator,
  resetDribbleState, otherResetDribbleState: enemyResetDribbleState,
  dribbleTuning, dribbleState, getBasketball: () => basketball,
  otherShootingState: enemyShootingState, otherHandlingState: enemyHandlingState,
  otherStealState: enemyStealState, otherPickupState: enemyPickupState, sfx,
  stealState, blockState, shootingState, pickupState, handlingState,
  // sweep di STEAL: parte da dove sta guardando la camera (crosshair),
  // non da dove puntano le ruote — in NO_BALL l'orbita è libera rispetto
  // al movimento, altrimenti lo sweep poteva partire "di lato"
  getAimYaw: () => cameraState.orbitYaw,
})
const {
  triggerSteal: enemyTriggerSteal, triggerBlock: enemyTriggerBlock,
  updateSteal: enemyUpdateSteal, updateBlock: enemyUpdateBlock,
  canUseSteal: enemyCanUseSteal,
} = initCombatMoves({
  manipulator: enemyManipulator, otherManipulator: manipulator,
  resetDribbleState: enemyResetDribbleState, otherResetDribbleState: resetDribbleState,
  dribbleTuning, dribbleState: enemyDribbleState, getBasketball: () => basketball,
  otherShootingState: shootingState, otherDashState: dashState, otherHandlingState: handlingState,
  otherStealState: stealState, otherPickupState: pickupState, sfx,
  stealState: enemyStealState, blockState: enemyBlockState, shootingState: enemyShootingState,
  pickupState: enemyPickupState, handlingState: enemyHandlingState,
})

// tasti STEAL/BLOCK (solo Play E solo 1V1 — in PRACTICE non c'è nessun
// avversario da derubare/bloccare; solo in NO_BALL, gate/cooldown gestiti
// internamente da initCombatMoves — qui solo il trigger dell'input)
document.addEventListener('keydown', e => {
  if (menuState.mode !== 'play' || e.repeat || menuState.gameMode !== GameMode.ONE_V_ONE) return
  if (e.code === 'KeyQ') triggerSteal()
  else if (e.code === 'KeyE') triggerBlock()
})

// AI del nemico (src/EnemyAI.js): decide lo stato tattico (CHASE_BALL/
// ATTACK/DEFEND/COVER) e pilota enemyManipulator ogni frame — le funzioni
// di palleggio/tiro/STEAL/BLOCK sopra restano identiche a quelle del
// giocatore, l'AI le aziona (setState/trigger dei tempi giusti) invece di
// mouse/tastiera
const { update: updateEnemyAI, resetWheelsAngle: resetEnemyWheelsAngle } = initEnemyAI({
  enemyManipulator, playerManipulator: manipulator, getBasketball: () => basketball, collisionWorld,
  enemyDribbleState, enemyHandlingState, enemyShootingState,
  dribbleTuning, clearAllCollisionCooldowns: enemyClearAllCollisionCooldowns,
  triggerSteal: enemyTriggerSteal, triggerBlock: enemyTriggerBlock,
  targetHoopIndex: TEAM_HOOP_INDEX[Team.B],
  playerTargetHoopIndex: TEAM_HOOP_INDEX[Team.A],
  canUseSteal: enemyCanUseSteal,
  getEffectiveShotSpeed: enemyGetEffectiveShotSpeed,
  playerShootingState: shootingState,
  enemyStealState, enemyBlockState,
})

// Pannello debug (tasto P): costruzione slider/readout in src/debugPanel.js
// — i 6 valori ancora `let` sciolti qui (usati anche altrove in main.js,
// non consolidati in oggetto) passati come coppie getter/setter, stesso
// principio di getBallRadius già in gameContext
const { cameraPanel, updateReadouts } = initDebugPanel({
  ...gameContext,
  // manipulator/dribbleState/pickupState non sono più in gameContext (sono
  // per-robot dopo il refactor 1v1) — il pannello debug resta SOLO per il
  // robot del giocatore, li passa espliciti qui
  manipulator, dribbleState, pickupState,
  trajDebug, pickupMargin: PICKUP_MARGIN,
  setBallRadius: v => { BALL_RADIUS = v; if (basketball) basketball.scale.setScalar(v) },
  getHandlingHeightBoost: () => HANDLING_HEIGHT_BOOST,
  setHandlingHeightBoost: v => { HANDLING_HEIGHT_BOOST = v },
  getHandlingCameraSideOffset: () => HANDLING_CAMERA_SIDE_OFFSET,
  setHandlingCameraSideOffset: v => { HANDLING_CAMERA_SIDE_OFFSET = v },
  getBallRestExtraOffset: () => BALL_REST_EXTRA_OFFSET,
  setBallRestExtraOffset: v => { BALL_REST_EXTRA_OFFSET = v; manipulator.controls.setBallRestOffset(v) },
  getArmYawOffsetDeg: () => ARM_YAW_OFFSET_DEG,
  setArmYawOffsetDeg: v => { ARM_YAW_OFFSET_DEG = v },
  getCrosshairHeight: () => CROSSHAIR_HEIGHT,
  setCrosshairHeight: v => { CROSSHAIR_HEIGHT = v; updateCrosshairPosition() },
})

// --- Main Menu ---
// centro/quota/raggio scelti a occhio per un'inquadratura "isometrica"
// plausibile sull'intero campo (bounding box reale del GLTF ≈
// X:-1730..1490 Z:-1580..1890, vedi commenti sulle collisioni dei muri)
const MENU_ORBIT_CENTER = new THREE.Vector3(-120, 0, 155)
const MENU_ORBIT_RADIUS = 1400
const MENU_ORBIT_HEIGHT = 900
const MENU_ORBIT_SPEED = 0.05 // rad/s, molto lenta apposta
let menuOrbitAngle = 0
function updateMenuCameraOrbit(delta) {
  menuOrbitAngle += MENU_ORBIT_SPEED * delta
  camera.position.set(
    MENU_ORBIT_CENTER.x + Math.cos(menuOrbitAngle) * MENU_ORBIT_RADIUS,
    MENU_ORBIT_HEIGHT,
    MENU_ORBIT_CENTER.z + Math.sin(menuOrbitAngle) * MENU_ORBIT_RADIUS
  )
  camera.lookAt(MENU_ORBIT_CENTER)
}

// BACK TO MAIN MENU deve riportare a una partita davvero pulita, non solo
// azzerare il punteggio — altrimenti una nuova PRACTICE iniziava con 0
// punti ma il robot dove lo si era lasciato fisicamente sul campo, ancora
// a metà tiro/palleggio/dash. Riporta ogni pezzo di stato transitorio (non
// gameMode/timeOfDay: quelli restano l'ultima scelta, si ricambiano
// rifacendo il flusso se serve) alla stessa condizione di un ingresso a
// freddo in Play — passata come callback a initMainMenu, che non deve sapere
// come funziona dentro (tocca troppi `let` sparsi per essere spostata anche
// lei senza un altro giro di consolidamento)
// Main Menu: navigazione/DOM-wiring + resetGameplayState estratti in
// src/MainMenu.js (esperimento di split "alla isometric_racer" — un unico
// oggetto context passato dentro, zero import circolari). Ora che
// movementState/cameraState/dashState/shootingState/handlingState/
// pickupState sono tutti oggetti (non più `let` sciolti), resetGameplayState
// non ha più bisogno di restare qui come callback: si sposta anche lei.
// basketball è un getter (non un valore semplice): all'avvio del modulo è
// ancora null (il GLTF carica async), un valore catturato qui sarebbe
// rimasto null per sempre — il getter legge invece il valore CORRENTE
// ogni volta che viene chiamato
// openPauseMenu riusata qui sotto (listener 'unlock' più sopra) —
// resumeGame/showMenuScreen restano disponibili nel valore di ritorno per
// altri punti d'ingresso futuri, non ancora servite fuori da MainMenu.js stesso
const { openPauseMenu } = initMainMenu({
  ...gameContext,
  // manipulator/shootingState/handlingState/pickupState non sono più in
  // gameContext (per-robot dopo il refactor 1v1) — il reset di
  // BACK TO MAIN MENU riguarda solo il giocatore, passati espliciti qui
  manipulator, shootingState, handlingState, pickupState,
  stealState, blockState,
  // il nemico va resettato insieme (posizione dal proprio lato, stato
  // pulito) altrimenti BACK TO MAIN MENU → PRACTICE riparte con l'IA a
  // metà tiro/palleggio di prima, o dalla parte sbagliata di campo
  enemyManipulator, enemyShootingState, enemyHandlingState, enemyPickupState,
  enemyStealState, enemyBlockState, enemyShotVelocity,
  enemyResetDribbleState, enemyClearAllCollisionCooldowns, resetEnemyWheelsAngle,
  menuOverlayEl: document.getElementById('menu-overlay'),
  hint, dashPanel, combatPanel, crosshair, modeIndicator,
  scoreboardEl: document.getElementById('scoreboard'),
  enemyScoreboardEl: document.getElementById('enemy-score-col'),
  controlsHintEl: document.getElementById('controls-hint'),
  menuState,
  applyTimeOfDayPreset, resetScore: resetShootingScore, resetEnemyScore: resetEnemyShootingScore,
  renderer, sun, ssaoPass,
  movementState, dashState, dashMaxCharges: DASH_MAX_CHARGES,
  shotVelocity, ORBIT_PITCH_REST,
  resetDribbleState, clearAllCollisionCooldowns, hideTrajectoryPreview,
})

// --- Main Menu: anteprima robot live (card MANIPULATOR) ---
// stessa tecnica base di isometric_racer (src/ui/carPreview.js, vedi
// README): renderer offscreen condiviso, camera inquadrata sul bounding
// box reale del modello (non una foto/asset statico — il robot è
// procedurale, non ha senso avere uno screenshot pre-fatto). A differenza
// della prima versione (un render singolo → PNG statico), qui il
// renderer resta vivo e il canvas stesso finisce nella card: il robot
// palleggia davvero (stessa API controls.setDribbleOffsets del palleggio
// vero), animato finché la sua schermata è quella attiva.
// Parametrizzata su (targetElementId, activeFlagKey) e chiamata due volte
// sotto — una per la card ROBOT (giocatore), una per ROBOT AVVERSARIO
// (1V1, vedi MainMenu.js): stesso identico setup, un renderer/scena/robot
// indipendente ciascuna (costo di setup pagato una sola volta all'avvio
// del menu, non un hot path), gating separato così la preview non visibile
// non continua a renderizzare in background
menuState.robotPreviewActive = false
menuState.enemyRobotPreviewActive = false
function renderRobotCardPreview(targetElementId, activeFlagKey) {
  const previewSize = 200
  const previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  previewRenderer.setSize(previewSize, previewSize)
  previewRenderer.setPixelRatio(1)
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace
  previewRenderer.toneMapping = THREE.ACESFilmicToneMapping
  previewRenderer.domElement.style.maxWidth = '100%'
  previewRenderer.domElement.style.maxHeight = '100%'

  const previewScene = new THREE.Scene()
  previewScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
  const previewKeyLight = new THREE.DirectionalLight(0xffffff, 1.8)
  previewKeyLight.position.set(1, 1.2, 1)
  previewScene.add(previewKeyLight)

  const previewCamera = new THREE.PerspectiveCamera(35, 1, 1, 10000)

  const previewRobot = new ManipulatorRobot()
  previewRobot.controls.manipulatorScale(45)
  previewScene.add(previewRobot.root)

  // pallone della preview: una sfera semplice (colore arancione da
  // pallacanestro) invece del GLTF vero — il pallone reale carica async e
  // potrebbe non essere pronto quando il menu appare, e per un'icona da
  // 200px il dettaglio in più non si vedrebbe comunque
  const previewBall = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.7 })
  )
  previewScene.add(previewBall)

  // inquadra il bounding box reale (robot + raggio di escursione del
  // pallone, non solo il robot a riposo — altrimenti il pallone in basso
  // durante la spinta uscirebbe dal frame) — distanza minima per
  // contenere tutti gli 8 angoli nel frustum, vista di 3/4 dall'alto
  const box = new THREE.Box3().setFromObject(previewRobot.root)
  // margine verticale doppio rispetto a X/Z: la palla scende fin quasi al
  // pavimento durante drop/rise, non solo di un raggio come in orizzontale
  const PREVIEW_BALL_VERTICAL_MARGIN_FACTOR = 2
  box.expandByVector(new THREE.Vector3(BALL_RADIUS, BALL_RADIUS * PREVIEW_BALL_VERTICAL_MARGIN_FACTOR, BALL_RADIUS))
  const center = box.getCenter(new THREE.Vector3())
  const viewDir = new THREE.Vector3(0.9, 0.55, 1).normalize()
  const halfFovRad = THREE.MathUtils.degToRad(previewCamera.fov / 2)
  let maxDist = 0
  const corner = new THREE.Vector3()
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    ).sub(center)
    const alongView = corner.dot(viewDir)
    const perp = Math.sqrt(Math.max(corner.lengthSq() - alongView * alongView, 0))
    const distForCorner = perp / Math.tan(halfFovRad) - alongView
    if (distForCorner > maxDist) maxDist = distForCorner
  }
  const distance = maxDist * 1.08 // 8% di margine
  previewCamera.position.copy(center).addScaledVector(viewDir, distance)
  previewCamera.lookAt(center)

  document.getElementById(targetElementId).replaceChildren(previewRenderer.domElement)

  // palleggio della preview: chiama stepDribble, la STESSA identica
  // funzione/simulazione del palleggio automatico vero (vedi sopra, non
  // una ricostruzione approssimata a parte) — solo con un proprio oggetto
  // state e il proprio robot/palla bersaglio. Nessun suono (onBounce
  // omesso): sfogliare i menu non deve produrre un thump ad ogni rimbalzo
  const previewDribbleState = {
    phase: 'push', phaseT: 0, armEase: 0,
    ballVelocityY: 0, previousPushPaddleY: null, riseBallisticY: 0,
    lockOffset: new THREE.Vector3(),
  }
  const previewClock = new THREE.Clock()

  function tickPreview() {
    requestAnimationFrame(tickPreview)
    if (!menuState[activeFlagKey]) { previewClock.getDelta(); return } // consuma il delta senza animare, niente salto al rientro
    const dt = Math.min(previewClock.getDelta(), MAX_DELTA)
    stepDribble(previewDribbleState, previewRobot, previewBall.position, dt, { dribbleTuning, ballRadius: BALL_RADIUS })
    previewRenderer.render(previewScene, previewCamera)
  }
  tickPreview()
}
renderRobotCardPreview('robot-preview-manipulator', 'robotPreviewActive')
renderRobotCardPreview('robot-preview-manipulator-enemy', 'enemyRobotPreviewActive')

// barre a blocchi delle stat sulla card robot (Main Menu → ROBOT): letture
// dirette da MANIPULATOR_STATS (src/robots/ManipulatorRobot.js), non valori
// ricopiati a mano nell'HTML — se una stat cambia in futuro la card resta
// allineata da sola. maxByStat riflette le scale reali usate altrove nel
// codice (SPEED/STEAL/BLOCK 1-5, SHOOTING 1-3 — vedi ManipulatorRobot.js/
// applyHoopAssist/CombatMoves.js)
function renderStatBars(containerEl, stats) {
  const maxByStat = { speed: 5, shooting: 3, steal: 5, block: 5 }
  containerEl.replaceChildren(...Object.entries(stats).map(([key, value]) => {
    const max = maxByStat[key] ?? value
    const row = document.createElement('div')
    row.className = 'stat-row'
    const label = document.createElement('span')
    label.className = 'stat-label'
    label.textContent = key.toUpperCase()
    const bar = document.createElement('div')
    bar.className = 'stat-bar'
    for (let i = 0; i < max; i++) {
      const block = document.createElement('div')
      block.className = 'stat-block' + (i < value ? ' filled' : '')
      bar.appendChild(block)
    }
    row.append(label, bar)
    return row
  }))
}
renderStatBars(document.getElementById('robot-stats-manipulator'), MANIPULATOR_STATS)

// LEGGED MANIPULATOR/DRONE: stat di roster per le card disabilitate del
// Main Menu (Section 4, ancora nessuna factory/classe reale — solo il
// numero da mostrare in anteprima) — non esiste ancora un
// LeggedManipulatorRobot.js/DroneRobot.js da cui importarle come per
// MANIPULATOR_STATS, quindi restano locali qui finché quelle classi non
// verranno implementate
const LEGGED_MANIPULATOR_STATS = { speed: 2, shooting: 3, steal: 2, block: 5 }
const DRONE_STATS = { speed: 5, shooting: 2, steal: 1, block: 1 }
renderStatBars(document.getElementById('robot-stats-legged'), LEGGED_MANIPULATOR_STATS)
renderStatBars(document.getElementById('robot-stats-drone'), DRONE_STATS)
// stesse identiche stat sulla schermata ROBOT AVVERSARIO (1V1, vedi
// MainMenu.js) — non un roster separato, lo stesso identico per entrambi
renderStatBars(document.getElementById('robot-stats-manipulator-enemy'), MANIPULATOR_STATS)
renderStatBars(document.getElementById('robot-stats-legged-enemy'), LEGGED_MANIPULATOR_STATS)
renderStatBars(document.getElementById('robot-stats-drone-enemy'), DRONE_STATS)

// Rotazione del pallone: dedotta dalla velocità REALE (differenza di
// posizione frame-su-frame), non simulata separatamente per ogni stato
// (palleggio/tiro/handling/pickup) — un solo punto condiviso invece di
// quattro copie, e funziona automaticamente qualunque cosa stia muovendo
// la palla in quel momento, senza bisogno di passargli una velocità esplicita.
// Asse di rotolamento = up × velocità (normalizzato): la stessa formula del
// rotolamento senza slittamento su un piano orizzontale, applicata anche in
// volo — non è fisicamente esatta lì (la palla non tocca terra), ma visivamente
// è quello che ci si aspetta di vedere. Velocità angolare = |velocità| / raggio
const ballSpinPreviousPos = new THREE.Vector3()
const ballSpinVelocity = new THREE.Vector3()
const ballSpinAxis = new THREE.Vector3()
let ballSpinInitialized = false
// tetto alla velocità usata per lo spin (non alla velocità vera della palla):
// il pickup/riaggancio del palleggio spostano la palla di scatto in un solo
// frame (per design, vedi Pickup Automatico) — senza un tetto quello scatto
// produrrebbe un giro di spin istantaneo e visibilmente innaturale
const BALL_SPIN_MAX_SPEED = 2000
function updateBallSpin(dt) {
  if (!ballSpinInitialized) {
    ballSpinPreviousPos.copy(basketball.position)
    ballSpinInitialized = true
    return
  }
  ballSpinVelocity.copy(basketball.position).sub(ballSpinPreviousPos).divideScalar(dt)
  ballSpinPreviousPos.copy(basketball.position)
  const speed = Math.min(ballSpinVelocity.length(), BALL_SPIN_MAX_SPEED)
  if (speed < 1e-4) return
  // lunghezza dell'asse controllata PRIMA di normalizzare: con velocità
  // (quasi) puramente verticale (comune nel palleggio da fermo, push/drop/
  // rise senza movimento in X/Z) up×velocità è (quasi) zero — normalizzare
  // un vettore zero produce NaN, che poi avvelenerebbe per sempre il
  // quaternione della palla (si compone con quello esistente ad ogni
  // chiamata, non si riprenderebbe più da sola)
  ballSpinAxis.set(0, 1, 0).cross(ballSpinVelocity)
  const axisLength = ballSpinAxis.length()
  if (axisLength < 1e-4) return // nessun asse di rotolamento orizzontale sensato
  ballSpinAxis.divideScalar(axisLength)
  basketball.mesh.rotateOnWorldAxis(ballSpinAxis, (speed / BALL_RADIUS) * dt)
}

// Il robot (giocatore E nemico) non ha MAI avuto un clamp contro la
// geometria statica del campo (muri/pali/panchine/backboard) — solo la
// PALLA viene risolta contro collisionWorld (vedi stepShotFlight/
// updateTrajectoryPreview in ShootingSystem.js). Camminare piano contro un
// muro/palo si nota a malapena (il robot resta visibilmente "incastrato" e
// basta), ma un DASH (6.6x velocità, nessun collision check) può spingere
// il robot ben oltre un palo/panchina sottile in un solo burst — e la
// palla, che segue sempre la posizione REALE della paletta fino al
// rilascio (snapBallToRestPoint), parte quindi già conficcata in quel box.
// Il primo sotto-passo di stepShotFlight la trova già dentro
// (containsPoint vero al frame 0 del volo) e la risolve SUBITO con un
// rimbalzo sulla faccia più vicina — un tiro che in realtà non ha mai
// toccato niente sembra un'accelerazione/collisione impazzita in
// partenza. Fix: stesso identico test sfera-vs-box già usato per la palla
// (collisionWorld.resolveSphereBoxCollision), applicato anche al ROBOT
// ogni frame subito dopo il movimento — velocità fittizia sempre a zero
// (il dot product con una normale non è mai negativo, quindi non viene
// mai mutata): serve solo la correzione di POSIZIONE, il robot non ha un
// vettore velocità persistente da riflettere come un vero rimbalzo
const PLAYER_COLLISION_RADIUS = 55 // ~ raggio del disco (discRadius=1 × manipulatorScale=45) + margine
const scratchRobotClampVelocity = new THREE.Vector3()
function clampRobotToCourt(robot) {
  const pos = robot.root.position
  scratchRobotClampVelocity.set(0, 0, 0)
  for (const box of collisionWorld.backboardBoxes) collisionWorld.resolveSphereBoxCollision(pos, scratchRobotClampVelocity, box, PLAYER_COLLISION_RADIUS, 0)
  for (const box of collisionWorld.wallBoxes) collisionWorld.resolveSphereBoxCollision(pos, scratchRobotClampVelocity, box, PLAYER_COLLISION_RADIUS, 0)
  for (const box of collisionWorld.poleBoxes) collisionWorld.resolveSphereBoxCollision(pos, scratchRobotClampVelocity, box, PLAYER_COLLISION_RADIUS, 0)
  for (const box of collisionWorld.benchBoxes) collisionWorld.resolveSphereBoxCollision(pos, scratchRobotClampVelocity, box, PLAYER_COLLISION_RADIUS, 0)
}

function animate() {
  requestAnimationFrame(animate)
  const delta = Math.min(clock.getDelta(), MAX_DELTA)

  // mentre il main menu è aperto: solo l'orbita lenta della camera, niente
  // altro (palleggio/fisica/input di gioco fermi, il campo è "vuoto" per
  // costruzione in questa fase) — poi esce subito, non gira il resto del loop
  if (menuState.mode === 'menu') {
    updateMenuCameraOrbit(delta)
    composer.render()
    return
  }

  if (menuState.mode === 'spectate' && controls.isLocked) {
    const speed = 300 * delta
    camera.getWorldDirection(camDir)
    camRight.crossVectors(camDir, camera.up).normalize()

    if (keys['KeyW'])      camera.position.addScaledVector(camDir, speed)
    if (keys['KeyS'])      camera.position.addScaledVector(camDir, -speed)
    if (keys['KeyA'])      camera.position.addScaledVector(camRight, -speed)
    if (keys['KeyD'])      camera.position.addScaledVector(camRight, speed)
    if (keys['Space'])     camera.position.y += speed
    if (keys['ShiftLeft']) camera.position.y -= speed
  }

  if (menuState.mode === 'play') {
    // R1 (base del manipolatore) segue l'orbit yaw della camera: stessa
    // convenzione sin/cos usata per camForward/movementState.facing, quindi a
    // cameraState.orbitYaw=0 la base è a riposo (nessuna rotazione extra) e il
    // braccio punta già "in avanti" di default. Indipendente dal
    // movimento: si mira col mouse, ci si muove con WASD
    const isHandlingNow = manipulator.state === RobotState.HANDLING
    const armYawLerpFactor = 1 - Math.exp(-handlingTuning.transitionSpeed * delta)
    cameraState.currentArmYawOffsetDeg += ((isHandlingNow ? 0 : ARM_YAW_OFFSET_DEG) - cameraState.currentArmYawOffsetDeg) * armYawLerpFactor
    // MAI durante il proprio STEAL/BLOCK: quel setAimYaw "vinceva" solo per
    // un ordine di chiamata fortunato (updateSteal/updateBlock girano DOPO
    // questo blocco nello stesso animate(), quindi lo sovrascrivevano) —
    // un contratto implicito, non una vera protezione. Un domani riordino
    // di animate() lo avrebbe rotto in silenzio
    if (!isCombatMoveActive(stealState, blockState)) {
      manipulator.controls.setAimYaw(cameraState.orbitYaw + THREE.MathUtils.degToRad(cameraState.currentArmYawOffsetDeg))
    }
    // guardare su/giù (cameraState.orbitPitch) alza/abbassa di poco l'end effector,
    // ruotando il gomito e non l'ultimo link — coupling piccolo apposta.
    // setAimPitch gestisce internamente anche il rilivellamento della
    // paletta (la cinematica gomito+polso resta dentro manipulator.js)
    manipulator.controls.setAimPitch((cameraState.orbitPitch - ORBIT_PITCH_REST) * ELBOW_PITCH_COUPLING)

    // assi camera flattened sul piano orizzontale (solo cameraState.orbitYaw, non
    // pitch) così W spinge sempre in avanti sul terreno, non in diagonale
    // verso l'alto/basso quando la camera è inclinata
    angleToForward(cameraState.orbitYaw, camForward)
    rotateRight(camForward, camRightFlat)

    moveVec.set(0, 0, 0)
    if (keys['KeyW']) moveVec.add(camForward)
    if (keys['KeyS']) moveVec.sub(camForward)
    if (keys['KeyD']) moveVec.add(camRightFlat)
    if (keys['KeyA']) moveVec.sub(camRightFlat)

    // fermo durante il proprio STEAL/BLOCK (reach+resolve, 0.4-0.6s, non
    // più istantaneo come prima) — camminare mentre il braccio sventola
    // per conto suo sembrava un unico glitch, stessa correzione già
    // applicata al movimento del nemico in EnemyAI.js
    if (moveVec.lengthSq() > 0 && !isCombatMoveActive(stealState, blockState)) {
      moveVec.normalize()
      movementState.facing = Math.atan2(moveVec.x, moveVec.z)
      manipulator.move(moveVec, delta)
    }

    // dash: scatto breve nella direzione di marcia, si somma al movimento
    // WASD normale se tenuto premuto durante il burst
    if (dashState.charges < DASH_MAX_CHARGES) {
      dashState.rechargeTimer -= delta
      if (dashState.rechargeTimer <= 0) {
        dashState.charges++
        // ricarica IN SEQUENZA: se resta ancora una carica da recuperare,
        // il timer della PROSSIMA riparte subito, non in parallelo
        dashState.rechargeTimer = dashState.charges < DASH_MAX_CHARGES ? DASH_COOLDOWN_TIME : 0
      }
    }
    if (dashState.timeRemaining > 0) {
      // baseSpeed (non speed): il burst resta lo stesso anche se il dash
      // scatta durante HANDLING, non va scalato dalla riduzione del 75%
      manipulator.root.position.addScaledVector(dashDirection, manipulator.baseSpeed * DASH_SPEED_MULTIPLIER * delta)
      dashState.timeRemaining = Math.max(0, dashState.timeRemaining - delta)
    }
    // DOPO sia WASD sia dash: vedi clampRobotToCourt sopra, il motivo per
    // cui serve è tutto lì (il dash è il caso che lo rende visibile)
    clampRobotToCourt(manipulator)

    // 2 blocchi indipendenti (stesso stile delle stat bar del menu): pieno/
    // verde se quella carica è pronta, altrimenti la ricarica in corso
    // riempie SOLO il primo blocco vuoto (le altre restano a 0%, in coda)
    for (let i = 0; i < DASH_MAX_CHARGES; i++) {
      const fillEl = dashChargeFillEls[i]
      if (i < dashState.charges) {
        fillEl.style.width = '100%'
        fillEl.classList.add('ready')
      } else if (i === dashState.charges) {
        fillEl.style.width = `${(1 - dashState.rechargeTimer / DASH_COOLDOWN_TIME) * 100}%`
        fillEl.classList.remove('ready')
      } else {
        fillEl.style.width = '0%'
        fillEl.classList.remove('ready')
      }
    }

    // STEAL/BLOCK: grigio/opaco l'intero pannello quando si ha la palla
    // (le due mosse sono usabili SOLO in NO_BALL, non solo "fuori
    // cooldown") — le barre dentro seguono lo stesso schema del dash
    combatPanel.classList.toggle('disabled', manipulator.state !== RobotState.NO_BALL)
    stealBarFill.style.width = `${(1 - stealState.cooldown / stealCooldownFor(manipulator.stats.steal)) * 100}%`
    stealBarFill.classList.toggle('ready', canUseSteal())
    blockBarFill.style.width = `${(1 - blockState.cooldown / blockCooldownFor(manipulator.stats.block)) * 100}%`
    blockBarFill.classList.toggle('ready', canUseBlock())

    // il toro giace nel piano XY (asse/perno lungo Z), quindi la sua
    // direzione di rotolamento a riposo è l'asse X locale, non Z — va
    // compensata con un offset di -90° perché si allinei al movimento.
    // Interpolata (non applicata di scatto) per una sterzata rapida ma
    // animata invece di un flip istantaneo
    const wheelsTargetAngle = movementState.facing - Math.PI / 2
    movementState.wheelsAngle = lerpAngle(movementState.wheelsAngle, wheelsTargetAngle, 1 - Math.exp(-WHEEL_TURN_SPEED * delta))
    manipulator.controls.setWheelsYaw(movementState.wheelsAngle)

    // zoom in mentre si tiene il tasto destro (RobotState.HANDLING):
    // stessa orbita, raggio interpolato invece di scattare di colpo, più un
    // piccolo rialzo di quota (stesso target/lerp) per vedere il canestro
    // invece che il pavimento da vicino
    const isHandling = manipulator.state === RobotState.HANDLING
    const zoomLerpFactor = 1 - Math.exp(-CHASE_DISTANCE_LERP_SPEED * delta)
    const zoomDistanceLerpFactor = 1 - Math.exp(-CHASE_DISTANCE_ZOOM_LERP_SPEED * delta)
    cameraState.currentChaseDistance += ((isHandling ? HANDLING_CHASE_DISTANCE : CHASE_DISTANCE) - cameraState.currentChaseDistance) * zoomDistanceLerpFactor
    cameraState.currentHeightBoost += ((isHandling ? HANDLING_HEIGHT_BOOST : 0) - cameraState.currentHeightBoost) * zoomLerpFactor

    const robotPos = manipulator.root.position
    // camForward/camRightFlat già calcolati sopra per il movimento: riusati
    // qui invece di ricalcolarli
    if (isHandling) {
      // In HANDLING la camera ha un orientamento LIBERO (yaw/pitch VERI,
      // come una vista in prima/terza persona normale), non un lookAt che
      // insegue sempre il robot. Col lookAt fisso il robot restava sempre
      // centrato a schermo qualunque cosa facesse la posizione — alzare la
      // camera la faceva solo guardare più dall'alto lo stesso punto, mai
      // vedere oltre. Ora pitch ruota la vista, non sposta il bersaglio:
      // si può davvero alzare lo sguardo sopra la testa del robot e vederlo
      // scendere nell'inquadratura. Bonus: pitch e cameraState.currentHeightBoost non si
      // "combattono" più — la quota è solo un'aggiunta fissa alla posizione,
      // il pitch non tocca più la posizione, solo l'orientamento
      targetCameraPos.set(
        robotPos.x - camForward.x * cameraState.currentChaseDistance + camRightFlat.x * HANDLING_CAMERA_SIDE_OFFSET,
        robotPos.y + LOOK_HEIGHT + cameraState.currentHeightBoost,
        robotPos.z - camForward.z * cameraState.currentChaseDistance + camRightFlat.z * HANDLING_CAMERA_SIDE_OFFSET
      )
      // cameraState.orbitPitch diretto, senza un secondo lerp qui sopra: era un doppio
      // smoothing in cascata con camera.quaternion.slerp sotto (due lag
      // esponenziali indipendenti sullo stesso segnale, a velocità diverse)
      // — per input veloci (flick del mouse) il risultato è imprevedibile
      // (scatti in avanti seguiti da correzioni all'indietro). Un solo
      // stadio di smoothing (lo slerp sotto, che esiste già apposta per
      // azzerare lo scatto tra formula e formula) è sufficiente
      scratchEuler.set(-cameraState.orbitPitch, cameraState.orbitYaw + Math.PI, 0, 'YXZ')
      targetCameraQuat.setFromEuler(scratchEuler)
    } else {
      // comportamento originale (DRIBBLE/Play normale): camera in orbita,
      // guarda sempre il robot — invariato
      const horizDist = cameraState.currentChaseDistance * Math.cos(cameraState.orbitPitch)
      targetCameraPos.set(
        robotPos.x - camForward.x * horizDist,
        robotPos.y + LOOK_HEIGHT + cameraState.currentChaseDistance * Math.sin(cameraState.orbitPitch),
        robotPos.z - camForward.z * horizDist
      )
      // stesso risultato di camera.lookAt(), ma calcolato su un bersaglio
      // di appoggio invece che applicato subito alla camera vera — serve
      // per poter interpolare anche la rotazione sotto, non solo la posizione
      scratchLookAtTarget.set(robotPos.x, robotPos.y + LOOK_HEIGHT, robotPos.z)
      scratchLookAtMatrix.lookAt(targetCameraPos, scratchLookAtTarget, camera.up)
      targetCameraQuat.setFromRotationMatrix(scratchLookAtMatrix)
    }
    // posizione E rotazione VERE interpolate verso il bersaglio (calcolato
    // sopra da qualunque formula sia in uso) invece di un .set()/lookAt()
    // diretto — questo è ciò che elimina lo scatto quando si passa da una
    // formula all'altra (DRIBBLE ↔ HANDLING, in ENTRAMBE le direzioni), non
    // solo i parametri che le alimentano. slerp per la rotazione (non lerp)
    // perché interpola quaternioni lungo il percorso più breve, non lineare
    // componente per componente
    const camPosLerpFactor = 1 - Math.exp(-CAMERA_POSITION_LERP_SPEED * delta)
    camera.position.lerp(targetCameraPos, camPosLerpFactor)
    camera.quaternion.slerp(targetCameraQuat, camPosLerpFactor)
  }

  // l'animazione di tiro (windup/release) va avanti indipendentemente da
  // manipulator.state: parte con lo stato ancora HANDLING e lo porta a
  // NO_BALL a metà strada (vedi updateShootAnimation), quindi va aggiornata
  // PRIMA del branch sotto, non dentro — altrimenti il frame del cambio
  // stato salterebbe un aggiornamento oppure ne farebbe due.
  // shootingState.stateTransitionTimer > 0 ANCHE con shootingState.phase già 'idle': il
  // countdown (0.35s) può superare quanto resta di release+recover — senza
  // continuare a chiamare la funzione qui, il countdown si blocca a metà e
  // NO_BALL/basketball FREE non scattano mai
  if (basketball && (shootingState.phase !== 'idle' || shootingState.stateTransitionTimer > 0)) updateShootAnimation(delta)

  if (basketball) {
    // shootingState.released, NON manipulator.state === NO_BALL da solo,
    // decide se far girare la fisica del VOLO: in 1v1 un robot è NO_BALL
    // anche solo perché la palla ce l'ha l'ALTRO, non perché ha tirato lui
    // — updateShotFlight andrebbe comunque a muovere la basketball
    // condivisa "a vuoto" (gravità applicata a uno shotVelocity mai
    // impostato) se guardasse solo allo stato. checkForPickup() invece
    // resta valido in ENTRAMBI i casi (mio tiro appena atterrato, o
    // semplicemente senza palla in questo istante): un robot ball-less
    // deve sempre poter raccogliere una palla libera, qualunque sia il motivo
    if (pickupState.phase === 'active') {
      updatePickup(delta)
    } else if (shootingState.released && (!basketball.owner || basketball.owner === manipulator)) {
      // basketball.owner check: se un BLOCK ha deviato il tiro E qualcun
      // altro l'ha già raccolto (owner riassegnato altrove), questo NON è
      // più "il mio tiro in volo" — continuare a chiamare updateShotFlight
      // qui applicherebbe la fisica ABBANDONATA di questo robot sulla
      // stessa basketball.position che il nuovo possessore sta già
      // muovendo per conto suo: la palla "flickerava" tra le due,
      // sembrando rimbalzare a terra invece di restare pulita in mano
      updateShotFlight(delta)
      checkForPickup()
    } else if (manipulator.state === RobotState.NO_BALL) {
      checkForPickup()
    } else if (shootingState.phase === 'idle') {
      if (manipulator.state === RobotState.HANDLING) {
        updateHandling(delta)
      } else {
        // consuma il tempo reale a fette fisse (vedi commento su DRIBBLE_FIXED_DT):
        // un frame lento produce più iterazioni consecutive, uno veloce anche
        // zero (il resto resta in accumulator per il prossimo) — updateDribble
        // non vede mai altro dt che non sia questo valore costante. Clamp per
        // evitare una "spirale della morte" (troppe iterazioni da recuperare)
        // se il tab perde focus a lungo
        dribbleAccumulator = Math.min(dribbleAccumulator + delta, DRIBBLE_FIXED_DT * 10)
        while (dribbleAccumulator >= DRIBBLE_FIXED_DT) {
          updateDribble(DRIBBLE_FIXED_DT)
          dribbleAccumulator -= DRIBBLE_FIXED_DT
        }
      }
    }
  }

  // PRACTICE è solo (nessun nemico: niente AI, niente STEAL/BLOCK, niente
  // dispatch palleggio/tiro per enemyManipulator) — tutto quello che segue
  // in questo blocco è specifico di 1V1
  const isOneVOne = menuState.gameMode === GameMode.ONE_V_ONE
  if (isOneVOne) {
    // AI del nemico: decide movimento/stato PRIMA del dispatch qui sotto,
    // così un cambio di stato deciso questo frame (es. entra in HANDLING)
    // si riflette subito nello stesso frame invece di restare un frame indietro
    if (basketball && menuState.mode === 'play') updateEnemyAI(delta)
    // stesso clamp del giocatore (vedi clampRobotToCourt sopra) — l'AI
    // naviga verso punti target senza sapere nulla di muri/pali/panchine,
    // quindi è altrettanto esposta a finire dentro quella geometria
    clampRobotToCourt(enemyManipulator)

    // niente compenetrazione: chi ha la palla non cede MAI il passo, chi
    // non ce l'ha viene spinto via se si avvicina troppo — dipende da chi
    // possiede la palla in QUESTO istante (non un lato fisso): se il
    // nemico ha la palla è lui a non cedere e tu vieni spinto, se sei tu
    // ad averla è il nemico a cedere. Palla libera (nessun owner, es.
    // durante un CHASE_BALL di entrambi): nessuno è "protetto", il
    // giocatore cede come comportamento di default. Non dentro il
    // movimento WASD/dash del giocatore (girava solo quando TI muovevi tu:
    // se stavi fermo e l'altro ti veniva addosso, niente ti spingeva) ma
    // QUI, ogni frame di Play, con le posizioni di ENTRAMBI già aggiornate
    // per questo frame (il nemico si è appena mosso sopra)
    if (menuState.mode === 'play' && basketball) {
      const yieldingRobot = basketball.owner === manipulator ? enemyManipulator : manipulator
      const holdingRobot = yieldingRobot === manipulator ? enemyManipulator : manipulator
      scratchPlayerVsEnemy.subVectors(yieldingRobot.root.position, holdingRobot.root.position)
      scratchPlayerVsEnemy.y = 0
      // gate economico (nessuna radice) PRIMA di pagare .length(): nel caso
      // comune (robot lontani) evita del tutto la radice quadrata, che
      // altrimenti girava ogni frame di Play indipendentemente dalla distanza
      const distSq = scratchPlayerVsEnemy.lengthSq()
      if (distSq < AI_MIN_PLAYER_DISTANCE * AI_MIN_PLAYER_DISTANCE && distSq > 1) {
        const dist = Math.sqrt(distSq)
        // chi ha la palla non è più del tutto immune: assorbe solo il 25%
        // della separazione necessaria, chi non ce l'ha (chi sta "venendo
        // addosso") il restante 75% — non uno split fisso "sempre lui/
        // sempre l'altro" come prima, entrambi si spostano un po'.
        // ECCEZIONE: chi sta eseguendo il PROPRIO tiro (shootingState/
        // enemyShootingState !== 'idle', quindi anche durante 'recover',
        // non solo windup/release) non viene MAI spostato da questa
        // correzione — root.position pilota anche la chase camera, quindi
        // un nemico semplicemente VICINO (nessun contatto vero, e senza
        // alcuna dipendenza da davanti/dietro: è solo un check di distanza)
        // faceva slittare il crosshair proprio nell'istante del rilascio.
        // L'altro robot assorbe per intero lo shortfall in quel caso
        const shortfall = AI_MIN_PLAYER_DISTANCE - dist
        // divideScalar invece di normalize(): dist è già noto, normalize()
        // ricalcolerebbe la stessa radice una seconda volta per niente
        scratchPlayerVsEnemy.divideScalar(dist) // ora è la direzione holder → yielder
        const playerShooting = shootingState.phase !== 'idle'
        const enemyShooting = enemyShootingState.phase !== 'idle'
        const holdingIsShooting = (holdingRobot === manipulator && playerShooting) || (holdingRobot === enemyManipulator && enemyShooting)
        const yieldingIsShooting = (yieldingRobot === manipulator && playerShooting) || (yieldingRobot === enemyManipulator && enemyShooting)
        const yielderShare = yieldingIsShooting ? 0 : (holdingIsShooting ? 1 : 0.75)
        const holderShare = holdingIsShooting ? 0 : (yieldingIsShooting ? 1 : 0.25)
        yieldingRobot.root.position.x += scratchPlayerVsEnemy.x * shortfall * yielderShare
        yieldingRobot.root.position.z += scratchPlayerVsEnemy.z * shortfall * yielderShare
        holdingRobot.root.position.x -= scratchPlayerVsEnemy.x * shortfall * holderShare
        holdingRobot.root.position.z -= scratchPlayerVsEnemy.z * shortfall * holderShare
      }
    }

    // STEAL/BLOCK: entrambi i robot (indipendenti da chi possiede la
    // palla in questo istante — l'idle-check è interno a initCombatMoves)
    if (basketball) {
      updateSteal(delta)
      updateBlock(delta)
      enemyUpdateSteal(delta)
      enemyUpdateBlock(delta)
    }

    // stesso identico dispatch del giocatore sopra, sul proprio set di
    // stati indipendente (enemyManipulator/enemyPickupState/
    // enemyShootingState) — basketball è condivisa, ma solo UNO dei due
    // robot alla volta la possiede davvero (Basketball.owner), quindi solo
    // uno dei due rami muove effettivamente la palla in un dato istante.
    // Niente preview di traiettoria/mira per il nemico (non c'è una camera
    // libera da inseguire, quella resta un concetto solo-giocatore)
    if (basketball && (enemyShootingState.phase !== 'idle' || enemyShootingState.stateTransitionTimer > 0)) enemyUpdateShootAnimation(delta)

    if (basketball) {
      if (enemyPickupState.phase === 'active') {
        enemyUpdatePickup(delta)
      } else if (enemyShootingState.released && (!basketball.owner || basketball.owner === enemyManipulator)) {
        enemyUpdateShotFlight(delta)
        enemyCheckForPickup()
      } else if (enemyManipulator.state === RobotState.NO_BALL) {
        enemyCheckForPickup()
      } else if (enemyShootingState.phase === 'idle') {
        if (enemyManipulator.state === RobotState.HANDLING) {
          enemyUpdateHandling(delta)
        } else {
          enemyDribbleAccumulator = Math.min(enemyDribbleAccumulator + delta, DRIBBLE_FIXED_DT * 10)
          while (enemyDribbleAccumulator >= DRIBBLE_FIXED_DT) {
            enemyUpdateDribble(DRIBBLE_FIXED_DT)
            enemyDribbleAccumulator -= DRIBBLE_FIXED_DT
          }
        }
      }
    }
  }
  // PRACTICE: STEAL/BLOCK non hanno senso senza un avversario reale (il
  // pannello combat-panel resta nascosto — vedi toggle su gameMode), niente
  // da aggiornare qui

  // dopo l'aggiornamento della palla per questo frame, qualunque stato
  // (giocatore o nemico) l'abbia mossa — vedi commento su updateBallSpin sopra
  if (basketball) updateBallSpin(delta)

  // preview di traiettoria: solo mentre si mira davvero (HANDLING, nessuna
  // animazione di tiro già in corso, palla non ancora rilasciata). Serve
  // anche !shootingState.released: lo stato passa a NO_BALL con un piccolo ritardo
  // dopo il rilascio vero (shootTuning.stateTransitionDelay), quindi c'è una
  // finestra in cui manipulator.state è ANCORA HANDLING e shootingState.phase è GIÀ
  // tornato 'idle' (fine di 'recover') — senza questo controllo la linea si
  // riattaccava per un istante alla palla già in volo/atterrata
  const showTrajectory = basketball && manipulator.state === RobotState.HANDLING && shootingState.phase === 'idle' && !shootingState.released
  if (showTrajectory) updateTrajectoryPreview()
  else hideTrajectoryPreview()

  if (!cameraPanel.classList.contains('hidden')) {
    updateReadouts()
  }

  updateCollisionDebugView()

  composer.render()
}

animate()

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})
