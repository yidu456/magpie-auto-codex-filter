@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. Install it and add node to PATH, then reopen this window.
  pause
  exit /b 1
)
chcp 65001 >nul
title Magpie Conditional Codex Filter - Start
node -e "console.log('Magpie Conditional \u4e13\u7528\u8fc7\u6ee4\u5668\uff1a\u9ed8\u8ba4\u4e0a\u6e38 127.0.0.1:3425\uff0c\u8fc7\u6ee4\u7aef\u53e3 18184\u3002\u8bf7\u5148\u5728 Magpie \u914d\u7f6e Codex \u63a5\u5165\u3002')"
node "%~dp0magpie-auto-codex-filter\filter.cjs" start %*
set "filterExit=%errorlevel%"
echo.
node -e "console.log('mode=magpie-auto\u3001state=filtering\u3001upstreamReachable=true \u8868\u793a\u672c\u673a\u63a5\u5165\uff1b\u968f\u540e\u91cd\u5f00 Codex \u9a8c\u8bc1\u6d41\u91cf\u3002\u5173\u95ed\u7a97\u53e3\u4e0d\u4f1a\u505c\u6b62\u540e\u53f0\u670d\u52a1\uff0c\u67e5\u770b\u548c\u505c\u6b62\u8bf7\u7528 Magpie \u4e13\u7528\u5165\u53e3\u3002')"
pause
exit /b %filterExit%
