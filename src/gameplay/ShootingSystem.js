import * as THREE from 'three'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from './Basketball.js'
import { clampOrbitPitchToNormalRange, dribbleAmplitudesRad, getObjectWorldPosition, paddleWorldPos } from './BallPossession.js'
import { BALL_GRAVITY, BALL_BOUNCE_SPEED } from '../utils/constants.js'

// Quarto e ultimo pezzo del refactor modulare: tiro, hoop assist, punteggio
// e preview di traiettoria — tutti insieme perché condividono isHoopCrossing/
// applyHoopAssist/collisionWorld.hoops in modo troppo stretto per separarli
// senza duplicare codice. Stesso principio di MainMenu.js/BallPossession.js:
// un unico oggetto context, zero import da main.js (RobotState/BallState
// importati direttamente, sono foglie). snapBallToRestPoint/
// clampOrbitPitchToNormalRange importati da BallPossession.js (condivisi,
// non duplicati — nessun rischio circolare, BallPossession.js non importa
// mai da qui).

const SHOT_FLOOR_BOUNCE_SPEED_FACTOR = 0.7 // rimbalzo a terra di un tiro sbagliato: vicino a BALL_BOUNCE_SPEED ma un filo più smorzato
const FLOOR_HORIZONTAL_DAMPING = 0.9
const THREE_POINT_RADIUS = 677 // distanza reale dal ferro al punto più "alto" dell'arco (accessor GLTF)
// frazione di windup+release (vedi updateShootAnimation, blend verso
// releaseOrigin) sotto la quale la palla resta agganciata RIGIDA alla
// paletta — solo l'ultimo (1-questa) tratto prima del rilascio vero
// converge verso il punto congelato della preview. 0.85 = la palla sta
// "in mano" per l'85% dell'animazione, la correzione (rapida ma non
// istantanea) si vede solo nell'ultimo 15%
const BLEND_START_FRACTION = 0.85
const THREE_POINT_SPEED_REDUCTION = 0.6 // forza ridotta al 60% da dentro l'arco: da vicino serve meno spinta
// campo potenziale attrattivo verso il centro canestro (stat SHOOTING): un
// tronco di cono che si allarga salendo, raggio del FERRO esattamente al
// livello del ferro, più largo (permissivo) salendo fino alla cima della
// backboard
const HOOP_ASSIST_TOP_RADIUS = 90
// tasso di correzione (1/s): quota della distanza residua riassorbita al
// secondo — correzione di POSIZIONE, non un'accelerazione (quella si
// accumula col tempo di permanenza nel cono, sparando la palla OLTRE il
// centro sui tiri lenti/da vicino)
const HOOP_ASSIST_PULL_RATE = 4
// abbastanza fine da non "bucare" lo spessore sottile di backboard/ferro
// nemmeno alla velocità di tiro più alta (tunneling)
const SHOT_PHYSICS_SUBSTEP_DT = 1 / 240
const SHOOT_EASE = t => t * t * (3 - 2 * t) // smoothstep, stessa curva usata per 'rise' nel palleggio
const TRAJECTORY_DT = 0.005 // fine quanto il volo reale (SHOT_PHYSICS_SUBSTEP_DT), non il vecchio 0.02 troppo grezzo
const TRAJECTORY_MAX_STEPS = 2400 // ~12s allo stesso dt fine
const TRAJECTORY_TUBE_RADIUS = 4
const TRAJ_COLOR_BLACK = 0x111111
const TRAJ_COLOR_BLUE = 0x1b3a6b
const TRAJ_COLOR_GREEN = 0x2e7d32
const TRAJECTORY_OPACITY = 0.5

// condivisa da getEffectiveShotSpeed (riduzione potenza) e dal Point System
// (2 o 3 punti) — stesso identico criterio "vicino a quale canestro", non
// due calcoli separati che potrebbero disallinearsi
export function isInsideThreePointArc(worldPosition, hoops) {
  let nearestDistSq = Infinity
  for (const hoop of hoops) {
    const dx = worldPosition.x - hoop.center.x
    const dz = worldPosition.z - hoop.center.z
    nearestDistSq = Math.min(nearestDistSq, dx * dx + dz * dz)
  }
  return nearestDistSq < THREE_POINT_RADIUS * THREE_POINT_RADIUS
}

// rilevamento canestro: nessuna vera "mesh trigger", stesso spirito
// imperativo del resto del progetto — attraversamento del piano orizzontale
// del ferro (Y), in discesa, entro il raggio del cerchio. previousPos è il
// vettore COMPLETO del passo precedente (non solo la Y): interpola il punto
// ESATTO in cui la traiettoria attraversa il piano del ferro, non testa
// solo la posizione già "oltre" a fine passo — necessario perché un test a
// campione singolo è sensibile alla grana del passo (tiri che davvero
// entrano, specialmente da vicino dove la traiettoria è più verticale
// vicino al ferro, potevano risultare "appena fuori")
export function isHoopCrossing(previousPos, position, hoop) {
  if (previousPos.y <= hoop.center.y || position.y > hoop.center.y) return false
  const t = (previousPos.y - hoop.center.y) / (previousPos.y - position.y)
  const crossX = THREE.MathUtils.lerp(previousPos.x, position.x, t)
  const crossZ = THREE.MathUtils.lerp(previousPos.z, position.z, t)
  const dx = crossX - hoop.center.x
  const dz = crossZ - hoop.center.z
  return Math.hypot(dx, dz) <= hoop.radius
}

// backboard/ferro/muri/pali/panchine: stesso identico giro di controlli
// serve sia al volo fisico reale sia alla preview di traiettoria — chiamata
// da entrambi gli step fisici così la preview mostra ESATTAMENTE la curva
// che poi succede davvero, non è un bias nascosto solo a runtime
function applyHoopAssist(position, velocity, dt, strength, hoops, backboardTopY, rimRingRadius) {
  if (strength <= 0) return
  for (const hoop of hoops) {
    const heightAboveRim = position.y - hoop.center.y
    // altezza del cono = dalla cima reale della backboard, non un valore a
    // caso — sopra la backboard il tiro è comunque ormai "andato"
    const assistHeight = backboardTopY - hoop.center.y
    if (heightAboveRim < 0 || heightAboveRim > assistHeight) continue
    const coneT = heightAboveRim / assistHeight
    const coneRadius = THREE.MathUtils.lerp(rimRingRadius, HOOP_ASSIST_TOP_RADIUS, coneT)
    const dx = hoop.center.x - position.x
    const dz = hoop.center.z - position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-6 || dist > coneRadius) continue
    // correzione di POSIZIONE (frazione della distanza residua verso il
    // centro): clampata a 1, non può mai superare il centro qualunque sia
    // strength/dt
    const pull = Math.min(strength * (dist / coneRadius) * HOOP_ASSIST_PULL_RATE * dt, 1)
    position.x += dx * pull
    position.z += dz * pull
  }
}

// scala SHOOTING 1-3: 1 = NESSUNA correzione, 2/3 = via via più forte — fit
// quadratico esatto sui tre punti storici (vecchia scala 1-5): (stat-1)(stat+4)/8
export function shootingStatToAssistStrength(shootingStat) {
  return (shootingStat - 1) * (shootingStat + 4) / 8
}

export function initShootingSystem(ctx) {
  const {
    getManipulator, collisionWorld, sfx, scene,
    shootingState, cameraState, dribbleState, handlingState,
    computeAimPitchOffset, getShotDirection, getBallRadius,
    scoreElementId = 'score-value',
    // funzione (non un valore fisso): in PRACTICE non c'è squadra avversaria
    // da rispettare, si può segnare in uno qualunque dei due ferri; in 1V1
    // ogni robot ha il SUO canestro (Team → hoop index) — letta ogni volta
    // invece che congelata alla creazione perché gameMode può ancora non
    // essere deciso quando initShootingSystem viene chiamato (al caricamento
    // pagina, prima di qualunque scelta nel menu). null/undefined = nessuna
    // restrizione (comportamento PRACTICE)
    getTargetHoopIndex = () => null,
    // opzionale: chiamata con QUESTO manipulator ogni volta che segna un
    // canestro (checkSingleHoopScore) — main.js la usa in 1V1 per il
    // turnover di possesso (chi ha SUBITO il canestro riparte con la
    // palla, vera regola del basket), no-op in PRACTICE. ShootingSystem.js
    // resta agnostico sul game mode: emette solo l'evento, main.js decide
    onScore = () => {},
  } = ctx
  // getBasketball NON destrutturato: è una funzione, non un valore semplice
  // (main.js assegna basketball in modo asincrono al caricamento del GLTF) —
  // va richiamata via ctx.getBasketball() ogni volta, non catturata una
  // volta sola, stesso pattern di BallPossession.js. Funzione e non un
  // accessor `get` perché ctx nasce da uno spread (gameContext in main.js):
  // un accessor verrebbe valutato subito dallo spread, congelando il
  // risultato — una funzione sopravvive perché lo spread copia il
  // riferimento alla funzione, non il suo risultato
  //
  // getShotDirection E computeAimPitchOffset arrivano DA FUORI (non più
  // costruite qui dentro): per il giocatore sono basate su crosshair/camera
  // (main.js), per il nemico sull'AI (direzione verso il canestro bersaglio,
  // src/EnemyAI.js) — ShootingSystem non deve sapere quale dei due sta
  // guidando l'istanza corrente, gli basta una funzione che gli dia una
  // direzione

  const shotFloorBounceSpeed = BALL_BOUNCE_SPEED * SHOT_FLOOR_BOUNCE_SPEED_FACTOR

  // in 1V1 ogni robot ha UN SOLO canestro bersaglio (getTargetHoopIndex,
  // già usato da checkHoopScore per il punteggio) — l'arco dei 3 punti va
  // giudicato contro QUEL canestro, non contro "il più vicino tra i due".
  // Bug reale altrimenti: un giocatore che si spinge (dash) oltre metà
  // campo, più vicino al canestro AVVERSARIO che al proprio, veniva
  // giudicato "dentro l'arco" di quello sbagliato — tiro da 3 vero sul
  // proprio canestro, ma forza ridotta al 60% (e 2 punti invece di 3 se
  // fosse mai entrato) come se fosse un tiro facile da sotto il canestro
  // avversario. Un solo canestro nell'array anche in PRACTICE se/quando
  // avrà un bersaglio proprio; per ora lì resta null → nessuna restrizione
  function hoopsForArcCheck() {
    const targetHoopIndex = getTargetHoopIndex()
    return targetHoopIndex == null ? collisionWorld.hoops : [collisionWorld.hoops[targetHoopIndex]]
  }

  function getEffectiveShotSpeed(worldPosition) {
    // shootTuning: PER ISTANZA (RobotBase.js), non più un unico oggetto
    // condiviso — ogni classe ha la propria forza/timing di tiro tarabile
    // indipendentemente (pannello debug, tasto P). resolveShootTuning
    // sceglie elevatedShootTuning invece mentre isElevated è vero (Drone)
    const { shotSpeed } = resolveShootTuning(getManipulator())
    return isInsideThreePointArc(worldPosition, hoopsForArcCheck()) ? shotSpeed * THREE_POINT_SPEED_REDUCTION : shotSpeed
  }

  // Point System: 2 punti se si tirava da dentro l'arco dei 3 punti, 3 se da
  // fuori (shootingState.wasInsideArc, catturato al rilascio — non dove si
  // trova la palla quando entra), canestro in uno qualunque dei due ferri vale
  let score = 0
  // scoreElementId: 'score-value' (default, il giocatore) o
  // 'enemy-score-value' per l'istanza del nemico — due contatori distinti
  // per il vero punteggio 1v1, non più uno condiviso
  const scoreValueEl = document.getElementById(scoreElementId)
  function addScore(points) {
    score += points
    scoreValueEl.textContent = String(score)
  }
  // per BACK TO MAIN MENU (MainMenu.js): resetta punteggio e DOM in un colpo
  // solo, senza far ricostruire a main.js "reset" da addScore/uno stato che
  // non gli appartiene
  function resetScore() {
    score = 0
    scoreValueEl.textContent = String(score)
  }

  // niente array temporaneo (era `[collisionWorld.hoops[i]]` costruito ad
  // ogni chiamata): questa gira a SHOT_PHYSICS_SUBSTEP_DT (240Hz) per
  // l'intera durata di ogni tiro, un'allocazione per passo era puro spreco
  function checkHoopScore(previousPos, position) {
    const targetHoopIndex = getTargetHoopIndex()
    if (targetHoopIndex == null) {
      for (const hoop of collisionWorld.hoops) checkSingleHoopScore(previousPos, position, hoop)
    } else {
      checkSingleHoopScore(previousPos, position, collisionWorld.hoops[targetHoopIndex])
    }
  }

  function checkSingleHoopScore(previousPos, position, hoop) {
    if (isHoopCrossing(previousPos, position, hoop)) {
      console.log('%c🏀 CANESTRO!', 'color: orange; font-weight: bold; font-size: 14px')
      addScore(shootingState.wasInsideArc ? 2 : 3)
      sfx.playScore()
      onScore(getManipulator())
    }
  }

  // dopo un urto (backboard/ferro/...), quanto ignorare NUOVE collisioni CON
  // LO STESSO OGGETTO — vedi CollisionWorld.js per il dettaglio del perché
  // (per-oggetto, non un timer globale, altrimenti un rimbalzo sul ferro
  // sospenderebbe anche il check contro la backboard)
  const shotCollisionCooldowns = new Map()
  function clearAllCollisionCooldowns() {
    shotCollisionCooldowns.clear()
  }

  // Avvia il windup del tiro: stessa identica sequenza scritta a mano sia
  // nel mousedown del giocatore (main.js) sia in EnemyAI.js — condivisa
  // qui, stesso principio già in uso per STEAL/BLOCK (triggerSteal/
  // triggerBlock, CombatMoves.js). Le PRECONDIZIONI restano ai chiamanti
  // (deliberatamente non qui): il giocatore controlla mouse/pointer-lock/
  // HANDLING/basketball esistente, il nemico un timer di mira/HANDLING —
  // condizioni davvero diverse, non la stessa guardia duplicata due volte
  function triggerShoot() {
    const manipulator = getManipulator()
    const [elbowAmp, link1Amp] = dribbleAmplitudesRad(manipulator.dribbleTuning)
    shootingState.startElbowOffset = dribbleState.armEase * elbowAmp
    shootingState.startLink1Offset = dribbleState.armEase * link1Amp
    shootingState.startGrip = handlingState.grip
    shootingState.startTilt = handlingState.tiltOffset
    shootingState.phase = 'windup'
    shootingState.phaseT = 0
    shootingState.timeSinceTrigger = 0
    shootingState.released = false
    shootingState.hasBounced = false
    clearAllCollisionCooldowns()
    // punto ESATTO da cui la preview di traiettoria stava disegnando
    // l'arco un istante prima del click (updateTrajectoryPreview legge
    // ctx.getBasketball().position ogni frame mentre si mira) — congelato
    // qui, non più letto di nuovo al momento del rilascio fisico vero.
    // Windup/release muovono il braccio (per ogni classe, non solo
    // Drone — più o meno a seconda della classe) trascinando la palla
    // dietro di sé: senza congelare l'origine, il volo reale partiva da
    // dove la paletta era arrivata DOPO il windup, non da dove la preview
    // l'aveva disegnato, con uno scarto proporzionale a quanto il windup
    // sposta il braccio (grande per l'Flight del Drone, segnalato dal
    // vivo: "verde" ma il tiro non entrava quasi mai). Interfaccia comune
    // a tutte le classi/entrambi i lati (player/enemy): stessa funzione
    // triggerShoot, nessuna logica per-classe qui
    const ball = ctx.getBasketball()
    if (ball) shootingState.releaseOrigin.copy(ball.position)
  }

  const shotVelocity = new THREE.Vector3()
  const scratchPreviousShotPos = new THREE.Vector3()
  function stepShotFlight(dt) {
    // basketball è assegnato in modo asincrono al caricamento del GLTF, ma
    // la reference non cambia mai a metà di questa singola chiamata —
    // ctx.getBasketball() richiamata una volta sola invece che ad ogni accesso
    const ball = ctx.getBasketball()
    const ballRadius = getBallRadius()
    // vettore COMPLETO (non solo Y): isHoopCrossing interpola il punto
    // esatto di attraversamento del piano del ferro, le serve X/Z di prima
    scratchPreviousShotPos.copy(ball.position)
    shotVelocity.y -= BALL_GRAVITY * dt
    ball.position.addScaledVector(shotVelocity, dt)
    applyHoopAssist(
      ball.position, shotVelocity, dt,
      shootingStatToAssistStrength(getManipulator().stats.shooting),
      collisionWorld.hoops, collisionWorld.BACKBOARD_TOP_Y, ctx.rimRingRadius,
    )

    // canestro controllato SUL PERCORSO BALISTICO PURO, prima di eventuale
    // deflessione da collisione in questo stesso passo — stesso ordine già
    // usato dalla preview (hitScore calcolato prima di hitVisible/resolve)
    checkHoopScore(scratchPreviousShotPos, ball.position)
    // solo nel volo reale (non nella preview, che condivide la stessa
    // funzione ma non deve mai suonare mentre si sta solo mirando)
    const hitVisible = collisionWorld.resolve(ball.position, shotVelocity, dt, shotCollisionCooldowns, ballRadius)
    if (hitVisible) sfx.playBounce()

    let hitFloor = false
    if (ball.position.y <= ballRadius) {
      ball.position.y = ballRadius
      sfx.playBounce()
      // vicino al rimbalzo del palleggio automatico ma un filo più
      // smorzato — un tiro sbagliato rimbalza come farebbe la palla vera
      // invece di fermarsi di colpo
      shotVelocity.y = shotFloorBounceSpeed
      // senza smorzare anche X/Z la palla scivolerebbe in orizzontale per
      // sempre (solo Y viene mai toccata altrimenti)
      shotVelocity.x *= FLOOR_HORIZONTAL_DAMPING
      shotVelocity.z *= FLOOR_HORIZONTAL_DAMPING
      hitFloor = true
    }

    // SOLO il primo tocco del PAVIMENTO (non backboard/ferro/muro/palo/
    // panchina): un tiro che colpisce il ferro/backboard — canestro fatto
    // o no — resta FREE_SHOT (bloccabile con BLOCK, non raccoglibile da
    // nessuno dei due con pickup/HANDLING) finché non tocca davvero
    // terra almeno una volta. hasBounced garantisce che scatti una volta
    // sola per tiro (senza, ogni rimbalzo successivo sul pavimento
    // rientrerebbe qui inutilmente)
    if (!shootingState.hasBounced && hitFloor) {
      shootingState.hasBounced = true
      ball.setState(BallState.FREE)
    }
  }
  function updateShotFlight(delta) {
    let remaining = delta
    while (remaining > 0) {
      stepShotFlight(Math.min(SHOT_PHYSICS_SUBSTEP_DT, remaining))
      remaining -= SHOT_PHYSICS_SUBSTEP_DT
    }
  }

  // Animazione di tiro: PRIMA di tutto (ogni frame, windup e release) il
  // gomito insegue il pitch della camera (shootTuning.elbowAimCoupling) —
  // l'end effector punta dove punta la mira. Sopra questa base, 'windup'
  // porta gomito/link1 ulteriormente all'indietro, poi 'release' li
  // riporta in avanti verso la posa di rilascio — il gomito parte con un
  // piccolo ritardo (shootTuning.releaseLead) rispetto a link1 e copre
  // tutto il suo raggio nel tempo RIMANENTE, quindi con velocità angolare
  // maggiore: il "colpo di frusta" prossimale→distale di un lancio vero.
  // Infine 'recover' interpola tutto verso una posa neutra
  // shootTuning: PER ISTANZA (RobotBase.js) — elevatedShootTuning (default
  // null) sostituisce shootTuning SOLO mentre isElevated è vero (Drone,
  // Flight): la posa di windup/release che evita di intersecare il
  // corpo mentre il braccio pende a terra è diversa da quella corretta
  // mentre il corpo è già sollevato in volo — vedi Drone.js
  function resolveShootTuning(manipulator) {
    return (manipulator.isElevated && manipulator.elevatedShootTuning) || manipulator.shootTuning
  }

  function updateShootAnimation(delta) {
    const manipulator = getManipulator()
    const shootTuning = resolveShootTuning(manipulator)
    shootingState.phaseT += delta
    shootingState.timeSinceTrigger += delta
    const elbowWindupTarget = THREE.MathUtils.degToRad(shootTuning.elbowWindupDeg)
    const link1WindupTarget = THREE.MathUtils.degToRad(shootTuning.link1WindupDeg)
    const aimPitchOffset = computeAimPitchOffset()

    // countdown SEMPRE attivo (non solo durante 'release'): se
    // stateTransitionDelay supera il tempo che resta alla fase 'release'
    // dopo releasePoint, la fase passa a 'recover' col timer ancora a metà
    // — se il countdown vivesse solo dentro il branch 'release' si blocca
    // lì per sempre e NO_BALL/basketball FREE non scattano mai
    if (shootingState.released && shootingState.stateTransitionTimer > 0) {
      shootingState.stateTransitionTimer -= delta
      if (shootingState.stateTransitionTimer <= 0) {
        manipulator.setState(RobotState.NO_BALL)
        // NON tocca più BallState qui: la palla è già passata a FREE_SHOT
        // al momento del rilascio fisico (vedi sotto) — questo timer
        // riguarda solo ROBOT/camera, non il ciclo di vita della palla
        // (FREE_SHOT → FREE gestito da stepShotFlight al primo urto)
        // stessa sicurezza di releaseBallHandling(): il clamp esteso di
        // HANDLING è valido solo lì — appena si esce la camera passa alla
        // formula normale, che con un pitch estremo manda la camera sotto
        // il pavimento (mai riclampata altrimenti fino al prossimo mousemove)
        clampOrbitPitchToNormalRange(cameraState)
      }
    }

    if (shootingState.phase === 'windup') {
      const t = SHOOT_EASE(Math.min(shootingState.phaseT / shootTuning.windupDuration, 1))
      const elbowOffset = THREE.MathUtils.lerp(shootingState.startElbowOffset, elbowWindupTarget, t)
      const link1Offset = THREE.MathUtils.lerp(shootingState.startLink1Offset, link1WindupTarget, t)
      manipulator.controls.setAimPitch(aimPitchOffset)
      manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
      // tre fasi, non due: orizzontale (startTilt, ≈0 da HANDLING) → su
      // (tiltWindupPeak, oltre il piatto) qui nel windup, poi 'release' la
      // riporta da lì verso la posa inclinata di rilascio
      manipulator.controls.setShootTilt(THREE.MathUtils.lerp(shootingState.startTilt, shootTuning.tiltWindupPeak, t))
      if (shootingState.phaseT >= shootTuning.windupDuration) { shootingState.phase = 'release'; shootingState.phaseT = 0 }
    } else if (shootingState.phase === 'release') {
      const t = Math.min(shootingState.phaseT / shootTuning.releaseDuration, 1)
      const easeT = SHOOT_EASE(t)
      const link1Offset = THREE.MathUtils.lerp(link1WindupTarget, THREE.MathUtils.degToRad(shootTuning.link1ReleaseDeg), easeT)
      // il gomito parte con un ritardo, poi copre tutto il suo raggio nel
      // tempo rimanente — stessa durata totale di link1 ma partenza
      // posticipata = velocità angolare maggiore
      const elbowT = SHOOT_EASE(THREE.MathUtils.clamp((t - shootTuning.releaseLead) / (1 - shootTuning.releaseLead), 0, 1))
      const elbowOffset = THREE.MathUtils.lerp(elbowWindupTarget, THREE.MathUtils.degToRad(shootTuning.elbowReleaseDeg), elbowT)
      manipulator.controls.setAimPitch(aimPitchOffset)
      manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
      // dal picco 'su' del windup verso la posa inclinata di rilascio, in
      // sincrono con link1 (stessa easeT) — non da startTilt (quello era
      // il punto di partenza del windup, non di questa fase)
      manipulator.controls.setShootTilt(THREE.MathUtils.lerp(shootTuning.tiltWindupPeak, shootTuning.tiltTarget, easeT))

      if (!shootingState.released && t >= shootTuning.releasePoint) {
        getShotDirection(shotVelocity).multiplyScalar(getEffectiveShotSpeed(manipulator.root.position))
        shootingState.wasInsideArc = isInsideThreePointArc(manipulator.root.position, hoopsForArcCheck())
        shootingState.released = true
        // FREE_SHOT (non FREE diretto): in volo, non ancora "sporca" — solo
        // BLOCK la intercetta da qui fino al primo urto, il pickup
        // automatico resta cieco a questo stato (vedi checkForPickup in
        // BallPossession.js e il primo urto in stepShotFlight più sotto)
        ctx.getBasketball().setState(BallState.FREE_SHOT)
        // nessuno la possiede più durante il volo — sarà il prossimo
        // pickup/steal a riassegnarla (ball.team resta quello di chi ha
        // appena tirato: setOwner(null) lo preserva, non lo azzera)
        ctx.getBasketball().setOwner(null)
        sfx.playShoot()
        // NON manipulator.setState(NO_BALL) qui: farlo nello STESSO istante
        // in cui parte il volo sgancia subito la camera dalla vista libera
        // di HANDLING, quindi il crosshair salta via proprio mentre la
        // palla lascia la mano. Il cambio di stato vero parte solo dopo
        // stateTransitionDelay secondi, per sicurezza — updateShotFlight
        // nel frattempo parte comunque (vedi guardia su shootingState.released)
        shootingState.stateTransitionTimer = shootTuning.stateTransitionDelay
      }
      if (shootingState.phaseT >= shootTuning.releaseDuration) {
        shootingState.phase = 'recover'
        shootingState.phaseT = 0
        shootingState.recoverStartAimPitch = aimPitchOffset
      }
    } else { // 'recover'
      const t = SHOOT_EASE(Math.min(shootingState.phaseT / shootTuning.recoverDuration, 1))
      const elbowOffset = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(shootTuning.elbowReleaseDeg), 0, t)
      const link1Offset = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(shootTuning.link1ReleaseDeg), 0, t)
      const recoverAimPitch = THREE.MathUtils.lerp(shootingState.recoverStartAimPitch, 0, t)
      const tiltOffset = THREE.MathUtils.lerp(shootTuning.tiltTarget, 0, t)
      const gripOffset = THREE.MathUtils.lerp(shootingState.startGrip, 0, t)
      manipulator.controls.setAimPitch(recoverAimPitch)
      manipulator.controls.setDribbleOffsets(elbowOffset, link1Offset)
      manipulator.controls.setShootTilt(tiltOffset)
      manipulator.controls.setGrip(gripOffset)
      handlingState.grip = gripOffset

      if (shootingState.phaseT >= shootTuning.recoverDuration) {
        shootingState.phase = 'idle'
        // dribbleState.armEase (uno scalare unico) non può rappresentare le
        // pose indipendenti usate sopra: riparte da zero, ma solo ORA che
        // la posa VISIVA è già a 0 (fine del lerp appena sopra) — nessuno
        // scatto, armEase=0 produce esattamente la stessa posa già raggiunta
        dribbleState.armEase = 0
      }
    }

    // finché la palla non è ancora partita resta incollata alla paletta,
    // stessa logica di updateHandling/updateDribble — ma non un aggancio
    // rigido puro PER TUTTA la durata: negli ultimi istanti prima del
    // rilascio vero converge verso releaseOrigin (la posizione ESATTA da
    // cui la preview disegnava l'arco al momento del click, congelata in
    // triggerShoot), altrimenti il volo vero partiva parallelo ma
    // SPOSTATO rispetto a quanto mostrato ("verde" ma non entrava).
    // Bug reale corretto: la prima versione faceva crescere il blend
    // LINEARMENTE per TUTTO windup+gran parte di release (~90% dell'intera
    // animazione, non solo l'istante del rilascio) — la palla si staccava
    // visibilmente dalla paletta per quasi tutta la motion invece di
    // restare "in mano" (segnalato dal vivo su AMR MANIPULATOR, dove il
    // windup è ampio). Il blend ora resta a 0 (aggancio rigido puro alla
    // paletta, "in mano") per la maggior parte del tempo, e cresce da 0 a
    // 1 solo nell'ULTIMA fetta (BLEND_START_FRACTION) prima del rilascio —
    // una correzione rapida ma non istantanea, concentrata dove serve
    // davvero (l'istante vero del rilascio deve combaciare con la preview)
    // invece di spalmata su tutta l'animazione
    if (!shootingState.released) {
      getObjectWorldPosition(manipulator.ballRestPoint, paddleWorldPos)
      const timeToRelease = shootTuning.windupDuration + shootTuning.releasePoint * shootTuning.releaseDuration
      const linearT = timeToRelease > 0 ? Math.min(shootingState.timeSinceTrigger / timeToRelease, 1) : 1
      const originBlend = Math.min(Math.max((linearT - BLEND_START_FRACTION) / (1 - BLEND_START_FRACTION), 0), 1)
      ctx.getBasketball().position.lerpVectors(paddleWorldPos, shootingState.releaseOrigin, originBlend)
    }
  }

  // --- Preview di traiettoria (solo mentre si mira in HANDLING) ---
  const trajectoryBlackMaterial = new THREE.MeshBasicMaterial({ color: TRAJ_COLOR_BLACK, transparent: true, opacity: TRAJECTORY_OPACITY })
  const trajectoryColoredMaterial = new THREE.MeshBasicMaterial({ color: TRAJ_COLOR_BLUE, transparent: true, opacity: TRAJECTORY_OPACITY })
  let trajectoryBlackMesh = null
  let trajectoryColoredMesh = null

  // ricostruisce (dispose + nuova, TubeGeometry non si aggiorna in place)
  // la mesh-tubo per un tratto di punti — null se meno di 2 punti
  function rebuildTrajectoryTube(existingMesh, points, material) {
    if (existingMesh) {
      scene.remove(existingMesh)
      existingMesh.geometry.dispose()
    }
    if (points.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(points)
    const tubularSegments = Math.min(points.length * 3, 150)
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, TRAJECTORY_TUBE_RADIUS, 6, false)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    scene.add(mesh)
    return mesh
  }

  // rimuove entrambe le mesh-tubo dalla scena (fuori da HANDLING, o a tiro
  // già rilasciato)
  function hideTrajectoryPreview() {
    if (trajectoryBlackMesh) { scene.remove(trajectoryBlackMesh); trajectoryBlackMesh.geometry.dispose(); trajectoryBlackMesh = null }
    if (trajectoryColoredMesh) { scene.remove(trajectoryColoredMesh); trajectoryColoredMesh.geometry.dispose(); trajectoryColoredMesh = null }
  }

  const trajPos = new THREE.Vector3()
  const trajVel = new THREE.Vector3()
  const trajBlackPoints = []
  const trajColoredPoints = []
  // diagnostica per il pannello CAMERA (tasto P)
  const trajDebug = { count: 0, stopReason: '—' }
  // scratch riusati invece di allocare ad ogni chiamata: updateTrajectoryPreview
  // gira ogni frame mentre si mira (fino a TRAJECTORY_MAX_STEPS passi ciascuna).
  // previewScratchPreviousPos sostituisce un .clone() ad ogni chiamata (stesso
  // scratch-pattern di scratchPreviousShotPos in stepShotFlight); la Map dei
  // cooldown è svuotata (.clear()) invece di ricreata — SEPARATA da
  // shotCollisionCooldowns (volo reale), mai condivisa tra le due
  const previewScratchPreviousPos = new THREE.Vector3()
  const previewCollisionCooldowns = new Map()

  function updateTrajectoryPreview() {
    const manipulator = getManipulator()
    // NOTA: usa la posa di mira ATTUALE (quella che updateHandling ha
    // appena applicato), non quella di rilascio effettivo — un tentativo
    // di simulare la posa di rilascio esatta è stato provato e scartato:
    // con mira bassa/di lato produceva un'origine innaturale
    trajPos.copy(ctx.getBasketball().position)
    getShotDirection(trajVel).multiplyScalar(getEffectiveShotSpeed(manipulator.root.position))

    trajBlackPoints.length = 0
    trajColoredPoints.length = 0
    let coloredMaterialColor = TRAJ_COLOR_BLUE
    let collided = false
    // vettore COMPLETO (non solo Y): isHoopCrossing interpola il punto
    // esatto di attraversamento del piano del ferro
    const previousTrajPos = previewScratchPreviousPos.copy(trajPos)
    trajBlackPoints.push(trajPos.clone())

    const hoopAssistStrength = shootingStatToAssistStrength(manipulator.stats.shooting)
    const ballRadius = getBallRadius()
    // mappa dei cooldown SEPARATA dal volo reale: la preview simula un tiro
    // ipotetico ogni frame mentre si mira, non deve "consumare" il
    // cooldown degli oggetti reali prima che il tiro vero parta davvero
    previewCollisionCooldowns.clear()
    for (let i = 0; i < TRAJECTORY_MAX_STEPS; i++) {
      trajVel.y -= BALL_GRAVITY * TRAJECTORY_DT
      trajPos.addScaledVector(trajVel, TRAJECTORY_DT)
      applyHoopAssist(trajPos, trajVel, TRAJECTORY_DT, hoopAssistStrength, collisionWorld.hoops, collisionWorld.BACKBOARD_TOP_Y, ctx.rimRingRadius)

      // canestro: stesso criterio di checkHoopScore — controllato SEMPRE,
      // anche dopo un tocco su ferro/backboard (un tiro può toccare il
      // ferro e poi entrare)
      let hitScore = false
      for (const hoop of collisionWorld.hoops) {
        if (isHoopCrossing(previousTrajPos, trajPos, hoop)) hitScore = true
      }
      // backboard/ferro/muri/pali/panchine: rilevanti SOLO per decidere
      // quando finisce il tratto nero — una volta "collided" non contano
      // più (il canestro può ancora ricolorare in verde)
      const hitVisible = !collided && collisionWorld.resolve(trajPos, trajVel, TRAJECTORY_DT, previewCollisionCooldowns, ballRadius)
      // pavimento: qui resta uno stop secco (a differenza del volo reale,
      // che rimbalza) — la preview si ferma alla prima cosa "interessante" toccata
      let hitFloor = false
      if (!hitScore && !hitVisible && trajPos.y <= ballRadius) {
        trajPos.y = ballRadius
        trajVel.set(0, 0, 0)
        hitFloor = true
      }
      previousTrajPos.copy(trajPos)

      if (hitScore) {
        // priorità assoluta sul colore: anche se si era già "collided"
        // (blu, toccato il ferro un attimo prima), un canestro vero
        // ricolora tutto il tratto in verde
        coloredMaterialColor = TRAJ_COLOR_GREEN
        if (!collided) { trajBlackPoints.push(trajPos.clone()); collided = true }
        trajColoredPoints.push(trajPos.clone())
      } else if (hitVisible) {
        coloredMaterialColor = TRAJ_COLOR_BLUE
        trajBlackPoints.push(trajPos.clone())
        collided = true
        trajColoredPoints.push(trajPos.clone())
      } else if (!collided) {
        trajBlackPoints.push(trajPos.clone())
      } else {
        trajColoredPoints.push(trajPos.clone())
      }

      if (hitFloor) { trajDebug.stopReason = 'pavimento'; break }
      if (i === TRAJECTORY_MAX_STEPS - 1) trajDebug.stopReason = 'budget esaurito (mai toccato nulla)'
    }
    trajDebug.count = trajBlackPoints.length + trajColoredPoints.length

    trajectoryColoredMaterial.color.set(coloredMaterialColor)
    trajectoryBlackMesh = rebuildTrajectoryTube(trajectoryBlackMesh, trajBlackPoints, trajectoryBlackMaterial)
    trajectoryColoredMesh = rebuildTrajectoryTube(trajectoryColoredMesh, trajColoredPoints, trajectoryColoredMaterial)
  }

  return {
    getShotDirection, getEffectiveShotSpeed, isInsideThreePointArc: pos => isInsideThreePointArc(pos, hoopsForArcCheck()),
    addScore, resetScore, checkHoopScore, clearAllCollisionCooldowns, triggerShoot,
    updateShotFlight, updateShootAnimation, updateTrajectoryPreview, hideTrajectoryPreview,
    shotVelocity, trajDebug,
    // letto da main.js dopo ogni onScore per il win-condition check (1V1,
    // primo a WIN_SCORE punti) — funzione, non un valore, resta corretta
    // ad ogni chiamata invece di una snapshot congelata alla costruzione
    getScore: () => score,
  }
}
