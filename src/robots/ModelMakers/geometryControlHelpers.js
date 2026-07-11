import * as THREE from 'three'



// helper functions for ModelMakers to create geometry and control it via state

// replaceGeometry: dispose of the old geometry and assign a new one to a mesh
export function replaceGeometry(mesh, newGeo) 
{
  mesh.geometry.dispose()
  mesh.geometry = newGeo
}

// setter "scale" generico: stessa forma per disc/link1/link2/giunti,
// cambia solo la state-key e la mesh target
export function makeScaleSetter(state, key, mesh) {
  return s => 
    {
    state[key] = s
    mesh.scale.setScalar(s)
  }
}
export function makeLinkGeometry(length, thickness) 
{
  const geo = new THREE.BoxGeometry(thickness, length, thickness)
  geo.translate(0, length / 2, 0) // pivot lower end (base) of the link, not its center
  return geo
}

// tapered link geometry: square cross-section, base and tip thicknesses differ
export function makeTaperedLinkGeometry(length, baseThickness, tipThickness) 
{
  const rBase = baseThickness / Math.SQRT2
  const rTip = tipThickness / Math.SQRT2
  const geo = new THREE.CylinderGeometry(rTip, rBase, length, 4)
  geo.rotateY(Math.PI / 4)        // square cross-section, not diamond
  geo.translate(0, length / 2, 0) // pivot lower end (base) of the link, not its center
  return geo
}

// createLinkControls: for a link mesh, create a set of setters that update the state and rebuild the geometry
// Generates functions based on the statePrefix and thicknessNames provided
export function createLinkControls(state, { statePrefix, mesh, downstreamJoint, buildGeometry, thicknessNames })
{
  const lengthKey = `${statePrefix}Length` // "link1Length" or "discLength" state itself stays flat (Copy Config)

  // rebuild: create a new geometry for the link mesh based on the current state values
  function rebuild() 
  {
    const thicknessArgs = []
    // here we obtain thickness values from state based on the provided thicknessNames
    for (let i = 0; i < thicknessNames.length; i++) thicknessArgs.push(state[`${statePrefix}${thicknessNames[i]}`])
    // replace the mesh's geometry with a new one built from the current length and thickness values
    replaceGeometry(mesh, buildGeometry(state[lengthKey], ...thicknessArgs))
  }

  // linkControls: a set of setters for the link's length and thicknesses, which update the state and rebuild the geometry
  const linkControls = 
  {
    scale: makeScaleSetter(state, `${statePrefix}Scale`, mesh),
    length(l) {
      state[lengthKey] = l
      rebuild()
      downstreamJoint.position.y = l
    },
  }

  // thickness setters: for each thickness name, create a setter that updates the state and rebuilds the
  // geometry,  propName lowercases the first letter ('Thickness' -> 'thickness', 'TipThickness' -> 'tipThickness')

  // propName is computed at runtime (e.g. 'thickness'/'tipThickness') — the
  // literal word never appears in this file, it comes from the caller's
  // thicknessNames array
  for (let i = 0; i < thicknessNames.length; i++) {
    const name = thicknessNames[i]
    const propName = name.charAt(0).toLowerCase() + name.slice(1) 
    linkControls[propName] = t => 
      {
      state[`${statePrefix}${name}`] = t
      rebuild()
    }
  }
  return linkControls
}

// createColorControls: for a set of materials, create a set of setters that update the colors of the materials
export function createColorControls({ body: bodyMat, arm: armMat, accent: accentMat }) {
  return {
    setColors({ body, arm, accent } = {}) 
    {
      if (body !== undefined) bodyMat.color.set(body)
      if (arm !== undefined) armMat.color.set(arm)
      if (accent !== undefined) accentMat.color.set(accent)
    },
    getColors() {
      return { body: bodyMat.color.getHex(), arm: armMat.color.getHex(), accent: accentMat.color.getHex() }
    },
  }
}
