// Shared enums — frozen objects simulating enum types (JS has no native enum).
// Merged from separate GameMode.js/Team.js/TimeOfDay.js/RobotKeys.js: same
// one-line pattern repeated 4 times, no reason to keep them in 4 files.

export const GameMode = Object.freeze({
  PRACTICE: 'practice',
  ONE_V_ONE: '1v1',
})

export const Team = Object.freeze({
  A: 'A', // player
  B: 'B', // enemy/enemies
})

export const TimeOfDay = Object.freeze({
  SUNRISE: 'sunrise',
  DAY: 'day',
  SUNSET: 'sunset',
  NIGHT: 'night',
})

export const ROBOT_KEYS = Object.freeze({ MANIPULATOR: 'manipulator', LEGGED: 'legged', DRONE: 'drone' })
