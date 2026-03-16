/**
 * state.js — Application State
 *
 * Centralised reactive state for the piano session.
 * Calls `onChange(state)` whenever state mutates.
 */

export class AppState {
  constructor() {
    this._state = {
      notesPlayed:     0,
      notesHistory:    [],   // last 20 note names
      exercisesDone:   0,
      currentStreak:   0,
      accuracy:        null, // null until first exercise completes
      activeExercise:  null,
      exerciseNotes:   [],   // expected notes
      playedBuffer:    [],   // notes played in current exercise
      currentNoteIndex: 0,    // index of the next note to be played
    };

    /** Called whenever state changes. Set by main.js. */
    this.onChange = null;
  }

  /**
   * Record a played note.
   * @param {string} note
   */
  recordNote(note) {
    const s = this._state;
    s.notesPlayed++;
    s.notesHistory = [...s.notesHistory.slice(-19), note];
    let correct = null;
    
    if (s.activeExercise) {
      const expected = s.exerciseNotes[s.currentNoteIndex];
      correct = (note === expected);
      if (correct) {
        s.currentNoteIndex++;
      }
      s.playedBuffer.push(note);
      this._checkExerciseCompletion();
    }
    
    this._emit();
    return { note, correct };
  }

  /**
   * Set the active exercise.
   * @param {{ name: string, notes: string[], description?: string }} exercise
   */
  setExercise(exercise) {
    const s = this._state;
    s.activeExercise  = exercise;
    s.exerciseNotes   = exercise.notes;
    s.playedBuffer    = [];
    s.currentNoteIndex = 0;
    this._emit();
  }

  clearExercise() {
    const s         = this._state;
    s.activeExercise = null;
    s.exerciseNotes  = [];
    s.playedBuffer   = [];
    s.currentNoteIndex = 0;
    this._emit();
  }

  get snapshot() {
    return { ...this._state };
  }

  // ── Private ────────────────────────────────────────────

  _checkExerciseCompletion() {
    const s = this._state;
    if (!s.activeExercise) return;

    const played   = s.playedBuffer;
    const expected = s.exerciseNotes;

    if (played.length < expected.length) return;

    // Calculate accuracy for the last N notes
    const relevant = played.slice(-expected.length);
    const correct  = relevant.filter((n, i) => n === expected[i]).length;
    s.accuracy      = Math.round((correct / expected.length) * 100);
    s.exercisesDone++;
    s.currentStreak = correct === expected.length ? s.currentStreak + 1 : 0;
    s.playedBuffer  = [];
    this._emit();
  }

  _emit() {
    this.onChange?.(this._state);
  }
}
