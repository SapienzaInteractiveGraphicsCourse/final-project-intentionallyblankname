// Helper puri di costruzione DOM per il pannello debug (tasto P) — nessuno
// stato di gioco toccato, solo elementi HTML e i loro event listener.
// Secondo pezzo del refactor modulare a rischio zero (dopo mathUtils.js).

// Uno slider (label + valore + input range) è l'unità riusata sia dallo
// slider "Manipulator Scale" in cima al pannello sia da ogni sezione di
// "Manipulator Config" sotto — stessa funzione per entrambi invece di due
// implementazioni parallele.
export function createSliderControl(container, { name, min, max, step, value, onChange }) {
  const lbl = document.createElement('label')
  const valSpan = document.createElement('span')
  valSpan.textContent = value
  lbl.append(`${name}: `, valSpan)

  const input = document.createElement('input')
  Object.assign(input, { type: 'range', min, max, step, value })
  input.addEventListener('input', () => {
    const v = parseFloat(input.value)
    valSpan.textContent = v
    onChange(v)
  })

  container.append(lbl, input)
  return input
}

// Bottone che apre/chiude un pannello: unità base di tutte le sezioni
// collassabili del menu debug (contenitori annidabili e gruppi di slider
// sono la stessa cosa, cambia solo cosa ci va dentro).
export function createToggleSection(container, label) {
  const btn = document.createElement('button')
  btn.textContent = `${label} ▸`
  const panel = document.createElement('div')
  panel.className = 'component-panel hidden'
  btn.addEventListener('click', () => panel.classList.toggle('hidden'))
  container.append(btn, panel)
  return panel
}

// Sezione con un bottone + i suoi slider dentro (es. Wheels, Disc, Dribble).
export function addComponentSection(container, label, sliders) {
  const panel = createToggleSection(container, label)
  sliders.forEach(sliderConfig => createSliderControl(panel, sliderConfig))
}
