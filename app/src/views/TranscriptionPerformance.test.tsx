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

  it("exposes the short model strategy and output modes", () => {
    const onUpdate = vi.fn();
    render(<SettingsView state={fallbackState} onUpdate={onUpdate}
      onSetup={vi.fn()} onOpenReleasePage={vi.fn()} onOpenDiagnostics={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Short recording model"), { target: { value: "base_only" } });
    fireEvent.change(screen.getByLabelText("Output mode"), { target: { value: "polished" } });
    expect(onUpdate).toHaveBeenCalledWith({ model_strategy: "base_only" });
    expect(onUpdate).toHaveBeenCalledWith({ output_mode: "polished" });
  });

  it("shows actual elapsed time and Windows CPU measurement", () => {
    render(<DiagnosticsView state={{ ...fallbackState, last_transcription_metrics: {
      audio_ms: 11000, transcription_ms: 4000, session_ms: 15000, threads: 4,
      preprocessing_ms: 12, postprocess_ms: 2, insertion_ms: 25, stop_to_insert_ms: 4040,
      model_variant: "my-finetuned-whisper.bin", fast_model_fallback: true,
      cpu_time_ms: null, average_cpu_percent: null, peak_memory_mb: null,
    } }} updateStatus={{ state: "idle", latestVersion: null, releaseUrl: "", message: "", canInstall: false }}
      setupMessage="" commandStatus="Idle" onRefresh={vi.fn()} onCheckUpdates={vi.fn()}
      onInstallUpdate={vi.fn()} onOpenReleasePage={vi.fn()} onSetup={vi.fn()}
      onCopyCommand={vi.fn()} onCopyReport={vi.fn()} />);
    expect(screen.getByText("4.00 s (4 threads)")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable after fallback")).toHaveLength(3);
    expect(screen.getByText("4.04 s")).toBeInTheDocument();
    expect(screen.getByText("my-finetuned-whisper.bin")).toBeInTheDocument();
    expect(screen.getByText("tiny.en failed; using my-finetuned-whisper.bin. Replace the tiny model or restart after repair to retry.")).toBeInTheDocument();
  });
});
