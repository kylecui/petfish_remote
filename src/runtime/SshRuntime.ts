import type { RuntimeType } from '../types.js';
import type { RuntimeCommand, RuntimeConnector, RuntimeHealth, RuntimeResult } from './RuntimeConnector.js';

export class SshRuntime implements RuntimeConnector {
  public readonly type: RuntimeType = 'ssh';

  public constructor(
    public readonly id: string,
    private readonly host: string,
    private readonly user: string,
    private readonly identityFile?: string,
  ) {
    void this.host;
    void this.user;
    void this.identityFile;
  }

  public async healthCheck(): Promise<RuntimeHealth> {
    throw new Error('Not implemented');
  }

  public async run(command: RuntimeCommand): Promise<RuntimeResult> {
    void command;
    throw new Error('Not implemented');
  }

  public async stop(taskId: string): Promise<void> {
    void taskId;
    throw new Error('Not implemented');
  }
}
