#!/usr/bin/env python3
"""Compare a fixed-shape ONNX forward graph with the PyTorch checkpoint."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from timesfm3 import TimesFM3Forecaster


class ExportableForward(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, values, masks, patch_is_target, patch_cpm_mask):
        return self.model.forward(
            {"values": values, "masks": masks, "patch_is_target": patch_is_target},
            patch_cpm_mask=patch_cpm_mask,
            return_aux_outputs=False,
        )["logits"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--checkpoint", default="google/timesfm-3.0-pytorch")
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--rtol", type=float, default=2e-3)
    parser.add_argument("--atol", type=float, default=2e-3)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    graph = args.manifest.parent / manifest["graphFile"]
    context_patches = manifest["contextLength"] // 32
    forecast_patches = max(math.ceil((manifest["forecastHorizon"] - 32) / 32), 1)
    total_patches = context_patches + forecast_patches + 1

    forecaster = TimesFM3Forecaster.from_pretrained(args.checkpoint, device="cpu")
    model = forecaster.model.eval()
    for layer in model.transformer_stack.layers:
        layer.seq_attn.use_sdpa = False
        if getattr(layer, "var_attn", None) is not None:
            layer.var_attn.use_sdpa = False
    wrapper = ExportableForward(model).eval()
    session = ort.InferenceSession(graph, providers=["CPUExecutionProvider"])

    worst_abs = 0.0
    worst_rel = 0.0
    for trial in range(args.trials):
        rng = np.random.default_rng(90210 + trial)
        values = rng.normal(size=(1, 32, total_patches, 32)).astype(np.float32)
        masks = rng.random(values.shape) < 0.04
        patch_is_target = np.zeros((1, 32, total_patches), dtype=bool)
        patch_is_target[:, :4, :] = True
        cpm = np.zeros((1, total_patches), dtype=bool)
        cpm[:, context_patches:] = True
        inputs = {
            "values": values,
            "masks": masks,
            "patch_is_target": patch_is_target,
            "patch_cpm_mask": cpm,
        }
        with torch.inference_mode():
            expected = wrapper(*[torch.from_numpy(inputs[name]) for name in ["values", "masks", "patch_is_target", "patch_cpm_mask"]]).numpy()
        actual = session.run(["logits"], inputs)[0]
        absolute = np.max(np.abs(expected - actual))
        relative = np.max(np.abs(expected - actual) / np.maximum(np.abs(expected), 1e-5))
        worst_abs = max(worst_abs, float(absolute))
        worst_rel = max(worst_rel, float(relative))
        np.testing.assert_allclose(actual, expected, rtol=args.rtol, atol=args.atol)
        print(f"trial={trial} max_abs={absolute:.6g} max_rel={relative:.6g}")

    print(json.dumps({"passed": True, "trials": args.trials, "worstAbsoluteError": worst_abs, "worstRelativeError": worst_rel}, indent=2))


if __name__ == "__main__":
    main()
