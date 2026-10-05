import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PillWindow } from "./PillWindow";
import { fallbackState, stateToPhase, actionIcon } from "./types";
import type { VoiceState } from "./types";
import "./App.css";
function Preview() {
  const [expanded, setExpanded] = useState(false);
  const states: VoiceState[] = ["Ready", "Preparing", "Recording", "Processing", "Error", "Inserted", "Copied"];
  const props = (voice_state: VoiceState) => ({
    state: { ...fallbackState, voice_state, last_transcript: voice_state === "Ready" ? "" : "Transcript ".repeat(100) },
    phase: stateToPhase[voice_state], lastText: voice_state === "Error" ? "Could not transcribe. Try recording again." : "A transcript that stays readable in the compact menu. ".repeat(10),
    recordingSeconds: 12, primaryDisabled: false, ActionIcon: actionIcon(voice_state),
    onToggleExpanded: () => setExpanded(value => !value), onCollapse: () => setExpanded(false),
    onDrag: () => {}, onPrimary: () => {}, onCopy: () => {}, onPaste: () => {}, onOpenMain: () => {},
  });
  return <div style={{ height: "100%", overflow: "auto", background: "var(--bg)", padding: 24 }}>
    <h1>Pill preview</h1><div style={{ width: expanded ? 340 : 196, height: expanded ? 280 : 80 }}><PillWindow {...props("Ready")} expanded={expanded} /></div>
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{states.map(state => <div key={state}><p>{state}</p><div style={{ width: 340, height: 280 }}><PillWindow {...props(state)} expanded /></div></div>)}</div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
