// True constants (never reassigned) imported directly from multiple files

export const BALL_GRAVITY = 820       // unità/s² (scena ≈ cm-scale), non più il valore g reale
export const BALL_BOUNCE_SPEED = 415  // velocità impressa ad ogni rimbalzo (palleggio automatico)

// Normal orbitPitch range outside HANDLING.
export const ORBIT_PITCH_MIN = 0.05
export const ORBIT_PITCH_MAX = 0.9 // avvicinato a ORBIT_PITCH_MAX_HANDLING (meno differenza tra i due stati, transizione meno marcata)
