import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { createManipulatorRobot } from './robots/manipulator.js'

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
  const lamp = new THREE.PointLight(0xfff2c0, 200000, 400, 2)
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
    // asta lampione: usa il materiale "floor.1", condiviso col pavimento
    // (per questo sembrava "uguale al pavimento") — va clonato prima di
    // ricolorarlo, altrimenti si tingerebbe anche il pavimento stesso.
    // Nome senza punto: GLTFLoader sanitizza i nomi nodo rimuovendo
    // caratteri riservati per i path di animazione (. : / [ ]), quindi
    // "Cylinder_5_floor.1_0" nel GLTF diventa "Cylinder_5_floor1_0" qui
    if (child.name === 'Cylinder_5_floor1_0') {
      child.material = child.material.clone()
      child.material.color.set(0x2b2b2e)
    }
    // pallone incluso nel modello del campo (unico mesh con texture
    // immagine vera, Mat.3_diffuse.jpeg) — rimosso, ne usiamo uno dedicato
    if (child.name === 'Sphere_Mat3_0') {
      child.parent.remove(child)
    }
  })
  scene.add(gltf.scene)
})

// --- Pallone (modello dedicato: color map + normal map + metallic/roughness) ---
// let (non const): regolabili a runtime dal pannello debug (Basketball/
// Manipulator Animation → Dribble), dichiarate qui perché lette già dal
// setup del debug menu più sotto, prima del blocco fisica nel render loop
let BALL_RADIUS = 15 // unità mondo (~cm-scale) — sfera sorgente ha raggio 1
// const (non più regolabili da debug): valori fissati dopo il tuning
const BALL_GRAVITY = 820       // unità/s² (scena ≈ cm-scale), non più il valore g reale
const BALL_BOUNCE_SPEED = 415  // velocità impressa ad ogni rimbalzo
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
let basketball = null
loader.load('./models/basketball_ball/scene.gltf', gltf => {
  gltf.scene.scale.setScalar(BALL_RADIUS)
  gltf.scene.traverse(child => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
  })
  basketball = gltf.scene
  scene.add(basketball)
})

// --- Robot (Step 4: solo modello statico, no animazione/movimento ancora) ---
const manipulator = createManipulatorRobot()
// unità locali (~1-4) → scala mondo: lampioni a Y=268, hoop reg. ~305cm,
// unità mondo ≈ 1cm → tarato a 45 dopo test visivi via slider debug (P).
// Passa da controls.manipulatorScale (non root.scale diretto) così lo
// stato tracciato resta coerente con "Copy config"
manipulator.controls.manipulatorScale(45)
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
renderer.domElement.addEventListener('click', () => controls.lock())
controls.addEventListener('lock', () => hint.style.display = 'none')
controls.addEventListener('unlock', () => hint.style.display = '')

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
// placeholder: nessuna animazione di tiro implementata ancora
createToggleSection(manipulatorAnimation, 'Shoot')
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
    ballOffsetForward: BALL_OFFSET_FORWARD, ballOffsetSide: BALL_OFFSET_SIDE, ballOffsetDown: BALL_OFFSET_DOWN,
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

let mode = 'spectate'
const modeIndicator = document.getElementById('mode-indicator')
let robotFacing = 0 // yaw ruote/robot (rad), persiste quando fermo
const moveVec = new THREE.Vector3()
const camForward = new THREE.Vector3()
const camRightFlat = new THREE.Vector3()
const ROBOT_SPEED = 200
const CHASE_DISTANCE = 350
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
const ORBIT_PITCH_MAX = 1.4
// coupling pitch camera → gomito: guardare su/giù alza/abbassa l'end
// effector di poco, non tantissimo — fattore piccolo apposta
const ELBOW_PITCH_COUPLING = 0.2

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
  if (e.code !== 'KeyM' || e.repeat) return
  mode = mode === 'spectate' ? 'play' : 'spectate'
  modeIndicator.textContent = `MODE: ${mode.toUpperCase()}`
  dashPanel.classList.toggle('hidden', mode !== 'play')
  crosshair.classList.toggle('hidden', mode !== 'play')
  // forza un nuovo click-per-entrare nel cambio modalità, per evitare
  // che un delta mouse residuo salti da uno schema di controllo all'altro
  if (controls.isLocked) controls.unlock()
})

document.addEventListener('mousemove', e => {
  if (mode !== 'play' || !controls.isLocked) return
  orbitYaw -= e.movementX * ORBIT_SENSITIVITY
  orbitPitch = THREE.MathUtils.clamp(
    orbitPitch + e.movementY * ORBIT_SENSITIVITY,
    ORBIT_PITCH_MIN,
    ORBIT_PITCH_MAX
  )
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
// assi locali della paletta trasformati in direzioni mondo ogni frame
// (BALL_OFFSET_* dichiarate più sopra, tarabili da debug)
const paddleForwardDir = new THREE.Vector3()
const paddleSideDir = new THREE.Vector3()
// costante (mai riassegnato): "giù" è sempre il basso reale del mondo,
// non dipende da nessun angolo — impostato una volta qui invece che ad
// ogni passo fisso del palleggio (120/s) dentro updateDribble()
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
  const elbowAmplitude = THREE.MathUtils.degToRad(DRIBBLE_ELBOW_AMPLITUDE_DEG)
  const link1Amplitude = THREE.MathUtils.degToRad(DRIBBLE_LINK1_AMPLITUDE_DEG)
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
  // rilevante, Down è sempre il basso reale del mondo
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

function animate() {
  requestAnimationFrame(animate)
  const delta = Math.min(clock.getDelta(), 0.1)

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
    manipulator.controls.setAimYaw(orbitYaw + THREE.MathUtils.degToRad(ARM_YAW_OFFSET_DEG))
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
      manipulator.root.position.addScaledVector(moveVec, ROBOT_SPEED * delta)
    }

    // dash: scatto breve nella direzione di marcia, si somma al movimento
    // WASD normale se tenuto premuto durante il burst
    if (dashCooldown > 0) dashCooldown = Math.max(0, dashCooldown - delta)
    if (dashTimeRemaining > 0) {
      manipulator.root.position.addScaledVector(dashDirection, ROBOT_SPEED * DASH_SPEED_MULTIPLIER * delta)
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

    const robotPos = manipulator.root.position
    // camForward è già stato calcolato sopra per il movimento: riusato qui
    // invece di un terzo sin/cos(orbitYaw) scritto a mano
    const horizDist = CHASE_DISTANCE * Math.cos(orbitPitch)
    camera.position.set(
      robotPos.x - camForward.x * horizDist,
      robotPos.y + LOOK_HEIGHT + CHASE_DISTANCE * Math.sin(orbitPitch),
      robotPos.z - camForward.z * horizDist
    )
    camera.lookAt(robotPos.x, robotPos.y + LOOK_HEIGHT, robotPos.z)
  }

  if (basketball) {
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
