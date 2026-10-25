@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. Install it and add node to PATH, then reopen this window.
  if not defined CODEX_FILTER_NO_PAUSE pause
  exit /b 1
)
chcp 65001 >nul
title Magpie Conditional Codex Filter - Stop
node -e "console.log('\u505c\u6b62\u8fc7\u6ee4\u670d\u52a1\uff0c\u5e76\u7cbe\u786e\u6062\u590d\u672c\u5de5\u5177\u6539\u5199\u7684\u5730\u5740\u3002')"
node "%~dp0filter.cjs" stop %*
set "filterExit=%errorlevel%"
echo.
node -e "console.log('running=false\u3001state=stopped \u8868\u793a\u505c\u6b62\u3002\u91cd\u5f00 Codex \u540e\u4f7f\u7528\u6062\u590d\u7684\u4e0a\u6e38\u5730\u5740\uff1b\u5207\u6362\u8fdc\u7a0b\u76f4\u8fde\u9700\u5728\u5bf9\u5e94\u4e0a\u6e38\u7ba1\u7406\u8f6f\u4ef6\u6062\u590d\u914d\u7f6e\u3002')"
if not defined CODEX_FILTER_NO_PAUSE pause
exit /b %filterExit%
