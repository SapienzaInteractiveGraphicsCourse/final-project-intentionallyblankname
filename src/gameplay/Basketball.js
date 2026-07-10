// Wrapper OOP leggero sopra il mesh GLTF del pallone (analogo a RobotBase
// per i robot): "enum" congelato + stato invece di un booleano sciolto in
// main.js, così il possesso della palla è un fatto della PALLA stessa, non
// dedotto ogni volta dallo stato del robot che la tiene.
export const BallState = Object.freeze({
  HANDLED: 'handled',     // posseduta da un robot (palleggiata o stretta in mano)
  // in volo da un tiro, fino al PRIMO urto con qualunque cosa (pavimento/
  // ferro/backboard/muro/palo/panchina) — NON triggera il pickup automatico
  // (checkForPickup in BallPossession.js resta agganciato solo a FREE): un
  // tiro in volo non si raccoglie camminandoci sotto, si intercetta solo
  // con la mossa BLOCK. Dopo quel primo urto la palla passa a FREE — a
  // quel punto è "sporca"/riprendibile da chiunque come una palla persa
  // qualunque, il pickup normale torna valido
  FREE_SHOT: 'free_shot',
  FREE: 'free',           // libera: ferma/rotolante a terra, o dopo il primo urto di un tiro
})

export class Basketball {
  constructor(mesh) {
    this.mesh = mesh
    this.state = BallState.FREE
    // owner: riferimento al robot che la tiene ora (null se libera). team:
    // SEMPRE derivato da owner.team via setOwner() — mai assegnato a mano
    // altrove, per non rischiare che i due finiscano disallineati. Resta
    // leggibile anche a palla libera (non azzerato da un semplice
    // setState): utile per l'AI, es. "la palla è appena diventata libera,
    // ma era in mano agli avversari — chi deve corrercisi dietro con
    // priorità?"
    this.owner = null
    this.team = null
  }

  setState(state) {
    this.state = state
  }

  // unico punto che cambia il possesso — chiamato da pickup/steal/turnover/
  // canestro, mai owner/team assegnati direttamente altrove
  setOwner(robot) {
    this.owner = robot
    this.team = robot ? robot.team : this.team
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
