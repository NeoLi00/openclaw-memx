import { mkdirSync, writeFileSync } from "node:fs";

const distUrl = new URL("../dist/", import.meta.url);
mkdirSync(distUrl, { recursive: true });

writeFileSync(
  new URL("index.mjs", distUrl),
  [
    'export { default } from "./.runtime/index.mjs";',
    'export * from "./.runtime/index.mjs";',
    "",
  ].join("\n"),
);

writeFileSync(
  new URL("index.d.mts", distUrl),
  [
    'export { default } from "./.runtime/index.d.mts";',
    'export * from "./.runtime/index.d.mts";',
    "",
  ].join("\n"),
);
