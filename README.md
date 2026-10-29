# Magpie Filter 本地控制台（dev-2）

`dev-2` 在 `dev` 网页控制台基础上新增受保护流式交付、有限用量观测和四页导航，保留原有 CMD/CLI 入口。支持 **Codex → 本地过滤器 → Magpie**，不包含 Magpie、Codex、账号或模型服务，不支持 Claude Code / WebSocket。

## 网页版快速开始

1. 双击本次 Windows x64 候选产物 `dist/dev-3/MagpieFilter.exe`，默认浏览器自动打开本地控制台。EXE 内含 Node 和网页资源，不需要另装 Node，也没有 Electron/Chromium 外壳。
2. 在“设置”页确认 Codex 配置文件、Magpie 本机 HTTP 地址和过滤端口，点击“保存接入设置”。本程序不会替你配置账号、模型或启动 Magpie。
3. 选择清理模式及异常处理项，分别打开首页“网关接入”和“核心过滤”。**每次新进程仅启动网页，网关和核心均关闭**；旧配置的启用值只读保留，不自动接入。重复双击已有实例保留当前选择。
4. 首次接入后，Codex 可能需要重开才能读取新地址。过滤端口默认 **18184**，可改为 1024–65535 范围内可用且不冲突的端口：先“关闭网关并中断请求”→修改并保存→重新开启接入→**重启 Codex**。核心、异常处理和保活开关切换不需要重启。

源码仍位于 literal **`dev-2`** 分支；当前 Windows 候选是 **`dist/dev-3/MagpieFilter.exe`**，SHA-256 为 `eb493cdd7004221ff25895a88e17aa1dca3474b5effd416cefa9e120b5575935`。正在使用的 `dist/dev-2/MagpieFilter.exe` 保持原字节，SHA-256 为 `4db96d472338365d1adb51da103c061198bfcb39c2a40b5d26d3cb701fd90157`。不要用源码目录名推断 EXE 版本，也不要覆盖正在运行的文件；此次验收没有接管真实客户端或停止用户进程。

## 四页导航

- 首页 `/`：每日聚合指标、请求/重试与观测 token 分钟曲线、首个真实交付/总时长分布、模型/错误计数，以及独立的网关 / 核心开关；其余控制项不在首页。
- 设置 `/?page=settings`：接入地址、清理方式、异常处理、三种交付方式、保活、网页端口/令牌、断开恢复及退出。
- 请求记录 `/?page=records`：进行中/最近请求的阶段、结果、重试、策略版本、观测覆盖、事件和诊断；不是请求正文查看器。
- 使用说明 `/?page=help`：模式边界、计量限制、默认兼容性和安全恢复说明。四页可直接打开、刷新，并使用浏览器前进/后退；登录后不会在地址中保留令牌片段。

## 便携配置与固定网页地址

- 默认网页地址为 **http://127.0.0.1:18185/**，不再随机换端口；与过滤端口 18184 分开。网页端口被占用会报错，不自动抢占或换号。
- 首次启动在 EXE 同目录生成 `MagpieFilter.config.json`，包含 `web.port`、`web.authEnabled:false`、生成的 `web.token`、客户端路径、上游、过滤端口和全部策略；自己的日志及恢复记录放在同目录 `.magpie-filter`。目录不可写会报错，不回退到 AppData。旧 version1 配置缺少 `authEnabled` 时仅在内存视为 `true`，读取不改写原文件，保留原鉴权保护。
- 新配置默认不启用管理鉴权，四页直接打开；关闭时本机程序无需令牌即可调用管理操作。设置中可启用令牌鉴权：手动打开时输入配置中的 `web.token`，双击 EXE 自动登录。令牌输入会遮掩，API 不返回令牌；关闭时不保存或发送 URL 中的旧令牌片段。模型/provider 密钥及过滤器内部停止令牌不受影响。
- 网页保存原子写回同一配置文件。运行期间手工编辑文件后，网页拒绝用旧状态覆盖；退出并重启读取修改。不要删除尚需恢复的运行记录。
- “网页与便携配置”可编辑网页端口、管理鉴权和令牌。令牌为 **64 位十六进制**，留空保留；三项均下次启动生效。状态分别显示配置与当前生效的鉴权标志，并提示待重启。保存后先退出程序再双击；重复双击仅确认当前实例，不重启它，也不再次打开浏览器。
- 令牌修改待重启期间，当前受保护实例仍使用旧令牌；`.magpie-filter/service.json` 记录当前生效的 `authEnabled`，只有生效鉴权开启时才临时缓存 `token`，用于重新打开，**不是另一份设置来源**。旧运行记录缺标志时按鉴权开启验证；不要公开配置或受保护实例缓存。
- 退出或关闭网关会恢复客户端地址，**不会改变当前核心选择或改写保存的启用偏好**。新进程始终网关 / 核心关闭，没有自动接入选项，不安装系统开机自启动。
- 如果显式接入或恢复失败，网页仍会显示“需要处理”，不会猜原地址或丢弃恢复备份。过滤端口占用等不涉及恢复的问题可修正后重试。

“不写 C 盘”指本程序自己的数据。启用接入仍会修改你选定路径的 Codex 配置；默认浏览器和 Windows 自身的数据位置不由过滤器控制。旧 AppData 记录未迁移或删除。

**已有旧过滤器时不要直接开启新控制台接管。** 请先等当前任务结束，在旧目录使用原停止脚本正常恢复地址；不要强杀旧进程、删除恢复文件或串联两个过滤器。新旧默认过滤端口都是 18184；新控制台只会在显式开启网关并实际遇到端口占用时显示一次确认，不会在启动或核心切换时自动终止进程。

源码方式启动：`node console/main.cjs` 或 `npm start`，需要 Node.js 24.12+，运行不需要 npm 依赖。`--runtime ABSOLUTE_PATH` 指定独立运行目录；`--no-open` 仅关闭自动打开浏览器，适合测试。不要把 console runtime 指到旧 `.runtime`。

## 网关和核心

| 网关 | 核心 | 新请求行为 |
| --- | --- | --- |
| 关闭 | 关闭 | 仅网页，不监听、不接入 |
| 关闭 | 开启 | 保存核心选择，当前未生效；不检查端口占用 |
| 开启 | 关闭 | 字节直通，不清理、不重试、不截获 SSE |
| 开启 | 开启 | 依据当前策略处理新请求；已有请求保持捕获策略 |

显式 `POST /api/connect` 仅接受 `{revision}`，使用已保存的接入设置；普通 `POST /api/settings` 不隐式启动网关。端口确认仅属于网关开启。`POST /api/disconnect` 安全恢复后强制取消，普通退出仍保留活动请求保护。当前 `dist/dev-3` Windows 候选已由同一源码重建并做隔离验收；`dist/dev-2` 旧 EXE 不会随源码自动更新。

### 端口冲突与进程确认

- 冲突框显示能安全取得的程序名、PID 和可执行路径；只能选择“否”或对这一次冲突选择“是”。默认焦点是“否”，取消、超时、设置变化或身份变化都会使确认失效。浏览器提交不了自选 PID，程序也不提供通用结束进程接口。
- 只允许终止当前用户、身份完整且复核一致的单个监听进程。自身、父进程/祖先进程、系统/root/关键进程、多重或无法识别的占用者、权限不足及检查超时一律拒绝；不提权、不结束进程树。macOS 因系统元数据不足仅显示冲突，必须手工退出占用程序后重试。
- 强制结束其他程序可能丢失它尚未保存的数据，且无法由 Magpie Filter 恢复。只确认自己明确认识且已保存工作的进程；身份或端口占用发生变化时必须重新确认。

## 模式和开关

| 控制项 | 行为 |
| --- | --- |
| 暴力清理 | 每次请求先按原有安全规则清理历史 reasoning 和可移除顶层 ID；保留正文、工具结果、call_id 等 |
| 条件清理 | 先保留，遇到已勾选的明确目标历史错误才在本请求内清理一次并重试 |
| 不清理 | 保留历史，仍启用用户勾选的重试与暂存保护；不是关闭核心 |
| 核心关闭 | 已接入的请求直接转发 Magpie，不做 JSON 清理、分类重试和 SSE 暂存；网页与代理入口仍运行 |

以下七类异常处理默认开启；交付方式和保活单独设置，依赖条件不满足时显示不可用并保留偏好：

| 选项 | 边界 |
| --- | --- |
| Azure 资源归属错误 | 仅精确跨 Azure 资源错误；条件模式清理，其他模式按原请求重试；资源类最多额外 5 次 |
| 无效推理密文 | 仅条件模式、HTTP 400 或受保护 SSE 的 `invalid_encrypted_content`；共享资源类额度 |
| 临时限流 | 最多额外 20 次，遵守 Retry-After；认证、余额与配额不足不会重试 |
| 网络错误与空闲超时 | 连接异常与上游无数据超时；断流类最多额外 10 次 |
| 流式中断 / 无详情失败 | 未完成就结束、断流、无详情 response.failed；整轮暂存或受保护流式的首个真实输出前可恢复，共享断流类额度 |
| ALB 网关 HTML 400 | 只识别已知完整 ALB 错误页及原有包装形式；共享断流类额度 |
| 无可用渠道 | 精确 no_available_channel 等现有匹配；最多额外 10 次 |
| 等待期间发送保活 | 在整轮暂存或受保护流式的等待/重试阶段发送空进度事件；完全直通不可用；不计作首个真实交付 |

### 三种交付方式与旧配置

| 方式 | 配置布尔值 | 恢复边界 |
| --- | --- | --- |
| 整轮暂存后交付（默认） | `bufferResponse=true`、`protectStreamStart=false` | 等 `response.completed` 再交付，保留原晚期失败恢复保障 |
| 受保护流式 | `bufferResponse=false`、`protectStreamStart=true` | 首个真实输出前暂存并按原规则恢复；首个正文/工具输出到达后立即流式转发，此后失败不清理、不重发 |
| 完全直通流式 | 两项均 `false` | 无首段恢复保障；一旦开始转发不再重发，切换需要确认 |

两项同时为 `true` 时整轮暂存优先；网页保存写入明确的一组值。旧 `version:1` 配置缺少 `protectStreamStart` 时按 `false` 读取，**仅启动不会重写文件**；旧 `bufferResponse=false` 保持直通，不自动升级为保护模式。首次生成配置仍核心关闭、整轮暂存；每次新进程的网关 / 核心仍关闭，不改写旧启用值。核心关闭始终透明绕过本过滤器的清理、恢复和终端用量解析。

受保护流式减少首个可见输出的等待，不保证晚期恢复。首个真实输出后认证、资源、断流或其他失败都不能自动重放工具/正文。被丢弃的失败尝试仍可能在上游执行工具或计费。

## 用量观测与存储边界

- 只累计本过滤器实际观测并验证通过的 `response.completed.response.usage`：输入、输出、可选总量和 cached input；缺失/格式错误/核心关闭都标记未知或不可用，不假装为零。合法零保留为零，不估算价格、节省比例或账单。
- 每日按进程本地日期汇总；错误次数是错误出现次数，恢复请求要求实际发出重试并最终成功。planned/executed retry 与计划等待时长分别展示；计划等待不是实际等待。首交付时长包括上传和等待，但排除本地保活；直方图及均值不是估算百分位。
- 分钟曲线最多 180 个稀疏分钟桶，进行中记录最多 1000 条，最近记录最多 200 条，均只在内存中。`.magpie-filter/metrics.json` 仅保存同日聚合（计数、模型/错误分类及直方图），约每分钟检查点、正常退出最终写入；重启后曲线、最近和进行中记录均为空。跨日/损坏/超限快照会非致命拒绝，不迁移旧详细记录。
- 检查点可能因崩溃丢失最后一段；异步日志/持久化失败有诊断但不阻断请求或安全恢复。标签和计数有限量截断，不承诺全量审计。指标/日志不保存正文、请求头、密钥或工具参数/结果；模型名、错误码、时间和聚合也属于本地运行信息，不应随源码分享。

关闭某类异常处理后，返回对应 HTTP 错误或终止 SSE，不把它改分类继续重试。所有分类共享每请求最多 **20 次额外重试、30 分钟总期限**；取消会停止等待。本轮开始时拍下策略快照，进行中的请求和退避重试不受后续核心 / 策略切换影响；显式关闭网关会强制取消。界面显示策略版本及仍使用旧策略的请求数。

安全边界不是可选项：本机地址限制、Host / Origin / Sec-Fetch-Site、JSON 与请求大小限制、一次性端口确认、配置恢复归属、取消和工具关联保护始终保留；只有本地管理令牌鉴权可按需开启。暴力清理也不能静默删除不可展开的压缩/服务器引用。直通关闭的是**本过滤器**的处理，不会关闭 Magpie 自身的功能。

## 关闭、恢复与隐私

- 浏览器只在服务启动时自动打开一次；重复双击同一运行目录的 EXE 不会再次打开网页。关闭网页不会停止服务，需要查看时手动打开原本的本地控制台地址（默认 `http://127.0.0.1:18185/`，以配置的 `web.port` 为准），鉴权开启时照常登录。
- “核心关闭”保持已接入地址，便于无需重启客户端直接切换直通。它不会恢复配置。
- “关闭网关并中断请求”经确认后先还原本程序精确改写且未被用户更改的地址，再关闭自己的网关连接，取消上传、暂存、流式、退避及直通请求；保留网页和核心选择。未交付的数据不会重放，且不能撤销上游已经执行的工具操作或计费。更换端口、上游、配置路径前先关闭网关。
- “退出程序并恢复配置”恢复地址并结束服务。仍有请求（包括上传、退避、直通请求）时会拒绝退出，请先关闭网关强制中断、等待结束或从客户端取消。
- 若恢复失败或用户编辑后的地址仍指向该过滤端口，不关闭可用代理、不猜原地址；界面提示处理。异常终止后重新启动同一 runtime 会先检查恢复记录。
- 默认状态目录为 EXE 同目录的 `.magpie-filter`。其中 `service.json` 仅在生效管理鉴权开启时缓存当前令牌，`connection.json` / `routes.json` 用于恢复；不要公开、跨机器复制或删除尚需恢复的记录。
- 控制接口只监听 `127.0.0.1`，始终验证 Host / Origin / Fetch 元数据，开启管理鉴权时额外验证 token，无远程脚本或字体。同源 `GET /api/auth` 仅返回 `{authRequired:boolean}`，不返回状态或密钥。不要分享带 `#token=` 的控制台链接。
- 请求事件不记录密钥、请求正文或模型正文。内存最多显示最近 200 个事件，页面最多展示最近 60 个；`console.log` 到约 1 MiB 时缩减至约 512 KiB，按容量保留，不承诺保留 24 小时。
- 极少数启动中断若留下无有效 owner 的 `instance.lock` 会安全拒绝猜测归属；保留整个目录并人工诊断。正常崩溃恢复留下的 `instance.lock.retired-*` 是很小的旧锁身份记录，不含令牌，不影响运行。

本轮仅验证隔离配置与模拟上游，未接管真实 Codex、未调用收费模型。首次客户端配置命中、Magpie 账号可用、真实模型质量与实际资源占用仍需在你方便时用正常任务确认。

## 安全切换与回滚

1. 等真实任务完成，在旧控制台正常“断开并恢复”并退出（CMD 服务用原停止脚本）。不要强杀、删除恢复记录或让两个实例接管同一客户端配置。
2. 保留回滚对：**旧 EXE + 与它配套的 `MagpieFilter.config.json`**，先离线备份配置，不复制令牌/恢复文件给别人。本地保留旧 portable EXE；此次 SHA-256 为 `06b5151c3239746748c7b70d2538cbe37e6c0418bba3ade2c11729b3d511da5d`。
3. 在新独立可写目录放 `dist/dev-3` 候选 EXE 和两份许可。需要沿用旧配置时，仅在旧程序退出恢复后复制旧 `version:1` 配置到新 EXE 同目录；先离线设 `settings.policy.enabled=false`，检查客户端路径、上游和端口，再启动并在设置页人工启用。不要迁移 `service.json`、锁或未完成的恢复文件；更换目录不能迁移进程。
4. 回滚时先等新版任务完成、正常恢复并退出，再启动旧 EXE/配套旧配置。若恢复失败，保留新版整个运行目录诊断，先修复恢复，不要启动旧版抢接管。旧 EXE 不一定识别新版新增字段，不能直接拿已保存的新配置替代回滚配置。

## 原生便携包

| 系统 | 包名 | 启动 |
| --- | --- | --- |
| Windows x64 | `MagpieFilter-windows-x64.zip` | 解压后双击 `MagpieFilter.exe`，或 PowerShell 运行 `& .\MagpieFilter.exe` |
| Linux x64 | `MagpieFilter-linux-x64.tar.gz` | 解压后运行 `./start.sh` |
| macOS arm64 | `MagpieFilter-macos-arm64.tar.gz` | 解压后运行 `./start.sh` 或双击 `Start-MagpieFilter.command` |
| macOS x64 | `MagpieFilter-macos-x64.tar.gz` | 同上 |

必须把**整个包**解压到新的可写目录后启动，不能在压缩包内运行。配置 `MagpieFilter.config.json` 和状态 `.magpie-filter` 始终写在可执行文件旁，与当前工作目录无关；不要从只读下载位置运行，也不要分享配置、令牌、日志或恢复状态。每个包只有一个同名顶层目录，含可执行文件、项目/Node 许可、`START-HERE.txt` 和内部 `SHA256SUMS.txt`；Unix 含 `start.sh`，macOS 另含 `.command` 启动器。无安装器、服务、自启动或 shell 配置修改。

Linux 包面向 x64 **glibc** 发行版（例如 Ubuntu 22.04+），不支持 Alpine/musl。macOS 构建仅 ad-hoc 签名，不是 Apple 公证或可验证发布者签名，首次运行可能需要在系统设置中手工批准；macOS 端口占用者也必须手工退出。Windows EXE 没有发布者证书，SmartScreen 可能提示；GUI 子系统不保留终端窗口。

Windows 文件详情和受控进程已验证为 `Magpie Filter` / `MagpieFilter.exe`，版本 `0.1.0.0`，设置页显示实际应用名、原始 PID 与可执行路径。它不冒充签名发布者；任务管理器的可视分组因 Windows 版本而异，应以“详细信息”中的映像名、PID 和路径为准。源码用 Node 启动时会诚实显示 Node 可执行路径。

## 本地构建与验收

只能在目标原生系统/架构上构建，不是交叉编译。需要 Node.js 24.12.0、锁文件中的 `esbuild`/`postject`、联网取得对应 Node LICENSE，以及系统自带的归档/签名工具。下例每次创建全新目录，不写 `dist/dev-2` 或 `dist/dev-3`：

```powershell
npm ci --ignore-scripts
npm test
$root = Join-Path $env:TEMP ("magpie-native-" + [guid]::NewGuid())
node scripts/build.cjs "$root/build"
node scripts/package-release.cjs "$root/build" "$root/release"
New-Item -ItemType Directory "$root/extracted" | Out-Null
tar -xf "$root/release/MagpieFilter-windows-x64.zip" -C "$root/extracted"
node scripts/smoke-exe.cjs "$root/extracted/MagpieFilter-windows-x64/MagpieFilter.exe"
node scripts/smoke-port-consent.cjs "$root/extracted/MagpieFilter-windows-x64/MagpieFilter.exe"
```

Linux/macOS 使用同样的安装、测试、构建和打包步骤，以 `root="$(mktemp -d)"` 创建目录，再用 `tar -xzf` 解压相应 `.tar.gz`，把两个 smoke 命令的可执行路径换成 `"$root/extracted/MagpieFilter-<target>/MagpieFilter"`。原生 smoke 只操作自己创建并跟踪的回环 fixture；Windows/Linux 非 root 会测试一次明确确认的单进程终止，macOS（以及 root Linux）只验证显示/拒绝，手工退出 fixture 后重试。不要对用户进程或真实客户端目录运行破坏性验收。

根 `SHA256SUMS.txt` 校验可分发源码，`node --test scripts/source-manifest.test.cjs` 验证清单覆盖及字节；每个构建目录和归档有自己的清单，含义不同。不要分享 `.runtime`、`.verification`、`.planning`、`.superpowers`、`.playwright-mcp`、`.magpie-filter` 或 `%LOCALAPPDATA%` 中的状态。可选浏览器验收使用外部已安装的 Playwright/Chrome，例如 `node scripts/run-browser-smoke.cjs <新解压的可执行文件>`；所有工装都应指向新解压目录和模拟配置，不调用收费服务。

## CI 产物与版本发布

`.github/workflows/windows-build.yml` 在推送 `dev` / `dev-2` 或手工 `workflow_dispatch` 时只构建和上传本次运行的四个平台 artifact，**不会创建 Release**。推送已有且格式合法的 `vMAJOR.MINOR.PATCH[-prerelease]` tag 才会在四个原生 job 全部通过后进入发布；没有 pull request 发布入口。2026-10-29 的修复提交 `57cb5d0` 已在四个目标上通过原生测试、构建、打包及解压后 smoke/端口确认；该轮 macOS x64 最后的 artifact 上传因 GitHub CreateArtifact 网络超时失败，仍不能声称整轮交付或 Release 已成功。源码修复与验证边界见 [Phase 14 验证记录](docs/verification-phase14.md)；本地 `dist/dev-3` 是此前保留的候选，不包含此次 CI 修复。

Release 精确包含八个资产：四个上述原生归档、`MagpieFilter.exe`、`LICENSE.txt`、`NODE-LICENSE.txt`、聚合 `SHA256SUMS.txt`。其中聚合清单精确校验前七项；工作流不会上传整个 `dist`、配置或运行状态。分支/手工运行下载 artifact 时，各目标仅含自己的归档和外部 `SHA256SUMS.txt`，它不是 GitHub Release。

全局权限只有 `contents:read`；仅 tag 的 publish job 获得 `contents:write`，且只在发布 helper 步骤把 GitHub 自动提供的短期 `GITHUB_TOKEN` 作为 `GH_TOKEN` 使用。无需也不应提供 PAT、用户 secret、签名凭据或修改仓库设置。发布器先校验现有 tag、四个 artifact 的精确外部清单/哈希，并检查 Windows 包的精确内容及内部清单，再创建 draft、上传并复核八个资产，最后发布；其余三个包由各自原生 job 打包、解压并运行 smoke。上传失败保留 draft，重新运行只允许续传匹配的 draft。已有已发布 Release 会明确拒绝，绝不覆盖；上传/发布本身不是原子操作。

在不发布的前提下，可从 Actions 手工运行 workflow，下载四个 artifact 并逐个核对/解压/运行 smoke；不要手工调用 `scripts/release.cjs`。首次真正 tag 发布前，应先让四个原生 runner 的 artifact-only 运行全部通过并人工检查包内 `START-HERE.txt`、权限和清单。

完整 Phase 13 本地证据、产物哈希和未验证边界见 `docs/verification-phase13.md`。

## 原独立版 CMD/CLI 说明

以下是原条件清理入口的行为；网页新选项只由控制台实例使用，不会自动改变已经运行的旧服务或 CMD 默认策略。

默认端口 18184、mode=magpie-auto、Magpie 上游 http://127.0.0.1:3425。本目录包含运行所需的全部源码，统一保存在 `magpie-auto-codex-filter` 中，不依赖原项目中的任何相邻目录。可以把整个 `magpie-auto-standalone` 文件夹单独复制到其他位置。

需要 Windows、PATH 中可用的 Node.js 24 或以上，以及另外安装并配置好的 Magpie / Codex；不需要 npm install。本包是过滤器，不包含 Node.js、Magpie、Codex、账号或模型服务。

根目录仅保留三个中文 CMD 入口、说明、许可、校验清单、忽略规则和运行状态。源码入口为 `magpie-auto-codex-filter/filter.cjs`；同目录的 `core.cjs` 管理后台服务，`proxy.cjs` 处理转发和重试，`base-config.cjs` 保存公共配置工具，`config.cjs` 适配 Magpie 配置。测试及测试辅助模块也在该目录中，只用于本地验证；`LICENSE` 保留原许可。不再使用原来的两个源码目录。

此独立副本只调整了目录布局、入口与测试的模块路径、帮助文字和本说明；条件清理策略、V10、端口与重试上限保持原版行为。运行状态仍在根目录 `.runtime`，已有服务及地址恢复备份不会因源码合并而迁移或删除；干净副本首次运行会生成该目录。`magpie-auto-codex-filter/.verification` 保存历史制作和本次合并的校验记录，不是运行依赖，转分享时无需携带。源码目录内的 `.runtime` 仅用于隔离测试，不能代替根目录的服务状态。

若合并时旧服务仍在运行，Windows 可能锁住其工作目录，留下一个空的 `ccswitch-codex-filter` 文件夹。它不再包含源码，也不是新启动入口的依赖；等当前任务结束，用根目录停止脚本正常停止服务后，可删除该空目录。不要强杀进程或删除根目录 `.runtime`。

## 使用

先在 Magpie 接入 Codex。等任务结束后，从当前过滤器原目录正常停止并恢复地址，再双击本目录“启动Magpie条件清理服务.cmd”。双击“查看Magpie条件清理状态.cmd”查看状态和实时日志；“停止Magpie条件清理服务.cmd”停止并恢复本版改写的地址。

~~~powershell
node .\magpie-auto-codex-filter\filter.cjs start
node .\magpie-auto-codex-filter\filter.cjs status
node .\magpie-auto-codex-filter\filter.cjs logs
node .\magpie-auto-codex-filter\filter.cjs stop
~~~

确认 running=true、mode=magpie-auto、state=filtering、upstreamReachable=true 后重开目标 Codex 客户端。用自己的正常请求核对新日志；TCP 可达不代表模型账号已经验证。自定义 --port、--upstream、--config、--runtime 在启停/查看时保持一致。

原项目的18181 CCS、18182 Magpie完整历史版、18183 Magpie固定清理版及18184 Auto保留不变。本副本仍默认使用18184；旧实例运行时会报告端口冲突，不会认领或停止旧实例。请等现有任务结束，在旧实例原目录按原参数正常停止并恢复地址，再启动本副本。两个 Magpie 过滤器不要同时接管同一配置；单独端口和 runtime 不等于配置所有权隔离。已有地址指向其他过滤器时，本版不会自动串联，可显示 waiting-for-magpie。原项目的联合脚本不管理本副本。

关闭启动或查看窗口不会停止后台服务；没有开机自启动。前台用 serve，Ctrl+C 停止并恢复。service 为 magpie-auto-codex-filter-v1。停止只恢复仍等于本版写入值的精确地址，保留用户后续改动。

## 清理何时触发

每次新 POST Responses 请求先保留 reasoning、历史 id、store、include、本轮推理强度及工具历史，进行基础 JSON 类型和大小验证后转发。自动压缩、已有压缩及服务器引用允许交给 Magpie，compact 路径直接转发且不重放。

以下明确错误才使当前 Responses 请求降级为 CCS 清理策略：

- HTTP 400，明确报告 item 属于另一 Azure OpenAI resource，并要求使用创建它的同一资源。
- HTTP 400，错误码为 invalid_encrypted_content。
- HTTP 200/SSE error 或 response.failed，包含上述明确资源错误或 invalid_encrypted_content。

不按泛泛的“解密失败”“签名错误”文案或所有400推断清理。其他错误码尚未纳入；遇到新的明确密文错误应核实后补充精确匹配。

降级时删除所有历史 reasoning 项、同 CCS 范围内的普通消息/函数/自定义工具顶层 id，store=false，移除 include 中 reasoning.encrypted_content；保留消息正文、phase、图片、工具参数/结果、call_id、嵌套资源及本轮 reasoning.effort。每条客户端请求最多执行一次清理，后续重试复用清理后的请求；下一条新请求再次先保留完整历史，不永久改变会话或本地聊天记录。

限流、断流/超时、ALB HTML400及无可用渠道按原策略有限重试，不触发清理。认证、配额和其他非目标业务错误直接返回；HTTP401/403/500中的密文错误码也不触发本策略。

若需降级的请求依赖 previous_response_id、conversation、自动compaction、已有压缩或item_reference等无法安全展开的上下文，返回明确拒绝错误，不删除这些内容强行重发。首次转发仍会保留它们；失败时的拒绝不等于之前没有向上游发送请求。其他资源ID也不能保证跨账号有效。

## 重试、日志与限制

清理后的重发计入原资源分类额度：最多额外5次，与其他分类合计最多20次，总期限30分钟。遵守 Retry-After 等等待下限；额度或期限不足时不清理、不重发。取消会终止退避等待与后续请求。供应商/账号选择、Magpie自己的重试和并发仍由 Magpie 决定。

Responses SSE仍完整暂存到response.completed后交付，失败尝试的客户端工具与正文被丢弃；成功响应的新推理保留。每轮暂存上限64MiB，无服务级缓存总上限。WebSocket不支持。第一次错误和退避可能增加可见等待，上游内置工具在重试时可能重复执行并计费。

日志 PRESERVE 表示保留完整历史，CLEANUP 表示具体错误触发了一次清理，FAIL中会说明无法安全清理的上下文。stats.filteredRequests是经过处理的Responses请求数，包含保留历史的请求；removedReasoningItems/removedItemIds只在实际降级时增长。数字是本进程累计移除项数，不是唯一历史项数或清理次数。同一历史在多次请求中出现时可重复计数。

每条新请求都会先打印 PRESERVE；它是首次尝试的策略，不是“本条请求最终没有清理”的结论。按同一请求编号看后续事件：目标错误会出现 FAIL → CLEANUP → WAIT → RETRY，成功后显示 RECOVERED / SUCCESS；限流或断流则可出现 FAIL → WAIT → RETRY，但不应出现 CLEANUP。PRESERVE 后直接 SUCCESS 表示该请求没有触发清理，PENDING 表示仍在等待，不能提前判断最终结果。查看窗口只显示打开后的新事件，之前的 CLEANUP 需检查本机原始日志；请求编号和状态累计数在后台重新启动后重置，原始日志可能仍包含旧进程记录，跨重启不能只凭编号关联。

清理在内存中生成重发内容，若用户在退避期间取消，清理计数可能已增长而resourceRetries尚未增长；实际重发看RETRY日志。原始日志最多保留24小时、4MiB，繁忙时保留更短。.runtime/routes.json用于恢复，service.json含停止令牌，不能公开或删除尚需恢复的备份。

条件清理减少正常请求的历史损失；触发降级后仍会丢弃内部推理状态，可能影响复杂任务连续性。若每条请求都遇到同类错误，每条仍可能失败后清理。它不能保证修复持续资源/签名错误，长任务应提前保留文字摘要。profile、客户端缓存或其他配置源仍可能绕过过滤器。

## 本地验证

~~~powershell
node --test .\magpie-auto-codex-filter\filter.test.cjs .\magpie-auto-codex-filter\retry.test.cjs .\magpie-auto-codex-filter\layout.test.cjs
~~~

测试使用本包中的临时配置和本机模拟服务，覆盖首次完整历史、HTTP/SSE降级、后续请求重置、非目标错误、上下文拒绝、预算/期限、并发、取消及真实CMD启停/查看/离线恢复。不读取或改写真实 Codex 配置，不调用收费模型。本独立包不包含 CCS 专用 live-check.cjs；真实模型测试须单独明确授权。

校验源码完整性可使用本目录的 `SHA256SUMS.txt`；它不包含运行生成文件，也不是发布者身份签名。转分享只携带清单列出的干净源码文件和清单本身，不携带任意 `.runtime` 或 `.verification` 目录。迁移已运行的副本时，先在原位置正常停止恢复，再复制干净源码到新位置，不能靠复制运行状态迁移进程。
