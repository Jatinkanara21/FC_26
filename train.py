"""
P11 · FC 24 Position Finder — train.py
KANARA JATIN JIJI · F10 · Div E · Enrollment 24004501210126

Same pipeline as F10_P11_Jatin.ipynb (the guide's 13 steps):
  FC 24 rows -> first position -> FWD / MID / DEF (goalkeepers removed) -> drop duplicates and
  ID / name / leaking columns -> median / mode fill -> new feature attack_defence_gap -> one-hot
  -> stratified 80/20 split -> SelectKBest fitted on training data only
  -> Random Forest candidates selected by 3-fold training CV macro F1 -> final held-out test evaluation.

It then exports the final forest so the GitHub Pages app runs the SAME model in the browser:
  docs/data/model.js    model info (classes, the 15 features, settings)
  docs/data/model_data_N.js  every tree of the forest, packed (pre-order bytes, gzip, base64)
  docs/data/stats.js    comparison table, confusion matrix, ROC curves, feature importance
  docs/data/samples.js  150 real test-set players for the "random real player" button

Run:  python train.py                      (looks for male_players.csv or data/fc24_players.csv)
      python train.py --data path/to/male_players.csv
Data: Kaggle "EA Sports FC 24 complete player dataset" (stefanoleone992), file male_players.csv.
"""
import argparse, base64, gzip, json, os, struct, sys, time
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.metrics import (accuracy_score, precision_score, recall_score, f1_score,
                             roc_auc_score, roc_curve, confusion_matrix)
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_CANDIDATES = ["male_players.csv", "data/male_players.csv", "fc24_players.csv", "data/fc24_players.csv"]
TARGET = "position_group"
K = 15
SETTINGS = {   # the same 7 rows as the notebook's comparison table
    "Baseline": {}, "n_estimators=50": {"n_estimators": 50}, "n_estimators=100": {"n_estimators": 100},
    "n_estimators=200": {"n_estimators": 200}, "max_depth=None": {"max_depth": None},
    "max_depth=5": {"max_depth": 5}, "max_depth=10": {"max_depth": 10},
}
POS_RATINGS = ["ls", "st", "rs", "lw", "lf", "cf", "rf", "rw", "lam", "cam", "ram", "lm", "lcm", "cm", "rcm",
               "rm", "lwb", "ldm", "cdm", "rdm", "rwb", "lb", "lcb", "cb", "rcb", "rb", "gk"]
DROP = (["player_id", "player_url", "club_team_id", "league_id", "nationality_id", "nation_team_id"]
        + ["fifa_version", "fifa_update", "update_as_of"]
        + ["short_name", "long_name", "dob", "club_name", "league_name", "nationality_name",
           "club_loaned_from", "club_joined_date", "player_tags", "player_traits", "body_type", "real_face"]
        + ["value_eur", "wage_eur", "release_clause_eur", "league_level", "club_jersey_number",
           "nation_jersey_number", "club_contract_valid_until_year"]
        + ["goalkeeping_speed"]
        + ["player_positions", "club_position", "nation_position", "overall", "potential"] + POS_RATINGS)
MAIN = ["pace", "shooting", "passing", "dribbling", "defending", "physic"]


def find_data(path=None):
    for p in ([path] if path else []) + DATA_CANDIDATES:
        full = p if os.path.isabs(p) else os.path.join(HERE, p)
        if os.path.exists(full):
            return full
    sys.exit("Dataset not found. Download male_players.csv from\n"
             "https://www.kaggle.com/datasets/stefanoleone992/ea-sports-fc-24-complete-player-dataset\n"
             "and put it next to train.py (or use data/fc24_players.csv from this repo).")


def group(pos):
    p = str(pos).split(",")[0].strip()
    if p in ["ST", "CF", "LW", "RW", "LF", "RF"]: return "FWD"
    if p in ["CM", "CDM", "CAM", "LM", "RM"]: return "MID"
    if p in ["CB", "LB", "RB", "LWB", "RWB"]: return "DEF"
    return None   # GK


def add_feature(frame):
    frame = frame.copy()
    frame["attack_defence_gap"] = (frame["shooting"] + frame["dribbling"]) / 2 - frame["defending"]
    return frame


def prepare(path=None):
    path = find_data(path)
    raw = pd.read_csv(path, low_memory=False)
    raw = raw[raw["fifa_version"] == 24].copy()
    raw[TARGET] = raw["player_positions"].apply(group)
    raw = raw.dropna(subset=[TARGET]).drop_duplicates()
    names = raw["short_name"] + " (" + raw["player_positions"].str.split(",").str[0] + ")"
    info = raw[["short_name", "long_name", "club_name", "nationality_name", "overall", "player_positions"]].copy()
    df = raw.drop(columns=[c for c in DROP if c in raw.columns]).copy()

    # Split by row BEFORE fitting imputers, one-hot encoding, or supervised feature selection.
    train_idx, test_idx = train_test_split(
        df.index, test_size=0.2, stratify=df[TARGET], random_state=42
    )
    train_raw = df.loc[train_idx]
    # Keep an un-imputed feature copy for cross-validation so every fold learns its own medians.
    df_unimputed = add_feature(df.copy())
    fill_values = {}
    for col in df.columns:
        if col == TARGET:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            fill_values[col] = train_raw[col].median()
        else:
            modes = train_raw[col].mode(dropna=True)
            fill_values[col] = modes.iloc[0] if not modes.empty else "Unknown"
    df = df.fillna({k: v for k, v in fill_values.items()})
    df = add_feature(df)

    # Encode each partition independently, then align test and full-data columns to train columns.
    X_train_cv = pd.get_dummies(df_unimputed.loc[train_idx].drop(columns=[TARGET]), drop_first=True)
    X_test_cv = pd.get_dummies(df_unimputed.loc[test_idx].drop(columns=[TARGET]), drop_first=True)
    X_test_cv = X_test_cv.reindex(columns=X_train_cv.columns, fill_value=0)
    X_train_full = pd.get_dummies(df.loc[train_idx].drop(columns=[TARGET]), drop_first=True)
    X_test_full = pd.get_dummies(df.loc[test_idx].drop(columns=[TARGET]), drop_first=True)
    X_test_full = X_test_full.reindex(columns=X_train_full.columns, fill_value=0)
    X_all_full = pd.get_dummies(df.drop(columns=[TARGET]), drop_first=True)
    X_all_full = X_all_full.reindex(columns=X_train_full.columns, fill_value=0)
    le = LabelEncoder()
    y_all = pd.Series(le.fit_transform(df[TARGET]), index=df.index)
    y_train, y_test = y_all.loc[train_idx], y_all.loc[test_idx]

    selector = SelectKBest(f_classif, k=min(K, X_train_full.shape[1])).fit(X_train_full, y_train)
    score_values = np.nan_to_num(selector.scores_, nan=0.0, posinf=0.0, neginf=0.0)
    scores = pd.Series(score_values, index=X_train_full.columns).sort_values(ascending=False)
    feats = list(scores.head(K).index)
    X_all = X_all_full[feats]
    X_train, X_test = X_train_full[feats], X_test_full[feats]
    return dict(path=path, df=df, names=names, info=info, X_all=X_all, X_train=X_train, X_test=X_test,
                X_train_cv=X_train_cv, X_test_cv=X_test_cv, y_train=y_train, y_test=y_test,
                classes=list(le.classes_), features=feats, kscores=scores)


def evaluate(model, d):
    model.fit(d["X_train"], d["y_train"])
    y_pred = model.predict(d["X_test"]); proba = model.predict_proba(d["X_test"])
    cm = confusion_matrix(d["y_test"], y_pred)
    spec = []
    for i in range(len(cm)):
        tn = cm.sum() - cm[i, :].sum() - cm[:, i].sum() + cm[i, i]; fp = cm[:, i].sum() - cm[i, i]
        spec.append(tn / (tn + fp))
    return {"Accuracy": accuracy_score(d["y_test"], y_pred),
            "Precision": precision_score(d["y_test"], y_pred, average="macro", zero_division=0),
            "Recall": recall_score(d["y_test"], y_pred, average="macro", zero_division=0),
            "F1": f1_score(d["y_test"], y_pred, average="macro", zero_division=0),
            "Specificity": float(np.mean(spec)),
            "AUC": roc_auc_score(d["y_test"], proba, multi_class="ovr", average="macro")}, y_pred, proba, cm


def tree_to_json(est):
    """f = feature index (-1 = leaf), t = threshold, r = right child (left child = next node,
    sklearn builds trees depth-first), v = class index for a pure leaf or class probabilities."""
    t = est.tree_
    leaf = t.children_left == -1
    assert all(t.children_left[i] == i + 1 for i in range(t.node_count) if not leaf[i])
    val = t.value[:, 0, :]; val = val / val.sum(axis=1, keepdims=True)
    v = []
    for row, l in zip(val, leaf):
        if not l: v.append(0)
        elif row.max() == 1.0: v.append(int(row.argmax()))
        else: v.append([round(float(a), 6) for a in row])
    return {"f": [int(x) if not l else -1 for x, l in zip(t.feature, leaf)],
            "t": [float(np.float32(x)) if not l else 0 for x, l in zip(t.threshold, leaf)],
            "r": [int(x) if not l else 0 for x, l in zip(t.children_right, leaf)], "v": v}


def predict_from_json(model_json, X):
    """Exactly what docs/app.js does, in Python: walk every tree, average the leaf votes."""
    out = np.zeros((len(X), len(model_json["classes"])))
    Xv = np.asarray(X, dtype=np.float32).astype(float)
    for tr in model_json["trees"]:
        f, t, r, v = tr["f"], tr["t"], tr["r"], tr["v"]
        for i, row in enumerate(Xv):
            n = 0
            while f[n] != -1:
                n = n + 1 if row[f[n]] <= t[n] else r[n]
            if isinstance(v[n], list): out[i] += v[n]
            else: out[i, v[n]] += 1.0
    return out / len(model_json["trees"])


def pack_trees(trees, k):
    out = bytearray()
    for tr in trees:
        def walk(n):
            if tr["f"][n] == -1:
                v = tr["v"][n]
                if isinstance(v, list): out.append(255); out.extend(struct.pack(f"<{k}f", *v))
                else: out.append(128 + v)
                return
            t4 = tr["t"][n] * 4
            assert t4 == int(t4) and -32768 <= t4 < 32768, "threshold not a multiple of 0.25"
            out.append(tr["f"][n]); out.extend(struct.pack("<h", int(t4)))
            walk(n + 1); walk(tr["r"][n])
        walk(0)
    return bytes(out)


def unpack_trees(buf, k):
    """Python twin of unpack() in docs/app.js."""
    trees, pos = [], 0
    while pos < len(buf):
        f, t, r, v, stack = [], [], [], [], []
        while True:
            b = buf[pos]; pos += 1
            if b < 128:
                f.append(b); t.append(struct.unpack_from("<h", buf, pos)[0] / 4); pos += 2
                r.append(0); v.append(0); stack.append(len(f) - 1)
                continue
            if b == 255: v.append(list(struct.unpack_from(f"<{k}f", buf, pos))); pos += 4 * k
            else: v.append(b - 128)
            f.append(-1); t.append(0); r.append(0)
            if not stack: break
            r[stack.pop()] = len(f)
        trees.append({"f": f, "t": t, "r": r, "v": v})
    return trees


def write_js(path, var, obj, indent=None):
    """JSON wrapped as window.VAR = {...}; so docs/index.html also works opened from disk (file://)."""
    with open(path, "w") as fh:
        fh.write(f"window.{var} = ")
        json.dump(obj, fh, separators=(",", ":") if indent is None else None, indent=indent)
        fh.write(";\n")


def r4(x): return round(float(x), 4)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", default=None); args = ap.parse_args()
    t0 = time.time()
    d = prepare(args.data)
    C, F = d["classes"], d["features"]
    print(f"Data: {os.path.relpath(d['path'], HERE)} | {len(d['df']):,} outfield players | classes {C}")
    print(f"SelectKBest k={K}: {F}")

    rows, best_name, best = [], None, None
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    for name, params in SETTINGS.items():
        candidate = RandomForestClassifier(random_state=42, n_jobs=-1, **params)
        # Refit imputation and feature selection inside each fold. Test rows never influence selection.
        cv_pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("select", SelectKBest(f_classif, k=min(K, d["X_train_cv"].shape[1]))),
            ("forest", candidate),
        ])
        cv_scores = cross_val_score(cv_pipeline, d["X_train_cv"], d["y_train"], cv=cv,
                                    scoring="f1_macro", n_jobs=1)
        m, _, _, _ = evaluate(candidate, d)
        row = {"Setting": name, **{k: round(float(v), 6) for k, v in m.items()},
               "CV_F1": round(float(cv_scores.mean()), 6), "CV_F1_std": round(float(cv_scores.std()), 6)}
        rows.append(row)
        print(f"  {name:17s} CV macroF1 {cv_scores.mean():.3f} (+/- {cv_scores.std():.3f}) | test macroF1 {m['F1']:.3f}")
        if best is None or cv_scores.mean() > best:
            best, best_name = float(cv_scores.mean()), name
    params = SETTINGS[best_name]
    final = RandomForestClassifier(random_state=42, n_jobs=-1, **params)
    met, pred, proba, cm = evaluate(final, d)
    met["train_accuracy"] = accuracy_score(d["y_train"], final.predict(d["X_train"]))
    print(f"FINAL = {best_name} {params}: CV macro F1 {best:.4f} | held-out test macro F1 {met['F1']:.4f} | accuracy {met['Accuracy']:.4f} | AUC {met['AUC']:.4f}")

    os.makedirs(os.path.join(HERE, "docs", "data"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "tests"), exist_ok=True)
    full_params = {"n_estimators": final.n_estimators, "max_depth": final.max_depth, "random_state": 42}
    model_json = {"project": "P11 FC 24 Position Finder", "classes": C, "features": F, "setting": best_name,
                  "params": full_params, "trees": [tree_to_json(e) for e in final.estimators_]}
    # Packed export: every tree in pre-order, one byte per node (feature index, or 128 + class for a
    # pure leaf, or 255 + float32 probabilities for a mixed leaf) + int16 threshold*4 for split nodes,
    # gzipped and base64'd into docs/data/model_data.js (≈1 MB instead of ≈8 MB of plain JSON).
    # docs/app.js unpacks it into the same f / t / r / v arrays used below.
    ddir = os.path.join(HERE, "docs", "data")
    packed = pack_trees(model_json["trees"], len(C))
    for old in os.listdir(ddir):
        if old.startswith("model_data"): os.remove(os.path.join(ddir, old))
    b64 = base64.b64encode(gzip.compress(packed, mtime=0)).decode()
    CH = 600_000                       # small files (some static hosts dislike one big file)
    data_files = []
    for i in range(0, len(b64), CH):
        name = f"model_data_{i // CH}.js"; data_files.append(name)
        with open(os.path.join(ddir, name), "w") as fh:
            fh.write(f'window.FC24_PACKED = (window.FC24_PACKED || "") + "{b64[i:i + CH]}";\n')
    write_js(os.path.join(ddir, "model.js"), "FC24_MODEL", {k: v for k, v in model_json.items() if k != "trees"}
             | {"n_trees": len(model_json["trees"]), "format": "preorder-v1", "data_files": data_files}, indent=1)
    reread = "".join(open(os.path.join(ddir, n)).read().split('"')[-2] for n in data_files)
    model_json["trees"] = unpack_trees(gzip.decompress(base64.b64decode(reread)), len(C))

    js_prob = predict_from_json(model_json, d["X_test"])
    agree = float((js_prob.argmax(1) == proba.argmax(1)).mean()); max_diff = float(np.abs(js_prob - proba).max())
    print(f"Export check (packed file unpacked + browser-style walk) == sklearn on {agree*100:.2f}% of {len(js_prob)} test rows (max prob diff {max_diff:.1e})")

    yb = np.eye(len(C))[d["y_test"]]
    roc = {}
    for k, c in enumerate(C):
        fpr, tpr, _ = roc_curve(yb[:, k], proba[:, k])
        idx = np.unique(np.linspace(0, len(fpr) - 1, min(len(fpr), 120)).astype(int))
        roc[c] = {"fpr": [r4(x) for x in fpr[idx]], "tpr": [r4(x) for x in tpr[idx]], "auc": r4(roc_auc_score(yb[:, k], proba[:, k]))}
    df, X_all = d["df"], d["X_all"]
    y_all = pd.Series(d["df"][TARGET].values, index=X_all.index)
    imp = pd.Series(final.feature_importances_, index=F).sort_values(ascending=False)
    stats = {
        "student": "KANARA JATIN JIJI · F10 · Div E · 24004501210126",
        "data_file": os.path.basename(d["path"]),
        "rows_outfield": int(len(df)),
        "class_counts": {c: int((df[TARGET] == c).sum()) for c in ["DEF", "MID", "FWD"]},
        "train_rows": int(len(d["X_train"])), "test_rows": int(len(d["X_test"])),
        "n_columns_before_selection": int(len(d["kscores"])), "k": K,
        "kbest_scores": [[f, round(float(s), 1)] for f, s in d["kscores"].head(K).items()],
        "comparison": rows, "best_setting": best_name, "final_params": full_params,
        "metrics": {k: round(float(v), 6) for k, v in met.items()},
        "confusion_matrix": {"labels": C, "matrix": cm.tolist()},
        "roc": roc,
        "feature_importance": [[f, r4(v)] for f, v in imp.items()],
        "class_means_main_stats": {c: {s: round(float(df.loc[df[TARGET] == c, s].mean()), 1) for s in MAIN + ["height_cm"]}
                                   for c in ["DEF", "MID", "FWD"]},
        "feature_ranges": {f: [float(X_all[f].min()), float(X_all[f].max())] for f in F},
        "class_feature_means": {c: {f: round(float(df.loc[y_all == c, f].mean()), 2) for f in set(F + MAIN)} for c in C},
        "export_check": {"test_rows": int(len(js_prob)), "same_prediction_share": agree, "max_probability_diff": max_diff},
    }
    stats["feature_ranges"]["dribbling"] = [float(df["dribbling"].min()), float(df["dribbling"].max())]
    write_js(os.path.join(HERE, "docs", "data", "stats.js"), "FC24_STATS", stats, indent=1)

    rs = d["X_test"].sample(150, random_state=42)
    write_js(os.path.join(HERE, "docs", "data", "samples.js"), "FC24_SAMPLES",
             [{"name": d["names"][i], "actual": C[int(d["y_test"].loc[i])],
               "dribbling": float(df.loc[i, "dribbling"]), "x": [float(v) for v in rs.loc[i].values]} for i in rs.index])
    # Player search list: names are ONLY for search/display, never model inputs.
    info, test_idx = d["info"], set(d["X_test"].index)
    order_idx = info["overall"].sort_values(ascending=False, kind="stable").index
    vals_cols = [f for f in F if f != "attack_defence_gap"] + (["dribbling"] if "dribbling" not in F else [])
    clubs = sorted(set(info["club_name"].fillna("")))
    nations = sorted(set(info["nationality_name"].fillna("")))
    ci, ni = {c: k for k, c in enumerate(clubs)}, {c: k for k, c in enumerate(nations)}
    rows_p = []
    for i in order_idx:
        short, long_ = str(info.at[i, "short_name"]), str(info.at[i, "long_name"])
        rows_p.append([short, "" if long_ == short else long_,
                       ci["" if pd.isna(info.at[i, "club_name"]) else info.at[i, "club_name"]],
                       ni["" if pd.isna(info.at[i, "nationality_name"]) else info.at[i, "nationality_name"]],
                       int(info.at[i, "overall"]), str(info.at[i, "player_positions"]).split(",")[0].strip(),
                       C.index(df.at[i, TARGET]), 1 if i in test_idx else 0] + [int(round(float(df.at[i, c]))) for c in vals_cols])
    blob = base64.b64encode(gzip.compress(json.dumps({"cols": vals_cols, "clubs": clubs, "nations": nations, "rows": rows_p},
                                                     separators=(",", ":"), ensure_ascii=False).encode(), mtime=0)).decode()
    with open(os.path.join(ddir, "players.js"), "w") as fh:
        fh.write(f'window.FC24_PLAYERS_PACKED = "{blob}";\n')
    print(f"Player search list: {len(rows_p):,} players, {len(blob)/1024:.0f} KB")

    ref = d["X_test"].iloc[:300]
    with open(os.path.join(HERE, "tests", "sklearn_reference.json"), "w") as fh:
        json.dump({"features": F, "X": ref.values.tolist(), "proba": final.predict_proba(ref).round(6).tolist()}, fh, separators=(",", ":"))
    kb = sum(os.path.getsize(os.path.join(ddir, n)) for n in data_files) / 1024
    print(f"Wrote docs/data/model.js + {len(data_files)} model_data files ({kb:.0f} KB, {len(model_json['trees'])} trees), stats.js, samples.js, tests/sklearn_reference.json in {time.time()-t0:.1f}s")
    return met, agree


if __name__ == "__main__":
    main()
