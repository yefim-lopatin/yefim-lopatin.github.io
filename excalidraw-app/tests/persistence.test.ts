import { vi } from "vitest";
import { newImageElement } from "@excalidraw/element";

import type { AppState } from "@excalidraw/excalidraw/types";

import {
  isSavedToFirebase,
  loadFilesFromFirebase,
  saveFilesToFirebase,
  loadFromFirebase,
  saveToFirebase,
} from "../data/firebase";

import { FileManager, encodeFilesForUpload } from "../data/FileManager";

import type { Socket } from "socket.io-client";

import type { SyncableExcalidrawElement } from "../data";
import type Portal from "../collab/Portal";

const storage = vi.hoisted(() => ({
  document: undefined as any,
  objects: new Map<string, ArrayBuffer>(),
  failUpload: false,
  sequence: 0,
  friend: true,
  boardData: new Map<
    string,
    { bytes: Uint8Array<ArrayBuffer>; revision: string }
  >(),
  conflict: false,
  failRead: false,
}));

vi.mock("../data/boardStorage", () => ({
  usesBoardStorage: () => storage.friend,
  readBoardData: async (_id: string, _key: string, resource: string) => {
    if (storage.failRead) {
      throw new Error("offline");
    }
    return storage.boardData.get(resource) || null;
  },
  writeBoardData: async (
    _id: string,
    _key: string,
    resource: string,
    bytes: Uint8Array<ArrayBuffer>,
    revision?: string,
  ) => {
    if (storage.failUpload) {
      throw new Error("offline");
    }
    if (storage.conflict && resource === "scene") {
      storage.conflict = false;
      return false;
    }
    const current = storage.boardData.get(resource);
    if (revision && revision !== (current?.revision || "missing")) {
      return false;
    }
    storage.boardData.set(resource, {
      bytes: bytes.slice(),
      revision: String(++storage.sequence),
    });
    return true;
  },
}));

vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/firestore", () => ({
  getFirestore: () => ({}),
  doc: () => ({}),
  Bytes: {
    fromUint8Array: (bytes: Uint8Array) => ({ toUint8Array: () => bytes }),
  },
  getDoc: async () => ({
    exists: () => !!storage.document,
    data: () => storage.document,
  }),
  runTransaction: async (_db: unknown, callback: any) => {
    let pending: any;
    const result = await callback({
      get: async () => ({
        exists: () => !!storage.document,
        data: () => storage.document,
      }),
      set: (_ref: unknown, value: any) => {
        pending = value;
      },
    });
    storage.document = pending;
    return result;
  },
}));
vi.mock("firebase/storage", () => ({
  getStorage: () => ({}),
  ref: (_storage: unknown, path: string) => path,
  uploadBytes: async (
    path: string,
    bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
  ) => {
    if (storage.failUpload) {
      throw new Error("offline");
    }
    storage.objects.set(
      path,
      bytes instanceof Uint8Array ? bytes.slice().buffer : bytes,
    );
  },
  getDownloadURL: async (path: string) => path,
}));
vi.mock("@excalidraw/excalidraw/data/encryption", () => ({
  encryptData: async (_key: string, bytes: Uint8Array) => ({
    encryptedBuffer: bytes.slice().buffer,
    iv: new Uint8Array(12),
  }),
  decryptData: async (_iv: unknown, bytes: Uint8Array) => bytes.buffer,
}));

const scene = (size: number, version = 1) =>
  [
    {
      id: "large-text",
      type: "text",
      text: "я".repeat(size),
      version,
      versionNonce: version,
      updated: version,
      isDeleted: false,
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      index: "a0",
    },
  ] as unknown as SyncableExcalidrawElement[];
const appState = {} as AppState;
let portal: Portal;

beforeEach(() => {
  storage.document = undefined;
  storage.friend = true;
  storage.boardData.clear();
  storage.conflict = false;
  storage.failRead = false;
  storage.objects.clear();
  storage.failUpload = false;
  portal = {
    roomId: "0123456789abcdef0123",
    roomKey: "test-key",
    socket: {} as Socket,
  } as Portal;
  vi.stubGlobal("fetch", async (path: string) => {
    const objectPath = path.startsWith("https://")
      ? decodeURIComponent(new URL(path).pathname.split("/o/")[1])
      : path;
    const bytes = storage.objects.get(objectPath);
    return {
      ok: !!bytes,
      status: bytes ? 200 : 404,
      arrayBuffer: async () => bytes,
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps small and existing scenes readable without file storage", async () => {
  storage.friend = false;
  await saveToFirebase(portal, scene(10), appState);
  expect(storage.document.ciphertext).toBeDefined();
  expect(storage.objects.size).toBe(0);
  const loaded = await loadFromFirebase(
    "0123456789abcdef0123",
    "test-key",
    null,
  );
  expect((loaded![0] as any).text).toBe("я".repeat(10));
});

it("saves and reloads a scene exceeding the database document limit", async () => {
  await saveToFirebase(portal, scene(800_000), appState);
  expect(storage.document).toBeUndefined();
  expect(storage.boardData.get("scene")!.bytes.length).toBeGreaterThan(
    1_000_000,
  );
  const loaded = await loadFromFirebase(
    "0123456789abcdef0123",
    "test-key",
    null,
  );
  expect((loaded![0] as any).text).toBe("я".repeat(800_000));
  expect(isSavedToFirebase(portal, scene(800_000))).toBe(true);
});

it("keeps the previous save intact on upload failure and retries successfully", async () => {
  await saveToFirebase(portal, scene(10), appState);
  const previous = storage.boardData.get("scene");
  storage.failUpload = true;
  await expect(
    saveToFirebase(portal, scene(800_000, 2), appState),
  ).rejects.toThrow("offline");
  expect(storage.boardData.get("scene")).toBe(previous);
  expect(isSavedToFirebase(portal, scene(800_000, 2))).toBe(false);
  storage.failUpload = false;
  await saveToFirebase(portal, scene(800_000, 2), appState);
  expect(isSavedToFirebase(portal, scene(800_000, 2))).toBe(true);
});

it("can save a smaller scene after a large scene", async () => {
  await saveToFirebase(portal, scene(800_000), appState);
  await saveToFirebase(portal, scene(10, 2), appState);
  expect(storage.boardData.get("scene")!.bytes.length).toBeLessThan(1000);
  const loaded = await loadFromFirebase(
    "0123456789abcdef0123",
    "test-key",
    null,
  );
  expect((loaded![0] as any).text).toBe("я".repeat(10));
});

it("saves and reloads image data larger than the previous 4 MiB limit", async () => {
  const id = "large-image" as import("@excalidraw/element/types").FileId;
  const dataURL = `data:image/png;base64,${"A".repeat(
    5 * 1024 * 1024,
  )}` as import("@excalidraw/excalidraw/types").DataURL;
  const files = new Map([
    [id, { id, dataURL, mimeType: "image/png" as const, created: 1 }],
  ]);
  const encoded = await encodeFilesForUpload({
    files,
    encryptionKey: "test-key",
    maxBytes: Infinity,
  });
  const saved = await saveFilesToFirebase({
    prefix: "files/rooms/0123456789abcdef0123",
    files: encoded,
    roomKey: "test-key",
  });
  expect(saved.erroredFiles).toEqual([]);
  const loaded = await loadFilesFromFirebase(
    "files/rooms/0123456789abcdef0123",
    "test-key",
    [id],
  );
  expect(loaded.erroredFiles.size).toBe(0);
  expect(loaded.loadedFiles[0].dataURL).toBe(dataURL);
});

it("imports an existing Firebase board without changing its old copy", async () => {
  storage.friend = false;
  await saveToFirebase(portal, scene(20), appState);
  const legacy = storage.document;
  storage.friend = true;
  const loaded = await loadFromFirebase(
    "0123456789abcdef0123",
    "test-key",
    null,
  );
  expect((loaded![0] as any).text).toBe("я".repeat(20));
  expect(storage.boardData.has("scene")).toBe(true);
  expect(storage.document).toBe(legacy);
});

it("retries a conflicting save and preserves elements from the old board", async () => {
  storage.friend = false;
  await saveToFirebase(portal, scene(20), appState);
  storage.friend = true;
  storage.conflict = true;
  const other = [
    { ...scene(10, 2)[0], id: "new-element", index: "a1" },
  ] as SyncableExcalidrawElement[];
  await saveToFirebase(portal, other, appState);
  const loaded = await loadFromFirebase(
    "0123456789abcdef0123",
    "test-key",
    null,
  );
  expect(loaded!.map((element) => element.id)).toEqual([
    "large-text",
    "new-element",
  ]);
});

it("never falls back to a stale board when the friend server is unavailable", async () => {
  storage.failRead = true;
  await expect(
    loadFromFirebase("0123456789abcdef0123", "test-key", null),
  ).rejects.toThrow("offline");
  expect(storage.boardData.size).toBe(0);
});

it("copies legacy images to the friend server and retains the Firebase copy", async () => {
  const id = "legacy-image" as import("@excalidraw/element/types").FileId;
  const dataURL =
    "data:image/png;base64,AAAA" as import("@excalidraw/excalidraw/types").DataURL;
  const files = new Map([
    [id, { id, dataURL, mimeType: "image/png" as const, created: 1 }],
  ]);
  const encoded = await encodeFilesForUpload({
    files,
    encryptionKey: "test-key",
    maxBytes: Infinity,
  });
  storage.objects.set(
    `files/rooms/0123456789abcdef0123/${id}`,
    new Uint8Array(encoded[0].buffer).buffer,
  );
  const loaded = await loadFilesFromFirebase(
    "files/rooms/0123456789abcdef0123",
    "test-key",
    [id],
  );
  expect(loaded.loadedFiles[0].dataURL).toBe(dataURL);
  expect(storage.boardData.has(`files/${id}`)).toBe(true);
  expect(storage.objects.size).toBe(1);
});

it("warns before closing after an image upload failure until its retry succeeds", async () => {
  const id = "retry-image" as import("@excalidraw/element/types").FileId;
  const file = {
    id,
    dataURL:
      "data:image/png;base64,AAAA" as import("@excalidraw/excalidraw/types").DataURL,
    mimeType: "image/png" as const,
    created: 1,
  };
  let fail = true;
  const manager = new FileManager({
    getFiles: async () => ({ loadedFiles: [], erroredFiles: new Map() }),
    saveFiles: async ({ addedFiles }) => ({
      savedFiles: fail ? new Map() : addedFiles,
      erroredFiles: fail ? addedFiles : new Map(),
    }),
  });
  const elements = [
    newImageElement({
      type: "image",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fileId: id,
      status: "pending",
    }),
  ];
  await manager.saveFiles({ elements, files: { [id]: file } });
  expect(manager.shouldPreventUnload(elements)).toBe(true);
  fail = false;
  await manager.saveFiles({ elements, files: { [id]: file } });
  expect(manager.shouldPreventUnload(elements)).toBe(false);
  expect(manager.isFileSavedOrBeingSaved(file)).toBe(true);
});
