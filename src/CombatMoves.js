import * as THREE from 'three'
import { RobotState } from './robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { dribbleAmplitudesRad, snapBallToRestPoint, getObjectWorldPosition, resetToNeutralPossession } from './BallPossession.js'
import { angleToForward } from './mathUtils.js'

// STEAL e BLOCK: entrambe animazioni di "allungo" (flette link1, estende
// elbow) via manipulator.controls.setDribbleOffsets — stessa API già usata
// da dribble/handling/shoot, nessuna nuova primitiva sul robot. Condividono
// abbastanza struttura (reach → contatto → resolve → cooldown, usabili
// SOLO in RobotState.NO_BALL) da stare in un solo modulo invece di due
// quasi identici.
//
// STEAL: successo se il ROBOT stealer è abbastanza vicino al vero corpo
// dell'avversario, con un margine ASIMMETRICO rispetto a dove sta
// guardando/spazzando LO STEALER (resolveAimYaw) — ampio davanti (il vero
// "allungo" del braccio, STEAL_FORWARD_MARGIN), quasi nullo alle spalle
// (STEAL_BACKWARD_MARGIN, praticamente a corpo) — non un cubo uniforme
// attorno all'avversario ("beccare una box del robot" indipendentemente
// da dove si guarda sembrava innaturale, rubabile anche di spalle) mentre
// la palla è HANDLED dall'AVVERSARIO —
// possesso trasferito, l'avversario derubato passa a NO_BALL (senza
// questo resterebbe in DRIBBLE con la palla ormai altrui, i due dispatch
// in main.js finirebbero per contendersi la stessa basketball.position
// ogni frame). Animazione: non un allungo statico, un vero SWEEP — la base
// (R1) spazza da un lato all'altro mentre link1/elbow restano tesi.
// BLOCK: successo se il contatto avviene mentre la palla è FREE_SHOT (tiro
// in volo, prima del primo rimbalzo) — nessun cambio di owner, il tiro
// viene solo deviato: la palla torna FREE (sganciata dal volo, "sporca",
// riprendibile subito), niente canestro. L'arm (yaw base) punta dritto
// verso la palla per tutta la reach, non una posa fissa.
// cooldown dipendente dalla stat STEAL/BLOCK del robot che esegue la mossa
// (scala 1-5, vedi MANIPULATOR_STATS in AMRManipulator.js) — più alto lo
// stat, più corto il cooldown. STEAL: valori scelti a mano, non una
// progressione lineare/esponenziale pulita (differenze -1,-1,-0.5,-0.5),
// quindi una tabella invece di una formula forzata. BLOCK resta 7-BLOCK
// (lineare, mai richiesto di cambiare)
const STEAL_COOLDOWN_BY_STAT = { 1: 6, 2: 5, 3: 4, 4: 3.5, 5: 3 }
// esportate (non solo interne): main.js le usa per calcolare la percentuale
// di riempimento delle barre HUD (stesso schema di DASH_COOLDOWN_TIME)
export function stealCooldownFor(stealStat) { return STEAL_COOLDOWN_BY_STAT[stealStat] }
export function blockCooldownFor(blockStat) { return 7 - blockStat }
// appena derubati, niente steal-back immediato per un po' — senza, chi non
// aveva mai usato STEAL prima (cooldown ancora a 0) poteva rubarla indietro
// nello stesso istante. Dipendente dallo stat STEAL della VITTIMA (più alto
// lo stat, più in fretta si riprende e può ritentare) — stessa tabella che
// STEAL_COOLDOWN_BY_STAT usava prima di questa modifica, riusata qui invece
// di un flat 2s uguale per tutti
const VICTIM_STEAL_LOCKOUT_BY_STAT = { 1: 4, 2: 3, 3: 2, 4: 1.5, 5: 1 }
function victimStealLockoutFor(stealStat) { return VICTIM_STEAL_LOCKOUT_BY_STAT[stealStat] }
const STEAL_REACH_DURATION = 0.4
const BLOCK_REACH_DURATION = 0.375 // rallentata del 20% (velocità all'80% di quella originale, 0.3s)
// tempo di rientro della posa (allungo → neutro) dopo successo O fallimento
// — stesso principio del "tuffo" del pickup: mai uno scatto secco
const RESOLVE_DURATION = 0.2
// margine di reach ASIMMETRICO oltre il vero corpo dell'avversario entro
// cui STEAL scatta, relativo a dove sta guardando/spazzando CHI RUBA
// (resolveAimYaw, non l'avversario): FORWARD è il vero "allungo" davanti
// (dove punta/spazza il braccio), BACKWARD è il margine alle spalle dello
// stealer — quasi a zero apposta, praticamente serve il corpo vero per
// rubare da lì. Esportate insieme a blockBoxHalfSizeFor: CollisionDebugView.js
// le disegna come wireframe (tasti 6/7) per poterle ispezionare a occhio,
// stessi identici valori usati qui per la logica vera
export const STEAL_FORWARD_MARGIN = 90
export const STEAL_BACKWARD_MARGIN = 20
// cubo di collisione dedicato all'END EFFECTOR per BLOCK — sostituisce il
// vecchio raggio di contatto sferico fisso (paletta-vs-palla): dimensione
// scalata sulla stat BLOCK di CHI ESEGUE la mossa (1-5). Livello 1 =
// dimensione base (contiene solo l'end effector), +20%/livello fino a
// +80% a livello 5 — esportata insieme alla base: CollisionDebugView.js
// (tasto 7) disegna lo STESSO cubo usato qui per il contatto vero, non
// un'approssimazione a parte
export const BLOCK_BOX_BASE_HALF_SIZE = 30
export function blockBoxHalfSizeFor(blockStat) {
  return BLOCK_BOX_BASE_HALF_SIZE * (1 + 0.2 * (blockStat - 1))
}
const STEAL_ELBOW_DEG = -70
const STEAL_LINK1_DEG = 50
const STEAL_SWEEP_AMPLITUDE_DEG = 50 // ampiezza dello spazzolamento base, da -X a +X gradi attorno alla direzione attuale
// verso l'ALTO, non in avanti: link1 vicino a 0 (resta verticale, niente
// tilt in avanti — quel +70 precedente inclinava tutto il braccio avanti)
// e gomito molto disteso (quasi dritto) per allungarsi sopra la testa
const BLOCK_ELBOW_DEG = -65
const BLOCK_LINK1_DEG = 5
// convertiti una sola volta (non ad ogni frame di reach) — stesso
// principio già seguito altrove nel progetto per le conversioni statiche
const STEAL_ELBOW_TARGET = THREE.MathUtils.degToRad(STEAL_ELBOW_DEG)
const STEAL_LINK1_TARGET = THREE.MathUtils.degToRad(STEAL_LINK1_DEG)
const STEAL_SWEEP_AMPLITUDE = THREE.MathUtils.degToRad(STEAL_SWEEP_AMPLITUDE_DEG)
const BLOCK_ELBOW_TARGET = THREE.MathUtils.degToRad(BLOCK_ELBOW_DEG)
const BLOCK_LINK1_TARGET = THREE.MathUtils.degToRad(BLOCK_LINK1_DEG)

// vero SOLO se il robot sta eseguendo la reach/resolve di una delle due
// mosse — usata da EnemyAI.js e da main.js per congelare tutto il resto
// (movimento/decisioni) finché l'animazione non finisce, invece di
// ritypare lo stesso confronto di fase in due file diversi
export function isCombatMoveActive(stealState, blockState) {
  return stealState.phase !== 'idle' || blockState.phase !== 'idle'
}

export function initCombatMoves(ctx) {
  const {
    getManipulator, getOtherManipulator, resetDribbleState, otherResetDribbleState,
    dribbleState, getBasketball, otherShootingState, otherDashState, sfx,
    otherHandlingState, otherStealState, otherPickupState, shootingState,
    pickupState, handlingState,
    // opzionale: da dove sta mirando questo robot, per il pivot dello
    // sweep di STEAL — il giocatore la passa (crosshair/orbit camera), il
    // nemico non ce l'ha (niente camera), ripiega sulle ruote
    getAimYaw,
    // raggio vero del pallone — serve al test sfera(palla)-vs-box(BLOCK),
    // vedi isBallInBlockBox sotto. Funzione, non un valore snapshot: resta
    // regolabile da debug panel a runtime (stesso principio di getBallRadius
    // già usato altrove nel progetto)
    getBallRadius,
    // stealState/blockState: SEMPRE passati da main.js (mai creati qui
    // dentro) — stealState del NEMICO deve essere leggibile dall'istanza
    // del GIOCATORE (otherStealState, per il lockout anti-steal-back) e
    // viceversa, il che richiederebbe un riferimento circolare se create
    // qui dentro (la seconda chiamata di initCombatMoves non esiste ancora
    // quando gira la prima). Forma: { phase: 'idle'|'reach'|'resolve',
    // phaseT, cooldown, resolveFromElbow, resolveFromLink1, startAimYaw }
    // (blockState senza startAimYaw/resolveFromAimYaw, non fa sweep)
    stealState, blockState,
  } = ctx

  const scratchOpponentBox = new THREE.Box3()
  const scratchNearestOnOpponent = new THREE.Vector3()
  const scratchStealDelta = new THREE.Vector3()
  const scratchStealForward = new THREE.Vector3()
  // bersaglio: il vero corpo dell'avversario (bounding box reale, non
  // espansa a caso), con un margine di reach oltre la superficie che
  // dipende da dove sta guardando/spazzando LO STEALER — pieno
  // (STEAL_FORWARD_MARGIN) davanti a sé, quasi nullo (STEAL_BACKWARD_MARGIN)
  // alle proprie spalle. Interpolato con dot/coseno (non uno split netto
  // avanti/dietro): il margine scende con continuità man mano che
  // l'avversario si sposta lateralmente, invece di uno scatto secco al
  // superamento dei 90°
  function isTouchingOpponentBox() {
    getOtherManipulator().getBodyBox(scratchOpponentBox)
    scratchOpponentBox.clampPoint(getManipulator().root.position, scratchNearestOnOpponent)
    scratchStealDelta.subVectors(scratchNearestOnOpponent, getManipulator().root.position)
    scratchStealDelta.y = 0
    const dist = scratchStealDelta.length()
    if (dist < 1e-4) return true // già dentro il vero corpo dell'avversario
    angleToForward(resolveAimYaw(), scratchStealForward)
    const forwardAmount = scratchStealDelta.dot(scratchStealForward) / dist // coseno dell'angolo, [-1,1]
    const margin = forwardAmount > 0
      ? THREE.MathUtils.lerp(STEAL_BACKWARD_MARGIN, STEAL_FORWARD_MARGIN, forwardAmount)
      : STEAL_BACKWARD_MARGIN
    return dist <= margin
  }

  // condizione di rubabilità (NON include isTouchingOpponentBox — quello
  // riguarda solo il momento del contatto, non va rivalutato a fine
  // sweep). Ricalcolata fresca ad ogni chiamata, mai messa in cache: gli
  // stessi controlli servono sia al momento del contatto sia di nuovo a
  // fine animazione, e nel frattempo l'avversario può aver tirato/perso
  // la palla — usata da updateSteal, non solo dichiarata qui per dedup
  function canStealFrom(ball) {
    // otherShootingState.phase === 'idle': l'avversario deve essere in
    // palleggio automatico puro, NON a metà di un proprio windup/
    // release/recover — altrimenti il possesso passa qui MA il suo
    // updateShootAnimation continua per conto suo (non sa nulla del
    // furto), arriva al rilascio e forza la palla in volo con la SUA
    // fisica di tiro abbandonata: risultato, la palla finiva in terra a
    // rimbalzare invece che in mano a chi l'ha appena rubata
    // immune durante il dash (otherDashState.timeRemaining>0): il burst
    // dura 0.15s a 6x velocità, un contatto lì sarebbe più un incidente
    // di hitbox che uno STEAL vero e proprio — otherDashState è opzionale
    // (il nemico non ha dash, quindi resta undefined nell'istanza che
    // ruba da lui, niente da controllare in quel verso)
    const otherIsDashing = otherDashState && otherDashState.timeRemaining > 0
    // otherPickupState.phase === 'idle': l'avversario deve avere già
    // FINITO il proprio pickup, non essere a metà — durante quei 0.3s
    // ball.owner/state sono già "presi" (claim atomico) ma il suo
    // manipulator.state resta ancora NO_BALL, quindi risulterebbe
    // rubabile mentre in realtà sta ancora raccogliendola: due robot
    // avrebbero finito per contendersi la posizione della palla
    const otherIsPickingUp = otherPickupState && otherPickupState.phase === 'active'
    return !!ball && ball.owner === getOtherManipulator() && ball.state === BallState.HANDLED
      && otherShootingState.phase === 'idle' && !otherIsDashing && !otherIsPickingUp
  }

  const scratchAimDir = new THREE.Vector3()
  // punta la base (R1) verso worldPos, sul piano orizzontale — usata da
  // BLOCK per seguire la palla in volo. Non aggiorna nulla se troppo
  // vicino (direzione degenere, evita un atan2(0,0))
  function aimBaseToward(worldPos) {
    const manipulator = getManipulator()
    scratchAimDir.subVectors(worldPos, manipulator.root.position)
    scratchAimDir.y = 0
    if (scratchAimDir.lengthSq() < 1) return
    manipulator.controls.setAimYaw(Math.atan2(scratchAimDir.x, scratchAimDir.z))
  }

  const scratchPaddlePos = new THREE.Vector3()
  function paddleWorldPosition() {
    return getObjectWorldPosition(getManipulator().paddle, scratchPaddlePos)
  }

  // sfera(palla)-vs-box(END EFFECTOR), stesso principio di clampPoint già
  // usato da isTouchingOpponentBox/CollisionWorld — il box è centrato sulla
  // paletta, mezzo-lato dato da blockBoxHalfSizeFor(stat BLOCK di chi tenta
  // il blocco), non un raggio fisso uguale per tutti come prima
  const scratchBlockBox = new THREE.Box3()
  const scratchBlockClamped = new THREE.Vector3()
  function isBallInBlockBox(ballPosition) {
    const center = paddleWorldPosition()
    const halfSize = blockBoxHalfSizeFor(getManipulator().stats.block)
    scratchBlockBox.min.set(center.x - halfSize, center.y - halfSize, center.z - halfSize)
    scratchBlockBox.max.set(center.x + halfSize, center.y + halfSize, center.z + halfSize)
    scratchBlockBox.clampPoint(ballPosition, scratchBlockClamped)
    return scratchBlockClamped.distanceTo(ballPosition) <= getBallRadius()
  }

  // usabile solo senza palla, non durante un'altra STEAL/BLOCK già in corso
  // (sullo stesso robot — le due mosse condividono setDribbleOffsets, non
  // possono girare insieme), non in cooldown
  // pickupState/shootingState PROPRI, non solo manipulator.state===NO_BALL:
  // durante il pickup (0.3s) e durante il 'recover' del proprio tiro
  // (dopo che manipulator.state è già tornato NO_BALL ma l'animazione di
  // rientro non ha ancora finito) lo stato è "tecnicamente" NO_BALL ma
  // c'è già un'altra animazione che scrive sugli stessi joint
  // (setDribbleOffsets) — STEAL/BLOCK partendo insieme si sarebbero
  // contesi i joint ogni frame invece di stare fermi finché l'altra non finisce
  function canTrigger(moveState) {
    return getManipulator().state === RobotState.NO_BALL
      && stealState.phase === 'idle' && blockState.phase === 'idle'
      && pickupState.phase === 'idle' && shootingState.phase === 'idle'
      && moveState.cooldown <= 0
  }

  // da dove sta MIRANDO ORA (getAimYaw — per il giocatore il
  // crosshair/orbit della camera, per il nemico nessun callback passato,
  // ripiega sulle ruote) — non da dove puntano le ruote: in NO_BALL la
  // camera orbita libera indipendente da dove ci si è mossi per ultimo,
  // uno sweep/rientro basato sulle ruote poteva partire o rientrare di
  // lato rispetto a dove si stava davvero guardando. Usata sia per il
  // pivot dello sweep (inizio reach) sia per il bersaglio di rientro
  // (fine sweep/resolve) — prima la stessa espressione ripetuta in due punti
  function resolveAimYaw() {
    return getAimYaw ? getAimYaw() : getManipulator().wheelsGroup.rotation.y
  }

  function startReach(moveState) {
    const [elbowAmp, link1Amp] = dribbleAmplitudesRad(getManipulator().dribbleTuning)
    moveState.phase = 'reach'
    moveState.phaseT = 0
    moveState.startElbow = dribbleState.armEase * elbowAmp
    moveState.startLink1 = dribbleState.armEase * link1Amp
    moveState.startAimYaw = resolveAimYaw()
    // solo STEAL lo usa, ma resettarlo qui (inizio di OGNI nuovo reach,
    // sia steal sia block) copre anche il caso in cui un reach precedente
    // sia stato interrotto a metà (es. BACK TO MAIN MENU) con contatto già
    // fatto: senza questo, il prossimo steal risulterebbe "riuscito"
    // all'istante t>=1 senza che sia MAI avvenuto un vero contatto in
    // QUESTO tentativo
    moveState.contactMade = false
  }

  function triggerSteal() {
    if (!canTrigger(stealState)) return
    startReach(stealState)
  }

  function triggerBlock() {
    if (!canTrigger(blockState)) return
    startReach(blockState)
  }

  function beginResolve(moveState, elbowAtEnd, link1AtEnd) {
    moveState.phase = 'resolve'
    moveState.phaseT = 0
    moveState.resolveFromElbow = elbowAtEnd
    moveState.resolveFromLink1 = link1AtEnd
  }

  // vera solo se QUESTO robot ha appena ottenuto/mantenuto il possesso alla
  // fine del resolve — l'altra mossa (o un pickup nel frattempo) potrebbe
  // aver già cambiato le cose, si ricontrolla lo stato reale invece di
  // assumerlo
  function finishResolve() {
    const manipulator = getManipulator()
    if (manipulator.state === RobotState.NO_BALL) {
      const ball = getBasketball()
      if (ball && ball.owner === manipulator) {
        // resetToNeutralPossession chiude anche shootingState.released
        // (senza, un PROPRIO tiro abbandonato in passato — mai raccolto di
        // persona da allora — lo lasciava true: il dispatch in main.js
        // instradava su updateShotFlight, fisica di gravità pura su
        // velocità stantia, invece del palleggio normale, "la palla
        // cadeva"/spariva pur essendo HANDLED) e grip/tilt (difensivo)
        resetToNeutralPossession(manipulator, { dribbleState, handlingState, shootingState }, resetDribbleState)
      }
    }
  }

  function updateSteal(delta) {
    const manipulator = getManipulator()
    const otherManipulator = getOtherManipulator()
    if (stealState.cooldown > 0) stealState.cooldown -= delta
    if (stealState.phase === 'idle') return
    stealState.phaseT += delta

    if (stealState.phase === 'reach') {
      const t = Math.min(stealState.phaseT / STEAL_REACH_DURATION, 1)
      const elbowTarget = STEAL_ELBOW_TARGET
      const link1Target = STEAL_LINK1_TARGET
      const elbowNow = THREE.MathUtils.lerp(stealState.startElbow, elbowTarget, t)
      const link1Now = THREE.MathUtils.lerp(stealState.startLink1, link1Target, t)
      manipulator.controls.setDribbleOffsets(elbowNow, link1Now)
      // SWEEP: la base spazza da -ampiezza a +ampiezza attorno alla
      // direzione di partenza mentre il braccio resta teso — un vero
      // spazzolamento, non un allungo statico
      const sweepAngle = THREE.MathUtils.lerp(-1, 1, t) * STEAL_SWEEP_AMPLITUDE
      const aimYawNow = stealState.startAimYaw + sweepAngle
      manipulator.controls.setAimYaw(aimYawNow)

      const ball = getBasketball()
      // il contatto è solo TRACCIATO qui (non trasferisce ancora nulla):
      // lo sweep va visto per intero, il possesso passa solo a fine
      // animazione (t>=1) sotto — prima passava SUBITO al primo contatto,
      // tagliando corto lo sweep proprio nel momento in cui aveva successo.
      // canStealFrom() ricalcolata FRESCA sia qui sia a fine sweep (non un
      // valore congelato): tra le due valutazioni possono passare diversi
      // frame, l'avversario potrebbe aver tirato/perso la palla nel
      // frattempo — prima erano due copie a mano della stessa espressione
      // a 4 condizioni, ora un'unica funzione condivisa sotto
      if (!stealState.contactMade && canStealFrom(ball) && isTouchingOpponentBox()) {
        stealState.contactMade = true
      }
      if (t >= 1) {
        if (stealState.contactMade) {
          if (canStealFrom(ball)) {
            // successo: possesso trasferito (fisica/dribble dell'altro
            // robot deve smettere di toccare la palla dal prossimo frame),
            // ma la POSA visiva rientra a neutro prima di passare a DRIBBLE
            ball.setOwner(manipulator)
            // altrimenti la palla resta congelata a mezz'aria fino a fine
            // resolve: né l'ex proprietario (ormai NO_BALL, il suo dribble
            // non la tocca più) né questo robot (ancora NO_BALL per altri
            // 0.2s, il suo dribble non è ancora partito) la stanno
            // aggiornando — sembrava "rimbalzare via" prima di teletrasportarsi
            // in mano di colpo. Agganciata SUBITO qui, poi ogni frame di
            // resolve sotto, così il passaggio è un aggancio immediato e
            // pulito invece di un salto dopo un blocco a mezz'aria
            snapBallToRestPoint(manipulator, ball)
            otherManipulator.setState(RobotState.NO_BALL)
            otherResetDribbleState()
            // grip/tilt della VITTIMA: se era in HANDLING quando gliel'hai
            // rubata, il grip poteva essere ancora parzialmente chiuso —
            // resetDribbleState non lo tocca (è HANDLING-specifico, non
            // dribble), restava così finché non ripigliava la palla, con la
            // paletta visibilmente "storta" nel palleggio successivo
            otherHandlingState.grip = 0
            otherHandlingState.tiltOffset = 0
            otherManipulator.controls.setGrip(0)
            // lockout anti-steal-back: appena derubato, un po' di tempo
            // (in base al PROPRIO stat STEAL) prima di poter ritentare —
            // senza, con cooldown a 0 (mai usato prima) poteva rubarla
            // indietro nello stesso istante
            otherStealState.cooldown = Math.max(otherStealState.cooldown, victimStealLockoutFor(otherManipulator.stats.steal))
            sfx.playSteal()
          }
        }
        stealState.contactMade = false
        beginResolve(stealState, elbowTarget, link1Target)
        stealState.resolveFromAimYaw = aimYawNow
      }
    } else { // 'resolve'
      const t = Math.min(stealState.phaseT / RESOLVE_DURATION, 1)
      manipulator.controls.setDribbleOffsets(
        THREE.MathUtils.lerp(stealState.resolveFromElbow, 0, t),
        THREE.MathUtils.lerp(stealState.resolveFromLink1, 0, t),
      )
      // se il resolve segue un furto RIUSCITO (owner già questo robot),
      // la palla resta agganciata alla paletta per tutta la durata —
      // senza, tornerebbe a congelarsi a mezz'aria un frame dopo l'aggancio
      if (getBasketball()?.owner === manipulator) snapBallToRestPoint(manipulator, getBasketball())
      // lo sweep può finire a metà spazzolata (successo prima di t=1) —
      // rientra verso resolveAimYaw() (fresca ogni frame, non quella
      // congelata a inizio reach): con wheelsGroup.rotation.y da solo
      // (sbagliato per il giocatore, la mira in dribble segue la CAMERA,
      // non le ruote) il rientro convergeva verso il posto sbagliato, poi
      // il dribble normale faceva scattare di colpo l'angolo vero
      manipulator.controls.setAimYaw(THREE.MathUtils.lerp(stealState.resolveFromAimYaw, resolveAimYaw(), t))
      if (t >= 1) {
        stealState.phase = 'idle'
        stealState.cooldown = stealCooldownFor(manipulator.stats.steal)
        finishResolve()
      }
    }
  }

  function updateBlock(delta) {
    const manipulator = getManipulator()
    if (blockState.cooldown > 0) blockState.cooldown -= delta
    if (blockState.phase === 'idle') return
    blockState.phaseT += delta

    if (blockState.phase === 'reach') {
      const t = Math.min(blockState.phaseT / BLOCK_REACH_DURATION, 1)
      const elbowTarget = BLOCK_ELBOW_TARGET
      const link1Target = BLOCK_LINK1_TARGET
      const elbowNow = THREE.MathUtils.lerp(blockState.startElbow, elbowTarget, t)
      const link1Now = THREE.MathUtils.lerp(blockState.startLink1, link1Target, t)
      manipulator.controls.setDribbleOffsets(elbowNow, link1Now)

      const ball = getBasketball()
      // "verso l'altro": la base punta dritta alla palla per tutta la
      // reach, non una posa fissa — aggiornata ogni frame perché in volo
      // la palla si muove sotto gli occhi
      if (ball) aimBaseToward(ball.position)
      if (ball && ball.state === BallState.FREE_SHOT) {
        if (isBallInBlockBox(ball.position)) {
          // deviato: nessun owner assegnato, "sporca" e riprendibile subito
          // da chiunque — niente canestro (il volo non arriva mai a segno)
          ball.setState(BallState.FREE)
          sfx.playBlock()
          beginResolve(blockState, elbowNow, link1Now)
          return
        }
      }
      if (t >= 1) beginResolve(blockState, elbowTarget, link1Target)
    } else { // 'resolve'
      const t = Math.min(blockState.phaseT / RESOLVE_DURATION, 1)
      manipulator.controls.setDribbleOffsets(
        THREE.MathUtils.lerp(blockState.resolveFromElbow, 0, t),
        THREE.MathUtils.lerp(blockState.resolveFromLink1, 0, t),
      )
      if (t >= 1) {
        blockState.phase = 'idle'
        blockState.cooldown = blockCooldownFor(manipulator.stats.block)
        // BLOCK non tocca mai il possesso di questo robot (era già NO_BALL
        // prima e resta NO_BALL dopo), niente finishResolve() qui
      }
    }
  }

  return {
    triggerSteal, triggerBlock, updateSteal, updateBlock,
    stealState, blockState,
    // per la UI (HUD pill): disponibile solo senza palla, cooldown finito,
    // nessuna delle due mosse già in corso
    canUseSteal: () => canTrigger(stealState),
    canUseBlock: () => canTrigger(blockState),
  }
}
