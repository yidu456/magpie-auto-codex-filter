# Magpie 条件清理版 — 独立开源目录

Codex → 本机条件清理过滤层 → Magpie → 你已配置的模型上游。

默认端口 18184、mode=magpie-auto、Magpie 上游 http://127.0.0.1:3425。本目录包含全部必要源码、启动脚本、测试和文档，可以单独克隆、下载或发布到 GitHub，**不再依赖相邻代码目录、父目录 package.json 或 node_modules**。Node.js 24+ 和 Magpie 本体仍需单独安装；没有 npm 依赖，不需要 npm install。本项目不是 Magpie，也不提供账号、密钥或模型。

源码沿用 AgentRouter-Codex-Filter 的可靠转发及配置恢复实现，保留原 MIT 版权声明。此次独立化不修改其他过滤器，也不会自动停止或更新已运行的实例。

## 使用

先在 Magpie 接入 Codex。等任务结束后，从当前过滤器原目录正常停止并恢复地址，再双击本目录“启动Magpie条件清理服务.cmd”。双击“查看Magpie条件清理状态.cmd”查看状态和实时日志；“停止Magpie条件清理服务.cmd”停止并恢复本版改写的地址。

在本目录打开终端：

~~~powershell
node .\filter.cjs start
node .\filter.cjs status
node .\filter.cjs logs
node .\filter.cjs idle-stop
node .\filter.cjs stop
~~~

确认 running=true、mode=magpie-auto、state=filtering、upstreamReachable=true 后重开目标 Codex 客户端。用自己的正常请求核对新日志；TCP 可达不代表模型账号已经验证。自定义 --port、--upstream、--config、--runtime 在启停/查看时保持一致。

其他过滤器继续使用各自原入口，本目录不管理它们。两个过滤器不要同时接管同一配置；单独端口和 runtime 不等于配置所有权隔离。已有地址指向其他过滤器时，本版不会自动串联，可显示 waiting-for-magpie。同端口被其他目录实例占用时会明确拒绝启动，不认领或杀死它。

`idle-stop` 在还有请求（包括上传、SSE 或退避）时拒绝停止，适合安全切换；普通 `stop` 保留原停止语义，应先等任务结束。变更端口、配置路径或运行目录前，必须用原参数正常停止并恢复。自定义配置时三个 CMD 必须采用相同参数，双击不会自动带上你曾在命令行使用的参数。

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

在本目录运行：

~~~powershell
npm test
npm run check
~~~

测试使用系统临时目录、随机空闲端口和本机模拟服务，不读取真实 Codex 配置、不接触现有 .runtime、不调用模型。覆盖首次完整历史、HTTP/SSE降级、后续请求重置、非目标错误、上下文拒绝、预算/期限、并发、取消、配置恢复、空闲停止和独立发布。Windows 额外运行三个真实 CMD 的模拟启停/查看；其他平台跳过 CMD 测试，使用 Node 命令。GitHub Actions 配置包含 Windows/Linux 两个平台，但本机验证不等于远程 CI 已运行。

没有 npm 时也可直接运行 `node --test filter.test.cjs config.test.cjs retry.test.cjs performance.test.cjs idle-stop.test.cjs standalone.test.cjs release.test.cjs` 和 `node release.cjs verify`。本目录不附带收费 live-check 探针，真实模型测试须单独明确授权。

## 发布到 GitHub

**不要直接上传当前使用过的整个文件夹。** `.runtime` 含停止令牌、恢复地址及本机日志，属于私有运行资料；`.gitignore` 仅防止通常的误提交，不能清除已经提交的历史，也不能阻止强制添加。

从本目录执行白名单导出，目标必须是尚不存在的目录，且父目录已经存在：

~~~powershell
node .\release.cjs export "D:\path\magpie-auto-open-source"
~~~

路径是占位示例，请替换为自己的位置。工具只导出明确列出的源码、测试、脚本、许可证及文档，生成独立 SHA256SUMS.txt；不复制 .runtime、配置、日志、数据库、环境文件、node_modules 或未知新增文件，不覆盖已有目录，也不修改运行服务。以后新增公开源码时需同步 release.cjs 白名单和测试。

在导出的目录执行 `npm test` 和 `npm run check`，检查无私人内容后，以**这个干净目录**作为新 GitHub 仓库根目录提交。`package.json` 的 private=true 仅禁止意外发布到 npm，不影响 GitHub 开源。MIT 允许修改及再发布，必须保留 LICENSE 版权声明。

修改公开源码后，重新导出会生成新校验值。若还需刷新工作目录校验清单，可从刚导出的干净目录复制 SHA256SUMS.txt 回来；清单不包含自身，也不是发布者身份签名。`.gitattributes` 保留文件字节，避免 Windows/Linux 换行转换使校验失效。

## 目录结构

- `filter.cjs`：唯一推荐入口，固定 Magpie 条件清理，默认 18184 和本目录 .runtime。
- `core.cjs`：本目录内的进程管理、状态、日志和恢复调度；不是另一个服务。
- `proxy.cjs` / `policy.cjs`：HTTP/SSE、有限重试、取消和策略实现。
- `config.cjs` / `magpie-config.cjs`：本目录内的配置解析、原子写入及 Magpie 多入口接管。
- `*.test.cjs` / `test-support.cjs`：无需账号的本地验证。
- `release.cjs`：干净源码导出和完整性检查。
- `AGENT_SETUP.md`：供接收者的 Agent 使用的独立安装/调试指南。

内核保留原模式兼容代码以避免重写可靠性逻辑；公开入口拒绝切换到其他模式。只发布本目录不会带来其他过滤器入口或桌面 UI。
