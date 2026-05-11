import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OptionalEmbeddingBackend } from "../dist/src/search/backends/embeddingBackend.mjs";

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

test("local sentence-transformers embedding worker stays resident across requests", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-local-worker-"));
  const startCountPath = join(tempDir, "starts.txt");
  const fakePythonPath = join(tempDir, "fake-python.mjs");
  await writeFile(
    fakePythonPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

appendFileSync(${JSON.stringify(startCountPath)}, "start\\n");

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (!line.trim()) continue;
  const payload = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    id: payload.id,
    embeddings: payload.texts.map(() => [1, 0, 0]),
  }) + "\\n");
}
`,
    "utf8",
  );
  await chmod(fakePythonPath, 0o755);

  const backend = new OptionalEmbeddingBackend(
    {},
    {
      provider: "sentence-transformers-local",
      model: "fake-model",
      localPythonBin: fakePythonPath,
      localDevice: "cpu",
    },
    createLogger(),
  );

  assert.deepEqual(await backend.embedTextsBatch(["alpha"], "query"), [[1, 0, 0]]);
  assert.deepEqual(await backend.embedTextsBatch(["beta"], "query"), [[1, 0, 0]]);
  await backend.close();

  const starts = (await readFile(startCountPath, "utf8"))
    .split("\n")
    .filter(Boolean);
  assert.equal(starts.length, 1);
});
