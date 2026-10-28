/* extra.js: SIMPLE mode (default), ADVANCED extras (search filters, "why this prediction", compare)
   and the ADMIN panel (#admin). Everything is static: settings, the prediction log and custom
   players are saved in this browser's localStorage. app.js (the model) calls FC24_afterBoot(). */
(function () {
  "use strict";
  const CFG = window.FC24_CONFIG || {};
  const X = window.FC24_EXTRAS || {};
  const SM = X.simple_map;
  const KEY = { settings: "fc24_settings", log: "fc24_log", custom: "fc24_custom_players", hash: "fc24_admin_hash", mode: "fc24_mode", authed: "fc24_admin_ok" };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { alert("Could not save: browser storage is full or blocked."); return false; } },
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const NAMES = { FWD: "Forward", MID: "Midfielder", DEF: "Defender" };
  const WORD = { FWD: "FORWARD", MID: "MIDFIELDER", DEF: "DEFENDER" };
  const EMO = { FWD: "⚽", MID: "🎯", DEF: "🛡️" };
  const COLORS = { DEF: "#2563eb", MID: "#16a34a", FWD: "#e11d48" };
  const ORDER = ["FWD", "MID", "DEF"];
  let F = null;            // window.FC24 once the model is ready

  // ---------- SHA-256 (pure JS, so the admin gate also works on file:// and old browsers) ----------
  function sha256(str) {
    const rr = (v, n) => (v >>> n) | (v << (32 - n));
    const H = [], Kc = []; let n = 2, c = 0;
    const isP = x => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; };
    const frac = x => ((x - Math.floor(x)) * 4294967296) | 0;
    while (c < 64) { if (isP(n)) { if (c < 8) H[c] = frac(Math.pow(n, 1 / 2)); Kc[c] = frac(Math.pow(n, 1 / 3)); c++; } n++; }
    const bytes = new TextEncoder().encode(str), l = bytes.length, bl = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(bl);
    m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(bl - 4, (l * 8) >>> 0); dv.setUint32(bl - 8, Math.floor(l * 8 / 4294967296));
    const w = new Array(64);
    for (let o = 0; o < bl; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, cc, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + Kc[i] + w[i]) | 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, cc, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    return H.map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }
  window.FC24_sha256 = sha256;

  // ---------- site settings (config.js defaults, overridden by Admin → Site settings) ----------
  const DEFAULTS = { appTitle: CFG.appTitle || "FC 24 Position Finder", defaultMode: CFG.defaultMode || "simple", theme: CFG.theme || "light", banner: CFG.banner || "" };
  const settings = () => Object.assign({}, DEFAULTS, LS.get(KEY.settings, {}));
  function applySettings() {
    const s = settings();
    $("appTitle").textContent = s.appTitle;
    document.title = s.appTitle + " · Random Forest ML Project (P11)";
    document.documentElement.dataset.theme = s.theme === "dark" ? "dark" : "light";
    const b = $("banner"); b.hidden = !s.banner.trim(); b.textContent = "📢 " + s.banner.trim();
  }

  // ---------- views: #simple · #predict/#dashboard/#compare/#batch/#about (advanced) · #admin ----------
  const ADV_TABS = ["predict", "dashboard", "compare", "batch", "about"];
  function route() {
    const h = location.hash.slice(1);
    const view = h === "admin" ? "admin" : h === "simple" ? "simple" : ADV_TABS.includes(h) ? "advanced"
      : (sessionStorage.getItem(KEY.mode) || settings().defaultMode) === "advanced" ? "advanced" : "simple";
    for (const v of ["simple", "advanced", "admin"]) $("view-" + v).hidden = v !== view;
    document.body.className = "mode-" + view;
    document.querySelectorAll(".modeseg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === view));
    if (view !== "admin") sessionStorage.setItem(KEY.mode, view);
    if (view === "advanced" && ADV_TABS.includes(h)) { const t = document.querySelector(`.tab[data-tab="${h}"]`); if (t && !t.classList.contains("active")) t.click(); }
    if (view === "admin") renderAdmin();
  }
  document.querySelectorAll(".modeseg button").forEach(b => b.addEventListener("click", () => {
    sessionStorage.setItem(KEY.mode, b.dataset.mode);
    const at = document.querySelector(".tab.active"), target = b.dataset.mode === "simple" ? "#simple" : "#" + (at ? at.dataset.tab : "predict");
    if (location.hash === target) route(); else location.hash = target;
    window.scrollTo(0, 0);
  }));
  window.addEventListener("hashchange", route);

  // ---------- prediction log (Admin) ----------
  function logPred(e) {
    const log = LS.get(KEY.log, []);
    log.push({ t: Date.now(), mode: e.mode, source: e.source, name: e.name || "", x: e.x.map(v => Math.round(v * 100) / 100),
      pred: e.pred, conf: Math.round(e.conf * 10000) / 10000, actual: e.actual || null, correct: e.actual ? e.actual === e.pred : null });
    if (log.length > 3000) log.splice(0, log.length - 3000);
    LS.set(KEY.log, log);
  }
  window.FC24_log = logPred;

  // ---------- custom players (Admin → Manage players) ----------
  const POS = ["ST", "CF", "LW", "RW", "LF", "RF", "CAM", "CM", "CDM", "LM", "RM", "CB", "LB", "RB", "LWB", "RWB"];
  function groupOf(pos) {
    const p = String(pos || "").split(",")[0].trim().toUpperCase();
    if (["FWD", "MID", "DEF"].includes(p)) return p;
    if (["ST", "CF", "LW", "RW", "LF", "RF"].includes(p)) return "FWD";
    if (["CM", "CDM", "CAM", "LM", "RM"].includes(p)) return "MID";
    if (["CB", "LB", "RB", "LWB", "RWB"].includes(p)) return "DEF";
    return null;
  }
  let customCache = null;
  const customRaw = () => LS.get(KEY.custom, []);
  function customPlayers() {
    if (!customCache) customCache = customRaw().map(c => ({ id: c.id, short: c.short, long: c.long || c.short, club: c.club || "", nation: c.nation || "",
      ovr: +c.ovr || 0, pos: c.pos || "", actual: groupOf(c.pos), test: false, custom: true, vals: c.vals, key: norm(c.short + " " + (c.long || "")) }));
    return customCache;
  }
  function saveCustom(list) { if (LS.set(KEY.custom, list)) { customCache = null; return true; } return false; }
  window.FC24 = Object.assign(window.FC24 || {}, { customPlayers });

  // ---------- shared search ----------
  function findPlayers(q, limit, filter) {
    const t = norm(q.trim()), words = t.split(/\s+/).filter(Boolean), starts = [], contains = [];
    if (!F) return [];
    for (const p of F.searchList()) {
      if (filter && !filter(p)) continue;
      if (!words.every(w => p.key.includes(w))) continue;
      (!words.length || p.key.split(/[\s.\-']+/).some(k => k.startsWith(words[0])) ? starts : contains).push(p);
      if (starts.length >= limit) break;
    }
    return starts.concat(contains).slice(0, limit);
  }
  function makeSearch(input, ul, onPick) {
    let hits = [], sel = -1;
    const show = () => {
      ul.hidden = !hits.length; input.setAttribute("aria-expanded", hits.length > 0);
      ul.innerHTML = hits.map((p, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="ovr">${p.ovr || "–"}</span>
        <span class="nm">${esc(p.short)}${p.custom ? ' <em class="cus">custom</em>' : ""}<small>${esc(p.club || "Free agent")} · ${esc(p.nation)}</small></span><span class="ps">${esc(p.pos)}</span></li>`).join("");
    };
    input.addEventListener("input", () => { sel = -1; hits = norm(input.value.trim()).length < 2 ? [] : findPlayers(input.value, 8); show(); });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!hits.length) return; sel = (sel + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length; show(); }
      else if (e.key === "Enter" && hits.length) { e.preventDefault(); choose(hits[Math.max(sel, 0)]); }
      else if (e.key === "Escape") { hits = []; show(); }
    });
    ul.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); choose(hits[+li.dataset.i]); } });
    input.addEventListener("blur", () => setTimeout(() => { hits = []; show(); }, 150));
    function choose(p) { input.value = p.short; hits = []; show(); input.blur(); onPick(p); }
    return { pickQuery(q) { const p = findPlayers(q, 1)[0]; if (p) choose(p); return p; } };
  }

  // ---------- SIMPLE MODE ----------
  function sure(p) { return p >= 0.75 ? ["Very sure", "vs"] : p >= 0.55 ? ["Fairly sure", "fs"] : ["Not sure", "ns"]; }
  function answerHTML(name, x, real) {
    const { p, votes } = F.predictProba(x);
    let top = 0; p.forEach((v, i) => { if (v > p[top]) top = i; });
    const code = F.C[top], [w, cls] = sure(p[top]), pct = Math.round(p[top] * 100);
    const others = ORDER.filter(c => c !== code).map(c => `${NAMES[c]} ${Math.round(p[F.C.indexOf(c)] * 100)}%`).join(" · ");
    let realHTML = "";
    if (real) {
      const meta = [real.club || (real.custom ? "" : "Free agent"), real.nation, real.ovr ? "Rated " + real.ovr : ""].filter(Boolean).map(esc).join(" · ");
      realHTML = `<p class="a-meta">${real.custom ? '<em class="cus">custom</em> ' : ""}${meta}</p>` + (real.actual
        ? `<div class="verdict ${real.actual === code ? "ok" : "bad"}">${real.actual === code
            ? `✅ <b>Correct!</b> In the game he plays <b>${esc(real.pos)}</b>, a ${NAMES[real.actual]}.`
            : `❌ <b>Not this time.</b> In the game he plays <b>${esc(real.pos)}</b>, a ${NAMES[real.actual]}.`}</div>`
        : `<div class="verdict">ℹ️ No real position saved for this player.</div>`);
    }
    return { code, pct, html: `<div class="a-main" style="--c:${COLORS[code]}">
      <p class="a-line"><b>${esc(name)}</b> plays like a</p>
      <p class="a-pos">${WORD[code]} <span aria-hidden="true">${EMO[code]}</span></p>
      <div class="sure ${cls}"><div class="sure-l"><span>${w}</span><span>${pct}%</span></div>
        <div class="sure-t"><div class="sure-f" style="width:${pct}%"></div></div>
        <p class="sure-n">${votes[top]} of ${F.NT} votes said ${NAMES[code]}</p></div>
      ${realHTML}
      <p class="a-others">Other guesses: ${others}</p></div>`, p, top };
  }

  /*MAP-START*/
  // Simple slider -> the real model inputs. Fitted in simple_map.py: each detailed rating =
  // round(a + b * slider), a straight-line fit of that rating on its main stat over all outfield players.
  function mapSimple(s, SM) {
    const o = { shooting: s.shooting, dribbling: s.dribbling, defending: s.defending };
    const lo = SM.range[0], hi = SM.range[1];
    for (const main in SM.groups) for (const f of SM.groups[main]) {
      const ab = SM.coef[f];
      o[f] = Math.min(hi, Math.max(lo, Math.floor(ab[0] + ab[1] * s[main] + 0.5)));
    }
    return o;
  }
  /*MAP-END*/
  window.FC24_mapSimple = mapSimple;

  const SIMPLE = [
    ["shooting", "🥅", "Shooting", "scoring goals"],
    ["passing", "🎯", "Passing", "seeing the right pass"],
    ["dribbling", "🪄", "Dribbling", "beating players with the ball"],
    ["defending", "🛡️", "Defending", "tackling and blocking"],
  ];
  const SPRESETS = [
    ["🔥 Striker", { shooting: 85, passing: 70, dribbling: 85, defending: 30 }],
    ["🎯 Playmaker", { shooting: 70, passing: 88, dribbling: 80, defending: 65 }],
    ["🧱 Defender", { shooting: 40, passing: 55, dribbling: 55, defending: 88 }],
  ];
  const sState = Object.assign({}, SPRESETS[1][1]);
  function setupSimple() {
    $("sSliders").innerHTML = SIMPLE.map(([k, ic, lab, hint]) => `<div class="ss">
      <label for="ss_${k}"><span class="ic" aria-hidden="true">${ic}</span><span class="lab">${lab}<small>${hint}</small></span><output id="so_${k}"></output></label>
      <input type="range" id="ss_${k}" data-k="${k}" min="${SM.range[0]}" max="${SM.range[1]}" step="1"></div>`).join("");
    $("sPresets").innerHTML = SPRESETS.map((p, i) => `<button type="button" class="chip" data-sp="${i}">${p[0]}</button>`).join("");
    $("sUnused").innerHTML = `⚡ <b>Speed</b> and 💪 <b>Strength</b> are not here on purpose: the computer found they don't help tell positions apart (forwards and defenders can both be fast and strong), so it doesn't use them.`;
    document.querySelectorAll("#sSliders input").forEach(el => {
      el.addEventListener("input", () => { sState[el.dataset.k] = +el.value; document.querySelectorAll("[data-sp]").forEach(c => c.classList.remove("on")); renderOwn(); });
      el.addEventListener("change", () => logOwn("simple sliders"));
    });
    document.querySelectorAll("[data-sp]").forEach(b => b.addEventListener("click", () => {
      Object.assign(sState, SPRESETS[+b.dataset.sp][1]);
      document.querySelectorAll("[data-sp]").forEach(c => c.classList.toggle("on", c === b)); renderOwn(); logOwn(SPRESETS[+b.dataset.sp][0].replace(/^\S+\s/, ""));
    }));
    document.querySelector('[data-sp="1"]').classList.add("on");
    renderOwn();
  }
  function ownVector() { const o = mapSimple(sState, SM); return { o, x: F.vectorFrom(o) }; }
  function renderOwn() {
    for (const [k] of SIMPLE) { $("ss_" + k).value = sState[k]; $("so_" + k).textContent = sState[k]; }
    const { o, x } = ownVector();
    $("oAnswer").innerHTML = answerHTML("Your player", x).html;
    const by = {}; for (const m in SM.groups) for (const f of SM.groups[m]) by[f] = m;
    const lab = { shooting: "🥅 Shooting", passing: "🎯 Passing", dribbling: "🪄 Dribbling", defending: "🛡️ Defending" };
    $("sAdvBody").innerHTML = `<p class="hint">Each slider sets its main rating and the related detailed ratings (from a straight-line fit on all 16,305 players). These are the exact inputs the Random Forest receives:</p>
      <div class="tbl"><table><thead><tr><th>Model feature</th><th>Value</th><th>Set by</th></tr></thead><tbody>${F.FEAT.map((f, i) =>
        `<tr><td>${esc(F.LABEL[f] || f)} <code>${f}</code></td><td>${Number.isInteger(x[i]) ? x[i] : x[i].toFixed(1)}</td><td>${f === "attack_defence_gap" ? "(Shooting + Dribbling) ÷ 2 − Defending" : lab[by[f] || f] || f}</td></tr>`).join("")}</tbody></table></div>
      <button type="button" class="btn" id="toAdv">✏️ Edit these 15 in Advanced mode</button>`;
    $("toAdv").onclick = () => { F.openInAdvanced(o); location.hash = "#predict"; window.scrollTo(0, 0); };
  }
  function logOwn(source) {
    const { x } = ownVector(), { p } = F.predictProba(x); let top = 0; p.forEach((v, i) => { if (v > p[top]) top = i; });
    logPred({ mode: "simple", source: "make-your-own", name: source, x, pred: F.C[top], conf: p[top] });
  }
  function setupSimpleSearch() {
    const q = $("sq");
    q.disabled = true; q.placeholder = "⏳ Loading players…";
    const pickP = p => {
      const x = F.vectorFrom(p.vals), a = answerHTML(p.short, x, p);
      $("sAnswer").innerHTML = a.html;
      logPred({ mode: "simple", source: "search", name: p.short, x, pred: a.code, conf: a.p[a.top], actual: p.actual });
      if (window.innerWidth < 700) $("sAnswer").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const s = makeSearch(q, $("ssugg"), pickP);
    const ready = () => {
      q.disabled = false; q.placeholder = "🔍 Type a player name";
      document.querySelectorAll("[data-try]").forEach(b => b.onclick = () => s.pickQuery(b.dataset.try));
    };
    if (F.basePlayers.length) ready(); else document.addEventListener("fc24:players", ready, { once: true });
  }

  // ---------- ADVANCED: filters ----------
  function setupFilters() {
    const fc = $("fClub"), fn = $("fNation"), fmin = $("fMin"), fmax = $("fMax");
    const f = { club: "", nation: "", min: 0, max: 99 };
    const active = () => f.club || f.nation || f.min > 0 || f.max < 99;
    F.passFilter = p => (!f.club || norm(p.club).includes(f.club)) && (!f.nation || norm(p.nation).includes(f.nation)) && (p.ovr || 0) >= f.min && (p.ovr || 0) <= f.max;
    F.filterActive = active;
    const upd = () => {
      f.club = norm(fc.value.trim()); f.nation = norm(fn.value.trim()); f.min = +fmin.value || 0; f.max = +fmax.value || 99;
      if (!active()) { $("fNote").textContent = ""; return; }
      const n = F.searchList().filter(F.passFilter).length;
      $("fNote").textContent = `${n.toLocaleString()} players match. Type in the search box (or just focus it) to see them, best first.`;
    };
    [fc, fn, fmin, fmax].forEach(el => el.addEventListener("input", upd));
    $("fClear").onclick = () => { fc.value = fn.value = fmin.value = fmax.value = ""; upd(); };
    // focusing the box with a filter on lists the top matches even before typing
    $("q").addEventListener("focus", () => { if (active()) $("q").dispatchEvent(new Event("input")); });
    const fill = () => {
      const uniq = k => [...new Set(F.basePlayers.map(p => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      $("clubList").innerHTML = uniq("club").map(c => `<option value="${esc(c)}">`).join("");
      $("nationList").innerHTML = uniq("nation").map(c => `<option value="${esc(c)}">`).join("");
    };
    if (F.basePlayers.length) fill(); else document.addEventListener("fc24:players", fill, { once: true });
  }

  // ---------- ADVANCED: why this prediction ----------
  // Real calculations on the same 200 trees:
  //  push   = P(class | this player) − P(class | same player but THIS rating set to the dataset average)
  //  paths  = how many of the 200 trees test this rating on the path from the root to the player's leaf
  let MEAN = null;
  function means() {
    if (MEAN) return MEAN;
    const cm = F.S.class_feature_means, cc = F.S.class_counts, N = Object.values(cc).reduce((a, b) => a + b, 0);
    MEAN = F.FEAT.map(f => Object.keys(cc).reduce((s, c) => s + cm[c][f] * cc[c], 0) / N);
    return MEAN;
  }
  function pathUse(x) {
    const use = new Array(F.FEAT.length).fill(0);
    for (const tr of F.M.trees) {
      const seen = new Set(); let n = 0;
      while (tr.f[n] !== -1) { seen.add(tr.f[n]); n = Math.fround(x[tr.f[n]]) <= tr.t[n] ? n + 1 : tr.r[n]; }
      seen.forEach(i => use[i]++);
    }
    return use;
  }
  function explain(x, code) {
    const ci = F.C.indexOf(code), base = F.predictProba(x).p[ci], mu = means(), use = pathUse(x);
    return F.FEAT.map((f, i) => { const x2 = x.slice(); x2[i] = mu[i]; return { f, i, v: x[i], avg: mu[i], d: base - F.predictProba(x2).p[ci], use: use[i] }; });
  }
  function setupWhy() {
    let tmr = null;
    window.FC24_onAdvRender = (x, p, code) => { clearTimeout(tmr); tmr = setTimeout(() => renderWhy(x, code), 60); };
  }
  function renderWhy(x, code) {
    const rows = explain(x, code), pos = rows.filter(r => r.d > 0.0005).sort((a, b) => b.d - a.d).slice(0, 5),
      neg = rows.filter(r => r.d < -0.0005).sort((a, b) => a.d - b.d).slice(0, 3), mx = Math.max(0.01, ...rows.map(r => Math.abs(r.d)));
    const fmt = v => Number.isInteger(v) ? v : v.toFixed(1);
    const row = r => `<div class="wr"><span class="k">${esc(F.LABEL[r.f] || r.f)} <small>${fmt(r.v)} vs avg ${r.avg.toFixed(0)}</small></span>
      <div class="wt"><div class="wf ${r.d > 0 ? "up" : "dn"}" style="width:${(Math.abs(r.d) / mx * 100).toFixed(1)}%"></div></div>
      <span class="n">${r.d > 0 ? "+" : "−"}${Math.abs(r.d * 100).toFixed(1)}%</span><span class="u" title="trees that test this rating on this player's path">${r.use}/${F.NT}</span></div>`;
    $("why").innerHTML = `<h3>🧠 Why ${code}?</h3>
      ${pos.length ? `<p class="wh">Pushing towards ${NAMES[code]}</p>${pos.map(row).join("")}` : ""}
      ${neg.length ? `<p class="wh">Pulling away</p>${neg.map(row).join("")}` : ""}
      <p class="hint">Real calculation: each rating is swapped for the average player's value and all ${F.NT} trees vote again; the change in ${code} probability is that rating's push. The last column counts trees that check that rating on the way to their answer.</p>`;
  }

  // ---------- ADVANCED: compare ----------
  const RADAR = ["shooting", "attacking_finishing", "power_shot_power", "skill_dribbling", "mentality_vision", "defending", "defending_sliding_tackle", "mentality_interceptions"];
  const CA = "#f59e0b", CB = "#3b82f6";
  function radarSVG(a, b) {
    const W = 320, cx = 160, cy = 155, R = 112, n = RADAR.length, ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    const pt = (i, v) => [cx + Math.cos(ang(i)) * R * v / 100, cy + Math.sin(ang(i)) * R * v / 100];
    let s = `<svg viewBox="0 0 ${W} 310" role="img" aria-label="Radar chart comparing the two players">`;
    for (const r of [20, 40, 60, 80, 100]) s += `<polygon points="${RADAR.map((_, i) => pt(i, r).join(",")).join(" ")}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
    RADAR.forEach((f, i) => {
      const [x, y] = pt(i, 100), [lx, ly] = pt(i, 122);
      s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line)"/><text x="${lx}" y="${ly + 4}" font-size="10.5" text-anchor="middle" fill="var(--muted)">${esc((F.LABEL[f] || f).replace("Standing ", "").replace("Sliding tackle", "Tackle"))}</text>`;
    });
    for (const [p, col] of [[a, CA], [b, CB]]) if (p) s += `<polygon points="${RADAR.map((f, i) => pt(i, p.vals[f]).join(",")).join(" ")}" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2.4"/>`;
    return s + "</svg>";
  }
  function pcard(p, col, tag) {
    if (!p) return `<div class="pc empty">Pick player ${tag}</div>`;
    const x = F.vectorFrom(p.vals), { p: pr } = F.predictProba(x); let top = 0; pr.forEach((v, i) => { if (v > pr[top]) top = i; });
    const code = F.C[top], ok = p.actual ? p.actual === code : null;
    return `<div class="pc" style="border-color:${col}"><p class="pn"><i style="background:${col}"></i>${esc(p.short)}${p.custom ? ' <em class="cus">custom</em>' : ""}</p>
      <p class="hint">${esc(p.club || "Free agent")} · ${esc(p.nation)} · OVR ${p.ovr}${p.pos ? " · plays " + esc(p.pos) : ""}</p>
      <p class="pp" style="color:${COLORS[code]}">${code} <small>${(pr[top] * 100).toFixed(1)}%</small> ${ok === null ? "" : ok ? '<span class="ok">✅</span>' : '<span class="bad">❌</span>'}</p>
      ${ORDER.map(c => { const v = pr[F.C.indexOf(c)]; return `<div class="bar"><div class="bl"><span>${c}</span><span>${(v * 100).toFixed(1)}%</span></div><div class="bt"><div class="bf" style="width:${(v * 100).toFixed(1)}%;background:${COLORS[c]}"></div></div></div>`; }).join("")}</div>`;
  }
  function setupCompare() {
    const st = { a: null, b: null };
    const render = () => {
      let tbl = "";
      if (st.a && st.b) {
        const xa = F.vectorFrom(st.a.vals), xb = F.vectorFrom(st.b.vals);
        tbl = `<div class="tbl"><table class="ctab"><thead><tr><th>Model feature</th><th style="color:${CA}">${esc(st.a.short)}</th><th style="color:${CB}">${esc(st.b.short)}</th><th>Diff</th></tr></thead><tbody>` +
          F.FEAT.map((f, i) => { const d = xa[i] - xb[i]; return `<tr><td>${esc(F.LABEL[f] || f)}</td><td class="${d > 0 ? "win" : ""}">${+xa[i].toFixed(1)}</td><td class="${d < 0 ? "win" : ""}">${+xb[i].toFixed(1)}</td><td>${d > 0 ? "+" : ""}${+d.toFixed(1)}</td></tr>`; }).join("") + `</tbody></table></div>`;
      }
      $("cmpOut").innerHTML = `<div class="cgrid">${pcard(st.a, CA, "A")}<div class="radar">${radarSVG(st.a, st.b)}</div>${pcard(st.b, CB, "B")}</div>${tbl}`;
    };
    const logC = p => { const x = F.vectorFrom(p.vals), { p: pr } = F.predictProba(x); let top = 0; pr.forEach((v, i) => { if (v > pr[top]) top = i; });
      logPred({ mode: "advanced", source: "compare", name: p.short, x, pred: F.C[top], conf: pr[top], actual: p.actual }); };
    const sa = makeSearch($("qa"), $("sa"), p => { st.a = p; render(); logC(p); });
    const sb = makeSearch($("qb"), $("sb"), p => { st.b = p; render(); logC(p); });
    render();
    const init = () => { st.a = findPlayers("Haaland", 1)[0] || null; st.b = findPlayers("Van Dijk", 1)[0] || null;
      if (st.a) $("qa").value = st.a.short; if (st.b) $("qb").value = st.b.short; render(); };
    if (F.basePlayers.length) init(); else document.addEventListener("fc24:players", init, { once: true });
    return { sa, sb };
  }

  // ---------- ADMIN ----------
  let adminTab = "model";
  const authed = () => sessionStorage.getItem(KEY.authed) === "1";
  const adminHash = () => LS.get(KEY.hash, null) || CFG.adminPasswordSha256;
  const SECURITY_NOTE = `🔓 Demo-level protection: GitHub Pages has no server, so this password check runs in your browser and anyone who reads the page code can get past it. Everything here (log, custom players, settings) is saved only in <b>this browser</b>. Fine for a college demo, not real security.`;
  function hbars(rows, max, fmt) {
    return rows.map(([k, v, col]) => `<div class="hb"><span class="k" title="${esc(k)}">${esc(k)}</span><div class="t"><div class="f" style="width:${max ? (v / max * 100).toFixed(1) : 0}%;${col ? "background:" + col : ""}"></div></div><span class="n">${fmt ? fmt(v) : v}</span></div>`).join("");
  }
  function download(name, text) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else if (ch !== "\r") cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ""));
  }

  function renderAdmin() {
    const root = $("adminRoot");
    if (!LS.get(KEY.hash, null) && !CFG.adminPasswordSha256) {
      root.innerHTML = `<div class="card login"><h1>🔐 Admin setup required</h1><p class="hint">For safety, this project no longer ships with a known default admin password.</p>
        <ol><li>Open <code>docs/config.js</code>.</li><li>Set <code>adminPasswordSha256</code> to the SHA-256 hash of a strong password.</li><li>Commit and redeploy the updated site.</li></ol>
        <p class="secnote">Important: this is a static demo. Browser-side checks can be bypassed and must not protect private data. Use server-side authentication and a database for production.</p>
        <p><a href="#simple">← Back to the app</a></p></div>`;
      return;
    }
    if (!authed()) {
      root.innerHTML = `<div class="card login"><h1>🔐 Admin</h1><p class="hint">Enter the admin password.</p>
        <form id="loginForm"><label class="sr" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" placeholder="Password" required>
        <button class="btn primary" type="submit">Log in</button><p class="err" id="pwErr" role="alert"></p></form>
        <p class="secnote">${SECURITY_NOTE}</p><p><a href="#simple">← Back to the app</a></p></div>`;
      $("loginForm").onsubmit = e => {
        e.preventDefault();
        if (sha256($("pw").value) === adminHash()) { sessionStorage.setItem(KEY.authed, "1"); renderAdmin(); }
        else { $("pwErr").textContent = "Wrong password."; $("pw").select(); }
      };
      setTimeout(() => $("pw") && $("pw").focus(), 50);
      return;
    }
    const TABS = [["model", "🤖 Model"], ["log", "📝 Prediction log"], ["stats", "📊 Usage stats"], ["players", "👥 Manage players"], ["settings", "⚙️ Site settings"], ["data", "🗂️ Dataset"]];
    root.innerHTML = `<div class="adm-head"><h1>🔐 Admin panel</h1><button class="btn" id="logout" type="button">Log out</button></div>
      <nav class="adm-nav" aria-label="Admin sections">${TABS.map(([k, l]) => `<button type="button" data-at="${k}" class="${k === adminTab ? "on" : ""}">${l}</button>`).join("")}</nav>
      <div id="admBody"></div><p class="secnote">${SECURITY_NOTE}</p>`;
    $("logout").onclick = () => { sessionStorage.removeItem(KEY.authed); renderAdmin(); };
    document.querySelectorAll("[data-at]").forEach(b => b.onclick = () => { adminTab = b.dataset.at; renderAdmin(); });
    ({ model: aModel, log: aLog, stats: aStats, players: aPlayers, settings: aSettings, data: aData })[adminTab]($("admBody"));
  }

  function aModel(el) {
    const S = window.FC24_STATS, M = window.FC24_MODEL, mt = S.metrics, ds = X.dataset || {};
    const imp = Object.fromEntries(S.feature_importance), ks = Object.fromEntries(S.kbest_scores);
    el.innerHTML = `<div class="grid2"><div class="card"><h2>🤖 Model</h2><table class="kv"><tbody>
      <tr><td>Algorithm</td><td>Random Forest (scikit-learn)</td></tr>
      <tr><td>Final setting</td><td>${esc(S.best_setting)} (best macro F1 of ${S.comparison.length} settings)</td></tr>
      <tr><td>Trees</td><td>${M.params.n_estimators}</td></tr><tr><td>max_depth</td><td>${M.params.max_depth === null ? "None" : M.params.max_depth}</td></tr>
      <tr><td>random_state</td><td>${M.params.random_state}</td></tr><tr><td>Feature selection</td><td>SelectKBest(f_classif, k=${S.k}) of ${S.n_columns_before_selection} columns</td></tr>
      <tr><td>Train / test</td><td>${S.train_rows.toLocaleString()} / ${S.test_rows.toLocaleString()} (80/20, stratified)</td></tr>
      <tr><td>Model exported (trained)</td><td>${esc(X.model_exported || "–")}</td></tr>
      <tr><td>Browser vs scikit-learn</td><td>${(S.export_check.same_prediction_share * 100).toFixed(2)}% same predictions on ${S.export_check.test_rows.toLocaleString()} test rows</td></tr>
      </tbody></table></div>
      <div class="card"><h2>📏 Test metrics</h2><div class="cards3">${[["Macro F1", mt.F1], ["Accuracy", mt.Accuracy], ["AUC", mt.AUC], ["Precision", mt.Precision], ["Recall", mt.Recall], ["Specificity", mt.Specificity]]
        .map(([k, v]) => `<div class="metric"><b>${v.toFixed(3)}</b><span>${k}</span></div>`).join("")}</div></div></div>
      <div class="card"><h2>The 15 features</h2><div class="tbl"><table><thead><tr><th>#</th><th>Feature</th><th>Importance</th><th>KBest score</th></tr></thead><tbody>${M.features.map((f, i) =>
        `<tr><td>${i + 1}</td><td>${esc((window.FC24 && F && F.LABEL[f]) || f)} <code>${f}</code></td><td>${(imp[f] || 0).toFixed(3)}</td><td>${(ks[f] || 0).toFixed(0)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  function aLog(el) {
    const log = LS.get(KEY.log, []), FEAT = window.FC24_MODEL.features;
    const short = { shooting: "Sho", attacking_finishing: "Fin", defending: "Def", mentality_vision: "Vis" };
    const inputTxt = e => e.name ? e.name : FEAT.map((f, i) => short[f] ? `${short[f]} ${e.x[i]}` : "").filter(Boolean).join(" · ");
    el.innerHTML = `<div class="card"><div class="row-head"><h2>📝 Prediction log <small class="hint">${log.length.toLocaleString()} in this browser</small></h2>
      <div class="btns"><button class="btn" id="logCsv" type="button" ${log.length ? "" : "disabled"}>⬇ Export CSV</button><button class="btn danger" id="logClear" type="button" ${log.length ? "" : "disabled"}>🗑 Clear</button></div></div>
      ${log.length ? `<div class="tbl"><table class="logt"><thead><tr><th>Time</th><th>Mode</th><th>Source</th><th>Input</th><th>Result</th><th>Real</th><th>Correct?</th></tr></thead><tbody>${log.slice(-200).reverse().map(e =>
        `<tr><td>${new Date(e.t).toLocaleString()}</td><td>${e.mode}</td><td>${esc(e.source)}</td><td class="inp">${esc(inputTxt(e))}</td><td><span class="tag" style="background:${COLORS[e.pred]}">${e.pred}</span> ${(e.conf * 100).toFixed(0)}%</td><td>${e.actual || "–"}</td><td>${e.correct === null ? "–" : e.correct ? "✅" : "❌"}</td></tr>`).join("")}</tbody></table></div>
        ${log.length > 200 ? `<p class="hint">Showing the latest 200. The CSV has all ${log.length}.</p>` : ""}` : `<p class="empty">No predictions yet. Search a player or move a slider in Simple or Advanced mode, then come back.</p>`}</div>`;
    if (!log.length) return;
    $("logCsv").onclick = () => download("fc24_prediction_log.csv", ["time,mode,source,name,prediction,confidence,actual,correct," + FEAT.join(",")]
      .concat(log.map(e => [new Date(e.t).toISOString(), e.mode, e.source, e.name, e.pred, e.conf, e.actual || "", e.correct === null ? "" : e.correct].concat(e.x).map(csvCell).join(","))).join("\n"));
    $("logClear").onclick = () => { if (confirm("Delete all " + log.length + " logged predictions from this browser?")) { LS.set(KEY.log, []); renderAdmin(); } };
  }

  function aStats(el) {
    const log = LS.get(KEY.log, []);
    if (!log.length) { el.innerHTML = `<div class="card"><h2>📊 Usage stats</h2><p class="empty">No predictions logged in this browser yet.</p></div>`; return; }
    const cnt = (arr, k) => arr.reduce((m, e) => (m[k(e)] = (m[k(e)] || 0) + 1, m), {});
    const byClass = cnt(log, e => e.pred), bySrc = cnt(log, e => e.mode + " · " + e.source);
    const searched = log.filter(e => ["search", "compare", "random"].includes(e.source) && e.name);
    const top = Object.entries(cnt(searched, e => e.name)).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const judged = log.filter(e => e.correct !== null), right = judged.filter(e => e.correct).length;
    const uniq = {}; judged.forEach(e => { uniq[e.name] = e.correct; }); const uN = Object.keys(uniq).length, uR = Object.values(uniq).filter(Boolean).length;
    const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d); }
    const perDay = days.map(d => [d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }), log.filter(e => e.t >= +d && e.t < +d + 864e5).length]);
    const mxD = Math.max(1, ...perDay.map(r => r[1]));
    el.innerHTML = `<div class="cards3 mb">${[["Predictions", log.length], ["Players searched", Object.keys(cnt(searched, e => e.name)).length],
        ["Accuracy on searched", judged.length ? (right / judged.length * 100).toFixed(1) + "%" : "–"]].map(([k, v]) => `<div class="metric"><b>${v}</b><span>${k}</span></div>`).join("")}</div>
      <div class="grid2"><div class="card"><h2>Predictions by class</h2>${hbars(ORDER.map(c => [`${NAMES[c]} (${c})`, byClass[c] || 0, COLORS[c]]), Math.max(...ORDER.map(c => byClass[c] || 0)))}
        <h2 class="mt">By mode · source</h2>${hbars(Object.entries(bySrc).sort((a, b) => b[1] - a[1]), Math.max(...Object.values(bySrc)))}</div>
      <div class="card"><h2>Most-searched players</h2>${top.length ? hbars(top, top[0][1]) : '<p class="empty">No searches yet.</p>'}
        <h2 class="mt">Accuracy on searched players</h2><p>${judged.length ? `<b>${right}</b> of <b>${judged.length}</b> predictions with a real position were correct (${(right / judged.length * 100).toFixed(1)}%). By unique player: <b>${uR}/${uN}</b>.` : "No players with a real position yet."}</p></div></div>
      <div class="card"><h2>Last 7 days</h2><div class="cols">${perDay.map(([k, v]) => `<div class="col"><div class="cb" style="height:${(v / mxD * 100).toFixed(0)}%"><span>${v}</span></div><small>${esc(k)}</small></div>`).join("")}</div></div>`;
  }

  function aPlayers(el, editId) {
    const list = customRaw(), COLS = F ? F.INPUTS : window.FC24_MODEL.features.filter(f => f !== "attack_defence_gap").concat(["dribbling"]);
    const LAB = f => (F && F.LABEL[f]) || f;
    const cm = window.FC24_STATS.class_feature_means;
    const ed = list.find(c => c.id === editId) || null;
    const start = ed ? ed.vals : Object.fromEntries(COLS.map(f => [f, Math.round(cm.MID[f])]));
    el.innerHTML = `<div class="card"><div class="row-head"><h2>👥 Custom players <small class="hint">${list.length} saved in this browser</small></h2>
        <div class="btns"><label class="btn"><input type="file" id="impCsv" accept=".csv,text/csv" hidden>⬆ Import CSV</label><button class="btn" type="button" id="expCsv">⬇ Export CSV</button></div></div>
        <p class="hint" id="impMsg">CSV columns: short_name, long_name, club_name, nationality_name, overall, player_positions, ${COLS.join(", ")}. Export gives a ready template.</p>
        ${list.length ? `<div class="tbl"><table><thead><tr><th>Name</th><th>Club</th><th>Nation</th><th>OVR</th><th>Pos</th><th>Model says</th><th></th></tr></thead><tbody>${list.map(c => {
          let pr = "–"; if (F) { const x = F.vectorFrom(c.vals), { p } = F.predictProba(x); let t = 0; p.forEach((v, i) => { if (v > p[t]) t = i; }); pr = `<span class="tag" style="background:${COLORS[F.C[t]]}">${F.C[t]}</span> ${(p[t] * 100).toFixed(0)}%`; }
          return `<tr><td><b>${esc(c.short)}</b> <em class="cus">custom</em></td><td>${esc(c.club)}</td><td>${esc(c.nation)}</td><td>${c.ovr || "–"}</td><td>${esc(c.pos) || "–"}</td><td>${pr}</td>
            <td class="act"><button class="btn sm" data-ed="${c.id}" type="button">Edit</button> <button class="btn sm danger" data-del="${c.id}" type="button">Delete</button></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="empty">No custom players yet. Add one below.</p>`}
      </div>
      <form class="card" id="pForm"><h2>${ed ? "✏️ Edit " + esc(ed.short) : "➕ Add a player"}</h2>
        <div class="fgrid">
          <label>Short name *<input name="short" required maxlength="40" value="${esc(ed ? ed.short : "")}" placeholder="e.g. J. Kanara"></label>
          <label>Full name<input name="long" maxlength="80" value="${esc(ed ? ed.long : "")}"></label>
          <label>Club<input name="club" maxlength="60" value="${esc(ed ? ed.club : "")}"></label>
          <label>Nation<input name="nation" maxlength="40" value="${esc(ed ? ed.nation : "India")}"></label>
          <label>Overall (40–99)<input name="ovr" type="number" min="40" max="99" value="${ed ? ed.ovr : 70}"></label>
          <label>Real position<select name="pos"><option value="">(unknown)</option>${POS.map(p => `<option ${ed && ed.pos === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
        </div>
        <div class="row-head mt"><h3>Ratings (10–99)</h3><span class="btns">${ORDER.map(c => `<button type="button" class="btn sm" data-fill="${c}">${NAMES[c]}-like</button>`).join("")}</span></div>
        <div class="fgrid rat">${COLS.map(f => `<label>${esc(LAB(f))}<input name="v_${f}" type="number" min="10" max="99" required value="${Math.round(start[f])}"></label>`).join("")}</div>
        <p class="preview" id="pPrev"></p>
        <div class="btns"><button class="btn primary" type="submit">${ed ? "Save changes" : "Add player"}</button>${ed ? '<button class="btn" type="button" id="pCancel">Cancel</button>' : ""}</div>
        <p class="ok" id="pMsg" role="status"></p>
      </form>`;
    const form = $("pForm");
    const read = () => Object.fromEntries(COLS.map(f => [f, Math.max(10, Math.min(99, Math.round(+form["v_" + f].value || 0)))]));
    const prev = () => { if (!F) return; const x = F.vectorFrom(read()), { p } = F.predictProba(x); let t = 0; p.forEach((v, i) => { if (v > p[t]) t = i; });
      $("pPrev").innerHTML = `Model preview: <b style="color:${COLORS[F.C[t]]}">${NAMES[F.C[t]]}</b> (${(p[t] * 100).toFixed(1)}%)`; };
    form.addEventListener("input", prev); prev();
    document.querySelectorAll("[data-fill]").forEach(b => b.onclick = () => { COLS.forEach(f => form["v_" + f].value = Math.round(cm[b.dataset.fill][f])); prev(); });
    form.onsubmit = e => {
      e.preventDefault();
      const rec = { id: ed ? ed.id : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), short: form.short.value.trim(), long: form.long.value.trim(),
        club: form.club.value.trim(), nation: form.nation.value.trim(), ovr: Math.max(40, Math.min(99, +form.ovr.value || 70)), pos: form.pos.value, vals: read() };
      if (!rec.short) return;
      const all = customRaw(); const i = all.findIndex(c => c.id === rec.id); if (i >= 0) all[i] = rec; else all.unshift(rec);
      if (saveCustom(all)) { aPlayers(el); $("pMsg").textContent = `✅ Saved "${rec.short}". Search for it in Simple or Advanced mode.`; }
    };
    if ($("pCancel")) $("pCancel").onclick = () => aPlayers(el);
    el.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => { aPlayers(el, b.dataset.ed); $("pForm").scrollIntoView({ behavior: "smooth" }); });
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { const c = list.find(x => x.id === b.dataset.del); if (c && confirm(`Delete "${c.short}"?`)) { saveCustom(customRaw().filter(x => x.id !== c.id)); aPlayers(el); } });
    $("expCsv").onclick = () => download("fc24_custom_players.csv", ["short_name,long_name,club_name,nationality_name,overall,player_positions," + COLS.join(",")]
      .concat(customRaw().map(c => [c.short, c.long, c.club, c.nation, c.ovr, c.pos].concat(COLS.map(f => c.vals[f])).map(csvCell).join(","))).join("\n"));
    $("impCsv").onchange = ev => {
      const file = ev.target.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        const rows = parseCSV(rd.result); const head = (rows.shift() || []).map(h => h.trim()); const H = Object.fromEntries(head.map((h, i) => [h, i]));
        const miss = ["short_name"].concat(COLS).filter(c => !(c in H));
        if (miss.length) { $("impMsg").textContent = "❌ Missing columns: " + miss.join(", "); return; }
        const all = customRaw(); let added = 0, skipped = 0;
        for (const r of rows) {
          const vals = Object.fromEntries(COLS.map(f => [f, Math.round(+r[H[f]])]));
          if (!String(r[H.short_name] || "").trim() || COLS.some(f => !(vals[f] >= 1 && vals[f] <= 99))) { skipped++; continue; }
          const g = k => (k in H ? String(r[H[k]] || "").trim() : "");
          all.push({ id: "c" + Date.now().toString(36) + (added++).toString(36) + Math.random().toString(36).slice(2, 5), short: g("short_name"), long: g("long_name"), club: g("club_name"),
            nation: g("nationality_name"), ovr: +g("overall") || 0, pos: g("player_positions").split(",")[0].trim(), vals });
        }
        if (saveCustom(all)) { aPlayers(el); $("impMsg").textContent = `✅ Imported ${added} player(s)${skipped ? `, skipped ${skipped} bad row(s)` : ""}.`; }
      };
      rd.readAsText(file);
    };
  }

  function aSettings(el) {
    const s = settings();
    el.innerHTML = `<form class="card" id="sForm"><h2>⚙️ Site settings</h2><div class="fgrid">
        <label>App title<input name="appTitle" maxlength="60" value="${esc(s.appTitle)}"></label>
        <label>Default mode<select name="defaultMode"><option value="simple" ${s.defaultMode === "simple" ? "selected" : ""}>🙂 Simple</option><option value="advanced" ${s.defaultMode === "advanced" ? "selected" : ""}>🔬 Advanced</option></select></label>
        <label>Theme<select name="theme"><option value="light" ${s.theme !== "dark" ? "selected" : ""}>☀️ Light</option><option value="dark" ${s.theme === "dark" ? "selected" : ""}>🌙 Dark</option></select></label>
        <label class="wide">Announcement banner (empty = none)<input name="banner" maxlength="160" value="${esc(s.banner)}" placeholder="e.g. Viva on Friday at 10 AM"></label>
      </div><div class="btns"><button class="btn primary" type="submit">Save settings</button><button class="btn" type="button" id="sReset">Reset to defaults</button></div>
      <p class="ok" id="sMsg" role="status"></p><p class="hint">Saved in this browser only. To change them for every visitor, edit <code>docs/config.js</code> in the repo.</p></form>
      <form class="card" id="pwForm"><h2>🔑 Change admin password</h2><div class="fgrid">
        <label>New password<input name="p1" type="password" minlength="4" required autocomplete="new-password"></label>
        <label>Repeat<input name="p2" type="password" minlength="4" required autocomplete="new-password"></label></div>
        <div class="btns"><button class="btn primary" type="submit">Change password</button><button class="btn" type="button" id="pwReset">Back to config.js password</button></div>
        <p class="ok" id="pwMsg" role="status"></p><p class="hint">Only the SHA-256 hash is stored (in this browser). For everyone: put the hash in <code>docs/config.js</code>.</p></form>`;
    $("sForm").onsubmit = e => { e.preventDefault(); const f = e.target;
      LS.set(KEY.settings, { appTitle: f.appTitle.value.trim() || DEFAULTS.appTitle, defaultMode: f.defaultMode.value, theme: f.theme.value, banner: f.banner.value });
      applySettings(); $("sMsg").textContent = "✅ Saved."; };
    $("sReset").onclick = () => { localStorage.removeItem(KEY.settings); applySettings(); aSettings(el); $("sMsg").textContent = "✅ Back to defaults."; };
    $("pwForm").onsubmit = e => { e.preventDefault(); const f = e.target;
      if (f.p1.value !== f.p2.value) { $("pwMsg").textContent = "❌ The two passwords are different."; return; }
      LS.set(KEY.hash, sha256(f.p1.value)); f.reset(); $("pwMsg").textContent = "✅ Password changed for this browser."; };
    $("pwReset").onclick = () => { localStorage.removeItem(KEY.hash); $("pwMsg").textContent = "✅ Using the password from config.js again."; };
  }

  function aData(el) {
    const d = X.dataset || {}, S = window.FC24_STATS, cc = d.class_counts || S.class_counts, tot = Object.values(cc).reduce((a, b) => a + b, 0);
    const miss = Object.entries(d.missing_by_column || {}), mm = d.missing_model_columns_outfield || {}, mmTot = Object.values(mm).reduce((a, b) => a + b, 0);
    el.innerHTML = `<div class="cards3 mb">${[["Rows in file", d.rows_file], ["FC 24 rows", d.rows_fc24], ["Goalkeepers removed", d.goalkeepers_removed], ["Outfield rows used", d.rows_outfield],
        ["Train / test", S.train_rows.toLocaleString() + " / " + S.test_rows.toLocaleString()], ["Columns in file", d.columns_file]]
        .map(([k, v]) => `<div class="metric"><b>${typeof v === "number" ? v.toLocaleString() : v}</b><span>${k}</span></div>`).join("")}</div>
      <div class="grid2"><div class="card"><h2>⚖️ Class balance</h2>${hbars(ORDER.map(c => [`${NAMES[c]} (${c})`, cc[c], COLORS[c]]), Math.max(...Object.values(cc)), v => `${v.toLocaleString()} · ${(v / tot * 100).toFixed(1)}%`)}
        <p class="hint">Not balanced (forwards are the smallest class), which is why the project uses <b>macro F1</b>.</p></div>
      <div class="card"><h2>🕳️ Missing values</h2><p><b>${(d.missing_cells || 0).toLocaleString()}</b> empty cells in the FC 24 rows, in ${miss.length} columns. The 15 model inputs have <b>${mmTot}</b> missing for outfield players ${mmTot ? "" : "✅"}.</p>
        ${hbars(miss.slice(0, 12).map(([k, v]) => [k, v]), miss.length ? miss[0][1] : 1, v => `${v.toLocaleString()} · ${(v / d.rows_fc24 * 100).toFixed(0)}%`)}
        <p class="hint">Top 12 shown. Most are goalkeeper-only or optional columns (club / national team details). Cleaning: numbers → median, text → most common value; ID, name and leaking columns dropped.</p></div></div>`;
  }

  // ---------- start ----------
  applySettings();
  route();
  window.FC24_afterBoot = function () {
    F = window.FC24;
    setupSimple(); setupSimpleSearch(); setupFilters(); setupWhy(); setupCompare();
    if (!$("view-admin").hidden) renderAdmin();
  };
})();
