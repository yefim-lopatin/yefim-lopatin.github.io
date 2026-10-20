import type { ExcalidrawElement } from "@excalidraw/element/types";

export const isStickyNote = (element: ExcalidrawElement | null | undefined) =>
  element?.type === "rectangle" && element.customData?.stickyNote === true;

export const getStickyTextColor = (background: string) => {
  const hex = background.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.179 ? "#000000" : "#ffffff";
};
