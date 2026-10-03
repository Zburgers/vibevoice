import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const step = workflow.split('      - name: Verify release metadata consistency')[1].split('      - name:')[0];
const script = step.split('        run: |')[1].trimEnd().split('\n').slice(1).map(line => line.slice(10)).join('\n');

test('all publishing platforms enforce metadata validation', () => {
  assert.doesNotMatch(step, /^\s*if:/m);
  assert.ok(workflow.indexOf('Verify release metadata consistency') < workflow.indexOf('Build and publish release assets'));
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const event of ['pull_request:', 'push:']) {
    assert.match(ci.split(event)[1].split('\n\n')[0], /- codex\/v0\.2\.8/);
  }
});

test('actual workflow guard rejects invalid tags and every version mismatch', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibevoice-release-'));
  mkdirSync(join(root, 'src-tauri'));
  try {
    for (const [tag, mismatch, success] of [
      ['v0.2.8', '', true], ['v', '', false], ['v0.2.9', '', false],
      ['v0.2.8', 'cargo', false], ['v0.2.8', 'tauri', false], ['v0.2.8', 'lock', false],
      ['v0.2.8-rc.1', 'prerelease', false],
    ]) {
      const version = mismatch === 'prerelease' ? '0.2.8-rc.1' : '0.2.8';
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
      writeFileSync(join(root, 'src-tauri/Cargo.toml'), `version = "${mismatch === 'cargo' ? '0.2.7' : version}"\n`);
      writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: mismatch === 'tauri' ? '0.2.7' : version }));
      writeFileSync(join(root, 'src-tauri/Cargo.lock'), `name = "vibevoice"\nversion = "${mismatch === 'lock' ? '0.2.7' : version}"\n`);
      const result = spawnSync('bash', ['-c', script], { cwd: root, env: { ...process.env, GITHUB_REF: `refs/tags/${tag}`, GITHUB_REF_NAME: tag }, encoding: 'utf8' });
      assert.equal(result.status === 0, success, `${tag}/${mismatch}: ${result.error ?? result.stderr}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
