// Costanti fisiche/di camera VERE (mai riassegnate) condivise tra main.js e
// i moduli estratti (BallPossession.js/ShootingSystem.js/debugPanel.js) —
// importabili direttamente invece di essere ripassate ad ogni context
// object, a differenza dei valori tunabili da debug panel (dribbleTuning/
// handlingTuning/shootTuning, oggetti mutabili) o dei `let` ancora condivisi
// con molto altro codice in main.js (BALL_RADIUS, CROSSHAIR_HEIGHT — quelli
// restano lì, letti via funzione accessor nel context, es. getBallRadius).
export const BALL_GRAVITY = 820       // unità/s² (scena ≈ cm-scale), non più il valore g reale
export const BALL_BOUNCE_SPEED = 415  // velocità impressa ad ogni rimbalzo (palleggio automatico)

// range normale di orbitPitch fuori da HANDLING (il clamp esteso valido
// solo in HANDLING, ORBIT_PITCH_MIN_HANDLING/MAX_HANDLING, resta locale a
// main.js — è specifico della camera in Play mode, non condiviso)
export const ORBIT_PITCH_MIN = 0.05
export const ORBIT_PITCH_MAX = 0.9 // avvicinato a ORBIT_PITCH_MAX_HANDLING (meno differenza tra i due stati, transizione meno marcata)
