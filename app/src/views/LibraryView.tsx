import { BookOpen, Copy, Eraser, History, RotateCcw, Trash2 } from "lucide-react";
import type { AppState, HistoryItem, LibraryMode, Settings } from "../types";
import { EmptyState, Field, RuleToggle, Toggle } from "../ui";
import { formatDuration } from "../types";

export function LibraryView({
  state,
  selectedHistory,
  libraryMode,
  newRuleSpoken,
  newRuleReplacement,
  onModeChange,
  onSelectHistory,
  onCopy,
  onReinsert,
  onDeleteHistory,
  onClearHistory,
  onUpdateSettings,
  onNewRuleSpoken,
  onNewRuleReplacement,
  onAddRule,
  onToggleRule,
  onRemoveRule,
}: {
  state: AppState;
  selectedHistory: HistoryItem | undefined;
  libraryMode: LibraryMode;
  newRuleSpoken: string;
  newRuleReplacement: string;
  onModeChange: (mode: LibraryMode) => void;
  onSelectHistory: (id: string) => void;
  onCopy: (text?: string | null) => void;
  onReinsert: (text?: string | null) => void;
  onDeleteHistory: (id: string) => void;
  onClearHistory: () => void;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onNewRuleSpoken: (value: string) => void;
  onNewRuleReplacement: (value: string) => void;
  onAddRule: () => void;
  onToggleRule: (id: string, enabled: boolean) => void;
  onRemoveRule: (id: string) => void;
}) {
  return (
    <section className="view library-view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Library</div>
          <h1>Local transcripts and replacements.</h1>
        </div>
        <div className="segmented" role="tablist" aria-label="Library mode">
          <button type="button" className={libraryMode === "history" ? "is-active" : ""} onClick={() => onModeChange("history")}>
            <History size={15} />
            <span>History</span>
          </button>
          <button type="button" className={libraryMode === "dictionary" ? "is-active" : ""} onClick={() => onModeChange("dictionary")}>
            <BookOpen size={15} />
            <span>Dictionary</span>
          </button>
        </div>
      </div>

      {libraryMode === "history" ? (
        <div className="history-layout">
          <div className="history-toolbar">
            <Toggle icon={History} label="Save local history" value={state.settings.history_enabled} onClick={() => onUpdateSettings({ history_enabled: !state.settings.history_enabled })} />
            <button type="button" className="secondary-action danger" disabled={state.history.length === 0} onClick={onClearHistory}>
              <Eraser size={16} />
              <span>Clear history</span>
            </button>
          </div>

          <div className="history-split">
            <div className="history-list">
              {state.history.length === 0 ? (
                <EmptyState icon={History} title={state.settings.history_enabled ? "No saved transcripts" : "Saved history is off"} />
              ) : (
                state.history.map((entry) => (
                  <button key={entry.id} type="button" className={`history-row ${selectedHistory?.id === entry.id ? "is-selected" : ""}`} onClick={() => onSelectHistory(entry.id)}>
                    <span className="history-time">{new Date(entry.created_at).toLocaleString()}</span>
                    <span className={`history-status tone-${entry.error ? "bad" : "good"}`}>{entry.insert_status}</span>
                    <span className="history-text">{entry.final_transcript}</span>
                  </button>
                ))
              )}
            </div>

            <article className="detail-block">
              <div className="block-head">
                <span>Selected transcript</span>
                <span>{formatDuration(selectedHistory?.duration_ms ?? null)}</span>
              </div>
              <p>{selectedHistory?.final_transcript || "Select a transcript."}</p>
              <div className="detail-meta">{selectedHistory?.error || "No error recorded"}</div>
              <div className="action-row">
                <button type="button" className="secondary-action" disabled={!selectedHistory} onClick={() => onCopy(selectedHistory?.final_transcript)}>
                  <Copy size={16} />
                  <span>Copy</span>
                </button>
                <button type="button" className="secondary-action" disabled={!selectedHistory} onClick={() => onReinsert(selectedHistory?.final_transcript)}>
                  <RotateCcw size={16} />
                  <span>Paste again</span>
                </button>
                <button type="button" className="secondary-action danger" disabled={!selectedHistory} onClick={() => selectedHistory && onDeleteHistory(selectedHistory.id)}>
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </div>
            </article>
          </div>
        </div>
      ) : (
        <div className="dictionary-layout">
          <div className="dictionary-form">
            <Field label="Spoken phrase" value={newRuleSpoken} onChange={onNewRuleSpoken} />
            <Field label="Replacement" value={newRuleReplacement} onChange={onNewRuleReplacement} />
            <button type="button" className="primary-action" onClick={onAddRule}>
              <BookOpen size={16} />
              <span>Add rule</span>
            </button>
          </div>

          <div className="rule-list">
            {state.dictionary.length === 0 ? (
              <EmptyState icon={BookOpen} title="No dictionary rules" />
            ) : (
              state.dictionary.map((rule) => (
                <article key={rule.id} className={`rule-row ${rule.enabled ? "is-on" : ""}`}>
                  <RuleToggle enabled={rule.enabled} onClick={() => onToggleRule(rule.id, !rule.enabled)} />
                  <div className="rule-text">
                    <span>{rule.spoken}</span>
                    <strong>{rule.replacement}</strong>
                  </div>
                  <button type="button" className="icon-action danger" onClick={() => onRemoveRule(rule.id)} aria-label={`Delete ${rule.spoken}`}>
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
