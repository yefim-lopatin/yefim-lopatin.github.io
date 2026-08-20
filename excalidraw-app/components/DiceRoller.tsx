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

import { DiceIcon, MDI_DICE_ICONS } from "./DiceIcons";

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
const PERCENTILE_DICE_WIDTH = 116;

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

export const getDieDimensions = (sides: DiceSides) => ({
  width: sides === 100 ? PERCENTILE_DICE_WIDTH : DICE_SIZE,
  height: DICE_SIZE,
});

const createValueSvg = (
  value: string | number,
  x: number,
  y: number,
  fontSize: number,
  textColor: string,
  backgroundColor: string,
) =>
  `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${textColor}" stroke="${backgroundColor}" stroke-width="5" stroke-linejoin="round" style="paint-order: stroke">${value}</text>`;

export const createDieSvg = (
  sides: DiceSides,
  result: number,
  accentColor: string,
  isDarkTheme: boolean,
) => {
  const backgroundColor = isDarkTheme ? "#2f2f2f" : "#ffffff";
  const textColor = isDarkTheme ? "#f5f5f5" : "#1f2937";
  const resultFontSize = result >= 100 ? 16 : result >= 10 ? 20 : 24;
  const { width, height } = getDieDimensions(sides);

  let shape: string;
  switch (sides) {
    case 2:
      shape = `<g data-die-shape="coin">
        <circle cx="32" cy="32" r="28" fill="${backgroundColor}" stroke="${accentColor}" stroke-width="3"/>
        <circle cx="32" cy="32" r="23" fill="none" stroke="${accentColor}" stroke-width="1.5" opacity="0.45"/>
        ${createValueSvg(
          result,
          32,
          33,
          resultFontSize,
          textColor,
          backgroundColor,
        )}
      </g>`;
      break;
    case 4:
    case 6:
    case 8:
    case 10:
    case 12:
    case 20: {
      const icon = MDI_DICE_ICONS[sides];
      shape = `<g data-die-shape="${icon.shape}">
        <g transform="translate(2 2) scale(2.5)">
          <path d="${icon.outlinePath}" fill="${accentColor}"/>
        </g>
        ${createValueSvg(
          result,
          32,
          sides === 4 ? 38 : 33,
          resultFontSize,
          backgroundColor,
          accentColor,
        )}
      </g>`;
      break;
    }
    case 100: {
      const tens =
        result === 100
          ? "00"
          : String(Math.floor(result / 10) * 10).padStart(2, "0");
      const units = result === 100 ? 0 : result % 10;
      shape = `<g data-die-shape="percentile-pair">
        <g transform="translate(1 5) scale(2.25)">
          <path d="${MDI_DICE_ICONS[10].outlinePath}" fill="${accentColor}"/>
        </g>
        <g transform="translate(59 5) scale(2.25)">
          <path d="${MDI_DICE_ICONS[10].outlinePath}" fill="${accentColor}"/>
        </g>
        ${createValueSvg(tens, 28, 33, 16, backgroundColor, accentColor)}
        ${createValueSvg(units, 86, 33, 18, backgroundColor, accentColor)}
      </g>`;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${shape}
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
      const dieDimensions = getDieDimensions(roll.sides);
      const columns = Math.min(roll.results.length, DICE_COLUMNS);
      const rows = Math.ceil(roll.results.length / columns);
      const boardWidth =
        columns * dieDimensions.width + (columns - 1) * DICE_GAP;
      const boardHeight = rows * dieDimensions.height + (rows - 1) * DICE_GAP;
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
          x:
            scenePoint.x -
            boardWidth / 2 +
            column * (dieDimensions.width + DICE_GAP),
          y:
            scenePoint.y -
            boardHeight / 2 +
            row * (dieDimensions.height + DICE_GAP),
          width: dieDimensions.width,
          height: dieDimensions.height,
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
                    <DiceIcon sides={sides} />
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
