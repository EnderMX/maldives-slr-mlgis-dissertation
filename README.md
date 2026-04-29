# PROTEUS
### Predictive Risk and Ocean Trend Evaluation for Uninhabited and Settled islands

MSc Dissertation, Mohamed Zidane Mahmood (S1701391)  
Villa College / University of the West of England, Bristol  
Module: UFCF9Y-60-M | April 2026

---

## What this is

PROTEUS is a machine learning and GIS platform for predicting sea level rise impact across all 181 inhabited Maldivian islands. Named after the ancient Greek sea deity who personified elusive sea change, the platform makes that change visible and quantifiable for climate adaptation planning.

The three components are:

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
- 291,604 people at risk
- With storm surge: 89.9% of land, 462,373 people

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
# Inhabited islands only (default, produces data/islands.json):
python scripts/fetch_onemap_arcgis.py

# All islands including uninhabited (produces data/islands_all.json):
# Required to enable the "Show all islands" toggle on the Rankings page
python scripts/fetch_onemap_arcgis.py --all

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

Mahmood, M.Z. (2026) *PROTEUS: Predictive Risk and Ocean Trend Evaluation for Uninhabited and Settled islands. Predicting Sea Level Rise Impact on Maldivian Islands: A Machine Learning Approach for Climate Adaptation Planning.* MSc Dissertation, Villa College / University of the West of England, Bristol. UFCF9Y-60-M.

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

This hits the OneMap public ArcGIS endpoint, fetches all island polygon features, filters to the 181 inhabited islands, and writes real GPS polygon centroids to islands.json. It takes about 30-60 seconds and requires an internet connection. After it finishes, re-run the analysis to regenerate outputs with the updated coordinates:

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

---

## Glossary

| Term | Full name | What it means |
|---|---|---|
| RMSE | Root Mean Square Error | Average prediction error in centimetres. Lower is better. The Ensemble achieves 4.37 cm. |
| MAE | Mean Absolute Error | Average absolute error in centimetres. Less sensitive to large outliers than RMSE. |
| R2 / NSE | R-squared / Nash-Sutcliffe Efficiency | How much of the observed variance the model explains. 1.0 = perfect, 0 = no better than predicting the mean, below 0 = worse than the mean. |
| MAPE | Mean Absolute Percentage Error | Error as a percentage of the mean absolute anomaly (5.11 cm). Lower is better. |
| Skill Score | Skill Score vs persistence | Improvement over a naive forecast that just predicts last month's value. Above 0 = better than persistence. The Ensemble scores 0.07 (modest, because the rising tide trend during the test period also benefits the naive persistence baseline). |
| F1 Score | F1 Score | Accuracy of detecting months when sea level exceeds the +4.5 cm detrended anomaly threshold (flood warning task). Balances precision and recall. 1.0 = perfect. |
| LSTM | Long Short-Term Memory | A type of recurrent neural network that can remember patterns over long time periods. Used here for sea level forecasting. |
| Hybrid LSTM | Hybrid LSTM | LSTM model that uses sea level data plus climate indices (ONI and DMI) as inputs. |
| Ensemble | Ensemble model | Weighted average of LSTM (60%) and Hybrid LSTM (40%). The best-performing model in this study. |
| ARIMA | AutoRegressive Integrated Moving Average | Classical statistical time series model. Used as a baseline. |
| ONI | Oceanic Nino Index | Monthly index measuring El Nino and La Nina strength in the Pacific. Affects Indian Ocean sea levels. |
| DMI | Dipole Mode Index | Monthly index measuring the Indian Ocean Dipole. A positive IOD event (2019-2020) caused the largest sea level anomalies in the test period. |
| IOD | Indian Ocean Dipole | A coupled ocean-atmosphere pattern in the Indian Ocean that drives multi-year sea level variability in the Maldives. |
| ENSO | El Nino-Southern Oscillation | Pacific climate pattern with global effects. Correlated with Indian Ocean sea level via the ONI index. |
| VI | Vulnerability Index | Composite score (0 to 1) for each island: 0.5 x land flooded + 0.3 x normalised population + 0.2 x (1/island area). Higher = more vulnerable. |
| SSP | Shared Socioeconomic Pathway | IPCC AR6 climate scenarios. SSP1-2.6 = low emissions, SSP5-8.5 = high emissions. |
| IPCC AR6 | Intergovernmental Panel on Climate Change Sixth Assessment Report | The authoritative international scientific assessment of climate change, published 2021. |
| SLR | Sea Level Rise | The increase in mean sea level over time due to thermal expansion and ice melt. |
| GIS | Geographic Information System | Software and methods for capturing, storing, and analysing spatial data. Used here for flood inundation mapping. |
| SRTM | Shuttle Radar Topography Mission | NASA satellite elevation data at 30m resolution. Used to estimate island elevation in the absence of national LiDAR coverage. |
| OneMap | OneMap Maldives | The official national mapping platform of the Maldives government, providing island boundary and registry data via an ArcGIS FeatureServer API. |
| UHSLC | University of Hawaii Sea Level Center | Maintains the 38-year tide gauge record at Male (Station 108) used to train all ML models. |
| Bathtub model | Bathtub inundation model | Simple flood model that classifies all land below a sea level threshold as inundated. Used for national-scale screening. |

---

