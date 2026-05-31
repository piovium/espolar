import { Parser } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { describe, expect, it } from "vitest";
import { print } from "../src/index.ts";
import type { AST } from "../src/types.ts";

const TsParser = Parser.extend(tsPlugin());

function parse(source: string): AST.Program {
  return TsParser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    ranges: true,
  }) as AST.Program;
}

describe("print", () => {
  it("preserves an untouched program byte-for-byte", () => {
    const source = "const answer = 42;\n";
    const ast = parse(source);

    const result = print(ast, { source });

    expect(result.code).toBe(source);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].sourceOffsets).toEqual([0]);
    expect(result.mappings[0].generatedOffsets).toEqual([0]);
    expect(result.mappings[0].lengths).toEqual([source.length]);
  });

  it("prints a touched parent while preserving untouched descendants and source gaps", () => {
    const source = "const one = 1;\n\nconst two = 2;";
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: (node) => node.type !== "Program",
    });

    expect(result.code).toBe(source);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].sourceOffsets).toEqual([0]);
    expect(result.mappings[0].generatedOffsets).toEqual([0]);
    expect(result.mappings[0].lengths).toEqual([source.length]);
  });

  it("structurally prints touched JavaScript nodes with leaf node mappings", () => {
    const source = "const total = add(1, 2);";
    const ast = parse(source);

    const result = print<string | undefined>(ast, {
      source,
      isUntouched: () => false,
      getMappingData: (node) => node?.type,
    });

    expect(result.code).toBe("const total = add(1, 2);");
    expect(result.mappings).toHaveLength(4);
    expect(result.mappings.map((mapping) => mapping.data)).toEqual([
      "Identifier",
      "Identifier",
      "Literal",
      "Literal",
    ]);
  });

  it("structurally prints basic TypeScript syntax", () => {
    const source = [
      "type Box<T> = { value: T };",
      "interface Named { readonly name?: string; }",
      "const value: Box<number> = item satisfies Box<number>;",
    ].join("\n");
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toBe(
      [
        "type Box<T> = { value: T; };",
        "interface Named { readonly name?: string; }",
        "const value: Box<number> = item satisfies Box<number>;",
      ].join("\n"),
    );
  });

  it("structurally prints functions, blocks, members, and arrows", () => {
    const source = [
      "async function* load<T>(items: T[]): Promise<T> { return items[0]!; }",
      "const fn = async (value: number): number => value + 1;",
      "function collect(...items: string[]) {}",
    ].join("\n");
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toBe(
      [
        "async function* load<T>(items: T[]): Promise<T> {\nreturn items[0]!;\n}",
        "const fn = async (value: number): number => value + 1;",
        "function collect(...items: string[]) {}",
      ].join("\n"),
    );
  });

  it("structurally prints object, array, spread, chain, and computed properties", () => {
    const source =
      "const data = { value, [key]: get?.(1), nested: { a: 1 }, list: [first, ...rest] };";
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toBe(
      "const data = { value, [key]: get?.(1), nested: { a: 1 }, list: [first, ...rest] };",
    );
  });

  it("structurally prints richer TypeScript declarations", () => {
    const source = [
      'type Mixed<T extends string = "x"> = string | number & boolean;',
      "interface Child extends Parent<string> { [key]?: number; }",
      "type Qualified = Namespace.Name;",
    ].join("\n");
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toBe(
      [
        'type Mixed<T extends string = "x"> = string | number & boolean;',
        "interface Child extends Parent<string> { [key]?: number; }",
        "type Qualified = Namespace.Name;",
      ].join("\n"),
    );
  });

  it("prints small generated nodes without source ranges", () => {
    const result = print(
      {
        type: "PrivateIdentifier",
        name: "secret",
      } as AST.Node,
      {
        source: "",
        isUntouched: () => false,
      },
    );

    expect(result.code).toBe("#secret");
  });

  it("preserves nodes that only expose start and end offsets", () => {
    const result = print(
      {
        type: "Identifier",
        start: 0,
        end: 6,
        name: "changed",
      } as AST.Node,
      {
        source: "actual",
      },
    );

    expect(result.code).toBe("actual");
    expect(result.mappings[0].sourceOffsets).toEqual([0]);
    expect(result.mappings[0].lengths).toEqual([6]);
  });

  it("reports unsupported touched nodes", () => {
    expect(() =>
      print(
        {
          type: "NotImplemented",
        } as unknown as AST.Node,
        {
          source: "",
          isUntouched: () => false,
        },
      ),
    ).toThrow("No printer registered for node type NotImplemented");
  });

  it("lets custom printers use low-level context helpers", () => {
    const literal = {
      type: "Literal",
      value: 1,
    } as AST.Node;
    const program = {
      type: "Program",
      body: [
        literal,
        null,
        {
          type: "Literal",
          value: 2,
        },
      ],
    } as AST.Node;

    const result = print(program, {
      source: "",
      isUntouched: () => false,
      printers: {
        Program: (_node, context) => {
          context.write("");
          context.writeNode(null);
          context.writeNodeListWithSourceGaps(
            (program as AST.Program).body,
            "\n",
          );
          context.writeSource(0, 0, null);
          context.write("|");
          context.writeNodeList([literal, null, literal], ",");
        },
      },
    });

    expect(result.code).toBe("1\n2|1,,1");
  });

  it("supports explicit mapping-data combination", () => {
    const source = "const a = 1;\nconst b = 2;";
    const ast = parse(source);

    const result = print<string | null>(ast, {
      source,
      isUntouched: (node) => node.type !== "Program",
      getMappingData: (node) => node?.type || null,
      combineMappingData: (left, right) =>
        right === null ? left : `${left}+${right}`,
    });

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].data).toBe(
      "VariableDeclaration+VariableDeclaration",
    );
  });

  it("supports custom untouched detection", () => {
    const source = "const untouched = 1;\nconst regenerated = 2;";
    const ast = parse(source);
    const regenerated = ast.body[1];

    const result = print(ast, {
      source,
      isUntouched: (node) =>
        node !== ast &&
        node !== regenerated &&
        node.type !== "VariableDeclarator",
    });

    expect(result.code).toBe(source);
    expect(result.mappings.map((mapping) => mapping.lengths[0])).toEqual([
      "const untouched = 1;\n".length,
      "regenerated".length,
      "2".length,
    ]);
  });

  it("supports custom printers and mapping data", () => {
    const source = "const value = 1;";
    const ast = parse(source);
    const declaration = ast.body[0] as AST.VariableDeclaration;

    const result = print<string | null>(declaration, {
      source,
      getMappingData: (node) => node?.type || null,
      isUntouched: (node) =>
        node !== declaration && node.type !== "VariableDeclarator",
      printers: {
        VariableDeclaration: (node, context) => {
          const variable = node as AST.VariableDeclaration;
          context.write("let ");
          context.writeNode(variable.declarations[0]);
          context.write(";");
        },
      },
    });

    expect(result.code).toBe("let value = 1;");
    expect(result.mappings.map((mapping) => mapping.data)).toEqual([
      "Identifier",
      "Literal",
    ]);
  });

  it("structurally prints precedence-aware binary and logical expressions", () => {
    const source = "const x = a + b * c;";
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe("const x = a + b * c;");
  });

  it("structurally prints arrow concise body wrapping", () => {
    const source = "const fn = () => ({ x: 1 } as const);";
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe("const fn = () => ({ x: 1 } as const);");
  });

  it("structurally prints expression statement wrapping for objects", () => {
    const source = "({ x: 1 });";
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe("({ x: 1 });");
  });

  it("structurally prints conditional and sequence expressions", () => {
    const source = "const x = a > b ? c : (d, e);";
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe("const x = a > b ? c : (d, e);");
  });

  it("structurally prints loops and branches", () => {
    const source = [
      "function f() {",
      "if (x) return y; else if (z) throw e;",
      "for (let i = 0; i < 10; i++) break;",
      "for (const x of arr) continue;",
      "while (true) debugger;",
      "do {} while (cond);",
      "}",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints switch and try statements", () => {
    const source = [
      "switch (x) {",
      "case 1:",
      "a;",
      "default:",
      "b;}",
      "try {",
      "c;",
      "} catch (e) {",
      "d;",
      "} finally {",
      "e;",
      "}",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints class declarations and expressions", () => {
    const source = [
      "class Base {}",
      "class Child extends Base<T> implements I {}",
      "const cls = class extends Base {};",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints template literals", () => {
    const source = "const msg = `hello ${name}`;";
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe("const msg = `hello ${name}`;");
  });

  it("structurally prints import and export declarations", () => {
    const source = [
      "import { x } from 'a';",
      "export { y } from 'b';",
      "export default z;",
      "export * from 'c';",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints TS type assertions and non-null", () => {
    const source = "const x = a as T; const y = b!;";
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe("const x = a as T; const y = b!;");
  });

  it("structurally prints TS advanced types", () => {
    const source = [
      "type A = [string, number, ...boolean[]];",
      "type B = T[K];",
      "type C = T extends U ? V : W;",
      "type D = { [K in keyof T]: T[K] };",
      "type E = infer R;",
      "type F = typeof x;",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints TS enum and module declarations", () => {
    const source = [
      "enum Color { Red, Green = 3 }",
      "declare module 'x' {",
      "export const a: number;",
      "}",
      "namespace N {",
      "export const b = 1;",
      "}",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints TS function and constructor types", () => {
    const source = [
      "type F = (x: number) => string;",
      "type C = new (x: number) => T;",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints TS template literal and import types", () => {
    const source = [
      "type T = `prefix-${string}-suffix`;",
      "type I = import('a').X;",
    ].join("\n");
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe(source);
  });

  it("structurally prints new expression", () => {
    const source = "const x = new Foo(1);";
    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });
    expect(result.code).toBe("const x = new Foo(1);");
  });
});
