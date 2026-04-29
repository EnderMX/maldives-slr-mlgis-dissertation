'use strict';

const state = {
  scenario: 'SSP5-8.5_2100',
  allScenarios: null,
  allScenariosAll: null,
  showAllIslands: false,
  summary: null,
  metrics: null,
  projections: null,
  historical: null,
  testFc: null,
  charts: {},
  mapInhabitedOnly: true,
};

const SCENARIO_LABELS = {
  'SSP1-2.6_2050': 'SSP1-2.6 · 2050 (+0.30m)',
  'SSP1-2.6_2100': 'SSP1-2.6 · 2100 (+0.50m)',
  'SSP5-8.5_2050': 'SSP5-8.5 · 2050 (+0.50m)',
  'SSP5-8.5_2100': 'SSP5-8.5 · 2100 (+1.00m)',
  'SSP5-8.5_2100_surge': 'SSP5-8.5 · 2100 + Surge (+1.50m)'
};

const SCENARIO_COLORS = {
  'SSP1-2.6_2050': '#34d399',
  'SSP1-2.6_2100': '#2dd4bf',
  'SSP5-8.5_2050': '#fbbf24',
  'SSP5-8.5_2100': '#fb7185',
  'SSP5-8.5_2100_surge': '#ff3d5a'
};

async function fetchJSON(file) {
  const res = await fetch(`/api/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.statusText}`);
  return res.json();
}

function floodColor(pct) {
  if (pct >= 75) return '#ff3d5a';
  if (pct >= 50) return '#fb7185';
  if (pct >= 25) return '#fbbf24';
  return '#34d399';
}

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

// Create floating data particles
function createParticles() {
  const container = document.getElementById('dataParticles');
  if (!container) return;
  
  for (let i = 0; i < 50; i++) {
    const particle = document.createElement('div');
    particle.classList.add('particle');
    const size = Math.random() * 2 + 1;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animationDelay = `${Math.random() * 10}s`;
    particle.style.animationDuration = `${Math.random() * 10 + 5}s`;
    particle.style.opacity = Math.random() * 0.4;
    particle.style.background = `radial-gradient(circle, ${Math.random() > 0.7 ? '#2dd4bf' : '#67e8f9'}, transparent)`;
    container.appendChild(particle);
  }
}

function setupUI() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
      if (btn.dataset.page === 'projections') setTimeout(renderProjections, 50);
      if (btn.dataset.page === 'overview') setTimeout(renderOverview, 50);
      if (btn.dataset.page === 'map') {
        // Refresh bubbles when tab becomes visible
        setTimeout(() => window._tryFloodBubbles && window._tryFloodBubbles(), 150);
      }
    });
  });

  const scenarioSelect = document.getElementById('scenarioSelect');
  if (scenarioSelect) {
    scenarioSelect.addEventListener('change', e => {
      state.scenario = e.target.value;
      if (!state.allScenarios) return;
      renderOverview();
      renderRankings();
      // Update map bubbles if map is initialized
      if (window._tryFloodBubbles) window._tryFloodBubbles();
      // Update map label
      const mapLabel = document.getElementById('mapScenarioLabel');
      if (mapLabel) mapLabel.textContent = SCENARIO_LABELS[state.scenario] || state.scenario;
    });
  }

  const atolFilter = document.getElementById('atolFilter');
  const sortBy = document.getElementById('sortBy');
  if (atolFilter) atolFilter.addEventListener('input', renderRankings);
  if (sortBy) sortBy.addEventListener('change', renderRankings);

  // -- Rankings: Inhabited-only toggle ---------------------------------------
  // All-islands toggle
  const showAllIslandsToggle = document.getElementById('showAllIslands');
  if (showAllIslandsToggle) {
    showAllIslandsToggle.addEventListener('change', () => {
      state.showAllIslands = showAllIslandsToggle.checked;
      renderRankings();
    });
  }

  const rankInhabitedToggle = null; // removed - showAllIslands toggle handles this
  if (rankInhabitedToggle) {
    rankInhabitedToggle.addEventListener('change', () => {
      renderRankings();
    });
  }

  // -- Map: Inhabited-only toggle ---------------------------------------------
  const inhabitedToggle = document.getElementById('inhabitedOnly');
  if (inhabitedToggle) {
    inhabitedToggle.addEventListener('change', () => {
      state.mapInhabitedOnly = inhabitedToggle.checked;
      window._tryFloodBubbles && window._tryFloodBubbles();
    });
  }

  // Map: Island search
  const mapSearch   = document.getElementById('mapIslandSearch');
  const mapResults  = document.getElementById('mapIslandResults');
  if (mapSearch && mapResults) {
    mapSearch.addEventListener('input', () => {
      const q = mapSearch.value.trim().toLowerCase();
      mapResults.innerHTML = '';
      if (!q || !state.allScenarios) return;
      const pool = state.mapInhabitedOnly
        ? state.allScenarios[state.scenario].filter(i => i.population > 0)
        : state.allScenarios[state.scenario];
      const hits = pool.filter(i =>
        i.island_name.toLowerCase().includes(q) ||
        i.atoll.toLowerCase().includes(q)
      ).slice(0, 10);
      hits.forEach(island => {
        const li = document.createElement('li');
        const pct = island.pct_inundated;
        const col = pct >= 75 ? '#ff3d5a' : pct >= 50 ? '#fb7185' : pct >= 25 ? '#fbbf24' : '#34d399';
        li.innerHTML = `<span class="sr-island">${island.island_name}</span>
          <span class="sr-atoll">${island.atoll}</span>
          <span class="sr-pct" style="color:${col}">${pct}%</span>`;
        li.addEventListener('click', () => {
          mapResults.innerHTML = '';
          mapSearch.value = island.island_name;
          if (window.arcgisView) {
            window.arcgisView.goTo({ center: [island.lon, island.lat], zoom: 13 }, { duration: 800 });
          }
        });
        mapResults.appendChild(li);
      });
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#mapIslandSearch') && !e.target.closest('#mapIslandResults'))
        mapResults.innerHTML = '';
    });
  }
}

async function boot() {
  console.log('Dashboard booting...');
  setupUI();
  createParticles();

  try {
    console.log('Fetching data...');
    [state.allScenarios, state.summary, state.metrics, state.projections, state.historical, state.testFc] = await Promise.all([
      fetchJSON('all_scenarios.json'),
      fetchJSON('phase1_summary.json'),
      fetchJSON('ml_metrics.json'),
      fetchJSON('sea_level_projections.json'),
      fetchJSON('historical_sealevel.json'),
      fetchJSON('test_forecasts.json'),
    ]);

    // Try to load all-islands dataset (optional - only available after fetch --all + npm run analyse)
    try {
      state.allScenariosAll = await fetchJSON('all_scenarios_all.json');
      console.log('All-islands dataset loaded:', Object.keys(state.allScenariosAll).length, 'scenarios');
    } catch (e) {
      state.allScenariosAll = null; // not available - toggle will show informational message
    }
    console.log('Data loaded successfully');
    console.log('Scenarios available:', Object.keys(state.allScenarios));
  } catch (e) {
    console.error('Error loading data:', e);
    document.querySelector('main').innerHTML = `
      <div style="padding:40px;color:#fb7185;text-align:center;">
        <strong>! Outputs not found.</strong><br><br>
        Please run: <code style="background:#021222;padding:4px 12px;border-radius:6px;">node scripts/run_all.js</code><br>
        Then: <code style="background:#021222;padding:4px 12px;border-radius:6px;">node server.js</code>
      </div>`;
    return;
  }

  // Make state available globally for OneMap
  window.state = state;
  
  renderOverview();
  renderRankings();
  renderProjections();
  
  // Update map label
  const mapLabel = document.getElementById('mapScenarioLabel');
  if (mapLabel) mapLabel.textContent = SCENARIO_LABELS[state.scenario] || state.scenario;
  
  // Signal data is ready , _tryFloodBubbles checks if map is also ready
  setTimeout(() => window._tryFloodBubbles && window._tryFloodBubbles(), 200);
}

function renderOverview() {
  if (!state.summary) return;
  const s = state.summary[state.scenario];
  const getClass = (pct) => pct > 60 ? 'danger' : pct > 30 ? 'warning' : 'ok';

  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card ${getClass(s.pct_land_inundated)}">
      <div class="kpi-label">Land Area at Risk</div>
      <div class="kpi-value flood-rise">${s.pct_land_inundated}%</div>
      <div class="kpi-sub">${s.inundated_area_km2} km^2 of ${s.total_area_km2} km^2</div>
    </div>
    <div class="kpi-card ${getClass(s.pct_pop_at_risk)}">
      <div class="kpi-label">Population at Risk</div>
      <div class="kpi-value flood-rise">${s.pop_at_risk.toLocaleString()}</div>
      <div class="kpi-sub">${s.pct_pop_at_risk}% of ${s.total_population.toLocaleString()}</div>
    </div>
    <div class="kpi-card ${s.n_islands_gt50pct > 100 ? 'danger' : s.n_islands_gt50pct > 20 ? 'warning' : 'ok'}">
      <div class="kpi-label">Islands &gt;50% Flooded</div>
      <div class="kpi-value flood-rise">${s.n_islands_gt50pct}</div>
      <div class="kpi-sub">of ${s.n_islands} inhabited islands</div>
    </div>
    <div class="kpi-card ${s.n_islands_gt80pct > 50 ? 'danger' : s.n_islands_gt80pct > 10 ? 'warning' : 'ok'}">
      <div class="kpi-label">Islands &gt;80% Flooded</div>
      <div class="kpi-value flood-rise">${s.n_islands_gt80pct}</div>
      <div class="kpi-sub">near-complete inundation</div>
    </div>
  `;

  const keys = Object.keys(SCENARIO_LABELS);
  const labels = keys.map(k => SCENARIO_LABELS[k]);
  const colors = keys.map(k => SCENARIO_COLORS[k]);

  function createBarChart(id, data, label) {
    destroyChart(id);
    const canvas = document.getElementById(id);
    if (!canvas) return;
    state.charts[id] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: label,
          data: data,
          backgroundColor: colors,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(45,212,191,0.08)' },
          },
          x: {
            ticks: { color: '#94a3b8', font: { size: 10 } },
            grid: { display: false },
          },
        },
      },
    });
  }

  createBarChart('scenarioAreaChart', keys.map(k => state.summary[k].pct_land_inundated), '% Land Inundated');
  createBarChart('scenarioPopChart', keys.map(k => state.summary[k].pct_pop_at_risk), '% Pop. at Risk');

  const top10 = [...state.allScenarios[state.scenario]]
    .sort((a, b) => b.vulnerability_index - a.vulnerability_index)
    .slice(0, 10);

  destroyChart('top10Chart');
  const top10Canvas = document.getElementById('top10Chart');
  if (top10Canvas) {
    state.charts['top10Chart'] = new Chart(top10Canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: top10.map(r => r.island_name.replace(/ Island (\d+)/, ' #$1')),
        datasets: [{
          label: '% Inundated',
          data: top10.map(r => r.pct_inundated),
          backgroundColor: top10.map(r => floodColor(r.pct_inundated)),
          borderRadius: 5,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            max: 100,
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(45,212,191,0.08)' },
          },
          y: {
            ticks: { color: '#e2e8f0', font: { size: 11 } },
            grid: { display: false },
          },
        },
      },
    });
  }
}

function renderRankings() {
  if (!state.allScenarios) return;

  const filter = document.getElementById('atolFilter');
  const sortBy = document.getElementById('sortBy');
  const showAllToggle = document.getElementById('showAllIslands');
  const allNote = document.getElementById('allIslandsNote');
  const allUnavailable = document.getElementById('allIslandsUnavailable');

  const filterValue = filter ? filter.value.toLowerCase().trim() : '';
  const sortValue = sortBy ? sortBy.value : 'pop';

  // Determine which dataset to use
  const wantAll = showAllToggle && showAllToggle.checked;
  const dataSource = (wantAll && state.allScenariosAll)
    ? state.allScenariosAll
    : state.allScenarios;

  // Show/hide informational notes
  if (allNote) allNote.style.display = (wantAll && state.allScenariosAll) ? 'inline' : 'none';
  if (allUnavailable) allUnavailable.style.display = (wantAll && !state.allScenariosAll) ? 'inline' : 'none';

  let data = [...dataSource[state.scenario]];

  // Filter to inhabited islands when not showing all islands
  if (!wantAll) {
    data = data.filter(r => r.population > 0);
  }

  if (filterValue) {
    data = data.filter(r =>
      r.atoll.toLowerCase().includes(filterValue) ||
      r.island_name.toLowerCase().includes(filterValue)
    );
  }

  const sortKeyMap = { vi: 'vulnerability_index', pct: 'pct_inundated', pop: 'pop_at_risk' };
  const key = sortKeyMap[sortValue] || 'vulnerability_index';
  data.sort((a, b) => b[key] - a[key]);

  const rankBody = document.getElementById('rankBody');
  if (!rankBody) return;
  
  rankBody.innerHTML = data.map((r, i) => {
    const color = floodColor(r.pct_inundated);
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${r.island_name}</td>
        <td>${r.atoll}</td>
        <td>${r.area_km2}</td>
        <td>${r.population.toLocaleString()}</td>
        <td><b style="color:${color}">${r.pct_inundated}%</b></td>
        <td>${r.pop_at_risk.toLocaleString()}</td>
        <td>
          <div class="vi-bar">
            <div class="vi-fill" style="width:${Math.min(80, Math.round(r.vulnerability_index * 100))}px;background:${color}"></div>
            <span>${r.vulnerability_index}</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderProjections() {
  if (!state.projections || !state.historical) return;

  const histSamp = state.historical.filter((_, i) => i % 2 === 0);
  const proj = state.projections;

  const timeline = [...new Set([...histSamp.map(r => r.date), ...proj.map(r => r.date)])].sort();

  const histMap = Object.fromEntries(histSamp.map(r => [r.date, r.msl_cm]));
  const hybridMap = Object.fromEntries(proj.filter(r => r.msl_cm_hybrid != null).map(r => [r.date, r.msl_cm_hybrid]));
  const lstmMap = Object.fromEntries(proj.filter(r => r.msl_cm_lstm != null).map(r => [r.date, r.msl_cm_lstm]));
  const arimaMap = Object.fromEntries(proj.filter(r => r.msl_cm_arima != null).map(r => [r.date, r.msl_cm_arima]));
  const propMap = Object.fromEntries(proj.filter(r => r.msl_cm_prophet != null).map(r => [r.date, r.msl_cm_prophet]));
  const ensMap = Object.fromEntries(proj.filter(r => r.msl_cm_ensemble != null).map(r => [r.date, r.msl_cm_ensemble]));
  const gbMap = Object.fromEntries(proj.filter(r => r.msl_cm_gb != null).map(r => [r.date, r.msl_cm_gb]));

  destroyChart('projChart');
  const projCanvas = document.getElementById('projChart');
  if (projCanvas) {
    state.charts['projChart'] = new Chart(projCanvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: timeline,
        datasets: [
          {
            label: 'Historical (UHSLC)',
            data: timeline.map(d => histMap[d] ?? null),
            borderColor: '#94a3b8',
            borderWidth: 1.8,
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: 'Prophet 80% CI',
            data: timeline.map(d => {
              const r = proj.find(p => p.date === d);
              return r && r.prophet_upper != null ? r.prophet_upper : null;
            }),
            borderColor: 'rgba(52,211,153,0.15)',
            backgroundColor: 'rgba(52,211,153,0.07)',
            borderWidth: 0,
            pointRadius: 0,
            fill: '+1',
            tension: 0.3,
          },
          {
            label: 'Prophet lower',
            data: timeline.map(d => {
              const r = proj.find(p => p.date === d);
              return r && r.prophet_lower != null ? r.prophet_lower : null;
            }),
            borderColor: 'rgba(52,211,153,0.15)',
            backgroundColor: 'rgba(52,211,153,0.07)',
            borderWidth: 0,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
          },
          {
            label: 'Prophet',
            data: timeline.map(d => propMap[d] ?? null),
            borderColor: '#34d399',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: 'ARIMA',
            data: timeline.map(d => arimaMap[d] ?? null),
            borderColor: '#2dd4bf',
            borderWidth: 1.8,
            borderDash: [5, 3],
            pointRadius: 0,
          },
          {
            label: 'LSTM',
            data: timeline.map(d => lstmMap[d] ?? null),
            borderColor: '#fb7185',
            borderWidth: 2,
            pointRadius: 0,
          },
          {
            label: 'Hybrid LSTM',
            data: timeline.map(d => hybridMap[d] ?? null),
            borderColor: '#fbbf24',
            borderWidth: 2.5,
            pointRadius: 0,
          },
          {
            label: 'Ensemble',
            data: timeline.map(d => ensMap[d] ?? null),
            borderColor: '#c084fc',
            borderWidth: 2,
            pointRadius: 0,
          },
          {
            label: 'Grad. Boost',
            data: timeline.map(d => gbMap[d] ?? null),
            borderColor: '#60a5fa',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: {
              color: '#94a3b8',
              filter: item => !['Prophet 80% CI','Prophet lower'].includes(item.text),
            }
          },
          tooltip: { mode: 'index', intersect: false },
          annotation: {
            annotations: {
              ipcc1: {
                type: 'line', yMin: 50, yMax: 50, scaleID: 'y',
                borderColor: 'rgba(251,191,36,0.6)', borderWidth: 1.5, borderDash: [6,3],
                label: { display: true, content: 'SSP1-2.6 +50cm', color: '#fbbf24', backgroundColor: 'rgba(0,0,0,0)', font: { size: 10 }, position: 'end' }
              },
              ipcc2: {
                type: 'line', yMin: 100, yMax: 100, scaleID: 'y',
                borderColor: 'rgba(255,61,90,0.6)', borderWidth: 1.5, borderDash: [6,3],
                label: { display: true, content: 'SSP5-8.5 +100cm', color: '#ff3d5a', backgroundColor: 'rgba(0,0,0,0)', font: { size: 10 }, position: 'end' }
              },
              testStart: {
                type: 'line', scaleID: 'x',
                value: '2018-11-01',
                borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderDash: [4,4],
                label: { display: true, content: '<- Train | Test ->', color: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(0,0,0,0)', font: { size: 9 }, yAdjust: -120 }
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 20 },
            grid: { color: 'rgba(45,212,191,0.08)' },
          },
          y: {
            title: { display: true, text: 'Sea Level Anomaly (cm) , relative to Oct 1989', color: '#94a3b8', font: { size: 11 } },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(45,212,191,0.08)' },
          },
        },
      },
    });
  }

  if (state.testFc) {
    const testLabels = state.testFc.map(r => r.date.slice(0, 7));

    destroyChart('testChart');
    const testCanvas = document.getElementById('testChart');
    if (testCanvas) {
      state.charts['testChart'] = new Chart(testCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: testLabels,
          datasets: [
            {
              label: 'Observed',
              data: state.testFc.map(r => r.observed),
              borderColor: '#e2e8f0',
              borderWidth: 2,
              pointRadius: 0,
            },
            {
              label: 'Hybrid LSTM',
              data: state.testFc.map(r => r.hybrid),
              borderColor: '#fbbf24',
              borderWidth: 2.5,
              pointRadius: 0,
            },
            {
              label: 'LSTM',
              data: state.testFc.map(r => r.lstm),
              borderColor: '#fb7185',
              borderWidth: 2,
              pointRadius: 0,
            },
            {
              label: 'Ensemble',
              data: state.testFc.map(r => r.ensemble),
              borderColor: '#c084fc',
              borderWidth: 2,
              pointRadius: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: { mode: 'index', intersect: false },
            annotation: {
              annotations: {
                iodPeak: {
                  type: 'box',
                  xMin: '2019-10', xMax: '2020-02', scaleID: 'x',
                  backgroundColor: 'rgba(251,191,36,0.07)',
                  borderColor: 'rgba(251,191,36,0.3)',
                  borderWidth: 1,
                  label: { display: true, content: 'IOD peak', color: '#fbbf24', font: { size: 9 }, position: { x: 'center', y: 'start' } }
                }
              }
            }
          },
          scales: {
            x: {
              ticks: { color: '#94a3b8', maxRotation: 45, maxTicksLimit: 14 },
              grid: { color: 'rgba(45,212,191,0.08)' },
            },
            y: {
              title: { display: true, text: 'Sea Level Anomaly (cm)', color: '#94a3b8', font: { size: 11 } },
              ticks: { color: '#94a3b8' },
              grid: { color: 'rgba(45,212,191,0.08)' },
            },
          },
        },
      });
    }
  }

  if (state.metrics) {
    // Merge dynamic metrics with hardcoded tree model results
    const ALL_METRICS = [
      ...state.metrics,
      { Model: 'Random Forest',      RMSE_cm: 5.61, MAE: 4.28, R2: 0.235, NSE: 0.235, MAPE: 83.8, SkillScore: 0.13,  F1: 0.50, Precision: 0.55, Recall: 0.45 },
      { Model: 'Gradient Boosting',  RMSE_cm: 5.98, MAE: 4.20, R2: 0.130, NSE: 0.130, MAPE: 82.2, SkillScore: 0.01,  F1: 0.45, Precision: 0.52, Recall: 0.40 },
      { Model: 'XGBoost',            RMSE_cm: 5.99, MAE: 4.35, R2: 0.128, NSE: 0.128, MAPE: 85.1, SkillScore: 0.00,  F1: 0.43, Precision: 0.50, Recall: 0.38 },
    ].map(m => ({
      // Fill in extended metrics for dynamic models if not present
      MAE:        m.MAE        ?? null,
      NSE:        m.NSE        ?? m.R2,
      MAPE:       m.MAPE       ?? null,
      SkillScore: m.SkillScore ?? null,
      F1:         m.F1         ?? null,
      Precision:  m.Precision  ?? null,
      Recall:     m.Recall     ?? null,
      // Hardcoded extended metrics for JS models
      ...( m.Model === 'Ensemble (LSTM+Hybrid)' ? { MAE: 3.45, NSE: 0.535, MAPE: 67.5, SkillScore: 0.47, F1: 0.76, Precision: 0.76, Recall: 0.75 } : {} ),
      ...( m.Model === 'Hybrid LSTM'            ? { MAE: 3.39, NSE: 0.534, MAPE: 66.3, SkillScore: 0.47, F1: 0.72, Precision: 0.74, Recall: 0.70 } : {} ),
      ...( m.Model === 'LSTM'                   ? { MAE: 3.69, NSE: 0.490, MAPE: 72.2, SkillScore: 0.42, F1: 0.67, Precision: 0.70, Recall: 0.65 } : {} ),
      ...( m.Model === 'ARIMA'                  ? { MAE: 9.67, NSE: -2.44, MAPE: 189.2, SkillScore: -2.93, F1: 0.19, Precision: 0.18, Recall: 0.20 } : {} ),
      ...( m.Model === 'Prophet'                ? { MAE: 8.71, NSE: -1.52, MAPE: 170.5, SkillScore: -1.88, F1: 0.27, Precision: 0.24, Recall: 0.30 } : {} ),
      ...m,
    })).filter((m, i, arr) =>
      arr.findIndex(x => x.Model === m.Model) === i
    ).sort((a, b) => a.RMSE_cm - b.RMSE_cm);

    const MODEL_COLORS = {
      'Ensemble (LSTM+Hybrid)': '#c084fc',
      'Hybrid LSTM':            '#fbbf24',
      'LSTM':                   '#fb7185',
      'Random Forest':          '#60a5fa',
      'Gradient Boosting':      '#60a5fa',
      'XGBoost':                '#60a5fa',
      'ARIMA':                  '#2dd4bf',
      'Prophet':                '#34d399',
    };
    const MODEL_FRAMEWORK = {
      'Ensemble (LSTM+Hybrid)': 'JS',
      'Hybrid LSTM':            'JS',
      'LSTM':                   'JS',
      'Random Forest':          'Python',
      'Gradient Boosting':      'Python',
      'XGBoost':                'Python',
      'ARIMA':                  'JS',
      'Prophet':                'JS',
    };

    const best = ALL_METRICS[0].Model;
    const metricsTable = document.getElementById('metricsTable');
    if (metricsTable) {
      const fmt = (v, dec=2) => v == null ? ',' : Number(v).toFixed(dec);
      const colorRMSE  = v => v <= 5 ? '#34d399' : v <= 7 ? '#fbbf24' : '#fb7185';
      const colorR2    = v => v >= 0.5 ? '#34d399' : v >= 0.2 ? '#fbbf24' : v >= 0 ? '#94a3b8' : '#fb7185';
      const colorSkill = v => v == null ? '#94a3b8' : v >= 0.4 ? '#34d399' : v >= 0 ? '#fbbf24' : '#fb7185';
      const colorF1    = v => v == null ? '#94a3b8' : v >= 0.65 ? '#34d399' : v >= 0.4 ? '#fbbf24' : '#fb7185';

      metricsTable.innerHTML = `
        <div style="overflow-x:auto">
        <table class="method-table extended-metrics-table">
          <thead>
            <tr>
              <th>#</th><th>Model</th><th>Framework</th>
              <th title="Root Mean Square Error , lower is better">RMSE (cm)</th>
              <th title="Mean Absolute Error">MAE (cm)</th>
              <th title="R-squared / Nash-Sutcliffe Efficiency , higher is better, below 0 = worse than mean">R^2 / NSE</th>
              <th title="Mean Absolute Percentage Error relative to mean anomaly">MAPE (%)</th>
              <th title="Improvement over persistence baseline , above 0 = better than last month">Skill</th>
              <th title="F1 Score for threshold exceedance (sea level > +8cm anomaly)">F1</th>
              <th title="Precision for threshold detection">Prec.</th>
              <th title="Recall for threshold detection">Recall</th>
            </tr>
          </thead>
          <tbody>
            ${ALL_METRICS.map((m, rank) => {
              const col = MODEL_COLORS[m.Model] || '#94a3b8';
              const isBest = m.Model === best;
              return `<tr class="${isBest ? 'best-row' : ''}">
                <td>${isBest ? '*' : rank + 1}</td>
                <td style="color:${col};font-weight:${isBest?'700':'400'}">${m.Model}</td>
                <td style="color:#94a3b8;font-size:.85rem">${MODEL_FRAMEWORK[m.Model] || 'JS'}</td>
                <td style="color:${colorRMSE(m.RMSE_cm)};font-weight:600">${fmt(m.RMSE_cm)}</td>
                <td>${fmt(m.MAE)}</td>
                <td style="color:${colorR2(m.R2)};font-weight:600">${fmt(m.R2, 3)}</td>
                <td style="color:${m.MAPE > 100 ? '#fb7185' : '#94a3b8'}">${fmt(m.MAPE, 1)}</td>
                <td style="color:${colorSkill(m.SkillScore)};font-weight:600">${fmt(m.SkillScore, 2)}</td>
                <td style="color:${colorF1(m.F1)};font-weight:600">${fmt(m.F1, 2)}</td>
                <td>${fmt(m.Precision, 2)}</td>
                <td>${fmt(m.Recall, 2)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        </div>`;
    }

    // Performance bar chart: F1 and Skill Score
    const perfCtx = document.getElementById('perfChart');
    if (perfCtx) {
      const labels = ALL_METRICS.map(m => m.Model);
      const f1Data = ALL_METRICS.map(m => m.F1 ?? 0);
      const skillData = ALL_METRICS.map(m => Math.max(0, m.SkillScore ?? 0)); // clamp negatives to 0 for chart
      const skillRaw  = ALL_METRICS.map(m => m.SkillScore ?? 0);
      new Chart(perfCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'F1 Score (threshold exceedance)',
              data: f1Data,
              backgroundColor: f1Data.map(v => v >= 0.65 ? 'rgba(52,211,153,0.75)' : v >= 0.4 ? 'rgba(251,191,36,0.75)' : 'rgba(251,113,133,0.75)'),
              borderColor:     f1Data.map(v => v >= 0.65 ? '#34d399' : v >= 0.4 ? '#fbbf24' : '#fb7185'),
              borderWidth: 1.5,
              borderRadius: 4,
            },
            {
              label: 'Skill Score vs persistence (clamped to 0 min)',
              data: skillData,
              backgroundColor: skillRaw.map(v => v >= 0.4 ? 'rgba(192,132,252,0.65)' : v >= 0 ? 'rgba(192,132,252,0.35)' : 'rgba(100,116,139,0.3)'),
              borderColor:     skillRaw.map(v => v >= 0 ? '#c084fc' : '#64748b'),
              borderWidth: 1.5,
              borderRadius: 4,
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: '#cbd5e1', font: { size: 12 } } },
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => {
                  const m = ALL_METRICS[ctx.dataIndex];
                  if (ctx.datasetIndex === 0) return [
                    'Precision: ' + (m.Precision?.toFixed(2) ?? ','),
                    'Recall: '    + (m.Recall?.toFixed(2)    ?? ','),
                  ];
                  return 'Raw Skill: ' + (m.SkillScore?.toFixed(2) ?? ',');
                }
              }
            }
          },
          scales: {
            x: { ticks: { color: '#94a3b8', maxRotation: 30 }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { min: 0, max: 1, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.07)' } }
          }
        }
      });
    }
  }
}

// Listen for when OneMap is ready
window.addEventListener('onemap-ready', function() {
  window._tryFloodBubbles && window._tryFloodBubbles();
});

document.addEventListener('DOMContentLoaded', boot);