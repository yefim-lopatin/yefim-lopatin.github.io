import { actionDeleteSelected, actionDuplicateSelection } from "../actions";
import { Excalidraw } from "../index";
import { actionChangeBackgroundColor } from "../actions/actionProperties";
import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

describe("sticky notes", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    act(() => h.app.setActiveTool({ type: "sticky" }));
    mouse.clickAt(200, 200);
  });

  it("creates a bound note, grows downwards, and reopens for editing", async () => {
    const editor = await getTextEditor();
    expect(h.elements).toHaveLength(2);
    const containerId = h.elements[0].id;
    expect(h.state.editingTextElement?.containerId).toBe(containerId);
    updateTextEditor(editor, "Строка\n".repeat(30));
    expect(h.elements[0].height).toBeGreaterThan(200);
    expect(h.elements[0].width).toBe(200);
    expect(h.elements[0].y).toBe(200);
    Keyboard.exitTextEditor(editor);
    expect(h.state.activeTool.type).toBe("selection");
    mouse.doubleClickAt(250, 250);
    expect((await getTextEditor()).value).toContain("Строка");
  });

  it("keeps an empty note and its binding through saving", async () => {
    Keyboard.exitTextEditor(await getTextEditor());
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(2);
    const restored = restoreElements(
      JSON.parse(JSON.stringify(h.elements)),
      null,
      { repairBindings: true, deleteInvisibleElements: true },
    );
    expect(restored[0].customData?.stickyNote).toBe(true);
    expect(restored[0].boundElements?.[0].id).toBe(restored[1].id);
    expect(restored[1].isDeleted).toBe(false);
  });

  it("moves, duplicates and deletes the text together with the note", async () => {
    updateTextEditor(await getTextEditor(), "Вместе");
    Keyboard.exitTextEditor(await getTextEditor());
    API.setSelectedElements([
      h.app.scene.getNonDeletedElement(h.elements[0].id)!,
    ]);
    const textBefore = { x: h.elements[1].x, y: h.elements[1].y };
    mouse.downAt(220, 220);
    mouse.moveTo(270, 280);
    mouse.upAt(270, 280);
    expect(h.elements[0].x).toBe(250);
    expect(h.elements[1].x).toBe(textBefore.x + 50);
    expect(h.elements[1].y).toBe(textBefore.y + 60);
    API.executeAction(actionDuplicateSelection);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(4);
    const notes = h.elements.filter((element) => element.type === "rectangle");
    for (const note of notes) {
      const text = h.elements.find(
        (element) => element.type === "text" && element.containerId === note.id,
      );
      expect(text).toBeDefined();
      expect(note.boundElements?.[0].id).toBe(text!.id);
    }
    API.executeAction(actionDeleteSelected);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(2);
    Keyboard.undo();
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(4);
  });

  it("chooses readable text when the background changes", async () => {
    updateTextEditor(await getTextEditor(), "Заметка");
    Keyboard.exitTextEditor(await getTextEditor());
    API.setSelectedElements([
      h.app.scene.getNonDeletedElement(h.elements[0].id)!,
    ]);
    for (const [background, foreground] of [
      ["#000000", "#ffffff"],
      ["#ffffff", "#000000"],
    ]) {
      await act(async () => {
        const result = await actionChangeBackgroundColor.perform(
          h.app.scene.getElementsIncludingDeleted(),
          h.state,
          {
            currentItemBackgroundColor: background,
            viewBackgroundColor: h.state.viewBackgroundColor,
          },
          h.app,
        );
        if (result && result.elements) {
          h.app.updateScene({ elements: result.elements });
        }
      });
      expect(h.elements[1].strokeColor).toBe(foreground);
    }
  });
});
