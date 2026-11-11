import { useEffect, useState, type CSSProperties } from 'react';
import { Printer } from 'lucide-react';
import { getPrinterSettings, getWorkstationPrinterId, useAutoPrint } from '../../utils/printer';

// On the receiving screens: whether this computer prints each label as soon as a lump is received.
// Remembered on this computer only and off until turned on, so one person's choice never makes
// another computer print. When on, it names the printer the labels go to.

// The printer this computer's labels go to: its own choice in Printer Settings, else the default
function thisComputersPrinter(): Promise<string> {
  return getPrinterSettings()
    .then(s => (s.printers.find(p => p.id === getWorkstationPrinterId()) ?? s.defaultPrinter ?? s.printers[0])?.name ?? '')
    .catch(() => '');
}

export default function AutoPrintSwitch({ style }: { style?: CSSProperties }) {
  const [on, setOn] = useAutoPrint();
  const [printer, setPrinter] = useState('');

  useEffect(() => {
    if (!on) return;
    let live = true;
    thisComputersPrinter().then(name => { if (live) setPrinter(name); });
    return () => { live = false; };
  }, [on]);

  return (
    <label
      title="Saved on this computer only"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', minHeight: 40, borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13, fontWeight: 600, border: `1px solid ${on ? '#c4b5fd' : 'var(--color-border)'}`, background: on ? '#f5f3ff' : 'var(--color-surface, #fff)', color: on ? '#4c1d95' : 'var(--color-text-muted)', ...style }}
    >
      <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} aria-label="Print labels automatically on this computer"
        style={{ width: 18, height: 18, accentColor: 'var(--color-brand)', margin: 0 }} />
      <Printer size={16} />
      <span>Print labels automatically{on && printer && <span style={{ fontWeight: 500 }}> on {printer}</span>}</span>
    </label>
  );
}
