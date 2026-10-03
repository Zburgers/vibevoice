import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { stageArtifacts, assembleArtifacts, publishDraft, platforms } from './release-artifacts.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'vibevoice-release-'));
  const input = join(root, 'input');
  const output = join(root, 'output');
  const names = ['VibeVoice_0.2.8_x64-setup.exe', 'VibeVoice_0.2.8_amd64.AppImage', 'VibeVoice_0.2.8_aarch64.app.tar.gz'];
  for (let i = 0; i < platforms.length; i++) {
    const build = join(root, platforms[i]);
    mkdirSync(build);
    const file = join(build, names[i]);
    writeFileSync(file, Buffer.from([0, 255, 128, i]));
    writeFileSync(`${file}.sig`, Buffer.alloc(96, i).toString('base64'));
    stageArtifacts([file, `${file}.sig`], platforms[i], join(input, `release-${platforms[i]}`));
  }
  try { run({ root, input, output, names }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('one complete manifest retains all three signed platform entries', () => fixture(({ input, output, names }) => {
  const manifest = assembleArtifacts(input, output, '0.2.8', 'Zburgers/vibevoice', 'Reviewed notes');
  assert.deepEqual(Object.keys(manifest.platforms), platforms);
  for (let i = 0; i < platforms.length; i++) {
    assert.equal(manifest.platforms[platforms[i]].url, `https://github.com/Zburgers/vibevoice/releases/download/v0.2.8/${names[i]}`);
    assert.equal(readFileSync(join(output, names[i]))[3], i);
  }
  assert.equal(readdirSync(output).length, 7);
}));

test('missing platform, signature, unsafe receipt or duplicate filename aborts assembly', () => {
  for (const mutation of ['platform', 'signature', 'path', 'duplicate']) fixture(({ input, output }) => {
    const dir = join(input, 'release-linux-x86_64');
    const receiptFile = join(dir, 'platform.json');
    const receipt = JSON.parse(readFileSync(receiptFile));
    if (mutation === 'platform') rmSync(dir, { recursive: true });
    if (mutation === 'signature') rmSync(join(dir, `${receipt.updater}.sig`));
    if (mutation === 'path') { receipt.files.push('../outside'); writeFileSync(receiptFile, JSON.stringify(receipt)); }
    if (mutation === 'duplicate') { receipt.files.push('VibeVoice_0.2.8_x64-setup.exe'); writeFileSync(receiptFile, JSON.stringify(receipt)); }
    assert.throws(() => assembleArtifacts(input, output, '0.2.8', 'Zburgers/vibevoice', 'notes'));
  });
});

test('publisher verifies binary uploads while draft and publishes only at the end', () => fixture(({ input, output }) => {
  assembleArtifacts(input, output, '0.2.8', 'Zburgers/vibevoice', 'notes');
  const calls = [];
  let views = 0;
  const files = readdirSync(output);
  publishDraft({ output, repository: 'Zburgers/vibevoice', tag: 'v0.2.8', notesFile: 'notes.md', sha: 'tested' }, args => {
    calls.push(args);
    if (args[0] === 'release' && args[1] === 'view') {
      if (++views === 1) throw new Error('release not found');
      return JSON.stringify({ isDraft: true, assets: files.map(name => ({ name, size: readFileSync(join(output, name)).length })) });
    }
    if (args[1] === 'download') return readFileSync(join(output, args[args.indexOf('--pattern') + 1]));
    return '';
  });
  const create = calls.find(args => args[1] === 'create');
  assert.ok(create.includes('--draft'));
  assert.ok(create.includes('--verify-tag'));
  assert.ok(calls.at(-1).includes('--draft=false'));
  assert.equal(calls.filter(args => args.includes('--draft=false')).length, 1);
  assert.equal(calls.filter(args => args[1] === 'download').length, files.length);
}));

test('failed upload, missing asset, wrong bytes or public existing release never publishes', () => {
  for (const fault of ['upload', 'missing', 'digest', 'public']) fixture(({ input, output }) => {
    assembleArtifacts(input, output, '0.2.8', 'Zburgers/vibevoice', 'notes');
    const calls = [];
    let views = 0;
    assert.throws(() => publishDraft({ output, repository: 'Zburgers/vibevoice', tag: 'v0.2.8' }, args => {
      calls.push(args);
      if (args[1] === 'view') {
        if (++views === 1) return JSON.stringify({ isDraft: fault !== 'public', assets: [] });
        return JSON.stringify({ isDraft: true, assets: fault === 'missing' ? [] : readdirSync(output).map(name => ({ name, size: readFileSync(join(output, name)).length })) });
      }
      if (args[1] === 'upload' && fault === 'upload') throw new Error('upload failed');
      if (args[1] === 'download') return Buffer.from('wrong bytes');
      return '';
    }));
    assert.ok(calls.every(args => !args.includes('--draft=false')));
    if (fault === 'public') assert.equal(calls.length, 1);
  });
});

test('matrix only builds; one dependent publisher owns release mutation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const [matrix, publisher] = workflow.split('\n  publish:');
  assert.doesNotMatch(matrix, /contents: write|tagName:|releaseId:|releaseDraft:/);
  assert.match(matrix, /includeUpdaterJson: false/);
  assert.match(publisher, /needs: build-tauri/);
  assert.match(publisher, /release-artifacts.mjs assemble/);
  assert.match(publisher, /release-artifacts.mjs publish/);
  assert.match(workflow, /cancel-in-progress: false/);
});
