import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, Undo2, Users } from 'lucide-react';
import ChoiceCard from '../../../components/Common/ChoiceCard';
import CustomerReturnsTab from './CustomerReturnsTab';
import SupplierReturnsTab from './SupplierReturnsTab';
import '../../../styles/components.css';

// Opens on two big cards for the touch screens at the gate. The choice is in the address, so the
// browser's back button and the Returns menu item both return to the cards.
export default function ReturnsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get('type');
  const isCustomer = type === 'customer';
  const isSupplier = type === 'supplier';

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Undo2 size={26} /> {isCustomer ? 'Customer Return' : isSupplier ? 'Return to Supplier' : 'Returns'}
          </h1>
          <p className="page-subtitle">
            {isCustomer ? 'Goods coming back from a customer' : isSupplier ? 'Goods going back to a supplier' : 'What is being returned?'}
          </p>
        </div>
        {(isCustomer || isSupplier) && (
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/returns')} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48 }}>
            <ArrowLeft size={18} /> Back
          </button>
        )}
      </div>

      {isCustomer ? <CustomerReturnsTab /> : isSupplier ? <SupplierReturnsTab /> : (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', maxWidth: 860, margin: '24px auto 0' }}>
          <ChoiceCard large icon={<Users size={36} />} title="Customer Return" subtitle="Goods coming back from a customer" onClick={() => navigate('/returns?type=customer')} />
          <ChoiceCard large icon={<Building2 size={36} />} title="Return to Supplier" subtitle="Goods going back to a supplier" onClick={() => navigate('/returns?type=supplier')} />
        </div>
      )}
    </div>
  );
}
