import type { DiceSides } from "./diceSvg";

export type DiceHistoryEntry = {
  id: string;
  username: string;
  sides: DiceSides;
  results: number[];
  hunger: number;
  difficulty?: number;
  time: number;
};

const roomId = async () => {
  let room = location.hash.startsWith("#room=") ? location.hash : "";
  if (!room) {
    room =
      localStorage.getItem("dice-history-local-room") || crypto.randomUUID();
    localStorage.setItem("dice-history-local-room", room);
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(room),
  );
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
};

export const historyRequest = async (
  method = "GET",
  entry?: Omit<DiceHistoryEntry, "time">,
  ownerKey = "",
) => {
  const response = await fetch("/api/dice-history", {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Dice-Room": await roomId(),
      "X-Owner-Key": ownerKey,
    },
    body: entry ? JSON.stringify(entry) : undefined,
  });
  if (!response.ok) {
    throw new Error("Не удалось загрузить или сохранить историю бросков");
  }
  return response.json();
};
