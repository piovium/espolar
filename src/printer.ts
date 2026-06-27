import {
  DO_NOT_COMBINE,
  type NodePrinter,
  type PrintOptions,
  type PrintResult,
  type PrinterContext,
  type Printers,
} from "./api.ts";
import {
  defaultPrinters,
  expectAssignmentExprNeedsParen,
  writeComment,
} from "./printers.ts";
import type { AST, AST_NODE_TYPES, Comment, NodeLike } from "./types.ts";
import {
  getNodeRange,
  pushMapping,
  toVolarMapping,
  type InternalMapping,
  type SourceRange,
} from "./mappings.ts";

interface InternalPrinterContext extends PrinterContext<any> {
  // make typescript happy about complex types
  options: any;
  _skipLeadingComment: boolean;
  result(): PrintResult<any>;
}

export function print<Data = undefined>(
  node: AST.Node,
  options: PrintOptions<Data>,
): PrintResult<Data>;
export function print<Data = undefined>(
  node: import("estree").Node,
  options: PrintOptions<Data>,
): PrintResult<Data>;
export function print<Data = undefined>(
  node: NodeLike,
  options: PrintOptions<Data>,
): PrintResult<Data>;
export function print<Data = undefined>(
  node: unknown,
  options: PrintOptions<Data>,
): PrintResult<Data> {
  const context = createPrinterContext(options);
  context.writeNode(node as AST.Node);
  return context.result();
}

export function defaultIsUntouched(node: AST.Node): boolean | SourceRange {
  return getNodeRange(node) || false;
}

export function defaultCombineMappingData<T>(
  left: T,
  right: T,
): T | typeof DO_NOT_COMBINE {
  if (left === right) {
    return left;
  }
  return DO_NOT_COMBINE;
}

function createPrinterContext<Data>(
  options: PrintOptions<Data>,
): InternalPrinterContext {
  const chunks: string[] = [];
  const mappings: InternalMapping<Data>[] = [];
  const extraMappings: InternalMapping<Data>[] = [];
  let generatedOffset = 0;

  const isUntouched = options.isUntouched ?? defaultIsUntouched;
  const getMappingData = options.getMappingData ?? ((): any => undefined);
  const combineMappingData =
    options.combineMappingData ?? defaultCombineMappingData;
  const printers: Printers<Data> = {
    ...defaultPrinters,
    ...options.printers,
  };

  const appendMapping = (
    sourceRange: SourceRange,
    generatedStart: number,
    generatedEnd: number,
    data: Data,
  ) => {
    pushMapping(
      mappings,
      {
        sourceStart: sourceRange.start,
        sourceEnd: sourceRange.end,
        generatedStart,
        generatedEnd,
        data,
      },
      combineMappingData,
    );
  };

  const context: InternalPrinterContext = {
    options: options,
    _skipLeadingComment: false,
    source: options.source,
    get generatedOffset() {
      return generatedOffset;
    },
    write(text) {
      if (text.length === 0) {
        return;
      }
      chunks.push(text);
      generatedOffset += text.length;
    },
    writeMapped(text, sourceStart, sourceEnd, data) {
      if (sourceEnd < sourceStart) {
        return;
      }
      const generatedStart = generatedOffset;
      context.write(text);
      appendMapping(
        { start: sourceStart, end: sourceEnd },
        generatedStart,
        generatedOffset,
        data ?? getMappingData(null),
      );
    },
    writeNode(node, writeOpt = {}) {
      if (!node) {
        return;
      }

      const range = getNodeRange(node);
      const untouched = isUntouched(node);

      if (options.beforeWriteNode) {
        const result = options.beforeWriteNode({
          node,
          range,
          isUntouched: untouched,
          generatedOffset,
          context: context as PrinterContext<Data>,
        });
        if (result === false) {
          return;
        }
      }

      const printComments = !untouched || options.printCommentsOnUntouchedNodes;
      if (printComments && !writeOpt.noLeadingComment) {
        const leadingComments = options.getLeadingComments?.(node);
        if (leadingComments && !context._skipLeadingComment) {
          for (const comment of leadingComments) {
            writeComment(comment, context);
          }
        }
      }

      const generatedStart = generatedOffset;

      if (untouched) {
        const sourceRange = untouched === true ? range : untouched;
        if (!sourceRange) {
          throw new Error(
            `Node of type ${node.type} is marked as untouched but does not have valid source offsets`,
          );
        }
        context.writeSource(
          sourceRange.start,
          sourceRange.end,
          getMappingData(node),
        );
      } else {
        const printer = printers[node.type] as
          | NodePrinter<AST_NODE_TYPES, Data>
          | undefined;
        if (!printer) {
          throw new Error(`No printer registered for node type ${node.type}`);
        }
        printer(node, context);
      }

      const generatedEnd = generatedOffset;

      if (printComments && !writeOpt.noTrailingComment) {
        const trailingComments = options.getTrailingComments?.(node);
        if (trailingComments) {
          for (const comment of trailingComments) {
            writeComment(comment, context);
          }
        }
      }

      // If children nodes don't emit any mapping but the parent node itself
      // can produce mapping, add that mapping
      const lastMappingGeneratedEnd = mappings.at(-1)?.generatedEnd ?? 0;
      if (range && lastMappingGeneratedEnd <= generatedStart) {
        appendMapping(
          range,
          generatedStart,
          generatedEnd,
          getMappingData(node),
        );
      }

      if (options.afterWriteNode) {
        options.afterWriteNode({
          node,
          range,
          isUntouched: untouched,
          generatedOffset: generatedStart,
          generatedStart,
          generatedEnd: generatedOffset,
          context: context as PrinterContext<Data>,
        });
      }
    },
    writeNodeList(nodes, separator) {
      let needsSeparator = false;
      for (const node of nodes) {
        if (!node) {
          if (needsSeparator) {
            context.write(separator);
          }
          continue;
        }

        if (needsSeparator) {
          context.write(separator);
        }
        context.writeNode(node);
        needsSeparator = true;
      }
    },
    writeExpressionListWithCommaSep(nodes) {
      let needsSeparator = false;
      for (const node of nodes) {
        if (!node) {
          if (needsSeparator) {
            context.write(", ");
          }
          continue;
        }

        if (needsSeparator) {
          context.write(", ");
        }
        const needsParens = expectAssignmentExprNeedsParen(node);
        if (needsParens) {
          context.write("(");
          context.writeNode(node);
          context.write(")");
        } else {
          context.writeNode(node);
        }
        needsSeparator = true;
      }
    },
    writeNodeListWithNewLineSep(nodes, parentRange) {
      let lastRangeEnd: number | undefined;
      let trailingSepEnd: number | undefined;
      if (parentRange) {
        lastRangeEnd = parentRange.start;
        trailingSepEnd = parentRange.end;
      }
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const range = getNodeRange(node);
        let noLeadingComment = false;
        let noTrailingComment =
          i < nodes.length - 1
            ? true
            : range !== undefined && parentRange !== undefined;
        if (
          lastRangeEnd !== undefined &&
          range &&
          range.start >= lastRangeEnd
        ) {
          context.writeSource(lastRangeEnd, range.start, getMappingData(null));
          noLeadingComment = true;
        } else if (i > 0) {
          context.write("\n");
        }
        context.writeNode(node, {
          noLeadingComment,
          noTrailingComment,
        });
        if (range) {
          lastRangeEnd = range.end;
        } else {
          lastRangeEnd = undefined;
        }
      }
      if (trailingSepEnd !== undefined && lastRangeEnd !== undefined) {
        context.writeSource(lastRangeEnd, trailingSepEnd, getMappingData(null));
      }
    },
    writeSource(start, end, data) {
      if (end < start) {
        return;
      }

      const generatedStart = generatedOffset;
      context.write(options.source.slice(start, end));
      appendMapping(
        { start, end },
        generatedStart,
        generatedOffset,
        data ?? getMappingData(null),
      );
    },
    writePreservedNode(node) {
      const range = getNodeRange(node);
      if (!range) {
        throw new Error(
          `Cannot preserve node ${node.type} without source offsets`,
        );
      }
      context.writeSource(range.start, range.end, getMappingData(node));
    },
    appendMapping,
    createExtraMapping(sourceRange, generatedStart, generatedEnd, data) {
      extraMappings.push({
        sourceStart: sourceRange.start,
        sourceEnd: sourceRange.end,
        generatedStart,
        generatedEnd,
        data,
      });
    },
    result() {
      return {
        code: chunks.join(""),
        mappings: [...mappings, ...extraMappings].map(toVolarMapping),
      };
    },
  };

  return context;
}
