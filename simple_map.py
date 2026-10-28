"""
simple_map.py: builds the data behind the web app's SIMPLE mode and ADMIN dataset card.
Does NOT change the model. Run after train.py:   python simple_map.py

1) Simple sliders -> real model features (honest mapping, fitted on the data):
   Shooting  -> shooting + finishing, shot power, long shots, volleys, penalties, att. positioning
   Dribbling -> dribbling (used in attack_defence_gap) + dribbling skill
   Passing   -> vision (the only passing-type rating SelectKBest kept)
   Defending -> defending + sliding tackle, standing tackle, def. awareness, interceptions
   Each detailed rating = round(a + b * slider) where a, b come from a straight-line fit
   (least squares) of that rating on its main stat over all 16,305 outfield players.
   Pace and physic were NOT selected by SelectKBest, so Speed / Strength do not change the prediction.
2) Dataset overview: rows, class balance, missing values.
3) tests/simple_reference.json: scikit-learn's predict_proba for 150 simple-slider players, so
   tests/test_site.test.js can check the browser (mapping + forest) gives the same answers.
"""
import json, math, os
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import train

HERE = os.path.dirname(os.path.abspath(__file__))
GROUPS = {
    "shooting": ["attacking_finishing", "power_shot_power", "power_long_shots", "attacking_volleys",
                 "mentality_penalties", "mentality_positioning"],
    "dribbling": ["skill_dribbling"],
    "passing": ["mentality_vision"],
    "defending": ["defending_sliding_tackle", "defending_standing_tackle", "defending_marking_awareness",
                  "mentality_interceptions"],
}
LO, HI = 10, 99


def rnd(v):                      # same rounding as JavaScript Math.floor(v + 0.5)
    return int(math.floor(v + 0.5))


def map_simple(s, coef):
    """s = dict(shooting, dribbling, passing, defending) on 10-99 -> dict of the 14 raw inputs + dribbling."""
    o = {"shooting": s["shooting"], "dribbling": s["dribbling"], "defending": s["defending"]}
    for main, feats in GROUPS.items():
        for f in feats:
            a, b = coef[f]
            o[f] = min(HI, max(LO, rnd(a + b * s[main])))
    return o


def vector(o, feats):
    return [(o["shooting"] + o["dribbling"]) / 2 - o["defending"] if f == "attack_defence_gap" else o[f] for f in feats]


def fit_coef(df):
    """Straight-line fit (least squares) of each detailed rating on its main stat."""
    coef = {}
    for main, fs in GROUPS.items():
        x = df[main].astype(float).values
        for f in fs:
            b, a = np.polyfit(x, df[f].astype(float).values, 1)
            coef[f] = [round(float(a), 4), round(float(b), 4)]
    return coef


def main():
    d = train.prepare()
    df, feats = d["df"], d["features"]
    coef = fit_coef(df)
    # check every model feature (except the gap, which is computed) is driven by a simple slider
    covered = {"shooting", "dribbling", "defending", *[f for fs in GROUPS.values() for f in fs]}
    assert all(f in covered or f == "attack_defence_gap" for f in feats), feats

    raw = pd.read_csv(d["path"], low_memory=False)
    raw24 = raw[raw["fifa_version"] == 24] if "fifa_version" in raw.columns else raw
    gk = int((raw24["player_positions"].astype(str).str.split(",").str[0].str.strip() == "GK").sum())
    out_raw = raw24[raw24["player_positions"].apply(train.group).notna()]
    miss_all = raw24.isna().sum()
    miss_all = {k: int(v) for k, v in miss_all[miss_all > 0].sort_values(ascending=False).items()}
    model_cols = [f for f in feats if f != "attack_defence_gap"] + ["dribbling"]
    miss_model = {c: int(out_raw[c].isna().sum()) for c in model_cols}
    import datetime
    mpath = os.path.join(HERE, "docs", "data", "model.js")
    exported = datetime.datetime.fromtimestamp(os.path.getmtime(mpath), datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    extras = {
        "model_exported": exported,
        "simple_map": {"groups": GROUPS, "coef": coef, "range": [LO, HI],
                       "unused": {"pace": "Speed", "physic": "Strength"},
                       "note": "detailed rating = round(a + b * slider), least-squares fit on all outfield players"},
        "dataset": {"file": os.path.basename(d["path"]), "rows_file": int(len(raw)), "rows_fc24": int(len(raw24)),
                    "goalkeepers_removed": gk, "rows_outfield": int(len(df)), "columns_file": int(raw.shape[1]),
                    "missing_by_column": miss_all, "missing_cells": int(raw24.isna().sum().sum()),
                    "missing_model_columns_outfield": miss_model,
                    "class_counts": {k: int(v) for k, v in df[train.TARGET].value_counts().items()}},
    }
    with open(os.path.join(HERE, "docs", "data", "extras.js"), "w") as fh:
        fh.write("window.FC24_EXTRAS = " + json.dumps(extras, indent=1) + ";\n")

    # scikit-learn reference for the simple mode (same final model as train.py)
    model = RandomForestClassifier(random_state=42, **{k: v for k, v in train.SETTINGS[train_best()].items()})
    model.fit(d["X_train"], d["y_train"])
    rng = np.random.default_rng(7)
    S = [dict(shooting=int(a), dribbling=int(b), passing=int(c), defending=int(e))
         for a, b, c, e in rng.integers(LO, HI + 1, size=(147, 4))]
    S += [dict(shooting=85, dribbling=85, passing=70, defending=30), dict(shooting=70, dribbling=80, passing=88, defending=65),
          dict(shooting=40, dribbling=55, passing=55, defending=88)]
    X = pd.DataFrame([vector(map_simple(s, coef), feats) for s in S], columns=feats)
    proba = model.predict_proba(X)
    ref = {"features": feats, "classes": d["classes"], "simple": S, "X": X.values.tolist(), "proba": proba.round(8).tolist()}
    with open(os.path.join(HERE, "tests", "simple_reference.json"), "w") as fh:
        json.dump(ref, fh)
    print("simple map:", {k: v for k, v in coef.items()})
    print("examples:", [d["classes"][i] for i in proba[-3:].argmax(1)])
    print("missing cells (FC 24 rows):", extras["dataset"]["missing_cells"], "| model columns:", miss_model)


def train_best():
    # the final setting written by train.py (docs/data/model.js)
    txt = open(os.path.join(HERE, "docs", "data", "model.js")).read()
    return json.loads(txt[txt.index("=") + 1:].strip().rstrip(";"))["setting"]


if __name__ == "__main__":
    main()
