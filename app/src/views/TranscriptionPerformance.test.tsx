import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import { DiagnosticsView } from "./DiagnosticsView";
import { fallbackState } from "../types";

afterEach(cleanup);

describe("transcription performance controls", () => {
  it("saves a lower CPU budget without changing accuracy settings", () => {
    const onUpdate = vi.fn();
    render(<SettingsView state={fallbackState} onUpdate={onUpdate}
      onSetup={vi.fn()} onOpenReleasePage={vi.fn()} onOpenDiagnostics={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Transcription CPU threads/), { target: { value: "2" } });
    expect(onUpdate).toHaveBeenCalledWith({ transcription_threads: 2 });
  });

  it("shows actual elapsed time and Windows CPU measurement", () => {
    render(<DiagnosticsView state={{ ...fallbackState, last_transcription_metrics: {
      audio_ms: 11000, transcription_ms: 4000, session_ms: 15000, threads: 4,
      cpu_time_ms: 16000, average_cpu_percent: 50, peak_memory_mb: 300,
    } }} updateStatus={{ state: "idle", latestVersion: null, releaseUrl: "", message: "", canInstall: false }}
      setupMessage="" commandStatus="Idle" onRefresh={vi.fn()} onCheckUpdates={vi.fn()}
      onInstallUpdate={vi.fn()} onOpenReleasePage={vi.fn()} onSetup={vi.fn()}
      onCopyCommand={vi.fn()} onCopyReport={vi.fn()} />);
    expect(screen.getByText("4.00 s (4 threads)")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("16.00 CPU-seconds")).toBeInTheDocument();
  });
});
