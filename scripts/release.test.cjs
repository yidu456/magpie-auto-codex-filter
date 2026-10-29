'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {fixture} = require('../magpie-auto-codex-filter/test-support.cjs');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const names = ['MagpieFilter-windows-x64.zip', 'MagpieFilter-linux-x64.tar.gz',
  'MagpieFilter-macos-arm64.tar.gz', 'MagpieFilter-macos-x64.tar.gz'];
const assets = [...names, 'MagpieFilter.exe', 'LICENSE.txt', 'NODE-LICENSE.txt', 'SHA256SUMS.txt'];
function implementation() {
  assert.ok(fs.existsSync(path.join(__dirname, 'release.cjs')), 'The gated release helper must exist');
  return require('./release.cjs');
}
function input(t) {
  const root = fixture(t), artifactDirectory = path.join(root, 'download with spaces');
  const outputDirectory = path.join(root, 'assets with spaces'); fs.mkdirSync(artifactDirectory);
  const payloadRoot = path.join(root, 'payload'), payload = path.join(payloadRoot, 'MagpieFilter-windows-x64');
  fs.mkdirSync(payload, {recursive: true});
  for (const [file, text] of [['MagpieFilter.exe', 'owned EXE fixture'], ['LICENSE.txt', 'MIT fixture'],
    ['NODE-LICENSE.txt', 'Node.js Permission fixture'], ['START-HERE.txt', 'instructions fixture']]) fs.writeFileSync(path.join(payload, file), text);
  fs.writeFileSync(path.join(payload, 'SHA256SUMS.txt'), ['MagpieFilter.exe', 'LICENSE.txt', 'NODE-LICENSE.txt', 'START-HERE.txt']
    .map(file => hash(path.join(payload, file)) + '  ' + file + '\n').join(''));
  for (const name of names) {
    const directory = path.join(artifactDirectory, name.replace(/\.zip$|\.tar\.gz$/, '')); fs.mkdirSync(directory);
    const archive = path.join(directory, name);
    if (name.endsWith('.zip')) {
      // GNU tar cannot read ZIP; Unix tests use tar bytes while Windows exercises the real ZIP path.
      const made = spawnSync('tar', [process.platform === 'win32' ? '-acf' : '-cf', archive, '-C', payloadRoot, 'MagpieFilter-windows-x64'], {encoding: 'utf8', timeout: 10000});
      assert.equal(made.status, 0, made.stderr);
    } else fs.writeFileSync(archive, name + ' owned archive fixture');
    fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), hash(archive) + '  ' + name + '\n');
  }
  return {root, artifactDirectory, outputDirectory, payload, payloadRoot};
}
const environment = (tag = 'v0.1.0-dev') => ({GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/' + tag,
  GITHUB_REPOSITORY: 'owned/repository', GH_TOKEN: 'mock-token'});
function remote({existing = null, failUpload = false, missingTag = false, extraAfterUpload = false, viewFailure = false} = {}) {
  const calls = []; let draft = existing, uploaded = false;
  const execute = (command, argv, options) => {
    calls.push({command, argv, options});
    assert.equal(command, 'gh'); assert.equal(options.shell, false); assert.ok(options.timeout > 0);
    const tag = 'v0.1.0' + (argv.includes('v0.1.0-dev') || argv.some(value => value.endsWith('/v0.1.0-dev')) ? '-dev' : '');
    if (argv[0] === 'api') return missingTag ? {status: 1, stderr: 'HTTP 404'}
      : {status: 0, stdout: JSON.stringify({ref: 'refs/tags/' + tag, object: {type: 'commit', sha: 'a'.repeat(40)}})};
    if (argv[1] === 'view') {
      if (viewFailure) return {status: 1, stderr: 'HTTP 403'};
      if (!draft) return {status: 1, stderr: 'release not found'};
      return {status: 0, stdout: JSON.stringify({...draft, assets: uploaded
        ? [...assets.map(name => ({name, size: fs.statSync(path.join(options.cwd, name)).size, state: 'uploaded'})),
          ...(extraAfterUpload ? [{name: 'private-config.json', size: 1, state: 'uploaded'}] : [])] : draft.assets || []})};
    }
    if (argv[1] === 'create') draft = {tagName: tag, isDraft: true, isPrerelease: tag.includes('-'), assets: []};
    if (argv[1] === 'upload') {
      if (failUpload) return {status: 1, stderr: 'fixture upload failed'};
      uploaded = true;
    }
    if (argv[1] === 'edit') draft = {...draft, isDraft: false};
    return {status: 0, stdout: ''};
  };
  return {calls, execute, state: () => draft};
}

test('version tags reject ambiguous semver, shell input and unsupported build metadata', () => {
  const {validateTag} = implementation();
  for (const [tag, prerelease] of [['v0.1.0', false], ['v123.456.789', false], ['v0.1.0-dev', true], ['v1.2.3-rc.1', true]]) {
    assert.deepEqual(validateTag(tag), {tag, prerelease});
  }
  for (const tag of ['', '1.2.3', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-', 'v1.2.3-01', 'v1.2.3-rc..1',
    'v1.2.3+build', 'v1.2.3;echo secret', 'v1.2.3\n', '--draft', 'refs/tags/v1.2.3', 'v1.2.3-rc_1']) {
    assert.throws(() => validateTag(tag), /version tag/i, tag);
  }
});

test('download validation requires exactly four isolated archive/checksum artifacts and current hashes', t => {
  const {verifyArtifacts} = implementation(), {artifactDirectory} = input(t);
  assert.deepEqual(verifyArtifacts(artifactDirectory).map(file => path.basename(file)), names);
  const directory = path.join(artifactDirectory, 'MagpieFilter-linux-x64'), archive = path.join(directory, names[1]);
  fs.appendFileSync(archive, 'corruption'); assert.throws(() => verifyArtifacts(artifactDirectory), /checksum/i);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), hash(archive) + '  ' + names[1] + '\n');
  fs.writeFileSync(path.join(directory, 'private-config.json'), 'private'); assert.throws(() => verifyArtifacts(artifactDirectory), /inventory/i);
  fs.unlinkSync(path.join(directory, 'private-config.json'));
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), hash(archive) + '  ../' + names[1] + '\n');
  assert.throws(() => verifyArtifacts(artifactDirectory), /checksum/i);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), (hash(archive) + '  ' + names[1] + '\n').repeat(2));
  assert.throws(() => verifyArtifacts(artifactDirectory), /checksum/i);
  fs.unlinkSync(archive); assert.throws(() => verifyArtifacts(artifactDirectory), /inventory/i);
});

test('download validation rejects unexpected artifact directories and symlinked directories', t => {
  const {verifyArtifacts} = implementation(), {root, artifactDirectory} = input(t);
  const extra = path.join(artifactDirectory, 'foreign'); fs.mkdirSync(extra);
  assert.throws(() => verifyArtifacts(artifactDirectory), /inventory/i); fs.rmdirSync(extra);
  const original = path.join(artifactDirectory, 'MagpieFilter-linux-x64'), moved = path.join(root, 'moved');
  fs.renameSync(original, moved); fs.symlinkSync(moved, original, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyArtifacts(artifactDirectory), /regular|directory|symlink/i); fs.unlinkSync(original);
});

test('only matching tag push events can reach gh; branches, manual runs, PRs and hostile refs cannot publish', t => {
  const {release} = implementation(), directories = input(t);
  for (const env of [{...environment(), GITHUB_EVENT_NAME: 'workflow_dispatch'}, {...environment(), GITHUB_EVENT_NAME: 'pull_request'},
    {...environment(), GITHUB_REF: 'refs/heads/dev-2'}, {...environment(), GITHUB_REF: 'refs/tags/v0.1.0'},
    environment('v0.1.0-dev;echo token'), {...environment(), GITHUB_REPOSITORY: '../untrusted'}, {...environment(), GH_TOKEN: ''}]) {
    const gh = remote(); assert.throws(() => release({...directories, tag: 'v0.1.0-dev', env, execute: gh.execute}), /push|tag|repository|token/i);
    assert.equal(gh.calls.length, 0);
  }
  assert.equal(fs.existsSync(directories.outputDirectory), false);
});

test('verified assets publish through existing-tag lookup and draft upload before edit, with safe argv and prerelease not latest', t => {
  const {release} = implementation(), directories = input(t), gh = remote();
  const result = release({...directories, tag: 'v0.1.0-dev', env: environment(), execute: gh.execute});
  assert.equal(result.prerelease, true); assert.equal(gh.state().isDraft, false);
  assert.deepEqual(fs.readdirSync(directories.outputDirectory).sort(), [...assets].sort());
  for (const row of fs.readFileSync(result.checksums, 'utf8').trim().split('\n')) {
    const [sum, file] = row.split('  '); assert.equal(sum, hash(path.join(directories.outputDirectory, file)));
  }
  assert.equal(fs.readFileSync(result.checksums, 'utf8').trim().split('\n').length, 7);
  assert.deepEqual(gh.calls.map(call => call.argv.slice(0, 2)), [['api', 'repos/owned/repository/git/ref/tags/v0.1.0-dev'],
    ['release', 'view'], ['release', 'create'], ['release', 'upload'], ['release', 'view'], ['release', 'edit']]);
  assert.deepEqual(gh.calls[2].argv, ['release', 'create', 'v0.1.0-dev', '--repo', 'owned/repository', '--verify-tag',
    '--draft', '--title', 'Magpie Filter v0.1.0-dev', '--notes', 'Native portable packages. See START-HERE.txt in each archive.', '--prerelease', '--latest=false']);
  const upload = gh.calls[3].argv;
  assert.deepEqual(upload.slice(0, 3), ['release', 'upload', 'v0.1.0-dev']);
  assert.deepEqual(upload.filter(value => value.includes('assets with spaces')).map(value => path.basename(value)), assets);
  assert.equal(upload.includes('--clobber'), false);
  assert.deepEqual(gh.calls[5].argv, ['release', 'edit', 'v0.1.0-dev', '--repo', 'owned/repository', '--draft=false', '--prerelease=true', '--latest=false']);
});

test('stable tags publish as stable and latest without prerelease flags', t => {
  const {release} = implementation(), directories = input(t), gh = remote();
  release({...directories, tag: 'v0.1.0', env: environment('v0.1.0'), execute: gh.execute});
  assert.equal(gh.calls.find(call => call.argv[1] === 'create').argv.includes('--prerelease'), false);
  assert.ok(gh.calls.at(-1).argv.includes('--prerelease=false')); assert.ok(gh.calls.at(-1).argv.includes('--latest=true'));
});

test('missing tag, network lookup failure and published release all prevent remote mutation', t => {
  const {release} = implementation();
  for (const options of [{missingTag: true}, {viewFailure: true},
    {existing: {tagName: 'v0.1.0-dev', isDraft: false, isPrerelease: true, assets: []}}]) {
    const directories = input(t), gh = remote(options);
    assert.throws(() => release({...directories, tag: 'v0.1.0-dev', env: environment(), execute: gh.execute}), /tag|lookup|published/i);
    assert.equal(gh.calls.some(call => ['create', 'upload', 'edit'].includes(call.argv[1])), false);
  }
});

test('upload failure leaves an unpublished draft; a matching draft rerun can replace only its expected assets', t => {
  const {release} = implementation(), first = input(t), failing = remote({failUpload: true});
  assert.throws(() => release({...first, tag: 'v0.1.0-dev', env: environment(), execute: failing.execute}), /upload/i);
  assert.equal(failing.state().isDraft, true); assert.equal(failing.calls.some(call => call.argv[1] === 'edit'), false);
  const second = input(t), retry = remote({existing: {...failing.state(), assets: [{name: names[0], size: 1, state: 'uploaded'}]}});
  release({...second, tag: 'v0.1.0-dev', env: environment(), execute: retry.execute});
  assert.equal(retry.calls.some(call => call.argv[1] === 'create'), false);
  assert.ok(retry.calls.find(call => call.argv[1] === 'upload').argv.includes('--clobber'));
  assert.equal(retry.state().isDraft, false);
});

test('unexpected existing draft assets and post-upload remote inventory prevent publish', t => {
  const {release} = implementation();
  for (const options of [{existing: {tagName: 'v0.1.0-dev', isDraft: true, isPrerelease: true, assets: [{name: 'secret.json', size: 1, state: 'uploaded'}]}},
    {extraAfterUpload: true}, {existing: {tagName: 'v0.1.0-dev', isDraft: true, isPrerelease: false, assets: []}}]) {
    const directories = input(t), gh = remote(options);
    assert.throws(() => release({...directories, tag: 'v0.1.0-dev', env: environment(), execute: gh.execute}), /inventory|prerelease/i);
    assert.equal(gh.calls.some(call => call.argv[1] === 'edit'), false);
  }
});

test('archive corruption, unexpected Windows payload, and reused local output fail before gh', t => {
  const {release} = implementation();
  for (const mutation of ['hash', 'payload', 'output']) {
    const directories = input(t), gh = remote();
    const archive = path.join(directories.artifactDirectory, 'MagpieFilter-windows-x64', names[0]);
    if (mutation === 'hash') fs.appendFileSync(archive, 'modified');
    if (mutation === 'output') fs.mkdirSync(directories.outputDirectory);
    if (mutation === 'payload') {
      fs.writeFileSync(path.join(directories.payload, 'private-config.json'), 'private');
      assert.equal(spawnSync('tar', [process.platform === 'win32' ? '-acf' : '-cf', archive, '-C', directories.payloadRoot, 'MagpieFilter-windows-x64']).status, 0);
      fs.writeFileSync(path.join(path.dirname(archive), 'SHA256SUMS.txt'), hash(archive) + '  ' + names[0] + '\n');
    }
    assert.throws(() => release({...directories, tag: 'v0.1.0-dev', env: environment(), execute: gh.execute}), /checksum|inventory|exists/i);
    assert.equal(gh.calls.length, 0);
  }
});

test('Windows payload internal checksum mismatch and incomplete remote upload never publish', t => {
  const {release} = implementation(), directories = input(t), gh = remote();
  fs.appendFileSync(path.join(directories.payload, 'MagpieFilter.exe'), 'modified');
  const archive = path.join(directories.artifactDirectory, 'MagpieFilter-windows-x64', names[0]);
  assert.equal(spawnSync('tar', [process.platform === 'win32' ? '-acf' : '-cf', archive, '-C', directories.payloadRoot, 'MagpieFilter-windows-x64']).status, 0);
  fs.writeFileSync(path.join(path.dirname(archive), 'SHA256SUMS.txt'), hash(archive) + '  ' + names[0] + '\n');
  assert.throws(() => release({...directories, tag: 'v0.1.0-dev', env: environment(), execute: gh.execute}), /checksum/i);
  assert.equal(gh.calls.length, 0);
  const other = input(t), incomplete = remote();
  const execute = (command, argv, options) => {
    const result = incomplete.execute(command, argv, options);
    if (argv[1] === 'view' && incomplete.calls.some(call => call.argv[1] === 'upload')) {
      const data = JSON.parse(result.stdout); data.assets[0].size = 0; result.stdout = JSON.stringify(data);
    }
    return result;
  };
  assert.throws(() => release({...other, tag: 'v0.1.0-dev', env: environment(), execute}), /incomplete.*inventory/i);
  assert.equal(incomplete.calls.some(call => call.argv[1] === 'edit'), false);
});
