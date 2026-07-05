// Wrapper OOP leggero sopra il mesh GLTF del pallone (analogo a RobotBase
// per i robot): "enum" congelato + stato invece di un booleano sciolto in
// main.js, così il possesso della palla è un fatto della PALLA stessa, non
// dedotto ogni volta dallo stato del robot che la tiene.
export const BallState = Object.freeze({
  HANDLED: 'handled', // posseduta da un robot (palleggiata o stretta in mano)
  FREE: 'free',        // libera: appena tirata, in volo, o ferma a terra
})

export class Basketball {
  constructor(mesh) {
    this.mesh = mesh
    this.state = BallState.FREE
  }

  setState(state) {
    this.state = state
  }

  // proxy verso il mesh: il resto del codice continua a usare
  // basketball.position/scale come se fosse il THREE.Object3D stesso
  get position() {
    return this.mesh.position
  }

  get scale() {
    return this.mesh.scale
  }
}
