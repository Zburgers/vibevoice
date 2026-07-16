# Project Context and Privacy Specification

**Status:** Proposed
**Phase:** P2

## Principle

Context is local, bounded, inspectable, revocable, and unavailable unless a visible policy permits it.

Metadata can still be sensitive. Filenames, branch names, repository names, and manifest identifiers must not be treated as harmless merely because they are not source-code contents.

## Context sources

```text
Application identity
Explicit project root
Repository name
Git remote names
Branch names
Manifest package identifiers
Manifest dependency names
Directory names
Filenames
README headings
Selected text
Clipboard
```

Every source has an independent permission and receipt state: `used`, `allowed-not-used`, `not-permitted`, `excluded`, `unavailable`, or `unsupported`.

## Default policy

- Raw Dictation uses no context.
- Agent Prompt may use application identity after consent; project metadata remains opt-in.
- Clipboard and selected text are off by default.
- Window titles are off by default.
- Arbitrary source-code contents are unsupported in the initial implementation.
- Network transmission is prohibited in all built-in `0.3` packs.

## Initial project vocabulary

The first provider reads only:

- Explicitly approved project roots
- Repository basename
- Manifest package or workspace names
- Manifest dependency identifiers

Supported initial manifests may include `package.json`, `Cargo.toml`, and `pyproject.toml`. Each parser reads only allowlisted name/dependency fields. Inputs are limited to regular files no larger than 2 MiB, canonicalized beneath the approved root, without following a manifest symlink. Parsers cap collected dependency identifiers at 10,000 and reject excessive nesting or malformed input before caching terms.

The initial project root comes from an explicit main-window folder selection. The user approves the canonical folder and may associate it with one or more applications. VibeVoice does not infer a repository root from window titles or process working directories.

Potential later opt-ins:

- Relative filenames and directory names
- Branch names
- Git remote names without URLs
- README headings

Do not persist full Git URLs, embedded credentials, absolute home paths, source contents, or README prose.

## Project identity

Cache identity must not expose an absolute path in the UI or receipt. Use an application-owned identifier derived locally from the approved root plus repository identity. The identifier is not transmitted and is deleted with the cache.

## Context receipt

```text
Context Pack: Agent Prompt
Application identity: used
Project manifest terms: 18
Filenames: not permitted
Branch name: not permitted
Clipboard: not permitted
Selected text: not permitted
Source contents: unsupported
Network transmission: none
```

Receipts store source categories, counts, revisions, and decisions. They should not duplicate sensitive term values unless the user opens an explicit vocabulary inspector.

## Storage and lifecycle

- Generate vocabulary locally.
- Cache only when enabled.
- Store cache schema, project identifier, source categories, term count, and generation time.
- Exclude context values from transcript history by default.
- Support per-project clear, clear all, and configurable expiry.
- Never retain audio as part of context collection.
- Invalidate cache when approved manifests change or policy permissions narrow.

## Exclusions

Support global and per-application exclusions for password managers, authentication windows, private browser profiles, remote-desktop tools, and user-defined sensitive applications.

An exclusion overrides pack permissions and activation rules. VibeVoice should show that context was excluded without revealing the sensitive target's content.

## Failure behavior

- Parser failure omits that source and records a warning; transcription continues.
- Unsupported manifest formats are ignored explicitly.
- Permission revocation clears disallowed cached data.
- If the project root cannot be established safely, project context is unavailable rather than guessed.

## Acceptance criteria

- No source is collected without an active visible policy.
- Initial project vocabulary does not read arbitrary source files.
- No context path transmits data over the network.
- Users can inspect and clear every cache.
- Receipts identify what was and was not used.
- Absolute user paths and Git credentials never appear in receipts.
- Sensitive-application exclusions override all packs.
