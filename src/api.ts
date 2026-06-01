import type { Mapping } from "@volar/source-map";
import type { AST, AST_NODE_TYPES, Comment } from "./types.ts";
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
  getLeadingComments?: (node: AST.Node) => Comment[] | undefined;
  getTrailingComments?: (node: AST.Node) => Comment[] | undefined;
  /**
   * Provide additional source range for the left parenthesis of `CallExpression` and `NewExpression`.
   * This is useful for language tools that want to provide signature hints when user enter `(`.
   * 
   * @notes This hook will not interact with parentheses around the callee.
   * 
   * @param node The `CallExpression` or `NewExpression` node.
   * @returns The source range of the left parenthesis, `undefined` if not available.
   */
  experimentalGetLeftParenSourceRange?: (
    node: AST.CallExpression | AST.NewExpression,
  ) => SourceRange | undefined;
}

export interface PrinterContext<Data = any> {
  readonly options: PrintOptions<Data>;
  readonly source: string;
  readonly generatedOffset: number;
  write(text: string): void;
  writeMapped(
    text: string,
    sourceStart: number,
    sourceEnd: number,
    data?: Data,
  ): void;
  writeNode(node: AST.Node | null | undefined): void;
  writeNodeList(
    nodes: readonly (AST.Node | null | undefined)[],
    separator: string,
  ): void;
  writeNodeListWithSourceGaps(
    nodes: readonly (AST.Node | null | undefined)[],
    fallbackSeparator: string,
  ): void;
  writeSource(start: number, end: number, data?: Data): void;
  writePreservedNode(node: AST.Node): void;
  appendMapping(
    sourceRange: SourceRange,
    generatedStart: number,
    generatedEnd: number,
    data?: Data,
  ): void;
}

export type NodePrinter<Key extends AST_NODE_TYPES, Data> = (
  node: Extract<AST.Node, { type: Key }>,
  context: PrinterContext<Data>,
) => void;

export type Printers<Data> = {
  [K in AST_NODE_TYPES]?: NodePrinter<K, Data>;
};
