import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import {
  MIME_TYPES,
  randomId,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { newImageElement } from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";
import { getDataURL_sync } from "@excalidraw/excalidraw/data/blob";

import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import "./DiceRoller.scss";

export const DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;

export type DiceSides = typeof DICE_SIDES[number];

const MAX_DICE_COUNT = 20;
const DRAG_THRESHOLD = 6;
const ROLL_ANIMATION_DURATION = 650;
const DICE_SIZE = 64;
const DICE_GAP = 12;
const DICE_COLUMNS = 5;
const DICE_COUNT_PRESETS = [1, 2, 3, 4, 5, 10] as const;

export const rollDie = (sides: number): number => {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error("Количество граней должно быть целым числом не меньше 2");
  }

  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    const random = new Uint32Array(1);
    const range = 0x100000000;
    const limit = range - (range % sides);

    do {
      cryptoObject.getRandomValues(random);
    } while (random[0] >= limit);

    return (random[0] % sides) + 1;
  }

  return Math.floor(Math.random() * sides) + 1;
};

type DiceRollerProps = {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
};

type LastRoll = {
  sides: DiceSides;
  count: number;
  results: number[];
};

type DragState = {
  sides: DiceSides;
  count: number;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  hasMoved: boolean;
};

type RollAnimation = {
  sides: DiceSides;
  count: number;
  results: number[];
  clientX: number;
  clientY: number;
};

const createInitialDiceCounts = (): Record<DiceSides, number> => ({
  2: 1,
  4: 1,
  6: 1,
  8: 1,
  10: 1,
  12: 1,
  20: 1,
  100: 1,
});

export const formatDiceRoll = (
  sides: DiceSides,
  results: readonly number[],
) => {
  if (results.length === 1) {
    return `d${sides}: ${results[0]}`;
  }
  return `d${sides} × ${results.length}: ${results.join(" · ")}`;
};

const createDieSvg = (
  sides: DiceSides,
  result: number,
  accentColor: string,
  isDarkTheme: boolean,
) => {
  const backgroundColor = isDarkTheme ? "#2f2f2f" : "#ffffff";
  const textColor = isDarkTheme ? "#f5f5f5" : "#1f2937";
  const resultFontSize = result >= 100 ? 16 : result >= 10 ? 20 : 24;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DICE_SIZE}" height="${DICE_SIZE}" viewBox="0 0 ${DICE_SIZE} ${DICE_SIZE}">
    <rect x="3" y="3" width="58" height="58" rx="15" fill="${backgroundColor}" stroke="${accentColor}" stroke-width="3"/>
    <text x="32" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-size="${resultFontSize}" font-weight="700" fill="${textColor}">${result}</text>
    <text x="32" y="53" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="600" fill="${accentColor}">d${sides}</text>
  </svg>`;
};

export const DiceRoller = ({ excalidrawAPI }: DiceRollerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredSides, setHoveredSides] = useState<DiceSides | null>(null);
  const [diceCounts, setDiceCounts] = useState(createInitialDiceCounts);
  const [lastRoll, setLastRoll] = useState<LastRoll | null>(null);
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(
    null,
  );
  const dragStateRef = useRef<DragState | null>(null);
  const rollTimerRef = useRef<number | null>(null);

  const addRollToCanvas = useCallback(
    (roll: RollAnimation) => {
      if (!excalidrawAPI) {
        return;
      }

      const appState = excalidrawAPI.getAppState();
      const sceneElements = excalidrawAPI.getSceneElements();
      const scenePoint = viewportCoordsToSceneCoords(
        {
          clientX: roll.clientX,
          clientY: roll.clientY,
        },
        appState,
      );
      const columns = Math.min(roll.results.length, DICE_COLUMNS);
      const rows = Math.ceil(roll.results.length / columns);
      const boardWidth = columns * DICE_SIZE + (columns - 1) * DICE_GAP;
      const boardHeight = rows * DICE_SIZE + (rows - 1) * DICE_GAP;
      const files: BinaryFileData[] = [];
      const resultElements = roll.results.map((result, index) => {
        const fileId = randomId() as FileId;
        const fileData: BinaryFileData = {
          id: fileId,
          dataURL: getDataURL_sync(
            createDieSvg(
              roll.sides,
              result,
              appState.currentItemStrokeColor,
              appState.theme === "dark",
            ),
            MIME_TYPES.svg,
          ),
          mimeType: MIME_TYPES.svg,
          created: Date.now(),
        };
        files.push(fileData);

        const column = index % columns;
        const row = Math.floor(index / columns);
        return newImageElement({
          type: "image",
          x: scenePoint.x - boardWidth / 2 + column * (DICE_SIZE + DICE_GAP),
          y: scenePoint.y - boardHeight / 2 + row * (DICE_SIZE + DICE_GAP),
          width: DICE_SIZE,
          height: DICE_SIZE,
          fileId,
          status: "saved",
          customData: {
            diceRoll: {
              sides: roll.sides,
              count: roll.count,
              result,
              index,
            },
          },
        });
      });

      excalidrawAPI.addFiles(files);

      // updateScene triggers App.onChange, which broadcasts the result to all
      // collaborators through the existing collaboration channel.
      excalidrawAPI.updateScene({
        elements: [...sceneElements, ...resultElements],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [excalidrawAPI],
  );

  const startRollAtPoint = useCallback(
    (sides: DiceSides, count: number, clientX: number, clientY: number) => {
      const results = Array.from({ length: count }, () => rollDie(sides));
      const roll = {
        sides,
        count,
        results,
        clientX,
        clientY,
      };

      if (rollTimerRef.current !== null) {
        window.clearTimeout(rollTimerRef.current);
      }
      setRollAnimation(roll);
      rollTimerRef.current = window.setTimeout(() => {
        setLastRoll(roll);
        addRollToCanvas(roll);
        setRollAnimation(null);
        rollTimerRef.current = null;
      }, ROLL_ANIMATION_DURATION);
    },
    [addRollToCanvas],
  );

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const hasMoved =
        dragState.hasMoved ||
        Math.hypot(
          event.clientX - dragState.startX,
          event.clientY - dragState.startY,
        ) >= DRAG_THRESHOLD;
      const nextDragState = {
        ...dragState,
        clientX: event.clientX,
        clientY: event.clientY,
        hasMoved,
      };
      dragStateRef.current = nextDragState;
      setDragPreview(nextDragState);
    };

    const finishDrag = (event: globalThis.PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      dragStateRef.current = null;
      setDragPreview(null);
      setHoveredSides(null);
      if (dragState.hasMoved) {
        startRollAtPoint(
          dragState.sides,
          dragState.count,
          event.clientX,
          event.clientY,
        );
      }
    };

    const cancelDrag = () => {
      dragStateRef.current = null;
      setDragPreview(null);
      setHoveredSides(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [startRollAtPoint]);

  useEffect(() => {
    return () => {
      if (rollTimerRef.current !== null) {
        window.clearTimeout(rollTimerRef.current);
      }
    };
  }, []);

  const handleDiePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    sides: DiceSides,
  ) => {
    if (event.button !== 0 || rollAnimation) {
      return;
    }

    const nextDragState = {
      sides,
      count: diceCounts[sides],
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      hasMoved: false,
    };
    dragStateRef.current = nextDragState;
    setDragPreview(nextDragState);
  };

  const updateDiceCount = (sides: DiceSides, delta: number) => {
    setDiceCounts((current) => ({
      ...current,
      [sides]: Math.min(MAX_DICE_COUNT, Math.max(1, current[sides] + delta)),
    }));
  };

  return (
    <div className="dice-roller" data-testid="dice-roller">
      <IconButton
        type="button"
        icon={<span className="material-icons">casino</span>}
        aria-label="Открыть кубики НРИ"
        title="Кубики НРИ"
        data-testid="dice-roller-toggle"
        className="dice-roller__toggle"
        onClick={() => setIsOpen((isOpen) => !isOpen)}
      />

      {isOpen && (
        <div
          className="dice-roller__menu"
          role="dialog"
          aria-label="Кубики НРИ"
        >
          <div className="dice-roller__header">
            <span className="dice-roller__title">Кубики НРИ</span>
            <button
              className="dice-roller__close"
              type="button"
              aria-label="Закрыть кубики НРИ"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="dice-roller__grid">
            {DICE_SIDES.map((sides) => {
              const count = diceCounts[sides];
              const isHovered = hoveredSides === sides;
              return (
                <div
                  className="dice-roller__die-wrapper"
                  key={sides}
                  onPointerEnter={() => setHoveredSides(sides)}
                  onPointerLeave={() => setHoveredSides(null)}
                >
                  <button
                    className="dice-roller__die"
                    type="button"
                    aria-label={`Перетащить ${count} кубик(а) d${sides} на холст`}
                    aria-grabbed={dragPreview?.sides === sides}
                    onFocus={() => setHoveredSides(sides)}
                    onPointerDown={(event) =>
                      handleDiePointerDown(event, sides)
                    }
                  >
                    <span>d{sides}</span>
                    {count > 1 && <small>×{count}</small>}
                  </button>

                  {isHovered && !dragPreview && (
                    <div
                      className="dice-roller__quantity"
                      onPointerEnter={() => setHoveredSides(sides)}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <span>Количество</span>
                      <div className="dice-roller__quantity-controls">
                        <button
                          type="button"
                          aria-label={`Уменьшить количество d${sides}`}
                          onClick={() => updateDiceCount(sides, -1)}
                        >
                          −
                        </button>
                        <strong>{count}</strong>
                        <button
                          type="button"
                          aria-label={`Увеличить количество d${sides}`}
                          onClick={() => updateDiceCount(sides, 1)}
                        >
                          +
                        </button>
                      </div>
                      <div className="dice-roller__quantity-presets">
                        {DICE_COUNT_PRESETS.map((preset) => (
                          <button
                            className={preset === count ? "is-selected" : ""}
                            key={preset}
                            type="button"
                            aria-label={`Выбрать ${preset} кубик(а) d${sides}`}
                            aria-pressed={preset === count}
                            onClick={() =>
                              setDiceCounts((current) => ({
                                ...current,
                                [sides]: preset,
                              }))
                            }
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <small>Потяните кубик на холст</small>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="dice-roller__result" aria-live="polite">
            {lastRoll ? (
              <div className="dice-roller__last-roll">
                <span className="dice-roller__last-roll-label">
                  d{lastRoll.sides} · {lastRoll.count} шт.
                </span>
                <div className="dice-roller__last-roll-values">
                  {lastRoll.results.map((result, index) => (
                    <span key={`${result}-${index}`}>{result}</span>
                  ))}
                </div>
              </div>
            ) : (
              "Наведите на кубик и задайте количество"
            )}
          </div>
        </div>
      )}

      {dragPreview && (
        <div
          className="dice-roller__drag-preview"
          style={{ left: dragPreview.clientX, top: dragPreview.clientY }}
          aria-hidden="true"
        >
          <span className="material-icons">casino</span>
          <span>
            d{dragPreview.sides} × {dragPreview.count}
          </span>
        </div>
      )}

      {rollAnimation && (
        <div
          className="dice-roller__roll-animation"
          style={{ left: rollAnimation.clientX, top: rollAnimation.clientY }}
          aria-live="polite"
          aria-label="Кубики бросаются"
        >
          <div className="dice-roller__rolling-dice">
            {rollAnimation.results.map((_, index) => (
              <span
                className="dice-roller__rolling-die"
                key={index}
                style={{ animationDelay: `${Math.min(index * 35, 180)}ms` }}
              >
                <span className="material-icons">casino</span>
              </span>
            ))}
          </div>
          <span className="dice-roller__rolling-label">Бросок…</span>
        </div>
      )}
    </div>
  );
};
