/**
 * mlTrainer.js — Shared In-Browser ML Training Pipeline
 *
 * Provides training and inference support for:
 *   - Method 9: Static MLP binary classifier (22 → 32 → 16 → 1)
 *   - Method 10: LSTM temporal classifier ([10, 12] → LSTM(32) → 16 → 1)
 *
 * Usage:
 *   const trainer = new MLTrainer();
 *   await trainer.init();
 *   trainer.collectSample(featureVec, label);   // 1 = press, 0 = no-press
 *   await trainer.trainMLP();                   // trains + saves Method 9 model
 *   await trainer.trainLSTM();                  // trains + saves Method 10 model
 *   const prob = trainer.predictMLP(featureVec);
 *   const prob = trainer.predictLSTM(sequenceArr);
 */

const MLP_STORAGE_KEY  = 'piancoach_mlp_model_v1';
const LSTM_STORAGE_KEY = 'piancoach_lstm_model_v1';
const SEQUENCE_LEN     = 10; // frames per LSTM window

export class MLTrainer {
  constructor() {
    this._mlpModel  = null;
    this._lstmModel = null;
    this._samples   = [];   // { features: Float32Array, label: 0|1 }
    this._sequences = [];   // { seq: Float32Array[10][12], label: 0|1 }

    this.isMlpReady  = false;
    this.isLstmReady = false;

    /** Called with (type, message) during training for UI feedback */
    this.onProgress = null;
  }

  /**
   * Load TF.js models from localStorage (IndexedDB) if previously trained.
   * Call this once on startup.
   */
  async init() {
    if (typeof tf === 'undefined') {
      console.warn('[MLTrainer] TensorFlow.js not loaded — ML methods unavailable.');
      return;
    }
    try {
      this._mlpModel = await tf.loadLayersModel(`localstorage://${MLP_STORAGE_KEY}`);
      this.isMlpReady = true;
      console.info('[MLTrainer] MLP model loaded from storage ✓');
    } catch (_) { /* no saved model yet */ }

    try {
      this._lstmModel = await tf.loadLayersModel(`localstorage://${LSTM_STORAGE_KEY}`);
      this.isLstmReady = true;
      console.info('[MLTrainer] LSTM model loaded from storage ✓');
    } catch (_) { /* no saved model yet */ }
  }

  // ── Data collection ────────────────────────────────────────────────────────

  /**
   * Record a single training sample.
   * @param {number[]} features  - feature vector (~22 numbers)
   * @param {0|1}      label     - 1=press, 0=no-press
   */
  collectSample(features, label) {
    this._samples.push({ features: new Float32Array(features), label });
  }

  /**
   * Record a training sequence for the LSTM.
   * @param {number[][]} seq   - array of SEQUENCE_LEN feature vectors (each 12 numbers)
   * @param {0|1}        label
   */
  collectSequence(seq, label) {
    if (seq.length !== SEQUENCE_LEN) return;
    this._sequences.push({
      seq: seq.map(f => new Float32Array(f)),
      label,
    });
  }

  clearSamples() {
    this._samples   = [];
    this._sequences = [];
  }

  get sampleCount() { return this._samples.length; }
  get sequenceCount() { return this._sequences.length; }

  // ── MLP Training ───────────────────────────────────────────────────────────

  async trainMLP() {
    if (typeof tf === 'undefined') throw new Error('TF.js not loaded');
    if (this._samples.length < 10) throw new Error('Need at least 10 samples to train');

    this._emit('mlp', `Training MLP on ${this._samples.length} samples…`);

    const posCount = this._samples.filter(s => s.label === 1).length;
    const negCount = this._samples.filter(s => s.label === 0).length;

    // Balance dataset by oversampling minority class
    const balanced = this._balance(this._samples);

    const featureDim = balanced[0].features.length;
    const xs = tf.tensor2d(balanced.map(s => Array.from(s.features)));
    const ys = tf.tensor1d(balanced.map(s => s.label), 'float32');

    // Build model: featureDim → 32 → 16 → 1 (sigmoid)
    if (this._mlpModel) { this._mlpModel.dispose(); this._mlpModel = null; }

    const model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [featureDim], units: 32, activation: 'relu',
          kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }) }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 16, activation: 'relu' }),
        tf.layers.dense({ units: 1, activation: 'sigmoid' }),
      ],
    });

    model.compile({
      optimizer: tf.train.adam(0.003),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy'],
    });

    await model.fit(xs, ys, {
      epochs: 60,
      batchSize: 16,
      validationSplit: 0.15,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 15 === 0) {
            this._emit('mlp', `Epoch ${epoch}/60 — loss: ${logs.loss.toFixed(3)}, acc: ${(logs.acc ?? logs.accuracy ?? 0).toFixed(2)}`);
          }
        },
      },
    });

    xs.dispose();
    ys.dispose();

    await model.save(`localstorage://${MLP_STORAGE_KEY}`);
    this._mlpModel  = model;
    this.isMlpReady = true;
    this._emit('mlp', `✅ MLP ready! (${posCount} press / ${negCount} hover samples)`);
    return model;
  }

  // ── LSTM Training ──────────────────────────────────────────────────────────

  async trainLSTM() {
    if (typeof tf === 'undefined') throw new Error('TF.js not loaded');
    if (this._sequences.length < 10) throw new Error('Need at least 10 sequences to train');

    this._emit('lstm', `Training LSTM on ${this._sequences.length} sequences…`);

    const balanced = this._balance(this._sequences.map(s => ({
      features: s.seq.map(f => Array.from(f)).flat(),
      label: s.label,
      seq: s.seq,
    })));

    // Rebuild sequences from balanced data
    const seqData = balanced.map(s => s.seq ?? null).filter(Boolean);
    const labels  = balanced.map(s => s.label);

    if (seqData.length === 0) throw new Error('No valid sequences after balancing');

    const featDim = seqData[0][0].length;
    // xs: [N, SEQUENCE_LEN, featDim]
    const xs = tf.tensor3d(
      seqData.map(seq => seq.map(f => Array.from(f)))
    );
    const ys = tf.tensor1d(labels, 'float32');

    if (this._lstmModel) { this._lstmModel.dispose(); this._lstmModel = null; }

    const model = tf.sequential({
      layers: [
        tf.layers.lstm({ inputShape: [SEQUENCE_LEN, featDim], units: 32, returnSequences: false }),
        tf.layers.dense({ units: 16, activation: 'relu' }),
        tf.layers.dense({ units: 1, activation: 'sigmoid' }),
      ],
    });

    model.compile({
      optimizer: tf.train.adam(0.002),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy'],
    });

    await model.fit(xs, ys, {
      epochs: 50,
      batchSize: 8,
      validationSplit: 0.15,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 10 === 0) {
            this._emit('lstm', `Epoch ${epoch}/50 — loss: ${logs.loss.toFixed(3)}`);
          }
        },
      },
    });

    xs.dispose();
    ys.dispose();

    await model.save(`localstorage://${LSTM_STORAGE_KEY}`);
    this._lstmModel  = model;
    this.isLstmReady = true;
    this._emit('lstm', `✅ LSTM ready! (${seqData.length} sequences)`);
    return model;
  }

  // ── Inference ──────────────────────────────────────────────────────────────

  /**
   * Run MLP inference on a single feature vector.
   * @returns {number} probability 0–1 (press likelihood)
   */
  predictMLP(features) {
    if (!this._mlpModel || !this.isMlpReady) return 0;
    return tf.tidy(() => {
      const input = tf.tensor2d([features]);
      const prob  = this._mlpModel.predict(input);
      return prob.dataSync()[0];
    });
  }

  /**
   * Run LSTM inference on a [SEQUENCE_LEN, featDim] sequence.
   * @param {number[][]} seq
   * @returns {number} probability 0–1
   */
  predictLSTM(seq) {
    if (!this._lstmModel || !this.isLstmReady) return 0;
    if (seq.length !== SEQUENCE_LEN) return 0;
    return tf.tidy(() => {
      const input = tf.tensor3d([seq]);
      const prob  = this._lstmModel.predict(input);
      return prob.dataSync()[0];
    });
  }

  async clearStoredModels() {
    try { await tf.io.removeModel(`localstorage://${MLP_STORAGE_KEY}`); } catch (_) {}
    try { await tf.io.removeModel(`localstorage://${LSTM_STORAGE_KEY}`); } catch (_) {}
    this._mlpModel  = null;
    this._lstmModel = null;
    this.isMlpReady  = false;
    this.isLstmReady = false;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _emit(type, msg) {
    console.info(`[MLTrainer/${type}] ${msg}`);
    this.onProgress?.(type, msg);
  }

  /** Oversample minority class to balance dataset */
  _balance(samples) {
    const pos = samples.filter(s => s.label === 1);
    const neg = samples.filter(s => s.label === 0);
    if (pos.length === 0 || neg.length === 0) return samples;
    const target = Math.max(pos.length, neg.length);
    const oversample = (arr) => {
      const result = [...arr];
      while (result.length < target) result.push(arr[Math.floor(Math.random() * arr.length)]);
      return result;
    };
    return [...oversample(pos), ...oversample(neg)].sort(() => Math.random() - 0.5);
  }
}

export { SEQUENCE_LEN };
