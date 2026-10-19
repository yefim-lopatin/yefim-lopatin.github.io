// SSH runs this process inside the service container. No public MCP port or token.
import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = Promise.resolve();
input.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  pending = pending.then(async () => {
    let message;
    try {
      message = JSON.parse(line);
      const response = await fetch("http://127.0.0.1:3003/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: line,
        signal: AbortSignal.timeout(60000),
      });
      if (response.status === 202) {
        return;
      }
      const result = await response.json();
      if (!response.ok && !result.jsonrpc) {
        throw new Error("MCP request failed");
      }
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      if (message && Object.hasOwn(message, "id")) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32603,
              message: "Excalidraw MCP service unavailable",
            },
          })}\n`,
        );
      } else {
        console.error("Invalid MCP notification or unavailable service");
      }
    }
  });
});
input.on("close", () => pending.then(() => process.exit(0)));
