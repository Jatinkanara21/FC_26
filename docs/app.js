/* FC 24 Position Finder — the notebook's final Random Forest, running in the browser.
   docs/data/model.js is written by train.py: every tree of the final forest.
   Tree format: f = feature index (-1 = leaf), t = threshold, r = right child (left child = next node),
                v = class index (pure leaf) or class probabilities (mixed leaf).
   predictProba() == scikit-learn's predict_proba: the average of every tree's leaf class distribution. */
function boot() {
  "use strict";
  const M = window.FC24_MODEL, S = window.FC24_STATS, SAMPLES = window.FC24_SAMPLES || [];
  const C = M.classes, FEAT = M.features, NT = M.trees.length;
  const FI = Object.fromEntries(FEAT.map((f, i) => [f, i]));
  const NAMES = { FWD: "Forward", MID: "Midfielder", DEF: "Defender" };
  const COLORS = { DEF: "#2563eb", MID: "#16a34a", FWD: "#e11d48" };
  const ORDER = ["FWD", "MID", "DEF"];
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- the model ----------
  function predictProba(x) {
    const k = C.length, p = new Array(k).fill(0), votes = new Array(k).fill(0);
    for (const tr of M.trees) {
      const f = tr.f, t = tr.t, r = tr.r;
      let n = 0;
      while (f[n] !== -1) n = Math.fround(x[f[n]]) <= t[n] ? n + 1 : r[n];
      const v = tr.v[n];
      if (typeof v === "number") { p[v] += 1; votes[v] += 1; }
      else { let b = 0; for (let j = 0; j < k; j++) { p[j] += v[j]; if (v[j] > v[b]) b = j; } votes[b] += 1; }
    }
    return { p: p.map(s => s / NT), votes };
  }
  window.FC24_predictProba = predictProba;

  // ---------- inputs ----------
  const LABEL = {
    shooting: "Shooting", dribbling: "Dribbling", defending: "Defending", passing: "Passing", pace: "Pace", physic: "Physical",
    attacking_finishing: "Finishing", attacking_volleys: "Volleys", power_long_shots: "Long shots", mentality_penalties: "Penalties",
    mentality_positioning: "Att. positioning", power_shot_power: "Shot power", mentality_vision: "Vision", skill_dribbling: "Dribbling skill",
    defending_sliding_tackle: "Sliding tackle", defending_standing_tackle: "Standing tackle", defending_marking_awareness: "Def. awareness",
    mentality_interceptions: "Interceptions", attack_defence_gap: "Attack–defence gap"
  };
  const MAIN = ["shooting", "dribbling", "defending"];       // dribbling is only used to compute the gap
  const GROUPS = [
    ["🎯 Attacking", "shooting", ["attacking_finishing", "power_shot_power", "power_long_shots", "attacking_volleys", "mentality_penalties", "mentality_positioning"]],
    ["🪄 Creating", "dribbling", ["skill_dribbling", "mentality_vision"]],
    ["🛡️ Defending", "defending", ["defending_sliding_tackle", "defending_standing_tackle", "defending_marking_awareness", "mentality_interceptions"]],
  ];
  const INPUTS = MAIN.concat(...GROUPS.map(g => g[2])).filter((f, i, a) => a.indexOf(f) === i);
  const state = {};
  const range = () => [10, 99];   // FC 24 ratings scale used by every slider

  // Presets: the 3 "new realistic inputs" from Step 12 of the notebook, plus the real class averages.
  const P = (sh, dr, de, fin, sp, ls, vo, pen, pos, sd, vis, sl, st, mk, ic) => ({ shooting: sh, dribbling: dr, defending: de,
    attacking_finishing: fin, power_shot_power: sp, power_long_shots: ls, attacking_volleys: vo, mentality_penalties: pen,
    mentality_positioning: pos, skill_dribbling: sd, mentality_vision: vis, defending_sliding_tackle: sl,
    defending_standing_tackle: st, defending_marking_awareness: mk, mentality_interceptions: ic });
  const PRESETS = [
    ["⚡ Winger", P(76, 87, 35, 75, 78, 74, 68, 66, 82, 88, 78, 29, 33, 30, 31)],
    ["🎯 Playmaker", P(74, 84, 64, 68, 80, 80, 66, 70, 74, 83, 89, 58, 65, 66, 70)],
    ["🧱 Centre-back", P(42, 62, 85, 35, 60, 40, 34, 40, 38, 58, 52, 85, 87, 86, 84)],
  ];
  for (const c of ORDER) PRESETS.push([`📊 Average ${c}`, Object.fromEntries(INPUTS.map(f => [f, Math.round(S.class_feature_means[c][f])]))]);

  function sliderHTML(f) {
    const [lo, hi] = range(f);
    const extra = f === "dribbling" ? ` <small class="hint">(for the gap)</small>` : "";
    return `<div class="sl"><label for="in_${f}"><span>${LABEL[f] || f}${extra}</span><output id="out_${f}"></output></label>
      <input type="range" id="in_${f}" data-f="${f}" min="${lo}" max="${hi}" step="1"></div>`;
  }
  function buildInputs() {
    $("mainSliders").innerHTML = MAIN.map(sliderHTML).join("");
    $("groupCards").innerHTML = `<div class="row-head"><h2>Detailed skills</h2><span class="hint">the model's selected features</span></div>` +
      GROUPS.map(([t, main, fs]) => `<div class="grp"><h3>${t} <small>${fs.length}</small></h3><div class="sliders">${fs.map(sliderHTML).join("")}</div></div>`).join("");
    $("presets").innerHTML = PRESETS.map((p, i) => `<button class="chip" type="button" data-p="${i}">${p[0]}</button>`).join("") +
      (SAMPLES.length ? `<button class="chip dice" type="button" id="dice">🎲 Random real player</button>` : "");
    document.querySelectorAll("input[type=range]").forEach(el => el.addEventListener("input", e => {
      const f = e.target.dataset.f, nv = +e.target.value, old = state[f];
      state[f] = nv;
      if ($("linkToggle").checked) for (const [, main, fs] of GROUPS) if (main === f) for (const g of fs) { const [lo, hi] = range(g); state[g] = clamp(state[g] + nv - old, lo, hi); }
      clearPreset(); render();
    }));
    document.querySelectorAll("input[type=range][data-f]").forEach(el => el.addEventListener("change", () => logAdv("sliders", "Advanced sliders")));
    document.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => {
      load(PRESETS[+b.dataset.p][1]); clearPreset(); b.classList.add("on"); render(null); logAdv("preset", PRESETS[+b.dataset.p][0].replace(/^\S+\s/, ""));
    }));
    if ($("dice")) $("dice").addEventListener("click", () => {
      const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
      const o = { dribbling: s.dribbling }; FEAT.forEach((f, i) => o[f] = s.x[i]);
      load(o); clearPreset(); $("dice").classList.add("on"); render(s); logAdv("random", s.name, s.actual);
    });
  }
  function clearPreset() { document.querySelectorAll(".chip.on").forEach(c => c.classList.remove("on")); }
  function load(o) { for (const f of INPUTS) if (o[f] !== undefined) { const [lo, hi] = range(f); state[f] = clamp(Math.round(o[f]), lo, hi); } }
  function vector() {
    return FEAT.map(f => f === "attack_defence_gap" ? (state.shooting + state.dribbling) / 2 - state.defending : state[f]);
  }

  // ---------- prediction log (admin) ----------
  function logAdv(source, name, actual) {
    if (!window.FC24_log) return;
    const x = vector(), { p } = predictProba(x); let top = 0; p.forEach((v, i) => { if (v > p[top]) top = i; });
    window.FC24_log({ mode: "advanced", source, name, x, pred: C[top], conf: p[top], actual: actual || null });
  }

  // ---------- render ----------
  let lastTop = null;
  function render(real) {
    for (const f of INPUTS) { $("in_" + f).value = state[f]; $("out_" + f).textContent = state[f]; }
    const x = vector(), { p, votes } = predictProba(x);
    let top = 0; p.forEach((v, i) => { if (v > p[top]) top = i; });
    const code = C[top];
    $("posCode").textContent = code; $("posCode").style.color = COLORS[code]; $("posName").textContent = NAMES[code];
    $("conf").textContent = `${(p[top] * 100).toFixed(1)}% · ${votes[top]} of ${NT} trees vote ${code}`;
    $("probBars").innerHTML = ORDER.map(c => { const i = C.indexOf(c); return `<div class="bar"><div class="bl"><span>${NAMES[c]} (${c})</span><span>${(p[i] * 100).toFixed(1)}%</span></div>
      <div class="bt"><div class="bf" style="width:${(p[i] * 100).toFixed(1)}%;background:${COLORS[c]}"></div></div></div>`; }).join("");
    document.querySelectorAll(".zone").forEach(z => z.classList.toggle("hit", z.textContent === code));
    if (lastTop !== null && code !== lastTop) { const b = $("posBadge"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    lastTop = code;
    $("miniCode").textContent = code; $("miniCode").style.color = { DEF: "#93c5fd", MID: "#86efac", FWD: "#fda4af" }[code];
    $("miniPct").textContent = (p[top] * 100).toFixed(0) + "%";
    const gap = x[FI.attack_defence_gap], m = S.class_feature_means;
    $("gapBox").innerHTML = `<b>Attack–defence gap: ${gap > 0 ? "+" : ""}${gap.toFixed(1)}</b> <span class="hint">= (shooting + dribbling) / 2 − defending · the #1 feature</span>
      <div class="track"><div class="dot" style="left:${clamp((gap + 45) / 105 * 100, 0, 100).toFixed(1)}%"></div></div>
      <div class="ends"><span>DEF avg ${m.DEF.attack_defence_gap.toFixed(1)}</span><span>MID avg +${m.MID.attack_defence_gap.toFixed(1)}</span><span>FWD avg +${m.FWD.attack_defence_gap.toFixed(1)}</span></div>`;
    if (real && real.player) {
      const pl = real.player, ok = pl.actual === code;
      $("realBox").hidden = false;
      $("realBox").innerHTML = `⚽ <b>${esc(pl.long)}</b> <span class="meta">· ${esc(pl.club || "Free agent")} · ${esc(pl.nation)} · OVR ${pl.ovr}</span><br>
        ${pl.actual ? `Real position <b>${esc(pl.pos)} (${pl.actual})</b> → model predicts <b>${code}</b> <span class="${ok ? "ok" : "bad"}">${ok ? "✅ correct" : "❌ wrong"}</span>` : `Model predicts <b>${code}</b> (no real position given)`}
        <br><span class="meta">${pl.custom ? "Custom player added in Admin (saved in this browser)." : pl.test ? "Test-set player: the model never saw him in training, so this is an honest check." : "This player was in the training data (80%), so the model has seen him; 🎲 test-set players are the honest check."}</span>`;
    } else if (real) {
      const ok = real.actual === code;
      $("realBox").hidden = false;
      $("realBox").innerHTML = `🎲 <b>${esc(real.name)}</b>, a real FC 24 player from the test set (never seen in training): actual <b>${real.actual}</b> → predicted <b>${code}</b> <span class="${ok ? "ok" : "bad"}">${ok ? "✓ correct" : "✗ wrong"}</span>`;
    } else if (real === null) $("realBox").hidden = true;
    if (window.FC24_onAdvRender) window.FC24_onAdvRender(x, p, code);
  }

  // ---------- dashboard ----------
  function hbars(rows, max, fmt) {
    return rows.map(([k, v, col]) => `<div class="hb"><span class="k" title="${esc(k)}">${esc(k)}</span><div class="t"><div class="f" style="width:${(v / max * 100).toFixed(1)}%;${col ? "background:" + col : ""}"></div></div><span class="n">${fmt(v)}</span></div>`).join("");
  }
  function buildDashboard() {
    const mt = S.metrics;
    $("heroMetrics").innerHTML = [["Macro F1", mt.F1], ["Accuracy", mt.Accuracy], ["AUC", mt.AUC]].map(([k, v]) => `<div class="hm"><b>${v.toFixed(3)}</b><span>${k}</span></div>`).join("");
    $("metricCards").innerHTML = [["Macro F1 (main)", mt.F1, 1], ["Accuracy", mt.Accuracy], ["Precision", mt.Precision], ["Recall", mt.Recall], ["Specificity", mt.Specificity], ["AUC (OvR)", mt.AUC]]
      .map(([k, v, main]) => `<div class="metric${main ? " main" : ""}"><b>${v.toFixed(3)}</b><span>${k}</span></div>`).join("");
    const cols = ["Accuracy", "Precision", "Recall", "F1", "Specificity", "AUC"];
    $("cmpTable").innerHTML = `<table class="cmp"><thead><tr><th>Setting</th>${cols.map(c => `<th class="${c === "F1" ? "f1" : ""}">${c === "F1" ? "Macro F1" : c}</th>`).join("")}</tr></thead><tbody>` +
      S.comparison.map(r => `<tr class="${r.Setting === S.best_setting ? "best" : ""}"><td>${r.Setting}${r.Setting === S.best_setting ? " ★" : ""}</td>${cols.map(c => `<td class="${c === "F1" ? "f1" : ""}">${r[c].toFixed(3)}</td>`).join("")}</tr>`).join("") + `</tbody></table>`;
    $("bestNote").textContent = `★ best by macro F1 → final model (${S.final_params.n_estimators} trees, max_depth=${S.final_params.max_depth === null ? "None" : S.final_params.max_depth})`;
    const lo = Math.min(...S.comparison.map(r => r.F1)) - 0.02;
    $("cmpBars").innerHTML = `<p class="hint">Macro F1 by setting (axis starts at ${lo.toFixed(2)})</p>` + hbars(S.comparison.map(r => [r.Setting, r.F1 - lo, r.Setting === S.best_setting ? "#e11d48" : ""]), Math.max(...S.comparison.map(r => r.F1)) - lo, v => (v + lo).toFixed(3));
    // confusion matrix
    const L = S.confusion_matrix.labels, mx = S.confusion_matrix.matrix, big = Math.max(...mx.flat());
    let g = `<div class="h"></div>` + ORDER.map(c => `<div class="h">pred ${c}</div>`).join("");
    for (const a of ORDER) { g += `<div class="h">${a}</div>`; for (const b of ORDER) { const v = mx[L.indexOf(a)][L.indexOf(b)], al = 0.07 + 0.85 * v / big; g += `<div style="background:rgba(18,87,63,${al.toFixed(2)});color:${al > .5 ? "#fff" : "#10231b"};font-weight:${a === b ? 800 : 500}">${v.toLocaleString()}</div>`; } }
    const correct = L.reduce((s, c, i) => s + mx[i][i], 0), tot = mx.flat().reduce((a, b) => a + b, 0);
    $("cm").innerHTML = `<div class="cm">${g}</div><p class="hint">${correct.toLocaleString()} of ${tot.toLocaleString()} test players correct.</p>`;
    // ROC
    const W = 320, H = 300, pad = 42, sx = v => pad + v * (W - pad - 8), sy = v => H - pad - v * (H - pad - 8);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ROC curves for each class"><rect x="${pad}" y="8" width="${W - pad - 8}" height="${H - pad - 8}" fill="#f7faf8" stroke="#e3e9e5"/>`;
    for (let i = 0; i <= 4; i++) { const v = i / 4; svg += `<text x="${sx(v)}" y="${H - pad + 16}" font-size="10" text-anchor="middle" fill="#5b6b63">${v}</text><text x="${pad - 6}" y="${sy(v) + 3}" font-size="10" text-anchor="end" fill="#5b6b63">${v}</text>`; }
    svg += `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(1)}" stroke="#9ca3af" stroke-dasharray="4 4"/>`;
    for (const c of ORDER) { const r = S.roc[c]; svg += `<polyline fill="none" stroke="${COLORS[c]}" stroke-width="2.2" points="${r.fpr.map((v, i) => sx(v).toFixed(1) + "," + sy(r.tpr[i]).toFixed(1)).join(" ")}"/>`; }
    svg += `<text x="${(W + pad) / 2}" y="${H - 4}" font-size="11" text-anchor="middle" fill="#5b6b63">False positive rate</text><text x="10" y="${H / 2}" font-size="11" text-anchor="middle" fill="#5b6b63" transform="rotate(-90 10 ${H / 2})">True positive rate</text></svg>`;
    $("roc").innerHTML = `<div class="roc">${svg}</div><div class="legend">${ORDER.map(c => `<span><i style="background:${COLORS[c]}"></i>${c} vs rest · AUC ${S.roc[c].auc.toFixed(3)}</span>`).join("")}<span>macro AUC ${mt.AUC.toFixed(3)}</span></div>`;
    // importance
    const imp = S.feature_importance;
    $("imp").innerHTML = hbars(imp.map(([k, v]) => [LABEL[k] || k, v, k === "attack_defence_gap" ? "#e11d48" : ""]), imp[0][1], v => v.toFixed(3));
    // dataset
    const cc = S.class_counts;
    $("classBars").innerHTML = hbars(ORDER.map(c => [`${NAMES[c]} (${c})`, cc[c], COLORS[c]]), Math.max(...Object.values(cc)), v => v.toLocaleString());
    $("splitNote").textContent = `${S.rows_outfield.toLocaleString()} outfield players (goalkeepers removed) · train ${S.train_rows.toLocaleString()} / test ${S.test_rows.toLocaleString()} (80/20, stratified) · SelectKBest kept ${S.k} of ${S.n_columns_before_selection} columns.`;
    const cm = S.class_means_main_stats, mc = ["pace", "shooting", "passing", "dribbling", "defending", "physic", "height_cm"];
    $("means").innerHTML = `<div class="tbl"><table><thead><tr><th>Class</th>${mc.map(c => `<th>${c === "height_cm" ? "Height" : (LABEL[c] || c).slice(0, 5)}</th>`).join("")}</tr></thead><tbody>` +
      ORDER.map(c => `<tr><td><span class="tag" style="background:${COLORS[c]}">${c}</span></td>${mc.map(k => `<td>${cm[c][k]}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
    const ec = S.export_check;
    $("checkCard").innerHTML = `<h2>Is this page running the real model?</h2>
      <p>Yes. <code>train.py</code> exports all ${NT} trees of the notebook's final Random Forest. It then runs the exported trees the same way this page does on all ${ec.test_rows.toLocaleString()} test players and compares with scikit-learn: <b>${(ec.same_prediction_share * 100).toFixed(2)}% identical predictions</b> (largest probability difference ${ec.max_probability_diff.toExponential(0)}). So every number on this dashboard is the score of the model you are using on the Predict tab.</p>`;
    $("modelNote").textContent = `Runs 100% in your browser: the notebook's final forest (${NT} trees, ${FEAT.length} features from SelectKBest), exported to JSON. Test macro F1 ${mt.F1.toFixed(3)}.`;
  }

  // ---------- CSV batch ----------
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else if (ch !== "\r") cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function group(pos) {
    const p = String(pos).split(",")[0].trim();
    if (["ST", "CF", "LW", "RW", "LF", "RF"].includes(p)) return "FWD";
    if (["CM", "CDM", "CAM", "LM", "RM"].includes(p)) return "MID";
    if (["CB", "LB", "RB", "LWB", "RWB"].includes(p)) return "DEF";
    return p ? "GK" : null;
  }
  function handleCSV(file) {
    $("csvStatus").textContent = `Reading ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…`; $("csvOut").innerHTML = "";
    const rd = new FileReader();
    rd.onload = () => setTimeout(() => {
      const t0 = performance.now();
      const rows = parseCSV(rd.result), head = rows.shift().map(h => h.trim()), H = Object.fromEntries(head.map((h, i) => [h, i]));
      const need = FEAT.filter(f => f !== "attack_defence_gap").concat(FI.attack_defence_gap !== undefined && !("attack_defence_gap" in H) ? ["dribbling"] : []);
      const missing = need.filter(f => !(f in H));
      if (missing.length) { $("csvStatus").textContent = "This CSV is missing columns the model needs: " + missing.join(", "); return; }
      const out = []; let gk = 0, bad = 0;
      for (const r of rows) {
        if (r.length < 2) continue;
        if ("fifa_version" in H && r[H.fifa_version] !== "" && +r[H.fifa_version] !== 24) continue;
        let actual = null;
        if ("player_positions" in H) { actual = group(r[H.player_positions]); if (actual === "GK") { gk++; continue; } }
        const o = {}; for (const f of need) o[f] = parseFloat(r[H[f]]);
        o.attack_defence_gap = "attack_defence_gap" in H ? parseFloat(r[H.attack_defence_gap]) : (o.shooting + o.dribbling) / 2 - o.defending;
        const x = FEAT.map(f => o[f]);
        if (x.some(v => !isFinite(v))) { bad++; continue; }
        const { p } = predictProba(x); let top = 0; p.forEach((v, i) => { if (v > p[top]) top = i; });
        out.push({ name: "short_name" in H ? r[H.short_name] : `row ${out.length + 1}`, actual, pred: C[top], conf: p[top] });
      }
      const ms = performance.now() - t0, withA = out.filter(o => o.actual), correct = withA.filter(o => o.actual === o.pred).length;
      const dist = Object.fromEntries(ORDER.map(c => [c, out.filter(o => o.pred === c).length]));
      $("csvStatus").textContent = `Predicted ${out.length.toLocaleString()} players in ${(ms / 1000).toFixed(1)} s on your device` + (gk ? ` · ${gk.toLocaleString()} goalkeepers skipped` : "") + (bad ? ` · ${bad} rows with missing values skipped` : "") + ".";
      let h = `<div class="cards4">` + (withA.length ? `<div class="metric main"><b>${(correct / withA.length * 100).toFixed(1)}%</b><span>match real position</span></div>` : "") +
        ORDER.map(c => `<div class="metric"><b style="color:${COLORS[c]}">${dist[c].toLocaleString()}</b><span>predicted ${c}</span></div>`).join("") + `</div>`;
      if (withA.length) h += `<p class="hint">A full Kaggle file also contains the players the model was trained on, so this match rate is higher than the honest test-set result (macro F1 ${S.metrics.F1.toFixed(3)}, accuracy ${S.metrics.Accuracy.toFixed(3)}).</p>`;
      h += `<p><button class="btn" id="dl" type="button">⬇ Download predictions CSV</button></p><div class="tbl"><table><thead><tr><th>Player</th><th>Actual</th><th>Predicted</th><th>Confidence</th></tr></thead><tbody>` +
        out.slice(0, 25).map(o => `<tr><td>${esc(o.name)}</td><td>${o.actual || "–"}</td><td><span class="tag" style="background:${COLORS[o.pred]}">${o.pred}</span></td><td>${(o.conf * 100).toFixed(0)}%</td></tr>`).join("") + `</tbody></table></div><p class="hint">First 25 rows shown.</p>`;
      $("csvOut").innerHTML = h;
      $("dl").addEventListener("click", () => {
        const csv = "player,actual,predicted,confidence\n" + out.map(o => `"${String(o.name).replace(/"/g, '""')}",${o.actual || ""},${o.pred},${o.conf.toFixed(3)}`).join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "fc24_predictions.csv"; a.click();
      });
    }, 30);
    rd.readAsText(file);
  }

  // ---------- tabs + mobile pill ----------
  let resultVisible = true;
  function syncMini() { $("mini").classList.toggle("hide", resultVisible || !$("tab-predict").classList.contains("active")); }
  function tabs() {
    document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => { t.classList.toggle("active", t === b); t.setAttribute("aria-selected", t === b); });
      document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + b.dataset.tab));
      history.replaceState(null, "", "#" + b.dataset.tab); syncMini();
    }));
    const b = document.querySelector(`.tab[data-tab="${location.hash.slice(1)}"]`); if (b) b.click();
  }

  // ---------- player search (names are only for search/display, never model inputs) ----------
  function setupSearch() {
    if (!window.FC24_PLAYERS_PACKED) return;
    const bin = atob(window.FC24_PLAYERS_PACKED), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    gunzip(bytes).then(raw => {
      window.FC24_PLAYERS_PACKED = null;
      const D = JSON.parse(new TextDecoder().decode(raw));
      const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const list = D.rows.map(r => ({ short: r[0], long: r[1] || r[0], club: D.clubs[r[2]], nation: D.nations[r[3]], ovr: r[4], pos: r[5],
        actual: C[r[6]] || null, test: r[7] === 1, vals: Object.fromEntries(D.cols.map((c, j) => [c, r[8 + j]])), key: norm(r[0] + " " + (r[1] || "")) }));
      const q = $("q"), ul = $("sugg");
      q.disabled = false; q.placeholder = `🔍 Search ${list.length.toLocaleString()} FC 24 players, e.g. Haaland`;
      let hits = [], sel = -1;
      const show = () => {
        ul.hidden = !hits.length; q.setAttribute("aria-expanded", hits.length > 0);
        ul.innerHTML = hits.map((p, i) => `<li role="option" id="opt${i}" data-i="${i}" aria-selected="${i === sel}"><span class="ovr">${p.ovr}</span>
          <span class="nm">${esc(p.short)}${p.custom ? ' <em class="cus">custom</em>' : ""}<small>${esc(p.club || "Free agent")} · ${esc(p.nation)}</small></span><span class="ps">${p.pos}</span></li>`).join("");
      };
      q.addEventListener("input", () => {
        const t = norm(q.value.trim()); sel = -1;
        if (t.length < 2 && !(window.FC24.filterActive && window.FC24.filterActive())) { hits = []; return show(); }
        const words = t.split(/\s+/);
        const starts = [], contains = [];
        for (const p of window.FC24.searchList()) {   // custom players first, then real players by overall
          if (!window.FC24.passFilter(p)) continue;
          if (!words.every(w => p.key.includes(w))) continue;
          (p.key.split(/[\s.\-']+/).some(k => k.startsWith(words[0])) ? starts : contains).push(p);
          if (starts.length >= 8) break;
        }
        hits = starts.concat(contains).slice(0, 8); show();
      });
      q.addEventListener("keydown", e => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!hits.length) return; sel = (sel + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length; show(); }
        else if (e.key === "Enter" && hits.length) { e.preventDefault(); pick(hits[Math.max(sel, 0)]); }
        else if (e.key === "Escape") { hits = []; show(); }
      });
      ul.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); pick(hits[+li.dataset.i]); } });
      q.addEventListener("blur", () => setTimeout(() => { hits = []; show(); }, 150));
      function pick(p) {
        q.value = p.short; hits = []; show(); q.blur();
        load(p.vals); clearPreset();
        render({ player: p }); logAdv("search", p.short, p.actual);
        if (window.innerWidth <= 900) $("result").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      window.FC24_searchPlayers = list;
      window.FC24.basePlayers = list; window.FC24.norm = norm;
      document.dispatchEvent(new Event("fc24:players"));
    }).catch(() => { $("q").placeholder = "Player search could not load"; });
  }

  // ---------- shared API for extra.js (simple mode, compare, why, admin) ----------
  window.FC24 = Object.assign(window.FC24 || {}, {
    M, S, C, FEAT, FI, NT, NAMES, COLORS, ORDER, LABEL, INPUTS, predictProba, esc, basePlayers: [],
    searchList() { return (window.FC24.customPlayers ? window.FC24.customPlayers() : []).concat(window.FC24.basePlayers); },
    passFilter() { return true; },
    vectorFrom(o) { return FEAT.map(f => f === "attack_defence_gap" ? (o.shooting + o.dribbling) / 2 - o.defending : o[f]); },
    openInAdvanced(o, real) { load(o); clearPreset(); render(real || null); },
  });
  buildInputs(); buildDashboard(); setupSearch();
  if (window.FC24_afterBoot) window.FC24_afterBoot();
  load(PRESETS[1][1]); document.querySelector('[data-p="1"]').classList.add("on"); render();
  tabs();
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { resultVisible = es[0].isIntersecting; syncMini(); }).observe($("result"));
  $("csvFile").addEventListener("change", e => e.target.files[0] && handleCSV(e.target.files[0]));
}

// ---------- unpack the model (twin of unpack_trees() in train.py) ----------
// Each tree is stored in pre-order: byte < 128 = split on feature b, then int16 threshold*4;
// byte 128+c = pure leaf of class c; byte 255 = mixed leaf, then k float32 probabilities.
function unpackTrees(buf, k) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), trees = [];
  let pos = 0;
  while (pos < buf.length) {
    const f = [], t = [], r = [], v = [], stack = [];
    for (;;) {
      const b = buf[pos++];
      if (b < 128) { f.push(b); t.push(dv.getInt16(pos, true) / 4); pos += 2; r.push(0); v.push(0); stack.push(f.length - 1); continue; }
      if (b === 255) { const p = []; for (let j = 0; j < k; j++) { p.push(dv.getFloat32(pos, true)); pos += 4; } v.push(p); }
      else v.push(b - 128);
      f.push(-1); t.push(0); r.push(0);
      if (!stack.length) break;
      r[stack.pop()] = f.length;
    }
    trees.push({ f, t, r, v });
  }
  return trees;
}
async function gunzip(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser is too old to unpack the model (no DecompressionStream). Try Chrome, Edge, Firefox or Safari 16.4+.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Load data/model_data_N.js in order, unpack the forest, then start the app.
(function loadModel() {
  const meta = window.FC24_MODEL, status = document.getElementById("posName");
  const files = meta.data_files.slice();
  const fail = e => { status.textContent = "model failed to load"; document.getElementById("conf").textContent = String(e.message || e); };
  (function next() {
    if (!files.length) {
      const bin = atob(window.FC24_PACKED), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      gunzip(bytes).then(raw => {
        meta.trees = unpackTrees(raw, meta.classes.length);
        window.FC24_PACKED = null;
        boot();
      }).catch(fail);
      return;
    }
    const s = document.createElement("script");
    s.src = "data/" + files.shift();
    s.onload = () => { status.textContent = `loading model ${Math.round((1 - files.length / meta.data_files.length) * 100)}%`; next(); };
    s.onerror = () => fail(new Error("could not load " + s.src));
    document.head.appendChild(s);
  })();
})();
