import { Navigate, Route, Routes } from 'react-router-dom';
import { IndianRupee } from 'lucide-react';
import { useCostUnlock, CostLockScreen, UnlockedBadge } from '../../components/Common/CostLock';
import { CostApiContext } from './shared';
import { StockValuePage, ClosingStockPage, SuppliersPage } from './ValuationPages';
import { PurchaseCostsPage, MissingCostsPage } from './CostPages';
import { CodeReaderPage, ChangeLogPage } from './ToolPages';
import { SecretCodePage } from './SecretCodePage';
import '../../styles/components.css';

// Accounts: cost in rupees, stock value and closing stock. Only Confidential Cost Prices holders
// reach it; it opens with the user's own password and locks again after a few minutes or when
// they leave Accounts. Moving between its pages keeps it unlocked.

export default function AccountsPage() {
  const { unlock, lockMessage, lock, unlocked, costApi, secondsLeft } = useCostUnlock();

  if (!unlock) {
    return (
      <CostLockScreen title="Accounts is locked" unlockUrl="/api/accounts/unlock" message={lockMessage} onUnlocked={unlocked}
        text="Enter your login password to see costs and stock value. Accounts locks again after a few minutes or when you leave it." />
    );
  }

  return (
    <CostApiContext.Provider value={costApi}>
      <div className="page-container" style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#fef3c7', padding: 8, borderRadius: 8, display: 'flex' }}><IndianRupee size={26} color="#b45309" /></div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Accounts</h1>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>Confidential. Everywhere else in the app costs show only as the secret code.</p>
            </div>
          </div>
          <UnlockedBadge secondsLeft={secondsLeft} onLock={() => lock()} />
        </div>
        <Routes>
          <Route index element={<Navigate to="stock-value" replace />} />
          <Route path="stock-value" element={<StockValuePage />} />
          <Route path="closing-stock" element={<ClosingStockPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="purchase-costs" element={<PurchaseCostsPage />} />
          <Route path="missing-costs" element={<MissingCostsPage />} />
          <Route path="code-reader" element={<CodeReaderPage />} />
          <Route path="change-log" element={<ChangeLogPage />} />
          <Route path="secret-code" element={<SecretCodePage />} />
          <Route path="*" element={<Navigate to="stock-value" replace />} />
        </Routes>
      </div>
    </CostApiContext.Provider>
  );
}
