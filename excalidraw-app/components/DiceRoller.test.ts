import { describe, expect, it } from "vitest";

import {
  DICE_SIDES,
  createDieSvg,
  formatDiceRoll,
  getDieDimensions,
  rollDie,
} from "./DiceRoller";

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
    expect(formatDiceRoll(4, [1, 3, 4])).toBe("d4 × 3: 1 · 3 · 4");
  });

  it("renders every die with its physical silhouette and no type label", () => {
    const expectedShapes = {
      2: "coin",
      4: "tetrahedron",
      6: "cube",
      8: "octahedron",
      10: "pentagonal-trapezohedron",
      12: "dodecahedron",
      20: "icosahedron",
      100: "percentile-pair",
    } as const;

    for (const sides of DICE_SIDES) {
      const svg = createDieSvg(sides, sides, "#1e1e1e", false);
      const visibleTexts = Array.from(
        svg.matchAll(/<text[^>]*>(.*?)<\/text>/g),
        (match) => match[1],
      );

      expect(svg).toContain(`data-die-shape="${expectedShapes[sides]}"`);
      expect(visibleTexts.some((text) => text.startsWith("d"))).toBe(false);
    }
  });

  it("renders d100 as two percentile d10 dice", () => {
    const svg = createDieSvg(100, 42, "#1e1e1e", false);
    const visibleTexts = Array.from(
      svg.matchAll(/<text[^>]*>(.*?)<\/text>/g),
      (match) => match[1],
    );

    expect(visibleTexts).toEqual(["40", "2"]);
    expect(getDieDimensions(100).width).toBeGreaterThan(
      getDieDimensions(10).width,
    );
  });
});
