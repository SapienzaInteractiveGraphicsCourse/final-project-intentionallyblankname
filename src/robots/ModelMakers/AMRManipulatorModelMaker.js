import * as THREE from 'three'
import { replaceGeometry, makeScaleSetter, makeLinkGeometry, makeTaperedLinkGeometry, createLinkControls, createColorControls } from './geometryControlHelpers.js'

// --- Procedural PBR textures ---
// Most textures are generated in code via <canvas>, matching the fully
// procedural robot: 1) draw a greyscale height-field (pattern varies by
// material); 2) normal map from the height GRADIENT (diff vs. neighbor pixels, wrapped
// at edges for seamless tiling); 3) roughness map reuses the same
// height-field (scratches read slightly shinier) plus random noise.



// MAIN GENERATION FUNCTION: given a height-field drawing function, generate the normal and roughness maps from it, plus the height map itself (can be used as bumpMap)
export function createProceduralPBRMaps({ size = 256, drawHeightField, baseRoughness, roughnessVariation }) 
{
  /*
  Parameters:
  - size: size of the generated texture (default 256x256)
  - drawHeightField: function to draw the height field on a canvas context, varies by material
  - baseRoughness: base roughness value for the material, the roughness map will vary around this value
  - roughnessVariation: variation in roughness based on the height field, plus some random noise

  Returns:
  - normalMap: THREE.CanvasTexture for the normal map
  - roughnessMap: THREE.CanvasTexture for the roughness map
  - heightMap: THREE.CanvasTexture for the height map (can be used as bumpMap)
  */


  // create a canvas for the height field
  // This is a HTMLCanvasElement, not a Three.js texture yet. 
  // i draw the height field on it and then extract the pixel data to compute the normal and roughness maps.
  const heightCanvas = document.createElement('canvas')
  heightCanvas.width = heightCanvas.height = size

  
  const hctx = heightCanvas.getContext('2d') //gives the context to draw on the canvas, Browser API
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)
  drawHeightField(hctx, size)  //Applies the material-specific height field drawing function to the canvas context

  const heightData = hctx.getImageData(0, 0, size, size).data // get the pixel data of the height field, an Uint8ClampedArray of RGBA values

  // helper function to get the height value at a given (x, y) coordinate + WRAP like angles
  const heightAt = (x, y) => 
  {
    const xi = (x + size) % size, yi = (y + size) % size
    return heightData[(yi * size + xi) * 4] / 255
  }

  // NORMAL MAP  
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = normalCanvas.height = size
  const nctx = normalCanvas.getContext('2d')
  const normalImg = nctx.createImageData(size, size) // this time this creates a EMPTY block of pixel data to fill with the computed normal map values

  // ROUGHNESS MAP
  const roughCanvas = document.createElement('canvas')
  roughCanvas.width = roughCanvas.height = size
  const rctx = roughCanvas.getContext('2d')
  const roughImg = rctx.createImageData(size, size)

  const NORMAL_STRENGTH = 2.5 // amplifica il rilievo percepito

  //THIS IS FOR EVERY PIXEL in the height field, compute the normal and roughness values based on the height gradient and the base roughness + variation

  for (let y = 0; y < size; y++) 
  {
    for (let x = 0; x < size; x++) 
    {

      //Compute the gradient of the height field at (x, y) using central differences
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * NORMAL_STRENGTH
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * NORMAL_STRENGTH

      const len = Math.hypot(dx, dy, 1) // length of the vector (dx, dy, 1) to normalize it
      const i = (y * size + x) * 4      // index in the pixel data array (4 values per pixel: R, G, B, A)

      // compute the normal vector and store it in the normal image data
      // The normal vector is encoded in RGB as follows:
      // R = (-dx / len * 0.5 + 0.5) * 255
      // G = (-dy / len * 0.5 + 0.5) * 255
      // B = (1 / len * 0.5 + 0.5) * 255
      // A = 255 (fully opaque)

      normalImg.data[i] = (-dx / len * 0.5 + 0.5) * 255
      normalImg.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255
      normalImg.data[i + 2] = (1 / len * 0.5 + 0.5) * 255
      normalImg.data[i + 3] = 255

      const h = heightAt(x, y)
      // compute the roughness value based on the height and the base roughness + variation
      const roughness = THREE.MathUtils.clamp
      (
        baseRoughness + (h - 0.5) * -0.3 + (Math.random() - 0.5) * roughnessVariation, 0, 1
      ) * 255

      // store the roughness value in the roughness image data (same value for R, G, B, A = 255)
      roughImg.data[i] = roughImg.data[i + 1] = roughImg.data[i + 2] = roughness
      roughImg.data[i + 3] = 255
    }
  }
  // put the computed normal and roughness image data back to the canvas contexts
  nctx.putImageData(normalImg, 0, 0)
  rctx.putImageData(roughImg, 0, 0)

  // create THREE.CanvasTexture from the canvases
  const normalMap = new THREE.CanvasTexture(normalCanvas)
  const roughnessMap = new THREE.CanvasTexture(roughCanvas)
  const heightMap = new THREE.CanvasTexture(heightCanvas)

  // set the wrapping mode to RepeatWrapping for seamless tiling
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  heightMap.wrapS = heightMap.wrapT = THREE.RepeatWrapping

  // set the repeat factor to 4x4 for all maps
  normalMap.repeat.set(4, 4)
  roughnessMap.repeat.set(4, 4)
  heightMap.repeat.set(4, 4)

  // Anisotropic filtering: a single isotropic mip level either blurs or
  // aliases a texture seen at a grazing angle (the course's Lecture 09
  // covers this directly, "especially important with far away planes")
  // which is exactly the repeated tiling here, viewed edge-on on a robot
  // walking away from the camera. Fixed value, not
  // renderer.capabilities.getMaxAnisotropy(): this factory has no
  // renderer reference (it is called from deep inside the robot
  // hierarchy construction), and 8 is supported by effectively every GPU
  normalMap.anisotropy = 8
  roughnessMap.anisotropy = 8
  heightMap.anisotropy = 8

  return { normalMap, roughnessMap, heightMap }
}


export function drawBrushedMetal(ctx, size, count = 400) 
{
  /*
  Parameters:
  - ctx: canvas 2D context to draw on
  - size: size of the canvas (width and height)
  - count: number of brush strokes to draw (default 400)

  This function draws a brushed metal pattern on the given canvas context. 
  It does so by drawing a number of horizontal lines with slight variations 
  in brightness and position to simulate the appearance of brushed metal.
  */

  for (let i = 0; i < count; i++) 
    {
    const y = Math.random() * size
    const bright = 128 + (Math.random() - 0.5) * 18
    ctx.strokeStyle = `rgb(${bright},${bright},${bright})`
    ctx.lineWidth = Math.random() < 0.5 ? 1 : 2  //50% chance of line width 1 or 2
    ctx.beginPath()                                 // start a new path for the line
    ctx.moveTo(0, y)                                // move to the left edge of the canvas at height y
    ctx.lineTo(size, y + (Math.random() - 0.5) * 4) // draw a line to the right edge of the canvas, with a slight vertical offset
    ctx.stroke()                                    // actually draw the line on the canvas
  }
}


export function drawOrganicGrain(ctx, size, count = 900, maxRadius = 2.5) 
{

  /*
  Parameters:
  - ctx: canvas 2D context to draw on
  - size: size of the canvas (width and height)
  - count: number of grains to draw (default 900)
  - maxRadius: maximum radius of the grains (default 2.5)

  This function draws an organic grain pattern on the given canvas context.
  */

  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size
    const r = 1 + Math.random() * maxRadius
    const bright = 128 + (Math.random() - 0.5) * 40
    ctx.fillStyle = `rgb(${bright},${bright},${bright})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2) // draw a circle at (x, y) with radius r
    ctx.fill()
  }
}

export function createArmAccentMaterials() 
{
  /*
  This function creates the materials for the arm and accent parts of the manipulator.
  */
  const armMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 550), baseRoughness: 0.4, roughnessVariation: 0.1 })
  const accentMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawOrganicGrain(ctx, s, 1400, 1.4), baseRoughness: 0.3, roughnessVariation: 0.1 })
  return {
    armMat: new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.4, metalness: 0.5, normalMap: armMaps.normalMap, roughnessMap: armMaps.roughnessMap }),
    accentMat: new THREE.MeshStandardMaterial({ color: 0xe8942c, roughness: 0.3, metalness: 0.3, normalMap: accentMaps.normalMap, roughnessMap: accentMaps.roughnessMap }),
  }
}

// MANIPULATOR class: wheeled locomotion, 3R arm on top of a disc. R1 (base)
// yaws (vertical axis); R2/R3 (elbow/wrist) pitch (horizontal axis) — a
// planar arm on a rotating base. Arms sized to clear the disc edge so
// dribbling doesn't hit the chassis.
//
// Geometries can't be resized in place in Three.js: length/thickness/radius
// require a full rebuild (dispose + new geometry). A downstream joint's
// position depends on its upstream link's length and must be recomputed
// whenever that length changes.

export function AMRManipulatorModelMaker() 
{
  /*
  This function creates the 3D model of the AMR manipulator robot, including the wheels, chassis, and manipulator arm.
  Returns an object containing the root THREE.Group of the model and a set of controls to manipulate the model's parameters.
  */

  const root = new THREE.Group() // root group for the entire robot model

  
  // --- Materials: procedural PBR textures for body, wheels, arm, and accent ---
  const bodyMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawBrushedMetal(ctx, s, 350), baseRoughness: 0.5, roughnessVariation: 0.12 })
  const wheelMaps = createProceduralPBRMaps({ drawHeightField: (ctx, s) => drawOrganicGrain(ctx, s, 900, 2.5), baseRoughness: 0.8, roughnessVariation: 0.15 })
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.4, normalMap: bodyMaps.normalMap, roughnessMap: bodyMaps.roughnessMap })
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.1, normalMap: wheelMaps.normalMap, roughnessMap: wheelMaps.roughnessMap })
  const { armMat, accentMat } = createArmAccentMaterials()

  // Parameters visually tuned
  // Debug panel is basically usable to get other tweaks
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
    link2Thickness: 0.17,      // Base thickness
    link2TipThickness: 0.05,   // Tip thickness (tapered)
    baseJointScale: 1,
    elbowJointScale: 0.75,
    endEffectorScale: 0.25,
    paddleAngle: 2.4,          //Angle of the paddle (V shape) in radians, 0 = closed, PADDLE_ANGLE_MAX = fully open
    paddleTilt: 1.2,           //Inclination of the paddle (V shape) in radians, 0 = horizontal, positive = downwards
  }

  const INITIAL_DISC_RADIUS = state.discRadius  // used to compute the wheelsGroup scale relative to the disc radius

  // --- Wheels: 4 toroidal wheels at the corners of a square ---
  // First we build a torus geometry for the wheels, then we create 4 instances of it and position them at the corners of a square. 
  // The wheels are added to a group so we can scale and rotate them together.
  const wheelRadius = 0.4
  const wheelTube = 0.15
  const wheelOuterRadius = wheelRadius + wheelTube
  const wheelGeo = new THREE.TorusGeometry(wheelRadius, wheelTube, 12, 24)
  const wheelOffsetX = 0.9
  const wheelOffsetZ = 0.9
  const wheelsGroup = new THREE.Group()
  const wheelOffsets = 
  [
    [-wheelOffsetX, -wheelOffsetZ],
    [wheelOffsetX, -wheelOffsetZ],
    [-wheelOffsetX, wheelOffsetZ],
    [wheelOffsetX, wheelOffsetZ],
  ]
  for (let i = 0; i < wheelOffsets.length; i++) {
    const [x, z] = wheelOffsets[i]
    const wheel = new THREE.Mesh(wheelGeo, wheelMat) //Three Mesh takes a geometry and a material, and creates a renderable object
    wheel.position.set(x, wheelOuterRadius, z)
    wheelsGroup.add(wheel)
  }
  root.add(wheelsGroup)

  // --- Chassis: a disc on top of the wheels, with the manipulator arm mounted on it ---
  const discHeight = 0.1875 // 75% di 0.25
  const disc = new THREE.Mesh
  (
    new THREE.CylinderGeometry(state.discRadius, state.discRadius, discHeight, 32),
    bodyMat
  )
  root.add(disc)

  // --- Manipolatore 3R sul disco ---
  const jointRadius = 0.22


  // Base is a group that contains the base joint and the link1Group.
  const base = new THREE.Group()
  root.add(base)

  const baseJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 16, 16), armMat)
  base.add(baseJoint)

  // Link1Group is a group that contains link1 and the elbow joint. It is positioned at the top of the base joint.
  const link1Group = new THREE.Group()
  base.add(link1Group)

  const link1 = new THREE.Mesh(makeLinkGeometry(state.link1Length, state.link1Thickness), armMat)
  link1Group.add(link1)


  const ELBOW_REST_PITCH = Math.PI / 2.4 // Resting is slightly bent
  const elbow = new THREE.Group()
  elbow.position.y = state.link1Length
  elbow.rotation.x = ELBOW_REST_PITCH
  link1Group.add(elbow)

  const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius * 0.85, 16, 16), armMat)
  elbow.add(elbowJoint)

  const link2 = new THREE.Mesh
  (
    makeTaperedLinkGeometry(state.link2Length, state.link2Thickness, state.link2TipThickness),
    armMat
  )

  elbow.add(link2)

  // End effector: wrist group, positioned at the end of link2, with a slight downward pitch
  const WRIST_REST_PITCH = -Math.PI / 6
  const wrist = new THREE.Group()
  wrist.position.y = state.link2Length
  wrist.rotation.x = WRIST_REST_PITCH
  elbow.add(wrist)

  // End effector: sfera (placeholder giunto finale) + piccola paletta
  const endEffector = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), accentMat)
  wrist.add(endEffector)


  // Paddle: two flat boxes forming a V shape, attached to the wrist. The paddle is used to hit the ball in the game.
  const paddleWidth = 0.35 // lato corto (Z)
  const paddleGeo = new THREE.BoxGeometry(0.5, 0.05, paddleWidth)

  // The paddle geometry is translated so that its local origin is at the hinge point 
  // (the edge of the box), not at the center. This way, when we rotate the paddle halves, 
  // they rotate around the hinge.
  paddleGeo.translate(0, 0, paddleWidth / 2)

  const paddleGroup = new THREE.Group()
  wrist.add(paddleGroup)
  const paddleLeft = new THREE.Mesh(paddleGeo, accentMat)
  const paddleRight = new THREE.Mesh(paddleGeo, accentMat)
  paddleGroup.add(paddleLeft, paddleRight)

 // Tracking point for the paddle: this is the point that external code (like main.js) 
 // will use to track the position of the paddle.
  const paddleCenter = new THREE.Object3D()
  paddleGroup.add(paddleCenter)

  // Second tracking point, only for HANDLING/shooting: where the two
  // halves' normals converge, not their flat midpoint. See updatePaddleCenter().
  const ballRestPoint = new THREE.Object3D()
  paddleGroup.add(ballRestPoint)

  // Extra closing offset on top of paddleAngle (kept as "shape" in state/Copy Config).
  let gripOffset = 0
  function effectivePaddleAngle() 
  {
    return Math.max(state.paddleAngle - gripOffset, 0) // clamp to 0 to avoid negative angles
  }

  // Shooting: opens the V upward instead of downward during release.
  let shootTiltOffset = 0

  // Perceptual correction only, not real geometry: pushes ballRestPoint further out.
  let ballRestExtraOffset = 0
  function updatePaddleCenter() // called whenever paddleAngle or ballRestExtraOffset changes
  {
    const halfAngle = effectivePaddleAngle() / 2
    const d = paddleWidth / 2
    // Flat midpoint of a half rotated by halfAngle: projects shorter by cos.
    paddleCenter.position.set(0, 0, d * Math.cos(halfAngle))
    // Where the two mirrored normals meet: grows by 1/cos as the V opens
    // (opposite of paddleCenter above). Both converge to d at angle 0.
    ballRestPoint.position.set(0, 0, d / Math.cos(halfAngle) + ballRestExtraOffset)
  }
  updatePaddleCenter()

  // The paddle must stay level (horizontal) relative to the world, not the wrist,
  function levelPaddle() // called whenever link1Group.rotation.x, elbow.rotation.x, or state.paddleTilt changes
  {
    paddleGroup.rotation.x = -(link1Group.rotation.x + elbow.rotation.x + WRIST_REST_PITCH) + state.paddleTilt + shootTiltOffset
  }

  function applyPaddleAngle() // called whenever state.paddleAngle or gripOffset changes
  {
    const angle = effectivePaddleAngle()
    paddleLeft.rotation.x = angle / 2
    paddleRight.rotation.x = -angle / 2
    updatePaddleCenter()
  }

  //Elbow Pitch Offsets
  let aimPitchOffset = 0
  let dribbleElbowOffset = 0
  function applyArmPitch() 
  {
    elbow.rotation.x = ELBOW_REST_PITCH + aimPitchOffset + dribbleElbowOffset
    levelPaddle()
  }

  //  Initial application of the paddle angle and level 
  levelPaddle()
  applyPaddleAngle()

  // Helpers to apply wheelsGroup scale and sync chassis height 
  function applyWheelsGroupScale()
  {
    wheelsGroup.scale.setScalar(state.wheelsScale * (state.discRadius / INITIAL_DISC_RADIUS))
  }

  // Sync the chassis height based on the wheels and disc dimensions
  function syncChassisHeight() {
    // The disc's top surface should be slightly embedded 
    // into the wheels for a solid attachment, without protruding above them.
    const wheelTopLocal = wheelOuterRadius * 2
    const wheelTopWorld = wheelTopLocal * wheelsGroup.scale.y
    
    // The disc's top surface should be slightly embedded into the wheels 
    // for a solid attachment, without protruding above them.
    const embed = discHeight * 0.35
    const discY = wheelTopWorld + discHeight / 2 - embed
    disc.position.y = discY
    base.position.y = discY + discHeight / 2
  }

  // Initial application of wheels scale and chassis height
  applyWheelsGroupScale()
  syncChassisHeight()

  
  // --- Controls: exposed to main.js for runtime manipulation of the model ---
  const controls = 
  {
    manipulatorScale: makeScaleSetter(state, 'manipulatorScale', root),

    wheelsScale(s) {
      state.wheelsScale = s
      applyWheelsGroupScale()
      syncChassisHeight()
    },

    discScale: makeScaleSetter(state, 'discScale', disc),
    discRadius(r) {
      state.discRadius = r
      replaceGeometry(disc, new THREE.CylinderGeometry(r, r, discHeight, 32))
      applyWheelsGroupScale()
      syncChassisHeight()
    },

    link1: createLinkControls(state, {
      statePrefix: 'link1', mesh: link1, downstreamJoint: elbow,
      buildGeometry: makeLinkGeometry, thicknessNames: ['Thickness'],
    }),

    link2: createLinkControls(state, {
      statePrefix: 'link2', mesh: link2, downstreamJoint: wrist,
      buildGeometry: makeTaperedLinkGeometry, thicknessNames: ['Thickness', 'TipThickness'],
    }),


    baseJointScale: makeScaleSetter(state, 'baseJointScale', baseJoint),
    elbowJointScale: makeScaleSetter(state, 'elbowJointScale', elbowJoint),
    endEffectorScale: makeScaleSetter(state, 'endEffectorScale', endEffector),

    // Yaw of the base joint (R1) — rotates the entire arm around the vertical axis
    setAimYaw(angle) {
      base.rotation.y = angle
    },

    // Pitch of the elbow joint (R2) — rotates the link2 and wrist around the horizontal axis
    setAimPitch(pitchOffset) 
    {
      aimPitchOffset = pitchOffset
      applyArmPitch()
    },

    // Pitch offsets for dribbling: moves the elbow and link1 to adjust the paddle height 
    // without changing the paddle shape
    setDribbleOffsets(elbowOffset, link1Offset) {
      dribbleElbowOffset = elbowOffset
      link1Group.rotation.x = link1Offset
      applyArmPitch()
    },

    // Grip offset: adds an extra closing offset on top of paddleAngle, without changing the paddle shape
    setGrip(offset) {
      gripOffset = offset
      applyPaddleAngle()
    },

    // Tilt offset for shooting: adds an extra tilt to the paddle during 
    // shooting, without changing the paddle shape
    setShootTilt(offset) {
      shootTiltOffset = offset
      levelPaddle()
    },

    // Extra offset for the ball rest point: moves the ball rest point further out, without changing the paddle shape
    // This is used to adjust the position of the ball rest point for better handling/shooting
    setBallRestOffset(extra) {
      ballRestExtraOffset = extra
      updatePaddleCenter()
    },

    // Paddle angle: sets the angle of the paddle (V shape) in radians, 0 = closed, PADDLE_ANGLE_MAX = fully open
    paddleAngle(a) 
    {
      state.paddleAngle = a
      applyPaddleAngle()
      updatePaddleCenter()
    },

    // Paddle tilt: sets the inclination of the paddle (V shape) in radians, 0 = horizontal, positive = downwards
    paddleTilt(angle) {
      state.paddleTilt = angle
      levelPaddle()
    },

    // Sets the yaw of the wheels group (for steering) in radians
    setWheelsYaw(angle) {
      wheelsGroup.rotation.y = angle
    },
    // Expose color controls for body, arm, and accent materials
    ...createColorControls({ body: bodyMat, arm: armMat, accent: accentMat }),
  }

  // Apply initial scales to the model parts based on the state
  controls.discScale(state.discScale)
  controls.link1.scale(state.link1Scale)
  controls.link2.scale(state.link2Scale)
  controls.baseJointScale(state.baseJointScale)
  controls.elbowJointScale(state.elbowJointScale)
  controls.endEffectorScale(state.endEffectorScale)

  // Return a copy of the current configuration state
  function getConfig() 
  {
    return { ...state }
  }

  // Return the current paddle tilt value
  function getPaddleTilt() {
    return state.paddleTilt
  }

  return {
    root,
    wheelsGroup,
    joints: { base, elbow, wrist },
    // paddleCenter (non paddleGroup): il punto di tracking esterno deve
    // essere al centro della paletta, non sul giunto di aggancio
    paddle: paddleCenter,
    // SOLO per HANDLING/tiro in main.js — vedi commento su ballRestPoint sopra
    ballRestPoint,
    controls,
    getConfig,
    getPaddleTilt,
  }
}
