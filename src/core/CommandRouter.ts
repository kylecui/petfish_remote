export type SupportedCommandName =
  | 'help'
  | 'list'
  | 'use'
  | 'where'
  | 'ask'
  | 'edit'
  | 'test'
  | 'status'
  | 'diff'
  | 'approve'
  | 'deny'
  | 'stop'
  | 'log'
  | 'pr'
  | 'commit'
  | 'new'
  | 'doctor';

export interface ParsedCommand {
  name: SupportedCommandName;
  args: string[];
  rawText: string;
}

const supportedCommands: ReadonlySet<SupportedCommandName> = new Set<SupportedCommandName>([
  'help',
  'list',
  'use',
  'where',
  'ask',
  'edit',
  'test',
  'status',
  'diff',
  'approve',
  'deny',
  'stop',
  'log',
  'pr',
  'commit',
  'new',
  'doctor',
]);

export class CommandRouter {
  parseCommand(text: string): ParsedCommand {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/pf')) {
      throw new Error('Invalid command prefix');
    }

    const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length < 2) {
      throw new Error('Missing command name');
    }

    const nameRaw = parts[1].toLowerCase();
    if (!supportedCommands.has(nameRaw as SupportedCommandName)) {
      throw new Error(`Unsupported command: ${nameRaw}`);
    }

    return {
      name: nameRaw as SupportedCommandName,
      args: parts.slice(2),
      rawText: text,
    };
  }

  parseNaturalLanguage(text: string, boundProject?: string): ParsedCommand {
    const lowered = text.trim().toLowerCase();

    if (lowered.includes('help')) {
      return { name: 'help', args: [], rawText: text };
    }
    if (lowered.includes('list project') || lowered.includes('show projects')) {
      return { name: 'list', args: [], rawText: text };
    }
    if (lowered.startsWith('use project ') || lowered.startsWith('switch to ')) {
      const candidate = text.split(/\s+/).slice(2).join(' ').trim();
      return { name: 'use', args: candidate ? [candidate] : [], rawText: text };
    }
    if (lowered.includes('where am i') || lowered.includes('current project')) {
      return { name: 'where', args: [], rawText: text };
    }
    if (lowered.startsWith('edit ') || lowered.includes('modify')) {
      const inferredArgs = boundProject ? [boundProject] : [];
      return { name: 'edit', args: inferredArgs, rawText: text };
    }
    if (lowered.startsWith('run test') || lowered.includes('run tests')) {
      return { name: 'test', args: [], rawText: text };
    }
    if (lowered.includes('status')) {
      return { name: 'status', args: [], rawText: text };
    }
    if (lowered.includes('show diff')) {
      return { name: 'diff', args: [], rawText: text };
    }
    if (lowered.startsWith('approve')) {
      return { name: 'approve', args: lowered.split(/\s+/).slice(1), rawText: text };
    }
    if (lowered.startsWith('deny')) {
      return { name: 'deny', args: lowered.split(/\s+/).slice(1), rawText: text };
    }
    if (lowered.includes('stop task') || lowered === 'stop') {
      return { name: 'stop', args: [], rawText: text };
    }
    if (lowered.includes('show logs') || lowered.startsWith('log ')) {
      return { name: 'log', args: lowered.split(/\s+/).slice(1), rawText: text };
    }
    if (lowered.includes('create pr') || lowered.includes('pull request')) {
      return { name: 'pr', args: [], rawText: text };
    }
    if (lowered.includes('commit')) {
      return { name: 'commit', args: [], rawText: text };
    }
    if (lowered.includes('doctor') || lowered.includes('health check') || lowered.includes('diagnostics')) {
      return { name: 'doctor', args: [], rawText: text };
    }

    return { name: 'ask', args: [], rawText: text };
  }
}
