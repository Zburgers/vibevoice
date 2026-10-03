import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fallbackState } from "./types";
import type { AppState, Settings } from "./types";

const runtime = vi.hoisted(() => ({
  label: "main", invoke: vi.fn(), listeners: new Map<string, () => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (event: string, callback: () => void) => {
  runtime.listeners.set(event, callback);
  return () => runtime.listeners.delete(event);
}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: runtime.label, outerPosition: async () => ({ x: 0, y: 0 }),
    outerSize: async () => ({ width: 196, height: 80 }), setSize: async () => {} }),
  monitorFromPoint: async () => null, CursorIcon: {}, Window: {},
}));
vi.mock("./views/SettingsView", () => ({ SettingsView: ({ state, onUpdate }: {
  state: AppState; onUpdate: (patch: Partial<Settings>) => Promise<boolean>;
}) => <div>
  <span data-testid="saved-hotkey">{state.settings.hotkey}</span>
  <button onClick={() => void onUpdate({ hotkey: "Ctrl+Alt+K" })}>Change hotkey</button>
  <button onClick={() => void onUpdate({ dictionary_cleanup: false })}>Disable cleanup</button>
</div> }));
let saved: AppState;
beforeEach(() => {
  window.__TAURI_INTERNALS__ = {};
  runtime.label = "main";
  runtime.listeners.clear();
  runtime.invoke.mockReset();
  saved = structuredClone(fallbackState);
  runtime.invoke.mockImplementation(async (command: string, args?: { settings: Settings }) => {
    if (command === "get_app_state") return structuredClone(saved);
    if (command === "save_settings" && args) { saved.settings = args.settings; return args.settings; }
  });
});
afterEach(() => { cleanup(); delete window.__TAURI_INTERNALS__; });

describe("settings persistence and cross-window refresh", () => {
  it("refreshes the pill hotkey on the settings event without a recording transition", async () => {
    runtime.label = "pill";
    render(<App />);
    await screen.findByText("Ctrl+Alt+Space");
    await waitFor(() => expect(runtime.listeners.has("vibevoice-state-changed")).toBe(true));
    saved.settings.hotkey = "Ctrl+Alt+K";
    await act(async () => { runtime.listeners.get("vibevoice-state-changed")!(); });
    await screen.findByText("Ctrl+Alt+K");
    expect(runtime.invoke.mock.calls.every(([name]) => name === "get_app_state")).toBe(true);
  });
  it("serializes rapid saves and composes each patch with the last accepted settings", async () => {
    render(<App />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: "Settings" }));
    await screen.findByTestId("saved-hotkey");
    fireEvent.click(screen.getByRole("button", { name: "Change hotkey" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable cleanup" }));
    await waitFor(() => expect(runtime.invoke.mock.calls.filter(([name]) => name === "save_settings")).toHaveLength(2));
    expect(saved.settings).toMatchObject({ hotkey: "Ctrl+Alt+K", dictionary_cleanup: false });
  });
  it("retains accepted settings after OS registration rejects a change", async () => {
    runtime.invoke.mockImplementation(async (command: string) => {
      if (command === "get_app_state") return structuredClone(saved);
      if (command === "save_settings") throw new Error("Hotkey already registered by another app");
    });
    render(<App />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Change hotkey" }));
    await waitFor(() => expect(runtime.invoke.mock.calls.filter(([name]) => name === "get_app_state").length).toBeGreaterThan(1));
    expect(screen.getByTestId("saved-hotkey")).toHaveTextContent("Ctrl+Alt+Space");
  });
});
