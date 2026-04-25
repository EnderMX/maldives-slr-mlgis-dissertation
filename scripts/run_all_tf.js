/**
 * run_all_tf.js  –  Run full analysis using TensorFlow.js (proper BPTT)
 *
 * PREREQUISITES (one-time):
 *   npm install @tensorflow/tfjs-node
 *   (requires Python + build tools for native C++ binding — 10–20× faster than pure JS)
 *
 * Then run:
 *   node scripts/run_all_tf.js
 *
 * Expected training time with tfjs-node: ~3–5 minutes total
 * Expected training time with tfjs (pure JS): ~20–30 minutes total
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const {
  DATA_DIR, OUT_DIR, ensureDirs,
  loadSeaLevel, generateDemoSeaLevel, generateDemoIslands,
  saveJSON,
} = require('./utils');

const { runPhase1 } = require('./phase1_gis');
const { runPhase2 } = require('./phase2_tf');
const { generateClimateIndices, loadClimateIndex } = require('./climate_indices');

async function main() {
  console.log('='.repeat(60));
  console.log('  Maldives SLR Analysis — TensorFlow.js Mode');
  console.log('  Mohamed Zidane Mahmood  |  S1701391  |  April 2026');
  console.log('='.repeat(60));

  ensureDirs();

  // ── Sea level data ────────────────────────────────────────────────────────
  const slPaths = [
    path.join(DATA_DIR, 'male_sealevel.csv'),
    path.join(DATA_DIR, 'male_sealevel.dat'),
    path.join(DATA_DIR, 'rq108a.dat'),
    path.join(DATA_DIR, 'fd108a.dat'),
  ];
  const slPath  = slPaths.find(p => fs.existsSync(p)) || generateDemoSeaLevel();
  console.log(`\n  Sea level data: ${path.basename(slPath)}`);
  const seaLevel = loadSeaLevel(slPath);
  console.log(`  Records: ${seaLevel.length}  (${seaLevel[0].date.getFullYear()}–${seaLevel[seaLevel.length-1].date.getFullYear()})`);

  // ── Island data ───────────────────────────────────────────────────────────
  const islandPath = path.join(DATA_DIR, 'islands.json');
  if (!fs.existsSync(islandPath)) generateDemoIslands();
  const islands = JSON.parse(fs.readFileSync(islandPath));
  console.log(`  Islands: ${islands.length}`);

  // ── Climate indices ───────────────────────────────────────────────────────
  const { oniPath, dmiPath } = generateClimateIndices();
  const oniMap = loadClimateIndex(oniPath, 'oni');
  const dmiMap = loadClimateIndex(dmiPath, 'dmi');
  console.log(`  Climate indices: ${Object.keys(oniMap).length} months ONI, ${Object.keys(dmiMap).length} months DMI`);

  // ── Phase 1: GIS ──────────────────────────────────────────────────────────
  const { summary: phase1Summary } = runPhase1(islands);

  // ── Phase 2: TF.js ML ────────────────────────────────────────────────────
  const { metrics } = await runPhase2(seaLevel, { oniMap, dmiMap });

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = { phase1: phase1Summary, ml_metrics: metrics };
  saveJSON('summary.json', summary);

  console.log('\n── Results ──────────────────────────────────────────────');
  for (const [scen, s] of Object.entries(phase1Summary)) {
    console.log(`  ${scen.padEnd(18)} | ${s.pct_land_inundated}% land | ${s.pop_at_risk.toLocaleString()} people`);
  }
  const sorted = [...metrics].sort((a,b) => a.RMSE_cm - b.RMSE_cm);
  console.log(`\n  Best model: ${sorted[0].Model} (RMSE=${sorted[0].RMSE_cm}cm, R²=${sorted[0].R2})`);
  console.log('\n  Start dashboard: node server.js');
  console.log('='.repeat(60));
}

main().catch(err => { console.error(err); process.exit(1); });
