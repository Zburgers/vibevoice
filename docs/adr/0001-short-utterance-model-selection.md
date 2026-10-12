# ADR 0001: Keep Whisper CLI and use an optional small model for short recordings

- Status: Accepted for an opt-in experiment
- Date: 2026-10-13

## Context

VibeVoice currently starts `whisper-cli` for each recording. A resident `whisper-rs` prototype did not materially reduce end-to-end inference on this CPU, while a smaller Whisper model substantially reduced latency on short speech. Streaming alternatives returned earlier partials but failed the measured quality guardrail. The product must keep its existing local, cancellable Whisper path available.

## Decision

Keep `whisper-cli` with the configured base model as the default. Offer the pinned 77.7 MB `tiny.en` model as an explicit download. When the user selects **Auto**, use it only for audio at most 5.5 seconds when a standard `base.en` model is selected. Retry with the base model if short-model inference fails or returns empty output. Never retry after cancellation or shutdown. Custom model paths and **Base model only** always use the configured base model.

The short model does not replace the saved base model. Existing model verification and the engine update flow remain available. Model downloads use the existing HTTPS, expected-size, SHA-256, atomic-install, progress, and cancellation path, with a free-space check before transfer.

This is opt-in because the short samples are read English speech. The technical-vocabulary sample is about 15 seconds and does not qualify short technical dictation. The default remains the base model until a short developer-speech corpus supports the same accuracy claim.

## Evidence

The benchmark used 18 fixed samples, three CLI process runs per sample, four threads, and one Fedora 44 Intel Core i5-7600T host. Six speech clips were between 1.9 and 5.1 seconds; each was run three times. On those 18 short speech runs, base and tiny each produced 3 word errors across 174 reference words (1.72% WER). Base p50/p95 was 1,600/1,748 ms; tiny was 812/1,105 ms. This is a 49.3% p50 and 36.7% p95 reduction. The measured CPU-time p50 was 4,909 vs 2,347 ms, and process peak-memory p50 was 284.67 vs 176.44 MB.

Across all 54 mixed-length runs, base WER was 6.54%; tiny WER was 11.53%. The hybrid simulation uses tiny only at or below 5.5 seconds and base for the rest; it retained 6.54% overall WER, because the selected short speech results matched. This does not establish short technical vocabulary accuracy or stop-to-insert application latency.

## Alternatives considered

| Candidate | Result | Decision |
|---|---|---|
| Persistent `whisper-server` | Short speech: 18 runs, p50 1,247 ms, p95 1,378 ms, WER 1.72%, peak memory p50 255 MB; server/model startup 203 ms | Rejected for this change; it beats per-request base CLI by 22% p50, but is slower and larger than tiny CLI at 812 ms / 176 MB. Permanent idle memory and power were not measured |
| Resident `whisper-rs`, no OpenMP | 54 runs: p50 2,055 ms vs 2,054 ms CLI; p95 4,306 vs 4,281 ms; higher CPU and peak memory | Rejected; no latency gain |
| Resident `whisper-rs`, OpenMP | One 18-sample pass: p50 1,970 ms, p95 4,423 ms, higher CPU; not a full repeated comparison | Rejected; inconclusive and no broad p95 gain |
| `base.en` Q5_0 | 54 runs: p50 2,171 ms and p95 4,692 ms; peak memory 194 MB vs 285 MB | Rejected for default; memory and disk savings did not offset slower inference |
| Moonshine Voice Medium Streaming | One pass over 18 samples: p50 9,880 ms, p95 28,215 ms, about 875 MB process peak; p50 first partial 411 ms | Rejected; partials arrived early, but final CPU inference was slower and memory use was high |
| sherpa-onnx 20M streaming Zipformer | One pass over 18 samples: p50 549 ms, p95 2,891 ms, about 564 MB peak; LibriSpeech clean WER 10.33%, test-other 50% | Rejected; latency is attractive, but quality fails the guardrail |
| VAD and incremental Whisper chunks | Not selected for this change | No correctness-preserving app-level measurement established; adds another model and could clip or duplicate speech |

## Consequences and limits

- There is no streaming partial transcript in this implementation. The floating UI continues to display the existing transcription state and inserts only finalized text.
- The CLI still reloads weights for each request. This change reduces the short-model compute cost, not process creation or model load cost.
- **Auto** is user selected; the initial setting is **Base model only**. Downloading tiny does not silently change transcription behavior.
- The tested corpus is small and contains no short technical-speech clip. Keep the selection experimental until that gap is measured on held-out human speech.
- Windows and macOS builds were not run in this environment.
