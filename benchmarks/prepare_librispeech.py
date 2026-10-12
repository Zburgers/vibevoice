#!/usr/bin/env python3
"""Build a small fixed-duration corpus from an extracted LibriSpeech test set."""
from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import wave
from pathlib import Path
from typing import Any

SAMPLE_RATE = 16_000
GAP_MS = 250
TARGETS = (2, 5, 10, 20, 30)


def duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def text_for(chapter: Path) -> dict[str, str]:
    transcript = next(chapter.glob("*.trans.txt"))
    return {line.split(" ", 1)[0]: line.split(" ", 1)[1]
            for line in transcript.read_text(encoding="utf-8").splitlines() if " " in line}


def closest_group(chapter: Path, target: int) -> tuple[list[Path], list[str], float]:
    transcripts = text_for(chapter)
    utterances = [(chapter / f"{utterance_id}.flac", text)
                  for utterance_id, text in sorted(transcripts.items())]
    utterances = [(path, text) for path, text in utterances if path.is_file()]
    measured = [(path, text, duration(path)) for path, text in utterances]
    best: tuple[float, list[Path], list[str], float] | None = None
    for start in range(len(measured)):
        selected: list[tuple[Path, str, float]] = []
        total = 0.0
        for path, text, seconds in measured[start:]:
            selected.append((path, text, seconds))
            total += seconds + (GAP_MS / 1000 if len(selected) > 1 else 0)
            delta = abs(total - target)
            if best is None or delta < best[0]:
                best = (delta, [item[0] for item in selected], [item[1] for item in selected], total)
            if total >= target + 1.5:
                break
    if best is None:
        raise ValueError(f"No audio clips in {chapter}")
    return best[1], best[2], best[3]


def decode(path: Path) -> bytes:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-acodec", "pcm_s16le",
         "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        check=True, capture_output=True,
    )
    return result.stdout


def write_group(paths: list[Path], destination: Path) -> float:
    gap = bytes(SAMPLE_RATE * (GAP_MS // 1000) * 2 + SAMPLE_RATE * (GAP_MS % 1000) * 2 // 1000)
    destination.parent.mkdir(parents=True, exist_ok=True)
    frames = 0
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        for index, path in enumerate(paths):
            if index:
                output.writeframesraw(gap)
                frames += len(gap) // 2
            pcm = decode(path)
            output.writeframesraw(pcm)
            frames += len(pcm) // 2
    return frames / SAMPLE_RATE


def add_synthetic_samples(output_dir: Path, samples: list[dict[str, Any]]) -> None:
    espeak = shutil.which("espeak-ng")
    if espeak:
        phrase = ("Um, I think TypeScript useEffect should call FastAPI before PostgreSQL changes. "
                  "Then git rebase, Convex, and Tauri can update app slash src tauri slash src slash lib dot r s.")
        raw = output_dir / "developer.raw.wav"
        subprocess.run([espeak, "-v", "en-us", "-s", "145", "-w", str(raw), phrase], check=True)
        normalized = output_dir / "developer-dictation.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", str(SAMPLE_RATE), str(normalized)], check=True)
        raw.unlink(missing_ok=True)
        with wave.open(str(normalized), "rb") as audio:
            duration_seconds = audio.getnframes() / audio.getframerate()
        samples.append({"id": "synthetic-developer-dictation", "audio_path": normalized.name,
                        "reference": phrase, "duration_seconds": round(duration_seconds, 3),
                        "duration_bucket_s": None, "category": "synthetic-developer-dictation"})
    silence = output_dir / "silence-5s.wav"
    with wave.open(str(silence), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(SAMPLE_RATE)
        audio.writeframes(bytes(SAMPLE_RATE * 5 * 2))
    samples.append({"id": "silence-5s", "audio_path": silence.name, "reference": "",
                    "duration_seconds": 5.0, "duration_bucket_s": None, "category": "silence"})


def build(dataset_root: Path, output_dir: Path) -> dict[str, Any]:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ffmpeg and ffprobe are required")
    clean = dataset_root / "test-clean"
    other = dataset_root / "test-other"
    if not clean.is_dir() or not other.is_dir():
        raise FileNotFoundError("dataset root must contain test-clean/ and test-other/ from LibriSpeech")
    chapters = sorted(clean.glob("*/*"))
    if len(chapters) < len(TARGETS) * 3:
        raise RuntimeError("test-clean has too few chapters")
    output_dir.mkdir(parents=True, exist_ok=True)
    samples: list[dict[str, Any]] = []
    rng = random.Random(20261013)
    rng.shuffle(chapters)
    used_chapters: set[Path] = set()
    for target in TARGETS:
        repeat = 0
        for chapter in chapters:
            if chapter in used_chapters:
                continue
            paths, references, measured_seconds = closest_group(chapter, target)
            if not target * 0.7 <= measured_seconds <= target * 1.3:
                continue
            used_chapters.add(chapter)
            repeat += 1
            sample_id = f"librispeech-clean-{target:02}-{repeat}"
            audio_path = output_dir / f"{sample_id}.wav"
            seconds = write_group(paths, audio_path)
            samples.append({"id": sample_id, "audio_path": audio_path.name,
                            "reference": " ".join(references), "duration_seconds": round(seconds, 3),
                            "duration_bucket_s": target, "category": "LibriSpeech test-clean",
                            "source_ids": [path.stem for path in paths]})
            if repeat == 3:
                break
        if repeat != 3:
            raise RuntimeError(f"Could not find three utterances close to {target}s")
    difficult_chapters = sorted(other.glob("*/*"))
    rng.shuffle(difficult_chapters)
    difficult_chapter = next((chapter for chapter in difficult_chapters
                              if 7 <= closest_group(chapter, 10)[2] <= 13), None)
    if difficult_chapter is None:
        raise RuntimeError("Could not find a test-other sample close to 10s")
    paths, references, _ = closest_group(difficult_chapter, 10)
    audio_path = output_dir / "librispeech-other-difficult.wav"
    seconds = write_group(paths, audio_path)
    samples.append({"id": "librispeech-other-difficult", "audio_path": audio_path.name,
                    "reference": " ".join(references), "duration_seconds": round(seconds, 3),
                    "duration_bucket_s": 10, "category": "LibriSpeech test-other",
                    "source_ids": [path.stem for path in paths]})
    add_synthetic_samples(output_dir, samples)
    return {"dataset": "LibriSpeech test-clean/test-other", "license": "CC BY 4.0",
            "source": "https://www.openslr.org/12/", "sample_rate": SAMPLE_RATE,
            "samples": samples}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", required=True, type=Path,
                        help="directory containing test-clean/ and test-other/")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    manifest = build(args.dataset_root.resolve(), args.output_dir.resolve())
    manifest_path = args.output_dir.resolve() / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
