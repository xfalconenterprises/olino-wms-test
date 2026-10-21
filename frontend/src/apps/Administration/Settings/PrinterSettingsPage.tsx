import { useEffect, useState, type FormEvent } from 'react';
import { 
  Printer, 
  CheckCircle2, 
  AlertCircle, 
  Save, 
  RefreshCw, 
  Sliders, 
  Eye, 
  Activity,
  Search,
  Wifi,
  Plus,
  Trash2,
  Edit2,
  Check,
  Star,
  X,
  Server,
  Monitor,
  Radio
} from 'lucide-react';
import { 
  getPrinterSettings, 
  savePrinterSettings, 
  addPrinterDevice,
  updatePrinterDevice,
  deletePrinterDevice,
  setDefaultPrinter,
  testPrintDirect, 
  checkPrinterConnection,
  discoverPrinters,
  getDetectedSubnets,
  getWorkstationPrinterId,
  setWorkstationPrinterId,
  type PrinterDevice,
  type MultiPrinterSettings,
  type DiscoveredPrinter
} from '../../../utils/printer';
import '../../../styles/components.css';

// Popular TSC Models with their native DPI resolutions
const TSC_MODELS = [
  { name: 'TSC TE210 (203 DPI)', model: 'TSC TE210', dpi: 203, desc: 'Desktop 4-inch, standard 203 DPI thermal transfer' },
  { name: 'TSC TE310 (300 DPI)', model: 'TSC TE310', dpi: 300, desc: 'Desktop 4-inch, high-resolution 300 DPI' },
  { name: 'TSC TE244 (203 DPI)', model: 'TSC TE244', dpi: 203, desc: 'Classic 4-inch desktop series' },
  { name: 'TSC DA210 / DA220 (203 DPI)', model: 'TSC DA210', dpi: 203, desc: 'Compact direct thermal desktop' },
  { name: 'TSC DA310 / DA320 (300 DPI)', model: 'TSC DA310', dpi: 300, desc: 'Compact direct thermal 300 DPI' },
  { name: 'TSC MB240 / MB240T (203 DPI)', model: 'TSC MB240', dpi: 203, desc: 'Light industrial metal-frame printer' },
  { name: 'TSC MB340 / MB340T (300 DPI)', model: 'TSC MB340', dpi: 300, desc: 'Light industrial 300 DPI high-density' },
  { name: 'Custom TSC Model', model: 'TSC TSPL Printer', dpi: 203, desc: 'Any other TSPL / TSPL2 compatible network printer' },
];

export default function PrinterSettingsPage() {
  const [config, setConfig] = useState<MultiPrinterSettings>({
    printers: [],
    autoPrintOnReceipt: true,
    copies: 1,
  });

  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Per-device link status tracker { [printerId]: { status, message, latencyMs, model } }
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, {
    status: 'checking' | 'success' | 'error';
    message: string;
    latencyMs?: number;
    model?: string;
  }>>({});

  // Per-device test printing tracker { [printerId]: boolean }
  const [testingPrinters, setTestingPrinters] = useState<Record<string, boolean>>({});

  // LAN Auto-discovery states
  const [scanningLAN, setScanningLAN] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<DiscoveredPrinter[]>([]);
  const [detectedSubnets, setDetectedSubnets] = useState<string[]>(['192.168.1']);
  const [selectedSubnet, setSelectedSubnet] = useState<string>('192.168.1');
  const [scanAttempted, setScanAttempted] = useState(false);
  const [lastScannedSubnets, setLastScannedSubnets] = useState<string[]>([]);
  const [showDiscoveryTool, setShowDiscoveryTool] = useState(true);

  // Quick Direct IP Ping state
  const [quickPingIp, setQuickPingIp] = useState('192.168.1.');
  const [quickPinging, setQuickPinging] = useState(false);
  const [quickPingResult, setQuickPingResult] = useState<{
    status: 'success' | 'error';
    latencyMs?: number;
    model?: string;
    message: string;
    testedIp: string;
  } | null>(null);

  // Local workstation PC preference
  const [workstationPrinterId, setLocalWorkstationId] = useState<string | null>(getWorkstationPrinterId());

  // Modal / Form state for Add/Edit Printer
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [modalForm, setModalForm] = useState<{
    name: string;
    model: string;
    ip: string;
    port: number;
    dpi: number;
    labelWidthMm: number;
    labelHeightMm: number;
    gapMm: number;
    direction: number;
    station: 'INBOUND' | 'OUTBOUND' | 'FLOOR' | 'GENERAL';
    isDefault: boolean;
  }>({
    name: '',
    model: 'TSC TE210',
    ip: '192.168.1.150',
    port: 9100,
    dpi: 203,
    labelWidthMm: 100,
    labelHeightMm: 50,
    gapMm: 3,
    direction: 1,
    station: 'INBOUND',
    isDefault: false,
  });
  const [submittingModal, setSubmittingModal] = useState(false);
  const [modalLinkCheck, setModalLinkCheck] = useState<{
    status: 'checking' | 'success' | 'error';
    message: string;
    latencyMs?: number;
  } | null>(null);

  // Sample data for live 100x50mm preview
  const sampleBatch = {
    batchCode: 'BAT-2026-0042',
    brand: 'Arvind Mills',
    quality: 'Heavy Cotton Drill',
    shade: 'Khaki 45',
    quantity: 78.9,
    uom: 'METERS',
    poNumber: 'PO-2026-0005',
    supplierName: 'Arvind Limited',
    bundle: 'BND-88',
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const [data, subnets] = await Promise.all([
        getPrinterSettings(),
        getDetectedSubnets().catch(() => ['192.168.1'])
      ]);
      if (data) {
        setConfig(data);
      }
      if (subnets && subnets.length > 0) {
        setDetectedSubnets(subnets);
        setSelectedSubnet(subnets[0]);
        setQuickPingIp(`${subnets[0]}.`);
      }
    } catch (err: any) {
      console.error('Failed to load printer settings:', err);
      setStatusMsg({
        type: 'error',
        text: 'Failed to load printer configuration from backend server.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Check connection to a specific printer device
  const handleCheckDevice = async (printer: PrinterDevice) => {
    setDeviceStatuses(prev => ({
      ...prev,
      [printer.id]: { status: 'checking', message: 'Testing Port 9100...' }
    }));

    try {
      const res = await checkPrinterConnection({ ip: printer.ip, port: printer.port });
      setDeviceStatuses(prev => ({
        ...prev,
        [printer.id]: {
          status: 'success',
          message: res.message || 'Connected',
          latencyMs: res.latencyMs,
          model: res.model || printer.model,
        }
      }));
    } catch (err: any) {
      const errorText = err.response?.data?.error || err.message || 'Connection timed out';
      setDeviceStatuses(prev => ({
        ...prev,
        [printer.id]: {
          status: 'error',
          message: errorText,
        }
      }));
    }
  };

  // Send a test print directly to a specific printer device
  const handleTestPrintDevice = async (printer: PrinterDevice) => {
    setTestingPrinters(prev => ({ ...prev, [printer.id]: true }));
    setStatusMsg(null);
    try {
      const res = await testPrintDirect({
        printerId: printer.id,
        ip: printer.ip,
        port: printer.port,
        dpi: printer.dpi,
      });
      setStatusMsg({
        type: 'success',
        text: res.message || `Test label successfully sent to ${printer.name} (${printer.ip}:${printer.port})!`,
      });
      // Also update status to connected if successful
      setDeviceStatuses(prev => ({
        ...prev,
        [printer.id]: {
          status: 'success',
          message: 'Active & Responding',
        }
      }));
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || `Failed to print to ${printer.name}.`,
      });
      setDeviceStatuses(prev => ({
        ...prev,
        [printer.id]: {
          status: 'error',
          message: 'Print failed / Unreachable',
        }
      }));
    } finally {
      setTestingPrinters(prev => ({ ...prev, [printer.id]: false }));
    }
  };

  // Designate a printer as the default
  const handleSetDefault = async (printerId: string) => {
    try {
      const res = await setDefaultPrinter(printerId);
      if (res.success && res.config) {
        setConfig(res.config);
        setStatusMsg({
          type: 'success',
          text: `Primary default printer changed to: ${res.defaultPrinter.name}`,
        });
        setTimeout(() => setStatusMsg(null), 3500);
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Failed to set default printer.',
      });
    }
  };

  // Open Add Printer Modal
  const openAddModal = () => {
    setEditingPrinterId(null);
    setModalForm({
      name: `Receiving Dock ${config.printers.length + 1}`,
      model: 'TSC TE210',
      ip: '192.168.1.150',
      port: 9100,
      dpi: 203,
      labelWidthMm: 100,
      labelHeightMm: 50,
      gapMm: 3,
      direction: 1,
      station: 'INBOUND',
      isDefault: config.printers.length === 0,
    });
    setModalLinkCheck(null);
    setIsModalOpen(true);
  };

  // Open Edit Printer Modal
  const openEditModal = (printer: PrinterDevice) => {
    setEditingPrinterId(printer.id);
    setModalForm({
      name: printer.name,
      model: printer.model,
      ip: printer.ip,
      port: printer.port,
      dpi: printer.dpi || 203,
      labelWidthMm: printer.labelWidthMm || 100,
      labelHeightMm: printer.labelHeightMm || 50,
      gapMm: printer.gapMm || 3,
      direction: printer.direction === 0 ? 0 : 1,
      station: printer.station || 'INBOUND',
      isDefault: printer.isDefault,
    });
    setModalLinkCheck(null);
    setIsModalOpen(true);
  };

  // Delete printer
  const handleDeletePrinter = async (printer: PrinterDevice) => {
    if (config.printers.length <= 1) {
      setStatusMsg({
        type: 'error',
        text: 'Cannot delete the only printer. At least one printer must remain in the warehouse registry.',
      });
      return;
    }

    if (!confirm(`Are you sure you want to remove '${printer.name}' (${printer.ip}) from the printer registry?`)) {
      return;
    }

    try {
      const res = await deletePrinterDevice(printer.id);
      if (res.config) {
        setConfig(res.config);
        setStatusMsg({
          type: 'success',
          text: `Printer '${printer.name}' removed successfully.`,
        });
        setTimeout(() => setStatusMsg(null), 3500);
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Failed to delete printer.',
      });
    }
  };

  // Test link inside modal
  const handleModalCheckLink = async () => {
    if (!modalForm.ip) return;
    setModalLinkCheck({ status: 'checking', message: 'Connecting to Port 9100...' });
    try {
      const res = await checkPrinterConnection({ ip: modalForm.ip, port: modalForm.port });
      setModalLinkCheck({
        status: 'success',
        message: `Online (${res.latencyMs}ms) - ${res.model || modalForm.model}`,
        latencyMs: res.latencyMs,
      });
    } catch (err: any) {
      setModalLinkCheck({
        status: 'error',
        message: err.response?.data?.error || err.message || 'Connection failed',
      });
    }
  };

  // Submit Add or Edit Modal
  const handleSaveModal = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingModal(true);
    setStatusMsg(null);
    try {
      if (editingPrinterId) {
        const res = await updatePrinterDevice(editingPrinterId, modalForm);
        if (res.config) setConfig(res.config);
        setStatusMsg({
          type: 'success',
          text: `Printer '${modalForm.name}' updated successfully!`,
        });
      } else {
        const res = await addPrinterDevice(modalForm);
        if (res.config) setConfig(res.config);
        setStatusMsg({
          type: 'success',
          text: `New printer '${modalForm.name}' registered successfully!`,
        });
      }
      setIsModalOpen(false);
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Failed to save printer details.',
      });
    } finally {
      setSubmittingModal(false);
    }
  };

  // Save global settings (autoPrintOnReceipt, default copies)
  const handleSaveGlobal = async (e: FormEvent) => {
    e.preventDefault();
    setSavingGlobal(true);
    setStatusMsg(null);
    try {
      const updated = await savePrinterSettings({
        autoPrintOnReceipt: config.autoPrintOnReceipt,
        copies: config.copies,
      });
      setConfig(prev => ({
        ...prev,
        autoPrintOnReceipt: updated.autoPrintOnReceipt,
        copies: updated.copies,
      }));
      setStatusMsg({
        type: 'success',
        text: 'Global barcode printing preferences saved successfully!',
      });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Failed to save global preferences.',
      });
    } finally {
      setSavingGlobal(false);
    }
  };

  // Scan LAN subnet for Port 9100
  const handleScanLAN = async (subnetToScan?: string) => {
    const target = (subnetToScan !== undefined ? subnetToScan : selectedSubnet).trim();
    setScanningLAN(true);
    setScanAttempted(true);
    setDiscoveredPrinters([]);
    setQuickPingResult(null);
    setStatusMsg(null);
    try {
      const res = await discoverPrinters(target);
      const found = res.printers || [];
      const scanned = res.scannedSubnets || (target ? [target] : ['192.168.1']);
      setDiscoveredPrinters(found);
      setLastScannedSubnets(scanned);

      if (found.length > 0) {
        setStatusMsg({
          type: 'success',
          text: `Found ${found.length} thermal printer(s) responding on Port 9100!`,
        });
      }
    } catch (err: any) {
      console.error('LAN scan failed:', err);
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || 'LAN scan failed. Check network connection.',
      });
    } finally {
      setScanningLAN(false);
    }
  };

  // Direct IP Port 9100 Probe
  const handleQuickPing = async () => {
    const ip = quickPingIp.trim();
    if (!ip) return;
    setQuickPinging(true);
    setQuickPingResult(null);
    try {
      const res = await checkPrinterConnection({ ip, port: 9100 });
      setQuickPingResult({
        status: 'success',
        testedIp: ip,
        latencyMs: res.latencyMs,
        model: res.model || 'TSC TSPL Printer',
        message: res.message || `Online & responding on Port 9100 (${res.latencyMs}ms)!`,
      });
    } catch (err: any) {
      setQuickPingResult({
        status: 'error',
        testedIp: ip,
        message: err.response?.data?.error || err.message || 'No response on Port 9100 (timed out).',
      });
    } finally {
      setQuickPinging(false);
    }
  };

  const defaultPrinter = config.printers.find(p => p.isDefault) || config.printers[0];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
      {/* ─── Page Header ─────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Printer size={28} /> Thermal Barcode Printer Registry
          </h1>
          <p className="page-subtitle">
            Manage multi-station TSC network thermal printers (TE210, TE310, MB240, DA210) for 100mm × 50mm rolls
          </p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadSettings}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Reload
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openAddModal}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} /> Add Barcode Printer
          </button>
        </div>
      </div>

      {/* ─── Feedback Alert ───────────────────────────────────────────────── */}
      {statusMsg && (
        <div 
          className={`alert ${statusMsg.type === 'success' ? 'alert-success' : 'alert-danger'}`} 
          style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}
        >
          {statusMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{statusMsg.text}</span>
        </div>
      )}

      {/* ─── System Default Printer Hero Card ─────────────────────────────── */}
      {defaultPrinter && (
        <div style={{
          background: '#ffffff',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              background: '#ecfdf5',
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #a7f3d0'
            }}>
              <Star size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                Primary Default Printer: {defaultPrinter.name}
                <span className="badge badge-success" style={{ fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Check size={12} /> Default
                </span>
                <span className="badge badge-neutral" style={{ fontSize: 11, padding: '2px 8px' }}>
                  {defaultPrinter.model} ({defaultPrinter.dpi || 203} DPI)
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Station: <strong>{defaultPrinter.station}</strong> · IP: <strong style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>{defaultPrinter.ip}:{defaultPrinter.port}</strong> · Label: <strong>{defaultPrinter.labelWidthMm}mm × {defaultPrinter.labelHeightMm}mm</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleCheckDevice(defaultPrinter)}
              disabled={deviceStatuses[defaultPrinter.id]?.status === 'checking'}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {deviceStatuses[defaultPrinter.id]?.status === 'checking' ? <RefreshCw size={14} className="spinner" /> : <Activity size={14} />}
              {deviceStatuses[defaultPrinter.id]?.status === 'checking' ? 'Testing Link...' : 'Check Link'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleTestPrintDevice(defaultPrinter)}
              disabled={testingPrinters[defaultPrinter.id]}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {testingPrinters[defaultPrinter.id] ? <span className="spinner spinner-sm" /> : <Printer size={15} />}
              Send Test Label
            </button>
          </div>
        </div>
      )}

      {/* ─── Workstation / This PC Assigned Printer ─────────────────────── */}
      <div style={{
        background: '#f8fafc',
        border: '1px solid #cbd5e1',
        borderRadius: 'var(--radius)',
        padding: '14px 18px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 6,
            background: '#e0e7ff',
            color: '#4f46e5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Monitor size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
              This Computer's Active Target Printer
              {workstationPrinterId ? (
                <span className="badge badge-info" style={{ fontSize: 10.5, padding: '1px 7px' }}>
                  Workstation Locked
                </span>
              ) : (
                <span className="badge badge-neutral" style={{ fontSize: 10.5, padding: '1px 7px' }}>
                  Inheriting Warehouse Default
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Set which physical printer labels will automatically print to when generated from this specific computer / tablet.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            className="form-input"
            value={workstationPrinterId || ''}
            onChange={e => {
              const val = e.target.value || null;
              setWorkstationPrinterId(val);
              setLocalWorkstationId(val);
              const matched = config.printers.find(p => p.id === val);
              setStatusMsg({
                type: 'success',
                text: matched 
                  ? `This computer will now automatically print to: ${matched.name} (${matched.ip})`
                  : `This computer will now use the Warehouse Default (${defaultPrinter?.name || 'Primary'}).`,
              });
              setTimeout(() => setStatusMsg(null), 3500);
            }}
            style={{ fontWeight: 600, fontSize: 13, minWidth: 260 }}
          >
            <option value="">Default: {defaultPrinter?.name || 'Warehouse Primary'} ({defaultPrinter?.ip})</option>
            {config.printers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} [{p.station}] ({p.ip})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Registered Printers Fleet ────────────────────────────────────── */}
      <div className="card" style={{ padding: 22, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Server size={18} color="var(--color-brand)" /> Registered Warehouse Printers ({config.printers.length})
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
              Connect multiple thermal printers across Inbound Receiving, Exit Gates, and Packing Stations.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowDiscoveryTool(prev => !prev)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Wifi size={14} color="var(--color-brand)" />
            {showDiscoveryTool ? 'Hide Scanner Tool' : 'Find / Scan Printer'}
          </button>
        </div>

        {/* Discovery & Probe Tool Box */}
        {showDiscoveryTool && (
          <div style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: 16,
            marginBottom: 20
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Search size={16} color="var(--color-brand)" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                  Network Discovery &amp; Port 9100 Probe Tool
                </span>
              </div>
              <span style={{ fontSize: 11.5, color: '#64748b' }}>
                Thermal printers listen for TSPL commands on TCP Port 9100
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(280px, 1fr)', gap: 16 }}>
              {/* Option 1: Subnet Auto-Scan */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Radio size={14} color="#0284c7" />
                  Auto-Scan Subnet Range (.1 to .254)
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>
                  Select or type your router subnet, then scan for any device listening on Port 9100.
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {detectedSubnets.map((sub) => (
                    <button
                      key={sub}
                      type="button"
                      className={`btn btn-sm ${selectedSubnet === sub ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: 11.5, padding: '3px 8px' }}
                      onClick={() => {
                        setSelectedSubnet(sub);
                        setQuickPingIp(`${sub}.`);
                      }}
                    >
                      {sub}.x (Wi-Fi/LAN)
                    </button>
                  ))}
                  {!detectedSubnets.includes('192.168.1') && (
                    <button
                      type="button"
                      className={`btn btn-sm ${selectedSubnet === '192.168.1' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: 11.5, padding: '3px 8px' }}
                      onClick={() => {
                        setSelectedSubnet('192.168.1');
                        setQuickPingIp('192.168.1.');
                      }}
                    >
                      192.168.1.x
                    </button>
                  )}
                  {!detectedSubnets.includes('192.168.0') && (
                    <button
                      type="button"
                      className={`btn btn-sm ${selectedSubnet === '192.168.0' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: 11.5, padding: '3px 8px' }}
                      onClick={() => {
                        setSelectedSubnet('192.168.0');
                        setQuickPingIp('192.168.0.');
                      }}
                    >
                      192.168.0.x
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="form-input"
                    value={selectedSubnet}
                    onChange={(e) => setSelectedSubnet(e.target.value)}
                    placeholder="e.g. 192.168.1"
                    style={{ fontSize: 12.5, padding: '5px 8px', maxWidth: 140 }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleScanLAN()}
                    disabled={scanningLAN}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {scanningLAN ? <RefreshCw size={13} className="spinner" /> : <Search size={13} />}
                    {scanningLAN ? 'Scanning Subnet...' : 'Scan Subnet'}
                  </button>
                </div>
              </div>

              {/* Option 2: Direct IP Ping */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Activity size={14} color="#059669" />
                  Direct IP Ping (Test Port 9100)
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>
                  Enter the printer or router IP directly to test socket connection.
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    type="text"
                    className="form-input"
                    value={quickPingIp}
                    onChange={(e) => setQuickPingIp(e.target.value)}
                    placeholder="192.168.1.150"
                    style={{ fontSize: 12.5, padding: '5px 8px', flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleQuickPing();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleQuickPing}
                    disabled={quickPinging || !quickPingIp.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {quickPinging ? <RefreshCw size={13} className="spinner" /> : <Activity size={13} />}
                    {quickPinging ? 'Pinging...' : 'Test IP'}
                  </button>
                </div>

                {quickPingResult && (
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 4,
                    background: quickPingResult.status === 'success' ? '#ecfdf5' : '#fef2f2',
                    border: `1px solid ${quickPingResult.status === 'success' ? '#a7f3d0' : '#fecaca'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 11.5
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: quickPingResult.status === 'success' ? '#065f46' : '#991b1b' }}>
                      {quickPingResult.status === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      <span>{quickPingResult.message}</span>
                    </div>
                    {quickPingResult.status === 'success' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => {
                          setEditingPrinterId(null);
                          setModalForm({
                            name: `Dock Printer (${quickPingResult.testedIp})`,
                            model: quickPingResult.model || 'TSC TE210',
                            ip: quickPingResult.testedIp,
                            port: 9100,
                            dpi: 203,
                            labelWidthMm: 100,
                            labelHeightMm: 50,
                            gapMm: 3,
                            direction: 1,
                            station: 'INBOUND',
                            isDefault: config.printers.length === 0,
                          });
                          setIsModalOpen(true);
                        }}
                      >
                        <Plus size={11} /> Register
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Results: Discovered Printers */}
            {discoveredPrinters.length > 0 && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 6, background: '#f0fdf4', border: '1px solid #86efac' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#166534', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={15} color="#16a34a" /> Discovered Thermal Printers ({discoveredPrinters.length}):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {discoveredPrinters.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setEditingPrinterId(null);
                        setModalForm({
                          name: `Dock Printer (${p.ip})`,
                          model: p.model || 'TSC TE210',
                          ip: p.ip,
                          port: p.port,
                          dpi: 203,
                          labelWidthMm: 100,
                          labelHeightMm: 50,
                          gapMm: 3,
                          direction: 1,
                          station: 'INBOUND',
                          isDefault: config.printers.length === 0,
                        });
                        setIsModalOpen(true);
                      }}
                      className="btn btn-sm btn-secondary"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: '#ffffff' }}
                      title="Click to register this printer"
                    >
                      <Plus size={13} color="var(--color-brand)" />
                      <span>{p.model}</span>
                      <code style={{ background: '#e2e8f0', padding: '2px 5px', borderRadius: 4 }}>{p.ip}</code>
                      <span style={{ fontSize: 11, color: '#16a34a' }}>({p.latencyMs}ms)</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Results: 0 Discovered & Helpful Troubleshooting */}
            {scanAttempted && !scanningLAN && discoveredPrinters.length === 0 && (
              <div style={{ marginTop: 14, padding: 14, borderRadius: 6, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={15} color="#b45309" />
                  0 printers responded on subnet {lastScannedSubnets.join(', ')} on Port 9100.
                </div>
                <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
                  <strong>How to find your printer's IP right now:</strong>
                  <ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    <li>
                      <strong>Printer Self-Test Slip (Quickest)</strong>: Turn the printer <strong>OFF</strong>. Hold down the <strong>FEED</strong> button on top of the printer, then turn the power switch <strong>ON</strong>. Release FEED when the light blinks. The printer will feed and print a calibration slip showing its exact <strong>IP address</strong>!
                    </li>
                    <li>
                      <strong>Physical Cable Check</strong>: Ensure the RJ45 Ethernet cable is plugged into a numbered <strong>LAN port (1, 2, 3, or 4)</strong> on your Wi-Fi router (not the yellow/blue WAN port). Verify that the small link LEDs on the printer's network port are glowing.
                    </li>
                    <li>
                      <strong>Router Admin Page</strong>: Open <a href="http://192.168.1.1" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: '#92400e', fontWeight: 600 }}>http://192.168.1.1</a> in your browser and check the <em>DHCP Client List</em> or <em>Connected Devices</em> to find the printer's IP.
                    </li>
                    <li>
                      Once you see the IP (e.g. <code>192.168.1.150</code>), enter it into the <strong>Direct IP Ping</strong> box above to verify connection!
                    </li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Printer Devices Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--color-border)', textAlign: 'left', fontSize: 12, color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '10px 12px' }}>STATUS</th>
                <th style={{ padding: '10px 12px' }}>PRINTER NAME &amp; STATION</th>
                <th style={{ padding: '10px 12px' }}>MODEL &amp; DPI</th>
                <th style={{ padding: '10px 12px' }}>IP : PORT</th>
                <th style={{ padding: '10px 12px' }}>LABEL SPEC</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {config.printers.map(printer => {
                const status = deviceStatuses[printer.id];
                const isTesting = testingPrinters[printer.id];

                return (
                  <tr key={printer.id} style={{ borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
                    <td style={{ padding: '12px 12px', verticalAlign: 'middle', width: 140 }}>
                      {status?.status === 'checking' && (
                        <span className="badge badge-neutral" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <RefreshCw size={11} className="spinner" /> Checking...
                        </span>
                      )}
                      {status?.status === 'success' && (
                        <span className="badge badge-success" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={12} /> {status.latencyMs ? `${status.latencyMs}ms` : 'Online'}
                        </span>
                      )}
                      {status?.status === 'error' && (
                        <span className="badge badge-danger" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <AlertCircle size={12} /> Offline
                        </span>
                      )}
                      {!status && (
                        <span className="badge badge-neutral" style={{ fontSize: 11, color: '#64748b' }}>
                          Ready
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ color: 'var(--color-text-main)' }}>{printer.name}</strong>
                        {printer.isDefault && (
                          <span className="badge badge-success" style={{ fontSize: 10, padding: '1px 6px' }}>
                            Default
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        Station: <strong>{printer.station}</strong>
                      </div>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 600 }}>{printer.model}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        {printer.dpi || 203} DPI ({printer.dpi === 300 ? '12 dots/mm' : '8 dots/mm'})
                      </div>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                      <code style={{ background: '#f1f5f9', padding: '3px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12.5 }}>
                        {printer.ip}:{printer.port}
                      </code>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'middle', fontSize: 12 }}>
                      {printer.labelWidthMm} × {printer.labelHeightMm} mm
                      <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Gap: {printer.gapMm}mm</span>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'middle', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleCheckDevice(printer)}
                          disabled={status?.status === 'checking'}
                          title="Check TCP Socket link on Port 9100"
                          style={{ padding: '4px 8px' }}
                        >
                          <Activity size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleTestPrintDevice(printer)}
                          disabled={isTesting}
                          title="Send a 100mm x 50mm test calibration label"
                          style={{ padding: '4px 8px' }}
                        >
                          {isTesting ? <RefreshCw size={14} className="spinner" /> : <Printer size={14} />}
                        </button>
                        {!printer.isDefault && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleSetDefault(printer.id)}
                            title="Set as Default Printer for warehouse operations"
                            style={{ padding: '4px 8px', color: '#0284c7' }}
                          >
                            <Star size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => openEditModal(printer)}
                          title="Edit printer configuration"
                          style={{ padding: '4px 8px' }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDeletePrinter(printer)}
                          disabled={config.printers.length <= 1}
                          title={config.printers.length <= 1 ? 'Cannot delete the only printer' : 'Delete printer'}
                          style={{ padding: '4px 8px', color: '#dc2626' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Grid: Global Preferences & Live 100x50mm Label Preview ──────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 1.15fr) minmax(360px, 1fr)', gap: 24, alignItems: 'start' }}>
        
        {/* Left Card: Warehouse Print Automation Preferences */}
        <form onSubmit={handleSaveGlobal} className="card" style={{ padding: 22 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sliders size={18} color="var(--color-brand)" /> Warehouse Print Automation
          </h2>

          <div className="form-group" style={{ marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.autoPrintOnReceipt}
                onChange={e => setConfig(prev => ({ ...prev, autoPrintOnReceipt: e.target.checked }))}
                style={{ marginTop: 3, width: 16, height: 16 }}
              />
              <div>
                <span style={{ fontWeight: 600, fontSize: 13.5, display: 'block', color: 'var(--color-text-main)' }}>
                  Auto-Print Barcode Stickers on PO Receipt
                </span>
                <span className="form-hint" style={{ fontSize: 12, marginTop: 2, display: 'block' }}>
                  When warehouse staff confirms inward receipt of a fabric roll or accessories batch, immediately transmit TSPL command to the designated station printer.
                </span>
              </div>
            </label>
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" style={{ fontWeight: 600 }}>
              Default Number of Label Copies
            </label>
            <input
              type="number"
              min="1"
              max="10"
              className="form-input"
              value={config.copies}
              onChange={e => setConfig(prev => ({ ...prev, copies: parseInt(e.target.value) || 1 }))}
              style={{ width: 100, fontWeight: 600 }}
            />
            <span className="form-hint" style={{ fontSize: 11.5 }}>
              Number of physical stickers to feed per inward batch roll (typically 1 sticker per physical roll).
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingGlobal}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {savingGlobal ? <span className="spinner spinner-sm" /> : <Save size={16} />}
              Save Automation Preferences
            </button>
          </div>
        </form>

        {/* Right Card: Live 100mm x 50mm Label Visual Mockup */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Eye size={18} color="var(--color-brand)" /> Live 100mm × 50mm Label Preview
            </h2>
            <span className="badge badge-neutral" style={{ fontSize: 11 }}>
              {defaultPrinter ? `${defaultPrinter.model} @ ${defaultPrinter.dpi || 203} DPI` : 'TSC TE210 @ 203 DPI'}
            </span>
          </div>

          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
            Crisp native typography with 3-zone layout: Item specifications, prominent roll quantity, 2D QR code, and full-width barcode.
          </p>

          {/* Realistic 100x50mm Thermal Sticker Mockup */}
          <div style={{
            background: '#ffffff',
            border: '2px solid #0f172a',
            borderRadius: 6,
            padding: '14px 18px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
            position: 'relative',
            aspectRatio: '2 / 1',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontFamily: 'monospace, sans-serif',
            color: '#000000',
            userSelect: 'none'
          }}>
            {/* Zone 1: Top Bar (Native Bold Brand Header & Date) */}
            <div style={{ borderBottom: '2px solid #000', paddingBottom: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 0.5, color: '#000' }}>
                OLINO UNIFORMS
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#334155' }}>
                REC: 16/10/2026
              </span>
            </div>

            {/* Zone 2: Middle Section (Specs + Big QTY + QR Code) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1.4fr) auto auto', alignItems: 'center', gap: 14, margin: '6px 0' }}>
              {/* Left: Item Specs */}
              <div style={{ fontSize: 11, lineHeight: 1.45, fontWeight: 600 }}>
                <div>BRAND : {sampleBatch.brand}</div>
                <div>QUAL  : {sampleBatch.quality}</div>
                <div>SHADE : {sampleBatch.shade}</div>
              </div>

              {/* Center: Big Quantity */}
              <div style={{ textAlign: 'center', padding: '0 6px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: '#475569' }}>
                  ROLL QTY
                </div>
                <div style={{ fontSize: 17, fontWeight: 900, whiteSpace: 'nowrap' }}>
                  {sampleBatch.quantity} M
                </div>
              </div>

              {/* Right: Simulated 2D QR Code */}
              <div style={{
                width: 48,
                height: 48,
                border: '2px solid #000',
                padding: 2,
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 1.5,
                background: '#fff'
              }}>
                <div style={{ background: '#000' }} /><div style={{ background: '#000' }} /><div style={{ background: '#000' }} /><div /><div style={{ background: '#000' }} />
                <div style={{ background: '#000' }} /><div /><div style={{ background: '#000' }} /><div style={{ background: '#000' }} /><div />
                <div /><div style={{ background: '#000' }} /><div /><div style={{ background: '#000' }} /><div style={{ background: '#000' }} />
                <div style={{ background: '#000' }} /><div style={{ background: '#000' }} /><div style={{ background: '#000' }} /><div /><div style={{ background: '#000' }} />
                <div style={{ background: '#000' }} /><div /><div style={{ background: '#000' }} /><div style={{ background: '#000' }} /><div style={{ background: '#000' }} />
              </div>
            </div>

            {/* Zone 3: Bottom Section (Full-Width Centered Code 128 Barcode) */}
            <div style={{ borderTop: '2px solid #000', paddingTop: 4, textAlign: 'center' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                height: 38,
                gap: 2,
                justifyContent: 'center',
                padding: '2px 0'
              }}>
                {[3,1,2,1,4,1,2,3,1,2,4,1,2,1,3,2,1,4,2,1,3,1,2,4,1,2,3,1,2,1,3,1,2,1,4,1,2,3].map((w, i) => (
                  <span 
                    key={i} 
                    style={{ 
                      display: 'inline-block', 
                      width: w * 1.5, 
                      height: '100%', 
                      background: i % 2 === 0 ? '#000' : 'transparent' 
                    }} 
                  />
                ))}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1.5, marginTop: 2 }}>
                {sampleBatch.batchCode}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Add / Edit Printer Modal ─────────────────────────────────────── */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 16
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: 580,
            maxHeight: '92vh',
            overflowY: 'auto',
            padding: 24,
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Printer size={18} color="var(--color-brand)" />
                {editingPrinterId ? 'Edit Printer Device' : 'Register New Barcode Printer'}
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsModalOpen(false)}
                style={{ padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveModal}>
              {/* Printer Name & Station */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 14 }}>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Friendly Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Inbound Dock Printer 1"
                    value={modalForm.name}
                    onChange={e => setModalForm(prev => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Workstation</label>
                  <select
                    className="form-input"
                    value={modalForm.station}
                    onChange={e => setModalForm(prev => ({ ...prev, station: e.target.value as any }))}
                  >
                    <option value="INBOUND">Inbound Receiving</option>
                    <option value="OUTBOUND">Exit / Shipping</option>
                    <option value="FLOOR">Storage Floor</option>
                    <option value="GENERAL">General Purpose</option>
                  </select>
                </div>
              </div>

              {/* Model Preset Selector */}
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Printer Model &amp; Resolution</label>
                <select
                  className="form-input"
                  value={modalForm.model}
                  onChange={e => {
                    const selected = TSC_MODELS.find(m => m.model === e.target.value || m.name === e.target.value);
                    setModalForm(prev => ({
                      ...prev,
                      model: e.target.value,
                      dpi: selected ? selected.dpi : prev.dpi
                    }));
                  }}
                >
                  {TSC_MODELS.map((m, idx) => (
                    <option key={idx} value={m.model}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <span className="form-hint" style={{ fontSize: 11.5, marginTop: 4 }}>
                  All TSC models use native TSPL commands. 203 DPI = 8 dots/mm (Standard), 300 DPI = 12 dots/mm (High-Res).
                </span>
              </div>

              {/* Resolution Radio selection */}
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Printhead Resolution</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="dpi"
                      checked={modalForm.dpi === 203}
                      onChange={() => setModalForm(prev => ({ ...prev, dpi: 203 }))}
                    />
                    <strong>203 DPI</strong> (TSC TE210, TE244, DA210, MB240)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="dpi"
                      checked={modalForm.dpi === 300}
                      onChange={() => setModalForm(prev => ({ ...prev, dpi: 300 }))}
                    />
                    <strong>300 DPI</strong> (TSC TE310, DA310, MB340)
                  </label>
                </div>
              </div>

              {/* IP and Port */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, marginBottom: 14 }}>
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>IP Address *</label>
                    <button
                      type="button"
                      onClick={handleModalCheckLink}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: '2px 6px', color: 'var(--color-brand)' }}
                    >
                      <Activity size={12} /> Test IP
                    </button>
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="192.168.1.150"
                    value={modalForm.ip}
                    onChange={e => {
                      setModalForm(prev => ({ ...prev, ip: e.target.value.trim() }));
                      if (modalLinkCheck) setModalLinkCheck(null);
                    }}
                    required
                    style={{ fontFamily: 'monospace', fontWeight: 600 }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Port</label>
                  <input
                    type="number"
                    className="form-input"
                    value={modalForm.port}
                    onChange={e => setModalForm(prev => ({ ...prev, port: parseInt(e.target.value) || 9100 }))}
                    required
                    style={{ fontFamily: 'monospace', fontWeight: 600 }}
                  />
                </div>
              </div>

              {/* Modal Link Status Feedback */}
              {modalLinkCheck && (
                <div style={{
                  marginBottom: 14,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: modalLinkCheck.status === 'success' ? '#f0fdf4' : (modalLinkCheck.status === 'checking' ? '#f8fafc' : '#fef2f2'),
                  border: `1px solid ${modalLinkCheck.status === 'success' ? '#bbf7d0' : (modalLinkCheck.status === 'checking' ? '#e2e8f0' : '#fecaca')}`,
                  color: modalLinkCheck.status === 'success' ? '#15803d' : (modalLinkCheck.status === 'checking' ? '#475569' : '#b91c1c'),
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  {modalLinkCheck.status === 'success' ? <CheckCircle2 size={15} /> : (modalLinkCheck.status === 'checking' ? <RefreshCw size={14} className="spinner" /> : <AlertCircle size={15} />)}
                  <span>{modalLinkCheck.message}</span>
                </div>
              )}

              {/* Label Specifications: the label layout is designed for 100mm x 50mm stock */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: 12 }}>Label Size</label>
                  <div className="form-input" style={{ fontWeight: 600, background: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center' }}>
                    100 × 50 mm
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: 12 }}>Print Direction</label>
                  <select
                    className="form-select"
                    value={modalForm.direction}
                    onChange={e => setModalForm(prev => ({ ...prev, direction: Number(e.target.value) }))}
                    style={{ fontWeight: 600 }}
                  >
                    <option value={1}>Normal</option>
                    <option value={0}>Rotated 180°</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: 12 }}>Gap (mm)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={modalForm.gapMm}
                    onChange={e => setModalForm(prev => ({ ...prev, gapMm: parseFloat(e.target.value) || 3 }))}
                    style={{ fontWeight: 600 }}
                  />
                </div>
              </div>

              {/* Default Checkbox */}
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={modalForm.isDefault}
                    onChange={e => setModalForm(prev => ({ ...prev, isDefault: e.target.checked }))}
                    style={{ width: 16, height: 16 }}
                  />
                  <strong>Set as Default Printer for warehouse operations</strong>
                </label>
              </div>

              {/* Modal Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submittingModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingModal}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {submittingModal ? <span className="spinner spinner-sm" /> : <Save size={16} />}
                  {editingPrinterId ? 'Update Printer' : 'Register Printer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
