# Research: PetFish Remote OpenCode Integration Architecture

> Research Type: **Product/Planning** | Status: **Complete** | Started: 2026-05-10 | Completed: 2026-05-10

## Research Question

为什么 petfish_remote 的 PC/IM 共享 session 不稳定？根因是什么？基于 opencode 的原生能力，正确的集成架构应该是什么？

## Core Sub-Questions

1. opencode 启动时的 TUI+Server 模式到底提供了什么能力？
2. 当前 OpenCodeBridge 用了哪些错误的 API 表面？
3. 不稳定的具体故障模式是什么？
4. 正确的集成路径是什么？

## Scope Boundaries

- IN: opencode server API、SDK、SSE event、session 管理
- IN: petfish_remote 当前 OpenCodeBridge 实现
- IN: 已有设计文档中的诊断和迁移方案
- OUT: petfish-bot 产品分离（Phase 5）
- OUT: IM UX 细节（Phase 4）

## Evidence Sources

- opencode 官方文档: https://opencode.ai/docs/server/
- opencode SDK 文档: https://opencode.ai/docs/sdk/
- 项目源码: src/connector/bridges/OpenCodeBridge.ts (935 lines)
- 设计文档: docs/design/shared-session-architecture.md (515 lines)
- 架构审查: docs/architecture-review-2026-05-08.md
- Phase 1 设计: docs/design/phase-1-root-session-binding.md
- Phase 2 设计: docs/design/phase-2-request-lifecycle.md
- 实施计划: docs/design/shared-session-implementation-plan.md

## Output

- **研究报告**: `research/06_outputs/root-cause-and-redesign.md`

## Conclusion

根因不是 `opencode serve` vs `opencode` 的选择问题，而是三个错误的 API 使用模式：
1. TUI 耦合的 prompt 注入（`/tui/*` 而非 `/session/:id/message`）
2. latest-updated 的 session 漂移（而非显式 root-session 绑定）
3. 全局 busy 的 settlement 死锁（而非 SSE `session.idle` 事件）

修复方案：引入 `@opencode-ai/sdk`，替换 OpenCodeBridge.ts 中的 935 行实现为 ~200 行 SDK 调用。预计 4-5 天。
