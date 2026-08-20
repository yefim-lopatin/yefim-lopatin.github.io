import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import { viewportCoordsToSceneCoords } from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./DiceRoller.scss";

export const DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;

export type DiceSides = typeof DICE_SIDES[number];

const MAX_DICE_COUNT = 20;
const DRAG_THRESHOLD = 6;
const ROLL_ANIMATION_DURATION = 650;

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
  total: number;
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
  total: number;
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
  const total = results.reduce((sum, result) => sum + result, 0);
  if (results.length === 1) {
    return `d${sides}: ${total}`;
  }
  return `d${sides} × ${results.length}: [${results.join(" + ")}] = ${total}`;
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
      const resultElement = newTextElement({
        x: scenePoint.x,
        y: scenePoint.y,
        text: formatDiceRoll(roll.sides, roll.results),
        fontSize: 24,
        fontFamily: appState.currentItemFontFamily,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: appState.currentItemStrokeColor,
        backgroundColor: "transparent",
        customData: {
          diceRoll: {
            sides: roll.sides,
            count: roll.count,
            results: roll.results,
            total: roll.total,
          },
        },
      });

      // updateScene triggers App.onChange, which broadcasts the result to all
      // collaborators through the existing collaboration channel.
      excalidrawAPI.updateScene({
        elements: [...sceneElements, resultElement],
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
        total: results.reduce((sum, result) => sum + result, 0),
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
                      <small>Потяните кубик на холст</small>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="dice-roller__result" aria-live="polite">
            {lastRoll ? (
              <>
                <span>{formatDiceRoll(lastRoll.sides, lastRoll.results)}</span>
                <strong>{lastRoll.total}</strong>
              </>
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
