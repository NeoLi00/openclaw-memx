import assert from "node:assert/strict";
import test from "node:test";
import { selectAgentEndMessagesForCapture } from "../dist/.runtime/src/pipeline/agentEndMessages.mjs";

function createCursorStore(initial = new Map()) {
  const values = new Map(initial);
  return {
    getSessionCursor(agentId, sessionKey) {
      return values.get(`${agentId}:${sessionKey}`);
    },
    setSessionCursor(agentId, sessionKey, cursor) {
      values.set(`${agentId}:${sessionKey}`, cursor);
    },
  };
}

function contents(messages) {
  return messages.map((message) => message.content);
}

test("ordinary agent_end snapshots capture only the newest turn even when the session is short", () => {
  const cursors = createCursorStore();
  const messages = [
    { role: "user", content: "old question" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "current question" },
    { role: "assistant", content: "current answer" },
  ];

  const selected = selectAgentEndMessagesForCapture({
    messages,
    ctx: { trigger: "manual", messageProvider: "gateway" },
    cursors,
    agentId: "main",
    sessionKey: "s1",
  });

  assert.deepEqual(contents(selected), ["current question", "current answer"]);
  assert.equal(cursors.getSessionCursor("main", "s1"), 4);
});

test("ordinary agent_end snapshots use the saved cursor on later turns", () => {
  const cursors = createCursorStore(new Map([["main:s1", 2]]));
  const messages = [
    { role: "user", content: "old question" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "next question" },
    { role: "assistant", content: "next answer" },
  ];

  const selected = selectAgentEndMessagesForCapture({
    messages,
    ctx: { trigger: "manual", messageProvider: "gateway" },
    cursors,
    agentId: "main",
    sessionKey: "s1",
  });

  assert.deepEqual(contents(selected), ["next question", "next answer"]);
  assert.equal(cursors.getSessionCursor("main", "s1"), 4);
});

test("gateway memory processing is the explicit turn-scoped agent_end payload", () => {
  const cursors = createCursorStore(new Map([["main:s1", 12]]));
  const messages = [
    { role: "user", content: "imported question" },
    { role: "assistant", content: "imported answer" },
  ];

  const selected = selectAgentEndMessagesForCapture({
    messages,
    ctx: { trigger: "memory", messageProvider: "gateway" },
    cursors,
    agentId: "main",
    sessionKey: "s1",
  });

  assert.deepEqual(contents(selected), ["imported question", "imported answer"]);
  assert.equal(cursors.getSessionCursor("main", "s1"), 12);
});
