import path from 'node:path';

import { loadConfig } from './config.js';
import { TelegramAdapter } from './adapters/telegram/TelegramAdapter.js';
import type { TelegramDeps } from './adapters/telegram/TelegramAdapter.js';
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
import { Storage } from './storage/sqlite.js';
import type { ChatEvent, ChatResponse } from './types.js';

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

if (config.gateway.enabled) {
  const auth = new ConnectorAuth(config.connector_tokens);

  registrationService = new RegistrationService({
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

  for (const rt of config.runtimes) {
    if (rt.type === 'connector') {
      const remote = new RemoteRuntime(rt.id, rt.host ?? undefined, gateway);
      runtimeRouter.registerConnector(rt.id, remote);
    }
  }

  gateway.on('connector:change', (connectorId: string, info: unknown) => {
    if (!telegramAdapter) return;
    const status = info ? '🟢 online' : '🔴 offline';
    const adminChatId = process.env.PETFISH_ADMIN_CHAT_ID;
    if (adminChatId) {
      void telegramAdapter.sendMessage({
        platform: 'telegram',
        chat_id: adminChatId,
        message_type: 'text',
        text: `Connector ${connectorId} is now ${status}`,
      });
    }
  });

  void gateway.start();
  console.log(`ConnectorGateway started on :${config.gateway.port}${config.gateway.path}`);
}

const taskManager = new TaskManager(storage, runtimeRouter, projectRegistry, policyEngine);

async function handleChatEvent(event: ChatEvent): Promise<void> {
  const userId = `${event.platform}:${event.user_id}`;

  auditLogger.log({ task_id: undefined, user_id: userId, event_type: 'message_received', payload: event.text });

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
      const task = taskManager.createTask({
        project_id: session.project_id,
        user_id: userId,
        instruction,
        mode: 'read_only',
      });
      sessionManager.updateTask(event.chat_id, task.task_id);

      if (telegramAdapter) {
        void telegramAdapter.sendTyping(event.chat_id);
      }

      responseText = '';

      const batcher = new OutputBatcher(
        (text) => {
          if (!telegramAdapter) return Promise.resolve();
          return telegramAdapter.sendMessage({
            platform: 'telegram',
            chat_id: event.chat_id,
            reply_to: event.message_id,
            message_type: 'text',
            text,
          });
        },
        task.task_id,
      );

      const typingInterval = setInterval(() => {
        if (telegramAdapter) void telegramAdapter.sendTyping(event.chat_id);
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

  if (responseText && telegramAdapter) {
    const response: ChatResponse = {
      platform: event.platform,
      chat_id: event.chat_id,
      reply_to: event.message_id,
      message_type: 'text',
      text: responseText,
    };
    await telegramAdapter.sendMessage(response);
  }
}

let telegramAdapter: TelegramAdapter | undefined;

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (telegramToken) {
  const telegramDeps: TelegramDeps = {
    listProjects: (userId: string) =>
      projectRegistry.listProjects().filter((p) => projectRegistry.isUserAllowed(p.id, userId)),
    getBinding: (chatId: string) => sessionManager.getSession(chatId) ?? undefined,
    bindProject: (chatId: string, projectId: string) => sessionManager.bindProject(chatId, projectId),
    isUserAllowed: (projectId: string, userId: string) => projectRegistry.isUserAllowed(projectId, userId),
    generateRegistrationToken: registrationService
      ? (userId: string) => registrationService!.generateToken(userId)
      : undefined,
  };

  telegramAdapter = new TelegramAdapter(telegramToken, handleChatEvent, telegramDeps);

  process.once('SIGINT', () => {
    void telegramAdapter?.stop();
    void gateway?.stop();
  });
  process.once('SIGTERM', () => {
    void telegramAdapter?.stop();
    void gateway?.stop();
  });

  void telegramAdapter.start();
  console.log('PetFish Remote started (Telegram polling)');
} else {
  console.error('TELEGRAM_BOT_TOKEN not set. Configure .env and restart.');
  process.exit(1);
}
