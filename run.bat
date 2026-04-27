@echo off
setlocal enabledelayedexpansion
title Maldives SLR Analysis Pipeline

echo.
echo ============================================================
echo   Maldives Sea Level Rise Analysis Pipeline
echo   Mohamed Zidane Mahmood ^| S1701391 ^| April 2026
echo ============================================================
echo.

:: Check prerequisites

echo [1/6] Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Node.js not found. Download from https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo   Node.js: %%v

where python >nul 2>&1
if errorlevel 1 (
    where python3 >nul 2>&1
    if errorlevel 1 (
        echo   ERROR: Python not found. Download from https://python.org
        pause & exit /b 1
    )
    set PYTHON=python3
) else (
    set PYTHON=python
)
for /f "tokens=*" %%v in ('!PYTHON! --version') do echo   Python: %%v

where npm >nul 2>&1
if errorlevel 1 (
    echo   ERROR: npm not found. Reinstall Node.js from https://nodejs.org
    pause & exit /b 1
)
echo   All prerequisites found.
echo.

:: Install dependencies

echo [2/6] Installing Node.js dependencies...
call npm install
if errorlevel 1 (
    echo   ERROR: npm install failed.
    pause & exit /b 1
)
echo   npm install complete.
echo.

echo [3/6] Installing Python dependencies...
!PYTHON! -m pip install -r requirements.txt --break-system-packages -q 2>nul
if errorlevel 1 (
    !PYTHON! -m pip install -r requirements.txt -q
    if errorlevel 1 (
        echo   WARNING: Some Python packages may not have installed correctly.
        echo   Try manually: pip install xgboost scikit-learn pandas numpy
    )
)
echo   Python packages ready.
echo.

:: Convert real data if available

echo [4/6] Checking for real data files...

set REAL_DATA=0

:: ONI
if exist "data\oni_ascii.txt" (
    echo   Found data\oni_ascii.txt - converting ONI...
    !PYTHON! scripts\convert_oni.py
    set REAL_DATA=1
) else (
    if exist "data\oni.csv" (
        echo   data\oni.csv already present - using existing.
    ) else (
        echo   No ONI data found - will use built-in values.
        echo   To use real data: download https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
        echo   and save as data\oni_ascii.txt
    )
)

:: DMI
if exist "data\dmi_had_long.data" (
    echo   Found data\dmi_had_long.data - converting DMI...
    !PYTHON! scripts\convert_dmi.py
    set REAL_DATA=1
) else (
    if exist "data\dmi.csv" (
        echo   data\dmi.csv already present - using existing.
    ) else (
        echo   No DMI data found - will use built-in values.
        echo   To use real data: download https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data
        echo   and save as data\dmi_had_long.data
    )
)

:: Sea level
if exist "data\rq108a.dat" (
    echo   Found data\rq108a.dat - UHSLC Research Quality data will be used.
    set REAL_DATA=1
) else if exist "data\fd108a.dat" (
    echo   Found data\fd108a.dat - UHSLC Fast Delivery data will be used.
    set REAL_DATA=1
) else if exist "data\male_sealevel.csv" (
    echo   data\male_sealevel.csv present - using existing sea level data.
) else (
    echo   No sea level data found - demo data will be generated.
    echo   To use real data: download from https://uhslc.soest.hawaii.edu/stations/?stn=108
    echo   and save rq108a.dat and fd108a.dat into data\
)

:: OneMap, fetch real GPS island coordinates from public ArcGIS FeatureServer
echo   Fetching real island coordinates from OneMap ArcGIS...
echo   (requires internet, ~30-60 seconds ) skip with Ctrl+C if offline)
!PYTHON! scripts\fetch_onemap_arcgis.py
if errorlevel 1 (
    echo   WARNING: OneMap fetch failed. Using existing islands.json coordinates.

:: OneMap: fetch all islands including uninhabited (for extended rankings view)
echo   Fetching all island features from OneMap ArcGIS...

!PYTHON! scripts\fetch_onemap_arcgis.py --all

    echo   WARNING: All-islands fetch failed. Extended rankings will be unavailable.

    echo   All island coordinates updated.
    echo   Map will show atoll-level estimates instead of exact GPS positions.
) else (
    echo   OneMap coordinates updated successfully.
    set REAL_DATA=1
)

echo.

:: Run analysis

echo [5/6] Running analysis...
echo.
echo   Phase 1: GIS flood inundation + Phase 2: LSTM models
echo   (this takes approximately 5 minutes)
echo.

call npm run analyse
if errorlevel 1 (
    echo   ERROR: npm run analyse failed. Check the output above for details.
    pause & exit /b 1
)

echo.
echo   Phase 2 continued: Random Forest, Gradient Boosting, XGBoost
echo   (approximately 2 minutes)
echo.

!PYTHON! scripts\ml_advanced.py
if errorlevel 1 (
    echo   WARNING: ml_advanced.py had errors. Tree models may be missing.
    echo   Dashboard will still work with LSTM models only.
)

echo.
echo   Analysis complete. Outputs written to outputs\
echo.

:: Summary of outputs

echo -- Output files ------------------------------------------------
if exist "outputs\phase1_summary.json"       echo   [OK] outputs\phase1_summary.json
if exist "outputs\all_scenarios.json"        echo   [OK] outputs\all_scenarios.json
if exist "outputs\sea_level_projections.json" echo   [OK] outputs\sea_level_projections.json
if exist "outputs\historical_sealevel.json"  echo   [OK] outputs\historical_sealevel.json
if exist "outputs\test_forecasts.json"       echo   [OK] outputs\test_forecasts.json
if exist "outputs\ml_metrics.json"           echo   [OK] outputs\ml_metrics.json
echo ----------------------------------------------------------------
echo.

:: Start dashboard

echo [6/6] Starting dashboard...
echo.
echo   Dashboard will open at: http://localhost:3000
echo   Press Ctrl+C in this window to stop the server.
echo.

:: Open browser after 2 second delay
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

node server.js

echo.
echo Server stopped.
pause
