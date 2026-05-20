import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OptionalEmbeddingBackend } from "../dist/.runtime/src/search/backends/embeddingBackend.mjs";

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
  const postMethod = ["PO", "ST"].join("");
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.method !== postMethod) {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/shutdown") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (request.url !== "/embed") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requestCount++;
      const payload = JSON.parse(body);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            embeddings: payload.texts.map(() => [1, 0, 0]),
          }),
        );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const fakeWorkerUrl = `http://127.0.0.1:${address.port}`;

  const fakePythonPath = join(tempDir, "fake-python.mjs");
  await writeFile(
    fakePythonPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(${JSON.stringify(startCountPath)}, "start\\n");
const tokenIndex = process.argv.indexOf("--token");
process.stdout.write(JSON.stringify({
  url: ${JSON.stringify(fakeWorkerUrl)},
  token: tokenIndex >= 0 ? process.argv[tokenIndex + 1] : "",
}) + "\\n");
`,
    "utf8",
  );
  await chmod(fakePythonPath, 0o755);

  try {
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const starts = (await readFile(startCountPath, "utf8"))
    .split("\n")
    .filter(Boolean);
  assert.equal(starts.length, 1);
  assert.equal(requestCount, 2);
});

test("local embedding similarity search skips a cold worker in the prompt hot path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-local-cold-skip-"));
  const startCountPath = join(tempDir, "starts.txt");
  const fakePythonPath = join(tempDir, "fake-python.mjs");
  await writeFile(
    fakePythonPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(${JSON.stringify(startCountPath)}, "start\\n");
process.stdout.write(JSON.stringify({
  url: "http://127.0.0.1:9",
  token: "unused",
}) + "\\n");
`,
    "utf8",
  );
  await chmod(fakePythonPath, 0o755);

  const backend = new OptionalEmbeddingBackend(
    {
      listEmbeddings() {
        return [];
      },
      getDoc() {
        return null;
      },
    },
    {
      provider: "sentence-transformers-local",
      model: "fake-model",
      localPythonBin: fakePythonPath,
      localDevice: "cpu",
    },
    createLogger(),
  );

  try {
    assert.deepEqual(
      await backend.similaritySearch({
        agentId: "main",
        scopes: ["agent:main"],
        query: "cold prompt hook query",
        limit: 5,
      }),
      [],
    );
  } finally {
    await backend.close();
  }

  await assert.rejects(readFile(startCountPath, "utf8"), { code: "ENOENT" });
});

test("local embedding backend can prewarm the worker outside the prompt hook", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-local-prewarm-"));
  const startCountPath = join(tempDir, "starts.txt");
  const postMethod = ["PO", "ST"].join("");
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.method !== postMethod) {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/shutdown") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (request.url !== "/embed") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requestCount++;
      const payload = JSON.parse(body);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ embeddings: payload.texts.map(() => [1, 0, 0]) }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const fakeWorkerUrl = `http://127.0.0.1:${address.port}`;

  const fakePythonPath = join(tempDir, "fake-python.mjs");
  await writeFile(
    fakePythonPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(${JSON.stringify(startCountPath)}, "start\\n");
const tokenIndex = process.argv.indexOf("--token");
process.stdout.write(JSON.stringify({
  url: ${JSON.stringify(fakeWorkerUrl)},
  token: tokenIndex >= 0 ? process.argv[tokenIndex + 1] : "",
}) + "\\n");
`,
    "utf8",
  );
  await chmod(fakePythonPath, 0o755);

  const backend = new OptionalEmbeddingBackend(
    {
      listEmbeddings() {
        return [];
      },
      getDoc() {
        return null;
      },
    },
    {
      provider: "sentence-transformers-local",
      model: "fake-model",
      localPythonBin: fakePythonPath,
      localDevice: "cpu",
    },
    createLogger(),
  );

  try {
    await backend.prewarmLocalEmbeddings();
    assert.deepEqual(await backend.embedTextsBatch(["after prewarm"], "query"), [[1, 0, 0]]);
  } finally {
    await backend.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const starts = (await readFile(startCountPath, "utf8"))
    .split("\n")
    .filter(Boolean);
  assert.equal(starts.length, 1);
  assert.equal(requestCount, 2);
});
