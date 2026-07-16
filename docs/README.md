# VibeVoice Documentation

VibeVoice is a local-first desktop voice-input utility for developers. This index separates the historical MVP contract, current architecture, release notes, validated product direction, and implementation specifications.

## Product

- [MVP build directive](VIBEVOICE_MVP.md) — historical product baseline. Some implementation recommendations were superseded after the MVP shipped.
- [VibeVoice 0.3: Context Packs](product/v0.3-context-packs.md) — approved post-MVP product direction, scope, and success criteria.

## Architecture and installation

- [Current architecture](ARCHITECTURE.md)
- [Installation](INSTALL.md)

## VibeVoice 0.3 validation

- [Context Packs validation](research/2026-07-17-context-packs-validation.md) — dated repository, issue, release, and market validation.

## VibeVoice 0.3 specifications

- [Context Pack model](specs/v0.3/context-packs.md)
- [Deterministic transcript compiler](specs/v0.3/transcript-compiler.md)
- [Safe insertion](specs/v0.3/safe-insertion.md)
- [Project context and privacy](specs/v0.3/project-context-privacy.md)
- [History and local observability](specs/v0.3/history-observability.md)
- [Architecture extraction](specs/v0.3/architecture-extraction.md)
- [Security foundation](specs/v0.3/security-foundation.md)
- [Renderer reliability](specs/v0.3/renderer-reliability.md)
- [Quality and compatibility](specs/v0.3/quality-compatibility.md)
- [Compatibility matrix](qa/v0.3-compatibility-matrix.md)

## Delivery

- [VibeVoice 0.3 implementation plan](plans/2026-07-17-vibevoice-0.3-context-packs.md)
- [Release notes](releases/)

## Version policy

The latest validated stable version is `0.2.6`. A stabilization-only release may use `0.2.7`; the Context Pack foundation is planned for `0.3.0`, with project context and terminal-specific packs following in the `0.3.x` line. Planning branches must not change application manifests, create tags, or publish releases.
