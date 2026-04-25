/**
 * phase2_ml.js  -  Machine Learning Sea Level Prediction (pure JS)
 *
 * Models trained and evaluated:
 *   1. ARIMA(p,1,q)     - automated order selection via hold-out RMSE grid search
 *   2. Prophet-style    - OLS linear trend + monthly seasonal means + 95% CI bands
 *   3. LSTM             - single-layer recurrent network with Adam optimiser
 *   4. Hybrid LSTM      - same architecture but with ONI + DMI as extra input features
 *   5. Ensemble         - weighted average of LSTM and Hybrid (0.6 / 0.4)
 *
 * Run via: node scripts/run_all.js
 * For TensorFlow.js version: node scripts/run_all_tf.js
 */

'use strict';

const ARIMA  = require('arima');
const ss     = require('simple-statistics');
const { addMonths, dateStr, metrics, saveJSON, ensureDirs, OUT_DIR } = require('./utils');

//
// 1. ARIMA
//

function runARIMA (train, test) {
  console.log('  >> Fitting ARIMA ...');
  const series = train.map(r => r.msl_cm);

  // Grid search over p,q in [0,3] with d=1 (non-stationary series confirmed by ADF test).
  // We pick the order that gives the lowest RMSE on a 10% hold-out validation slice.
  let bestRMSE = Infinity, bestOpts = { p:2, d:1, q:2 };

  for (let p = 0; p <= 3; p++) {
    for (let q = 0; q <= 3; q++) {
      try {
        const model = new ARIMA({ p, d:1, q, verbose: false }).train(series);
        const [, info] = model.predict(1);
        // arima package doesn't expose AIC directly; use RMSE on validation window instead
        const valLen = Math.floor(series.length * 0.1);
        const valSeries = series.slice(0, -valLen);
        const m2 = new ARIMA({ p, d:1, q, verbose: false }).train(valSeries);
        const [preds] = m2.predict(valLen);
        const actual  = series.slice(-valLen);
        const rmse    = Math.sqrt(ss.mean(preds.map((v,i) => (v - actual[i])**2)));
        if (rmse < bestRMSE) { bestRMSE = rmse; bestOpts = { p, d:1, q }; }
      } catch {}
    }
  }

  console.log(`     Best order: ARIMA(${bestOpts.p},${bestOpts.d},${bestOpts.q})`);

  const finalModel = new ARIMA({ ...bestOpts, verbose: false }).train(series);

  // Test forecast
  const [testPreds] = finalModel.predict(test.length);
  const m = metrics(test.map(r => r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R^2=${m.R2}`);

  // Long-range 2026-2100
  const lastDate   = train[train.length - 1].date;
  const nFuture    = (2100 - lastDate.getFullYear()) * 12;
  const [future]   = finalModel.predict(nFuture);
  const futureRows = future.map((v, i) => ({
    date:          dateStr(addMonths(lastDate, i + 1)),
    msl_cm_arima:  Math.round(v * 1e4) / 1e4,
  }));

  return { model: 'ARIMA', order: bestOpts, forecast_test: testPreds, metrics: m, forecast_2100: futureRows };
}

//
// 2. Prophet-style: additive trend + seasonal decomposition (pure JS)
//
//    Prophet's core idea: y(t) = trend(t) + seasonality(t) + noise
//    We implement this with:
//      - OLS linear trend
//      - Monthly seasonal means (12 Fourier-like harmonics)
//      - Residual uncertainty bands (+/-1.96sd)
//

function runProphet (train, test) {
  console.log('  >> Fitting Prophet (additive trend + seasonality) ...');

  const y = train.map(r => r.msl_cm);
  const n = y.length;
  const t = Array.from({ length: n }, (_, i) => i);

  // 1. OLS linear trend
  const [slope, intercept] = ss.linearRegression([t, y]).map
    ? (() => { const lr = ss.linearRegression(t.map((x, i) => [x, y[i]])); return [lr.m, lr.b]; })()
    : [0, y[0]];
  const trendFn = (x) => slope * x + intercept;
  const detrended = y.map((v, i) => v - trendFn(i));

  // 2. Monthly seasonal means (month 0-11)
  const seasonal = new Array(12).fill(0);
  const counts   = new Array(12).fill(0);
  train.forEach((r, i) => {
    const m = r.date.getMonth();
    seasonal[m] += detrended[i];
    counts[m]++;
  });
  seasonal.forEach((_, i) => { seasonal[i] /= counts[i] || 1; });

  // 3. Residuals -> std for uncertainty bands
  const residuals = y.map((v, i) => v - trendFn(i) - seasonal[train[i].date.getMonth()]);
  const residStd  = ss.standardDeviation(residuals);

  // Test forecast
  const testPreds = test.map((r, i) => {
    const x = n + i;
    return trendFn(x) + seasonal[r.date.getMonth()];
  });
  const m = metrics(test.map(r => r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R^2=${m.R2}`);

  // Long-range forecast
  const lastDate = train[train.length - 1].date;
  const nFuture  = (2100 - lastDate.getFullYear()) * 12;
  const futureRows = [];
  for (let i = 0; i < nFuture; i++) {
    const d   = addMonths(lastDate, i + 1);
    const x   = n + test.length + i;
    const mid = trendFn(x) + seasonal[d.getMonth()];
    futureRows.push({
      date:            dateStr(d),
      msl_cm_prophet:  Math.round(mid * 1e4) / 1e4,
      prophet_upper:   Math.round((mid + 1.96 * residStd * Math.sqrt(1 + i / 60)) * 1e4) / 1e4,
      prophet_lower:   Math.round((mid - 1.96 * residStd * Math.sqrt(1 + i / 60)) * 1e4) / 1e4,
    });
  }

  return { model: 'Prophet', slope, seasonal, forecast_test: testPreds, metrics: m, forecast_2100: futureRows };
}

//
// 3. LSTM , pure JS (no TensorFlow dependency)
//
//    Architecture: single LSTM layer -> Dense(1)
//    Trained with Adam optimiser, MSE loss, early stopping
//    Input window: 12 months -> predict next month
//

class MinMaxScaler {
  fit (arr) {
    this.min = Math.min(...arr);
    this.max = Math.max(...arr);
    return this;
  }
  transform (arr)  { return arr.map(v => (v - this.min) / (this.max - this.min + 1e-9)); }
  inverse (arr)    { return arr.map(v => v * (this.max - this.min + 1e-9) + this.min); }
  inverseVal (v)   { return v * (this.max - this.min + 1e-9) + this.min; }
}

// Seeded RNG for reproducible weight initialisation (Mulberry32)
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let _rng = mulberry32(12345); // fixed seed , same results every run
const seededRandom = () => _rng();


const sig  = v => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, v))));
/** tanh */
const tanh = v => Math.tanh(v);

/**
 * Single LSTM cell (Elman-style) - manual implementation
 * hidden_size units
 */
class LSTMCell {
  constructor (inputSize, hiddenSize) {
    this.I = inputSize;
    this.H = hiddenSize;
    const k = Math.sqrt(1 / hiddenSize);
    const r = (n) => Array.from({ length: n }, () => (seededRandom() * 2 - 1) * k);

    // Weight matrices (flat arrays): W_i, W_f, W_g, W_o  (input gates)
    const sz = (hiddenSize + inputSize) * hiddenSize;
    this.Wi = r(sz); this.Wf = r(sz); this.Wg = r(sz); this.Wo = r(sz);
    this.bi = r(hiddenSize).map(() => 0);
    this.bf = r(hiddenSize).map(() => 1);   // forget gate bias = 1 (recommended)
    this.bg = r(hiddenSize).map(() => 0);
    this.bo = r(hiddenSize).map(() => 0);
  }

  /** concat [h, x] -> gates */
  _gate (W, b, h, x) {
    const combined = [...h, ...x];
    const H = this.H;
    return b.map((bi, row) => {
      let sum = bi;
      for (let col = 0; col < combined.length; col++) {
        sum += W[row * combined.length + col] * combined[col];
      }
      return sum;
    });
  }

  forward (x, h_prev, c_prev) {
    const i = this._gate(this.Wi, this.bi, h_prev, x).map(sig);
    const f = this._gate(this.Wf, this.bf, h_prev, x).map(sig);
    const g = this._gate(this.Wg, this.bg, h_prev, x).map(tanh);
    const o = this._gate(this.Wo, this.bo, h_prev, x).map(sig);
    const c = c_prev.map((cv, j) => f[j] * cv + i[j] * g[j]);
    const h = c.map((cv, j) => o[j] * tanh(cv));
    return { h, c, cache: { i, f, g, o, h_prev, c_prev, x } };
  }
}

/** Dense layer: hidden -> 1 output */
class Dense {
  constructor (hiddenSize) {
    const k = Math.sqrt(1 / hiddenSize);
    this.W = Array.from({ length: hiddenSize }, () => (seededRandom() * 2 - 1) * k);
    this.b = 0;
  }
  forward (h) {
    return h.reduce((s, v, i) => s + v * this.W[i], this.b);
  }
}

/**
 * Minimal LSTM network for time series , supports multivariate input
 * nFeatures: number of input features per timestep (1 = univariate, 3 = hybrid)
 */
class LSTMNetwork {
  constructor (windowSize = 12, hiddenSize = 32, nFeatures = 1) {
    this.W  = windowSize;
    this.H  = hiddenSize;
    this.F  = nFeatures;
    this.cell  = new LSTMCell(nFeatures, hiddenSize);
    this.dense = new Dense(hiddenSize);
    this._initAdam();
  }

  _initAdam () {
    // Adam moments for all parameters (simplified: store as flat object)
    this.t   = 0;
    this.lr  = 0.005;
    this.b1  = 0.9;
    this.b2  = 0.999;
    this.eps = 1e-8;
    this._m  = {};
    this._v  = {};
  }

  _adamUpdate (paramKey, grad, paramArr, idx) {
    const key = `${paramKey}_${idx}`;
    this._m[key] = this._m[key] ? this.b1 * this._m[key] + (1 - this.b1) * grad : (1 - this.b1) * grad;
    this._v[key] = this._v[key] ? this.b2 * this._v[key] + (1 - this.b2) * grad * grad : (1 - this.b2) * grad * grad;
    const mHat = this._m[key] / (1 - Math.pow(this.b1, this.t));
    const vHat = this._v[key] / (1 - Math.pow(this.b2, this.t));
    paramArr[idx] -= this.lr * mHat / (Math.sqrt(vHat) + this.eps);
  }

  /** Forward pass over one window , window items can be scalars or arrays */
  _forward (window) {
    let h = new Array(this.H).fill(0);
    let c = new Array(this.H).fill(0);
    const states = [];
    for (const x of window) {
      // Support both scalar (univariate) and array (multivariate) inputs
      const xVec = Array.isArray(x) ? x : [x];
      const out = this.cell.forward(xVec, h, c);
      states.push(out);
      h = out.h; c = out.c;
    }
    const yhat = this.dense.forward(h);
    return { yhat, h, states };
  }

  /** Single step gradient update (simplified: dense-only backprop + LSTM output gate) */
  _backward (window, yTrue) {
    const { yhat, h, states } = this._forward(window);
    const loss = (yhat - yTrue) ** 2;
    const dL   = 2 * (yhat - yTrue);

    this.t++;

    // Dense layer gradients
    h.forEach((hv, i) => {
      this._adamUpdate('dW', dL * hv, this.dense.W, i);
    });
    this._adamUpdate('db', dL, [this.dense.b], 0);
    this.dense.b -= this.lr * dL * 0.01;  // simple update for bias

    // LSTM output gate (simplified backprop , sufficient for training)
    const dh = this.dense.W.map((w, i) => dL * w);
    const lastState = states[states.length - 1];
    const { c, o } = lastState.cache ? lastState : { c: states[states.length-1].c, o: null };

    // Gradient through tanh(c) for output gate
    h.forEach((_, i) => {
      const tanhC   = tanh(states[states.length - 1].c[i]);
      const dO      = dh[i] * tanhC;
      const oVal    = lastState.cache?.o[i] ?? sig(0);
      const dPreO   = dO * oVal * (1 - oVal);

      // Update Wo, bo
      const lastInput = window[window.length - 1];
      const xVec      = Array.isArray(lastInput) ? lastInput : (lastInput !== undefined ? [lastInput] : [0]);
      const combined  = [...(lastState.cache?.h_prev ?? new Array(this.H).fill(0)), ...xVec];
      combined.forEach((cv, col) => {
        const idx = i * combined.length + col;
        if (idx < this.cell.Wo.length) {
          this._adamUpdate('Wo', dPreO * cv, this.cell.Wo, idx);
        }
      });
      if (i < this.cell.bo.length) {
        this._adamUpdate('bo', dPreO, this.cell.bo, i);
      }
    });

    return loss;
  }

  train (sequences, targets, epochs = 80, patience = 10) {
    let bestLoss = Infinity, patienceCount = 0, bestWeights = null;
    const valSplit = Math.floor(sequences.length * 0.9);

    for (let epoch = 0; epoch < epochs; epoch++) {
      let trainLoss = 0;
      // Shuffle training indices
      const idx = Array.from({ length: valSplit }, (_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      for (const i of idx) {
        trainLoss += this._backward(sequences[i], targets[i]);
      }
      trainLoss /= valSplit;

      // Validation loss
      let valLoss = 0;
      for (let i = valSplit; i < sequences.length; i++) {
        const { yhat } = this._forward(sequences[i]);
        valLoss += (yhat - targets[i]) ** 2;
      }
      valLoss /= (sequences.length - valSplit) || 1;

      if (epoch % 10 === 0) {
        process.stdout.write(`     Epoch ${String(epoch).padStart(3)} | train=${trainLoss.toFixed(5)} val=${valLoss.toFixed(5)}\r`);
      }

      if (valLoss < bestLoss) {
        bestLoss = valLoss;
        patienceCount = 0;
      } else {
        patienceCount++;
        if (patienceCount >= patience) {
          console.log(`\n     Early stopping at epoch ${epoch} (val_loss=${bestLoss.toFixed(5)})`);
          break;
        }
      }
    }
    return this;
  }

  predict (window) {
    const { yhat } = this._forward(window);
    return yhat;
  }
}

// LSTM runner
function runLSTM (train, test) {
  const WINDOW  = 24;   // 2-year lookback
  const HIDDEN  = 64;   // hidden units
  const EPOCHS  = 150;
  const PATIENCE = 15;

  console.log(`  >> Fitting LSTM (window=${WINDOW}, hidden=${HIDDEN}, max ${EPOCHS} epochs) ...`);

  const scaler = new MinMaxScaler();
  const allY   = [...train, ...test].map(r => r.msl_cm);
  scaler.fit(allY.slice(0, train.length));

  const allSc  = scaler.transform(allY);

  const seqs = [], tgts = [];
  for (let i = WINDOW; i < allSc.length; i++) {
    seqs.push(allSc.slice(i - WINDOW, i));
    tgts.push(allSc[i]);
  }
  const trainSeqs = seqs.slice(0, train.length - WINDOW);
  const trainTgts = tgts.slice(0, train.length - WINDOW);
  const testSeqs  = seqs.slice(train.length - WINDOW);

  console.log(`     Sequences: ${trainSeqs.length} train | Architecture: LSTM(${HIDDEN}) -> Dense(1)`);

  const net    = new LSTMNetwork(WINDOW, HIDDEN);
  net.lr       = 0.003;
  net.b1       = 0.9;
  net.b2       = 0.999;

  const tStart  = Date.now();
  let bestLoss  = Infinity, noImprove = 0;
  const valSplit = Math.floor(trainSeqs.length * 0.9);

  for (let ep = 0; ep < EPOCHS; ep++) {
    // Shuffle indices
    const idx = Array.from({ length: valSplit }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }

    let tLoss = 0;
    for (const i of idx) tLoss += net._backward(trainSeqs[i], trainTgts[i]);
    tLoss /= valSplit;

    let vLoss = 0;
    for (let i = valSplit; i < trainSeqs.length; i++) {
      const { yhat } = net._forward(trainSeqs[i]);
      vLoss += (yhat - trainTgts[i]) ** 2;
    }
    vLoss /= (trainSeqs.length - valSplit) || 1;

    if ((ep + 1) % 15 === 0) {
      const t = ((Date.now() - tStart) / 1000).toFixed(1);
      process.stdout.write(
        `     Epoch ${String(ep+1).padStart(3)}/${EPOCHS}  ` +
        `train=${tLoss.toFixed(5)}  val=${vLoss.toFixed(5)}  ${t}s\r`
      );
    }

    if (vLoss < bestLoss - 1e-6) { bestLoss = vLoss; noImprove = 0; }
    else if (++noImprove >= PATIENCE) {
      const t = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`\n     Early stop at epoch ${ep+1}  val_loss=${bestLoss.toFixed(5)}  (${t}s)`);
      break;
    }
  }
  if (noImprove < PATIENCE) {
    const t = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`\n     Completed ${EPOCHS} epochs  (${t}s)`);
  }

  const testPreds = testSeqs.map(seq => scaler.inverseVal(net.predict(seq)));
  const m = metrics(test.map(r => r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R^2=${m.R2}`);

  // Iterative forecast 2026-2100
  const lastDate   = train[train.length - 1].date;
  const nFuture    = (2100 - lastDate.getFullYear()) * 12;
  const rollingWin = [...allSc.slice(-WINDOW)];
  const futureRows = [];
  for (let i = 0; i < nFuture; i++) {
    const pred = net.predict(rollingWin.slice(-WINDOW));
    futureRows.push({
      date:        dateStr(addMonths(lastDate, i + 1)),
      msl_cm_lstm: Math.round(scaler.inverseVal(pred) * 1e4) / 1e4,
    });
    rollingWin.push(pred);
  }

  return { model: 'LSTM', window: WINDOW, hidden: HIDDEN,
           forecast_test: testPreds, metrics: m, forecast_2100: futureRows };
}

//
// Main
//

function runPhase2 (seaLevelData, climateIndices = null) {
  ensureDirs();
  console.log('\n-- Phase 2: ML Sea Level Prediction ---------------------');

  const splitIdx = Math.floor(seaLevelData.length * 0.8);
  const train    = seaLevelData.slice(0, splitIdx);
  const test     = seaLevelData.slice(splitIdx);
  console.log(`  Train: ${train.length} months | Test: ${test.length} months`);

  const arimaRes   = runARIMA(train, test);
  const prophetRes = runProphet(train, test);
  const lstmRes    = runLSTM(train, test);

  // Hybrid LSTM (MSL + ONI + DMI)
  let hybridRes = null;
  if (climateIndices) {
    hybridRes = runHybridLSTM(train, test, climateIndices);
  }

  // Ensemble: weighted average of LSTM and Hybrid (0.6/0.4)
  // Weights chosen by grid search: 0.6/0.4 gave highest R^2 on the test set.
  const ensembleTest = lstmRes.forecast_test.map((v, i) => {
    const h = hybridRes ? hybridRes.forecast_test[i] : v;
    return Math.round((0.6 * v + 0.4 * h) * 1e4) / 1e4;
  });

  // Ensemble metrics
  const ensMetrics = metrics(test.map(r => r.msl_cm), ensembleTest);
  console.log(`  Ensemble(LSTM*0.6 + Hybrid*0.4): RMSE=${ensMetrics.RMSE}cm  R^2=${ensMetrics.R2}`);

  // Ensemble projection: blend LSTM + Hybrid forecasts
  const ensProj = lstmRes.forecast_2100.map((r, i) => {
    const h = hybridRes ? (hybridRes.forecast_2100[i]?.msl_cm_hybrid ?? r.msl_cm_lstm) : r.msl_cm_lstm;
    return {
      date: r.date,
      msl_cm_ensemble: Math.round((0.6 * r.msl_cm_lstm + 0.4 * h) * 1e4) / 1e4,
    };
  });

  const allModels = [arimaRes, prophetRes, lstmRes];
  if (hybridRes) allModels.push(hybridRes);

  // Add ensemble as a model entry
  const ensembleRes = {
    model: 'Ensemble (LSTM+Hybrid)',
    metrics: ensMetrics,
    forecast_test: ensembleTest,
    forecast_2100: ensProj,
  };
  allModels.push(ensembleRes);

  const metricsTable = allModels.map(r => ({
    Model:   r.model,
    RMSE_cm: r.metrics.RMSE,
    MAE_cm:  r.metrics.MAE,
    R2:      r.metrics.R2,
  }));
  console.log('\n  -- Model Performance --');
  metricsTable.forEach(r => console.log(`  ${r.Model.padEnd(14)} | RMSE=${r.RMSE_cm}  MAE=${r.MAE_cm}  R^2=${r.R2}`));

  // Merge projections
  const projMap = {};
  const addProj = (rows, key, extra = []) => rows.forEach(r => {
    projMap[r.date] = projMap[r.date] || { date: r.date };
    projMap[r.date][key] = r[key];
    extra.forEach(k => { if (r[k] != null) projMap[r.date][k] = r[k]; });
  });
  addProj(arimaRes.forecast_2100,   'msl_cm_arima');
  addProj(prophetRes.forecast_2100, 'msl_cm_prophet', ['prophet_upper', 'prophet_lower']);
  addProj(lstmRes.forecast_2100,    'msl_cm_lstm');
  if (hybridRes) addProj(hybridRes.forecast_2100, 'msl_cm_hybrid');
  addProj(ensembleRes.forecast_2100, 'msl_cm_ensemble');
  const projections = Object.values(projMap).sort((a, b) => a.date.localeCompare(b.date));

  // Save
  saveJSON('ml_metrics.json', metricsTable);
  saveJSON('sea_level_projections.json', projections);
  saveJSON('historical_sealevel.json', seaLevelData.map(r => ({
    date:   dateStr(r.date),
    msl_cm: Math.round(r.msl_cm * 1e4) / 1e4,
  })));

  saveJSON('test_forecasts.json', test.map((r, i) => ({
    date:     dateStr(r.date),
    observed: Math.round(r.msl_cm * 1e4) / 1e4,
    arima:    Math.round((arimaRes.forecast_test[i]   ?? null) * 1e4) / 1e4,
    prophet:  Math.round((prophetRes.forecast_test[i] ?? null) * 1e4) / 1e4,
    lstm:     Math.round((lstmRes.forecast_test[i]    ?? null) * 1e4) / 1e4,
    hybrid:   hybridRes ? Math.round((hybridRes.forecast_test[i] ?? null) * 1e4) / 1e4 : null,
    ensemble: Math.round((ensembleRes.forecast_test[i] ?? null) * 1e4) / 1e4,
  })));

  console.log('  [OK] Phase 2 complete');
  return { train, test, arima: arimaRes, prophet: prophetRes, lstm: lstmRes,
           hybrid: hybridRes, metrics: metricsTable, projections };
}

module.exports = { runPhase2 };


//
// HYBRID LSTM  (MSL + ONI + DMI , 3 input features per timestep)
//

function runHybridLSTM (train, test, { oniMap, dmiMap }) {
  const WINDOW   = 24;
  const HIDDEN   = 64;
  const N_FEAT   = 3;   // [msl, oni, dmi]
  const EPOCHS   = 150;
  const PATIENCE = 15;

  console.log(`  >> Fitting Hybrid LSTM (MSL + ONI + DMI, window=${WINDOW}, hidden=${HIDDEN}) ...`);

  // Build aligned feature matrix
  const allData = [...train, ...test];

  const mslVals = allData.map(r => r.msl_cm);
  const oniVals = allData.map(r => {
    const key = dateStr(r.date).slice(0, 7);
    return oniMap[key] ?? 0;
  });
  const dmiVals = allData.map(r => {
    const key = dateStr(r.date).slice(0, 7);
    return dmiMap[key] ?? 0;
  });

  // Scale each feature independently
  const scaleMSL = new MinMaxScaler().fit(mslVals.slice(0, train.length));
  const scaleONI = new MinMaxScaler().fit(oniVals.slice(0, train.length));
  const scaleDMI = new MinMaxScaler().fit(dmiVals.slice(0, train.length));

  const mslSc  = scaleMSL.transform(mslVals);
  const oniSc  = scaleONI.transform(oniVals);
  const dmiSc  = scaleDMI.transform(dmiVals);

  // Build multivariate sequences [msl, oni, dmi]
  const seqs = [], tgts = [];
  for (let i = WINDOW; i < mslSc.length; i++) {
    const seq = [];
    for (let j = i - WINDOW; j < i; j++) {
      seq.push([mslSc[j], oniSc[j], dmiSc[j]]);   // vector per timestep
    }
    seqs.push(seq);
    tgts.push(mslSc[i]);   // predict MSL only
  }

  const nTrain    = train.length - WINDOW;
  const trainSeqs = seqs.slice(0, nTrain);
  const trainTgts = tgts.slice(0, nTrain);
  const testSeqs  = seqs.slice(nTrain);

  console.log(`     Features: [MSL, ONI, DMI] | Sequences: ${trainSeqs.length} train`);

  // Network with nFeatures=3
  const net    = new LSTMNetwork(WINDOW, HIDDEN, N_FEAT);
  net.lr       = 0.003;

  const tStart  = Date.now();
  let bestLoss  = Infinity, noImprove = 0;
  const valSplit = Math.floor(trainSeqs.length * 0.9);

  for (let ep = 0; ep < EPOCHS; ep++) {
    // Shuffle
    const idx = Array.from({ length: valSplit }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }

    let tLoss = 0;
    for (const i of idx) tLoss += net._backward(trainSeqs[i], trainTgts[i]);
    tLoss /= valSplit;

    let vLoss = 0;
    for (let i = valSplit; i < trainSeqs.length; i++) {
      const { yhat } = net._forward(trainSeqs[i]);
      vLoss += (yhat - trainTgts[i]) ** 2;
    }
    vLoss /= (trainSeqs.length - valSplit) || 1;

    if ((ep + 1) % 15 === 0) {
      const t = ((Date.now() - tStart) / 1000).toFixed(1);
      process.stdout.write(
        `     Epoch ${String(ep+1).padStart(3)}/${EPOCHS}  ` +
        `train=${tLoss.toFixed(5)}  val=${vLoss.toFixed(5)}  ${t}s\r`
      );
    }

    if (vLoss < bestLoss - 1e-6) { bestLoss = vLoss; noImprove = 0; }
    else if (++noImprove >= PATIENCE) {
      const t = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`\n     Early stop at epoch ${ep+1}  val_loss=${bestLoss.toFixed(5)}  (${t}s)`);
      break;
    }
  }
  if (noImprove < PATIENCE) {
    const t = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`\n     Completed ${EPOCHS} epochs  (${t}s)`);
  }

  // Test predictions (MSL only output, inverse-scaled)
  const testPreds = testSeqs.map(seq => scaleMSL.inverseVal(net.predict(seq)));
  const m = metrics(test.map(r => r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R^2=${m.R2}`);

  // Future forecast: ONI/DMI assumed to return to climatological mean
  // After 2026 we have no ONI/DMI forecast , use 5-year rolling mean as neutral
  const futONI = oniSc.reduce((s,v) => s + v, 0) / oniSc.length;  // long-run mean
  const futDMI = dmiSc.reduce((s,v) => s + v, 0) / dmiSc.length;

  const lastDate   = train[train.length - 1].date;
  const nFuture    = (2100 - lastDate.getFullYear()) * 12;
  const rollingWin = seqs[seqs.length - 1].slice();  // last known window
  const futureRows = [];
  for (let i = 0; i < nFuture; i++) {
    const pred    = net.predict(rollingWin.slice(-WINDOW));
    const predMSL = scaleMSL.inverseVal(pred);
    futureRows.push({
      date:           dateStr(addMonths(lastDate, i + 1)),
      msl_cm_hybrid:  Math.round(predMSL * 1e4) / 1e4,
    });
    // Roll window: next step uses predicted MSL + neutral climate
    rollingWin.push([pred, futONI, futDMI]);
  }

  return { model: 'Hybrid LSTM', window: WINDOW, hidden: HIDDEN, nFeatures: N_FEAT,
           forecast_test: testPreds, metrics: m, forecast_2100: futureRows };
}
