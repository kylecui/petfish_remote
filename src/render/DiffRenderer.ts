export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
}

export class DiffRenderer {
  public renderDiffSummary(files: FileChange[]): string {
    if (files.length === 0) return '';

    const lines = files.map((f) => {
      const adds = f.additions > 0 ? `+${f.additions}` : '';
      const dels = f.deletions > 0 ? `-${f.deletions}` : '';
      const stats = [adds, dels].filter(Boolean).join(' ');
      return `\`${f.file}\` ${stats}`;
    });

    const totalAdds = files.reduce((s, f) => s + f.additions, 0);
    const totalDels = files.reduce((s, f) => s + f.deletions, 0);

    return `📝 *${files.length} file(s) changed* (+${totalAdds} -${totalDels})\n${lines.join('\n')}`;
  }
}
