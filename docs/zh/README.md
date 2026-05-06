# PetFish Remote (胖鱼遥控器)

PetFish Remote 是一款将本地 AI Agent（如 OpenCode）安全接入 Telegram 的轻量级中间件，支持远程向本地工作区发送指令并接收实时反馈。

## 项目状态

当前版本：0.1.0 (Beta)

## 架构概览

系统由三大核心组件构成。Bot Server 负责与 Telegram 交互，Connector 运行在本地网络，Session Bridge 负责连接具体的 Agent 进程。

```text
[ Telegram ] <---> [ Bot Server ] <=== WebSocket ===> [ Connector ] <---> [ Session Bridge / OpenCode ]
```

## 功能特性

- **安全穿透**：基于 WebSocket 长连接，无需本地暴露公网端口。
- **实时交互**：支持在 Telegram 中直接与 OpenCode 进行对话式编程。
- **多项目管理**：支持单用户绑定并切换多个本地项目。
- **快捷菜单**：提供 Telegram InlineKeyboard 快捷操作按钮。
- **自动更新**：Connector 启动时自动校验版本并按需更新。

## 文档导航

- [客户端安装使用指南](./client-guide.md)：适合需要在本地运行 Agent 并接受远程控制的开发者。
- [服务器自部署指南](./server-guide.md)：适合希望拥有独立中控服务器的团队或个人。
