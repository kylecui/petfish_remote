import type { ChatEvent, ChatResponse, Platform, ProjectConfig } from '../types.js';
import type { TaskQuestionPayload, TaskPermissionPayload } from '../protocol/connectorProtocol.js';

// ─── Outbound Interactions ───────────────────────────────────────────────────

export type OutboundInteraction =
  | { type: 'question'; chatId: string; payload: TaskQuestionPayload }
  | { type: 'permission'; chatId: string; payload: TaskPermissionPayload };

// ─── Inbound Events ─────────────────────────────────────────────────────────

export interface QuestionReplyEvent {
  questionId: string;
  answers: string[][];
}

export interface PermissionReplyEvent {
  permissionId: string;
  allowed: boolean;
}

export type AdapterInboundEvent =
  | { type: 'message'; event: ChatEvent }
  | { type: 'questionReply'; event: QuestionReplyEvent }
  | { type: 'permissionReply'; event: PermissionReplyEvent }
  | { type: 'error'; error: Error };

export type AdapterEventHandler = (event: AdapterInboundEvent) => void;
export type Unsubscribe = () => void;

// ─── Adapter Dependencies ───────────────────────────────────────────────────

export interface AdapterDeps {
  listProjects: (userId: string) => ProjectConfig[];
  getBinding: (chatId: string) => { project_id: string } | undefined;
  bindProject: (chatId: string, projectId: string) => void;
  isUserAllowed: (projectId: string, userId: string) => boolean;
  generateRegistrationToken?: (userId: string) => string;
}

// ─── IMAdapter Interface ────────────────────────────────────────────────────

export interface IMAdapter {
  readonly platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(response: ChatResponse): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
  sendInteraction(request: OutboundInteraction): Promise<void>;
  hasPendingInteraction(chatId: string): boolean;
  onEvent(handler: AdapterEventHandler): Unsubscribe;
}

// ─── BaseIMAdapter ──────────────────────────────────────────────────────────

export abstract class BaseIMAdapter implements IMAdapter {
  abstract readonly platform: Platform;

  private listeners = new Set<AdapterEventHandler>();

  onEvent(handler: AdapterEventHandler): Unsubscribe {
    this.listeners.add(handler);
    return () => { this.listeners.delete(handler); };
  }

  protected emit(event: AdapterInboundEvent): void {
    for (const handler of this.listeners) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[${this.platform}] Event handler error:`, err);
      }
    }
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendMessage(response: ChatResponse): Promise<void>;
  abstract sendTyping(chatId: string): Promise<void>;
  abstract sendInteraction(request: OutboundInteraction): Promise<void>;
  abstract hasPendingInteraction(chatId: string): boolean;
}
