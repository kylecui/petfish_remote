# PetFish Remote (胖鱼遥控器)

> 从任何平台遥控你的 opencode AI 编程助手：Telegram、Slack、飞书、企业微信或 Web。

## 架构概览

```
┌─────────────┐
│  Telegram   │◄──┐
├─────────────┤   │
│   Slack     │◄──┤     ┌─────────────────┐        ┌─────────────────────┐
├─────────────┤   ├────►│   Bot Server    │◄──WSS──►│  Connector (你的机器)  │
│   Feishu    │◄──┤     │ remote.petfish.ai│        │                     │
├─────────────┤   │     └─────────────────┘        │  ┌───────────────┐  │
│   WeCom     │◄──┤                                │  │ Session Bridge │  │
├─────────────┤   │                                │  │  ↕ opencode   │  │
│   Web UI    │◄──┘                                │  └───────────────┘  │
└─────────────┘                                    └─────────────────────┘
```

**三大组件：**

| 组件 | 职责 | 运行位置 |
|------|------|----------|
| **Bot Server** | 多平台机器人 + Connector 注册中心 | 云端（remote.petfish.ai 或自托管） |
| **Connector** | 维护到服务器的WebSocket连接，管理 Session Bridge | 你的开发机 |
| **Session Bridge** | 将提示词注入运行中的 opencode 会话并收集输出 | 每个 opencode 进程 |

## 功能特性

- **多平台支持**：Telegram、Slack、飞书（Lark）、企业微信和 Web 控制台
- **默认对话模式**：直接发送文字即可，无需前缀
- **原生交互菜单**：`/pf` 显示各平台原生快捷菜单
- **多项目管理**：单个 Connector 可桥接多个项目
- **会话管理**：创建、列表、切换会话；实时输出与输入指示器
- **子Agent追踪**：追踪根会话下的子Agent会话，可配置详细程度
- **模型切换**：`/pf model` 中途切换模型
- **多用户权限**：RBAC角色控制（admin/operator/viewer）+ 9事件审计日志
- **opencode插件**：Bun插件，支持工具拦截、权限自动处理和上下文注入
- **SSH运行时**：通过SSH在远程机器上执行opencode
- **自守护Connector**：自动重启、指数退避、PID管理
- **自动更新**：启动时检查服务器版本，自动升级
- **安全**：Token认证、加密WebSocket、用户白名单、策略引擎
- **AI Agent集成**：添加到AGENTS.md实现每次opencode会话自动启动
- **一键安装**：`curl | bash` 动态注入服务器地址

## 文档导航

- [客户端安装使用指南](./client-guide.md)
- [服务器自部署指南](./server-guide.md)
- [安装与升级](../install.md)
- [API参考](../api.md)
- [架构说明](../architecture.md)
- [安全模型](../security-model.md)
- [部署指南](../deployment.md)
- [opencode集成](../opencode-integration.md)
- [Agent安装](../agent-install.md) · [升级](../agent-upgrade.md)
- [开发指南](../development.md) · [贡献指南](../../CONTRIBUTING.md)
- [路线图](../roadmap.md)
- [更新日志](../../CHANGELOG.md)

## 项目状态

当前版本：0.4.x（Beta）
