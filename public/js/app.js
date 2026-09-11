(function () {
  'use strict';

  const state = {
    colonies: [],
    selectedColonyId: null,
    observations: [],
    image: null,
    imgFile: null,
    mode: null, // 'calibrate' | 'diameter' | 'area' | null
    calibratePoints: [],
    diameterPoints: [],
    areaPoints: [],
    areaClosed: false
  };

  const el = (id) => document.getElementById(id);
  const canvas = el('measureCanvas');
  const ctx = canvas.getContext('2d');

  function toast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      let msg = 'Erro na requisição';
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------------- Colonias ----------------
  async function loadColonies() {
    state.colonies = await api('/api/colonies');
    renderColonyList();
  }

  function renderColonyList() {
    const wrap = el('colonyList');
    if (!state.colonies.length) {
      wrap.innerHTML = '<div class="empty-state">Nenhum formigueiro ainda.</div>';
      return;
    }
    wrap.innerHTML = '';
    state.colonies.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'colony-item' + (c.id === state.selectedColonyId ? ' selected' : '');
      div.innerHTML = `
        <div style="flex:1;">
          <div class="name">${escapeHtml(c.name)}</div>
          <div class="muted">${c.observation_count} observação(ões)${c.last_observed_at ? ' · última em ' + formatDate(c.last_observed_at) : ''}</div>
        </div>`;
      div.addEventListener('click', () => selectColony(c.id));
      wrap.appendChild(div);
    });
  }

  el('colonyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('c_name').value.trim();
    if (!name) return;
    try {
      const colony = await api('/api/colonies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          species: el('c_species').value.trim(),
          location: el('c_location').value.trim(),
          notes: el('c_notes').value.trim()
        })
      });
      el('colonyForm').reset();
      await loadColonies();
      selectColony(colony.id);
      toast('Formigueiro criado.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  el('deleteColonyBtn').addEventListener('click', async () => {
    if (!state.selectedColonyId) return;
    if (!confirm('Excluir este formigueiro e todas as suas observações? Essa ação não pode ser desfeita.')) return;
    await api(`/api/colonies/${state.selectedColonyId}`, { method: 'DELETE' });
    state.selectedColonyId = null;
    el('selectedColonyCard').style.display = 'none';
    el('uploadCard').style.display = 'none';
    el('historyCard').style.display = 'none';
    await loadColonies();
    toast('Formigueiro removido.');
  });

  async function selectColony(id) {
    state.selectedColonyId = id;
    renderColonyList();
    const c = state.colonies.find((x) => x.id === id);
    el('selectedColonyCard').style.display = '';
    el('uploadCard').style.display = '';
    el('historyCard').style.display = '';
    el('selectedColonyName').textContent = c.name;
    el('selectedColonyMeta').textContent = [c.species, c.location].filter(Boolean).join(' · ') || 'Sem detalhes adicionais';
    resetMeasurement();
    el('observedAt').value = new Date().toISOString().slice(0, 10);
    await loadObservations();
  }

  // ---------------- Observacoes / historico ----------------
  async function loadObservations() {
    state.observations = await api(`/api/observations?colony_id=${state.selectedColonyId}`);
    renderHistory();
  }

  function renderHistory() {
    const wrap = el('historyTableWrap');
    if (!state.observations.length) {
      wrap.innerHTML = '<div class="empty-state">Nenhuma observação registrada ainda.</div>';
      return;
    }
    const rows = state.observations.slice().reverse().map((o) => `
      <tr>
        <td><img class="thumb" src="${o.image_path}" alt="" /></td>
        <td>${formatDate(o.observed_at)}</td>
        <td>${fmt(o.diameter_cm, 'cm')}</td>
        <td>${fmt(o.area_cm2, 'cm²')}</td>
        <td>${fmt(o.height_cm, 'cm')}</td>
        <td>${fmt(o.volume_cm3, 'cm³')}</td>
        <td>${o.ant_count ?? '—'}</td>
        <td><button class="danger" data-id="${o.id}">Excluir</button></td>
      </tr>`).join('');
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Foto</th><th>Data</th><th>Diâmetro</th><th>Área</th><th>Altura</th><th>Volume</th><th>Formigas</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    wrap.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir esta observação?')) return;
        await api(`/api/observations/${btn.dataset.id}`, { method: 'DELETE' });
        await loadObservations();
        await loadColonies();
      });
    });
  }

  function fmt(v, unit) {
    if (v == null) return '—';
    return `${Number(v).toFixed(2)} ${unit}`;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- Ferramenta de medição por canvas ----------------
  el('imageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.imgFile = file;
    const img = new Image();
    img.onload = () => {
      state.image = img;
      const maxW = 640;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      resetMeasurement(false);
      draw();
      el('canvasHint').textContent = 'Clique "Calibrar escala" e marque 2 pontos sobre um objeto de tamanho conhecido.';
    };
    img.src = URL.createObjectURL(file);
  });

  function resetMeasurement(clearImage = true) {
    state.mode = null;
    state.calibratePoints = [];
    state.diameterPoints = [];
    state.areaPoints = [];
    state.areaClosed = false;
    el('refLengthCm').value = '';
    el('calibReadout').textContent = 'Escala: —';
    el('diameterReadout').textContent = 'Diâmetro medido: —';
    el('areaReadout').textContent = 'Área medida (polígono): —';
    updateStepUI();
    if (!clearImage) draw();
  }

  el('btnCalibrate').addEventListener('click', () => { state.mode = 'calibrate'; state.calibratePoints = []; updateStepUI(); draw(); });
  el('btnDiameter').addEventListener('click', () => { state.mode = 'diameter'; state.diameterPoints = []; updateStepUI(); draw(); });
  el('btnArea').addEventListener('click', () => { state.mode = 'area'; state.areaPoints = []; state.areaClosed = false; updateStepUI(); draw(); });
  el('btnCloseArea').addEventListener('click', () => {
    if (state.areaPoints.length >= 3) {
      state.areaClosed = true;
      state.mode = null;
      computeArea();
      draw();
    } else {
      toast('Marque ao menos 3 pontos para fechar o polígono.', 'error');
    }
  });
  el('btnUndo').addEventListener('click', () => {
    if (state.mode === 'calibrate') state.calibratePoints.pop();
    else if (state.mode === 'diameter') state.diameterPoints.pop();
    else if (state.mode === 'area') state.areaPoints.pop();
    draw();
  });
  el('btnResetMeasure').addEventListener('click', () => resetMeasurement(false));

  canvas.addEventListener('click', (e) => {
    if (!state.image || !state.mode) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (state.mode === 'calibrate') {
      if (state.calibratePoints.length >= 2) state.calibratePoints = [];
      state.calibratePoints.push({ x, y });
      if (state.calibratePoints.length === 2) computeCalibration();
    } else if (state.mode === 'diameter') {
      if (state.diameterPoints.length >= 2) state.diameterPoints = [];
      state.diameterPoints.push({ x, y });
      if (state.diameterPoints.length === 2) computeDiameter();
    } else if (state.mode === 'area') {
      if (state.areaClosed) { state.areaPoints = []; state.areaClosed = false; }
      state.areaPoints.push({ x, y });
    }
    updateStepUI();
    draw();
  });

  el('refLengthCm').addEventListener('input', computeCalibration);

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function pxPerCm() {
    if (state.calibratePoints.length < 2) return null;
    const lengthCm = parseFloat(el('refLengthCm').value);
    if (!lengthCm || lengthCm <= 0) return null;
    const px = dist(state.calibratePoints[0], state.calibratePoints[1]);
    return px / lengthCm;
  }

  function computeCalibration() {
    if (state.calibratePoints.length < 2) return;
    const px = dist(state.calibratePoints[0], state.calibratePoints[1]);
    const ratio = pxPerCm();
    el('calibReadout').textContent = ratio
      ? `Escala: ${px.toFixed(1)} px = referência informada → ${ratio.toFixed(2)} px/cm`
      : `Escala: ${px.toFixed(1)} px — informe o comprimento real acima`;
    computeDiameter();
  }

  function computeDiameter() {
    if (state.diameterPoints.length < 2) return;
    const px = dist(state.diameterPoints[0], state.diameterPoints[1]);
    const ratio = pxPerCm();
    if (!ratio) { el('diameterReadout').textContent = `Diâmetro medido: ${px.toFixed(1)} px (calibre a escala para converter)`; return; }
    el('diameterReadout').textContent = `Diâmetro medido: ${(px / ratio).toFixed(2)} cm`;
  }

  function shoelaceArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function computeArea() {
    if (state.areaPoints.length < 3) return;
    const px2 = shoelaceArea(state.areaPoints);
    const ratio = pxPerCm();
    if (!ratio) { el('areaReadout').textContent = `Área medida (polígono): ${px2.toFixed(0)} px² (calibre a escala para converter)`; return; }
    el('areaReadout').textContent = `Área medida (polígono): ${(px2 / (ratio * ratio)).toFixed(2)} cm²`;
  }

  function updateStepUI() {
    document.querySelectorAll('.step-list .step').forEach((s) => {
      s.classList.remove('active', 'done');
      const step = s.dataset.step;
      if (step === state.mode) s.classList.add('active');
      else if (
        (step === 'calibrate' && state.calibratePoints.length === 2) ||
        (step === 'diameter' && state.diameterPoints.length === 2) ||
        (step === 'area' && state.areaClosed)
      ) s.classList.add('done');
    });
  }

  function draw() {
    if (!state.image) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);

    drawLine(state.calibratePoints, '#d9a441', 'Ref');
    drawLine(state.diameterPoints, '#7fc97f', 'Diâm');
    drawPolygon(state.areaPoints, state.areaClosed, '#5aa9e6');
  }

  function drawLine(points, color, label) {
    if (points.length === 0) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      const mx = (points[0].x + points[1].x) / 2;
      const my = (points[0].y + points[1].y) / 2;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(label, mx + 6, my - 6);
    }
  }

  function drawPolygon(points, closed, color) {
    if (points.length === 0) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (closed) ctx.closePath();
    ctx.stroke();
    if (closed) {
      ctx.globalAlpha = 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- Salvar observação ----------------
  el('btnSaveObservation').addEventListener('click', async () => {
    if (!state.selectedColonyId) return toast('Selecione um formigueiro.', 'error');
    if (!state.imgFile) return toast('Carregue uma imagem.', 'error');
    if (state.calibratePoints.length < 2) return toast('Calibre a escala (2 pontos).', 'error');
    const refLengthCm = parseFloat(el('refLengthCm').value);
    if (!refLengthCm || refLengthCm <= 0) return toast('Informe o comprimento real da referência.', 'error');
    if (state.diameterPoints.length < 2) return toast('Meça o diâmetro (2 pontos).', 'error');

    const fd = new FormData();
    fd.append('image', state.imgFile);
    fd.append('colony_id', state.selectedColonyId);
    fd.append('ref_length_cm', refLengthCm);
    fd.append('ref_pixels', dist(state.calibratePoints[0], state.calibratePoints[1]));
    fd.append('diameter_px', dist(state.diameterPoints[0], state.diameterPoints[1]));
    if (state.areaClosed && state.areaPoints.length >= 3) {
      fd.append('area_px2', shoelaceArea(state.areaPoints));
    }
    if (el('heightCm').value) fd.append('height_cm', el('heightCm').value);
    if (el('antCount').value) fd.append('ant_count', el('antCount').value);
    if (el('entranceCount').value) fd.append('entrance_count', el('entranceCount').value);
    if (el('observedAt').value) fd.append('observed_at', el('observedAt').value);
    if (el('obsNotes').value) fd.append('notes', el('obsNotes').value);

    try {
      el('btnSaveObservation').disabled = true;
      await api('/api/observations', { method: 'POST', body: fd });
      toast('Observação salva!');
      el('imageInput').value = '';
      state.image = null;
      state.imgFile = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      resetMeasurement(false);
      el('heightCm').value = '';
      el('antCount').value = '';
      el('entranceCount').value = '';
      el('obsNotes').value = '';
      await loadObservations();
      await loadColonies();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      el('btnSaveObservation').disabled = false;
    }
  });

  loadColonies();
})();
