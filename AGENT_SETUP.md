# 独立 Magpie 条件清理版：安装与调试

本文件只适用于同目录源码。整个目录可单独使用，不需要 AgentRouter 父项目、CC Switch、其他过滤器或桌面 UI。源码运行需要 Node.js 24+；Magpie 本体、账号和模型上游由接收者单独安装配置。本文件不授权付费模型调用、上传资料或修改无关项目。

## 1. 检查与保留

1. 完整读取本文件及 AGENTS.md，检查接收者实际系统、`node --version` 和 PATH。无需 npm install；可使用系统 npm 运行脚本。
2. 将干净源码放到当前用户可写、长期保留的位置。不要在压缩包内运行。执行 `node release.cjs verify` 核对 SHA256SUMS.txt；这是完整性清单，不是身份签名。失败时先核对本机有意修改，不盲目覆盖。
3. 识别已有实例的目录、端口、参数与配置，不重启、认领或杀死未知进程。默认过滤端口 18184，上游 Magpie 3425，仅绑定 127.0.0.1。
4. 当前目录若已有 .runtime，保留它；routes.json 用于精确恢复，service.json 含本机停止令牌。不要复制另一台电脑的运行目录，不直接删除备份绕过保护。
5. 本地测试只用临时目录和模拟服务，不读取真实配置、发送模型请求或需要密钥。运行 `npm test`；只有 Windows 会测试 CMD，其他系统用 Node 命令。

## 2. 核对真实接入

1. 接收者先在 Magpie 中按自己已经选定的账号、模型完成 Codex 接入，不虚构凭据或擅自切换服务商。可通过本机只读 GET /api/hello 验证 Magpie 身份，但它不证明账号、模型调用或工具功能成功。
2. 核对目标 Codex 实际读取的配置。默认 CODEX_HOME/config.toml，未设置 CODEX_HOME 时是用户主目录 .codex/config.toml；profile、启动参数、应用设置或缓存可能覆盖它。读取时不输出完整配置、密钥、令牌、账号或请求正文。
3. 若其他过滤器正在管理同一配置，先等任务结束，按其原目录和原参数正常停止、恢复，再启动本版。不要自动停止其他版本。只看不同端口不能认定配置互不影响。
4. 本版接管顶层 openai_base_url、常规 model_providers 表中的 base_url/model_catalog_url，仅匹配当前 Magpie 回环 HTTP origin；保留认证、本地模型目录和其他上游地址。暂不支持多行/复杂 TOML 地址。加入 /magpie 前缀，转发时移除一次。
5. 使用非默认端口、配置或运行目录时，在 start/status/logs/idle-stop/stop 一致传递 --port、--upstream、--config、--runtime。上游仅允许无凭据、无路径、无查询的回环 HTTP origin，不填远程模型供应商地址。

在本目录的示例（配置路径仅为占位，替换为接收者真实路径）：

```powershell
node .\filter.cjs status
node .\filter.cjs start --port 18184 --upstream http://127.0.0.1:3425 --config "C:\path\config.toml"
node .\filter.cjs status --port 18184 --upstream http://127.0.0.1:3425 --config "C:\path\config.toml"
node .\filter.cjs logs --port 18184 --upstream http://127.0.0.1:3425 --config "C:\path\config.toml"
node .\filter.cjs idle-stop --port 18184 --upstream http://127.0.0.1:3425 --config "C:\path\config.toml"
```

日常 CMD 会透传参数，双击不带自定义参数。需要自定义时，以接收者自己的设置制作三个一致的快捷方式，或先备份再调整三个脚本；保留 ASCII 正文和 Node Unicode 转义输出，避免 CMD 编码问题。不写入发送者机器的绝对路径。

## 3. 验证不同层次

- 进程：running=true、filterVersion=10、service=magpie-auto-codex-filter-v1、mode=magpie-auto。
- 配置：state=filtering、upstreamReachable=true（同 magpieReachable），实际所需地址指向过滤端口并带 /magpie；TCP 可达不等于上游账户鉴权成功。
- 客户端：配置接入后，用户在合适时机完全退出并重开目标 Codex。不要结束进行中的任务。通过用户正常获授权请求观察新请求日志，不能把其他客户端的累计计数作为当前会话路由证据。
- 停止恢复：无任务时执行 idle-stop 或本目录停止 CMD，确认 running=false、state=stopped 并核对精确地址恢复。停止只恢复仍等于本工具写入值的地址，不覆盖用户后续改动。接入或停止后均需重开目标客户端。

重复 start 不加载新源码；更新后台代码必须等任务结束再按原参数停止、启动。idle-stop 有请求时返回错误且不关闭服务。普通 stop 保留原恢复/排空行为，不能用于保证不中断长任务。强制退出后可按原参数重新 start，或 stop 离线恢复；不得删除 .runtime/routes.json。

## 4. 行为与限制

首次 Responses 请求保留完整历史、store、include、reasoning、工具、压缩和服务器引用。只有 HTTP400 或 HTTP200/SSE 明确 Azure item 资源归属错误或 invalid_encrypted_content，才在当前请求内执行一次清理：删历史 reasoning、可移除的顶层 id，store=false，去掉 reasoning.encrypted_content include。后续新请求重新优先完整历史。

降级若依赖压缩、conversation、previous_response_id 或 item_reference 等无法安全展开的上下文，明确拒绝，不静默丢历史。非目标错误不触发清理，认证/余额/配额错误不靠重试修复。

额外重试额度：资源5、限流20、断流/超时/特定 ALB HTML400 共10、无可用渠道10；合计不超过20次，总期限30分钟。取消会停止等待。SSE 整轮暂存到 response.completed，失败尝试的正文和客户端工具不交付；每轮64MiB，无进程级缓存总上限。并发会累加内存，重试可能重复上游内置工具及计费。仅支持 Responses HTTP/SSE，WebSocket不支持，不声称支持 Claude Messages。

日志 PRESERVE 只是首轮策略，需按同一编号查看后续 CLEANUP/WAIT/RETRY/SUCCESS/FAILED。查看窗口只显示打开后的新事件，后台重启会重置编号和统计。日志最多24小时、4MiB。关闭启动或日志窗口不会停止后台服务；没有开机自启。持续错误仍可能失败，清理可能影响任务连续性，长任务提前留文字摘要。

## 5. 排查与交付

- waiting-for-codex-config：核对真实配置及 CODEX_HOME。
- waiting-for-supported-provider/waiting-for-magpie：核对地址是否由 Magpie 接入，不创建虚构服务商，也不串联另一过滤器。
- config-error/备份不匹配：按原配置、端口和 runtime 正常停止恢复，不删除备份。
- portConflict：识别占用者，等空闲后在其原目录停止；不认领其他目录实例。
- filtering 但没有新流量：核对客户端配置源及是否重开，不能只凭累计统计下结论。

完成后直接在会话里说明：安装目录；双击“启动Magpie条件清理服务.cmd”启动，“查看Magpie条件清理状态.cmd”查看状态/新日志，“停止Magpie条件清理服务.cmd”停止恢复；客户端何时重开；哪些本地测试通过、哪些真实客户端/模型验证尚未做；无开机自启及历史/暂存/重试限制。不要只让用户读文档。

## 6. 开源发布

执行 `node release.cjs export NEW_DIRECTORY`，目标为源码目录外尚不存在的目录，其父目录需存在。只导出白名单源码、测试、文档、脚本及 MIT 许可证，生成独立校验清单；不复制 .runtime、配置、日志、数据库、环境文件或未知文件。导出后运行 npm test、npm run check，再以干净目录作为新 GitHub 根目录提交。

不要直接上传使用后的工作目录或强制添加忽略文件。若凭据已进入 Git 历史，单加 .gitignore 无法消除泄漏，需轮换凭据并另行处理历史。本指南不自动初始化仓库、提交或推送。保留 LICENSE 版权声明。
