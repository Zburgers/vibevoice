# Deterministic Transcript Compiler Specification

**Status:** Proposed
**Phase:** P1

## Problem

Current cleanup removes blank lines, joins remaining lines, and collapses whitespace. Dictionary rules run sequentially as case-insensitive substring replacements. This prevents reliable paragraphs, Markdown, code blocks, exact terminal tokens, conflict reporting, and transformation receipts.

## Goals

- Preserve transcript structure.
- Make every built-in transformation deterministic and inspectable.
- Support Context Pack-specific processing.
- Prevent substring corruption and order-dependent dictionary output.
- Keep probabilistic rewriting out of the initial `0.3.0` compiler.

## Domain model

```rust
struct TranscriptDocument {
    source: String,
    blocks: Vec<TranscriptBlock>,
}

struct TranscriptBlock {
    id: BlockId,
    source_span: SourceSpan,
    kind: TranscriptBlockKind,
}

enum TranscriptBlockKind {
    Paragraph(String),
    Heading { level: u8, text: String },
    List(Vec<String>),
    CodeBlock { language: Option<String>, text: String },
}

struct ProcessingReceipt {
    stages: Vec<StageReceipt>,
    applied_rules: Vec<AppliedRule>,
    context_sources: Vec<ContextSourceReceipt>,
    warnings: Vec<ProcessingWarning>,
}
```

Receipts identify applied rules by stable block ID, original source span, and rendered output range. They must contain enough information to reproduce and debug output without copying sensitive context values unnecessarily.

## Pipeline

```text
Raw ASR output
-> normalize engine output
-> detect spoken formatting commands
-> build TranscriptDocument
-> apply scoped vocabulary
-> normalize developer tokens
-> apply Context Pack rules
-> validate target-specific output
-> render text and receipt
```

Each stage receives and returns explicit values. A stage must not write history, modify runtime state, or paste text.

## Formatting commands

Initial commands:

- `new paragraph`
- `bullet point`
- `heading <text>`
- `code block`
- `end code block`

Commands are recognized only at token boundaries. Content inside a code block is literal until `end code block`. Ambiguous or unterminated structures produce warnings and safe literal output rather than discarded content.

Plain `heading <text>` creates a level-2 heading. Optional explicit forms `heading one` through `heading six` select levels 1-6. Invalid levels render literally with a warning.

## Filler cleanup

Packs that enable filler cleanup reference a versioned lexicon of isolated disfluencies such as `um` and `uh`. Matching is token-boundary based, disabled inside code blocks and literal spans, and recorded in the receipt. The compiler does not remove conversational phrases through an open-ended heuristic.

## Vocabulary behavior

- Match longest phrases before shorter phrases.
- Use Unicode-aware word boundaries.
- Reject or report conflicting enabled rules.
- Apply scope precedence deterministically:

```text
project vocabulary
-> Context Pack vocabulary
-> global dictionary
```

- Record the original phrase, replacement, scope, and output position.
- Never replace inside a larger identifier unless a rule explicitly enables identifier matching.
- Preserve case-sensitive identifiers when the rule declares them.
- Select matches from original source spans. Once a span is consumed by a higher-priority or longer match, lower scopes cannot rematch either the source span or replacement text.

## Developer tokens

The compiler may deterministically normalize declared spoken forms such as:

```text
dash dash dry run -> --dry-run
apps slash dashboard -> apps/dashboard
snake case user id -> user_id
```

Token behavior belongs to a pack or vocabulary scope. It must be covered by corpus tests and must not guess an undeclared identifier. General developer-token normalization may ship in P1; Terminal Safe Mode's exact-token corpus and immutable terminal policy are P2 gates.

## Compatibility

Existing users migrate to Raw Dictation. Its first revision should characterize current output and intentionally document any safe corrections rather than silently changing all transcripts.

## Non-goals

- LLM cleanup
- Source-code parsing
- Automatic invention of headings or requirements
- General grammar rewriting beyond declared deterministic rules
- Shell command execution

## Acceptance criteria

- Paragraphs and Markdown blocks survive processing.
- Formatting-command recognition reaches at least 95% on the maintained corpus.
- Dictionary rules do not corrupt larger words or identifiers.
- Conflicts are reported before pack activation.
- Identical input, pack revision, vocabulary revision, and context produce identical output and receipts.
- Raw and final transcripts remain distinguishable.
- P2 Terminal Safe Mode preserves the terminal corpus exactly.
