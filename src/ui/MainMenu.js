import { GameMode } from '../state/GameMode.js'
import { TimeOfDay } from '../state/TimeOfDay.js'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from '../gameplay/Basketball.js'

// Esperimento di split "alla isometric_racer" (vedi README → "Confronto
// con Altri Progetti"/ricerca su cross-module state sharing): invece di
// importare stato "vivo" da main.js (rischio di dipendenze circolari —
// main.js dovrebbe importare da qui, qui da main.js), questo modulo
// riceve TUTTO ciò che gli serve come un unico oggetto context passato a
// initMainMenu(), stesso principio del ctx di isometric_racer. Nessun
// import da main.js: zero dipendenza circolare. RobotState/BallState
// importati direttamente qui (sono foglie, nessun rischio circolare) —
// diverso da GameMode/TimeOfDay solo per dove main.js li usa anche altrove.
//
// Cosa NON è stato spostato qui (deliberatamente): renderRobotCardPreview/
// stat bar restano in main.js perché dipendono da stepDribble e dagli
// helper angleToForward/rotateRight — importarli qui creerebbe la stessa
// dipendenza circolare che questo split vuole evitare. startTimeOfDayTransition
// resta una CALLBACK nel context (usata dal click sulla card — sempre un fade
// animato, mai uno scatto secco) — questo modulo non deve sapere come
// funziona dentro (luci, Sky, transizione: tutto vive in main.js).
// applyTimeOfDayPreset (lo scatto istantaneo, usato solo al primissimo avvio
// pagina) resta invece interna a main.js, non passa da qui.
//
// ctx.getBasketball() è una funzione, non un valore semplice: main.js
// assegna basketball in modo asincrono al caricamento del GLTF, quindi al
// momento in cui initMainMenu() viene chiamato è ancora null — un valore
// catturato lì per lì resterebbe null per sempre. La funzione legge il
// valore CORRENTE ad ogni chiamata (non un accessor `get`: ctx nasce da uno
// spread di gameContext in main.js, che valuterebbe subito un accessor e ne
// congelerebbe il risultato — vedi il commento su gameContext in main.js)
export function initMainMenu(ctx) {
  const {
    menuOverlayEl, hint, dashPanel, combatPanel, crosshair, modeIndicator,
    scoreboardEl, enemyScoreboardEl, controlsHintEl,
    menuState, controls,
    startTimeOfDayTransition, resetScore, resetEnemyScore,
    renderer, scene, camera, sun, ssaoPass, sfx,
    getManipulator, movementState, cameraState, dashState, dashMaxCharges, shootingState, handlingState, pickupState,
    stealState, blockState,
    shotVelocity, ORBIT_PITCH_REST,
    resetDribbleState, clearAllCollisionCooldowns, hideTrajectoryPreview,
    getEnemyManipulator, enemyShootingState, enemyHandlingState, enemyPickupState,
    enemyStealState, enemyBlockState, enemyShotVelocity,
    enemyResetDribbleState, enemyClearAllCollisionCooldowns, resetEnemyWheelsAngle,
    setActiveRobotClass, setActiveEnemyRobotClass,
  } = ctx

  // "lati" del campo: canestri reali a X≈±1080 (CollisionWorld.js) — a metà
  // strada verso il centro, non alla linea di fondo: una nuova partita
  // parte a distanza di palleggio, non già sotto canestro
  const PLAYER_SPAWN_X = -300
  const ENEMY_SPAWN_X = 300

  // BACK TO MAIN MENU deve riportare a una partita davvero pulita, non solo
  // azzerare il punteggio — altrimenti una nuova PRACTICE iniziava con 0
  // punti ma il robot dove lo si era lasciato fisicamente sul campo,
  // ancora a metà tiro/palleggio/dash. Riporta ogni pezzo di stato
  // transitorio (non gameMode/timeOfDay: quelli restano l'ultima scelta,
  // si ricambiano rifacendo il flusso se serve) alla stessa condizione di
  // un ingresso a freddo in Play
  // Reset di tiro/handling/pickup/STEAL/BLOCK per UN robot a una condizione
  // pulita — prima duplicato a mano per giocatore/nemico dentro
  // resetGameplayState (stessi ~19 campi, differivano solo nel prefisso
  // enemy*). Non copre posizione/camera/dash/aimYaw: quei pezzi divergono
  // per davvero tra giocatore e nemico (camera orbitale solo-giocatore,
  // dash solo-giocatore, l'IA nemica ha un proprio setAimYaw esplicito),
  // non solo nei nomi — restano scritti a mano in resetGameplayState sotto
  function resetCombatAndShotState(robot, s) {
    s.resetDribbleState()
    s.clearAllCollisionCooldowns()

    s.shootingState.phase = 'idle'
    s.shootingState.phaseT = 0
    s.shootingState.released = false
    s.shootingState.hasBounced = false
    s.shootingState.stateTransitionTimer = 0
    s.shootingState.wasInsideArc = false
    s.shotVelocity.set(0, 0, 0)
    robot.controls.setShootTilt(0)

    s.handlingState.grip = 0
    s.handlingState.tiltOffset = 0
    robot.controls.setGrip(0)

    s.pickupState.phase = 'idle'
    s.pickupState.phaseT = 0

    s.stealState.phase = 'idle'
    s.stealState.phaseT = 0
    s.stealState.cooldown = 0
    s.stealState.contactMade = false
    s.blockState.phase = 'idle'
    s.blockState.phaseT = 0
    s.blockState.cooldown = 0
    robot.controls.setDribbleOffsets(0, 0)
  }

  // ballOwner: di default il giocatore (comportamento storico, invariato
  // per BACK TO MAIN MENU) — parametrizzato per riuso dal turnover di
  // possesso dopo un canestro/palla fuori campo in 1V1 (main.js), dove deve
  // andare a chi ha SUBITO il canestro/l'ha persa, non sempre al giocatore
  function resetGameplayState(ballOwner) {
    const manipulator = getManipulator()
    const enemyManipulator = getEnemyManipulator()
    if (ballOwner === undefined) ballOwner = manipulator
    const otherOwner = ballOwner === manipulator ? enemyManipulator : manipulator
    manipulator.root.position.set(PLAYER_SPAWN_X, 0, 0)
    movementState.facing = 0
    manipulator.locomotionYaw = -Math.PI / 2 // combacia col valore iniziale impostato dal costruttore di RobotBase
    manipulator.controls.setWheelsYaw(manipulator.locomotionYaw)
    cameraState.orbitYaw = 0
    cameraState.orbitPitch = ORBIT_PITCH_REST

    ballOwner.setState(RobotState.DRIBBLE)
    otherOwner.setState(RobotState.NO_BALL)
    // palla riassegnata a ballOwner: la sua posizione segue comunque
    // sempre la paletta del possessore (vedi stepDribble), "al centro"
    // vero conterebbe solo per una palla senza owner — qui basta che
    // riparta da chi la possiede, non da dove l'ultima partita l'ha lasciata
    const ball = ctx.getBasketball()
    if (ball) {
      ball.setState(BallState.HANDLED)
      ball.setOwner(ballOwner)
    }
    resetCombatAndShotState(manipulator, {
      shootingState, shotVelocity, handlingState, pickupState, stealState, blockState,
      resetDribbleState, clearAllCollisionCooldowns,
    })

    dashState.charges = dashMaxCharges
    dashState.rechargeTimer = 0
    dashState.timeRemaining = 0

    // nemico: stesso reset di posizione/orientamento dal proprio lato di
    // campo — altrimenti BACK TO MAIN MENU → PRACTICE riparte con l'IA a
    // metà tiro/palleggio di prima, o dalla parte sbagliata di campo
    enemyManipulator.root.position.set(ENEMY_SPAWN_X, 0, 0)
    enemyManipulator.controls.setWheelsYaw(-Math.PI / 2)
    // risincronizza la copia locale di EnemyAI.js (mantenuta per
    // interpolare fluidamente, non la sorgente di verità) — senza,
    // restava al valore di prima del reset e il prossimo lerpAngle
    // faceva scivolare visibilmente le ruote da lì invece di ripartire pulite
    resetEnemyWheelsAngle(-Math.PI / 2)
    enemyManipulator.controls.setAimYaw(-Math.PI / 2)
    // stato già impostato sopra (ballOwner/otherOwner) — non risovrascrivere
    // qui a NO_BALL fisso: se ballOwner è l'ENEMY (turnover di possesso)
    // deve restare DRIBBLE
    resetCombatAndShotState(enemyManipulator, {
      shootingState: enemyShootingState, shotVelocity: enemyShotVelocity, handlingState: enemyHandlingState,
      pickupState: enemyPickupState, stealState: enemyStealState, blockState: enemyBlockState,
      resetDribbleState: enemyResetDribbleState, clearAllCollisionCooldowns: enemyClearAllCollisionCooldowns,
    })

    hideTrajectoryPreview()
  }


  function showMenuScreen(id) {
    document.querySelectorAll('.menu-screen').forEach(el => el.classList.toggle('active', el.id === id))
    // l'anteprima robot (canvas live, palleggio animato) anima solo mentre
    // la sua card è davvero visibile — niente sprecato sulle altre schermate.
    // Due flag separati (non uno solo): con un flag unico per entrambe le
    // schermate ROBOT/ROBOT AVVERSARIO, la preview NON visibile avrebbe
    // comunque continuato a renderizzare in background ogni volta che
    // l'altra è quella davvero mostrata
    menuState.robotPreviewActive = (id === 'menu-robot')
    menuState.enemyRobotPreviewActive = (id === 'menu-robot-enemy')
    // stessa logica per le card LEGGED MANIPULATOR/DRONE (ancora "Coming
    // Soon", ma con una vera anteprima 3D dal vivo — vedi main.js)
    menuState.leggedRobotPreviewActive = (id === 'menu-robot')
    menuState.enemyLeggedRobotPreviewActive = (id === 'menu-robot-enemy')
    menuState.droneRobotPreviewActive = (id === 'menu-robot')
    menuState.enemyDroneRobotPreviewActive = (id === 'menu-robot-enemy')
  }
  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => showMenuScreen(el.dataset.goto))
  })

  // OPTIONS è raggiungibile sia dal main menu (menu-main) sia dalla pausa in
  // partita (menu-pause) — il tasto indietro deve tornare da dove si è
  // entrati, non sempre allo stesso posto fisso
  menuState.optionsReturnScreen = 'menu-main'
  document.querySelectorAll('[data-goto-options-from]').forEach(el => {
    el.addEventListener('click', () => {
      menuState.optionsReturnScreen = el.dataset.gotoOptionsFrom
      showMenuScreen('menu-options')
    })
  })
  document.getElementById('menu-options-back-btn').addEventListener('click', () => showMenuScreen(menuState.optionsReturnScreen))

  // --- Pausa in partita (ESC) ---
  // idempotente (guardia su mode==='menu') perché ci sono DUE modi in cui
  // arriva: (1) il keydown Escape in main.js, se il pointer non era già
  // agganciato; (2) l'evento 'unlock' in main.js, se lo era — col pointer
  // agganciato il browser stesso intercetta Esc per sganciarlo PRIMA che il
  // keydown arrivi alla pagina (comportamento nativo della Pointer Lock API,
  // non evitabile): la prima pressione sganciava solo il pointer (mostrando
  // il vecchio hint "Click per entrare"), la pausa vera scattava solo alla
  // seconda pressione. Aprirla anche da 'unlock' copre il caso mancante
  function openPauseMenu() {
    if (menuState.mode === 'menu') return
    menuState.mode = 'menu'
    menuOverlayEl.style.display = 'flex'
    showMenuScreen('menu-pause')
    hint.style.display = 'none' // sovrascrive quanto fatto da 'unlock' (vedi sopra) — c'è un vero menu ora
  }
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape' || (menuState.mode !== 'play' && menuState.mode !== 'spectate')) return
    if (controls.isLocked) controls.unlock() // farà scattare anche il listener 'unlock' in main.js, openPauseMenu() è idempotente
    else openPauseMenu()
  })
  // fattorizzata (non solo un listener inline): riusata anche dal bottone
  // BACK TO MAIN MENU della title screen di fine partita (game-over-screen,
  // main.js) — stessa identica pulizia, non una copia a parte
  function backToMainMenu() {
    resetScore()
    resetEnemyScore()
    resetGameplayState()
    // l'HUD di gioco deve tornare invisibile finché non si preme di nuovo
    // START — altrimenti restava sullo schermo (visibile attraverso il
    // centro trasparente di #menu-overlay) anche mentre si è tornati al
    // menu principale
    dashPanel.classList.add('hidden')
    combatPanel.classList.add('hidden')
    crosshair.classList.add('hidden')
    scoreboardEl.classList.add('hidden')
    enemyScoreboardEl.classList.add('hidden')
    controlsHintEl.classList.add('hidden')
    modeIndicator.classList.add('hidden')
    // difesa in profondità: l'evento 'unlock' (main.js) rimostra sempre
    // "Click to enter" — già sovrascritto da chi ci porta qui (openPauseMenu/
    // showGameOverScreen), ma questo è il vero punto di arrivo finale
    // qualunque sia stato il percorso, stesso principio del resto sopra
    hint.style.display = 'none'
    // bug reale: openPauseMenu() rende visibile #menu-overlay (display:flex)
    // PRIMA di chiamare backToMainMenu() da lì — ma showGameOverScreen()
    // (main.js) non lo fa mai, mostra solo #game-over-screen (un overlay
    // SEPARATO). Arrivando qui da GAME OVER, #menu-main diventava .active
    // ma il suo contenitore #menu-overlay restava invisibile: si vedeva
    // solo l'orbita lenta della camera (menuState.mode è già 'menu') senza
    // alcun menu sopra. Impostato qui, non nei chiamanti, per lo stesso
    // motivo di hint sopra: questo è il vero arrivo finale
    menuOverlayEl.style.display = 'flex'
    getManipulator().root.visible = false
    getEnemyManipulator().root.visible = false
    showMenuScreen('menu-main')
  }
  document.getElementById('menu-back-to-main-btn').addEventListener('click', backToMainMenu)

  // comune a START (primo ingresso) e BACK TO GAME (ripresa da pausa): nasconde
  // l'overlay ed entra in 'play'. Il primo ingresso ha in più dashPanel/
  // crosshair da smostrare una tantum (nascosti di default nell'HTML finché
  // non si è mai entrati in play) — la pausa non li tocca mai, restano già
  // visibili da quando sono stati sbloccati la prima volta.
  // controls.lock() diretto (non più "Click per entrare" a schermo): il
  // click sul bottone STESSO è già il gesto utente richiesto dalla Pointer
  // Lock API, non serve un secondo click sul canvas — l'evento 'lock' che
  // scatta nasconde #hint da solo (vedi il listener in main.js)
  function enterPlayMode() {
    menuOverlayEl.style.display = 'none'
    menuState.mode = 'play'
    modeIndicator.textContent = `MODE: ${menuState.mode.toUpperCase()}`
    controls.lock()
    // il campo resta vuoto per tutto il Main Menu (vedi main.js, dove
    // entrambi partono con root.visible = false) — solo da qui in poi il
    // robot del giocatore torna visibile, per davvero entrare in partita
    getManipulator().root.visible = true
    // PRACTICE è solo: il nemico resta nascosto (la sua AI/dispatch sono
    // già disattivati altrove in base a gameMode, questo è solo l'aspetto
    // visivo — senza, il modello procedurale restava lì fermo e visibile
    // anche in una partita "da soli")
    const isOneVOne = menuState.gameMode === GameMode.ONE_V_ONE
    getEnemyManipulator().root.visible = isOneVOne
    combatPanel.classList.toggle('hidden', !isOneVOne)
    enemyScoreboardEl.classList.toggle('hidden', !isOneVOne)
  }
  // funzione a parte (non solo dentro il listener) perché serve anche da
  // altre varianti (es. altri punti d'ingresso alla pausa)
  function resumeGame() {
    enterPlayMode()
  }
  document.getElementById('menu-back-to-game-btn').addEventListener('click', resumeGame)

  // solo PRACTICE e 1V1 esistono come bottoni (3V3 mai implementata, fuori
  // scope — nessun bottone disabled da escludere qui)
  const gameModeMap = { practice: GameMode.PRACTICE, '1v1': GameMode.ONE_V_ONE }
  document.querySelectorAll('[data-gamemode]').forEach(el => {
    el.addEventListener('click', () => {
      menuState.gameMode = gameModeMap[el.dataset.gamemode]
      showMenuScreen('menu-robot')
    })
  })

  document.querySelectorAll('[data-robot]').forEach(el => {
    // applicata SUBITO (mai un reload): la schermata ROBOT è raggiungibile
    // solo mentre manipulator.root è ancora nascosto (Main Menu, o dopo
    // BACK TO MAIN MENU che lo nasconde di nuovo) — lo switch tra le 3
    // istanze precaricate è quindi sempre invisibile, nessun glitch
    // possibile scegliendo/ricambiando idea tra le card. In 1V1 c'è un
    // secondo giro di scelta (l'avversario, stesso roster) — in PRACTICE
    // non esiste alcun avversario, si salta diretti a TIMEOFDAY
    el.addEventListener('click', () => {
      setActiveRobotClass(el.dataset.robot)
      showMenuScreen(menuState.gameMode === GameMode.ONE_V_ONE ? 'menu-robot-enemy' : 'menu-timeofday')
    })
  })

  // stesso principio della scelta del proprio robot sopra — il roster
  // dell'avversario è indipendente da quello del giocatore
  document.querySelectorAll('[data-robot-enemy]').forEach(el => {
    el.addEventListener('click', () => {
      setActiveEnemyRobotClass(el.dataset.robotEnemy)
      showMenuScreen('menu-timeofday')
    })
  })

  // il "back" da TIMEOFDAY deve tornare alla schermata di scelta robot
  // giusta per la modalità corrente: ROBOT AVVERSARIO in 1V1 (l'ultimo
  // passo prima di questa), ROBOT in PRACTICE (dove non esiste un giro
  // avversario) — data-goto statico non basta, dipende da menuState.gameMode
  document.getElementById('menu-timeofday-back-btn').addEventListener('click', () => {
    showMenuScreen(menuState.gameMode === GameMode.ONE_V_ONE ? 'menu-robot-enemy' : 'menu-robot')
  })

  const timeOfDayCards = document.querySelectorAll('[data-timeofday]')
  const menuStartBtn = document.getElementById('menu-start-btn')
  timeOfDayCards.forEach(el => {
    el.addEventListener('click', () => {
      // solo scelta + preview (camera ancora in orbita isometrica, mode
      // resta 'menu') — niente cambio di schermata: il tasto START compare
      // sotto le card, nella STESSA schermata, non se ne apre un'altra
      const timeMap = { sunrise: TimeOfDay.SUNRISE, day: TimeOfDay.DAY, sunset: TimeOfDay.SUNSET, night: TimeOfDay.NIGHT }
      menuState.timeOfDay = timeMap[el.dataset.timeofday]
      startTimeOfDayTransition(menuState.timeOfDay)
      timeOfDayCards.forEach(card => card.classList.toggle('selected', card === el))
      menuStartBtn.classList.remove('hidden')
    })
  })

  document.getElementById('menu-start-btn').addEventListener('click', () => {
    // resetGameplayState() qui, non solo su BACK TO MAIN MENU: la palla
    // riceve il proprio owner iniziale in main.js in modo ASINCRONO, al
    // caricamento del GLTF (basketball.setOwner(manipulator), una tantum,
    // qualunque manipulator fosse quello ATTIVO in quel momento) — se
    // l'utente sceglie una classe diversa DOPO che quel caricamento è già
    // arrivato (tipico: scegliere robot richiede più tempo del download del
    // GLTF pallone), quell'owner restava agganciato alla classe VECCHIA per
    // sempre, perché su una primissima partita (mai passata da BACK TO MAIN
    // MENU) resetGameplayState() non girava mai — bug reale: tasto destro
    // non faceva scattare HANDLING (basketball.owner !== manipulator),
    // "mirare" sembrava completamente rotto. Chiamarlo anche qui risincronizza
    // sempre l'owner (e tutto il resto dello stato transitorio) col robot
    // REALMENTE attivo, prima di ogni nuova partita
    resetGameplayState()
    // dashPanel/crosshair/scoreboard/controls-hint: nascosti di default
    // nell'HTML finché non si entra MAI in play — smostrati qui (combatPanel
    // NON qui: dipende da PRACTICE/1V1, lo decide enterPlayMode sotto)
    dashPanel.classList.remove('hidden')
    crosshair.classList.remove('hidden')
    scoreboardEl.classList.remove('hidden')
    // "R: recover the ball" è un tasto di TEST valido solo in PRACTICE (il
    // keydown handler in main.js è già disabilitato in 1V1 — vedi il
    // commento lì) — l'hint visivo deve rispecchiare lo stesso gate,
    // altrimenti resta un pulsante fuorviante che promette un tasto che in
    // 1V1 non fa nulla
    controlsHintEl.classList.toggle('hidden', menuState.gameMode !== GameMode.PRACTICE)
    modeIndicator.classList.remove('hidden')
    enterPlayMode()
  })

  // --- Main Menu: Options (grafica) ---
  document.getElementById('opt-ssao').addEventListener('change', e => { ssaoPass.enabled = e.target.checked })
  document.getElementById('opt-shadows').addEventListener('change', e => {
    // renderer.shadowMap.enabled da solo non basta: gli shader dei materiali
    // già compilati con lo shadow branch attivo restano "congelati" com'erano
    // (gotcha noto di three.js) — serve anche spegnere castShadow sulla luce
    // vera e forzare la ricompilazione di ogni materiale in scena
    const enabled = e.target.checked
    renderer.shadowMap.enabled = enabled
    sun.castShadow = enabled
    scene.traverse(obj => {
      if (!obj.material) return
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      materials.forEach(m => { m.needsUpdate = true })
    })
  })
  document.getElementById('opt-volume').addEventListener('input', e => { sfx.setMasterVolume(Number(e.target.value)) })
  document.getElementById('opt-fov').addEventListener('input', e => {
    camera.fov = Number(e.target.value)
    camera.updateProjectionMatrix()
  })

  // resetGameplayState esportata direttamente (accetta ballOwner opzionale,
  // default = giocatore): usata da BACK TO MAIN MENU qui dentro, e da
  // main.js per i due casi di turnover di possesso in 1V1 (canestro subito,
  // palla uscita dal campo non recuperata) — main.js decide CHI diventa il
  // nuovo proprietario e se siamo in 1V1, questa funzione resta un
  // meccanismo puro, non una decisione
  return { openPauseMenu, resumeGame, showMenuScreen, resetGameplayState, backToMainMenu }
}
