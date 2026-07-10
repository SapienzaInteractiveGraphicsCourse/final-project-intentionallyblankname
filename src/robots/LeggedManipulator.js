import { createLeggedManipulatorRobot } from './leggedManipulator.js'
import { RobotBase } from './RobotBase.js'

// stat LEGGED MANIPULATOR: più lento a spostarsi di MANIPULATOR (gambe,
// non ruote) ma migliore su tiro/difesa — differenzia davvero il roster
// invece di un secondo robot con gli stessi numeri. Stessi valori già
// usati come placeholder in main.js per la card disabilitata del Main
// Menu, ora la fonte di verità è qui (esportata, come MANIPULATOR_STATS)
export const LEGGED_MANIPULATOR_STATS = { speed: 2, shooting: 3, steal: 2, block: 5 }

export class LeggedManipulatorRobot extends RobotBase {
  constructor(team) {
    super({ factory: createLeggedManipulatorRobot, stats: LEGGED_MANIPULATOR_STATS, type: 'LEGGED_MANIPULATOR', team })
  }

  // TODO (Section 4): mossa speciale "Jump" — per ora eredita lo stub
  // vuoto di RobotBase.specialMove()
}
