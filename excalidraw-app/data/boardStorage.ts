const endpoint = import.meta.env.VITE_APP_BOARD_STORAGE_URL;
export const usesBoardStorage = () => !!endpoint;

const tokens = new Map<string, Promise<string>>();
const headers = async (roomId: string, roomKey: string) => {
  const identity = `${roomId}:${roomKey}`;
  let token = tokens.get(identity);
  if (!token) {
    token = window.crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(identity))
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      );
    tokens.set(identity, token);
  }
  return { "x-board-token": await token };
};

export const readBoardData = async (
  roomId: string,
  roomKey: string,
  resource: string,
) => {
  const response = await fetch(`${endpoint}/${roomId}/${resource}`, {
    headers: await headers(roomId, roomKey),
    cache: "no-store",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Не удалось загрузить доску с сервера");
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    revision: response.headers.get("ETag")!,
  };
};

export const writeBoardData = async (
  roomId: string,
  roomKey: string,
  resource: string,
  bytes: Uint8Array<ArrayBuffer>,
  revision?: string,
) => {
  const response = await fetch(`${endpoint}/${roomId}/${resource}`, {
    method: "PUT",
    headers: {
      ...(await headers(roomId, roomKey)),
      "Content-Type": "application/octet-stream",
      ...(revision ? { "If-Match": revision } : {}),
    },
    body: bytes,
  });
  if (response.status === 412) {
    return false;
  }
  if (!response.ok) {
    throw new Error("Не удалось сохранить данные на сервере");
  }
  return true;
};
