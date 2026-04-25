'use strict';

process.env.TF_CPP_MIN_LOG_LEVEL = '3';

let tf;
try {
  tf = require('@tensorflow/tfjs-node');
  console.log('  TensorFlow backend: tfjs-node (native C++)');
} catch {
  tf = require('@tensorflow/tfjs');
  console.log('  TensorFlow backend: tfjs (pure JS)');
}

const ARIMA = require('arima');
const ss    = require('simple-statistics');
const { addMonths, dateStr, metrics, saveJSON, ensureDirs } = require('./utils');

// ── Scaler ────────────────────────────────────────────────────────────────────
class Scaler {
  fit(arr)      { this.min = Math.min(...arr); this.max = Math.max(...arr); this.r = this.max - this.min + 1e-9; return this; }
  transform(arr){ return arr.map(v => (v - this.min) / this.r); }
  inverse(arr)  { return arr.map(v => v * this.r + this.min); }
  inv(v)        { return v * this.r + this.min; }
}

function makeSeq(data, window, nFeat = 1) {
  const X = [], y = [];
  for (let i = window; i < data.length; i++) {
    X.push(Array.from({length: window}, (_, j) => nFeat === 1 ? [data[i-window+j]] : data[i-window+j]));
    y.push(nFeat === 1 ? data[i] : data[i][0]);
  }
  return { X, y };
}

// ── 1. ARIMA ──────────────────────────────────────────────────────────────────
function runARIMA(train, test) {
  console.log('  ► Fitting ARIMA …');
  const series = train.map(r => r.msl_cm);
  let best = Infinity, bestOpts = {p:2,d:1,q:2};
  for (let p = 0; p <= 3; p++) for (let q = 0; q <= 3; q++) {
    try {
      const vl = Math.floor(series.length*0.1);
      const [fc] = new ARIMA({p,d:1,q,verbose:false}).train(series.slice(0,-vl)).predict(vl);
      const rmse = Math.sqrt(ss.mean(fc.map((v,i)=>(v-series[series.length-vl+i])**2)));
      if (rmse < best) { best = rmse; bestOpts = {p,d:1,q}; }
    } catch {}
  }
  console.log(`     Best order: ARIMA(${bestOpts.p},${bestOpts.d},${bestOpts.q})`);
  const model = new ARIMA({...bestOpts, verbose:false}).train(series);
  const [testPreds] = model.predict(test.length);
  const m = metrics(test.map(r=>r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R²=${m.R2}`);
  const lastDate = train[train.length-1].date;
  const nFut = (2100 - lastDate.getFullYear()) * 12;
  const [fut] = model.predict(nFut);
  return { model:'ARIMA', metrics:m, forecast_test:testPreds,
    forecast_2100: fut.map((v,i)=>({date:dateStr(addMonths(lastDate,i+1)), msl_cm_arima:Math.round(v*1e4)/1e4})) };
}

// ── 2. Prophet-style ──────────────────────────────────────────────────────────
function runProphet(train, test) {
  console.log('  ► Fitting Prophet (OLS trend + seasonal) …');
  const y = train.map(r => r.msl_cm);
  const n = y.length;
  const t = Array.from({length:n},(_,i)=>i);
  const lr = ss.linearRegression(t.map((x,i)=>[x,y[i]]));
  const tFn = x => lr.m*x + lr.b;
  const det = y.map((v,i) => v - tFn(i));
  const seas = new Array(12).fill(0), cnt = new Array(12).fill(0);
  train.forEach((r,i) => { const mo=r.date.getMonth(); seas[mo]+=det[i]; cnt[mo]++; });
  seas.forEach((_,i) => { seas[i] /= cnt[i]||1; });
  const resid = y.map((v,i)=>v-tFn(i)-seas[train[i].date.getMonth()]);
  const std = ss.standardDeviation(resid);
  const testPreds = test.map((r,i) => tFn(n+i) + seas[r.date.getMonth()]);
  const m = metrics(test.map(r=>r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R²=${m.R2}`);
  const lastDate = train[train.length-1].date;
  const nFut = (2100 - lastDate.getFullYear()) * 12;
  const rows = [];
  for (let i=0; i<nFut; i++) {
    const d=addMonths(lastDate,i+1), x=n+test.length+i, mid=tFn(x)+seas[d.getMonth()], ci=1.96*std*Math.sqrt(1+i/60);
    rows.push({date:dateStr(d), msl_cm_prophet:Math.round(mid*1e4)/1e4, prophet_upper:Math.round((mid+ci)*1e4)/1e4, prophet_lower:Math.round((mid-ci)*1e4)/1e4});
  }
  return { model:'Prophet', metrics:m, forecast_test:testPreds, forecast_2100:rows };
}

// ── 3. Univariate LSTM ────────────────────────────────────────────────────────
async function runLSTM(train, test) {
  const WINDOW = 24;
  const EPOCHS = 200;
  console.log(`  ► Fitting LSTM (TF.js, LSTM(16)+L2, window=${WINDOW}) …`);

  const scaler = new Scaler().fit(train.map(r=>r.msl_cm));
  const allSc  = scaler.transform([...train,...test].map(r=>r.msl_cm));
  const {X, y} = makeSeq(allSc, WINDOW, 1);
  const nTr = train.length - WINDOW;
  const Xtr = tf.tensor3d(X.slice(0,nTr));
  const ytr = tf.tensor2d(y.slice(0,nTr), [nTr,1]);
  const Xte = tf.tensor3d(X.slice(nTr));

  const l2 = w => tf.regularizers.l2({l2:w});
  const model = tf.sequential();
  model.add(tf.layers.lstm({
    units: 16, returnSequences: false, inputShape: [WINDOW, 1],
    kernelInitializer: 'glorotUniform', recurrentInitializer: 'glorotUniform',
    kernelRegularizer: l2(0.005), recurrentRegularizer: l2(0.005),
  }));
  model.add(tf.layers.dense({units:8, activation:'relu', kernelRegularizer:l2(0.005)}));
  model.add(tf.layers.dense({units:1}));
  model.compile({optimizer: tf.train.adam(0.001), loss:'meanSquaredError'});
  console.log(`     Parameters: ${model.countParams().toLocaleString()}`);

  const tStart = Date.now();
  for (let ep = 0; ep < EPOCHS; ep++) {
    const h = await model.fit(Xtr, ytr, {epochs:1, batchSize:8, verbose:0});
    if ((ep+1) % 20 === 0) {
      process.stdout.write(`     Epoch ${String(ep+1).padStart(3)}/${EPOCHS}  loss=${h.history.loss[0].toFixed(5)}  ${((Date.now()-tStart)/1000).toFixed(1)}s\r`);
    }
  }
  console.log(`\n     Completed ${EPOCHS} epochs  (${((Date.now()-tStart)/1000).toFixed(1)}s)`);

  const predSc = Array.from((await model.predict(Xte)).dataSync());
  const testPreds = scaler.inverse(predSc);
  const m = metrics(test.map(r=>r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R²=${m.R2}`);

  const lastDate = train[train.length-1].date;
  const nFut = (2100 - lastDate.getFullYear()) * 12;
  let win = allSc.slice(-WINDOW);
  const rows = [];
  for (let i=0; i<nFut; i++) {
    const inp = tf.tensor3d([win.slice(-WINDOW).map(v=>[v])]);
    const p = (await model.predict(inp)).dataSync()[0];
    rows.push({date:dateStr(addMonths(lastDate,i+1)), msl_cm_lstm:Math.round(scaler.inv(p)*1e4)/1e4});
    win = [...win.slice(1), p];
    inp.dispose();
  }
  Xtr.dispose(); ytr.dispose(); Xte.dispose();
  return { model:'LSTM', params:model.countParams(), metrics:m, forecast_test:testPreds, forecast_2100:rows };
}

// ── 4. Hybrid LSTM (MSL + ONI + DMI) ─────────────────────────────────────────
async function runHybridLSTM(train, test, {oniMap, dmiMap}) {
  const WINDOW = 24;
  const N_FEAT = 3;
  const EPOCHS = 200;
  console.log(`  ► Fitting Hybrid LSTM (TF.js, LSTM(24)+L2, MSL+ONI+DMI, window=${WINDOW}) …`);

  const allData = [...train,...test];
  const mslRaw = allData.map(r=>r.msl_cm);
  const oniRaw = allData.map(r=>oniMap[dateStr(r.date).slice(0,7)]??0);
  const dmiRaw = allData.map(r=>dmiMap[dateStr(r.date).slice(0,7)]??0);

  const sMSL = new Scaler().fit(mslRaw.slice(0,train.length));
  const sONI = new Scaler().fit(oniRaw.slice(0,train.length));
  const sDMI = new Scaler().fit(dmiRaw.slice(0,train.length));

  const combined = mslRaw.map((v,i)=>[sMSL.transform([v])[0], sONI.transform([oniRaw[i]])[0], sDMI.transform([dmiRaw[i]])[0]]);
  const {X, y} = makeSeq(combined, WINDOW, N_FEAT);
  const nTr = train.length - WINDOW;
  const Xtr = tf.tensor3d(X.slice(0,nTr));
  const ytr = tf.tensor2d(y.slice(0,nTr), [nTr,1]);
  const Xte = tf.tensor3d(X.slice(nTr));

  const l2h = w => tf.regularizers.l2({l2:w});
  const model = tf.sequential();
  model.add(tf.layers.lstm({
    units: 24, returnSequences: false, inputShape: [WINDOW, N_FEAT],
    kernelInitializer: 'glorotUniform', recurrentInitializer: 'glorotUniform',
    kernelRegularizer: l2h(0.005), recurrentRegularizer: l2h(0.005),
  }));
  model.add(tf.layers.dense({units:12, activation:'relu', kernelRegularizer:l2h(0.005)}));
  model.add(tf.layers.dense({units:1}));
  model.compile({optimizer: tf.train.adam(0.001), loss:'meanSquaredError'});
  console.log(`     Parameters: ${model.countParams().toLocaleString()}`);
  console.log(`     Features: [MSL, ONI (NOAA CPC), DMI (NOAA PSL)] — real monthly data`);

  const tStart = Date.now();
  for (let ep = 0; ep < EPOCHS; ep++) {
    const h = await model.fit(Xtr, ytr, {epochs:1, batchSize:8, verbose:0});
    if ((ep+1) % 20 === 0) {
      process.stdout.write(`     Epoch ${String(ep+1).padStart(3)}/${EPOCHS}  loss=${h.history.loss[0].toFixed(5)}  ${((Date.now()-tStart)/1000).toFixed(1)}s\r`);
    }
  }
  console.log(`\n     Completed ${EPOCHS} epochs  (${((Date.now()-tStart)/1000).toFixed(1)}s)`);

  const predSc = Array.from((await model.predict(Xte)).dataSync());
  const testPreds = sMSL.inverse(predSc);
  const m = metrics(test.map(r=>r.msl_cm), testPreds);
  console.log(`     Metrics: RMSE=${m.RMSE}cm  MAE=${m.MAE}cm  R²=${m.R2}`);

  const mslScAll = sMSL.transform(mslRaw);
  const oniScAll = sONI.transform(oniRaw);
  const dmiScAll = sDMI.transform(dmiRaw);
  const futONI = ss.mean(oniScAll.slice(-60));
  const futDMI = ss.mean(dmiScAll.slice(-60));

  const lastDate = train[train.length-1].date;
  const nFut = (2100 - lastDate.getFullYear()) * 12;
  let win = combined.slice(-WINDOW);
  const rows = [];
  for (let i=0; i<nFut; i++) {
    const inp = tf.tensor3d([win.slice(-WINDOW)]);
    const p = (await model.predict(inp)).dataSync()[0];
    rows.push({date:dateStr(addMonths(lastDate,i+1)), msl_cm_hybrid:Math.round(sMSL.inv(p)*1e4)/1e4});
    win = [...win.slice(1), [p, futONI, futDMI]];
    inp.dispose();
  }
  Xtr.dispose(); ytr.dispose(); Xte.dispose();
  return { model:'Hybrid LSTM', params:model.countParams(), metrics:m, forecast_test:testPreds, forecast_2100:rows };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runPhase2(seaLevelData, climateIndices = null) {
  ensureDirs();
  console.log('\n── Phase 2: ML Sea Level Prediction (TensorFlow.js) ─────');
  const splitIdx = Math.floor(seaLevelData.length * 0.8);
  const train = seaLevelData.slice(0, splitIdx);
  const test  = seaLevelData.slice(splitIdx);
  console.log(`  Train: ${train.length} months | Test: ${test.length} months`);

  const arimaRes   = runARIMA(train, test);
  const prophetRes = runProphet(train, test);
  const lstmRes    = await runLSTM(train, test);
  const hybridRes  = climateIndices ? await runHybridLSTM(train, test, climateIndices) : null;

  const allModels = [arimaRes, prophetRes, lstmRes];
  if (hybridRes) allModels.push(hybridRes);
  const metricsTable = allModels.map(r=>({Model:r.model, RMSE_cm:r.metrics.RMSE, MAE_cm:r.metrics.MAE, R2:r.metrics.R2, Params:r.params??'N/A'}));

  console.log('\n  ── Model Performance ──────────────────────────────────');
  metricsTable.forEach(r => console.log(`  ${r.Model.padEnd(14)} | RMSE=${String(r.RMSE_cm).padEnd(7)} MAE=${String(r.MAE_cm).padEnd(7)} R²=${r.R2}`));

  const projMap = {};
  const addP = (rows, key, extra=[]) => rows.forEach(r => {
    projMap[r.date] = projMap[r.date]||{date:r.date};
    projMap[r.date][key] = r[key];
    extra.forEach(k => { if(r[k]!=null) projMap[r.date][k]=r[k]; });
  });
  addP(arimaRes.forecast_2100,   'msl_cm_arima');
  addP(prophetRes.forecast_2100, 'msl_cm_prophet', ['prophet_upper','prophet_lower']);
  addP(lstmRes.forecast_2100,    'msl_cm_lstm');
  if (hybridRes) addP(hybridRes.forecast_2100, 'msl_cm_hybrid');
  const projections = Object.values(projMap).sort((a,b)=>a.date.localeCompare(b.date));

  saveJSON('ml_metrics.json', metricsTable);
  saveJSON('sea_level_projections.json', projections);
  saveJSON('historical_sealevel.json', seaLevelData.map(r=>({date:dateStr(r.date), msl_cm:Math.round(r.msl_cm*1e4)/1e4})));
  saveJSON('test_forecasts.json', test.map((r,i)=>({
    date:    dateStr(r.date),
    observed: Math.round(r.msl_cm*1e4)/1e4,
    arima:    Math.round((arimaRes.forecast_test[i]??null)*1e4)/1e4,
    prophet:  Math.round((prophetRes.forecast_test[i]??null)*1e4)/1e4,
    lstm:     Math.round((lstmRes.forecast_test[i]??null)*1e4)/1e4,
    hybrid:   hybridRes ? Math.round((hybridRes.forecast_test[i]??null)*1e4)/1e4 : null,
  })));

  console.log('  ✓ Phase 2 complete');
  return { train, test, arima:arimaRes, prophet:prophetRes, lstm:lstmRes, hybrid:hybridRes, metrics:metricsTable, projections };
}

module.exports = { runPhase2 };
