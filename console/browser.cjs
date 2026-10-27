'use strict';
const path = require('node:path');
const {spawn} = require('node:child_process');

function openBrowser(url, {spawnProcess = spawn, platform = process.platform} = {}) {
  let executable, args;
  if (platform === 'win32') {
    executable = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // ShellExecute uses the user's HTTP association; Explorer exit codes are not launch results.
    const script = "$ErrorActionPreference = 'Stop'; $p = New-Object System.Diagnostics.ProcessStartInfo; "
      + "$p.FileName = '" + url.replaceAll("'", "''") + "'; $p.UseShellExecute = $true; [System.Diagnostics.Process]::Start($p) | Out-Null";
    args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  } else {
    executable = platform === 'darwin' ? 'open' : 'xdg-open'; args = [url];
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, args, {windowsHide: true, stdio: 'ignore'});
    const timer = setTimeout(() => { child.kill(); reject(new Error('Browser launch timed out.')); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error('Browser launch failed (exit ' + code + ').'));
    });
  });
}

module.exports = {openBrowser};
