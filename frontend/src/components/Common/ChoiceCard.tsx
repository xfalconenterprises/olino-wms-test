import type { ReactNode } from 'react';

// Large option button for choosing what to do next. `large` makes it a tall, centred card for
// touch screens.
export default function ChoiceCard({ icon, title, subtitle, badge, large, onClick }: {
  icon: ReactNode; title: string; subtitle: string; badge?: string; large?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '1 1 220px', textAlign: large ? 'center' : 'left', cursor: 'pointer', padding: large ? '36px 24px' : '18px 20px', borderRadius: 'var(--radius-lg)',
        border: '1.5px solid var(--color-border)', background: '#fff', display: 'flex', flexDirection: large ? 'column' : 'row',
        alignItems: large ? 'center' : 'flex-start', justifyContent: large ? 'center' : undefined, gap: large ? 16 : 14, minHeight: large ? 220 : undefined,
        position: 'relative', transition: 'border-color 0.15s ease, box-shadow 0.15s ease', touchAction: 'manipulation',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.06)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <span style={{ width: large ? 72 : 42, height: large ? 72 : 42, borderRadius: large ? 18 : 10, background: 'var(--color-brand-faded)', color: 'var(--color-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      <span>
        <span style={{ display: 'block', fontSize: large ? 20 : 15, fontWeight: 700, color: '#0f172a' }}>{title}</span>
        <span style={{ display: 'block', fontSize: large ? 14 : 12.5, color: 'var(--color-text-muted)', marginTop: large ? 6 : 3 }}>{subtitle}</span>
      </span>
      {badge && (
        <span style={{ position: 'absolute', top: 10, right: 12, fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10 }}>
          {badge}
        </span>
      )}
    </button>
  );
}
