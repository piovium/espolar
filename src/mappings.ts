import type { Mapping } from "@volar/source-map";
import type { AST } from "./types.ts";

export interface InternalMapping<Data = unknown> {
  sourceStart: number;
  sourceEnd: number;
  generatedStart: number;
  generatedEnd: number;
  data: Data;
}

export interface SourceRange {
  start: number;
  end: number;
}

export function getNodeRange(node: AST.Node): SourceRange | undefined {
  if (Array.isArray(node.range) && node.range.length === 2) {
    const [start, end] = node.range;
    if (Number.isInteger(start) && Number.isInteger(end) && start <= end) {
      return { start, end };
    }
  }
  const { start, end } = node;
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start <= end
  ) {
    return {
      start,
      end,
    };
  }

  return undefined;
}

export function pushMapping<Data>(
  mappings: InternalMapping<Data>[],
  mapping: InternalMapping<Data>,
  combineMappingData: (left: Data, right: Data) => Data,
): void {
  const previous = mappings.at(-1);
  if (previous && canMerge(previous, mapping)) {
    previous.sourceEnd = mapping.sourceEnd;
    previous.generatedEnd = mapping.generatedEnd;
    previous.data = combineMappingData(previous.data, mapping.data);
    return;
  }

  mappings.push(mapping);
}

function canMerge<Data>(
  left: InternalMapping<Data>,
  right: InternalMapping<Data>,
): boolean {
  return (
    left.sourceEnd === right.sourceStart &&
    left.generatedEnd === right.generatedStart
  );
}

export function toVolarMapping<Data>(
  mapping: InternalMapping<Data>,
): Mapping<Data> {
  const sourceLength = mapping.sourceEnd - mapping.sourceStart;
  const generatedLength = mapping.generatedEnd - mapping.generatedStart;
  return {
    sourceOffsets: [mapping.sourceStart],
    generatedOffsets: [mapping.generatedStart],
    lengths: [sourceLength],
    generatedLengths:
      generatedLength !== sourceLength ? [generatedLength] : undefined,
    data: mapping.data,
  };
}
