# Feasibility assessment

Research date: September 2, 2026.

## Verdict

The idea is technically feasible as a Chromium-first, non-commercial research app.

It is not yet feasible as a universal browser product that promises to understand every workbook and run TimesFM-3 smoothly on every device. Three boundaries are non-negotiable:

1. TimesFM-3 needs a separate browser export and parity program.
2. Current ONNX Runtime WebGPU support narrows the full path mainly to Chrome and Edge on desktop and Android.
3. The TimesFM-3 model license blocks ordinary production and commercial use unless separate terms are obtained.

The product can still be valuable. The deterministic data workbench, baseline, tool boundary, and model adapter are independent of TimesFM-3. A commercially licensed or permissively licensed forecasting model can later use the same contract.

## Component assessment

| Component | Feasible now | Main constraint | Decision |
|---|---|---|---|
| CSV, TXT, JSON parsing | Yes | Large files and malformed inputs | Worker, row and memory caps |
| Excel parsing | Yes for common workbook tables | Encrypted files, macros, formulas, layout semantics | SheetJS plus explicit rejection and manual mapping |
| Arbitrary schema understanding | Partly | Semantics are underdetermined | Heuristics first, LLM proposal second, user approval required |
| Local sub-1B LLM | Yes on capable WebGPU devices | 570 MB q4f16 artifact and tool-call reliability | Qwen3-0.6B first, serialize model residency |
| JustBash tools | Yes | Untrusted programs can consume resources | Dedicated worker, no network, hardened limits, read-only policy |
| TimesFM-3 browser inference | Plausible, not proven | PyTorch export, operator coverage, memory, quantization error | Fixed-shape ONNX forward graph and parity gates |
| Offline PWA | Yes after assets exist locally | First-use downloads and browser storage eviction | Vendor release assets and support OPFS import |
| All browsers | No for full model path | ONNX Runtime WebGPU matrix | Chromium-first, deterministic fallback elsewhere |
| Commercial TimesFM-3 product | No under current public weight terms | Non-commercial model license | Research only or obtain a separate license |

## TimesFM-3 facts that matter

Google describes TimesFM-3 as a roughly 330 million parameter model pretrained on more than one trillion time points. It accepts multiple targets, historical covariates, and known-future covariates. It emits point and nine quantile forecasts in one non-autoregressive pass.

The public configuration uses 20 transformer layers, width 1,280, 16 heads, 32-step input patches, 64-step output patches, and a maximum of 32 variates. The published float32 checkpoint is about 1.32 GB.

The architecture is export-friendly in one sense. Its core uses linear layers, RMS normalization, rotary positions, matrix multiplication, softmax, masking, reshapes, and elementwise operations. The difficult part is the Python control around that core: dynamic patch construction, running statistics, iterative CPM RevIN refinement, stitching, and lazy dimensions.

The implementation in this repository therefore exports a static forward graph. JavaScript owns the fixed-shape input construction and output stitching. PyTorch SDPA is disabled during export so attention decomposes into ordinary ONNX operators.

## Memory budget

Weight-only lower bounds:

| Artifact | Approximate bytes | Approximate GiB |
|---|---:|---:|
| TimesFM-3 FP32 | 1.32 GB | 1.229 GiB |
| TimesFM-3 FP16 | 660 MB | 0.615 GiB |
| TimesFM-3 INT8 | 330 MB | 0.307 GiB |
| TimesFM-3 INT4 | 165 MB | 0.154 GiB |
| Qwen3-0.6B q4f16 browser artifact | 570 MB | 0.531 GiB |

If both models remain resident, TimesFM INT4 weights plus the Qwen q4f16 artifact total at least 735 MB before activations, graph state, browser copies, GPU allocation overhead, and caches. Serializing residency lowers the weight or artifact floor to 570 MB. A 1.55 planning sensitivity gives 1.14 GB simultaneous and 0.88 GB serialized, but neither value is a measured browser peak.

The practical design is serial:

1. Load the LLM.
2. Produce and approve a schema.
3. Dispose the LLM and release GPU buffers.
4. Load TimesFM-3.
5. Forecast.
6. Dispose TimesFM when the user switches datasets or profiles.

## Browser limits

ONNX Runtime documents WebAssembly support across the major browsers. Its WebGPU matrix currently lists Chrome and Edge support on Windows, Android, and macOS. Safari and Firefox are not listed for the WebGPU execution provider.

ONNX Runtime also documents several large-model limits:

- Chrome ArrayBuffer operations encounter a limit around 2 GB.
- ONNX protobuf files are limited to 2 GB, so larger graphs need external data.
- 32-bit WebAssembly memory is limited to 4 GB.
- Cache API and OPFS can persist large model data.

TimesFM-3 FP32 fits below the protobuf limit, but external data is still preferable. It reduces giant graph-buffer handling and lets the app pass model weights as local Blob objects.

## Why "any arbitrary Excel" must be changed

A parser can accept many file formats. It cannot infer missing meaning.

Examples that require rejection or user action:

- A workbook has monthly columns but no year.
- Dates are ambiguous between day-first and month-first conventions.
- Several unrelated tables share one sheet.
- A merged title row sits above a two-row header.
- A formula has no cached result.
- Targets are censored by stockouts but the sheet records them as demand.
- A future covariate contains the realized future value, creating leakage.
- The workbook contains only 10 observations.
- A numerical ID looks like an Excel serial date.

The defensible promise is: broad file ingestion, explicit schema proposals, visible ambiguity, deterministic validation, and no forecast when evidence is inadequate.

## LLM choice

Qwen3-0.6B is the default research planner because its official model is Apache 2.0, supports 32,768 context, and is trained for agent use. Its browser ONNX conversion has a q4f16 artifact around 570 MB. The app disables long reasoning and requests a bounded JSON schema patch.

FunctionGemma 270M is smaller and purpose-built for function calling, but Google describes it as a base for task-specific fine-tuning rather than a drop-in general planner. It is a good second-stage target after collecting our schema and tool traces.

## JustBash role

JustBash is not the data engine. It is an auditable inspection surface.

The worker receives compact text files such as `profile.json` and `sample.csv`. It has no network configuration. The app enables the hardened execution profile and applies smaller limits for time, commands, loops, output, input, and filesystem bytes. A second policy rejects redirection, command substitution, network tools, interpreters, deletion, and commands outside a short read-only allowlist.

The browser terminates the entire worker when a deadline is exceeded. This matters because host-defined custom commands are trusted code and must not share the UI thread.

## Primary sources

- Google Research, TimesFM-3 announcement: https://research.google/blog/timesfm-3-a-zero-shot-foundation-model-for-multivariate-forecasting/
- Google TimesFM repository: https://github.com/google-research/timesfm
- TimesFM-3 model and license: https://huggingface.co/google/timesfm-3.0-pytorch
- ONNX Runtime Web browser matrix: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- ONNX Runtime Web large-model guidance: https://onnxruntime.ai/docs/tutorials/web/large-models.html
- ONNX Runtime WebGPU guidance: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- Qwen3-0.6B model card: https://huggingface.co/Qwen/Qwen3-0.6B
- Qwen3 browser ONNX conversion: https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX
- Transformers.js: https://github.com/huggingface/transformers.js
- JustBash: https://github.com/vercel-labs/just-bash
- SheetJS CE: https://github.com/SheetJS/sheetjs
