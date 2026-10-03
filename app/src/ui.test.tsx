import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MicVisualizer } from "./ui";

afterEach(cleanup);

describe("frequency-band visualizer", () => {
  it("shows equal-strength low and high sounds in different bars", () => {
    const low = Array<number>(12).fill(0);
    const high = Array<number>(12).fill(0);
    low[2] = high[10] = 0.8;
    const view = render(<MicVisualizer bands={low} active />);
    const heights = () => Array.from(view.container.querySelectorAll(".mic-visualizer > span"))
      .map(bar => Number.parseInt((bar as HTMLElement).style.height));
    const lowHeights = heights();
    expect(lowHeights[2]).toBeGreaterThan(lowHeights[10]);
    view.rerender(<MicVisualizer bands={high} active />);
    const highHeights = heights();
    expect(highHeights[10]).toBeGreaterThan(highHeights[2]);
    expect(highHeights[10]).toEqual(lowHeights[2]);
  });

  it("stays quiet with missing data or when recording ends", () => {
    const view = render(<MicVisualizer active />);
    const quiet = () => Array.from(view.container.querySelectorAll(".mic-visualizer > span"))
      .every(bar => (bar as HTMLElement).style.height === "4px");
    expect(quiet()).toBe(true);
    view.rerender(<MicVisualizer active={false} bands={Array(12).fill(1)} />);
    expect(quiet()).toBe(true);
  });

  it("preserves high-frequency activity in the compact pill and clamps malformed values", () => {
    const view = render(<MicVisualizer compact active bands={[NaN, Infinity, -1, 0, 0, 0, 0, 0, 0, 0, 2, 0]} />);
    const bars = view.container.querySelectorAll(".mic-visualizer > span");
    expect(bars).toHaveLength(6);
    expect((bars[0] as HTMLElement).style.height).toBe("3px");
    expect((bars[5] as HTMLElement).style.height).toBe("22px");
  });
});
