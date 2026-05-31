import type { Mapping } from "@volar/source-map";
import type {
  NodeMappingData,
  NodePrinter,
  PrintOptions,
  PrintResult,
  PrinterContext,
  Printers,
} from "./api.ts";
import { defaultPrinters } from "./printers.ts";
import type { AST, AST_NODE_TYPES } from "./types.ts";
import {
  canUseDefaultPreservation,
  extendLastMapping,
  getNodeRange,
  pushMapping,
} from "./mappings.ts";

interface InternalPrinterContext<Data> extends PrinterContext<Data> {
  result(): PrintResult<Data>;
}

export function print<Data = NodeMappingData>(
  node: AST.Node,
  options: PrintOptions<Data>,
): PrintResult<Data> {
  const context = createPrinterContext(options);
  context.writeNode(node);
  return context.result();
}

export function defaultIsUntouched(node: AST.Node): boolean {
  return canUseDefaultPreservation(node);
}

export function defaultGetMappingData(node: AST.Node): NodeMappingData {
  return {
    nodeTypes: [node.type],
    nodes: [node],
  };
}

export function defaultCombineMappingData(
  left: NodeMappingData,
  right: NodeMappingData,
): NodeMappingData {
  return {
    nodeTypes: [...left.nodeTypes, ...right.nodeTypes],
    nodes: [...left.nodes, ...right.nodes],
  };
}

function createPrinterContext<Data>(
  options: PrintOptions<Data>,
): InternalPrinterContext<Data> {
  const chunks: string[] = [];
  const mappings: Mapping<Data>[] = [];
  let generatedOffset = 0;

  const isUntouched = options.isUntouched ?? defaultIsUntouched;
  const getMappingData =
    options.getMappingData ??
    (defaultGetMappingData as (node: AST.Node) => Data);
  const combineMappingData =
    options.combineMappingData ??
    (options.getMappingData
      ? (left: Data) => left
      : (defaultCombineMappingData as unknown as (
          left: Data,
          right: Data,
        ) => Data));
  const printers: Printers<Data> = {
    ...defaultPrinters,
    ...options.printers,
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

      if (isUntouched(node)) {
        const range = getNodeRange(node);
        if (range) {
          context.writePreservedNode(node);
          return;
        }
      }

      const printer = printers[node.type] as
        | NodePrinter<AST_NODE_TYPES, Data>
        | undefined;
      if (!printer) {
        throw new Error(`No printer registered for node type ${node.type}`);
      }

      printer(node, context);
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
            context.writeSourceGap(lastRangeEnd, range.start);
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

      const generatedStart = generatedOffset;
      const text = options.source.slice(range.start, range.end);
      context.write(text);

      pushMapping(
        mappings,
        {
          sourceOffsets: [range.start],
          generatedOffsets: [generatedStart],
          lengths: [range.end - range.start],
          data: getMappingData(node),
        },
        combineMappingData,
      );
    },
    writeSourceGap(start, end) {
      if (end <= start) {
        return;
      }

      const generatedStart = generatedOffset;
      context.write(options.source.slice(start, end));
      extendLastMapping(mappings, start, end, generatedStart, generatedOffset);
    },
    result() {
      return {
        code: chunks.join(""),
        mappings,
      };
    },
  };

  return context;
}
