import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TranscriptContent } from "./TranscriptContent";

afterEach(cleanup);

it("keeps successful transcription visible beside an insertion error", () => {
  render(<TranscriptContent transcript="Hello. Can you hear me?" error="Clipboard read failed." />);
  expect(screen.getByText("Hello. Can you hear me?")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Clipboard read failed.");
});

it("clearing an insertion error does not reveal previously hidden text", () => {
  const view = render(<TranscriptContent transcript="Already transcribed." error="Could not paste." />);
  expect(screen.getByText("Already transcribed.")).toBeVisible();
  view.rerender(<TranscriptContent transcript="Already transcribed." error={null} />);
  expect(screen.getByText("Already transcribed.")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});
