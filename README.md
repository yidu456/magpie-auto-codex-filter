# Magpie Filter 本地控制台（dev-2）

`dev-2` 在 `dev` 网页控制台基础上新增受保护流式交付、有限用量观测和四页导航，保留原有 CMD/CLI 入口。支持 **Codex → 本地过滤器 → Magpie**，不包含 Magpie、Codex、账号或模型服务，不支持 Claude Code / WebSocket。

## 网页版快速开始

1. 双击本次单独构建的 `dist/dev-2/MagpieFilter.exe`，默认浏览器自动打开本地控制台。EXE 内含 Node 和网页资源，不需要另装 Node，也没有 Electron/Chromium 外壳。
2. 在“设置”页确认 Codex 配置文件、Magpie 本机 HTTP 地址和过滤端口，点击“保存接入设置”。本程序不会替你配置账号、模型或启动 Magpie。
3. 选择清理模式及异常处理项，打开“核心过滤”总开关。**仅首次生成配置时默认关闭**；以后每次启动按配置文件的 `settings.policy.enabled` 决定是否自动接入。
4. 首次接入后，Codex 可能需要重开才能读取新地址。过滤端口默认 **18184**，可改为 1024–65535 范围内可用且不冲突的端口：先“断开并恢复”→修改并保存→重新开启接入→**重启 Codex**。模式和复选框切换不需要重启。

本次产物只放在 **`dist/dev-2/MagpieFilter.exe`**，不覆盖 `dist/portable/MagpieFilter.exe` 或旧 `dist` 根目录产物。此次没有停止旧实例，也没有改写真实客户端配置。

## 四页导航

- 首页 `/`：每日聚合指标、请求/重试与观测 token 分钟曲线、首个真实交付/总时长分布、模型/错误计数，以及核心总开关；其余控制项不在首页。
- 设置 `/?page=settings`：接入地址、清理方式、异常处理、三种交付方式、保活、网页端口/令牌、断开恢复及退出。
- 请求记录 `/?page=records`：进行中/最近请求的阶段、结果、重试、策略版本、观测覆盖、事件和诊断；不是请求正文查看器。
- 使用说明 `/?page=help`：模式边界、计量限制、默认兼容性和安全恢复说明。四页可直接打开、刷新，并使用浏览器前进/后退；登录后不会在地址中保留令牌片段。

## 便携配置与固定网页地址

- 默认网页地址为 **http://127.0.0.1:18185/**，不再随机换端口；与过滤端口 18184 分开。网页端口被占用会报错，不自动抢占或换号。
- 首次启动在 EXE 同目录生成 `MagpieFilter.config.json`，包含 `web.port`、`web.authEnabled:false`、生成的 `web.token`、客户端路径、上游、过滤端口和全部策略；自己的日志及恢复记录放在同目录 `.magpie-filter`。目录不可写会报错，不回退到 AppData。旧 version1 配置缺少 `authEnabled` 时仅在内存视为 `true`，读取不改写原文件，保留原鉴权保护。
- 新配置默认不启用管理鉴权，四页直接打开；关闭时本机程序无需令牌即可调用管理操作。设置中可启用令牌鉴权：手动打开时输入配置中的 `web.token`，双击 EXE 自动登录。令牌输入会遮掩，API 不返回令牌；关闭时不保存或发送 URL 中的旧令牌片段。模型/provider 密钥及过滤器内部停止令牌不受影响。
- 网页保存原子写回同一配置文件。运行期间手工编辑文件后，网页拒绝用旧状态覆盖；退出并重启读取修改。不要删除尚需恢复的运行记录。
- “网页与便携配置”可编辑网页端口、管理鉴权和令牌。令牌为 **64 位十六进制**，留空保留；三项均下次启动生效。状态分别显示配置与当前生效的鉴权标志，并提示待重启。保存后先退出程序再双击，重复双击只打开当前实例，不重启它。
- 令牌修改待重启期间，当前受保护实例仍使用旧令牌；`.magpie-filter/service.json` 记录当前生效的 `authEnabled`，只有生效鉴权开启时才临时缓存 `token`，用于重新打开，**不是另一份设置来源**。旧运行记录缺标志时按鉴权开启验证；不要公开配置或受保护实例缓存。
- 退出会恢复客户端地址，**不会将保存的启用偏好改成关闭**。不希望下次自动接入时，先关总开关或在退出后将配置 `settings.policy.enabled` 改成 `false`。不安装系统开机自启动。
- 如果自动接入或恢复失败，网页仍会显示“需要处理”，不会猜原地址或丢弃恢复备份。过滤端口占用等不涉及恢复的问题可修正后重试。

“不写 C 盘”指本程序自己的数据。启用接入仍会修改你选定路径的 Codex 配置；默认浏览器和 Windows 自身的数据位置不由过滤器控制。旧 AppData 记录未迁移或删除。

**已有旧过滤器时不要直接开启新控制台接管。** 请先等当前任务结束，在旧目录使用原停止脚本正常恢复地址；不要强杀旧进程、删除恢复文件或串联两个过滤器。新旧默认过滤端口都是 18184；端口冲突会拒绝启用。

源码方式启动：`node console/main.cjs` 或 `npm start`，需要 Node.js 24.12+，运行不需要 npm 依赖。`--runtime ABSOLUTE_PATH` 指定独立运行目录；`--no-open` 仅关闭自动打开浏览器，适合测试。不要把 console runtime 指到旧 `.runtime`。

## 模式和复选框

| 控制项 | 行为 |
| --- | --- |
| 暴力清理 | 每次请求先按原有安全规则清理历史 reasoning 和可移除顶层 ID；保留正文、工具结果、call_id 等 |
| 条件清理 | 先保留，遇到已勾选的明确目标历史错误才在本请求内清理一次并重试 |
| 不清理 | 保留历史，仍启用用户勾选的重试与暂存保护；不是关闭核心 |
| 总开关关闭 | 已接入的请求直接转发 Magpie，不做 JSON 清理、分类重试和 SSE 暂存；网页与代理入口仍运行 |

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

两项同时为 `true` 时整轮暂存优先；网页保存写入明确的一组值。旧 `version:1` 配置缺少 `protectStreamStart` 时按 `false` 读取，**仅启动不会重写文件**；旧 `bufferResponse=false` 保持直通，不自动升级为保护模式。首次生成配置仍核心关闭、整轮暂存；后续启动尊重保存的启用偏好。核心关闭始终透明绕过本过滤器的清理、恢复和终端用量解析。

受保护流式减少首个可见输出的等待，不保证晚期恢复。首个真实输出后认证、资源、断流或其他失败都不能自动重放工具/正文。被丢弃的失败尝试仍可能在上游执行工具或计费。

## 用量观测与存储边界

- 只累计本过滤器实际观测并验证通过的 `response.completed.response.usage`：输入、输出、可选总量和 cached input；缺失/格式错误/核心关闭都标记未知或不可用，不假装为零。合法零保留为零，不估算价格、节省比例或账单。
- 每日按进程本地日期汇总；错误次数是错误出现次数，恢复请求要求实际发出重试并最终成功。planned/executed retry 与计划等待时长分别展示；计划等待不是实际等待。首交付时长包括上传和等待，但排除本地保活；直方图及均值不是估算百分位。
- 分钟曲线最多 180 个稀疏分钟桶，进行中记录最多 1000 条，最近记录最多 200 条，均只在内存中。`.magpie-filter/metrics.json` 仅保存同日聚合（计数、模型/错误分类及直方图），约每分钟检查点、正常退出最终写入；重启后曲线、最近和进行中记录均为空。跨日/损坏/超限快照会非致命拒绝，不迁移旧详细记录。
- 检查点可能因崩溃丢失最后一段；异步日志/持久化失败有诊断但不阻断请求或安全恢复。标签和计数有限量截断，不承诺全量审计。指标/日志不保存正文、请求头、密钥或工具参数/结果；模型名、错误码、时间和聚合也属于本地运行信息，不应随源码分享。

关闭某类异常处理后，返回对应 HTTP 错误或终止 SSE，不把它改分类继续重试。所有分类共享每请求最多 **20 次额外重试、30 分钟总期限**；取消会停止等待。本轮开始时拍下策略快照，进行中的请求和退避重试不受后续切换影响。界面显示策略版本及仍使用旧策略的请求数。

安全边界不是可选项：本机地址限制、Host / Origin / Sec-Fetch-Site、JSON 与请求大小限制、一次性端口确认、配置恢复归属、取消和工具关联保护始终保留；只有本地管理令牌鉴权可按需开启。暴力清理也不能静默删除不可展开的压缩/服务器引用。直通关闭的是**本过滤器**的处理，不会关闭 Magpie 自身的功能。

## 关闭、恢复与隐私

- 关闭网页不会停止服务；再次双击同一运行目录的 EXE 会重新打开已有实例。
- “总开关关闭”保持已接入地址，便于无需重启客户端直接切换直通。它不会恢复配置。
- “断开并恢复”还原本程序精确改写且未被用户更改的地址，但保留网页；更换端口、上游、配置路径前先断开。
- “退出程序并恢复配置”恢复地址并结束服务。仍有请求（包括上传、退避、直通请求）时会拒绝退出，请等待结束或从客户端取消。
- 若恢复失败或用户编辑后的地址仍指向该过滤端口，不关闭可用代理、不猜原地址；界面提示处理。异常终止后重新启动同一 runtime 会先检查恢复记录。
- 默认状态目录为 EXE 同目录的 `.magpie-filter`。其中 `service.json` 仅在生效管理鉴权开启时缓存当前令牌，`connection.json` / `routes.json` 用于恢复；不要公开、跨机器复制或删除尚需恢复的记录。
- 控制接口只监听 `127.0.0.1`，始终验证 Host / Origin / Fetch 元数据，开启管理鉴权时额外验证 token，无远程脚本或字体。同源 `GET /api/auth` 仅返回 `{authRequired:boolean}`，不返回状态或密钥。不要分享带 `#token=` 的控制台链接。
- 请求事件不记录密钥、请求正文或模型正文。内存最多显示最近 200 个事件，页面最多展示最近 60 个；`console.log` 到约 1 MiB 时缩减至约 512 KiB，按容量保留，不承诺保留 24 小时。
- 极少数启动中断若留下无有效 owner 的 `instance.lock` 会安全拒绝猜测归属；保留整个目录并人工诊断。正常崩溃恢复留下的 `instance.lock.retired-*` 是很小的旧锁身份记录，不含令牌，不影响运行。

本轮仅验证隔离配置与模拟上游，未接管真实 Codex、未调用收费模型。首次客户端配置命中、Magpie 账号可用、真实模型质量与实际资源占用仍需在你方便时用正常任务确认。

## 安全切换与回滚

1. 等真实任务完成，在旧控制台正常“断开并恢复”并退出（CMD 服务用原停止脚本）。不要强杀、删除恢复记录或让两个实例接管同一客户端配置。
2. 保留回滚对：**旧 EXE + 与它配套的 `MagpieFilter.config.json`**，先离线备份配置，不复制令牌/恢复文件给别人。本地保留旧 portable EXE；此次 SHA-256 为 `06b5151c3239746748c7b70d2538cbe37e6c0418bba3ade2c11729b3d511da5d`。
3. 在新独立目录放 dev-2 EXE 和两份许可。需要沿用旧配置时，仅在旧程序退出恢复后复制旧 `version:1` 配置到新 EXE 同目录；先离线设 `settings.policy.enabled=false`，检查客户端路径、上游和端口，再启动并在设置页人工启用。不要迁移 `service.json`、锁或未完成的恢复文件；更换目录不能迁移进程。
4. 回滚时先等新版任务完成、正常恢复并退出，再启动旧 EXE/配套旧配置。若恢复失败，保留新版整个运行目录诊断，先修复恢复，不要启动旧版抢接管。旧 EXE 不一定识别新版新增字段，不能直接拿已保存的新配置替代回滚配置。

## 构建与验证

Windows x64，Node 24.12+：

```powershell
npm ci --ignore-scripts
npm test
node -e "require('./scripts/build.cjs').build({outputDirectory:'dist/dev-2'}).catch(e=>{console.error(e);process.exitCode=1})"
node scripts/smoke-exe.cjs dist/dev-2/MagpieFilter.exe
```

先确认目标 EXE 不存在或是自己可替换的未运行产物；构建会写指定目录，切勿覆盖旧产物。默认 `npm run build` / `npm run smoke:exe` 仍指向 `dist` 根目录，保留旧版时请使用上述显式命令。构建依赖仅 `esbuild` 和 `postject`，版本锁定在 lockfile；运行无第三方依赖。构建需联网获取匹配版本的 Node LICENSE。`dist/dev-2` 包含 EXE、两份许可和 EXE 校验值；EXE 约 86 MiB（磁盘体积，不是内存占用）。运行后生成外部设置/日志/恢复文件是正常行为。

当前是**未签名 dev EXE**，Windows/SmartScreen 可能提示。GUI 子系统构建不保留命令行窗口。构建时 postject 的原 Node 签名警告不代表产物带有效签名；产物验证为 NotSigned。发布前如需受信任签名，要使用自己的代码签名证书。

`.github/workflows/windows-build.yml` 可手动或推送 dev 后在 Windows runner 构建并上传 artifact，不自动发布 Release。此次仅完成本机构建，未推送、未运行远程工作流。

根 `SHA256SUMS.txt` 校验可分发源码；`dist/dev-2/SHA256SUMS.txt` 单独校验 EXE。源码校验覆盖源码/测试/脚本/许可，不包括本地规划和运行状态；`node --test scripts/source-manifest.test.cjs` 验证覆盖和当前文件字节。不要分享 `.runtime`、`.verification`、`.planning`、`.superpowers`、`.playwright-mcp` 或 `%LOCALAPPDATA%` 中的运行状态。

可选的四页浏览器验收（已有 Playwright 与 Chrome，不安装/下载浏览器）：

```powershell
$env:PLAYWRIGHT_MODULE='你的已安装 playwright 模块绝对路径'
node scripts/run-browser-smoke.cjs dist/dev-2/MagpieFilter.exe
```

不传 EXE 参数则测试源码。Runner 使用已安装 Chrome、独立 headless 上下文和工作区内模拟配置/上游，成功或失败都清理它自己拥有的子进程，不枚举或停止用户进程；可用 `BROWSER_CHANNEL` 选择已有兼容浏览器。桌面与 390px 四页截图在 `.verification/task-5-browser`，不分发。独立 CLI 工装 `node scripts/serve-ui-fixture.cjs [EXE路径]` 仍可用；`scripts/browser-smoke.js` 拒绝修改非工装配置。EXE smoke 覆盖旧配置只读、受保护首输出/前段恢复/晚期不重放、透明绕过/精确地址恢复、重启仅聚合恢复、令牌/端口待重启、单实例、复制到其他目录并在无 Node PATH/不同 cwd 下读取相邻配置。所有测试仅本地模拟，不调用收费服务。

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
