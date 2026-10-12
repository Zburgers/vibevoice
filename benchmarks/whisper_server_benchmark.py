#!/usr/bin/env python3
"""Benchmark the experimental persistent whisper.cpp HTTP server on loopback (Linux)."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import platform
import socket
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from asr_benchmark import hardware, sha256, summarize, word_errors


def process_stats(pid: int) -> tuple[float, float]:
    fields = Path(f"/proc/{pid}/stat").read_text().split()
    cpu_ms = 1000 * (int(fields[13]) + int(fields[14])) / os.sysconf("SC_CLK_TCK")
    peak_memory_mb = 0.0
    for line in Path(f"/proc/{pid}/status").read_text().splitlines():
        if line.startswith("VmHWM:"):
            peak_memory_mb = int(line.split()[1]) / 1024
            break
    return cpu_ms, peak_memory_mb


def transcript_from_response(response: str) -> str:
    try:
        transcript = json.loads(response)["text"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise RuntimeError("whisper-server returned an unexpected JSON response") from error
    if not isinstance(transcript, str):
        raise RuntimeError("whisper-server JSON response did not contain transcript text")
    return transcript


def post_audio(port: int, data: bytes) -> str:
    boundary = "----vibevoice-asr-benchmark"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n"
            "Content-Type: audio/wav\r\n\r\n").encode() + data
    body += (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson"
             f"\r\n--{boundary}--\r\n").encode()
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=900)
    try:
        connection.request("POST", "/inference", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
        response = connection.getresponse()
        result = response.read().decode("utf-8").strip()
        if response.status != 200:
            raise RuntimeError(f"whisper-server returned HTTP {response.status}: {result[:300]}")
        return transcript_from_response(result)
    finally:
        connection.close()


def main() -> int:
    if not Path("/proc/self/stat").exists():
        raise SystemExit("This experimental server benchmark currently supports Linux only.")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 20 or not 1 <= args.threads <= 16:
        parser.error("repeats must be 1..20 and threads must be 1..16")
    manifest_path = args.manifest.resolve()
    samples = json.loads(manifest_path.read_text(encoding="utf-8"))["samples"]
    with socket.socket() as socket_handle:
        socket_handle.bind(("127.0.0.1", 0))
        port = socket_handle.getsockname()[1]
    command = [str(args.server.resolve()), "--host", "127.0.0.1", "--port", str(port),
               "-t", str(args.threads), "-m", str(args.model.resolve()), "-ng"]
    with tempfile.TemporaryFile() as logs:
        started = time.perf_counter()
        server = subprocess.Popen(command, stdout=logs, stderr=logs)
        try:
            deadline = started + 60
            while time.perf_counter() < deadline:
                if server.poll() is not None:
                    logs.seek(0)
                    raise RuntimeError(logs.read().decode("utf-8", "replace")[-3000:])
                try:
                    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
                    connection.request("GET", "/")
                    response = connection.getresponse()
                    response.read()
                    connection.close()
                    if response.status == 200:
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise TimeoutError("whisper-server did not become ready in 60 seconds")
            ready_ms = (time.perf_counter() - started) * 1000
            runs: list[dict[str, Any]] = []
            for repeat in range(1, args.repeats + 1):
                for sample in samples:
                    audio_path = Path(sample["audio_path"])
                    if not audio_path.is_absolute():
                        audio_path = manifest_path.parent / audio_path
                    before_cpu, _ = process_stats(server.pid)
                    started = time.perf_counter()
                    hypothesis = post_audio(port, audio_path.read_bytes())
                    wall_ms = (time.perf_counter() - started) * 1000
                    after_cpu, peak_memory_mb = process_stats(server.pid)
                    cpu_ms = max(0, after_cpu - before_cpu)
                    errors, reference_words = word_errors(sample.get("reference", ""), hypothesis)
                    audio_ms = round(float(sample["duration_seconds"]) * 1000)
                    run = {"sample_id": sample["id"], "category": sample.get("category", "unspecified"),
                           "duration_bucket_s": sample.get("duration_bucket_s"), "audio_ms": audio_ms,
                           "wall_ms": round(wall_ms, 2), "cpu_ms": round(cpu_ms, 2),
                           "average_cpu_percent": round(100 * cpu_ms / wall_ms / (os.cpu_count() or 1), 2) if wall_ms else None,
                           "peak_memory_mb": round(peak_memory_mb, 2), "rtf": round(wall_ms / audio_ms, 4) if audio_ms else None,
                           "word_errors": errors, "reference_words": reference_words,
                           "silence_false_positive_words": len(hypothesis.split()) if not reference_words else 0,
                           "repeat": repeat}
                    runs.append(run)
                    print(json.dumps(run, ensure_ascii=False), flush=True)
            grouped: dict[str, list[dict[str, Any]]] = {}
            for run in runs:
                grouped.setdefault(run["category"], []).append(run)
            result = {"schema_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
                      "hardware": hardware(), "engine": {"path": str(args.server.resolve()),
                          "sha256": sha256(args.server.resolve()), "lifecycle": "persistent server process"},
                      "model": {"path": str(args.model.resolve()), "sha256": sha256(args.model.resolve()),
                                "bytes": args.model.stat().st_size},
                      "server_ready_ms": round(ready_ms, 2), "threads": args.threads, "repeats": args.repeats,
                      "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(), "runs": runs,
                      "summary": {"all": summarize(runs), "by_category": {key: summarize(value) for key, value in grouped.items()}},
                      "limitations": ["Research runner calls whisper.cpp's HTTP server on loopback with local audio only.",
                                      "Timing excludes microphone capture, UI, cleanup, and insertion.",
                                      "Server and model binaries may not match packaged artifacts on other platforms."]}
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
