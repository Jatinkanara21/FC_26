const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data-private'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'fc26-admin.sqlite');
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const production = process.env.NODE_ENV === 'production';

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET is required and must be at least 32 characters.');
}
if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !/^\$2[aby]\$\d\d\$/.test(ADMIN_PASSWORD_HASH)) {
  throw new Error('Set ADMIN_USERNAME and a bcrypt ADMIN_PASSWORD_HASH before starting the server.');
}
if (production && process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  short TEXT NOT NULL,
  long TEXT NOT NULL DEFAULT '',
  club TEXT NOT NULL DEFAULT '',
  nation TEXT NOT NULL DEFAULT '',
  ovr INTEGER NOT NULL DEFAULT 0 CHECK (ovr BETWEEN 0 AND 99),
  pos TEXT NOT NULL DEFAULT '',
  vals_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS prediction_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mode TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  player_name TEXT NOT NULL DEFAULT '',
  prediction TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  actual TEXT,
  correct INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prediction_logs_created ON prediction_logs(created_at DESC);
`);
const admin = db.prepare('SELECT id FROM admins WHERE username = ?').get(ADMIN_USERNAME);
if (!admin) {
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(ADMIN_USERNAME, ADMIN_PASSWORD_HASH);
} else {
  db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(ADMIN_PASSWORD_HASH, ADMIN_USERNAME);
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(session({
  name: 'fc26.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR, concurrentDB: true }),
  cookie: { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge: 30 * 60 * 1000 },
  rolling: true
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });
const requireAdmin = (req, res, next) => {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: 'Authentication required.' });
};
const sameOrigin = (req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked.' });
    } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
  }
  next();
};
const clean = (value, max = 160) => String(value == null ? '' : value).trim().slice(0, max);
const json = value => JSON.stringify(value == null ? {} : value);
const publicPlayer = row => ({ id: row.id, short: row.short, long: row.long, club: row.club, nation: row.nation, ovr: row.ovr, pos: row.pos, vals: JSON.parse(row.vals_json) });
const allPlayers = db.prepare('SELECT * FROM players ORDER BY short COLLATE NOCASE');
const insertPlayer = db.prepare(`INSERT INTO players(id,short,long,club,nation,ovr,pos,vals_json,updated_at)
 VALUES(@id,@short,@long,@club,@nation,@ovr,@pos,@vals_json,CURRENT_TIMESTAMP)`);
const updatePlayer = db.prepare(`UPDATE players SET short=@short,long=@long,club=@club,nation=@nation,ovr=@ovr,pos=@pos,vals_json=@vals_json,updated_at=CURRENT_TIMESTAMP WHERE id=@id`);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'fc26-admin-api', adminBackend: true }));
app.get('/api/players', (_req, res) => res.json(allPlayers.all().map(publicPlayer)));
app.get('/api/site-settings', (_req, res) => {
  const rows = db.prepare('SELECT key,value_json FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value_json)])));
});
app.post('/api/auth/login', loginLimiter, sameOrigin, async (req, res, next) => {
  try {
    const username = clean(req.body.username, 100);
    const password = String(req.body.password || '');
    const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    const ok = row && password.length <= 1024 && await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.adminId = row.id;
      req.session.username = row.username;
      req.session.save(err2 => err2 ? next(err2) : res.json({ ok: true, username: row.username }));
    });
  } catch (err) { next(err); }
});
app.get('/api/auth/me', requireAdmin, (req, res) => res.json({ ok: true, username: req.session.username }));
app.post('/api/auth/logout', sameOrigin, requireAdmin, (req, res, next) => req.session.destroy(err => {
  if (err) return next(err);
  res.clearCookie('fc26.sid', { path: '/', httpOnly: true, secure: production, sameSite: 'strict' });
  res.json({ ok: true });
}));

const publicLogLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
app.post('/api/predictions', publicLogLimiter, sameOrigin, (req, res) => {
  const p = req.body || {};
  const pred = clean(p.pred, 12);
  if (!['FWD', 'MID', 'DEF'].includes(pred)) return res.status(400).json({ error: 'Invalid prediction class.' });
  const result = db.prepare(`INSERT INTO prediction_logs(mode,source,player_name,prediction,confidence,actual,correct)
    VALUES(?,?,?,?,?,?,?)`).run(clean(p.mode,40),clean(p.source,80),clean(p.name,160),pred,
      Math.max(0,Math.min(1,Number(p.conf)||0)),p.actual ? clean(p.actual,12) : null,
      p.correct == null ? null : (p.correct ? 1 : 0));
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
});

app.use('/api/admin', sameOrigin, requireAdmin);
app.get('/api/admin/players', (_req, res) => res.json(allPlayers.all().map(publicPlayer)));
app.post('/api/admin/players', (req, res) => {
  const p = req.body || {};
  const player = { id: crypto.randomUUID(), short: clean(p.short, 100), long: clean(p.long || p.short, 160),
    club: clean(p.club, 120), nation: clean(p.nation, 120), ovr: Number(p.ovr || 0), pos: clean(p.pos, 24), vals_json: json(p.vals) };
  if (!player.short) return res.status(400).json({ error: 'Player name is required.' });
  if (!Number.isInteger(player.ovr) || player.ovr < 0 || player.ovr > 99) return res.status(400).json({ error: 'OVR must be an integer from 0 to 99.' });
  try { insertPlayer.run(player); res.status(201).json(publicPlayer(db.prepare('SELECT * FROM players WHERE id=?').get(player.id))); }
  catch (err) { if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return res.status(409).json({ error: 'Player already exists.' }); throw err; }
});
app.put('/api/admin/players/:id', (req, res) => {
  const p = req.body || {};
  const player = { id: clean(req.params.id, 80), short: clean(p.short, 100), long: clean(p.long || p.short, 160),
    club: clean(p.club, 120), nation: clean(p.nation, 120), ovr: Number(p.ovr || 0), pos: clean(p.pos, 24), vals_json: json(p.vals) };
  if (!player.short || !Number.isInteger(player.ovr) || player.ovr < 0 || player.ovr > 99) return res.status(400).json({ error: 'Valid player name and OVR (0–99) are required.' });
  const result = updatePlayer.run(player);
  if (!result.changes) return res.status(404).json({ error: 'Player not found.' });
  res.json(publicPlayer(db.prepare('SELECT * FROM players WHERE id=?').get(player.id)));
});
app.delete('/api/admin/players/:id', (req, res) => {
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(clean(req.params.id, 80));
  if (!result.changes) return res.status(404).json({ error: 'Player not found.' });
  res.json({ ok: true });
});
app.get('/api/admin/settings', (_req, res) => {
  const rows = db.prepare('SELECT key,value_json FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value_json)])));
});
app.put('/api/admin/settings', (req, res) => {
  const allowed = ['appTitle', 'defaultMode', 'theme', 'banner'];
  const save = db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP');
  const tx = db.transaction(input => {
    for (const key of allowed) if (Object.hasOwn(input, key)) save.run(key, json(key === 'appTitle' || key === 'banner' ? clean(input[key], 240) : clean(input[key], 24)));
  });
  tx(req.body || {});
  res.json({ ok: true });
});
app.get('/api/admin/logs', (req, res) => {
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 200));
  res.json(db.prepare('SELECT id,created_at AS createdAt,mode,source,player_name AS name,prediction AS pred,confidence AS conf,actual,correct FROM prediction_logs ORDER BY id DESC LIMIT ?').all(limit));
});
app.post('/api/admin/logs', (req, res) => {
  const p = req.body || {};
  const result = db.prepare(`INSERT INTO prediction_logs(mode,source,player_name,prediction,confidence,actual,correct)
    VALUES(?,?,?,?,?,?,?)`).run(clean(p.mode,40),clean(p.source,80),clean(p.name,160),clean(p.pred,12),
      Math.max(0,Math.min(1,Number(p.conf)||0)),p.actual ? clean(p.actual,12) : null,
      p.correct == null ? null : (p.correct ? 1 : 0));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.delete('/api/admin/logs', (_req, res) => { db.prepare('DELETE FROM prediction_logs').run(); res.json({ ok: true }); });

app.get('/admin', (_req, res) => res.redirect(308, '/admin/'));
app.get('/admin/', (_req, res) => res.sendFile(path.join(ROOT, 'admin', 'index.html')));
app.use(express.static(path.join(ROOT, 'docs'), { extensions: ['html'], index: 'index.html', maxAge: production ? '1h' : 0 }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});
app.listen(PORT, () => console.log(`FC_26 server listening on port ${PORT}`));
