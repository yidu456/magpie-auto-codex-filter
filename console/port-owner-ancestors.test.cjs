'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createPortOwner} = require('./port-owner.cjs');

test('native Windows ancestry protects the full stale chain and refuses unqualified cycles',
  {skip: process.platform !== 'win32', timeout: 30000}, async () => {
    let helper, command, options;
    await createPortOwner({platform: 'win32', currentPid: 100, currentPpid: 99,
      runCommand: async (file, args, settings) => {
        command = file; options = settings;
        helper = Buffer.from(args.at(-1), 'base64').toString('utf16le');
        return JSON.stringify({owners: [], currentUser: 'fixture', ancestors: [100]});
      }}).inspect(18193);
    const ancestors = /function Ancestors \{[\s\S]*?\n\}(?=\nfunction Owner)/.exec(helper)?.[0];
    assert.ok(ancestors, 'Exercise the actual production ancestry function');
    const tick = 134377189347172600n;
    const node = (parent, offset, deny = false) => ({parent, started: String(tick + BigInt(offset)), deny});
    const cases = [
      {name: 'older native parent', nodes: {100: node(99, 100), 99: node(0, 0)}, ancestors: [99, 100]},
      {name: 'older CIM parent', nodes: {100: node(99, 100), 99: node(0, 0, true)}, ancestors: [99, 100]},
      {name: 'recycled native parent', nodes: {100: node(99, 0), 99: node(100, 100)}, ancestors: [99, 100]},
      {name: 'recycled CIM parent', nodes: {100: node(99, 0), 99: node(100, 100, true)}, ancestors: [99, 100]},
      {name: 'stale cycle retains all candidates', nodes: {100: node(99, 100), 99: node(98, 0), 98: node(99, 200)}, ancestors: [98, 99, 100]},
      {name: 'CIM microsecond precision', nodes: {100: node(99, 0, true), 99: node(98, 1), 98: node(0, -10)}, ancestors: [98, 99, 100]},
      {name: 'clock rollback protects grandparent', nodes: {100: node(99, 0), 99: node(98, 100), 98: node(0, 200)}, ancestors: [98, 99, 100]},
      {name: 'same microsecond cycle', nodes: {100: node(99, 0), 99: node(100, 1)}, failed: true},
      {name: 'exited parent', nodes: {100: node(99, 100)}, ancestors: [99, 100]},
      {name: 'CIM missing creation', nodes: {100: node(99, 100), 99: {parent: 98, deny: true}}, failed: true},
      {name: 'native invalid creation', nodes: {100: node(99, 100), 99: {parent: 98, started: 'invalid'}}, failed: true},
      {name: 'native zero creation', nodes: {100: node(99, 100), 99: {parent: 98, started: '0'}}, failed: true},
      {name: 'cyclic chain', nodes: {100: node(99, 0), 99: node(100, 0)}, failed: true},
      {name: 'depth bound', nodes: {}, failed: true}
    ];
    const fixture = String.raw`
$ErrorActionPreference = 'Stop'
class PortOwnerNative {
  static [hashtable] $Nodes
  static [int] $Opened
  static [int] $Closed
  static [IntPtr] OpenProcess([uint32] $access, [bool] $inherit, [uint32] $id) {
    $n = [PortOwnerNative]::Nodes[[string]$id]
    if (-not $n -or $n.deny) { return [IntPtr]::Zero }
    [PortOwnerNative]::Opened++
    return [IntPtr][int]$id
  }
  static [string] Start([IntPtr] $handle) { return [PortOwnerNative]::Nodes[[string]$handle.ToInt32()].started }
  static [int] Parent([IntPtr] $handle) { return [PortOwnerNative]::Nodes[[string]$handle.ToInt32()].parent }
  static [bool] CloseHandle([IntPtr] $handle) { [PortOwnerNative]::Closed++; return $true }
}
function Get-CimInstance($class, $Filter) {
  if ($class -ne 'Win32_Process' -or $Filter -notmatch '^ProcessId = ([0-9]+)$') { throw 'unexpected fixture query' }
  $n = [PortOwnerNative]::Nodes[$Matches[1]]
  if (-not $n) { return $null }
  $created = if ($n.started) { [DateTime]::FromFileTimeUtc([long]$n.started) } else { $null }
  [pscustomobject]@{ ParentProcessId = $n.parent; CreationDate = $created }
}
`;
    const script = fixture + '\n' + ancestors + "\n$cases = ConvertFrom-Json -InputObject '"
      + JSON.stringify(cases) + "'\n" + String.raw`
$results = @()
foreach ($case in $cases) {
  $nodes = @{}
  foreach ($property in $case.nodes.PSObject.Properties) { $nodes[$property.Name] = $property.Value }
  if ($case.name -eq 'depth bound') {
    for ($i = 0; $i -lt 129; $i++) { $nodes[[string](100 + $i)] = [pscustomobject]@{ parent = 101 + $i; started = [string](134377189347172600L - $i * 10); deny = $false } }
  }
  [PortOwnerNative]::Nodes = $nodes
  [PortOwnerNative]::Opened = 0
  [PortOwnerNative]::Closed = 0
  $self = 100
  try { $result = Ancestors; $record = @{ name = $case.name; ancestors = @($result | Sort-Object) } }
  catch { $record = @{ name = $case.name; failed = $true } }
  $record.handlesClosed = [PortOwnerNative]::Opened -eq [PortOwnerNative]::Closed
  $results += $record
}
ConvertTo-Json -InputObject @($results) -Compress -Depth 5
`;
    const {stdout} = await promisify(execFile)(command,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], options);
    assert.deepEqual(JSON.parse(stdout), cases.map(({name, ancestors, failed}) => failed ? {name, failed, handlesClosed: true} : {name, ancestors, handlesClosed: true}));
  });
