# Local Forecast Lab

A Chromium-first research PWA for turning local tabular files into explicit time-series schemas, measured baselines, and locally executed forecasts.

The app is designed around one rule: the language model may resolve semantics and propose tool calls, but deterministic code owns parsing, validation, resampling, model tensors, metrics, and exports.

## What works now

- CSV, TSV, TXT, and JSON ingestion in a browser worker with byte, row, cell, and wall-clock limits.
- Excel and other workbook ingestion through SheetJS CE. For strict offline use, vendor `xlsx.mjs` into `public/vendor/`.
- Column profiling and automatic wide or long schema proposals.
- Editable timestamp, entity, target, past-only covariate, and known-future covariate mappings.
- Duplicate aggregation, frequency inference, regularity checks, missing-value accounting, and TimesFM's 32-variate gate.
- Seasonal-naive point and quantile forecasts.
- Rolling holdout metrics including WAPE, MASE, pinball loss, and interval coverage.
- A bounded JustBash worker for read-only local inspection.
- An optional Qwen3-0.6B schema planner through Transformers.js and WebGPU or WASM.
- A fixed-shape TimesFM-3 ONNX export script, browser tensor adapter, ONNX Runtime Web loader, and output decoder.
- CSV and JSON result export.
- PWA app-shell caching.

## What is not yet proven

- The official TimesFM-3 checkpoint has not been exported and run in this repository. The model is large, separately licensed, and its browser graph needs parity testing.
- INT4 WebGPU speed and operator coverage are not assumed. They must be measured against FP16 and FP32 on each target browser and GPU class.
- The sub-1B planner is integrated but has not yet passed a large schema/tool benchmark.
- "Any arbitrary Excel" is not a defensible promise. The app can ingest broad workbook formats, but it must reject encrypted files, macros, external data models, decorative sheets, unresolved multi-row headers, and datasets with no usable time signal.

See [STATUS.md](STATUS.md) and [docs/VALIDATION.md](docs/VALIDATION.md).

## Run the app

```bash
npm install
npm run dev
```

Use a current desktop Chrome or Edge build for the full WebGPU path. The deterministic baseline remains useful when WebGPU is unavailable.

Run the dependency-free tests:

```bash
npm test
npm run samples
npm run memory
```

## Export TimesFM-3 separately

The app does not contain or redistribute TimesFM-3 weights.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-export.txt
python scripts/export_timesfm3_onnx.py \
  --checkpoint google/timesfm-3.0-pytorch \
  --output-dir models/timesfm3-c512-h64-fp32 \
  --context 512 \
  --horizon 64
python scripts/parity_timesfm3.py \
  --manifest models/timesfm3-c512-h64-fp32/timesfm3-forward.manifest.json
```

Select the generated manifest, ONNX graph, and external data files together in the app. Converted artifacts remain subject to the TimesFM model license.

## Why fixed shapes

TimesFM-3's published Python implementation performs dynamic preprocessing, iterative running-stat refinement, patch stitching, and optional PyTorch scaled-dot-product attention. The browser adapter exports the model's forward core at a fixed context and horizon. Fixed shapes reduce ONNX export uncertainty and make ONNX Runtime Web graph capture possible when every node stays on WebGPU.

A small family of profiles is preferable to one dynamic graph:

- 512 context, 64 horizon
- 1,024 context, 128 horizon
- 2,048 context, 256 horizon

All profiles pad to 32 variates. Unused channels are masked.

## Project layout

```text
src/core/             Parsing, profiling, schema, normalization, validation, metrics
src/core/forecast/    Deterministic baseline
src/runtime/          Browser capability gate, LLM planner, JustBash, TimesFM ONNX
src/ui/               Canvas chart and DOM helpers
scripts/              Export, quantization, parity, and memory calculations
docs/                 Research, architecture, licensing, and validation plan
tests/                Dependency-free unit tests
```

## Privacy model

Uploaded files are read through the browser `File` API. They are passed to a local worker, not uploaded. JustBash has no network configuration. The app only contacts model and library hosts when it must download runtime assets. A release build should vendor SheetJS and all WASM files, pin model revisions, and offer a switch that disables every remote request.

## Research date

The technical and licensing review in this repository was performed on September 2, 2026. Deterministic sample evidence is stored under `evidence/`. Recheck browser support, package versions, and model terms before each release.
