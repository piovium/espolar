import type { Mapping } from "@volar/source-map";
import type { AST, AST_NODE_TYPES } from "./types.ts";

export interface NodeMappingData {
  nodeTypes: string[];
  nodes: AST.Node[];
}

export interface PrintResult<Data = NodeMappingData> {
  code: string;
  mappings: Mapping<Data>[];
}

export interface PrintOptions<Data = NodeMappingData> {
  source: string;
  isUntouched?: (node: AST.Node) => boolean;
  getMappingData?: (node: AST.Node) => Data;
  combineMappingData?: (left: Data, right: Data) => Data;
  printers?: Printers<Data>;
}

export interface PrinterContext<Data = NodeMappingData> {
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
  writeSourceGap(start: number, end: number): void;
}

export type NodePrinter<Key extends AST_NODE_TYPES, Data = NodeMappingData> = (
  node: Extract<AST.Node, { type: Key }>,
  context: PrinterContext<Data>,
) => void;

export type Printers<Data = NodeMappingData> = {
  [K in AST_NODE_TYPES]?: NodePrinter<K, Data>;
};
