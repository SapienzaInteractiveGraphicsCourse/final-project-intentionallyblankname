// "Enum" congelato, stesso pattern di RobotState/BallState/GameMode —
// scelto nel main menu, nessun preset di illuminazione ancora collegato
// (Section 4 nel roadmap): solo il valore selezionato, per ora.
export const TimeOfDay = Object.freeze({
  SUNRISE: 'sunrise',
  DAY: 'day',
  SUNSET: 'sunset',
  NIGHT: 'night',
})
