import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
const dir = process.env.DATA_DIR || "./data";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const keyPath = join(dir, "owner-key");
if (!existsSync(keyPath))
  writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
const key = readFileSync(keyPath, "utf8").trim();
const authorized = (req) => {
  const value = String(req.headers["x-owner-key"] || "");
  const hash = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(value), hash(key));
};
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const send = (status, data) => {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  };
  if (req.url === "/api/dice-history/owner" && req.method === "POST")
    return send(authorized(req) ? 200 : 403, {});
  const room = req.headers["x-dice-room"];
  if (
    req.url !== "/api/dice-history" ||
    typeof room !== "string" ||
    !/^[a-f0-9]{64}$/.test(room)
  )
    return send(400, {});
  const path = join(dir, room + ".json");
  try {
    if (req.method === "GET")
      return send(
        200,
        existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [],
      );
    if (req.method === "DELETE") {
      if (!authorized(req)) return send(403, {});
      writeFileSync(path + ".tmp", "[]", { mode: 0o600 });
      renameSync(path + ".tmp", path);
      return send(200, []);
    }
    if (req.method !== "POST") return send(405, {});
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) return send(413, {});
    }
    const row = JSON.parse(body);
    if (
      typeof row.id !== "string" ||
      row.id.length > 100 ||
      typeof row.username !== "string" ||
      row.username.length > 100 ||
      ![2, 4, 6, 8, 10, 12, 20, 100].includes(row.sides) ||
      !Array.isArray(row.results) ||
      row.results.length < 1 ||
      row.results.length > 20 ||
      !row.results.every(
        (n) => Number.isInteger(n) && n >= 1 && n <= row.sides,
      ) ||
      !Number.isInteger(row.hunger) ||
      row.hunger < 0 ||
      row.hunger > Math.min(10, row.results.length) ||
      (row.hunger > 0 && row.sides !== 10) ||
      (row.difficulty !== undefined &&
        (row.sides !== 10 ||
          !Number.isInteger(row.difficulty) ||
          row.difficulty < 1 ||
          row.difficulty > 40))
    )
      return send(400, {});
    const rows = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
    if (!rows.some((r) => r.id === row.id)) {
      rows.push({
        id: row.id,
        username: row.username,
        sides: row.sides,
        results: row.results,
        hunger: row.hunger,
        difficulty: row.difficulty,
        time: Date.now(),
      });
      writeFileSync(path + ".tmp", JSON.stringify(rows), { mode: 0o600 });
      renameSync(path + ".tmp", path);
    }
    send(200, {});
  } catch {
    send(500, { error: "Не удалось сохранить историю" });
  }
}).listen(Number(process.env.PORT || 3003), "0.0.0.0");
