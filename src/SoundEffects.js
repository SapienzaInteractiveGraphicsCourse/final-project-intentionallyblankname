import * as THREE from 'three'

// Wrapper OOP sopra AudioListener e i suoni sintetizzati via Web Audio —
// stesso spirito di RobotBase/Basketball: un'unica API (sfx.playX()) invece
// di funzioni globali sparse in main.js. Nessun asset esterno (mp3/wav):
// tutto generato in codice (oscillatori + rumore bianco filtrato), coerente
// col resto del progetto (texture procedurali, niente download).

// Parametri di sintesi nominati (non inline dentro i metodi sotto), stesso
// stile SCREAMING_SNAKE_CASE delle costanti SHOOT_*/DRIBBLE_* tunabili in
// main.js — anche se qui non sono ancora esposte al pannello debug, restano
// facili da individuare/ritarare tutte insieme invece che sparse tra i
// parametri di createOscillator/createGain.

const NOISE_BUFFER_DURATION = 0.3 // secondi di rumore bianco pre-generato, riusato da playBounce/playShoot

// playScore: "campanello" a due note ascendenti
const SCORE_NOTES = [880, 1320] // La5 → Mi6, salto di quinta, "ding-ding" ascendente
const SCORE_NOTE_STAGGER = 0.1  // secondi tra l'inizio di una nota e la successiva
const SCORE_ATTACK_TIME = 0.03  // attacco lineare 0→picco, evita il "click" di uno scatto istantaneo
const SCORE_PEAK_GAIN = 0.22
const SCORE_DURATION = 0.35     // decadimento esponenziale fino a qui, poi stop

// playBounce: corpo grave ("bong") + transiente di contatto (rumore secco)
const BOUNCE_BODY_FREQ_START = 160
const BOUNCE_BODY_FREQ_END = 75
const BOUNCE_BODY_SWEEP_TIME = 0.15
const BOUNCE_BODY_ATTACK_TIME = 0.008
const BOUNCE_BODY_PEAK_GAIN = 0.22
const BOUNCE_BODY_DURATION = 0.18
const BOUNCE_CONTACT_LOWPASS_FREQ = 400 // taglia il rumore bianco per un "tonfo" invece di un fischio
const BOUNCE_CONTACT_ATTACK_TIME = 0.005
const BOUNCE_CONTACT_PEAK_GAIN = 0.12
const BOUNCE_CONTACT_DURATION = 0.04

// playSteal: rumore bianco filtrato passa-banda, centro che SCENDE (opposto
// di playShoot) — un "swipe" secco e breve, distinto dal "whoosh" del tiro
const STEAL_FILTER_Q = 0.6
const STEAL_FREQ_START = 1400
const STEAL_FREQ_END = 350
const STEAL_SWEEP_TIME = 0.12
const STEAL_ATTACK_TIME = 0.01
const STEAL_PEAK_GAIN = 0.16
const STEAL_DURATION = 0.16

// playBlock: "thwack" secco e basso — un colpo deciso, distinto sia dal
// wsh discendente di playSteal sia dal thump morbido di playBounce
const BLOCK_NOISE_LOWPASS_FREQ = 900
const BLOCK_NOISE_ATTACK_TIME = 0.004
const BLOCK_NOISE_PEAK_GAIN = 0.2
const BLOCK_NOISE_DURATION = 0.1
const BLOCK_TONE_FREQ_START = 220
const BLOCK_TONE_FREQ_END = 90
const BLOCK_TONE_SWEEP_TIME = 0.1
const BLOCK_TONE_ATTACK_TIME = 0.005
const BLOCK_TONE_PEAK_GAIN = 0.18
const BLOCK_TONE_DURATION = 0.14

// playShoot: rumore bianco filtrato passa-banda, centro che sale ("whoosh")
const SHOOT_FILTER_Q = 0.5 // basso/banda larga: un Q alto suonava troppo "nasale"/fischiante
const SHOOT_FREQ_START = 500
const SHOOT_FREQ_END = 1600
const SHOOT_SWEEP_TIME = 0.18
const SHOOT_ATTACK_TIME = 0.04
const SHOOT_PEAK_GAIN = 0.14
const SHOOT_DURATION = 0.28

export class SoundEffects {
  constructor(camera) {
    this.listener = new THREE.AudioListener()
    camera.add(this.listener)
    // rumore bianco generato una volta sola (buffer condiviso, riusato dai
    // suoni sotto per i loro transienti/whoosh — rigenerarlo ad ogni play
    // sarebbe puro spreco, il contenuto è statico)
    this.noiseBuffer = this._createNoiseBuffer(NOISE_BUFFER_DURATION)
  }

  _createNoiseBuffer(duration) {
    const ctx = this.listener.context
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  // inviluppo condiviso dai 4 gain node sotto (score, bounce body, bounce
  // contact, shoot): silenzio → attacco lineare (evita il "click" di un
  // salto istantaneo da 0 al picco) → decadimento esponenziale fino quasi a
  // zero (0.001, mai 0 esatto: exponentialRampToValueAtTime non accetta 0)
  _applyEnvelope(gainNode, startTime, peakGain, attackTime, duration) {
    gainNode.gain.setValueAtTime(0, startTime)
    gainNode.gain.linearRampToValueAtTime(peakGain, startTime + attackTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  }

  // piccolo "campanello" a due note ascendenti: due oscillatori sinusoidali
  // in sequenza, stesso spirito "generato in codice" delle texture PBR del
  // robot. Piccolo attacco lineare (evita il "click" di un salto istantaneo
  // da 0 al picco) usato anche dagli altri due suoni sotto
  playScore() {
    const ctx = this.listener.context
    SCORE_NOTES.forEach((freq, i) => {
      const startTime = ctx.currentTime + i * SCORE_NOTE_STAGGER
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = freq
      this._applyEnvelope(gain, startTime, SCORE_PEAK_GAIN, SCORE_ATTACK_TIME, SCORE_DURATION)
      oscillator.connect(gain)
      gain.connect(this.listener.getInput())
      oscillator.start(startTime)
      oscillator.stop(startTime + SCORE_DURATION)
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
    body.frequency.setValueAtTime(BOUNCE_BODY_FREQ_START, t)
    body.frequency.exponentialRampToValueAtTime(BOUNCE_BODY_FREQ_END, t + BOUNCE_BODY_SWEEP_TIME)
    this._applyEnvelope(bodyGain, t, BOUNCE_BODY_PEAK_GAIN * volumeScale, BOUNCE_BODY_ATTACK_TIME, BOUNCE_BODY_DURATION)
    body.connect(bodyGain)
    bodyGain.connect(this.listener.getInput())
    body.start(t)
    body.stop(t + BOUNCE_BODY_DURATION)

    // transiente di contatto: rumore passa-basso, brevissimo, sotto il
    // corpo grave — dà "peso" senza risultare fischiante/duro
    const contact = ctx.createBufferSource()
    contact.buffer = this.noiseBuffer
    const contactFilter = ctx.createBiquadFilter()
    contactFilter.type = 'lowpass'
    contactFilter.frequency.value = BOUNCE_CONTACT_LOWPASS_FREQ
    const contactGain = ctx.createGain()
    this._applyEnvelope(contactGain, t, BOUNCE_CONTACT_PEAK_GAIN * volumeScale, BOUNCE_CONTACT_ATTACK_TIME, BOUNCE_CONTACT_DURATION)
    contact.connect(contactFilter)
    contactFilter.connect(contactGain)
    contactGain.connect(this.listener.getInput())
    contact.start(t)
    contact.stop(t + BOUNCE_CONTACT_DURATION)
  }

  // Rumore bianco filtrato passa-banda con un centro-frequenza che scivola
  // (sweep) da un valore all'altro — playShoot ("whoosh" ascendente) e
  // playSteal ("swipe" discendente, molto più breve) erano la STESSA
  // tecnica ripetuta due volte, differivano solo nei numeri: consolidata
  // qui, un solo posto in cui aggiungere un terzo suono con questa stessa
  // forma in futuro
  _playBandpassNoiseSweep({ q, freqStart, freqEnd, sweepTime, peakGain, attackTime, duration }) {
    const ctx = this.listener.context
    const t = ctx.currentTime
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = q
    filter.frequency.setValueAtTime(freqStart, t)
    filter.frequency.exponentialRampToValueAtTime(freqEnd, t + sweepTime)
    const gain = ctx.createGain()
    this._applyEnvelope(gain, t, peakGain, attackTime, duration)
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(this.listener.getInput())
    noise.start(t)
    noise.stop(t + duration)
  }

  // "whoosh": centro-frequenza che SALE. Q basso (banda larga): un Q alto
  // suonava troppo "nasale"/fischiante invece che un soffio morbido
  playShoot() {
    this._playBandpassNoiseSweep({
      q: SHOOT_FILTER_Q, freqStart: SHOOT_FREQ_START, freqEnd: SHOOT_FREQ_END,
      sweepTime: SHOOT_SWEEP_TIME, peakGain: SHOOT_PEAK_GAIN, attackTime: SHOOT_ATTACK_TIME, duration: SHOOT_DURATION,
    })
  }

  // "swipe" secco per uno STEAL riuscito: centro-frequenza che SCENDE
  // (opposto di playShoot) e molto più breve, per non confonderlo col whoosh
  playSteal() {
    this._playBandpassNoiseSweep({
      q: STEAL_FILTER_Q, freqStart: STEAL_FREQ_START, freqEnd: STEAL_FREQ_END,
      sweepTime: STEAL_SWEEP_TIME, peakGain: STEAL_PEAK_GAIN, attackTime: STEAL_ATTACK_TIME, duration: STEAL_DURATION,
    })
  }

  // "thwack" secco e basso per un BLOCK riuscito: rumore passa-basso
  // (il colpo secco) + un tono grave discendente sotto (il "peso" della
  // deviazione) — stessa idea di playBounce (corpo+contatto) ma più
  // corto e deciso, per leggersi come un vero swat e non un rimbalzo
  playBlock() {
    const ctx = this.listener.context
    const t = ctx.currentTime
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = BLOCK_NOISE_LOWPASS_FREQ
    const noiseGain = ctx.createGain()
    this._applyEnvelope(noiseGain, t, BLOCK_NOISE_PEAK_GAIN, BLOCK_NOISE_ATTACK_TIME, BLOCK_NOISE_DURATION)
    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(this.listener.getInput())
    noise.start(t)
    noise.stop(t + BLOCK_NOISE_DURATION)

    const tone = ctx.createOscillator()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(BLOCK_TONE_FREQ_START, t)
    tone.frequency.exponentialRampToValueAtTime(BLOCK_TONE_FREQ_END, t + BLOCK_TONE_SWEEP_TIME)
    const toneGain = ctx.createGain()
    this._applyEnvelope(toneGain, t, BLOCK_TONE_PEAK_GAIN, BLOCK_TONE_ATTACK_TIME, BLOCK_TONE_DURATION)
    tone.connect(toneGain)
    toneGain.connect(this.listener.getInput())
    tone.start(t)
    tone.stop(t + BLOCK_TONE_DURATION)
  }

  setMasterVolume(value) {
    this.listener.setMasterVolume(value)
  }
}
