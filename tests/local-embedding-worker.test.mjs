import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OptionalEmbeddingBackend } from "../dist/.runtime/src/search/backends/embeddingBackend.mjs";

const rootPath = new URL("..", import.meta.url).pathname;
const workerPath = join(rootPath, "dist/.runtime/sentence_transformers_embedder.py");

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("process exit timed out"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function waitForLauncherMetadata(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await waitForExit(child, 8000);
  assert.equal(code, 0, stderr);
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  assert.ok(line, `missing launcher stdout; stderr=${stderr}`);
  return JSON.parse(line);
}

async function waitUntilServerStops(url, token) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/embed`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memx-token": token,
        },
        body: JSON.stringify({ mode: "query", texts: ["still alive?"] }),
        signal: AbortSignal.timeout(250),
      });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("embedding server stayed alive after owner process exited");
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

test("local embedding worker is shared across backend instances with the same model config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-local-worker-shared-"));
  const startCountPath = join(tempDir, "starts.txt");
  const postMethod = ["PO", "ST"].join("");
  let requestCount = 0;
  let shutdownCount = 0;
  const server = createServer((request, response) => {
    if (request.method !== postMethod) {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/shutdown") {
      shutdownCount++;
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

  const config = {
    provider: "sentence-transformers-local",
    model: "shared-fake-model",
    localPythonBin: fakePythonPath,
    localDevice: "cpu",
  };
  const backendA = new OptionalEmbeddingBackend({}, config, createLogger());
  const backendB = new OptionalEmbeddingBackend({}, config, createLogger());

  try {
    assert.deepEqual(await backendA.embedTextsBatch(["alpha"], "query"), [[1, 0, 0]]);
    assert.deepEqual(await backendB.embedTextsBatch(["beta"], "query"), [[1, 0, 0]]);
    await backendA.close();
    assert.equal(shutdownCount, 0);
    assert.deepEqual(await backendB.embedTextsBatch(["gamma"], "query"), [[1, 0, 0]]);
  } finally {
    await backendA.close();
    await backendB.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const starts = (await readFile(startCountPath, "utf8"))
    .split("\n")
    .filter(Boolean);
  assert.equal(starts.length, 1);
  assert.equal(requestCount, 3);
  assert.equal(shutdownCount, 1);
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

test("local embedding backend passes its owning process pid to the Python launcher", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-local-parent-pid-"));
  const argsPath = join(tempDir, "args.json");
  const fakePythonPath = join(tempDir, "fake-python.mjs");
  await writeFile(
    fakePythonPath,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
const tokenIndex = process.argv.indexOf("--token");
process.stdout.write(JSON.stringify({
  url: "http://127.0.0.1:9",
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
    await backend.embedTextsBatch(["trigger launch"], "query");
  } finally {
    await backend.close();
  }

  const args = JSON.parse(await readFile(argsPath, "utf8"));
  const parentPidIndex = args.indexOf("--parent-pid");
  assert.notEqual(parentPidIndex, -1);
  assert.equal(args[parentPidIndex + 1], String(process.pid));
});

test("local embedding Python server exits when its owning process exits", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-python-owner-watch-"));
  await mkdir(join(tempDir, "sentence_transformers"), { recursive: true });
  await writeFile(
    join(tempDir, "sentence_transformers", "__init__.py"),
    `class SentenceTransformer:
    def __init__(self, model_name, cache_folder=None, device=None):
        pass

    def encode(self, texts, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False, batch_size=1):
        return [[1.0, 0.0, 0.0] for _ in texts]
`,
    "utf8",
  );

  const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  assert.ok(owner.pid);
  const token = "owner-watch-token";
  const stateFile = join(tempDir, "state.json");
  const launcher = spawn(
    "python3",
    [
      workerPath,
      "--launch-server",
      "--model",
      "fake-model",
      "--device",
      "cpu",
      "--token",
      token,
      "--state-file",
      stateFile,
      "--parent-pid",
      String(owner.pid),
    ],
    {
      env: {
        ...process.env,
        PYTHONPATH: tempDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let metadata;
  try {
    metadata = await waitForLauncherMetadata(launcher);
    const response = await fetch(`${metadata.url}/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-memx-token": token,
      },
      body: JSON.stringify({ mode: "query", texts: ["hello"] }),
    });
    assert.equal(response.status, 200);

    owner.kill("SIGTERM");
    await waitForExit(owner);
    await waitUntilServerStops(metadata.url, token);
  } finally {
    owner.kill("SIGKILL");
    if (metadata?.url) {
      await fetch(`${metadata.url}/shutdown`, {
        method: "POST",
        headers: { "x-memx-token": token },
        signal: AbortSignal.timeout(500),
      }).catch(() => {});
    }
  }
});
