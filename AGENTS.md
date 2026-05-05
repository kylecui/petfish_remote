<!-- BEGIN pack: repo-deploy-ops-skill-pack -->
# Repo Deployment & Operations Rules

本项目包含一套用于 **repo部署、验证、运维、回滚** 的OpenCode skills。

## 工作原则

-当用户要求“读取repo/GitHub项目并部署到指定主机”时，优先走完整链路：
  1. `repo-runtime-discovery`
  2. `target-host-readiness`
  3. `deployment-executor`
  4. `deployment-verifier`
  5. 如需持续管理，再使用 `service-operations`
  6. 如遇异常，再使用 `incident-rollback`

-如果用户给的是宽泛任务，例如：
  - “帮我把这个仓库部署到10.0.0.5”
  - “把这个GitHub repo跑起来并验收”
  - “把这个服务上线后帮我持续运维”

  优先启用 `repo-service-lifecycle` 作为总控技能。

## 必须遵守

-先分析repo与目标主机，再选择部署方式。
-不得在未形成最小部署计划前直接执行高风险变更。
-涉及覆盖、替换、重启、删除、迁移时，必须先说明：
  -本次动作影响范围
  -回滚入口
  -验证办法
-部署完成后必须给出至少一份验证结果：
  -健康检查
  -功能smoke test
  -日志核验
  -端口/进程/页面/API结果
-任何长期运维动作都要记录版本、时间、路径、端口、依赖、观察点。

## 输出偏好

当任务涉及部署或运维时，默认输出以下结构：

1. **识别结果**
2. **部署计划**
3. **执行结果**
4. **验证结果**
5. **回滚点**
6. **后续运维建议**

## 懒加载参考文件

只在需要时读取skill中的 `references/*.md` 与 `assets/*` 文件，不要一次性全部加载。
<!-- END pack: repo-deploy-ops-skill-pack -->


<!-- BEGIN pack: petfish-style-skill -->
# AGENTS.md

## Project Writing Policy

When the user asks to rewrite, polish, humanize, formalize, simplify, or make text closer to Petfish's writing style, use the local skill:

- `.opencode/skills/petfish-style-rewriter/SKILL.md`

Default mode is `strict` when the user says:

-用我的语言习惯表达
-按我的风格写
-说人话
-去AI味
-让我们润色一下

## Priority

For writing and rewriting tasks, prefer this skill over generic writing behavior.

## Default Output Expectations

- Clear structure
- Problem-driven analysis
- Concise language
- Evidence-based claims
- No rhetorical exaggeration
- No internet-style slogans
- No unnecessary conclusion
- Chinese-English mixed technical terms must be compact: use `Webhook挂载`, `Git提交`, `API接口`, not `Webhook挂载`, `Git提交`, `API接口`

## Important Distinction

Thinking can be exploratory, but final writing must be structured. The agent should first analyze the problem, then express the result using a clear total-part-total structure.

## Suggested User Prompts

-用我的语言习惯表达：...
-让我们润色一下：...
-说人话：...
-按petfish风格重写：...
-去掉AI味并保持工程化表达：...
<!-- END pack: petfish-style-skill -->


<!-- BEGIN pack: anti-sycophancy-calibration-pack -->
# Anti-Sycophancy Calibration Pack

本pack提供一个用于反迎合决策校准的prompt skill，帮助Agent在评审、方案设计、代码审查、写作反馈等判断型任务中减少顺着用户说的倾向。

## 何时启用

- 用户要求评审、评价、批判、review、critique、feedback、judgment、decision、evaluation、calibration
- 用户在问“对吗？/right?/是不是?/你同意吗?/is this correct?”这类确认性问题
- 用户需要方案评估、可行性分析、code review、架构判断、论文或提案反馈

## 行为规则

- 先中性化问题，再给结论；不要直接顺着用户预设表态
- 先给评分维度，再做判断；至少补一个反方或替代方案
- 结论与置信度必须分开表达；证据不足时要明确降级
- 不把skill用成“杠精模式”；该同意时同意，该保留时保留，该反对时反对
- 简单事实查询、翻译、排版、机械编辑默认不启用，除非用户明确要求 judgment或critique

## 组合示例

- `course-outline-design + anti-sycophancy-calibration`：避免课程大纲只顺着最初设想扩写
- `code-review + anti-sycophancy-calibration`：避免审查只给礼貌性正反馈
- `petfish-style-rewriter + anti-sycophancy-calibration`：在润色同时指出论证漏洞和边界条件
- `strategy-writer + anti-sycophancy-calibration`：把支持理由、反对理由、替代路线拆开表达
<!-- END pack: anti-sycophancy-calibration-pack -->


<!-- BEGIN pack: fish-trail -->
# Fish Trail — 话题治理器

本pack为项目提供上下文治理能力，降低跨话题污染风险。

## Always-On行为（每次交互自动执行）

### 交互前检查

每次收到用户消息时，调用MCP tool `topic_detect`判断当前消息与活跃topic的关系。若有可用的session_id（如OpenCode session ID），应在调用时传入`session_id`参数以启用会话追踪。根据返回的风险等级执行对应行为：

| 风险等级 | 行为 |
|---------|------|
| low (0-30) | 静默继续，不做任何提示 |
| medium (31-60) | 在回复开头用一行简要说明上下文继承范围，例如："当前继续topic「X」，继承上下文包含Y和Z。" |
| high (61-100) | 主动向用户说明话题变更风险，建议处理策略（fork/switch/reset），加载fish-trail skill执行深度治理 |

### 交互后更新

当本次交互产生实质性成果（代码变更、文档输出、决策结论等）时，调用`topic_update`更新当前topic的summary和status。

### 会话管理

fish-trail支持会话级追踪。会话（session）绑定外部平台的session ID或自动推断创建。

- **会话绑定**：在会话开始时调用`session_bind`绑定外部session_id和当前topic
- **事件追踪**：`topic_detect`传入`session_id`时，自动记录话题切换事件到session timeline
- **会话查询**：通过`session_list`按topic、时间、状态过滤，回答"昨天我们做了什么？"
- **会话恢复**：通过`session_resume`查找与特定topic关联的最近session，支持跨会话上下文继承

会话数据存储在`.petfish/fish-trail/sessions/`，与topic数据独立管理。

### 话题关系类型

检测到的关系类型决定上下文处理策略：

- **continue**：完全继承当前上下文
- **fork**：从当前topic分叉，继承部分上下文，创建子topic
- **switch**：切换到已有topic，加载该topic的Context Package
- **merge**：合并两个topic（需用户确认）
- **archive**：归档当前topic，冻结上下文
- **reset**：清空上下文，建立干净包
- **bridge**：两个topic间建立桥接，只继承交叉部分（需用户确认）

对merge、archive、bridge三种类型，检测置信度较低时必须提示用户确认，不得自动执行。

### 会话边界自动管理

fish-trail自动管理会话边界：

- `topic_detect`检测到archive或reset信号时，自动关闭关联session
- `session_bind`时自动清理不活跃超过24小时的session
- 使用`session_close`显式关闭session并附带summary
- `session_resume`返回resume context（session summary + timeline digest），支持跨会话上下文继承
- 新增`session_timeline`查看session时间线摘要
- 使用`session_query`按时间范围、topic、agent查询活动（回答"昨天我们做了什么？"）
- 使用`session_agents`查看agent-topic归属关系（哪个agent处理了哪个topic）
- 使用`topic_recommend`从topic图谱推荐关联topic

### MCP不可用时的降级行为

当context-state MCP server未启动、连接失败或调用超时时：

- 不报错，不阻塞正常工作
- 在回复中附带一行提示："⚠ fish-trail MCP未连接，话题治理未激活。"
- 跳过所有topic_detect和topic_update调用
- 每次会话最多提示一次，避免重复干扰

## 深度治理触发条件

以下情况自动加载`.opencode/skills/fish-trail/SKILL.md`执行完整5步工作流：

- topic_detect返回风险等级high
- 用户主动要求话题管理（"整理一下话题"、"切换到X"、"把这两个话题合并"等）
- 用户使用fish-trail相关关键词（topic、话题、上下文、污染、继承、隔离等）
<!-- END pack: fish-trail -->
