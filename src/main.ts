import path from 'node:path';

import { loadConfig } from './config.js';
import { TelegramAdapter } from './adapters/telegram/TelegramAdapter.js';
import type { IMAdapter, AdapterDeps, AdapterInboundEvent } from './adapters/types.js';
import { CommandRouter } from './core/CommandRouter.js';
import { ProjectRegistry } from './core/ProjectRegistry.js';
import { SessionManager } from './core/SessionManager.js';
import { TaskManager } from './core/TaskManager.js';
import { PolicyEngine } from './core/PolicyEngine.js';
import type { PolicyConfig } from './core/PolicyEngine.js';
import { AuditLogger } from './core/AuditLogger.js';
import { RuntimeRouter } from './runtime/RuntimeRouter.js';
import { LocalRuntime } from './runtime/LocalRuntime.js';
import { RemoteRuntime } from './runtime/RemoteRuntime.js';
import { MessageRenderer } from './render/MessageRenderer.js';
import { OutputBatcher } from './render/OutputBatcher.js';
import { ConnectorAuth } from './server/ConnectorAuth.js';
import { ConnectorGateway } from './server/ConnectorGateway.js';
import { RegistrationService } from './server/RegistrationService.js';
import { createEnvelope, MSG } from './protocol/connectorProtocol.js';
import type { TaskQuestionPayload, TaskPermissionPayload } from './protocol/connectorProtocol.js';
import { Storage } from './storage/sqlite.js';
import type { ChatEvent, ChatResponse, ExecutionMode } from './types.js';

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
  }
}

let gateway: ConnectorGateway | undefined;
let registrationService: RegistrationService | undefined;
const taskIdToChatId = new Map<string, string>();
const connectorIdToChatId = new Map<string, string>();
const questionIdToContext = new Map<string, { connectorId: string; taskId: string }>();
const permissionIdToContext = new Map<string, { connectorId: string; taskId: string }>();

function resolveChatId(taskId: string, connectorId: string): string | undefined {
  const fromTask = taskIdToChatId.get(taskId);
  if (fromTask) return fromTask;

  const fromConnector = connectorIdToChatId.get(connectorId);
  if (fromConnector) return fromConnector;

  if (!gateway) return undefined;
  const connInfo = gateway.registry.get(connectorId);
  if (connInfo) {
    for (const proj of connInfo.projects) {
      const chatId = storage.getChatIdByProject(proj.id);
      if (chatId) return chatId;
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
          });
          console.log(`[auto-register] Project ${proj.id} added from connector ${connectorId}${connInfo.userId ? ` for user ${connInfo.userId}` : ''}`);
        }
      }
    }

    if (!adapter) return;
    const status = info ? '🟢 online' : '🔴 offline';

    if (!info) {
      const userChatId = connectorIdToChatId.get(connectorId);
      if (userChatId) {
        void adapter.sendMessage({
          platform: adapter.platform,
          chat_id: userChatId,
          message_type: 'text',
          text: `⚠️ Connector \`${connectorId}\` disconnected. It may be restarting — replies paused until reconnect.`,
        });
      }
    }

    const adminChatId = process.env.PETFISH_ADMIN_CHAT_ID;
    if (adminChatId) {
      void adapter.sendMessage({
        platform: adapter.platform,
        chat_id: adminChatId,
        message_type: 'text',
        text: `Connector ${connectorId} is now ${status}`,
      });
    }
  });

  gateway.on('task:question', (connectorId: string, payload: TaskQuestionPayload) => {
    if (!adapter) return;
    questionIdToContext.set(payload.questionId, { connectorId, taskId: payload.taskId });
    const chatId = resolveChatId(payload.taskId, connectorId);
    if (!chatId) {
      console.warn(`[question] No chatId found for taskId=${payload.taskId} connectorId=${connectorId}`);
      return;
    }
    console.log(`[question] Relaying question ${payload.questionId} to chat ${chatId}`);
    void adapter.sendInteraction({ type: 'question', chatId, payload });
  });

  gateway.on('task:permission', (connectorId: string, payload: TaskPermissionPayload) => {
    if (!adapter) return;
    permissionIdToContext.set(payload.permissionId, { connectorId, taskId: payload.taskId });
    const chatId = resolveChatId(payload.taskId, connectorId);
    if (!chatId) {
      console.warn(`[permission] No chatId found for taskId=${payload.taskId} connectorId=${connectorId}`);
      return;
    }
    console.log(`[permission] Relaying permission ${payload.permissionId} to chat ${chatId}`);
    void adapter.sendInteraction({ type: 'permission', chatId, payload });
  });

  void gateway.start();
  console.log(`ConnectorGateway started on :${config.gateway.port}${config.gateway.path}`);
}

const taskManager = new TaskManager(storage, runtimeRouter, projectRegistry, policyEngine);

function dispatchAgentTask(event: ChatEvent, projectId: string, userId: string, instruction: string, mode: ExecutionMode): void {
  const task = taskManager.createTask({ project_id: projectId, user_id: userId, instruction, mode });
  sessionManager.updateTask(event.chat_id, task.task_id);
  taskIdToChatId.set(task.task_id, event.chat_id);
  if (gateway) {
    const ci = gateway.registry.findByProject(projectId);
    if (ci) connectorIdToChatId.set(ci.connectorId, event.chat_id);
  }

  if (adapter) {
    void adapter.sendTyping(event.chat_id);
    void adapter.sendMessage({
      platform: event.platform,
      chat_id: event.chat_id,
      reply_to: event.message_id,
      message_type: 'markdown',
      text: `📂 *${projectId}* · Task \`${task.task_id}\` accepted`,
    });
  }

  const batcher = new OutputBatcher(
    (text, plain) => {
      if (!adapter) return Promise.resolve();
      return adapter.sendMessage({
        platform: event.platform,
        chat_id: event.chat_id,
        reply_to: event.message_id,
        message_type: plain ? 'text' : 'markdown',
        text,
      });
    },
    task.task_id,
    undefined,
    undefined,
    projectId,
  );

  const typingInterval = setInterval(() => {
    if (adapter) void adapter.sendTyping(event.chat_id);
  }, 4000);

  taskManager.dispatchTask(task.task_id, (chunk) => {
    batcher.append(chunk);
  }).then((result) => {
    clearInterval(typingInterval);
    void batcher.complete(result.exitCode);
  }).catch((err: unknown) => {
    clearInterval(typingInterval);
    const msg = err instanceof Error ? err.message : String(err);
    void batcher.fail(msg);
  });
}

async function handleChatEvent(event: ChatEvent): Promise<void> {
  const userId = `${event.platform}:${event.user_id}`;

  auditLogger.log({ task_id: undefined, user_id: userId, event_type: 'message_received', payload: event.text });

  if (adapter && !event.text.startsWith('/') && adapter.hasPendingInteraction(event.chat_id)) {
    if (adapter instanceof TelegramAdapter) {
      const handled = adapter.handleCustomTextAnswer(event.chat_id, event.text);
      if (handled) return;
    }
  }

  let parsed;
  try {
    parsed = commandRouter.parseCommand(event.text);
  } catch {
    const session = sessionManager.getSession(event.chat_id);
    if (session?.project_id && !event.text.startsWith('/')) {
      parsed = { name: 'ask' as const, args: [event.text], rawText: event.text };
    } else {
      return;
    }
  }

  let responseText: string;

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
      sessionManager.bindProject(event.chat_id, projectId);
      responseText = messageRenderer.renderProjectBound(project);
      break;
    }
    case 'where': {
      const session = sessionManager.getSession(event.chat_id);
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
      const session = sessionManager.getSession(event.chat_id);
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
      const session = sessionManager.getSession(event.chat_id);
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
      const session = sessionManager.getSession(event.chat_id);
      if (!session) {
        responseText = 'No project bound. Use /pf use <project> first.';
        break;
      }
      dispatchAgentTask(event, session.project_id, userId, 'Run the project tests and report results.', 'read_only');
      responseText = '';
      break;
    }
    case 'diff': {
      const session = sessionManager.getSession(event.chat_id);
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
        responseText = 'Usage: /pf approve <approval_id>';
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
        responseText = 'Usage: /pf deny <approval_id>';
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
        const session = sessionManager.getSession(event.chat_id);
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
      const session = sessionManager.getSession(event.chat_id);
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
      const session = sessionManager.getSession(event.chat_id);
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
      const session = sessionManager.getSession(event.chat_id);
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
      const session = sessionManager.getSession(event.chat_id);
      if (!session?.active_task_id) {
        responseText = 'No active task to stop.';
        break;
      }
      taskManager.cancelTask(session.active_task_id);
      responseText = `Task ${session.active_task_id} cancelled.`;
      break;
    }
    case 'new': {
      const session = sessionManager.getSession(event.chat_id);
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
    default: {
      responseText = `Unknown command: ${parsed.name}. Try /pf help`;
      break;
    }
  }

  if (responseText && adapter) {
    const response: ChatResponse = {
      platform: event.platform,
      chat_id: event.chat_id,
      reply_to: event.message_id,
      message_type: 'text',
      text: responseText,
    };
    await adapter.sendMessage(response);
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

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (telegramToken) {
  const adapterDeps: AdapterDeps = {
    listProjects: (userId: string) =>
      projectRegistry.listProjects().filter((p) => projectRegistry.isUserAllowed(p.id, userId)),
    getBinding: (chatId: string) => sessionManager.getSession(chatId) ?? undefined,
    bindProject: (chatId: string, projectId: string) => sessionManager.bindProject(chatId, projectId),
    isUserAllowed: (projectId: string, userId: string) => projectRegistry.isUserAllowed(projectId, userId),
    generateRegistrationToken: registrationService
      ? (userId: string) => registrationService!.generateToken(userId)
      : undefined,
  };

  const telegramAdapter = new TelegramAdapter(telegramToken, adapterDeps);
  adapter = telegramAdapter;
  adapter.onEvent(handleAdapterEvent);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);

    if (adapter) {
      const chatIds = new Set([...taskIdToChatId.values(), ...connectorIdToChatId.values()]);
      const notifications = [...chatIds].map((chatId) =>
        adapter!.sendMessage({
          platform: adapter!.platform,
          chat_id: chatId,
          message_type: 'text',
          text: '🔄 PetFish Remote is restarting — back in a few seconds.',
        }).catch(() => {}),
      );
      await Promise.allSettled(notifications);
    }

    const timeout = setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    try {
      await Promise.allSettled([adapter?.stop(), gateway?.stop()]);
    } finally {
      clearTimeout(timeout);
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  void adapter.start();
  console.log('PetFish Remote started (Telegram polling)');
} else {
  console.error('TELEGRAM_BOT_TOKEN not set. Configure .env and restart.');
  process.exit(1);
}
