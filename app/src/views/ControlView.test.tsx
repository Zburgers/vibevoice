import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlView } from "./ControlView";
import { actionIcon, canStartOrStop, fallbackState, stateToPhase } from "../types";
import type { AppState } from "../types";

afterEach(cleanup);

function show(state: AppState = fallbackState) {
  const callbacks = {
    onPrimary: vi.fn(), onCopy: vi.fn(), onPaste: vi.fn(), onSetup: vi.fn(),
    onOpenReleasePage: vi.fn(), onOpenSettings: vi.fn(),
  };
  render(<ControlView state={state} phase={stateToPhase[state.voice_state]}
    commandStatus="Idle" recordingSeconds={73}
    primaryDisabled={!canStartOrStop(state.voice_state)} ActionIcon={actionIcon(state.voice_state)}
    {...callbacks} />);
  return callbacks;
}

describe("control workspace actions", () => {
  it("keeps transcription cancellation available during processing", () => {
    const callbacks = show({ ...fallbackState, voice_state: "Processing" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel transcription" }));
    expect(callbacks.onPrimary).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Turning voice into text." })).toBeVisible();
  });

  it("shows recording duration independently of the shortcut and stops recording", () => {
    const callbacks = show({ ...fallbackState, voice_state: "Recording" });
    expect(screen.getByLabelText("Recording duration: 73 seconds")).toHaveTextContent("1:13");
    expect(screen.getByRole("group", { name: "Ctrl+Alt+Space" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(callbacks.onPrimary).toHaveBeenCalledOnce();
  });

  it("disables transcript actions until there is text, and retains setup and settings", () => {
    const callbacks = show();
    expect(screen.getByRole("button", { name: "Copy transcript" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry insertion" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Install guide" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(callbacks.onOpenReleasePage).toHaveBeenCalledOnce();
    expect(callbacks.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("retains transcript recovery actions when an error follows a previous transcript", () => {
    const callbacks = show({ ...fallbackState, voice_state: "Error",
      last_transcript: "Keep this transcript.", last_error: "Could not insert into the focused app." });
    expect(screen.getByText("Could not insert into the focused app.")).toBeVisible();
    expect(screen.getByText("Keep this transcript.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Your transcript is ready." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry insertion" }));
    expect(callbacks.onCopy).toHaveBeenCalledOnce();
    expect(callbacks.onPaste).toHaveBeenCalledOnce();
  });

  it("keeps the preparing action disabled while showing the setup command when available", () => {
    const callbacks = show({ ...fallbackState, voice_state: "Preparing",
      diagnostics: { ...fallbackState.diagnostics, setup_available: true } });
    expect(screen.getByRole("button", { name: "Starting" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run setup" }));
    expect(callbacks.onSetup).toHaveBeenCalledOnce();
  });
});
