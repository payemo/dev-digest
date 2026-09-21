/**
 * The reveal-key toggle used to hardcode Icon.EyeOff, so only the input's
 * `type` flipped and the icon/label never did — clicking it always looked
 * like "show" was still on offer, and it wasn't even a real, focusable
 * control (a raw <svg onClick>). This asserts both: the accessible name
 * flips with the state, and the input's type actually follows it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/settings.json";

vi.mock("../../../../../../../lib/hooks", () => ({
  useTestConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSecretsStatus: () => ({ data: undefined }),
}));

import { SettingsApiKeys } from "./SettingsApiKeys";

afterEach(cleanup);

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ settings: messages }}>
      <SettingsApiKeys />
    </NextIntlClientProvider>,
  );
}

describe("SettingsApiKeys — reveal toggle", () => {
  it("starts every row masked with a 'Show key' control", () => {
    renderWithIntl();
    const inputs = screen.getAllByPlaceholderText(messages.apiKeys.placeholder);
    expect(inputs).toHaveLength(4); // one per KEY_ROWS entry
    for (const input of inputs) expect(input).toHaveAttribute("type", "password");
    expect(screen.getAllByRole("button", { name: "Show key" })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Hide key" })).not.toBeInTheDocument();
  });

  it("reveals only the clicked row, flipping just its own control to 'Hide key'", () => {
    renderWithIntl();
    const revealButtons = screen.getAllByRole("button", { name: "Show key" });
    fireEvent.click(revealButtons[0]!);

    const inputs = screen.getAllByPlaceholderText(messages.apiKeys.placeholder);
    expect(inputs[0]).toHaveAttribute("type", "text");
    expect(inputs[1]).toHaveAttribute("type", "password"); // untouched sibling row

    expect(screen.getAllByRole("button", { name: "Show key" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Hide key" })).toHaveLength(1);
  });
});
