import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

import { io } from "socket.io-client";
import { generateKeyBetween } from "fractional-indexing";

export const SITE = "https://excalidraw.159-69-159-241.sslip.io";
const nonce = () => randomBytes(4).readUInt32BE() & 0x7fffffff;
const clone = (value) => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

// Same AES-128-GCM format as packages/excalidraw/data/encryption.ts.
export function encrypt(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-128-gcm",
    Buffer.from(key, "base64url"),
    iv,
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { data, iv };
}

export function decrypt(key, data, iv) {
  data = Buffer.from(data);
  const decipher = createDecipheriv(
    "aes-128-gcm",
    Buffer.from(key, "base64url"),
    Buffer.from(iv),
  );
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(0, -16)),
      decipher.final(),
    ]).toString(),
  );
}

function atomicWrite(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flush: true });
  renameSync(temporary, path);
}

function seal(key, value) {
  const { data, iv } = encrypt(key, value);
  return { data: data.toString("base64"), iv: iv.toString("base64") };
}

function unseal(key, value) {
  return decrypt(
    key,
    Buffer.from(value.data, "base64"),
    Buffer.from(value.iv, "base64"),
  );
}

function merge(local, remote) {
  const elements = new Map(local.map((element) => [element.id, element]));
  for (const incoming of remote) {
    assert(
      typeof incoming.id === "string" &&
        Number.isInteger(incoming.version) &&
        Number.isInteger(incoming.versionNonce),
      "Invalid element in room message",
    );
    const current = elements.get(incoming.id);
    if (
      !current ||
      incoming.version > current.version ||
      (incoming.version === current.version &&
        incoming.versionNonce < current.versionNonce)
    ) {
      elements.set(incoming.id, incoming);
    }
  }
  return [...elements.values()].sort((a, b) => {
    const left = a.index || "";
    const right = b.index || "";
    return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
  });
}

function newElement(spec, index) {
  const element = {
    id: spec.id || randomUUID(),
    type: spec.type,
    x: spec.x,
    y: spec.y,
    width: spec.width ?? 160,
    height: spec.height ?? 80,
    angle: 0,
    strokeColor: spec.strokeColor || "#1e1e1e",
    backgroundColor: spec.backgroundColor || "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: spec.opacity ?? 100,
    groupIds: [],
    frameId: null,
    index,
    roundness: null,
    seed: nonce(),
    version: 1,
    versionNonce: nonce(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: spec.locked ?? false,
  };
  if (spec.type === "text") {
    Object.assign(element, {
      text: spec.text || "",
      originalText: spec.text || "",
      fontSize: spec.fontSize || 20,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    });
    measureText(element);
  }
  if (spec.type === "arrow" || spec.type === "line") {
    Object.assign(element, {
      points: [
        [0, 0],
        [element.width, element.height],
      ],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: spec.type === "arrow" ? "arrow" : null,
      ...(spec.type === "arrow" ? { elbowed: false } : { polygon: false }),
    });
  }
  return element;
}

function measureText(element) {
  // Browser recalculates exact font metrics. Keep a useful headless approximation.
  const lines = element.text.split("\n");
  element.width = Math.max(
    1,
    ...lines.map((line) => [...line].length * element.fontSize * 0.65),
  );
  element.height = Math.max(
    1,
    lines.length * element.fontSize * element.lineHeight,
  );
}

export class Boards {
  constructor(directory, socketURL = SITE) {
    this.directory = directory;
    this.socketURL = socketURL;
    this.boards = new Map();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.registryPath = join(directory, "boards.json");
    const records = existsSync(this.registryPath)
      ? JSON.parse(readFileSync(this.registryPath))
      : [];
    for (const record of records) {
      this.start(record);
    }
  }

  saveRegistry() {
    atomicWrite(
      this.registryPath,
      [...this.boards.values()].map(({ id, key, name }) => ({ id, key, name })),
    );
  }

  statePath(board) {
    return join(this.directory, `${board.id}.json`);
  }
  snapshotDirectory(board) {
    return join(this.directory, `${board.id}-snapshots`);
  }
  state(board) {
    return { elements: board.elements, initialized: board.initialized };
  }
  persist(board, state = this.state(board)) {
    atomicWrite(this.statePath(board), seal(board.key, state));
  }
  revision(board) {
    return createHash("sha256")
      .update(JSON.stringify(board.elements))
      .digest("hex");
  }

  summary(board) {
    return {
      boardId: board.id,
      name: board.name,
      connected: board.socket.connected && board.joined,
      initialized: board.initialized,
      revision: this.revision(board),
      elementCount: board.elements.filter((element) => !element.isDeleted)
        .length,
      lastError: board.lastError,
    };
  }

  get(id) {
    const board = this.boards.get(id);
    assert(board, "Unknown board. Call connect_board or create_board first.");
    return board;
  }

  start(record, initialState) {
    const board = {
      ...record,
      elements: [],
      initialized: false,
      joined: false,
      lastError: null,
    };
    if (existsSync(this.statePath(board))) {
      Object.assign(
        board,
        unseal(board.key, JSON.parse(readFileSync(this.statePath(board)))),
      );
    } else if (initialState) {
      Object.assign(board, initialState);
      this.persist(board);
    }
    const socket = io(this.socketURL, {
      autoConnect: false,
      transports: ["websocket", "polling"],
    });
    board.socket = socket;
    this.boards.set(board.id, board);
    socket.on("init-room", () => socket.emit("join-room", board.id));
    socket.on("disconnect", () => {
      board.joined = false;
    });
    socket.on("connect_error", () => {
      board.lastError = "Collaboration server unavailable";
    });
    socket.on("room-user-change", () => {
      board.joined = true;
      board.lastError = null;
      if (board.initialized) {
        this.broadcast(board, "SCENE_UPDATE");
      }
    });
    socket.on("new-user", () => {
      if (board.initialized) {
        this.broadcast(board, "SCENE_INIT");
      }
    });
    socket.on("client-broadcast", (data, iv) => {
      try {
        const message = decrypt(board.key, data, iv);
        if (message.type !== "SCENE_INIT" && message.type !== "SCENE_UPDATE") {
          return;
        }
        assert(Array.isArray(message.payload?.elements), "Invalid room scene");
        const elements = merge(board.elements, message.payload.elements);
        this.persist(board, {
          elements,
          initialized: board.initialized || message.type === "SCENE_INIT",
        });
        board.elements = elements;
        board.initialized = board.initialized || message.type === "SCENE_INIT";
        board.lastError = null;
      } catch {
        board.lastError =
          "Cannot decrypt, validate or save room update; writes are blocked";
        console.error(`Room update rejected for ${board.id}`);
      }
    });
    socket.connect();
    return board;
  }

  broadcast(board, type) {
    if (!board.socket.connected || !board.joined || !board.initialized) {
      return;
    }
    const { data, iv } = encrypt(board.key, {
      type,
      payload: { elements: board.elements },
    });
    board.socket.emit("server-broadcast", board.id, data, iv);
  }

  async wait(board) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (board.socket.connected && board.joined && board.initialized) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.summary(board);
  }

  async connect(url, name) {
    const parsed = new URL(url);
    assert(
      parsed.origin === SITE,
      "Only the friend's Excalidraw server is allowed",
    );
    const match = parsed.hash.match(
      /^#room=([a-f0-9]{20}),([A-Za-z0-9_-]{22})$/,
    );
    assert(
      match && Buffer.from(match[2], "base64url").length === 16,
      "Expected a collaboration link with room ID and key",
    );
    const [, id, key] = match;
    let board = this.boards.get(id);
    if (board) {
      assert(board.key === key, "Room key does not match the registered board");
    } else {
      board = this.start({ id, key, name });
      this.saveRegistry();
    }
    return this.wait(board);
  }

  async create(name) {
    const id = randomBytes(10).toString("hex");
    const key = randomBytes(16).toString("base64url");
    const board = this.start(
      { id, key, name },
      { initialized: true, elements: [] },
    );
    this.saveRegistry();
    return { ...(await this.wait(board)), url: `${SITE}/#room=${id},${key}` };
  }

  read(id, offset, limit, includeDeleted) {
    const board = this.get(id);
    assert(
      board.initialized,
      "Scene not received yet. Open one existing participant once to send the initial scene.",
    );
    const elements = board.elements.filter(
      (element) => includeDeleted || !element.isDeleted,
    );
    return {
      ...this.summary(board),
      total: elements.length,
      offset,
      elements: clone(elements.slice(offset, offset + limit)),
    };
  }

  checkpoint(board) {
    const directory = this.snapshotDirectory(board);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}-${randomUUID()}`;
    atomicWrite(
      join(directory, `${id}.json`),
      seal(board.key, this.state(board)),
    );
    return id;
  }

  checkWrite(board, expectedRevision) {
    assert(
      board.socket.connected && board.joined,
      "Board is disconnected; changes have not been applied",
    );
    assert(
      board.initialized,
      "Scene not received yet; refusing to overwrite an unknown board",
    );
    assert(!board.lastError, board.lastError);
    assert(
      this.revision(board) === expectedRevision,
      "Board changed. Read it again before editing.",
    );
  }

  commit(board, elements) {
    const snapshotId = this.checkpoint(board);
    this.persist(board, { elements, initialized: true });
    board.elements = elements;
    this.broadcast(board, "SCENE_UPDATE");
    return {
      ...this.summary(board),
      snapshotId,
      delivery:
        "Saved and broadcast; relay does not acknowledge individual recipients",
    };
  }

  edit(id, expectedRevision, operations) {
    const board = this.get(id);
    this.checkWrite(board, expectedRevision);
    const elements = clone(board.elements);
    const changedIds = [];
    const byId = new Map(elements.map((element) => [element.id, element]));
    let lastIndex = elements.reduce(
      (last, element) =>
        element.index && element.index > (last || "") ? element.index : last,
      null,
    );
    for (const operation of operations) {
      if (operation.action === "add") {
        lastIndex = generateKeyBetween(lastIndex, null);
        const element = newElement(operation.element, lastIndex);
        assert(!byId.has(element.id), "Duplicate element ID");
        elements.push(element);
        byId.set(element.id, element);
        changedIds.push(element.id);
        continue;
      }
      const element = byId.get(operation.id);
      assert(
        element && !element.isDeleted,
        "Element not found or already deleted",
      );
      if (operation.action === "delete") {
        assert(
          !element.boundElements?.length &&
            !element.containerId &&
            !element.startBinding &&
            !element.endBinding &&
            element.type !== "frame",
          "Deletion of linked elements and frames is not supported; this tool does not repair bindings",
        );
        element.isDeleted = true;
      } else {
        const patch = operation.changes;
        assert(
          !(
            element.boundElements?.length ||
            element.containerId ||
            element.startBinding ||
            element.endBinding ||
            element.type === "frame"
          ) ||
            !["x", "y", "width", "height", "text", "fontSize"].some((key) =>
              Object.hasOwn(patch, key),
            ),
          "Geometry of linked elements requires updating bindings; edit unbound elements instead",
        );
        assert(
          !Object.hasOwn(patch, "text") || element.type === "text",
          "Only text elements have editable text",
        );
        assert(
          !Object.hasOwn(patch, "fontSize") || element.type === "text",
          "Only text elements have font size",
        );
        if (
          (element.type === "line" || element.type === "arrow") &&
          (Object.hasOwn(patch, "width") || Object.hasOwn(patch, "height"))
        ) {
          assert(
            element.points.length === 2,
            "Resize of multi-point lines is not supported",
          );
          element.points = [
            [0, 0],
            [patch.width ?? element.width, patch.height ?? element.height],
          ];
        }
        Object.assign(element, patch);
        if (
          element.type === "text" &&
          (Object.hasOwn(patch, "text") || Object.hasOwn(patch, "fontSize"))
        ) {
          assert(
            element.autoResize && !element.containerId,
            "Resizing wrapped or bound text is not supported",
          );
          element.originalText = element.text;
          measureText(element);
        }
      }
      element.version += 1;
      element.versionNonce = nonce();
      element.updated = Date.now();
      changedIds.push(element.id);
    }
    return { ...this.commit(board, elements), changedIds };
  }

  snapshots(id) {
    const directory = this.snapshotDirectory(this.get(id));
    return existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => name.endsWith(".json"))
          .sort()
          .reverse()
          .map((name) => name.slice(0, -5))
      : [];
  }

  restore(id, expectedRevision, snapshotId) {
    const board = this.get(id);
    this.checkWrite(board, expectedRevision);
    assert(this.snapshots(id).includes(snapshotId), "Snapshot not found");
    const saved = unseal(
      board.key,
      JSON.parse(
        readFileSync(join(this.snapshotDirectory(board), `${snapshotId}.json`)),
      ),
    );
    const current = new Map(
      board.elements.map((element) => [element.id, element]),
    );
    const restored = new Map(
      saved.elements.map((element) => [element.id, element]),
    );
    // Restoration is a new edit: monotonically advance versions, including tombstones.
    const elements = [...new Set([...current.keys(), ...restored.keys()])].map(
      (id) => {
        const previous = restored.get(id);
        const latest = current.get(id);
        return {
          ...(previous || latest),
          isDeleted: previous ? previous.isDeleted : true,
          version: Math.max(previous?.version || 0, latest?.version || 0) + 1,
          versionNonce: nonce(),
          updated: Date.now(),
        };
      },
    );
    return this.commit(board, merge([], elements));
  }

  close() {
    for (const board of this.boards.values()) {
      board.socket.close();
    }
  }
}
