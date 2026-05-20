import { handleMcpRequest } from "./mcpProtocol.js";

type DecodedMessage = {
  payload: string;
  framed: boolean;
};

type ParseErrorMessage = {
  error: string;
  framed: boolean;
};

type ReadMessageResult = {
  message: DecodedMessage | ParseErrorMessage;
  remaining: Buffer;
};

export async function startMcpStdio(): Promise<void> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
    while (true) {
      const decoded = readMessage(buffer);
      if (!decoded) {
        break;
      }
      buffer = decoded.remaining;
      void handleMessage(decoded.message);
    }
  }
  const leftover = buffer.toString("utf8").trim();
  if (leftover) {
    void handleMessage({ payload: leftover, framed: false });
  }
}

function findHeaderEnd(buffer: Buffer): { index: number; length: number } | null {
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf >= 0) {
    return { index: crlf, length: 4 };
  }
  const lf = buffer.indexOf("\n\n");
  return lf >= 0 ? { index: lf, length: 2 } : null;
}

function readMessage(buffer: Buffer): ReadMessageResult | null {
  const preview = buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii").toLowerCase();
  if (preview.startsWith("content-length:")) {
    const headerEnd = findHeaderEnd(buffer);
    if (!headerEnd) {
      return null;
    }
    const headers = buffer.subarray(0, headerEnd.index).toString("ascii");
    const lengthHeader = headers
      .split(/\r?\n/u)
      .find((line) => line.toLowerCase().startsWith("content-length:"));
    const length = Number(lengthHeader?.slice("content-length:".length).trim());
    if (!Number.isInteger(length) || length < 0) {
      return {
        message: {
          error: "invalid Content-Length header",
          framed: true,
        },
        remaining: buffer.subarray(headerEnd.index + headerEnd.length),
      };
    }
    const bodyStart = headerEnd.index + headerEnd.length;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) {
      return null;
    }
    return {
      message: {
        payload: buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
        framed: true,
      },
      remaining: buffer.subarray(bodyEnd),
    };
  }

  const newline = buffer.indexOf("\n");
  if (newline < 0) {
    return null;
  }
  const payload = buffer.subarray(0, newline).toString("utf8").trim();
  return {
    message: { payload, framed: false },
    remaining: buffer.subarray(newline + 1),
  };
}

function writeResponse(response: Record<string, unknown>, framed: boolean): void {
  const json = JSON.stringify(response);
  if (framed) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
    return;
  }
  process.stdout.write(`${json}\n`);
}

async function handleMessage(message: DecodedMessage | ParseErrorMessage): Promise<void> {
  if ("error" in message) {
    writeResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: message.error },
      },
      message.framed,
    );
    return;
  }
  await handlePayload(message);
}

async function handlePayload(message: DecodedMessage): Promise<void> {
  if (!message.payload.trim()) {
    return;
  }
  try {
    const request = JSON.parse(message.payload) as Record<string, unknown>;
    const response = await handleMcpRequest(request);
    if (response) {
      writeResponse(response, message.framed);
    }
  } catch (error) {
    writeResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
      },
      message.framed,
    );
  }
}
