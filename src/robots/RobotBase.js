// Wrapper OOP sopra le factory function dei robot (createManipulatorRobot(),
// in futuro createLeggedManipulatorRobot()/createDroneRobot()). Le factory
// restano la fonte di verità per la costruzione Three.js — non cambia nulla
// lì — questa classe aggiunge solo stat/tipo/comportamento condiviso.
// Object.assign copia root/wheelsGroup/joints/paddle/controls/getConfig
// sull'istanza, quindi tutto quello che main.js già usa (manipulator.root,
// manipulator.controls.X(), ecc.) continua a funzionare identico anche
// passando per questa classe — nessuna migrazione forzata del chiamante.

// SPEED è uno stat 1-5 (stesso struct per ogni classe, cambiano solo i
// valori), convertito in unità mondo/secondo con questa formula: SPEED=3
// corrisponde a 200, il valore già tarato a occhio per MANIPULATOR prima
// che esistessero le stat.
function speedStatToUnitsPerSecond(speedStat) {
  return 50 + speedStat * 50
}

// "Enum" equivalente in JS: non esiste un costrutto enum nativo, il pattern
// idiomatico è un oggetto plain congelato — RobotState.DRIBBLE invece di
// stringhe sciolte in giro per il codice, autocomplete-friendly, e
// Object.freeze impedisce di riassegnare/aggiungere chiavi per sbaglio
export const RobotState = Object.freeze({
  DRIBBLE: 'dribble',    // palleggio automatico attivo (comportamento di default)
  HANDLING: 'handling',  // palla afferrata e ferma in mano, palleggio in pausa
  NO_BALL: 'no_ball',    // palla appena tirata, non più in mano/palleggio finché non viene ripresa
})

export class RobotBase {
  constructor({ factory, stats, type, team }) {
    Object.assign(this, factory())
    this.stats = stats
    this.type = type
    this.team = team // Team.A/Team.B (src/Team.js) — chi possiede la palla si legge da qui via Basketball.owner.team
    this.state = RobotState.DRIBBLE
  }

  setState(state) {
    this.state = state
  }

  // velocità di BASE (unità mondo/s), sempre piena — usata dal dash: uno
  // scatto resta lo stesso burst indipendentemente da HANDLING, non va
  // rallentato dalla stessa riduzione del movimento normale
  get baseSpeed() {
    return speedStatToUnitsPerSecond(this.stats.speed)
  }

  // velocità reale (unità mondo/s) derivata dallo stat SPEED — usata dal
  // movimento normale. Ridotta al 75% in HANDLING: si cammina un po' più
  // lenti mentre si tiene la palla ferma in mano, non dimezzata (troppo
  // penalizzante mentre si mira)
  get speed() {
    return this.state === RobotState.HANDLING ? this.baseSpeed * 0.75 : this.baseSpeed
  }

  // movimento condiviso da tutte le classi: la velocità viene dallo stat,
  // non da una costante fissa in main.js
  move(moveVec, delta) {
    this.root.position.addScaledVector(moveVec, this.speed * delta)
  }

  // ogni classe con una mossa speciale la sovrascrive; il default è "nessuna"
  specialMove() {}
}
