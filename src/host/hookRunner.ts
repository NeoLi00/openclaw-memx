import { normalizeHookPayload, type MemxHostId } from "./hookPayload.js";

const DEFAULT_URL = "http://127.0.0.1:3878";

async function readStdinJson(): Promise<Record<string, unknown>> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  if (!input.trim()) {
    return {};
  }
  return JSON.parse(input) as Record<string, unknown>;
}

function authHeaders(): Record<string, string> {
  const secret = process.env["MEMX_SECRET"];
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const url = (process.env["MEMX_URL"] || DEFAULT_URL).replace(/\/+$/u, "");
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function runMemxHook(argv = process.argv.slice(2)): Promise<void> {
  const host = (argv[0] || process.env["MEMX_HOOK_HOST"] || "generic") as MemxHostId;
  const eventName = argv[1] || process.env["MEMX_HOOK_EVENT"] || "observe";
  const payload = await readStdinJson();
  const timeoutMs = Number(process.env["MEMX_HOOK_TIMEOUT_MS"] || 3000);
  try {
    const envelope = normalizeHookPayload(host, eventName, payload);
    await post("/v1/observe", envelope, Number.isFinite(timeoutMs) ? timeoutMs : 3000);
  } catch (error) {
    if (process.env["MEMX_HOOK_DEBUG"] === "1") {
      console.error(`memx hook failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
