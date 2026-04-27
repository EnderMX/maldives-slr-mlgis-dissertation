/**
 * phase1_gis.js  -  GIS Flood Inundation Modelling
 *
 * Bathtub model: for each island, computes the fraction of land area
 * inundated at a given SLR threshold using the island's elevation profile.
 *
 * With real data: swap the bathtub() function body for rasterio/gdal logic
 * (see commented instructions inside the function).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { DATA_DIR, OUT_DIR, saveJSON, ensureDirs } = require('./utils');

// IPCC AR6 scenarios: sea level rise in metres above 1995-2014 mean
const SCENARIOS = {
  'SSP1-2.6_2050': 0.30,
  'SSP1-2.6_2100': 0.50,
  'SSP5-8.5_2050': 0.50,
  'SSP5-8.5_2100': 1.00,
  // Storm surge compound scenarios: SLR + 100-yr return period surge (~0.5m for Maldives)
  // Based on: Amores et al. (2021) wave climate modelling for the Maldives
  'SSP5-8.5_2100_surge': 1.50,
};

// Bathtub model
function bathtub (island, slr_m) {
  /*
   * REAL DATA IMPLEMENTATION (when SRTM .tif + OneMap GeoJSON are available):
   *
   * const gdal = require('gdal-async');   // npm install gdal-async
   * const ds   = gdal.open('data/maldives_srtm.tif');
   * const band = ds.bands.get(1);
   * const geom = island.geometry;  // GeoJSON polygon from OneMap
   * // Clip DEM to island polygon, count pixels <= slr_m
   * // -> fracInundated = inundatedPixels / totalPixels
   *
   * For now: parameterised model based on published elevation statistics.
   */

  const { mean_elev_m: meanE, max_elev_m: maxE, frac_lt1m: flt1, area_km2, population } = island;

  let frac;
  if   (slr_m >= maxE)  frac = 1.0;
  else if (slr_m <= 0)  frac = 0.0;
  else if (slr_m <= 1.0) frac = flt1 * (slr_m / 1.0);
  else                  frac = flt1 + (1 - flt1) * ((slr_m - 1.0) / (maxE - 1.0));

  frac = Math.min(1, Math.max(0, frac));

  return {
    island_id:          island.id,
    island_name:        island.name,
    atoll:              island.atoll,
    lat:                island.lat,
    lon:                island.lon,
    area_km2,
    population,
    slr_m,
    area_inundated_km2: Math.round(area_km2 * frac * 1e4) / 1e4,
    frac_inundated:     Math.round(frac * 1e4) / 1e4,
    pct_inundated:      Math.round(frac * 100 * 100) / 100,
    pop_at_risk:        Math.round(population * frac),
    pct_pop_at_risk:    Math.round(frac * 100 * 100) / 100,
  };
}

// Vulnerability Index
function computeVI (rows) {
  // Normalise sub-indicators to [0,1]
  const norm = (arr) => {
    const mn = Math.min(...arr), mx = Math.max(...arr);
    return mx > mn ? arr.map(v => (v - mn) / (mx - mn)) : arr.map(() => 0);
  };

  const nLand = norm(rows.map(r => r.pct_inundated));
  const nPop  = norm(rows.map(r => r.pct_pop_at_risk));
  const nSize = norm(rows.map(r => r.area_km2)).map(v => 1 - v); // inverse

  rows.forEach((r, i) => {
    r.vulnerability_index = Math.round((0.5 * nLand[i] + 0.3 * nPop[i] + 0.2 * nSize[i]) * 1e4) / 1e4;
  });

  // Rank (1 = most vulnerable)
  const sorted = [...rows].sort((a, b) => b.vulnerability_index - a.vulnerability_index);
  sorted.forEach((r, i) => { r.vi_rank = i + 1; });

  return rows;
}

// Summary stats
function summarise (rows) {
  const totalArea = rows.reduce((s, r) => s + r.area_km2, 0);
  const totalPop  = rows.reduce((s, r) => s + r.population, 0);
  const inundArea = rows.reduce((s, r) => s + r.area_inundated_km2, 0);
  const popRisk   = rows.reduce((s, r) => s + r.pop_at_risk, 0);

  const top5 = [...rows]
    .sort((a, b) => b.vulnerability_index - a.vulnerability_index)
    .slice(0, 5)
    .map(r => ({ name: r.island_name, atoll: r.atoll, vi: r.vulnerability_index, pct: r.pct_inundated }));

  return {
    n_islands:           rows.length,
    total_area_km2:      Math.round(totalArea * 100) / 100,
    inundated_area_km2:  Math.round(inundArea * 100) / 100,
    pct_land_inundated:  Math.round(inundArea / totalArea * 10000) / 100,
    total_population:    totalPop,
    pop_at_risk:         popRisk,
    pct_pop_at_risk:     Math.round(popRisk / totalPop * 10000) / 100,
    n_islands_gt50pct:   rows.filter(r => r.pct_inundated > 50).length,
    n_islands_gt80pct:   rows.filter(r => r.pct_inundated > 80).length,
    top5_vulnerable:     top5,
  };
}

// Main
function runPhase1 (islands, suffix = '') {
  ensureDirs();
  console.log('\n-- Phase 1: GIS Flood Inundation ------------------------');
  console.log(`  Islands loaded: ${islands.length}`);

  const allResults  = {};
  const summaryAll  = {};

  for (const [scenario, slr] of Object.entries(SCENARIOS)) {
    process.stdout.write(`  >> ${scenario}  (+${slr}m) ... `);

    let rows = islands.map(island => bathtub(island, slr));
    rows = computeVI(rows);

    const summary = summarise(rows);
    summaryAll[scenario] = summary;
    allResults[scenario] = rows;

    saveJSON(`${scenario}_vulnerability${suffix}.json`, rows);
    console.log(`done  [${summary.pct_land_inundated}% land  |  ${summary.pop_at_risk.toLocaleString()} people]`);
  }

  saveJSON('all_scenarios.json', allResults);
  saveJSON('phase1_summary.json', summaryAll);

  console.log('  [OK] Phase 1 complete');
  return { results: allResults, summary: summaryAll };
}

module.exports = { runPhase1, SCENARIOS };
