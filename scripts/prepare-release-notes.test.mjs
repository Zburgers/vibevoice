import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReleaseNotes } from './prepare-release-notes.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'vibevoice-notes-'));
  const files = {
    'app/package.json': '{"version":"0.2.8"}',
    'app/package-lock.json': '{"version":"0.2.8","packages":{"":{"version":"0.2.8"}}}',
    'app/src-tauri/Cargo.toml': '[package]\nversion = "0.2.8"',
    'app/src-tauri/Cargo.lock': 'name = "vibevoice"\nversion = "0.2.8"',
    'app/src-tauri/tauri.conf.json': '{"version":"0.2.8"}',
    'app/src/types.ts': 'app_version: "0.2.8",',
    'docs/releases/v0.2.8.md': '# VibeVoice 0.2.8\nStatus: unreleased\n<!-- release-notes:start -->\n## Fixes\n\n- Keep transcripts.\n<!-- release-notes:end -->\nOwner acceptance pending.',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  try { run(root, files); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('publication uses only reviewed user notes, preserving Markdown', () => fixture(root => {
  assert.equal(prepareReleaseNotes(root, 'v0.2.8'), '## Fixes\n\n- Keep transcripts.');
}));

test('each of the seven version declarations fails closed when inconsistent or absent', () => fixture((root, files) => {
  for (const [file, original] of Object.entries(files).filter(([file]) => file.startsWith('app/'))) {
    const occurrences = [...original.matchAll(/0\.2\.8/g)];
    for (const match of occurrences) {
      for (const replacement of ['0.2.7', '']) {
        writeFileSync(join(root, file), original.slice(0, match.index) + replacement + original.slice(match.index + 5));
        assert.throws(() => prepareReleaseNotes(root, 'v0.2.8'), /version mismatch/, file);
      }
      writeFileSync(join(root, file), original);
    }
  }
}));

test('malformed tags and missing, reversed, duplicated or empty notes are rejected', () => fixture((root, files) => {
  for (const tag of ['v', 'v0.2.8-rc.1', 'v00.2.8', 'v0.2.8+build', '../v0.2.8']) {
    assert.throws(() => prepareReleaseNotes(root, tag), /stable SemVer/);
  }
  const file = 'docs/releases/v0.2.8.md';
  const original = files[file];
  for (const notes of [
    original.replace('# VibeVoice 0.2.8', '# VibeVoice 0.2.7'),
    original.replace('<!-- release-notes:end -->', ''),
    original + '\n<!-- release-notes:start -->',
    '# VibeVoice 0.2.8\n<!-- release-notes:end -->\n<!-- release-notes:start -->',
    '# VibeVoice 0.2.8\n<!-- release-notes:start --><!-- release-notes:end -->',
  ]) {
    writeFileSync(join(root, file), notes);
    assert.throws(() => prepareReleaseNotes(root, 'v0.2.8'));
  }
}));

test('workflow validates reviewed notes before build and single publication', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const step = workflow.split('      - name: Load reviewed release notes')[1].split('      - name:')[0];
  assert.doesNotMatch(step, /^\s*if:/m);
  assert.match(workflow, /release-artifacts\.mjs assemble/);
  const publisher = readFileSync(new URL('./release-artifacts.mjs', import.meta.url), 'utf8');
  assert.match(publisher, /prepareReleaseNotes\(root, tag\)/);
  assert.match(publisher, /'--notes-file', notesFile/);
});
