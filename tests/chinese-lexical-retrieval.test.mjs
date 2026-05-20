import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemxDbClient } from "../dist/.runtime/src/db/client.mjs";
import { VectorRepo } from "../dist/.runtime/src/db/repositories/vectorRepo.mjs";
import { SqliteFtsBackend } from "../dist/.runtime/src/search/backends/ftsBackend.mjs";
import {
  hasCjkLexicalTerms,
  lexicalSearchTerms,
} from "../dist/.runtime/src/search/lexical.mjs";

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
      {
        docId: "doc:ja:1",
        docKind: "event",
        sourceId: "turn:ja:1",
        scope: "agent:main",
        agentId: "main",
        text: "ユーザーはプロジェクト記憶の設計を確認した。",
        metadataJson: { observedAt },
        createdAt: observedAt,
        updatedAt: observedAt,
        materializedEpoch: 1,
      },
      {
        docId: "doc:ko:1",
        docKind: "event",
        sourceId: "turn:ko:1",
        scope: "agent:main",
        agentId: "main",
        text: "사용자는프로젝트메모리저장소설계를점검했다.",
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

test("lexical terms treat Hangul as CJK-like lexical text and expose short subwords", () => {
  const terms = lexicalSearchTerms("사용자는프로젝트메모리저장소설계를점검했다");
  assert.equal(hasCjkLexicalTerms("메모리"), true);
  assert.ok(terms.includes("메모리"));
  assert.ok(terms.includes("프로"));
});

test("lexical retrieval matches Japanese and Korean terms inside no-space memory text", async () => {
  await withBackend((backend) => {
    const japaneseHits = backend.keywordSearch({
      agentId: "main",
      scopes: ["agent:main"],
      query: "記憶",
      limit: 5,
    });
    assert.equal(japaneseHits[0]?.docId, "doc:ja:1");

    const koreanHits = backend.keywordSearch({
      agentId: "main",
      scopes: ["agent:main"],
      query: "메모리",
      limit: 5,
    });
    assert.equal(koreanHits[0]?.docId, "doc:ko:1");
  });
});

test("lexical terms keep mixed Latin and CJK-family scripts available to recall", () => {
  const terms = lexicalSearchTerms("Notebook 项目 memory メモリ 저장소");
  assert.ok(terms.includes("notebook"));
  assert.ok(terms.includes("项目"));
  assert.ok(terms.includes("memory"));
  assert.ok(terms.includes("メモリ"));
  assert.ok(terms.includes("저장소"));
});
