import {
  CheckCircle2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { phaseCopy, phaseIcons, phaseTone } from "./types";
import type { Phase } from "./types";

export function StatusChip({ phase }: { phase: Phase }) {
  const Icon = phaseIcons[phase];
  return (
    <span className={`status-chip tone-${phaseTone[phase]}`}>
      <Icon size={14} className={phase === "preparing" || phase === "transcribing" ? "spin" : ""} />
      <span>{phaseCopy[phase]}</span>
    </span>
  );
}

export function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <article className="metric-card">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function MicVisualizer({ level, active, compact = false }: { level: number; active: boolean; compact?: boolean }) {
  const normalized = Math.max(0.04, Math.min(1, level || 0));
  return (
    <span className={`mic-visualizer ${active ? "is-active" : ""} ${compact ? "is-compact" : ""}`} aria-hidden="true">
      {Array.from({ length: compact ? 6 : 12 }).map((_, index) => {
        const wave = active ? Math.abs(Math.sin(index * 0.72 + normalized * 2.8)) : 0.16;
        const height = Math.round((compact ? 8 : 18) + (active ? Math.max(normalized, wave * normalized) : wave) * (compact ? 16 : 34));
        return <span key={index} style={{ height: `${height}px` }} />;
      })}
    </span>
  );
}

export function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Toggle({ icon: Icon, label, value, onClick }: { icon: LucideIcon; label: string; value: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`toggle ${value ? "is-on" : ""}`} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value ? "On" : "Off"}</strong>
    </button>
  );
}

export function RuleToggle({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="rule-toggle" onClick={onClick}>
      {enabled ? <CheckCircle2 size={15} /> : <X size={15} />}
      <span>{enabled ? "On" : "Off"}</span>
    </button>
  );
}

export function EmptyState({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="empty-state">
      <Icon size={22} />
      <span>{title}</span>
    </div>
  );
}
