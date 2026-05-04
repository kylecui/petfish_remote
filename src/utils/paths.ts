import path from 'node:path';

export function isWithinRoot(filePath: string, rootPath: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizePath(p: string, style: 'linux' | 'windows'): string {
  if (style === 'linux') {
    return p.replace(/\\/g, '/');
  }
  return p.replace(/\//g, '\\');
}
