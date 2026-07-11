import * as THREE from 'three'

// OOP wrapper over AudioListener + synthesized Web Audio sounds (sfx.playX()),
// generated in code (oscillators + filtered white noise).

const NOISE_BUFFER_DURATION = 0.3 // seconds of pre-generated white noise, reused by playBounce/playShoot

// playScore: two-note ascending "bell"
const SCORE_NOTES = [880, 1320] // A5 → E6, a fifth apart, ascending "ding-ding"
const SCORE_NOTE_STAGGER = 0.1  // seconds between one note's start and the next
const SCORE_ATTACK_TIME = 0.03  // linear attack 0→peak, avoids the "click" of an instant jump
const SCORE_PEAK_GAIN = 0.22
const SCORE_DURATION = 0.35     // exponential decay down to here, then stop

// playBounce: low "bong" body + sharp contact transient
const BOUNCE_BODY_FREQ_START = 160
const BOUNCE_BODY_FREQ_END = 75
const BOUNCE_BODY_SWEEP_TIME = 0.15
const BOUNCE_BODY_ATTACK_TIME = 0.008
const BOUNCE_BODY_PEAK_GAIN = 0.22
const BOUNCE_BODY_DURATION = 0.18
const BOUNCE_CONTACT_LOWPASS_FREQ = 400 // filters the white noise into a "thud" instead of a hiss
const BOUNCE_CONTACT_ATTACK_TIME = 0.005
const BOUNCE_CONTACT_PEAK_GAIN = 0.12
const BOUNCE_CONTACT_DURATION = 0.04

// playSteal: bandpass-filtered white noise, center frequency DROPS (opposite
// of playShoot) — a short, sharp "swipe", distinct from the shot's "whoosh"
const STEAL_FILTER_Q = 0.6
const STEAL_FREQ_START = 1400
const STEAL_FREQ_END = 350
const STEAL_SWEEP_TIME = 0.12
const STEAL_ATTACK_TIME = 0.01
const STEAL_PEAK_GAIN = 0.16
const STEAL_DURATION = 0.16

// playBlock: sharp, low "thwack" — a decisive hit, distinct from both
// playSteal's descending swipe and playBounce's soft thump
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

// playShoot: bandpass-filtered white noise, center frequency rises ("whoosh")
const SHOOT_FILTER_Q = 0.5 // low/wide band: a high Q sounded too "nasal"/whistly
const SHOOT_FREQ_START = 500
const SHOOT_FREQ_END = 1600
const SHOOT_SWEEP_TIME = 0.18
const SHOOT_ATTACK_TIME = 0.04
const SHOOT_PEAK_GAIN = 0.14
const SHOOT_DURATION = 0.28

export class SoundEffects 
{
  constructor(camera) 
  {
    this.listener = new THREE.AudioListener()
    camera.add(this.listener) //Lock onto the camera (an obj is required i guess???)
    this.noiseBuffer = this._createNoiseBuffer(NOISE_BUFFER_DURATION)    // white noise generated once (shared buffer) used after
  }

  _createNoiseBuffer(duration) 
  {
    const ctx = this.listener.context                                               // Web Audio API context, shared by all THREE.Audio objects
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)   // 1 channel, length = sampleRate * duration, sampleRate = ctx.sampleRate
    const data = buffer.getChannelData(0)                                           // get the buffer's data array (Float32Array) for channel 0
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1           // fill with random values in [-1, 1] (white noise)
    return buffer
  }

  // Apply a simple linear attack + exponential decay envelope to a GainNode
  _applyEnvelope(gainNode, startTime, peakGain, attackTime, duration) 
  {
    gainNode.gain.setValueAtTime(0, startTime)
    gainNode.gain.linearRampToValueAtTime(peakGain, startTime + attackTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  }

  // Two-note ascending "bell" for scoring (A5 → E6, a fifth apart)
  playScore() {
    const ctx = this.listener.context
    for (let i = 0; i < SCORE_NOTES.length; i++) 
    {
      const freq = SCORE_NOTES[i]
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
    }
  }

 // Low "bong" body + sharp contact transient for a ball bounce (or similar)
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

    // contact transient: lowpass noise, very short, under the low body —
    // adds "weight" without sounding whistly/harsh
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

  // Bandpass-filtered white noise sweep, used for playShoot and playSteal
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

  // "whoosh": center frequency RISES. Low Q (wide band): a high Q sounded
  // too "nasal"/whistly instead of a soft breath
  playShoot() {
    this._playBandpassNoiseSweep({
      q: SHOOT_FILTER_Q, freqStart: SHOOT_FREQ_START, freqEnd: SHOOT_FREQ_END,
      sweepTime: SHOOT_SWEEP_TIME, peakGain: SHOOT_PEAK_GAIN, attackTime: SHOOT_ATTACK_TIME, duration: SHOOT_DURATION,
    })
  }

  // sharp "swipe" for a successful STEAL: center frequency DROPS (opposite
  // of playShoot) and much shorter, so it's not confused with the whoosh
  playSteal() {
    this._playBandpassNoiseSweep({
      q: STEAL_FILTER_Q, freqStart: STEAL_FREQ_START, freqEnd: STEAL_FREQ_END,
      sweepTime: STEAL_SWEEP_TIME, peakGain: STEAL_PEAK_GAIN, attackTime: STEAL_ATTACK_TIME, duration: STEAL_DURATION,
    })
  }

  // Sharp
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
