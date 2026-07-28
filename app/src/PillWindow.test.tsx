import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Mic } from "lucide-react";
import { PillWindow } from "./PillWindow";
import { fallbackState, stateToPhase } from "./types";

describe("pill renderer regressions", () => {
  it("keeps content visible through repeated expand/collapse transitions", () => {
    const view = render(
      <PillWindow
        state={fallbackState}
        phase={stateToPhase.Ready}
        expanded={false}
        lastText="No transcript captured yet."
        recordingSeconds={0}
        primaryDisabled={false}
        ActionIcon={Mic}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
        onDrag={vi.fn()}
        onPrimary={vi.fn()}
        onPaste={vi.fn()}
        onOpenMain={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("button", { name: /open controls/i });
    expect(toggle).toBeVisible();
    for (let index = 0; index < 12; index += 1) {
      view.rerender(
        <PillWindow
          state={fallbackState}
          phase={stateToPhase.Ready}
          expanded={index % 2 === 0}
          lastText="No transcript captured yet."
          recordingSeconds={0}
          primaryDisabled={false}
          ActionIcon={Mic}
          onToggleExpanded={vi.fn()}
          onCollapse={vi.fn()}
          onDrag={vi.fn()}
          onPrimary={vi.fn()}
          onPaste={vi.fn()}
          onOpenMain={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: /open controls/i })).toBeVisible();
      if (index % 2 === 0) expect(screen.getByText("No transcript captured yet.")).toBeVisible();
      fireEvent.mouseMove(document.body);
    }
  });
});
