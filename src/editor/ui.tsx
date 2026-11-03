import React, { useId, useState } from 'react';

import { ChevronRight } from 'lucide-react';

const parseFr = (raw: string) => Number(raw.replace(/\s/g, '').replace(',', '.'));

/**
 * Shell of anything the user picks: an outlined tile that strengthens on hover
 * and turns blue when chosen, so every choice reads as clickable at rest.
 */
export const choiceClass = (active: boolean) =>
  `rounded border transition-colors duration-100 ${
    active ? 'border-accent bg-accent-soft text-ink' : 'border-edge bg-panel text-ink hover:border-edge-hover hover:bg-hover'
  }`;

/** Text-entry shell shared by selects, number fields and exact-value entries. */
const fieldClass =
  'rounded border border-edge bg-field hover:border-edge-hover focus:border-accent focus-within:border-accent outline-none';

/** Radio mark: an empty ring at rest, a filled blue dot when chosen. */
const RadioMark: React.FC<{ active: boolean }> = ({ active }) => (
  <span
    aria-hidden
    className={`grid place-items-center w-3.5 h-3.5 shrink-0 rounded-full border transition-colors duration-100 ${
      active ? 'border-accent bg-accent' : 'border-edge-hover bg-field'
    }`}
  >
    {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
  </span>
);

/** Inspector section: a title row that collapses its body. */
export const PanelSection: React.FC<{
  title: string;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, action, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="border-b border-line">
      <div className="flex items-center h-10 pl-2 pr-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex flex-1 items-center gap-1 h-full text-left text-xs font-semibold text-ink rounded"
        >
          <ChevronRight
            aria-hidden
            className={`w-3.5 h-3.5 text-ink-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
          {title}
        </button>
        {action}
      </div>
      {open && (
        <div id={bodyId} className="px-4 pb-4 space-y-3">
          {children}
        </div>
      )}
    </section>
  );
};

/** Label on the left, control on the right, on one 28px row. */
export const FieldRow: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-3 min-h-7">
    <span className="text-xs text-ink-muted truncate" title={hint}>
      {label}
    </span>
    <div className="flex items-center gap-2 shrink-0">{children}</div>
  </div>
);

export const SliderField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  /** Multiplier between the stored value and the unit typed by the user (100 for cm or %). */
  scale?: number;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, display, scale = 1, hint, disabled, onChange }) => {
  const id = useId();
  const fill = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  // The value reads as formatted text and becomes an exact numeric entry while focused.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const typed = parseFr(draft);
    setDraft(null);
    if (!Number.isFinite(typed)) return;
    onChange(Math.min(max, Math.max(min, typed / scale)));
  };
  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs text-ink-muted truncate" title={hint}>
          {label}
        </label>
        <input
          aria-label={`${label}, valeur exacte`}
          inputMode="decimal"
          disabled={disabled}
          value={draft ?? display}
          size={Math.max(3, (draft ?? display).length)}
          onFocus={(e) => {
            setDraft(String(Number((value * scale).toFixed(2))).replace('.', ','));
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          className={`min-w-10 max-w-40 h-6 px-1.5 text-right text-xs text-ink tabular-nums ${fieldClass}`}
        />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sf-range mt-1"
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
      />
    </div>
  );
};

export const Switch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-7 h-4 rounded-full transition-colors duration-150 disabled:opacity-40 ${
      checked ? 'bg-accent-strong' : 'bg-line-strong'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-150 ${
        checked ? 'translate-x-3' : ''
      }`}
    />
  </button>
);

export const ToggleField: React.FC<{
  label: string;
  checked: boolean;
  hint?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, hint, disabled, onChange }) => (
  <FieldRow label={label} hint={hint}>
    <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
  </FieldRow>
);

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
  size = 'md',
}: {
  value: T;
  options: { id: T; label: React.ReactNode; title?: string }[];
  onChange: (id: T) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`flex p-0.5 rounded-md bg-canvas border border-line ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded whitespace-nowrap transition-colors duration-100 ${
              size === 'sm' ? 'h-6 px-2 text-2xs' : 'h-7 px-2.5 text-xs'
            } ${
              active ? 'bg-raised text-ink font-medium shadow-thumb' : 'text-ink-muted hover:text-ink hover:bg-hover'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <FieldRow label={label}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className={`h-7 max-w-44 pl-2 pr-6 text-xs text-ink appearance-none bg-no-repeat bg-[right_6px_center] bg-[length:10px] cursor-pointer disabled:opacity-40 ${fieldClass}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23a3a3a3' fill='none' stroke-width='1.4'/%3E%3C/svg%3E\")",
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

/**
 * Single-choice list: one outlined row per option with a radio mark; the chosen
 * row shows its short secondary line.
 */
export function OptionList<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  columns = 1,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; detail?: string; leading?: React.ReactNode }[];
  onChange: (id: T) => void;
  disabled?: boolean;
  columns?: 1 | 2;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid gap-1 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'} ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.detail}
            onClick={() => onChange(o.id)}
            className={`flex items-center gap-2 min-h-8 px-2 py-1.5 text-left ${choiceClass(active)}`}
          >
            <RadioMark active={active} />
            {o.leading}
            <span className="flex-1 min-w-0">
              <span className={`block text-xs truncate text-ink ${active ? 'font-medium' : ''}`}>
                {o.label}
              </span>
              {o.detail && active && columns === 1 && (
                <span className="block mt-0.5 text-2xs text-ink-muted">{o.detail}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }
> = ({ variant = 'secondary', className = '', ...props }) => (
  <button
    type="button"
    {...props}
    className={`inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded transition-colors duration-100 whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${
      variant === 'primary'
        ? 'bg-accent-strong text-white hover:bg-accent-strong-hover'
        : variant === 'secondary'
          ? 'bg-raised text-ink border border-edge hover:border-edge-hover hover:bg-hover'
          : 'text-ink-muted hover:text-ink hover:bg-hover'
    } ${className}`}
  />
);

export const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }
> = ({ label, active, className = '', children, ...props }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...props}
    className={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors duration-100 disabled:opacity-35 disabled:pointer-events-none ${
      active ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:text-ink hover:bg-hover'
    } ${className}`}
  >
    {children}
  </button>
);

export const NumberField: React.FC<{
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}> = ({ label, value, step = 1, min, max, onChange }) => (
  <label className={`flex items-center h-7 ${fieldClass}`}>
    <span className="pl-2 pr-1 text-2xs text-ink-faint whitespace-nowrap">{label}</span>
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="w-full min-w-0 pr-2 bg-transparent text-xs text-ink tabular-nums text-right outline-none"
    />
  </label>
);
