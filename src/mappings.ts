import type { Mapping } from "@volar/source-map";
import type { AST } from "./types.ts";

export interface SourceRange {
  start: number;
  end: number;
}

type NodeWithOffsets = AST.Node & {
  start?: number;
  end?: number;
};

export function getNodeRange(node: AST.Node): SourceRange | undefined {
  if (Array.isArray(node.range) && node.range.length === 2) {
    const [start, end] = node.range;
    if (Number.isInteger(start) && Number.isInteger(end) && start <= end) {
      return { start, end };
    }
  }

  const nodeWithOffsets = node as NodeWithOffsets;
  const start = nodeWithOffsets.start;
  const end = nodeWithOffsets.end;
  if (
    typeof start === "number"
    && typeof end === "number"
    && Number.isInteger(start)
    && Number.isInteger(end)
    && start <= end
  ) {
    return {
      start,
      end,
    };
  }

  return undefined;
}

export function canUseDefaultPreservation(node: AST.Node): boolean {
  return getNodeRange(node) !== undefined;
}

export function pushMapping<Data>(
  mappings: Mapping<Data>[],
  mapping: Mapping<Data>,
  combineMappingData: (left: Data, right: Data) => Data,
): void {
  const previous = mappings.at(-1);
  if (previous && canMerge(previous, mapping)) {
    previous.lengths[0] += mapping.lengths[0];
    previous.data = combineMappingData(previous.data, mapping.data);
    return;
  }

  mappings.push(mapping);
}

export function extendLastMapping<Data>(
  mappings: Mapping<Data>[],
  sourceStart: number,
  sourceEnd: number,
  generatedStart: number,
  generatedEnd: number,
): boolean {
  const previous = mappings.at(-1);
  if (!previous) {
    return false;
  }

  const length = sourceEnd - sourceStart;
  if (
    previous.sourceOffsets.length === 1
    && previous.generatedOffsets.length === 1
    && previous.lengths.length === 1
    && previous.generatedLengths === undefined
    && length === generatedEnd - generatedStart
    && previous.sourceOffsets[0] + previous.lengths[0] === sourceStart
    && previous.generatedOffsets[0] + previous.lengths[0] === generatedStart
  ) {
    previous.lengths[0] += length;
    return true;
  }

  return false;
}

function canMerge<Data>(left: Mapping<Data>, right: Mapping<Data>): boolean {
  return (
    left.sourceOffsets.length === 1
    && left.generatedOffsets.length === 1
    && left.lengths.length === 1
    && right.sourceOffsets.length === 1
    && right.generatedOffsets.length === 1
    && right.lengths.length === 1
    && left.generatedLengths === undefined
    && right.generatedLengths === undefined
    && left.sourceOffsets[0] + left.lengths[0] === right.sourceOffsets[0]
    && left.generatedOffsets[0] + left.lengths[0] === right.generatedOffsets[0]
  );
}
