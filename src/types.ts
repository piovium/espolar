import type { TSESTree } from "@typescript-eslint/types";

declare module "@typescript-eslint/types" {
  export namespace TSESTree {
    export interface NodeOrTokenData {
      start?: number;
      end?: number;
    }
  }
}

export { TSESTree as AST } from "@typescript-eslint/types";
export type { TSESTree } from "@typescript-eslint/types";
