import {
  createOpencodeClient,
  type OpencodeClient,
  type OpencodeClientConfig,
} from '@opencode-ai/sdk';

export type { OpencodeClient, OpencodeClientConfig };

export function createClient(port: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl: `http://127.0.0.1:${port}`,
  });
}
