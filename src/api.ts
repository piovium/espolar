import type { Mapping } from "@volar/source-map";
import type { AST, AST_NODE_TYPES } from "./types.ts";
import type { SourceRange } from "./mappings.ts";

export interface PrintResult<Data> {
  code: string;
  mappings: Mapping<Data>[];
}

export interface PrintOptions<Data> {
  source: string;
  isUntouched?: (node: AST.Node) => boolean | SourceRange;
  getMappingData?: (node?: AST.Node | null) => Data;
  combineMappingData?: (left: Data, right: Data) => Data;
  printers?: Printers<Data>;
}

export interface PrinterContext<Data> {
  readonly source: string;
  readonly generatedOffset: number;
  write(text: string): void;
  writeNode(node: AST.Node | null | undefined): void;
  writeNodeList(
    nodes: readonly (AST.Node | null | undefined)[],
    separator: string,
  ): void;
  writeNodeListWithSourceGaps(
    nodes: readonly (AST.Node | null | undefined)[],
    fallbackSeparator: string,
  ): void;
  writePreservedNode(node: AST.Node): void;
  writeSource(start: number, end: number, data: Data): void;
}

export type NodePrinter<Key extends AST_NODE_TYPES, Data> = (
  node: Extract<AST.Node, { type: Key }>,
  context: PrinterContext<Data>,
) => void;

export type Printers<Data> = {
  [K in AST_NODE_TYPES]?: NodePrinter<K, Data>;
};
