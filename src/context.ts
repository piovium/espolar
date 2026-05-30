import type { Mapping } from "@volar/source-map";
import type { AST } from "./types.ts";
import { printNode } from "./language.ts";
import { sliceSource, type SourceRange } from "./utils.ts";
import { appendMapping } from "./mappings.ts";

export type MappingFactory<T = unknown> = (input: {
  node: AST.Node;
  sourceRange: SourceRange;
  generatedRange: SourceRange;
}) => Mapping<T>;

export interface PrinterHooks<T = unknown> {
  isUntouched?: (node: AST.Node, context: PrintContext<T>) => boolean;
  printNode?: (
    node: AST.Node,
    context: PrintContext<T>,
    next: () => void,
  ) => void;
  createMapping?: MappingFactory<T>;
  shouldMergeMappings?: (previous: Mapping<T>, next: Mapping<T>) => boolean;
}

export interface PrintOptions<T = unknown> extends PrinterHooks<T> {
  source: string;
  mappingData?: T;
}

export interface PrintContext<T = unknown> {
  readonly options: PrintOptions<T>;
  readonly source: string;
  /** Returns the raw source code for a given node. */
  raw: (node: AST.Node) => string;
  /** Run printer on given node. */
  print: (node: AST.Node) => string;
  /** Write `code` as a generation of `node`. */
  write: (code: string, node?: AST.Node) => void;
  /** Write the generated code for a given node. */
  writeNode: (node: AST.Node) => void;
  appendMapping: (node: AST.Node, generatedRange: SourceRange) => void;
}

export interface InternalContext<T> extends PrintContext<T> {
  readonly mappings: Mapping<T>[];
  code: string;
}

export function createPrintContext<T>(
  options: PrintOptions<T>,
): InternalContext<T> {
  const context: InternalContext<T> = {
    options,
    source: options.source,
    mappings: [],
    code: "",
    raw(node) {
      return sliceSource(options.source, getRange(node));
    },
    appendMapping(node, generatedRange) {
      const sourceRange = getRange(node);
      if (!sourceRange) {
        return;
      }
      appendMapping(context, node, sourceRange, generatedRange);
    },
    print(node) {
      if (isUntouched(node, context)) {
        return context.raw(node);
      }
      const next = () => printNode(node, context);
      const text = options.printNode?.(node, context, next) ?? next();
      return text;
    },
    write(code, node) {
      const start = context.code.length;
      context.code += code;
      if (node) {
        const end = context.code.length;
        context.appendMapping(node, [start, end]);
      }
    },
    writeNode(node) {
      const code = context.print(node);
      context.write(code, node);
    },
  };
  return context;
}

function isUntouched<T>(node: AST.Node, context: PrintContext<T>): boolean {
  if (!getRange(node)) {
    return false;
  }
  return context.options.isUntouched?.(node, context) ?? true;
}

function getRange(node: AST.Node): SourceRange | undefined {
  if (
    Array.isArray(node.range) &&
    typeof node.range[0] === "number" &&
    typeof node.range[1] === "number"
  ) {
    return [node.range[0], node.range[1]];
  }
  if (typeof node.start === "number" && typeof node.end === "number") {
    return [node.start, node.end];
  }
  return undefined;
}

function mustGetRange(node: AST.Node): SourceRange {
  const range = getRange(node);
  if (!range) {
    throw new Error(`Expected source range for ${node.type}`);
  }
  return range;
}
