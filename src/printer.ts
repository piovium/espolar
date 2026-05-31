import type {
  NodePrinter,
  PrintOptions,
  PrintResult,
  PrinterContext,
  Printers,
} from "./api.ts";
import { defaultPrinters } from "./printers.ts";
import type { AST, AST_NODE_TYPES } from "./types.ts";
import {
  getNodeRange,
  pushMapping,
  toVolarMapping,
  type InternalMapping,
  type SourceRange,
} from "./mappings.ts";

interface InternalPrinterContext<Data> extends PrinterContext<Data> {
  result(): PrintResult<Data>;
}

export function print<Data>(
  node: AST.Node,
  options: PrintOptions<Data>,
): PrintResult<Data> {
  const context = createPrinterContext(options);
  context.writeNode(node);
  return context.result();
}

export function defaultIsUntouched(node: AST.Node): boolean | SourceRange {
  return getNodeRange(node) || false;
}

export function defaultGetMappingData(node?: AST.Node | null): unknown {
  return {};
}

export function defaultCombineMappingData(
  left: unknown,
  right: unknown,
): unknown {
  return right;
}

function createPrinterContext<Data>(
  options: PrintOptions<Data>,
): InternalPrinterContext<Data> {
  const chunks: string[] = [];
  const mappings: InternalMapping<Data>[] = [];
  let generatedOffset = 0;

  const isUntouched = options.isUntouched ?? defaultIsUntouched;
  const getMappingData =
    options.getMappingData ??
    (defaultGetMappingData as (node?: AST.Node | null) => Data);
  const combineMappingData =
    options.combineMappingData ??
    (options.getMappingData
      ? (left: Data) => left
      : (defaultCombineMappingData as (left: Data, right: Data) => Data));
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

  const context: InternalPrinterContext<Data> = {
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
    writeNode(node) {
      if (!node) {
        return;
      }

      const range = getNodeRange(node);
      const untouchedRet = isUntouched(node);
      if (untouchedRet) {
        const sourceRange = untouchedRet === true ? range : untouchedRet;
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
        return;
      }

      const printer = printers[node.type] as
        | NodePrinter<AST_NODE_TYPES, Data>
        | undefined;
      if (!printer) {
        throw new Error(`No printer registered for node type ${node.type}`);
      }

      const generatedStart = generatedOffset;
      printer(node, context);
      const generatedEnd = generatedOffset;
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
    writeNodeListWithSourceGaps(nodes, fallbackSeparator) {
      let lastRangeEnd: number | undefined;
      let wroteNode = false;

      for (const node of nodes) {
        if (!node) {
          continue;
        }

        const range = getNodeRange(node);
        if (wroteNode) {
          if (
            lastRangeEnd !== undefined &&
            range &&
            range.start >= lastRangeEnd
          ) {
            context.writeSource(
              lastRangeEnd,
              range.start,
              getMappingData(null),
            );
          } else {
            context.write(fallbackSeparator);
          }
        }

        context.writeNode(node);
        wroteNode = true;

        if (range) {
          lastRangeEnd = range.end;
        } else {
          lastRangeEnd = undefined;
        }
      }
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
    writeSource(start, end, data) {
      if (end <= start) {
        return;
      }

      const generatedStart = generatedOffset;
      context.write(options.source.slice(start, end));
      appendMapping({ start, end }, generatedStart, generatedOffset, data);
    },
    result() {
      return {
        code: chunks.join(""),
        mappings: mappings.map(toVolarMapping),
      };
    },
  };

  return context;
}
