/**
 * utils.js  -  Shared helpers for Maldives SLR analysis
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const ss   = require('simple-statistics');

// Paths
const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR  = path.join(ROOT, 'outputs');

function ensureDirs () {
  [DATA_DIR, OUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

// UHSLC .dat file parser
/**
 * Parse a UHSLC fixed-width monthly mean sea level file.
 * Format: each row = one year, 12 monthly values (mm), -32767 = missing.
 * Example line:  1988 6987 6991 7002 ...
 *
 * Alternatively accepts a CSV with columns: date, msl_mm
 */
function loadSeaLevel (filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const rows = [];

  // Detect format: CSV vs UHSLC fixed-width
  if (raw.startsWith('date') || raw.startsWith('Date')) {
    // CSV  (date, msl_mm)
    const lines = raw.split('\n').slice(1);
    for (const line of lines) {
      const [dateStr, val] = line.trim().split(',');
      if (!dateStr || !val) continue;
      const msl = parseFloat(val);
      if (msl > 0 && msl !== -32767) {
        rows.push({ date: new Date(dateStr), msl_mm: msl });
      }
    }
  } else if (raw.includes('108') && raw.includes('Male')) {
    // UHSLC daily .dat format  (d108a.dat / d108b.dat / rq108a.dat)
    // Each row: STID  Name  YEAR  DOYJ  val1..val12  (12 daily readings starting at DOY)
    // Missing = 9999.  Aggregate to monthly means.
    const dailyMap = {};  // 'YYYY-MM' -> [values]
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const year = parseInt(parts[2]);
      if (isNaN(year)) continue;
      const doyStr = parts[3].replace(/[JjRr]/g, '');
      const doy    = parseInt(doyStr);
      if (isNaN(doy)) continue;
      for (let i = 0; i < 12; i++) {
        const raw_v = parts[4 + i];
        if (!raw_v) continue;
        const v = parseInt(raw_v.replace(/-/g, ''));
        if (!v || v >= 9999 || v <= 0) continue;
        // Convert DOY to date
        const d = new Date(year, 0, 1);
        d.setDate(d.getDate() + doy + i - 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        if (!dailyMap[key]) dailyMap[key] = [];
        dailyMap[key].push(v);
      }
    }
    // Only keep months with >=10 valid daily readings
    for (const [key, vals] of Object.entries(dailyMap)) {
      if (vals.length < 10) continue;
      const mean = vals.reduce((a,b)=>a+b,0) / vals.length;
      const [y, m] = key.split('-').map(Number);
      rows.push({ date: new Date(y, m-1, 1), msl_mm: Math.round(mean*10)/10 });
    }
    rows.sort((a,b) => a.date - b.date);
  } else {
    // UHSLC fixed-width monthly rows (legacy format)
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/).map(Number);
      if (parts.length < 2) continue;
      const year = parts[0];
      for (let m = 0; m < 12; m++) {
        const val = parts[m + 1];
        if (val !== undefined && val !== -32767 && val > 0) {
          rows.push({ date: new Date(year, m, 1), msl_mm: val });
        }
      }
    }
  }

  // Sort chronologically
  rows.sort((a, b) => a.date - b.date);

  // Convert to anomaly (cm) from first reading
  const base = rows[0].msl_mm;
  rows.forEach(r => { r.msl_cm = (r.msl_mm - base) / 10; });

  // Linear interpolation for any remaining gaps
  interpolateMissing(rows);

  return rows;
}

function interpolateMissing (rows) {
  for (let i = 1; i < rows.length - 1; i++) {
    if (rows[i].msl_cm === undefined) {
      rows[i].msl_cm = (rows[i - 1].msl_cm + rows[i + 1].msl_cm) / 2;
    }
  }
}

// Demo data generator
/**
 * Generates synthetic UHSLC-compatible data matching published Male statistics:
 *   trend: 4.4 mm/yr  |  total rise ~157mm over 37 years  |  seasonal +/-3cm
 */
function generateDemoSeaLevel () {
  const outPath = path.join(DATA_DIR, 'male_sealevel.csv');
  if (fs.existsSync(outPath)) return outPath;

  const rows = ['date,msl_mm'];
  const start = new Date(1989, 0, 1);
  let t = 0;

  // Seeded pseudo-random (LCG)
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
  const randn = () => Math.sqrt(-2 * Math.log(rand() + 1e-10)) * Math.cos(2 * Math.PI * rand());

  for (let year = 1989; year <= 2025; year++) {
    const months = year === 2025 ? 10 : 12;
    for (let m = 0; m < months; m++, t++) {
      const trend      = (4.4 / 12) * t;
      const seasonal   = 30 * Math.sin(2 * Math.PI * t / 12 + 1.2) + 15 * Math.sin(4 * Math.PI * t / 12);
      const interann   = 20 * Math.sin(2 * Math.PI * t / 54) + 15 * Math.sin(2 * Math.PI * t / 84);
      const noise      = randn() * 8;
      const msl        = Math.round((7000 + trend + seasonal + interann + noise) * 10) / 10;
      const date       = `${year}-${String(m + 1).padStart(2,'0')}-01`;
      // ~2% missing
      rows.push(`${date},${rand() < 0.02 ? -32767 : msl}`);
    }
  }

  fs.writeFileSync(outPath, rows.join('\n'));
  console.log('  [DEMO] Generated synthetic sea level data ->', outPath);
  return outPath;
}

function generateDemoIslands () {
  const outPath = path.join(DATA_DIR, 'islands.json');
  if (fs.existsSync(outPath)) return outPath;

  // Real geographic bounding boxes per atoll (from published Maldives charts)
  // [latMin, latMax, lonMin, lonMax]
  const atollBounds = {
    'Haa Alif':      [6.55, 7.10, 72.85, 73.20],
    'Haa Dhaalu':    [6.25, 6.60, 72.85, 73.15],
    'Shaviyani':     [5.90, 6.25, 72.95, 73.25],
    'Noonu':         [5.70, 6.05, 73.10, 73.50],
    'Raa':           [5.40, 5.80, 72.80, 73.20],
    'Baa':           [4.90, 5.30, 72.80, 73.10],
    'Lhaviyani':     [5.30, 5.60, 73.30, 73.60],
    'Kaafu':         [3.85, 4.60, 73.30, 73.70],
    'Alifu Alifu':   [3.90, 4.25, 72.70, 72.95],
    'Alifu Dhaalu':  [3.50, 3.95, 72.70, 72.95],
    'Vaavu':         [3.25, 3.65, 73.35, 73.65],
    'Meemu':         [2.75, 3.15, 73.35, 73.65],
    'Faafu':         [2.85, 3.10, 72.90, 73.10],
    'Dhaalu':        [2.50, 2.90, 72.70, 73.00],
    'Thaa':          [2.05, 2.50, 72.85, 73.15],
    'Laamu':         [1.80, 2.20, 73.35, 73.70],
    'Gaafu Alifu':   [0.50, 0.95, 72.95, 73.35],
    'Gaafu Dhaalu':  [0.15, 0.55, 72.95, 73.35],
    'Gnaviyani':     [-0.35, -0.20, 73.35, 73.55],
    'Seenu':         [-0.80, -0.35, 72.95, 73.35],
  };

  const atolls = Object.keys(atollBounds);

  let seed = 7;
  const rand  = () => { seed=(seed*1664525+1013904223)&0xffffffff; return (seed>>>0)/0xffffffff; };
  const lognorm = (mu,sig) => Math.exp(mu + sig*(Math.sqrt(-2*Math.log(rand()+1e-9))*Math.cos(2*Math.PI*rand())));

  const islands = [];
  let id = 1;
  for (const atoll of atolls) {
    const [latMin, latMax, lonMin, lonMax] = atollBounds[atoll];
    const n = 6 + Math.floor(rand() * 8);
    for (let j = 0; j < n && id <= 187; j++, id++) {
      const area     = Math.max(0.05, Math.min(8, lognorm(1.2, 0.9)));
      const pop      = Math.max(50, Math.min(14000, Math.floor(lognorm(5.5, 1.2))));
      const meanElev = 0.6 + rand() * 1.2;
      const fracLt1  = Math.min(0.98, 0.5 + rand() * 0.45);
      islands.push({
        id, atoll,
        name:        `${atoll} Island ${String(j+1).padStart(2,'0')}`,
        area_km2:    Math.round(area * 1e4) / 1e4,
        population:  pop,
        mean_elev_m: Math.round(meanElev * 100) / 100,
        max_elev_m:  Math.round((meanElev + 0.3 + rand() * 0.7) * 100) / 100,
        frac_lt1m:   Math.round(fracLt1 * 1000) / 1000,
        // Place within real atoll bounding box
        lat: latMin + rand() * (latMax - latMin),
        lon: lonMin + rand() * (lonMax - lonMin),
      });
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(islands, null, 2));
  console.log('  [DEMO] Generated island data with real atoll coordinates ->', outPath);
  return outPath;
}

// Math helpers
function addMonths (date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function dateStr (date) {
  return date.toISOString().slice(0, 10);
}

function metrics (actual, predicted) {
  if (actual.length !== predicted.length) {
    const len = Math.min(actual.length, predicted.length);
    actual    = actual.slice(0, len);
    predicted = predicted.slice(0, len);
  }
  const n    = actual.length;
  const mean = ss.mean(actual);
  let sse = 0, sst = 0, sae = 0;
  for (let i = 0; i < n; i++) {
    const e = actual[i] - predicted[i];
    sse += e * e;
    sst += (actual[i] - mean) ** 2;
    sae += Math.abs(e);
  }
  return {
    RMSE: Math.round(Math.sqrt(sse / n) * 1e4) / 1e4,
    MAE:  Math.round((sae / n) * 1e4) / 1e4,
    R2:   Math.round((1 - sse / (sst || 1)) * 1e4) / 1e4,
  };
}

function saveJSON (name, data) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

module.exports = {
  ROOT, DATA_DIR, OUT_DIR, ensureDirs,
  loadSeaLevel, generateDemoSeaLevel, generateDemoIslands,
  addMonths, dateStr, metrics, saveJSON,
};
