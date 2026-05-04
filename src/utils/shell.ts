export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'"'"'`)}'`;
}

export function buildCommand(binary: string, args: string[]): string {
  const escapedBinary = escapeShellArg(binary);
  const escapedArgs = args.map((arg) => escapeShellArg(arg));
  return [escapedBinary, ...escapedArgs].join(' ');
}
