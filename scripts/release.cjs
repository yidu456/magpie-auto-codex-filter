'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const archives = ['MagpieFilter-windows-x64.zip', 'MagpieFilter-linux-x64.tar.gz',
  'MagpieFilter-macos-arm64.tar.gz', 'MagpieFilter-macos-x64.tar.gz'];
const windowsFiles = ['MagpieFilter.exe', 'LICENSE.txt', 'NODE-LICENSE.txt', 'START-HERE.txt'];
const assetNames = [...archives, ...windowsFiles.slice(0, 3), 'SHA256SUMS.txt'];
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function validateTag(tag) {
  const match = typeof tag === 'string' && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*))?$/.exec(tag);
  if (!match || match[0] !== tag || (match[4] || '').split('.').some(value => /^0\d+$/.test(value))) {
    throw new Error('Invalid version tag: expected vMAJOR.MINOR.PATCH[-prerelease].');
  }
  return {tag, prerelease: tag.includes('-')};
}
function regular(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Expected regular ' + (directory ? 'directory' : 'file') + ': ' + file);
}
function exact(actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error('Unexpected release inventory.');
}
function verifyChecksums(directory, files) {
  const rows = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trimEnd().split(/\r?\n/);
  const parsed = rows.map(row => /^([a-f0-9]{64})  ([^/\\]+)$/.exec(row));
  if (parsed.some(row => !row) || JSON.stringify(parsed.map(row => row[2]).sort()) !== JSON.stringify([...files].sort())) {
    throw new Error('Unexpected checksum inventory.');
  }
  for (const [, checksum, file] of parsed) if (hash(path.join(directory, file)) !== checksum) throw new Error('Checksum mismatch: ' + file);
}
function verifyArtifacts(artifactDirectory) {
  const root = path.resolve(artifactDirectory); regular(root, true);
  const directories = archives.map(file => file.replace(/\.zip$|\.tar\.gz$/, ''));
  exact(fs.readdirSync(root), directories);
  return archives.map((file, index) => {
    const directory = path.join(root, directories[index]); regular(directory, true);
    exact(fs.readdirSync(directory), [file, 'SHA256SUMS.txt']);
    for (const name of [file, 'SHA256SUMS.txt']) regular(path.join(directory, name));
    verifyChecksums(directory, [file]); return path.join(directory, file);
  });
}
function prepareAssets(files, outputDirectory) {
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) throw new Error('Release output already exists; use a fresh directory.');
  fs.mkdirSync(output, {recursive: true});
  const stage = fs.mkdtempSync(path.join(output, '.release-stage-'));
  const tar = args => {
    const result = spawnSync('tar', args, {encoding: 'utf8', windowsHide: true, shell: false, timeout: 120000, maxBuffer: 1024 * 1024});
    if (result.error || result.status !== 0) throw result.error || new Error('Windows archive inspection/extraction failed.');
    return result.stdout.trim().split(/\r?\n/);
  };
  try {
    const top = 'MagpieFilter-windows-x64';
    const listing = tar(['-tf', files[0]]);
    exact(listing.filter(file => file !== top + '/'), [...windowsFiles, 'SHA256SUMS.txt'].map(file => top + '/' + file));
    if (listing.filter(file => file === top + '/').length > 1 || tar(['-tvf', files[0]]).some(row => !/^[-d]/.test(row))) {
      throw new Error('Windows archive inventory contains non-regular entries.');
    }
    tar(['-xf', files[0], '-C', stage]);
    exact(fs.readdirSync(stage), [top]);
    const payload = path.join(stage, top); regular(payload, true);
    exact(fs.readdirSync(payload), [...windowsFiles, 'SHA256SUMS.txt']);
    for (const file of [...windowsFiles, 'SHA256SUMS.txt']) regular(path.join(payload, file));
    verifyChecksums(payload, windowsFiles);
    for (const file of files) fs.copyFileSync(file, path.join(output, path.basename(file)), fs.constants.COPYFILE_EXCL);
    for (const file of windowsFiles.slice(0, 3)) fs.copyFileSync(path.join(payload, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), assetNames.slice(0, -1)
      .map(file => hash(path.join(output, file)) + '  ' + file + '\n').join(''), {flag: 'wx'});
    exact(fs.readdirSync(output).filter(file => file !== path.basename(stage)), assetNames);
    return assetNames.map(file => path.join(output, file));
  } finally {
    // Remove only our fresh, resolved staging child, never downloaded or existing user outputs.
    if (path.dirname(fs.realpathSync(stage)) !== fs.realpathSync(output) || !path.basename(stage).startsWith('.release-stage-')) {
      throw new Error('Unexpected release staging path.');
    }
    fs.rmSync(stage, {recursive: true, force: true});
  }
}
function release({tag, artifactDirectory, outputDirectory, env = process.env, execute = spawnSync} = {}) {
  const version = validateTag(tag);
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/tags/' + tag) throw new Error('Release requires a matching tag push event.');
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '') || repository.split('/').some(part => /^\.+$/.test(part))) {
    throw new Error('Invalid GitHub repository.');
  }
  if (!env.GH_TOKEN) throw new Error('Release requires GH_TOKEN.');
  const files = verifyArtifacts(artifactDirectory), assets = prepareAssets(files, outputDirectory), cwd = path.resolve(outputDirectory);
  const gh = args => execute('gh', args, {env, cwd, encoding: 'utf8', windowsHide: true, shell: false,
    timeout: 120000, maxBuffer: 1024 * 1024});
  const checked = (result, action) => {
    if (result.error || result.status !== 0) throw new Error('Release ' + action + ' failed.');
    return result.stdout;
  };
  const ref = JSON.parse(checked(gh(['api', 'repos/' + repository + '/git/ref/tags/' + tag]), 'existing-tag lookup'));
  if (ref.ref !== 'refs/tags/' + tag || !['commit', 'tag'].includes(ref.object?.type) || !/^[a-f0-9]{40}$/.test(ref.object?.sha || '')) {
    throw new Error('Existing tag lookup returned an unexpected ref.');
  }
  const view = () => gh(['release', 'view', tag, '--repo', repository, '--json', 'tagName,isDraft,isPrerelease,assets']);
  const checkDraft = (draft, complete = false) => {
    if (draft.isDraft !== true) throw new Error('Refusing to overwrite an existing published release.');
    if (draft.tagName !== tag || draft.isPrerelease !== version.prerelease) throw new Error('Existing draft tag/prerelease mismatch.');
    if (!Array.isArray(draft.assets) || draft.assets.some(asset => !assetNames.includes(asset.name))
        || new Set(draft.assets.map(asset => asset.name)).size !== draft.assets.length) throw new Error('Unexpected draft asset inventory.');
    if (complete) {
      exact(draft.assets.map(asset => asset.name), assetNames);
      for (const asset of draft.assets) if (asset.state !== 'uploaded' || asset.size !== fs.statSync(path.join(cwd, asset.name)).size) {
        throw new Error('Incomplete uploaded asset inventory.');
      }
    }
  };
  const existing = view(); let retry = false;
  if (!existing.error && existing.status === 0) { checkDraft(JSON.parse(existing.stdout)); retry = true; }
  else {
    if (existing.error || !/^release not found\s*$/i.test((existing.stderr || '').trim())) throw new Error('Release lookup failed.');
    checked(gh(['release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--title', 'Magpie Filter ' + tag,
      '--notes', 'Native portable packages. See START-HERE.txt in each archive.', ...(version.prerelease ? ['--prerelease', '--latest=false'] : [])]), 'draft creation');
  }
  checked(gh(['release', 'upload', tag, ...assets, '--repo', repository, ...(retry ? ['--clobber'] : [])]), 'upload');
  checkDraft(JSON.parse(checked(view(), 'uploaded asset lookup')), true);
  checked(gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--prerelease=' + version.prerelease,
    '--latest=' + !version.prerelease]), 'publish');
  return {...version, assets, checksums: path.join(cwd, 'SHA256SUMS.txt')};
}
if (require.main === module) {
  try { console.log(JSON.stringify(release({tag: process.env.RELEASE_TAG, artifactDirectory: process.argv[2], outputDirectory: process.argv[3]}), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {validateTag, verifyArtifacts, release};
