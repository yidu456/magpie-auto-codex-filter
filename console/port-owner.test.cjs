'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createPortOwner, parseWindows, parseProcSockets, parseProcStat, parseLsof, parsePs} = require('./port-owner.cjs');

const winOwner = {pid: 321, name: 'node.exe', executable: 'C:\\Node\\node.exe', started: '134060000000000001', user: 'S-1-5-21-fixture', parent: 111, critical: false};
const winSnapshot = owners => JSON.stringify({owners, currentUser: winOwner.user, ancestors: [100, 99, 1]});
function windowsFixture(owners = [winOwner]) {
  const commands = [], kills = [];
  let snapshot = owners;
  const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99,
    runCommand: async (file, args, options) => {
      commands.push({file, args, options});
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      if (script.includes('$expected =')) { kills.push(script); snapshot = []; return JSON.stringify({status: 'terminated'}); }
      return winSnapshot(snapshot);
    }, sleep: async () => {}});
  return {adapter, commands, kills, replace: owners => { snapshot = owners; }};
}

test('Windows parser restricts output to bounded complete metadata', () => {
  assert.equal(parseWindows(winSnapshot([winOwner])).owners[0].started, winOwner.started);
  for (const malformed of ['', '{', '{"owners":[]}', 'x'.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => parseWindows(malformed), {code: 'PORT_INSPECTION_FAILED'});
  }
});

test('procfs parser includes IPv4/IPv6 wildcard and loopback, not other addresses or established sockets', () => {
  const header = '  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
  const row = (address, state, inode) => `  0: ${address}:4711 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 ${inode} 1\n`;
  assert.deepEqual(parseProcSockets(header + row('00000000', '0A', 12) + row('0100007F', '0A', 13)
    + row('0200007F', '0A', 14) + row('0100007F', '01', 15), 18193, false), ['12', '13']);
  assert.deepEqual(parseProcSockets(header + row('00000000000000000000000000000000', '0A', 16)
    + row('0000000000000000FFFF00000100007F', '0A', 17)
    + row('00000000000000000000000001000000', '0A', 18), 18193, true), ['16', '17']);
  assert.throws(() => parseProcSockets(header + 'broken\n', 18193, false), {code: 'PORT_INSPECTION_FAILED'});
  assert.throws(() => parseProcSockets(header + row('00000000', '0A', 12).trimEnd(), 18193, false), {code: 'PORT_INSPECTION_FAILED'});
});

test('procfs process start parser handles parentheses without trusting comm as a command line', () => {
  const stat = '321 (fixture (name)) S 111 ' + Array(17).fill('0').join(' ') + ' 7654321 0\n';
  assert.deepEqual(parseProcStat(stat, 321), {name: 'fixture (name)', parent: 111, started: '7654321'});
  assert.throws(() => parseProcStat(stat, 322), {code: 'PORT_INSPECTION_FAILED'});
  assert.throws(() => parseProcStat('321 (bad) S 111', 321), {code: 'PORT_INSPECTION_FAILED'});
});

test('macOS lsof and ps parsers keep conflicting listeners and full metadata without arguments', () => {
  assert.deepEqual(parseLsof('p321\nfc7\nn127.0.0.1:18193\np322\nfc8\nn*:18193\np323\nfc9\nn[::1]:18193\n', 18193), [321, 322]);
  const record = parsePs(' 321 111 501 Wed Oct 28 08:09:10 2026 /Applications/Fixture App/fixture\n', 321);
  assert.deepEqual(record, {pid: 321, parent: 111, user: '501', started: 'Wed Oct 28 08:09:10 2026', executable: '/Applications/Fixture App/fixture', name: 'fixture', critical: false});
  for (const text of ['p321\nn*:18193', 'n*:18193\n', 'pnot-a-pid\nn*:18193\n']) {
    assert.throws(() => parseLsof(text, 18193), {code: 'PORT_INSPECTION_FAILED'});
  }
  assert.throws(() => parsePs('321 111 501 missing identity\n', 321), {code: 'PORT_INSPECTION_FAILED'});
});

test('Windows inspection uses fixed bounded hidden helper and exposes metadata only', async () => {
  const {adapter, commands} = windowsFixture();
  const result = await adapter.inspect(18193);
  assert.deepEqual(result, {port: 18193, owner: {pid: 321, name: 'node.exe', executable: 'C:\\Node\\node.exe', started: winOwner.started}, canTerminate: true, reason: null});
  assert.equal(Object.isFrozen(result.owner), true);
  assert.equal(JSON.stringify(result).includes(winOwner.user), false);
  assert.match(commands[0].file, /System32[\\/]WindowsPowerShell[\\/]v1.0[\\/]powershell.exe$/i);
  assert.equal(commands[0].options.shell, false);
  assert.equal(commands[0].options.windowsHide, true);
  assert.ok(commands[0].options.timeout > 0 && commands[0].options.maxBuffer <= 1024 * 1024);
});

test('port validation rejects non-numeric or out-of-range input before any command', async () => {
  const {adapter, commands} = windowsFixture();
  for (const port of [0, -1, 65536, NaN, 1.5, '18193', '1;exit']) {
    await assert.rejects(adapter.inspect(port), {code: 'INVALID_PORT'});
  }
  assert.equal(commands.length, 0);
});

test('ambiguous, incomplete, hostile, foreign-user, critical, root, self and ancestor identities fail closed', async () => {
  const cases = [
    [[winOwner, {...winOwner, pid: 322}], 'MULTIPLE_OWNERS'],
    [[{...winOwner, executable: ''}], 'IDENTITY_UNAVAILABLE'],
    [[{...winOwner, name: ''}], 'IDENTITY_UNAVAILABLE'],
    [[{...winOwner, started: ''}], 'IDENTITY_UNAVAILABLE'],
    [[{...winOwner, name: 'secret\ncommand'}], 'IDENTITY_UNAVAILABLE'],
    [[{...winOwner, user: 'foreign'}], 'NOT_CURRENT_USER'],
    [[{...winOwner, critical: true}], 'PROTECTED_PROCESS'],
    [[{...winOwner, critical: null}], 'IDENTITY_UNAVAILABLE'],
    [[{...winOwner, pid: 4}], 'PROTECTED_PROCESS'],
    [[{...winOwner, pid: 100}], 'PROTECTED_PROCESS'],
    [[{...winOwner, pid: 99}], 'PROTECTED_PROCESS'],
    [[{...winOwner, name: 'lsass.exe'}], 'PROTECTED_PROCESS']
  ];
  for (const [owners, reason] of cases) {
    const {adapter, kills} = windowsFixture(owners);
    const conflict = await adapter.inspect(18193);
    assert.equal(conflict.canTerminate, false, reason);
    assert.equal(conflict.reason, reason);
    await assert.rejects(adapter.terminate(18193, conflict.owner), {code: 'PORT_OWNER_UNSAFE'});
    assert.equal(kills.length, 0);
    assert.equal(JSON.stringify(conflict).includes('secret'), false);
  }
});

test('replaced PID/start/image/user and a changed port produce fresh conflict without a kill', async () => {
  for (const change of [{pid: 322}, {started: '134060000000000002'}, {executable: 'C:\\Other.exe'}, {user: 'foreign'}, {name: 'other.exe'}]) {
    const {adapter, kills, replace} = windowsFixture();
    const oldIdentity = (await adapter.inspect(18193)).owner;
    replace([{...winOwner, ...change}]);
    await assert.rejects(adapter.terminate(18193, oldIdentity), error => error.code === 'PORT_OWNER_CHANGED' && error.conflict.port === 18193);
    assert.equal(kills.length, 0);
  }
  const fixture = windowsFixture();
  const owner = (await fixture.adapter.inspect(18193)).owner;
  await assert.rejects(fixture.adapter.terminate(18194, owner), {code: 'PORT_OWNER_UNSAFE'});
  await assert.rejects(fixture.adapter.terminate(18193, {...owner}), {code: 'PORT_OWNER_UNSAFE'});
  assert.equal(fixture.kills.length, 0);
});

test('free port skips termination; confirmed owner termination is singular and bounded', async () => {
  const free = windowsFixture();
  const owner = (await free.adapter.inspect(18193)).owner;
  free.replace([]);
  assert.deepEqual(await free.adapter.terminate(18193, owner), {port: 18193, released: true});
  assert.equal(free.kills.length, 0);
  const occupied = windowsFixture();
  const confirmed = (await occupied.adapter.inspect(18193)).owner;
  assert.deepEqual(await occupied.adapter.terminate(18193, confirmed), {port: 18193, released: true});
  assert.equal(occupied.kills.length, 1);
});

test('missing tools, access denial and malformed helper outputs are safe display results without leaked errors', async () => {
  for (const output of [new Error('permission denied SECRET-command-line'), '{broken', JSON.stringify({owners: [], currentUser: '', ancestors: []})]) {
    const adapter = createPortOwner({platform: 'win32', runCommand: async () => { if (output instanceof Error) throw output; return output; }});
    const result = await adapter.inspect(18193);
    assert.deepEqual(result, {port: 18193, owner: null, canTerminate: false, reason: 'PORT_INSPECTION_FAILED'});
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});

test('a failed reinspection exposes an inspection error instead of killing a previously known owner', async () => {
  let calls = 0, kills = 0;
  const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99,
    runCommand: async (_file, args) => {
      if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('$expected =')) kills++;
      if (++calls > 1) throw new Error('permission denied SECRET');
      return winSnapshot([winOwner]);
    }});
  const owner = (await adapter.inspect(18193)).owner;
  await assert.rejects(adapter.terminate(18193, owner), error => error.code === 'PORT_INSPECTION_FAILED' && !error.message.includes('SECRET'));
  assert.equal(kills, 0);
});

test('termination surfaces native denial, helper failure, a new occupant and release timeout without repeated kills', async () => {
  for (const [status, expectedCode] of [['denied', 'PORT_TERMINATION_DENIED'], ['failed', 'PORT_TERMINATION_FAILED'], ['timeout', 'PORT_TERMINATION_TIMEOUT'], ['command-timeout', 'PORT_TERMINATION_TIMEOUT'], ['changed', 'PORT_OWNER_CHANGED'], ['terminated', 'PORT_RELEASE_TIMEOUT']]) {
    let kills = 0, time = 0;
    const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99, now: () => time,
      sleep: async ms => { time += ms; }, runCommand: async (_file, args) => {
        if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('$expected =')) {
          kills++;
          if (status === 'command-timeout') throw Object.assign(new Error('timeout SECRET'), {killed: true, code: null});
          return JSON.stringify({status});
        }
        return winSnapshot([winOwner]);
      }});
    const owner = (await adapter.inspect(18193)).owner;
    await assert.rejects(adapter.terminate(18193, owner), {code: expectedCode});
    assert.equal(kills, 1);
    await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_OWNER_UNSAFE'});
    assert.equal(kills, 1);
  }
  let calls = 0, kills = 0;
  const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99,
    runCommand: async (_file, args) => {
      if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('$expected =')) { kills++; return '{"status":"terminated"}'; }
      calls++;
      return winSnapshot([{...winOwner, pid: calls > 2 ? 322 : 321}]);
    }});
  const owner = (await adapter.inspect(18193)).owner;
  await assert.rejects(adapter.terminate(18193, owner), error => error.code === 'PORT_OWNER_CHANGED' && error.conflict.owner.pid === 322);
  assert.equal(kills, 1);
});

test('release waiting never schedules another inspection after its deadline', async () => {
  let time = 0, killed = false, inspectionsAfterKill = 0;
  const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99, now: () => time, sleep: async () => {},
    runCommand: async (_file, args) => {
      if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('$expected =')) { killed = true; return '{"status":"terminated"}'; }
      if (killed) { inspectionsAfterKill++; time += 5001; }
      return winSnapshot([winOwner]);
    }});
  const owner = (await adapter.inspect(18193)).owner;
  await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_RELEASE_TIMEOUT'});
  assert.equal(inspectionsAfterKill, 1);
});

test('a stalled post-kill inspection cannot extend the five-second release bound', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let killed = false, signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99,
    runCommand: async (_file, args) => {
      if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('$expected =')) { killed = true; return '{"status":"terminated"}'; }
      if (killed) { signalStarted(); return new Promise(() => {}); }
      return winSnapshot([winOwner]);
    }});
  const owner = (await adapter.inspect(18193)).owner;
  let failure;
  const pending = adapter.terminate(18193, owner).catch(error => { failure = error; });
  await started;
  t.mock.timers.tick(5000);
  await new Promise(resolve => setImmediate(resolve));
  const timedOut = failure?.code;
  t.mock.timers.tick(15000);
  await pending;
  assert.equal(timedOut, 'PORT_RELEASE_TIMEOUT');
});

test('wall-clock rollback cannot enlarge native release inspection timeouts', async t => {
  let clock = 100000, killed = false;
  t.mock.method(Date, 'now', () => clock);
  const timeouts = [];
  const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99, sleep: async () => { clock -= 100000; },
    runCommand: async (_file, args, options) => {
      if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('$expected =')) { killed = true; return '{"status":"terminated"}'; }
      if (killed) timeouts.push(options.timeout);
      return winSnapshot([winOwner]);
    }});
  const owner = (await adapter.inspect(18193)).owner;
  await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_RELEASE_TIMEOUT'});
  assert.ok(timeouts.every(timeout => Number.isInteger(timeout) && timeout > 0 && timeout <= 5000));
});

function linuxFixture({user = '1000', ownerUser = user, procName = 'fixture', inaccessible = false, duplicate = false, killError = null, replacement = null, lateReplacement = false, metadataReplacement = null, postKill = ['free']} = {}) {
  let live = true;
  const kills = [], signals = [];
  let socketReads = 0, lateChanged = false;
  let time = 0, observation = 'live', observations = 0;
  const header = ' sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
  const stat = (pid, parent, name, started) => `${pid} (${name}) S ${parent} ${Array(17).fill('0').join(' ')} ${started} 0\n`;
  const readFile = async file => {
    if (file === '/proc/net/tcp') {
      socketReads++;
      if (!live) observation = postKill[Math.min(observations++, postKill.length - 1)];
      if (observation === 'failed-table') throw Object.assign(new Error('denied'), {code: 'EACCES'});
      return header + (live || observation !== 'free' ? '0: 0100007F:4711 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345 1\n' : '');
    }
    if (file === '/proc/net/tcp6') return header;
    if (file === '/proc/sys/kernel/random/boot_id') return '11111111-1111-1111-1111-111111111111\n';
    if (file === '/proc/321/stat') return stat(321, 111, procName, lateChanged ? 7654329 : replacement && socketReads >= 3 ? replacement : 7654321);
    if (file === '/proc/322/stat') return stat(322, 111, 'second', 7654322);
    if (file === '/proc/100/stat') return stat(100, 99, 'node', 500);
    if (file === '/proc/99/stat') { if (lateReplacement && socketReads >= 3) lateChanged = true; return stat(99, 1, 'shell', 400); }
    if (/^\/proc\/32[12]\/status$/.test(file)) {
      if (observation === 'vanished-metadata') throw Object.assign(new Error('exited'), {code: 'ENOENT'});
      if (metadataReplacement === 'status' && socketReads >= 3) lateChanged = true;
      return `Name:\tfixture\nUid:\t${ownerUser}\t${ownerUser}\t${ownerUser}\t${ownerUser}\n`;
    }
    throw Object.assign(new Error('unavailable'), {code: 'ENOENT'});
  };
  const adapter = createPortOwner({platform: 'linux', currentPid: 100, currentPpid: 99, currentUser: user, readFile,
    readdir: async directory => {
      if (directory === '/proc') return [observation === 'new-owner' ? '322' : '321', ...(duplicate ? ['322'] : []), '100', '99', '1', 'net'];
      if (observation === 'unresolved' && directory.endsWith('/fd')) throw Object.assign(new Error('exited'), {code: 'ENOENT'});
      if (directory === '/proc/321/fd' && !inaccessible) return ['7'];
      if (directory === '/proc/322/fd') return ['8'];
      throw Object.assign(new Error('denied'), {code: 'EACCES'});
    }, readlink: async file => {
      if (file.endsWith('/exe')) {
        if (metadataReplacement === 'exe' && socketReads >= 3) lateChanged = true;
        return '/opt/fixture';
      }
      return 'socket:[12345]';
    },
    killProcess: (pid, signal) => { if (killError) throw Object.assign(new Error('denied SECRET'), {code: killError}); kills.push(pid); signals.push(signal); live = false; },
    now: () => time, sleep: async ms => { time += ms; }});
  return {adapter, kills, signals, elapsed: () => time, observations: () => observations};
}

for (const gap of ['unresolved', 'vanished-metadata', 'failed-table']) {
  test(`Linux post-kill ${gap} is retried until a fresh successful empty socket inspection`, async () => {
    const {adapter, kills, signals, observations} = linuxFixture({postKill: [gap, 'free']});
    const owner = (await adapter.inspect(18193)).owner;
    assert.deepEqual(await adapter.terminate(18193, owner), {port: 18193, released: true});
    assert.equal(observations(), 2);
    assert.deepEqual(kills, [321]); assert.deepEqual(signals, ['SIGKILL']);
    await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_OWNER_UNSAFE'});
  });
  test(`Linux persistent post-kill ${gap} fails within the existing release deadline without a second kill`, async () => {
    const {adapter, kills, elapsed} = linuxFixture({postKill: [gap]});
    const owner = (await adapter.inspect(18193)).owner;
    await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_RELEASE_TIMEOUT'});
    assert.equal(elapsed(), 5000); assert.deepEqual(kills, [321]);
  });
}

test('Linux new owner after a post-kill ownership gap needs fresh consent, never another kill', async () => {
  const {adapter, kills} = linuxFixture({postKill: ['unresolved', 'new-owner']});
  const owner = (await adapter.inspect(18193)).owner;
  await assert.rejects(adapter.terminate(18193, owner), error => error.code === 'PORT_OWNER_CHANGED' && error.conflict.owner?.pid === 322);
  assert.deepEqual(kills, [321]);
  await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_OWNER_UNSAFE'});
});

test('Windows post-kill inspection failure still fails immediately without a second kill', async () => {
  let killed = false;
  const adapter = createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99,
    runCommand: async (_file, args) => {
      if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('$expected =')) { killed = true; return '{"status":"terminated"}'; }
      if (killed) throw Object.assign(new Error('denied'), {code: 'EACCES'});
      return winSnapshot([winOwner]);
    }, sleep: async () => assert.fail('Windows inspection failure must not be retried')});
  const owner = (await adapter.inspect(18193)).owner;
  await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_INSPECTION_FAILED'});
  await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_OWNER_UNSAFE'});
});

test('Linux procfs discovers socket owners and revalidates full same-user identity before one PID SIGKILL', async () => {
  const {adapter, kills, signals} = linuxFixture();
  const result = await adapter.inspect(18193);
  assert.deepEqual(result, {port: 18193, owner: {pid: 321, name: 'fixture', executable: '/opt/fixture', started: '11111111-1111-1111-1111-111111111111:7654321'}, canTerminate: true, reason: null});
  await adapter.terminate(18193, result.owner);
  assert.deepEqual(kills, [321]);
  assert.deepEqual(signals, ['SIGKILL']);
});

test('Linux shared sockets are ambiguous, final start revalidation rejects reuse, and permission denial is stable', async () => {
  const shared = linuxFixture({duplicate: true});
  const ambiguous = await shared.adapter.inspect(18193);
  assert.equal(ambiguous.reason, 'MULTIPLE_OWNERS');
  await assert.rejects(shared.adapter.terminate(18193, ambiguous.owner), {code: 'PORT_OWNER_UNSAFE'});
  assert.equal(shared.kills.length, 0);
  const reused = linuxFixture({replacement: '7654329'});
  const oldIdentity = (await reused.adapter.inspect(18193)).owner;
  await assert.rejects(reused.adapter.terminate(18193, oldIdentity), {code: 'PORT_OWNER_CHANGED'});
  assert.equal(reused.kills.length, 0);
  const late = linuxFixture({lateReplacement: true});
  const lateOwner = (await late.adapter.inspect(18193)).owner;
  await assert.rejects(late.adapter.terminate(18193, lateOwner), {code: 'PORT_OWNER_CHANGED'});
  assert.equal(late.kills.length, 0);
  const denied = linuxFixture({killError: 'EPERM'});
  const owner = (await denied.adapter.inspect(18193)).owner;
  await assert.rejects(denied.adapter.terminate(18193, owner), {code: 'PORT_TERMINATION_DENIED'});
  assert.equal(denied.kills.length, 0);
});

for (const metadataReplacement of ['status', 'exe']) {
  test(`Linux replacement during final ${metadataReplacement} read cannot retain the old start identity`, async () => {
    const {adapter, kills} = linuxFixture({metadataReplacement});
    const owner = (await adapter.inspect(18193)).owner;
    await assert.rejects(adapter.terminate(18193, owner), {code: 'PORT_OWNER_CHANGED'});
    assert.equal(kills.length, 0);
  });
}

test('Linux root, inaccessible socket ownership and hostile process names cannot be terminated', async () => {
  for (const [options, reason] of [[{ownerUser: '0'}, 'PROTECTED_PROCESS'], [{inaccessible: true}, 'OWNERSHIP_UNAVAILABLE'], [{procName: 'bad\nname'}, 'IDENTITY_UNAVAILABLE']]) {
    const {adapter, kills} = linuxFixture(options);
    const result = await adapter.inspect(18193);
    assert.equal(result.canTerminate, false);
    assert.equal(result.reason, reason);
    await assert.rejects(adapter.terminate(18193, result.owner), {code: 'PORT_OWNER_UNSAFE'});
    assert.equal(kills.length, 0);
  }
});

test('macOS coarse ps identity is display-only and never terminates an unsupported identity', async () => {
  const commands = [], kills = [];
  const adapter = createPortOwner({platform: 'darwin', currentPid: 100, currentPpid: 99, currentUser: '501',
    runCommand: async (file, args) => {
      commands.push({file, args});
      if (file === '/usr/sbin/lsof') return 'p321\nf7\nn*:18193\n';
      const pid = Number(args[1]);
      return `${pid} ${pid === 321 ? 111 : pid === 100 ? 99 : 1} 501 Wed Oct 28 08:09:10 2026 /opt/fixture\n`;
    }, killProcess: pid => kills.push(pid)});
  const result = await adapter.inspect(18193);
  assert.equal(result.owner.pid, 321);
  assert.equal(result.canTerminate, false);
  assert.equal(result.reason, 'IDENTITY_UNAVAILABLE');
  await assert.rejects(adapter.terminate(18193, result.owner), {code: 'PORT_OWNER_UNSAFE'});
  assert.equal(kills.length, 0);
  assert.ok(commands.every(({file}) => file === '/usr/sbin/lsof' || file === '/bin/ps'));
});

test('macOS basename ancestor does not erase tracked listener metadata or permit termination', async () => {
  const records = {
    321: ' 321 100 501 Thu Oct 29 03:21:09 2026     /Users/runner/hostedtoolcache/node/24.12.0/arm64/bin/node\n',
    100: ' 100 99 501 Thu Oct 29 03:21:09 2026     /Users/runner/hostedtoolcache/node/24.12.0/arm64/bin/node\n',
    99: ' 99 1 501 Thu Oct 29 03:20:49 2026     node\n'
  };
  const adapter = createPortOwner({platform: 'darwin', currentPid: 100, currentPpid: 99, currentUser: '501',
    runCommand: async (file, args) => {
      if (file === '/usr/sbin/lsof') return 'p321\nf7\nn*:18193\n';
      return records[Number(args[1])];
    }, killProcess: () => assert.fail('macOS inspection must never kill')});
  const conflict = await adapter.inspect(18193);
  assert.deepEqual(conflict, {port: 18193, owner: {pid: 321, name: 'node',
    executable: '/Users/runner/hostedtoolcache/node/24.12.0/arm64/bin/node', started: 'Thu Oct 29 03:21:09 2026'},
    canTerminate: false, reason: 'IDENTITY_UNAVAILABLE'});
  await assert.rejects(adapter.terminate(18193, conflict.owner), {code: 'PORT_OWNER_UNSAFE'});
});

test('macOS basename listener stays display-only and malformed ancestors still fail closed', async () => {
  for (const [ancestor, reason] of [
    ['99 1 501 Thu Oct 29 03:20:49 2026 node\n', 'IDENTITY_UNAVAILABLE'],
    ['99 100 501 Thu Oct 29 03:20:49 2026 node\n', 'PORT_INSPECTION_FAILED'],
    ['98 1 501 Thu Oct 29 03:20:49 2026 node\n', 'PORT_INSPECTION_FAILED'],
    ['99 1 501 Thu Oct 29 03:20:49 2026 bad\x00name\n', 'PORT_INSPECTION_FAILED'],
    ['99 1 501 missing identity\n', 'PORT_INSPECTION_FAILED']
  ]) {
    const adapter = createPortOwner({platform: 'darwin', currentPid: 100, currentPpid: 99, currentUser: '501',
      runCommand: async (file, args) => {
        if (file === '/usr/sbin/lsof') return 'p321\nf7\nn*:18193\n';
        const pid = Number(args[1]);
        return pid === 99 ? ancestor : `${pid} ${pid === 100 ? 99 : 100} 501 Thu Oct 29 03:21:09 2026 node\n`;
      }, killProcess: () => assert.fail('macOS basename metadata must never permit termination')});
    const conflict = await adapter.inspect(18193);
    assert.equal(conflict.canTerminate, false);
    assert.equal(conflict.reason, reason);
    assert.deepEqual(conflict.owner, reason === 'IDENTITY_UNAVAILABLE'
      ? {pid: 321, name: 'node', executable: 'node', started: 'Thu Oct 29 03:21:09 2026'} : null);
    await assert.rejects(adapter.terminate(18193, conflict.owner), {code: 'PORT_OWNER_UNSAFE'});
  }
});

test('native Windows terminates only a tracked disposable listener while an unrelated fixture survives', {skip: process.platform !== 'win32', timeout: 120000}, async t => {
  const {spawn, execFile} = require('node:child_process');
  const {promisify} = require('node:util');
  const {once} = require('node:events');
  const execute = promisify(execFile);
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  });
  async function listener(host) {
    const source = "const net=require('node:net'); const server=net.createServer(); server.listen(0," + JSON.stringify(host)
      + ",()=>process.stdout.write(JSON.stringify({port:server.address().port})+'\\n'));";
    const child = spawn(process.execPath, ['-e', source], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    children.push(child);
    const [data] = await once(child.stdout, 'data');
    return {child, port: JSON.parse(data.toString()).port};
  }
  const target = await listener('0.0.0.0'), unrelated = await listener('127.0.0.1');
  const unicodeName = '\u6d4b\u8bd5-fixture.exe';
  const unicodeAdapter = createPortOwner({runCommand: async (file, args, options) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
      .replace('$owners += (Owner $id $h)', "$metadata = Owner $id $h; $metadata.name = '" + unicodeName + "'; $owners += $metadata");
    const {stdout} = await execute(file, [...args.slice(0, -1), Buffer.from(script, 'utf16le').toString('base64')], options);
    return stdout;
  }});
  assert.equal((await unicodeAdapter.inspect(target.port)).owner?.name, unicodeName);
  let changed = false;
  const kills = [];
  const adapter = createPortOwner({runCommand: async (file, args, options) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    if (script.includes('$expected =')) {
      const encoded = /FromBase64String\('([^']+)'\)/.exec(script)[1];
      const expected = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      assert.equal(expected.pid, target.child.pid, 'The test may only terminate its own tracked child');
      kills.push(expected.pid);
    }
    const {stdout} = await execute(file, args, options);
    if (!changed || script.includes('$expected =')) return stdout;
    const snapshot = JSON.parse(stdout);
    for (const owner of snapshot.owners || []) owner.started = String(BigInt(owner.started) + 1n);
    return JSON.stringify(snapshot);
  }});
  const first = await adapter.inspect(target.port);
  assert.equal(first.owner?.pid, target.child.pid);
  assert.equal(first.canTerminate, true, first.reason);
  changed = true;
  await assert.rejects(adapter.terminate(target.port, first.owner), {code: 'PORT_OWNER_CHANGED'});
  assert.equal(kills.length, 0);
  assert.equal(target.child.exitCode, null);
  changed = false;
  const confirmed = await adapter.inspect(target.port);
  const exited = once(target.child, 'exit');
  assert.deepEqual(await adapter.terminate(target.port, confirmed.owner), {port: target.port, released: true});
  await exited;
  assert.deepEqual(kills, [target.child.pid]);
  assert.equal(unrelated.child.exitCode, null);
  assert.equal((await adapter.inspect(unrelated.port)).owner?.pid, unrelated.child.pid);
});

test('native Unix inspects a tracked listener, Linux revalidates before one kill and macOS stays display-only',
  {skip: !['linux', 'darwin'].includes(process.platform), timeout: 90000}, async t => {
    const {spawn, execFile} = require('node:child_process'), {once} = require('node:events');
    const execute = require('node:util').promisify(execFile);
    const children = [];
    t.after(async () => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
      }
    });
    const launch = async () => {
      const child = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(0,'0.0.0.0',function(){console.log(this.address().port)})"],
        {stdio: ['ignore', 'pipe', 'pipe']}); children.push(child);
      const [data] = await once(child.stdout, 'data'); return {child, port: Number(String(data).trim())};
    };
    const target = await launch(), other = await launch();
    const diagnostics = [];
    const record = (file, args, result) => {
      if (diagnostics.length < 16) diagnostics.push({file, args, code: result.code,
        stdout: String(result.stdout || '').slice(0, 4096), stderr: String(result.stderr || '').slice(0, 4096)});
    };
    const runCommand = process.platform !== 'darwin' ? undefined : async (file, args, options) => {
      try { const result = await execute(file, args, options); record(file, args, result); return result.stdout; }
      catch (error) { record(file, args, error); throw error; }
    };
    const killed = [], adapter = createPortOwner({runCommand, killProcess: (pid, signal) => {
      assert.equal(pid, target.child.pid); assert.equal(signal, 'SIGKILL');
      killed.push(pid); process.kill(pid, signal);
    }});
    const conflict = await adapter.inspect(target.port);
    if (process.platform === 'darwin' && conflict.owner?.pid !== target.child.pid) {
      const commands = [
        ...[target.child.pid, process.pid, process.ppid].map(pid => ['/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,uid=,lstart=,comm=']])
      ];
      t.diagnostic('Tracked macOS owner failure: ' + JSON.stringify(conflict));
      for (const diagnostic of diagnostics) t.diagnostic(JSON.stringify(diagnostic));
      for (const [file, args] of commands) {
        try {
          const {stdout, stderr} = await execute(file, args, {encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024, shell: false});
          t.diagnostic(JSON.stringify({file, args, stdout: stdout.slice(0, 4096), stderr: stderr.slice(0, 4096)}));
        } catch (error) {
          t.diagnostic(JSON.stringify({file, args, code: error.code, stdout: String(error.stdout || '').slice(0, 4096), stderr: String(error.stderr || '').slice(0, 4096)}));
        }
      }
    }
    assert.equal(conflict.owner?.pid, target.child.pid);
    assert.ok(conflict.owner.executable.startsWith('/')); assert.ok(conflict.owner.started);
    if (process.platform === 'darwin' || process.getuid() === 0) {
      assert.equal(conflict.canTerminate, false);
      assert.equal(conflict.reason, process.getuid() === 0 ? 'PROTECTED_PROCESS' : 'IDENTITY_UNAVAILABLE');
      await assert.rejects(adapter.terminate(target.port, conflict.owner), {code: 'PORT_OWNER_UNSAFE'});
      assert.deepEqual(killed, []);
    } else {
      assert.equal(conflict.canTerminate, true);
      const ended = once(target.child, 'exit');
      assert.deepEqual(await adapter.terminate(target.port, conflict.owner), {port: target.port, released: true});
      await ended; assert.deepEqual(killed, [target.child.pid]);
      assert.equal(target.child.signalCode, 'SIGKILL');
    }
    assert.equal(other.child.exitCode, null); assert.equal(other.child.signalCode, null);
  });
