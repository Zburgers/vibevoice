import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WhisperUpdatePanel } from "./WhisperUpdatePanel";
import { fallbackState } from "./types";

afterEach(cleanup);
const state = { ...fallbackState, whisper_update: {
  engine_version: "1.9.4", engine_supported: true, model_name: "base.en", model_bytes: 147964211, busy: false,
} };

it("dispatches engine and model updates separately", () => {
  const onUpdate = vi.fn();
  render(<WhisperUpdatePanel state={state} progress={null} pending={false} onUpdate={onUpdate} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Update Whisper engine" }));
  fireEvent.click(screen.getByRole("button", { name: "Verify / repair model" }));
  expect(onUpdate.mock.calls).toEqual([["engine"], ["model"]]);
});

it("blocks both actions during recording", () => {
  render(<WhisperUpdatePanel state={{ ...state, voice_state: "Recording" }} progress={null} pending={false} onUpdate={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Update Whisper engine" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Verify / repair model" })).toBeDisabled();
});

it("shows download progress and allows cancellation while busy", () => {
  const onCancel = vi.fn();
  render(<WhisperUpdatePanel state={state} pending progress={{ component: "engine", stage: "downloading", downloaded_bytes: 25, total_bytes: 100, message: "Downloading: 25%" }} onUpdate={vi.fn()} onCancel={onCancel} />);
  expect(screen.getByRole("button", { name: "Update Whisper engine" })).toBeDisabled();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "25");
  expect(screen.getByRole("status")).toHaveTextContent("Downloading: 25%");
  fireEvent.click(screen.getByRole("button", { name: "Cancel update" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it("keeps model repair available when engine updates are unsupported", () => {
  render(<WhisperUpdatePanel state={{ ...state, whisper_update: { ...state.whisper_update, engine_supported: false } }} progress={null} pending={false} onUpdate={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Update Whisper engine" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Verify / repair model" })).toBeEnabled();
});
