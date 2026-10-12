#!/usr/bin/env python3
"""Repeatable CPU ASR benchmark for a whisper.cpp-compatible local CLI."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import resource
except ImportError:  # Windows
    resource = None


def words(text: str) -> list[str]:
    return re.findall(r"[^\W_]+(?:['’][^\W_]+)?", text.casefold(), flags=re.UNICODE)


def word_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    left, right = words(reference), words(hypothesis)
    row = list(range(len(right) + 1))
    for i, source in enumerate(left, 1):
        previous, row[0] = row[0], i
        for j, target in enumerate(right, 1):
            old = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, previous + (source != target))
            previous = old
    return row[-1], len(left)


def parse_cli_timings(stderr: str) -> dict[str, float]:
    timing_line = re.compile(r"whisper_print_timings:\s+(.+?)\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*ms\b")
    return {
        match.group(1).strip().replace(" ", "_"): float(match.group(2))
        for match in timing_line.finditer(stderr)
    }


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def summarize(runs: list[dict[str, Any]]) -> dict[str, Any]:
    if not runs:
        return {"sample_count": 0}
    wall = [run["wall_ms"] for run in runs]
    rtf = [run["rtf"] for run in runs]
    cpu = [run["cpu_ms"] for run in runs if run["cpu_ms"] is not None]
    memory = [run["peak_memory_mb"] for run in runs if run["peak_memory_mb"] is not None]
    timing_names = {name for run in runs for name in run.get("timings_ms", {})}
    # Silence false positives are tracked separately; WER is undefined when the
    # reference has no words, so empty-reference samples do not enter its numerator.
    errors = sum(run["word_errors"] for run in runs if run["reference_words"] > 0)
    reference_words = sum(run["reference_words"] for run in runs)
    silence_false_positives = sum(run["silence_false_positive_words"] for run in runs)
    return {
        "sample_count": len(runs),
        "wall_ms_p50": round(statistics.median(wall), 2),
        "wall_ms_p95": round(percentile(wall, 0.95) or 0, 2),
        "wall_ms_spread": round(max(wall) - min(wall), 2),
        "rtf_p50": round(statistics.median(rtf), 4),
        "rtf_p95": round(percentile(rtf, 0.95) or 0, 4),
        "cpu_ms_p50": round(statistics.median(cpu), 2) if cpu else None,
        "average_cpu_percent_p50": round(statistics.median([run["average_cpu_percent"] for run in runs if run["average_cpu_percent"] is not None]), 2) if any(run["average_cpu_percent"] is not None for run in runs) else None,
        "peak_memory_mb_p50": round(statistics.median(memory), 2) if memory else None,
        "wer": round(errors / reference_words, 4) if reference_words else None,
        "silence_false_positive_words": silence_false_positives,
        "timings_ms_p50": {
            name: round(statistics.median(values), 2)
            for name in sorted(timing_names)
            if (values := [run["timings_ms"][name] for run in runs if name in run.get("timings_ms", {})])
        },
        "timings_ms_p95": {
            name: round(percentile(values, 0.95) or 0, 2)
            for name in sorted(timing_names)
            if (values := [run["timings_ms"][name] for run in runs if name in run.get("timings_ms", {})])
        },
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()



class WindowsProcessMetrics:
    def __init__(self, pid: int):
        import ctypes
        from ctypes import wintypes

        class FILETIME(ctypes.Structure):
            _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]

        class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                        ("PrivateUsage", ctypes.c_size_t)]

        self.ctypes = ctypes
        self.filetime_type = FILETIME
        self.counters_type = PROCESS_MEMORY_COUNTERS_EX
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.psapi = ctypes.WinDLL("psapi", use_last_error=True)
        self.kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel32.OpenProcess.restype = ctypes.c_void_p
        self.kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        self.kernel32.CloseHandle.restype = wintypes.BOOL
        self.handle = self.kernel32.OpenProcess(0x0400 | 0x0010, False, pid)
        if not self.handle:
            raise OSError(ctypes.get_last_error(), "OpenProcess failed")
        self.psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD]
        self.kernel32.GetProcessTimes.argtypes = [ctypes.c_void_p, ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME)]
        self.peak_memory_mb = 0.0
        self.cpu_ms = None

    def sample(self) -> None:
        counters = self.counters_type()
        counters.cb = self.ctypes.sizeof(counters)
        if self.psapi.GetProcessMemoryInfo(self.handle, self.ctypes.byref(counters), counters.cb):
            self.peak_memory_mb = max(self.peak_memory_mb, counters.PeakWorkingSetSize / 1_048_576)
        creation, exit_time, kernel, user = (self.filetime_type() for _ in range(4))
        if self.kernel32.GetProcessTimes(self.handle, self.ctypes.byref(creation), self.ctypes.byref(exit_time),
                                         self.ctypes.byref(kernel), self.ctypes.byref(user)):
            ticks = lambda value: (value.high << 32) | value.low
            self.cpu_ms = (ticks(kernel) + ticks(user)) / 10_000

    def close(self) -> None:
        self.kernel32.CloseHandle(self.handle)


def linux_memory_mb(pid: int) -> float | None:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) / 1024
    except (FileNotFoundError, PermissionError, ValueError):
        return None
    return None


def run_cli(engine: Path, model: Path, sample: dict[str, Any], threads: int, timeout: int) -> dict[str, Any]:
    audio = Path(sample["audio_path"]).resolve()
    if not audio.is_file():
        raise FileNotFoundError(audio)
    with tempfile.TemporaryDirectory(prefix="vibevoice-asr-") as temp:
        prefix = Path(temp) / "transcript"
        command = [str(engine), "-t", str(threads), "-m", str(model), "-f", str(audio),
                   "-otxt", "-nt", "-of", str(prefix)]
        env = os.environ.copy()
        env["OMP_WAIT_POLICY"] = "PASSIVE"
        cpu_before = resource.getrusage(resource.RUSAGE_CHILDREN) if resource else None
        started = time.perf_counter()
        with tempfile.TemporaryFile() as stderr:
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=stderr, env=env)
            peak_memory = 0.0
            windows_metrics = WindowsProcessMetrics(process.pid) if os.name == "nt" else None
            try:
                deadline = started + timeout
                while process.poll() is None:
                    if sys.platform.startswith("linux"):
                        peak_memory = max(peak_memory, linux_memory_mb(process.pid) or 0.0)
                    if windows_metrics:
                        windows_metrics.sample()
                    if time.perf_counter() >= deadline:
                        process.kill()
                        process.wait()
                        raise TimeoutError(f"ASR exceeded {timeout}s for {sample['id']}")
                    time.sleep(0.01)
                return_code = process.wait()
                if windows_metrics:
                    windows_metrics.sample()
                    peak_memory = windows_metrics.peak_memory_mb
                wall_ms = (time.perf_counter() - started) * 1000
                stderr.seek(0)
                timings_ms = parse_cli_timings(stderr.read().decode("utf-8", "replace"))
                if return_code:
                    raise RuntimeError(f"ASR exited with status {return_code} for {sample['id']}")
                hypothesis = prefix.with_suffix(".txt").read_text(encoding="utf-8").strip()
                cpu_after = resource.getrusage(resource.RUSAGE_CHILDREN) if resource else None
                cpu_ms = None
                if cpu_before and cpu_after:
                    cpu_ms = 1000 * ((cpu_after.ru_utime + cpu_after.ru_stime) - (cpu_before.ru_utime + cpu_before.ru_stime))
                elif windows_metrics:
                    cpu_ms = windows_metrics.cpu_ms
            finally:
                if windows_metrics:
                    windows_metrics.close()
        errors, reference_words = word_errors(sample.get("reference", ""), hypothesis)
        audio_ms = round(float(sample["duration_seconds"]) * 1000)
        return {
            "sample_id": sample["id"],
            "category": sample.get("category", "unspecified"),
            "duration_bucket_s": sample.get("duration_bucket_s"),
            "audio_ms": audio_ms,
            "wall_ms": round(wall_ms, 2),
            "cpu_ms": round(cpu_ms, 2) if cpu_ms is not None else None,
            "average_cpu_percent": round(100 * cpu_ms / wall_ms / (os.cpu_count() or 1), 2) if cpu_ms is not None and wall_ms else None,
            "peak_memory_mb": round(peak_memory, 2) if peak_memory else None,
            "rtf": round(wall_ms / audio_ms, 4) if audio_ms else None,
            "word_errors": errors,
            "reference_words": reference_words,
            "silence_false_positive_words": len(words(hypothesis)) if not reference_words else 0,
            "timings_ms": timings_ms,
        }


def hardware() -> dict[str, Any]:
    cpu_model = platform.processor() or None
    if sys.platform.startswith("linux"):
        try:
            for line in Path("/proc/cpuinfo").read_text().splitlines():
                if line.startswith("model name"):
                    cpu_model = line.split(":", 1)[1].strip()
                    break
        except OSError:
            pass
    memory_total_mb = None
    if sys.platform.startswith("linux"):
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal:"):
                    memory_total_mb = round(int(line.split()[1]) / 1024)
                    break
        except (OSError, ValueError):
            pass
    return {
        "os": platform.platform(), "machine": platform.machine(), "cpu": cpu_model,
        "logical_cpus": os.cpu_count(), "ram_total_mb": memory_total_mb,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path, help="JSON object with a samples array")
    parser.add_argument("--engine", required=True, type=Path, help="whisper-cli executable")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 20 or not 1 <= args.threads <= 16:
        parser.error("repeats must be 1..20 and threads must be 1..16")
    engine, model = args.engine.resolve(), args.model.resolve()
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    samples = manifest["samples"]
    for sample in samples:
        audio_path = Path(sample["audio_path"])
        if not audio_path.is_absolute():
            sample["audio_path"] = str((manifest_path.parent / audio_path).resolve())
    if not engine.is_file() or not model.is_file() or not samples:
        parser.error("engine, model, and at least one valid manifest sample are required")

    runs: list[dict[str, Any]] = []
    first_by_sample: list[dict[str, Any]] = []
    later_by_sample: list[dict[str, Any]] = []
    for repeat in range(1, args.repeats + 1):
        for sample in samples:
            run = run_cli(engine, model, sample, args.threads, args.timeout)
            run["repeat"] = repeat
            run["warmth"] = "first" if repeat == 1 else "subsequent"
            runs.append(run)
            (first_by_sample if repeat == 1 else later_by_sample).append(run)
            print(json.dumps(run, ensure_ascii=False), flush=True)

    grouped: dict[str, list[dict[str, Any]]] = {}
    by_category: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        grouped.setdefault(str(run["duration_bucket_s"] or "all"), []).append(run)
        by_category.setdefault(run["category"], []).append(run)
    output = {
        "schema_version": 1,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "hardware": hardware(),
        "engine": {"path": str(engine), "sha256": sha256(engine), "lifecycle": "one process per request"},
        "model": {"path": str(model), "sha256": sha256(model), "bytes": model.stat().st_size},
        "threads": args.threads,
        "repeats": args.repeats,
        "manifest_sha256": sha256(manifest_path),
        "runs": runs,
        "summary": {
            "all": summarize(runs),
            "first_repeat": summarize(first_by_sample),
            "subsequent_repeats": summarize(later_by_sample),
            "by_duration_bucket_s": {key: summarize(value) for key, value in grouped.items()},
            "by_category": {key: summarize(value) for key, value in by_category.items()},
        },
        "limitations": ["CPU and memory cover the CLI process, not the app or OS-wide usage.",
                        "Timing excludes microphone capture, UI, cleanup, and insertion.",
                        "Stage timings are reported by whisper-cli and are not full application trace spans.",
                        "No cache eviction is used; first_repeat measures initial order, not guaranteed cold storage."]
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
