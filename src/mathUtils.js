import * as THREE from 'three'

// Helper matematici puri (nessuno stato, nessuna dipendenza di gioco) —
// candidati "a rischio zero" per l'estrazione da main.js: usati da più
// punti (movimento, camera, sterzata ruote, mira), ma non toccano mai
// manipulator/basketball/scene/eccetera direttamente.

// converte un angolo (yaw, rad) nel vettore forward orizzontale
// corrispondente — usato per WASD relativo alla camera, dash, sterzata
// ruote, tracking della paletta nel palleggio
export function angleToForward(angle, out) {
  return out.set(Math.sin(angle), 0, Math.cos(angle))
}

// "destra" rispetto a un forward orizzontale: rotazione di -90° attorno a
// Y, equivalente a cross(forward, worldUp)
export function rotateRight(forward, out) {
  return out.set(-forward.z, 0, forward.x)
}

// interpolazione angolare con via breve sul wrap-around (es. da 350° a
// 10° gira per 20°, non per 340°) — usata per la sterzata delle ruote
export function lerpAngle(current, target, factor) {
  const diff = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI
  return current + diff * factor
}
