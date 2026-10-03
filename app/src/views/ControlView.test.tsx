import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlView } from "./ControlView";
import { actionIcon, fallbackState, stateToPhase } from "../types";
import type { AppState } from "../types";

afterEach(cleanup);

function show(state: AppState = fallbackState) {
  const callbacks = {
    onPrimary: vi.fn(), onCopy: vi.fn(), onPaste: vi.fn(), onSetup: vi.fn(),
    onOpenReleasePage: vi.fn(), onOpenSettings: vi.fn(),
  };
  render(<ControlView state={state} phase={stateToPhase[state.voice_state]}
    commandStatus="Idle" recordingSeconds={73}
    primaryDisabled={false} ActionIcon={actionIcon(state.voice_state)}
    {...callbacks} />);
  return callbacks;
}

describe("control workspace actions", () => {
  it("shows a restore warning as inserted and labels a repeat paste explicitly", () => {
    show({ ...fallbackState, voice_state: "Inserted", last_transcript: "Already pasted",
      last_error: "Paste completed. Clipboard could not be restored. Do not retry." });
    expect(screen.getByRole("heading", { name: "Your words are in." })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry insertion" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste again" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Do not retry");
  });
  it.each(["Preparing", "Recording", "Processing"] as const)("protects the %s session from older transcript actions", (voice_state) => {
    const callbacks = show({ ...fallbackState, voice_state, last_transcript: "Previous words" });
    const copy = screen.getByRole("button", { name: "Copy transcript" });
    const paste = screen.getByRole("button", { name: "Retry insertion" });
    expect(copy).toBeDisabled();
    expect(paste).toBeDisabled();
    fireEvent.click(copy);
    fireEvent.click(paste);
    expect(callbacks.onCopy).not.toHaveBeenCalled();
    expect(callbacks.onPaste).not.toHaveBeenCalled();
  });
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
    expect(screen.getByRole("heading", { name: "Your last transcript is available." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry insertion" }));
    expect(callbacks.onCopy).toHaveBeenCalledOnce();
    expect(callbacks.onPaste).toHaveBeenCalledOnce();
  });

  it("allows cancelling microphone preparation while retaining setup", () => {
    const callbacks = show({ ...fallbackState, voice_state: "Preparing",
      diagnostics: { ...fallbackState.diagnostics, setup_available: true } });
    const cancel = screen.getByRole("button", { name: "Cancel start" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(callbacks.onPrimary).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Run setup" }));
    expect(callbacks.onSetup).toHaveBeenCalledOnce();
  });
});
