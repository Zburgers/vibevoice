#!/usr/bin/env python3
"""Optional Moonshine Voice streaming benchmark; install moonshine-voice separately."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import struct
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


def read_audio(path: Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getcomptype() != "NONE":
            raise ValueError(f"Expected mono 16-bit PCM WAV: {path}")
        rate = audio.getframerate()
        payload = audio.readframes(audio.getnframes())
    samples = struct.unpack(f"<{len(payload) // 2}h", payload)
    return [sample / 32768.0 for sample in samples], rate


def model_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
    return digest.hexdigest()


def peak_memory_mb() -> float | None:
    if resource is None:
        return None
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value / 1024 if platform.system() == "Linux" else value / (1024 * 1024)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path, help="Downloaded Moonshine model root")
    parser.add_argument("--model-arch", default="MEDIUM_STREAMING")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--chunk-ms", type=int, default=500)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 20 or not 100 <= args.chunk_ms <= 2000:
        parser.error("repeats must be 1..20 and chunk-ms must be 100..2000")

    from moonshine_voice import ModelArch, Transcriber

    model_arch = ModelArch[args.model_arch]
    started = time.perf_counter()
    transcriber = Transcriber(args.model, model_arch=model_arch, update_interval=args.chunk_ms / 1000)
    load_ms = (time.perf_counter() - started) * 1000
    model_peak_memory_mb = peak_memory_mb()
    manifest_path = args.manifest.resolve()
    samples = json.loads(manifest_path.read_text(encoding="utf-8"))["samples"]
    runs: list[dict[str, Any]] = []
    try:
        for repeat in range(1, args.repeats + 1):
            for sample in samples:
                audio_path = Path(sample["audio_path"])
                if not audio_path.is_absolute():
                    audio_path = manifest_path.parent / audio_path
                samples_f32, rate = read_audio(audio_path)
                stream = transcriber.create_stream(update_interval=args.chunk_ms / 1000)
                first_partial_ms: float | None = None
                started = time.perf_counter()
                cpu_started = time.process_time()

                def on_event(event: Any) -> None:
                    nonlocal first_partial_ms
                    if first_partial_ms is None and event.line.text.strip():
                        first_partial_ms = (time.perf_counter() - started) * 1000

                stream.add_listener(on_event)
                try:
                    stream.start()
                    chunk_samples = max(1, rate * args.chunk_ms // 1000)
                    for offset in range(0, len(samples_f32), chunk_samples):
                        stream.add_audio(samples_f32[offset : offset + chunk_samples], rate)
                    result = stream.stop()
                finally:
                    stream.close()
                wall_ms = (time.perf_counter() - started) * 1000
                cpu_ms = (time.process_time() - cpu_started) * 1000
                memory_mb = peak_memory_mb()
                hypothesis = " ".join(line.text for line in result.lines).strip()
                errors, reference_words = word_errors(sample.get("reference", ""), hypothesis)
                audio_ms = round(float(sample["duration_seconds"]) * 1000)
                runs.append({
                    "sample_id": sample["id"], "category": sample.get("category", "unspecified"),
                    "duration_bucket_s": sample.get("duration_bucket_s"), "audio_ms": audio_ms,
                    "wall_ms": round(wall_ms, 2), "cpu_ms": round(cpu_ms, 2),
                    "average_cpu_percent": round(100 * cpu_ms / wall_ms / (os.cpu_count() or 1), 2) if wall_ms else None,
                    "peak_memory_mb": round(memory_mb, 2) if memory_mb is not None else None,
                    "rtf": round(wall_ms / audio_ms, 4) if audio_ms else None,
                    "first_partial_ms": round(first_partial_ms, 2) if first_partial_ms is not None else None,
                    "word_errors": errors, "reference_words": reference_words,
                    "silence_false_positive_words": len(hypothesis.split()) if not reference_words else 0,
                    "repeat": repeat,
                })
                print(json.dumps(runs[-1], ensure_ascii=False), flush=True)
    finally:
        transcriber.close()

    by_category: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        by_category.setdefault(run["category"], []).append(run)
    process_peak_memory_mb = peak_memory_mb()
    output = {
        "schema_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
        "hardware": {"os": platform.platform(), "machine": platform.machine(), "cpu_count": os.cpu_count()},
        "engine": {"name": "Moonshine Voice Python C-API wrapper", "model_arch": args.model_arch,
                   "model_sha256": model_sha256(args.model.resolve()), "lifecycle": "one resident model per benchmark process"},
        "model_load_ms": round(load_ms, 2), "peak_memory_mb": round(process_peak_memory_mb, 2) if process_peak_memory_mb is not None else None,
        "model_peak_memory_mb": round(model_peak_memory_mb, 2) if model_peak_memory_mb is not None else None,
        "chunk_ms": args.chunk_ms, "repeats": args.repeats,
        "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(), "runs": runs,
        "summary": {"all": summarize(runs), "by_category": {key: summarize(value) for key, value in by_category.items()},
                    "first_partial_ms_p50": round(statistics.median(values), 2) if (values := [run["first_partial_ms"] for run in runs if run["first_partial_ms"] is not None]) else None},
        "limitations": ["Python wrapper benchmark only; it does not qualify a Rust desktop distribution.",
                        "Audio is fed as fast as inference permits without real-time pacing.",
                        "Peak memory includes the resident model and is measured for the whole benchmark process.",
                        "Timing excludes application capture, text cleanup, UI, and insertion."],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
