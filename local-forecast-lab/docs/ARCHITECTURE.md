# Architecture

## Control principle

The LLM does not own the data plane.

```text
Local file
  -> parser worker
  -> deterministic profile
  -> heuristic schema proposal
  -> optional LLM and bounded tools
  -> user-approved schema
  -> deterministic normalization and validation
  -> baseline and rolling backtest
  -> optional TimesFM tensor adapter
  -> local WebGPU or WASM inference
  -> deterministic metrics, chart, and export
```

This split prevents a plausible-sounding language model response from silently changing dates, targets, aggregation, or units.

## Data contracts

### Table

```ts
interface Table {
  name: string
  columns: string[]
  rows: Record<string, unknown>[]
}
```

### Approved schema

```ts
interface ForecastSchema {
  version: 1
  table: string
  mode: "wide" | "long"
  timestampColumn: string
  entityColumns: string[]
  valueColumn: string | null
  targetColumns: string[]
  pastCovariateColumns: string[]
  futureCovariateColumns: string[]
  horizon: number
  seasonality: number
  duplicatePolicy: "sum" | "mean" | "last" | "min" | "max"
  missingPolicy: "null" | "zero" | "forward" | "linear"
  dayFirst: boolean
}
```

### Canonical point

```ts
interface CanonicalPoint {
  timestamp: number
  seriesId: string
  sourceColumn: string
  role: "target" | "past_covariate" | "future_covariate"
  value: number
  duplicateCount: number
}
```

A future revision should add `availableAt`, `unit`, and `aggregationMethod`. `availableAt` is necessary for leakage-safe historical evaluation. For example, a weather observation recorded after the forecast origin must not masquerade as a weather forecast known at the origin.

## File ingestion

CSV, TSV, TXT, and JSON use dependency-free parsers. Workbook formats use SheetJS CE. Parsing occurs in a worker.

Limits should be checked twice:

- Before parsing: file byte limit.
- During parsing: row, cell, and output limits.

The current delimited parser caps data rows at 250,000. The TimesFM pipeline should usually aggregate much earlier because a browser transformer does not benefit from millions of raw points.

## Schema inference

The deterministic profiler computes:

- Missing ratio
- Numeric parse ratio
- Date parse ratio
- Cardinality
- Uniqueness ratio
- Sample values
- Name-based semantic hints

The heuristic schema is always produced first. The local LLM sees only the profile, five sample rows, the current schema, and the user's forecasting intent. It does not see the complete workbook by default.

The LLM returns a schema patch in a bounded JSON object. Unknown columns are removed. Numeric ranges are clamped. A malformed response is rejected.

## Tool loop

The planner may request up to three read-only shell pipelines. The app executes them in a dedicated JustBash worker and returns bounded evidence for one refinement pass.

Allowed commands include `cat`, `head`, `tail`, `wc`, `cut`, `sort`, `uniq`, `grep`, `awk`, `sed`, `jq`, `xan`, and a few display tools.

Disallowed features include:

- Network access
- File writes and redirection
- Command substitution
- Shell nesting and `eval`
- Python and JavaScript interpreters
- SQLite
- Deletion and permission changes

The planner should eventually call typed tools instead of writing shell strings. JustBash remains useful behind tools such as `inspect_rows`, `select_columns`, `group_counts`, and `summarize_json`.

## Model residency

The app should treat GPU memory as a scarce shared resource.

```text
Schema phase: Qwen loaded, TimesFM unloaded
Forecast phase: Qwen disposed, TimesFM loaded
Formatting phase: deterministic JavaScript, both models may be unloaded
```

The UI should expose model state and a manual release button. Browser garbage collection is not a reliable GPU-memory protocol, so runtime `dispose` and session `release` calls are required.

## TimesFM export boundary

The exported ONNX graph wraps `TimesFM3Torch.forward`, not `TimesFM3Torch.decode`.

Inputs:

```text
values            float32 [1, 32, total_patches, 32]
masks             bool    [1, 32, total_patches, 32]
patch_is_target    bool    [1, 32, total_patches]
patch_cpm_mask     bool    [1, total_patches]
```

Output:

```text
logits             float32 [1, 32, total_patches, 64, 9]
```

JavaScript performs:

1. Context truncation and left padding.
2. Variate padding to 32.
3. Mask construction.
4. Linear detrending compatible with the published decoder.
5. Horizon patch construction.
6. ONNX execution.
7. Overlap stitching.
8. Trend restoration.
9. Target selection and quantile formatting.

This boundary is testable. The Python parity harness compares the ONNX forward output with PyTorch on identical tensors. A later end-to-end fixture must compare JavaScript preprocessing and decoding against the official Python `decode` result.

## Static model profiles

A graph has a fixed context and maximum horizon. A user can request a shorter horizon and the adapter masks and slices it.

The application should select the smallest profile that satisfies the request. Smaller profiles reduce activations and graph-capture cost.

## Storage

Use three tiers:

- Cache API for immutable app shell and versioned WASM assets.
- Browser model cache for Transformers.js artifacts.
- OPFS for user-imported TimesFM graph, external data, and manifests.

Do not put uploaded business data into persistent storage by default. Persistence should be explicit and encrypted when required.

## Exported results

Every result bundle should contain:

- Input file fingerprint, not file contents
- Approved schema
- Parsing and validation diagnostics
- Model ID, revision, graph profile, dtype, and backend
- Forecast origin and horizon
- Point and quantile forecasts
- Backtest metrics
- Tool transcript
- Human edits and overrides

Without this provenance, a local forecast is hard to reproduce and audit.
