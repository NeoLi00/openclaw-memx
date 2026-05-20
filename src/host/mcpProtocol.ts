const DEFAULT_URL = "http://localhost:3878";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

type JsonRpcHandlerResult = JsonRpcResponse | null;

type McpTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type MemxMcpProxy = (path: string, init: RequestInit) => Promise<unknown>;

export type MemxMcpHandlerDeps = {
  proxy?: MemxMcpProxy;
};

function stringProp(description: string): Record<string, string> {
  return { type: "string", description };
}

function numberProp(description: string): Record<string, string> {
  return { type: "number", description };
}

export const MEMX_MCP_TOOLS: McpTool[] = [
  {
    name: "memx_recall",
    description: "Recall relevant memX memory across working state, facts, events, and graph.",
    inputSchema: {
      type: "object",
      properties: {
        query: stringProp("Focused recall query."),
        limit: numberProp("Maximum number of returned items."),
      },
      required: ["query"],
    },
  },
  {
    name: "memx_remember",
    description: "Store reusable memory through the memX semantic write pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        content: stringProp("Memory content to store."),
        type: stringProp("Optional memory type hint."),
      },
      required: ["content"],
    },
  },
  {
    name: "memx_observe",
    description: "Append a host turn or lifecycle event to memX.",
    inputSchema: {
      type: "object",
      properties: {
        hostId: stringProp("Host identifier, for example codex or claude-code."),
        sessionId: stringProp("Host session identifier."),
        messages: { type: "array", description: "Turn messages to observe." },
      },
    },
  },
  {
    name: "memx_forget",
    description: "Delete or tombstone a memory object.",
    inputSchema: {
      type: "object",
      properties: {
        kind: stringProp("Memory kind: doc, event, fact, or state."),
        id: stringProp("Memory object id."),
      },
      required: ["id"],
    },
  },
  {
    name: "memx_stats",
    description: "Return memX store statistics for the current shared actor.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memx_audit",
    description: "Return recent memX audit signals and maintenance activity.",
    inputSchema: {
      type: "object",
      properties: {
        limit: numberProp("Maximum number of audit rows."),
      },
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonResponse(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function textResult(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function callBody(args: Record<string, unknown>, extra?: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...args, ...(extra ?? {}) }),
  };
}

function pathForTool(name: string, args: Record<string, unknown>): { path: string; init: RequestInit } {
  switch (name) {
    case "memx_recall":
      return { path: "/v1/recall", init: callBody(args) };
    case "memx_remember":
      return { path: "/v1/remember", init: callBody(args) };
    case "memx_observe":
      return { path: "/v1/observe", init: callBody(args) };
    case "memx_forget":
      return { path: "/v1/forget", init: callBody(args) };
    case "memx_stats":
      return { path: "/v1/stats", init: { method: "GET" } };
    case "memx_audit": {
      const limit = typeof args.limit === "number" ? Math.trunc(args.limit) : 50;
      return { path: `/v1/audit?limit=${Math.max(1, Math.min(limit, 200))}`, init: { method: "GET" } };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function authHeaders(): Record<string, string> {
  const secret = process.env["MEMX_SECRET"];
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

export async function defaultMemxProxy(path: string, init: RequestInit): Promise<unknown> {
  const url = (process.env["MEMX_URL"] || DEFAULT_URL).replace(/\/+$/u, "");
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...authHeaders(),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  deps: MemxMcpHandlerDeps = {},
): Promise<JsonRpcHandlerResult> {
  const id = request.id ?? null;
  try {
    if (request.method === "notifications/initialized") {
      return null;
    }
    if (request.method === "initialize") {
      return jsonResponse(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "memx", version: "2026.3.15" },
        capabilities: { tools: {} },
      });
    }
    if (request.method === "ping") {
      return jsonResponse(id, {});
    }
    if (request.method === "tools/list") {
      return jsonResponse(id, { tools: MEMX_MCP_TOOLS });
    }
    if (request.method === "tools/call") {
      const params = asRecord(request.params);
      const name = typeof params.name === "string" ? params.name : "";
      const args = asRecord(params.arguments);
      const { path, init } = pathForTool(name, args);
      const proxy = deps.proxy ?? defaultMemxProxy;
      const result = await proxy(path, init);
      return jsonResponse(id, textResult(result));
    }
    return errorResponse(id, -32601, `method not found: ${request.method ?? "unknown"}`);
  } catch (error) {
    return errorResponse(id, -32000, error instanceof Error ? error.message : String(error));
  }
}
