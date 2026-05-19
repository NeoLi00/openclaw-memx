import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemxDbClient } from "../dist/src/db/client.mjs";
import { VectorRepo } from "../dist/src/db/repositories/vectorRepo.mjs";
import { SqliteFtsBackend } from "../dist/src/search/backends/ftsBackend.mjs";

const observedAt = "2026-05-19T00:00:00.000Z";

async function withBackend(run) {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-chinese-lexical-"));
  const dbPath = join(tempDir, "memx.sqlite");
  const client = await MemxDbClient.open(dbPath);
  try {
    const repo = new VectorRepo(client);
    const backend = new SqliteFtsBackend(repo);
    backend.upsertDocs([
      {
        docId: "doc:cn:1",
        docKind: "event",
        sourceId: "turn:cn:1",
        scope: "agent:main",
        agentId: "main",
        text: "用户喜欢苹果手机，也经常问中文召回问题。",
        metadataJson: { observedAt },
        createdAt: observedAt,
        updatedAt: observedAt,
        materializedEpoch: 1,
      },
    ]);
    return await run(backend);
  } finally {
    client.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("Chinese lexical retrieval matches short CJK query terms inside longer memory text", async () => {
  await withBackend((backend) => {
    const appleHits = backend.keywordSearch({
      agentId: "main",
      scopes: ["agent:main"],
      query: "苹果",
      limit: 5,
    });
    assert.equal(appleHits[0]?.docId, "doc:cn:1");

    const recallHits = backend.keywordSearch({
      agentId: "main",
      scopes: ["agent:main"],
      query: "召回",
      limit: 5,
    });
    assert.equal(recallHits[0]?.docId, "doc:cn:1");
  });
});
