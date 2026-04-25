"""
ml_advanced.py  -  Tree-based ML models for sea level prediction

Implements Random Forest, Gradient Boosting, and XGBoost using lag-based
feature engineering (MSL lags, ONI lags, DMI lags, rolling means, seasonality).
Results are merged into the same outputs/ JSON files as the LSTM models,
so the dashboard automatically shows all models together.

RUN ORDER:
    1. node scripts/run_all.js      (generates LSTM outputs first)
    2. python scripts/ml_advanced.py  (adds tree models on top)

Why tree models underperform LSTM here:
    The test period (2018-2026) contains an extreme out-of-distribution event
    (2019-2020 Indian Ocean Dipole, DMI peak = 0.964). Tree models interpolate
    within training-set boundaries and cannot extrapolate to unseen sea level
    heights. LSTM tracks a running hidden state that handles this shift better.

Requirements:
    pip install xgboost scikit-learn pandas numpy python-dateutil
"""

import os, json, warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from xgboost import XGBRegressor

os.makedirs('outputs', exist_ok=True)


def load_sealevel():
    df = pd.read_csv('data/male_sealevel.csv', parse_dates=['date'])
    df = df[df['msl_mm'] > 0].copy().sort_values('date').reset_index(drop=True)
    df['msl_cm'] = (df['msl_mm'] - df['msl_mm'].iloc[0]) / 10.0
    return df


def load_index(path, col):
    df = pd.read_csv(path, parse_dates=['date'])
    return {row['date'].to_period('M'): row[col] for _, row in df.iterrows()}


def calc_metrics(yt, yp):
    yt, yp = np.array(yt), np.array(yp)
    return {
        'RMSE': round(float(np.sqrt(mean_squared_error(yt, yp))), 4),
        'MAE':  round(float(mean_absolute_error(yt, yp)), 4),
        'R2':   round(float(r2_score(yt, yp)), 4),
    }


def build_features(df, oni, dmi):
    """
    Build a tabular feature matrix from the time series.
    Each row represents one month and contains:
      - MSL lag values (how high sea level was 1, 2, 3, 6, 12, 24 months ago)
      - Rolling mean MSL over 3 and 12 months (smoothed trend signal)
      - ONI and DMI lag values at known lead times (3-12 months)
      - Rolling mean climate indices over 3 months
      - Month of year (captures the seasonal cycle)
      - Linear time index t (captures the long-term trend)
    """
    rows = []
    for i in range(24, len(df)):
        row = df.iloc[i]
        f = {}
        for lag in [1, 2, 3, 6, 12, 24]:
            f[f'msl_lag{lag}'] = df.iloc[i - lag]['msl_cm']
        f['msl_roll3']  = df.iloc[i-3:i]['msl_cm'].mean()
        f['msl_roll12'] = df.iloc[i-12:i]['msl_cm'].mean()
        for lag in [1, 2, 3, 4, 5, 6, 9, 12]:
            prev = (row['date'] - relativedelta(months=lag)).to_period('M')
            f[f'oni_lag{lag}'] = oni.get(prev, 0.0)
            f[f'dmi_lag{lag}'] = dmi.get(prev, 0.0)
        f['oni_roll3'] = np.mean([oni.get((row['date'] - relativedelta(months=j)).to_period('M'), 0) for j in range(1, 4)])
        f['dmi_roll3'] = np.mean([dmi.get((row['date'] - relativedelta(months=j)).to_period('M'), 0) for j in range(1, 4)])
        f['month'] = row['date'].month
        f['t']     = i
        f['y']     = row['msl_cm']
        f['date']  = row['date']
        rows.append(f)
    return pd.DataFrame(rows)


def forecast_2100(model, df, oni, dmi, last_train_date, feat_cols, model_key):
    history = list(df['msl_cm'])
    cur = pd.Timestamp(last_train_date)
    out = []
    for _ in range((2100 - cur.year) * 12):
        cur = cur + relativedelta(months=1)
        f = {}
        for lag in [1, 2, 3, 6, 12, 24]:
            f[f'msl_lag{lag}'] = history[-lag] if lag <= len(history) else history[0]
        f['msl_roll3']  = np.mean(history[-3:])
        f['msl_roll12'] = np.mean(history[-12:])
        for lag in [1, 2, 3, 4, 5, 6, 9, 12]:
            prev = (cur - relativedelta(months=lag)).to_period('M')
            f[f'oni_lag{lag}'] = oni.get(prev, 0.0)
            f[f'dmi_lag{lag}'] = dmi.get(prev, 0.0)
        f['oni_roll3'] = np.mean([oni.get((cur - relativedelta(months=j)).to_period('M'), 0) for j in range(1, 4)])
        f['dmi_roll3'] = np.mean([dmi.get((cur - relativedelta(months=j)).to_period('M'), 0) for j in range(1, 4)])
        f['month'] = cur.month
        f['t']     = len(history)
        X = pd.DataFrame([f])[feat_cols]
        p = float(model.predict(X)[0])
        history.append(p)
        out.append({'date': cur.strftime('%Y-%m-%d'), model_key: round(p, 4)})
    return out


def main():
    print('=' * 60)
    print('  Advanced ML , Random Forest | Gradient Boosting | XGBoost')
    print('=' * 60)

    df  = load_sealevel()
    oni = load_index('data/oni.csv', 'oni')
    dmi = load_index('data/dmi.csv', 'dmi')
    print(f'\n  Records: {len(df)}  ({df.date.dt.year.min()}-{df.date.dt.year.max()})')

    feat_df   = build_features(df, oni, dmi)
    feat_cols = [c for c in feat_df.columns if c not in ['y', 'date']]
    split     = int(len(df) * 0.8)
    n_tr      = split - 24
    Xtr, ytr  = feat_df.iloc[:n_tr][feat_cols], feat_df.iloc[:n_tr]['y']
    Xte, yte  = feat_df.iloc[n_tr:][feat_cols], feat_df.iloc[n_tr:]['y']
    dates_te  = feat_df.iloc[n_tr:]['date']
    last_tr   = df.iloc[split - 1]['date']
    print(f'  Train: {len(Xtr)}  Test: {len(Xte)}  Features: {len(feat_cols)}\n')

    new_results = []

    # Random Forest
    print('  >> Fitting Random Forest ...')
    rf = RandomForestRegressor(n_estimators=500, max_depth=5, min_samples_leaf=8,
                                max_features=0.6, random_state=42, n_jobs=-1)
    rf.fit(Xtr, ytr)
    rf_p = rf.predict(Xte)
    rf_m = calc_metrics(yte, rf_p)
    print(f'     Metrics: RMSE={rf_m["RMSE"]}cm  MAE={rf_m["MAE"]}cm  R^2={rf_m["R2"]}')
    top3 = pd.Series(rf.feature_importances_, index=feat_cols).nlargest(3).index.tolist()
    print(f'     Top features: {", ".join(top3)}')
    new_results.append({'Model': 'Random Forest', 'RMSE_cm': rf_m['RMSE'], 'MAE_cm': rf_m['MAE'], 'R2': rf_m['R2'], 'Params': 'N/A'})

    # Gradient Boosting
    print('  >> Fitting Gradient Boosting ...')
    gb = GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05,
                                    subsample=0.8, min_samples_leaf=8, random_state=42)
    gb.fit(Xtr, ytr)
    gb_p = gb.predict(Xte)
    gb_m = calc_metrics(yte, gb_p)
    print(f'     Metrics: RMSE={gb_m["RMSE"]}cm  MAE={gb_m["MAE"]}cm  R^2={gb_m["R2"]}')
    new_results.append({'Model': 'Gradient Boosting', 'RMSE_cm': gb_m['RMSE'], 'MAE_cm': gb_m['MAE'], 'R2': gb_m['R2'], 'Params': 'N/A'})

    # XGBoost
    print('  >> Fitting XGBoost ...')
    xgb = XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8,
                        colsample_bytree=0.8, reg_lambda=2.0, min_child_weight=5,
                        random_state=42, verbosity=0)
    xgb.fit(Xtr, ytr)
    xgb_p = xgb.predict(Xte)
    xgb_m = calc_metrics(yte, xgb_p)
    print(f'     Metrics: RMSE={xgb_m["RMSE"]}cm  MAE={xgb_m["MAE"]}cm  R^2={xgb_m["R2"]}')
    new_results.append({'Model': 'XGBoost', 'RMSE_cm': xgb_m['RMSE'], 'MAE_cm': xgb_m['MAE'], 'R2': xgb_m['R2'], 'Params': 'N/A'})

    # Merge with existing
    existing = []
    if os.path.exists('outputs/ml_metrics.json'):
        with open('outputs/ml_metrics.json') as f:
            existing = json.load(f)
    merged = {r['Model']: r for r in existing}
    for r in new_results:
        merged[r['Model']] = r
    final = sorted(merged.values(), key=lambda r: -r['R2'])
    with open('outputs/ml_metrics.json', 'w') as f:
        json.dump(final, f, indent=2)

    # Future forecasts
    print('\n  Generating 2100 forecasts ...')
    for model, key, preds in [(rf, 'msl_cm_rf', rf_p), (gb, 'msl_cm_gb', gb_p), (xgb, 'msl_cm_xgb', xgb_p)]:
        fut = forecast_2100(model, df, oni, dmi, last_tr, feat_cols, key)
        if os.path.exists('outputs/sea_level_projections.json'):
            with open('outputs/sea_level_projections.json') as f:
                proj = {r['date']: r for r in json.load(f)}
        else:
            proj = {}
        for r in fut:
            proj.setdefault(r['date'], {'date': r['date']})
            proj[r['date']][key] = r[key]
        with open('outputs/sea_level_projections.json', 'w') as f:
            json.dump(sorted(proj.values(), key=lambda r: r['date']), f)

    # Test forecasts
    if os.path.exists('outputs/test_forecasts.json'):
        with open('outputs/test_forecasts.json') as f:
            tf = {r['date']: r for r in json.load(f)}
    else:
        tf = {}
    for date, rp, gp, xp in zip(dates_te, rf_p, gb_p, xgb_p):
        d = date.strftime('%Y-%m-%d')
        tf.setdefault(d, {'date': d})
        tf[d]['rf']  = round(float(rp), 4)
        tf[d]['gb']  = round(float(gp), 4)
        tf[d]['xgb'] = round(float(xp), 4)
    with open('outputs/test_forecasts.json', 'w') as f:
        json.dump(sorted(tf.values(), key=lambda r: r['date']), f)

    # Summary
    print('\n-- Final Rankings ---------------------------------------')
    for r in final:
        flag = ' <- BEST' if r == final[0] else ''
        print(f'  {r["Model"]:<26} | RMSE={str(r["RMSE_cm"]).ljust(7)} R^2={r["R2"]}{flag}')
    print('\n  [OK] Done. Restart dashboard: node server.js')
    print('=' * 60)


if __name__ == '__main__':
    main()
