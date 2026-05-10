import path from 'node:path';

import { loadConfig } from './config.js';
import { TelegramAdapter } from './adapters/telegram/TelegramAdapter.js';
import { FeishuAdapter } from './adapters/feishu/FeishuAdapter.js';
import { SlackAdapter } from './adapters/slack/SlackAdapter.js';
import type { IMAdapter, AdapterDeps, AdapterInboundEvent, SessionListEntry } from './adapters/types.js';
import { CommandRouter } from './core/CommandRouter.js';
import type { ParsedCommand } from './core/CommandRouter.js';
import { ProjectRegistry } from './core/ProjectRegistry.js';
import { SessionManager } from './core/SessionManager.js';
import { TaskManager } from './core/TaskManager.js';
import { PolicyEngine } from './core/PolicyEngine.js';
import type { PolicyConfig } from './core/PolicyEngine.js';
import { AuditLogger } from './core/AuditLogger.js';
import { RuntimeRouter } from './runtime/RuntimeRouter.js';
import { LocalRuntime } from './runtime/LocalRuntime.js';
import { SshRuntime } from './runtime/SshRuntime.js';
import { RemoteRuntime } from './runtime/RemoteRuntime.js';
import { MessageRenderer } from './render/MessageRenderer.js';
import { OutputBatcher } from './render/OutputBatcher.js';
import { DiffRenderer } from './render/DiffRenderer.js';
import { telegramRenderPolicy } from './render/renderPolicy.js';
import { feishuRenderPolicy } from './adapters/feishu/feishuRenderPolicy.js';
import { slackRenderPolicy } from './adapters/slack/slackRenderPolicy.js';
import { ConnectorAuth } from './server/ConnectorAuth.js';
import { ConnectorGateway } from './server/ConnectorGateway.js';
import { RegistrationService } from './server/RegistrationService.js';
import { createEnvelope, MSG } from './protocol/connectorProtocol.js';
import type { TaskQuestionPayload, TaskPermissionPayload } from './protocol/connectorProtocol.js';
import { Storage } from './storage/sqlite.js';
import type { ChatEvent, ChatResponse, ExecutionMode, Platform } from './types.js';

const configDir = process.env.PETFISH_CONFIG_DIR ?? './config';
const runtimeDir = process.env.PETFISH_RUNTIME_DIR ?? './.runtime';

const config = loadConfig(configDir);

const dbPath = path.join(runtimeDir, 'petfish.db');
const storage = new Storage(dbPath);
storage.init();

const projectRegistry = new ProjectRegistry(config.projects);
const sessionManager = new SessionManager(storage);
const commandRouter = new CommandRouter();

const policyConfig: PolicyConfig = {
  blockedTargets: ['.env', 'id_rsa', 'secret'],
  highRiskProfiles: ['kernel-ebpf'],
  requireApprovalActions: ['write', 'exec', 'docker'],
};
const policyEngine = new PolicyEngine(policyConfig);
const auditLogger = new AuditLogger(storage);
const messageRenderer = new MessageRenderer();
const runtimeRouter = new RuntimeRouter(config.runtimes);

for (const rt of config.runtimes) {
  if (rt.type === 'local') {
    runtimeRouter.registerConnector(rt.id, new LocalRuntime(rt.id, rt.opencode_bin));
  } else if (rt.type === 'ssh' && rt.host && rt.user) {
    runtimeRouter.registerConnector(rt.id, new SshRuntime(rt.id, rt.host, rt.user, rt.identity_file, rt.port, rt.opencode_bin));
  }
}

let gateway: ConnectorGateway | undefined;
let registrationService: RegistrationService | undefined;
const taskIdToChatId = new Map<string, { platform: Platform; chatId: string }>();
const connectorIdToChatId = new Map<string, { platform: Platform; chatId: string }>();
const questionIdToContext = new Map<string, { connectorId: string; taskId: string }>();
const permissionIdToContext = new Map<string, { connectorId: string; taskId: string }>();
const sessionListCallbacks = new Map<string, { resolve: (sessions: SessionListEntry[]) => void }>();

function resolveChatId(taskId: string, connectorId: string): { platform: Platform; chatId: string } | undefined {
  const fromTask = taskIdToChatId.get(taskId);
  if (fromTask) return fromTask;

  const fromConnector = connectorIdToChatId.get(connectorId);
  if (fromConnector) return fromConnector;

  if (!gateway) return undefined;
  const connInfo = gateway.registry.get(connectorId);
  if (connInfo) {
    for (const proj of connInfo.projects) {
      const result = storage.getChatIdByProject(proj.id);
      if (result) return result;
    }
  }

  return undefined;
}

if (config.gateway.enabled) {
  const auth = new ConnectorAuth(config.connector_tokens);

  registrationService = new RegistrationService({
    storage,
    onProjectRegistered: (userId, projectId, projectName, projectPath) => {
      const existing = projectRegistry.getProject(projectId);
      if (!existing) {
        projectRegistry.addProject({
          id: projectId,
          name: projectName,
          runtime: 'connector',
          path: projectPath,
          default_mode: 'read_only',
          allowed_users: [userId],
          readme_files: [],
          test_commands: {},
          risk_profile: 'default',
          secrets_policy: 'mask',
        });
      } else {
        projectRegistry.addUserToProject(projectId, userId);
      }
      console.log(`[registration] Project ${projectId} registered for user ${userId}`);
    },
  });

  gateway = new ConnectorGateway({
    port: config.gateway.port,
    path: config.gateway.path,
    pingIntervalMs: config.gateway.pingIntervalMs,
    auth,
    registrationService,
  });

  gateway.setProjectListProvider(() =>
    projectRegistry.listProjects().map(({ id, name, runtime, path, allowed_users }) => ({
      id, name, runtime, path, allowed_users,
    })),
  );

  for (const token of registrationService.getPersistedTokens()) {
    auth.addWildcardToken(token);
  }

  for (const rt of config.runtimes) {
    if (rt.type === 'connector') {
      const remote = new RemoteRuntime(rt.id, rt.host ?? undefined, gateway);
      runtimeRouter.registerConnector(rt.id, remote);
    }
  }

  const dynamicRuntime = new RemoteRuntime('connector', undefined, gateway);
  runtimeRouter.registerConnector('connector', dynamicRuntime);

  gateway.on('connector:change', (connectorId: string, info: unknown) => {
    if (info && typeof info === 'object' && 'projects' in info) {
      const connInfo = info as { projects: Array<{ id: string; path: string }>; userId?: string };
      for (const proj of connInfo.projects) {
        if (!projectRegistry.getProject(proj.id)) {
          projectRegistry.addProject({
            id: proj.id,
            name: proj.id,
            runtime: 'connector',
            path: proj.path,
            default_mode: 'read_only',
            allowed_users: connInfo.userId ? [connInfo.userId] : [],
            readme_files: [],
            test_commands: {},
            risk_profile: 'default',
            secrets_policy: 'mask',
          }, connectorId);
          console.log(`[auto-register] Project ${proj.id} added from connector ${connectorId}${connInfo.userId ? ` for user ${connInfo.userId}` : ''}`);
        }
      }
    }

    if (adapterMap.size === 0) return;
    const status = info ? '🟢 online' : '🔴 offline';

    if (!info) {
      const removed = projectRegistry.removeProjectsByConnector(connectorId);
      if (removed.length > 0) {
        console.log(`[auto-unregister] Removed projects [${removed.join(', ')}] — connector ${connectorId} disconnected`);
      }

      const target = connectorIdToChatId.get(connectorId);
      if (target) {
        const targetAdapter = adapterMap.get(target.platform);
        if (targetAdapter) {
          targetAdapter.sendMessage({
            platform: target.platform,
            chat_id: target.chatId,
            message_type: 'text',
            text: `⚠️ Connector \`${connectorId}\` disconnected. It may be restarting — replies paused until reconnect.`,
          }).catch((err) => console.error(`[connector] Failed to send disconnect notice:`, err));
        }
      }
    }

    const adminChatId = process.env.PETFISH_ADMIN_CHAT_ID;
    const adminPlatform = (process.env.PETFISH_ADMIN_PLATFORM ?? 'telegram') as Platform;
    if (adminChatId) {
      const adminAdapter = adapterMap.get(adminPlatform);
      if (adminAdapter) {
        adminAdapter.sendMessage({
          platform: adminPlatform,
          chat_id: adminChatId,
          message_type: 'text',
          text: `Connector ${connectorId} is now ${status}`,
        }).catch(() => {});
      }
    }
  });

  gateway.on('task:question', (connectorId: string, payload: TaskQuestionPayload) => {
    questionIdToContext.set(payload.questionId, { connectorId, taskId: payload.taskId });
    if (!taskIdToChatId.has(payload.taskId)) {
      console.log(`[question] Skipping relay for ${payload.questionId} — taskId=${payload.taskId} has no IM origin`);
      return;
    }
    const target = resolveChatId(payload.taskId, connectorId);
    if (!target) {
      console.warn(`[question] No chatId found for taskId=${payload.taskId} connectorId=${connectorId}`);
      return;
    }
    const targetAdapter = adapterMap.get(target.platform);
    if (!targetAdapter) return;
    console.log(`[question] Relaying question ${payload.questionId} to ${target.platform}:${target.chatId}`);
    void targetAdapter.sendInteraction({ type: 'question', chatId: target.chatId, payload });
  });

  gateway.on('task:permission', (connectorId: string, payload: TaskPermissionPayload) => {
    permissionIdToContext.set(payload.permissionId, { connectorId, taskId: payload.taskId });
    if (!taskIdToChatId.has(payload.taskId)) {
      console.log(`[permission] Skipping relay for ${payload.permissionId} — taskId=${payload.taskId} has no IM origin`);
      return;
    }
    const target = resolveChatId(payload.taskId, connectorId);
    if (!target) {
      console.warn(`[permission] No chatId found for taskId=${payload.taskId} connectorId=${connectorId}`);
      return;
    }
    const targetAdapter = adapterMap.get(target.platform);
    if (!targetAdapter) return;
    console.log(`[permission] Relaying permission ${payload.permissionId} to ${target.platform}:${target.chatId}`);
    void targetAdapter.sendInteraction({ type: 'permission', chatId: target.chatId, payload });
  });

  gateway.on('session:list', (_connectorId: string, payload: { requestId: string; sessions: SessionListEntry[] }) => {
    const cb = sessionListCallbacks.get(payload.requestId);
    if (cb) {
      sessionListCallbacks.delete(payload.requestId);
      cb.resolve(payload.sessions);
    }
  });

  void gateway.start();
  console.log(`ConnectorGateway started on :${config.gateway.port}${config.gateway.path}`);
}

const taskManager = new TaskManager(storage, runtimeRouter, projectRegistry, policyEngine);

const adapterMap = new Map<Platform, IMAdapter>();

function getAdapterForEvent(event: ChatEvent): IMAdapter | undefined {
  return adapterMap.get(event.platform);
}

function dispatchAgentTask(event: ChatEvent, projectId: string, userId: string, instruction: string, mode: ExecutionMode): void {
  if (gateway && !gateway.registry.findByProject(projectId)) {
    const eventAdapter = getAdapterForEvent(event);
    if (eventAdapter) {
      eventAdapter.sendMessage({
        platform: event.platform,
        chat_id: event.chat_id,
        reply_to: event.message_id,
        message_type: 'text',
        text: `⚠️ Project \`${projectId}\` has no active connector. The connector may be offline — please check and reconnect.`,
      }).catch((err) => console.error(`[dispatch] Failed to send offline notice:`, err));
    }
    return;
  }

  const task = taskManager.createTask({ project_id: projectId, user_id: userId, instruction, mode });
  sessionManager.updateTask(event.platform, event.chat_id, task.task_id);
  taskIdToChatId.set(task.task_id, { platform: event.platform, chatId: event.chat_id });
  if (gateway) {
    const ci = gateway.registry.findByProject(projectId);
    if (ci) connectorIdToChatId.set(ci.connectorId, { platform: event.platform, chatId: event.chat_id });
  }

  const eventAdapter = getAdapterForEvent(event);
  if (eventAdapter) {
    void eventAdapter.sendTyping(event.chat_id);
    eventAdapter.sendMessage({
      platform: event.platform,
      chat_id: event.chat_id,
      reply_to: event.message_id,
      message_type: 'markdown',
      text: `📂 *${projectId}* · Task \`${task.task_id}\` accepted`,
    }).catch((err) => console.error(`[dispatch] Failed to send acceptance message:`, err));
  }

  const renderPolicy = event.platform === 'feishu' ? feishuRenderPolicy
  : event.platform === 'slack' ? slackRenderPolicy
  : telegramRenderPolicy;

  const batcher = new OutputBatcher(
    (text, plain) => {
      const a = getAdapterForEvent(event);
      if (!a) return Promise.resolve();
      return a.sendMessage({
        platform: event.platform,
        chat_id: event.chat_id,
        reply_to: event.message_id,
        message_type: plain ? 'text' : 'markdown',
        text,
      }).catch((err) => {
        console.error(`[batcher] Failed to send output to ${event.platform}:${event.chat_id}:`, err);
      });
    },
    task.task_id,
    undefined,
    undefined,
    projectId,
    renderPolicy,
  );

  const typingInterval = setInterval(() => {
    const a = getAdapterForEvent(event);
    if (a) void a.sendTyping(event.chat_id);
  }, 4000);

  taskManager.dispatchTask(task.task_id, (chunk) => {
    batcher.append(chunk);
  }).then((result) => {
    clearInterval(typingInterval);
    const a = getAdapterForEvent(event);
    if (a) a.clearPendingInteraction(event.chat_id);
    void batcher.complete(result.exitCode);
    if (result.files && result.files.length > 0 && a) {
      const summary = new DiffRenderer().renderDiffSummary(result.files);
      if (summary) {
        void a.sendMessage({
          platform: event.platform,
          chat_id: event.chat_id,
          message_type: 'markdown',
          text: summary,
        }).catch((err: unknown) => console.error(`[dispatch] diff summary send failed:`, err));
      }
    }
  }).catch((err: unknown) => {
    clearInterval(typingInterval);
    const a = getAdapterForEvent(event);
    if (a) a.clearPendingInteraction(event.chat_id);
    const msg = err instanceof Error ? err.message : String(err);
    void batcher.fail(msg);
  });
}

async function handleChatEvent(event: ChatEvent): Promise<void> {
  const userId = `${event.platform}:${event.user_id}`;

  auditLogger.log({ task_id: undefined, user_id: userId, event_type: 'message_received', payload: event.text });

  const eventAdapter = adapterMap.get(event.platform);
  if (eventAdapter && !event.text.startsWith('/') && eventAdapter.hasPendingInteraction(event.chat_id)) {
    if (eventAdapter instanceof TelegramAdapter) {
      const handled = eventAdapter.handleCustomTextAnswer(event.chat_id, event.text);
      if (handled) return;
    } else {
      console.log(`[${event.platform}] Clearing stale pending interaction for chat=${event.chat_id} — user sent new message`);
      eventAdapter.clearPendingInteraction(event.chat_id);
    }
  }

  let parsed: ParsedCommand;
  try {
    parsed = commandRouter.parseCommand(event.text);
  } catch {
    const session = sessionManager.getSession(event.platform, event.chat_id);
    if (session?.project_id && !event.text.startsWith('/')) {
      parsed = { name: 'ask' as const, args: [event.text], rawText: event.text };
    } else {
      return;
    }
  }

  let responseText: string;

  const commandDecision = policyEngine.evaluateCommand(parsed.name);
  if (commandDecision === 'deny') {
    const adapter = getAdapterForEvent(event);
    if (adapter) {
      await adapter.sendMessage({
        platform: event.platform,
        chat_id: event.chat_id,
        message_type: 'text',
        text: `⛔ Command \`${parsed.name}\` is not allowed.`,
      });
    }
    return;
  }

  switch (parsed.name) {
    case 'help': {
      responseText = messageRenderer.renderHelp();
      break;
    }
    case 'list': {
      const projects = projectRegistry.listProjects();
      responseText = messageRenderer.renderProjectList(projects);
      break;
    }
    case 'use': {
      const projectId = parsed.args[0];
      if (!projectId) {
        responseText = 'Usage: /pf use <project>';
        break;
      }
      const project = projectRegistry.getProject(projectId);
      if (!project) {
        responseText = `Project not found: ${projectId}`;
        break;
      }
      if (!projectRegistry.isUserAllowed(projectId, userId)) {
        responseText = `Access denied to project: ${projectId}`;
        break;
      }
      sessionManager.bindProject(event.platform, event.chat_id, projectId);
      responseText = messageRenderer.renderProjectBound(project);
      break;
    }
    case 'where': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project>';
        break;
      }
      const proj = projectRegistry.getProject(session.project_id);
      responseText = proj
        ? `Bound to: ${proj.name}\nPath: ${proj.path}\nMode: ${session.mode}`
        : `Bound to unknown project: ${session.project_id}`;
      break;
    }
    case 'ask': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      const instruction = parsed.args.length > 0 ? parsed.args.join(' ') : parsed.rawText;
      if (!instruction) {
        responseText = 'Usage: /pf ask <instruction>';
        break;
      }
      dispatchAgentTask(event, session.project_id, userId, instruction, 'read_only');
      responseText = '';
      break;
    }
    case 'edit': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      const editInstruction = parsed.args.length > 0 ? parsed.args.join(' ') : '';
      if (!editInstruction) {
        responseText = 'Usage: /pf edit <instruction>';
        break;
      }
      dispatchAgentTask(event, session.project_id, userId, editInstruction, 'edit_guarded');
      responseText = '';
      break;
    }
    case 'test': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      dispatchAgentTask(event, session.project_id, userId, 'Run the project tests and report results.', 'read_only');
      responseText = '';
      break;
    }
    case 'diff': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      dispatchAgentTask(event, session.project_id, userId, 'Show the current git diff (staged and unstaged changes). Output the diff directly.', 'read_only');
      responseText = '';
      break;
    }
    case 'approve': {
      const approvalId = parsed.args[0];
      if (!approvalId) {
        responseText = 'Usage: /pf approve <id>';
        break;
      }

      const approveTask = taskManager.getTask(approvalId);
      if (approveTask?.status === 'waiting_approval') {
        const approvePolicy = event.platform === 'feishu' ? feishuRenderPolicy
          : event.platform === 'slack' ? slackRenderPolicy
          : telegramRenderPolicy;
        const batcher = new OutputBatcher(
          (text, plain) => {
            const a = getAdapterForEvent(event);
            if (!a) return Promise.resolve();
            return a.sendMessage({
              platform: event.platform,
              chat_id: event.chat_id,
              message_type: plain ? 'text' : 'markdown',
              text,
            }).catch((err) => {
              console.error(`[batcher] Failed to send output:`, err);
            });
          },
          approvalId,
          undefined,
          undefined,
          approveTask.project_id,
          approvePolicy,
        );

        const typingInterval = setInterval(() => {
          const a = getAdapterForEvent(event);
          if (a) void a.sendTyping(event.chat_id);
        }, 4000);

        taskManager.approveTask(approvalId, (chunk) => {
          batcher.append(chunk);
        }).then((result) => {
          clearInterval(typingInterval);
          void batcher.complete(result.exitCode);
        }).catch((err: unknown) => {
          clearInterval(typingInterval);
          const msg = err instanceof Error ? err.message : String(err);
          void batcher.fail(msg);
        });

        responseText = `✅ Approved task ${approvalId}. Executing...`;
        break;
      }

      const permCtx = permissionIdToContext.get(approvalId);
      if (!permCtx) {
        responseText = `Approval not found or already handled: ${approvalId}`;
        break;
      }
      permissionIdToContext.delete(approvalId);
      if (gateway) {
        gateway.sendPermissionReply(permCtx.connectorId, permCtx.taskId, approvalId, true);
      }
      responseText = `✅ Approved: ${approvalId}`;
      break;
    }
    case 'deny': {
      const denyId = parsed.args[0];
      if (!denyId) {
        responseText = 'Usage: /pf deny <id>';
        break;
      }

      const denyTask = taskManager.getTask(denyId);
      if (denyTask?.status === 'waiting_approval') {
        taskManager.denyTask(denyId);
        responseText = `❌ Task ${denyId} denied and cancelled.`;
        break;
      }

      const denyCtx = permissionIdToContext.get(denyId);
      if (!denyCtx) {
        responseText = `Approval not found or already handled: ${denyId}`;
        break;
      }
      permissionIdToContext.delete(denyId);
      if (gateway) {
        gateway.sendPermissionReply(denyCtx.connectorId, denyCtx.taskId, denyId, false);
      }
      responseText = `❌ Denied: ${denyId}`;
      break;
    }
    case 'log': {
      const logTaskId = parsed.args[0];
      if (!logTaskId) {
        const session = sessionManager.getSession(event.platform, event.chat_id);
        if (session?.active_task_id) {
          const task = taskManager.getTask(session.active_task_id);
          responseText = task
            ? `Task: ${task.task_id}\nStatus: ${task.status}\nInstruction: ${task.instruction}`
            : 'Task not found.';
        } else {
          responseText = 'Usage: /pf log [task_id] (or have an active task)';
        }
        break;
      }
      const logTask = taskManager.getTask(logTaskId);
      responseText = logTask
        ? `Task: ${logTask.task_id}\nStatus: ${logTask.status}\nInstruction: ${logTask.instruction}`
        : `Task not found: ${logTaskId}`;
      break;
    }
    case 'pr': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      const prArgs = parsed.args.length > 0 ? ` with title: ${parsed.args.join(' ')}` : '';
      dispatchAgentTask(event, session.project_id, userId, `Create a pull request for the current branch${prArgs}. Push if needed, then create the PR and return the URL.`, 'execute_guarded');
      responseText = '';
      break;
    }
    case 'commit': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      const commitMsg = parsed.args.length > 0 ? parsed.args.join(' ') : '';
      const commitInstruction = commitMsg
        ? `Commit all current changes with message: "${commitMsg}"`
        : 'Commit all current changes with an appropriate commit message based on the diff.';
      dispatchAgentTask(event, session.project_id, userId, commitInstruction, 'execute_guarded');
      responseText = '';
      break;
    }
    case 'status': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session?.active_task_id) {
        responseText = 'No active task.';
        break;
      }
      const task = taskManager.getTask(session.active_task_id);
      responseText = task
        ? `Task: ${task.task_id}\nStatus: ${task.status}\nMode: ${task.mode}`
        : 'Task not found.';
      break;
    }
    case 'stop': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session?.active_task_id) {
        responseText = 'No active task to stop.';
        break;
      }
      taskManager.cancelTask(session.active_task_id);
      responseText = `Task ${session.active_task_id} cancelled.`;
      break;
    }
    case 'new': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      if (gateway) {
        const connectorInfo = gateway.registry.findByProject(session.project_id);
        if (connectorInfo) {
          const envelope = createEnvelope(MSG.SESSION_NEW, { projectId: session.project_id });
          gateway.sendToConnector(connectorInfo.connectorId, envelope);
          responseText = '🔄 New session requested. Next message starts fresh context.';
        } else {
          responseText = 'Connector not connected. Cannot create new session.';
        }
      } else {
        responseText = 'Gateway not enabled.';
      }
      break;
    }
    case 'doctor': {
      if (!gateway) {
        responseText = 'Gateway not enabled.';
        break;
      }
      const diag = gateway.getDiagnostics();
      const uptimeH = Math.floor(diag.uptimeMs / 3_600_000);
      const uptimeM = Math.floor((diag.uptimeMs % 3_600_000) / 60_000);
      const lines: string[] = [`🩺 Doctor Report`, `Uptime: ${uptimeH}h ${uptimeM}m`];

      const adapterEntries = Object.entries(diag.adapters);
      if (adapterEntries.length > 0) {
        lines.push(`\nAdapters:`);
        for (const [name, status] of adapterEntries) {
          lines.push(`  ${name}: ${status}`);
        }
      }

      if (diag.connectors.length > 0) {
        lines.push(`\nConnectors (${diag.connectors.length}):`);
        for (const c of diag.connectors) {
          const projects = c.projects.map((p) => `${p.id}${p.opencodeAvailable ? '' : ' (no opencode)'}`).join(', ');
          lines.push(`  ${c.hostname} — ${projects}`);
        }
      } else {
        lines.push(`\nNo connectors online.`);
      }

      if (diag.pending.length > 0) {
        lines.push(`\nPending reconnects (${diag.pending.length}):`);
        for (const p of diag.pending) {
          const ago = Math.round((Date.now() - p.disconnectedAt) / 1000);
          lines.push(`  ${p.hostname} — disconnected ${ago}s ago`);
        }
      }

      const currentSession = sessionManager.getSession(event.platform, event.chat_id);
      if (currentSession) {
        lines.push(`\nCurrent binding: ${currentSession.project_id}${currentSession.active_task_id ? ` (task: ${currentSession.active_task_id})` : ''}`);
      } else {
        lines.push(`\nNo project bound.`);
      }

      responseText = lines.join('\n');
      break;
    }
    case 'sessions': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      const sessions = await fetchSessions(event.platform, event.chat_id);
      if (sessions.length === 0) {
        responseText = 'No sessions found (or request timed out).';
      } else {
        responseText = messageRenderer.renderSessionList(sessions);
      }
      break;
    }
    case 'switch': {
      const session = sessionManager.getSession(event.platform, event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      if (!gateway) {
        responseText = 'Gateway not enabled.';
        break;
      }
      const switchTarget = parsed.args[0]?.trim() ?? '';
      if (!switchTarget) {
        responseText = 'Usage: /pf switch <slug>';
        break;
      }
      const switchConnector = gateway.registry.findByProject(session.project_id);
      if (!switchConnector) {
        responseText = 'Connector not connected. Cannot switch session.';
        break;
      }
      gateway.sendSessionSwitch(switchConnector.connectorId, session.project_id, switchTarget);
      responseText = `🔄 Switching to session ${switchTarget}. Next message will use the new session.`;
      break;
    }
    default: {
      responseText = `Unknown command: ${parsed.name}. Try /pf help`;
      break;
    }
  }

  if (responseText) {
    const respAdapter = adapterMap.get(event.platform);
    if (respAdapter) {
      const response: ChatResponse = {
        platform: event.platform,
        chat_id: event.chat_id,
        reply_to: event.message_id,
        message_type: 'text',
        text: responseText,
      };
      await respAdapter.sendMessage(response);
    }
  }
}

function handleAdapterEvent(event: AdapterInboundEvent): void {
  switch (event.type) {
    case 'message':
      void handleChatEvent(event.event);
      break;
    case 'questionReply': {
      const ctx = questionIdToContext.get(event.event.questionId);
      if (!ctx) {
        console.warn(`[question-reply] No context found for questionId=${event.event.questionId}`);
        return;
      }
      questionIdToContext.delete(event.event.questionId);
      if (gateway) {
        console.log(`[question-reply] Sending answer for ${event.event.questionId} to connector ${ctx.connectorId}`);
        gateway.sendQuestionReply(ctx.connectorId, ctx.taskId, event.event.questionId, event.event.answers);
      }
      break;
    }
    case 'permissionReply': {
      const ctx = permissionIdToContext.get(event.event.permissionId);
      if (!ctx) {
        console.warn(`[permission-reply] No context found for permissionId=${event.event.permissionId}`);
        return;
      }
      permissionIdToContext.delete(event.event.permissionId);
      if (gateway) {
        console.log(`[permission-reply] Sending ${event.event.allowed ? 'allow' : 'deny'} for ${event.event.permissionId} to connector ${ctx.connectorId}`);
        gateway.sendPermissionReply(ctx.connectorId, ctx.taskId, event.event.permissionId, event.event.allowed);
      }
      break;
    }
    case 'error':
      console.error(`[adapter] Error:`, event.error);
      break;
  }
}

let adapter: IMAdapter | undefined;

function fetchSessions(platform: Platform, chatId: string): Promise<SessionListEntry[]> {
  const session = sessionManager.getSession(platform, chatId);
  if (!session || !gateway) return Promise.resolve([]);
  const connector = gateway.registry.findByProject(session.project_id);
  if (!connector) return Promise.resolve([]);
  const requestId = `sl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<SessionListEntry[]>((resolve) => {
    sessionListCallbacks.set(requestId, { resolve });
    setTimeout(() => {
      if (sessionListCallbacks.has(requestId)) {
        sessionListCallbacks.delete(requestId);
        resolve([]);
      }
    }, 10_000);
    gateway!.sendSessionListRequest(connector.connectorId, session.project_id, requestId);
  });
}

const adapterDeps: AdapterDeps = {
  listProjects: (userId: string) =>
    projectRegistry.listProjects().filter((p) => {
      if (!projectRegistry.isUserAllowed(p.id, userId)) return false;
      if (p.runtime === 'connector' && gateway && !gateway.registry.findByProject(p.id)) return false;
      return true;
    }),
  getBinding: (platform: Platform, chatId: string) => sessionManager.getSession(platform, chatId) ?? undefined,
  bindProject: (platform: Platform, chatId: string, projectId: string) => sessionManager.bindProject(platform, chatId, projectId),
  isUserAllowed: (projectId: string, userId: string) => projectRegistry.isUserAllowed(projectId, userId),
  generateRegistrationToken: registrationService
    ? (userId: string) => registrationService!.generateToken(userId)
    : undefined,
  getUserChatId: (platform: Platform, userId: string) => storage.getUserChatId(platform, userId),
  setUserChatId: (platform: Platform, userId: string, chatId: string) => storage.setUserChatId(platform, userId, chatId),
  getAllUserChatIds: (platform: Platform) => storage.getAllUserChatIds(platform),
  listSessions: fetchSessions,
};

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (telegramToken) {
  const telegramAdapter = new TelegramAdapter(telegramToken, adapterDeps);
  adapterMap.set('telegram', telegramAdapter);
  telegramAdapter.onEvent(handleAdapterEvent);
  if (!adapter) adapter = telegramAdapter;
}

const feishuAppId = process.env.FEISHU_APP_ID;
const feishuAppSecret = process.env.FEISHU_APP_SECRET;
if (feishuAppId && feishuAppSecret) {
  const feishuDomain = (process.env.FEISHU_DOMAIN ?? 'feishu') as 'feishu' | 'lark';
  const feishuAdapter = new FeishuAdapter({ appId: feishuAppId, appSecret: feishuAppSecret, domain: feishuDomain }, adapterDeps);
  adapterMap.set('feishu', feishuAdapter);
  feishuAdapter.onEvent(handleAdapterEvent);
  if (!adapter) adapter = feishuAdapter;
  if (gateway) {
    gateway.setCardActionHandler((payload) => feishuAdapter.handleCardAction(payload));
  }
}

const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackAppToken = process.env.SLACK_APP_TOKEN;
if (slackBotToken && slackAppToken) {
  const slackAdapter = new SlackAdapter({ botToken: slackBotToken, appToken: slackAppToken }, adapterDeps);
  adapterMap.set('slack', slackAdapter);
  slackAdapter.onEvent(handleAdapterEvent);
  if (!adapter) adapter = slackAdapter;
}

if (adapterMap.size === 0) {
  console.error('No IM adapter configured. Set TELEGRAM_BOT_TOKEN, FEISHU_APP_ID+FEISHU_APP_SECRET, or SLACK_BOT_TOKEN+SLACK_APP_TOKEN.');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);

  const chatTargets = new Set([...taskIdToChatId.values(), ...connectorIdToChatId.values()]);
  const notifications = [...chatTargets].map((target) => {
    const a = adapterMap.get(target.platform);
    if (!a) return Promise.resolve();
    return a.sendMessage({
      platform: target.platform,
      chat_id: target.chatId,
      message_type: 'text',
      text: '🔄 PetFish Remote is restarting — back in a few seconds.',
    }).catch(() => {});
  });
  await Promise.allSettled(notifications);

  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  try {
    const stops = [...adapterMap.values()].map((a) => a.stop());
    if (gateway) stops.push(gateway.stop());
    await Promise.allSettled(stops);
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

for (const [name, a] of adapterMap.entries()) {
  if (gateway) gateway.setAdapterStatus(name, 'starting');
  void a.start().then(() => {
    if (gateway) gateway.setAdapterStatus(name, 'connected');
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${name}] Adapter failed to start: ${msg}`);
    if (gateway) gateway.setAdapterStatus(name, `error: ${msg}`);
  });
}

const platforms = [...adapterMap.keys()].join(', ');
console.log(`PetFish Remote started (adapters: ${platforms})`);
