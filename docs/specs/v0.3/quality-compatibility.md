# Quality and Compatibility Contract

**Status:** Proposed
**Phase:** P0-P3

## Current gap

The repository has focused Rust unit tests but no maintained developer voice corpus, benchmark suite, target-application compatibility matrix, or long-cycle release QA specification.

## Corpus policy

Maintain locally generated, licensed, or explicitly consented samples covering:

- Framework and package names
- Acronyms
- Camel case and snake case
- File and directory paths
- CLI flags and shell operators
- Git branches and issue references
- Paragraph and Markdown structure
- Natural self-corrections
- Accented English
- Transliterated Hinglish as an exploratory, non-gating corpus while the default model remains `ggml-base.en.bin`
- Background noise and microphone variation

Store expected raw and processed outputs separately. Do not commit private recordings or user dictations. Every corpus item records consent or provenance, language, expected tokens, and applicable packs.

## Quality metrics

- Developer-term error rate
- Formatting-command precision and recall
- Exact terminal-token accuracy
- Paragraph and Markdown preservation
- Dictionary false-replacement rate
- End-to-end insertion success
- Stale-target paste count
- Clipboard restoration success and skip correctness

## Performance metrics

Record stage timing for:

```text
hotkey -> Preparing
Preparing -> Recording
stop -> raw transcript
raw transcript -> processed output
processed output -> insertion result
```

Transcription performance is reported by hardware class, engine revision, and model. It does not use one universal threshold.

## Application compatibility matrix

Every target entry records:

```text
Platform and display server
Application and tested version
Focus preservation
Single-line insertion
Multiline insertion
Clipboard restoration
Target-change behavior
Terminal classification
Known limitations
```

Initial targets:

- VS Code and Cursor
- Common terminal applications
- Browser text fields
- ChatGPT and Claude
- GitHub
- Slack and Discord
- Native text editors

“Works in any focused input” is marketing language until the target is tested. Unsupported applications use copy-only fallback and appear as unsupported in the matrix.

## Measurement rules

- Every supported platform/application combination runs at least 100 insertion trials: 50 single-line and 50 multiline.
- The 99% insertion target applies to every supported combination and to the aggregate; an unsupported target cannot be omitted silently or hidden by another target's volume.
- Every platform runs at least 50 forced target-change trials with zero automatic paste attempts.
- Formatting evaluation includes at least 200 labeled command opportunities. Precision and recall must each be at least 95%; the requirement is not an undifferentiated accuracy score.
- Clipboard restoration runs at least 50 unchanged-clipboard and 50 newer-user-copy trials per platform, with zero overwrites of newer content.
- Corpus and matrix revisions are pinned in each report.

## P0-P1 release gates

- No renderer disappearance across 500 state cycles.
- At least 99% insertion success across the declared supported matrix.
- Zero stale-target automatic pastes.
- Zero automatic terminal execution.
- At least 95% formatting-command precision and recall.
- No substring corruption in the dictionary corpus.
- No full state reload from meter or runtime-only events.

## P2 release gates

- Terminal corpus tokens are preserved exactly.
- Project-context privacy and clearing requirements pass.
- Application activation and exclusion rows meet the supported matrix thresholds.

## Local reporting

Release reports remain local artifacts and contain:

- Hardware and OS
- Engine and model
- Corpus revision
- Application matrix revision
- Passed, failed, and unsupported cases
- Known limitations

No cloud telemetry is introduced to measure these goals.

## Acceptance criteria

- Corpus provenance and privacy rules are documented and enforced.
- Metrics are reproducible from pinned corpus and implementation revisions.
- Compatibility claims name tested platforms and application versions.
- Release blockers cannot be hidden inside an aggregate score.
- Unsupported targets fall back safely.
