import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DiceHistory } from "./DiceHistory";

vi.mock("./diceHistoryApi", () => ({
  historyRequest: vi.fn().mockResolvedValue([]),
}));

const ownerFetch = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  ownerFetch.mockReset();
  vi.stubGlobal("fetch", ownerFetch);
});

describe("доступ ведущего к истории", () => {
  it("восстанавливает кнопку после входа и повторного открытия", async () => {
    ownerFetch.mockResolvedValue({ ok: true });
    const view = render(<DiceHistory />);
    expect(
      screen.queryByRole("button", { name: "Очистить историю" }),
    ).toBeNull();
    fireEvent.click(screen.getByText("Доступ ведущего"));
    fireEvent.change(screen.getByLabelText("Ключ ведущего"), {
      target: { value: "test-owner-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    await screen.findByRole("button", { name: "Очистить историю" });
    view.unmount();
    render(<DiceHistory />);
    await screen.findByRole("button", { name: "Очистить историю" });
    expect(ownerFetch).toHaveBeenCalledTimes(2);
    expect(ownerFetch).toHaveBeenLastCalledWith("/api/dice-history/owner", {
      method: "POST",
      headers: { "X-Owner-Key": "test-owner-key" },
    });
  });

  it("не даёт доступ по отвергнутому сохранённому ключу", async () => {
    sessionStorage.setItem("dice-history-owner-key", "invalid-key");
    ownerFetch.mockResolvedValue({ ok: false });
    render(<DiceHistory />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Войти" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(
      screen.queryByRole("button", { name: "Очистить историю" }),
    ).toBeNull();
  });
});
