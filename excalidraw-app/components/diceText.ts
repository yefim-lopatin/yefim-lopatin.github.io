import { FONT_FAMILY, randomId } from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";

import { DICE_SIDES, getDieDimensions } from "./diceSvg";

import type { DiceSides } from "./diceSvg";

export const getDieCharacter = (
  sides: DiceSides,
  result: number,
  v5 = false,
  hunger = false,
) => {
  if (!Number.isInteger(result) || result < 1 || result > sides) {
    throw new Error("Недопустимый результат броска");
  }
  if (v5 && sides === 10) {
    const symbol =
      hunger && result === 1
        ? 6
        : (hunger ? 3 : 0) + (result === 10 ? 2 : result >= 6 ? 1 : 0);
    return String.fromCodePoint(0xe400 + symbol);
  }
  return String.fromCodePoint(
    0xe000 + DICE_SIDES.indexOf(sides) * 128 + result - 1,
  );
};

export const createDiceText = ({
  sides,
  results,
  hunger,
  x,
  y,
  isDarkTheme,
}: {
  sides: DiceSides;
  results: readonly number[];
  hunger: number;
  x: number;
  y: number;
  isDarkTheme: boolean;
}) => {
  const columns = Math.min(results.length, 5);
  const rows = Math.ceil(results.length / columns);
  const { width, height } = getDieDimensions(sides);
  const left = x - (columns * width + (columns - 1) * 12) / 2;
  const top = y - (rows * height + (rows - 1) * 12) / 2;
  const groupId = randomId();
  const elements = [];
  const hungerCount = sides === 10 ? Math.min(hunger, results.length) : 0;
  for (let row = 0; row < rows; row++) {
    const start = row * columns;
    const end = Math.min(start + columns, results.length);
    for (let index = start; index < end; ) {
      const red = index < hungerCount;
      const runEnd = red ? Math.min(end, hungerCount) : end;
      const values = results.slice(index, runEnd);
      elements.push({
        ...newTextElement({
          x: left + (index - start) * (width + 12),
          y: top + row * (height + 12),
          text: values
            .map((value) => getDieCharacter(sides, value, hungerCount > 0, red))
            .join(" "),
          fontFamily: FONT_FAMILY.Dice,
          fontSize: 64,
          strokeColor: red ? "#b52025" : isDarkTheme ? "#e6e6eb" : "#363636",
          textAlign: "left",
          verticalAlign: "top",
          groupIds: [groupId],
          customData: {
            diceRoll: { renderer: 2, sides, results: values, hunger: red },
          },
        }),
        width: values.length * width + (values.length - 1) * 12,
        height,
      });
      index = runEnd;
    }
  }
  return elements;
};
