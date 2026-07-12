// Pure DOM builders for the debug panel (key P). No game state touched.

// One slider row = label + number input + range input, reused by every
// panel section. The number input exists because a granular slider gives
// too little per-pixel resolution for fine tuning; typing bypasses the
// slider step entirely. The two stay synced both ways, and a typed value
// OUTSIDE the slider's min/max is still passed to onChange as-is (only
// the visual bar position clamps)
export function createSliderControl(container, { name, min, max, step, value, onChange }) {
  const lbl = document.createElement('label')
  lbl.append(`${name}: `)

  // No min/max on the number input: native validation would block the
  // arrows at the slider's range, which is only a suggestion
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
    rangeInput.value = v // bar self-clamps if out of range, visual only
    onChange(v)
  })

  container.append(lbl, numberInput, rangeInput)
  return rangeInput
}

// Collapsible section: button that toggles a panel
export function createToggleSection(container, label) {
  const btn = document.createElement('button')
  btn.textContent = `${label} ▸`
  const panel = document.createElement('div')
  panel.className = 'component-panel hidden'
  btn.addEventListener('click', () => panel.classList.toggle('hidden'))
  container.append(btn, panel)
  return panel
}

// Section with a toggle button and its sliders inside (Wheels, Disc, ...)
export function addComponentSection(container, label, sliders) {
  const panel = createToggleSection(container, label)
  sliders.forEach(sliderConfig => createSliderControl(panel, sliderConfig))
}
