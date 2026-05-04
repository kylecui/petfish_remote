const sensitivePatterns: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/i,
  /(^|\/)(secrets?|credentials?)(\/|$)/i,
  /\.(pem|p12|pfx|key)$/i,
];

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return sensitivePatterns.some((pattern) => pattern.test(normalized));
}

export function sanitizeOutput(text: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
