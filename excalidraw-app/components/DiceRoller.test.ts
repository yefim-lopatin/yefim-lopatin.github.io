import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getSceneVersion, newElement } from "@excalidraw/element";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { BOARD_DICE } from "./BoardDice";
import { getHungerCount, getV5Symbol, createV5DieSvg } from "./v5Dice";
import { DiceIcon, MDI_DICE_ICONS, isMdiDiceSides } from "./DiceIcons";
import {
  DICE_SIDES,
  DiceRoller,
  createDieSvg,
  getDieDimensions,
  rollDie,
} from "./DiceRoller";

vi.mock("./DiceThrow", () => ({
  DiceThrow: ({
    onComplete,
  }: {
    onComplete: (result: { results: number[] }) => void;
  }) =>
    createElement(
      "button",
      { onClick: () => onComplete({ results: [12] }) },
      "Завершить тестовый бросок",
    ),
}));

describe("DiceRoller", () => {
  it("keeps deletion records so a roll increases the collaboration scene version", () => {
    const deleted = {
      ...newElement({ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }),
      isDeleted: true,
      version: 100,
    };
    const updateScene = vi.fn(
      (scene: { elements: readonly ExcalidrawElement[] }) => scene,
    );
    const excalidrawAPI = {
      getAppState: () => ({
        ...getDefaultAppState(),
        offsetLeft: 0,
        offsetTop: 0,
      }),
      getSceneElements: () => [],
      getSceneElementsIncludingDeleted: () => [deleted],
      addFiles: vi.fn(),
      updateScene,
    } as unknown as ExcalidrawImperativeAPI;
    render(createElement(DiceRoller, { excalidrawAPI }));
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    const pointer = (
      target: Element | Window,
      type: string,
      x: number,
      y: number,
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      fireEvent(target, event);
    };
    pointer(
      screen.getByRole("button", {
        name: "Перетащить 1 кубик(а) d20 на холст",
      }),
      "pointerdown",
      120,
      240,
    );
    pointer(window, "pointermove", 250, 350);
    pointer(window, "pointerup", 250, 350);
    fireEvent.click(
      screen.getByRole("button", { name: "Завершить тестовый бросок" }),
    );
    const { elements } = updateScene.mock.calls[0][0];
    expect(
      elements.find((element) => element.id === deleted.id)?.isDeleted,
    ).toBe(true);
    expect(elements.filter((element) => !element.isDeleted)).toHaveLength(1);
    expect(getSceneVersion(elements)).toBeGreaterThan(
      getSceneVersion([deleted]),
    );
  });

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
        expect(svg).toContain(BOARD_DICE[sides].outline);
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

  it("keeps quantity controls visible and toggles Hunger up to ten", () => {
    render(createElement(DiceRoller, { excalidrawAPI: null }));
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    for (const sides of DICE_SIDES) {
      expect(
        screen.getByRole("button", { name: `Увеличить количество d${sides}` }),
      ).toBeTruthy();
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Увеличить количество d10" }),
    );
    expect(
      screen.getByRole("button", {
        name: "Перетащить 2 кубик(а) d10 на холст",
      }),
    ).toBeTruthy();
    const increase = screen.getByRole("button", {
      name: "Увеличить кубики голода",
    });
    expect(screen.queryByText("×2")).toBeNull();
    expect(increase.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Кубики голода" }));
    for (let i = 0; i < 12; i++) {
      fireEvent.click(increase);
    }
    expect(screen.getByLabelText("Количество кубиков голода").textContent).toBe(
      "10",
    );
    expect(increase.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Кубики голода" }));
    expect(
      screen
        .getByRole("button", { name: "Уменьшить кубики голода" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("replaces only d10s with Hunger dice and maps all V5 faces", () => {
    expect(getHungerCount(10, 5, 0)).toBe(0);
    expect(getHungerCount(10, 20, 12)).toBe(10);
    expect(getHungerCount(10, 10, 10)).toBe(10);
    expect(getHungerCount(10, 2, 5)).toBe(2);
    expect(getHungerCount(20, 5, 3)).toBe(0);
    expect(getV5Symbol(1, true)).not.toBe(getV5Symbol(2, true));
    expect(getV5Symbol(2, true)).toBe(getV5Symbol(5, true));
    expect(getV5Symbol(6, true)).toBe(getV5Symbol(9, true));
    expect(getV5Symbol(10, true)).not.toBe(getV5Symbol(9, true));
    expect(getV5Symbol(1, false)).toBe(getV5Symbol(5, false));
    for (const hunger of [false, true]) {
      for (let result = 1; result <= 10; result++) {
        const doc = new DOMParser().parseFromString(
          createV5DieSvg(result, hunger),
          "image/svg+xml",
        );
        expect(doc.querySelector("parsererror")).toBeNull();
      }
    }
  });

  it("shows a die preview and grabbing cursor while dragging", async () => {
    render(createElement(DiceRoller, { excalidrawAPI: null }));

    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "Перетащить 1 кубик(а) d20 на холст",
      }),
      { button: 0, pointerId: 1, clientX: 120, clientY: 240 },
    );

    await waitFor(() => {
      expect(document.body.classList.contains("dice-roller--dragging")).toBe(
        true,
      );
      expect(
        document.querySelector(".dice-roller__drag-preview svg"),
      ).toBeTruthy();
    });

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 130, clientY: 250 });
    await waitFor(() => {
      expect(document.body.classList.contains("dice-roller--dragging")).toBe(
        false,
      );
    });
  });
});
