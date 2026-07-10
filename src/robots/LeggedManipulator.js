import { LeggedManipulatorModelMaker } from './ModelMakers/LeggedManipulatorModelMaker.js'
import { RobotBase } from './RobotBase.js'

// stat LEGGED MANIPULATOR: più lento a spostarsi di MANIPULATOR (gambe,
// non ruote) ma migliore su tiro/difesa — differenzia davvero il roster
// invece di un secondo robot con gli stessi numeri.
export const LEGGED_MANIPULATOR_STATS = { speed: 2, shooting: 3, steal: 2, block: 5 }

// Jump — valori di partenza "sensati" (non tarati a occhio come i default
// di AMRManipulatorModelMaker.js, primo giro ancora da fare): un solo balzo verticale,
// 1 carica, cooldown medio (più lungo del Dash — non deve essere
// spammabile quanto un burst orizzontale). Fasi: crouch (anticipazione,
// le gambe si accovacciano) → air (parabola verticale pura, le gambe si
// estendono a metà volo e si preparano a richiudersi per l'atterraggio)
// → land (compressione d'impatto, ritorno a neutro)
const JUMP_COOLDOWN = 5
const JUMP_CROUCH_DURATION = 0.15
const JUMP_AIR_DURATION = 0.4
const JUMP_LAND_DURATION = 0.15
const JUMP_HEIGHT = 170 // unità mondo — stesso ordine di grandezza del burst orizzontale del Dash
const JUMP_CROUCH_BEND = -0.35 // rad, anca+ginocchio insieme (vedi setLegBend in LeggedManipulatorModelMaker.js)
const JUMP_AIR_BEND = 0.25 // rad, picco a metà volo

// Bozza di camminata: fase del ciclo del passo avanza solo mentre il
// robot si sta DAVVERO spostando (non da fermo, altrimenti "cammina sul
// posto" con le gambe che oscillano senza motivo). RobotBase non ha un
// segnale di velocità lineare pronto all'uso (solo lo yaw) — dedotta qui
// localmente dallo spostamento reale frame-su-frame di root.position,
// senza toccare l'interfaccia condivisa di updateLocomotionAnimation
// (main.js/EnemyAI.js continuano a chiamarla con gli stessi argomenti)
const WALK_MIN_SPEED = 1 // unità mondo/s — sotto soglia, jitter in virgola mobile a robot fermo, non movimento vero
const WALK_CYCLE_SPEED = 6 // rad/s di fase — valore di partenza, non legato alla velocità reale (Section 4: Animation Tweaks)

export class LeggedManipulator extends RobotBase {
  constructor(team) {
    super({ factory: LeggedManipulatorModelMaker, stats: LEGGED_MANIPULATOR_STATS, type: 'LEGGED_MANIPULATOR', team })
    this._prevPosition = this.root.position.clone()
    this._walkPhase = 0
    // manipulatorScale 56.25 = 45×1.25 (25% più alto di MANIPULATOR) — √1.25
    // (non 1.25, l'altezza del rimbalzo scala col QUADRATO della velocità,
    // h = v²/2g) sarebbe il minimo per pareggiare PROPORZIONALMENTE la
    // stessa altezza relativa di MANIPULATOR. Alzato oltre quel minimo
    // (richiesto dal vivo, "spinta con più forza, bounce più forte"): un
    // palleggio più energico si addice a un robot più pesante/a gambe
    // (più "atletico" nel tocco) — ancora tunabile dal pannello debug
    this.dribbleTuning.bounceSpeedScale = 1.4
  }

  // "camminata": pivot rigido delle gambe verso la direzione di marcia
  // ereditato invariato da RobotBase (super), PIÙ un vero ciclo del passo
  // (trot, coppie diagonali) sopra — sospeso durante il Jump (stesso
  // joint, non deve competere con setLegBend) e quando il robot è fermo
  updateLocomotionAnimation(targetYaw, delta, turnSpeed) {
    super.updateLocomotionAnimation(targetYaw, delta, turnSpeed)
    const dx = this.root.position.x - this._prevPosition.x
    const dz = this.root.position.z - this._prevPosition.z
    this._prevPosition.copy(this.root.position)
    if (this.specialMoveState.phase !== 'idle' || delta <= 0) return
    const speedNow = Math.hypot(dx, dz) / delta
    if (speedNow > WALK_MIN_SPEED) {
      this._walkPhase += delta * WALK_CYCLE_SPEED
      this.controls.setLegWalkCycle(this._walkPhase)
    } else if (this._walkPhase !== 0) {
      this._walkPhase = 0
      this.controls.setLegWalkCycle(0)
    }
  }

  get specialMoveMaxCharges() { return 1 }
  get specialMoveCooldownTime() { return JUMP_COOLDOWN }

  onSpecialMoveStart() {
    this.specialMoveState.phase = 'crouch'
    this.specialMoveState.phaseT = 0
  }

  // Jump: root.position.y segue una parabola pura durante 'air' (nessun
  // motore fisico, stesso stile imperativo del resto del progetto — non
  // una vera simulazione di gravità, un arco 4t(1-t) che parte e torna
  // a 0 esattamente su una durata fissa, come il resto delle animazioni
  // a timer di questo progetto). Le gambe (setLegBend) si accovacciano in
  // anticipazione, si estendono a metà volo (sin(t·π), stessa curva "va
  // e torna" usata altrove), poi si ricomprimono all'atterraggio
  onSpecialMoveUpdate(delta) {
    const s = this.specialMoveState
    if (s.phase === 'idle') return
    s.phaseT += delta
    if (s.phase === 'crouch') {
      const t = Math.min(s.phaseT / JUMP_CROUCH_DURATION, 1)
      this.controls.setLegBend(JUMP_CROUCH_BEND * t)
      if (t >= 1) { s.phase = 'air'; s.phaseT = 0 }
    } else if (s.phase === 'air') {
      const t = Math.min(s.phaseT / JUMP_AIR_DURATION, 1)
      this.root.position.y = JUMP_HEIGHT * 4 * t * (1 - t)
      this.controls.setLegBend(JUMP_AIR_BEND * Math.sin(t * Math.PI))
      if (t >= 1) { s.phase = 'land'; s.phaseT = 0 }
    } else { // 'land'
      const t = Math.min(s.phaseT / JUMP_LAND_DURATION, 1)
      this.root.position.y = 0
      this.controls.setLegBend(JUMP_CROUCH_BEND * (1 - t))
      if (t >= 1) { s.phase = 'idle'; s.phaseT = 0; this.controls.setLegBend(0) }
    }
  }
}
