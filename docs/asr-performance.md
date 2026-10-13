# Local ASR performance and setup

## Current behavior

VibeVoice records locally, closes the audio file, and runs the installed `whisper-cli` in a tracked worker process. Audio remains in memory only for capture and is handed to Whisper through the existing WAV file. Cancellation and shutdown terminate and reap the worker process; text insertion remains behind the existing cancellation commit boundary and clipboard recovery flow.

The existing base model remains the default. **Short recording model** starts at **Base model only**. To try the measured short-utterance path:

1. Open Settings and choose **Install short model**. This explicitly downloads the pinned English `tiny.en` GGML model (77,704,715 bytes). The [official converted-model repository](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1) is MIT licensed. The downloader checks HTTPS, exact size, SHA-256, available disk space, cancellation, and atomic installation. It does not download during normal startup or transcription.
2. Select **Auto — faster model up to 5.5 seconds**. Recordings at or below 5,500 ms use tiny only when the configured base model is the standard `base.en`; custom models use the configured path. Longer recordings always use base.
3. If tiny fails or returns no text, VibeVoice retries once with base. A cancellation or application shutdown prevents the retry. The selected model appears in Diagnostics.

Return to **Base model only** to immediately restore the previous inference behavior. The optional model then remains on disk but is not loaded or used. Existing engine update and base model verify/repair controls are unchanged.

## Output modes

- **Verbatim** removes Whisper timestamp rows and blank rows, while retaining the remaining line breaks and words.
- **Clean** removes Whisper timestamp rows, trims and collapses whitespace, and preserves spoken words, including `um`, `uh`, `erm`, and `uhm`. It preserves mixed-case identifiers such as `useEffect`.
- **Polished** applies Clean, uppercases a plain first word, and adds a final period only when the final token is a plain alphabetic word. It avoids changing numbers, paths, and mixed-case identifiers.

Enabled dictionary rules run after the selected mode. No LLM, cloud formatter, or network request is used.

## Benchmark corpus and host

The harness uses public LibriSpeech `test-clean` and `test-other` audio, with three samples each near 2, 5, 10, 20, and 30 seconds, one difficult `test-other` sample, silence, and an optional synthetic developer phrase. The manifest and generation instructions are in [`benchmarks/README.md`](../benchmarks/README.md). The public corpus is [CC BY 4.0](https://www.openslr.org/12/). Audio files are not checked in.

Measurements were collected on Fedora 44 Linux x86_64, kernel `7.2.5-200.fc44.x86_64`, Intel Core i5-7600T at 2.80 GHz, 4 logical CPUs, 32 GB RAM, whisper.cpp `v1.8.6-58-gdf7638d8`, four threads. The base model was 147,964,211 bytes, SHA-256 `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`; tiny was 77,704,715 bytes, SHA-256 `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f`.

Each model was measured over 18 samples and 3 process runs per sample (54 runs). The short speech comparison uses the six LibriSpeech clips at 1.9–5.1 seconds, repeated three times (18 runs). Results are process-only, not full app latency.

The first pass p50/p95 was 2,174/4,764 ms for base and 1,081/2,523 ms for tiny; the later 36 runs measured 2,235/4,558 ms and 1,115/2,380 ms. The runner does not evict the OS file cache, so “first” is not a guaranteed cold-cache measurement.

| Model and selection | Runs | p50 / p95 wall time | p50 RTF | WER | p50 CPU time | p50 CPU utilization | p50 peak memory |
|---|---:|---:|---:|---:|---:|---:|---:|
| Base, all lengths | 54 | 2,183 / 4,558 ms | 0.219 | 6.54% | 6,603 ms | 76.75% | 285 MB |
| Tiny, all lengths (rejected) | 54 | 1,107 / 2,380 ms | 0.113 | 11.53% | 3,095 ms | 73.35% | 177 MB |
| Base, short speech only | 18 | 1,600 / 1,748 ms | 0.523 | 1.72% | 4,909 ms | 76.92% | 285 MB |
| Tiny, same short speech | 18 | 812 / 1,105 ms | 0.287 | 1.72% | 2,347 ms | 73.03% | 176 MB |

On these short clips, tiny reduced p50 and p95 by 49.3% and 36.7%, with identical measured WER. The hybrid simulation routes short clips to tiny and longer clips to base; its full-corpus p50/p95 stay 2,183/4,558 ms because the corpus median and tail are long recordings. Its overall WER remains 6.54%. It is an offline selection simulation, not an in-app stop-to-insert measurement.

The CLI-reported stage timings show the source of the short-clip change. On the same 18 runs, p50 model load was 109 ms for base and 72 ms for tiny; mel processing was 7 ms and 8 ms; encode was 1,118 ms and 475 ms; decode was 0 ms and 6 ms; and Whisper's reported total was 1,560 ms and 779 ms. The machine-readable [short stage profile](../benchmarks/results/short-stage-profile.json) includes per-run values and p95 stage timings. These stage figures exclude VibeVoice capture, text cleanup, clipboard, and insertion.

The synthetic developer phrase is about 15 seconds, so the routing rule would use base for it. Its eSpeak WER is 70% for base and 56.67% for tiny, which is not reliable human speech evidence. The sample set does not qualify tiny for short developer terminology. Silence produced three false-positive words in three base runs and three tiny runs; silence hallucinations are reported separately from WER.

The checked-in JSON under `benchmarks/results/` contains individual run metrics, hashes, host metadata, p50/p95, and category summaries. `baseline.json`, `tiny.json`, and `hybrid-short-tiny.json` correspond to the table above.

## Alternatives and why they were not selected

The resident whisper-rs probe showed no meaningful p50 or p95 reduction on the full corpus, with higher CPU and peak memory. A persistent whisper-server reduced short-speech p50/p95 to 1,247/1,378 ms with 1.72% WER, versus base CLI at 1,600/1,748 ms; the server/model took 203 ms to start and its measured peak memory was 255 MB. Tiny CLI was faster at 812/1,105 ms and used 176 MB peak memory, so the resident server did not justify a permanent worker and lifecycle path. The resident result is in [`resident-server-short.json`](../benchmarks/results/resident-server-short.json). Q5_0 reduced memory but was slower. Moonshine Voice Medium Streaming produced a first partial around 411 ms on a single pass but had 9.88 second p50 final time and about 875 MB process peak. The sherpa-onnx 20M streaming Zipformer prototype had 549 ms p50 final time and a first partial around 104 ms, but LibriSpeech clean WER was 10.33% and difficult test-other WER was 50%. Those streaming prototypes were benchmarked through Python and are not runtime dependencies.

The production path does not emit partial transcript text. Whisper CLI has no stable partial event contract in the current integration, and the resident and streaming candidates did not justify replacing the quality path. The pill continues to report its current recording/transcription status and inserts only finalized text. VAD was not added: no silence or boundary benchmark established that it saves more work than it adds while preserving initial/final words and pauses.

## Diagnostics, troubleshooting, rollback

Diagnostics records transcription wall time (including a failed tiny attempt before base fallback), whether tiny fallback occurred, preprocessing, cleanup, insertion, stop-to-insert, the model actually used, thread count, child CPU time, and peak memory when the platform exposes it. A tiny model that fails is skipped for the rest of the app process; replacing its file or restarting after repair lets Auto retry it. The in-app stop-to-insert counters have not been measured on a physical microphone/target-app run in this change; the benchmark table excludes capture and insertion.

- If the short model cannot load, the request falls back to the configured base model. Check Diagnostics for the fallback warning and the model actually used.
- If the download fails for space, network, checksum, or cancellation, the old model and configured settings remain active. Retry with enough free disk space.
- To roll back, switch to **Base model only**. The installed optional file remains unused and can be removed manually after closing VibeVoice.
- If an existing installation has a custom model, Auto keeps that model selected. If model selection behaves unexpectedly, choose Base model only and verify the Model path in Settings.

## Platform and qualification limits

Local implementation and benchmark runs used Linux only. Final PR CI also passed native Rust tests, Clippy, and release builds on Windows and macOS. Those jobs do not exercise live microphone capture, package installation, model download, global hotkeys, or insertion into a target application on those platforms. Hardware acceleration, VAD, reliable partial transcripts, sustained idle power, application memory lifecycle, and full stop-to-insert performance have not been measured.
