import { describe, expect, it } from "vitest";
import { FONT_FAMILY } from "@excalidraw/common";

import { getV5Result } from "./v5Dice";

import { DICE_SIDES } from "./diceSvg";
import { createDiceText, getDieCharacter } from "./diceText";

const create = (
  overrides: Partial<Parameters<typeof createDiceText>[0]> = {},
) =>
  createDiceText({
    sides: 20,
    results: [12, 20],
    hunger: 0,
    x: 200,
    y: 200,
    isDarkTheme: false,
    ...overrides,
  });

describe("dice text", () => {
  it("gives all 162 standard die faces distinct font characters", () => {
    const characters = new Set<string>();
    for (const sides of DICE_SIDES) {
      for (let result = 1; result <= sides; result++) {
        characters.add(getDieCharacter(sides, result));
      }
    }
    expect(characters.size).toBe(162);
    expect(() => getDieCharacter(20, 21)).toThrow();
    expect(() => getDieCharacter(10, 0)).toThrow();
  });

  it("creates grouped text instead of image files", () => {
    const elements = create();
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe("text");
    expect(elements[0].fontFamily).toBe(FONT_FAMILY.Dice);
    expect(elements[0].text).toBe(
      `${getDieCharacter(20, 12)} ${getDieCharacter(20, 20)}`,
    );
    expect(elements[0].groupIds).toHaveLength(1);
    expect(elements[0].width).toBe(140);
    expect(elements[0].height).toBe(64);
    expect(elements[0]).not.toHaveProperty("fileId");
  });

  it("keeps red Hunger dice and ordinary V5 symbols in one group", () => {
    const elements = create({ sides: 10, results: [1, 10, 6, 3], hunger: 2 });
    expect(elements).toHaveLength(2);
    expect(elements[0].strokeColor).toBe("#b52025");
    expect(elements[0].text).toBe(
      `${getDieCharacter(10, 1, true, true)} ${getDieCharacter(
        10,
        10,
        true,
        true,
      )}`,
    );
    expect(elements[1].text).toBe(
      `${getDieCharacter(10, 6, true)} ${getDieCharacter(10, 3, true)}`,
    );
    expect(elements[1].groupIds).toEqual(elements[0].groupIds);
    expect(elements[1].x).toBe(elements[0].x + 2 * 76);
  });

  it("maps V5 failures, successes, criticals and Hunger ones", () => {
    expect(getDieCharacter(10, 2, true, true)).toBe(
      getDieCharacter(10, 5, true, true),
    );
    expect(getDieCharacter(10, 6, true)).toBe(getDieCharacter(10, 9, true));
    expect(
      new Set(
        [1, 2, 6, 10].map((value) => getDieCharacter(10, value, true, true)),
      ).size,
    ).toBe(4);
  });

  it("wraps large rolls in five-die rows and preserves dark-mode contrast", () => {
    const elements = create({ results: Array(12).fill(8), isDarkTheme: true });
    expect(elements).toHaveLength(3);
    expect(elements.map((element) => element.text.split(" ").length)).toEqual([
      5, 5, 2,
    ]);
    expect(elements[1].y - elements[0].y).toBe(76);
    expect(elements.every((element) => element.strokeColor === "#363636")).toBe(
      true,
    );
    expect(new Set(elements.flatMap((element) => element.groupIds)).size).toBe(
      1,
    );
  });

  it("supports paired percentile dice and ignores Hunger on other die types", () => {
    const [element] = create({ sides: 100, results: [100, 42], hunger: 2 });
    expect(element.text).toBe(
      `${getDieCharacter(100, 100)} ${getDieCharacter(100, 42)}`,
    );
    expect(element.strokeColor).not.toBe("#b52025");
  });
});

describe("V5 result", () => {
  it.each([
    [[2, 5], 1, 0, "Состязание — 0 успехов"],
    [[1, 6], 1, 0, "Состязание — 1 успех"],
    [[10, 10], 1, 0, "Состязание — 4 успеха"],
    [[2, 5], 1, 1, "Нет успехов"],
    [[1, 6], 1, 2, "Кровавый провал — 1 успех"],
    [[1, 6], 1, 1, "1 успех"],
    [[6, 3], 0, 2, "1 успех — провал"],
    [[10, 10], 0, 4, "Прорыв — 4 успеха"],
    [[10, 10], 1, 4, "Кровавый триумф — 4 успеха"],
    [[10, 10], 1, 5, "4 успеха — провал"],
    [[10, 10, 10], 1, 1, "Кровавый триумф — 5 успехов"],
  ])(
    "resolves %j with Hunger %i and difficulty %i",
    (results, hunger, difficulty, expected) => {
      expect(
        getV5Result(
          results as number[],
          hunger as number,
          difficulty as number,
        ),
      ).toBe(expected);
    },
  );
  it("adds ordinary text below the dice even at zero Hunger", () => {
    const elements = create({ sides: 10, results: [6, 3], difficulty: 1 });
    expect(elements).toHaveLength(2);
    expect(elements[1].text).toBe("1 успех");
    expect(elements[1].fontFamily).toBe(FONT_FAMILY.Assistant);
    expect(elements[1].y).toBeGreaterThanOrEqual(
      elements[0].y + elements[0].height + 12,
    );
    expect(elements[1].groupIds).toEqual(elements[0].groupIds);
    expect(elements[0].text).toContain(getDieCharacter(10, 6, true));
  });
});
