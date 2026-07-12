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
import { ROBOT_KEYS, Team, GameMode, TimeOfDay } from './SharedEnums.js'
import { RobotState } from './robots/RobotBase.js'
import { createProceduralPBRMaps, drawBrushedMetal } from './robots/ModelMakers/AMRManipulatorModelMaker.js'
import { Basketball, BallState } from './gameplay/Basketball.js'
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
// antialias:true would have no effect: rendering goes through
// EffectComposer render targets (no MSAA), AA is done by SMAAPass
const renderer = new THREE.WebGLRenderer()
// pixelRatio 1: devicePixelRatio 2 quadruples the SSAO pass cost
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

// near=0.1 with far=5000 (1:50000 ratio) saturates depth precision and
// breaks the SSAO depth texture at distance
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 5, 5000)
// 'YXZ' matches PointerLockControls internals: the default 'XYZ' order
// produced a spurious roll component on a camera that cannot roll
camera.rotation.order = 'YXZ'
// Spawn tuned via the debug panel (P)
camera.position.set(590, 540, 565)
camera.rotation.set(THREE.MathUtils.degToRad(-60), THREE.MathUtils.degToRad(35), 0)

// --- Audio ---
// AudioListener + Web Audio synthesized sounds, no external assets
const sfx = new SoundEffects(camera)

// --- Post-processing (SSAO) ---
// kernelRadius is in world units; minDistance/maxDistance are NORMALIZED
// depth fractions (0..1 over near-far), so they are derived from
// kernelRadius / (far - near), never passed in world units
const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight, 16)
// Large kernelRadius created dark halos around silhouettes (samples hit
// far surfaces and read them as local occlusion)
ssaoPass.kernelRadius = 12
const depthRange = camera.far - camera.near
ssaoPass.maxDistance = (ssaoPass.kernelRadius / depthRange) * 1.5
ssaoPass.minDistance = ssaoPass.maxDistance / 20
composer.addPass(ssaoPass)

composer.addPass(new OutputPass())

// SMAA last: works on the composited/tone-mapped image
const smaaPass = new SMAAPass(window.innerWidth, window.innerHeight)
composer.addPass(smaaPass)

// --- Lights ---
// Warm tones approximating the Sketchfab environment lighting
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
// Shadow acne fix: huge frustum (±2500) on 4096px means low texel density,
// self-shadowing patches on surfaces nearly parallel to the light
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 2
scene.add(sun)

// Procedural skybox (Preetham model, three.js addons, no HDR asset).
// BackSide box scaled just under camera.far so it stays behind everything
// without leaving the clipping frustum
const sky = new Sky()
sky.scale.setScalar(4800)
scene.add(sky)

// NIGHT does not use the procedural Sky: the Preetham model degenerates
// below the horizon (daylight scattering, not darkness). Flat color
// applied only AT REST on NIGHT (sky hidden); during a fade to/from NIGHT
// the Sky stays visible and animated, the swap happens at fade end
const NIGHT_FLAT_BG = 0x0a1030

// Per-phase lighting presets: hemi/sun color+intensity, sun position and
// Sky atmosphere. The Sky sun direction is NOT a separate parameter: it
// is always derived from sunPos normalized (hand-tuned separate
// elevation/azimuth drifted 80-100 degrees from the real shadows). NIGHT
// keeps a high sunPos like DAY (only a coherent shadow direction is
// needed, the Sky is hidden in that preset)
const TIME_OF_DAY_PRESETS = {
  [TimeOfDay.SUNRISE]: { hemiSky: 0xffb08a, hemiGround: 0x9a5a40, hemiIntensity: 0.9, sunColor: 0xffae5c, sunIntensity: 1.0, sunPos: [1500, 400, -800], skyTurbidity: 8, skyRayleigh: 2.5, skyMie: 0.01, skyMieG: 0.9 },
  [TimeOfDay.DAY]:     { hemiSky: 0xffd0c8, hemiGround: 0xc09080, hemiIntensity: 1.2, sunColor: 0xfff5ee, sunIntensity: 1.2, sunPos: [1500, 1200, -800], skyTurbidity: 3, skyRayleigh: 1.2, skyMie: 0.003, skyMieG: 0.8 },
  [TimeOfDay.SUNSET]:  { hemiSky: 0xff8a5c, hemiGround: 0x7a3a2a, hemiIntensity: 0.85, sunColor: 0xff7040, sunIntensity: 0.9, sunPos: [-1500, 300, 800], skyTurbidity: 14, skyRayleigh: 4.5, skyMie: 0.02, skyMieG: 0.95 },
  [TimeOfDay.NIGHT]:   { hemiSky: 0x3a4a7c, hemiGround: 0x10101c, hemiIntensity: 0.6, sunColor: 0x6a8fd0, sunIntensity: 0.5, sunPos: [1500, 1200, -800], skyTurbidity: 4, skyRayleigh: 0.5, skyMie: 0.005, skyMieG: 0.8 },
}

// Animated transition state (ramp/crossfade instead of a hard cut).
// Scratch objects reused, never reallocated during the fade
const TIME_OF_DAY_TRANSITION_DURATION = 2.5
const timeOfDayTransition = {
  active: false, elapsed: 0, toTime: TimeOfDay.SUNRISE,
  fromHemiSky: new THREE.Color(), fromHemiGround: new THREE.Color(), fromHemiIntensity: 0,
  fromSunColor: new THREE.Color(), fromSunIntensity: 0, fromSunPos: new THREE.Vector3(),
  fromSkyTurbidity: 0, fromSkyRayleigh: 0, fromSkyMie: 0, fromSkyMieG: 0,
  fromHoopSpotIntensity: 0,
}
const presetColorScratch = new THREE.Color()
const presetSunPosScratch = new THREE.Vector3()

// Apply a preset with NO transition, page-load initial state only. Also
// cancels a running fade: an instant set must always win
function applyTimeOfDayPreset(time) {
  timeOfDayTransition.active = false
  const preset = TIME_OF_DAY_PRESETS[time]
  hemi.color.set(preset.hemiSky)
  hemi.groundColor.set(preset.hemiGround)
  hemi.intensity = preset.hemiIntensity
  sun.color.set(preset.sunColor)
  sun.intensity = preset.sunIntensity
  sun.position.set(...preset.sunPos)
  // Sky sun direction = sunPos normalized, never a separate parameter:
  // alignment with the real shadows guaranteed by construction
  sky.material.uniforms.sunPosition.value.copy(sun.position).normalize()
  sky.material.uniforms.turbidity.value = preset.skyTurbidity
  sky.material.uniforms.rayleigh.value = preset.skyRayleigh
  sky.material.uniforms.mieCoefficient.value = preset.skyMie
  sky.material.uniforms.mieDirectionalG.value = preset.skyMieG
  // NIGHT: flat color instead of the Sky (see NIGHT_FLAT_BG)
  sky.visible = time !== TimeOfDay.NIGHT
  scene.background = time === TimeOfDay.NIGHT ? new THREE.Color(NIGHT_FLAT_BG) : null
  // Hoop spotlights on only at SUNSET/NIGHT. NEVER .visible = false: a
  // shadow-casting light turning visible for the first time allocates its
  // shadow map and compiles shaders on the spot (perceptible hitch).
  // Intensity 0 keeps it in the pipeline, ready from frame one
  const spotsOn = time === TimeOfDay.SUNSET || time === TimeOfDay.NIGHT
  for (let i = 0; i < hoopSpotlights.length; i++) hoopSpotlights[i].intensity = spotsOn ? HOOP_SPOTLIGHT_INTENSITY : 0
}

// Start the ANIMATED change (TIME OF DAY card click). The "from" snapshot
// is taken from the LIVE current values, not the nominal preset: a fade
// interrupted mid-way restarts from where it really got to
function startTimeOfDayTransition(time) {
  // Re-enable the Sky for the fade duration, whatever the endpoints: at
  // rest on NIGHT (flat bg) the fade must still animate through the Sky
  sky.visible = true
  scene.background = null
  const t = timeOfDayTransition
  t.fromHemiSky.copy(hemi.color)
  t.fromHemiGround.copy(hemi.groundColor)
  t.fromHemiIntensity = hemi.intensity
  t.fromSunColor.copy(sun.color)
  t.fromSunIntensity = sun.intensity
  t.fromSunPos.copy(sun.position)
  t.fromSkyTurbidity = sky.material.uniforms.turbidity.value
  t.fromSkyRayleigh = sky.material.uniforms.rayleigh.value
  t.fromSkyMie = sky.material.uniforms.mieCoefficient.value
  t.fromSkyMieG = sky.material.uniforms.mieDirectionalG.value
  t.fromHoopSpotIntensity = hoopSpotlights[0]?.intensity ?? 0
  t.toTime = time
  t.elapsed = 0
  t.active = true
}

// Called every frame from animate(), even in menu mode (the change is
// picked right there and must stay visible while fading). Immediate no-op
// when no transition is active
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
  // Derived from the sun.position just interpolated above, not a second
  // independent lerp that could drift mid-fade
  sky.material.uniforms.sunPosition.value.copy(sun.position).normalize()
  sky.material.uniforms.turbidity.value = THREE.MathUtils.lerp(t.fromSkyTurbidity, preset.skyTurbidity, e)
  sky.material.uniforms.rayleigh.value = THREE.MathUtils.lerp(t.fromSkyRayleigh, preset.skyRayleigh, e)
  sky.material.uniforms.mieCoefficient.value = THREE.MathUtils.lerp(t.fromSkyMie, preset.skyMie, e)
  sky.material.uniforms.mieDirectionalG.value = THREE.MathUtils.lerp(t.fromSkyMieG, preset.skyMieG, e)

  // Spotlights fade via intensity too, never a hard .visible toggle
  const spotsOn = t.toTime === TimeOfDay.SUNSET || t.toTime === TimeOfDay.NIGHT
  const targetHoopIntensity = spotsOn ? HOOP_SPOTLIGHT_INTENSITY : 0
  const hoopIntensity = THREE.MathUtils.lerp(t.fromHoopSpotIntensity, targetHoopIntensity, e)
  for (let i = 0; i < hoopSpotlights.length; i++) hoopSpotlights[i].intensity = hoopIntensity

  if (linearT >= 1) {
    t.active = false
    // Fade complete: only now swap to the flat NIGHT background
    if (t.toTime === TimeOfDay.NIGHT) {
      sky.visible = false
      scene.background = new THREE.Color(NIGHT_FLAT_BG)
    }
  }
}

// Street lamps: 4 point lights at the GLTF globe positions, extracted by
// composing the full GLTF node matrix chain (including Sphere_1 local
// scale/offset)
const lampPositions = [
  [615.87, 268, -845],
  [615.87, 268, 845],
  [-615.87, 268, -845],
  [-615.87, 268, 845],
]
for (let lampIndex = 0; lampIndex < lampPositions.length; lampIndex++) {
  const [x, y, z] = lampPositions[lampIndex]
  // Intensity is candela with decay=2 (physical, three.js r155+): at
  // ~250 units lamp-to-ground it needs this order of magnitude
  const lamp = new THREE.PointLight(0xfff2c0, 130000, 400, 2)
  lamp.position.set(x, y, z)
  lamp.castShadow = true
  // Small map: 4 point lights = 24 cubemap passes/frame, keep it light
  lamp.shadow.mapSize.set(512, 512)
  // near > globe radius (~26): the light sits at the center of the solid
  // sphere, a smaller near self-shadows against its own shell
  lamp.shadow.camera.near = 30
  lamp.shadow.camera.far = 400
  // Softer PCF blur edge (default 1 is nearly invisible)
  lamp.shadow.radius = 6
  // Same shadow acne cause/fix as the sun
  lamp.shadow.bias = -0.0005
  lamp.shadow.normalBias = 2
  scene.add(lamp)
}

// Hoop spotlights: SpotLight over each rim plus a visible fixture mesh.
// Hoop XZ coordinates repeated as literals (hoops does not exist yet at
// this point). Fixture uses the robot chassis material recipe; pole/arm
// start with a placeholder and get sharedWoodMaterial after the court
// GLTF loads. poleMetalMaps is still needed by the lamp pole in the GLTF
// traverse below, do not remove
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
const HOOP_SPOTLIGHT_Y = 450 // above the backboard top edge (340)
const HOOP_SPOTLIGHT_BACK_OFFSET = 150 // behind the rim, away from center court
const HOOP_POLE_RADIUS = 8
// Candela. Shared constant: applyTimeOfDayPreset toggles back to it
const HOOP_SPOTLIGHT_INTENSITY = 180000
const hoopPolePlaceholderMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8 })
const hoopSpotlightFixtureGeometry = new THREE.BoxGeometry(24, 16, 30)
// Created now, reassigned to sharedWoodMaterial after the court loads
const hoopPoleMeshes = []
// Lit only at SUNSET/NIGHT (applyTimeOfDayPreset)
const hoopSpotlights = []
for (let hoopIndex = 0; hoopIndex < HOOP_SPOTLIGHT_POSITIONS.length; hoopIndex++) {
  const { x, z } = HOOP_SPOTLIGHT_POSITIONS[hoopIndex]
  // L-shaped pole: vertical segment behind the backboard + horizontal arm
  // reaching over the rim, spotlight pointing straight down
  const poleX = x + Math.sign(x) * HOOP_SPOTLIGHT_BACK_OFFSET

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(HOOP_POLE_RADIUS, HOOP_POLE_RADIUS, HOOP_SPOTLIGHT_Y, 10), hoopPolePlaceholderMaterial)
  pole.position.set(poleX, HOOP_SPOTLIGHT_Y / 2, z)
  // No own shadow: pole/arm/fixture nearly share the light's position,
  // they would self-project artifacts
  pole.castShadow = false
  scene.add(pole)
  hoopPoleMeshes.push(pole)

  // Horizontal arm: cylinders are Y-aligned by default, rotated onto X
  const armLength = Math.abs(x - poleX)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(HOOP_POLE_RADIUS, HOOP_POLE_RADIUS, armLength, 10), hoopPolePlaceholderMaterial)
  arm.position.set((poleX + x) / 2, HOOP_SPOTLIGHT_Y, z)
  arm.rotation.z = Math.PI / 2
  arm.castShadow = false
  scene.add(arm)
  hoopPoleMeshes.push(arm)

  // Same large-scene photometric scale as the lamps above
  const spot = new THREE.SpotLight(0xfff2c0, HOOP_SPOTLIGHT_INTENSITY, 900, THREE.MathUtils.degToRad(52), 0.8, 2)
  spot.position.set(x, HOOP_SPOTLIGHT_Y, z)
  spot.target.position.set(x, 262.55, z) // straight down onto the rim
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
  fixture.castShadow = false // sits exactly on the light itself
  scene.add(fixture)
}
// SUNRISE default at page load (same default as menuState.timeOfDay).
// Must run AFTER hoopSpotlights: applyTimeOfDayPreset reads that array
applyTimeOfDayPreset(TimeOfDay.SUNRISE)

// --- Court ---
// Plugin for KHR_materials_pbrSpecularGlossiness, removed from three r152+.
// Converts diffuseFactor to color, glossinessFactor to roughness
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
// Only 2 async assets (court + ball, robots are procedural): real
// progress by counting completed loads, no fake percentages
const TOTAL_ASSETS_TO_LOAD = 2
let assetsLoadedCount = 0
const loadingScreenEl = document.getElementById('loading-screen')
const loadingBarFillEl = document.getElementById('loading-bar-fill')
const loadingLabelEl = document.getElementById('loading-label')
// Label follows the real phase: "Creating Robot Models" (HTML default,
// synchronous robot construction), then "Loading Environment Assets",
// then "Loading Textures" when only the ball remains
function markAssetLoaded() {
  assetsLoadedCount++
  loadingBarFillEl.style.width = `${Math.round((assetsLoadedCount / TOTAL_ASSETS_TO_LOAD) * 100)}%`
  if (assetsLoadedCount < TOTAL_ASSETS_TO_LOAD) loadingLabelEl.textContent = 'LOADING TEXTURES'
  else loadingScreenEl.classList.add('fade-out')
}

// Same procedural generator used for the robot textures, reused for
// benches and the lamp pole. Built once, not per mesh
const benchWoodMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 300), baseRoughness: 0.75, roughnessVariation: 0.15 })
// Benches AND tree trunks share the GLTF "wood" material: one shared clone
let sharedWoodMaterial = null
// Painted court lines mesh: its world bounding box (taken after
// scene.add, when the world matrix is final) becomes courtBounds, the
// playing rectangle for the out-of-bounds rule
let courtLinesMesh = null
let courtBounds = null
// Covers the real gap between the painted lines edge and the rims (~40
// units) plus normal under-basket rebounds. 250 made the trigger too rare
const COURT_BOUNDS_MARGIN = 100

loader.load('./models/court/basketball_court/scene.gltf', gltf => {
  gltf.scene.traverse(child => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    // z-fighting fix for the court lines (coplanar with the floor)
    if (child.material?.name === 'Basket_ball_lines') {
      child.material.polygonOffset = true
      child.material.polygonOffsetFactor = -1
      child.material.polygonOffsetUnits = -4
      child.renderOrder = 1
      courtLinesMesh = child
    }
    // Shared "wood" material: cloned once before adding the maps
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
    // Lamp pole: shares the floor material, cloned before recoloring.
    // Dotless name: GLTFLoader strips animation-path reserved chars
    if (child.name === 'Cylinder_5_floor1_0') {
      child.material = child.material.clone()
      // Visible dark grey (0x2b2b2e read as pure black under these lights)
      child.material.color.set(0x55555a)
      child.material.normalMap = poleMetalMaps.normalMap
      child.material.roughnessMap = poleMetalMaps.roughnessMap
      child.material.bumpMap = poleMetalMaps.heightMap
      child.material.bumpScale = 0.4
      child.material.roughness = 0.5
      child.material.metalness = 0.5 // the SpecularGlossiness plugin always zeroes metalness
    }
    // Ball bundled in the court model: removed, a dedicated one is used
    if (child.name === 'Sphere_Mat3_0') {
      child.parent.remove(child)
    }
  })
  scene.add(gltf.scene)
  // Hoop spotlight pole/arm: placeholder material until now, reassigned
  // to the shared wood populated during the traverse above
  if (sharedWoodMaterial) {
    for (let i = 0; i < hoopPoleMeshes.length; i++) hoopPoleMeshes[i].material = sharedWoodMaterial
  }
  // Only NOW (after scene.add) is the lines mesh world matrix final
  if (courtLinesMesh) {
    courtLinesMesh.updateWorldMatrix(true, false)
    courtBounds = new THREE.Box3().setFromObject(courtLinesMesh)
    // The rims already sit past the painted lines edge: without this
    // margin every rebound near the basket triggered the OOB timer
    courtBounds.expandByScalar(COURT_BOUNDS_MARGIN)
  }
  markAssetLoaded()
})

// --- Ball (dedicated model: color + normal + metallic/roughness maps) ---
// let: live-tunable from the debug panel, declared here because the debug
// menu setup below reads it
let BALL_RADIUS = 15 // world units, source sphere has radius 1
// >1 brightens the texel (not clamped) without tinting
const BALL_COLOR_BRIGHTNESS = 1.15
const collisionWorld = new CollisionWorld()
// Globals kept as loose `let` here: genuinely global values (camera/
// crosshair), not per-class geometry/animation (those are instance fields
// on RobotBase, see debugPanel.js)
let ARM_YAW_OFFSET_DEG = -36
let CROSSHAIR_HEIGHT = 115
// Closer camera reads lower/flatter: extra height keeps the arm in view
let HANDLING_HEIGHT_BOOST = 40
// Lateral offset in HANDLING: over-the-shoulder view, not straight behind
let HANDLING_CAMERA_SIDE_OFFSET = -60
// Shared by updateHandling and updateShootAnimation (elbow follows camera
// pitch with the same formula in both)
function computeAimPitchOffset() {
  // Player only (the enemy passes () => 0), so module-scope manipulator
  // is always the right instance
  return (cameraState.orbitPitch - ORBIT_PITCH_REST) * manipulator.shootTuning.elbowAimCoupling
}
// Basketball wrapper: position/scale proxy to the real mesh
let basketball = null
loader.load('./models/basketball_ball/scene.gltf', gltf => {
  gltf.scene.scale.setScalar(BALL_RADIUS)
  gltf.scene.traverse(child => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    // Slight brightening of the color map (multiplies texels, no tint)
    if (child.material?.color) child.material.color.multiplyScalar(BALL_COLOR_BRIGHTNESS)
  })
  basketball = new Basketball(gltf.scene)
  // Player starts in possession. Referencing `manipulator` (declared
  // later) is safe: this async callback runs after the whole sync script
  basketball.setState(BallState.HANDLED)
  basketball.setOwner(manipulator)
  scene.add(gltf.scene)
  markAssetLoaded()
})

// --- Robots ---
// ALL 3 classes are instantiated immediately, both sides (6 instances),
// hidden until active. Switching class from the Main Menu is only a
// reference reassignment + visibility toggle, never a reload. External
// consumers receive getManipulator/getEnemyManipulator (functions, not
// values): a value captured at destructure/spread time would keep
// pointing at the OLD instance forever (same footgun as getBasketball).
// Scale: 45 for MANIPULATOR/DRONE, 56.25 (45 x 1.25) for LEGGED
const ROBOT_CLASS_BY_KEY = {
  [ROBOT_KEYS.MANIPULATOR]: { RobotClass: AMRManipulator, scale: 45, label: 'MOBILE MANIPULATOR' },
  [ROBOT_KEYS.LEGGED]: { RobotClass: LeggedManipulator, scale: 56.25, label: 'LEGGED MANIPULATOR' },
  [ROBOT_KEYS.DRONE]: { RobotClass: Drone, scale: 45, label: 'DRONE' },
}

// Same spawn X as resetGameplayState (MainMenu.js), repeated here only
// for the very first boot
function buildRobotInstances(team, spawnX) {
  const instances = {}
  for (const key of Object.keys(ROBOT_CLASS_BY_KEY)) {
    const { RobotClass, scale } = ROBOT_CLASS_BY_KEY[key]
    const robot = new RobotClass(team)
    // Local units to world scale. Through controls.manipulatorScale (not
    // root.scale) so the tracked state stays coherent with Copy Config
    robot.controls.manipulatorScale(scale)
    // Per-instance default applied at construction
    robot.controls.setBallRestOffset(robot.ballRestExtraOffset)
    robot.root.position.set(spawnX, 0, 0)
    robot.root.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    scene.add(robot.root)
    // Hidden until active: the court must stay truly empty during the
    // menu (a visible robot and its shadow "ghosted" behind the overlay)
    robot.root.visible = false
    instances[key] = robot
  }
  return instances
}

const playerRobots = buildRobotInstances(Team.A, -300)
// Custom colors (Main Menu, Team.A only): a TEAM identity applied to all
// 3 instances. In-memory only, an F5 restarts from factory colors
let currentAllyColors = null
const enemyRobots = buildRobotInstances(Team.B, 300)
// Robot construction is synchronous, no loader callback can have run yet
loadingLabelEl.textContent = 'LOADING ENVIRONMENT ASSETS'
// RobotBase defaults to DRIBBLE, but the enemy does NOT own the ball at
// boot: without this its dribble would fight over the shared
// basketball.position. Applied to all 3 enemy instances
for (const key of Object.keys(enemyRobots)) enemyRobots[key].setState(RobotState.NO_BALL)

let manipulator = playerRobots[ROBOT_KEYS.MANIPULATOR]
let enemyManipulator = enemyRobots[ROBOT_KEYS.MANIPULATOR]

// --- Spectator Camera ---
const controls = new PointerLockControls(camera, renderer.domElement)
// True while controls.enabled is forced false (aim hard lock during the
// shot animation): avoids reassigning enabled every frame
let aimLockActive = false

const hint = document.getElementById('hint')
renderer.domElement.addEventListener('click', () => { if (!controls.isLocked && menuState.mode !== 'menu') controls.lock() })
controls.addEventListener('lock', () => hint.style.display = 'none')
// PointerLockControls cannot distinguish WHY an unlock happened (browser
// ESC vs unlock() from code): this flag marks code-initiated unlocks so
// they do not open the pause menu
let suppressPauseOnUnlock = false
controls.addEventListener('unlock', () => {
  hint.style.display = ''
  if (suppressPauseOnUnlock) { suppressPauseOnUnlock = false; return }
  // With the pointer locked the browser intercepts ESC before any keydown
  // reaches the page: this is the only reliable "just unlocked while
  // playing" signal. openPauseMenu is idempotent
  openPauseMenu()
})

const keys = {}
document.addEventListener('keydown', e => keys[e.code] = true)
document.addEventListener('keyup',   e => keys[e.code] = false)

const camDir = new THREE.Vector3()
const camRight = new THREE.Vector3()

// --- Spectate/Play modes (M key) ---
// Spectate: free-fly. Play: third-person orbit camera (mouse moves
// orbitYaw/orbitPitch), WASD relative to where the camera looks NOW.

// 'menu' is a third mode value (plain string, no FSM needed): while the
// menu is open M cannot switch to play and the camera follows the slow
// menu orbit. PRACTICE and 1V1 are the only real game modes
const menuState = { mode: 'menu', gameMode: GameMode.PRACTICE, timeOfDay: TimeOfDay.SUNRISE }
const modeIndicator = document.getElementById('mode-indicator')
const movementState = { facing: 0 } // robot yaw (rad), persists when idle
const moveVec = new THREE.Vector3()
const camForward = new THREE.Vector3()
const camRightFlat = new THREE.Vector3()
const targetCameraPos = new THREE.Vector3()
// Scratch for the camera target rotation, reused every frame
const targetCameraQuat = new THREE.Quaternion()
const scratchLookAtMatrix = new THREE.Matrix4()
const scratchLookAtTarget = new THREE.Vector3()
const scratchEuler = new THREE.Euler()
const CHASE_DISTANCE = 350
// Right mouse held (HANDLING): same orbit, shorter radius, interpolated
const HANDLING_CHASE_DISTANCE = 150
const CHASE_DISTANCE_LERP_SPEED = 6
// Slower than the shared lerp: at 6 the zoom settled so fast (~167ms) it
// read as an instant snap
const CHASE_DISTANCE_ZOOM_LERP_SPEED = 2.5
// DRIBBLE and HANDLING use structurally DIFFERENT camera formulas
// (orbit+lookAt vs free orientation): the real camera position/rotation
// is interpolated toward the per-frame target, so switching formulas
// never snaps
const CAMERA_POSITION_LERP_SPEED = 10
const cameraState = {}
cameraState.currentChaseDistance = CHASE_DISTANCE
cameraState.currentHeightBoost = 0
// No side offset while HANDLING: arm in line with the view, interpolated
cameraState.currentArmYawOffsetDeg = ARM_YAW_OFFSET_DEG
const CHASE_HEIGHT = 180
const LOOK_HEIGHT = 80
const ORBIT_SENSITIVITY = 0.0025
// ARM_YAW_OFFSET_DEG keeps the arm tied to the orbit but offset sideways,
// so the dribble is seen in profile instead of from behind
cameraState.orbitYaw = 0
// Initial pitch reproducing the original framing, then mouse-free
const ORBIT_PITCH_REST = Math.atan2(CHASE_HEIGHT, CHASE_DISTANCE)
cameraState.orbitPitch = ORBIT_PITCH_REST
// HIGHER orbitPitch = camera higher/closer, looking DOWN. "Look up" means
// pitch going down toward zero and negative. HANDLING lowers the MIN (to
// aim up at the hoop), it does not raise the max
const ORBIT_PITCH_MIN_HANDLING = -0.9
// Free-orientation camera needs its own floor-avoidance cap
const ORBIT_PITCH_MAX_HANDLING = 0.9
// Camera pitch to elbow coupling, disabled for now (0, formula kept)
const ELBOW_PITCH_COUPLING = 0

// Steering speed for updateLocomotionAnimation (RobotBase owns the lerp)
const WHEEL_TURN_SPEED = 18

// --- Dash (Shift in Play), MANIPULATOR only (see AMRManipulator.js) ---
const dashPanel = document.getElementById('dash-panel')
const dashChargeFillEls = [document.getElementById('dash-charge-fill-0'), document.getElementById('dash-charge-fill-1')]
const dashChargeBlockEls = Array.from(document.querySelectorAll('#dash-charges .dash-charge-block'))
// Panel label depends on the active class (Shift differs per class)
const SPECIAL_MOVE_LABEL_BY_TYPE = { MANIPULATOR: 'DASH', LEGGED_MANIPULATOR: 'JUMP', DRONE: 'FLIGHT' }
// --- STEAL/BLOCK HUD (Q/E in Play) ---
const combatPanel = document.getElementById('combat-panel')
const stealBarFill = document.getElementById('steal-bar-fill')
const blockBarFill = document.getElementById('block-bar-fill')
const crosshair = document.getElementById('crosshair')
// Also reused by the Crosshair Height debug slider
function updateCrosshairPosition() {
  crosshair.style.top = `calc(50% - ${CROSSHAIR_HEIGHT}px)`
}
updateCrosshairPosition()
const dashDirection = new THREE.Vector3()
const scratchPlayerVsEnemy = new THREE.Vector3()
const DASH_COOLDOWN_TIME = 4
const DASH_DURATION = 0.15
const DASH_SPEED_MULTIPLIER = 6.6
// 2 independent charges, recharged IN SEQUENCE (one timer at a time)
const DASH_MAX_CHARGES = 2
const dashState = {
  charges: DASH_MAX_CHARGES,
  rechargeTimer: 0, // seconds to the NEXT charge (0 if full)
  timeRemaining: 0, // seconds left of the running burst
}
// Same HUD panel for every class: reads dashState (MANIPULATOR) or
// specialMoveState (Jump/Flight). `let`: recalculated on class switch
let USES_DASH_STATE, SPECIAL_MOVE_MAX_CHARGES, SPECIAL_MOVE_COOLDOWN_TIME
function refreshSpecialMoveHud() {
  USES_DASH_STATE = manipulator.type === 'MANIPULATOR'
  SPECIAL_MOVE_MAX_CHARGES = USES_DASH_STATE ? DASH_MAX_CHARGES : manipulator.specialMoveMaxCharges
  SPECIAL_MOVE_COOLDOWN_TIME = USES_DASH_STATE ? DASH_COOLDOWN_TIME : manipulator.specialMoveCooldownTime
  document.getElementById('dash-panel-label').textContent = SPECIAL_MOVE_LABEL_BY_TYPE[manipulator.type] ?? 'SPECIAL'
  for (let i = 0; i < dashChargeBlockEls.length; i++) dashChargeBlockEls[i].classList.toggle('hidden', i >= SPECIAL_MOVE_MAX_CHARGES)
}
refreshSpecialMoveHud()

// Class switch from the Main Menu: reference reassignment + visibility
// toggle, never a reload. Safe because the ROBOT screens are reachable
// only while the robot is hidden; visibility is preserved, not assumed
function setActiveRobotClass(key) {
  if (manipulator === playerRobots[key]) return
  const wasVisible = manipulator.root.visible
  manipulator.root.visible = false
  manipulator = playerRobots[key]
  manipulator.root.visible = wasVisible
  refreshSpecialMoveHud()
}
function setActiveEnemyRobotClass(key) {
  if (enemyManipulator === enemyRobots[key]) return
  const wasVisible = enemyManipulator.root.visible
  enemyManipulator.root.visible = false
  enemyManipulator = enemyRobots[key]
  enemyManipulator.root.visible = wasVisible
}

document.addEventListener('keydown', e => {
  if (e.code !== 'ShiftLeft' || e.repeat || menuState.mode !== 'play') return
  // Dash stays MANIPULATOR-only; other classes use the shared
  // triggerSpecialMove (RobotBase): same key, per-class implementation
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
  // Force a fresh click-to-enter on mode switch; this unlock is a mode
  // switch detail, not "player pressed ESC"
  if (controls.isLocked) { suppressPauseOnUnlock = true; controls.unlock() }
  // Do not stay stuck in HANDLING when switching modes with right mouse
  // held (unless a shot is mid-animation: aborting it would leave ball
  // state inconsistent)
  if (menuState.mode !== 'play' && manipulator.state === RobotState.HANDLING && shootingState.phase === 'idle') releaseBallHandling()
})

document.addEventListener('mousemove', e => {
  if (menuState.mode !== 'play' || !controls.isLocked) return
  // Camera/crosshair frozen for the whole shot animation: the real shot
  // direction is captured at releasePoint, not at click. Blocking here
  // (not downstream) keeps the elbow coherent with the same direction
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

// --- Ball grip (right mouse held, Play only) ---
// While held: dribble paused, arm holds the ball, camera zooms in. On
// release the dribble restarts from a clean 'push'
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault())
let rightMouseDown = false
document.addEventListener('mousedown', e => {
  if (e.button !== 2 || menuState.mode !== 'play') return
  rightMouseDown = true
  if (shootingState.phase !== 'idle') return // never interrupt a shot
  // owner check, not just HANDLED: in 1v1 the ball can be HANDLED by the
  // OPPONENT, right mouse must not enter HANDLING without real possession
  if (!basketball || basketball.state !== BallState.HANDLED || basketball.owner !== manipulator) return
  // orbitPitch/orbitYaw deliberately untouched: resetting pitch here made
  // the crosshair jump. The HANDLING pitch range fully contains the
  // DRIBBLE one, so the aim DIRECTION stays continuous; only the camera
  // POSITION moves, already interpolated in animate()
  manipulator.setState(RobotState.HANDLING)
  // Else it stays true forever after the first shot, blocking the preview
  shootingState.released = false
})
document.addEventListener('mouseup', e => {
  if (e.button !== 2) return
  rightMouseDown = false
  if (manipulator.state !== RobotState.HANDLING || shootingState.phase !== 'idle') return
  releaseBallHandling()
})
// NO_BALL is entered only at the physical release inside 'release', not
// at click: the whole windup plays with the ball still on the paddle
const shootingState = {
  phase: 'idle',      // 'idle' | 'windup' | 'release' | 'recover'
  phaseT: 0,
  timeSinceTrigger: 0, // not reset per phase, drives the releaseOrigin blend
  released: false,    // true from the frame the ball really leaves the paddle
  // true from the first post-release bounce: FREE_SHOT (blockable, not
  // pickable) becomes FREE exactly then
  hasBounced: false,
  // Captured at release (ROBOT position): the 2/3-point rule depends on
  // where the shot was taken, not where the ball lands
  wasInsideArc: false,
  stateTransitionTimer: 0, // seconds left before the real state change
  // Click-time poses, start points of the windup lerps
  startElbowOffset: 0,
  startLink1Offset: 0,
  startGrip: 0,
  startTilt: 0,
  // aimPitchOffset frozen when 'recover' starts (lerp start toward 0)
  recoverStartAimPitch: 0,
  // Exact point the preview was drawing from at click time: the real
  // flight starts exactly there (see updateShootAnimation)
  releaseOrigin: new THREE.Vector3(),
}

// --- Automatic pickup (FREE ball touched by the robot) ---
// No key: walking close enough to a free ball picks it up with a short
// arm dip animation, then the normal dribble restarts
const PICKUP_MARGIN = 40
// Ball is locked to the paddle from frame one, the arm dip can afford
// a readable duration
const PICKUP_DURATION = 0.3
const pickupState = { phase: 'idle', phaseT: 0 } // 'idle' | 'active'

// Collision/contact wireframes (number keys, CollisionDebugView.js).
// Built here: needs collisionWorld + robots + PICKUP_MARGIN
const { update: updateCollisionDebugView } = initCollisionDebugView({
  scene, collisionWorld, rimRingRadius: RIM_RING_RADIUS, rimTubeRadius: RIM_TUBE_RADIUS,
  getManipulator: () => manipulator, getEnemyManipulator: () => enemyManipulator,
  // Same aim source as CombatMoves.resolveAimYaw: the drawn STEAL zone
  // must orient exactly like the real one
  getPlayerAimYaw: () => cameraState.orbitYaw,
  getEnemyAimYaw: () => enemyManipulator.wheelsGroup.rotation.y,
  stealForwardMargin: STEAL_FORWARD_MARGIN, stealBackwardMargin: STEAL_BACKWARD_MARGIN,
  pickupMargin: PICKUP_MARGIN,
})

document.addEventListener('mousedown', e => {
  if (e.button !== 0 || menuState.mode !== 'play' || !controls.isLocked) return
  if (manipulator.state !== RobotState.HANDLING || shootingState.phase !== 'idle' || !basketball) return
  // Windup start sequence shared with EnemyAI (ShootingSystem.triggerShoot)
  triggerShoot()
  // A dash mid-burst at click time stays frozen (not consumed) for the
  // whole shot animation; without zeroing it here it fired all at once
  // the instant the animation returned to idle (surprise teleport)
  dashState.timeRemaining = 0
})

// R key: test-only ball "reload" straight into the hand, skipping the
// dribble. Direct (non-interpolated) resets: debug flow, not gameplay
document.addEventListener('keydown', e => {
  // Disabled in 1V1: reloading on demand would bypass STEAL/BLOCK
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
  // Must go back to HANDLED too, or right mouse stays blocked by the
  // normal-pickup gate
  if (basketball) {
    basketball.setState(BallState.HANDLED)
    basketball.setOwner(manipulator)
  }
  // ALWAYS HANDLING, never branch on the incidental right-mouse state:
  // ending in DRIBBLE put the ball at the dribble tracking offset instead
  // of the tight HANDLING point ("ball at a distance from the hand" bug)
  manipulator.setState(RobotState.HANDLING)
})

// --- Dribble (always active, not only in Play) ---
// push/drop/rise state machine synced with the elbow, no physics lib.
// See createDribbleState (BallPossession.js) for the state shape
const dribbleState = createDribbleState()

// Fixed timestep for the dribble simulation (accumulator pattern):
// updateDribble always sees the same small constant dt, making the
// trajectory reproducible and killing the single-huge-delta edge case
const DRIBBLE_FIXED_DT = 1 / 120

// Per-robot dispatch state, lets updateBallDispatch below be ONE shared
// function instead of two near-identical blocks
function createBallDispatchState() {
  return { dribbleAccumulator: 0, wasElevated: false }
}

// Debug "Animation Preview": advances the special move regardless of
// menuState.mode (the real updateSpecialMove runs only inside the Play
// block, so from Spectate the phase froze at idle). Deliberately bypasses
// charges/cooldown: inspection tool
const debugPreviewState = { specialMoveActive: false }
const ballDispatchState = createBallDispatchState()
const enemyBallDispatchState = createBallDispatchState()

// Pickup/shot/Flight/dribble dispatch for ONE robot, called once per side
// with its own state bundle. wasElevated tracks the Flight landing:
// dribbleState must reset clean, else the first push compares against a
// paddle height from before takeoff. The basketball check stays INSIDE:
// updateAimPosture at the bottom must run even before the ball loads
function updateBallDispatch(delta, dispatch) {
  const {
    manipulator, pickupState, shootingState, dispatchState,
    updatePickup, updateShotFlight, checkForPickup,
    resetDribbleState, updateHandling, updateDribble,
  } = dispatch
  if (basketball) {
    // shootingState.released, not just NO_BALL: in 1v1 a robot is
    // NO_BALL just because the OTHER has the ball, not because it shot.
    // checkForPickup() stays valid in both cases
    if (pickupState.phase === 'active') {
      updatePickup(delta)
    } else if (shootingState.released && (!basketball.owner || basketball.owner === manipulator)) {
      // owner check: if a BLOCK deflected the shot and someone else
      // already picked it up, this is no longer "my flight": applying
      // abandoned physics on a position the new owner already drives
      // would flicker between the two
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
        // Flight (Drone): ball leaves the dribble for the whole
        // grab-rise-hold-descend duration, rigidly snapped (never a
        // lerp, interpolation always read as the ball chasing the paddle)
        snapBallToRestPoint(manipulator, basketball)
      } else {
        // Fixed-timestep accumulator: a slow frame runs more steps, a
        // fast one may run none. Clamp guards against a "spiral of death"
        // after the tab loses focus for a while
        dispatchState.dribbleAccumulator = Math.min(dispatchState.dribbleAccumulator + delta, DRIBBLE_FIXED_DT * 10)
        while (dispatchState.dribbleAccumulator >= DRIBBLE_FIXED_DT) {
          updateDribble(DRIBBLE_FIXED_DT)
          dispatchState.dribbleAccumulator -= DRIBBLE_FIXED_DT
        }
      }
    }
  }
  // Drone: relax the aim tilt back to 0 outside HANDLING, covering every
  // exit path (a shot goes straight to NO_BALL, bypassing releaseBallHandling)
  if (manipulator.state !== RobotState.HANDLING) manipulator.updateAimPosture(0, delta)
}

// --- Loop ---
const clock = new THREE.Clock()
// Per-frame delta cap (background tab, hitch): avoids a huge jump
// skipping physics/animations in one step
const MAX_DELTA = 0.1

const handlingState = { grip: 0, tiltOffset: 0 }
// Reduced volume: the automatic dribble loops forever, full intensity
// was annoying
const DRIBBLE_BOUNCE_SOUND_VOLUME = 0.35

const PICKUP_COARSE_RADIUS = 300

// gameContext: fields genuinely shared by 2+ of the extracted modules
// (stable references + mutable state objects). collisionWorld is NOT
// here (only ShootingSystem uses it).
//
// getBasketball/getBallRadius are FUNCTIONS, not `get` accessors: the
// spread in each init call copies the VALUE of every property, and a
// `get` accessor gets invoked immediately and frozen (verified:
// `{...{get v(){return x}}}.v` stops following updates to x). A function
// value survives the spread (the reference is copied, not its result),
// so the same function called later always reads basketball fresh
const gameContext = {
  getBasketball: () => basketball,
  camera, scene, sfx, controls,
  cameraState,
  getBallRadius: () => BALL_RADIUS,
}

// stealState/blockState declared HERE, before initBallPossession:
// checkForPickup reads them to avoid starting a pickup mid steal/block
// resolve. Also used by initCombatMoves below: the player instance must
// read/write the ENEMY's stealState (steal-back lockout) and vice versa,
// which would need a circular reference if created inside initCombatMoves
const stealState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0, startAimYaw: 0, contactMade: false }
const blockState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0 }
const enemyStealState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0, startAimYaw: 0, contactMade: false }
const enemyBlockState = { phase: 'idle', phaseT: 0, cooldown: 0, resolveFromElbow: 0, resolveFromLink1: 0 }

// --- Player: dribble/HANDLING/pickup/shoot driven by mouse+keyboard ---
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

// Player shot direction: raycast through the crosshair PIXEL (not screen
// center). ShootingSystem receives this from outside (the enemy passes an
// AI-based one), it never needs to know what a crosshair is
const shootRaycaster = new THREE.Raycaster()
const crosshairNDC = new THREE.Vector2()
function getShotDirection(out) {
  crosshairNDC.set(0, (2 * CROSSHAIR_HEIGHT) / window.innerHeight)
  shootRaycaster.setFromCamera(crosshairNDC, camera)
  return out.copy(shootRaycaster.ray.direction)
}

// --- 1V1 possession turnover and win condition (first to WIN_SCORE) ---
// Full-screen fade before every position reset: an instant teleport also
// snapped the chase camera (disorienting). Timer state machine, not a CSS
// transition: the reset must fire exactly at full black, deterministic
const WIN_SCORE = 11
const turnoverFadeEl = document.getElementById('turnover-fade')
const TURNOVER_FADE_OUT_DURATION = 0.25
const TURNOVER_FADE_IN_DURATION = 0.35
const turnoverFadeState = { phase: 'idle', phaseT: 0, pendingAction: null }
function startTurnoverFade(action) {
  // Defense in depth: two close triggers still run the pending action
  // instead of silently dropping it
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

// Game over screen (1V1): mode back to 'menu' freezes all gameplay
const gameOverScreenEl = document.getElementById('game-over-screen')
const gameOverTitleEl = document.getElementById('game-over-title')
const gameOverScoreEl = document.getElementById('game-over-score')
function showGameOverScreen(playerWon) {
  menuState.mode = 'menu'
  if (controls.isLocked) { suppressPauseOnUnlock = true; controls.unlock() }
  // The 'unlock' listener always re-shows the hint: override it, this is
  // a real title screen, not "click to enter"
  hint.style.display = 'none'
  gameOverTitleEl.textContent = playerWon ? 'YOU WON' : 'GAME OVER'
  gameOverTitleEl.classList.toggle('won', playerWon)
  gameOverTitleEl.classList.toggle('lost', !playerWon)
  gameOverScoreEl.textContent = `${getScore()} - ${getEnemyScoreValue()}`
  gameOverScreenEl.classList.remove('hidden')
}

// Assigned AFTER the inits below: these callbacks are BUILT now (passed
// to initShootingSystem) but only CALLED later during gameplay, when the
// real functions exist
let possessionResetHandler = null
let getScore = null
let getEnemyScoreValue = null

// Called by BOTH ShootingSystem instances on every made basket. PRACTICE:
// nothing. 1V1: win condition or possession turnover (whoever concedes
// the basket restarts with the ball)
function handleMadeBasket(scoringManipulator) {
  if (menuState.gameMode !== GameMode.ONE_V_ONE) return
  if (getScore() >= WIN_SCORE) { showGameOverScreen(true); return }
  if (getEnemyScoreValue() >= WIN_SCORE) { showGameOverScreen(false); return }
  const defendingManipulator = scoringManipulator === manipulator ? enemyManipulator : manipulator
  startTurnoverFade(() => possessionResetHandler?.(defendingManipulator))
}

// Out of bounds (1V1): a loose ball outside courtBounds for longer than
// this goes to the opponent of whoever last held it (ball.owner stays
// readable while FREE: "last holder", not current possessor)
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

// Shooting System (player instance)
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

// --- Enemy (1v1): same state machines/physics, driven by the AI. Fully
// independent state set, never shared with the player
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
  // No camera to follow: the real shot elevation comes from
  // getShotDirection anyway, this only drives the visual elbow
  computeAimPitchOffset: () => 0,
  dribbleBounceSoundVolume: DRIBBLE_BOUNCE_SOUND_VOLUME,
  pickupDuration: PICKUP_DURATION, pickupMargin: PICKUP_MARGIN, pickupCoarseRadius: PICKUP_COARSE_RADIUS,
})

// Per-team hoop assignment. PRACTICE: null = either hoop counts
const TEAM_HOOP_INDEX = { [Team.A]: 0, [Team.B]: 1 }
function getPlayerTargetHoopIndex() {
  return menuState.gameMode === GameMode.ONE_V_ONE ? TEAM_HOOP_INDEX[Team.A] : null
}
function getEnemyTargetHoopIndex() {
  return menuState.gameMode === GameMode.ONE_V_ONE ? TEAM_HOOP_INDEX[Team.B] : null
}

// AI shot direction: a straight line at constant speed fell far short of
// the target. Real ballistic solution: given speed and gravity, which
// elevation angle lands the projectile on the target?
//   tan(theta) = (v^2 + sqrt(v^4 - g(g x^2 + 2 y v^2))) / (g x)
// The + picks the HIGH arc. Negative discriminant = out of range at this
// speed: 50 degrees as a reasonable fallback
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
  // From the real paddle, not the root on the ground: the height
  // difference matters for the ballistic angle
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

// No trajectory preview for the enemy: player-only concept
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
  scoreElementId: 'enemy-score-value', // separate counter from the player's
  getTargetHoopIndex: getEnemyTargetHoopIndex,
  onScore: handleMadeBasket,
})
getEnemyScoreValue = getEnemyScoreValueFn

// STEAL/BLOCK: one instance per robot, each only knows itself and "the
// other". Built BEFORE the AI (which uses enemyTriggerSteal/Block)
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
  // STEAL sweep pivots on the camera aim, not the wheels (free orbit in
  // NO_BALL, the sweep could start sideways otherwise)
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

// Combat HUD (player only): config array instead of two repeated blocks
const COMBAT_BAR_CONFIG = [
  { fillEl: stealBarFill, state: stealState, cooldownFor: stealCooldownFor, statKey: 'steal', canUse: canUseSteal },
  { fillEl: blockBarFill, state: blockState, cooldownFor: blockCooldownFor, statKey: 'block', canUse: canUseBlock },
]

// STEAL/BLOCK keys (Play + 1V1 only; gates/cooldowns are internal)
document.addEventListener('keydown', e => {
  if (menuState.mode !== 'play' || e.repeat || menuState.gameMode !== GameMode.ONE_V_ONE) return
  if (e.code === 'KeyQ') triggerSteal()
  else if (e.code === 'KeyE') triggerBlock()
})

// Enemy AI: tactical decisions each frame, actuating the same shared
// dribble/shoot/steal/block systems instead of mouse/keyboard
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

// Debug "Animation Preview" buttons: force the ACTIVE robot into a pose,
// bypassing the normal input path (HANDLING was never inspectable from a
// free camera: leaving Play releases the ball)
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
// Jump/Flight preview, harmless no-op for MANIPULATOR (Dash is separate).
// Bypasses charges/cooldown on purpose (see debugPreviewState)
function debugPreviewSpecialMove() {
  manipulator.onSpecialMoveStart()
  debugPreviewState.specialMoveActive = true
}

// Debug panel (key P): the loose `let` globals are passed as
// getter/setter pairs (an importer cannot reassign an export let)
const { cameraPanel, updateReadouts } = initDebugPanel({
  ...gameContext,
  // Player-only panel. playerRobots: all 3 instances, so LEGGED/DRONE can
  // be tuned without being the active class
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
// Slow isometric orbit framing the whole court, values picked by eye
const MENU_ORBIT_CENTER = new THREE.Vector3(-120, 0, 155)
const MENU_ORBIT_RADIUS = 1400
const MENU_ORBIT_HEIGHT = 900
const MENU_ORBIT_SPEED = 0.05 // rad/s, deliberately slow
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

// Main Menu: navigation/DOM wiring + resetGameplayState live in
// src/ui/MainMenu.js (context object, zero circular imports)
const { openPauseMenu, resetGameplayState, backToMainMenu } = initMainMenu({
  ...gameContext,
  getManipulator: () => manipulator, shootingState, handlingState, pickupState,
  stealState, blockState,
  // The enemy is reset together, else BACK TO MAIN MENU left the AI
  // mid-shot or on the wrong side of the court
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
// Wire the indirect handler passed to handleMadeBasket above: from here
// on every made basket really triggers the 1V1 turnover
possessionResetHandler = resetGameplayState

// Game over screen: same cleanup as the pause button, plus hiding the
// game-over overlay itself
document.getElementById('game-over-back-btn').addEventListener('click', () => {
  gameOverScreenEl.classList.add('hidden')
  backToMainMenu()
})

// --- Main Menu: live robot card previews ---
// isometric_racer technique: offscreen renderer, camera fit on the real
// bounding box. The canvas stays live in the card: the robot really
// dribbles (same stepDribble), animated only while its screen is active
menuState.robotPreviewActive = false
menuState.enemyRobotPreviewActive = false
// Frames robot + ball excursion (not just the robot at rest): minimum
// distance containing all 8 box corners in the frustum. Shared with the
// zoom modal (tighter marginFactor there)
const PREVIEW_BALL_VERTICAL_MARGIN_FACTOR = 2
const previewFitCorner = new THREE.Vector3()
// Also returns `center`: the zoom modal reuses it as its orbit pivot
function fitPreviewCameraToRobot(camera, robotRoot, ballRadius, marginFactor = 1.08) {
  const box = new THREE.Box3().setFromObject(robotRoot)
  // Double vertical margin: the ball drops almost to the floor
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

  // team applies the real per-team default colors (the enemy cards used
  // to show the ally factory orange, a real inconsistency)
  const previewRobot = new RobotClass(team)
  previewRobot.controls.manipulatorScale(scale)
  // Team.A: reflect any customization already made this session
  if (team === Team.A && currentAllyColors) previewRobot.controls.setColors(currentAllyColors)
  previewScene.add(previewRobot.root)

  // Simple sphere instead of the real GLTF: the ball loads async and the
  // detail would not show at 200px anyway
  const previewBall = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.7 })
  )
  previewScene.add(previewBall)

  fitPreviewCameraToRobot(previewCamera, previewRobot.root, BALL_RADIUS)

  document.getElementById(targetElementId).replaceChildren(previewRenderer.domElement)

  // Preview dribble: the SAME stepDribble as the real game, own state
  // object, no sound (browsing menus must not thump)
  const previewDribbleState = createDribbleState()
  const previewClock = new THREE.Clock()
  // Same fixed-timestep accumulator as the real dribble: passing the raw
  // variable dt made the preview visibly less smooth
  let previewAccumulator = 0

  function tickPreview() {
    requestAnimationFrame(tickPreview)
    if (!menuState[activeFlagKey]) { previewClock.getDelta(); return } // consume delta, no jump on resume
    const previewFrameDelta = Math.min(previewClock.getDelta(), MAX_DELTA)
    previewAccumulator = Math.min(previewAccumulator + previewFrameDelta, DRIBBLE_FIXED_DT * 10)
    while (previewAccumulator >= DRIBBLE_FIXED_DT) {
      stepDribble(previewDribbleState, previewRobot, previewBall.position, DRIBBLE_FIXED_DT, { ballRadius: BALL_RADIUS })
      previewAccumulator -= DRIBBLE_FIXED_DT
    }
    // Drone rotors always spin, even standing still; the preview never
    // calls updateLocomotionAnimation so they are driven separately
    if (previewRobot.controls.spinRotors) previewRobot.controls.spinRotors(previewFrameDelta, droneTuning.rotorSpinSpeed)
    previewRenderer.render(previewScene, previewCamera)
  }
  tickPreview()
  // Used by "Personalizza" to live-update the card thumbnail too
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

// --- Zoom preview modal (eye icon under each card) ---
// Same technique as the cards but ONE shared renderer/scene: it opens
// rarely, the robot is built/disposed per opening instead of keeping 3
// more instances alive
function disposeRobotPreviewRoot(root) {
  root.traverse(child => {
    if (!child.isMesh) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i]
      for (const mapKey of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (m[mapKey]) m[mapKey].dispose()
      }
      m.dispose()
    }
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

  // Same simple sphere as the cards
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

  // Colors panel, ally robot only ("Personalizza"): openZoom creates a
  // NEW instance each time, so changes must be reapplied both to the
  // zoomRobot and to playerRobots[key]
  const colorsPanel = document.getElementById('robot-zoom-colors')
  const colorInputs = {
    accent: document.getElementById('zoom-color-accent'),
    arm: document.getElementById('zoom-color-arm'),
    body: document.getElementById('zoom-color-body'),
  }
  let currentCustomizeKey = null
  function hexToCss(hex) { return '#' + hex.toString(16).padStart(6, '0') }
  // True factory values. accent/arm are uniform across classes, BODY is
  // not (Drone hull differs): Reset must return the PER-CLASS default
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
    // TEAM colors: applied to all 3 instances (game + card thumbnails)
    for (const key of Object.keys(playerRobots)) {
      playerRobots[key].controls.setColors(colors)
      cardPreviewByKey[key]?.setColors(colors)
    }
    currentAllyColors = colors
  }
  function applyCustomColorsFromInputs() {
    applyColorsEverywhere({ accent: colorInputs.accent.value, arm: colorInputs.arm.value, body: colorInputs.body.value })
  }
  Object.values(colorInputs).forEach(input => input.addEventListener('input', applyCustomColorsFromInputs))
  document.getElementById('zoom-color-reset').addEventListener('click', () => {
    if (!currentCustomizeKey) return
    // CSS strings (#rrggbb), same format as the normal input flow, else
    // currentAllyColors ended up with a different format after a reset
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
    // team applies the real per-team default colors
    zoomRobot = new RobotClass(team)
    zoomRobot.controls.manipulatorScale(scale)
    // Team.A: reflect this session's customization
    if (team === Team.A && currentAllyColors) zoomRobot.controls.setColors(currentAllyColors)
    zoomScene.add(zoomRobot.root)
    zoomDribbleState = createDribbleState()
    // 0.95: 0.72 cut too close, the robot left the frame during the
    // dribble arm excursion
    zoomOrbitCenter.copy(fitPreviewCameraToRobot(zoomCamera, zoomRobot.root, BALL_RADIUS, 0.95))
    titleEl.textContent = label ?? ''
    zoomClock.getDelta() // discard the closed time, no jump on first frame
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
      // Must not select/navigate the card underneath
      e.stopPropagation()
      // Same markup in both grids: team told apart by the container
      const team = el.closest('#menu-robot-enemy') ? Team.B : Team.A
      openZoom(el.dataset.robotZoom, { team })
    })
  })
  document.querySelectorAll('[data-robot-customize]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      // Ally grid only, no team ambiguity
      openZoom(el.dataset.robotCustomize, { team: Team.A, customize: true })
    })
  })
  document.getElementById('robot-zoom-close').addEventListener('click', closeZoom)
  document.getElementById('robot-zoom-backdrop').addEventListener('click', closeZoom)

  // Drag orbit: horizontal drag rotates the camera around zoomOrbitCenter
  // (yaw only, elevation/distance from the fit stay fixed). Rotates the
  // existing camera-to-center vector instead of refitting
  const ZOOM_ORBIT_SENSITIVITY = 0.008 // rad per dragged pixel
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

  // Same fixed-timestep accumulator as the card previews
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
    // Drone rotors always spin (see card previews)
    if (zoomRobot.controls.spinRotors) zoomRobot.controls.spinRotors(zoomFrameDelta, droneTuning.rotorSpinSpeed)
    zoomRenderer.render(zoomScene, zoomCamera)
  }
  tickZoom()
}
initRobotZoomModal()

// Stat bars on the robot cards: read directly from *_STATS, never
// hand-copied into the HTML. maxByStat mirrors the real scales used
// elsewhere (SPEED/STEAL/BLOCK 1-5, SHOOTING 1-3)
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
// Same roster on the ROBOT AVVERSARIO screen (1V1)
renderStatBars(document.getElementById('robot-stats-manipulator-enemy'), MANIPULATOR_STATS)
renderStatBars(document.getElementById('robot-stats-legged-enemy'), LEGGED_MANIPULATOR_STATS)
renderStatBars(document.getElementById('robot-stats-drone-enemy'), DRONE_STATS)

// Ball rotation deduced from REAL velocity (frame-to-frame position
// difference), one shared point instead of per-state copies. Rolling
// axis = up cross velocity (rolling-without-slipping formula, applied to
// flight too for a visually plausible spin). Angular speed = |v| / radius
const ballSpinPreviousPos = new THREE.Vector3()
const ballSpinVelocity = new THREE.Vector3()
const ballSpinAxis = new THREE.Vector3()
let ballSpinInitialized = false
// Cap on the velocity USED for spin, not the real ball velocity: pickup/
// dribble re-lock snap the ball in one frame, an uncapped spin would jump
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
  // Axis length checked BEFORE normalizing: near-vertical velocity (idle
  // dribble) makes up x velocity near zero, normalizing that would
  // produce NaN that poisons the ball quaternion forever
  ballSpinAxis.set(0, 1, 0).cross(ballSpinVelocity)
  const axisLength = ballSpinAxis.length()
  if (axisLength < 1e-4) return // no sensible horizontal rolling axis
  ballSpinAxis.divideScalar(axisLength)
  basketball.mesh.rotateOnWorldAxis(ballSpinAxis, (speed / BALL_RADIUS) * dt)
}

// Robots never clamped against static court geometry (only the ball did):
// a DASH (6.6x speed) can push a robot past a thin pole/bench in one
// burst, and the ball (which always follows the real paddle position
// until release) starts a shot already inside that box, resolved as a
// bogus bounce on frame one. Fix: the same sphere-vs-box test used for
// the ball, applied to the robot every frame after movement, with a
// fixed zero velocity (position correction only, no bounce)
const PLAYER_COLLISION_RADIUS = 55 // disc radius + margin
const scratchRobotClampVelocity = new THREE.Vector3()
function clampRobotToCourt(robot) {
  // This clamp used to run at any height: a Drone at FLIGHT_HEIGHT above
  // a wall/pole box in X/Z was pushed out every frame, read as a slow
  // horizontal drift instead of a hard bounce. isElevated (Drone only)
  // exempts it, same reasoning as the STEAL immunity in Drone.js
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

  // Always runs, regardless of mode: the time-of-day change is picked
  // from the Main Menu and must stay visible while fading
  updateTimeOfDayTransition(delta)

  // Menu open: only the slow camera orbit, nothing else, then exit early
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
    // Hard aim lock for the whole shot animation: PointerLockControls has
    // its OWN internal mousemove listener rotating camera.quaternion
    // directly, independent of cameraState. controls.enabled=false
    // freezes that listener (onMouseMove checks this.enabled) without
    // detaching pointerlockchange/pointerlockerror. NOT controls.disconnect():
    // that removes those two listeners as well, so an ESC during the shot
    // would really unlock the pointer but isLocked stays stuck true
    // forever (the pause menu's 'unlock' event never fires again)
    const shouldLockAim = shootingState.phase !== 'idle'
    if (shouldLockAim !== aimLockActive) {
      aimLockActive = shouldLockAim
      controls.enabled = !shouldLockAim
    }
    // Base (R1) follows the camera orbit yaw, independent of movement:
    // aim with the mouse, move with WASD
    const isHandlingNow = manipulator.state === RobotState.HANDLING
    const armYawLerpFactor = 1 - Math.exp(-manipulator.handlingTuning.transitionSpeed * delta)
    cameraState.currentArmYawOffsetDeg += ((isHandlingNow ? 0 : ARM_YAW_OFFSET_DEG) - cameraState.currentArmYawOffsetDeg) * armYawLerpFactor
    // Never during own STEAL/BLOCK: guarded explicitly, not just by call
    // order in animate() (a future reorder would silently break it)
    if (!isCombatMoveActive(stealState, blockState)) {
      manipulator.controls.setAimYaw(cameraState.orbitYaw + THREE.MathUtils.degToRad(cameraState.currentArmYawOffsetDeg))
    }
    // Small elbow coupling to camera pitch (setAimPitch also relevels the paddle)
    manipulator.controls.setAimPitch((cameraState.orbitPitch - ORBIT_PITCH_REST) * ELBOW_PITCH_COUPLING)

    // Camera axes flattened on the horizontal plane so W always pushes
    // forward on the ground, never diagonally when the camera is tilted
    angleToForward(cameraState.orbitYaw, camForward)
    rotateRight(camForward, camRightFlat)

    moveVec.set(0, 0, 0)
    if (keys['KeyW']) moveVec.add(camForward)
    if (keys['KeyS']) moveVec.sub(camForward)
    if (keys['KeyD']) moveVec.add(camRightFlat)
    if (keys['KeyA']) moveVec.sub(camRightFlat)

    // Frozen during own STEAL/BLOCK and during the shot animation: the
    // position at end of 'windup' determines shot speed/2-3 point zone,
    // captured at physical release. Moving mid-animation could put the
    // robot in/out of the arc after the frozen preview already showed a
    // different trajectory
    if (moveVec.lengthSq() > 0 && !isCombatMoveActive(stealState, blockState) && shootingState.phase === 'idle') {
      moveVec.normalize()
      movementState.facing = Math.atan2(moveVec.x, moveVec.z)
      manipulator.move(moveVec, delta)
    }

    // Dash: short burst in the facing direction, adds to WASD movement
    if (dashState.charges < DASH_MAX_CHARGES) {
      dashState.rechargeTimer -= delta
      if (dashState.rechargeTimer <= 0) {
        dashState.charges++
        // Recharge IN SEQUENCE: the next timer starts immediately, not in parallel
        dashState.rechargeTimer = dashState.charges < DASH_MAX_CHARGES ? DASH_COOLDOWN_TIME : 0
      }
    }
    // Same reasoning as the WASD freeze above: a dash mid-burst must not
    // move the robot in/out of the arc during the shot animation
    if (dashState.timeRemaining > 0 && shootingState.phase === 'idle') {
      // baseSpeed, not speed: the burst is unscaled by the HANDLING slowdown
      manipulator.root.position.addScaledVector(dashDirection, manipulator.baseSpeed * DASH_SPEED_MULTIPLIER * delta)
      dashState.timeRemaining = Math.max(0, dashState.timeRemaining - delta)
    }
    // AFTER both WASD and dash: see clampRobotToCourt above
    clampRobotToCourt(manipulator)

    // Generic special move (RobotBase): no-op for MANIPULATOR (Dash is
    // separate). isShooting freezes an active move (Flight) mid-shot
    manipulator.updateSpecialMove(delta, shootingState.phase !== 'idle')

    // Independent charge blocks: full/green when ready, recharge fills
    // only the first empty block. MANIPULATOR reads dashState, Jump/Flight
    // read specialMoveState on the same HUD panel
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

    // STEAL/BLOCK: panel greyed out while holding the ball (usable only
    // in NO_BALL). Loop instead of two near-identical blocks
    combatPanel.classList.toggle('disabled', manipulator.state !== RobotState.NO_BALL)
    for (const { fillEl, state, cooldownFor, statKey, canUse } of COMBAT_BAR_CONFIG) {
      fillEl.style.width = `${(1 - state.cooldown / cooldownFor(manipulator.stats[statKey])) * 100}%`
      fillEl.classList.toggle('ready', canUse())
    }

    // Torus rest rolling direction is local X, not Z: -90 degree offset
    // to align with movement. updateLocomotionAnimation interpolates
    manipulator.updateLocomotionAnimation(movementState.facing - Math.PI / 2, delta, WHEEL_TURN_SPEED)

    // Zoom in while HANDLING: same orbit, interpolated shorter radius
    // plus a height boost to see the hoop instead of the floor
    const isHandling = manipulator.state === RobotState.HANDLING
    const zoomLerpFactor = 1 - Math.exp(-CHASE_DISTANCE_LERP_SPEED * delta)
    const zoomDistanceLerpFactor = 1 - Math.exp(-CHASE_DISTANCE_ZOOM_LERP_SPEED * delta)
    cameraState.currentChaseDistance += ((isHandling ? HANDLING_CHASE_DISTANCE : CHASE_DISTANCE) - cameraState.currentChaseDistance) * zoomDistanceLerpFactor
    cameraState.currentHeightBoost += ((isHandling ? HANDLING_HEIGHT_BOOST : 0) - cameraState.currentHeightBoost) * zoomLerpFactor

    const robotPos = manipulator.root.position
    // camForward/camRightFlat already computed above for movement
    if (isHandling) {
      // HANDLING camera has a FREE orientation (real yaw/pitch), not a
      // lookAt that always chases the robot: pitch rotates the view
      // instead of moving the target, so it can look above the robot
      targetCameraPos.set(
        robotPos.x - camForward.x * cameraState.currentChaseDistance + camRightFlat.x * HANDLING_CAMERA_SIDE_OFFSET,
        robotPos.y + LOOK_HEIGHT + cameraState.currentHeightBoost,
        robotPos.z - camForward.z * cameraState.currentChaseDistance + camRightFlat.z * HANDLING_CAMERA_SIDE_OFFSET
      )
      // orbitPitch used directly, no second lerp here: that was a double
      // smoothing cascade with the slerp below, unpredictable on fast
      // mouse flicks. One smoothing stage is enough
      scratchEuler.set(-cameraState.orbitPitch, cameraState.orbitYaw + Math.PI, 0, 'YXZ')
      targetCameraQuat.setFromEuler(scratchEuler)
    } else {
      // DRIBBLE/normal Play: orbit camera, always looks at the robot
      const horizDist = cameraState.currentChaseDistance * Math.cos(cameraState.orbitPitch)
      targetCameraPos.set(
        robotPos.x - camForward.x * horizDist,
        robotPos.y + LOOK_HEIGHT + cameraState.currentChaseDistance * Math.sin(cameraState.orbitPitch),
        robotPos.z - camForward.z * horizDist
      )
      // Same result as camera.lookAt(), computed on a scratch target so
      // the rotation can be interpolated too, not just the position
      scratchLookAtTarget.set(robotPos.x, robotPos.y + LOOK_HEIGHT, robotPos.z)
      scratchLookAtMatrix.lookAt(targetCameraPos, scratchLookAtTarget, camera.up)
      targetCameraQuat.setFromRotationMatrix(scratchLookAtMatrix)
    }
    // Real position AND rotation interpolated toward the target: this is
    // what removes the snap when switching formulas (either direction).
    // slerp for rotation: shortest path between quaternions, not a
    // linear component-by-component blend
    const camPosLerpFactor = 1 - Math.exp(-CAMERA_POSITION_LERP_SPEED * delta)
    camera.position.lerp(targetCameraPos, camPosLerpFactor)
    camera.quaternion.slerp(targetCameraQuat, camPosLerpFactor)
  }

  // Shot animation runs independent of manipulator.state (starts HANDLING,
  // moves to NO_BALL mid-way), must update BEFORE the branch below.
  // stateTransitionTimer > 0 even with phase already 'idle': the 0.35s
  // countdown can outlast release+recover, else it stalls mid-way
  if (basketball && (shootingState.phase !== 'idle' || shootingState.stateTransitionTimer > 0)) updateShootAnimation(delta)

  // Debug preview: runs in Play AND Spectate, BEFORE updateBallDispatch
  // (which reads ballRestPoint's world position, depending on
  // root.position.y updated by onSpecialMoveUpdate during rise/descend;
  // running after would lag one frame behind for the whole climb)
  if (debugPreviewState.specialMoveActive) {
    manipulator.onSpecialMoveUpdate(delta)
    if (manipulator.specialMoveState.phase === 'idle') debugPreviewState.specialMoveActive = false
  }

  updateBallDispatch(delta, {
    manipulator, pickupState, shootingState, dispatchState: ballDispatchState,
    updatePickup, updateShotFlight, checkForPickup,
    resetDribbleState, updateHandling, updateDribble,
  })

  // PRACTICE is solo: everything below in this block is 1V1-specific
  const isOneVOne = menuState.gameMode === GameMode.ONE_V_ONE
  if (isOneVOne) {
    // Enemy AI decides movement/state BEFORE the dispatch below, so a
    // state change this frame reflects immediately, not one frame late
    if (basketball && menuState.mode === 'play') updateEnemyAI(delta)
    // Same clamp as the player: the AI navigates without knowing about
    // walls/poles/benches
    clampRobotToCourt(enemyManipulator)
    enemyManipulator.updateSpecialMove(delta, enemyShootingState.phase !== 'idle')

    // Anti-compenetration: whoever holds the ball never yields, whoever
    // doesn't gets pushed if too close. Depends on possession THIS
    // instant, not a fixed side. Runs here (both positions already
    // updated this frame), not inside the player's WASD block, so it
    // also fires when the player stands still and the enemy approaches
    if (menuState.mode === 'play' && basketball) {
      const yieldingRobot = basketball.owner === manipulator ? enemyManipulator : manipulator
      const holdingRobot = yieldingRobot === manipulator ? enemyManipulator : manipulator
      scratchPlayerVsEnemy.subVectors(yieldingRobot.root.position, holdingRobot.root.position)
      scratchPlayerVsEnemy.y = 0
      // Cheap gate (no sqrt) before paying .length()
      const distSq = scratchPlayerVsEnemy.lengthSq()
      if (distSq < AI_MIN_PLAYER_DISTANCE * AI_MIN_PLAYER_DISTANCE && distSq > 1) {
        const dist = Math.sqrt(distSq)
        // Holder absorbs only 25% of the separation, yielder 75% (both
        // move a little). EXCEPTION: whoever is mid-shot (including
        // 'recover') is never moved by this correction, else a merely
        // nearby enemy made the crosshair slip right at release. The
        // other robot absorbs the whole shortfall in that case
        const shortfall = AI_MIN_PLAYER_DISTANCE - dist
        // divideScalar, not normalize(): dist is already known
        scratchPlayerVsEnemy.divideScalar(dist) // now the holder-to-yielder direction
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

    // STEAL/BLOCK: both robots (the idle-check is internal to initCombatMoves)
    if (basketball) {
      updateSteal(delta)
      updateBlock(delta)
      enemyUpdateSteal(delta)
      enemyUpdateBlock(delta)
    }

    // No trajectory preview for the enemy (player-only concept)
    if (basketball && (enemyShootingState.phase !== 'idle' || enemyShootingState.stateTransitionTimer > 0)) enemyUpdateShootAnimation(delta)

    // Same dispatch as the player, on the enemy's own independent state
    updateBallDispatch(delta, {
      manipulator: enemyManipulator, pickupState: enemyPickupState, shootingState: enemyShootingState,
      dispatchState: enemyBallDispatchState,
      updatePickup: enemyUpdatePickup, updateShotFlight: enemyUpdateShotFlight, checkForPickup: enemyCheckForPickup,
      resetDribbleState: enemyResetDribbleState, updateHandling: enemyUpdateHandling, updateDribble: enemyUpdateDribble,
    })

    // Out-of-bounds rule, only while actively playing
    if (menuState.mode === 'play') updateOutOfBoundsTimer(delta)
  }

  // After the ball has been updated this frame, whoever moved it
  if (basketball) updateBallSpin(delta)

  // Trajectory preview: only while genuinely aiming (HANDLING, no shot
  // animation running, not yet released). !shootingState.released covers
  // the small window where manipulator.state is still HANDLING but
  // shootingState.phase already returned to idle after recover
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
