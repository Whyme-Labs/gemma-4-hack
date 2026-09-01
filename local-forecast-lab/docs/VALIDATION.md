# Validation plan

A browser demo is not enough. The project passes only when the following gates are measured.

## Gate 1: ingestion corpus

Build a local corpus of at least 100 files:

- CSV, TSV, pipe-delimited, and malformed text
- JSON arrays, nested objects, and multiple table arrays
- XLSX, XLS, XLSB, ODS, merged headers, hidden sheets, formulas, date serials, and empty sheets
- Long and wide time-series layouts
- Multilingual headers
- Adversarially large cells and row counts

Record expected outcome for every file: parsed, ambiguous, rejected, or manually mapped.

Pass criteria:

- No uncaught parser crash.
- No silent row loss.
- Every skipped row receives a count and reason.
- At least 99% agreement with the labelled table boundary on supported files.
- Unsupported workbook features produce explicit messages.

## Gate 2: schema benchmark

Create labelled schemas for at least 200 tables from our actual domains:

- Bakery and retail demand
- Air quality
- GPU and rendering queues
- 3D scanning jobs
- Property CRM
- Hospitality
- Energy and industrial sensors

Evaluate the deterministic heuristic and the LLM separately.

Metrics:

- Timestamp-column accuracy
- Target-column precision and recall
- Entity-column exact match
- Covariate-role macro F1
- Frequency accuracy
- Invalid schema rate
- Abstention quality

Pass criteria for the LLM-assisted system:

- Valid JSON in at least 99.5% of runs.
- Timestamp accuracy at least 98% on supported tables.
- Target precision at least 97%.
- No lower abstention rate at the cost of more dangerous mappings.

## Gate 3: tool safety

Generate at least 10,000 benign and adversarial planner outputs.

Attack classes:

- Network calls
- Redirection and file writes
- Command substitution
- Fork or loop bombs
- Huge glob expansion
- Deep jq and awk programs
- Output flooding
- Prompt injection inside cell values
- Requests to expose unrelated local files

Pass criteria:

- Zero successful network requests.
- Zero reads outside the in-memory workspace.
- Zero persistent writes.
- Worker termination within 5 seconds of the app deadline.
- Output never exceeds configured limits.
- The workbook's text cannot change the system tool policy.

## Gate 4: ONNX forward parity

For every exported profile and dtype, run at least 100 randomized cases against PyTorch.

Vary:

- Number of active variates from 1 to 32
- Missingness from 0% to 50%
- Target and covariate role combinations
- Scale from very small to very large
- Constant and near-constant series
- CPM horizon masks

Initial float parity target:

- Maximum absolute error at most 0.002
- Maximum relative error at most 0.002 outside values near zero

Quantized profiles need a forecast-level criterion rather than only tensor parity.

## Gate 5: end-to-end decoder parity

Create fixtures with targets, past-only covariates, known-future covariates, masks, context, and horizon.

Compare:

- Official Python `decode`
- JavaScript preprocessing plus ONNX forward plus JavaScript stitching

Test linear trends, no trends, missing context, multiple targets, and horizon values around patch boundaries such as 31, 32, 33, 63, 64, 65, 127, and 128.

Pass criteria:

- FP32 point and quantile forecasts within the forward-parity tolerance.
- No off-by-one shift at a patch boundary.
- Correct target order after variate padding.

## Gate 6: forecast quality

Use rolling-origin evaluation. Never use a random row split.

For each dataset and horizon, compare:

- Seasonal naive
- Exponential smoothing or a suitable statistical model
- CatBoost or LightGBM with lag features
- TimesFM-3 FP32
- TimesFM-3 FP16
- TimesFM-3 INT8 and INT4 candidates

Metrics:

- WAPE or MASE for point accuracy
- Pinball loss by quantile
- Interval coverage and width
- Dataset-specific decision cost

A model is promoted only when the paired bootstrap lower confidence bound for decision-cost improvement is above zero, or when it offers a measured latency or deployment benefit without material quality loss.

## Gate 7: browser performance

Target matrix:

- Chrome and Edge on Windows with integrated GPU
- Chrome and Edge on Windows with discrete GPU
- Chrome on macOS Apple Silicon
- Chrome on Android high-end device
- Safari and Firefox baseline-only path

Measure cold and warm runs:

- Model download bytes
- Parse time
- Schema planner load and generation time
- TimesFM session creation time
- First inference and steady-state inference time
- JavaScript heap peak
- GPU memory where the browser exposes it
- Tab crash or device-loss rate
- Cache hit behavior

Initial product targets for the 512/64 profile:

- No tab crash on a 16 GB desktop.
- Warm forecast under 10 seconds on a recent discrete GPU.
- Warm forecast under 30 seconds on a recent integrated GPU.
- Peak combined residency avoided by model serialization.

These are engineering targets, not claims. Replace them with measured distributions.

## Gate 8: privacy and offline behavior

Use browser developer tools and an automated proxy.

Pass criteria:

- Uploaded file bytes never leave the origin process.
- After assets are installed, strict offline mode produces zero network requests.
- Model and runtime downloads are version-pinned and integrity-checked.
- No analytics, crash report, or service worker request includes file names, headers, samples, schema, or forecasts.

## Gate 9: user decision quality

Run task tests with users who know the data.

Measure:

- Time to an approved schema
- Number of mapping corrections
- Incorrect confidence in weak data
- Ability to explain why a forecast was rejected
- Whether users understand target versus known-future covariates
- Whether users notice leakage warnings

The app fails if it makes bad data feel authoritative.

## Current local evidence

The repository currently passes 12 unit tests covering core parsing, schema selection, normalization, baseline forecasting, TimesFM shape construction and decoding, JSON extraction, and shell policy.

The deterministic fixture suite also covers tab-delimited energy load and long-format JSON air-quality data. The 84-day sales sample produces a valid six-variate daily schema and seasonal-naive WAPE between 3.59% and 6.90% across three products. Exact outputs are committed under `evidence/`.

The ONNX, WebGPU, workbook corpus, and LLM gates remain open.
