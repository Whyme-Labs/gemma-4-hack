# Status

Research snapshot: September 2, 2026.

## Implemented and tested here

| Area | State | Evidence |
|---|---|---|
| Delimited parsing | Pass | Quoted fields and duplicate headers covered by unit tests |
| Ingestion resource caps | Pass at source and unit boundary | 64 MiB input, 250,000 rows, 5,000,000 cells, 2,048 columns, 30-second worker deadline |
| JSON ingestion | Pass | Array-of-object conversion covered by unit tests |
| Profiling and schema inference | Pass for representative wide data | Unit test and 84-day sample |
| Frequency inference | Pass for daily sample | 86,400,000 ms, regularity 1.0 |
| Target and future-covariate split | Pass for sample | 3 targets and 3 future covariates selected |
| Normalization and duplicate policy | Pass | Duplicate sum behavior covered by unit test |
| Baseline forecasting | Pass | Perfect weekly-pattern test and sample holdout run |
| TimesFM tensor contract | Pass at shape/decoder unit level | Fixed context, horizon, 32-variate padding, quantile extraction |
| Expanded variate gate | Pass | Long-format entity expansion beyond 32 is rejected |
| Semantic role isolation | Pass | Overlapping target and covariate assignments are rejected |
| Shell policy | Pass at policy unit level | Read-only pipeline allowed; network, redirection, command substitution denied |
| Browser UI | Implemented | Static HTTP serving and source retrieval passed; bundled build still needs installed dependencies |
| PWA shell | Implemented | Service worker caches same-origin app assets |

All 12 dependency-free unit tests pass.

## Measured sample result

Input: `samples/daily-sales.csv`, 84 daily rows.

Inferred schema:

- Timestamp: `date`
- Targets: `croissant_units`, `bun_units`, `cake_units`
- Known-future covariates: `promotion_planned`, `public_holiday`, `weather_forecast_c`
- Horizon: 14 days
- Seasonality: 7 days
- Time-grid regularity: 100%

Seasonal-naive rolling holdout:

| Series | WAPE | MASE | 10% to 90% interval coverage |
|---|---:|---:|---:|
| `bun_units` | 5.01% | 1.013 | 92.9% |
| `croissant_units` | 3.59% | 0.575 | 100% |
| `cake_units` | 6.90% | 0.692 | 100% |

The intervals are not calibrated enough to call the 100% figures good. Overcoverage can mean the interval is too wide. The result only establishes a baseline for later TimesFM comparisons.

## Additional local checks

- Every JavaScript source module passes `node --check`.
- All Python export and parity scripts pass `python -m py_compile`.
- The app shell, `src/main.js`, and the sample CSV returned HTTP 200 through a local static server.
- Headless Chromium did not initialize reliably in this container, so DOM interaction and WebGPU tests remain open rather than being reported as passed.
- `evidence/sample-evaluation.json` records deterministic results for CSV, tab-delimited TXT, and long-format JSON fixtures.
- `evidence/memory-budget.json` separates simultaneous and serialized model-residency estimates.

## Implemented but not runtime-verified here

| Area | Why not yet verified |
|---|---|
| Vite production build | The execution container could not resolve the npm registry, so dependencies and the bundled build were not available |
| SheetJS workbook parsing | The adapter, declared-range limits, and worker deadline are implemented, but no workbook corpus was available locally |
| Qwen3-0.6B WebGPU planner | Requires a browser GPU and roughly 570 MB of model artifacts |
| JustBash worker execution | Requires the installed package and browser worker environment |
| ONNX Runtime WebGPU session | Requires a browser GPU and converted TimesFM artifact |
| TimesFM-3 numerical parity | Requires separately obtained model weights and Python ONNX dependencies |
| TimesFM-3 accuracy and latency | Requires parity first, then browser device benchmarks |

## Explicitly not implemented

- Password-protected workbook support.
- Macro execution.
- External workbook connection refresh.
- Pivot-table semantic reconstruction.
- Formula recalculation when no cached value exists.
- Autonomous shell writes.
- Automatic causal claims.
- Direct safety-critical control.
- Commercial distribution or use of TimesFM-3 weights.
