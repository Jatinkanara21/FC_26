// node --test tests/   — checks that the browser model == scikit-learn and the site is complete.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");

const DOCS = path.join(__dirname, "..", "docs");
function loadData() {
  const ctx = { window: {} };
  for (const f of ["model.js", "stats.js", "samples.js"]) vm.runInNewContext(fs.readFileSync(path.join(DOCS, "data", f), "utf8"), ctx);
  for (const p of ctx.window.FC24_MODEL.data_files) vm.runInNewContext(fs.readFileSync(path.join(DOCS, "data", p), "utf8"), ctx);
  // use the unpacker from docs/app.js itself
  const app = fs.readFileSync(path.join(DOCS, "app.js"), "utf8");
  const src = app.slice(app.indexOf("function unpackTrees"), app.indexOf("async function gunzip"));
  const unpackTrees = new Function(src + "; return unpackTrees;")();
  const raw = zlib.gunzipSync(Buffer.from(ctx.window.FC24_PACKED, "base64"));
  ctx.window.FC24_MODEL.trees = unpackTrees(new Uint8Array(raw), ctx.window.FC24_MODEL.classes.length);
  return ctx.window;
}
// same walk as docs/app.js
function predictProba(M, x) {
  const p = new Array(M.classes.length).fill(0);
  for (const tr of M.trees) {
    let n = 0;
    while (tr.f[n] !== -1) n = Math.fround(x[tr.f[n]]) <= tr.t[n] ? n + 1 : tr.r[n];
    const v = tr.v[n];
    if (typeof v === "number") p[v] += 1; else v.forEach((q, j) => (p[j] += q));
  }
  return p.map(s => s / M.trees.length);
}
const argmax = a => a.indexOf(Math.max(...a));

test("JS forest gives the same probabilities as scikit-learn on 300 test rows", () => {
  const W = loadData();
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "sklearn_reference.json"), "utf8"));
  assert.strictEqual(JSON.stringify(ref.features), JSON.stringify(W.FC24_MODEL.features));
  let same = 0, maxDiff = 0;
  ref.X.forEach((x, i) => {
    const p = predictProba(W.FC24_MODEL, x);
    if (argmax(p) === argmax(ref.proba[i])) same++;
    p.forEach((q, j) => (maxDiff = Math.max(maxDiff, Math.abs(q - ref.proba[i][j]))));
  });
  assert.strictEqual(same, ref.X.length, `only ${same}/${ref.X.length} predictions match`);
  assert.ok(maxDiff < 1e-5, `max probability difference ${maxDiff}`);
});

test("model uses k = 15 SelectKBest features and the notebook's final setting", () => {
  const W = loadData();
  assert.strictEqual(W.FC24_MODEL.features.length, 15);
  assert.ok(W.FC24_MODEL.features.includes("attack_defence_gap"));
  assert.strictEqual(W.FC24_MODEL.trees.length, W.FC24_STATS.final_params.n_estimators);
  const best = W.FC24_STATS.comparison.reduce((a, b) => (b.CV_F1 > a.CV_F1 ? b : a));
  assert.strictEqual(best.Setting, W.FC24_STATS.best_setting);
  assert.ok(W.FC24_STATS.metrics.F1 > 0.75, "macro F1 unexpectedly low");
});

test("the 3 Step-12 inputs from the notebook give FWD, MID, DEF", () => {
  const M = loadData().FC24_MODEL;
  const rows = {
    FWD: { shooting: 76, dribbling: 87, defending: 35, attacking_finishing: 75, power_shot_power: 78, power_long_shots: 74, attacking_volleys: 68, mentality_penalties: 66, mentality_positioning: 82, skill_dribbling: 88, mentality_vision: 78, defending_sliding_tackle: 29, defending_standing_tackle: 33, defending_marking_awareness: 30, mentality_interceptions: 31 },
    MID: { shooting: 74, dribbling: 84, defending: 64, attacking_finishing: 68, power_shot_power: 80, power_long_shots: 80, attacking_volleys: 66, mentality_penalties: 70, mentality_positioning: 74, skill_dribbling: 83, mentality_vision: 89, defending_sliding_tackle: 58, defending_standing_tackle: 65, defending_marking_awareness: 66, mentality_interceptions: 70 },
    DEF: { shooting: 42, dribbling: 62, defending: 85, attacking_finishing: 35, power_shot_power: 60, power_long_shots: 40, attacking_volleys: 34, mentality_penalties: 40, mentality_positioning: 38, skill_dribbling: 58, mentality_vision: 52, defending_sliding_tackle: 85, defending_standing_tackle: 87, defending_marking_awareness: 86, mentality_interceptions: 84 },
  };
  for (const [want, o] of Object.entries(rows)) {
    const x = M.features.map(f => (f === "attack_defence_gap" ? (o.shooting + o.dribbling) / 2 - o.defending : o[f]));
    assert.strictEqual(M.classes[argmax(predictProba(M, x))], want);
  }
});

test("site files: title, viewport, local assets, no placeholders", () => {
  const html = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
  assert.match(html, /<title>[^<]*FC 24 Position Finder[^<]*<\/title>/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /KANARA JATIN JIJI/);
  assert.match(html, /Dashboard/);
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(fs.existsSync(path.join(DOCS, ref)), `missing ${ref}`);
  assert.doesNotMatch(html, /lorem|TODO|\[Your Name\]/i);
});


// ---------- v2: Simple mode mapping + new files ----------
function loadExtras() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(DOCS, "data", "extras.js"), "utf8"), ctx);
  const src = fs.readFileSync(path.join(DOCS, "extra.js"), "utf8");
  const body = src.slice(src.indexOf("/*MAP-START*/"), src.indexOf("/*MAP-END*/"));
  const mapSimple = new Function(body + "; return mapSimple;")();
  return { X: ctx.window.FC24_EXTRAS, mapSimple };
}

test("simple sliders map to valid model inputs and drive every model feature", () => {
  const W = loadData(), { X, mapSimple } = loadExtras(), SM = X.simple_map, F = W.FC24_MODEL.features;
  const driven = new Set(["shooting", "dribbling", "defending", ...Object.values(SM.groups).flat()]);
  for (const f of F) if (f !== "attack_defence_gap") assert.ok(driven.has(f), `${f} is not driven by any simple slider`);
  for (const v of [10, 25, 50, 75, 99]) {
    const o = mapSimple({ shooting: v, dribbling: v, passing: v, defending: 109 - v }, SM);
    const x = F.map(f => (f === "attack_defence_gap" ? (o.shooting + o.dribbling) / 2 - o.defending : o[f]));
    assert.strictEqual(x.length, 15);
    x.forEach((val, i) => {
      assert.ok(Number.isFinite(val), `${F[i]} not a number`);
      if (F[i] !== "attack_defence_gap") assert.ok(Number.isInteger(val) && val >= 10 && val <= 99, `${F[i]}=${val} out of 10-99`);
    });
  }
});

test("simple-mode predictions equal scikit-learn on 150 slider players", () => {
  const W = loadData(), { X, mapSimple } = loadExtras();
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "simple_reference.json"), "utf8"));
  assert.strictEqual(JSON.stringify(ref.features), JSON.stringify(W.FC24_MODEL.features));
  let maxDiff = 0;
  ref.simple.forEach((s, i) => {
    const o = mapSimple(s, X.simple_map);
    const x = ref.features.map(f => (f === "attack_defence_gap" ? (o.shooting + o.dribbling) / 2 - o.defending : o[f]));
    assert.deepStrictEqual(x, ref.X[i], `row ${i}: JS mapping differs from Python`);
    const p = predictProba(W.FC24_MODEL, x);
    assert.strictEqual(argmax(p), argmax(ref.proba[i]), `row ${i}: prediction differs`);
    p.forEach((q, j) => (maxDiff = Math.max(maxDiff, Math.abs(q - ref.proba[i][j]))));
  });
  assert.ok(maxDiff < 1e-5, `max probability difference ${maxDiff}`);
  const n = ref.simple.length;   // the last 3 are the Striker / Playmaker / Defender presets
  assert.deepStrictEqual([n - 3, n - 2, n - 1].map(i => ref.classes[argmax(ref.proba[i])]), ["FWD", "MID", "DEF"]);
});

test("admin: config stores a SHA-256 hash (not the password) and the JS hash matches", () => {
  const cfg = fs.readFileSync(path.join(DOCS, "config.js"), "utf8");
  const ctx = { window: {} }; vm.runInNewContext(cfg, ctx);
  const h = ctx.window.FC24_CONFIG.adminPasswordSha256;
  assert.strictEqual(h, "", "no weak default password should be shipped");
  const src = fs.readFileSync(path.join(DOCS, "extra.js"), "utf8");
  const body = src.slice(src.indexOf("function sha256"), src.indexOf("window.FC24_sha256"));
  const sha = new Function(body + "; return sha256;")();
  for (const s of ["fc24admin", "", "पासवर्ड ⚽ long text ".repeat(9)])
    assert.strictEqual(sha(s), require("node:crypto").createHash("sha256").update(s).digest("hex"));
});

test("v2 site: simple view is the default, advanced + admin exist", () => {
  const html = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
  assert.match(html, /<body class="mode-simple">/);
  assert.match(html, /Type a player name/);
  for (const id of ["view-simple", "view-advanced", "view-admin", "tab-compare", "why", "fClub", "adminLink"]) assert.match(html, new RegExp(`id="${id}"`));
  const simple = html.slice(html.indexOf('id="view-simple"'), html.indexOf('id="view-advanced"'));
  assert.doesNotMatch(simple, /\bF1\b|\bAUC\b/, "no jargon in simple mode");
});
