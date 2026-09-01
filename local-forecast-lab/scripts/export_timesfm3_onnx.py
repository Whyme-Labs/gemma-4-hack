#!/usr/bin/env python3
"""Export a fixed-shape TimesFM-3 forward graph for browser inference.

This script does not redistribute weights. The operator must separately accept
Google's TimesFM license and obtain the checkpoint. Output artifacts remain
subject to that license.

Example:
  python scripts/export_timesfm3_onnx.py \
    --checkpoint google/timesfm-3.0-pytorch \
    --output-dir models/timesfm3-c512-h64-fp32 \
    --context 512 --horizon 64
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import onnx
import torch
from timesfm3 import TimesFM3Forecaster


class ExportableForward(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(
        self,
        values: torch.Tensor,
        masks: torch.Tensor,
        patch_is_target: torch.Tensor,
        patch_cpm_mask: torch.Tensor,
    ) -> torch.Tensor:
        output = self.model.forward(
            {
                "values": values,
                "masks": masks,
                "patch_is_target": patch_is_target,
            },
            patch_cpm_mask=patch_cpm_mask,
            return_aux_outputs=False,
        )
        return output["logits"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default="google/timesfm-3.0-pytorch")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--context", type=int, default=512)
    parser.add_argument("--horizon", type=int, default=64)
    parser.add_argument("--opset", type=int, default=21)
    parser.add_argument("--device", default="cpu")
    return parser.parse_args()


def external_locations(model_path: Path) -> list[str]:
    model = onnx.load(model_path, load_external_data=False)
    locations: set[str] = set()
    for tensor in model.graph.initializer:
        if tensor.data_location != onnx.TensorProto.EXTERNAL:
            continue
        for entry in tensor.external_data:
            if entry.key == "location":
                locations.add(entry.value)
    return sorted(locations)


def main() -> None:
    args = parse_args()
    if args.context <= 0 or args.context % 32:
        raise SystemExit("--context must be positive and divisible by 32")
    if args.horizon <= 0:
        raise SystemExit("--horizon must be positive")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    graph_path = args.output_dir / "timesfm3-forward.onnx"

    forecaster = TimesFM3Forecaster.from_pretrained(args.checkpoint, device=args.device)
    model = forecaster.model.eval()
    if model.input_patch_len != 32 or model.output_patch_len != 64:
        raise RuntimeError(f"Unexpected patch sizes: {model.input_patch_len}, {model.output_patch_len}")

    # Avoid exporting PyTorch SDPA as a backend-specific fused op. The eager
    # path decomposes to common ONNX operators such as MatMul, Softmax, Where,
    # Reshape, and Transpose.
    for layer in model.transformer_stack.layers:
        layer.seq_attn.use_sdpa = False
        if getattr(layer, "var_attn", None) is not None:
            layer.var_attn.use_sdpa = False

    patch = model.input_patch_len
    rolls = model.output_patch_len // patch
    extract_length = min(2 * patch, model.output_patch_len)
    overlap = extract_length - patch
    forecast_patches = max(math.ceil((args.horizon - overlap) / patch), 1)
    horizon_patches = forecast_patches + rolls - 1
    total_patches = args.context // patch + horizon_patches
    shape = (1, 32, total_patches, patch)

    values = torch.randn(shape, dtype=torch.float32, device=args.device)
    masks = torch.zeros(shape, dtype=torch.bool, device=args.device)
    patch_is_target = torch.ones((1, 32, total_patches), dtype=torch.bool, device=args.device)
    patch_cpm_mask = torch.zeros((1, total_patches), dtype=torch.bool, device=args.device)
    patch_cpm_mask[:, args.context // patch :] = True

    wrapper = ExportableForward(model).eval()
    with torch.inference_mode():
        reference = wrapper(values, masks, patch_is_target, patch_cpm_mask)
    print(f"PyTorch output shape: {tuple(reference.shape)}")

    torch.onnx.export(
        wrapper,
        (values, masks, patch_is_target, patch_cpm_mask),
        graph_path,
        input_names=["values", "masks", "patch_is_target", "patch_cpm_mask"],
        output_names=["logits"],
        opset_version=args.opset,
        dynamo=True,
        external_data=True,
        optimize=True,
        verify=False,
        report=True,
    )

    onnx.checker.check_model(onnx.load(graph_path, load_external_data=False))
    locations = external_locations(graph_path)
    manifest = {
        "format": "timesfm3-forward-onnx-v1",
        "sourceCheckpoint": args.checkpoint,
        "graphFile": graph_path.name,
        "externalData": [{"path": location, "file": Path(location).name} for location in locations],
        "contextLength": args.context,
        "forecastHorizon": args.horizon,
        "maxVariates": 32,
        "inputPatchLength": 32,
        "outputPatchLength": 64,
        "quantiles": list(model.quantiles),
        "staticShape": True,
        "allowWasmFallback": False,
        "inputs": {
            "values": "values",
            "masks": "masks",
            "patch_is_target": "patch_is_target",
            "patch_cpm_mask": "patch_cpm_mask",
        },
        "outputs": {"logits": "logits"},
        "licenseNotice": "TimesFM Non-Commercial License v1.0 applies to the checkpoint and converted artifacts.",
    }
    manifest_path = args.output_dir / "timesfm3-forward.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {graph_path}")
    print(f"Wrote {manifest_path}")
    if not locations:
        print("Warning: exporter did not emit external data. Browser loading can still use the graph directly.")


if __name__ == "__main__":
    main()
