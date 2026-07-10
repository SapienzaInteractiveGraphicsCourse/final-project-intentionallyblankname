// Persistenza (solo convenienza) della scelta robot tra una sessione e
// l'altra del browser — sessionStorage, non localStorage: una nuova tab
// deve ripartire dal default, non ereditare la scelta di un'altra partita.
//
// Lo switch VERO tra classi (main.js: setActiveRobotClass/
// setActiveEnemyRobotClass) non passa più da qui: tutte e 3 le classi sono
// precaricate all'avvio (nascoste, root.visible = false) e lo switch è solo
// una riassegnazione di riferimento + toggle di visibilità, MAI un reload —
// vedi il commento su setActiveRobotClass in main.js per il perché questo è
// sicuro (la schermata ROBOT è raggiungibile solo mentre il robot attivo è
// comunque nascosto). Questo modulo si limita a ricordare l'ultima scelta
// per un eventuale F5 vero, non è più coinvolto nel percorso critico
export const ROBOT_KEYS = Object.freeze({ MANIPULATOR: 'manipulator', LEGGED: 'legged', DRONE: 'drone' })

const STORAGE_KEY_PLAYER = 'mechaBasketball.robot'
const STORAGE_KEY_ENEMY = 'mechaBasketball.enemyRobot'

export function getSelectedRobotKey() {
  return sessionStorage.getItem(STORAGE_KEY_PLAYER) || ROBOT_KEYS.MANIPULATOR
}
export function getSelectedEnemyRobotKey() {
  return sessionStorage.getItem(STORAGE_KEY_ENEMY) || ROBOT_KEYS.MANIPULATOR
}
export function setSelectedRobotKey(key) {
  sessionStorage.setItem(STORAGE_KEY_PLAYER, key)
}
export function setSelectedEnemyRobotKey(key) {
  sessionStorage.setItem(STORAGE_KEY_ENEMY, key)
}
