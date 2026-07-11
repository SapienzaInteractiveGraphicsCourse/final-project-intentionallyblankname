// Light OOP wrapper over the ball's GLTF mesh (same idea as RobotBase for
// robots): frozen "enum" + state instead of a loose boolean in main.js, so
// possession is a fact of the BALL itself, not derived from the robot.


export const BallState = Object.freeze({
  HANDLED: 'handled',     // held by a robot (dribbled or gripped)
  // In flight from a shot, until the FIRST hit (floor/rim/backboard/wall/
  // pole/bench),  doesn't trigger auto-pickup (only FREE does), only BLOCK
  // can intercept it. After that first hit it becomes FREE, up for grabs again.
  FREE_SHOT: 'free_shot',
  FREE: 'free',           // loose: resting/rolling, or after a shot's first hit
})

export class Basketball 
{
  constructor(mesh) 
  {
    this.mesh = mesh
    this.state = BallState.FREE
    // owner: robot holding it now (null if loose). team: always derived from
    // owner.team via setOwner(), never set by hand elsewhere. 
    this.owner = null
    this.team = null
  }

  setState(state)
   {
    this.state = state
  }

  // Single point that changes possession, called by pickup/steal/turnover/score
  setOwner(robot) {
    this.owner = robot
    this.team = robot ? robot.team : this.team
  }

  // Proxy to the mesh: rest of the code uses basketball.position/scale like it's the THREE.Object3D itself
  get position() 
  {
    return this.mesh.position
  }

  get scale() {
    return this.mesh.scale
  }
}
