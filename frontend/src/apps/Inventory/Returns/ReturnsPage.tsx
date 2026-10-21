import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import CustomerReturnsTab from './CustomerReturnsTab';
import SupplierReturnsTab from './SupplierReturnsTab';
import '../../../styles/components.css';

export default function ReturnsPage() {
  const [tab, setTab] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Undo2 size={26} /> Returns</h1>
          <p className="page-subtitle">Goods coming back from customers, and goods going back to suppliers</p>
        </div>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 18 }}>
        {([['CUSTOMER', 'Customer Returns'], ['SUPPLIER', 'Return to Supplier']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, marginBottom: -1,
            borderBottom: tab === key ? '2px solid var(--color-brand)' : '2px solid transparent',
            color: tab === key ? 'var(--color-brand)' : 'var(--color-text-muted)', fontWeight: tab === key ? 700 : 500,
          }}>{label}</button>
        ))}
      </div>
      {tab === 'CUSTOMER' ? <CustomerReturnsTab /> : <SupplierReturnsTab />}
    </div>
  );
}
