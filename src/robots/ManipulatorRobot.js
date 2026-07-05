import { createManipulatorRobot } from './manipulator.js'
import { RobotBase } from './RobotBase.js'

// stat MANIPULATOR: SPEED=3 -> 200 unità/s (il valore già tarato a occhio
// prima che esistessero le stat). POWER=3 ancora senza consumer, sarà usato
// dallo Shooting System (Section 2)
const MANIPULATOR_STATS = { speed: 3, power: 3 }

export class ManipulatorRobot extends RobotBase {
  constructor() {
    super({ factory: createManipulatorRobot, stats: MANIPULATOR_STATS, type: 'MANIPULATOR' })
  }
}
