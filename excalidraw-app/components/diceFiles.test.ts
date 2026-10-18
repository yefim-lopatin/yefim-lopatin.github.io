import { describe, expect, it } from "vitest";
import { MIME_TYPES } from "@excalidraw/common";
import { newImageElement } from "@excalidraw/element";
import { getDataURL_sync } from "@excalidraw/excalidraw/data/blob";

import type { FileId } from "@excalidraw/element/types";

import { isReconstructableDie, reconstructDiceFiles } from "./diceFiles";
import { createDieSvg } from "./diceSvg";
import { createV5DieSvg } from "./v5Dice";

const die = (metadata: Record<string, unknown> = {}) =>
  newImageElement({
    type: "image",
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    fileId: "remote-die" as FileId,
    status: "saved",
    customData: {
      diceRoll: {
        renderer: 1,
        sides: 20,
        result: 12,
        isDarkTheme: false,
        v5: false,
        hunger: false,
        ...metadata,
      },
    },
  });

describe("dice file reconstruction", () => {
  it("recreates all standard dice identically without the sender's files", () => {
    for (const sides of [2, 4, 6, 8, 10, 12, 20, 100] as const) {
      for (const isDarkTheme of [false, true]) {
        const element = die({ sides, result: sides, isDarkTheme });
        const [file] = reconstructDiceFiles([element], {});
        expect(file.id).toBe(element.fileId);
        expect(file.dataURL).toBe(
          getDataURL_sync(
            createDieSvg(sides, sides, "", isDarkTheme),
            MIME_TYPES.svg,
          ),
        );
      }
    }
  });

  it("preserves V5 symbols for both ordinary and Hunger dice", () => {
    for (const hunger of [false, true]) {
      for (let result = 1; result <= 10; result++) {
        const [file] = reconstructDiceFiles(
          [die({ sides: 10, result, hunger, v5: true })],
          {},
        );
        expect(file.dataURL).toBe(
          getDataURL_sync(createV5DieSvg(result, hunger), MIME_TYPES.svg),
        );
      }
    }
  });

  it("recreates saved dice when joining later and skips existing files", () => {
    const elements = [die()];
    const [file] = reconstructDiceFiles(elements, {});
    expect(reconstructDiceFiles(elements, { [file.id]: file })).toEqual([]);
    expect(reconstructDiceFiles(elements, {})).toEqual([file]);
  });

  it("leaves legacy dice and unsupported or invalid metadata to file storage", () => {
    for (const metadata of [
      { renderer: undefined },
      { renderer: 2 },
      { sides: 3 },
      { result: 0 },
      { result: 21 },
      { result: 1.5 },
      { result: "12" },
      { v5: true },
      { isDarkTheme: undefined },
    ]) {
      const element = die(metadata);
      expect(isReconstructableDie(element)).toBe(false);
      expect(reconstructDiceFiles([element], {})).toEqual([]);
    }
  });

  it("skips deleted dice and creates one file for duplicate references", () => {
    const element = die();
    expect(reconstructDiceFiles([{ ...element, isDeleted: true }], {})).toEqual(
      [],
    );
    expect(reconstructDiceFiles([element, element], {})).toHaveLength(1);
  });
});
