// "Enum" congelato, stesso pattern di RobotState/BallState — nessuna classe,
// solo valori: la modalità scelta nel main menu (GAMEMODES), letta da
// main.js per decidere come impostare la partita. Solo PRACTICE è davvero
// implementata per ora (robot singolo, campo vuoto) — 1v1/3v3 richiedono
// nemici (Section 3), ancora da fare.
export const GameMode = Object.freeze({
  PRACTICE: 'practice',
  ONE_V_ONE: '1v1',
  THREE_V_THREE: '3v3',
})
