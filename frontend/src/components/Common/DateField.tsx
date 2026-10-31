import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { formatDate, istDateKey } from '../../utils/format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPUP_WIDTH = 312;
const POPUP_HEIGHT = 410;

const toKey = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Reads a fully typed DD-MM-YYYY as YYYY-MM-DD; '' if it isn't a real date. */
function parseTyped(text: string): string {
  const match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return '';
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2099 || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return toKey(year, month - 1, day);
}

/** Adds the dashes while the user types digits. */
function withDashes(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('-');
}

function CalendarPopup({ anchor, label, value, min, max, clearable, onPick, onClose }: {
  anchor: HTMLElement;
  label: string;
  value: string;
  min?: string;
  max?: string;
  clearable: boolean;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const today = istDateKey();
  const start = value || today;
  const [view, setView] = useState({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 });
  const popupRef = useRef<HTMLDivElement>(null);
  const [, reposition] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popupRef.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); anchor.focus(); }
    };
    // Stays on its field when the on-screen keyboard hides, which resizes the window
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    popupRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [anchor, onClose]);

  const shift = (months: number) => setView(v => {
    const total = v.year * 12 + v.month + months;
    return { year: Math.floor(total / 12), month: total % 12 };
  });

  const rect = anchor.getBoundingClientRect();
  const fitsBelow = rect.bottom + POPUP_HEIGHT + 8 <= window.innerHeight;
  const position: CSSProperties = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 8)),
    top: fitsBelow ? rect.bottom + 6 : Math.max(8, rect.top - POPUP_HEIGHT - 6),
  };

  const leadingBlanks = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const outOfRange = (key: string) => Boolean((min && key < min) || (max && key > max));

  return createPortal(
    <div ref={popupRef} className="date-popup" role="dialog" aria-label={label} style={position}>
      <div className="date-popup-label">{label}</div>
      <div className="date-popup-nav">
        <button type="button" onClick={() => shift(-12)} aria-label="Previous year"><ChevronsLeft size={18} /></button>
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
        <div className="date-popup-title" aria-live="polite">{MONTHS[view.month]} {view.year}</div>
        <button type="button" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={18} /></button>
        <button type="button" onClick={() => shift(12)} aria-label="Next year"><ChevronsRight size={18} /></button>
      </div>
      <div className="date-popup-grid">
        {WEEKDAYS.map(d => <div key={d} className="date-popup-weekday">{d}</div>)}
        {Array.from({ length: leadingBlanks }, (_, i) => <span key={`blank-${i}`} />)}
        {Array.from({ length: dayCount }, (_, i) => {
          const key = toKey(view.year, view.month, i + 1);
          const selected = key === value;
          return (
            <button key={key} type="button" disabled={outOfRange(key)} onClick={() => onPick(key)}
              aria-label={formatDate(key)} aria-pressed={selected}
              data-selected={selected || (!value && key === today)}
              className={`date-popup-day${selected ? ' is-selected' : ''}${key === today ? ' is-today' : ''}`}>
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="date-popup-footer">
        <button type="button" disabled={outOfRange(today)} onClick={() => onPick(today)}>Today</button>
        {clearable && value && <button type="button" onClick={() => onPick('')}>Clear</button>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The only date input in the system: always shows DD-MM-YYYY, whatever the browser's language.
 * `value` and `onChange` use YYYY-MM-DD, the same as a native date input.
 * `compact` is a calendar symbol for filter bars: `short` names it until a date is chosen, then the date shows.
 */
export default function DateField({ value, onChange, label, short, compact, required, min, max, style }: {
  value: string;
  onChange: (key: string) => void;
  label: string;
  short?: string;
  compact?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
  style?: CSSProperties;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [text, setText] = useState(formatDate(value));
  const iconRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setText(formatDate(value)), [value]);

  const close = useCallback(() => setAnchor(null), []);
  const toggle = () => setAnchor(current => (current ? null : iconRef.current));
  const pick = (key: string) => {
    onChange(key);
    close();
    iconRef.current?.focus();
  };

  const type = (raw: string) => {
    const next = withDashes(raw);
    setText(next);
    if (!next && !required) onChange('');
    else if (parseTyped(next)) onChange(parseTyped(next));
  };

  const popup = anchor && (
    <CalendarPopup anchor={anchor} label={label} value={value} min={min} max={max}
      clearable={!required} onPick={pick} onClose={close} />
  );

  if (compact) {
    return (
      <>
        <button ref={iconRef} type="button" title={value ? `${label}: ${formatDate(value)}` : label}
          aria-label={value ? `${label}: ${formatDate(value)}` : label} aria-expanded={Boolean(anchor)}
          className={`date-symbol${value ? ' is-set' : ''}`} style={style} onClick={toggle}>
          <Calendar size={18} />
          <span>{value ? formatDate(value) : short}</span>
        </button>
        {popup}
      </>
    );
  }

  return (
    <div className="date-field" style={style}>
      <input type="text" inputMode="numeric" className="form-input" placeholder="DD-MM-YYYY" aria-label={label}
        autoComplete="off" required={required} maxLength={10} value={text}
        onChange={e => type(e.target.value)} onBlur={() => setText(formatDate(value))} />
      <button ref={iconRef} type="button" className="date-field-icon" aria-label={`Choose ${label}`}
        aria-expanded={Boolean(anchor)} onClick={toggle}>
        <Calendar size={17} />
      </button>
      {popup}
    </div>
  );
}

/** Month picker for reports. `value` and `onChange` use YYYY-MM. */
export function MonthField({ value, onChange, style }: {
  value: string;
  onChange: (key: string) => void;
  style?: CSSProperties;
}) {
  const [year, month] = value.split('-');
  const thisYear = Number(istDateKey().slice(0, 4));
  const years = Array.from({ length: 5 }, (_, i) => thisYear + 1 - i);
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select className="form-select" aria-label="Month" value={month} style={{ width: 130, ...style }}
        onChange={e => onChange(`${year}-${e.target.value}`)}>
        {MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)}
      </select>
      <select className="form-select" aria-label="Year" value={year} style={{ width: 90, ...style }}
        onChange={e => onChange(`${e.target.value}-${month}`)}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
