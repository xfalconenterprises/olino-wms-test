import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

// An in-app yes/no question. The warehouse runs in kiosk mode, where a browser confirm box looks
// out of place, so pages ask with this instead:
//   const [confirmDialog, ask] = useConfirm();
//   if (!(await ask('Is it correct?'))) return;
//   ...render {confirmDialog}

interface Question {
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
}

export function useConfirm(): [ReactNode, (message: ReactNode, labels?: { confirm?: string; cancel?: string }) => Promise<boolean>] {
  const [question, setQuestion] = useState<Question | null>(null);
  const answer = useRef<(yes: boolean) => void>(() => {});

  const ask = useCallback((message: ReactNode, labels?: { confirm?: string; cancel?: string }) => new Promise<boolean>(resolve => {
    answer.current = resolve;
    setQuestion({ message, confirmLabel: labels?.confirm ?? 'Yes, it is correct', cancelLabel: labels?.cancel ?? 'No, let me fix it' });
  }), []);

  const close = (yes: boolean) => {
    setQuestion(null);
    answer.current(yes);
  };

  const dialog = question && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 20 }}>
      <div role="alertdialog" style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-xl)', padding: 22 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={24} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 15, lineHeight: 1.5, color: '#0f172a' }}>{question.message}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={() => close(false)} autoFocus>{question.cancelLabel}</button>
          <button type="button" className="btn btn-primary" onClick={() => close(true)}>{question.confirmLabel}</button>
        </div>
      </div>
    </div>
  );

  return [dialog, ask];
}
