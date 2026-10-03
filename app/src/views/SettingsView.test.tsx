import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import { fallbackState } from "../types";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));

function setup() {
  const onUpdate = vi.fn().mockResolvedValue(true);
  const view = render(<SettingsView state={fallbackState} onUpdate={onUpdate}
    onSetup={vi.fn()} onOpenReleasePage={vi.fn()} onOpenDiagnostics={vi.fn()} />);
  return { ...view, onUpdate };
}
beforeEach(() => { invoke.mockReset().mockResolvedValue(null); });
afterEach(cleanup);

describe("settings controls", () => {
  it("keeps Automatic separate and waits for Save before persisting typed paths", async () => {
    const { onUpdate } = setup();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Whisper binary path"), { target: { value: "custom" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Whisper binary path custom file" }), { target: { value: "C:\\tools\\whisper-cli.exe" } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save path" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ whisper_binary_path: "C:\\tools\\whisper-cli.exe" }));
  });
  it("uses the native picker and leaves settings alone on cancellation or invalid selection", async () => {
    const { onUpdate } = setup();
    fireEvent.change(screen.getByLabelText("Model path"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pick_engine_file", { model: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Browse…" })).toBeEnabled());
    expect(onUpdate).not.toHaveBeenCalled();
    invoke.mockRejectedValueOnce("Unsupported model header");
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported model header");
    expect(onUpdate).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce("C:\\models\\ggml-base.en.bin");
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ model_path: "C:\\models\\ggml-base.en.bin" }));
  });
  it("preserves modifiers even when they are released before the main key", async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByText("Press your hotkey combo…");
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    fireEvent.keyUp(window, { key: "Control", code: "ControlLeft", altKey: true });
    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    expect(onUpdate).toHaveBeenCalledWith({ hotkey: "Ctrl+Alt+K" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_hotkey_capture", { capturing: false }));
  });
  it("cancels on Escape without saving Escape as a hotkey", async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByText("Press your hotkey combo…");
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    fireEvent.keyUp(window, { key: "Escape", code: "Escape" });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
  });
  it("records physical punctuation keys rather than unsupported symbol names", async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByText("Press your hotkey combo…");
    fireEvent.keyDown(window, { key: "?", code: "Slash", ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: "/", code: "Slash" });
    expect(onUpdate).toHaveBeenCalledWith({ hotkey: "Ctrl+Shift+Slash" });
  });
});
