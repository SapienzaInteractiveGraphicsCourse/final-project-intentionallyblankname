import * as THREE from 'three'

// Helper generici di geometria/controlli "Scale" condivisi dai 3 ModelMaker
// (AMRManipulatorModelMaker/LeggedManipulatorModelMaker/DroneModelMaker) —
// robot-agnostici (non toccano la parte "delicata": il blocco braccio 3R+
// paletta resta duplicato deliberatamente in ognuno, vedi CLAUDE.md → cosa
// resta E perché). Prima erano ridefiniti identici in tutti e tre; qui
// prendono `state` come parametro esplicito invece di chiuderlo, perché
// ogni ModelMaker ha il proprio oggetto state locale (non condivisibile).

// dispose + riassegna: le geometrie non sono ridimensionabili "in place"
export function replaceGeometry(mesh, newGeo) {
  mesh.geometry.dispose()
  mesh.geometry = newGeo
}

// setter "scale" generico: stessa forma per disc/link1/link2/giunti,
// cambia solo la state-key e la mesh target
export function makeScaleSetter(state, key, mesh) {
  return s => {
    state[key] = s
    mesh.scale.setScalar(s)
  }
}

export function makeLinkGeometry(length, thickness) {
  const geo = new THREE.BoxGeometry(thickness, length, thickness)
  geo.translate(0, length / 2, 0) // pivot all'estremità inferiore
  return geo
}

// link rastremato (base ≠ punta): CylinderGeometry con radialSegments=4 è
// un prisma a base quadrata invece che rotondo; top/bottom radius diversi =
// tronco di piramide, cioè un parallelepipedo trapezoidale. radius =
// thickness/√2 per far coincidere la larghezza faccia-a-faccia (non
// spigolo-a-spigolo) con lo spessore, coerente col BoxGeometry
export function makeTaperedLinkGeometry(length, baseThickness, tipThickness) {
  const rBase = baseThickness / Math.SQRT2
  const rTip = tipThickness / Math.SQRT2
  const geo = new THREE.CylinderGeometry(rTip, rBase, length, 4)
  geo.rotateY(Math.PI / 4) // allinea le facce piatte agli assi X/Z
  geo.translate(0, length / 2, 0) // pivot all'estremità inferiore (base)
  return geo
}

// genera Scale/Length/Thickness(+TipThickness) per un link, parametrico su
// state/mesh/funzione di geometria/giunto a valle da riposizionare — link1
// e link2 differiscono solo per questi argomenti
export function createLinkControls(state, { statePrefix, mesh, downstreamJoint, buildGeometry, thicknessNames }) {
  const lengthKey = `${statePrefix}Length`
  function rebuild() {
    const thicknessArgs = thicknessNames.map(name => state[`${statePrefix}${name}`])
    replaceGeometry(mesh, buildGeometry(state[lengthKey], ...thicknessArgs))
  }
  const linkControls = {
    [`${statePrefix}Scale`]: makeScaleSetter(state, `${statePrefix}Scale`, mesh),
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

// setColors/getColors condivisi dai 3 ModelMaker — 3 "canali" colore
// uniformi per ogni classe (body/arm/accent), a prescindere da quante MESH
// diverse condividano ciascun materiale (es. bodyMat è condiviso da
// disco+chassis in AMR, solo dallo scafo nel Drone). Materiali creati UNA
// volta per CHIAMATA di factory (mai condivisi tra istanze/classi), quindi
// mutare `.color` qui tocca solo il robot proprietario — usato sia per il
// default per-squadra (RobotBase, arancione/viola) sia per la
// personalizzazione dal vivo (pulsante "Personalizza" nel Main Menu)
export function createColorControls({ body: bodyMat, arm: armMat, accent: accentMat }) {
  return {
    setColors({ body, arm, accent } = {}) {
      if (body !== undefined) bodyMat.color.set(body)
      if (arm !== undefined) armMat.color.set(arm)
      if (accent !== undefined) accentMat.color.set(accent)
    },
    getColors() {
      return { body: bodyMat.color.getHex(), arm: armMat.color.getHex(), accent: accentMat.color.getHex() }
    },
  }
}
