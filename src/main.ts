import path from 'node:path';

import { loadConfig } from './config.js';
import { TelegramAdapter } from './adapters/telegram/TelegramAdapter.js';
import { CommandRouter } from './core/CommandRouter.js';
import { ProjectRegistry } from './core/ProjectRegistry.js';
import { SessionManager } from './core/SessionManager.js';
import { TaskManager } from './core/TaskManager.js';
import { PolicyEngine } from './core/PolicyEngine.js';
import type { PolicyConfig } from './core/PolicyEngine.js';
import { AuditLogger } from './core/AuditLogger.js';
import { RuntimeRouter } from './runtime/RuntimeRouter.js';
import { LocalRuntime } from './runtime/LocalRuntime.js';
import { OpenCodeCliRunner } from './opencode/OpenCodeCliRunner.js';
import { MessageRenderer } from './render/MessageRenderer.js';
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

const defaultRuntime = runtimeRouter.getConnector('local');
const openCodeRunner = new OpenCodeCliRunner(defaultRuntime, 'opencode');
const taskManager = new TaskManager(storage, openCodeRunner, policyEngine);

async function handleChatEvent(event: ChatEvent): Promise<void> {
  const userId = `${event.platform}:${event.user_id}`;

  auditLogger.log({ task_id: undefined, user_id: userId, event_type: 'message_received', payload: event.text });

  let parsed;
  try {
    parsed = commandRouter.parseCommand(event.text);
  } catch {
    return;
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
      const instruction = parsed.args.join(' ');
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
      responseText = messageRenderer.renderTaskCreated(task);
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
    default: {
      responseText = `Unknown command: ${parsed.name}. Try /pf help`;
      break;
    }
  }

  const response: ChatResponse = {
    platform: event.platform,
    chat_id: event.chat_id,
    reply_to: event.message_id,
    message_type: 'text',
    text: responseText,
  };

  if (telegramAdapter) {
    await telegramAdapter.sendMessage(response);
  }
}

let telegramAdapter: TelegramAdapter | undefined;

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (telegramToken) {
  telegramAdapter = new TelegramAdapter(telegramToken, handleChatEvent);

  process.once('SIGINT', () => {
    void telegramAdapter?.stop();
  });
  process.once('SIGTERM', () => {
    void telegramAdapter?.stop();
  });

  void telegramAdapter.start();
  console.log('PetFish Remote started (Telegram polling)');
} else {
  console.error('TELEGRAM_BOT_TOKEN not set. Configure .env and restart.');
  process.exit(1);
}
