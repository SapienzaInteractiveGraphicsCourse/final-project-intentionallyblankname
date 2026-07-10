import { AMRManipulatorModelMaker } from './ModelMakers/AMRManipulatorModelMaker.js'
import { RobotBase } from './RobotBase.js'

// stat MANIPULATOR: SPEED=3 -> 200 unità/s (il valore già tarato a occhio
// prima che esistessero le stat). SHOOTING su scala 1-3 (non 1-5 come le
// altre): 1 = nessuna correzione, 3 = massima — forza del campo potenziale
// attrattivo verso il centro canestro (vedi applyHoopAssist in main.js) —
// non tocca la forza del tiro (quella resta costante/di zona), solo quanto
// "aiuta" vicino al ferro. STEAL/BLOCK su scala 1-5 come SPEED: più alto
// = cooldown più corto (vedi stealCooldownFor/blockCooldownFor in
// CombatMoves.js — 11-STEAL e 7-BLOCK rispettivamente)
// esportata (non solo locale): la card di selezione robot nel Main Menu
// legge questi stessi valori per disegnare le barre a blocchi (SPEED/
// STEAL/BLOCK su scala 1-5, SHOOTING su scala 1-3) invece di averli
// ricopiati a mano nell'HTML, che sarebbe potuto disallinearsi da questi
export const MANIPULATOR_STATS = { speed: 3, shooting: 1, steal: 3, block: 3 }

export class AMRManipulator extends RobotBase {
  // team facoltativo (default undefined, retrocompatibile con la preview
  // robot del Main Menu che non appartiene a nessuna squadra) — il robot
  // del giocatore/nemico lo passa esplicitamente (Team.A/Team.B)
  constructor(team) {
    super({ factory: AMRManipulatorModelMaker, stats: MANIPULATOR_STATS, type: 'MANIPULATOR', team })
  }

  // Mossa speciale: Dash — ma NON passa da specialMove()/triggerSpecialMove()
  // (RobotBase.js): resta il meccanismo originale in main.js (dashState,
  // 2 cariche, cooldown 4s, 6.6× velocità "decentemente esplosivo"),
  // accoppiato a movimento/camera/HUD già esistente e testato. L'hook
  // condiviso (aggiunto insieme a Jump/Flight di LEGGED MANIPULATOR/
  // DRONE) è pensato per mosse NUOVE che partono da zero — migrare il
  // Dash dentro non aggiungerebbe nulla, solo rischio su un sistema
  // funzionante a ridosso della consegna
}
