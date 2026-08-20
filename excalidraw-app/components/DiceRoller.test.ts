import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DiceIcon, MDI_DICE_ICONS, isMdiDiceSides } from "./DiceIcons";
import {
  DICE_SIDES,
  DiceRoller,
  createDieSvg,
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
      expect(svg).toContain('fill="#000000"');
      if (isMdiDiceSides(sides)) {
        expect(svg).toContain(MDI_DICE_ICONS[sides].outlinePath);
      }
    }
  });

  it("distinguishes d10 from d8 with facet lines", () => {
    expect(createDieSvg(10, 5, "#1e1e1e", false)).toContain(
      'data-die-facets="d10"',
    );
    expect(createDieSvg(8, 5, "#1e1e1e", false)).not.toContain(
      'data-die-facets="d10"',
    );
  });

  it("renders the official MDI dice icons in the picker", () => {
    for (const sides of DICE_SIDES) {
      const markup = renderToStaticMarkup(createElement(DiceIcon, { sides }));

      if (isMdiDiceSides(sides)) {
        expect(markup).toContain(MDI_DICE_ICONS[sides].path);
      }
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

  it("toggles with D and closes on an outside pointer down", () => {
    render(createElement(DiceRoller, { excalidrawAPI: null }));

    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    expect(screen.getByRole("dialog", { name: "Кубики" })).toBeTruthy();
    expect(screen.queryByText("Кубики НРИ")).toBeNull();
    expect(screen.queryByText(/Наведите/)).toBeNull();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Кубики" })).toBeNull();
  });
});
