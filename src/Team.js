// "Enum" congelato, stesso pattern di RobotState/BallState/GameMode —
// assegnato ad ogni robot alla creazione (property, non una sottoclasse
// diversa: appartenere a una squadra non cambia comportamento/geometria).
// In 1v1 un solo robot per squadra; in 3v3 (Section 4) più robot condividono
// lo stesso Team — è per questo che esiste già come concetto a parte
// rispetto a "chi tiene la palla in questo istante" (Basketball.owner)
export const Team = Object.freeze({
  A: 'A', // giocatore
  B: 'B', // nemico/i
})
