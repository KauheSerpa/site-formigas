const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// DATA_DIR aponta para um disco persistente em producao (ex: /var/data no Render).
// Sem essa variavel, usa as pastas locais do projeto (comportamento de dev).
const DATA_DIR = process.env.DATA_DIR || ROOT;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'data', 'formigueiros.db');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'data'), { recursive: true });

// ---------- Banco de dados ----------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS colonies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  colony_id TEXT NOT NULL,
  image_path TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  ref_length_cm REAL NOT NULL,
  ref_pixels REAL NOT NULL,
  px_per_cm REAL NOT NULL,
  diameter_cm REAL,
  area_cm2 REAL,
  height_cm REAL,
  volume_cm3 REAL,
  ant_count INTEGER,
  entrance_count INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_obs_colony ON observations(colony_id);
`);

// ---------- Upload ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${nanoid(12)}${ext}`);
  }
});

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.has(ext)) return cb(new Error('Formato de imagem nao suportado'));
    cb(null, true);
  }
});

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- Helpers ----------
function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeDerived({ diameter_cm, area_cm2, height_cm }) {
  let area = area_cm2;
  if (area == null && diameter_cm != null) {
    const r = diameter_cm / 2;
    area = Math.PI * r * r;
  }
  let volume = null;
  if (diameter_cm != null && height_cm != null) {
    // Formigueiros de montículo tendem a formato de cone/domo.
    const r = diameter_cm / 2;
    volume = (1 / 3) * Math.PI * r * r * height_cm; // aproximacao conica
  }
  return { area_cm2: area, volume_cm3: volume };
}

// ---------- Rotas: colonias ----------
app.get('/api/colonies', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM observations o WHERE o.colony_id = c.id) AS observation_count,
      (SELECT MAX(observed_at) FROM observations o WHERE o.colony_id = c.id) AS last_observed_at
    FROM colonies c
    ORDER BY c.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/colonies', (req, res) => {
  const { name, species, location, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do formigueiro e obrigatorio' });
  const id = nanoid(10);
  db.prepare(`INSERT INTO colonies (id, name, species, location, notes, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, name.trim(), species || null, location || null, notes || null, new Date().toISOString());
  res.status(201).json(db.prepare('SELECT * FROM colonies WHERE id = ?').get(id));
});

app.get('/api/colonies/:id', (req, res) => {
  const colony = db.prepare('SELECT * FROM colonies WHERE id = ?').get(req.params.id);
  if (!colony) return res.status(404).json({ error: 'Nao encontrado' });
  res.json(colony);
});

app.delete('/api/colonies/:id', (req, res) => {
  const obs = db.prepare('SELECT image_path FROM observations WHERE colony_id = ?').all(req.params.id);
  obs.forEach(o => {
    const p = path.join(UPLOAD_DIR, path.basename(o.image_path));
    fs.existsSync(p) && fs.unlinkSync(p);
  });
  db.prepare('DELETE FROM observations WHERE colony_id = ?').run(req.params.id);
  db.prepare('DELETE FROM colonies WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Rotas: observacoes ----------
app.get('/api/observations', (req, res) => {
  const { colony_id } = req.query;
  const rows = colony_id
    ? db.prepare('SELECT * FROM observations WHERE colony_id = ? ORDER BY observed_at ASC').all(colony_id)
    : db.prepare('SELECT * FROM observations ORDER BY observed_at ASC').all();
  res.json(rows);
});

app.post('/api/observations', upload.single('image'), (req, res) => {
  try {
    const b = req.body || {};
    const colony_id = b.colony_id;
    if (!colony_id) return res.status(400).json({ error: 'colony_id e obrigatorio' });
    const colony = db.prepare('SELECT id FROM colonies WHERE id = ?').get(colony_id);
    if (!colony) return res.status(404).json({ error: 'Formigueiro nao encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Imagem e obrigatoria' });

    const ref_length_cm = num(b.ref_length_cm);
    const ref_pixels = num(b.ref_pixels);
    if (!ref_length_cm || !ref_pixels) {
      return res.status(400).json({ error: 'Calibracao de escala (referencia) e obrigatoria' });
    }
    const px_per_cm = ref_pixels / ref_length_cm;

    let diameter_cm = num(b.diameter_cm);
    const diameter_px = num(b.diameter_px);
    if (diameter_cm == null && diameter_px != null) diameter_cm = diameter_px / px_per_cm;

    let area_cm2 = num(b.area_cm2);
    const area_px2 = num(b.area_px2);
    if (area_cm2 == null && area_px2 != null) area_cm2 = area_px2 / (px_per_cm * px_per_cm);

    const height_cm = num(b.height_cm);
    const ant_count = num(b.ant_count);
    const entrance_count = num(b.entrance_count);

    const derived = computeDerived({ diameter_cm, area_cm2, height_cm });

    const id = nanoid(12);
    const observed_at = b.observed_at ? new Date(b.observed_at).toISOString() : new Date().toISOString();

    db.prepare(`INSERT INTO observations
      (id, colony_id, image_path, observed_at, ref_length_cm, ref_pixels, px_per_cm,
       diameter_cm, area_cm2, height_cm, volume_cm3, ant_count, entrance_count, notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, colony_id, `/uploads/${req.file.filename}`, observed_at,
      ref_length_cm, ref_pixels, px_per_cm,
      diameter_cm, derived.area_cm2, height_cm, derived.volume_cm3,
      ant_count, entrance_count, b.notes || null, new Date().toISOString()
    );

    res.status(201).json(db.prepare('SELECT * FROM observations WHERE id = ?').get(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

app.delete('/api/observations/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM observations WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Nao encontrado' });
  const p = path.join(UPLOAD_DIR, path.basename(o.image_path));
  fs.existsSync(p) && fs.unlinkSync(p);
  db.prepare('DELETE FROM observations WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Estatisticas / dashboard ----------
function linregLogLog(points) {
  // points: [{x, y}] com x,y > 0. Ajuste y = a * x^b via log-log.
  const pts = points.filter(p => p.x > 0 && p.y > 0);
  const n = pts.length;
  if (n < 2) return null;
  const xs = pts.map(p => Math.log(p.x));
  const ys = pts.map(p => Math.log(p.y));
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  const lnA = my - b * mx;
  const a = Math.exp(lnA);
  // R^2
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = lnA + b * xs[i];
    ssTot += (ys[i] - my) ** 2;
    ssRes += (ys[i] - yPred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { a, b, r2, n };
}

app.get('/api/stats', (req, res) => {
  const colonies = db.prepare('SELECT * FROM colonies').all();
  const observations = db.prepare('SELECT * FROM observations ORDER BY observed_at ASC').all();

  const byColony = {};
  colonies.forEach(c => (byColony[c.id] = { colony: c, observations: [] }));
  observations.forEach(o => { if (byColony[o.colony_id]) byColony[o.colony_id].observations.push(o); });

  // Taxa de crescimento por formigueiro (cm/dia de diametro, entre 1a e ultima observacao)
  const growth = Object.values(byColony).map(({ colony, observations: obs }) => {
    if (obs.length === 0) return { colony, hasData: false };
    const withDiam = obs.filter(o => o.diameter_cm != null);
    let growthRateCmPerDay = null;
    if (withDiam.length >= 2) {
      const first = withDiam[0];
      const last = withDiam[withDiam.length - 1];
      const days = (new Date(last.observed_at) - new Date(first.observed_at)) / 86400000;
      if (days > 0) growthRateCmPerDay = (last.diameter_cm - first.diameter_cm) / days;
    }
    const latest = obs[obs.length - 1];
    return {
      colony,
      hasData: true,
      observationCount: obs.length,
      latest,
      growthRateCmPerDay,
      firstObservedAt: obs[0].observed_at,
      lastObservedAt: latest.observed_at
    };
  });

  // Escalonamento alometrico: area (cm2) vs numero de formigas
  const scalingPoints = observations
    .filter(o => o.area_cm2 != null && o.ant_count != null)
    .map(o => ({ x: o.ant_count, y: o.area_cm2, colony_id: o.colony_id }));
  const scalingFit = linregLogLog(scalingPoints);

  // Escalonamento diametro vs volume
  const volumePoints = observations
    .filter(o => o.diameter_cm != null && o.volume_cm3 != null)
    .map(o => ({ x: o.diameter_cm, y: o.volume_cm3, colony_id: o.colony_id }));
  const volumeFit = linregLogLog(volumePoints);

  const diameters = observations.map(o => o.diameter_cm).filter(v => v != null);
  const areas = observations.map(o => o.area_cm2).filter(v => v != null);

  const summary = {
    totalColonies: colonies.length,
    totalObservations: observations.length,
    avgDiameterCm: diameters.length ? diameters.reduce((s, v) => s + v, 0) / diameters.length : null,
    maxDiameterCm: diameters.length ? Math.max(...diameters) : null,
    minDiameterCm: diameters.length ? Math.min(...diameters) : null,
    avgAreaCm2: areas.length ? areas.reduce((s, v) => s + v, 0) / areas.length : null,
    biggestColony: growth.filter(g => g.hasData && g.latest.diameter_cm != null)
      .sort((a, b) => b.latest.diameter_cm - a.latest.diameter_cm)[0] || null,
    fastestGrowing: growth.filter(g => g.growthRateCmPerDay != null)
      .sort((a, b) => b.growthRateCmPerDay - a.growthRateCmPerDay)[0] || null,
  };

  res.json({
    summary,
    growth,
    scaling: { points: scalingPoints, fit: scalingFit },
    volumeScaling: { points: volumePoints, fit: volumeFit },
    diameterHistogram: diameters,
    areaHistogram: areas,
    byColony
  });
});

app.listen(PORT, () => {
  console.log(`\n  Formigueiro Analytics rodando em http://localhost:${PORT}\n`);
});
