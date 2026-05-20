//#region src/host/mcpProtocol.d.ts
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
  error?: {
    code: number;
    message: string;
  };
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
type MemxMcpToolsProfile = "full" | "lifecycle-safe";
type MemxMcpProxy = (path: string, init: RequestInit) => Promise<unknown>;
type MemxMcpHandlerDeps = {
  proxy?: MemxMcpProxy;
};
declare const MEMX_MCP_TOOLS: McpTool[];
declare function defaultMemxProxy(path: string, init: RequestInit): Promise<unknown>;
declare function handleMcpRequest(request: JsonRpcRequest, deps?: MemxMcpHandlerDeps): Promise<JsonRpcHandlerResult>;
//#endregion
export { MEMX_MCP_TOOLS, MemxMcpHandlerDeps, MemxMcpProxy, MemxMcpToolsProfile, defaultMemxProxy, handleMcpRequest };