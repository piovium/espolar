import type { Mapping } from "@volar/source-map";
import type { InternalContext } from "./context.ts";
import type { AST } from "./types.ts";
import type { SourceRange } from "./utils.ts";

export function appendMapping<T>(
  context: InternalContext<T>,
  node: AST.Node,
  sourceRange: SourceRange,
  generatedRange: SourceRange,
): void {
  const next =
    context.options.createMapping?.({
      node,
      sourceRange,
      generatedRange,
    }) ??
    ({
      sourceOffsets: [sourceRange[0]],
      generatedOffsets: [generatedRange[0]],
      lengths: [sourceRange[1] - sourceRange[0]],
      generatedLengths:
        generatedRange[1] - generatedRange[0] ===
        sourceRange[1] - sourceRange[0]
          ? undefined
          : [generatedRange[1] - generatedRange[0]],
      data: context.options.mappingData as T,
    } satisfies Mapping<T>);

  const previous = context.mappings.at(-1);
  if (previous && shouldMergeMappings(context, previous, next)) {
    mergeMappings(previous, next);
    return;
  }
  context.mappings.push(next);
}

function shouldMergeMappings<T>(
  context: InternalContext<T>,
  previous: Mapping<T>,
  next: Mapping<T>,
): boolean {
  if (context.options.shouldMergeMappings) {
    return context.options.shouldMergeMappings(previous, next);
  }
  if (
    previous.data !== next.data ||
    previous.sourceOffsets.length !== 1 ||
    next.sourceOffsets.length !== 1 ||
    previous.generatedOffsets.length !== 1 ||
    next.generatedOffsets.length !== 1 ||
    previous.lengths.length !== 1 ||
    next.lengths.length !== 1
  ) {
    return false;
  }
  const sourceGap =
    next.sourceOffsets[0] - (previous.sourceOffsets[0] + previous.lengths[0]);
  const previousGeneratedLength =
    previous.generatedLengths?.[0] ?? previous.lengths[0];
  const generatedGap =
    next.generatedOffsets[0] -
    (previous.generatedOffsets[0] + previousGeneratedLength);
  return sourceGap >= 0 && sourceGap === generatedGap;
}

function mergeMappings<T>(previous: Mapping<T>, next: Mapping<T>): void {
  previous.lengths[0] =
    next.sourceOffsets[0] + next.lengths[0] - previous.sourceOffsets[0];
  const nextGeneratedLength = next.generatedLengths?.[0] ?? next.lengths[0];
  const generatedLength =
    next.generatedOffsets[0] +
    nextGeneratedLength -
    previous.generatedOffsets[0];
  if (generatedLength === previous.lengths[0]) {
    delete previous.generatedLengths;
  } else {
    previous.generatedLengths = [generatedLength];
  }
}
