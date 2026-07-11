import { AMRManipulatorModelMaker } from './ModelMakers/AMRManipulatorModelMaker.js'
import { RobotBase } from './RobotBase.js'

//I MADE THIS AS A WRAPPER CLASS BECAUSE it's a better fit of abstraction for me


// SHOOTING is 1-3 (not 1-5 like the others): strength of the hoop-assist
// pull, not shot power. STEAL/BLOCK are 1-5, higher = shorter cooldown.
export const MANIPULATOR_STATS = { speed: 3, shooting: 1, steal: 3, block: 3 }

export class AMRManipulator extends RobotBase {
  constructor(team) {
    super({ factory: AMRManipulatorModelMaker, stats: MANIPULATOR_STATS, type: 'MANIPULATOR', team })
  }

  // Dash does NOT go through RobotBase's specialMove hooks
}
