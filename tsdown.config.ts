import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  fixedExtension: false,
  dts: true,
  clean: true,
  hash: false,
  format: ["esm"],
});
