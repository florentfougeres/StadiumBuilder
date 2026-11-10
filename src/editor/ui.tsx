import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ChevronRight, X } from 'lucide-react';
import { beginEditGesture } from '../state/useStadiumStore';

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

/* ------------------------------------------------------------------------------------------------
 * Modified fields
 *
 * A field given the value it had in the stadium's starting model shows a blue dot in the left
 * gutter while it differs; the dot (or a double-click on the label) puts the model value back.
 * Each field reports its state up through the sections around it, so a collapsed section can say
 * how many of its settings differ from the model.
 * ---------------------------------------------------------------------------------------------- */

interface ModifiedTracker {
  report: (key: string, modified: boolean) => void;
}

const ModifiedTrackerContext = createContext<ModifiedTracker | null>(null);

/** Equality used to decide whether a value still matches the model (float noise ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
}

/** Counts the modified fields reported from inside, and passes each report on to the parent. */
function useModifiedTracker(): [number, ModifiedTracker] {
  const parent = useContext(ModifiedTrackerContext);
  const keys = useRef(new Set<string>());
  const [count, setCount] = useState(0);
  const tracker = useMemo<ModifiedTracker>(
    () => ({
      report(key, modified) {
        const set = keys.current;
        if (modified) set.add(key);
        else set.delete(key);
        setCount(set.size);
        parent?.report(key, modified);
      },
    }),
    [parent]
  );
  return [count, tracker];
}

/** Reports one field's modified state to the enclosing sections for as long as it is mounted. */
function useReportModified(modified: boolean) {
  const tracker = useContext(ModifiedTrackerContext);
  const key = useId();
  useEffect(() => {
    tracker?.report(key, modified);
  }, [tracker, key, modified]);
  useEffect(() => () => tracker?.report(key, false), [tracker, key]);
}

/** Blue dot hung in the 16px gutter left of a modified field; clicking it restores the model value. */
const ResetDot: React.FC<{ label: string; disabled?: boolean; onReset: () => void; top?: boolean }> = ({
  label,
  disabled,
  onReset,
  top,
}) => (
  <button
    type="button"
    onClick={onReset}
    disabled={disabled}
    aria-label={`Rétablir « ${label} » à la valeur du modèle`}
    title="Modifié par rapport au modèle : cliquer pour rétablir"
    className={`absolute -left-4 grid place-items-center w-4 h-4 rounded-full hover:bg-hover disabled:pointer-events-none ${
      top ? 'top-2.5' : 'top-1/2 -translate-y-1/2'
    }`}
  >
    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />
  </button>
);

/** How many settings differ from the model, shown on a collapsed header. */
const ModifiedCount: React.FC<{ count: number }> = ({ count }) =>
  count > 0 ? (
    <span
      className="inline-flex items-center gap-1 shrink-0 text-2xs text-accent-ink tabular-nums"
      title={`${count} réglage${count > 1 ? 's' : ''} modifié${count > 1 ? 's' : ''} par rapport au modèle`}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />
      {count}
      <span className="sr-only"> modifié{count > 1 ? 's' : ''}</span>
    </span>
  ) : null;

/** Open state of sections that carry a `persistKey`, kept across tab switches for the session. */
const sectionOpenState = new Map<string, boolean>();

function usePersistedOpen(persistKey: string | undefined, defaultOpen: boolean) {
  const [open, setOpenState] = useState(() =>
    persistKey ? (sectionOpenState.get(persistKey) ?? defaultOpen) : defaultOpen
  );
  const setOpen = (next: boolean) => {
    if (persistKey) sectionOpenState.set(persistKey, next);
    setOpenState(next);
  };
  return [open, setOpen] as const;
}

/**
 * Inspector section: a title row that collapses its body. Closed, the row keeps a short summary
 * of what is inside and how many settings differ from the model. The body stays mounted while
 * closed so those counts hold.
 */
export const PanelSection: React.FC<{
  title: string;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  /** Remembers the open state under this key while the page is open. */
  persistKey?: string;
  /** Short state of the section, shown on the title row while it is closed. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, action, defaultOpen = true, persistKey, summary, children }) => {
  const [open, setOpen] = usePersistedOpen(persistKey, defaultOpen);
  const [modifiedCount, tracker] = useModifiedTracker();
  const bodyId = useId();
  return (
    <section className="border-b border-line">
      <div className="flex items-center min-h-10 pl-2 pr-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex flex-1 min-w-0 items-center gap-1 min-h-10 py-2 text-left text-xs font-semibold text-ink rounded"
        >
          <ChevronRight
            aria-hidden
            className={`w-3.5 h-3.5 shrink-0 text-ink-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
          <span className="shrink-0">{title}</span>
          {!open && (
            <span className="flex flex-1 min-w-0 items-center justify-end gap-2 pl-3 font-normal">
              {summary && <span className="min-w-0 truncate text-2xs text-ink-faint">{summary}</span>}
              <ModifiedCount count={modifiedCount} />
            </span>
          )}
        </button>
        {action}
      </div>
      <ModifiedTrackerContext.Provider value={tracker}>
        <div id={bodyId} hidden={!open} className="px-4 pb-4 space-y-3">
          {children}
        </div>
      </ModifiedTrackerContext.Provider>
    </section>
  );
};

/** Inside Avancé, top-level groups fold on their own; groups nested in them stay plain headings. */
const AdvancedTabContext = createContext<string | null>(null);

/**
 * The collapsed home of a tab's expert settings, closed by default and remembered per tab.
 * Its direct `SubGroup`s fold one by one, so opening Avancé shows a short list of topics.
 */
export const AdvancedSection: React.FC<{ tab: string; children: React.ReactNode }> = ({ tab, children }) => (
  <PanelSection title="Avancé" defaultOpen={false} persistKey={`advanced:${tab}`}>
    <AdvancedTabContext.Provider value={tab}>
      <div className="-mx-4 -mb-4 -mt-1">{children}</div>
    </AdvancedTabContext.Provider>
  </PanelSection>
);

const FoldingGroup: React.FC<{
  title: string;
  persistKey: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, persistKey, summary, children }) => {
  const [open, setOpen] = usePersistedOpen(persistKey, false);
  const [modifiedCount, tracker] = useModifiedTracker();
  const bodyId = useId();
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-1 min-h-9 pl-5 pr-3 text-left text-xs text-ink-muted hover:text-ink"
      >
        <ChevronRight
          aria-hidden
          className={`w-3 h-3 shrink-0 text-ink-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <span className={`shrink-0 ${open ? 'text-ink font-medium' : ''}`}>{title}</span>
        <span className="flex flex-1 min-w-0 items-center justify-end gap-2 pl-3">
          {!open && summary && <span className="min-w-0 truncate text-2xs text-ink-faint">{summary}</span>}
          {!open && <ModifiedCount count={modifiedCount} />}
        </span>
      </button>
      <ModifiedTrackerContext.Provider value={tracker}>
        <AdvancedTabContext.Provider value={null}>
          <div id={bodyId} hidden={!open} className="px-4 pt-1 pb-4 space-y-3">
            {children}
          </div>
        </AdvancedTabContext.Provider>
      </ModifiedTrackerContext.Provider>
    </div>
  );
};

/**
 * A titled group of fields. Directly inside Avancé it folds on its own (closed by default,
 * remembered per tab); anywhere else it is a plain heading over its fields.
 */
export const SubGroup: React.FC<{ title: string; summary?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  summary,
  children,
}) => {
  const advancedTab = useContext(AdvancedTabContext);
  if (advancedTab !== null) {
    return (
      <FoldingGroup title={title} summary={summary} persistKey={`advanced:${advancedTab}:${title}`}>
        {children}
      </FoldingGroup>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-2xs font-medium text-ink-faint">{title}</h3>
      {children}
    </div>
  );
};

/**
 * Label on the left, control on the right, on one 28px row. With `onReset`, the row is marked
 * modified and the label's double-click (or the gutter dot) restores the model value.
 */
export const FieldRow: React.FC<{
  label: string;
  hint?: string;
  /** Present while the value differs from the model: restores it. */
  onReset?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, hint, onReset, disabled, children }) => {
  useReportModified(onReset !== undefined);
  return (
    <div className="relative flex items-center justify-between gap-3 min-h-7">
      {onReset && <ResetDot label={label} disabled={disabled} onReset={onReset} />}
      <span
        className="min-w-0 text-xs leading-snug text-ink-muted"
        title={hint}
        onDoubleClick={disabled ? undefined : onReset}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
};

/** `onReset` for a field whose model value is known: defined only while the value differs. */
export function resetTo<T>(value: T, modelValue: T | undefined, apply: (value: T) => void) {
  return modelValue === undefined || sameValue(value, modelValue) ? undefined : () => apply(modelValue);
}

/**
 * Gives the modified mark to a control that has no label row of its own (picture gallery,
 * option list, bare segmented control): the dot hangs in the gutter beside it.
 */
export function Resettable<T>({
  label,
  value,
  defaultValue,
  onChange,
  disabled,
  top,
  children,
}: {
  label: string;
  value: T;
  defaultValue: T | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Aligns the dot with the first row rather than the middle (tall lists). */
  top?: boolean;
  children: React.ReactNode;
}) {
  const onReset = resetTo(value, defaultValue, onChange);
  useReportModified(onReset !== undefined);
  return (
    <div className="relative">
      {onReset && <ResetDot label={label} disabled={disabled} onReset={onReset} top={top} />}
      {children}
    </div>
  );
}

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
  /** The value in the stadium's starting model: marks the field while it differs. */
  defaultValue?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, display, scale = 1, hint, disabled, defaultValue, onChange }) => {
  const id = useId();
  const onReset = resetTo(value, defaultValue, onChange);
  useReportModified(onReset !== undefined);
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
      <div className="relative flex items-baseline justify-between gap-3">
        {onReset && <ResetDot label={label} disabled={disabled} onReset={onReset} />}
        <label
          htmlFor={id}
          className="min-w-0 text-xs leading-snug text-ink-muted"
          title={hint}
          onDoubleClick={disabled ? undefined : onReset}
        >
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
        onPointerDown={beginEditGesture}
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
  /** The value in the stadium's starting model: marks the field while it differs. */
  defaultValue?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, hint, disabled, defaultValue, onChange }) => (
  <FieldRow label={label} hint={hint} disabled={disabled} onReset={resetTo(checked, defaultValue, onChange)}>
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
  nowrap = false,
}: {
  value: T;
  options: { id: T; label: React.ReactNode; title?: string }[];
  onChange: (id: T) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Keeps every label on one line (toolbar); panel controls wrap long labels inside the button. */
  nowrap?: boolean;
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
            className={`flex-1 ${size === 'sm' ? 'min-w-7' : 'min-w-0'} flex items-center justify-center gap-1.5 rounded text-center leading-tight transition-colors duration-100 ${nowrap ? 'whitespace-nowrap' : ''} ${
              size === 'sm' ? 'min-h-6 py-0.5 px-1.5 text-2xs' : 'min-h-7 py-1 px-2 text-xs'
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
  defaultValue,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
  /** The value in the stadium's starting model: marks the field while it differs. */
  defaultValue?: T;
}) {
  return (
    <FieldRow label={label} disabled={disabled} onReset={resetTo(value, defaultValue, onChange)}>
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
  defaultValue,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; detail?: string; leading?: React.ReactNode }[];
  onChange: (id: T) => void;
  disabled?: boolean;
  columns?: 1 | 2;
  /** The value in the stadium's starting model: marks the list while it differs. */
  defaultValue?: T;
}) {
  return (
    <Resettable label={label} value={value} defaultValue={defaultValue} onChange={onChange} disabled={disabled} top>
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
            className={`flex items-center gap-2 min-h-9 min-w-0 px-2 py-1.5 text-left ${choiceClass(active)}`}
          >
            <RadioMark active={active} />
            {o.leading}
            <span className="flex-1 min-w-0">
              <span className={`block text-xs leading-snug text-ink break-words ${active ? 'font-medium' : ''}`}>
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
    </Resettable>
  );
}

/**
 * Open/close state and keyboard behaviour of a top-bar popup menu: outside click and Escape close
 * it (Escape returns focus to the trigger), opening focuses the first item, and the arrow keys,
 * Home and End move between the enabled `menuitem`s.
 */
export function usePopupMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown' ? list[(i + 1) % list.length]
      : e.key === 'ArrowUp' ? list[(i - 1 + list.length) % list.length]
      : e.key === 'Home' ? list[0]
      : e.key === 'End' ? list[list.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  return { open, setOpen, rootRef, triggerRef, menuProps: { ref: menuRef, role: 'menu', onKeyDown: onMenuKeyDown } };
}

export const Button: React.FC<
  React.ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' }
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

/**
 * Square icon control. `active` marks a toggled state: it is drawn in blue and exposed as
 * `aria-pressed`, unless the caller swaps the label between the two states instead
 * (then pass `aria-pressed={undefined}`).
 */
export const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }
> = ({ label, active, className = '', children, ...props }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    title={label}
    {...props}
    className={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors duration-100 disabled:opacity-35 disabled:pointer-events-none ${
      active ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:text-ink hover:bg-hover'
    } ${className}`}
  >
    {children}
  </button>
);

/** Short text on one row, committed on Enter or when leaving the field rather than per keystroke. */
export const TextField: React.FC<{
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, maxLength, hint, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };
  return (
    <FieldRow label={label} hint={hint}>
      <input
        type="text"
        aria-label={label}
        value={draft ?? value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className={`w-36 h-7 px-2 text-xs text-ink ${fieldClass}`}
      />
    </FieldRow>
  );
};

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

/**
 * Number in a table cell: reads as formatted text, becomes an exact entry while focused (Enter
 * commits, Escape cancels), and the up/down arrows step it (Shift for ten steps).
 */
export const CellNumber: React.FC<{
  /** Accessible name, e.g. « Rangs, étage 2 ». */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  /** Multiplier between the stored value and the unit typed by the user. */
  scale?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, display, scale = 1, disabled, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const commit = () => {
    if (draft === null) return;
    const typed = parseFr(draft);
    setDraft(null);
    if (Number.isFinite(typed)) onChange(clamp(typed / scale));
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      disabled={disabled}
      value={draft ?? display}
      onFocus={(e) => {
        setDraft(String(Number((value * scale).toFixed(2))).replace('.', ','));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          onChange(next);
          setDraft(String(Number((next * scale).toFixed(2))).replace('.', ','));
        }
      }}
      className={`w-full h-7 px-1.5 text-right text-xs text-ink tabular-nums disabled:opacity-40 ${fieldClass}`}
    />
  );
};

export interface GalleryOption<T extends string> {
  id: T;
  label: string;
  detail?: string;
  /** Rendered thumbnail; when it fails to load the tile keeps a plain face. */
  image?: string;
  /** Drawn preview instead of an image (material swatches). */
  preview?: React.ReactNode;
}

const GalleryVisual: React.FC<{ option: GalleryOption<string>; className: string }> = ({ option, className }) => {
  const [failed, setFailed] = useState(false);
  if (option.preview) {
    return <span className={`${className} grid overflow-hidden [&>*]:w-full [&>*]:h-full`}>{option.preview}</span>;
  }
  if (option.image && !failed) {
    return (
      <img
        src={option.image}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${className} object-cover`}
      />
    );
  }
  return <span aria-hidden className={`${className} bg-canvas`} />;
};

/**
 * A big choice (stadium shape, roof system, facade material): the current option on one row with
 * its picture; clicking opens a grid of pictured tiles beside the side panel, over the viewport.
 */
export function GalleryPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  defaultValue,
}: {
  label: string;
  value: T;
  options: GalleryOption<T>[];
  onChange: (id: T) => void;
  disabled?: boolean;
  /** The value in the stadium's starting model: marks the picker while it differs. */
  defaultValue?: T;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const current = options.find((o) => o.id === value);

  // Beside the side panel on desktop; over the panel itself when it is a full-width drawer.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const panel = triggerRef.current?.closest('[data-side-panel]')?.getBoundingClientRect();
      if (!panel) return;
      const vw = window.innerWidth;
      const room = vw - panel.right - 16;
      const left = room >= 360 ? panel.right + 8 : panel.left + 8;
      setBox({
        left,
        top: panel.top + 8,
        bottom: window.innerHeight - panel.bottom + 8,
        width: Math.min(640, vw - left - 8),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const columns = box && box.width >= 600 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <Resettable label={label} value={value} defaultValue={defaultValue} onChange={onChange} disabled={disabled}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} : ${current?.label ?? ''}, changer`}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-3 w-full p-1.5 pr-2 text-left disabled:opacity-40 disabled:pointer-events-none ${choiceClass(open)}`}
      >
        {current && <GalleryVisual option={current} className="w-[72px] h-11 shrink-0 rounded-sm" />}
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-medium leading-snug text-ink">{current?.label ?? '—'}</span>
          {current?.detail && (
            <span className="block mt-0.5 text-2xs leading-snug text-ink-muted">{current.detail}</span>
          )}
        </span>
        <span className="flex items-center gap-0.5 shrink-0 text-2xs text-ink-muted">
          Changer
          <ChevronRight aria-hidden className="w-3.5 h-3.5" />
        </span>
      </button>
      {open &&
        box &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-labelledby={titleId}
            style={{ left: box.left, top: box.top, bottom: box.bottom, width: box.width }}
            className="fixed z-50 flex flex-col rounded-md bg-panel border border-line shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
          >
            <div className="flex items-center gap-2 h-11 pl-4 pr-2 border-b border-line shrink-0">
              <h2 id={titleId} className="flex-1 text-sm font-semibold text-ink">
                {label}
              </h2>
              <span className="text-2xs text-ink-faint tabular-nums">{options.length} choix</span>
              <IconButton
                label="Fermer"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>
            <div role="radiogroup" aria-label={label} className={`grid ${columns} gap-2 p-3 overflow-y-auto`}>
              {options.map((o) => {
                const active = o.id === value;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={`flex flex-col gap-1.5 p-1.5 text-left ${choiceClass(active)}`}
                  >
                    <GalleryVisual option={o} className="w-full aspect-[36/22] rounded-sm" />
                    <span className="flex items-start gap-1.5 px-0.5">
                      <RadioMark active={active} />
                      <span className="flex-1 min-w-0">
                        <span className={`block text-xs leading-snug text-ink ${active ? 'font-medium' : ''}`}>
                          {o.label}
                        </span>
                        {o.detail && (
                          <span className="block mt-0.5 text-2xs leading-snug text-ink-muted">{o.detail}</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </Resettable>
  );
}
