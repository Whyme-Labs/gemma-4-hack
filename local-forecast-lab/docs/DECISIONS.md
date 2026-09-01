# Engineering decisions

## 2026-09-02: deterministic data plane

The LLM proposes semantics. It does not parse full workbooks, resample timestamps, calculate metrics, construct model tensors, or format numeric exports.

Reason: these operations have crisp invariants and need reproducible tests.

## 2026-09-02: Chromium-first full model path

The full WebGPU path targets Chrome and Edge first. Other browsers keep the baseline and may use WASM for smaller models.

Reason: ONNX Runtime Web's current WebGPU support matrix does not justify a universal-browser claim.

## 2026-09-02: fixed-shape TimesFM graphs

Export a small family of static profiles rather than a fully dynamic graph.

Reason: TimesFM's Python decoder has dynamic control, and ONNX Runtime Web graph capture requires static shapes and WebGPU-resident operators.

## 2026-09-02: model serialization

Do not keep Qwen and TimesFM loaded together by default.

Reason: simultaneous residency has a weight and artifact floor of about 735 MB even with an INT4 TimesFM estimate. Serializing the models lowers that floor to the larger artifact, about 570 MB, before runtime overhead.

## 2026-09-02: JustBash as an inspection tool

JustBash sees compact text projections, not the original binary workbook. The worker has no network and a read-only command policy.

Reason: shell tools are useful for transparent inspection, but arbitrary mutation is unnecessary and raises the attack surface.

## 2026-09-02: baseline before foundation model

Every dataset runs a simple baseline and rolling holdout first.

Reason: model size is not evidence of value. TimesFM must beat a cheap alternative on measured forecast or decision cost.
