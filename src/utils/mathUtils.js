import * as THREE from 'three'

//Pure Math Helpers

// Takes a Yaw angle in radians and returns a forward unit vector in the XZ plane
export function angleToForward(angle, out) 
{
  return out.set(Math.sin(angle), 0, Math.cos(angle))
}


export function rotateRight(forward, out) 
{
  return out.set(-forward.z, 0, forward.x)
}

// Interpolate (based on a factor between 0 and 1) between two angles in radians, taking the shortest path around the circle
export function lerpAngle(current, target, factor) {
  const diff = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI
  return current + diff * factor
}
