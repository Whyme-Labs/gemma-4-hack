# License notes

Research date: September 2, 2026. This document is an engineering interpretation, not legal advice.

## Source code and model weights are different

The Google TimesFM repository source code uses Apache 2.0. The TimesFM-3 pretrained weights use Google's TimesFM Non-Commercial License v1.0.

The public weight license permits non-commercial testing, evaluation, and research. It excludes ordinary production and commercial activity, including revenue-generating use, direct or indirect end-user production use, commercial decision-making, paid deliverables, and commercial training, tuning, or distillation based on the model.

The license also restricts distribution of the model and derivatives. A converted ONNX or ORT checkpoint is likely a model derivative for practical engineering purposes. Do not commit, host, mirror, or bundle it in this repository without legal confirmation and appropriate rights.

## Design consequence

This repository contains:

- Source code for a converter.
- A manifest contract.
- A local file picker.
- No TimesFM-3 model weights.
- No converted TimesFM-3 artifact.

The user obtains the checkpoint separately, accepts the terms separately, converts it locally, and imports the artifact through the browser.

## Other components

At the time of review:

- Qwen3-0.6B is Apache 2.0.
- Transformers.js is Apache 2.0.
- JustBash is Apache 2.0.
- SheetJS Community Edition is Apache 2.0.
- ONNX Runtime is MIT.

Recheck exact transitive dependencies and model conversion repositories before distribution.

## Commercial path

A commercial product needs one of these paths:

1. Obtain a separate commercial TimesFM-3 license from Google.
2. Replace TimesFM-3 with a commercially usable forecasting model while keeping the same browser data and model contract.
3. Train our own compact forecasting model using data and teachers whose licenses allow the intended use.

Do not use TimesFM-3 outputs to create a commercial distilled model unless the applicable license or separate agreement clearly permits it.
