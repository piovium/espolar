import { Parser } from "acorn";
import { describe, expect, it } from "vitest";
import { print, type AstNode } from "../src/index.ts";

function parse(source: string): AstNode {
  return Parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    ranges: true,
  }) as unknown as AstNode;
}

describe("printer", () => {
  it("preserves a source-backed root node by default", () => {
    const source = "const a = 1;\n";
    const ast = parse(source);
    const result = print(ast, { source, sourceName: "input.ts" });

    expect(result.code).toBe(source);
    expect(result.mappings).toEqual([
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [source.length],
        data: undefined,
      },
    ]);
  });

  it("prints touched ancestors and preserves untouched descendants", () => {
    const source = "const answer = 1;";
    const ast = parse(source);
    const declaration = (ast.body as AstNode[])[0];
    const declarator = (declaration.declarations as AstNode[])[0];
    const literal = declarator.init as AstNode;
    const touched = new WeakSet<AstNode>([ast, declaration, declarator, literal]);

    literal.value = 2;
    delete literal.raw;

    const result = print(ast, {
      source,
      sourceName: "input.ts",
      isUntouched: (node) => !touched.has(node),
    });

    expect(result.code).toBe("const answer = 2;");
    expect(result.mappings).toEqual([
      {
        sourceOffsets: [6],
        generatedOffsets: [6],
        lengths: [6],
        data: undefined,
      },
    ]);
  });

  it("combines adjacent untouched sibling mappings with preserved trivia", () => {
    const source = "let a = 1;\nlet b = 2;";
    const ast = parse(source);
    const touched = new WeakSet<AstNode>([ast]);

    const result = print(ast, {
      source,
      sourceName: "input.ts",
      isUntouched: (node) => !touched.has(node),
    });

    expect(result.code).toBe(source);
    expect(result.mappings).toEqual([
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [source.length],
        data: undefined,
      },
    ]);
  });

  it("allows callers to override node printing and mapping data", () => {
    const source = "foo();";
    const ast = parse(source);
    const statement = (ast.body as AstNode[])[0];
    const touched = new WeakSet<AstNode>([ast, statement]);

    const result = print(ast, {
      source,
      sourceName: "input.ts",
      mappingData: { verification: true },
      isUntouched: (node) => !touched.has(node),
      printNode: (node, context, next) => {
        if (node.type === "ExpressionStatement") {
          return `await ${context.print(node.expression as AstNode)};`;
        }
        return next();
      },
    });

    expect(result.code).toBe("await foo();");
    expect(result.mappings).toEqual([
      {
        sourceOffsets: [0],
        generatedOffsets: [6],
        lengths: [5],
        data: { verification: true },
      },
    ]);
  });
});
