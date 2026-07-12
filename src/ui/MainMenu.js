import { GameMode, TimeOfDay } from '../SharedEnums.js'
import { RobotState } from '../robots/RobotBase.js'
import { BallState } from '../gameplay/Basketball.js'

// Menu screens, pause, gameplay reset. Context-object pattern, zero
// imports from main.js. renderRobotCardPreview/stat bars deliberately
// stay in main.js (they depend on stepDribble and would recreate the
// circular dependency this split avoids). startTimeOfDayTransition is a
// callback in the context: this module never needs to know how
// lights/sky work inside.
//
// ctx.getBasketball() is a function, not a value: basketball is assigned
// asynchronously on GLTF load (null at init time). Not a `get` accessor:
// ctx comes from a spread, which would freeze the accessor's result
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

  // Spawns halfway to center (hoops at X≈±1080): a new game starts at
  // dribbling distance, not under the basket
  const PLAYER_SPAWN_X = -300
  const ENEMY_SPAWN_X = 300

  // Shot/handling/pickup/STEAL/BLOCK reset for ONE robot, previously
  // duplicated by hand for player/enemy (same ~19 fields, enemy* prefix).
  // Position/camera/dash/aimYaw are NOT here: those genuinely differ
  // between the two sides and stay in resetGameplayState below
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

  // Full transient-state reset, equivalent to a cold entry into Play
  // (score alone was not enough: robots stayed mid-shot/dribble/dash).
  // gameMode/timeOfDay keep the last choice. ballOwner defaults to the
  // player (BACK TO MAIN MENU); the 1V1 possession turnover (main.js)
  // passes whoever conceded the basket/lost the ball
  function resetGameplayState(ballOwner) {
    const manipulator = getManipulator()
    const enemyManipulator = getEnemyManipulator()
    if (ballOwner === undefined) ballOwner = manipulator
    const otherOwner = ballOwner === manipulator ? enemyManipulator : manipulator
    manipulator.root.position.set(PLAYER_SPAWN_X, 0, 0)
    movementState.facing = 0
    manipulator.locomotionYaw = -Math.PI / 2 // matches the RobotBase constructor initial value
    manipulator.controls.setWheelsYaw(manipulator.locomotionYaw)
    cameraState.orbitYaw = 0
    cameraState.orbitPitch = ORBIT_PITCH_REST

    ballOwner.setState(RobotState.DRIBBLE)
    otherOwner.setState(RobotState.NO_BALL)
    // Ball position always follows the owner's paddle (stepDribble), so
    // reassigning the owner is enough
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

    // Enemy: same position/orientation reset on its own side
    enemyManipulator.root.position.set(ENEMY_SPAWN_X, 0, 0)
    enemyManipulator.controls.setWheelsYaw(-Math.PI / 2)
    // Resync EnemyAI's locomotionYaw copy, else the next lerp visibly
    // slides the wheels from the stale value
    resetEnemyWheelsAngle(-Math.PI / 2)
    enemyManipulator.controls.setAimYaw(-Math.PI / 2)
    // Robot states already set above (ballOwner/otherOwner): do not force
    // NO_BALL here, on a turnover the enemy may be the new owner
    resetCombatAndShotState(enemyManipulator, {
      shootingState: enemyShootingState, shotVelocity: enemyShotVelocity, handlingState: enemyHandlingState,
      pickupState: enemyPickupState, stealState: enemyStealState, blockState: enemyBlockState,
      resetDribbleState: enemyResetDribbleState, clearAllCollisionCooldowns: enemyClearAllCollisionCooldowns,
    })

    hideTrajectoryPreview()
  }


  function showMenuScreen(id) {
    document.querySelectorAll('.menu-screen').forEach(el => el.classList.toggle('active', el.id === id))
    // Card previews (live canvas, animated dribble) render only while
    // their screen is the visible one. Separate flags per screen: a
    // single shared flag kept the hidden screen's previews rendering
    menuState.robotPreviewActive = (id === 'menu-robot')
    menuState.enemyRobotPreviewActive = (id === 'menu-robot-enemy')
    menuState.leggedRobotPreviewActive = (id === 'menu-robot')
    menuState.enemyLeggedRobotPreviewActive = (id === 'menu-robot-enemy')
    menuState.droneRobotPreviewActive = (id === 'menu-robot')
    menuState.enemyDroneRobotPreviewActive = (id === 'menu-robot-enemy')
  }
  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => showMenuScreen(el.dataset.goto))
  })

  // OPTIONS is reachable from both the main menu and the pause menu: the
  // back button returns to wherever it was entered from
  menuState.optionsReturnScreen = 'menu-main'
  document.querySelectorAll('[data-goto-options-from]').forEach(el => {
    el.addEventListener('click', () => {
      menuState.optionsReturnScreen = el.dataset.gotoOptionsFrom
      showMenuScreen('menu-options')
    })
  })
  document.getElementById('menu-options-back-btn').addEventListener('click', () => showMenuScreen(menuState.optionsReturnScreen))

  // --- In-game pause (ESC) ---
  // Idempotent (mode guard): reached both from the Escape keydown and
  // from the 'unlock' event. With the pointer locked the browser
  // intercepts ESC to unlock BEFORE the keydown reaches the page, so the
  // keydown alone required two presses
  function openPauseMenu() {
    if (menuState.mode === 'menu') return
    menuState.mode = 'menu'
    menuOverlayEl.style.display = 'flex'
    showMenuScreen('menu-pause')
    hint.style.display = 'none' // a real menu is showing, override the 'unlock' hint
  }
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape' || (menuState.mode !== 'play' && menuState.mode !== 'spectate')) return
    if (controls.isLocked) controls.unlock() // also fires the 'unlock' listener; openPauseMenu is idempotent
    else openPauseMenu()
  })
  // Factored out: also reused by the game-over screen's BACK TO MAIN MENU
  // button (main.js), same cleanup, not a separate copy
  function backToMainMenu() {
    resetScore()
    resetEnemyScore()
    resetGameplayState()
    // Game HUD hidden until the next START (it was visible through the
    // transparent center of #menu-overlay otherwise)
    dashPanel.classList.add('hidden')
    combatPanel.classList.add('hidden')
    crosshair.classList.add('hidden')
    scoreboardEl.classList.add('hidden')
    enemyScoreboardEl.classList.add('hidden')
    controlsHintEl.classList.add('hidden')
    modeIndicator.classList.add('hidden')
    hint.style.display = 'none'
    // Real bug: openPauseMenu sets the overlay visible before calling
    // here, but showGameOverScreen (a SEPARATE overlay) never does.
    // Arriving from GAME OVER, #menu-main became .active inside an
    // invisible container. Set here, the true common arrival point
    menuOverlayEl.style.display = 'flex'
    getManipulator().root.visible = false
    getEnemyManipulator().root.visible = false
    showMenuScreen('menu-main')
  }
  document.getElementById('menu-back-to-main-btn').addEventListener('click', backToMainMenu)

  // Shared by START (first entry) and BACK TO GAME (resume). Direct
  // controls.lock(): the button click itself is already the user gesture
  // the Pointer Lock API requires, no extra "click to enter" step
  function enterPlayMode() {
    menuOverlayEl.style.display = 'none'
    menuState.mode = 'play'
    modeIndicator.textContent = `MODE: ${menuState.mode.toUpperCase()}`
    controls.lock()
    // The court stays empty for the whole Main Menu (both robots start
    // with root.visible = false in main.js)
    getManipulator().root.visible = true
    // PRACTICE is solo: the enemy stays hidden (its AI/dispatch are
    // already gated on gameMode elsewhere, this is just visibility)
    const isOneVOne = menuState.gameMode === GameMode.ONE_V_ONE
    getEnemyManipulator().root.visible = isOneVOne
    combatPanel.classList.toggle('hidden', !isOneVOne)
    enemyScoreboardEl.classList.toggle('hidden', !isOneVOne)
  }
  function resumeGame() {
    enterPlayMode()
  }
  document.getElementById('menu-back-to-game-btn').addEventListener('click', resumeGame)

  const gameModeMap = { practice: GameMode.PRACTICE, '1v1': GameMode.ONE_V_ONE }
  document.querySelectorAll('[data-gamemode]').forEach(el => {
    el.addEventListener('click', () => {
      menuState.gameMode = gameModeMap[el.dataset.gamemode]
      showMenuScreen('menu-robot')
    })
  })

  document.querySelectorAll('[data-robot]').forEach(el => {
    // Applied immediately, never a reload: the ROBOT screen is only
    // reachable while the robot is still hidden, so switching between
    // the 3 preloaded instances is always invisible. In 1V1 a second
    // pick follows (the opponent); PRACTICE skips straight to TIMEOFDAY
    el.addEventListener('click', () => {
      setActiveRobotClass(el.dataset.robot)
      showMenuScreen(menuState.gameMode === GameMode.ONE_V_ONE ? 'menu-robot-enemy' : 'menu-timeofday')
    })
  })

  // Same principle; the opponent roster is independent of the player's
  document.querySelectorAll('[data-robot-enemy]').forEach(el => {
    el.addEventListener('click', () => {
      setActiveEnemyRobotClass(el.dataset.robotEnemy)
      showMenuScreen('menu-timeofday')
    })
  })

  // Back from TIMEOFDAY returns to the right robot screen for the current
  // mode (a static data-goto cannot express this)
  document.getElementById('menu-timeofday-back-btn').addEventListener('click', () => {
    showMenuScreen(menuState.gameMode === GameMode.ONE_V_ONE ? 'menu-robot-enemy' : 'menu-robot')
  })

  const timeOfDayCards = document.querySelectorAll('[data-timeofday]')
  const menuStartBtn = document.getElementById('menu-start-btn')
  timeOfDayCards.forEach(el => {
    el.addEventListener('click', () => {
      // Choice + preview only (camera stays in menu orbit): START appears
      // below the cards on the SAME screen
      const timeMap = { sunrise: TimeOfDay.SUNRISE, day: TimeOfDay.DAY, sunset: TimeOfDay.SUNSET, night: TimeOfDay.NIGHT }
      menuState.timeOfDay = timeMap[el.dataset.timeofday]
      startTimeOfDayTransition(menuState.timeOfDay)
      timeOfDayCards.forEach(card => card.classList.toggle('selected', card === el))
      menuStartBtn.classList.remove('hidden')
    })
  })

  document.getElementById('menu-start-btn').addEventListener('click', () => {
    // resetGameplayState here too, not only on BACK TO MAIN MENU: the
    // ball's initial owner is set asynchronously on GLTF load to whatever
    // robot was active at that moment. Picking a different class AFTER
    // the load left the owner glued to the old class on a first game
    // (right mouse never entered HANDLING). This resyncs owner and all
    // transient state with the truly active robot before every game
    resetGameplayState()
    // Hidden by default in the HTML until play is first entered
    // (combatPanel NOT here: it depends on PRACTICE/1V1, enterPlayMode decides)
    dashPanel.classList.remove('hidden')
    crosshair.classList.remove('hidden')
    scoreboardEl.classList.remove('hidden')
    // "R: recover the ball" is a PRACTICE-only test key: the hint must
    // mirror the same gate as the keydown handler in main.js
    controlsHintEl.classList.toggle('hidden', menuState.gameMode !== GameMode.PRACTICE)
    modeIndicator.classList.remove('hidden')
    enterPlayMode()
  })

  // --- Options (graphics) ---
  document.getElementById('opt-ssao').addEventListener('change', e => { ssaoPass.enabled = e.target.checked })
  document.getElementById('opt-shadows').addEventListener('change', e => {
    // renderer.shadowMap.enabled alone is not enough: already-compiled
    // materials keep their shadow branch (known three.js gotcha). Also
    // disable castShadow on the light and force every material to recompile
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

  // resetGameplayState exported directly (optional ballOwner, default
  // player): main.js uses it for the two 1V1 turnover cases and decides
  // WHO the new owner is; this stays a pure mechanism
  return { openPauseMenu, resumeGame, showMenuScreen, resetGameplayState, backToMainMenu }
}
