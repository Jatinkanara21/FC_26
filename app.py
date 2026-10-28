"""
P11 · FC 24 Position Finder — Streamlit app
KANARA JATIN JIJI · F10 · Div E · 24004501210126

Same data, same 15 SelectKBest features and same final Random Forest as F10_P11_Jatin.ipynb
(the pipeline lives in train.py, so the notebook, train.py, this app and the web page agree).

Run locally:   pip install -r requirements.txt  &&  streamlit run app.py
"""
import numpy as np
import pandas as pd
import streamlit as st
from sklearn.ensemble import RandomForestClassifier

import train

st.set_page_config(page_title="FC 24 Position Finder (P11)", page_icon="⚽", layout="wide")
COLORS = {"DEF": "#2563eb", "MID": "#16a34a", "FWD": "#e11d48"}
NAMES = {"FWD": "Forward", "MID": "Midfielder", "DEF": "Defender"}


@st.cache_resource(show_spinner="Training the Random Forest on the FC 24 data (about 20 s, once)…")
def build():
    d = train.prepare()
    rows, best_name, best = [], None, -1
    for name, params in train.SETTINGS.items():
        m, _, _, _ = train.evaluate(RandomForestClassifier(random_state=42, **params), d)
        rows.append({"Setting": name, **{k: round(v, 3) for k, v in m.items()}})
        if m["F1"] > best: best, best_name = m["F1"], name
    model = RandomForestClassifier(random_state=42, **train.SETTINGS[best_name])
    met, pred, proba, cm = train.evaluate(model, d)
    return d, model, pd.DataFrame(rows), best_name, met, cm


d, model, comparison, best_name, met, cm = build()
F, C = d["features"], d["classes"]
df, info = d["df"], d["info"]
LABEL = {f: f.replace("_", " ").replace("attacking ", "").replace("mentality ", "").replace("defending ", "def. ")
           .replace("power ", "").replace("skill ", "").capitalize() for f in F}
LABEL["skill_dribbling"] = "Dribbling skill"
LABEL["attack_defence_gap"] = "Attack-defence gap"

import simple_map

COEF = simple_map.fit_coef(df)
if "log" not in st.session_state: st.session_state.log = []
if "custom" not in st.session_state: st.session_state.custom = []


def predict(vec):
    pr = model.predict_proba(pd.DataFrame([vec], columns=F))[0]
    return C[int(np.argmax(pr))], pr


def log(mode, source, name, vec, pred, conf, actual=None):
    st.session_state.log.append({"time": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"), "mode": mode, "source": source, "name": name,
                                 "prediction": pred, "confidence": round(float(conf), 3), "actual": actual,
                                 "correct": None if actual is None else actual == pred, **dict(zip(F, vec))})


def admin_password():
    try:
        return st.secrets["ADMIN_PASSWORD"]          # set in Streamlit Cloud → App → Settings → Secrets
    except Exception:
        return None                                   # fail closed: configure st.secrets["ADMIN_PASSWORD"]


# ---------------- sidebar: mode + admin ----------------
st.sidebar.title("⚽ FC 24 Position Finder")
mode = st.sidebar.radio("Mode", ["🙂 Simple", "🔬 Advanced"], help="Simple = for any football fan. Advanced = all the ML details.")
st.sidebar.divider()
st.sidebar.subheader("🔐 Admin")
if not st.session_state.get("admin"):
    pw = st.sidebar.text_input("Password", type="password")
    if st.sidebar.button("Log in"):
        st.session_state.admin = pw == admin_password()
        if not st.session_state.admin: st.sidebar.error("Wrong password")
        else: st.rerun()
    st.sidebar.caption("Demo-level protection. Configure st.secrets['ADMIN_PASSWORD']; no default password is shipped.")
else:
    show_admin = st.sidebar.checkbox("Show admin panel", value=True)
    if st.sidebar.button("Log out"):
        st.session_state.admin = False; st.rerun()

NAMES_UP = {"FWD": "FORWARD ⚽", "MID": "MIDFIELDER 🎯", "DEF": "DEFENDER 🛡️"}
def sure(p): return "Very sure" if p >= .75 else "Fairly sure" if p >= .55 else "Not sure"

order = info["overall"].sort_values(ascending=False, kind="stable").index
labels = {i: f"{info.at[i, 'short_name']} · {info.at[i, 'club_name'] if pd.notna(info.at[i, 'club_name']) else 'Free agent'} · OVR {info.at[i, 'overall']}" for i in order}

# ---------------- ADMIN PANEL ----------------
if st.session_state.get("admin") and show_admin:
    st.title("🔐 Admin panel")
    st.warning("Demo-level protection only: the log, stats and custom players live in this Streamlit session.")
    a1, a2, a3, a4, a5 = st.tabs(["Model info", "Prediction log", "Usage stats", "Manage players", "Dataset"])
    with a1:
        st.write({"algorithm": "RandomForestClassifier", "setting": best_name, **{k: v for k, v in train.SETTINGS[best_name].items()},
                  "random_state": 42, "SelectKBest k": train.K, "features": F})
        st.dataframe(pd.DataFrame([met]).round(3), use_container_width=True)
    with a2:
        lg = pd.DataFrame(st.session_state.log)
        st.dataframe(lg, use_container_width=True)
        if len(lg):
            st.download_button("Export CSV", lg.to_csv(index=False), "fc24_prediction_log.csv")
            if st.button("Clear log"): st.session_state.log = []; st.rerun()
    with a3:
        lg = pd.DataFrame(st.session_state.log)
        if len(lg):
            st.bar_chart(lg["prediction"].value_counts())
            st.write("Most-searched players"); st.bar_chart(lg[lg["source"] == "search"]["name"].value_counts().head(10))
            j = lg.dropna(subset=["actual"])
            st.metric("Accuracy on searched players", f"{(j['correct'].astype(bool).mean() * 100):.1f}%" if len(j) else "–")
        else:
            st.info("No predictions yet.")
    with a4:
        with st.form("add"):
            nm = st.text_input("Name"); pos = st.selectbox("Real position", ["", "ST", "CAM", "CM", "CDM", "CB", "LB", "RB", "LW", "RW"])
            base = df[df[train.TARGET] == "MID"].mean(numeric_only=True)
            raw_cols = [f for f in F if f != "attack_defence_gap"] + ["dribbling"]
            vals = {f: st.number_input(LABEL.get(f, f), 10, 99, int(round(base[f]))) for f in raw_cols}
            if st.form_submit_button("Add player") and nm:
                st.session_state.custom.append({"name": nm, "pos": pos, **vals}); st.success(f"Added {nm}")
        if st.session_state.custom:
            cdf = pd.DataFrame(st.session_state.custom); st.dataframe(cdf, use_container_width=True)
            st.download_button("Export CSV", cdf.to_csv(index=False), "fc24_custom_players.csv")
    with a5:
        st.metric("Outfield rows", f"{len(df):,}")
        st.bar_chart(df[train.TARGET].value_counts())
        raw_all = pd.read_csv(d["path"], low_memory=False)
        miss = raw_all.isna().sum(); st.write("Missing values (raw file, top 12)"); st.bar_chart(miss[miss > 0].sort_values(ascending=False).head(12))
    st.stop()

# ---------------- SIMPLE MODE ----------------
if mode.startswith("🙂"):
    st.title("⚽ Where does he really play?")
    st.write("Type any FC 24 player. The computer looks at his ratings and guesses **Forward**, **Midfielder** or **Defender**.")
    customs = {f"custom:{k}": c for k, c in enumerate(st.session_state.custom)}
    opts = [None] + list(customs) + list(order)
    pick = st.selectbox("🔍 Type a player name", opts, format_func=lambda i: "Type a player name…" if i is None else
                        f"{customs[i]['name']} · custom" if str(i).startswith("custom:") else labels[i])
    if pick is not None:
        if str(pick).startswith("custom:"):
            c = customs[pick]; o = dict(c); name = c["name"]; actual = train.group(c["pos"]) if c["pos"] else None; real_pos = c["pos"]
        else:
            o = df.loc[pick]; name = info.at[pick, "short_name"]; actual = df.at[pick, train.TARGET]; real_pos = str(info.at[pick, "player_positions"]).split(",")[0]
        vec = simple_map.vector(o, F); top, pr = predict(vec)
        st.markdown(f"## {name} plays like a <span style='color:{COLORS[top]}'>{NAMES_UP[top]}</span>", unsafe_allow_html=True)
        st.progress(float(pr.max()), text=f"{sure(pr.max())} ({pr.max()*100:.0f}%)")
        if actual: (st.success if actual == top else st.error)(("✅ Correct! " if actual == top else "❌ Not this time. ") + f"In the game he plays {real_pos}, a {NAMES[actual]}.")
        if st.session_state.get("last_pick") != pick:
            log("simple", "search", name, vec, top, pr.max(), actual); st.session_state.last_pick = pick
    st.divider()
    st.subheader("🛠️ Make your own player")
    c1, c2 = st.columns(2)
    s = {"shooting": c1.slider("🥅 Shooting", 10, 99, 70), "passing": c2.slider("🎯 Passing", 10, 99, 70),
         "dribbling": c1.slider("🪄 Dribbling", 10, 99, 75), "defending": c2.slider("🛡️ Defending", 10, 99, 55)}
    st.caption("⚡ Speed and 💪 Strength are not used: the model found they don't help tell positions apart.")
    o = simple_map.map_simple(s, COEF); vec = simple_map.vector(o, F); top, pr = predict(vec)
    st.markdown(f"### Your player plays like a <span style='color:{COLORS[top]}'>{NAMES_UP[top]}</span>", unsafe_allow_html=True)
    st.progress(float(pr.max()), text=f"{sure(pr.max())} ({pr.max()*100:.0f}%)")
    with st.expander("🔬 Advanced: the exact 15 numbers the model uses"):
        st.dataframe(pd.DataFrame({"feature": F, "value": vec}), use_container_width=True, hide_index=True)
    st.info("💡 How it works: we showed the computer 16,305 real FC 24 players and their positions; it learned which ratings go with which position, like a scout.")
    st.stop()

# ---------------- ADVANCED MODE ----------------
st.title("⚽ FC 24 Position Finder")
st.caption("P11 · Random Forest · KANARA JATIN JIJI · F10 · Div E · 24004501210126")
c1, c2, c3, c4 = st.columns(4)
c1.metric("Macro F1 (main metric)", f"{met['F1']:.3f}")
c2.metric("Accuracy", f"{met['Accuracy']:.3f}")
c3.metric("AUC (OvR)", f"{met['AUC']:.3f}")
c4.metric("Final setting", best_name)

tab1, tab2, tab3, tab4 = st.tabs(["Predict one player", "Predict a CSV", "Dashboard", "Compare"])

with tab1:
    # Player search: names are only for search/display, never model inputs.
    pick = st.selectbox("🔍 Search an FC 24 player (type a name)", [None] + list(order),
                        format_func=lambda i: "— choose a player, or use the sliders —" if i is None else labels[i])
    base = df.loc[pick] if pick is not None else df[df[train.TARGET] == "MID"].mean(numeric_only=True)
    st.write("Move the sliders: the prediction updates live.")
    inputs = {}
    raw = [f for f in F if f != "attack_defence_gap"] + ["dribbling"]
    cols = st.columns(3)
    for j, f in enumerate(raw):
        with cols[j % 3]:
            inputs[f] = st.slider(LABEL.get(f, f.capitalize()), 10, 99, int(round(float(base[f]))), key=f"{f}_{pick}")
    inputs["attack_defence_gap"] = (inputs["shooting"] + inputs["dribbling"]) / 2 - inputs["defending"]
    x = pd.DataFrame([[inputs[f] for f in F]], columns=F)
    proba = model.predict_proba(x)[0]
    top = C[int(np.argmax(proba))]
    sig = (pick, tuple(x.iloc[0].round(2)))
    if st.session_state.get("last_adv") != sig:
        log("advanced", "search" if pick is not None else "sliders", info.at[pick, "short_name"] if pick is not None else "sliders",
            list(x.iloc[0]), top, proba.max(), df.at[pick, train.TARGET] if pick is not None else None)
        st.session_state.last_adv = sig
    st.markdown(f"### Predicted: <span style='color:{COLORS[top]}'>{top} · {NAMES[top]}</span> ({proba.max()*100:.1f}%)",
                unsafe_allow_html=True)
    st.bar_chart(pd.DataFrame({"probability": proba}, index=C))
    st.caption(f"attack_defence_gap = (shooting + dribbling) / 2 − defending = {inputs['attack_defence_gap']:.1f}")
    if pick is not None:
        actual = df.at[pick, train.TARGET]
        seen = "test set (never seen in training)" if pick in d["X_test"].index else "training set (the model has seen him)"
        st.info(f"{info.at[pick, 'long_name']}: real position {str(info.at[pick, 'player_positions']).split(',')[0]} ({actual}) → "
                f"predicted {top} {'✅ correct' if actual == top else '❌ wrong'} · {seen}")

with tab2:
    st.write("Upload Kaggle's **male_players.csv** (or data/fc24_players.csv). Same cleaning as the notebook, then every outfield player is predicted.")
    up = st.file_uploader("CSV file", type="csv")
    if up is not None:
        raw_df = pd.read_csv(up, low_memory=False)
        if "fifa_version" in raw_df: raw_df = raw_df[raw_df["fifa_version"] == 24]
        if "player_positions" in raw_df:
            raw_df["actual"] = raw_df["player_positions"].apply(train.group)
            raw_df = raw_df[raw_df["actual"].notna()]
        raw_df = train.add_feature(raw_df) if "attack_defence_gap" not in raw_df else raw_df
        missing = [f for f in F if f not in raw_df]
        if missing:
            st.error(f"Missing columns: {missing}")
        else:
            X = raw_df[F].fillna(raw_df[F].median())
            raw_df["predicted"] = [C[i] for i in model.predict(X)]
            raw_df["confidence"] = model.predict_proba(X).max(axis=1).round(3)
            show = [c for c in ["short_name", "player_positions", "actual", "predicted", "confidence"] if c in raw_df]
            if "actual" in raw_df:
                st.metric("Match with real position (includes training players)", f"{(raw_df['actual'] == raw_df['predicted']).mean()*100:.1f}%")
            st.dataframe(raw_df[show].head(200), use_container_width=True)
            st.download_button("Download predictions", raw_df[show].to_csv(index=False), "fc24_predictions.csv")

with tab3:
    st.subheader("Comparison of all settings (test set)")
    st.dataframe(comparison.style.highlight_max(subset=["F1"], color="#bbf7d0"), use_container_width=True)
    st.bar_chart(comparison.set_index("Setting")["F1"])
    a, b = st.columns(2)
    with a:
        st.subheader("Confusion matrix (final model)")
        st.dataframe(pd.DataFrame(cm, index=[f"true {c}" for c in C], columns=[f"pred {c}" for c in C]))
    with b:
        st.subheader("Feature importance (final model)")
        st.bar_chart(pd.Series(model.feature_importances_, index=F).sort_values(ascending=False))
    st.caption(f"{len(df):,} outfield players · train {len(d['X_train']):,} / test {len(d['X_test']):,} · SelectKBest k={train.K}")

with tab4:
    ca, cb = st.columns(2)
    pa = ca.selectbox("Player A", list(order), format_func=lambda i: labels[i], index=0)
    pb = cb.selectbox("Player B", list(order), format_func=lambda i: labels[i], index=1)
    rows = []
    for col, pidx in [(ca, pa), (cb, pb)]:
        vec = simple_map.vector(df.loc[pidx], F); top, pr = predict(vec)
        col.metric(info.at[pidx, "short_name"], f"{top} {pr.max()*100:.1f}%", f"real {df.at[pidx, train.TARGET]}")
        rows.append(pd.Series(vec, index=F, name=info.at[pidx, "short_name"]))
    st.dataframe(pd.concat(rows, axis=1), use_container_width=True)
