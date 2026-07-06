import { GameMode } from './GameMode.js'
import { TimeOfDay } from './TimeOfDay.js'
import { RobotState } from './robots/RobotBase.js'
import { BallState } from './Basketball.js'

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
// dipendenza circolare che questo split vuole evitare. applyTimeOfDayPreset
// resta una CALLBACK nel context (usata anche fuori dal menu, al primo
// avvio) — questo modulo non deve sapere come funziona dentro.
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
    menuOverlayEl, hint, dashPanel, crosshair, modeIndicator,
    menuState, controls,
    applyTimeOfDayPreset, resetScore,
    renderer, scene, camera, sun, ssaoPass, sfx,
    manipulator, movementState, cameraState, dashState, shootingState, handlingState, pickupState,
    shotVelocity, ORBIT_PITCH_REST,
    resetDribbleState, clearAllCollisionCooldowns, hideTrajectoryPreview,
  } = ctx

  // BACK TO MAIN MENU deve riportare a una partita davvero pulita, non solo
  // azzerare il punteggio — altrimenti una nuova PRACTICE iniziava con 0
  // punti ma il robot dove lo si era lasciato fisicamente sul campo,
  // ancora a metà tiro/palleggio/dash. Riporta ogni pezzo di stato
  // transitorio (non gameMode/timeOfDay: quelli restano l'ultima scelta,
  // si ricambiano rifacendo il flusso se serve) alla stessa condizione di
  // un ingresso a freddo in Play
  function resetGameplayState() {
    manipulator.root.position.set(0, 0, 0)
    movementState.facing = 0
    movementState.wheelsAngle = -Math.PI / 2 // combacia col valore iniziale del `let` a modulo originale
    manipulator.controls.setWheelsYaw(movementState.wheelsAngle)
    cameraState.orbitYaw = 0
    cameraState.orbitPitch = ORBIT_PITCH_REST

    manipulator.setState(RobotState.DRIBBLE)
    const ball = ctx.getBasketball()
    if (ball) ball.setState(BallState.HANDLED)
    resetDribbleState()
    clearAllCollisionCooldowns()

    dashState.cooldown = 0
    dashState.timeRemaining = 0

    shootingState.phase = 'idle'
    shootingState.phaseT = 0
    shootingState.released = false
    shootingState.stateTransitionTimer = 0
    shootingState.wasInsideArc = false
    shotVelocity.set(0, 0, 0)
    manipulator.controls.setShootTilt(0)

    handlingState.grip = 0
    handlingState.tiltOffset = 0
    manipulator.controls.setGrip(0)

    pickupState.phase = 'idle'
    pickupState.phaseT = 0

    hideTrajectoryPreview()
  }

  function showMenuScreen(id) {
    document.querySelectorAll('.menu-screen').forEach(el => el.classList.toggle('active', el.id === id))
    // l'anteprima robot (canvas live, palleggio animato) anima solo mentre
    // la sua card è davvero visibile — niente sprecato sulle altre schermate
    menuState.robotPreviewActive = (id === 'menu-robot')
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
  document.getElementById('menu-back-to-main-btn').addEventListener('click', () => {
    resetScore()
    resetGameplayState()
    showMenuScreen('menu-main')
  })

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
  }
  // funzione a parte (non solo dentro il listener) perché serve anche da
  // altre varianti (es. altri punti d'ingresso alla pausa)
  function resumeGame() {
    enterPlayMode()
  }
  document.getElementById('menu-back-to-game-btn').addEventListener('click', resumeGame)

  // solo PRACTICE ha data-gamemode (1V1/3V3 sono bottoni disabled senza
  // l'attributo, questo querySelectorAll non li include nemmeno) — nessun
  // ramo per "quale gamemode" serve finché ce n'è solo una vera
  document.querySelectorAll('[data-gamemode]').forEach(el => {
    el.addEventListener('click', () => {
      menuState.gameMode = GameMode.PRACTICE
      showMenuScreen('menu-robot')
    })
  })

  document.querySelectorAll('[data-robot]').forEach(el => {
    // solo MANIPULATOR è selezionabile per ora (le altre card non hanno
    // data-robot, quindi questo querySelectorAll non le include nemmeno)
    el.addEventListener('click', () => showMenuScreen('menu-timeofday'))
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
      applyTimeOfDayPreset(menuState.timeOfDay)
      timeOfDayCards.forEach(card => card.classList.toggle('selected', card === el))
      menuStartBtn.classList.remove('hidden')
    })
  })

  document.getElementById('menu-start-btn').addEventListener('click', () => {
    // dashPanel/crosshair: nascosti di default nell'HTML finché non si entra
    // MAI in play — smostrati una tantum qui, la pausa/ripresa successive
    // (enterPlayMode/resumeGame) non li toccano più, restano già sbloccati
    dashPanel.classList.remove('hidden')
    crosshair.classList.remove('hidden')
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

  return { openPauseMenu, resumeGame, showMenuScreen }
}
