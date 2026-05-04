export interface DiffFile {
  path: string;
  changeType: string;
  summary: string;
}

export class DiffRenderer {
  public renderDiffSummary(files: DiffFile[]): string {
    if (files.length === 0) {
      return 'No changes detected';
    }

    return files
      .map((file) => {
        return `[${file.changeType}] ${file.path}\n${file.summary}`;
      })
      .join('\n\n');
  }
}
