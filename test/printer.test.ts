import { Parser } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { describe, expect, it } from "vitest";
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

// TODO add test here
