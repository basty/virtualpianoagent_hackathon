/**
 * soundEngine.js — Piano Sound Engine
 *
 * Uses Tone.js Sampler with pre-recorded Salamander piano samples
 * (hosted publicly on GitHub via tonejs/audio).
 *
 * Falls back to a simple oscillator synth if the network is unavailable.
 */

const SAMPLE_BASE_URL =
  'https://tonejs.github.io/audio/salamander/';

const SAMPLE_MAP = {
  A0:    'A0.mp3',  C1:  'C1.mp3',  'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
  A1:    'A1.mp3',  C2:  'C2.mp3',  'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
  A2:    'A2.mp3',  C3:  'C3.mp3',  'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
  A3:    'A3.mp3',  C4:  'C4.mp3',  'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
  A4:    'A4.mp3',  C5:  'C5.mp3',  'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
  A5:    'A5.mp3',  C6:  'C6.mp3',  'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
  A6:    'A6.mp3',  C7:  'C7.mp3',  'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
  A7:    'A7.mp3',  C8:  'C8.mp3',
};

export class SoundEngine {
  constructor() {
    this._sampler = null;
    this._synth   = null;
    this._ready   = false;
    this._volume  = 0.8;
  }

  /** Initialise Tone.js. Returns a promise that resolves when samples load. */
  async init() {
    // Map sample URLs
    const urls = {};
    for (const [note, file] of Object.entries(SAMPLE_MAP)) {
      urls[note] = SAMPLE_BASE_URL + file;
    }

    return new Promise((resolve) => {
      this._sampler = new Tone.Sampler({
        urls,
        release: 1,
        onload: () => {
          this._ready = true;
          console.info('[SoundEngine] Sampler loaded ✓');
          resolve();
        },
      }).toDestination();

      this._sampler.volume.value = Tone.gainToDb(this._volume);

      // If samples take too long, fall back to synth after 6 s
      setTimeout(() => {
        if (!this._ready) {
          console.warn('[SoundEngine] Sampler timeout — using synth fallback');
          this._buildFallbackSynth();
          resolve();
        }
      }, 6000);
    });
  }

  /**
   * Play a note immediately.
   * @param {string} note — e.g. 'C4', 'F#4'
   * @param {number} [velocity] — 0–1
   * @param {string} [duration] — Tone.js duration string, default '8n'
   */
  play(note, velocity = 0.8, duration = '8n') {
    // Tone.js context must be resumed after user gesture
    if (Tone.context.state !== 'running') {
      Tone.start();
    }

    const engine = this._ready && this._sampler ? this._sampler : this._synth;
    if (!engine) return;

    try {
      engine.triggerAttackRelease(note, duration, Tone.now(), velocity);
    } catch (err) {
      console.warn('[SoundEngine] play error:', err.message);
    }
  }

  noteOn(note, velocity = 0.8) {
    if (Tone.context.state !== 'running') {
      Tone.start();
    }
    const engine = this._ready && this._sampler ? this._sampler : this._synth;
    if (!engine) return;
    try {
      if (engine instanceof Tone.PolySynth) {
         engine.triggerAttack(note, Tone.now(), velocity);
      } else {
         engine.triggerAttack(note, Tone.now(), velocity);
      }
    } catch (err) {
      console.warn('[SoundEngine] noteOn error:', err.message);
    }
  }

  noteOff(note) {
    const engine = this._ready && this._sampler ? this._sampler : this._synth;
    if (!engine) return;
    try {
      engine.triggerRelease(note, Tone.now());
    } catch (err) {
      console.warn('[SoundEngine] noteOff error:', err.message);
    }
  }

  /** Stop all currently playing notes. */
  stopAll() {
    this._sampler?.releaseAll?.();
    if (this._synth) {
       this._synth.releaseAll();
    }
  }

  /** Set master volume (0–1). */
  setVolume(v) {
    this._volume = v;
    if (this._sampler) {
      this._sampler.volume.value = Tone.gainToDb(v);
    }
    if (this._synth) {
      this._synth.volume.value = Tone.gainToDb(v);
    }
  }

  // ── Private ────────────────────────────────────────────

  _buildFallbackSynth() {
    this._synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope:   { attack: 0.02, decay: 0.3, sustain: 0.4, release: 1.2 },
    }).toDestination();
    this._synth.volume.value = Tone.gainToDb(this._volume);
    this._ready = true;
  }
}
