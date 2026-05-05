# 常见问题与排障

本文聚焦运行期与配置期故障排查，不覆盖安装流程与功能说明。所有条目统一采用：**问题 → 原因 → 解决方案**。

## 1. 启动问题

### 1.1 Node.js 版本不足
- **问题**：启动时报语法或运行时兼容错误，或项目无法正常构建。
- **原因**：当前 Node.js 主版本低于要求（需要 `>=20`）。
- **解决方案**：执行 `node -v` 检查版本；若主版本小于 20，升级到 Node.js 20+ 后重新执行 `npm run build` 与 `npm start`（或 `npm run dev`）。

### 1.2 `npm install` 失败
- **问题**：安装依赖过程中 `better-sqlite3` 相关步骤失败。
- **原因**：`better-sqlite3` 是 native addon，缺少编译环境（如 `build-essential`、`python3`）或网络拉取异常。
- **解决方案**：先确认系统具备编译工具链与 `python3`，再重试安装；若仍失败，检查网络连通性与 npm registry 可访问性。

### 1.3 `TELEGRAM_BOT_TOKEN` 未设置
- **问题**：启动直接退出，并出现 `TELEGRAM_BOT_TOKEN not set. Configure .env and restart.`。
- **原因**：环境变量未注入，或 `.env` 文件不存在/内容错误。
- **解决方案**：确认项目根目录存在 `.env`，并包含正确的 `TELEGRAM_BOT_TOKEN`；修改后重启进程。

### 1.4 `Cannot find module`
- **问题**：`npm start` 时出现 `Cannot find module ...`。
- **原因**：TypeScript 尚未编译，`dist/` 缺失或产物不完整。
- **解决方案**：先执行 `npm run build` 编译 TypeScript，再执行 `npm start`。

### 1.5 端口冲突（Webhook 模式）
- **问题**：Webhook 启动失败，提示端口被占用或监听失败。
- **原因**：Webhook 服务端口被其他进程占用，或 `config/adapters.yaml` 的 webhook 配置不匹配当前环境。
- **解决方案**：检查端口占用（如 `ss -ltnp | grep <port>`），释放冲突端口或调整 webhook 端口/URL 配置后重启。

## 2. Bot 连接问题

### 2.1 Bot 不响应消息
- **问题**：向 Bot 发送 `/pf help` 或其他命令无返回。
- **原因**：常见为 Token 错误、群组隐私模式未关闭（`/setprivacy`）、或 polling 未启用。
- **解决方案**：
  1. 检查 `.env` 中 `TELEGRAM_BOT_TOKEN` 是否正确；
  2. 群组场景下在 `@BotFather` 执行 `/setprivacy` 并关闭隐私模式；
  3. 检查 `config/adapters.yaml` 中 `adapters.telegram.polling.enabled: true`，并确认服务进程已启动。

### 2.2 `409 Conflict`
- **问题**：日志出现 `409 Conflict`，Bot 无法正常拉取更新。
- **原因**：同一个 Bot Token 同时有多个实例在消费更新（重复 polling/webhook）。
- **解决方案**：停止其他 Bot 实例，仅保留一个活动消费者，再重启当前服务。

### 2.3 Webhook 设置失败
- **问题**：Webhook 注册失败或 Telegram 返回 URL 不可用。
- **原因**：Webhook 需要 HTTPS；域名、证书链或公网可达性不满足要求。
- **解决方案**：确认使用 HTTPS URL，检查域名解析与 TLS 证书配置，确保 Telegram 可访问该 webhook 地址。

### 2.4 Bot 响应慢
- **问题**：命令已接收但长时间无结果。
- **原因**：底层任务依赖 `opencode` CLI，若未安装或不在 `PATH`，任务会阻塞/失败重试。
- **解决方案**：执行 `opencode --version` 验证可执行；若命令不可用，安装 opencode CLI 并确保其在运行用户 `PATH` 中。

## 3. 项目相关问题

### 3.1 `/pf list` 返回空
- **问题**：`/pf list` 没有任何项目。
- **原因**：`config/projects.yaml` 中没有有效的未注释项目配置，或 YAML 缩进/结构错误导致加载为空。
- **解决方案**：检查 `projects:` 下是否存在未注释项目条目，并确认 YAML 缩进合法。

### 3.2 `/pf use` 报错 `Project not found`
- **问题**：执行 `/pf use <project>` 返回 `Project not found: <project>`。
- **原因**：项目标识拼写与 `config/projects.yaml` 的 key 不一致。
- **解决方案**：对照 `projects.yaml` 的项目 key（不是 `name` 显示名）修正命令参数。

### 3.3 `Permission denied` / 无权限访问项目
- **问题**：切换项目时出现权限拒绝（例如 `Access denied to project: <project>`）。
- **原因**：当前用户未被授权该项目。
- **解决方案**：检查 `config/users.yaml` 中对应用户的 `allowed_projects` 是否包含目标项目标识。

### 3.4 项目路径不存在
- **问题**：任务创建后执行失败，提示目录不存在或无法进入项目目录。
- **原因**：`config/projects.yaml` 的 `path` 指向了不存在目录，或路径写错。
- **解决方案**：核对 `path` 为真实绝对路径，并确认运行用户对该目录有访问权限。

## 4. Runtime / 执行问题

### 4.1 `opencode` 命令未找到
- **问题**：任务执行时报 `opencode: command not found` 或等效错误。
- **原因**：运行机未安装 opencode CLI，或 `PATH` 未包含其安装位置，或 `config/runtimes.yaml` 的 `opencode_bin` 配置错误。
- **解决方案**：安装 opencode CLI；确认 `opencode --version` 可执行；必要时在 `runtimes.yaml` 中将 `opencode_bin` 指向绝对路径。

### 4.2 SSH runtime 连接失败
- **问题**：使用 SSH runtime 时无法连接远端。
- **原因**：`host`/`port`/`user`/`identity_file` 配置不正确，或 SSH key/网络不可用。
- **解决方案**：先用手工命令验证（如 `ssh -i <key> <user>@<host> -p <port>`）；通过后再回填并核对 `config/runtimes.yaml`。

### 4.3 WSL runtime 失败
- **问题**：WSL runtime 无法启动或找不到 distro。
- **原因**：目标 WSL distro 未安装，或 `runtimes.yaml` 中 `distro` 名称不匹配。
- **解决方案**：执行 `wsl -l -v` 检查已安装发行版与状态，并将 runtime 配置中的 `distro` 改为准确名称。

### 4.4 任务超时
- **问题**：任务在运行中被自动终止。
- **原因**：超过 `config/runtime.yaml` 中 `max_task_runtime_seconds`（默认 `1800` 秒）。
- **解决方案**：
  1. 对长任务拆分为更小步骤；
  2. 或按需调大 `max_task_runtime_seconds` 后重启服务；
  3. 同时排查是否存在外部命令卡住。

### 4.5 任务一直 `pending`
- **问题**：任务状态长期停留在 `pending`/排队，不进入执行。
- **原因**：常见为 opencode 进程无响应、runtime 不可用或队列处理异常。
- **解决方案**：检查 `.runtime/logs/` 日志与进程状态，确认 opencode 可正常调用；必要时重启服务并复测最小命令。

## 5. 策略与审批问题

### 5.1 操作被拒绝
- **问题**：某些读写/执行动作被直接拒绝。
- **原因**：命中 `config/policies.yaml` 中对应 profile 的 `deny` 规则。
- **解决方案**：定位被拒绝动作，检查 `deny` 列表匹配项；若业务必须执行，调整策略后再重启并复测。

### 5.2 总是需要审批
- **问题**：很多操作都会进入审批流。
- **原因**：命中 `require_approval` 规则，可能是通配符范围过大（如 `write:**/*.ts`、`docker:*`）。
- **解决方案**：检查 `policies.yaml` 的 `require_approval` 配置，收敛匹配范围或拆分 profile。

### 5.3 审批按钮不出现
- **问题**：消息里看不到审批入口，无法 `/pf approve`。
- **原因**：用户角色缺少审批权限，`roles.<role>.can_approve` 为 `false`。
- **解决方案**：检查 `config/users.yaml` 的用户角色与 `roles` 配置，确保审批人角色具备 `can_approve: true`。

## 6. 数据库问题

### 6.1 SQLite 锁定
- **问题**：出现 `database is locked` 或写入阻塞。
- **原因**：多个实例同时访问同一个 `.runtime/petfish.db`。
- **解决方案**：确保同一 runtime 目录仅运行一个 PetFish Remote 实例；停掉重复实例后重试。

### 6.2 数据库损坏
- **问题**：启动时 SQLite 报损坏或读取异常。
- **原因**：非正常中断、磁盘问题或文件损坏。
- **解决方案**：先备份 `.runtime/petfish.db`，再删除该文件并重启；系统会自动重建数据库（历史数据需从备份恢复）。

### 6.3 磁盘空间不足
- **问题**：日志/附件/数据库写入失败。
- **原因**：`.runtime/` 目录持续增长导致磁盘空间不足。
- **解决方案**：检查 `.runtime/` 占用并清理历史日志、无用附件，必要时迁移运行目录到更大磁盘。

## 7. 日志与调试

### 7.1 如何查看详细日志
- **问题**：默认日志信息不足以定位问题。
- **原因**：日志级别过低。
- **解决方案**：在 `.env` 设置 `PETFISH_LOG_LEVEL=debug`，重启后复现问题并抓取日志。

### 7.2 日志文件位置
- **问题**：不知道到哪里看运行日志。
- **原因**：未明确 runtime 日志目录。
- **解决方案**：默认查看 `.runtime/logs/`（对应 `config/runtime.yaml` 的 `logs_dir`）。

### 7.3 systemd 日志查看
- **问题**：systemd 托管场景下需要实时观察服务输出。
- **原因**：日志进入 journald，而非当前终端。
- **解决方案**：使用 `journalctl -u petfish-remote -f` 实时跟踪服务日志。

---

如仍无法定位问题，建议最小化复现：只保留一个项目、一个用户、local runtime，并先验证 `/pf help` 与 `/pf list` 的基础链路，再逐步恢复复杂配置。
