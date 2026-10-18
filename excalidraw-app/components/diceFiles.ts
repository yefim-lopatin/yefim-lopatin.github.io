import { MIME_TYPES } from "@excalidraw/common";
import { isInitializedImageElement } from "@excalidraw/element";
import { getDataURL_sync } from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import { DICE_SIDES, createDieSvg } from "./diceSvg";
import { createV5DieSvg } from "./v5Dice";

import type { DiceSides } from "./diceSvg";

export const isReconstructableDie = (element: ExcalidrawElement) => {
  const die = element.customData?.diceRoll;
  return !!(
    isInitializedImageElement(element) &&
    die?.renderer === 1 &&
    DICE_SIDES.includes(die.sides) &&
    Number.isInteger(die.result) &&
    die.result >= 1 &&
    die.result <= die.sides &&
    typeof die.isDarkTheme === "boolean" &&
    typeof die.v5 === "boolean" &&
    typeof die.hunger === "boolean" &&
    (!die.v5 || die.sides === 10)
  );
};

export const reconstructDiceFiles = (
  elements: readonly ExcalidrawElement[],
  existingFiles: Readonly<Record<string, BinaryFileData>>,
): BinaryFileData[] => {
  const files = new Map<string, BinaryFileData>();
  for (const element of elements) {
    if (
      element.isDeleted ||
      !isInitializedImageElement(element) ||
      existingFiles[element.fileId] ||
      !isReconstructableDie(element)
    ) {
      continue;
    }
    const die = element.customData!.diceRoll;
    files.set(element.fileId, {
      id: element.fileId,
      dataURL: getDataURL_sync(
        die.v5
          ? createV5DieSvg(die.result, die.hunger)
          : createDieSvg(
              die.sides as DiceSides,
              die.result,
              "",
              die.isDarkTheme,
            ),
        MIME_TYPES.svg,
      ),
      mimeType: MIME_TYPES.svg,
      created: element.updated,
    });
  }
  return [...files.values()];
};
