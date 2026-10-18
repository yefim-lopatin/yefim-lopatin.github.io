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
  randomId,
  isWritableElement,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { syncInvalidIndices } from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DiceIcon } from "./DiceIcons";
import { DiceThrow } from "./DiceThrow";
import { DICE_SIDES } from "./diceSvg";
import { createDiceText } from "./diceText";

import { getHungerCount } from "./v5Dice";

import "./DiceRoller.scss";

import type { DiceSides } from "./diceSvg";

export { DICE_SIDES, createDieSvg, getDieDimensions } from "./diceSvg";
export type { DiceSides } from "./diceSvg";

const MAX_DICE_COUNT = 20;
const DRAG_THRESHOLD = 6;

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
  id: string;
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

export const DiceRoller = ({ excalidrawAPI }: DiceRollerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hunger, setHunger] = useState(0);
  const [hungerEnabled, setHungerEnabled] = useState(false);
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
      // Keep deletion records: collaboration compares the sum of element
      // versions, so dropping them can prevent a new roll from being sent.
      const sceneElements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const scenePoint = viewportCoordsToSceneCoords(
        {
          clientX: roll.clientX,
          clientY: roll.clientY,
        },
        appState,
      );
      const resultElements = createDiceText({
        sides: roll.sides,
        results: roll.results,
        hunger: roll.hunger,
        x: scenePoint.x,
        y: scenePoint.y,
        isDarkTheme: appState.theme === "dark",
      });

      // updateScene triggers App.onChange, which broadcasts the result to all
      // collaborators through the existing collaboration channel.
      excalidrawAPI.updateScene({
        elements: syncInvalidIndices([...sceneElements, ...resultElements]),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [excalidrawAPI],
  );

  const startRollAtPoint = useCallback(
    (sides: DiceSides, count: number, clientX: number, clientY: number) => {
      const results = Array.from({ length: count }, () => rollDie(sides));
      const roll = {
        id: randomId(),
        sides,
        count,
        results,
        hunger: getHungerCount(sides, count, hungerEnabled ? hunger : 0),
        clientX,
        clientY,
      };

      setRollAnimation(roll);
    },
    [hunger, hungerEnabled],
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
                  </button>
                </div>
              );
            })}
          </div>
          <div className="dice-roller__hunger">
            <label className="dice-roller__hunger-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={hungerEnabled}
                onChange={(event) => setHungerEnabled(event.target.checked)}
              />
              <span className="dice-roller__switch" aria-hidden="true" />
              <span>Кубики голода</span>
            </label>
            <div className="dice-roller__quantity-controls">
              <button
                type="button"
                aria-label="Уменьшить кубики голода"
                disabled={!hungerEnabled || hunger === 0}
                onClick={() => setHunger((n) => Math.max(0, n - 1))}
              >
                −
              </button>
              <output aria-label="Количество кубиков голода">{hunger}</output>
              <button
                type="button"
                aria-label="Увеличить кубики голода"
                disabled={!hungerEnabled || hunger === 10}
                onClick={() => setHunger((n) => Math.min(10, n + 1))}
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
          key={rollAnimation.id}
          sides={rollAnimation.sides}
          count={rollAnimation.count}
          hunger={rollAnimation.hunger}
          clientX={rollAnimation.clientX}
          clientY={rollAnimation.clientY}
          onResult={({ results }) => {
            addRollToCanvas({
              ...rollAnimation,
              results: results.length ? results : rollAnimation.results,
            });
          }}
          onComplete={() => setRollAnimation(null)}
        />
      )}
    </div>
  );
};
