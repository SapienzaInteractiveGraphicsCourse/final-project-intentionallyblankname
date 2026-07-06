// "Enum" congelato, stesso pattern di RobotState/BallState/GameMode —
// scelto nel main menu, collegato a preset reali di luci/sfondo/faretti
// canestro (applyTimeOfDayPreset in main.js, vedi CLAUDE.md → "Main Menu")
export const TimeOfDay = Object.freeze({
  SUNRISE: 'sunrise',
  DAY: 'day',
  SUNSET: 'sunset',
  NIGHT: 'night',
})
