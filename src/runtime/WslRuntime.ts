import type { RuntimeType } from '../types.js';
import type { RuntimeCommand, RuntimeConnector, RuntimeHealth, RuntimeResult } from './RuntimeConnector.js';

export class WslRuntime implements RuntimeConnector {
  public readonly type: RuntimeType = 'wsl';

  public constructor(
    public readonly id: string,
    private readonly distro: string,
    private readonly opencodeBin = 'opencode',
  ) {
    void this.distro;
    void this.opencodeBin;
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
