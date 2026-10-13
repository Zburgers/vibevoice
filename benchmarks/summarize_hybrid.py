#!/usr/bin/env python3
"""Combine aligned base and tiny.en runs using the app's duration rule."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from asr_benchmark import summarize


def combine(base: dict[str, Any], fast: dict[str, Any], max_audio_ms: int = 5_500) -> dict[str, Any]:
    if base["manifest_sha256"] != fast["manifest_sha256"]:
        raise ValueError("candidate results must use the same manifest")
    base_runs = {(run["sample_id"], run["repeat"]): run for run in base["runs"]}
    fast_runs = {(run["sample_id"], run["repeat"]): run for run in fast["runs"]}
    if base_runs.keys() != fast_runs.keys():
        raise ValueError("candidate results must contain matching sample and repeat IDs")

    selected: list[dict[str, Any]] = []
    for key, base_run in base_runs.items():
        fast_run = fast_runs[key]
        if base_run["audio_ms"] != fast_run["audio_ms"]:
            raise ValueError(f"audio duration differs for {key}")
        use_fast = base_run["audio_ms"] <= max_audio_ms
        run = dict(fast_run if use_fast else base_run)
        run["model_variant"] = "tiny.en" if use_fast else "base.en"
        selected.append(run)

    by_duration: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in selected:
        by_duration[str(run.get("duration_bucket_s") or "other")].append(run)
        by_category[run["category"]].append(run)
    return {
        "schema_version": 1,
        "hardware": base["hardware"],
        "selection": {"max_audio_ms": max_audio_ms, "short_model": "tiny.en", "fallback_model": "base.en"},
        "manifest_sha256": base["manifest_sha256"],
        "base_engine_sha256": base["engine"]["sha256"],
        "base_model_sha256": base["model"]["sha256"],
        "fast_model_sha256": fast["model"]["sha256"],
        "runs": selected,
        "summary": {
            "all": summarize(selected),
            "short_model_only": summarize([run for run in selected if run["model_variant"] == "tiny.en"]),
            "short_speech": summarize([
                run for run in selected
                if run["model_variant"] == "tiny.en" and run["reference_words"] > 0
            ]),
            "by_duration_bucket_s": {key: summarize(value) for key, value in sorted(by_duration.items())},
            "by_category": {key: summarize(value) for key, value in sorted(by_category.items())},
        },
        "limitations": [
            "This combines independent CLI runs; it is an offline selection simulation, not a live app measurement.",
            "The 5.5 second routing threshold was chosen from this finite sample and is not accuracy-qualified for every speaker or acoustic condition.",
            "No capture, text cleanup, UI, or insertion time is included.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--fast", required=True, type=Path)
    parser.add_argument("--max-audio-ms", type=int, default=5_500)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.max_audio_ms < 1:
        parser.error("max-audio-ms must be positive")
    result = combine(json.loads(args.base.read_text()), json.loads(args.fast.read_text()), args.max_audio_ms)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
