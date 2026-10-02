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
    <span className={`status-chip tone-${phaseTone[phase]}`} title={phaseCopy[phase]}>
      <Icon size={14} aria-hidden="true" className={phase === "preparing" || phase === "transcribing" ? "spin" : ""} />
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

export function MicVisualizer({ bands = [], active, compact = false }: { bands?: readonly number[]; active: boolean; compact?: boolean }) {
  const bandLevel = (index: number) => {
    const value = bands[index];
    return active && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  };
  return (
    <span className={`mic-visualizer ${active ? "is-active" : ""} ${compact ? "is-compact" : ""}`} aria-hidden="true">
      {Array.from({ length: compact ? 6 : 12 }).map((_, index) => {
        const energy = compact ? Math.max(bandLevel(index * 2), bandLevel(index * 2 + 1)) : bandLevel(index);
        const height = Math.round((compact ? 3 : 4) + energy * (compact ? 19 : 34));
        return <span key={index} style={{ height: `${height}px`, opacity: active ? 0.3 + energy * 0.65 : 0.3 }} />;
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
