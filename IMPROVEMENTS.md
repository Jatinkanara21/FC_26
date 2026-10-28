# FC 24 Position Finder — Improvements and Verification

## Changes applied

### Machine learning reliability
- Split the labeled outfield-player data before fitting supervised feature selection.
- Fit median/mode imputers and `SelectKBest` inside each training cross-validation fold for model selection.
- Select the final Random Forest configuration using 3-fold stratified CV macro F1 on the training split only.
- Keep the held-out 20% test split for final reporting, not model selection.
- Rebuilt the browser model exports and scikit-learn reference data from the corrected training pipeline.
- Verified exported JavaScript tree inference against scikit-learn on all 3,261 held-out test rows: 100% matching predictions and zero maximum probability difference.

### Application and UX
- Preserved the responsive Simple, Advanced, Dashboard, Compare, Batch CSV, and Admin demo experiences.
- Simple mode remains the default and explains that its four sliders estimate detailed player ratings; pace and strength do not affect the current selected model features.
- Retained local assets so the browser application can run offline from `docs/index.html`.
- Kept a clear warning that GitHub Pages cannot provide real server-side admin security and that localStorage data is browser/device-local.

### Admin and configuration safety
- Removed any known default password from the static site's config; no default password is shipped.
- Streamlit now requires `st.secrets["ADMIN_PASSWORD"]` and fails closed if it is not configured.
- The static browser admin gate remains demo-only, because any client-side password check can be bypassed. Do not store confidential data or treat it as production authorization. A secure public admin system requires server-side authentication/authorization and a database.

## Verification performed

- `python -m py_compile train.py app.py simple_map.py` — passed.
- `python train.py` — passed; 16,305 outfield players, 15 selected features, 200-tree final model.
- `python simple_map.py` — passed; slider mapping generated and FWD/MID/DEF sample predictions verified.
- `node --test tests/test_site.test.js` — 8/8 passed.
- Export parity — all 3,261 held-out test rows match scikit-learn exactly.

## Results from the corrected pipeline

- Selected model: Random Forest, 200 trees.
- Training CV macro F1: 0.8213.
- Held-out test accuracy: 0.8185.
- Held-out test macro F1: 0.8152.
- Held-out test macro one-vs-rest AUC: 0.9466.

These are dataset-specific results and should be described as the current evaluation, not a guarantee of real-world football-position accuracy.

## Deployment items that cannot be completed from the ZIP alone

- Replace `USERNAME` / `REPO` placeholders in README links with the actual GitHub owner and repository.
- Enable GitHub Pages or configure Streamlit hosting in the owner's account.
- Configure `ADMIN_PASSWORD` in Streamlit secrets if the Streamlit admin demo is needed.
- If real admin access is required, deploy a backend with server-side authorization; GitHub Pages alone cannot securely host admin operations.
