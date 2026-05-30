
export type SourceRange = [start: number, end: number];

export function sliceSource(source: string, range: SourceRange | undefined): string {
  if (!range) {
    return "";
  }
  return source.slice(range[0], range[1]);
}
