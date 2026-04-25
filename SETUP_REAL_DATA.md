# Maldives SLR, Real Data Setup Guide

Complete walkthrough for replacing demo data with real data and running the full analysis.

---

## Step 1, Download UHSLC Sea Level Data

Go to: https://uhslc.soest.hawaii.edu/stations/?stn=108

Download two files:
- **Research Quality** → `rq108a.dat`
- **Fast Delivery** → `fd108a.dat`

Place both in your `data/` folder:
```
data/
  rq108a.dat
  fd108a.dat
```

The pipeline detects these automatically. Delete `male_sealevel.csv` if it exists so the real files take priority.

---

## Step 2, Download Real ONI and DMI Climate Indices

### ONI (El Niño ) NOAA CPC)

Go to: https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt

Save the file as `data/oni_ascii.txt`, then run the converter:

```powershell
python scripts/convert_oni.py
```

This produces `data/oni.csv` in the format the pipeline expects.

### DMI (Indian Ocean Dipole ) NOAA PSL)

Go to: https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data

Save the file as `data/dmi_had_long.data`, then run the converter:

```powershell
python scripts/convert_dmi.py
```

This produces `data/dmi.csv`.

> If you already have `data/oni.csv` and `data/dmi.csv` from the repo, these are already real NOAA data, skip this step.

---

## Step 3, Download Real Island Data from OneMap

Go to: https://onemap.mv

Download the island boundary layer as GeoJSON. Save it to the project folder as `maldives_islands.geojson`, then run:

```powershell
python scripts/convert_onemap.py
```

This replaces `data/islands.json` with real island names, real coordinates, and real land areas.

> **If OneMap is unavailable:** The current `data/islands.json` already has real island names for all 20 atolls including all 14 Shaviyani islands (Funadhoo, Bileffahi, Maaungoodhoo etc.). Only the coordinates are approximate, they use real atoll bounding boxes rather than exact GPS centroids.

---

## Step 4, Install Dependencies

```powershell
npm install
pip install -r requirements.txt
```

---

## Step 5, Run the Full Analysis

Run these in order:

```powershell
# Phase 1: GIS flood inundation + Phase 2: LSTM models (~5 min)
npm run analyse

# Phase 2 continued: Random Forest, Gradient Boosting, XGBoost (~2 min)
npm run analyse:advanced
```

Or run both at once:
```powershell
npm run analyse:all
```

---

## Step 6, Start the Dashboard

```powershell
node server.js
```

Open: **http://localhost:3000**

---

## What Each Output File Contains

| File in `outputs/` | Contents |
|---|---|
| `phase1_summary.json` | GIS flood stats per scenario (% land, pop at risk) |
| `all_scenarios.json` | Per-island vulnerability data for all 5 scenarios |
| `SSP*_vulnerability.json` | Individual scenario island results |
| `sea_level_projections.json` | ML projections to 2100 (all 8 models) |
| `historical_sealevel.json` | Processed UHSLC tide gauge record |
| `test_forecasts.json` | Model predictions on 2018–2026 test set |
| `ml_metrics.json` | RMSE, MAE, R² for all models |
| `summary.json` | Combined Phase 1 + Phase 2 summary |

---

## Data Sources Summary

| Data | Real or Demo | Source |
|---|---|---|
| Sea level (Male Station 108) | **Real** (438 months, 1988–2026) | UHSLC |
| ONI climate index | **Real** (NOAA CPC monthly) | NOAA CPC |
| DMI climate index | **Real** (NOAA PSL monthly) | NOAA PSL |
| Island names | **Real** (all 20 atolls) | Census 2022 / published sources |
| Island coordinates | Approximate (real atoll bounding boxes) | Published Maldives charts |
| Island elevation | Parameterised from published stats | Sakamoto et al. (2022) |
| Exact GPS + elevation | Requires OneMap GeoJSON | onemap.mv |

---

## Upgrade Path: Exact Island Coordinates

Once you have the OneMap GeoJSON, run:

```powershell
python scripts/convert_onemap.py
npm run analyse
node server.js
```

This upgrades from approximate to exact coordinates and real elevation profiles. No other code changes needed.
