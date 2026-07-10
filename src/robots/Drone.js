import * as THREE from 'three'
import { createDroneRobot } from './drone.js'
import { RobotBase } from './RobotBase.js'

// stat DRONE: il più veloce del roster (vola, non deve girare ruote/gambe
// per cambiare direzione) ma il peggiore in STEAL/BLOCK (corpo leggero,
// niente presa/massa per contrastare). Stessi valori già usati come
// placeholder in main.js per la card disabilitata del Main Menu
export const DRONE_STATS = { speed: 5, shooting: 2, steal: 1, block: 1 }

// quanto velocemente girano le pale (rad/s) — sempre, anche da fermo (un
// drone acceso non spegne le eliche stando fermo), e quanto si inclina in
// virata (bank, come un vero quadricottero: si inclina per cambiare
// direzione, non ruota sul posto come farebbe un robot a ruote/gambe)
const ROTOR_SPIN_SPEED = 24
// rad di bank per rad/s di velocità di imbardata — tarato perché una
// virata "decisa" (~2 rad/s, tipica quando lerpAngle rincorre un target
// lontano a inizio sterzata) arrivi vicino a BANK_MAX, poi il clamp sotto
// impedisce comunque qualunque inclinazione eccessiva a virate più brusche
const BANK_GAIN = 0.15
const BANK_MAX = 0.35
const BANK_SMOOTH_SPEED = 8

export class DroneRobot extends RobotBase {
  constructor(team) {
    super({ factory: createDroneRobot, stats: DRONE_STATS, type: 'DRONE', team })
    this._bank = 0
  }

  // "walking animation" del drone: non cammina — le pale girano SEMPRE
  // (spinRotors, indipendente dallo yaw target/delta) e il corpo si
  // inclina (bank) in proporzione a quanto sta virando in questo frame,
  // invece del semplice pivot rigido ereditato di default da RobotBase
  // (quello resta corretto per MANIPULATOR/LEGGED — ruote/gambe girano
  // rigidamente verso la direzione di marcia, un drone vero si INCLINA)
  updateLocomotionAnimation(targetYaw, delta, turnSpeed) {
    const prevYaw = this.locomotionYaw
    super.updateLocomotionAnimation(targetYaw, delta, turnSpeed)
    // lerpAngle (dentro il super) prende già la via breve sul
    // wrap-around, quindi la differenza qui resta piccola frame-su-frame
    // — nessun bisogno di un secondo unwrap
    const yawRate = delta > 0 ? (this.locomotionYaw - prevYaw) / delta : 0
    const bankTarget = THREE.MathUtils.clamp(-yawRate * BANK_GAIN, -BANK_MAX, BANK_MAX)
    this._bank += (bankTarget - this._bank) * (1 - Math.exp(-BANK_SMOOTH_SPEED * delta))
    this.controls.setBank(this._bank)
    this.controls.spinRotors(delta, ROTOR_SPIN_SPEED)
  }

  // TODO (Section 4): mossa speciale "Uplifting" — per ora eredita lo
  // stub vuoto di RobotBase.specialMove()
}
