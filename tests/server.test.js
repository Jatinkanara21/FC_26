const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

test('server protects admin APIs and persists records', { timeout: 30000 }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fc26-admin-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const password = 'Test-only-Password-938!never-use-in-production';
  const hash = await bcrypt.hash(password, 4);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
      ADMIN_USERNAME: 'test-admin', ADMIN_PASSWORD_HASH: hash, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  const base = 'http://127.0.0.1:' + port;
  let cookie = '';
  async function request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + url, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { response, body: await response.json().catch(() => ({})) };
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('server exited before readiness');
      try { const r = await fetch(base + '/api/health'); if (r.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'server should become ready');
    const denied = await request('/api/admin/players');
    assert.equal(denied.response.status, 401);
    const badLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'test-admin', password: 'wrong' }) });
    assert.equal(badLogin.response.status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'test-admin', password }) });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.ok, true);
    const created = await request('/api/admin/players', { method: 'POST', body: JSON.stringify({ short: 'Test Player', ovr: 77, pos: 'CM' }) });
    assert.equal(created.response.status, 201);
    const id = created.body.id;
    assert.ok(id);
    const list = await request('/api/admin/players');
    assert.equal(list.response.status, 200);
    assert.equal(list.body.some(p => p.id === id && p.short === 'Test Player'), true);
    const settings = await request('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ appTitle: 'Saved title' }) });
    assert.equal(settings.response.status, 200);
    const readSettings = await request('/api/admin/settings');
    assert.equal(readSettings.body.appTitle, 'Saved title');
    const logout = await request('/api/auth/logout', { method: 'POST', body: '{}' });
    assert.equal(logout.response.status, 200);
    const afterLogout = await request('/api/admin/players');
    assert.equal(afterLogout.response.status, 401);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve).catch?.(()=>{})).catch(()=>{});
    await rm(dataDir, { recursive: true, force: true });
  }
});
