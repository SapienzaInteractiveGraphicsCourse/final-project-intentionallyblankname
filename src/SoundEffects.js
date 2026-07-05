import * as THREE from 'three'

// Wrapper OOP sopra AudioListener e i suoni sintetizzati via Web Audio —
// stesso spirito di RobotBase/Basketball: un'unica API (sfx.playX()) invece
// di funzioni globali sparse in main.js. Nessun asset esterno (mp3/wav):
// tutto generato in codice (oscillatori + rumore bianco filtrato), coerente
// col resto del progetto (texture procedurali, niente download).
export class SoundEffects {
  constructor(camera) {
    this.listener = new THREE.AudioListener()
    camera.add(this.listener)
    // rumore bianco generato una volta sola (buffer condiviso, riusato dai
    // suoni sotto per i loro transienti/whoosh — rigenerarlo ad ogni play
    // sarebbe puro spreco, il contenuto è statico)
    this.noiseBuffer = this._createNoiseBuffer(0.3)
  }

  _createNoiseBuffer(duration) {
    const ctx = this.listener.context
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  // piccolo "campanello" a due note ascendenti: due oscillatori sinusoidali
  // in sequenza, stesso spirito "generato in codice" delle texture PBR del
  // robot. Piccolo attacco lineare (evita il "click" di un salto istantaneo
  // da 0 al picco) usato anche dagli altri due suoni sotto
  playScore() {
    const ctx = this.listener.context
    const notes = [880, 1320] // La5 → Mi6, salto di quinta, "ding-ding" ascendente
    notes.forEach((freq, i) => {
      const startTime = ctx.currentTime + i * 0.1
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = freq
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(0.22, startTime + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35)
      oscillator.connect(gain)
      gain.connect(this.listener.getInput())
      oscillator.start(startTime)
      oscillator.stop(startTime + 0.35)
    })
  }

  // "thump" sordo — ogni rimbalzo (palleggio automatico E collisioni del
  // volo di tiro con backboard/ferro/muri/pali/panchine/pavimento). Un vero
  // rimbalzo ha sia un corpo grave (il "bong" della palla) sia un breve
  // transiente di contatto (il rumore secco dell'urto) — un sine puro da
  // solo suonava troppo "elettronico", pulito ma innaturale.
  // volumeScale: il palleggio automatico non si ferma MAI, quindi rimbalza
  // in loop continuo — lo stesso thump a piena intensità ad ogni ciclo
  // diventava fastidioso in fretta. Le collisioni vere del tiro (più rare,
  // più significative) restano a piena intensità (default 1)
  playBounce(volumeScale = 1) {
    const ctx = this.listener.context
    const t = ctx.currentTime
    const body = ctx.createOscillator()
    const bodyGain = ctx.createGain()
    body.type = 'sine'
    body.frequency.setValueAtTime(160, t)
    body.frequency.exponentialRampToValueAtTime(75, t + 0.15)
    bodyGain.gain.setValueAtTime(0, t)
    bodyGain.gain.linearRampToValueAtTime(0.22 * volumeScale, t + 0.008)
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    body.connect(bodyGain)
    bodyGain.connect(this.listener.getInput())
    body.start(t)
    body.stop(t + 0.18)

    // transiente di contatto: rumore passa-basso, brevissimo, sotto il
    // corpo grave — dà "peso" senza risultare fischiante/duro
    const contact = ctx.createBufferSource()
    contact.buffer = this.noiseBuffer
    const contactFilter = ctx.createBiquadFilter()
    contactFilter.type = 'lowpass'
    contactFilter.frequency.value = 400
    const contactGain = ctx.createGain()
    contactGain.gain.setValueAtTime(0, t)
    contactGain.gain.linearRampToValueAtTime(0.12 * volumeScale, t + 0.005)
    contactGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
    contact.connect(contactFilter)
    contactFilter.connect(contactGain)
    contactGain.connect(this.listener.getInput())
    contact.start(t)
    contact.stop(t + 0.04)
  }

  // rumore bianco filtrato (bandpass, centro che sale) invece di un
  // oscillatore puro — un "whoosh" ha bisogno di uno spettro largo, non una
  // singola frequenza. Q basso (banda larga): un Q alto suonava troppo
  // "nasale"/fischiante invece che un soffio morbido
  playShoot() {
    const ctx = this.listener.context
    const t = ctx.currentTime
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.5
    filter.frequency.setValueAtTime(500, t)
    filter.frequency.exponentialRampToValueAtTime(1600, t + 0.18)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.14, t + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28)
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(this.listener.getInput())
    noise.start(t)
    noise.stop(t + 0.28)
  }

  setMasterVolume(value) {
    this.listener.setMasterVolume(value)
  }
}
