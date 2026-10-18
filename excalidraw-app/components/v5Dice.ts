import { drawBoardDie } from "./BoardDice";

import blackDot from "./v5-symbols/black-dot.svg?raw";
import blackSuccess from "./v5-symbols/black-success.svg?raw";
import blackTriumph from "./v5-symbols/black-triumph.svg?raw";
import redDot from "./v5-symbols/red-dot.svg?raw";
import redSuccess from "./v5-symbols/red-success.svg?raw";
import redTriumph from "./v5-symbols/red-triumph.svg?raw";
import redUnluck from "./v5-symbols/red-unluck.svg?raw";

export const getV5Symbol = (result: number, hunger: boolean) => {
  if (hunger && result === 1) {
    return redUnluck;
  }
  if (result === 10) {
    return hunger ? redTriumph : blackTriumph;
  }
  if (result >= 6) {
    return hunger ? redSuccess : blackSuccess;
  }
  return hunger ? redDot : blackDot;
};

export const getHungerCount = (sides: number, count: number, hunger: number) =>
  sides === 10 ? Math.min(count, Math.max(0, Math.min(10, hunger))) : 0;

export const createV5DieSvg = (result: number, hunger: boolean) => {
  const symbol = getV5Symbol(result, hunger)
    .replace(/<svg\b/, '<svg x="21" y="15"')
    .replace(/width="[^"]*"/, 'width="22"')
    .replace(/height="[^"]*"/, 'height="27"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${drawBoardDie(
    10,
    hunger ? "#b52025" : "#333333",
    "#ffffff",
  )}${symbol}</svg>`;
};
