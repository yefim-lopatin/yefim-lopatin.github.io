import { describe, expect, it } from "vitest";

import { DICE_SIDES, formatDiceRoll, rollDie } from "./DiceRoller";

describe("DiceRoller", () => {
  it("contains the standard RPG dice", () => {
    expect(DICE_SIDES).toEqual([2, 4, 6, 8, 10, 12, 20, 100]);
  });

  it("returns a result within the die range", () => {
    for (const sides of DICE_SIDES) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const result = rollDie(sides);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(sides);
      }
    }
  });

  it("rejects invalid dice sizes", () => {
    expect(() => rollDie(1)).toThrow();
    expect(() => rollDie(2.5)).toThrow();
  });

  it("formats a multi-dice result for the canvas", () => {
    expect(formatDiceRoll(4, [1, 3, 4])).toBe("d4 × 3: [1 + 3 + 4] = 8");
  });
});
