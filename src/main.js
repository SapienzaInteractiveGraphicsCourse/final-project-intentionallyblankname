import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { AMRManipulator, MANIPULATOR_STATS } from './robots/AMRManipulator.js'
import { LeggedManipulator, LEGGED_MANIPULATOR_STATS } from './robots/LeggedManipulator.js'
import { Drone, DRONE_STATS, droneTuning } from './robots/Drone.js'
import { ROBOT_KEYS, getSelectedRobotKey, getSelectedEnemyRobotKey, setSelectedRobotKey, setSelectedEnemyRobotKey } from './state/RobotSelection.js'
import { getSavedAllyColors, saveAllyColors } from './state/RobotColors.js'
import { Team } from './state/Team.js'
import { RobotState } from './robots/RobotBase.js'
import { createProceduralPBRMaps, drawBrushedMetal } from './robots/ModelMakers/AMRManipulatorModelMaker.js'
import { Basketball, BallState } from './gameplay/Basketball.js'
import { GameMode } from './state/GameMode.js'
import { TimeOfDay } from './state/TimeOfDay.js'
import { SoundEffects } from './audio/SoundEffects.js'
import { CollisionWorld, RIM_RING_RADIUS, RIM_TUBE_RADIUS } from './gameplay/CollisionWorld.js'
import { initMainMenu } from './ui/MainMenu.js'
import { angleToForward, rotateRight } from './utils/mathUtils.js'
import { initBallPossession, stepDribble, getObjectWorldPosition, createDribbleState, snapBallToRestPoint } from './gameplay/BallPossession.js'
import { initShootingSystem } from './gameplay/ShootingSystem.js'
import { initEnemyAI, AI_MIN_PLAYER_DISTANCE } from './gameplay/EnemyAI.js'
import { initCombatMoves, stealCooldownFor, blockCooldownFor, isCombatMoveActive, STEAL_FORWARD_MARGIN, STEAL_BACKWARD_MARGIN } from './gameplay/CombatMoves.js'
import { initDebugPanel } from './debug/debugPanel.js'
import { initCollisionDebugView } from './debug/CollisionDebugView.js'
import { ORBIT_PITCH_MIN, ORBIT_PITCH_MAX, BALL_GRAVITY } from './utils/constants.js'

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

// Skybox procedurale (modello Preetham/Rayleigh scattering, three/addons/
// objects/Sky.js — parte dell'ecosistema three.js ufficiale, nessun asset HDR
// scaricato, coerente con l'approccio "tutto procedurale" del resto del
// progetto), al posto del colore piatto (`scene.background = new THREE.Color`)
// usato finora. Box enorme (BackSide, three.js disegna solo le facce interne)
// scalato appena sotto camera.far=5000 così resta sempre dietro a tutto senza
// mai finire fuori dal frustum di clipping
const sky = new Sky()
sky.scale.setScalar(4800)
scene.add(sky)

// converte elevazione/azimuth (gradi) in un vettore direzione unitario per
// l'uniform sunPosition dello shader Sky — stessa formula standard usata
// negli esempi three.js (phi da zenit, non da orizzonte)
function sunDirectionFromElevAzim(elevationDeg, azimuthDeg, target = new THREE.Vector3()) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg)
  const theta = THREE.MathUtils.degToRad(azimuthDeg)
  return target.setFromSphericalCoords(1, phi, theta)
}

// preset di illuminazione scelti nel main menu (fase del giorno) — colore e
// intensità di hemi/sun, posizione del sole (basso all'alba/tramonto, alto a
// mezzogiorno) e look atmosferico dello Sky (torbidità/rayleigh/mie).
// skyElevation/skyAzimuth sono SEPARATI da sunPos: sunPos è la luce vera
// (serve solo una direzione d'ombra coerente, l'intensità bassa fa il resto
// del lavoro per NIGHT — motivo per cui resta "alta" come DAY), ma il modello
// Preetham dello Sky renderizza un cielo diurno azzurro ogni volta che il
// sole è sopra l'orizzonte, qualunque sia torbidità/rayleigh — per NIGHT il
// sole del cielo deve scendere sotto l'orizzonte (elevation negativa),
// altrimenti lo skybox sembrerebbe pieno giorno anche di notte.
// NIGHT alzata rispetto al primo tentativo (hemi 0.35→0.6, sun 0.2→0.5):
// troppo scuro, quasi nero — resta comunque la più buia delle 4, ma con
// una luce blu lunare chiaramente presente, non pressoché assente
const TIME_OF_DAY_PRESETS = {
  [TimeOfDay.SUNRISE]: { hemiSky: 0xffb08a, hemiGround: 0x9a5a40, hemiIntensity: 0.9, sunColor: 0xffae5c, sunIntensity: 1.0, sunPos: [1500, 400, -800], skyElevation: 6, skyAzimuth: 220, skyTurbidity: 8, skyRayleigh: 2.5, skyMie: 0.01, skyMieG: 0.9 },
  [TimeOfDay.DAY]:     { hemiSky: 0xffd0c8, hemiGround: 0xc09080, hemiIntensity: 1.2, sunColor: 0xfff5ee, sunIntensity: 1.2, sunPos: [1500, 1200, -800], skyElevation: 60, skyAzimuth: 220, skyTurbidity: 3, skyRayleigh: 1.2, skyMie: 0.003, skyMieG: 0.8 },
  [TimeOfDay.SUNSET]:  { hemiSky: 0xff8a5c, hemiGround: 0x7a3a2a, hemiIntensity: 0.85, sunColor: 0xff7040, sunIntensity: 0.9, sunPos: [-1500, 400, 800], skyElevation: 4, skyAzimuth: 40, skyTurbidity: 8, skyRayleigh: 3, skyMie: 0.012, skyMieG: 0.92 },
  [TimeOfDay.NIGHT]:   { hemiSky: 0x3a4a7c, hemiGround: 0x10101c, hemiIntensity: 0.6, sunColor: 0x6a8fd0, sunIntensity: 0.5, sunPos: [1500, 1200, -800], skyElevation: -8, skyAzimuth: 220, skyTurbidity: 4, skyRayleigh: 0.5, skyMie: 0.005, skyMieG: 0.8 },
}

// stato della transizione animata (stile isometric_racer: rampa/crossfade
// invece di uno scatto secco, vedi startTimeOfDayTransition/
// updateTimeOfDayTransition più sotto) — scratch riusati, mai riallocati
// per frame durante il fade
const TIME_OF_DAY_TRANSITION_DURATION = 2.5
const timeOfDayTransition = {
  active: false, elapsed: 0, toTime: TimeOfDay.SUNRISE,
  fromHemiSky: new THREE.Color(), fromHemiGround: new THREE.Color(), fromHemiIntensity: 0,
  fromSunColor: new THREE.Color(), fromSunIntensity: 0, fromSunPos: new THREE.Vector3(),
  fromSkySunDir: new THREE.Vector3(), fromSkyTurbidity: 0, fromSkyRayleigh: 0, fromSkyMie: 0, fromSkyMieG: 0,
  fromHoopSpotIntensity: 0,
}
const skySunDirScratch = new THREE.Vector3()
const presetColorScratch = new THREE.Color()
const presetSunPosScratch = new THREE.Vector3()

// applica un preset SENZA transizione — solo per lo stato iniziale a
// caricamento pagina (vedi startTimeOfDayTransition per il cambio animato
// dal Main Menu). Cancella anche una transizione in corso: uno scatto
// istantaneo deve sempre vincere su un fade a metà
function applyTimeOfDayPreset(time) {
  timeOfDayTransition.active = false
  const preset = TIME_OF_DAY_PRESETS[time]
  hemi.color.set(preset.hemiSky)
  hemi.groundColor.set(preset.hemiGround)
  hemi.intensity = preset.hemiIntensity
  sun.color.set(preset.sunColor)
  sun.intensity = preset.sunIntensity
  sun.position.set(...preset.sunPos)
  sunDirectionFromElevAzim(preset.skyElevation, preset.skyAzimuth, sky.material.uniforms.sunPosition.value)
  sky.material.uniforms.turbidity.value = preset.skyTurbidity
  sky.material.uniforms.rayleigh.value = preset.skyRayleigh
  sky.material.uniforms.mieCoefficient.value = preset.skyMie
  sky.material.uniforms.mieDirectionalG.value = preset.skyMieG
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

// avvia il cambio ANIMATO (Main Menu → schermata TIME OF DAY): l'istantanea
// "from" è presa dai valori LIVE correnti, non dal preset nominale di
// partenza — se una transizione precedente viene interrotta a metà da un
// secondo click, si riparte da dove si è VERAMENTE arrivati (stesso
// principio già usato altrove nel progetto per non assumere uno stato mai
// verificato, vedi CLAUDE.md → stealState.contactMade)
function startTimeOfDayTransition(time) {
  const t = timeOfDayTransition
  t.fromHemiSky.copy(hemi.color)
  t.fromHemiGround.copy(hemi.groundColor)
  t.fromHemiIntensity = hemi.intensity
  t.fromSunColor.copy(sun.color)
  t.fromSunIntensity = sun.intensity
  t.fromSunPos.copy(sun.position)
  t.fromSkySunDir.copy(sky.material.uniforms.sunPosition.value)
  t.fromSkyTurbidity = sky.material.uniforms.turbidity.value
  t.fromSkyRayleigh = sky.material.uniforms.rayleigh.value
  t.fromSkyMie = sky.material.uniforms.mieCoefficient.value
  t.fromSkyMieG = sky.material.uniforms.mieDirectionalG.value
  t.fromHoopSpotIntensity = hoopSpotlights[0]?.intensity ?? 0
  t.toTime = time
  t.elapsed = 0
  t.active = true
}

// chiamata ogni frame da animate() (anche a menuState.mode==='menu': è
// proprio lì che il cambio viene scelto e deve restare visibile mentre
// sfuma) — no-op immediato se non c'è nessuna transizione in corso
function updateTimeOfDayTransition(delta) {
  const t = timeOfDayTransition
  if (!t.active) return
  t.elapsed += delta
  const linearT = Math.min(t.elapsed / TIME_OF_DAY_TRANSITION_DURATION, 1)
  const e = linearT * linearT * (3 - 2 * linearT) // smoothstep

  const preset = TIME_OF_DAY_PRESETS[t.toTime]
  hemi.color.lerpColors(t.fromHemiSky, presetColorScratch.set(preset.hemiSky), e)
  hemi.groundColor.lerpColors(t.fromHemiGround, presetColorScratch.set(preset.hemiGround), e)
  hemi.intensity = THREE.MathUtils.lerp(t.fromHemiIntensity, preset.hemiIntensity, e)
  sun.color.lerpColors(t.fromSunColor, presetColorScratch.set(preset.sunColor), e)
  sun.intensity = THREE.MathUtils.lerp(t.fromSunIntensity, preset.sunIntensity, e)
  sun.position.lerpVectors(t.fromSunPos, presetSunPosScratch.set(...preset.sunPos), e)

  sunDirectionFromElevAzim(preset.skyElevation, preset.skyAzimuth, skySunDirScratch)
  sky.material.uniforms.sunPosition.value.lerpVectors(t.fromSkySunDir, skySunDirScratch, e).normalize()
  sky.material.uniforms.turbidity.value = THREE.MathUtils.lerp(t.fromSkyTurbidity, preset.skyTurbidity, e)
  sky.material.uniforms.rayleigh.value = THREE.MathUtils.lerp(t.fromSkyRayleigh, preset.skyRayleigh, e)
  sky.material.uniforms.mieCoefficient.value = THREE.MathUtils.lerp(t.fromSkyMie, preset.skyMie, e)
  sky.material.uniforms.mieDirectionalG.value = THREE.MathUtils.lerp(t.fromSkyMieG, preset.skyMieG, e)

  // stesso principio del faretto in applyTimeOfDayPreset: l'intensità stessa
  // viene interpolata (mai un toggle .visible secco), qui il fade è ancora
  // più naturale perché la luce vera e propria si accende/spegne gradualmente
  const spotsOn = t.toTime === TimeOfDay.SUNSET || t.toTime === TimeOfDay.NIGHT
  const targetHoopIntensity = spotsOn ? HOOP_SPOTLIGHT_INTENSITY : 0
  const hoopIntensity = THREE.MathUtils.lerp(t.fromHoopSpotIntensity, targetHoopIntensity, e)
  hoopSpotlights.forEach(spot => { spot.intensity = hoopIntensity })

  if (linearT >= 1) t.active = false
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
// SUNRISE di default all'avvio (imposta luci+Sky sul preset iniziale,
// stesso valore di default di menuState.timeOfDay più sotto — il campo
// da GAMEMODE in poi, il court vuoto e "all'alba" prima ancora di scegliere
// qualunque cosa) — la variabile timeOfDay vera e propria è dichiarata più
// avanti nel file (vicino a mode), qui si passa direttamente l'enum per
// evitare di referenziarla prima della sua dichiarazione. Deve girare DOPO
// hoopSpotlights (sopra), non subito dopo la dichiarazione della funzione:
// applyTimeOfDayPreset legge quell'array
applyTimeOfDayPreset(TimeOfDay.SUNRISE)

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
const loadingLabelEl = document.getElementById('loading-label')
// etichetta per fase reale, non un timer finto: "Creating Robot Models" è il
// testo di default nell'HTML (la costruzione dei 6 robot procedurali è
// sincrona, gira PRIMA che i due loader.load() sotto abbiano il tempo di
// rispondere — vedi il set-testo subito dopo buildRobotInstances più sotto),
// poi "Loading Environment Assets" finché nessuno dei 2 GLTF è pronto,
// "Loading Textures" quando resta solo l'ultimo (il pallone, l'asset con
// più tipi di texture del progetto)
function markAssetLoaded() {
  assetsLoadedCount++
  loadingBarFillEl.style.width = `${Math.round((assetsLoadedCount / TOTAL_ASSETS_TO_LOAD) * 100)}%`
  if (assetsLoadedCount < TOTAL_ASSETS_TO_LOAD) loadingLabelEl.textContent = 'LOADING TEXTURES'
  else loadingScreenEl.classList.add('fade-out')
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
// riferimento alla mesh delle linee dipinte del campo (Basket_ball_lines) —
// la sua bounding box world-space (calcolata dopo scene.add(gltf.scene)
// sotto, quando la matrice mondo è definitiva) diventa COURT_BOUNDS, il
// vero rettangolo di gioco per la regola "palla fuori campo" (vedi
// updateOutOfBoundsTimer in animate()) — coordinate reali dagli accessor
// GLTF, non un rettangolo stimato a mano (stesso principio già seguito per
// muri/hoop/backboard in CollisionWorld.js)
let courtLinesMesh = null
let courtBounds = null
// vedi commento su expandByScalar più sotto (dove courtBounds viene
// calcolato): copre lo scarto reale tra il bordo delle linee dipinte e i
// ferri (CollisionWorld.js, X≈±1080 contro un bordo linee reale ≈1042 —
// scarto ~40 unità), più un margine per rimbalzi normali sotto canestro.
// 250 (primo tentativo) rendeva il trigger troppo lontano/raro da
// incontrare in una partita normale ("non sembra attiva", segnalato dal
// vivo) — verificato via test headless (basketball.owner/state forzati,
// timer letto ogni 0.5s di tempo reale) che il meccanismo FUNZIONA
// correttamente end-to-end, il problema era solo la distanza richiesta
const COURT_BOUNDS_MARGIN = 100

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
      courtLinesMesh = child
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
  // COURT_BOUNDS: solo ORA (dopo scene.add) la matrice mondo della mesh
  // delle linee è definitiva — un Box3 preso prima (durante il traverse,
  // gltf.scene non ancora agganciato alla scena) rischierebbe coordinate
  // locali invece che mondo
  if (courtLinesMesh) {
    courtLinesMesh.updateWorldMatrix(true, false)
    courtBounds = new THREE.Box3().setFromObject(courtLinesMesh)
    // margine di sicurezza: i due ferri (CollisionWorld.js, X≈±1080) stanno
    // GIÀ oltre il bordo esatto delle linee dipinte (max.x misurato ≈1042)
    // — backboard/ferro/area di rimbalzo sotto canestro sono normalissimo
    // gameplay, non "palla uscita dal campo". Senza questo margine, OGNI
    // tiro/rimbalzo vicino al proprio canestro avrebbe fatto scattare
    // erroneamente il timer fuori-campo pochi istanti dopo un tiro reale
    courtBounds.expandByScalar(COURT_BOUNDS_MARGIN)
  }
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
// centro visivo reale della paletta a occhio: Forward/Side/Down sono
// ballOffsetForward/Side/Down, campi di ISTANZA sul robot (RobotBase.js) —
// ogni classe ha un braccio/orientamento diverso e lo stesso numero
// assoluto non produce lo stesso punto visivo per MANIPULATOR/LEGGED/DRONE
// (vedi debugPanel.js → Basketball → Ball Offset, un sottomenu per classe).
// Stesso principio per dribbleTuning/shootTuning/handlingTuning (durate/
// ampiezze di palleggio, tiro, presa): anche questi sono campi di ISTANZA
// sul robot ora, non più oggetti condivisi qui in main.js — vedi
// RobotBase.js (default) e debugPanel.js (un sottomenu "X Animation" per
// classe). NON rimasti qui: solo i valori GENUINAMENTE globali restano
// `let` sciolti (camera/crosshair, non geometria/animazione di una classe)
// ballRestExtraOffset (SOLO per HANDLING/tiro, ballRestPoint non
// paddleCenter — il punto di convergenza delle normali è geometricamente
// corretto "di luogo" ma può risultare troppo vicino/dentro la paletta a
// seconda di grip/scala/geometria) NON è più un `let` globale qui: campo
// di ISTANZA su ogni robot (RobotBase.js/Drone.js), stesso motivo di Ball
// Offset/Dribble/Shoot/Handling tuning — vedi debugPanel.js → Animation →
// Handling, un sottomenu per classe invece di un unico slider condiviso
// offset yaw del braccio in Play (gradi, sommato a cameraState.orbitYaw ogni frame) e
// altezza del crosshair (px sopra il centro schermo) — anche questi
// dichiarati qui per lo stesso motivo di BALL_*: letti già dal setup del
// debug menu sotto
let ARM_YAW_OFFSET_DEG = -36
let CROSSHAIR_HEIGHT = 115
// più vicino = visuale più bassa/schiacciata: un rialzo extra in quota
// compensa, per non vedere la base ma il braccio (utile per mirare/tirare)
let HANDLING_HEIGHT_BOOST = 40
// scarto laterale della camera in HANDLING (asse camRightFlat), per una
// vista "di spalla" invece che dritta dietro il robot
let HANDLING_CAMERA_SIDE_OFFSET = -60
// stessa formula usata sia in updateHandling (gomito già agganciato al
// pitch della camera durante la presa) sia in updateShootAnimation (stessa
// formula durante il tiro vero) — un solo posto invece di due copie
function computeAimPitchOffset() {
  // manipulator.shootTuning (RobotBase.js): PER ISTANZA, non più l'oggetto
  // condiviso shootTuning di prima — solo il giocatore usa questa funzione
  // (l'enemy passa computeAimPitchOffset: () => 0, niente camera da
  // inseguire), quindi il modulo-scope "manipulator" è sempre quello giusto
  return (cameraState.orbitPitch - ORBIT_PITCH_REST) * manipulator.shootTuning.elbowAimCoupling
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

// --- Robot ---
// TUTTE E 3 le classi vengono istanziate SUBITO, per entrambi i lati (6
// istanze totali) — nascoste (root.visible = false) finché non sono quelle
// ATTIVE. Cambiare classe dal Main Menu (vedi setActiveRobotClass più
// sotto) è quindi solo una riassegnazione del riferimento manipulator/
// enemyManipulator + uno switch di visibilità, MAI un reload. Scala per
// classe: 45 tarato a occhio per MANIPULATOR/DRONE (stessa scala visiva),
// 56.25 = 45×1.25 per LEGGED MANIPULATOR (25% più grande — vedi
// leggedManipulator.js)
//
// Prima di questa versione, cambiare classe ricaricava la pagina: main.js
// istanziava UNA sola classe e quel riferimento veniva catturato per
// VALORE (non un accessor) in 8+ moduli (BallPossession/ShootingSystem×2/
// EnemyAI/CombatMoves×2/debugPanel/CollisionDebugView) — riassegnarlo a
// runtime avrebbe lasciato quei moduli a operare per sempre sull'istanza
// VECCHIA (stessa classe di footgun già risolta altrove con getBasketball:
// un valore catturato allo spread/destructure non segue una riassegnazione
// successiva). Soluzione applicata ora, generalizzata a TUTTI quei moduli:
// manipulator/enemyManipulator restano `let` qui (riassegnabili, stesso
// modulo — main.js non ha mai avuto questo problema al suo interno), ma
// ogni consumer esterno riceve getManipulator/getEnemyManipulator (funzioni,
// non valori) e le richiama fresche ad ogni frame/chiamata invece di
// destrutturare `manipulator` una volta sola
const ROBOT_CLASS_BY_KEY = {
  [ROBOT_KEYS.MANIPULATOR]: { RobotClass: AMRManipulator, scale: 45, label: 'MOBILE MANIPULATOR' },
  [ROBOT_KEYS.LEGGED]: { RobotClass: LeggedManipulator, scale: 56.25, label: 'LEGGED MANIPULATOR' },
  [ROBOT_KEYS.DRONE]: { RobotClass: Drone, scale: 45, label: 'DRONE' },
}

// dal proprio lato di campo (stessa X di resetGameplayState in
// MainMenu.js — PLAYER_SPAWN_X/ENEMY_SPAWN_X lì, ripetuta qui solo per il
// primissimo avvio prima che esista un menu da cui tornare)
function buildRobotInstances(team, spawnX) {
  const instances = {}
  for (const key of Object.keys(ROBOT_CLASS_BY_KEY)) {
    const { RobotClass, scale } = ROBOT_CLASS_BY_KEY[key]
    const robot = new RobotClass(team)
    // unità locali (~1-4) → scala mondo: lampioni a Y=268, hoop reg.
    // ~305cm, unità mondo ≈ 1cm — tarato a occhio via slider debug (P).
    // Passa da controls.manipulatorScale (non root.scale diretto) così lo
    // stato tracciato resta coerente con "Copy config"
    robot.controls.manipulatorScale(scale)
    // ballRestExtraOffset: PER ISTANZA (RobotBase.js/Drone.js), non più il
    // vecchio BALL_REST_EXTRA_OFFSET globale — ogni classe applica il
    // proprio valore di default qui alla costruzione
    robot.controls.setBallRestOffset(robot.ballRestExtraOffset)
    robot.root.position.set(spawnX, 0, 0)
    robot.root.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    scene.add(robot.root)
    // nascosto finché non diventa la classe ATTIVA — e comunque solo
    // quella attiva viene mai mostrata, sia in Play sia nel Main Menu (il
    // campo deve restare vuoto durante il menu, non solo velato dietro
    // #menu-overlay semi-trasparente — altrimenti il robot reale, e la sua
    // ombra, restavano visibili/"fantasma" dietro il menu, compresa la
    // card preview 3D (canvas trasparente) delle schermate ROBOT)
    robot.root.visible = false
    instances[key] = robot
  }
  return instances
}

const playerRobots = buildRobotInstances(Team.A, -300)
// colori personalizzati (Main Menu → ROBOT → "Personalizza", solo Team.A):
// applicati a TUTTE E 3 le istanze, non solo quella attiva ora — è
// un'identità di SQUADRA, non della singola classe, quindi deve restare
// coerente anche cambiando robot in seguito dallo stesso menu
const savedAllyColors = getSavedAllyColors()
if (savedAllyColors) {
  for (const key of Object.keys(playerRobots)) playerRobots[key].controls.setColors(savedAllyColors)
}
// --- Nemico (1v1, Section 3): stessa scelta classe del giocatore, propria
// e indipendente — guidato dall'AI invece che dall'input. Spawn a una
// distanza ragionevole dal giocatore, non sovrapposto: la posizione vera
// verrà gestita dall'AI (src/EnemyAI.js)
const enemyRobots = buildRobotInstances(Team.B, 300)
// fase reale successiva (vedi commento su markAssetLoaded): la costruzione
// procedurale dei 6 robot è già finita qui (sincrona), ora si aspettano i 2
// GLTF (campo + pallone) — nessun loro loader.load() può ancora aver
// richiamato markAssetLoaded() a questo punto (JS è single-thread, un
// callback async non può girare a metà di questa stessa esecuzione
// sincrona), quindi sovrascrivere qui è sempre sicuro
loadingLabelEl.textContent = 'LOADING ENVIRONMENT ASSETS'
// RobotBase parte di default in DRIBBLE (l'ipotesi valida finché esisteva
// un solo robot, sempre in possesso all'avvio) — il nemico invece NON
// possiede la palla all'avvio (il giocatore sì, vedi setOwner(manipulator)
// al caricamento del GLTF pallone): senza questa correzione esplicita,
// enemyUpdateDribble proverebbe comunque a muovere ogni tick la stessa
// basketball.position condivisa, in conflitto con quella del giocatore.
// Applicata a TUTTE E 3 le istanze nemico (non solo quella inizialmente
// attiva): diventare attiva più tardi, dopo uno switch, non deve
// "resettare" questo stato — nessuno lo farebbe comunque per lei
for (const key of Object.keys(enemyRobots)) enemyRobots[key].setState(RobotState.NO_BALL)

let manipulator = playerRobots[getSelectedRobotKey()]
let enemyManipulator = enemyRobots[getSelectedEnemyRobotKey()]

// --- Spectator Camera ---
const controls = new PointerLockControls(camera, renderer.domElement)
// true mentre controls.enabled è forzato a false (hard lock della mira
// durante l'animazione di tiro, vedi animate()) — evita di riassegnare
// controls.enabled ogni frame quando lo stato non è cambiato
let aimLockActive = false

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
// di entrare in scena — PRACTICE e 1V1 sono le uniche modalità reali (3V3
// mai implementata, fuori scope)
const menuState = { mode: 'menu', gameMode: GameMode.PRACTICE, timeOfDay: TimeOfDay.SUNRISE }
const modeIndicator = document.getElementById('mode-indicator')
// stato di movimento consolidato (stesso principio di shootingState/
// cameraState/menuState) — l'orientamento visivo di locomozione interpolato
// (ex wheelsAngle) ora vive su manipulator.locomotionYaw (RobotBase.js),
// di proprietà del robot invece che duplicato qui
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

// velocità di sterzata (rad/s equivalenti: "rapidissima" ma non istantanea)
// per manipulator.updateLocomotionAnimation() (src/robots/RobotBase.js) —
// l'interpolazione vera e propria (lerpAngle, smoothing esponenziale
// framerate-independent) ora vive lì, di proprietà del robot invece che
// duplicata come `let` sciolto qui
const WHEEL_TURN_SPEED = 18

// --- Dash (Shift in Play) — solo MANIPULATOR, vedi AMRManipulator.js ---
const dashPanel = document.getElementById('dash-panel')
const dashChargeFillEls = [document.getElementById('dash-charge-fill-0'), document.getElementById('dash-charge-fill-1')]
const dashChargeBlockEls = Array.from(document.querySelectorAll('#dash-charges .dash-charge-block'))
// etichetta pannello dipende dalla classe scelta (Shift fa cose diverse per classe)
const SPECIAL_MOVE_LABEL_BY_TYPE = { MANIPULATOR: 'DASH', LEGGED_MANIPULATOR: 'JUMP', DRONE: 'FLIGHT' }
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
// stesso pannello HUD per tutte le classi: numero di blocchi/cooldown letti
// da dashState (MANIPULATOR) o da specialMoveState/specialMoveCooldownTime
// (Jump/Flight, RobotBase.js) — `let`, non `const`: il tipo può cambiare
// a runtime ora (setActiveRobotClass, niente più reload), quindi vanno
// ricalcolati ad ogni switch, non solo una volta all'avvio
let USES_DASH_STATE, SPECIAL_MOVE_MAX_CHARGES, SPECIAL_MOVE_COOLDOWN_TIME
function refreshSpecialMoveHud() {
  USES_DASH_STATE = manipulator.type === 'MANIPULATOR'
  SPECIAL_MOVE_MAX_CHARGES = USES_DASH_STATE ? DASH_MAX_CHARGES : manipulator.specialMoveMaxCharges
  SPECIAL_MOVE_COOLDOWN_TIME = USES_DASH_STATE ? DASH_COOLDOWN_TIME : manipulator.specialMoveCooldownTime
  document.getElementById('dash-panel-label').textContent = SPECIAL_MOVE_LABEL_BY_TYPE[manipulator.type] ?? 'SPECIAL'
  dashChargeBlockEls.forEach((el, i) => el.classList.toggle('hidden', i >= SPECIAL_MOVE_MAX_CHARGES))
}
refreshSpecialMoveHud()

// switch di classe robot dal Main Menu (schermata ROBOT/ROBOT AVVERSARIO):
// solo riassegnazione di riferimento + toggle di visibilità, MAI un reload
// (vedi il commento sopra buildRobotInstances). Sicuro perché quelle
// schermate sono raggiungibili SOLO mentre il robot in questione è ancora
// nascosto (Main Menu prima di START, o dopo BACK TO MAIN MENU che lo
// nasconde di nuovo) — non serve replicare qui la visibilità "vera", basta
// preservarla (nel caso limite in cui questa funzione venga mai chiamata
// mentre il robot è visibile, non succede oggi ma non si assume silenziosamente)
function setActiveRobotClass(key) {
  if (manipulator === playerRobots[key]) return
  const wasVisible = manipulator.root.visible
  manipulator.root.visible = false
  manipulator = playerRobots[key]
  manipulator.root.visible = wasVisible
  setSelectedRobotKey(key)
  refreshSpecialMoveHud()
}
function setActiveEnemyRobotClass(key) {
  if (enemyManipulator === enemyRobots[key]) return
  const wasVisible = enemyManipulator.root.visible
  enemyManipulator.root.visible = false
  enemyManipulator = enemyRobots[key]
  enemyManipulator.root.visible = wasVisible
  setSelectedEnemyRobotKey(key)
}

document.addEventListener('keydown', e => {
  if (e.code !== 'ShiftLeft' || e.repeat || menuState.mode !== 'play') return
  // Dash resta il meccanismo originale SOLO per MANIPULATOR (vedi
  // AMRManipulator.js sul perché non passa dall'hook generico) — le
  // altre classi usano triggerSpecialMove()/specialMoveState condiviso
  // (RobotBase.js): stesso tasto, implementazione diversa per classe
  if (manipulator.type !== 'MANIPULATOR') { manipulator.triggerSpecialMove(); return }
  if (dashState.charges <= 0) return
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
  // camera/crosshair congelati per tutta l'animazione di tiro (windup/
  // release/recover): la direzione vera del tiro è catturata dentro
  // 'release' (t>=releasePoint, vedi ShootingSystem.js), non al click —
  // senza questo lock la mira poteva ancora derivare dopo il click e il
  // tiro finiva diverso da quanto mostrato dalla preview congelata lì.
  // Bloccare qui invece che a valle (in getShotDirection) fa sì che anche
  // il gomito (che insegue aimPitchOffset per tutta l'animazione, vedi
  // updateShootAnimation) resti coerente con la stessa direzione fissa
  if (shootingState.phase !== 'idle') return
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
  timeSinceTrigger: 0, // secondi dal trigger (triggerShoot) — non azzerato ad ogni cambio fase come phaseT, usato per il blend verso releaseOrigin
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
  // punto esatto da cui la preview di traiettoria disegnava l'arco
  // un istante prima del trigger (triggerShoot, ShootingSystem.js) — il
  // volo reale riparte ESATTAMENTE da lì invece che da dove il windup ha
  // trascinato la palla nel frattempo, altrimenti l'arco vero è
  // parallelo ma spostato rispetto a quanto la preview mostrava
  releaseOrigin: new THREE.Vector3(),
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
  getManipulator: () => manipulator, getEnemyManipulator: () => enemyManipulator,
  // stessa identica fonte di "dove sta guardando" usata da CombatMoves.js
  // (resolveAimYaw): il giocatore la camera/crosshair, il nemico le ruote
  // (niente camera) — la zona STEAL disegnata deve orientarsi esattamente
  // come quella vera, non una approssimazione a parte
  getPlayerAimYaw: () => cameraState.orbitYaw,
  getEnemyAimYaw: () => enemyManipulator.wheelsGroup.rotation.y,
  stealForwardMargin: STEAL_FORWARD_MARGIN, stealBackwardMargin: STEAL_BACKWARD_MARGIN,
  pickupMargin: PICKUP_MARGIN,
})

document.addEventListener('mousedown', e => {
  if (e.button !== 0 || menuState.mode !== 'play' || !controls.isLocked) return
  if (manipulator.state !== RobotState.HANDLING || shootingState.phase !== 'idle' || !basketball) return
  // sequenza di avvio windup condivisa con EnemyAI.js (ShootingSystem.js →
  // triggerShoot, stesso principio già in uso per triggerSteal/triggerBlock)
  triggerShoot()
  // un dash ancora a metà del suo burst (0.15s) al momento del click resta
  // congelato (non consumato) per tutta l'animazione di tiro — vedi il
  // guard su shootingState.phase in animate() — ma senza azzerarlo qui
  // restava "in banca" e scattava tutto insieme, di colpo, nell'istante
  // esatto in cui l'animazione tornava a 'idle' (fine 'recover'), un
  // teletrasporto imprevisto subito dopo il tiro. Annullare il residuo qui
  // consuma la carica una volta sola, come un dash interrotto a metà
  dashState.timeRemaining = 0
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
  // SEMPRE in HANDLING, non solo se il tasto destro è già giù in quel
  // preciso istante — bug reale segnalato dal vivo: "R" doveva rimettere
  // la palla "in mano" (commento sopra), ma se il destro non era tenuto
  // proprio in quel momento finiva in releaseBallHandling() → DRIBBLE,
  // dove la palla riparte dal punto offset del palleggio automatico
  // (paddle+ballOffsetForward/Side/Down, ~13 unità dal centro grezzo della
  // paletta per design), non dal punto stretto di HANDLING (ballRestPoint)
  // — sembrava "a una certa distanza dall'end effector" invece che in mano.
  // Verificato identico su tutte e 3 le classi (nessuna differenza per
  // robot): il problema era la condizione, non la geometria di una classe
  // specifica. HANDLING resta comunque uscibile normalmente (destro giù+su)
  manipulator.setState(RobotState.HANDLING)
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
// (forma completa/commento dettagliato ora su createDribbleState, BallPossession.js)
const dribbleState = createDribbleState()
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

// Stato "leggero" del dispatch palleggio/tiro/pickup/Flight, UNO per robot
// — prima 3 `let` sciolti duplicati a mano per giocatore/nemico
// (dribbleAccumulator/wasElevated) — consolidati in un oggetto (stesso
// principio già seguito ovunque nel progetto: dribbleState/shootingState/
// handlingState/pickupState) — permette a updateBallDispatch() sotto di
// essere UNA sola funzione condivisa invece di due blocchi quasi identici
// (~80 righe ciascuno, differivano solo nei nomi manipulator/
// enemyManipulator ecc., zero divergenza di comportamento reale)
function createBallDispatchState() {
  return { dribbleAccumulator: 0, wasElevated: false }
}

// Debug (pannello P, "Animation Preview"): fa avanzare la mossa speciale
// (Jump/Flight) indipendentemente da menuState.mode — updateSpecialMove
// vero (RobotBase.js) gira SOLO dentro il blocco Play (serve dashDirection/
// input WASD lì attorno), quindi da Spectate la fase restava congelata a
// 'idle' per sempre, impedendo di guardarla da un angolo libero. Bypassa
// anche charges/cooldown apposta (chiama onSpecialMoveStart() direttamente,
// non triggerSpecialMove()): è un tool di ispezione, non deve aspettare la
// ricarica reale per essere rilanciato
const debugPreviewState = { specialMoveActive: false }
const ballDispatchState = createBallDispatchState()
const enemyBallDispatchState = createBallDispatchState()

// Dispatch pickup/tiro/Flight/palleggio automatico per UN robot — chiamata
// una volta per il giocatore e una per il nemico (vedi le due call site in
// animate()), ognuna col proprio bundle di stato/funzioni. `wasElevated`
// traccia la transizione isElevated (Flight) true→false: al rientro a
// terra dribbleState va resettato pulito,
// altrimenti ballVelocityY/previousPushPaddleY restano quelli di PRIMA del
// decollo e il primo 'push' dopo l'atterraggio calcola una velocità dal
// confronto con una paddleWorldPos di centinaia di unità più in basso di
// quella pre-decollo (stesso sintomo della palla sparata al decollo, ma al
// contrario). Il check `if (basketball)` resta DENTRO questa funzione (non
// nel chiamante): updateAimPosture in fondo deve girare SEMPRE, anche
// mentre la palla non è ancora caricata (basketball null all'avvio)
function updateBallDispatch(delta, dispatch) {
  const {
    manipulator, pickupState, shootingState, dispatchState,
    updatePickup, updateShotFlight, checkForPickup,
    resetDribbleState, updateHandling, updateDribble,
  } = dispatch
  if (basketball) {
    // shootingState.released, NON manipulator.state === NO_BALL da solo,
    // decide se far girare la fisica del VOLO: in 1v1 un robot è NO_BALL
    // anche solo perché la palla ce l'ha l'ALTRO, non perché ha tirato lui
    // — updateShotFlight andrebbe comunque a muovere la basketball
    // condivisa "a vuoto" se guardasse solo allo stato. checkForPickup()
    // resta valido in ENTRAMBI i casi (tiro appena atterrato, o
    // semplicemente senza palla in questo istante)
    if (pickupState.phase === 'active') {
      updatePickup(delta)
    } else if (shootingState.released && (!basketball.owner || basketball.owner === manipulator)) {
      // basketball.owner check: se un BLOCK ha deviato il tiro E qualcun
      // altro l'ha già raccolto, questo NON è più "il mio tiro in volo" —
      // continuare ad applicare la fisica ABBANDONATA di questo robot
      // sulla stessa basketball.position che il nuovo possessore sta già
      // muovendo per conto suo la farebbe "flickerare" tra le due
      updateShotFlight(delta)
      checkForPickup()
    } else if (manipulator.state === RobotState.NO_BALL) {
      checkForPickup()
    } else if (shootingState.phase === 'idle') {
      if (dispatchState.wasElevated && !manipulator.isElevated) resetDribbleState()
      dispatchState.wasElevated = manipulator.isElevated
      if (manipulator.state === RobotState.HANDLING) {
        updateHandling(delta)
      } else if (manipulator.isElevated) {
        // Flight (Drone): la palla esce dal palleggio automatico per tutta
        // la durata grab→rise→hold→descend — altrimenti stepDribble
        // continuerebbe a inseguire una paddleWorldPos che sale di
        // centinaia di unità in pochi frame. Aggancio RIGIDO fin da 'grab'
        // (snapBallToRestPoint, la STESSA funzione/comportamento di
        // HANDLING — un .copy() diretto, MAI un lerp): due tentativi
        // interpolati (lerp "a tempo rimasto", poi un exponential decay
        // "veloce") sono stati scartati dal vivo (bottoni "Animation
        // Preview", pannello P) — qualunque interpolazione, per quanto
        // rapida, restava percepibile come la palla che "insegue" la
        // paletta invece di starci sopra. Deve stare sull'end effector
        // esattamente come in HANDLING, non rincorrerlo
        snapBallToRestPoint(manipulator, basketball)
      } else {
        // consuma il tempo reale a fette fisse (vedi commento su
        // DRIBBLE_FIXED_DT): un frame lento produce più iterazioni
        // consecutive, uno veloce anche zero (il resto resta in
        // accumulator per il prossimo) — updateDribble non vede mai altro
        // dt che non sia questo valore costante. Clamp per evitare una
        // "spirale della morte" se il tab perde focus a lungo
        dispatchState.dribbleAccumulator = Math.min(dispatchState.dribbleAccumulator + delta, DRIBBLE_FIXED_DT * 10)
        while (dispatchState.dribbleAccumulator >= DRIBBLE_FIXED_DT) {
          updateDribble(DRIBBLE_FIXED_DT)
          dispatchState.dribbleAccumulator -= DRIBBLE_FIXED_DT
        }
      }
    }
  }
  // Drone: se non in HANDLING, rilassa l'inclinazione di mira verso 0 (mai
  // congelata all'ultimo valore) — copre OGNI modo in cui si esce da
  // HANDLING, non solo il rilascio manuale (releaseBallHandling in
  // BallPossession.js, che la azzera di scatto): un tiro va DIRETTAMENTE a
  // NO_BALL da ShootingSystem.js, bypassando quella funzione. RobotBase.
  // updateAimPosture default è vuoto: innocuo per MANIPULATOR/LEGGED
  if (manipulator.state !== RobotState.HANDLING) manipulator.updateAimPosture(0, delta)
}

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
// debugPanel/MainMenu, sotto) — riferimenti stabili (camera/scene/sfx/
// controls) e oggetti-stato mutabili (cameraState). Costruito una volta sola, poi ogni init riceve
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
// nemico) — un solo pallone/collisionWorld/audio in scena. NON qui:
// manipulator/dribbleState/handlingState/pickupState/shootingState/
// computeAimPitchOffset/getShotDirection — sono per-robot (ognuno pilotato
// in modo diverso, input utente vs AI, con la propria macchina a stati
// indipendente), passati espliciti ad ogni chiamata sotto. dribbleTuning/
// handlingTuning/shootTuning NON sono più qui: sono campi di ISTANZA sul
// robot stesso ora (RobotBase.js), letti via getManipulator().dribbleTuning
// ecc. da chi li usa — non più un tuning fisico condiviso da tutte le classi
const gameContext = {
  getBasketball: () => basketball,
  camera, scene, sfx, controls,
  cameraState,
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
  getManipulator: () => manipulator, dribbleState, handlingState, pickupState, shootingState,
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

// --- Turnover di possesso 1V1 (canestro subito / palla fuori campo non
// recuperata) e win condition (primo a WIN_SCORE) ---
//
// Dissolvenza a schermo intero (#turnover-fade) prima di ogni reset di
// posizione — un teletrasporto ISTANTANEO del robot allo spawn (la vecchia
// versione) faceva scattare di colpo anche la chase camera, disorientante
// dal vivo ("mi gira la testa" — segnalato). Piccola state machine a timer
// (out/in), come il resto delle animazioni del progetto — NON una CSS
// transition: deve restare deterministica, l'azione vera (il reset) scatta
// esattamente a schermo pieno, mai a metà dissolvenza
const WIN_SCORE = 11
const turnoverFadeEl = document.getElementById('turnover-fade')
const TURNOVER_FADE_OUT_DURATION = 0.25
const TURNOVER_FADE_IN_DURATION = 0.35
const turnoverFadeState = { phase: 'idle', phaseT: 0, pendingAction: null }
function startTurnoverFade(action) {
  // difesa in profondità: due trigger ravvicinati (non dovrebbe succedere,
  // un canestro/OOB alla volta) eseguono comunque l'azione pendente invece
  // di perderla silenziosamente
  if (turnoverFadeState.phase !== 'idle' && turnoverFadeState.pendingAction) turnoverFadeState.pendingAction()
  turnoverFadeState.phase = 'out'
  turnoverFadeState.phaseT = 0
  turnoverFadeState.pendingAction = action
  turnoverFadeEl.classList.remove('hidden')
}
function updateTurnoverFade(delta) {
  if (turnoverFadeState.phase === 'idle') return
  turnoverFadeState.phaseT += delta
  if (turnoverFadeState.phase === 'out') {
    const t = Math.min(turnoverFadeState.phaseT / TURNOVER_FADE_OUT_DURATION, 1)
    turnoverFadeEl.style.opacity = t
    if (t >= 1) {
      turnoverFadeState.pendingAction?.()
      turnoverFadeState.pendingAction = null
      turnoverFadeState.phase = 'in'
      turnoverFadeState.phaseT = 0
    }
  } else { // 'in'
    const t = Math.min(turnoverFadeState.phaseT / TURNOVER_FADE_IN_DURATION, 1)
    turnoverFadeEl.style.opacity = 1 - t
    if (t >= 1) {
      turnoverFadeState.phase = 'idle'
      turnoverFadeEl.classList.add('hidden')
    }
  }
}

// title screen di fine partita (1V1, primo a WIN_SCORE) — stesso principio
// di openPauseMenu: menuState.mode torna 'menu', freeza tutto il gameplay
// (animate() esce subito appena vede mode==='menu')
const gameOverScreenEl = document.getElementById('game-over-screen')
const gameOverTitleEl = document.getElementById('game-over-title')
const gameOverScoreEl = document.getElementById('game-over-score')
function showGameOverScreen(playerWon) {
  menuState.mode = 'menu'
  if (controls.isLocked) { suppressPauseOnUnlock = true; controls.unlock() }
  // l'evento 'unlock' (sopra) mostra SEMPRE hint.style.display='' (pensato
  // per M/spectate, dove serve un nuovo click per rilockare) — stesso
  // motivo per cui openPauseMenu() lo sovrascrive esplicitamente subito
  // dopo (MainMenu.js): qui c'è una vera title screen, non "click per
  // entrare". Bug reale segnalato dal vivo: senza questa riga, "Click to
  // enter" restava visibile sopra la title screen E sopra il menu
  // principale dopo BACK TO MAIN MENU, rendendo il gioco bloccato/confuso
  hint.style.display = 'none'
  gameOverTitleEl.textContent = playerWon ? 'YOU WON' : 'GAME OVER'
  gameOverTitleEl.classList.toggle('won', playerWon)
  gameOverTitleEl.classList.toggle('lost', !playerWon)
  gameOverScoreEl.textContent = `${getScore()} - ${getEnemyScoreValue()}`
  gameOverScreenEl.classList.remove('hidden')
}

// possessionResetHandler/getScore/getEnemyScoreValue: assegnate DOPO
// initMainMenu/initShootingSystem più sotto — queste callback vengono
// COSTRUITE ora (passate a initShootingSystem, che deve esistere prima di
// initMainMenu perché quest'ultimo dipende dai SUOI valori di ritorno,
// es. clearAllCollisionCooldowns/shotVelocity — non si può invertire
// l'ordine) ma CHIAMATE solo più tardi durante il gameplay, quando tutte
// le funzioni reali sono già assegnate — stesso principio già usato per
// getManipulator/getBasketball nel progetto (funzione, non un valore
// catturato subito)
let possessionResetHandler = null
let getScore = null
let getEnemyScoreValue = null

// chiamata da ENTRAMBE le istanze di ShootingSystem (giocatore/nemico) ad
// ogni canestro fatto, in QUALUNQUE game mode (l'agnosticismo è nel
// chiamante — ShootingSystem.js non sa nulla di PRACTICE/1V1) — qui decide
// cosa fare: in PRACTICE niente (nessun avversario a cui ridare la palla),
// in 1V1 o la partita finisce (win condition) o parte il turnover di
// possesso (vera regola del basket: chi SUBISCE il canestro riparte con
// la palla)
function handleMadeBasket(scoringManipulator) {
  if (menuState.gameMode !== GameMode.ONE_V_ONE) return
  if (getScore() >= WIN_SCORE) { showGameOverScreen(true); return }
  if (getEnemyScoreValue() >= WIN_SCORE) { showGameOverScreen(false); return }
  const defendingManipulator = scoringManipulator === manipulator ? enemyManipulator : manipulator
  startTurnoverFade(() => possessionResetHandler?.(defendingManipulator))
}

// Palla fuori campo (1V1): se resta libera (non HANDLED) FUORI dal
// rettangolo delle linee dipinte (courtBounds, vedi caricamento GLTF
// campo sopra) per più di OUT_OF_BOUNDS_RECOVERY_TIME senza che nessuno la
// recuperi, passa all'avversario di chi l'ha fatta uscire — basketball.owner
// resta leggibile anche a palla libera (Basketball.js, non azzerato da
// FREE), è "l'ultimo che l'ha toccata/tenuta", non il possessore attuale
const OUT_OF_BOUNDS_RECOVERY_TIME = 2
const outOfBoundsState = { timer: 0 }
function updateOutOfBoundsTimer(delta) {
  if (!basketball || !courtBounds) { outOfBoundsState.timer = 0; return }
  const pos = basketball.position
  const isOutside = pos.x < courtBounds.min.x || pos.x > courtBounds.max.x || pos.z < courtBounds.min.z || pos.z > courtBounds.max.z
  const isLoose = basketball.state !== BallState.HANDLED
  if (!isOutside || !isLoose || !basketball.owner) { outOfBoundsState.timer = 0; return }
  outOfBoundsState.timer += delta
  if (outOfBoundsState.timer < OUT_OF_BOUNDS_RECOVERY_TIME) return
  outOfBoundsState.timer = 0
  const faultManipulator = basketball.owner
  const opponentManipulator = faultManipulator === manipulator ? enemyManipulator : manipulator
  startTurnoverFade(() => possessionResetHandler?.(opponentManipulator))
}

// Shooting System: tiro, hoop assist, punteggio, preview di traiettoria —
// estratti in src/ShootingSystem.js. rimRingRadius passato direttamente
// (const importata da CollisionWorld.js, mai riassegnata — nessun bisogno
// di getter).
const {
  addScore, checkHoopScore, clearAllCollisionCooldowns, triggerShoot,
  updateShotFlight, updateShootAnimation, updateTrajectoryPreview, hideTrajectoryPreview,
  shotVelocity, trajDebug,
  resetScore: resetShootingScore,
  getScore: getPlayerScoreValue,
} = initShootingSystem({
  ...gameContext,
  getManipulator: () => manipulator, dribbleState, handlingState, shootingState,
  computeAimPitchOffset, getShotDirection,
  collisionWorld,
  rimRingRadius: RIM_RING_RADIUS,
  getTargetHoopIndex: getPlayerTargetHoopIndex,
  onScore: handleMadeBasket,
})
getScore = getPlayerScoreValue

// --- Nemico (1v1, Section 3): stessa identica macchina a stati/fisica,
// pilotata dall'AI (src/EnemyAI.js) invece che da mouse/tastiera — un set
// di oggetti-stato indipendente, MAI condiviso col giocatore: i due robot
// palleggiano/mirano/tirano ognuno per conto proprio
const enemyShootingState = {
  phase: 'idle', phaseT: 0, timeSinceTrigger: 0, released: false, hasBounced: false, wasInsideArc: false,
  stateTransitionTimer: 0,
  startElbowOffset: 0, startLink1Offset: 0, startGrip: 0, startTilt: 0,
  recoverStartAimPitch: 0,
  releaseOrigin: new THREE.Vector3(),
}
const enemyPickupState = { phase: 'idle', phaseT: 0 }
const enemyDribbleState = createDribbleState()
const enemyHandlingState = { grip: 0, tiltOffset: 0 }

const {
  resetDribbleState: enemyResetDribbleState,
  updateDribble: enemyUpdateDribble, updateHandling: enemyUpdateHandling,
  checkForPickup: enemyCheckForPickup, updatePickup: enemyUpdatePickup,
} = initBallPossession({
  ...gameContext,
  getManipulator: () => enemyManipulator,
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
  triggerShoot: enemyTriggerShoot,
  getScore: getEnemyScoreValueFn,
} = initShootingSystem({
  ...gameContext,
  getManipulator: () => enemyManipulator,
  dribbleState: enemyDribbleState, handlingState: enemyHandlingState, shootingState: enemyShootingState,
  computeAimPitchOffset: () => 0, getShotDirection: enemyGetShotDirection,
  collisionWorld,
  rimRingRadius: RIM_RING_RADIUS,
  scoreElementId: 'enemy-score-value', // contatore separato dal giocatore — vedi Point System 1v1
  getTargetHoopIndex: getEnemyTargetHoopIndex,
  onScore: handleMadeBasket,
})
getEnemyScoreValue = getEnemyScoreValueFn

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
  getManipulator: () => manipulator, getOtherManipulator: () => enemyManipulator,
  resetDribbleState, otherResetDribbleState: enemyResetDribbleState,
  dribbleState, getBasketball: () => basketball,
  otherShootingState: enemyShootingState, otherHandlingState: enemyHandlingState,
  otherStealState: enemyStealState, otherPickupState: enemyPickupState, sfx,
  stealState, blockState, shootingState, pickupState, handlingState,
  // sweep di STEAL: parte da dove sta guardando la camera (crosshair),
  // non da dove puntano le ruote — in NO_BALL l'orbita è libera rispetto
  // al movimento, altrimenti lo sweep poteva partire "di lato"
  getAimYaw: () => cameraState.orbitYaw,
  getBallRadius: () => BALL_RADIUS,
})
const {
  triggerSteal: enemyTriggerSteal, triggerBlock: enemyTriggerBlock,
  updateSteal: enemyUpdateSteal, updateBlock: enemyUpdateBlock,
  canUseSteal: enemyCanUseSteal,
} = initCombatMoves({
  getManipulator: () => enemyManipulator, getOtherManipulator: () => manipulator,
  resetDribbleState: enemyResetDribbleState, otherResetDribbleState: resetDribbleState,
  dribbleState: enemyDribbleState, getBasketball: () => basketball,
  otherShootingState: shootingState, otherDashState: dashState, otherHandlingState: handlingState,
  otherStealState: stealState, otherPickupState: pickupState, sfx,
  stealState: enemyStealState, blockState: enemyBlockState, shootingState: enemyShootingState,
  pickupState: enemyPickupState, handlingState: enemyHandlingState,
  getBallRadius: () => BALL_RADIUS,
})

// HUD combat-panel (solo giocatore — il nemico non ha una sua barra a
// schermo, l'AI decide da sola): un array-config invece di ripetere lo
// stesso blocco fillEl/cooldownFor/canUse due volte (vedi animate() sotto)
const COMBAT_BAR_CONFIG = [
  { fillEl: stealBarFill, state: stealState, cooldownFor: stealCooldownFor, statKey: 'steal', canUse: canUseSteal },
  { fillEl: blockBarFill, state: blockState, cooldownFor: blockCooldownFor, statKey: 'block', canUse: canUseBlock },
]

// tasti STEAL/BLOCK (solo Play E solo 1V1 — in PRACTICE non c'è nessun
// avversario da derubare/bloccare; solo in NO_BALL, gate/cooldown gestiti
// internamente da initCombatMoves — qui solo il trigger dell'input)
document.addEventListener('keydown', e => {
  if (menuState.mode !== 'play' || e.repeat || menuState.gameMode !== GameMode.ONE_V_ONE) return
  if (e.code === 'KeyQ') triggerSteal()
  else if (e.code === 'KeyE') triggerBlock()
})

// AI del nemico (src/EnemyAI.js): decide lo stato tattico (CHASE_BALL/
// ATTACK/DEFEND) e pilota enemyManipulator ogni frame — le funzioni
// di palleggio/tiro/STEAL/BLOCK sopra restano identiche a quelle del
// giocatore, l'AI le aziona (setState/trigger dei tempi giusti) invece di
// mouse/tastiera
const { update: updateEnemyAI, resetWheelsAngle: resetEnemyWheelsAngle } = initEnemyAI({
  getEnemyManipulator: () => enemyManipulator, getPlayerManipulator: () => manipulator, getBasketball: () => basketball, collisionWorld,
  enemyShootingState,
  triggerSteal: enemyTriggerSteal, triggerBlock: enemyTriggerBlock, triggerShoot: enemyTriggerShoot,
  targetHoopIndex: TEAM_HOOP_INDEX[Team.B],
  playerTargetHoopIndex: TEAM_HOOP_INDEX[Team.A],
  canUseSteal: enemyCanUseSteal,
  getEffectiveShotSpeed: enemyGetEffectiveShotSpeed,
  playerShootingState: shootingState,
  enemyStealState, enemyBlockState,
})

// Debug (pannello P, "Animation Preview"): forza lo stato/l'animazione del
// robot ATTIVO a scelta, bypassando il percorso normale (tasto destro
// tenuto, camminare vicino alla palla, ecc.) — richiesto dal vivo: in Play,
// HANDLING è raggiungibile solo tenendo il tasto destro con la camera
// agganciata al robot (niente vista libera); passare a Spectate (M) per
// girarci attorno forza però releaseBallHandling() (vedi keydown KeyM
// sopra), quindi la posa non era MAI ispezionabile da un angolo a scelta.
// Ogni funzione usa getManipulator() fresco (non "manipulator" catturato
// per valore): deve operare sulla classe ATTIVA ORA, anche se cambiata dal
// menu dopo la costruzione di questi bottoni
function debugForceBallOwnership() {
  if (!basketball) return
  basketball.setState(BallState.HANDLED)
  basketball.setOwner(manipulator)
}
function debugPreviewDribble() {
  shootingState.phase = 'idle'
  shootingState.released = false
  manipulator.setState(RobotState.DRIBBLE)
  debugForceBallOwnership()
  resetDribbleState()
}
function debugPreviewHandling() {
  shootingState.phase = 'idle'
  shootingState.released = false
  manipulator.setState(RobotState.HANDLING)
  debugForceBallOwnership()
}
function debugPreviewShoot() {
  debugPreviewHandling()
  triggerShoot()
}
// Jump (Legged)/Flight (Drone) — no-op innocuo per MANIPULATOR (Dash resta
// il suo meccanismo separato, non passa da onSpecialMoveStart/Update, vedi
// RobotBase.js): bypassa charges/cooldown apposta, vedi debugPreviewState sopra
function debugPreviewSpecialMove() {
  manipulator.onSpecialMoveStart()
  debugPreviewState.specialMoveActive = true
}

// Pannello debug (tasto P): costruzione slider/readout in src/debugPanel.js
// — i 6 valori ancora `let` sciolti qui (usati anche altrove in main.js,
// non consolidati in oggetto) passati come coppie getter/setter, stesso
// principio di getBallRadius già in gameContext
const { cameraPanel, updateReadouts } = initDebugPanel({
  ...gameContext,
  // manipulator/dribbleState/pickupState non sono più in gameContext (sono
  // per-robot dopo il refactor 1v1) — il pannello debug resta SOLO per il
  // robot del giocatore, li passa espliciti qui. playerRobots (le 3
  // istanze MANIPULATOR/LEGGED/DRONE, non solo quella attiva ORA): la
  // sezione Ball Offset deve mostrare ed editare tutte e tre insieme
  // (sottomenu per classe), non solo quella che si sta giocando in questo
  // momento — altrimenti tarare LEGGED/DRONE richiederebbe uscire e
  // rientrare in partita selezionando ogni classe una alla volta
  getManipulator: () => manipulator, dribbleState, pickupState, playerRobots, droneTuning,
  trajDebug, pickupMargin: PICKUP_MARGIN,
  setBallRadius: v => { BALL_RADIUS = v; if (basketball) basketball.scale.setScalar(v) },
  getHandlingHeightBoost: () => HANDLING_HEIGHT_BOOST,
  setHandlingHeightBoost: v => { HANDLING_HEIGHT_BOOST = v },
  getHandlingCameraSideOffset: () => HANDLING_CAMERA_SIDE_OFFSET,
  setHandlingCameraSideOffset: v => { HANDLING_CAMERA_SIDE_OFFSET = v },
  getArmYawOffsetDeg: () => ARM_YAW_OFFSET_DEG,
  setArmYawOffsetDeg: v => { ARM_YAW_OFFSET_DEG = v },
  getCrosshairHeight: () => CROSSHAIR_HEIGHT,
  setCrosshairHeight: v => { CROSSHAIR_HEIGHT = v; updateCrosshairPosition() },
  setSuppressPauseOnUnlock: v => { suppressPauseOnUnlock = v },
  debugPreviewDribble, debugPreviewHandling, debugPreviewShoot, debugPreviewSpecialMove,
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
const { openPauseMenu, resetGameplayState, backToMainMenu } = initMainMenu({
  ...gameContext,
  // manipulator/shootingState/handlingState/pickupState non sono più in
  // gameContext (per-robot dopo il refactor 1v1) — il reset di
  // BACK TO MAIN MENU riguarda solo il giocatore, passati espliciti qui
  getManipulator: () => manipulator, shootingState, handlingState, pickupState,
  stealState, blockState,
  // il nemico va resettato insieme (posizione dal proprio lato, stato
  // pulito) altrimenti BACK TO MAIN MENU → PRACTICE riparte con l'IA a
  // metà tiro/palleggio di prima, o dalla parte sbagliata di campo
  getEnemyManipulator: () => enemyManipulator, enemyShootingState, enemyHandlingState, enemyPickupState,
  enemyStealState, enemyBlockState, enemyShotVelocity,
  enemyResetDribbleState, enemyClearAllCollisionCooldowns, resetEnemyWheelsAngle,
  setActiveRobotClass, setActiveEnemyRobotClass,
  menuOverlayEl: document.getElementById('menu-overlay'),
  hint, dashPanel, combatPanel, crosshair, modeIndicator,
  scoreboardEl: document.getElementById('scoreboard'),
  enemyScoreboardEl: document.getElementById('enemy-score-col'),
  controlsHintEl: document.getElementById('controls-hint'),
  menuState,
  startTimeOfDayTransition, resetScore: resetShootingScore, resetEnemyScore: resetEnemyShootingScore,
  renderer, sun, ssaoPass,
  movementState, dashState, dashMaxCharges: DASH_MAX_CHARGES,
  shotVelocity, ORBIT_PITCH_REST,
  resetDribbleState, clearAllCollisionCooldowns, hideTrajectoryPreview,
})
// collega ora l'indirizzo indiretto passato a handleMadeBasket più sopra
// (vedi commento su possessionResetHandler) — da questo punto in poi ogni
// canestro (in entrambe le istanze di ShootingSystem, giocatore e nemico)
// attiva davvero il turnover di possesso in 1V1
possessionResetHandler = resetGameplayState

// title screen di fine partita: stesso identico "pulisci tutto e torna al
// menu" del bottone di pausa (backToMainMenu, MainMenu.js) — nasconde
// anche lo schermo di game-over stesso, che il pulsante di pausa non conosce
document.getElementById('game-over-back-btn').addEventListener('click', () => {
  gameOverScreenEl.classList.add('hidden')
  backToMainMenu()
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
// RobotClass/scale parametrizzati (non più AMRManipulator/45 hardcoded):
// ogni classe fissa la propria scala esplicitamente (vedi sopra, manipulator/
// enemyManipulator) — il default qui copre le due chiamate MANIPULATOR
// esistenti, le nuove chiamate (LEGGED MANIPULATOR) passano la propria classe/scala
// inquadra il bounding box reale (robot + raggio di escursione del pallone,
// non solo il robot a riposo — altrimenti il pallone in basso durante la
// spinta uscirebbe dal frame) — distanza minima per contenere tutti gli 8
// angoli nel frustum, vista di 3/4 dall'alto. Estratta da renderRobotCardPreview
// per essere riusata identica anche dal modal di zoom (eye icon): stessa
// matematica, solo marginFactor più basso per un'inquadratura più stretta
const PREVIEW_BALL_VERTICAL_MARGIN_FACTOR = 2
const previewFitCorner = new THREE.Vector3()
// ritorna `center` (Vector3) oltre a posizionare la camera — il modal di
// zoom (sotto) lo riusa come perno per l'orbita interattiva a trascinamento,
// le card non ne fanno nulla (il valore di ritorno resta ignorato lì)
function fitPreviewCameraToRobot(camera, robotRoot, ballRadius, marginFactor = 1.08) {
  const box = new THREE.Box3().setFromObject(robotRoot)
  // margine verticale doppio rispetto a X/Z: la palla scende fin quasi al
  // pavimento durante drop/rise, non solo di un raggio come in orizzontale
  box.expandByVector(new THREE.Vector3(ballRadius, ballRadius * PREVIEW_BALL_VERTICAL_MARGIN_FACTOR, ballRadius))
  const center = box.getCenter(new THREE.Vector3())
  const viewDir = new THREE.Vector3(0.9, 0.55, 1).normalize()
  const halfFovRad = THREE.MathUtils.degToRad(camera.fov / 2)
  let maxDist = 0
  for (let i = 0; i < 8; i++) {
    previewFitCorner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    ).sub(center)
    const alongView = previewFitCorner.dot(viewDir)
    const perp = Math.sqrt(Math.max(previewFitCorner.lengthSq() - alongView * alongView, 0))
    const distForCorner = perp / Math.tan(halfFovRad) - alongView
    if (distForCorner > maxDist) maxDist = distForCorner
  }
  const distance = maxDist * marginFactor
  camera.position.copy(center).addScaledVector(viewDir, distance)
  camera.lookAt(center)
  return center
}

function renderRobotCardPreview(targetElementId, activeFlagKey, RobotClass = AMRManipulator, scale = 45, team = Team.A) {
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

  // team passato al costruttore: applica lo stesso default di colore
  // (arancione/rosso) delle istanze vere — prima queste 6 preview
  // ignoravano completamente il team, mostrando sempre l'arancione di
  // fabbrica anche per le 3 card NEMICO (bug reale, incoerente col vero
  // colore in partita)
  const previewRobot = new RobotClass(team)
  previewRobot.controls.manipulatorScale(scale)
  // Team.A: riflette l'eventuale personalizzazione già salvata, non il
  // default di fabbrica — stesso principio già usato per la preview
  // zoomata (initRobotZoomModal)
  if (team === Team.A) {
    const saved = getSavedAllyColors()
    if (saved) previewRobot.controls.setColors(saved)
  }
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

  fitPreviewCameraToRobot(previewCamera, previewRobot.root, BALL_RADIUS)

  document.getElementById(targetElementId).replaceChildren(previewRenderer.domElement)

  // palleggio della preview: chiama stepDribble, la STESSA identica
  // funzione/simulazione del palleggio automatico vero (vedi sopra, non
  // una ricostruzione approssimata a parte) — solo con un proprio oggetto
  // state e il proprio robot/palla bersaglio. Nessun suono (onBounce
  // omesso): sfogliare i menu non deve produrre un thump ad ogni rimbalzo
  const previewDribbleState = createDribbleState()
  const previewClock = new THREE.Clock()
  // timestep fisso (DRIBBLE_FIXED_DT, la STESSA costante del palleggio vero
  // in animate()), non un dt variabile passato diretto a stepDribble: senza
  // l'accumulator la preview avanzava di un passo a framerate variabile
  // (jitter del rAF/vsync), risultando visibilmente meno fluida/"desincata"
  // rispetto al palleggio reale — che invece vede SEMPRE lo stesso dt piccolo
  // e costante indipendentemente da quanto è fluido il framerate quella volta
  let previewAccumulator = 0

  function tickPreview() {
    requestAnimationFrame(tickPreview)
    if (!menuState[activeFlagKey]) { previewClock.getDelta(); return } // consuma il delta senza animare, niente salto al rientro
    const previewFrameDelta = Math.min(previewClock.getDelta(), MAX_DELTA)
    previewAccumulator = Math.min(previewAccumulator + previewFrameDelta, DRIBBLE_FIXED_DT * 10)
    while (previewAccumulator >= DRIBBLE_FIXED_DT) {
      stepDribble(previewDribbleState, previewRobot, previewBall.position, DRIBBLE_FIXED_DT, { ballRadius: BALL_RADIUS })
      previewAccumulator -= DRIBBLE_FIXED_DT
    }
    // il Drone non ha una vera "walking animation" da innescare qui (la
    // preview fa solo palleggio, mai locomozione) — le pale però girano
    // SEMPRE anche da fermo (stesso principio di Drone.updateLocomotionAnimation,
    // mai chiamato in questa preview), quindi vanno azionate a parte
    if (previewRobot.controls.spinRotors) previewRobot.controls.spinRotors(previewFrameDelta, droneTuning.rotorSpinSpeed)
    previewRenderer.render(previewScene, previewCamera)
  }
  tickPreview()
  // usata da "Personalizza" (initRobotZoomModal) per aggiornare dal vivo
  // ANCHE la miniatura della card, non solo la preview zoomata — solo le 3
  // card ALLEATE lo richiamano davvero (vedi cardPreviewByKey sotto)
  return { setColors: colors => previewRobot.controls.setColors(colors) }
}
const cardPreviewByKey = {
  [ROBOT_KEYS.MANIPULATOR]: renderRobotCardPreview('robot-preview-manipulator', 'robotPreviewActive'),
}
renderRobotCardPreview('robot-preview-manipulator-enemy', 'enemyRobotPreviewActive', AMRManipulator, 45, Team.B)
menuState.leggedRobotPreviewActive = false
menuState.enemyLeggedRobotPreviewActive = false
cardPreviewByKey[ROBOT_KEYS.LEGGED] = renderRobotCardPreview('robot-preview-legged', 'leggedRobotPreviewActive', LeggedManipulator, 56.25)
renderRobotCardPreview('robot-preview-legged-enemy', 'enemyLeggedRobotPreviewActive', LeggedManipulator, 56.25, Team.B)
menuState.droneRobotPreviewActive = false
menuState.enemyDroneRobotPreviewActive = false
cardPreviewByKey[ROBOT_KEYS.DRONE] = renderRobotCardPreview('robot-preview-drone', 'droneRobotPreviewActive', Drone, 45)
renderRobotCardPreview('robot-preview-drone-enemy', 'enemyDroneRobotPreviewActive', Drone, 45, Team.B)

// --- Main Menu: modal di preview "zoomata" (eye icon sotto ogni card) ---
// stessa tecnica di renderRobotCardPreview (renderer offscreen + stepDribble
// vero) ma UN SOLO renderer/scena condiviso invece di uno per classe: si
// apre raramente (click esplicito dell'utente), a differenza delle 6 card
// che devono restare sempre pronte finché si sfoglia il menu — costruire/
// distruggere il robot ad ogni apertura invece di tenere altre 3 istanze
// sempre vive evita di triplicare ulteriormente il costo di setup già
// pagato dalle card preview
function disposeRobotPreviewRoot(root) {
  root.traverse(child => {
    if (!child.isMesh) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach(m => {
      for (const mapKey of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (m[mapKey]) m[mapKey].dispose()
      }
      m.dispose()
    })
  })
}


function initRobotZoomModal() {
  const modal = document.getElementById('robot-zoom-modal')
  const canvasContainer = document.getElementById('robot-zoom-canvas-container')
  const titleEl = document.getElementById('robot-zoom-title')

  const ZOOM_SIZE = 480
  const zoomRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  zoomRenderer.setSize(ZOOM_SIZE, ZOOM_SIZE)
  zoomRenderer.setPixelRatio(1)
  zoomRenderer.outputColorSpace = THREE.SRGBColorSpace
  zoomRenderer.toneMapping = THREE.ACESFilmicToneMapping
  zoomRenderer.domElement.style.maxWidth = '100%'
  zoomRenderer.domElement.style.maxHeight = '100%'
  canvasContainer.append(zoomRenderer.domElement)

  const zoomScene = new THREE.Scene()
  zoomScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
  const zoomKeyLight = new THREE.DirectionalLight(0xffffff, 1.8)
  zoomKeyLight.position.set(1, 1.2, 1)
  zoomScene.add(zoomKeyLight)

  const zoomCamera = new THREE.PerspectiveCamera(35, 1, 1, 10000)

  // stessa palla-sfera semplice delle card (vedi renderRobotCardPreview sul perché)
  const zoomBall = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.7 })
  )
  zoomScene.add(zoomBall)

  let zoomRobot = null
  let zoomDribbleState = null
  const zoomClock = new THREE.Clock()
  const zoomOrbitCenter = new THREE.Vector3()
  menuState.robotZoomActive = false

  // pannello colori — solo per il robot ALLEATO (pulsante "Personalizza",
  // mai sui bottoni Preview/sull'avversario): tracciato a parte perché
  // openZoom crea un'istanza NUOVA ad ogni apertura (mai la vera istanza di
  // gioco), quindi le modifiche vanno riapplicate esplicitamente sia allo
  // zoomRobot (preview live) sia a playerRobots[key] (la partita vera)
  const colorsPanel = document.getElementById('robot-zoom-colors')
  const colorInputs = {
    accent: document.getElementById('zoom-color-accent'),
    arm: document.getElementById('zoom-color-arm'),
    body: document.getElementById('zoom-color-body'),
  }
  let currentCustomizeKey = null
  function hexToCss(hex) { return '#' + hex.toString(16).padStart(6, '0') }
  // valori di fabbrica VERI (createArmAccentMaterials/ModelMaker default) —
  // accent/arm sono uniformi per le 3 classi, BODY no (il Drone ha uno
  // scafo scuro 0x2c3540 diverso dal grigio 0x8a8f96 di AMR/Legged). Il
  // pulsante Reset (sotto) deve tornare al vero default PER CLASSE, non
  // spalmare lo stesso body ovunque come fa la personalizzazione normale
  // (quella sì è deliberatamente uniforme per tutta la squadra)
  const DEFAULT_ACCENT = 0xe8942c
  const DEFAULT_ARM = 0x4a5560
  const DEFAULT_BODY_BY_KEY = {
    [ROBOT_KEYS.MANIPULATOR]: 0x8a8f96,
    [ROBOT_KEYS.LEGGED]: 0x8a8f96,
    [ROBOT_KEYS.DRONE]: 0x2c3540,
  }
  function applyColorsEverywhere(colors) {
    zoomRobot.controls.setColors(colors)
    if (!currentCustomizeKey) return
    // colori di SQUADRA, non della singola classe — applicati a tutte e 3
    // le istanze (partita vera + miniatura card) allo stesso modo di
    // getSavedAllyColors all'avvio
    for (const key of Object.keys(playerRobots)) {
      playerRobots[key].controls.setColors(colors)
      cardPreviewByKey[key]?.setColors(colors)
    }
    saveAllyColors(colors)
  }
  function applyCustomColorsFromInputs() {
    applyColorsEverywhere({ accent: colorInputs.accent.value, arm: colorInputs.arm.value, body: colorInputs.body.value })
  }
  Object.values(colorInputs).forEach(input => input.addEventListener('input', applyCustomColorsFromInputs))
  document.getElementById('zoom-color-reset').addEventListener('click', () => {
    if (!currentCustomizeKey) return
    // stringhe CSS (#rrggbb), non i numeri esadecimali delle costanti — la
    // persistenza (saveAllyColors) e getColors()/hexToCss si aspettano
    // sempre lo stesso formato del flusso normale (colorInputs.value),
    // altrimenti sessionStorage finiva con un formato diverso dopo un reset
    colorInputs.accent.value = hexToCss(DEFAULT_ACCENT)
    colorInputs.arm.value = hexToCss(DEFAULT_ARM)
    colorInputs.body.value = hexToCss(DEFAULT_BODY_BY_KEY[currentCustomizeKey])
    applyCustomColorsFromInputs()
  })

  function openZoom(key, { team = Team.A, customize = false } = {}) {
    const { RobotClass, scale, label } = ROBOT_CLASS_BY_KEY[key]
    if (zoomRobot) {
      zoomScene.remove(zoomRobot.root)
      disposeRobotPreviewRoot(zoomRobot.root)
    }
    // team passato al costruttore: applica lo stesso default di colore
    // (arancione/viola) delle istanze vere — vedi RobotBase.js
    zoomRobot = new RobotClass(team)
    zoomRobot.controls.manipulatorScale(scale)
    // Team.A: la preview deve riflettere l'eventuale personalizzazione già
    // salvata, non ripartire dal default di fabbrica ogni volta che si apre
    if (team === Team.A) {
      const saved = getSavedAllyColors()
      if (saved) zoomRobot.controls.setColors(saved)
    }
    zoomScene.add(zoomRobot.root)
    zoomDribbleState = createDribbleState()
    // marginFactor un po' più largo (0.95, prima 0.72) — "più grande E
    // zoomato" rispetto alle card (1.08) restava vero anche un filo più
    // indietro: 0.72 tagliava troppo vicino, il robot usciva dal frame
    // durante l'escursione del braccio nel palleggio
    zoomOrbitCenter.copy(fitPreviewCameraToRobot(zoomCamera, zoomRobot.root, BALL_RADIUS, 0.95))
    titleEl.textContent = label ?? ''
    zoomClock.getDelta() // scarta il tempo trascorso da chiuso, niente salto in avanti al primo frame
    menuState.robotZoomActive = true
    modal.classList.remove('hidden')

    currentCustomizeKey = customize ? key : null
    colorsPanel.classList.toggle('hidden', !customize)
    if (customize) {
      const colors = zoomRobot.controls.getColors()
      colorInputs.accent.value = hexToCss(colors.accent)
      colorInputs.arm.value = hexToCss(colors.arm)
      colorInputs.body.value = hexToCss(colors.body)
    }
  }

  function closeZoom() {
    menuState.robotZoomActive = false
    modal.classList.add('hidden')
  }

  document.querySelectorAll('[data-robot-zoom]').forEach(el => {
    el.addEventListener('click', e => {
      // non deve selezionare/navigare la card sottostante (l'intero
      // .menu-card ha già un proprio listener data-robot/data-robot-enemy)
      e.stopPropagation()
      // stesso bottone/markup in entrambe le griglie (ally/enemy) — il team
      // si distingue solo dal contenitore in cui si trova il bottone
      const team = el.closest('#menu-robot-enemy') ? Team.B : Team.A
      openZoom(el.dataset.robotZoom, { team })
    })
  })
  document.querySelectorAll('[data-robot-customize]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      // esiste solo nella griglia ALLEATA (index.html) — nessuna ambiguità di team
      openZoom(el.dataset.robotCustomize, { team: Team.A, customize: true })
    })
  })
  document.getElementById('robot-zoom-close').addEventListener('click', closeZoom)
  document.getElementById('robot-zoom-backdrop').addEventListener('click', closeZoom)

  // Orbita a trascinamento: click+drag orizzontale sul canvas ruota la
  // camera attorno a zoomOrbitCenter (stesso perno usato per l'inquadratura
  // iniziale), solo yaw — l'elevazione/distanza fissate da fitPreviewCameraToRobot
  // restano invariate, si gira solo "attorno" al robot. Ruota il vettore
  // camera→centro già esistente invece di ricalcolare da zero ad ogni
  // frame: più semplice e non richiede di rifare il fit dei bordi
  const ZOOM_ORBIT_SENSITIVITY = 0.008 // rad per pixel di trascinamento
  const zoomOrbitAxis = new THREE.Vector3(0, 1, 0)
  const zoomOrbitOffset = new THREE.Vector3()
  let isDraggingZoom = false
  let lastPointerX = 0
  zoomRenderer.domElement.addEventListener('pointerdown', e => {
    isDraggingZoom = true
    lastPointerX = e.clientX
  })
  window.addEventListener('pointermove', e => {
    if (!isDraggingZoom) return
    const deltaX = e.clientX - lastPointerX
    lastPointerX = e.clientX
    zoomOrbitOffset.copy(zoomCamera.position).sub(zoomOrbitCenter)
    zoomOrbitOffset.applyAxisAngle(zoomOrbitAxis, -deltaX * ZOOM_ORBIT_SENSITIVITY)
    zoomCamera.position.copy(zoomOrbitCenter).add(zoomOrbitOffset)
    zoomCamera.lookAt(zoomOrbitCenter)
  })
  window.addEventListener('pointerup', () => { isDraggingZoom = false })

  // stesso accumulator a timestep fisso di renderRobotCardPreview (vedi
  // commento lì) — resettato ad ogni apertura insieme a zoomDribbleState,
  // altrimenti un residuo dalla sessione precedente farebbe scattare subito
  // uno o più passi extra al primo frame dopo l'apertura
  let zoomAccumulator = 0

  function tickZoom() {
    requestAnimationFrame(tickZoom)
    if (!menuState.robotZoomActive || !zoomRobot) { zoomClock.getDelta(); return }
    const zoomFrameDelta = Math.min(zoomClock.getDelta(), MAX_DELTA)
    zoomAccumulator = Math.min(zoomAccumulator + zoomFrameDelta, DRIBBLE_FIXED_DT * 10)
    while (zoomAccumulator >= DRIBBLE_FIXED_DT) {
      stepDribble(zoomDribbleState, zoomRobot, zoomBall.position, DRIBBLE_FIXED_DT, { ballRadius: BALL_RADIUS })
      zoomAccumulator -= DRIBBLE_FIXED_DT
    }
    // stesso motivo di renderRobotCardPreview sopra: le pale del Drone
    // girano sempre, ma questa preview fa solo palleggio (mai locomozione)
    if (zoomRobot.controls.spinRotors) zoomRobot.controls.spinRotors(zoomFrameDelta, droneTuning.rotorSpinSpeed)
    zoomRenderer.render(zoomScene, zoomCamera)
  }
  tickZoom()
}
initRobotZoomModal()

// barre a blocchi delle stat sulla card robot (Main Menu → ROBOT): letture
// dirette da MANIPULATOR_STATS (src/robots/AMRManipulator.js), non valori
// ricopiati a mano nell'HTML — se una stat cambia in futuro la card resta
// allineata da sola. maxByStat riflette le scale reali usate altrove nel
// codice (SPEED/STEAL/BLOCK 1-5, SHOOTING 1-3 — vedi AMRManipulator.js/
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
  // bug reale (drift durante Flight): questo clamp girava SEMPRE, a
  // qualunque quota — backboard/muri/pali/panchine hanno box verticali che
  // arrivano ben oltre il livello del pavimento, quindi un Drone elevato a
  // FLIGHT_HEIGHT (400 unità locali) che si trova sopra uno di questi box
  // in X/Z veniva comunque respinto ogni frame (stessa identica logica
  // "velocità fittizia zero, solo correzione di posizione" del volo di
  // tiro) — percepito come un lento "drift" orizzontale mentre si è fermi
  // in aria, non un vero rimbalzo secco, perché la spinta fuori dal box
  // veniva ricalcolata da capo ad ogni frame quasi alla stessa posizione
  // limite. `isElevated` esiste solo su Drone (RobotBase/altre classi non
  // lo definiscono, quindi qui resta semplicemente undefined/falsy) —
  // stessa immunità già concessa a STEAL per lo stesso motivo (vedi
  // Drone.js): a quota di volo la geometria statica del campo non deve
  // più contare
  if (robot.isElevated) return
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

  // gira SEMPRE, indipendentemente dalla modalità: il cambio di fase del
  // giorno si sceglie dal Main Menu (menuState.mode==='menu') e deve restare
  // visibile mentre sfuma, non solo durante Play/Spectate
  updateTimeOfDayTransition(delta)

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
    // hard lock della mira per tutta l'animazione di tiro (windup/release/
    // recover): il solo freeze su cameraState.orbitYaw/orbitPitch (vedi
    // mousemove) non basta — PointerLockControls ha un SUO listener interno
    // che ruota camera.quaternion direttamente sul movementX/Y, indipendente
    // da cameraState. Con quel listener ancora attivo, il quaternion vero
    // veniva comunque spostato ad ogni mousemove; lo slerp verso il target
    // fisso in fondo ad animate() lo tirava indietro solo PARZIALMENTE
    // (camPosLerpFactor<1), quindi restava un residuo percepibile ad ogni
    // movimento del mouse invece di un vero blocco. controls.enabled=false
    // congela quel listener interno (onMouseMove controlla this.enabled)
    // senza staccare 'pointerlockchange'/'pointerlockerror' — NON usare
    // controls.disconnect(): in questa classe è un override completo che
    // rimuove anche quei due listener insieme a mousemove, quindi un ESC
    // premuto durante il tiro uscirebbe davvero dal pointer lock ma
    // controls.isLocked resterebbe bloccato a true per sempre (l'evento
    // 'unlock' da cui dipende il menu di pausa, main.js sopra, non
    // scatterebbe più) — game-breaking, richiede reload della pagina
    const shouldLockAim = shootingState.phase !== 'idle'
    if (shouldLockAim !== aimLockActive) {
      aimLockActive = shouldLockAim
      controls.enabled = !shouldLockAim
    }
    // R1 (base del manipolatore) segue l'orbit yaw della camera: stessa
    // convenzione sin/cos usata per camForward/movementState.facing, quindi a
    // cameraState.orbitYaw=0 la base è a riposo (nessuna rotazione extra) e il
    // braccio punta già "in avanti" di default. Indipendente dal
    // movimento: si mira col mouse, ci si muove con WASD
    const isHandlingNow = manipulator.state === RobotState.HANDLING
    const armYawLerpFactor = 1 - Math.exp(-manipulator.handlingTuning.transitionSpeed * delta)
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
    // applicata al movimento del nemico in EnemyAI.js. Fermo anche durante
    // la propria animazione di tiro (windup/release/recover): la posizione
    // a fine 'windup' determina forza/zona 2-3 punti (getEffectiveShotSpeed/
    // wasInsideArc, catturate al rilascio fisico in ShootingSystem.js) — se
    // il robot continuava a camminare durante l'animazione (0.35-0.65s),
    // poteva entrare/uscire dall'arco dei 3 punti DOPO che la preview
    // (congelata dal click in poi) aveva già mostrato una traiettoria a
    // un'altra forza, risultando in un tiro visibilmente diverso da quanto
    // previsto — nessun jump shot vero si muove comunque durante la spinta
    if (moveVec.lengthSq() > 0 && !isCombatMoveActive(stealState, blockState) && shootingState.phase === 'idle') {
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
    // stesso motivo del blocco WASD sopra: un dash ancora in corso (burst di
    // 0.15s, indipendente da quale tasto sia premuto ORA) non deve spostare
    // il robot dentro/fuori l'arco dei 3 punti a metà della propria
    // animazione di tiro — il tempo residuo resta congelato, riprende dove
    // era arrivato appena la palla è partita/l'animazione torna a 'idle'
    if (dashState.timeRemaining > 0 && shootingState.phase === 'idle') {
      // baseSpeed (non speed): il burst resta lo stesso anche se il dash
      // scatta durante HANDLING, non va scalato dalla riduzione del 75%
      manipulator.root.position.addScaledVector(dashDirection, manipulator.baseSpeed * DASH_SPEED_MULTIPLIER * delta)
      dashState.timeRemaining = Math.max(0, dashState.timeRemaining - delta)
    }
    // DOPO sia WASD sia dash: vedi clampRobotToCourt sopra, il motivo per
    // cui serve è tutto lì (il dash è il caso che lo rende visibile)
    clampRobotToCourt(manipulator)

    // mossa speciale generica (RobotBase.js): innocuo per MANIPULATOR (il
    // suo Dash resta il meccanismo sopra, cooldown/onSpecialMoveUpdate di
    // default restano no-op). isShooting congela una mossa già attiva
    // (Flight) mentre il tiro è a metà animazione — vedi commento in
    // RobotBase.updateSpecialMove
    manipulator.updateSpecialMove(delta, shootingState.phase !== 'idle')

    // blocchi indipendenti (stesso stile delle stat bar del menu): pieno/
    // verde se quella carica è pronta, altrimenti la ricarica in corso
    // riempie SOLO il primo blocco vuoto (le altre restano a 0%, in coda) —
    // MANIPULATOR legge dashState (2 cariche vere), Jump/Flight leggono
    // specialMoveState (1 carica, RobotBase.js) sullo stesso pannello HUD
    const specialCharges = USES_DASH_STATE ? dashState.charges : manipulator.specialMoveState.charges
    const specialRechargeTimer = USES_DASH_STATE ? dashState.rechargeTimer : manipulator.specialMoveState.rechargeTimer
    for (let i = 0; i < SPECIAL_MOVE_MAX_CHARGES; i++) {
      const fillEl = dashChargeFillEls[i]
      if (i < specialCharges) {
        fillEl.style.width = '100%'
        fillEl.classList.add('ready')
      } else if (i === specialCharges) {
        fillEl.style.width = `${(1 - specialRechargeTimer / SPECIAL_MOVE_COOLDOWN_TIME) * 100}%`
        fillEl.classList.remove('ready')
      } else {
        fillEl.style.width = '0%'
        fillEl.classList.remove('ready')
      }
    }

    // STEAL/BLOCK: grigio/opaco l'intero pannello quando si ha la palla
    // (le due mosse sono usabili SOLO in NO_BALL, non solo "fuori
    // cooldown") — le barre dentro seguono lo stesso schema del dash.
    // Loop invece di 2 blocchi quasi identici (fillEl/cooldownFor/canUse
    // per STEAL e per BLOCK) — stesso principio del loop dashChargeFillEls sopra
    combatPanel.classList.toggle('disabled', manipulator.state !== RobotState.NO_BALL)
    for (const { fillEl, state, cooldownFor, statKey, canUse } of COMBAT_BAR_CONFIG) {
      fillEl.style.width = `${(1 - state.cooldown / cooldownFor(manipulator.stats[statKey])) * 100}%`
      fillEl.classList.toggle('ready', canUse())
    }

    // il toro giace nel piano XY (asse/perno lungo Z), quindi la sua
    // direzione di rotolamento a riposo è l'asse X locale, non Z — va
    // compensata con un offset di -90° perché si allinei al movimento.
    // updateLocomotionAnimation (RobotBase.js) interpola invece di
    // applicare di scatto, per una sterzata rapida ma animata invece di un
    // flip istantaneo — di proprietà del robot, non più duplicata qui
    manipulator.updateLocomotionAnimation(movementState.facing - Math.PI / 2, delta, WHEEL_TURN_SPEED)

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

  // Debug: vedi commento su debugPreviewState sopra — gira SEMPRE (Play e
  // Spectate), non solo dentro il blocco Play. PRIMA di updateBallDispatch,
  // non dopo: quest'ultimo legge la posizione mondo di ballRestPoint (via
  // getObjectWorldPosition), che dipende da root.position.y — se
  // onSpecialMoveUpdate (che lo aggiorna durante 'rise'/'descend') girasse
  // DOPO, il ballRestPoint letto sarebbe sempre quello di un frame indietro,
  // un lag costante e percepibile per tutta la salita/discesa (bug reale,
  // segnalato dal vivo: "la ball is lagging behind mentre si sale" — non
  // c'era nel gameplay vero, dove updateSpecialMove gira già PRIMA di
  // updateBallDispatch dentro il blocco Play, solo in questo bottone debug)
  if (debugPreviewState.specialMoveActive) {
    manipulator.onSpecialMoveUpdate(delta)
    if (manipulator.specialMoveState.phase === 'idle') debugPreviewState.specialMoveActive = false
  }

  updateBallDispatch(delta, {
    manipulator, pickupState, shootingState, dispatchState: ballDispatchState,
    updatePickup, updateShotFlight, checkForPickup,
    resetDribbleState, updateHandling, updateDribble,
  })

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
    // stesso motivo del giocatore sopra — innocuo finché il nemico resta
    // sempre un MANIPULATOR (EnemyAI.js non aziona ancora nessuna mossa
    // speciale, giusto o sbagliato che sia il robot); isShooting congela
    // una mossa già attiva mentre il nemico sta tirando, stesso motivo del giocatore
    enemyManipulator.updateSpecialMove(delta, enemyShootingState.phase !== 'idle')

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

    // Niente preview di traiettoria/mira per il nemico (non c'è una camera
    // libera da inseguire, quella resta un concetto solo-giocatore)
    if (basketball && (enemyShootingState.phase !== 'idle' || enemyShootingState.stateTransitionTimer > 0)) enemyUpdateShootAnimation(delta)

    // stesso identico dispatch del giocatore sopra (updateBallDispatch),
    // sul proprio set di stati indipendente — basketball è condivisa, ma
    // solo UNO dei due robot alla volta la possiede davvero (Basketball.owner)
    updateBallDispatch(delta, {
      manipulator: enemyManipulator, pickupState: enemyPickupState, shootingState: enemyShootingState,
      dispatchState: enemyBallDispatchState,
      updatePickup: enemyUpdatePickup, updateShotFlight: enemyUpdateShotFlight, checkForPickup: enemyCheckForPickup,
      resetDribbleState: enemyResetDribbleState, updateHandling: enemyUpdateHandling, updateDribble: enemyUpdateDribble,
    })

    // regola "palla fuori campo" — solo mentre si gioca davvero (non in
    // pausa/menu: il timer non deve avanzare mentre il gioco è congelato)
    if (menuState.mode === 'play') updateOutOfBoundsTimer(delta)
  }
  // PRACTICE: STEAL/BLOCK non hanno senso senza un avversario reale (il
  // pannello combat-panel resta nascosto — vedi toggle su gameMode), niente
  // da aggiornare qui

  // dopo l'aggiornamento della palla per questo frame, qualunque stato
  // (giocatore o nemico) l'abbia mossa — vedi commento su updateBallSpin sopra
  if (basketball) updateBallSpin(delta)

  // preview di traiettoria: solo mentre si mira davvero (HANDLING, nessuna
  // animazione di tiro già in corso, palla non ancora rilasciata) — torna a
  // sparire subito al click. Ora che mira/posizione sono bloccate per tutta
  // windup/release/recover (controls.disconnect() sopra + freeze WASD/dash),
  // la preview non potrebbe comunque più cambiare durante l'animazione,
  // quindi tenerla in vista lì non aggiungeva informazione, solo rumore
  // visivo. Serve anche !shootingState.released: lo stato passa a NO_BALL
  // con un piccolo ritardo dopo il rilascio vero (shootTuning.
  // stateTransitionDelay), quindi c'è una finestra in cui manipulator.state
  // è ANCORA HANDLING e shootingState.phase è GIÀ tornato 'idle' (fine di
  // 'recover') — senza questo controllo la linea si riattaccava per un
  // istante alla palla già in volo/atterrata
  const showTrajectory = basketball && manipulator.state === RobotState.HANDLING && shootingState.phase === 'idle' && !shootingState.released
  if (showTrajectory) updateTrajectoryPreview()
  else hideTrajectoryPreview()

  if (!cameraPanel.classList.contains('hidden')) {
    updateReadouts()
  }

  updateCollisionDebugView()
  updateTurnoverFade(delta)

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
