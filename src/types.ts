declare module "@typescript-eslint/types" {
  export namespace TSESTree {
    export interface NodeOrTokenData {
      start?: number;
      end?: number;
    }
  }
}

export { TSESTree as AST } from "@typescript-eslint/types";
export type { AST_NODE_TYPES } from "@typescript-eslint/types";
