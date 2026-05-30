import { Parser } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { describe, expect, it } from "vitest";
import { print, type AST } from "../src/index.ts";

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
