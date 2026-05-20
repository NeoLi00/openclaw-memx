import { handleMcpRequest } from "./mcpProtocol.js";

export async function startMcpStdio(): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        void handleLine(line);
      }
      newline = buffer.indexOf("\n");
    }
  }
}

async function handleLine(line: string): Promise<void> {
  try {
    const request = JSON.parse(line) as Record<string, unknown>;
    const response = await handleMcpRequest(request);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
      })}\n`,
    );
  }
}
