import type { Mapping } from "@volar/source-map";
import type { AST } from "./types.ts";
import { DO_NOT_COMBINE } from "./api.ts";

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
    return { start, end };
  }

  return undefined;
}

export function pushMapping<Data>(
  mappings: InternalMapping<Data>[],
  mapping: InternalMapping<Data>,
  combineMappingData: (left: Data, right: Data) => Data | typeof DO_NOT_COMBINE,
): void {
  const previous = mappings.at(-1);
  let combinedData: Data | typeof DO_NOT_COMBINE;
  if (
    previous &&
    canMerge(previous, mapping) &&
    (combinedData = combineMappingData(previous.data, mapping.data)) !==
      DO_NOT_COMBINE
  ) {
    previous.sourceEnd = mapping.sourceEnd;
    previous.generatedEnd = mapping.generatedEnd;
    previous.data = combinedData;
  } else {
    mappings.push(mapping);
  }
}

/**
 * Two adjacent mappings with identical lengths can be merged into one mapping.
 * @param left
 * @param right
 * @returns
 */
function canMerge<Data>(
  left: InternalMapping<Data>,
  right: InternalMapping<Data>,
): boolean {
  return (
    left.sourceEnd - left.sourceStart ===
      left.generatedEnd - left.generatedStart &&
    right.sourceEnd - right.sourceStart ===
      right.generatedEnd - right.generatedStart &&
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
