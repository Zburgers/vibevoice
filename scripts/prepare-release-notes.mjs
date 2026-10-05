import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function prepareReleaseNotes(root, tag) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Expected a stable SemVer tag such as v0.2.8.');
  }
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const pkg = JSON.parse(read('app/package.json'));
  const npmLock = JSON.parse(read('app/package-lock.json'));
  const appstreamReleases = [...read('app/src-tauri/linux/dev.zburgers.vibevoice.metainfo.xml').matchAll(/<release\s+[^>]*\bversion="([^"]+)"[^>]*\/>/g)];
  const values = {
    package: pkg.version,
    npmLock: npmLock.version,
    npmRoot: npmLock.packages?.['']?.version,
    cargo: read('app/src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    cargoLock: read('app/src-tauri/Cargo.lock').match(/name = "vibevoice"\s+version = "([^"]+)"/)?.[1],
    tauri: JSON.parse(read('app/src-tauri/tauri.conf.json')).version,
    fallback: read('app/src/types.ts').match(/app_version:\s*"([^"]+)"/)?.[1],
    appstream: appstreamReleases.length === 1 ? appstreamReleases[0][1] : undefined,
  };
  if (Object.values(values).some(version => version !== tag.slice(1))) {
    throw new Error(`Release version mismatch (including AppStream): ${JSON.stringify(values)}; tag=${tag}`);
  }
  const notes = read(`docs/releases/${tag}.md`);
  if (notes.split('\n')[0].trim() !== `# VibeVoice ${pkg.version}`) {
    throw new Error('Patch-note heading does not match the release version.');
  }
  const start = '<!-- release-notes:start -->';
  const end = '<!-- release-notes:end -->';
  if (notes.split(start).length !== 2 || notes.split(end).length !== 2 || notes.indexOf(end) < notes.indexOf(start)) {
    throw new Error('Expected one ordered pair of release-note markers.');
  }
  const body = notes.slice(notes.indexOf(start) + start.length, notes.indexOf(end)).trim();
  if (!body || !/^## /m.test(body)) throw new Error('Release notes are empty or missing change sections.');
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const tag = process.argv[2] === '--check'
    ? `v${JSON.parse(readFileSync(resolve(root, 'app/package.json'), 'utf8')).version}`
    : process.argv[2];
  const body = prepareReleaseNotes(root, tag);
  if (process.argv[2] === '--check') {
    console.log(`All seven version declarations, the AppStream release entry, and release notes match ${tag}.`);
  } else {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required to prepare publication notes.');
    const delimiter = `notes_${randomUUID()}`;
    appendFileSync(process.env.GITHUB_OUTPUT, `body<<${delimiter}\n${body}\n${delimiter}\n`);
    console.log(`Prepared reviewed patch notes for ${tag}.`);
  }
}
