#!/usr/bin/env python3
"""Optional sherpa-onnx online Zipformer benchmark; install its wheel separately."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import time
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from asr_benchmark import summarize, word_errors

try:
    import resource
except ImportError:  # Windows
    resource = None


def peak_memory_mb() -> float | None:
    if resource is None:
        return None
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value / 1024 if platform.system() == "Linux" else value / (1024 * 1024)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path, help="Extracted English streaming Zipformer model directory")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--chunk-ms", type=int, default=500)
    parser.add_argument("--float", action="store_true", help="Use float ONNX files instead of int8 variants")
    args = parser.parse_args()
    if not 1 <= args.repeats <= 20 or not 1 <= args.threads <= 16 or not 100 <= args.chunk_ms <= 2000:
        parser.error("repeats must be 1..20, threads 1..16, and chunk-ms 100..2000")

    import numpy as np
    import sherpa_onnx

    root = args.model.resolve()
    suffix = "" if args.float else ".int8"
    stem = "epoch-99-avg-1"
    manifest_path = args.manifest.resolve()
    samples = json.loads(manifest_path.read_text(encoding="utf-8"))["samples"]
    start = time.perf_counter()
    recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(root / "tokens.txt"), encoder=str(root / f"encoder-{stem}{suffix}.onnx"),
        decoder=str(root / f"decoder-{stem}{suffix}.onnx"), joiner=str(root / f"joiner-{stem}{suffix}.onnx"),
        num_threads=args.threads, enable_endpoint_detection=True, decoding_method="greedy_search", provider="cpu",
    )
    model_load_ms = (time.perf_counter() - start) * 1000
    model_peak_memory_mb = peak_memory_mb()
    model_hash = hashlib.sha256()
    for path in sorted(item for item in root.iterdir() if item.is_file()):
        model_hash.update(path.name.encode())
        with path.open("rb") as file:
            for block in iter(lambda: file.read(1024 * 1024), b""):
                model_hash.update(block)

    runs: list[dict[str, Any]] = []
    for repeat in range(1, args.repeats + 1):
        for sample in samples:
            audio_path = Path(sample["audio_path"])
            if not audio_path.is_absolute():
                audio_path = manifest_path.parent / audio_path
            with wave.open(str(audio_path), "rb") as source:
                if source.getnchannels() != 1 or source.getframerate() != 16000 or source.getsampwidth() != 2:
                    raise ValueError(f"Expected mono 16kHz PCM16: {audio_path}")
                audio = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
            stream = recognizer.create_stream()
            started = time.perf_counter()
            cpu_started = time.process_time()
            first_partial_ms: float | None = None
            chunk_samples = 16000 * args.chunk_ms // 1000
            for offset in range(0, len(audio), chunk_samples):
                stream.accept_waveform(16000, audio[offset : offset + chunk_samples])
                while recognizer.is_ready(stream):
                    recognizer.decode_stream(stream)
                    if first_partial_ms is None and recognizer.get_result(stream).strip():
                        first_partial_ms = (time.perf_counter() - started) * 1000
            stream.input_finished()
            while recognizer.is_ready(stream):
                recognizer.decode_stream(stream)
            wall_ms = (time.perf_counter() - started) * 1000
            cpu_ms = (time.process_time() - cpu_started) * 1000
            current_peak_memory_mb = peak_memory_mb()
            hypothesis = recognizer.get_result(stream).strip()
            errors, reference_words = word_errors(sample.get("reference", ""), hypothesis)
            audio_ms = round(float(sample["duration_seconds"]) * 1000)
            run = {
                "sample_id": sample["id"], "category": sample.get("category", "unspecified"),
                "duration_bucket_s": sample.get("duration_bucket_s"), "audio_ms": audio_ms,
                "wall_ms": round(wall_ms, 2), "cpu_ms": round(cpu_ms, 2),
                "average_cpu_percent": round(100 * cpu_ms / wall_ms / (os.cpu_count() or 1), 2) if wall_ms else None,
                "peak_memory_mb": round(current_peak_memory_mb, 2) if current_peak_memory_mb is not None else None,
                "rtf": round(wall_ms / audio_ms, 4) if audio_ms else None,
                "first_partial_ms": round(first_partial_ms, 2) if first_partial_ms is not None else None,
                "word_errors": errors, "reference_words": reference_words,
                "silence_false_positive_words": len(hypothesis.split()) if not reference_words else 0,
                "repeat": repeat,
            }
            runs.append(run)
            print(json.dumps(run), flush=True)
            del stream, audio

    grouped: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        grouped.setdefault(run["category"], []).append(run)
    process_peak_memory_mb = peak_memory_mb()
    output = {
        "schema_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
        "hardware": {"os": platform.platform(), "machine": platform.machine(), "cpu_count": os.cpu_count()},
        "engine": {"name": f"sherpa-onnx {sherpa_onnx.__version__} streaming Zipformer",
                   "model_sha256": model_hash.hexdigest(), "threads": args.threads,
                   "model_format": "float" if args.float else "int8"},
        "model_load_ms": round(model_load_ms, 2), "model_peak_memory_mb": round(model_peak_memory_mb, 2) if model_peak_memory_mb is not None else None,
        "peak_memory_mb": round(process_peak_memory_mb, 2) if process_peak_memory_mb is not None else None,
        "chunk_ms": args.chunk_ms, "repeats": args.repeats,
        "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(), "runs": runs,
        "summary": {"all": summarize(runs), "by_category": {key: summarize(value) for key, value in grouped.items()},
                    "first_partial_ms_p50": round(statistics.median(values), 2) if (values := [run["first_partial_ms"] for run in runs if run["first_partial_ms"] is not None]) else None},
        "limitations": ["Model is an English 20M parameter Apache-2.0 LibriSpeech model, not developer-vocabulary tuned.",
                        "Audio is streamed into the recognizer as fast as it can decode; no real-time pacing is used.",
                        "Python wrapper benchmark only; it does not qualify Rust desktop packaging.",
                        "Timing excludes application capture, cleanup, UI, and insertion."],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
