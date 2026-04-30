/**
 * run_all.js  -  Entry point: run Phase 1 + Phase 2, write all outputs
 *
 * Usage:  node scripts/run_all.js
 *
 * REAL DATA:
 *   Save UHSLC tide gauge data to:  data/male_sealevel.csv  (or .dat)
 *   Save OneMap island data to:     data/islands.json
 *   -> The script will use real data automatically if those files exist.
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
const { runPhase2 } = require('./phase2_ml');
const { generateClimateIndices, loadClimateIndex } = require('./climate_indices');

async function main () {
  console.log('='.repeat(60));
  console.log('  Maldives Sea Level Rise Analysis');
  console.log('  Mohamed Zidane Mahmood  |  S1701391  |  April 2026');
  console.log('='.repeat(60));

  ensureDirs();

  // Check if valid pre-computed outputs already exist.
  // Skip recomputation unless --force is passed.
  // This ensures the dashboard always shows the correct pre-committed results.
  const forceRecompute = process.argv.includes('--force');
  const p1SummaryPath = path.join(OUT_DIR, 'phase1_summary.json');
  const mlMetricsPath = path.join(OUT_DIR, 'ml_metrics.json');
  const allScenariosPath = path.join(OUT_DIR, 'all_scenarios.json');

  if (!forceRecompute &&
      fs.existsSync(p1SummaryPath) &&
      fs.existsSync(mlMetricsPath) &&
      fs.existsSync(allScenariosPath)) {
    try {
      const p1 = JSON.parse(fs.readFileSync(p1SummaryPath, 'utf8'));
      const ssp85 = p1['SSP5-8.5_2100'];
      if (ssp85 && ssp85.pop_at_risk > 200000 && ssp85.n_islands >= 150) {
        console.log('\n  [OK] Valid pre-computed outputs found. Skipping recomputation.');
        console.log('       Run with --force to regenerate: node scripts/run_all.js --force');
        console.log('\n-- Results Summary (pre-computed) ----------------------------');
        console.log('  Note: SSP1-2.6_2100 and SSP5-8.5_2050 both use +0.5m SLR -- identical by design');
        for (const [scen, s] of Object.entries(p1)) {
          console.log(`  ${scen.padEnd(22)} | ${s.pct_land_inundated}% land | ${s.pop_at_risk.toLocaleString()} people at risk`);
        }
        console.log('\n-- Done (pre-computed) -----------------------------------------');
        console.log('  Start dashboard: node server.js  (then open http://localhost:3000)');
        console.log('='.repeat(60));
        return;
      }
    } catch (e) { /* invalid JSON, fall through to recompute */ }
  }

  if (forceRecompute) {
    console.log('\n  --force flag detected. Recomputing all outputs...');
  }

  // Load or generate sea level data
  const slPaths = [
    path.join(DATA_DIR, 'male_sealevel.csv'),
    path.join(DATA_DIR, 'male_sealevel.dat'),
    path.join(DATA_DIR, 'rq108a.dat'),
    path.join(DATA_DIR, 'fd108a.dat'),
  ];
  const slPath = slPaths.find(p => fs.existsSync(p)) || generateDemoSeaLevel();
  console.log(`\n  Sea level data: ${path.basename(slPath)}`);
  const seaLevel = loadSeaLevel(slPath);
  console.log(`  Records: ${seaLevel.length}  (${seaLevel[0].date.getFullYear()}-${seaLevel[seaLevel.length-1].date.getFullYear()})`);

  // Load or generate island data
  const islandPath = path.join(DATA_DIR, 'islands.json');
  if (!fs.existsSync(islandPath)) generateDemoIslands();
  const islands = JSON.parse(fs.readFileSync(islandPath));

  // Also run GIS for all islands (including uninhabited) if islands_all.json exists
  const islandAllPath = path.join(DATA_DIR, 'islands_all.json');
  if (fs.existsSync(islandAllPath)) {
    console.log('  Found islands_all.json - running GIS for all islands...');
    const islandsAll = JSON.parse(fs.readFileSync(islandAllPath));
    const { summary: phase1SummaryAll } = runPhase1(islandsAll, '_all');
    console.log('  [OK] All-islands GIS complete');
  }
  console.log(`  Islands: ${islands.length}`);

  // Load or generate climate indices
  const { oniPath, dmiPath } = generateClimateIndices();
  const oniMap = loadClimateIndex(oniPath, 'oni');
  const dmiMap = loadClimateIndex(dmiPath, 'dmi');
  console.log(`  Climate indices: ${Object.keys(oniMap).length} months ONI, ${Object.keys(dmiMap).length} months DMI`);

  // Phase 1
  const { summary: phase1Summary } = runPhase1(islands);

  // Phase 2
  const { metrics } = await runPhase2(seaLevel, { oniMap, dmiMap });

  // Combined summary
  const summary = { phase1: phase1Summary, ml_metrics: metrics };
  saveJSON('summary.json', summary);

  // Print key results
  console.log('\n-- Results Summary (land % = area-based, pop = Census 2022) ----------');
  console.log('  Note: SSP1-2.6_2100 and SSP5-8.5_2050 both use +0.5m SLR -- identical by design');
  for (const [scen, s] of Object.entries(phase1Summary)) {
    console.log(`  ${scen.padEnd(18)} | ${s.pct_land_inundated}% land | ${s.pop_at_risk.toLocaleString()} people at risk`);
  }
  // Full metrics table
  const sorted = [...metrics].sort((a,b) => a.RMSE_cm - b.RMSE_cm);
  console.log('\n-- ML Model Performance (all metrics) -------------------');
  console.log('  Model                      RMSE(cm)  MAE(cm)  R2/NSE   F1    Skill');
  console.log('  ' + '-'.repeat(66));
  sorted.forEach(m => {
    const pad = (v, n) => String(v===undefined?'N/A':v).padEnd(n);
    const best = m.Model === sorted[0].Model ? ' <- BEST' : '';
    console.log(`  ${pad(m.Model,26)} ${pad(m.RMSE_cm,9)} ${pad(m.MAE_cm,8)} ${pad(m.R2,8)} ${pad(m.f1||'N/A',5)} ${pad(m.skill_score||'N/A',5)}${best}`);
  });
  console.log('\n  Best ML model:', sorted[0].Model,
    `(RMSE=${sorted[0].RMSE_cm}cm, R^2=${sorted[0].R2})`);

  console.log('\n-- Done -------------------------------------------------');
  console.log('  Outputs in ./outputs/');
  console.log('  Start dashboard: node server.js  (then open http://localhost:3000)');
  console.log('='.repeat(60));
}

main().catch(err => { console.error(err); process.exit(1); });
