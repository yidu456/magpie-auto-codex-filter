'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const MAX_OUTPUT = 1024 * 1024;
const COMMAND_TIMEOUT = 20000;
const RELEASE_TIMEOUT = 5000;
const MAX_ENTRIES = 8192;
const commandOptions = Object.freeze({encoding: 'utf8', timeout: COMMAND_TIMEOUT, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false});
const protectedNames = new Set(['system', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'winlogon', 'svchost', 'dwm', 'systemd', 'init', 'launchd', 'kernel_task']);
const fail = (code, conflict) => Object.assign(new Error(code), {code}, conflict ? {conflict} : {});
const validPid = pid => Number.isInteger(pid) && pid > 0 && pid <= 2147483647;
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
function bounded(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_OUTPUT) throw fail('PORT_INSPECTION_FAILED');
  return value;
}
function lines(value) {
  bounded(value);
  if (value && !value.endsWith('\n')) throw fail('PORT_INSPECTION_FAILED');
  const result = value.trimEnd().split('\n').filter(Boolean);
  if (result.length > MAX_ENTRIES) throw fail('PORT_INSPECTION_FAILED');
  return result;
}
function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('INVALID_PORT');
}

function parseWindows(output) {
  try {
    const record = JSON.parse(bounded(output));
    if (!record || !Array.isArray(record.owners) || record.owners.length > MAX_ENTRIES
      || !text(record.currentUser, 256) || !Array.isArray(record.ancestors)
      || !record.ancestors.length || record.ancestors.length > 128 || !record.ancestors.every(validPid)
      || !record.owners.every(owner => owner && validPid(owner.pid))) throw fail('PORT_INSPECTION_FAILED');
    return record;
  } catch { throw fail('PORT_INSPECTION_FAILED'); }
}

function parseProcSockets(output, port, ipv6) {
  const rows = lines(output);
  if (!rows.length || !rows.shift().includes('local_address')) throw fail('PORT_INSPECTION_FAILED');
  const found = [];
  for (const row of rows) {
    const fields = row.trim().split(/\s+/);
    const local = /^([0-9A-F]+):([0-9A-F]{4})$/i.exec(fields[1] || '');
    if (fields.length < 10 || !/^\d+:$/.test(fields[0]) || !local || local[1].length !== (ipv6 ? 32 : 8)
      || !/^[0-9A-F]{2}$/i.test(fields[3]) || !/^\d+$/.test(fields[9])) throw fail('PORT_INSPECTION_FAILED');
    const address = local[1].toUpperCase();
    const conflicts = ipv6 ? ['00000000000000000000000000000000', '0000000000000000FFFF00000100007F'].includes(address)
      : ['00000000', '0100007F'].includes(address);
    if (conflicts && parseInt(local[2], 16) === port && fields[3].toUpperCase() === '0A') {
      if (fields[9] === '0') throw fail('OWNERSHIP_UNAVAILABLE');
      found.push(fields[9]);
    }
  }
  return [...new Set(found)];
}

function parseProcStat(output, pid) {
  bounded(output);
  const end = output.lastIndexOf(') ');
  const prefix = /^(\d+) \(/.exec(output);
  const fields = output.slice(end + 2).trim().split(/\s+/);
  if (!prefix || Number(prefix[1]) !== pid || end < prefix[0].length || fields.length < 20
    || !/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[19])) throw fail('PORT_INSPECTION_FAILED');
  return {name: output.slice(prefix[0].length, end), parent: Number(fields[1]), started: fields[19]};
}

function parseLsof(output, port) {
  const found = new Set();
  let pid;
  for (const line of lines(output)) {
    if (line.startsWith('p')) {
      if (!/^p\d+$/.test(line) || !validPid(Number(line.slice(1)))) throw fail('PORT_INSPECTION_FAILED');
      pid = Number(line.slice(1));
    } else if (line.startsWith('n')) {
      if (!pid) throw fail('PORT_INSPECTION_FAILED');
      const endpoint = /^(\*|127\.0\.0\.1|\[::\]|\[::ffff:127\.0\.0\.1\]):(\d+)$/.exec(line.slice(1));
      if (endpoint && Number(endpoint[2]) === port) found.add(pid);
    } else if (!/^f[^\x00-\x1f]*$/.test(line)) throw fail('PORT_INSPECTION_FAILED');
  }
  return [...found];
}

function parsePs(output, pid) {
  const rows = lines(output);
  const match = rows.length === 1 && /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/.exec(rows[0]);
  // macOS comm may be a basename; absolute-path and strong-identity checks belong to safety().
  if (!match || Number(match[1]) !== pid || !text(match[5], 4096)) throw fail('PORT_INSPECTION_FAILED');
  return {pid, parent: Number(match[2]), user: match[3], started: match[4], executable: match[5], name: path.posix.basename(match[5]), critical: false};
}

async function nativeReadFile(file) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_OUTPUT + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_OUTPUT) throw fail('PORT_INSPECTION_FAILED');
    return buffer.subarray(0, length).toString('utf8');
  } finally { await handle.close(); }
}
const nativeExec = promisify(execFile);
async function nativeCommand(file, args, options) {
  const {stdout} = await nativeExec(file, args, options);
  return stdout;
}

// The helper keeps a Windows process handle open through identity checks and TerminateProcess.
const windowsHelper = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$watch = [Diagnostics.Stopwatch]::StartNew()
$nativeSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class PortOwnerNative {
  [StructLayout(LayoutKind.Sequential)] struct BasicInfo { public IntPtr Exit, Peb, Affinity, Priority, Id, Parent; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int kind, out BasicInfo info, int size, out int length);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder image, ref uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessCritical(IntPtr handle, out bool critical);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr handle, uint code);
  public static string Start(IntPtr handle) {
    long c,e,k,u; if (!GetProcessTimes(handle,out c,out e,out k,out u)) throw new Win32Exception(); return c.ToString(System.Globalization.CultureInfo.InvariantCulture);
  }
  public static string Image(IntPtr handle) {
    uint size=32768; var b=new StringBuilder((int)size); if (!QueryFullProcessImageName(handle,0,b,ref size)) throw new Win32Exception(); return b.ToString();
  }
  public static bool Critical(IntPtr handle) {
    bool value; if (!IsProcessCritical(handle,out value)) throw new Win32Exception(); return value;
  }
  public static int Parent(IntPtr handle) {
    BasicInfo info; int size; if (NtQueryInformationProcess(handle,0,out info,Marshal.SizeOf(typeof(BasicInfo)),out size) != 0) throw new Win32Exception();
    return checked((int)info.Parent.ToInt64());
  }
}
'@
function Listeners {
  @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue -ErrorVariable netErrors |
    Where-Object { $_.LocalAddress -in @('0.0.0.0', '::', '127.0.0.1', '::ffff:127.0.0.1') } |
    Select-Object -ExpandProperty OwningProcess -Unique)
  if ($netErrors -and @($netErrors | Where-Object { $_.FullyQualifiedErrorId -notlike 'CmdletizationQuery_NotFound*' }).Count) { throw 'INSPECTION' }
}
function Ancestors {
  $seen = New-Object 'System.Collections.Generic.HashSet[int]'
  $next = $self
  for ($i=0; $i -lt 128; $i++) {
    if ($next -le 0) { return ,@($seen) }
    if (-not $seen.Add($next)) { throw 'INSPECTION' }
    if ($next -le 4) { return ,@($seen) }
    $h = [PortOwnerNative]::OpenProcess(0x1000, $false, [uint32]$next)
    if ($h -eq [IntPtr]::Zero) {
      $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $next)
      if (-not $p) { return ,@($seen) }
      $next = [int]$p.ParentProcessId
      continue
    }
    try { $next = [PortOwnerNative]::Parent($h) }
    finally { [PortOwnerNative]::CloseHandle($h) | Out-Null }
  }
  throw 'INSPECTION'
}
function Owner($id, $handle) {
  $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$id)
  if (-not $p) { throw 'CHANGED' }
  $u = Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
  if ($u.ReturnValue -ne 0 -or -not $u.Sid) { throw 'DENIED' }
  @{ pid=[int]$id; name=[string]$p.Name; executable=[PortOwnerNative]::Image($handle);
    started=[PortOwnerNative]::Start($handle); user=[string]$u.Sid; parent=[int]$p.ParentProcessId;
    critical=[PortOwnerNative]::Critical($handle) }
}
function Protected($owner, $ancestors) {
  $name = [IO.Path]::GetFileNameWithoutExtension($owner.name).ToLowerInvariant()
  $owner.pid -le 4 -or $owner.critical -or $ancestors -contains $owner.pid -or
    $owner.user -in @('S-1-5-18','S-1-5-19','S-1-5-20') -or
    $name -in @('system','registry','smss','csrss','wininit','services','lsass','winlogon','svchost','dwm')
}
try {
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $ids = @(Listeners)
  # A free port needs no process handles; avoid compiler startup during bounded release polling.
  if ($ids.Count) { Add-Type -TypeDefinition $nativeSource | Out-Null }
  $ancestors = if ($ids.Count) { Ancestors } else { @($self) }
  if ($mode -eq 'inspect') {
    $owners = @()
    foreach ($id in $ids) {
      $h = [PortOwnerNative]::OpenProcess(0x1000, $false, [uint32]$id)
      if ($h -eq [IntPtr]::Zero) {
        $owners += @{pid=[int]$id; name=''; executable=''; started=''; user=''; critical=$null}; continue
      }
      try { $owners += (Owner $id $h) } catch { $owners += @{pid=[int]$id; name=''; executable=''; started=''; user=''; critical=$null} }
      finally { [PortOwnerNative]::CloseHandle($h) | Out-Null }
    }
    @{owners=@($owners);currentUser=$currentUser;ancestors=@($ancestors)} | ConvertTo-Json -Compress -Depth 5
  } else {
    if ($ids.Count -eq 0) { @{status='free'} | ConvertTo-Json -Compress; exit }
    if ($ids.Count -ne 1 -or $ids[0] -ne $expected.pid) { throw 'CHANGED' }
    $h = [PortOwnerNative]::OpenProcess(0x1001, $false, [uint32]$expected.pid)
    if ($h -eq [IntPtr]::Zero) { throw 'DENIED' }
    try {
      $owner = Owner $expected.pid $h
      foreach ($field in @('pid','name','executable','started','user')) {
        if ([string]$owner[$field] -cne [string]$expected.$field) { throw 'CHANGED' }
      }
      if ($owner.user -cne $currentUser -or (Protected $owner $ancestors)) { throw 'DENIED' }
      $ids = @(Listeners)
      if ($ids.Count -eq 0) { @{status='free'} | ConvertTo-Json -Compress; exit }
      if ($ids.Count -ne 1 -or $ids[0] -ne $expected.pid) { throw 'CHANGED' }
      if ([PortOwnerNative]::Start($h) -cne $expected.started) { throw 'CHANGED' }
      if ($watch.ElapsedMilliseconds -gt 17000) { throw 'TIMEOUT' }
      if (-not [PortOwnerNative]::TerminateProcess($h, 1)) { throw 'DENIED' }
      @{status='terminated'} | ConvertTo-Json -Compress
    } finally { [PortOwnerNative]::CloseHandle($h) | Out-Null }
  }
} catch {
  $status = switch ([string]$_.Exception.Message) { 'CHANGED' {'changed'} 'DENIED' {'denied'} 'TIMEOUT' {'timeout'} default {'failed'} }
  @{status=$status} | ConvertTo-Json -Compress
}
`;

function createPortOwner({platform = process.platform, currentPid = process.pid, currentPpid = process.ppid,
  currentUser = typeof process.getuid === 'function' ? String(process.getuid()) : null,
  runCommand = nativeCommand, readFile = nativeReadFile, readdir = fs.readdir, readlink = fs.readlink,
  killProcess = (pid, signal) => process.kill(pid, signal), now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const known = new WeakMap();
  const powershell = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const checked = async (operation, timeout = COMMAND_TIMEOUT, timeoutCode = 'PORT_INSPECTION_FAILED') => {
    let timer;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail(timeoutCode)), timeout);
      })]);
    } finally { clearTimeout(timer); }
  };
  const ps = async pid => parsePs(await runCommand('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,uid=,lstart=,comm='], commandOptions), pid);
  async function windows(port, expected, timeout = COMMAND_TIMEOUT) {
    const setup = `$port = ${port}; $self = ${currentPid}; $mode = '${expected ? 'terminate' : 'inspect'}'\n`;
    const data = expected ? "$expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"
      + Buffer.from(JSON.stringify(expected)).toString('base64') + "')) | ConvertFrom-Json\n" : '';
    return bounded(await runCommand(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(setup + data + windowsHelper, 'utf16le').toString('base64')], {...commandOptions, timeout}));
  }
  async function linuxIdentity(pid, boot) {
    const [status, executable] = await Promise.all([readFile(`/proc/${pid}/status`), readlink(`/proc/${pid}/exe`)]);
    // Read start identity last; pending metadata must not preserve an earlier process identity.
    const record = parseProcStat(await readFile(`/proc/${pid}/stat`), pid);
    const uid = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(bounded(status));
    return {pid, ...record, executable, started: boot + ':' + record.started,
      user: uid && uid.slice(1).every(value => value === uid[1]) ? uid[1] : null, critical: false};
  }
  async function ancestors(readProcess) {
    const result = [currentPid];
    let pid = currentPid;
    while (pid > 1) {
      const record = await readProcess(pid);
      pid = record.parent;
      if (!validPid(pid) || result.includes(pid) || result.length >= 128) throw fail('PORT_INSPECTION_FAILED');
      result.push(pid);
    }
    if (!result.includes(currentPpid)) throw fail('PORT_INSPECTION_FAILED');
    return result;
  }
  async function collect(port, timeout = COMMAND_TIMEOUT) {
    if (platform === 'win32') return parseWindows(await windows(port, null, timeout));
    if (platform === 'darwin') {
      let output;
      try { output = await runCommand('/usr/sbin/lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-F', 'pfn'], commandOptions); }
      catch (error) {
        if (error.code === 1 && error.stdout === '' && !error.stderr) output = ''; else throw error;
      }
      const owners = await Promise.all(parseLsof(output, port).map(ps));
      // shortcut: macOS ps exposes whole-second starts; display only until a native strong-identity helper is available.
      return {owners, currentUser, ancestors: owners.length ? await ancestors(ps) : [currentPid, currentPpid], identitySupported: false};
    }
    if (platform !== 'linux') throw fail('PLATFORM_UNSUPPORTED');
    const [tcp, tcp6] = await Promise.all([readFile('/proc/net/tcp'), readFile('/proc/net/tcp6')]);
    const inodes = new Set([...parseProcSockets(tcp, port, false), ...parseProcSockets(tcp6, port, true)]);
    if (!inodes.size) return {owners: [], currentUser, ancestors: [currentPid, currentPpid]};
    const pids = (await readdir('/proc')).filter(value => /^\d+$/.test(value));
    if (pids.length > MAX_ENTRIES) throw fail('PORT_INSPECTION_FAILED');
    const owners = new Set(), resolved = new Set();
    const deadline = now() + COMMAND_TIMEOUT;
    for (const entry of pids) {
      if (!validPid(Number(entry)) || now() > deadline) throw fail('PORT_INSPECTION_FAILED');
      let fds;
      try { fds = await readdir(`/proc/${entry}/fd`); } catch (error) {
        if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) continue; throw error;
      }
      if (fds.length > MAX_ENTRIES) throw fail('PORT_INSPECTION_FAILED');
      for (const fd of fds) {
        if (!/^\d+$/.test(fd)) continue;
        let link;
        try { link = await readlink(`/proc/${entry}/fd/${fd}`); } catch (error) {
          if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) continue; throw error;
        }
        const match = /^socket:\[(\d+)\]$/.exec(link);
        if (match && inodes.has(match[1])) { owners.add(Number(entry)); resolved.add(match[1]); }
      }
    }
    if (resolved.size !== inodes.size) throw fail('OWNERSHIP_UNAVAILABLE');
    const boot = (await readFile('/proc/sys/kernel/random/boot_id')).trim();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(boot)) throw fail('PORT_INSPECTION_FAILED');
    const protectedPids = await ancestors(async pid => parseProcStat(await readFile(`/proc/${pid}/stat`), pid));
    const records = await Promise.all([...owners].map(pid => linuxIdentity(pid, boot)));
    return {owners: records, currentUser, ancestors: protectedPids};
  }
  function safety(raw, snapshot) {
    const protectedUser = platform === 'win32' ? ['S-1-5-18', 'S-1-5-19', 'S-1-5-20'].includes(raw.user) : raw.user === '0';
    if (raw.pid <= (platform === 'win32' ? 4 : 1) || snapshot.ancestors.includes(raw.pid) || raw.pid === currentPid || raw.pid === currentPpid
      || raw.critical === true || protectedUser || protectedNames.has(typeof raw.name === 'string' ? raw.name.toLowerCase().replace(/\.exe$/, '') : '')) return 'PROTECTED_PROCESS';
    if (!text(raw.name, 256) || !text(raw.executable, 4096) || !text(raw.started, 256) || !text(raw.user, 256)
      || raw.critical !== false || snapshot.identitySupported === false
      || (platform === 'win32' ? !/^[A-Za-z]:\\/.test(raw.executable) : !raw.executable.startsWith('/') || raw.executable.endsWith(' (deleted)'))
      || (platform === 'win32' && !/^\d{1,20}$/.test(raw.started))) return 'IDENTITY_UNAVAILABLE';
    if (raw.user !== snapshot.currentUser) return 'NOT_CURRENT_USER';
    return null;
  }
  async function inspectWithin(port, timeout = COMMAND_TIMEOUT, timeoutCode = 'PORT_INSPECTION_FAILED') {
    validatePort(port);
    try {
      const snapshot = await checked(() => collect(port, timeout), timeout, timeoutCode);
      if (!snapshot.owners.length) return {port, owner: null, canTerminate: false, reason: null};
      if (snapshot.owners.length !== 1) return {port, owner: null, canTerminate: false, reason: 'MULTIPLE_OWNERS'};
      const raw = snapshot.owners[0], reason = safety(raw, snapshot);
      const owner = Object.freeze({pid: raw.pid, name: text(raw.name, 256) ? raw.name : null,
        executable: text(raw.executable, 4096) ? raw.executable : null, started: text(raw.started, 256) ? raw.started : null});
      known.set(owner, {port, raw, canTerminate: !reason, used: false});
      return {port, owner, canTerminate: !reason, reason};
    } catch (error) {
      const reason = ['OWNERSHIP_UNAVAILABLE', 'PLATFORM_UNSUPPORTED', 'PORT_RELEASE_TIMEOUT'].includes(error.code) ? error.code : 'PORT_INSPECTION_FAILED';
      return {port, owner: null, canTerminate: false, reason};
    }
  }
  const inspect = port => inspectWithin(port);
  const sameIdentity = (left, right) => ['pid', 'name', 'executable', 'started', 'user'].every(field => left[field] === right[field]);
  async function terminate(port, expectedOwner) {
    validatePort(port);
    const expected = expectedOwner && known.get(expectedOwner);
    if (!expected || expected.port !== port || !expected.canTerminate || expected.used) throw fail('PORT_OWNER_UNSAFE');
    expected.used = true;
    const fresh = await inspect(port);
    if (!fresh.owner && !fresh.reason) return {port, released: true};
    if (fresh.reason === 'PORT_INSPECTION_FAILED') throw fail('PORT_INSPECTION_FAILED', fresh);
    const candidate = fresh.owner && known.get(fresh.owner);
    if (!candidate || !sameIdentity(candidate.raw, expected.raw)) throw fail('PORT_OWNER_CHANGED', fresh);
    if (!fresh.canTerminate) throw fail('PORT_OWNER_UNSAFE', fresh);
    try {
      if (platform === 'win32') {
        const result = JSON.parse(await checked(() => windows(port, expected.raw), COMMAND_TIMEOUT, 'PORT_TERMINATION_TIMEOUT'));
        if (result.status === 'changed') throw fail('PORT_OWNER_CHANGED', await inspect(port));
        if (result.status === 'denied') throw fail('PORT_TERMINATION_DENIED');
        if (result.status === 'timeout') throw fail('PORT_TERMINATION_TIMEOUT');
        if (!['free', 'terminated'].includes(result.status)) throw fail('PORT_TERMINATION_FAILED');
      } else {
        const snapshot = await checked(() => collect(port));
        if (!snapshot.owners.length) return {port, released: true};
        if (snapshot.owners.length !== 1 || !sameIdentity(snapshot.owners[0], expected.raw)) throw fail('PORT_OWNER_CHANGED', await inspect(port));
        if (safety(snapshot.owners[0], snapshot)) throw fail('PORT_OWNER_UNSAFE', await inspect(port));
        // shortcut: Unix lacks a process handle; a tiny identity-check/SIGKILL race remains, upgrade with a native pidfd/libproc helper.
        killProcess(expected.raw.pid, 'SIGKILL');
      }
    } catch (error) {
      if (error.code && error.code.startsWith('PORT_')) throw error;
      if (error.killed && error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw fail('PORT_TERMINATION_TIMEOUT');
      throw fail(['EPERM', 'EACCES'].includes(error.code) ? 'PORT_TERMINATION_DENIED' : 'PORT_TERMINATION_FAILED');
    }
    const deadline = now() + RELEASE_TIMEOUT;
    for (let attempts = 0; attempts < 51; attempts++) {
      const remaining = Math.ceil(deadline - now());
      if (remaining <= 0) break;
      const conflict = await inspectWithin(port, remaining, 'PORT_RELEASE_TIMEOUT');
      if (conflict.reason === 'PORT_RELEASE_TIMEOUT') throw fail('PORT_RELEASE_TIMEOUT');
      if (!conflict.owner && !conflict.reason) return {port, released: true};
      if (conflict.reason === 'PORT_INSPECTION_FAILED' || conflict.reason === 'OWNERSHIP_UNAVAILABLE') {
        // After SIGKILL procfs can retain a socket while its owning fds/metadata disappear.
        if (platform !== 'linux') throw fail('PORT_INSPECTION_FAILED');
      } else {
        const record = conflict.owner && known.get(conflict.owner);
        if (!record || !sameIdentity(record.raw, expected.raw)) throw fail('PORT_OWNER_CHANGED', conflict);
      }
      if (now() >= deadline) break;
      await sleep(100);
    }
    throw fail('PORT_RELEASE_TIMEOUT');
  }
  return {inspect, terminate};
}

module.exports = {createPortOwner, parseWindows, parseProcSockets, parseProcStat, parseLsof, parsePs};
