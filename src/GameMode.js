// "Enum" congelato, stesso pattern di RobotState/BallState — nessuna classe,
// solo valori: la modalità scelta nel main menu (GAMEMODES), letta da
// main.js per decidere come impostare la partita. 3V3 rimosso dal Main
// Menu (mai stato implementato, nessun piano di farlo nel breve periodo) —
// solo PRACTICE e 1V1 restano come opzioni reali.
export const GameMode = Object.freeze({
  PRACTICE: 'practice',
  ONE_V_ONE: '1v1',
})
