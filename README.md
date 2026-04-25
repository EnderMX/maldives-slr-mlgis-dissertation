# Maldives Sea Level Rise Dashboard

MSc Dissertation, Mohamed Zidane Mahmood (S1701391)  
Villa College / University of the West of England, Bristol  
Module: UFCF9Y-60-M | April 2026

---

## What this is

This is the code and data for my MSc dissertation. The project looks at how much of the Maldives would be flooded under different sea level rise scenarios, and builds machine learning models to forecast future sea levels using real tide gauge data. Everything is pulled together in an interactive dashboard built with Node.js.

The three main parts are:

- GIS flood modelling across all 181 inhabited islands under 5 IPCC scenarios
- 8 machine learning models trained on 38 years of real tide gauge data from Male
- A web dashboard using the official OneMap island boundary data from the Maldives government

---

## Results

**Best ML model: Ensemble (LSTM + Hybrid LSTM)**

| Model | RMSE (cm) | R2 |
|---|---|---|
| Ensemble (best) | 4.37 | 0.535 |
| Hybrid LSTM | 4.38 | 0.534 |
| LSTM | 4.58 | 0.490 |
| Random Forest | 5.61 | 0.235 |
| Gradient Boosting | 5.98 | 0.130 |
| XGBoost | 5.99 | 0.128 |
| ARIMA | 11.90 | -2.44 |
| Prophet | 10.18 | -1.52 |

**Flood exposure under worst case (SSP5-8.5 2100):**

- 70.6% of national land area flooded
- 294,718 people at risk
- With storm surge: 89.9% of land, 465,223 people

---

## Running it

### Requirements

- Node.js 18+
- Python 3.9+

### Windows (easiest)

Double-click `run.bat`. It handles everything including installing dependencies, fetching island coordinates from OneMap, running the models, and starting the dashboard.

### Manual

```bash
# Install
npm install
pip install -r requirements.txt

# Fetch real island GPS coordinates from OneMap (optional but recommended)
python scripts/fetch_onemap_arcgis.py

# Run the analysis (takes about 5-7 minutes)
npm run analyse
python scripts/ml_advanced.py

# Start the dashboard
node server.js
```

Open http://localhost:3000 in your browser.

---

## Files

```
data/
  male_sealevel.csv       38 years of tide gauge data from Male (UHSLC Station 108)
  oni.csv                 NOAA monthly Oceanic Nino Index
  dmi.csv                 NOAA monthly Dipole Mode Index
  islands.json            181 inhabited islands with populations and coordinates

scripts/
  phase1_gis.js           Flood inundation model and vulnerability index
  phase2_ml.js            ARIMA, Prophet, LSTM, Hybrid LSTM, Ensemble
  ml_advanced.py          Random Forest, Gradient Boosting, XGBoost
  fetch_onemap_arcgis.py  Downloads real island boundaries from OneMap
  climate_indices.js      Loads ONI and DMI data
  run_all.js              Runs the full pipeline

public/
  index.html              Dashboard (5 pages)
  js/dashboard.js         Chart.js charts and rankings table
  js/onemap.js            ArcGIS map with flood bubbles

outputs/                  Pre-computed results (dashboard works immediately after cloning)
server.js                 Express server
run.bat                   One-click setup for Windows
setup_git.bat             Pushes the repo to GitHub
```

---

## Data sources

| Data | Source |
|---|---|
| Tide gauge data (Male Station 108) | University of Hawaii Sea Level Center |
| Oceanic Nino Index | NOAA Climate Prediction Center |
| Dipole Mode Index | NOAA Physical Sciences Laboratory |
| Island boundaries and registry | OneMap (onemap.mv) |
| Population figures | Maldives Census 2022 |
| Sea level scenarios | IPCC AR6 (2021) |

---

## Citation

Mahmood, M.Z. (2026) *Predicting Sea Level Rise Impact on Maldivian Islands: A Machine Learning Approach for Climate Adaptation Planning.* MSc Dissertation, Villa College / University of the West of England, Bristol. UFCF9Y-60-M.

---

## Using real data

The repo already includes real data for everything except the tide gauge raw files. Here is what you need to check or replace.

### Sea level data (already included)

`data/male_sealevel.csv` is the real UHSLC tide gauge record from Male, Station 108. 423 months from October 1989 to February 2026. Nothing to do here.

If you want to pull a fresh copy directly:

1. Go to https://uhslc.soest.hawaii.edu/stations/?stn=108
2. Download the Research Quality file (`rq108a.dat`) and the Fast Delivery file (`fd108a.dat`)
3. Drop both into the `data/` folder and delete `male_sealevel.csv`
4. The pipeline will detect and use the raw files automatically

### Climate index data (already included)

`data/oni.csv` and `data/dmi.csv` are already real NOAA data. Nothing to do here either.

To pull fresh copies:

**ONI:** Download https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt, save as `data/oni_ascii.txt`, then run:

```bash
python scripts/convert_oni.py
```

**DMI:** Download https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data, save as `data/dmi_had_long.data`, then run:

```bash
python scripts/convert_dmi.py
```

### Island coordinates (fetch from OneMap)

`data/islands.json` currently has real island names and Census populations, but coordinates come from OneMap live. To refresh:

```bash
python scripts/fetch_onemap_arcgis.py
```

This hits the OneMap public ArcGIS endpoint and downloads real GPS polygon centroids for all 1,560 island features. It takes about 30-60 seconds and requires an internet connection. After it finishes, re-run the analysis to regenerate outputs with the updated coordinates:

```bash
npm run analyse
python scripts/ml_advanced.py
```

This step runs automatically when you use `run.bat`.

### Summary: what is real vs approximate

| Data | Status |
|---|---|
| Tide gauge record (Male) | Real, 423 months, UHSLC Station 108 |
| ONI climate index | Real, monthly NOAA CPC |
| DMI climate index | Real, monthly NOAA PSL |
| Island names and populations | Real, Census 2022 |
| Island coordinates | Real, fetched from OneMap (auto on run.bat) |
| Island elevation | Parameterised from published national averages |
