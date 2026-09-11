(function () {
  'use strict';

  // Paleta categórica validada (passo escuro) — ordem fixa, nunca ciclada por rank.
  const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const POSITIVE = '#199e70';
  const NEGATIVE = '#e66767';
  const NEUTRAL = '#8a9a8a';
  const TEXT = '#eef2ec';
  const TEXT_DIM = '#9fb09f';
  const GRID = 'rgba(255,255,255,0.06)';

  Chart.defaults.color = TEXT_DIM;
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.borderColor = GRID;

  const el = (id) => document.getElementById(id);

  function colorFor(i) { return PALETTE[i % PALETTE.length]; }

  function fmtNum(v, digits = 1) { return v == null ? '—' : Number(v).toFixed(digits); }
  function fmtDate(iso) { return new Date(iso).toLocaleDateString('pt-BR'); }

  async function main() {
    const res = await fetch('/api/stats');
    const data = await res.json();

    if (data.summary.totalObservations === 0) {
      el('emptyState').style.display = '';
      el('dashboardContent').style.display = 'none';
      return;
    }

    renderStatTiles(data);
    renderGrowthChart(data);
    renderCompareChart(data);
    renderHistChart(data);
    renderRateChart(data);
    renderScalingChart(data);
    renderVolumeChart(data);
    renderRanking(data);
  }

  function renderStatTiles(data) {
    const s = data.summary;
    const tiles = [
      { label: 'Formigueiros monitorados', value: s.totalColonies },
      { label: 'Observações registradas', value: s.totalObservations },
      { label: 'Diâmetro médio', value: s.avgDiameterCm != null ? `${fmtNum(s.avgDiameterCm)} cm` : '—' },
      { label: 'Maior diâmetro já medido', value: s.maxDiameterCm != null ? `${fmtNum(s.maxDiameterCm)} cm` : '—' },
      { label: 'Área média', value: s.avgAreaCm2 != null ? `${fmtNum(s.avgAreaCm2)} cm²` : '—' },
      {
        label: 'Maior formigueiro',
        value: s.biggestColony ? s.biggestColony.colony.name : '—',
        sub: s.biggestColony ? `${fmtNum(s.biggestColony.latest.diameter_cm)} cm de diâmetro` : ''
      },
      {
        label: 'Crescimento mais rápido',
        value: s.fastestGrowing ? s.fastestGrowing.colony.name : '—',
        sub: s.fastestGrowing ? `${fmtNum(s.fastestGrowing.growthRateCmPerDay, 3)} cm/dia` : ''
      }
    ];
    el('statTiles').innerHTML = tiles.map(t => `
      <div class="stat-tile">
        <div class="label">${t.label}</div>
        <div class="value">${t.value}</div>
        ${t.sub ? `<div class="sub">${t.sub}</div>` : ''}
      </div>`).join('');
  }

  function timeTicks(ctx) {
    return new Date(ctx).toLocaleDateString('pt-BR');
  }

  function renderGrowthChart(data) {
    const colonies = Object.values(data.byColony).filter(c => c.observations.length > 0);
    const datasets = colonies.map((c, i) => ({
      label: c.colony.name,
      data: c.observations.filter(o => o.diameter_cm != null)
        .map(o => ({ x: new Date(o.observed_at).getTime(), y: o.diameter_cm })),
      borderColor: colorFor(i),
      backgroundColor: colorFor(i),
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 2,
      tension: 0.15,
      spanGaps: true
    }));

    new Chart(el('growthChart'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', grid: { color: GRID }, ticks: { callback: timeTicks } },
          y: { grid: { color: GRID }, title: { display: true, text: 'Diâmetro (cm)', color: TEXT_DIM } }
        },
        plugins: {
          legend: { display: datasets.length > 1, labels: { color: TEXT, usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (items) => timeTicks(items[0].parsed.x),
              label: (item) => `${item.dataset.label}: ${fmtNum(item.parsed.y, 2)} cm`
            }
          }
        }
      }
    });
  }

  function renderCompareChart(data) {
    const rows = data.growth.filter(g => g.hasData && g.latest.diameter_cm != null);
    new Chart(el('compareChart'), {
      type: 'bar',
      data: {
        labels: rows.map(r => r.colony.name),
        datasets: [{
          label: 'Diâmetro atual (cm)',
          data: rows.map(r => r.latest.diameter_cm),
          backgroundColor: rows.map((_, i) => colorFor(i)),
          borderRadius: 4,
          maxBarThickness: 46
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { grid: { display: false } }, y: { grid: { color: GRID }, beginAtZero: true } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function histogramBins(values, binCount = 8) {
    if (!values.length) return { labels: [], counts: [] };
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const width = span / binCount;
    const counts = new Array(binCount).fill(0);
    values.forEach(v => {
      let idx = Math.floor((v - min) / width);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    });
    const labels = counts.map((_, i) => `${(min + i * width).toFixed(1)}–${(min + (i + 1) * width).toFixed(1)}`);
    return { labels, counts };
  }

  function renderHistChart(data) {
    const { labels, counts } = histogramBins(data.diameterHistogram, 8);
    new Chart(el('histChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Observações',
          data: counts,
          backgroundColor: PALETTE[0],
          borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, title: { display: true, text: 'Diâmetro (cm)', color: TEXT_DIM } },
          y: { grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  function renderRateChart(data) {
    const rows = data.growth.filter(g => g.growthRateCmPerDay != null);
    new Chart(el('rateChart'), {
      type: 'bar',
      data: {
        labels: rows.map(r => r.colony.name),
        datasets: [{
          label: 'Taxa de crescimento (cm/dia)',
          data: rows.map(r => r.growthRateCmPerDay),
          backgroundColor: rows.map(r => r.growthRateCmPerDay >= 0 ? POSITIVE : NEGATIVE),
          borderRadius: 4,
          maxBarThickness: 46
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: GRID }, title: { display: true, text: 'cm / dia', color: TEXT_DIM } }
        },
        plugins: { legend: { display: false } }
      }
    });
    if (!rows.length) {
      el('rateChart').parentElement.insertAdjacentHTML('beforeend',
        '<p class="muted">É preciso ao menos 2 observações com diâmetro no mesmo formigueiro para calcular taxa de crescimento.</p>');
    }
  }

  function fitCurve(fit, xMin, xMax) {
    if (!fit) return [];
    const steps = 30;
    const pts = [];
    const logMin = Math.log(xMin), logMax = Math.log(xMax);
    for (let i = 0; i <= steps; i++) {
      const x = Math.exp(logMin + (logMax - logMin) * (i / steps));
      pts.push({ x, y: fit.a * Math.pow(x, fit.b) });
    }
    return pts;
  }

  function renderScalingChart(data) {
    const pts = data.scaling.points;
    const fit = data.scaling.fit;
    const wrap = el('scalingChart').closest('.card');
    if (!pts.length) {
      el('scalingChart').parentElement.style.display = 'none';
      el('scalingFitText').textContent = 'Registre o número de formigas visíveis nas observações para habilitar este gráfico.';
      return;
    }
    const xs = pts.map(p => p.x);
    const datasets = [{
      type: 'scatter',
      label: 'Observações',
      data: pts,
      backgroundColor: PALETTE[0],
      pointRadius: 5
    }];
    if (fit) {
      datasets.push({
        type: 'line',
        label: `Ajuste: área ≈ ${fit.a.toFixed(2)}·N^${fit.b.toFixed(2)}`,
        data: fitCurve(fit, Math.min(...xs), Math.max(...xs)),
        borderColor: NEUTRAL,
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      });
    }
    new Chart(el('scalingChart'), {
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'logarithmic', title: { display: true, text: 'Nº de formigas (log)', color: TEXT_DIM }, grid: { color: GRID } },
          y: { type: 'logarithmic', title: { display: true, text: 'Área (cm², log)', color: TEXT_DIM }, grid: { color: GRID } }
        },
        plugins: { legend: { labels: { color: TEXT, usePointStyle: true } } }
      }
    });
    el('scalingFitText').textContent = fit
      ? `Expoente de escala b = ${fit.b.toFixed(3)} (R² = ${fit.r2.toFixed(3)}, n = ${fit.n}). b≈1 indica crescimento proporcional; b>1, área crescendo mais rápido que a população.`
      : 'Dados insuficientes para ajuste (mínimo 2 pontos).';
  }

  function renderVolumeChart(data) {
    const pts = data.volumeScaling.points;
    const fit = data.volumeScaling.fit;
    if (!pts.length) {
      el('volumeChart').parentElement.style.display = 'none';
      el('volumeFitText').textContent = 'Informe altura do monte nas observações para habilitar este gráfico.';
      return;
    }
    const xs = pts.map(p => p.x);
    const datasets = [{
      type: 'scatter',
      label: 'Observações',
      data: pts,
      backgroundColor: PALETTE[2],
      pointRadius: 5
    }];
    if (fit) {
      datasets.push({
        type: 'line',
        label: `Ajuste: volume ≈ ${fit.a.toFixed(2)}·d^${fit.b.toFixed(2)}`,
        data: fitCurve(fit, Math.min(...xs), Math.max(...xs)),
        borderColor: NEUTRAL,
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      });
    }
    new Chart(el('volumeChart'), {
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'logarithmic', title: { display: true, text: 'Diâmetro (cm, log)', color: TEXT_DIM }, grid: { color: GRID } },
          y: { type: 'logarithmic', title: { display: true, text: 'Volume (cm³, log)', color: TEXT_DIM }, grid: { color: GRID } }
        },
        plugins: { legend: { labels: { color: TEXT, usePointStyle: true } } }
      }
    });
    el('volumeFitText').textContent = fit
      ? `Expoente b = ${fit.b.toFixed(3)} (R² = ${fit.r2.toFixed(3)}, n = ${fit.n}). Geometria cônica ideal prevê b≈3.`
      : 'Dados insuficientes para ajuste.';
  }

  function renderRanking(data) {
    const rows = data.growth.filter(g => g.hasData).sort((a, b) => {
      const ad = a.latest.diameter_cm ?? -Infinity, bd = b.latest.diameter_cm ?? -Infinity;
      return bd - ad;
    });
    if (!rows.length) {
      el('rankingTableWrap').innerHTML = '<div class="empty-state">Sem dados suficientes.</div>';
      return;
    }
    const body = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.colony.name}</td>
        <td>${fmtNum(r.latest.diameter_cm, 2)} cm</td>
        <td>${r.latest.area_cm2 != null ? fmtNum(r.latest.area_cm2, 2) + ' cm²' : '—'}</td>
        <td>${r.growthRateCmPerDay != null ? fmtNum(r.growthRateCmPerDay, 3) + ' cm/dia' : '—'}</td>
        <td>${r.observationCount}</td>
        <td>${fmtDate(r.lastObservedAt)}</td>
      </tr>`).join('');
    el('rankingTableWrap').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>#</th><th>Formigueiro</th><th>Diâmetro atual</th><th>Área atual</th>
          <th>Taxa de crescimento</th><th>Observações</th><th>Última medição</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  main();
})();
