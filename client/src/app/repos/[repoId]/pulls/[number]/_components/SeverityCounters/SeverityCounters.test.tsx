import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SeverityCounters } from "./SeverityCounters";

afterEach(cleanup);

const COUNTS = { CRITICAL: 3, WARNING: 5, SUGGESTION: 2 };

describe("SeverityCounters (smoke)", () => {
  it("renders a chip with its count for every severity", () => {
    render(<SeverityCounters counts={COUNTS} active={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /CRITICAL/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /WARNING/ })).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: /SUGGESTION/ })).toHaveTextContent("2");
  });

  it("shows only the severities this run actually has", () => {
    render(
      <SeverityCounters
        counts={{ CRITICAL: 0, WARNING: 2, SUGGESTION: 0 }}
        active={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /WARNING/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CRITICAL/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SUGGESTION/ })).not.toBeInTheDocument();
  });

  it("renders nothing when the run has no findings", () => {
    const { container } = render(
      <SeverityCounters
        counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }}
        active={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selects a severity on click", () => {
    const onSelect = vi.fn();
    render(<SeverityCounters counts={COUNTS} active={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/ }));
    expect(onSelect).toHaveBeenCalledWith("CRITICAL");
  });

  it("clears the filter when the active chip is clicked again", () => {
    const onSelect = vi.fn();
    render(<SeverityCounters counts={COUNTS} active="CRITICAL" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
