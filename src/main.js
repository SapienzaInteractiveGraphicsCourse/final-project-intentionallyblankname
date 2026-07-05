import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ManipulatorRobot } from './robots/ManipulatorRobot.js'
import { RobotState } from './robots/RobotBase.js'
import { createProceduralPBRMaps, drawBrushedMetal } from './robots/manipulator.js'
import { Basketball, BallState } from './Basketball.js'
import { GameMode } from './GameMode.js'
import { TimeOfDay } from './TimeOfDay.js'
import { SoundEffects } from './SoundEffects.js'
import { CollisionWorld, RIM_RING_RADIUS } from './CollisionWorld.js'

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
})

// --- Pallone (modello dedicato: color map + normal map + metallic/roughness) ---
// let (non const): regolabili a runtime dal pannello debug (Basketball/
// Manipulator Animation → Dribble), dichiarate qui perché lette già dal
// setup del debug menu più sotto, prima del blocco fisica nel render loop
let BALL_RADIUS = 15 // unità mondo (~cm-scale) — sfera sorgente ha raggio 1
// const (non più regolabili da debug): valori fissati dopo il tuning
const BALL_GRAVITY = 820       // unità/s² (scena ≈ cm-scale), non più il valore g reale
const BALL_BOUNCE_SPEED = 415  // velocità impressa ad ogni rimbalzo (palleggio automatico)
// rimbalzo a terra di un tiro sbagliato: vicino a BALL_BOUNCE_SPEED (stesso
// "sapore" del palleggio) ma un filo più smorzato — costante separata, non
// tocca la taratura del palleggio automatico
const SHOT_FLOOR_BOUNCE_SPEED = BALL_BOUNCE_SPEED * 0.7
// smorzamento orizzontale ad ogni rimbalzo a terra: poco alla volta, non un
// attrito forte, ma senza questo la palla scivolerebbe in orizzontale in
// eterno (X/Z non vengono mai altrimenti toccate dal rimbalzo)
const FLOOR_HORIZONTAL_DAMPING = 0.9
// CollisionWorld (src/CollisionWorld.js): possiede backboard/ferro/muri/
// pali/panchine (coordinate estratte dagli accessor del GLTF, non stimate
// a occhio — vedi i commenti nel file) e il metodo resolve() che li
// controlla tutti in un colpo solo. RIM_RING_RADIUS/RIM_TUBE_RADIUS
// esportate a parte: servono anche qui sotto (HOOP_ASSIST_BASE_RADIUS)
const collisionWorld = new CollisionWorld(BALL_RADIUS)
// zona dei 3 punti: dentro l'arco (da entrambi i lati) la potenza del tiro è
// dimezzata. Raggio NON stimato a occhio: distanza reale dal ferro al punto
// più "alto" dell'arco (mesh 'Sweep_1_Basket ball lines _0'/'Sweep_3_2_...'),
// estratta dagli accessor del GLTF — semplificato a un cerchio centrato sul
// ferro (l'arco vero ha un tratto dritto agli angoli, qui non replicato)
const THREE_POINT_RADIUS = 677
// condivisa da getEffectiveShotSpeed (riduzione potenza) e dal Point System
// (2 o 3 punti) — stesso identico criterio "vicino a quale canestro", non
// due calcoli separati che potrebbero disallinearsi
function isInsideThreePointArc(worldPosition) {
  let nearestDistSq = Infinity
  for (const hoop of collisionWorld.hoops) {
    const dx = worldPosition.x - hoop.center.x
    const dz = worldPosition.z - hoop.center.z
    nearestDistSq = Math.min(nearestDistSq, dx * dx + dz * dz)
  }
  return nearestDistSq < THREE_POINT_RADIUS * THREE_POINT_RADIUS
}

function getEffectiveShotSpeed(worldPosition) {
  return isInsideThreePointArc(worldPosition) ? SHOT_SPEED * 0.6 : SHOT_SPEED
}
// campo potenziale attrattivo verso il centro canestro (stat SHOOTING) — un
// tronco di cono che si allarga salendo, non un raggio costante per tutta
// l'altezza: raggio del FERRO esattamente a livello del ferro (non uno
// stretto a caso), raggio più largo (più permissivo) salendo fino alla
// cima della backboard, poi niente oltre. Niente forza sulla componente Y
// (non tocca l'arco del tiro, solo l'allineamento orizzontale) — la forza
// del tiro resta quella che l'utente vede nella preview, questo è un aiuto
// SUL contatto, non un cambio di potenza
const HOOP_ASSIST_BASE_RADIUS = RIM_RING_RADIUS // raggio del cono esattamente al livello del ferro = raggio vero del ferro
const HOOP_ASSIST_TOP_RADIUS = 90               // raggio del cono in cima (più permissivo)
// tasso di correzione (1/s): quota della distanza residua riassorbita al
// secondo, a strength=1 e sul bordo del cono. NON un'accelerazione — quella
// si accumula con quanto tempo la palla passa dentro il cono, e sui tiri
// da vicino/lenti (più tempo dentro la zona) sparava la palla OLTRE il
// centro invece di correggerla. Una correzione di POSIZIONE (frazione
// della distanza residua ad ogni passo) converge verso il centro ma non
// può mai superarlo, qualunque sia il tempo di permanenza
const HOOP_ASSIST_PULL_RATE = 4
// scala SHOOTING 1-3 (non più 1-5): 1 = NESSUNA correzione, 2 = la
// correzione tarata prima come "vecchio stat 4", 3 = la correzione tarata
// prima come "vecchio stat 8" — con la vecchia formula lineare (stat-1)/4,
// f(1)=0, f(2)=0.75, f(3)=1.75. Fit quadratico esatto sui tre punti:
// (stat-1)(stat+4)/8
function shootingStatToAssistStrength(shootingStat) {
  return (shootingStat - 1) * (shootingStat + 4) / 8
}
// il punto di tracking (manipulator.paddle = paddleCenter) non coincide col
// centro visivo reale della paletta a occhio: questi 3 offset (unità
// mondo) si sommano in animate(), lungo gli assi LOCALI della paletta
// (non mondo, così restano corretti mentre si inclina/tilta) — Forward =
// lungo la paletta (asse locale Z), Side = di lato (asse locale X), Down =
// verso il basso reale della paletta (asse locale -Y). Tarati da debug
// (Basketball → Ball Offset), non da fisica/geometria
let BALL_OFFSET_FORWARD = 6
let BALL_OFFSET_SIDE = 0
let BALL_OFFSET_DOWN = 12
// SOLO per HANDLING/tiro (ballRestPoint, non paddleCenter): il punto di
// convergenza delle normali è geometricamente corretto "di luogo" ma
// visivamente troppo vicino alla camera/al polso — extra distanza lungo la
// stessa direzione, non una nuova geometria (vedi setBallRestOffset)
let BALL_REST_EXTRA_OFFSET = 0.08
// offset yaw del braccio in Play (gradi, sommato a orbitYaw ogni frame) e
// altezza del crosshair (px sopra il centro schermo) — anche questi
// dichiarati qui per lo stesso motivo di BALL_*: letti già dal setup del
// debug menu sotto
let ARM_YAW_OFFSET_DEG = -36
let CROSSHAIR_HEIGHT = 115
// palleggio: durata della spinta verso il basso (gomito+link1) e ampiezza
// del piegamento di ciascuno (gradi) — stessa ampiezza usata sia nella
// spinta (push) sia nella risalita in sincrono col rimbalzo (rise)
let DRIBBLE_PUSH_DURATION = 0.25
let DRIBBLE_ELBOW_AMPLITUDE_DEG = 40
let DRIBBLE_LINK1_AMPLITUDE_DEG = 10
// entrambe tunabili da slider (let, non const): niente cache module-scope,
// ricalcolate ad ogni chiamata — usata da updateDribble/updateHandling/
// updatePickup/il trigger del tiro invece di ripetere la stessa coppia di
// degToRad in ognuno
function dribbleAmplitudesRad() {
  return [THREE.MathUtils.degToRad(DRIBBLE_ELBOW_AMPLITUDE_DEG), THREE.MathUtils.degToRad(DRIBBLE_LINK1_AMPLITUDE_DEG)]
}
// RobotState.HANDLING (tasto destro tenuto premuto): dichiarate qui (non
// vicino a updateHandling più in basso) perché usate come valore iniziale
// dello slider debug "Handling" costruito subito dopo questo blocco —
// prima di questo spostamento erano `let` più in basso nel file e lo
// slider le leggeva prima della dichiarazione (temporal dead zone,
// ReferenceError che crashava l'intero modulo prima di arrivare ad animate())
let HANDLING_EASE = -0.3 // quanto è "chiuso" il braccio nella presa (negativo=sopra il riposo/più in alto, 0=riposo, 1=fondo corsa push)
let HANDLING_GRIP_OFFSET = 0.5 // quanto si stringe la V della paletta (rad, sottratto da paddleAngle)
let HANDLING_TRANSITION_SPEED = 12 // rad/s-equivalente: interpolazione rapida ma non istantanea
// più vicino = visuale più bassa/schiacciata: un rialzo extra in quota
// compensa, per non vedere la base ma il braccio (utile per mirare/tirare)
let HANDLING_HEIGHT_BOOST = 40
// scarto laterale della camera in HANDLING (asse camRightFlat), per una
// vista "di spalla" invece che dritta dietro il robot
let HANDLING_CAMERA_SIDE_OFFSET = -60
// quanto ci mette lockOffset (vedi sotto) a riassorbirsi a inizio 'push':
// finestra breve rispetto a DRIBBLE_PUSH_DURATION, così per il resto della
// spinta (mentre il link si piega, visibilmente) la palla è già a offset
// zero e segue ESATTAMENTE la paletta, invece di continuare a "cadere"
// per conto suo sull'intera durata della spinta
let DRIBBLE_LOCK_ABSORB_TIME = 0.25
// piccolo offset costante (unità mondo) sottratto dalla Y balistica pura
// di 'rise' (vedi riseBallisticY in animate()), non un clamp: a 0 la
// traiettoria è la fisica pura, invariata
let DRIBBLE_RISE_Y_CORRECTION = 7
// RobotState.NO_BALL (tiro): velocità di lancio, ancora una costante piatta,
// non legata alla stat POWER né a una HUD di carica — quella (Shooting
// System con forza dipendente dalle stat) resta un task separato più avanti.
// Dichiarata qui per lo stesso motivo di HANDLING_EASE sopra: letta subito
// dallo slider debug "Shoot" costruito prima della sua dichiarazione più in
// basso nel file
let SHOT_SPEED = 1100
// Animazione di tiro (windup → release), sequenziata come un vero lancio:
// 'windup' porta gomito/link1 IN DIETRO oltre il riposo (gomito di più,
// link1 di meno); poi in 'release' link1 riparte per primo verso la posa di
// rilascio mentre il gomito parte con un piccolo ritardo (SHOOT_RELEASE_LEAD)
// ma copre tutto il suo raggio nel tempo rimanente — stessa durata totale di
// link1 ma partenza posticipata = velocità angolare maggiore, il "colpo di
// frusta" del gomito che rincorre e supera link1. Segni/gradi di partenza:
// da tarare a occhio via pannello debug (P → Shoot), stesso workflow di tutti
// gli altri parametri di animazione del progetto (vedi Copy Config)
let SHOOT_WINDUP_DURATION = 0.35
let SHOOT_RELEASE_DURATION = 0.3
// dopo 'release' il braccio torna a una posa neutra pulita invece di restare
// nel follow-through — durata di questo terzo tratto, sempre interpolato
let SHOOT_RECOVER_DURATION = 0.25
let SHOOT_ELBOW_WINDUP_DEG = -55  // negativo: gomito apre ALL'INDIETRO oltre il riposo (opposto della spinta in giù del palleggio)
let SHOOT_LINK1_WINDUP_DEG = -40  // stesso verso del gomito, ampiezza maggiorata ("più dietro")
// posa di rilascio/follow-through: NON un valore grande come l'ampiezza del
// palleggio (quella spinge la paletta VERSO IL BASSO, oltre ~90° di pitch
// del gomito la paletta punta a terra) — qui serve restare vicino/appena
// oltre il riposo (75°), altrimenti la palla si stacca dalla mano già
// puntata verso il pavimento e sembra "cadere subito" indipendentemente
// dalla velocità (che viene dal crosshair, non da questa posa). Questo è
// solo l'offset dell'ANIMAZIONE (windup→release): ci si somma sopra, ogni
// frame, anche l'aggancio al pitch della camera (vedi SHOOT_ELBOW_AIM_
// COUPLING sotto) — quello, non questo valore, è la prima cosa che decide
// se il braccio punta su o giù
let SHOOT_ELBOW_RELEASE_DEG = 5
let SHOOT_LINK1_RELEASE_DEG = 15
let SHOOT_RELEASE_LEAD = 0.25     // frazione di SHOOT_RELEASE_DURATION prima che il gomito inizi a muoversi
let SHOOT_RELEASE_POINT = 0.8     // frazione di 'release' a cui la palla lascia davvero la paletta
// quanto resta manipulator.state = HANDLING DOPO il rilascio vero (vedi
// shootReleased) prima di passare a NO_BALL — per non sganciare di scatto
// la camera libera esattamente mentre la palla parte (altrimenti il
// crosshair salta via a metà tiro, sembra che punti altrove)
let SHOOT_STATE_TRANSITION_DELAY = 0.35
// quanto il gomito segue il pitch della camera durante TUTTO il tiro (non
// solo al rilascio): 1 = l'end effector matcha esattamente il pitch della
// mira, sommato sopra l'animazione windup/release — stessa formula già
// usata (disattivata, ELBOW_PITCH_COUPLING=0) per il Play normale, qui
// invece è la prima cosa applicata, a piena intensità di default
let SHOOT_ELBOW_AIM_COUPLING = 1
// stessa formula usata sia in updateHandling (gomito già agganciato al
// pitch della camera durante la presa) sia in updateShootAnimation (stessa
// formula durante il tiro vero) — un solo posto invece di due copie
function computeAimPitchOffset() {
  return (orbitPitch - ORBIT_PITCH_REST) * SHOOT_ELBOW_AIM_COUPLING
}
// offset di tilt della paletta (sommato sopra state.paddleTilt, che resta
// la "forma"/baseline di presa): a offset=0 la paletta è già piatta
// (normale dritta verso l'alto, coincide con l'HANDLING base) — tre fasi,
// non due: 'windup' la porta OLTRE il piatto, più indietro/in su
// (SHOOT_TILT_WINDUP_PEAK, più negativo), poi 'release' la riporta da lì
// verso una posa inclinata in avanti (SHOOT_TILT_TARGET) per il rilascio
// vero — orizzontale → su → inclinata, non un lerp diretto piatto→inclinata
let SHOOT_TILT_WINDUP_PEAK = -2.5
let SHOOT_TILT_TARGET = -0.5
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
  })
  basketball = new Basketball(gltf.scene)
  // il robot parte già in possesso della palla (palleggio automatico da
  // subito, non un pickup da fare) — FREE è il default della classe per una
  // palla "generica", qui va corretto esplicitamente all'avvio
  basketball.setState(BallState.HANDLED)
  scene.add(gltf.scene)
})

// --- Preview traiettoria di tiro (solo mentre si mira in HANDLING) ---
// Nessun motore fisico: sotto gravità costante la traiettoria è nota in
// forma chiusa, ma con le collisioni (backboard/ferro) diventa piecewise,
// quindi si campiona con un piccolo stepping (stesso stile imperativo del
// resto del progetto, non è la simulazione vera che gira in updateShotFlight
// — solo una previsione, ricalcolata ogni frame mentre si mira).
//
// Spessore vero come MESH 3D (THREE.TubeGeometry lungo una curva Catmull-Rom
// per i punti campionati), non una "fat line" in stile Line2/LineMaterial:
// quella calcola lo spessore proiettando la direzione del segmento in
// screen-space (2D), e quando un segmento punta quasi dritto verso/lontano
// dalla camera — capita spesso proprio mentre miri, guardando nella stessa
// direzione del tiro — quella proiezione collassa quasi a un punto e lo
// spessore diventa instabile (segmenti che spariscono/si accorciano in modo
// incoerente, provato e scartato anche con worldUnits:true). Un tubo è
// geometria reale, nessuna proiezione 2D coinvolta: la direzione del
// segmento nel MONDO non è mai degenere, il problema sparisce alla radice.
// Due mesh separate (nero + colorato) ricostruite ogni frame dagli stessi
// punti condivisi nel punto di giunzione: essendo geometria reale (non due
// shader indipendenti che estrudono in screen-space) restano allineate.
// 0.02 (50Hz) era troppo grezzo rispetto al volo fisico reale
// (SHOT_PHYSICS_SUBSTEP_DT=1/240, ~240Hz): a velocità di tiro normali la
// palla si sposta ~22 unità a passo, abbastanza da "saltare oltre" la
// stretta finestra di HOOP_DETECTION_RADIUS (20) proprio nell'istante del
// vero attraversamento — tiri che in realtà entrano (verde) mostravano
// blu (ferro) nella preview solo per la grana del campionamento
const TRAJECTORY_DT = 0.005
const TRAJECTORY_MAX_STEPS = 2400      // ~12s allo stesso dt più fine (0.005*2400=12), stesso budget di prima
const TRAJECTORY_TUBE_RADIUS = 4       // unità mondo
const TRAJ_COLOR_BLACK = 0x111111
const TRAJ_COLOR_BLUE = 0x1b3a6b
const TRAJ_COLOR_GREEN = 0x2e7d32
// depthTest normale (a differenza del tentativo con Line2): è geometria 3D
// vera, deve sparire dietro il ferro/backboard come farebbe la palla reale
// passandoci dietro — non un overlay che deve sempre stare sopra a tutto
const trajectoryBlackMaterial = new THREE.MeshBasicMaterial({ color: TRAJ_COLOR_BLACK, transparent: true, opacity: 0.5 })
const trajectoryColoredMaterial = new THREE.MeshBasicMaterial({ color: TRAJ_COLOR_BLUE, transparent: true, opacity: 0.5 })
let trajectoryBlackMesh = null
let trajectoryColoredMesh = null

// ricostruisce (dispose + nuova, TubeGeometry non si aggiorna in place) la
// mesh-tubo per un tratto di punti — null se meno di 2 punti (nessun tubo
// possibile). tubularSegments più fitto dei punti fisici campionati (la
// spline Catmull-Rom interpola morbidamente tra loro) ma con un tetto per
// non ricostruire geometrie enormi ad ogni frame
function rebuildTrajectoryTube(existingMesh, points, material) {
  if (existingMesh) {
    scene.remove(existingMesh)
    existingMesh.geometry.dispose()
  }
  if (points.length < 2) return null
  const curve = new THREE.CatmullRomCurve3(points)
  const tubularSegments = Math.min(points.length * 3, 150)
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, TRAJECTORY_TUBE_RADIUS, 6, false)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  return mesh
}

// rimuove entrambe le mesh-tubo dalla scena (fuori da HANDLING, o a tiro
// già rilasciato) — richiamata invece di un semplice .visible=false perché
// le mesh sono ricostruite (dispose+nuova) ad ogni updateTrajectoryPreview,
// non riusate in place
function hideTrajectoryPreview() {
  if (trajectoryBlackMesh) { scene.remove(trajectoryBlackMesh); trajectoryBlackMesh.geometry.dispose(); trajectoryBlackMesh = null }
  if (trajectoryColoredMesh) { scene.remove(trajectoryColoredMesh); trajectoryColoredMesh.geometry.dispose(); trajectoryColoredMesh = null }
}

const trajPos = new THREE.Vector3()
const trajVel = new THREE.Vector3()
const trajBlackPoints = []
const trajColoredPoints = []
// diagnostica per il pannello CAMERA (tasto P): letti in tempo reale invece
// di indovinare dal solo aspetto della linea
let trajDebugCount = 0
let trajDebugStopReason = '—'

function updateTrajectoryPreview() {
  // NOTA: usa la posa di mira ATTUALE (quella che updateHandling ha appena
  // applicato), non quella di rilascio effettivo (che dipende da dove sono
  // arrivati windup/release in quel momento) — un tentativo di simulare la
  // posa di rilascio esatta mutando temporaneamente gomito/link1/tilt e poi
  // ripristinando è stato provato e scartato: con mira bassa/di lato
  // produceva un'origine innaturale (quasi dentro il pavimento), rompendo
  // la parabola. Meglio una leggera imprecisione verticale che una preview
  // che si interrompe
  // il centro della palla renderizzata QUESTO frame (updateHandling l'ha già
  // posizionata), non un ricalcolo separato da ballRestPoint — stesso punto
  // per costruzione, ma legge direttamente cosa si vede a video invece di
  // ridipendere dall'ordine con cui girano le funzioni nel frame
  trajPos.copy(basketball.position)
  getShotDirection(trajVel).multiplyScalar(getEffectiveShotSpeed(manipulator.root.position))

  // struttura volutamente semplice (prima versione, senza debounce/skip
  // estetico aggiunti dopo): un solo passaggio, collisione controllata ogni
  // passo, nessuna logica extra che possa introdurre un arresto prematuro
  trajBlackPoints.length = 0
  trajColoredPoints.length = 0
  let coloredMaterialColor = TRAJ_COLOR_BLUE
  let collided = false
  // vettore COMPLETO (non solo Y): isHoopCrossing interpola il punto esatto
  // di attraversamento del piano del ferro, le serve X/Z di prima
  const previousTrajPos = trajPos.clone()
  trajBlackPoints.push(trajPos.clone())

  const hoopAssistStrength = shootingStatToAssistStrength(manipulator.stats.shooting)
  // mappa dei cooldown SEPARATA da shotCollisionCooldowns (volo reale): la
  // preview simula un tiro ipotetico ogni frame mentre si mira, non deve
  // "consumare" il cooldown degli oggetti reali prima che il tiro parta
  // davvero — nuova ad ogni chiamata, non serve svuotarla esplicitamente
  const previewCollisionCooldowns = new Map()
  for (let i = 0; i < TRAJECTORY_MAX_STEPS; i++) {
    trajVel.y -= BALL_GRAVITY * TRAJECTORY_DT
    trajPos.addScaledVector(trajVel, TRAJECTORY_DT)
    applyHoopAssist(trajPos, trajVel, TRAJECTORY_DT, hoopAssistStrength)

    // canestro: stesso criterio di checkHoopScore (isHoopCrossing, condiviso)
    // — controllato SEMPRE, anche dopo un tocco su ferro/backboard (un tiro
    // può toccare il ferro e poi entrare): la zona di contatto fisico del
    // ferro (fino a RIM_TUBE_RADIUS+BALL_RADIUS oltre l'anello) è più larga
    // della zona di canestro vero (HOOP_DETECTION_RADIUS), quindi il tocco
    // spesso scatta PRIMA — senza ricontrollare hitScore ad ogni passo il
    // verde non scattava mai
    let hitScore = false
    for (const hoop of collisionWorld.hoops) {
      if (isHoopCrossing(previousTrajPos, trajPos, hoop)) hitScore = true
    }
    // backboard/ferro/muri/pali/panchine (resolveEnvironmentCollisions,
    // condivisa con updateShotFlight): rilevanti SOLO per decidere quando
    // finisce il tratto nero — una volta "collided" non contano più (il
    // canestro può ancora ricolorare in verde, vedi sotto, ma non serve
    // ricontrollarli)
    const hitVisible = !collided && collisionWorld.resolve(trajPos, trajVel, TRAJECTORY_DT, previewCollisionCooldowns, BALL_RADIUS)
    // pavimento: qui resta uno stop secco (a differenza di updateShotFlight,
    // che ora rimbalza con SHOT_FLOOR_BOUNCE_SPEED) — la preview si ferma
    // alla prima cosa "interessante" toccata, mostrare un rimbalzo infinito
    // sarebbe un'altra feature, non richiesta qui
    let hitFloor = false
    if (!hitScore && !hitVisible && trajPos.y <= BALL_RADIUS) {
      trajPos.y = BALL_RADIUS
      trajVel.set(0, 0, 0)
      hitFloor = true
    }
    previousTrajPos.copy(trajPos)

    if (hitScore) {
      // priorità assoluta sul colore: anche se si era già "collided" (blu,
      // toccato il ferro un attimo prima), un canestro vero ricolora tutto
      // il tratto in verde
      coloredMaterialColor = TRAJ_COLOR_GREEN
      if (!collided) { trajBlackPoints.push(trajPos.clone()); collided = true }
      trajColoredPoints.push(trajPos.clone())
    } else if (hitVisible) {
      coloredMaterialColor = TRAJ_COLOR_BLUE
      trajBlackPoints.push(trajPos.clone())
      collided = true
      trajColoredPoints.push(trajPos.clone())
    } else if (!collided) {
      trajBlackPoints.push(trajPos.clone())
    } else {
      trajColoredPoints.push(trajPos.clone())
    }

    if (hitFloor) { trajDebugStopReason = 'pavimento'; break }
    if (i === TRAJECTORY_MAX_STEPS - 1) trajDebugStopReason = 'budget esaurito (mai toccato nulla)'
  }
  trajDebugCount = trajBlackPoints.length + trajColoredPoints.length

  trajectoryColoredMaterial.color.set(coloredMaterialColor)
  trajectoryBlackMesh = rebuildTrajectoryTube(trajectoryBlackMesh, trajBlackPoints, trajectoryBlackMaterial)
  trajectoryColoredMesh = rebuildTrajectoryTube(trajectoryColoredMesh, trajColoredPoints, trajectoryColoredMaterial)
}

// --- Robot (Step 4: solo modello statico, no animazione/movimento ancora) ---
const manipulator = new ManipulatorRobot()
// unità locali (~1-4) → scala mondo: lampioni a Y=268, hoop reg. ~305cm,
// unità mondo ≈ 1cm → tarato a 45 dopo test visivi via slider debug (P).
// Passa da controls.manipulatorScale (non root.scale diretto) così lo
// stato tracciato resta coerente con "Copy config"
manipulator.controls.manipulatorScale(45)
manipulator.controls.setBallRestOffset(BALL_REST_EXTRA_OFFSET)
// placeholder: vicino allo spawn della spectator camera (0,15,30), non
// ancora la posizione di gioco reale
manipulator.root.position.set(0, 0, 0)
manipulator.root.traverse(child => {
  if (child.isMesh) {
    child.castShadow = true
    child.receiveShadow = true
  }
})
scene.add(manipulator.root)

// --- Spectator Camera ---
const controls = new PointerLockControls(camera, renderer.domElement)

const hint = document.getElementById('hint')
// guardia: senza questa, il tiro (click sinistro, vedi sezione Tiro più
// sotto) richiamerebbe lock() anche a pointer già agganciato ogni volta —
// innocuo di per sé ma non necessario
renderer.domElement.addEventListener('click', () => { if (!controls.isLocked && mode !== 'menu') controls.lock() })
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

// --- Debug Menu (tasto P) ---
const debugPanel = document.getElementById('debug-panel')

// Uno slider (label + valore + input range) è l'unità riusata sia dallo
// slider "Manipulator Scale" in cima al pannello sia da ogni sezione di
// "Manipulator Config" sotto — stessa funzione per entrambi invece di due
// implementazioni parallele.
function createSliderControl(container, { name, min, max, step, value, onChange }) {
  const lbl = document.createElement('label')
  const valSpan = document.createElement('span')
  valSpan.textContent = value
  lbl.append(`${name}: `, valSpan)

  const input = document.createElement('input')
  Object.assign(input, { type: 'range', min, max, step, value })
  input.addEventListener('input', () => {
    const v = parseFloat(input.value)
    valSpan.textContent = v
    onChange(v)
  })

  container.append(lbl, input)
  return input
}

// Bottone che apre/chiude un pannello: unità base di tutte le sezioni
// collassabili del menu debug (contenitori annidabili e gruppi di slider
// sono la stessa cosa, cambia solo cosa ci va dentro).
function createToggleSection(container, label) {
  const btn = document.createElement('button')
  btn.textContent = `${label} ▸`
  const panel = document.createElement('div')
  panel.className = 'component-panel hidden'
  btn.addEventListener('click', () => panel.classList.toggle('hidden'))
  container.append(btn, panel)
  return panel
}

// Sezione con un bottone + i suoi slider dentro (es. Wheels, Disc, Dribble).
function addComponentSection(container, label, sliders) {
  const panel = createToggleSection(container, label)
  sliders.forEach(sliderConfig => createSliderControl(panel, sliderConfig))
}

const cfg = manipulator.getConfig()

// range condiviso da tutti gli slider "Scale" per componente, invece della
// stessa tripla min/max/step ripetuta 7 volte
const SCALE_SLIDER_RANGE = { min: 0.2, max: 3, step: 0.05 }
// estremi degli slider Paddle Angle/Tilt — baseline attuale tarata proprio
// su questi massimi (vedi state.paddleAngle/paddleTilt in manipulator.js)
const PADDLE_ANGLE_MAX = 2.4
const PADDLE_TILT_MAX = 1.2

// --- Manipulator Shape: dimensioni statiche (scale/length/thickness) ---
const manipulatorShape = createToggleSection(debugPanel, 'Manipulator Shape')

createSliderControl(manipulatorShape, {
  name: 'Manipulator Scale (overall)', min: 1, max: 50, step: 0.5,
  value: cfg.manipulatorScale, onChange: manipulator.controls.manipulatorScale,
})

const manipulatorConfig = createToggleSection(manipulatorShape, 'Manipulator Config')

addComponentSection(manipulatorConfig, 'Wheels', [
  { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.wheelsScale, onChange: manipulator.controls.wheelsScale },
])
addComponentSection(manipulatorConfig, 'Disc', [
  { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.discScale, onChange: manipulator.controls.discScale },
  { name: 'Radius', min: 0.5, max: 3, step: 0.05, value: cfg.discRadius, onChange: manipulator.controls.discRadius },
])
addComponentSection(manipulatorConfig, 'Link 1', [
  { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link1Scale, onChange: manipulator.controls.link1Scale },
  { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link1Length, onChange: manipulator.controls.link1Length },
  { name: 'Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link1Thickness, onChange: manipulator.controls.link1Thickness },
])
addComponentSection(manipulatorConfig, 'Link 2', [
  { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.link2Scale, onChange: manipulator.controls.link2Scale },
  { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link2Length, onChange: manipulator.controls.link2Length },
  { name: 'Base Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link2Thickness, onChange: manipulator.controls.link2Thickness },
  { name: 'Tip Thickness', min: 0.02, max: 1, step: 0.01, value: cfg.link2TipThickness, onChange: manipulator.controls.link2TipThickness },
])
addComponentSection(manipulatorConfig, 'Base Joint (sfera)', [
  { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.baseJointScale, onChange: manipulator.controls.baseJointScale },
])
addComponentSection(manipulatorConfig, 'Elbow Joint (sfera)', [
  { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.elbowJointScale, onChange: manipulator.controls.elbowJointScale },
])
addComponentSection(manipulatorConfig, 'End Effector (sfera)', [
  { name: 'Scale', ...SCALE_SLIDER_RANGE, value: cfg.endEffectorScale, onChange: manipulator.controls.endEffectorScale },
])
addComponentSection(manipulatorConfig, 'Paddle (V)', [
  { name: 'Angle', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: cfg.paddleAngle, onChange: manipulator.controls.paddleAngle },
  { name: 'Tilt (down)', min: -PADDLE_TILT_MAX, max: PADDLE_TILT_MAX, step: 0.02, value: cfg.paddleTilt, onChange: manipulator.controls.paddleTilt },
])

// --- Manipulator Animation: parametri delle animazioni (non la forma) ---
const manipulatorAnimation = createToggleSection(debugPanel, 'Manipulator Animation')

addComponentSection(manipulatorAnimation, 'Dribble', [
  { name: 'Push Duration (s)', min: 0.05, max: 1, step: 0.01, value: DRIBBLE_PUSH_DURATION, onChange: v => { DRIBBLE_PUSH_DURATION = v } },
  { name: 'Elbow Amplitude (deg)', min: 0, max: 45, step: 1, value: DRIBBLE_ELBOW_AMPLITUDE_DEG, onChange: v => { DRIBBLE_ELBOW_AMPLITUDE_DEG = v } },
  { name: 'Link 1 Amplitude (deg)', min: 0, max: 25, step: 0.5, value: DRIBBLE_LINK1_AMPLITUDE_DEG, onChange: v => { DRIBBLE_LINK1_AMPLITUDE_DEG = v } },
  { name: 'Lock Absorb Time (s)', min: 0.01, max: 0.3, step: 0.01, value: DRIBBLE_LOCK_ABSORB_TIME, onChange: v => { DRIBBLE_LOCK_ABSORB_TIME = v } },
  { name: 'Rise Y Correction', min: 0, max: 25, step: 1, value: DRIBBLE_RISE_Y_CORRECTION, onChange: v => { DRIBBLE_RISE_Y_CORRECTION = v } },
])
addComponentSection(manipulatorAnimation, 'Shoot', [
  { name: 'Windup Duration (s)', min: 0.05, max: 1, step: 0.01, value: SHOOT_WINDUP_DURATION, onChange: v => { SHOOT_WINDUP_DURATION = v } },
  { name: 'Release Duration (s)', min: 0.05, max: 1, step: 0.01, value: SHOOT_RELEASE_DURATION, onChange: v => { SHOOT_RELEASE_DURATION = v } },
  { name: 'Recover Duration (s)', min: 0.05, max: 1, step: 0.01, value: SHOOT_RECOVER_DURATION, onChange: v => { SHOOT_RECOVER_DURATION = v } },
  { name: 'Elbow Windup (deg)', min: -90, max: 90, step: 1, value: SHOOT_ELBOW_WINDUP_DEG, onChange: v => { SHOOT_ELBOW_WINDUP_DEG = v } },
  { name: 'Link 1 Windup (deg)', min: -90, max: 90, step: 1, value: SHOOT_LINK1_WINDUP_DEG, onChange: v => { SHOOT_LINK1_WINDUP_DEG = v } },
  { name: 'Elbow Release (deg)', min: -90, max: 90, step: 1, value: SHOOT_ELBOW_RELEASE_DEG, onChange: v => { SHOOT_ELBOW_RELEASE_DEG = v } },
  { name: 'Link 1 Release (deg)', min: -90, max: 90, step: 1, value: SHOOT_LINK1_RELEASE_DEG, onChange: v => { SHOOT_LINK1_RELEASE_DEG = v } },
  { name: 'Elbow Release Lead', min: 0, max: 0.9, step: 0.05, value: SHOOT_RELEASE_LEAD, onChange: v => { SHOOT_RELEASE_LEAD = v } },
  { name: 'Release Point', min: 0.1, max: 1, step: 0.05, value: SHOOT_RELEASE_POINT, onChange: v => { SHOOT_RELEASE_POINT = v } },
  { name: 'Elbow Aim Coupling', min: 0, max: 2, step: 0.05, value: SHOOT_ELBOW_AIM_COUPLING, onChange: v => { SHOOT_ELBOW_AIM_COUPLING = v } },
  { name: 'Paddle Tilt Windup Peak', min: -3, max: 3, step: 0.05, value: SHOOT_TILT_WINDUP_PEAK, onChange: v => { SHOOT_TILT_WINDUP_PEAK = v } },
  { name: 'Paddle Tilt Target (release)', min: -3, max: 3, step: 0.05, value: SHOOT_TILT_TARGET, onChange: v => { SHOOT_TILT_TARGET = v } },
  { name: 'Shot Speed', min: 100, max: 2500, step: 10, value: SHOT_SPEED, onChange: v => { SHOT_SPEED = v } },
  { name: 'State Transition Delay (s)', min: 0, max: 1, step: 0.05, value: SHOOT_STATE_TRANSITION_DELAY, onChange: v => { SHOOT_STATE_TRANSITION_DELAY = v } },
])
addComponentSection(manipulatorAnimation, 'Handling (tasto destro)', [
  { name: 'Arm Ease', min: -1, max: 1, step: 0.02, value: HANDLING_EASE, onChange: v => { HANDLING_EASE = v } },
  { name: 'Grip Angle (rad)', min: 0, max: PADDLE_ANGLE_MAX, step: 0.02, value: HANDLING_GRIP_OFFSET, onChange: v => { HANDLING_GRIP_OFFSET = v } },
  { name: 'Transition Speed', min: 1, max: 30, step: 1, value: HANDLING_TRANSITION_SPEED, onChange: v => { HANDLING_TRANSITION_SPEED = v } },
  { name: 'Camera Height Boost', min: 0, max: 300, step: 5, value: HANDLING_HEIGHT_BOOST, onChange: v => { HANDLING_HEIGHT_BOOST = v } },
  { name: 'Camera Side Offset', min: -150, max: 150, step: 5, value: HANDLING_CAMERA_SIDE_OFFSET, onChange: v => { HANDLING_CAMERA_SIDE_OFFSET = v } },
  {
    name: 'Ball Rest Extra Offset', min: -5, max: 10, step: 0.05, value: BALL_REST_EXTRA_OFFSET,
    onChange: v => { BALL_REST_EXTRA_OFFSET = v; manipulator.controls.setBallRestOffset(v) },
  },
])
addComponentSection(manipulatorAnimation, 'Play Aim', [
  { name: 'Arm Yaw Offset (deg)', min: -180, max: 180, step: 1, value: ARM_YAW_OFFSET_DEG, onChange: v => { ARM_YAW_OFFSET_DEG = v } },
  {
    name: 'Crosshair Height (px)', min: 0, max: 300, step: 5, value: CROSSHAIR_HEIGHT,
    onChange: v => { CROSSHAIR_HEIGHT = v; updateCrosshairPosition() },
  },
])

// --- Basketball ---
const basketballConfig = createToggleSection(debugPanel, 'Basketball')
createSliderControl(basketballConfig, {
  name: 'Scale', min: 5, max: 40, step: 1, value: BALL_RADIUS,
  onChange: v => {
    BALL_RADIUS = v
    if (basketball) basketball.scale.setScalar(v)
  },
})
addComponentSection(basketballConfig, 'Ball Offset (da centro paletta)', [
  { name: 'Forward', min: -40, max: 40, step: 1, value: BALL_OFFSET_FORWARD, onChange: v => { BALL_OFFSET_FORWARD = v } },
  { name: 'Side', min: -40, max: 40, step: 1, value: BALL_OFFSET_SIDE, onChange: v => { BALL_OFFSET_SIDE = v } },
  { name: 'Down', min: -40, max: 40, step: 1, value: BALL_OFFSET_DOWN, onChange: v => { BALL_OFFSET_DOWN = v } },
])

// "Copy config": serializza TUTTI i parametri regolabili da debug pronti
// da incollare nel codice (manipolatore + dribble + pallone, non solo la
// forma del robot come prima — stesso schema usato finora per hardcodare
// scala/spawn camera)
const copyConfigBtn = document.createElement('button')
copyConfigBtn.id = 'copy-config-btn'
copyConfigBtn.textContent = 'Copy config'
const copyConfigFeedback = document.createElement('div')
copyConfigFeedback.id = 'copy-config-feedback'
debugPanel.append(copyConfigBtn, copyConfigFeedback)

copyConfigBtn.addEventListener('click', async () => {
  const c = {
    ...manipulator.getConfig(),
    ballRadius: BALL_RADIUS, ballGravity: BALL_GRAVITY, ballBounceSpeed: BALL_BOUNCE_SPEED,
    armYawOffsetDeg: ARM_YAW_OFFSET_DEG, crosshairHeight: CROSSHAIR_HEIGHT,
    dribblePushDuration: DRIBBLE_PUSH_DURATION, dribbleElbowAmplitudeDeg: DRIBBLE_ELBOW_AMPLITUDE_DEG,
    dribbleLink1AmplitudeDeg: DRIBBLE_LINK1_AMPLITUDE_DEG, dribbleLockAbsorbTime: DRIBBLE_LOCK_ABSORB_TIME,
    dribbleRiseYCorrection: DRIBBLE_RISE_Y_CORRECTION,
    handlingEase: HANDLING_EASE, handlingGripOffset: HANDLING_GRIP_OFFSET, handlingTransitionSpeed: HANDLING_TRANSITION_SPEED,
    handlingHeightBoost: HANDLING_HEIGHT_BOOST, handlingCameraSideOffset: HANDLING_CAMERA_SIDE_OFFSET,
    ballOffsetForward: BALL_OFFSET_FORWARD, ballOffsetSide: BALL_OFFSET_SIDE, ballOffsetDown: BALL_OFFSET_DOWN,
    shootWindupDuration: SHOOT_WINDUP_DURATION, shootReleaseDuration: SHOOT_RELEASE_DURATION,
    shootElbowWindupDeg: SHOOT_ELBOW_WINDUP_DEG, shootLink1WindupDeg: SHOOT_LINK1_WINDUP_DEG,
    shootElbowReleaseDeg: SHOOT_ELBOW_RELEASE_DEG, shootLink1ReleaseDeg: SHOOT_LINK1_RELEASE_DEG,
    shootReleaseLead: SHOOT_RELEASE_LEAD, shootReleasePoint: SHOOT_RELEASE_POINT, shotSpeed: SHOT_SPEED,
    shootRecoverDuration: SHOOT_RECOVER_DURATION, shootElbowAimCoupling: SHOOT_ELBOW_AIM_COUPLING,
    shootTiltWindupPeak: SHOOT_TILT_WINDUP_PEAK, shootTiltTarget: SHOOT_TILT_TARGET,
    ballRestExtraOffset: BALL_REST_EXTRA_OFFSET,
  }
  const text = Object.entries(c).map(([k, v]) => `${k}: ${v}`).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copyConfigFeedback.textContent = 'Copiato negli appunti ✓'
  } catch {
    copyConfigFeedback.textContent = text
  }
  setTimeout(() => { copyConfigFeedback.textContent = '' }, 2500)
})

// --- Pannello Camera (posizione + angoli, sola lettura) ---
const cameraPanel = document.getElementById('camera-panel')
// [elemento, funzione che legge il valore corrente] invece di 6 variabili
// + 6 assegnazioni .textContent speculari nel loop
const camReadouts = [
  ['cam-x', () => camera.position.x.toFixed(1)],
  ['cam-y', () => camera.position.y.toFixed(1)],
  ['cam-z', () => camera.position.z.toFixed(1)],
  ['cam-pitch', () => THREE.MathUtils.radToDeg(camera.rotation.x).toFixed(1)],
  ['cam-yaw', () => THREE.MathUtils.radToDeg(camera.rotation.y).toFixed(1)],
  ['cam-roll', () => THREE.MathUtils.radToDeg(camera.rotation.z).toFixed(1)],
  // stato grezzo della macchina a stati del palleggio, per verificare a
  // occhio SE è davvero questo a scattare in anticipo (non solo i numeri
  // derivati sotto)
  ['dribble-phase', () => dribblePhase],
  ['dribble-arm-ease', () => dribbleArmEase.toFixed(3)],
  ['ball-y', () => basketball ? basketball.position.y.toFixed(1) : '—'],
  ['paddle-y', () => paddleWorldPos.y.toFixed(1)],
  // "Gap (live)" è quasi sempre diverso da zero (palla e paletta seguono
  // curve diverse per la maggior parte del ciclo, per design) — non è il
  // numero utile. "Reconnect Gap" invece è lockOffset.y: congelato
  // esattamente nell'istante del riaggancio, resta leggibile tra un ciclo
  // e l'altro invece di sfarfallare — è QUESTO che deve tendere a 0
  // tarando Bounce Speed/Gravity
  ['ball-paddle-gap', () => basketball ? (basketball.position.y - paddleWorldPos.y).toFixed(1) : '—'],
  ['reconnect-gap', () => lockOffset.y.toFixed(1)],
  // diagnostica preview traiettoria: quanti punti ha scritto l'ultima volta
  // e PERCHÉ si è fermata (pavimento / esaurito il budget di passi / mai
  // aggiornata) — per capire a occhio, mentre si mira, cosa succede davvero
  // invece di indovinare dal solo aspetto della linea
  ['traj-count', () => trajDebugCount],
  ['traj-stop', () => trajDebugStopReason],
  // true/false reale del test usato da checkForPickup (bounding box del
  // robot, non solo la distanza dal centro) e stato FSM, per verificare a
  // occhio se il pickup dovrebbe scattare invece di indovinare
  ['pickup-dist', () => {
    if (!basketball) return '—'
    scratchRobotBox.setFromObject(manipulator.root)
    scratchRobotBox.expandByScalar(BALL_RADIUS + PICKUP_MARGIN)
    return scratchRobotBox.containsPoint(basketball.position) ? 'DENTRO (dovrebbe scattare)' : 'fuori'
  }],
  ['pickup-state', () => `ball=${basketball ? basketball.state : '—'} robot=${manipulator.state} phase=${pickupPhase}`],
].map(([id, get]) => [document.getElementById(id), get])

document.addEventListener('keydown', e => {
  if (e.code !== 'KeyP' || e.repeat) return
  const opening = debugPanel.classList.contains('hidden')
  debugPanel.classList.toggle('hidden', !opening)
  cameraPanel.classList.toggle('hidden', !opening)
  // serve il cursore per usare lo slider, quindi si sblocca il pointer lock
  if (opening && controls.isLocked) controls.unlock()
})

const camDir = new THREE.Vector3()
const camRight = new THREE.Vector3()

// --- Modalità Spectate/Play (tasto M) ---
// Spectate: free-fly esistente. Play: camera in terza persona che orbita
// il robot col mouse (stesso pointer lock del free-fly, ma qui muove un
// angolo orbitYaw/orbitPitch invece della camera direttamente); WASD è
// relativo a dove guarda ORA la camera (non assi mondo fissi). Le ruote
// (yaw dell'intero wheelsGroup) puntano comunque verso il vettore di
// movimento totale risultante via atan2.

// converte un angolo orizzontale (stessa convenzione di robotFacing/
// orbitYaw) in un vettore direzione — usato per camForward, dashDirection
// e l'offset della camera in Play, invece di scrivere sin/cos a mano ogni
// volta (un bug di segno su una di queste formule scritte a mano ha già
// causato l'inversione di A/D)
function angleToForward(angle, out) {
  return out.set(Math.sin(angle), 0, Math.cos(angle))
}
// "destra" rispetto a un forward orizzontale: rotazione di -90° attorno a
// Y, equivalente a cross(forward, worldUp)
function rotateRight(forward, out) {
  return out.set(-forward.z, 0, forward.x)
}

// scelti nel main menu (GAMEMODES/robot/fase del giorno) prima di entrare
// in scena — solo PRACTICE è davvero implementata, 1v1/3v3 richiedono
// nemici (Section 3)
let gameMode = GameMode.PRACTICE
let timeOfDay = TimeOfDay.DAY

// 'menu' è un terzo valore di mode (non una FSM/enum a parte — mode è
// sempre stata una semplice stringa, un terzo valore basta): mentre il
// main menu è aperto non si può passare a 'play' col tasto M, e la camera
// segue l'orbita lenta del menu invece della logica normale. Diventa
// 'spectate' quando il menu si chiude (fine flusso di selezione)
let mode = 'menu'
const modeIndicator = document.getElementById('mode-indicator')
let robotFacing = 0 // yaw ruote/robot (rad), persiste quando fermo
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
// HANDLING_HEIGHT_BOOST dichiarata più in alto (vedi vicino a HANDLING_EASE)
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
let currentChaseDistance = CHASE_DISTANCE
let currentHeightBoost = 0
// in HANDLING niente offset laterale: il braccio va in linea con la
// visuale invece che di profilo, interpolato come il resto (vedi
// ARM_YAW_OFFSET_DEG sopra per l'offset normale fuori da HANDLING)
let currentArmYawOffsetDeg = ARM_YAW_OFFSET_DEG
const CHASE_HEIGHT = 180
const LOOK_HEIGHT = 80
const ORBIT_SENSITIVITY = 0.0025
// il braccio (base R1) seguiva l'orbit yaw 1:1, quindi puntava sempre
// esattamente lontano dalla camera (si vedeva il palleggio "di spalle").
// ARM_YAW_OFFSET_DEG (dichiarata più sopra, tarabile da debug → Play Aim)
// resta comunque agganciato all'orbit (gira insieme alla camera), ma
// sfalsato di lato — così il palleggio si vede di profilo
let orbitYaw = 0
// pitch iniziale che riproduce l'inquadratura di prima (stessa proporzione
// altezza/distanza), poi libero via mouse entro un range che non ribalta
const ORBIT_PITCH_REST = Math.atan2(CHASE_HEIGHT, CHASE_DISTANCE)
let orbitPitch = ORBIT_PITCH_REST
const ORBIT_PITCH_MIN = 0.05
const ORBIT_PITCH_MAX = 0.9 // avvicinato a ORBIT_PITCH_MAX_HANDLING (meno differenza tra i due stati, transizione meno marcata)
// orbitPitch CRESCENTE porta la camera più in alto e vicina, sopra la testa
// del robot → guarda più IN GIÙ. Quindi "guarda su" è l'opposto: orbitPitch
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
let wheelsCurrentAngle = -Math.PI / 2 // combacia col target a robotFacing=0
const WHEEL_TURN_SPEED = 18 // rad/s equivalenti: "rapidissima" ma non istantanea
function lerpAngle(current, target, factor) {
  const diff = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI
  return current + diff * factor
}

// --- Dash (Shift in Play) ---
const dashPanel = document.getElementById('dash-panel')
const dashBarFill = document.getElementById('dash-bar-fill')
const crosshair = document.getElementById('crosshair')
// riusata anche dallo slider "Crosshair Height" nel pannello debug, invece
// di ripetere la stessa formula in due punti
function updateCrosshairPosition() {
  crosshair.style.top = `calc(50% - ${CROSSHAIR_HEIGHT}px)`
}
updateCrosshairPosition()
const dashDirection = new THREE.Vector3()
const DASH_COOLDOWN_TIME = 4
const DASH_DURATION = 0.15
const DASH_SPEED_MULTIPLIER = 6
let dashCooldown = 0     // secondi rimanenti prima che il dash sia di nuovo pronto
let dashTimeRemaining = 0 // secondi rimanenti dello scatto in corso

document.addEventListener('keydown', e => {
  if (e.code !== 'ShiftLeft' || e.repeat || mode !== 'play' || dashCooldown > 0) return
  angleToForward(robotFacing, dashDirection)
  dashTimeRemaining = DASH_DURATION
  dashCooldown = DASH_COOLDOWN_TIME
})

document.addEventListener('keydown', e => {
  if (e.code !== 'KeyM' || e.repeat || mode === 'menu') return
  mode = mode === 'spectate' ? 'play' : 'spectate'
  modeIndicator.textContent = `MODE: ${mode.toUpperCase()}`
  dashPanel.classList.toggle('hidden', mode !== 'play')
  crosshair.classList.toggle('hidden', mode !== 'play')
  // forza un nuovo click-per-entrare nel cambio modalità, per evitare
  // che un delta mouse residuo salti da uno schema di controllo all'altro
  // — suppressPauseOnUnlock: questo unlock è un dettaglio del cambio
  // modalità, non "il giocatore ha premuto Esc per mettere in pausa"
  if (controls.isLocked) { suppressPauseOnUnlock = true; controls.unlock() }
  // sicurezza: se si cambia modalità mentre si tiene il tasto destro
  // premuto, non restare bloccati in HANDLING senza modo di rilasciarlo
  // (non se un tiro è in corso: interromperlo a metà lascerebbe l'animazione
  // e lo stato palla in una via di mezzo incoerente)
  if (mode !== 'play' && manipulator.state === RobotState.HANDLING && shootPhase === 'idle') releaseBallHandling()
})

document.addEventListener('mousemove', e => {
  if (mode !== 'play' || !controls.isLocked) return
  orbitYaw -= e.movementX * ORBIT_SENSITIVITY
  const isHandlingNow = manipulator.state === RobotState.HANDLING
  const pitchMin = isHandlingNow ? ORBIT_PITCH_MIN_HANDLING : ORBIT_PITCH_MIN
  const pitchMax = isHandlingNow ? ORBIT_PITCH_MAX_HANDLING : ORBIT_PITCH_MAX
  orbitPitch = THREE.MathUtils.clamp(
    orbitPitch + e.movementY * ORBIT_SENSITIVITY,
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
  if (e.button !== 2 || mode !== 'play') return
  rightMouseDown = true
  if (shootPhase !== 'idle') return // non interrompere un tiro in corso
  // senza la palla non c'è niente da stringere in mano: tasto destro non fa
  // nulla finché non la si raccoglie (pickup automatico toccandola a terra)
  if (!basketball || basketball.state !== BallState.HANDLED) return
  // la mira riparte da un pitch fisso e sensato invece di quello che si
  // aveva in DRIBBLE (che potrebbe essere un estremo, tipo guardando giù) —
  // il salto si vede scorrere comunque: camera.quaternion.slerp verso il
  // bersaglio (vedi animate()) è l'UNICO stadio di smoothing sulla rotazione,
  // niente doppio lerp in cascata qui sopra
  orbitPitch = ORBIT_PITCH_REST
  manipulator.setState(RobotState.HANDLING)
  // altrimenti resterebbe bloccato a true per sempre dopo il primo tiro,
  // impedendo alla preview di traiettoria di riapparire quando si riafferra
  shootReleased = false
})
document.addEventListener('mouseup', e => {
  if (e.button !== 2) return
  rightMouseDown = false
  if (manipulator.state !== RobotState.HANDLING || shootPhase !== 'idle') return
  releaseBallHandling()
})
// riparte da un 'push' pulito, non da dove si era fermata la palla prima
// della transizione — condivisa da releaseBallHandling() e da updatePickup()
// (era scritta due volte identica in main.js)
function resetDribbleState() {
  dribblePhase = 'push'
  dribblePhaseT = 0
  dribbleArmEase = 0
  ballVelocityY = 0
  previousPushPaddleY = null
  lockOffset.set(0, 0, 0)
}

function releaseBallHandling() {
  manipulator.setState(RobotState.DRIBBLE)
  // ORBIT_PITCH_MIN_HANDLING (fino a -0.9) è valido solo mentre si è in
  // HANDLING — il clamp normale (ORBIT_PITCH_MIN=0.05) si applica di nuovo
  // solo al prossimo movimento del mouse, quindi se si rilascia il tasto
  // destro senza muovere il mouse orbitPitch resta a un valore fuori dal
  // range normale e la camera finisce sotto il pavimento. Riportarlo subito
  // dentro il range appena si torna in DRIBBLE evita il buco
  orbitPitch = THREE.MathUtils.clamp(orbitPitch, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX)
  resetDribbleState()
  handlingGrip = 0
  manipulator.controls.setGrip(0)
  handlingTiltOffset = 0
  manipulator.controls.setShootTilt(0)
}

// --- Tiro (click sinistro, solo mentre si tiene la palla in HANDLING) ---
// Direzione: raycast dalla camera attraverso il PIXEL del crosshair (non il
// centro schermo) — in HANDLING la camera ha un orientamento libero vero
// (quaternion, non lookAt), quindi quel raggio è esattamente dove il
// giocatore sta mirando. Il crosshair è sempre centrato in orizzontale
// (CSS left:50%) e spostato solo in verticale di CROSSHAIR_HEIGHT px, quindi
// le NDC si derivano direttamente da quella costante, senza leggere il DOM.
// Velocità: ancora una costante piatta (SHOT_SPEED) — la HUD forza dipendente
// dalle stat è un task separato più avanti, per ora serve solo la meccanica.
const shootRaycaster = new THREE.Raycaster()
const crosshairNDC = new THREE.Vector2()
function getShotDirection(out) {
  crosshairNDC.set(0, (2 * CROSSHAIR_HEIGHT) / window.innerHeight)
  shootRaycaster.setFromCamera(crosshairNDC, camera)
  return out.copy(shootRaycaster.ray.direction)
}

// RobotState.NO_BALL si entra SOLO al momento del rilascio dentro 'release'
// (vedi updateShootAnimation), non subito al click: prima c'è tutta
// l'animazione di windup+rilascio, con la palla ancora incollata alla
// paletta come in HANDLING normale
let shootPhase = 'idle' // 'idle' | 'windup' | 'release'
let shootPhaseT = 0
let shootReleased = false // per-tiro: true dal frame in cui la palla lascia davvero la paletta
// catturata al momento del rilascio (posizione del ROBOT, non della palla
// quando arriva al canestro) — la regola dei 2/3 punti dipende da dove si
// tirava, non da dove si trova la palla quando entra
let shotWasInsideArc = false
let shootStateTransitionTimer = 0 // secondi rimanenti prima del vero cambio di stato (vedi SHOOT_STATE_TRANSITION_DELAY)
// pose di gomito/link1 al momento del click, punto di partenza del lerp di
// 'windup' — senza questo la prima svg dello windup scatterebbe dalla posa
// di presa direttamente al target invece di scorrere con continuità
let shootStartElbowOffset = 0
let shootStartLink1Offset = 0
let shootStartGrip = 0
let shootStartTilt = 0
// aimPitchOffset "congelato" all'istante in cui parte 'recover' (vedi sotto):
// il punto di partenza del suo lerp verso 0, calcolato una volta sola invece
// di continuare a inseguire la camera anche durante il recupero
let shootRecoverStartAimPitch = 0
const shotVelocity = new THREE.Vector3()
// dopo un urto (backboard/ferro/...), quanto ignorare NUOVE collisioni CON
// LO STESSO OGGETTO: con restituzione bassa (rimbalzo morbido voluto) la
// palla si allontana dalla superficie molto lentamente — così lentamente
// che senza questa pausa il check "sfera dentro il volume espanso" la
// ricattura ogni singolo frame (la spinge di nuovo esattamente sul bordo,
// riflette di nuovo una velocità già debole), restando visivamente
// "incollata" al punto d'urto per un bel po' invece di allontanarsene con
// un arco pulito. PER OGGETTO (WeakMap), non un unico timer globale: un
// timer globale sospendeva TUTTE le collisioni per 0.3s dopo un rimbalzo
// qualsiasi — un rimbalzo sul ferro seguito a ruota da un volo verso la
// backboard ATTRAVERSAVA la backboard senza mai risultare in collisione,
// perché il cooldown (nato per il ferro) bloccava anche lei
// Map, non WeakMap: i collidable (collisionWorld.backboardBoxes/hoops/
// wallBoxes/...) sono un insieme fisso e permanente per tutta la sessione
// (mai creati/distrutti a runtime), quindi niente rischio di leak — e
// serve poterla svuotare (clearAllCollisionCooldowns) a inizio tiro/reset,
// cosa che WeakMap non permette
const shotCollisionCooldowns = new Map() // oggetto collidable -> secondi rimanenti
function clearAllCollisionCooldowns() {
  shotCollisionCooldowns.clear()
}

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
let pickupPhase = 'idle' // 'idle' | 'active'
let pickupPhaseT = 0

document.addEventListener('mousedown', e => {
  if (e.button !== 0 || mode !== 'play' || !controls.isLocked) return
  if (manipulator.state !== RobotState.HANDLING || shootPhase !== 'idle' || !basketball) return
  const [shootTriggerElbowAmplitude, shootTriggerLink1Amplitude] = dribbleAmplitudesRad()
  shootStartElbowOffset = dribbleArmEase * shootTriggerElbowAmplitude
  shootStartLink1Offset = dribbleArmEase * shootTriggerLink1Amplitude
  shootStartGrip = handlingGrip
  shootStartTilt = handlingTiltOffset
  shootPhase = 'windup'
  shootPhaseT = 0
  shootReleased = false
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
  if (e.code !== 'KeyR' || e.repeat || mode !== 'play') return
  shootPhase = 'idle'
  shootPhaseT = 0
  shootReleased = false
  shootStateTransitionTimer = 0
  clearAllCollisionCooldowns()
  manipulator.controls.setAimPitch(0)
  manipulator.controls.setShootTilt(0)
  manipulator.controls.setDribbleOffsets(0, 0)
  dribbleArmEase = 0
  handlingTiltOffset = 0
  pickupPhase = 'idle'
  // il tasto di test "ricarica" la palla forzatamente in mano — deve anche
  // riportarla a HANDLED, altrimenti il tasto destro resterebbe bloccato
  // dal gate pensato per il pickup normale (basketball.state !== HANDLED)
  if (basketball) basketball.setState(BallState.HANDLED)
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
// BALL_GRAVITY/BALL_BOUNCE_SPEED dichiarate più sopra (fisse); DRIBBLE_* regolabili da debug
let ballVelocityY = 0
// fisica balistica pura di 'rise', SEPARATA dalla Y renderizzata: se si
// sottraesse DRIBBLE_RISE_Y_CORRECTION direttamente da basketball.position.y
// ogni frame, il frame successivo ripartirebbe già "corretto" e la
// sottrazione si accumulerebbe frame dopo frame invece di restare un
// piccolo offset costante — qui invece resta lo stato fisico vero,
// impostato al rimbalzo (vedi 'drop'), la correzione si applica solo in
// fase di render (vedi 'rise')
let riseBallisticY = 0
let dribblePhase = 'push'
let dribblePhaseT = 0
// 0 = braccio a riposo (in cima), 1 = spinta al massimo — persiste anche
// durante 'drop' (il braccio resta fermo dov'è arrivato), aggiornata solo
// in 'push'/'rise'; guida anche la posa "aperta" della paletta sotto
let dribbleArmEase = 0
// offset palla↔paletta congelato nell'istante in cui la palla si "riaggancia"
// (fine 'rise' → 'push'): il lock parte esattamente da lì (nessuno scatto),
// poi si riassorbe verso 0 nel corso della spinta — vedi uso in animate()
const lockOffset = new THREE.Vector3()
// Y della PALETTA (non della palla) al frame precedente, solo durante
// 'push': serve a dedurre la velocità reale che la spinta impartisce
// (differenza finita), così 'drop' riparte da quella invece che da un
// azzeramento secco. Deve essere la Y della paletta, non quella
// (eventualmente ancora "sporcata" dal riassorbimento di lockOffset) della
// palla — vedi uso in animate(). null = "appena entrati in push, nessuna
// storia da cui dedurla"
let previousPushPaddleY = null
const paddleWorldPos = new THREE.Vector3()
// assi locali della paletta trasformati in direzioni mondo ogni frame — SOLO
// per updateDribble (palleggio automatico), dove il tilt della paletta resta
// sempre costante (state.paddleTilt, mai toccato lì) quindi yaw+giù fisso
// basta ed è quello che è sempre stato tarato dai BALL_OFFSET_* di debug.
// updateHandling/updateShootAnimation NON usano questi offset: lì il tilt
// cambia (piatto in HANDLING, verso l'alto nel tiro, vedi setShootTilt) e la
// palla segue direttamente il centro vero della paletta, senza correzioni
const paddleForwardDir = new THREE.Vector3()
const paddleSideDir = new THREE.Vector3()
// costante (mai riassegnato): "giù" è sempre il basso reale del mondo
const paddleDownDir = new THREE.Vector3(0, -1, 0)

// timestep fisso per la simulazione del palleggio, disaccoppiato dal
// framerate di rendering (accumulator pattern): il render loop gira a
// delta variabile (vsync/hitch/tab in background), ma updateDribble vede
// SEMPRE lo stesso dt piccolo e costante. Questo è ciò che rende la
// traiettoria riproducibile (stesse condizioni iniziali → stessa curva,
// indipendentemente da quanto è fluido il framerate quella volta) ed
// elimina alla radice — non solo attutisce — il caso patologico di un
// singolo frame con delta enorme che capita esattamente sul frame in cui
// dribbleArmEase satura a 1: qui quel frame verrebbe semplicemente diviso
// in più passi da DRIBBLE_FIXED_DT, mai in un passo unico anomalo
const DRIBBLE_FIXED_DT = 1 / 120
let dribbleAccumulator = 0

// --- Loop ---
const clock = new THREE.Clock()

// Palleggio: unica funzione chiamata a passo fisso (vedi accumulator in
// animate()). dt è sempre DRIBBLE_FIXED_DT, mai il delta di rendering.
function updateDribble(dt) {
  dribblePhaseT += dt
  const [elbowAmplitude, link1Amplitude] = dribbleAmplitudesRad()
  // dribbleArmEase aggiornata solo in 'push'/'rise' — in 'drop' resta
  // quella di fine 'push' (il braccio è fermo in fondo, non tocca nulla)
  if (dribblePhase === 'push') {
    const t = Math.min(dribblePhaseT / DRIBBLE_PUSH_DURATION, 1)
    dribbleArmEase = t * t // ease-IN: velocità massima (non zero) proprio al rilascio, sempre da 0 (pose pulita, niente scatto residuo)
  } else if (dribblePhase === 'rise') {
    const riseDuration = BALL_BOUNCE_SPEED / BALL_GRAVITY // tempo per decelerare a v=0 sotto gravità
    const t = Math.min(dribblePhaseT / riseDuration, 1)
    dribbleArmEase = 1 - t * t * (3 - 2 * t) // da 1 a 0: il braccio torna su mentre la palla risale
  }
  // applicata PRIMA di leggere la world position della paletta, altrimenti
  // sarebbe in ritardo di un frame rispetto alla posa appena decisa sopra
  manipulator.controls.setDribbleOffsets(dribbleArmEase * elbowAmplitude, dribbleArmEase * link1Amplitude)

  // updateWorldMatrix forza il ricalcolo subito (matrixWorld si aggiorna
  // di norma solo durante il render, quindi senza sarebbe in ritardo di
  // un frame rispetto alla posa appena applicata sopra)
  manipulator.paddle.updateWorldMatrix(true, false)
  manipulator.paddle.getWorldPosition(paddleWorldPos)
  // il punto di tracking (centro geometrico della paletta) non è dove
  // dovrebbe stare la palla a occhio: 3 offset (Forward/Side/Down,
  // tarabili da debug → Basketball → Ball Offset) spostano quel punto.
  // NON relativi alla rotazione dell'end effector (gomito/link1/polso/
  // tilt): con Forward=40 e il gomito che spazza 40° durante il push,
  // un offset che ruotasse CON quella pitch disegnerebbe un arco da 40
  // unità di raggio, staccando visibilmente la palla dalla paletta —
  // solo lo yaw della base (dove punta il braccio orizzontalmente) è
  // rilevante, Down è sempre il basso reale del mondo. SOLO qui (dribble
  // automatico): il tilt della paletta resta costante in questa fase
  // (state.paddleTilt, mai toccato da setShootTilt), quindi la formula
  // yaw-only che ha sempre funzionato resta corretta invariata
  angleToForward(manipulator.joints.base.rotation.y, paddleForwardDir)
  rotateRight(paddleForwardDir, paddleSideDir)
  paddleWorldPos
    .addScaledVector(paddleForwardDir, BALL_OFFSET_FORWARD)
    .addScaledVector(paddleSideDir, BALL_OFFSET_SIDE)
    .addScaledVector(paddleDownDir, BALL_OFFSET_DOWN)

  if (dribblePhase === 'push') {
    // lockOffset si riassorbe in DRIBBLE_LOCK_ABSORB_TIME (breve, non
    // sull'intera spinta): al frame del "riaggancio" la palla resta
    // esattamente dov'era (nessuno scatto), poi converge in fretta sulla
    // paletta — per il resto della spinta la segue esattamente, offset zero
    const lockBlend = Math.min(dribblePhaseT / DRIBBLE_LOCK_ABSORB_TIME, 1)
    basketball.position.copy(paddleWorldPos).addScaledVector(lockOffset, 1 - lockBlend)
    // velocità dedotta dal movimento REALE della paletta (paddleWorldPos),
    // non da basketball.position: quella include anche il riassorbimento
    // di lockOffset, che con Lock Absorb Time pari all'intera Push
    // Duration contribuisce un termine costante alla velocità per tutta
    // la spinta — compreso l'ultimo passo, quello del rilascio. lockOffset
    // varia leggermente da ciclo a ciclo, quindi ogni tanto quel termine
    // annullava quasi del tutto la velocità vera della paletta proprio al
    // rilascio, dando l'impressione di un azzeramento/rallentamento a inizio 'drop'.
    // Con dt fisso questa lettura per-passo è stabile: non c'è più un delta
    // variabile/anomalo che possa farla collassare vicino a zero
    if (previousPushPaddleY !== null) ballVelocityY = (paddleWorldPos.y - previousPushPaddleY) / dt
    previousPushPaddleY = paddleWorldPos.y
    // tolleranza, non ">= 1" stretto: dribblePhaseT accumula dt (1/120, non
    // rappresentabile esattamente in binario) per ~30 passi, quindi arriva
    // a un pelo SOTTO 0.25 invece che esattamente uguale — dribbleArmEase
    // tocca 0.999999999999998 invece di 1, e senza tolleranza serve un
    // passo fisso intero "sprecato" in più prima che la transizione scatti
    // davvero. In quel passo la paletta è già a fine corsa e non si muove
    // per niente (Δy = 0 esatto) → l'ultima ballVelocityY calcolata è
    // sempre zero, ad ogni singolo ciclo (deterministico, non casuale)
    if (dribbleArmEase >= 1 - 1e-6) { dribblePhase = 'drop'; dribblePhaseT = 0 }
  } else if (dribblePhase === 'drop') {
    ballVelocityY -= BALL_GRAVITY * dt
    let ballY = basketball.position.y + ballVelocityY * dt
    if (ballY <= BALL_RADIUS) {
      ballY = BALL_RADIUS
      ballVelocityY = BALL_BOUNCE_SPEED
      riseBallisticY = ballY // stato fisico vero di 'rise', riparte dal punto di rimbalzo
      dribblePhase = 'rise'
      dribblePhaseT = 0
      // volume ridotto: il palleggio automatico non si ferma mai, a piena
      // intensità diventava fastidioso in loop continuo
      sfx.playBounce(0.35)
    }
    basketball.position.set(paddleWorldPos.x, ballY, paddleWorldPos.z)
  } else { // 'rise'
    ballVelocityY -= BALL_GRAVITY * dt
    // riseBallisticY integra la fisica pura, MAI la Y già corretta (che
    // altrimenti si accumulerebbe frame dopo frame) — la correzione è
    // un piccolo offset costante applicato solo qui, in fase di render
    riseBallisticY += ballVelocityY * dt
    const ballY = riseBallisticY - DRIBBLE_RISE_Y_CORRECTION
    basketball.position.set(paddleWorldPos.x, ballY, paddleWorldPos.z)
    // riaggancio al vero apice balistico (v=0): il riaggancio esattamente
    // lì, non prima, è ciò che minimizza lo scatto (sia la velocità della
    // palla sia il ritorno del braccio sono più piatti in quel punto)
    if (dribbleArmEase <= 0 || ballVelocityY <= 0) {
      // congela l'offset palla↔paletta nell'istante esatto del riaggancio,
      // così 'push' riparte dalla posizione reale della palla, non da uno
      // scatto verso la paletta
      lockOffset.copy(basketball.position).sub(paddleWorldPos)
      previousPushPaddleY = null // nessuna storia di velocità pregressa per il nuovo 'push'
      dribblePhase = 'push'
      dribblePhaseT = 0
    }
  }
}

// RobotState.HANDLING (tasto destro tenuto premuto): posa di presa fissa,
// niente accumulator/timestep fisso (non è una simulazione, è una posa
// interpolata) — la palla resta incollata alla paletta con lo stesso offset
// usato in 'push'. dribbleArmEase/handlingGrip si avvicinano rapidamente ai
// target invece di scattarci sopra di colpo (stesso schema esponenziale
// framerate-independent usato per sterzata ruote e zoom camera). Costanti
// HANDLING_* dichiarate più in alto (vedi commento lì)
let handlingGrip = 0
// offset di tilt applicato SOLO durante l'HANDLING base (non il tiro): porta
// la paletta esattamente piatta (normale dritta verso l'alto, "orizzontale
// al piano XZ") cancellando state.paddleTilt — a pitch estremi (ora che il
// gomito segue la camera anche qui) la V restava alla sua inclinazione da
// palleggio e finiva per compenetrarsi nel polso/gomito
let handlingTiltOffset = 0
function updateHandling(delta) {
  const lerpFactor = 1 - Math.exp(-HANDLING_TRANSITION_SPEED * delta)
  dribbleArmEase += (HANDLING_EASE - dribbleArmEase) * lerpFactor
  handlingGrip += (HANDLING_GRIP_OFFSET - handlingGrip) * lerpFactor
  manipulator.controls.setGrip(handlingGrip)

  // gomito già agganciato al pitch della camera QUI, non solo durante il
  // tiro (updateShootAnimation usa la stessa formula): così quando si preme
  // il sinistro per tirare il braccio è già orientato dove si sta mirando,
  // nessun salto quando parte il windup — camera e braccio sono coerenti
  // per tutta la durata della presa, non solo durante l'animazione di lancio
  manipulator.controls.setAimPitch(computeAimPitchOffset())

  // getPaddleTilt() letto ogni frame (non una snapshot vecchia): paddleTilt
  // è regolabile da debug, il bersaglio deve restare in sync se cambia —
  // getConfig() farebbe una clone completa dello state solo per un campo
  const targetHandlingTilt = -manipulator.getPaddleTilt()
  handlingTiltOffset += (targetHandlingTilt - handlingTiltOffset) * lerpFactor
  manipulator.controls.setShootTilt(handlingTiltOffset)

  const [handlingElbowAmplitude, handlingLink1Amplitude] = dribbleAmplitudesRad()
  manipulator.controls.setDribbleOffsets(dribbleArmEase * handlingElbowAmplitude, dribbleArmEase * handlingLink1Amplitude)

  // niente BALL_OFFSET_*/tilt qui: manipulator.ballRestPoint (non .paddle) è
  // già il punto geometricamente corretto — dove le normali delle due metà
  // della V si incontrerebbero se estruse, non il centro "piatto" usato dal
  // palleggio (quello assume un tilt sempre costante, qui varia)
  manipulator.ballRestPoint.updateWorldMatrix(true, false)
  manipulator.ballRestPoint.getWorldPosition(paddleWorldPos)
  basketball.position.copy(paddleWorldPos)
}

// RobotState.NO_BALL: vi si entra a metà di updateShootAnimation, esattamente
// al momento del rilascio (vedi sotto) — da lì la palla vola come un vero
// proiettile sotto gravità pura (stessa BALL_GRAVITY del palleggio),
// staccata da qualunque tracking sulla paletta
// resolveSphereBoxCollision/resolveSphereTorusCollision/resolveEnvironmentCollisions
// spostate in CollisionWorld (src/CollisionWorld.js, istanziata più sotto
// come collisionWorld) — stesso comportamento, solo raccolto in una classe

// rilevamento canestro: nessuna vera "mesh trigger", stesso spirito
// imperativo del resto del progetto — attraversamento del piano orizzontale
// del ferro (Y), in discesa, entro il raggio del cerchio. Punto debole noto:
// usa la posizione DOPO il movimento di questo frame (non un'intersezione
// segmento-piano esatta), a 120fps-equivalenti di updateShotFlight è
// un'approssimazione più che sufficiente, coerente con lo stile del resto
// della fisica del progetto. Estratta a parte (non solo inline in
// checkHoopScore) perché la preview di traiettoria ha bisogno dello stesso
// identico test, ricontrollato ad ogni passo — vedi updateTrajectoryPreview
// previousPos è il vettore COMPLETO del passo precedente (non solo la Y):
// serve per interpolare il punto ESATTO in cui la traiettoria attraversa
// il piano del ferro, non testare la posizione già "oltre" a fine passo.
// Con un solo campione discreto il test è sensibile alla grana del passo
// (TRAJECTORY_DT nella preview è più grezzo di SHOT_PHYSICS_SUBSTEP_DT nel
// volo reale) — tiri che davvero entrano, specialmente da vicino dove la
// traiettoria è più verticale vicino al ferro, potevano risultare "appena
// fuori" nella preview pur essendo dentro nella realtà
function isHoopCrossing(previousPos, position, hoop) {
  if (previousPos.y <= hoop.center.y || position.y > hoop.center.y) return false
  const t = (previousPos.y - hoop.center.y) / (previousPos.y - position.y)
  const crossX = THREE.MathUtils.lerp(previousPos.x, position.x, t)
  const crossZ = THREE.MathUtils.lerp(previousPos.z, position.z, t)
  const dx = crossX - hoop.center.x
  const dz = crossZ - hoop.center.z
  return Math.hypot(dx, dz) <= hoop.radius
}

// Point System: 2 punti se si tirava da dentro l'arco dei 3 punti, 3 se da
// fuori (shotWasInsideArc, catturato al rilascio — non dove si trova la
// palla quando entra), canestro in uno qualunque dei due ferri vale
let score = 0
const scoreValueEl = document.getElementById('score-value')
function addScore(points) {
  score += points
  scoreValueEl.textContent = String(score)
}

function checkHoopScore(previousPos, position) {
  for (const hoop of collisionWorld.hoops) {
    if (isHoopCrossing(previousPos, position, hoop)) {
      console.log('%c🏀 CANESTRO!', 'color: orange; font-weight: bold; font-size: 14px')
      addScore(shotWasInsideArc ? 2 : 3)
      sfx.playScore()
    }
  }
}

// backboard/ferro/muri/pali/panchine: stesso identico giro di 5 controlli
// serviva sia al volo fisico reale (updateShotFlight) sia alla preview di
// traiettoria (updateTrajectoryPreview), copiato due volte — un nuovo tipo
// di collidable andava aggiunto in ENTRAMBI i posti separatamente. Un solo
// giro condiviso, richiamato da entrambi; ritorna true se almeno un urto
// spinge orizzontalmente (X/Z, mai Y) verso l'asse verticale del canestro
// quando la palla è dentro il cono d'assistenza — chiamata da entrambi gli
// step fisici (volo vero e preview) così la preview mostra ESATTAMENTE la
// curva che poi succede davvero, non è un bias nascosto solo a runtime
function applyHoopAssist(position, velocity, dt, strength) {
  if (strength <= 0) return
  for (const hoop of collisionWorld.hoops) {
    const heightAboveRim = position.y - hoop.center.y
    // altezza del cono = dalla cima reale della backboard, non un valore
    // a caso — sopra la backboard il tiro è comunque ormai "andato"
    const assistHeight = collisionWorld.BACKBOARD_TOP_Y - hoop.center.y
    if (heightAboveRim < 0 || heightAboveRim > assistHeight) continue
    const coneT = heightAboveRim / assistHeight
    const coneRadius = THREE.MathUtils.lerp(HOOP_ASSIST_BASE_RADIUS, HOOP_ASSIST_TOP_RADIUS, coneT)
    const dx = hoop.center.x - position.x
    const dz = hoop.center.z - position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-6 || dist > coneRadius) continue
    // correzione di POSIZIONE (frazione della distanza residua verso il
    // centro), non un'accelerazione sulla velocità: quella si accumula con
    // quanto tempo la palla passa nel cono (tiri da vicino/lenti = più
    // tempo dentro = spinta eccessiva, la palla finiva OLTRE il centro
    // invece che dentro). Più forte verso il bordo del cono (dove "quasi
    // ci arriva da solo"), non al centro (dove non serve aiuto) — ma non
    // può mai superare il centro qualunque sia strength/dt
    const pull = Math.min(strength * (dist / coneRadius) * HOOP_ASSIST_PULL_RATE * dt, 1)
    position.x += dx * pull
    position.z += dz * pull
  }
}

// abbastanza fine da non "bucare" lo spessore sottile di backboard/ferro
// (BACKBOARD_HALF_THICKNESS=4, quindi 8 unità totali) nemmeno alla velocità
// di tiro più alta: a SHOT_SPEED~1100 unità/s, un frame intero (delta
// variabile, fino a 16-30ms) sposterebbe la palla di 18-33 unità — più
// dello spessore del pannello, saltandolo del tutto (tunneling). Con questo
// passo fisso lo spostamento massimo per sotto-passo resta sotto le 5 unità
const SHOT_PHYSICS_SUBSTEP_DT = 1 / 240

function updateShotFlight(delta) {
  let remaining = delta
  while (remaining > 0) {
    stepShotFlight(Math.min(SHOT_PHYSICS_SUBSTEP_DT, remaining))
    remaining -= SHOT_PHYSICS_SUBSTEP_DT
  }
}

const scratchPreviousShotPos = new THREE.Vector3()
function stepShotFlight(dt) {
  // vettore COMPLETO (non solo Y): isHoopCrossing interpola il punto
  // esatto di attraversamento del piano del ferro, le serve X/Z di prima
  scratchPreviousShotPos.copy(basketball.position)
  shotVelocity.y -= BALL_GRAVITY * dt
  basketball.position.addScaledVector(shotVelocity, dt)
  applyHoopAssist(basketball.position, shotVelocity, dt, shootingStatToAssistStrength(manipulator.stats.shooting))

  // solo nel volo reale (non nella preview, che condivide la stessa
  // funzione ma non deve mai suonare mentre si sta solo mirando)
  if (collisionWorld.resolve(basketball.position, shotVelocity, dt, shotCollisionCooldowns, BALL_RADIUS)) sfx.playBounce()
  checkHoopScore(scratchPreviousShotPos, basketball.position)

  if (basketball.position.y <= BALL_RADIUS) {
    basketball.position.y = BALL_RADIUS
    sfx.playBounce()
    // vicino al rimbalzo del palleggio automatico (BALL_BOUNCE_SPEED) ma un
    // filo più smorzato — un tiro sbagliato rimbalza come farebbe la palla
    // vera invece di fermarsi di colpo, senza però riusare la costante del
    // palleggio 1:1 (quella resta sua, tarata a parte). Punteggio/rotolamento
    // reali restano lavoro futuro (Point System)
    shotVelocity.y = SHOT_FLOOR_BOUNCE_SPEED
    // senza smorzare anche X/Z la palla scivolerebbe in orizzontale per
    // sempre (solo Y viene mai toccata altrimenti) — un filo alla volta,
    // non un attrito forte
    shotVelocity.x *= FLOOR_HORIZONTAL_DAMPING
    shotVelocity.z *= FLOOR_HORIZONTAL_DAMPING
  }
}

const SHOOT_EASE = t => t * t * (3 - 2 * t) // smoothstep, stessa curva già usata per 'rise' in updateDribble

// bounding box VERA del robot (non la distanza dal solo centro/root — il
// corpo è largo e basso, non uno sferoide, un raggio da un punto solo non
// rappresenta bene quando la palla è davvero "a portata") — ricalcolata
// dalla geometria reale ogni volta, si adatta a qualunque posa/rotazione
const scratchRobotBox = new THREE.Box3()
// avvia il pickup (non durante un altro pickup già in corso, né se la palla
// non è libera). Chiamata da updateShotFlight ogni frame mentre lo stato è NO_BALL
// scarto grossolano (solo distanza al quadrato dal root, nessuna allocazione
// né traversal) prima del test preciso: setFromObject attraversa l'intera
// gerarchia del robot (ruote, telaio, bracci) e aggiorna le matrici mondo di
// ognuna, costoso per essere chiamato ogni frame mentre la palla è FREE. Il
// raggio è ampiamente più largo del vero ingombro del robot (~60-70 unità +
// margine): scarta solo i casi ovviamente lontani, non introduce falsi
// negativi vicino al bordo reale
const PICKUP_COARSE_RADIUS = 300
function checkForPickup() {
  if (pickupPhase !== 'idle' || !basketball || basketball.state !== BallState.FREE) return
  if (manipulator.state !== RobotState.NO_BALL) return
  if (manipulator.root.position.distanceToSquared(basketball.position) > PICKUP_COARSE_RADIUS * PICKUP_COARSE_RADIUS) return
  scratchRobotBox.setFromObject(manipulator.root)
  scratchRobotBox.expandByScalar(BALL_RADIUS + PICKUP_MARGIN)
  if (!scratchRobotBox.containsPoint(basketball.position)) return
  pickupPhase = 'active'
  pickupPhaseT = 0
}

// la palla si blocca SUBITO alla paletta (primo frame, nessun lerp da dove
// si trovava) — se restasse ancora "libera" per la durata del pickup
// poteva sembrare sfuggire mentre rimbalzava via; il braccio fa comunque un
// piccolo "tuffo" di raccolta (0→1→0, non 0→1) come flourish visivo, ma la
// presa è immediata. Il tuffo torna a 0 PRIMA che finisca il pickup apposta:
// il palleggio automatico che riprende subito dopo parte anche lui da
// dribbleArmEase=0 ('push' pulito) — senza questo la mano sarebbe rimasta
// ad ampiezza piena (1.0) fino all'ultimo frame, con uno scatto a 0 nel
// momento esatto dell'aggancio invece di un passaggio smooth
function updatePickup(delta) {
  pickupPhaseT += delta
  const t = Math.min(pickupPhaseT / PICKUP_DURATION, 1)
  const dipT = Math.sin(t * Math.PI) // 0 -> 1 -> 0, non 0 -> 1

  dribbleArmEase = dipT
  const [pickupElbowAmplitude, pickupLink1Amplitude] = dribbleAmplitudesRad()
  manipulator.controls.setDribbleOffsets(dribbleArmEase * pickupElbowAmplitude, dribbleArmEase * pickupLink1Amplitude)

  // ballRestPoint (non paddle/paddleCenter): quello è il centro piatto
  // usato dal palleggio automatico, sta sulla superficie della paletta e
  // causava compenetrazione visiva — ballRestPoint è il punto corretto già
  // usato da HANDLING/tiro, spostato fuori lungo la convergenza della V
  manipulator.ballRestPoint.updateWorldMatrix(true, false)
  manipulator.ballRestPoint.getWorldPosition(paddleWorldPos)
  basketball.position.copy(paddleWorldPos)

  if (t >= 1) {
    pickupPhase = 'idle'
    basketball.setState(BallState.HANDLED)
    manipulator.setState(RobotState.DRIBBLE)
    resetDribbleState()
    // senza questo resta true dal tiro che ha liberato la palla: animate()
    // instrada su updateShotFlight finché manipulator.state===NO_BALL O
    // shootReleased — con questo flag ancora true il palleggio non riparte
    // mai anche se lo stato è già tornato DRIBBLE
    shootReleased = false
  }
}

// Animazione di tiro: PRIMA di tutto (ogni frame, windup e release) il
// gomito insegue il pitch della camera (SHOOT_ELBOW_AIM_COUPLING, stessa
// formula già presente ma disattivata per il Play normale) — l'end effector
// punta dove punta la mira, non in una direzione fissa scollegata dal
// crosshair. Sopra questa base, 'windup' porta gomito/link1 ulteriormente
// all'indietro (il gomito più di link1, vedi SHOOT_ELBOW_WINDUP_DEG/SHOOT_
// LINK1_WINDUP_DEG), poi 'release' li riporta in avanti verso la posa di
// rilascio — il gomito parte con un piccolo ritardo (SHOOT_RELEASE_LEAD)
// rispetto a link1 e copre tutto il suo raggio nel tempo RIMANENTE, quindi
// con velocità angolare maggiore: il "colpo di frusta" prossimale→distale di
// un lancio vero. In parallelo la paletta apre la sua V verso l'alto/
// orizzontale (SHOOT_TILT_TARGET) invece che verso il basso, sincronizzata
// sulla stessa 't' di link1. Infine 'recover' interpola tutto (gomito,
// link1, aim, tilt, presa) verso una posa neutra, invece di scattarci sopra
// di colpo — 'tutte le animazioni interpolate', nessun salto secco
function updateShootAnimation(delta) {
  shootPhaseT += delta
  const elbowWindupTarget = THREE.MathUtils.degToRad(SHOOT_ELBOW_WINDUP_DEG)
  const link1WindupTarget = THREE.MathUtils.degToRad(SHOOT_LINK1_WINDUP_DEG)
  // aggancio elbow→pitch camera: stessa formula di ELBOW_PITCH_COUPLING nel
  // Play normale (lì disattivata), qui a piena intensità di default — usa
  // orbitPitch (il bersaglio "vero" della mira, non un valore intermedio)
  const aimPitchOffset = computeAimPitchOffset()

  // countdown SEMPRE attivo (non solo durante 'release'): se SHOOT_STATE_
  // TRANSITION_DELAY supera il tempo che resta alla fase 'release' dopo
  // SHOOT_RELEASE_POINT (caso comune: 0.35s di ritardo contro appena 0.06s
  // di 'release' rimanenti), la fase passa a 'recover' col timer ancora a
  // metà — se il countdown vivesse solo dentro il branch 'release' si
  // blocca lì per sempre e NO_BALL/basketball FREE non scattano mai
  if (shootReleased && shootStateTransitionTimer > 0) {
    shootStateTransitionTimer -= delta
    if (shootStateTransitionTimer <= 0) {
      manipulator.setState(RobotState.NO_BALL)
      basketball.setState(BallState.FREE)
      // stessa sicurezza di releaseBallHandling(): ORBIT_PITCH_MIN_HANDLING
      // (fino a -0.9) è valido solo in HANDLING — appena si esce da lì la
      // camera passa alla formula normale (orbita+lookAt), che con un
      // pitch così estremo manda la camera sotto il pavimento (mai
      // riclampata altrimenti, il mousemove lo fa solo al prossimo
      // movimento del mouse)
      orbitPitch = THREE.MathUtils.clamp(orbitPitch, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX)
    }
  }

  if (shootPhase === 'windup') {
    const t = SHOOT_EASE(Math.min(shootPhaseT / SHOOT_WINDUP_DURATION, 1))
    const elbowOffset = THREE.MathUtils.lerp(shootStartElbowOffset, elbowWindupTarget, t)
    const link1Offset = THREE.MathUtils.lerp(shootStartLink1Offset, link1WindupTarget, t)
    manipulator.controls.setAimPitch(aimPitchOffset)
    manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
    // tre fasi, non due: orizzontale (shootStartTilt, ≈0 da HANDLING) → su
    // (SHOOT_TILT_WINDUP_PEAK, oltre il piatto) qui nel windup, poi
    // 'release' la riporta da lì verso la posa inclinata di rilascio
    manipulator.controls.setShootTilt(THREE.MathUtils.lerp(shootStartTilt, SHOOT_TILT_WINDUP_PEAK, t))
    if (shootPhaseT >= SHOOT_WINDUP_DURATION) { shootPhase = 'release'; shootPhaseT = 0 }
  } else if (shootPhase === 'release') {
    const t = Math.min(shootPhaseT / SHOOT_RELEASE_DURATION, 1)
    const easeT = SHOOT_EASE(t)
    const link1Offset = THREE.MathUtils.lerp(link1WindupTarget, THREE.MathUtils.degToRad(SHOOT_LINK1_RELEASE_DEG), easeT)
    // il gomito parte con un ritardo (SHOOT_RELEASE_LEAD), poi copre tutto
    // il suo raggio nel tempo rimanente — stessa durata totale di link1 ma
    // partenza posticipata = velocità angolare maggiore
    const elbowT = SHOOT_EASE(THREE.MathUtils.clamp((t - SHOOT_RELEASE_LEAD) / (1 - SHOOT_RELEASE_LEAD), 0, 1))
    const elbowOffset = THREE.MathUtils.lerp(elbowWindupTarget, THREE.MathUtils.degToRad(SHOOT_ELBOW_RELEASE_DEG), elbowT)
    manipulator.controls.setAimPitch(aimPitchOffset)
    manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
    // dal picco 'su' del windup verso la posa inclinata di rilascio, in
    // sincrono con link1 (stessa easeT) — non da shootStartTilt (quello era
    // il punto di partenza del windup, non di questa fase)
    manipulator.controls.setShootTilt(THREE.MathUtils.lerp(SHOOT_TILT_WINDUP_PEAK, SHOOT_TILT_TARGET, easeT))

    if (!shootReleased && t >= SHOOT_RELEASE_POINT) {
      getShotDirection(shotVelocity).multiplyScalar(getEffectiveShotSpeed(manipulator.root.position))
      shotWasInsideArc = isInsideThreePointArc(manipulator.root.position)
      shootReleased = true
      sfx.playShoot()
      // NON manipulator.setState(NO_BALL) qui: farlo nello STESSO istante in
      // cui parte il volo sgancia subito la camera dalla vista libera di
      // HANDLING (isHandling in animate() diventa falso il prossimo frame),
      // quindi il crosshair salta via proprio mentre la palla lascia la
      // mano — sembra che il tiro punti "da un'altra parte" anche se la
      // direzione catturata sopra è corretta. Il cambio di stato vero
      // (camera + velocità dimezzata) parte solo dopo SHOOT_STATE_TRANSITION_
      // DELAY secondi, per sicurezza — updateShotFlight nel frattempo parte
      // comunque (vedi guardia su shootReleased in animate())
      shootStateTransitionTimer = SHOOT_STATE_TRANSITION_DELAY
    }
    if (shootPhaseT >= SHOOT_RELEASE_DURATION) {
      shootPhase = 'recover'
      shootPhaseT = 0
      shootRecoverStartAimPitch = aimPitchOffset
    }
  } else { // 'recover'
    const t = SHOOT_EASE(Math.min(shootPhaseT / SHOOT_RECOVER_DURATION, 1))
    const elbowOffset = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(SHOOT_ELBOW_RELEASE_DEG), 0, t)
    const link1Offset = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(SHOOT_LINK1_RELEASE_DEG), 0, t)
    const recoverAimPitch = THREE.MathUtils.lerp(shootRecoverStartAimPitch, 0, t)
    const tiltOffset = THREE.MathUtils.lerp(SHOOT_TILT_TARGET, 0, t)
    const gripOffset = THREE.MathUtils.lerp(shootStartGrip, 0, t)
    manipulator.controls.setAimPitch(recoverAimPitch)
    manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
    manipulator.controls.setShootTilt(tiltOffset)
    manipulator.controls.setGrip(gripOffset)
    handlingGrip = gripOffset

    if (shootPhaseT >= SHOOT_RECOVER_DURATION) {
      shootPhase = 'idle'
      // dribbleArmEase (uno scalare unico) non può rappresentare le pose
      // indipendenti usate sopra: riparte da zero, ma solo ORA che la posa
      // VISIVA è già a 0 (fine del lerp appena sopra) — nessuno scatto,
      // dribbleArmEase=0 produce esattamente la stessa posa già raggiunta
      dribbleArmEase = 0
    }
  }

  // finché la palla non è ancora partita resta incollata alla paletta,
  // stessa logica di updateHandling/updateDribble
  if (!shootReleased) {
    // stesso motivo di updateHandling: manipulator.ballRestPoint segue il
    // vero punto di convergenza della V, corretto per qualunque tilt
    manipulator.ballRestPoint.updateWorldMatrix(true, false)
    manipulator.ballRestPoint.getWorldPosition(paddleWorldPos)
    basketball.position.copy(paddleWorldPos)
  }
}

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

const menuOverlayEl = document.getElementById('menu-overlay')
// #hint parte già nascosto via style inline nell'HTML (non qui): questa riga
// girerebbe DOPO tutto il resto del setup di scena/robot/luci più sopra,
// lasciando un frame (o più) in cui "Click per entrare" lampeggia visibile
// prima di essere nascosto — nascosto da subito nel markup, nessun flash
function showMenuScreen(id) {
  document.querySelectorAll('.menu-screen').forEach(el => el.classList.toggle('active', el.id === id))
}
document.querySelectorAll('[data-goto]').forEach(el => {
  el.addEventListener('click', () => showMenuScreen(el.dataset.goto))
})

// OPTIONS è raggiungibile sia dal main menu (menu-main) sia dalla pausa in
// partita (menu-pause) — il tasto indietro deve tornare da dove si è
// entrati, non sempre allo stesso posto fisso
let optionsReturnScreen = 'menu-main'
document.querySelectorAll('[data-goto-options-from]').forEach(el => {
  el.addEventListener('click', () => {
    optionsReturnScreen = el.dataset.gotoOptionsFrom
    showMenuScreen('menu-options')
  })
})
document.getElementById('menu-options-back-btn').addEventListener('click', () => showMenuScreen(optionsReturnScreen))

// --- Pausa in partita (ESC) ---
// idempotente (guardia su mode==='menu') perché ci sono DUE modi in cui
// arriva: (1) il keydown Escape qui sotto, se il pointer non era già
// agganciato; (2) l'evento 'unlock' più in alto, se lo era — col pointer
// agganciato il browser stesso intercetta Esc per sganciarlo PRIMA che il
// keydown arrivi alla pagina (comportamento nativo della Pointer Lock API,
// non evitabile): la prima pressione sganciava solo il pointer (mostrando
// il vecchio hint "Click per entrare"), la pausa vera scattava solo alla
// seconda pressione. Aprirla anche da 'unlock' copre il caso mancante
function openPauseMenu() {
  if (mode === 'menu') return
  mode = 'menu'
  menuOverlayEl.style.display = 'flex'
  showMenuScreen('menu-pause')
  hint.style.display = 'none' // sovrascrive quanto fatto da 'unlock' (vedi sopra) — c'è un vero menu ora
}
document.addEventListener('keydown', e => {
  if (e.code !== 'Escape' || (mode !== 'play' && mode !== 'spectate')) return
  if (controls.isLocked) controls.unlock() // farà scattare anche il listener 'unlock' sopra, openPauseMenu() è idempotente
  else openPauseMenu()
})
document.getElementById('menu-back-to-main-btn').addEventListener('click', () => {
  // reset: punteggio a zero e ritorno all'inizio del flusso di scelta —
  // gameMode/timeOfDay restano quelli scelti l'ultima volta (li si può
  // ricambiare rifacendo il flusso, non serve azzerarli anche loro)
  addScore(-score)
  showMenuScreen('menu-main')
})

// comune a START (primo ingresso) e BACK TO GAME (ripresa da pausa): nasconde
// l'overlay ed entra in 'play'. Il primo ingresso ha in più dashPanel/
// crosshair da smostrare una tantum (nascosti di default nell'HTML finché
// non si è mai entrati in play) — la pausa non li tocca mai, restano già
// visibili da quando sono stati sbloccati la prima volta.
// controls.lock() diretto (non più "Click per entrare" a schermo): il
// click sul bottone STESSO è già il gesto utente richiesto dalla Pointer
// Lock API, non serve un secondo click sul canvas — l'evento 'lock' che
// scatta nasconde #hint da solo (vedi il listener più in alto)
function enterPlayMode() {
  menuOverlayEl.style.display = 'none'
  mode = 'play'
  modeIndicator.textContent = `MODE: ${mode.toUpperCase()}`
  controls.lock()
}
// funzione a parte (non solo dentro il listener) perché servirà anche da
// altre varianti più avanti (es. altri punti d'ingresso alla pausa)
function resumeGame() {
  enterPlayMode()
}
document.getElementById('menu-back-to-game-btn').addEventListener('click', resumeGame)

// solo PRACTICE ha data-gamemode (1V1/3V3 sono bottoni disabled senza
// l'attributo, questo querySelectorAll non li include nemmeno) — nessun
// ramo per "quale gamemode" serve finché ce n'è solo una vera
document.querySelectorAll('[data-gamemode]').forEach(el => {
  el.addEventListener('click', () => {
    gameMode = GameMode.PRACTICE
    showMenuScreen('menu-robot')
  })
})

document.querySelectorAll('[data-robot]').forEach(el => {
  // solo MANIPULATOR è selezionabile per ora (le altre card non hanno
  // data-robot, quindi questo querySelectorAll non le include nemmeno)
  el.addEventListener('click', () => showMenuScreen('menu-timeofday'))
})

const timeOfDayCards = document.querySelectorAll('[data-timeofday]')
const menuStartBtn = document.getElementById('menu-start-btn')
timeOfDayCards.forEach(el => {
  el.addEventListener('click', () => {
    // solo scelta + preview (camera ancora in orbita isometrica, mode
    // resta 'menu') — niente cambio di schermata: il tasto START compare
    // sotto le card, nella STESSA schermata, non se ne apre un'altra
    const timeMap = { sunrise: TimeOfDay.SUNRISE, day: TimeOfDay.DAY, sunset: TimeOfDay.SUNSET, night: TimeOfDay.NIGHT }
    timeOfDay = timeMap[el.dataset.timeofday]
    applyTimeOfDayPreset(timeOfDay)
    timeOfDayCards.forEach(card => card.classList.toggle('selected', card === el))
    menuStartBtn.classList.remove('hidden')
  })
})

document.getElementById('menu-start-btn').addEventListener('click', () => {
  // dashPanel/crosshair: nascosti di default nell'HTML finché non si entra
  // MAI in play — smostrati una tantum qui, la pausa/ripresa successive
  // (enterPlayMode/resumeGame) non li toccano più, restano già sbloccati
  dashPanel.classList.remove('hidden')
  crosshair.classList.remove('hidden')
  enterPlayMode()
})

// --- Main Menu: Options (grafica) ---
document.getElementById('opt-ssao').addEventListener('change', e => { ssaoPass.enabled = e.target.checked })
document.getElementById('opt-shadows').addEventListener('change', e => {
  // renderer.shadowMap.enabled da solo non basta: gli shader dei materiali
  // già compilati con lo shadow branch attivo restano "congelati" com'erano
  // (gotcha noto di three.js) — serve anche spegnere castShadow sulla luce
  // vera e forzare la ricompilazione di ogni materiale in scena
  const enabled = e.target.checked
  renderer.shadowMap.enabled = enabled
  sun.castShadow = enabled
  scene.traverse(obj => {
    if (!obj.material) return
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
    materials.forEach(m => { m.needsUpdate = true })
  })
})
document.getElementById('opt-volume').addEventListener('input', e => { sfx.setMasterVolume(Number(e.target.value)) })
document.getElementById('opt-fov').addEventListener('input', e => {
  camera.fov = Number(e.target.value)
  camera.updateProjectionMatrix()
})

// --- Main Menu: anteprima robot live (card MANIPULATOR) ---
// stessa tecnica di isometric_racer (src/ui/carPreview.js, vedi README):
// renderer offscreen condiviso, camera inquadrata sul bounding box reale
// del modello (non una foto/asset statico — il robot è procedurale, non
// ha senso avere uno screenshot pre-fatto), un render singolo convertito
// in PNG e inserito come <img> nella card. Nessuna rotazione continua.
function renderRobotCardPreview() {
  const previewSize = 200
  const previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  previewRenderer.setSize(previewSize, previewSize)
  previewRenderer.setPixelRatio(1)
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace
  previewRenderer.toneMapping = THREE.ACESFilmicToneMapping

  const previewScene = new THREE.Scene()
  previewScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
  const previewKeyLight = new THREE.DirectionalLight(0xffffff, 1.8)
  previewKeyLight.position.set(1, 1.2, 1)
  previewScene.add(previewKeyLight)

  const previewCamera = new THREE.PerspectiveCamera(35, 1, 1, 10000)

  const previewRobot = new ManipulatorRobot()
  previewRobot.controls.manipulatorScale(45)
  previewScene.add(previewRobot.root)

  // inquadra il bounding box reale: distanza minima per contenere tutti
  // gli 8 angoli nel frustum, vista di 3/4 leggermente dall'alto
  const box = new THREE.Box3().setFromObject(previewRobot.root)
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

  previewRenderer.render(previewScene, previewCamera)
  const dataUrl = previewRenderer.domElement.toDataURL('image/png')

  const img = document.createElement('img')
  img.src = dataUrl
  document.getElementById('robot-preview-manipulator').replaceChildren(img)

  // pulizia: la scena offscreen non serve più dopo lo snapshot
  previewRenderer.dispose()
}
renderRobotCardPreview()

function animate() {
  requestAnimationFrame(animate)
  const delta = Math.min(clock.getDelta(), 0.1)

  // mentre il main menu è aperto: solo l'orbita lenta della camera, niente
  // altro (palleggio/fisica/input di gioco fermi, il campo è "vuoto" per
  // costruzione in questa fase) — poi esce subito, non gira il resto del loop
  if (mode === 'menu') {
    updateMenuCameraOrbit(delta)
    composer.render()
    return
  }

  if (mode === 'spectate' && controls.isLocked) {
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

  if (mode === 'play') {
    // R1 (base del manipolatore) segue l'orbit yaw della camera: stessa
    // convenzione sin/cos usata per camForward/robotFacing, quindi a
    // orbitYaw=0 la base è a riposo (nessuna rotazione extra) e il
    // braccio punta già "in avanti" di default. Indipendente dal
    // movimento: si mira col mouse, ci si muove con WASD
    const isHandlingNow = manipulator.state === RobotState.HANDLING
    const armYawLerpFactor = 1 - Math.exp(-HANDLING_TRANSITION_SPEED * delta)
    currentArmYawOffsetDeg += ((isHandlingNow ? 0 : ARM_YAW_OFFSET_DEG) - currentArmYawOffsetDeg) * armYawLerpFactor
    manipulator.controls.setAimYaw(orbitYaw + THREE.MathUtils.degToRad(currentArmYawOffsetDeg))
    // guardare su/giù (orbitPitch) alza/abbassa di poco l'end effector,
    // ruotando il gomito e non l'ultimo link — coupling piccolo apposta.
    // setAimPitch gestisce internamente anche il rilivellamento della
    // paletta (la cinematica gomito+polso resta dentro manipulator.js)
    manipulator.controls.setAimPitch((orbitPitch - ORBIT_PITCH_REST) * ELBOW_PITCH_COUPLING)

    // assi camera flattened sul piano orizzontale (solo orbitYaw, non
    // pitch) così W spinge sempre in avanti sul terreno, non in diagonale
    // verso l'alto/basso quando la camera è inclinata
    angleToForward(orbitYaw, camForward)
    rotateRight(camForward, camRightFlat)

    moveVec.set(0, 0, 0)
    if (keys['KeyW']) moveVec.add(camForward)
    if (keys['KeyS']) moveVec.sub(camForward)
    if (keys['KeyD']) moveVec.add(camRightFlat)
    if (keys['KeyA']) moveVec.sub(camRightFlat)

    if (moveVec.lengthSq() > 0) {
      moveVec.normalize()
      robotFacing = Math.atan2(moveVec.x, moveVec.z)
      manipulator.move(moveVec, delta)
    }

    // dash: scatto breve nella direzione di marcia, si somma al movimento
    // WASD normale se tenuto premuto durante il burst
    if (dashCooldown > 0) dashCooldown = Math.max(0, dashCooldown - delta)
    if (dashTimeRemaining > 0) {
      manipulator.root.position.addScaledVector(dashDirection, manipulator.speed * DASH_SPEED_MULTIPLIER * delta)
      dashTimeRemaining = Math.max(0, dashTimeRemaining - delta)
    }
    const dashReady = dashCooldown <= 0
    dashBarFill.style.width = `${(1 - dashCooldown / DASH_COOLDOWN_TIME) * 100}%`
    dashBarFill.classList.toggle('ready', dashReady)

    // il toro giace nel piano XY (asse/perno lungo Z), quindi la sua
    // direzione di rotolamento a riposo è l'asse X locale, non Z — va
    // compensata con un offset di -90° perché si allinei al movimento.
    // Interpolata (non applicata di scatto) per una sterzata rapida ma
    // animata invece di un flip istantaneo
    const wheelsTargetAngle = robotFacing - Math.PI / 2
    wheelsCurrentAngle = lerpAngle(wheelsCurrentAngle, wheelsTargetAngle, 1 - Math.exp(-WHEEL_TURN_SPEED * delta))
    manipulator.controls.setWheelsYaw(wheelsCurrentAngle)

    // zoom in mentre si tiene il tasto destro (RobotState.HANDLING):
    // stessa orbita, raggio interpolato invece di scattare di colpo, più un
    // piccolo rialzo di quota (stesso target/lerp) per vedere il canestro
    // invece che il pavimento da vicino
    const isHandling = manipulator.state === RobotState.HANDLING
    const zoomLerpFactor = 1 - Math.exp(-CHASE_DISTANCE_LERP_SPEED * delta)
    const zoomDistanceLerpFactor = 1 - Math.exp(-CHASE_DISTANCE_ZOOM_LERP_SPEED * delta)
    currentChaseDistance += ((isHandling ? HANDLING_CHASE_DISTANCE : CHASE_DISTANCE) - currentChaseDistance) * zoomDistanceLerpFactor
    currentHeightBoost += ((isHandling ? HANDLING_HEIGHT_BOOST : 0) - currentHeightBoost) * zoomLerpFactor

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
      // scendere nell'inquadratura. Bonus: pitch e currentHeightBoost non si
      // "combattono" più — la quota è solo un'aggiunta fissa alla posizione,
      // il pitch non tocca più la posizione, solo l'orientamento
      targetCameraPos.set(
        robotPos.x - camForward.x * currentChaseDistance + camRightFlat.x * HANDLING_CAMERA_SIDE_OFFSET,
        robotPos.y + LOOK_HEIGHT + currentHeightBoost,
        robotPos.z - camForward.z * currentChaseDistance + camRightFlat.z * HANDLING_CAMERA_SIDE_OFFSET
      )
      // orbitPitch diretto, senza un secondo lerp qui sopra: era un doppio
      // smoothing in cascata con camera.quaternion.slerp sotto (due lag
      // esponenziali indipendenti sullo stesso segnale, a velocità diverse)
      // — per input veloci (flick del mouse) il risultato è imprevedibile
      // (scatti in avanti seguiti da correzioni all'indietro). Un solo
      // stadio di smoothing (lo slerp sotto, che esiste già apposta per
      // azzerare lo scatto tra formula e formula) è sufficiente
      scratchEuler.set(-orbitPitch, orbitYaw + Math.PI, 0, 'YXZ')
      targetCameraQuat.setFromEuler(scratchEuler)
    } else {
      // comportamento originale (DRIBBLE/Play normale): camera in orbita,
      // guarda sempre il robot — invariato
      const horizDist = currentChaseDistance * Math.cos(orbitPitch)
      targetCameraPos.set(
        robotPos.x - camForward.x * horizDist,
        robotPos.y + LOOK_HEIGHT + currentChaseDistance * Math.sin(orbitPitch),
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
  // shootStateTransitionTimer > 0 ANCHE con shootPhase già 'idle': il
  // countdown (0.35s) può superare quanto resta di release+recover — senza
  // continuare a chiamare la funzione qui, il countdown si blocca a metà e
  // NO_BALL/basketball FREE non scattano mai
  if (basketball && (shootPhase !== 'idle' || shootStateTransitionTimer > 0)) updateShootAnimation(delta)

  if (basketball) {
    // shootReleased (non solo manipulator.state === NO_BALL): lo stato vero
    // e proprio ora cambia con un piccolo ritardo dopo il rilascio (vedi
    // SHOOT_STATE_TRANSITION_DELAY in updateShootAnimation) — il volo fisico
    // della palla deve però partire SUBITO al rilascio, non aspettare
    if (pickupPhase === 'active') {
      updatePickup(delta)
    } else if (manipulator.state === RobotState.NO_BALL || shootReleased) {
      updateShotFlight(delta)
      checkForPickup()
    } else if (shootPhase === 'idle') {
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

  // preview di traiettoria: solo mentre si mira davvero (HANDLING, nessuna
  // animazione di tiro già in corso, palla non ancora rilasciata). Serve
  // anche !shootReleased: lo stato passa a NO_BALL con un piccolo ritardo
  // dopo il rilascio vero (SHOOT_STATE_TRANSITION_DELAY), quindi c'è una
  // finestra in cui manipulator.state è ANCORA HANDLING e shootPhase è GIÀ
  // tornato 'idle' (fine di 'recover') — senza questo controllo la linea si
  // riattaccava per un istante alla palla già in volo/atterrata
  const showTrajectory = basketball && manipulator.state === RobotState.HANDLING && shootPhase === 'idle' && !shootReleased
  if (showTrajectory) updateTrajectoryPreview()
  else hideTrajectoryPreview()

  if (!cameraPanel.classList.contains('hidden')) {
    camReadouts.forEach(([el, get]) => { el.textContent = get() })
  }

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
