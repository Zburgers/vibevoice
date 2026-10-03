import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareReleaseNotes } from './prepare-release-notes.mjs';

export const platforms = ['windows-x86_64', 'linux-x86_64', 'darwin-aarch64'];
const updaterSuffix = { 'windows-x86_64': '-setup.exe', 'linux-x86_64': '.AppImage', 'darwin-aarch64': '.app.tar.gz' };

export function stageArtifacts(paths, platform, output) {
  if (!platforms.includes(platform)) throw new Error('Unexpected release platform');
  mkdirSync(output, { recursive: true });
  const files = new Map();
  for (let path of paths) {
    if (path.endsWith('.app')) path += '.tar.gz';
    if (!statSync(path).isFile()) throw new Error(`Release artifact is not a file: ${path}`);
    if (files.has(basename(path)) && files.get(basename(path)) !== path) throw new Error('Duplicate platform artifact');
    files.set(basename(path), path);
    if (existsSync(`${path}.sig`)) files.set(`${basename(path)}.sig`, `${path}.sig`);
  }
  const updaters = [...files.keys()].filter(name => name.endsWith(updaterSuffix[platform]));
  if (updaters.length !== 1) throw new Error(`Expected exactly one signed updater for ${platform}`);
  const updater = updaters[0];
  if (!files.has(`${updater}.sig`)) throw new Error(`Missing updater signature for ${platform}`);
  for (const [name, path] of files) {
    if (name === 'platform.json' || name === 'latest.json') throw new Error('Reserved release filename');
    copyFileSync(path, join(output, name));
  }
  writeFileSync(join(output, 'platform.json'), JSON.stringify({ platform, updater, files: [...files.keys()] }, null, 2));
}

export function assembleArtifacts(input, output, version, repository, notes, date = new Date().toISOString()) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release identity');
  const manifest = { version, notes, pub_date: date, platforms: {} };
  const assets = new Map();
  for (const platform of platforms) {
    const dir = join(input, `release-${platform}`);
    const receipt = JSON.parse(readFileSync(join(dir, 'platform.json'), 'utf8'));
    if (receipt.platform !== platform || !receipt.updater.endsWith(updaterSuffix[platform]) || basename(receipt.updater) !== receipt.updater) throw new Error('Invalid platform receipt');
    if (!receipt.files.includes(receipt.updater) || !receipt.files.includes(`${receipt.updater}.sig`)) throw new Error('Incomplete updater receipt');
    const signature = readFileSync(join(dir, `${receipt.updater}.sig`), 'utf8').trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length < 80) throw new Error('Invalid updater signature');
    manifest.platforms[platform] = { signature, url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(receipt.updater)}` };
    for (const name of receipt.files) {
      if (basename(name) !== name || name === 'latest.json' || name === 'platform.json' || assets.has(name)) throw new Error(`Invalid or duplicate release asset: ${name}`);
      const path = join(dir, name);
      if (!statSync(path).isFile()) throw new Error('Missing release asset');
      assets.set(name, path);
    }
    if (readdirSync(dir).some(name => name !== 'platform.json' && !receipt.files.includes(name))) throw new Error('Unlisted build artifact');
  }
  mkdirSync(output, { recursive: true });
  for (const [name, path] of assets) copyFileSync(path, join(output, name));
  writeFileSync(join(output, 'latest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// All builds and validation finish before creating the draft. A failed upload
// or verification leaves it private. This is the only release writer.
export function publishDraft({ output, repository, tag, notesFile, sha }, run = args => execFileSync('gh', args, { maxBuffer: 512 * 1024 * 1024 })) {
  const base = ['--repo', repository];
  let release;
  try {
    release = JSON.parse(run(['release', 'view', tag, ...base, '--json', 'isDraft,assets']));
  } catch (error) {
    if (!/release not found/i.test(String(error.stderr || error.message))) throw error;
  }
  if (release && !release.isDraft) throw new Error('Refusing to modify a published release');
  const names = readdirSync(output);
  const files = names.map(name => join(output, name));
  if (!names.includes('latest.json') || files.some(path => !statSync(path).isFile())) throw new Error('Incomplete assembled release');
  if (!release) run(['release', 'create', tag, ...base, '--verify-tag', '--draft', '--target', sha, '--title', `VibeVoice ${tag}`, '--notes-file', notesFile]);
  else run(['release', 'edit', tag, ...base, '--notes-file', notesFile]);
  run(['release', 'upload', tag, ...base, ...files, '--clobber']);
  const uploaded = JSON.parse(run(['release', 'view', tag, ...base, '--json', 'isDraft,assets']));
  if (!uploaded.isDraft || uploaded.assets.length !== files.length) throw new Error('Draft asset set mismatch');
  for (const path of files) {
    const asset = uploaded.assets.find(asset => asset.name === basename(path));
    const bytes = readFileSync(path);
    if (!asset || asset.size !== bytes.length) throw new Error('Uploaded asset size mismatch');
    // Download and hash every draft asset before making it public. Size alone
    // cannot prove that a rerun uploaded the current build.
    const remote = run(['release', 'download', tag, ...base, '--pattern', asset.name, '--output', '-']);
    if (createHash('sha256').update(remote).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Uploaded asset digest mismatch');
  }
  run(['release', 'edit', tag, ...base, '--draft=false', '--latest']);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [mode, input, output] = process.argv.slice(2);
  if (mode === 'stage') {
    stageArtifacts(JSON.parse(process.env.ARTIFACT_PATHS), process.env.RELEASE_PLATFORM, input);
  } else if (mode === 'assemble') {
    const tag = process.env.GITHUB_REF_NAME;
    const notes = prepareReleaseNotes(root, tag);
    assembleArtifacts(input, output, tag.slice(1), process.env.GITHUB_REPOSITORY, notes);
    writeFileSync(join(dirname(output), 'release-notes.md'), notes);
  } else if (mode === 'publish') {
    prepareReleaseNotes(root, process.env.GITHUB_REF_NAME);
    publishDraft({ output: input, repository: process.env.GITHUB_REPOSITORY, tag: process.env.GITHUB_REF_NAME, notesFile: join(dirname(input), 'release-notes.md'), sha: process.env.GITHUB_SHA }, args => execFileSync('gh', args, { maxBuffer: 512 * 1024 * 1024 }));
  } else throw new Error('Expected stage, assemble, or publish');
}
