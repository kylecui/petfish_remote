import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Envelope — every WS message wraps in this structure
// ---------------------------------------------------------------------------

export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.string(),
  id: z.string(),
  ts: z.string(),
  taskId: z.string().optional(),
  payload: z.record(z.unknown()),
});

export type Envelope = z.infer<typeof envelopeSchema>;

// ---------------------------------------------------------------------------
// Connector → Server messages
// ---------------------------------------------------------------------------

export const registerPayloadSchema = z.object({
  connectorId: z.string(),
  token: z.string(),
  hostname: z.string(),
  version: z.string().optional(),
  projects: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      opencodeAvailable: z.boolean(),
    }),
  ),
});

export type RegisterPayload = z.infer<typeof registerPayloadSchema>;

export const taskAcceptedPayloadSchema = z.object({
  taskId: z.string(),
});

export type TaskAcceptedPayload = z.infer<typeof taskAcceptedPayloadSchema>;

export const taskRejectedPayloadSchema = z.object({
  taskId: z.string(),
  reason: z.string(),
});

export type TaskRejectedPayload = z.infer<typeof taskRejectedPayloadSchema>;

export const taskOutputPayloadSchema = z.object({
  taskId: z.string(),
  stream: z.enum(['stdout', 'stderr']),
  chunk: z.string(),
});

export type TaskOutputPayload = z.infer<typeof taskOutputPayloadSchema>;

export const taskStatePayloadSchema = z.object({
  taskId: z.string(),
  state: z.string(),
});

export type TaskStatePayload = z.infer<typeof taskStatePayloadSchema>;

export const fileChangeSchema = z.object({
  file: z.string(),
  additions: z.number(),
  deletions: z.number(),
});

export type FileChangePayload = z.infer<typeof fileChangeSchema>;

export const taskCompletePayloadSchema = z.object({
  taskId: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  files: z.array(fileChangeSchema).optional(),
});

export type TaskCompletePayload = z.infer<typeof taskCompletePayloadSchema>;

export const taskFailPayloadSchema = z.object({
  taskId: z.string(),
  error: z.string(),
});

export type TaskFailPayload = z.infer<typeof taskFailPayloadSchema>;

export const resumeRunningPayloadSchema = z.object({
  taskIds: z.array(z.string()),
});

export type ResumeRunningPayload = z.infer<typeof resumeRunningPayloadSchema>;

export const taskQuestionPayloadSchema = z.object({
  taskId: z.string(),
  questionId: z.string(),
  sessionId: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      header: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string() })),
      multiple: z.boolean(),
      custom: z.boolean(),
    }),
  ),
});

export type TaskQuestionPayload = z.infer<typeof taskQuestionPayloadSchema>;

export const questionReplyPayloadSchema = z.object({
  taskId: z.string(),
  questionId: z.string(),
  answers: z.array(z.array(z.string())),
});

export type QuestionReplyPayload = z.infer<typeof questionReplyPayloadSchema>;

export const taskPermissionPayloadSchema = z.object({
  taskId: z.string(),
  permissionId: z.string(),
  sessionId: z.string(),
  tool: z.string(),
  input: z.record(z.unknown()),
});

export type TaskPermissionPayload = z.infer<typeof taskPermissionPayloadSchema>;

export const permissionReplyPayloadSchema = z.object({
  taskId: z.string(),
  permissionId: z.string(),
  allowed: z.boolean(),
});

export type PermissionReplyPayload = z.infer<typeof permissionReplyPayloadSchema>;

export const sessionListResponsePayloadSchema = z.object({
  requestId: z.string(),
  sessions: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ),
});

export type SessionListResponsePayload = z.infer<typeof sessionListResponsePayloadSchema>;

// ---------------------------------------------------------------------------
// Server → Connector messages
// ---------------------------------------------------------------------------

export const registeredPayloadSchema = z.object({
  connectorId: z.string(),
  serverVersion: z.string(),
});

export type RegisteredPayload = z.infer<typeof registeredPayloadSchema>;

export const taskStartPayloadSchema = z.object({
  taskId: z.string(),
  projectId: z.string(),
  projectPath: z.string(),
  instruction: z.string(),
  rawInstruction: z.string().optional(),
  mode: z.string(),
  timeoutSeconds: z.number(),
  env: z.record(z.string()).optional(),
});

export type TaskStartPayload = z.infer<typeof taskStartPayloadSchema>;

export const taskControlPayloadSchema = z.object({
  taskId: z.string(),
  action: z.enum(['cancel', 'approve', 'deny', 'input']),
  data: z.string().optional(),
});

export type TaskControlPayload = z.infer<typeof taskControlPayloadSchema>;

export const errorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  taskId: z.string().optional(),
});

export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

export const sessionListRequestPayloadSchema = z.object({
  projectId: z.string(),
  requestId: z.string(),
});

export type SessionListRequestPayload = z.infer<typeof sessionListRequestPayloadSchema>;

export const sessionSwitchPayloadSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
});

export type SessionSwitchPayload = z.infer<typeof sessionSwitchPayloadSchema>;

// ---------------------------------------------------------------------------
// Message type constants
// ---------------------------------------------------------------------------

export const MSG = {
  REGISTER: 'register',
  REGISTERED: 'registered',
  TASK_START: 'task.start',
  TASK_ACCEPTED: 'task.accepted',
  TASK_REJECTED: 'task.rejected',
  TASK_OUTPUT: 'task.output',
  TASK_STATE: 'task.state',
  TASK_COMPLETE: 'task.complete',
  TASK_FAIL: 'task.fail',
  TASK_CONTROL: 'task.control',
  TASK_QUESTION: 'task.question',
  QUESTION_REPLY: 'question.reply',
  TASK_PERMISSION: 'task.permission',
  PERMISSION_REPLY: 'permission.reply',
  SESSION_NEW: 'session.new',
  SESSION_LIST: 'session.list',
  SESSION_LIST_RESPONSE: 'session.list.response',
  SESSION_SWITCH: 'session.switch',
  RESUME_RUNNING: 'resume.running',
  UPGRADE_AVAILABLE: 'upgrade.available',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
} as const;

// ---------------------------------------------------------------------------
// Payload schema lookup by message type
// ---------------------------------------------------------------------------

export const payloadSchemas: Record<string, z.ZodType> = {
  [MSG.REGISTER]: registerPayloadSchema,
  [MSG.REGISTERED]: registeredPayloadSchema,
  [MSG.TASK_START]: taskStartPayloadSchema,
  [MSG.TASK_ACCEPTED]: taskAcceptedPayloadSchema,
  [MSG.TASK_REJECTED]: taskRejectedPayloadSchema,
  [MSG.TASK_OUTPUT]: taskOutputPayloadSchema,
  [MSG.TASK_STATE]: taskStatePayloadSchema,
  [MSG.TASK_COMPLETE]: taskCompletePayloadSchema,
  [MSG.TASK_FAIL]: taskFailPayloadSchema,
  [MSG.TASK_CONTROL]: taskControlPayloadSchema,
  [MSG.TASK_QUESTION]: taskQuestionPayloadSchema,
  [MSG.QUESTION_REPLY]: questionReplyPayloadSchema,
  [MSG.TASK_PERMISSION]: taskPermissionPayloadSchema,
  [MSG.PERMISSION_REPLY]: permissionReplyPayloadSchema,
  [MSG.RESUME_RUNNING]: resumeRunningPayloadSchema,
  [MSG.SESSION_LIST]: sessionListRequestPayloadSchema,
  [MSG.SESSION_LIST_RESPONSE]: sessionListResponsePayloadSchema,
  [MSG.SESSION_SWITCH]: sessionSwitchPayloadSchema,
  [MSG.ERROR]: errorPayloadSchema,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let msgCounter = 0;

export function createEnvelope(type: string, payload: Record<string, unknown>, taskId?: string): Envelope {
  return {
    v: PROTOCOL_VERSION,
    type,
    id: `msg_${Date.now()}_${++msgCounter}`,
    ts: new Date().toISOString(),
    taskId,
    payload,
  };
}

export function parseEnvelope(raw: string): Envelope {
  const json: unknown = JSON.parse(raw);
  return envelopeSchema.parse(json);
}

export function validatePayload<T extends z.ZodType>(schema: T, payload: Record<string, unknown>): z.infer<T> {
  return schema.parse(payload) as z.infer<T>;
}
