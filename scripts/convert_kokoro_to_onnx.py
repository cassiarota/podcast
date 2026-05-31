#!/usr/bin/env python3.12
"""Convert Kokoro-82M (PyTorch float weights) to a mobile-friendly ONNX model.

Run this on a desktop machine that has:
  - `pip install kokoro torch onnx onnxruntime`
  - `models/Kokoro-82M/kokoro-v1_0.pth` already pulled from Git LFS

Outputs:
  - `android/app/src/main/assets/kokoro/kokoro_int8.ort`
  - `android/app/src/main/assets/kokoro/voices/<voice>.bin` for each voice

After running this script, `gradle :app:bundleRelease` will produce an AAB
containing the quantized ONNX model and voice tables, ready for Phase 2 use.

NOTE: This is a SCAFFOLD. The exact export depends on the Kokoro version's
internal module names — adjust the `MODEL_INPUT_NAMES` block below to match
your installed `kokoro` package.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

MODEL_INPUT_NAMES = ("tokens", "voice", "speed")
MODEL_OUTPUT_NAMES = ("audio",)
DEFAULT_VOICES = ("af_heart", "af_sky", "af_bella", "am_adam")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        type=Path,
        default=Path("models/Kokoro-82M/kokoro-v1_0.pth"),
        help="Path to the Kokoro float .pth weights (already LFS-pulled).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("android/app/src/main/assets/kokoro"),
        help="Output directory inside the Android assets tree.",
    )
    parser.add_argument("--voices", nargs="*", default=list(DEFAULT_VOICES))
    parser.add_argument(
        "--no-quantize",
        action="store_true",
        help="Skip int8 quantization (debug only).",
    )
    args = parser.parse_args()

    if not args.model.exists():
        print(f"error: model not found at {args.model}", file=sys.stderr)
        print("hint: run `git lfs pull` first.", file=sys.stderr)
        return 1
    if args.model.stat().st_size < 1024:
        print(
            f"error: {args.model} looks like an LFS pointer ({args.model.stat().st_size} bytes).",
            file=sys.stderr,
        )
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "voices").mkdir(parents=True, exist_ok=True)

    try:
        import torch
        from kokoro import KModel
    except ImportError as exc:
        print(f"error: missing Python deps ({exc}).", file=sys.stderr)
        print("hint: pip install torch onnx onnxruntime kokoro", file=sys.stderr)
        return 1

    print(f"[convert] loading {args.model}")
    model = KModel(args.model)
    model.eval()

    # Build a dummy input that matches the contract documented in
    # android/app/src/main/java/com/podcast/reader/tts/KokoroOnnxEngine.kt.
    dummy_tokens = torch.zeros(64, dtype=torch.long)
    dummy_voice = torch.zeros(256, dtype=torch.float32)
    dummy_speed = torch.ones(1, dtype=torch.float32)

    onnx_path = args.out / "kokoro_fp32.onnx"
    print(f"[convert] exporting ONNX → {onnx_path}")
    torch.onnx.export(
        model,
        (dummy_tokens, dummy_voice, dummy_speed),
        str(onnx_path),
        input_names=list(MODEL_INPUT_NAMES),
        output_names=list(MODEL_OUTPUT_NAMES),
        dynamic_axes={
            "tokens": {0: "seq_len"},
            "audio": {0: "n_samples"},
        },
        opset_version=17,
    )

    final_path = args.out / "kokoro_int8.ort"
    if args.no_quantize:
        print(f"[convert] skipping quantization, copying fp32 → {final_path}")
        final_path.write_bytes(onnx_path.read_bytes())
    else:
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType
        except ImportError:
            print("error: onnxruntime quantization not available; reinstall onnxruntime.", file=sys.stderr)
            return 1
        print(f"[convert] quantizing to int8 → {final_path}")
        quantize_dynamic(str(onnx_path), str(final_path), weight_type=QuantType.QInt8)
        os.remove(onnx_path)

    # Voice embeddings — Kokoro stores these as a dict on the model.
    voices_dir = args.out / "voices"
    print(f"[convert] exporting voices → {voices_dir}")
    voice_table = getattr(model, "voices", None)
    if voice_table is None:
        print("warn: model has no voice table; voices/ will be empty.", file=sys.stderr)
    else:
        for voice_id in args.voices:
            vec = voice_table.get(voice_id)
            if vec is None:
                print(f"warn: voice {voice_id!r} not found; skipping.", file=sys.stderr)
                continue
            arr = vec.detach().cpu().numpy().astype("float32")
            (voices_dir / f"{voice_id}.bin").write_bytes(arr.tobytes())

    size_kb = final_path.stat().st_size / 1024
    print(f"[convert] done. final model: {final_path} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
