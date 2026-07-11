import * as THREE from 'three'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { isCombatMoveActive } from './CombatMoves.js'

// FSM delle decisioni dell'AI nemica — "enum" congelato, stesso pattern di
// RobotState/BallState/Team. Diversa da RobotState (DRIBBLE/HANDLING/
// NO_BALL, lo stato fisico di possesso/animazione condiviso da QUALUNQUE
// robot, giocatore incluso): EnemyState è la decisione tattica, solo per i
// robot guidati dall'AI.
export const EnemyState = Object.freeze({
  CHASE_BALL: 'chase_ball', // insegue la palla libera o cerca di rubarla (STEAL) a chi ce l'ha
  ATTACK: 'attack',         // ha la palla, punta al canestro e tira quando in range
  DEFEND: 'defend',         // l'avversario ha la palla, si frappone/cerca BLOCK
})

// distanza dal canestro sotto la quale l'AI tenta il tiro invece di
// continuare ad avvicinarsi
const AI_SHOOT_RANGE = 500
// quanto "finge di mirare" (HANDLING) prima di tirare davvero — tempo perché
// l'animazione di presa si veda, non un tiro istantaneo appena entra in range
const AI_AIM_DURATION = 0.6
// sotto questa distanza dal bersaglio (canestro o palla) l'AI si considera
// "arrivata" e smette di muoversi in quella direzione — altrimenti
// vibrerebbe avanti/indietro attorno al bersaglio
const AI_ARRIVAL_RADIUS = 30
// distanza minima dal GIOCATORE che il nemico non deve mai attraversare —
// senza questo, CHASE_BALL/DEFEND lo spingono a inseguire un bersaglio che
// nella pratica coincide con la posizione del giocatore stesso (la palla
// palleggiata è proprio lì), compenetrandolo visivamente. Più ampia di
// AI_ARRIVAL_RADIUS (quella è per bersagli generici come canestro/palla
// libera, questa è specifica per "non stare DENTRO l'altro robot")
// esportata: main.js applica lo STESSO limite anche al movimento del
// giocatore (WASD/dash) — senza, il vincolo era a senso unico: il nemico
// non poteva avvicinarsi troppo, ma il giocatore poteva comunque
// attraversarlo camminandoci sopra
export const AI_MIN_PLAYER_DISTANCE = 110
// stessa velocità di sterzata ruote del giocatore (src/main.js, WHEEL_TURN_SPEED)
const AI_WHEEL_TURN_SPEED = 18
// distanza sotto la quale l'AI tenta STEAL (avversario col possesso) o
// BLOCK (tiro avversario in volo) invece di limitarsi ad avvicinarsi —
// initCombatMoves scarta comunque il tentativo se fuori dal vero raggio di
// contatto (paletta-vs-palla) o in cooldown, questo è solo "abbastanza
// vicino da provarci", non una garanzia di successo
const AI_STEAL_ATTEMPT_RANGE = 120
const AI_BLOCK_ATTEMPT_RANGE = 150

// Schema stati/transizioni della contesa palla in 1v1 (per robot X, con
// "altro" Y che condivide la stessa basketball):
//   RobotState  X: DRIBBLE | HANDLING | NO_BALL
//   BallState     : HANDLED | FREE_SHOT | FREE            (una sola, globale)
//   Basketball.owner: null | X | Y                          (una sola, globale)
//   pickupState X: idle | active     (0.3s, invisibile a manipulator.state)
//   stealState/blockState X: idle | reach | resolve (+ cooldown indipendente)
//   shootingState X: idle | windup | release | recover
// Invariante chiave: ball.owner === X deve implicare che SOLO il dispatch
// di X stia scrivendo basketball.position questo frame — ogni bug trovato
// in questo sottosistema (steal durante il tiro abbandonato dell'altro,
// palla congelata dopo un furto, steal durante il pickup a metà, block che
// lascia il tiratore a inseguire fisica propria) era la STESSA violazione:
// due dispatch che scrivono la posizione della stessa palla nello stesso
// frame perché uno stato "di transizione" (pickupState.active,
// shootingState non idle, dash) non era considerato da chi cambia owner.
// Regola applicata ovunque ora: chi tenta di cambiare owner (STEAL) o
// stato (pickup/finishResolve) deve verificare lo stato di transizione
// dell'ALTRO PRIMA di agire, e chi COMPLETA un'animazione deve riverificare
// di possedere ancora la palla PRIMA di finalizzare (non assumerlo da
// quando l'animazione è partita).
//
// Navigazione: linea diretta verso il bersaglio, NESSUN aggiramento
// ostacoli per ora (a differenza di thehollowzone, scouting già fatto,
// vedi README → "Spunti per Enemy AI") — scelta deliberata: sia il
// giocatore sia il nemico restano quasi sempre vicino al centro campo
// (inseguono palla/canestro), gli ostacoli reali (muri/pali/panchine/
// tribuna) stanno tutti ai bordi. Aggiungere waypoint di aggiramento (le
// stesse AABB già in CollisionWorld, pattern già scoutato e pronto) resta
// un miglioramento futuro SE e quando si rivelasse un problema vero,
// non prima
export function initEnemyAI(ctx) {
  const {
    getEnemyManipulator, getPlayerManipulator, getBasketball, collisionWorld,
    enemyShootingState,
    targetHoopIndex = 0,
    // canestro a cui punta il GIOCATORE (per posizionarsi in DEFEND) — di
    // solito l'altro rispetto a targetHoopIndex, ma non assunto: passato
    // esplicito per restare corretto qualunque sia l'assegnazione squadre
    playerTargetHoopIndex = 0,
    triggerSteal, triggerBlock, triggerShoot, canUseSteal,
    playerShootingState,
    enemyStealState, enemyBlockState,
  } = ctx

  let aiState = EnemyState.CHASE_BALL
  let aimTimer = 0

  const scratchDir = new THREE.Vector3()
  const scratchTarget = new THREE.Vector3()
  const scratchDefendPos = new THREE.Vector3()
  // distanza FISSA dal giocatore (non una frazione della distanza
  // giocatore-canestro: con quella, più il giocatore era lontano dal
  // proprio canestro più il nemico finiva lontano anche da LUI). DERIVATA
  // da AI_MIN_PLAYER_DISTANCE (definita sopra, in questo stesso file) +
  // un margine, non un secondo numero scelto a mano: un bersaglio PIÙ
  // VICINO del minimo fisico anti-compenetrazione (provato, 70) creava un
  // tiro alla fune ogni frame (l'IA spinge verso 70, la fisica respinge a
  // 110) che impediva di convergere in modo stabile sulla direzione
  // giusta ("continua a non farlo"). Con la relazione esplicita, un
  // domani cambio di AI_MIN_PLAYER_DISTANCE aggiorna anche questo bersaglio
  // invece di riaprire in silenzio lo stesso tiro alla fune
  const DEFEND_CLEARANCE_MARGIN = 5
  const DEFEND_OFFSET_DISTANCE = AI_MIN_PLAYER_DISTANCE + DEFEND_CLEARANCE_MARGIN

  // sterza ruote+braccio verso un angolo già noto (atan2 è invariante alla
  // scala: funziona identico su un vettore normalizzato o no, niente
  // bisogno di normalizzare solo per l'angolo)
  function steerToward(dirX, dirZ, delta) {
    const enemyManipulator = getEnemyManipulator()
    const targetAngle = Math.atan2(dirX, dirZ)
    // updateLocomotionAnimation (RobotBase.js) fa l'interpolazione vera e
    // propria (lerpAngle, stesso smoothing di sempre) e la applica a
    // wheelsGroup — di proprietà del robot, non più un `let` locale qui.
    // Il braccio (setAimYaw) segue lo stesso yaw appena interpolato: a
    // differenza del giocatore (mira da camera, scollegata dal movimento)
    // il nemico non ha una camera, l'aim segue sempre la direzione di marcia
    enemyManipulator.updateLocomotionAnimation(targetAngle, delta, AI_WHEEL_TURN_SPEED)
    enemyManipulator.controls.setAimYaw(enemyManipulator.locomotionYaw)
  }

  // ruota ruote+braccio (base R1) verso targetPos, SENZA muovere la
  // posizione — usata sia da moveToward (mentre ci si sposta) sia da sola
  // (mentre si è fermi, es. durante la mira/il tiro vero e proprio: senza
  // questo il braccio restava congelato all'ultima direzione di marcia
  // invece di puntare davvero il canestro per tutta la durata dell'aim)
  function faceToward(targetPos, delta) {
    scratchDir.subVectors(targetPos, getEnemyManipulator().root.position)
    scratchDir.y = 0
    if (scratchDir.lengthSq() < 1) return
    steerToward(scratchDir.x, scratchDir.z, delta)
  }

  // muove il robot in linea retta verso targetPos (solo X/Z), sterzando
  // ruote+braccio mentre lo fa — faceTarget opzionale (default lo stesso
  // targetPos) per i casi in cui ci si sposta verso un punto ma si vuole
  // restare rivolti verso un ALTRO bersaglio (DEFEND: il nemico si
  // posiziona verso il canestro del giocatore ma deve restare rivolto
  // verso IL GIOCATORE stesso, non verso il punto in cui si sta muovendo).
  // Quando faceTarget coincide con targetPos (il caso comune), la stessa
  // sottrazione calcolata per il movimento serve anche per la sterzata,
  // invece di richiederne una seconda identica
  function moveToward(targetPos, delta, faceTarget = targetPos) {
    const enemyManipulator = getEnemyManipulator()
    scratchDir.subVectors(targetPos, enemyManipulator.root.position)
    scratchDir.y = 0
    const dist = scratchDir.length()
    if (faceTarget === targetPos) {
      if (dist >= 1) steerToward(scratchDir.x, scratchDir.z, delta)
    } else {
      faceToward(faceTarget, delta)
    }
    if (dist > 1) scratchDir.normalize()
    if (dist < AI_ARRIVAL_RADIUS) return
    enemyManipulator.move(scratchDir, delta)
    // NIENTE correzione qui: il nemico non deve mai essere lui a fermarsi/
    // deviare per la vicinanza del giocatore (lo faceva "incastrare"/
    // oscillare vicino a lui, movimento innaturale) — chi cede è SEMPRE il
    // giocatore, per "peso"/priorità di balance: main.js applica lo stesso
    // AI_MIN_PLAYER_DISTANCE spostando SOLO manipulator.root (il
    // giocatore), mai enemyManipulator.root
  }

  // triggerShoot (avvio windup) arriva da ctx ora — stessa sequenza
  // condivisa col mousedown del giocatore in main.js, esportata da
  // ShootingSystem.js (stesso principio già in uso per triggerSteal/
  // triggerBlock, CombatMoves.js). Le precondizioni (aimTimer/HANDLING)
  // restano qui, non nella funzione condivisa

  function update(delta) {
    const ball = getBasketball()
    if (!ball) return
    const enemyManipulator = getEnemyManipulator()
    const playerManipulator = getPlayerManipulator()

    // STEAL/BLOCK in corso: niente decisioni di movimento finché non
    // finisce (reach+resolve) — altrimenti il nemico continuava a
    // camminare/girarsi mentre l'animazione (0.4-0.6s, non più istantanea
    // come prima) sventolava il braccio per conto suo, le due cose non
    // sincronizzate sembravano un unico glitch
    if (isCombatMoveActive(enemyStealState, enemyBlockState)) return

    // BLOCK ha priorità assoluta sullo stato tattico: un tiro in volo
    // (FREE_SHOT) non ha owner (azzerato al rilascio, vedi ShootingSystem),
    // quindi altrimenti finirebbe scambiato per "palla libera" (CHASE_BALL)
    // invece che per "tiro da intercettare" — sono situazioni diverse,
    // solo BLOCK intercetta un FREE_SHOT, il pickup automatico lo ignora
    if (ball.state === BallState.FREE_SHOT) {
      aimTimer = 0
      if (enemyManipulator.state === RobotState.NO_BALL) {
        if (enemyManipulator.root.position.distanceTo(ball.position) <= AI_BLOCK_ATTEMPT_RANGE) triggerBlock()
        else moveToward(ball.position, delta)
      }
      return
    }

    if (ball.owner === enemyManipulator) aiState = EnemyState.ATTACK
    else if (ball.owner === playerManipulator) aiState = EnemyState.DEFEND
    else aiState = EnemyState.CHASE_BALL

    if (aiState === EnemyState.ATTACK) {
      // il canestro bersaglio non dipende dal ramo HANDLING/DRIBBLE qui
      // sotto, calcolato una volta sola invece che in entrambi
      const hoop = collisionWorld.hoops[targetHoopIndex]
      scratchTarget.set(hoop.center.x, hoop.center.y, hoop.center.z)
      if (enemyManipulator.state === RobotState.HANDLING) {
        // punta DAVVERO il canestro per tutta la mira/il tiro — senza
        // questo il braccio restava congelato all'ultima direzione di
        // marcia invece di seguire il vero bersaglio (era proprio questo
        // il motivo per cui il tiro non sembrava mirato al canestro,
        // anche se la fisica del volo lo era comunque)
        faceToward(scratchTarget, delta)
        aimTimer += delta
        if (enemyShootingState.phase === 'idle' && aimTimer >= AI_AIM_DURATION) triggerShoot()
      } else if (enemyManipulator.state === RobotState.DRIBBLE) {
        if (enemyManipulator.root.position.distanceTo(scratchTarget) <= AI_SHOOT_RANGE) {
          enemyManipulator.setState(RobotState.HANDLING)
          enemyShootingState.released = false
          aimTimer = 0
        } else {
          moveToward(scratchTarget, delta)
        }
      }
    } else if (aiState === EnemyState.DEFEND) {
      aimTimer = 0
      // calcolata una volta sola (BLOCK e STEAL sotto la usavano entrambi,
      // ricalcolandola ciascuno per conto proprio)
      const distToPlayer = enemyManipulator.root.position.distanceTo(playerManipulator.root.position)
      // BLOCK preventivo: SEMPRE controllato, indipendentemente da STEAL
      // pronto o no. Agganciato a shootingState.phase==='release' (la vera
      // motion di tiro, non solo "sta mirando" in HANDLING) — quel primo
      // tentativo scattava con manipulator.state===HANDLING, vero per
      // TUTTO il tempo che il giocatore tiene il tasto destro anche solo
      // per guardarsi intorno, quindi partiva anche senza nessuna
      // intenzione di tirare. 'release' scatta solo a windup concluso,
      // quando il tiro è davvero in corso — dà comunque margine (la reach
      // di 0.3s copre gran parte della release, che dura shootTuning.
      // releaseDuration prima del vero distacco della palla)
      if (enemyManipulator.state === RobotState.NO_BALL && playerShootingState.phase === 'release'
        && distToPlayer <= AI_BLOCK_ATTEMPT_RANGE) {
        triggerBlock()
      }
      // posizione di difesa: SEMPRE tra il giocatore e IL SUO canestro (non
      // stargli esattamente sopra) — questo è il movimento di default in
      // DEFEND, non solo un ripiego quando STEAL è in cooldown com'era
      // prima (con STEAL quasi sempre pronto, il nemico finiva per
      // inseguire il giocatore dritto invece di mettersi davanti quasi
      // sempre). Rivolto verso il giocatore con l'end effector (faceTarget)
      // per tutto il tempo, sia in marcia sia una volta arrivato
      const playerHoop = collisionWorld.hoops[playerTargetHoopIndex]
      scratchTarget.set(playerHoop.center.x, playerHoop.center.y, playerHoop.center.z)
      scratchDir.subVectors(scratchTarget, playerManipulator.root.position)
      scratchDir.y = 0
      if (scratchDir.lengthSq() > 1) scratchDir.normalize()
      scratchDefendPos.copy(playerManipulator.root.position).addScaledVector(scratchDir, DEFEND_OFFSET_DISTANCE)
      moveToward(scratchDefendPos, delta, playerManipulator.root.position)
      // STEAL tentato in parallelo, se pronto e abbastanza vicino —
      // initCombatMoves scarta comunque il tentativo se il vero raggio di
      // contatto non lo permette, questo è solo "vale la pena provarci"
      if (canUseSteal() && enemyManipulator.state === RobotState.NO_BALL && distToPlayer <= AI_STEAL_ATTEMPT_RANGE) {
        triggerSteal()
      }
    } else { // CHASE_BALL
      aimTimer = 0
      moveToward(ball.position, delta)
    }
  }

  // resync di enemyManipulator.locomotionYaw (RobotBase.js): se qualcun
  // altro tocca enemyManipulator.controls.setWheelsYaw direttamente
  // (MainMenu.js su BACK TO MAIN MENU) senza aggiornare anche questo, il
  // prossimo updateLocomotionAnimation farebbe scivolare visibilmente le
  // ruote dal valore vecchio (lerpAngle) invece di ripartire pulito
  function resetWheelsAngle(angle) {
    getEnemyManipulator().locomotionYaw = angle
  }

  return { update, getState: () => aiState, resetWheelsAngle }
}
