import { createManipulatorRobot } from './manipulator.js'
import { RobotBase } from './RobotBase.js'

// stat MANIPULATOR: SPEED=3 -> 200 unità/s (il valore già tarato a occhio
// prima che esistessero le stat). SHOOTING su scala 1-3 (non 1-5 come le
// altre): 1 = nessuna correzione, 3 = massima — forza del campo potenziale
// attrattivo verso il centro canestro (vedi applyHoopAssist in main.js) —
// non tocca la forza del tiro (quella resta costante/di zona), solo quanto
// "aiuta" vicino al ferro
// esportata (non solo locale): la card di selezione robot nel Main Menu
// legge questi stessi valori per disegnare le barre a blocchi (SPEED su
// scala 1-5, SHOOTING su scala 1-3) invece di averli ricopiati a mano
// nell'HTML, che sarebbe potuto disallinearsi da questi
export const MANIPULATOR_STATS = { speed: 3, shooting: 1 }

export class ManipulatorRobot extends RobotBase {
  constructor() {
    super({ factory: createManipulatorRobot, stats: MANIPULATOR_STATS, type: 'MANIPULATOR' })
  }
}
