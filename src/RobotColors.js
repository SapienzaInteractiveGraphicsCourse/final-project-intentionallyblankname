// Persistenza (sessionStorage, stesso principio di RobotSelection.js) dei
// colori personalizzati del robot ALLEATO — solo Team.A è personalizzabile
// dal Main Menu (schermata ROBOT, pulsante "Personalizza" sotto la
// preview). I nemici non hanno UI di personalizzazione: usano sempre lo
// schema di default per squadra (RobotBase.js, TEAM_ACCENT_COLOR).
const STORAGE_KEY = 'mechaBasketball.allyColors'

export function getSavedAllyColors() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveAllyColors(colors) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(colors))
}
