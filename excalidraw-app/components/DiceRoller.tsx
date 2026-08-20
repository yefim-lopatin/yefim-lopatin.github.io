import { useCallback, useState } from "react";

import { viewportCoordsToSceneCoords } from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./DiceRoller.scss";

export const DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;

export type DiceSides = typeof DICE_SIDES[number];

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

export const DiceRoller = ({ excalidrawAPI }: DiceRollerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [lastRoll, setLastRoll] = useState<{
    sides: DiceSides;
    result: number;
  } | null>(null);

  const handleRoll = useCallback(
    (sides: DiceSides) => {
      const result = rollDie(sides);
      setLastRoll({ sides, result });

      if (!excalidrawAPI) {
        return;
      }

      const appState = excalidrawAPI.getAppState();
      const sceneElements = excalidrawAPI.getSceneElements();
      const diceRollCount = sceneElements.filter(
        (element) => element.customData?.diceRoll,
      ).length;
      const sceneCenter = viewportCoordsToSceneCoords(
        {
          clientX: appState.offsetLeft + appState.width / 2,
          clientY: appState.offsetTop + appState.height / 2,
        },
        appState,
      );
      const resultElement = newTextElement({
        x: sceneCenter.x,
        y: sceneCenter.y + diceRollCount * 40,
        text: `d${sides}: ${result}`,
        fontSize: 24,
        fontFamily: appState.currentItemFontFamily,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: appState.currentItemStrokeColor,
        backgroundColor: "transparent",
        customData: {
          diceRoll: { sides, result },
        },
      });

      // updateScene triggers App.onChange, which broadcasts the new element to
      // all collaborators through the existing collaboration channel.
      excalidrawAPI.updateScene({
        elements: [...sceneElements, resultElement],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [excalidrawAPI],
  );

  return (
    <div className="dice-roller">
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
            {DICE_SIDES.map((sides) => (
              <button
                className="dice-roller__die"
                type="button"
                key={sides}
                aria-label={`Бросить d${sides}`}
                onClick={() => handleRoll(sides)}
              >
                d{sides}
              </button>
            ))}
          </div>

          <div className="dice-roller__result" aria-live="polite">
            {lastRoll ? (
              <>
                <span>d{lastRoll.sides}</span>
                <strong>{lastRoll.result}</strong>
              </>
            ) : (
              "Выберите кубик"
            )}
          </div>
        </div>
      )}
    </div>
  );
};
