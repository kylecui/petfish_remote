# 基于IM的Hypervisor安全控制体系：IM交互协议设计

## 1. 文档目标

本文档定义基于IM的人机交互协议，用于承载以下能力：

- 告警推送
- 状态查询
- 策略下发
- 临时观测控制
- 阻断/恢复操作
- 审批流
- 解释与审计

本文档不规定具体IM平台实现细节，但默认兼容以下形态：

- 企业微信机器人
- 飞书机器人
- 钉钉机器人
- Slack Bot
- Telegram Bot
- 其它支持Webhook、Slash Command、Bot API的IM平台

---

## 2. 设计原则

IM控制面应满足以下原则：

- **命令简短**：适合聊天窗口直接输入
- **可读可审计**：返回结果尽量结构化，便于留痕
- **权限分级**：高风险动作必须有角色与审批约束
- **默认安全**：未授权命令默认失败
- **可解释**：高风险事件必须支持 explain
- **幂等友好**：重复操作尽量不造成不可控副作用

---

## 3. 角色模型

建议至少定义以下角色：

### 3.1 Viewer
只读权限，可执行：

- 查看告警
- 查询对象状态
- 查询策略摘要
- 查询最近事件
- 请求解释

### 3.2 Operator
运维/值班权限，可执行：

- 启用临时观测
- 调整低风险策略档位
- 添加临时保护对象
- 触发取证摘要导出
- 发起阻断申请

### 3.3 SecurityAdmin
安全管理员权限，可执行：

- 下发阻断
- 恢复阻断
- 修改长期策略
- 审批高风险动作
- 变更白名单/例外列表

### 3.4 AutomationAgent
自动化机器人权限，可执行：

- 自动发送告警
- 自动请求审批
- 在预定义条件下执行低风险处置
- 生成解释摘要与工单内容

---

## 4. 对象标识模型

IM命令中建议使用统一对象标识，避免歧义。

### 4.1 VM对象
格式：
`vm:<vm_id>`

示例：
- `vm:17`
- `vm:web-prod-03`

### 4.2 进程对象
格式：
`proc:<vm_id>:<pid>`
或
`proc:<vm_id>:<process_name>`

示例：
- `proc:web-prod-03:884`
- `proc:web-prod-03:lsass.exe`

### 4.3 模块对象
格式：
`mod:<vm_id>:<module_name>`

### 4.4 告警对象
格式：
`alert:<alert_id>`

### 4.5 策略对象
格式：
`policy:<policy_id>`

### 4.6 保护对象
格式：
`obj:<object_id>`

---

## 5. 命令风格建议

建议使用统一前缀：

`/guard`

结构为：

`/guard <verb> <target> [options]`

例如：

- `/guard status vm:17`
- `/guard explain alert:20391`
- `/guard observe vm:17 --level G2 --duration 60s`
- `/guard block proc:web-prod-03:lsass.exe --reason "credential tampering"`
- `/guard protect obj:kpt_shadow_table`
- `/guard resume vm:17`

---

## 6. 基础命令集

## 6.1 查询类命令

### status
查询对象当前状态。

示例：
`/guard status vm:17`

返回示例：
```text
对象: vm:17
状态: guarded
风险等级: medium
当前观测级别: G1
受保护对象数: 12
最近高风险事件: 2
最近策略动作: observe-upgrade
最近变更时间: 2026-05-05T14:42:11Z
```

### events
查询最近事件。

示例：
`/guard events vm:17 --last 10m`

### policy
查询生效策略摘要。

示例：
`/guard policy vm:17`

### explain
解释某条告警或某次阻断。

示例：
`/guard explain alert:20391`

返回重点应包括：

- 告警对象
- 触发原语
- 语义重建结果
- 命中规则
- 风险理由
- 推荐动作
- 是否已自动处置

---

## 6.2 观测控制类命令

### observe
提升目标的观测等级。

示例：
`/guard observe vm:17 --level G2 --duration 60s`

含义：
- 将 vm:17 提升至 G2 短窗口高分辨观测模式
- 持续 60 秒
- 超时后自动恢复默认档位

### watch
把某个对象加入重点关注列表。

示例：
`/guard watch proc:web-prod-03:lsass.exe --ttl 1h`

### unwatch
取消重点关注。

示例：
`/guard unwatch proc:web-prod-03:lsass.exe`

---

## 6.3 保护控制类命令

### protect
将对象加入保护集。

示例：
`/guard protect obj:kernel_token_region`

### unprotect
将对象移出保护集。

示例：
`/guard unprotect obj:kernel_token_region`

### mode
切换对象保护模式。

示例：
`/guard mode vm:17 --set guarded`

可选模式建议：
- `monitor`
- `guarded`
- `forensic`
- `quarantine`

---

## 6.4 处置类命令

### block
对行为或对象执行阻断。

示例：
`/guard block proc:web-prod-03:884 --reason "suspicious code injection"`

### resume
恢复被阻断对象。

示例：
`/guard resume vm:17`

### isolate
对目标执行隔离。

示例：
`/guard isolate vm:17 --scope network`

### snapshot
触发快照/取证摘要导出。

示例：
`/guard snapshot vm:17 --type forensic`

---

## 6.5 策略变更类命令

### allow
添加例外/白名单。

示例：
`/guard allow proc:web-prod-03:backup-agent.exe --for behavior:kernel_table_write --ttl 24h`

### deny
增加禁止规则。

示例：
`/guard deny vm:17 --for behavior:newly-executable-memory`

### commit
把临时策略固化为正式策略。

示例：
`/guard commit policy:tmp-392`

### rollback
回滚最近一次策略变更。

示例：
`/guard rollback policy:238`

---

## 7. 告警消息格式

IM中的告警不应直接倾倒原始底层事件，而应输出“低层原语 + 高层语义”的摘要。

推荐格式：

```text
[HIGH] Hypervisor Guard Alert
对象: vm:web-prod-03 / proc:lsass.exe
事件: protected-page-write
语义: suspicious credential region tampering
风险评分: 92
动作: blocked
原因: unsigned thread attempted write into protected credential region
建议: review explain /guard explain alert:20391
告警ID: alert:20391
时间: 2026-05-05T14:42:11Z
```

### 7.1 告警最小字段

- 严重级别
- 告警ID
- 目标对象
- 原始触发类型
- 语义解释
- 风险评分
- 当前处置
- 推荐下一步
- 时间戳

### 7.2 告警等级建议

- `INFO`
- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

---

## 8. 审批流设计

高风险动作不应默认自动执行，应支持审批流。

### 8.1 需要审批的动作

建议以下动作默认需审批：

- 挂起 VM
- 长期阻断关键工作负载
- 修改正式白名单
- 切换到 quarantine 模式
- 执行广域策略下发
- 导出高敏感取证数据

### 8.2 审批消息格式

```text
[APPROVAL REQUIRED]
请求动作: suspend vm:web-prod-03
原因: repeated attempts to modify protected kernel object
证据: alert:20391, alert:20395
建议动作: suspend + forensic snapshot
有效期: 5m
批准命令: /guard approve req:7712
拒绝命令: /guard reject req:7712
```

### 8.3 审批命令

- `/guard approve req:7712`
- `/guard reject req:7712 --reason "approved maintenance window"`

---

## 9. explain 能力要求

`explain` 是 IM 控制面的核心能力之一。

一个好的 explain 至少要解释：

- 触发的底层原语是什么
- 为什么这不是普通访问
- 命中了哪条规则
- 系统为何给出当前风险评分
- 已采取了什么动作
- 下一步建议是什么

示例：

```text
Explain for alert:20391
1. 触发原语: write attempt to protected credential region
2. 目标对象: proc:web-prod-03:lsass.exe
3. 来源线程: tid 9184, unsigned module context
4. 行为推断: possible credential tampering or injection path
5. 命中策略: deny untrusted write into protected credential object
6. 当前动作: write blocked, target elevated to G2 for 60s
7. 建议: review module lineage and decide whether to isolate VM
```

---

## 10. 审计与留痕要求

所有通过 IM 发起的控制动作都应记录：

- 操作者
- 原始命令
- 标准化动作
- 目标对象
- 是否成功
- 审批链
- 原因
- 变更前后状态
- 时间戳

建议为每次动作生成：

- action_id
- correlation_id
- related_alert_ids

---

## 11. 安全要求

### 11.1 身份认证
IM 机器人必须识别调用者身份，不能仅信任消息文本。

### 11.2 最小权限
角色只拥有所需最小权限。

### 11.3 双人审批
关键动作建议支持双人审批或高权限审批。

### 11.4 防误触
高风险动作需要：
- 确认提示
- 短时有效期
- 明确目标对象
- 明确影响范围

### 11.5 防重放
每个请求/审批应包含唯一请求ID和有效期。

---

## 12. 建议的最小实现范围

MVP阶段建议先实现以下 IM 能力：

- `/guard status`
- `/guard explain`
- `/guard observe`
- `/guard block`
- `/guard resume`
- `/guard approve`
- `/guard reject`

告警先实现：
- HIGH / CRITICAL 两级
- 结构化摘要
- explain 跳转命令

这已经足够支撑一个闭环原型。

---

## 13. 结论

IM控制面不是数据面，而是：

- 告警面
- 指挥面
- 审批面
- 协同面
- 审计面

因此，它最适合承担：

> “人机交互与控制闭环”

而真正的安全强制执行，仍然必须留在 Hypervisor 一侧。
