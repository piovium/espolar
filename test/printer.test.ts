import { Parser } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { describe, expect, it } from "vitest";
import { print, type NodeMappingData } from "../src/index.ts";
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
      isUntouched: node => node.type !== "Program",
    });

    expect(result.code).toBe(source);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].sourceOffsets).toEqual([0]);
    expect(result.mappings[0].generatedOffsets).toEqual([0]);
    expect(result.mappings[0].lengths).toEqual([source.length]);
    expect((result.mappings[0].data as NodeMappingData).nodeTypes).toEqual([
      "VariableDeclaration",
      "VariableDeclaration",
    ]);
  });

  it("structurally prints touched JavaScript nodes", () => {
    const source = "const total = add(1, 2);";
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toBe("const total = add(1, 2);");
    expect(result.mappings).toHaveLength(0);
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

    expect(result.code).toBe([
      "type Box<T> = { value: T; };",
      "interface Named { readonly name?: string; }",
      "const value: Box<number> = item satisfies Box<number>;",
    ].join("\n"));
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

    expect(result.code).toBe([
      "async function* load<T>(items: T[]): Promise<T> {\nreturn items[0]!;\n}",
      "const fn = async (value: number): number => value + 1;",
      "function collect(...items: string[]) {}",
    ].join("\n"));
  });

  it("structurally prints object, array, spread, chain, and computed properties", () => {
    const source = "const data = { value, [key]: get?.(1), nested: { a: 1 }, list: [first, ...rest] };";
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toBe("const data = { value, [key]: get?.(1), nested: { a: 1 }, list: [first, ...rest] };");
  });

  it("structurally prints richer TypeScript declarations", () => {
    const source = [
      "type Mixed<T extends string = \"x\"> = string | number & boolean;",
      "interface Child extends Parent<string> { [key]?: number; }",
      "type Qualified = Namespace.Name;",
    ].join("\n");
    const ast = parse(source);

    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toBe([
      "type Mixed<T extends string = \"x\"> = string | number & boolean;",
      "interface Child extends Parent<string> { [key]?: number; }",
      "type Qualified = Namespace.Name;",
    ].join("\n"));
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
    expect(() => print(
      {
        type: "NotImplemented",
      } as unknown as AST.Node,
      {
        source: "",
        isUntouched: () => false,
      },
    )).toThrow("No printer registered for node type NotImplemented");
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
          context.writeNodeListWithSourceGaps((program as AST.Program).body, "\n");
          context.writeSourceGap(0, 0);
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

    const result = print<string>(ast, {
      source,
      isUntouched: node => node.type !== "Program",
      getMappingData: node => node.type,
      combineMappingData: (left, right) => `${left}+${right}`,
    });

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].data).toBe("VariableDeclaration+VariableDeclaration");
  });

  it("supports custom untouched detection", () => {
    const source = "const untouched = 1;\nconst regenerated = 2;";
    const ast = parse(source);
    const regenerated = ast.body[1];

    const result = print(ast, {
      source,
      isUntouched: node => (
        node !== ast
        && node !== regenerated
        && node.type !== "VariableDeclarator"
      ),
    });

    expect(result.code).toBe(source);
    expect(result.mappings.map(mapping => mapping.lengths[0])).toEqual([
      "const untouched = 1;\n".length,
      "regenerated".length,
      "2".length,
    ]);
  });

  it("supports custom printers and mapping data", () => {
    const source = "const value = 1;";
    const ast = parse(source);
    const declaration = ast.body[0] as AST.VariableDeclaration;

    const result = print<string>(declaration, {
      source,
      getMappingData: node => node.type,
      isUntouched: node => node !== declaration && node.type !== "VariableDeclarator",
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
    expect(result.mappings.map(mapping => mapping.data)).toEqual([
      "Identifier",
      "Literal",
    ]);
  });
});
