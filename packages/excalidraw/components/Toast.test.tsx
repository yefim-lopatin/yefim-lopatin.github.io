import { fireEvent, render } from "@testing-library/react";

import { Toast } from "./Toast";

describe("Toast timeout", () => {
  it("closes after five seconds despite rerenders and hovering", () => {
    vi.useFakeTimers();
    try {
      const firstClose = vi.fn();
      const latestClose = vi.fn();
      const view = render(<Toast message="message" onClose={firstClose} />);
      vi.advanceTimersByTime(3000);
      fireEvent.mouseEnter(view.getByRole("status"));
      view.rerender(<Toast message="message" onClose={latestClose} />);
      vi.advanceTimersByTime(1999);
      expect(latestClose).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(latestClose).toHaveBeenCalledTimes(1);
      expect(firstClose).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
