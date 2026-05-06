import { z } from 'zod';

export const connectorTokenSchema = z.object({
  connectorId: z.string(),
  token: z.string(),
  label: z.string().optional(),
});

export type ConnectorToken = z.infer<typeof connectorTokenSchema>;

export class ConnectorAuth {
  private readonly tokens: Map<string, string>;
  private readonly wildcardTokens: string[];

  public constructor(tokens: ConnectorToken[]) {
    this.tokens = new Map();
    this.wildcardTokens = [];
    for (const t of tokens) {
      if (t.connectorId === '*') {
        this.wildcardTokens.push(t.token);
      } else {
        this.tokens.set(t.connectorId, t.token);
      }
    }
  }

  public verify(connectorId: string, token: string): boolean {
    const expected = this.tokens.get(connectorId);
    if (expected) {
      return this.timingSafeEqual(expected, token);
    }
    return this.wildcardTokens.some((wt) => this.timingSafeEqual(wt, token));
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
