import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import {
  CODES,
  KEYS,
  MIME_TYPES,
  isWritableElement,
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

import { DiceIcon } from "./DiceIcons";
import { DiceThrow } from "./DiceThrow";
import { BOARD_DICE, drawBoardDie } from "./BoardDice";
import { createV5DieSvg, getHungerCount } from "./v5Dice";

import "./DiceRoller.scss";

export const DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;

export type DiceSides = typeof DICE_SIDES[number];

const MAX_DICE_COUNT = 20;
const DRAG_THRESHOLD = 6;
const DICE_SIZE = 64;
const DICE_GAP = 12;
const DICE_COLUMNS = 5;
const PERCENTILE_DICE_WIDTH = 116;
const RESULT_TEXT_COLOR = "#000000";
const RESULT_TEXT_OUTLINE = "#ffffff";

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
  hunger: number;
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
  _accentColor: string,
  isDarkTheme: boolean,
) => {
  const paper = isDarkTheme ? "#252529" : "#ffffff";
  const ink = isDarkTheme ? "#e6e6eb" : "#363636";
  const { width, height } = getDieDimensions(sides);
  const value = (number: string | number, x: number, y: number, size = 17) =>
    createValueSvg(number, x, y, size, RESULT_TEXT_COLOR, RESULT_TEXT_OUTLINE);
  let shape: string;
  if (sides === 2) {
    shape = `<g data-die-shape="coin"><circle cx="32" cy="32" r="28" fill="${paper}" stroke="${ink}" stroke-width="2"/>${value(
      result,
      32,
      33,
    )}</g>`;
  } else if (sides === 100) {
    const tens =
      result === 100
        ? "00"
        : String(Math.floor(result / 10) * 10).padStart(2, "0");
    shape = `<g data-die-shape="percentile-pair"><g transform="scale(.9)">${drawBoardDie(
      10,
      ink,
      paper,
    )}${value(
      tens,
      32,
      26,
    )}</g><g transform="translate(58 0) scale(.9)">${drawBoardDie(
      10,
      ink,
      paper,
    )}${value(result === 100 ? 0 : result % 10, 32, 26)}</g></g>`;
  } else {
    const die = BOARD_DICE[sides];
    shape =
      drawBoardDie(sides, ink, paper) +
      value(result, die.x, die.y, sides === 6 ? 14 : 17);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shape}</svg>`;
};

export const DiceRoller = ({ excalidrawAPI }: DiceRollerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hunger, setHunger] = useState(0);
  const [diceCounts, setDiceCounts] = useState(createInitialDiceCounts);
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(
    null,
  );
  const dragStateRef = useRef<DragState | null>(null);
  const diceRollerRef = useRef<HTMLDivElement | null>(null);

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
            roll.hunger > 0
              ? createV5DieSvg(result, index < roll.hunger)
              : createDieSvg(
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
              hunger: index < roll.hunger,
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
        hunger: getHungerCount(sides, count, hunger),
        clientX,
        clientY,
      };

      setRollAnimation(roll);
    },
    [hunger],
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
    document.body.classList.toggle(
      "dice-roller--dragging",
      dragPreview !== null,
    );
    return () => document.body.classList.remove("dice-roller--dragging");
  }, [dragPreview]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePointerDown = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !diceRollerRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    const toggleWithKeyboard = (event: KeyboardEvent) => {
      const isDiceShortcut =
        event.key.toLowerCase() === KEYS.D || event.code === CODES.D;
      if (
        !isDiceShortcut ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isWritableElement(event.target)
      ) {
        return;
      }

      const appState = excalidrawAPI?.getAppState();
      if (appState?.openDialog || appState?.openMenu) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsOpen((current) => !current);
    };

    window.addEventListener("keydown", toggleWithKeyboard, true);
    return () => {
      window.removeEventListener("keydown", toggleWithKeyboard, true);
    };
  }, [excalidrawAPI]);

  const handleDiePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    sides: DiceSides,
  ) => {
    if (event.button > 0 || rollAnimation) {
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
    <div className="dice-roller" data-testid="dice-roller" ref={diceRollerRef}>
      <IconButton
        type="toggle"
        checked={isOpen}
        icon={<DiceIcon sides={20} />}
        aria-label="Открыть кубики"
        aria-keyshortcuts="D"
        title="Кубики (D)"
        keyBindingLabel="D"
        data-testid="dice-roller-toggle"
        className="dice-roller__toggle"
        onSelect={() => setIsOpen((current) => !current)}
      />

      {isOpen && (
        <div className="dice-roller__menu" role="dialog" aria-label="Кубики">
          <button
            className="dice-roller__close"
            type="button"
            aria-label="Закрыть кубики"
            onClick={() => setIsOpen(false)}
          >
            ×
          </button>

          <div className="dice-roller__grid">
            {DICE_SIDES.map((sides) => {
              const count = diceCounts[sides];
              return (
                <div className="dice-roller__die-wrapper" key={sides}>
                  <div className="dice-roller__quantity-controls">
                    <button
                      type="button"
                      aria-label={`Уменьшить количество d${sides}`}
                      disabled={count === 1}
                      onClick={() => updateDiceCount(sides, -1)}
                    >
                      −
                    </button>
                    <output aria-label={`Количество d${sides}`}>{count}</output>
                    <button
                      type="button"
                      aria-label={`Увеличить количество d${sides}`}
                      disabled={count === MAX_DICE_COUNT}
                      onClick={() => updateDiceCount(sides, 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="dice-roller__die"
                    type="button"
                    aria-label={`Перетащить ${count} кубик(а) d${sides} на холст`}
                    aria-grabbed={dragPreview?.sides === sides}
                    onPointerDown={(event) =>
                      handleDiePointerDown(event, sides)
                    }
                  >
                    <DiceIcon sides={sides} />
                    {count > 1 && <small>×{count}</small>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="dice-roller__hunger">
            <span id="dice-hunger-label">Кубики голода</span>
            <div className="dice-roller__quantity-controls">
              <button
                type="button"
                aria-label="Уменьшить кубики голода"
                disabled={hunger === 0}
                onClick={() => setHunger((n) => Math.max(0, n - 1))}
              >
                −
              </button>
              <output aria-labelledby="dice-hunger-label">{hunger}</output>
              <button
                type="button"
                aria-label="Увеличить кубики голода"
                disabled={hunger === 5}
                onClick={() => setHunger((n) => Math.min(5, n + 1))}
              >
                +
              </button>
            </div>
            <small>Заменяют обычные d10 в броске</small>
          </div>
        </div>
      )}

      {dragPreview && (
        <div
          className="dice-roller__drag-preview"
          style={{ left: dragPreview.clientX, top: dragPreview.clientY }}
          aria-hidden="true"
        >
          <DiceIcon sides={dragPreview.sides} />
          <span>
            d{dragPreview.sides} × {dragPreview.count}
          </span>
        </div>
      )}

      {rollAnimation && (
        <DiceThrow
          sides={rollAnimation.sides}
          count={rollAnimation.count}
          hunger={rollAnimation.hunger}
          clientX={rollAnimation.clientX}
          clientY={rollAnimation.clientY}
          onComplete={({ results }) => {
            addRollToCanvas({
              ...rollAnimation,
              results: results.length ? results : rollAnimation.results,
            });
            setRollAnimation(null);
          }}
        />
      )}
    </div>
  );
};
