import { z } from 'zod';

export const connectorTokenSchema = z.object({
  connectorId: z.string(),
  token: z.string(),
  label: z.string().optional(),
});

export type ConnectorToken = z.infer<typeof connectorTokenSchema>;

export class ConnectorAuth {
  private readonly tokens: Map<string, string>;

  public constructor(tokens: ConnectorToken[]) {
    this.tokens = new Map(tokens.map((t) => [t.connectorId, t.token]));
  }

  public verify(connectorId: string, token: string): boolean {
    const expected = this.tokens.get(connectorId);
    if (!expected) {
      return false;
    }
    return this.timingSafeEqual(expected, token);
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
