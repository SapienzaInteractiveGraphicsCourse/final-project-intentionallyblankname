// Helper puri di costruzione DOM per il pannello debug (tasto P) — nessuno
// stato di gioco toccato, solo elementi HTML e i loro event listener.
// Secondo pezzo del refactor modulare a rischio zero (dopo mathUtils.js).

// Uno slider (label + input numerico + input range) è l'unità riusata sia
// dallo slider "Manipulator Scale" in cima al pannello sia da ogni sezione
// di "Manipulator Config" sotto — stessa funzione per entrambi invece di
// due implementazioni parallele.
//
// Il campo numerico (non solo lo span di sola lettura di prima) è lì per un
// motivo concreto: uno slider granulare — range/step piccolo su un range
// ampio — dà pochissima risoluzione per pixel trascinato, tarare un valore
// come "Bounce Speed Scale" fino quasi a 0 con un solo trascinamento era
// impreciso. Il numero si digita diretto, bypassando lo step/lo scatto per
// tacche dello slider (che resta comunque comodo per esplorare a occhio in
// fretta) — i due restano sincronizzati in entrambe le direzioni, e digitare
// un valore FUORI da min/max dello slider resta valido (viene comunque
// passato a onChange così com'è: solo la posizione VISIVA della barra si
// clampa ai suoi estremi, un limite del solo elemento <input type="range">,
// non del valore vero applicato)
export function createSliderControl(container, { name, min, max, step, value, onChange }) {
  const lbl = document.createElement('label')
  lbl.append(`${name}: `)

  // NIENTE min/max sul campo numerico (solo sullo slider, che resta il
  // range "consigliato" per trascinare a occhio): un <input type="number">
  // con min/max applica comunque la propria validazione nativa (:invalid,
  // frecce su/giù bloccate a quell'estremo) — libero da vincoli, si può
  // digitare qualunque valore, anche ben oltre il range dello slider
  const numberInput = document.createElement('input')
  Object.assign(numberInput, { type: 'number', step, value })
  numberInput.className = 'debug-number-input'

  const rangeInput = document.createElement('input')
  Object.assign(rangeInput, { type: 'range', min, max, step, value })

  rangeInput.addEventListener('input', () => {
    const v = parseFloat(rangeInput.value)
    numberInput.value = v
    onChange(v)
  })
  numberInput.addEventListener('input', () => {
    const v = parseFloat(numberInput.value)
    if (Number.isNaN(v)) return
    rangeInput.value = v // si autoclampa alla barra se v è fuori min/max, solo visivo
    onChange(v)
  })

  container.append(lbl, numberInput, rangeInput)
  return rangeInput
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
