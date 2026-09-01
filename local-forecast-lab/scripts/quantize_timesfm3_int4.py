#!/usr/bin/env python3
"""Apply ONNX Runtime weight-only INT4 quantization to a TimesFM graph.

Quantization is an experiment, not an assumed win. Run numerical parity and
forecast backtests after conversion. WebGPU operator coverage for MatMulNBits
must also be checked on the target ONNX Runtime Web release.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from onnxruntime.quantization import matmul_nbits_quantizer, quant_utils


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--block-size", type=int, default=128)
    args = parser.parse_args()

    config = matmul_nbits_quantizer.DefaultWeightOnlyQuantConfig(
        block_size=args.block_size,
        is_symmetric=True,
        accuracy_level=4,
        quant_format=quant_utils.QuantFormat.QOperator,
        op_types_to_quantize=("MatMul", "Gather"),
        quant_axes=(("MatMul", 0), ("Gather", 1)),
    )
    model = quant_utils.load_model_with_shape_infer(args.input)
    quantizer = matmul_nbits_quantizer.MatMulNBitsQuantizer(
        model,
        bits=4,
        nodes_to_exclude=None,
        nodes_to_include=None,
        algo_config=config,
    )
    quantizer.process()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    quantizer.model.save_model_to_file(args.output, True)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
