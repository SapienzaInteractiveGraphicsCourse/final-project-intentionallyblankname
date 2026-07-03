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
  })
  scene.add(gltf.scene)
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
// posa di riposo del gomito, catturata prima di qualunque modifica: serve
// come riferimento neutro per il coupling pitch-camera → gomito in Play
const ELBOW_REST_X = manipulator.joints.elbow.rotation.x

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
const scaleSlider = document.getElementById('debug-scale-slider')
const scaleValue = document.getElementById('debug-scale-value')

scaleSlider.value = manipulator.root.scale.x
scaleValue.textContent = manipulator.root.scale.x

scaleSlider.addEventListener('input', () => {
  const s = parseFloat(scaleSlider.value)
  manipulator.controls.manipulatorScale(s)
  scaleValue.textContent = s
})

// Sezione "Manipulator Config": un bottone per componente (ruote in
// gruppo, disco, link1, link2), ognuno apre i propri slider. Generata da
// JS invece che duplicare il markup 4 volte in HTML.
function addComponentSection(container, label, sliders) {
  const btn = document.createElement('button')
  btn.textContent = `${label} ▸`
  const panel = document.createElement('div')
  panel.className = 'component-panel hidden'

  sliders.forEach(({ name, min, max, step, value, onChange }) => {
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

    panel.append(lbl, input)
  })

  btn.addEventListener('click', () => panel.classList.toggle('hidden'))
  container.append(btn, panel)
}

const manipulatorConfigBtn = document.getElementById('manipulator-config-btn')
const manipulatorConfig = document.getElementById('manipulator-config')
manipulatorConfigBtn.addEventListener('click', () => manipulatorConfig.classList.toggle('hidden'))

const cfg = manipulator.getConfig()
addComponentSection(manipulatorConfig, 'Wheels', [
  { name: 'Scale', min: 0.2, max: 3, step: 0.05, value: cfg.wheelsScale, onChange: manipulator.controls.wheelsScale },
])
addComponentSection(manipulatorConfig, 'Disc', [
  { name: 'Scale', min: 0.2, max: 3, step: 0.05, value: cfg.discScale, onChange: manipulator.controls.discScale },
  { name: 'Radius', min: 0.5, max: 3, step: 0.05, value: cfg.discRadius, onChange: manipulator.controls.discRadius },
])
addComponentSection(manipulatorConfig, 'Link 1', [
  { name: 'Scale', min: 0.2, max: 3, step: 0.05, value: cfg.link1Scale, onChange: manipulator.controls.link1Scale },
  { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link1Length, onChange: manipulator.controls.link1Length },
  { name: 'Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link1Thickness, onChange: manipulator.controls.link1Thickness },
])
addComponentSection(manipulatorConfig, 'Link 2', [
  { name: 'Scale', min: 0.2, max: 3, step: 0.05, value: cfg.link2Scale, onChange: manipulator.controls.link2Scale },
  { name: 'Length', min: 0.3, max: 4, step: 0.05, value: cfg.link2Length, onChange: manipulator.controls.link2Length },
  { name: 'Base Thickness', min: 0.05, max: 1, step: 0.01, value: cfg.link2Thickness, onChange: manipulator.controls.link2Thickness },
  { name: 'Tip Thickness', min: 0.02, max: 1, step: 0.01, value: cfg.link2TipThickness, onChange: manipulator.controls.link2TipThickness },
])
addComponentSection(manipulatorConfig, 'Base Joint (sfera)', [
  { name: 'Scale', min: 0.2, max: 3, step: 0.05, value: cfg.baseJointScale, onChange: manipulator.controls.baseJointScale },
])
addComponentSection(manipulatorConfig, 'Elbow Joint (sfera)', [
  { name: 'Scale', min: 0.2, max: 3, step: 0.05, value: cfg.elbowJointScale, onChange: manipulator.controls.elbowJointScale },
])
addComponentSection(manipulatorConfig, 'End Effector (sfera)', [
  { name: 'Scale', min: 0.2, max: 3, step: 0.05, value: cfg.endEffectorScale, onChange: manipulator.controls.endEffectorScale },
])

// "Copy config": serializza i parametri correnti pronti da incollare nel
// codice (stesso schema usato finora per hardcodare scala/spawn camera)
const copyConfigBtn = document.getElementById('copy-config-btn')
const copyConfigFeedback = document.getElementById('copy-config-feedback')
copyConfigBtn.addEventListener('click', async () => {
  const c = manipulator.getConfig()
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
const camX = document.getElementById('cam-x')
const camY = document.getElementById('cam-y')
const camZ = document.getElementById('cam-z')
const camPitch = document.getElementById('cam-pitch')
const camYaw = document.getElementById('cam-yaw')
const camRoll = document.getElementById('cam-roll')

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
const dashDirection = new THREE.Vector3()
const DASH_COOLDOWN_TIME = 4
const DASH_DURATION = 0.15
const DASH_SPEED_MULTIPLIER = 6
let dashCooldown = 0     // secondi rimanenti prima che il dash sia di nuovo pronto
let dashTimeRemaining = 0 // secondi rimanenti dello scatto in corso

document.addEventListener('keydown', e => {
  if (e.code !== 'ShiftLeft' || e.repeat || mode !== 'play' || dashCooldown > 0) return
  dashDirection.set(Math.sin(robotFacing), 0, Math.cos(robotFacing))
  dashTimeRemaining = DASH_DURATION
  dashCooldown = DASH_COOLDOWN_TIME
})

document.addEventListener('keydown', e => {
  if (e.code !== 'KeyM' || e.repeat) return
  mode = mode === 'spectate' ? 'play' : 'spectate'
  modeIndicator.textContent = `MODE: ${mode.toUpperCase()}`
  dashPanel.classList.toggle('hidden', mode !== 'play')
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

// --- Loop ---
const clock = new THREE.Clock()

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
    manipulator.joints.base.rotation.y = orbitYaw
    // guardare su/giù (orbitPitch) alza/abbassa di poco l'end effector,
    // ruotando il gomito e non l'ultimo link — coupling piccolo apposta
    manipulator.joints.elbow.rotation.x = ELBOW_REST_X + (orbitPitch - ORBIT_PITCH_REST) * ELBOW_PITCH_COUPLING
    // rilivella la paletta: la contro-rotazione iniziale era fissa, ma
    // ora il gomito si muove col pitch quindi va ricalcolata ogni frame
    manipulator.paddle.rotation.x = -(manipulator.joints.elbow.rotation.x + manipulator.joints.wrist.rotation.x)

    // assi camera flattened sul piano orizzontale (solo orbitYaw, non
    // pitch) così W spinge sempre in avanti sul terreno, non in diagonale
    // verso l'alto/basso quando la camera è inclinata
    camForward.set(Math.sin(orbitYaw), 0, Math.cos(orbitYaw))
    // cross(forward, up): stessa formula usata in Spectate (camDir × up),
    // il segno opposto qui prima puntava a sinistra invece che a destra
    camRightFlat.set(-Math.cos(orbitYaw), 0, Math.sin(orbitYaw))

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
    manipulator.wheelsGroup.rotation.y = wheelsCurrentAngle

    const robotPos = manipulator.root.position
    const horizDist = CHASE_DISTANCE * Math.cos(orbitPitch)
    camera.position.set(
      robotPos.x - Math.sin(orbitYaw) * horizDist,
      robotPos.y + LOOK_HEIGHT + CHASE_DISTANCE * Math.sin(orbitPitch),
      robotPos.z - Math.cos(orbitYaw) * horizDist
    )
    camera.lookAt(robotPos.x, robotPos.y + LOOK_HEIGHT, robotPos.z)
  }

  if (!cameraPanel.classList.contains('hidden')) {
    camX.textContent = camera.position.x.toFixed(1)
    camY.textContent = camera.position.y.toFixed(1)
    camZ.textContent = camera.position.z.toFixed(1)
    camPitch.textContent = THREE.MathUtils.radToDeg(camera.rotation.x).toFixed(1)
    camYaw.textContent = THREE.MathUtils.radToDeg(camera.rotation.y).toFixed(1)
    camRoll.textContent = THREE.MathUtils.radToDeg(camera.rotation.z).toFixed(1)
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
