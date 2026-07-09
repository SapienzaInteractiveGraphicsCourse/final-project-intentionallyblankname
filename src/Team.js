// "Enum" congelato, stesso pattern di RobotState/BallState/GameMode —
// assegnato ad ogni robot alla creazione (property, non una sottoclasse
// diversa: appartenere a una squadra non cambia comportamento/geometria).
// Esiste come concetto a parte rispetto a "chi tiene la palla in questo
// istante" (Basketball.owner) anche se in 1v1 (unica modalità con nemici)
// è sempre un solo robot per squadra
export const Team = Object.freeze({
  A: 'A', // giocatore
  B: 'B', // nemico/i
})
