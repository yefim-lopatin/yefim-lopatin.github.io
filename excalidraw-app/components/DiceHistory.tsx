import { useEffect, useState } from "react";

import { historyRequest } from "./diceHistoryApi";
import { getDieCharacter } from "./diceText";
import { getV5Result } from "./v5Dice";

import "./DiceHistory.scss";

import type { DiceHistoryEntry } from "./diceHistoryApi";

const checkOwnerKey = (key: string) =>
  fetch("/api/dice-history/owner", {
    method: "POST",
    headers: { "X-Owner-Key": key },
  });

export const DiceHistory = () => {
  const [rows, setRows] = useState<DiceHistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [key, setKey] = useState(
    () => sessionStorage.getItem("dice-history-owner-key") || "",
  );
  const [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await historyRequest();
        if (active) {
          setRows(data);
          setError("");
        }
      } catch {
        if (active) {
          setError("История временно недоступна");
        }
      }
      if (active) {
        timer = setTimeout(load, 3000);
      }
    };
    void load();
    const change = () => {
      setRows([]);
    };
    window.addEventListener("hashchange", change);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("hashchange", change);
    };
  }, []);
  useEffect(() => {
    const savedKey = sessionStorage.getItem("dice-history-owner-key");
    if (!savedKey) {
      return;
    }
    let active = true;
    setBusy(true);
    void checkOwnerKey(savedKey)
      .then((response) => {
        if (active) {
          setIsOwner(response.ok);
        }
      })
      .catch(() => {
        if (active) {
          setIsOwner(false);
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const authorize = async () => {
    setBusy(true);
    try {
      const response = await checkOwnerKey(key);
      if (!response.ok) {
        throw new Error();
      }
      sessionStorage.setItem("dice-history-owner-key", key);
      setIsOwner(true);
      setError("");
    } catch {
      setIsOwner(false);
      setError("Ключ ведущего не принят");
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (
      !window.confirm(
        "Очистить всю историю бросков этой комнаты? Кубики на доске останутся.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await historyRequest("DELETE", undefined, key);
      setRows([]);
      setError("");
    } catch {
      setError("Не удалось очистить историю");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dice-history" aria-label="Комментарии">
      <h2>Комментарии</h2>
      {isOwner ? (
        <button type="button" disabled={busy} onClick={clear}>
          Очистить историю
        </button>
      ) : (
        <details>
          <summary>Доступ ведущего</summary>
          <input
            type="password"
            aria-label="Ключ ведущего"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
          />
          <button type="button" disabled={busy || !key} onClick={authorize}>
            Войти
          </button>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {!rows.length && !error && <p>Здесь появятся результаты бросков.</p>}
      <ol>
        {rows.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.username}</strong>{" "}
              <time dateTime={new Date(row.time).toISOString()}>
                {new Date(row.time).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <div
              className="dice-history__dice"
              aria-label={`d${row.sides}: ${row.results.join(", ")}`}
            >
              {row.results.map((result, index) => (
                <span
                  key={index}
                  className="dice-history__glyph"
                  style={{
                    color:
                      index < row.hunger
                        ? "#b52025"
                        : "var(--color-on-surface)",
                  }}
                >
                  {getDieCharacter(
                    row.sides,
                    result,
                    row.difficulty !== undefined,
                    index < row.hunger,
                  )}
                </span>
              ))}
            </div>
            <p>
              {row.difficulty !== undefined
                ? getV5Result(row.results, row.hunger, row.difficulty)
                : `d${row.sides}: ${row.results.join(", ")}`}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
};
