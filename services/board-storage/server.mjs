import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

const root = process.env.DATA_DIR || "./data";
const origin =
  process.env.ALLOWED_ORIGIN || "https://excalidraw.159-69-159-241.sslip.io";
mkdirSync(root, { recursive: true, mode: 0o700 });
const revision = (bytes) =>
  `"${createHash("sha256").update(bytes).digest("hex")}"`;
function atomicWrite(path, bytes) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
}

createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const send = (status, message = "") => {
    res.writeHead(status);
    res.end(message);
  };
  if (req.url === "/health" && req.method === "GET") {
    return send(200, "ok");
  }
  if (req.headers.origin && req.headers.origin !== origin) {
    return send(403);
  }
  const match =
    /^\/api\/boards\/([a-f0-9]{20})\/(scene|files\/([a-zA-Z0-9_-]{1,100}))$/.exec(
      req.url || "",
    );
  const token = req.headers["x-board-token"];
  if (!match || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return send(400);
  }
  if (req.method !== "GET" && req.method !== "PUT") {
    return send(405);
  }
  // A hash of the room secret grants access, without giving the server the
  // encryption key. Different secrets cannot overwrite each other's boards.
  const directory = join(
    root,
    createHash("sha256").update(`${match[1]}:${token}`).digest("hex"),
  );
  const isScene = match[2] === "scene";
  const path = join(directory, isScene ? "scene" : `file-${match[3]}`);
  try {
    if (req.method === "GET") {
      if (!existsSync(path)) {
        return send(404);
      }
      const bytes = readFileSync(path);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("ETag", revision(bytes));
      res.setHeader("Content-Length", bytes.length);
      res.writeHead(200);
      return res.end(bytes);
    }
    if (isScene && !req.headers["if-match"]) {
      return send(428);
    }
    const limit = 256 * 1024 * 1024;
    if (Number(req.headers["content-length"]) > limit) {
      return send(413);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) {
        return send(413);
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length || (isScene && bytes.length < 29)) {
      return send(400);
    }
    // No await between checking the revision and atomic replacement: concurrent
    // writers must reconcile against the latest scene before retrying.
    const previous = existsSync(path) ? readFileSync(path) : null;
    if (
      isScene &&
      req.headers["if-match"] !== (previous ? revision(previous) : "missing")
    ) {
      return send(412);
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (isScene && previous) {
      atomicWrite(`${path}.previous`, previous);
    }
    atomicWrite(path, bytes);
    const fd = openSync(directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    res.setHeader("ETag", revision(bytes));
    return send(204);
  } catch (error) {
    console.error("Board storage failed:", error.code || error.message);
    if (!res.headersSent) {
      send(500, "Не удалось сохранить данные");
    } else {
      res.end();
    }
  }
}).listen(Number(process.env.PORT || 3004), "0.0.0.0");
