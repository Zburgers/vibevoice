# Local ASR benchmarks

The harness measures `whisper-cli` process wall time, child CPU time, peak process memory, real-time factor (RTF), WER, silence false positives, and the CLI's `whisper_print_timings` load, mel, encode, decode, sampling, and total durations. It runs each sample in a new CLI process, so model loading and process startup are included in the measured wall time. It does not measure microphone capture, application post-processing, UI, clipboard, or insertion.

## Reproduce the corpus

Download and extract LibriSpeech `test-clean` and `test-other` from [OpenSLR 12](https://www.openslr.org/12/). The corpus is CC BY 4.0; preserve the dataset attribution when redistributing any audio or transcript material. No audio is committed here. `prepare_librispeech.py` selects three fixed-duration groups near 2, 5, 10, 20, and 30 seconds, one difficult `test-other` group, a 5-second silence sample, and an optional eSpeak-generated developer phrase. The synthetic phrase is only a terminology smoke test; its WER is not a human-speech accuracy estimate.

Requires Python 3.10+, `ffmpeg`, and `ffprobe`:

```sh
python3 benchmarks/prepare_librispeech.py \
  --dataset-root /path/to/LibriSpeech \
  --output-dir /tmp/vibevoice-asr-corpus
```

To reproduce the short-profile and resident-server comparison, derive the six clean English speech clips (1.9–5.1 seconds) into a separate manifest:

```sh
python3 - <<'PY'
import json
from pathlib import Path

root = Path("/tmp/vibevoice-asr-corpus")
manifest = json.loads((root / "manifest.json").read_text())
manifest["samples"] = [
    sample for sample in manifest["samples"]
    if sample["category"] == "LibriSpeech test-clean" and sample["duration_seconds"] <= 5.5
]
(root / "short-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
```

## Run Whisper CLI

Use the same engine binary, audio manifest, thread count, and repeat count for each model. The checked-in result bundle records model and binary SHA-256 digests.

```sh
python3 benchmarks/asr_benchmark.py \
  --manifest /tmp/vibevoice-asr-corpus/manifest.json \
  --engine /path/to/whisper-cli \
  --model /path/to/ggml-base.en.bin \
  --threads 4 --repeats 3 \
  --output /tmp/base-results.json
```

Repeat with `ggml-tiny.en.bin`, then combine the identical runs under the application’s 5.5-second routing rule:

```sh
python3 benchmarks/summarize_hybrid.py \
  --base /tmp/base-results.json --fast /tmp/tiny-results.json \
  --max-audio-ms 5500 --output /tmp/hybrid-results.json
```

## Compare a persistent whisper.cpp server

On Linux, use the experimental loopback runner to separate server/model startup from short-clip request latency. The server and all audio requests bind to `127.0.0.1`; the script terminates the server when the run ends.

```sh
python3 benchmarks/whisper_server_benchmark.py \
  --server /path/to/whisper-server \
  --model /path/to/ggml-base.en.bin \
  --manifest /tmp/vibevoice-asr-corpus/short-manifest.json \
  --threads 4 --repeats 3 \
  --output /tmp/resident-server-results.json
```

The manifest should contain the short LibriSpeech samples and keep their WAV paths relative to the manifest. This research runner is not part of the application runtime.

The scripts do not install engines, download models, or access a microphone. The optional Moonshine and sherpa-onnx prototypes require their own Python environments and models; they are not VibeVoice runtime dependencies.

## Result interpretation

- p50 and nearest-rank p95 are reported for latency. Spread is max minus min.
- WER is word-level Levenshtein errors divided by reference words. Empty-reference samples are excluded from WER and report hallucinated silence words separately.
- A first pass and later passes are separated, but the first pass is not guaranteed cold storage: OS file caches are not cleared.
- On Windows the CLI process memory and CPU use Windows process APIs. On Linux peak memory is sampled from `/proc`; CPU time comes from child process accounting. Some other platforms report memory as unavailable.
- Full raw transcripts are not written to result JSON. The corpus manifest contains licensed reference text and IDs; benchmark results contain only sample IDs and metrics.
