import api from './api';

export interface PrinterDevice {
  id: string;
  name: string;
  model: string;
  ip: string;
  port: number;
  dpi: number; // 203 or 300
  labelWidthMm: number;
  labelHeightMm: number;
  gapMm: number;
  direction: number;
  isDefault: boolean;
  station: 'INBOUND' | 'OUTBOUND' | 'FLOOR' | 'GENERAL';
}

export interface MultiPrinterSettings {
  printers: PrinterDevice[];
  defaultPrinter?: PrinterDevice;
  autoPrintOnReceipt: boolean;
  copies: number;
}

export interface CheckConnectionResult {
  success: boolean;
  latencyMs: number;
  model: string;
  message: string;
}

export interface DiscoveredPrinter {
  ip: string;
  port: number;
  model: string;
  latencyMs: number;
}

/**
 * Fetch current multi-printer configuration from backend
 */
export async function getPrinterSettings(): Promise<MultiPrinterSettings> {
  const res = await api.get('/api/printer/settings');
  return res.data;
}

/**
 * Save updated global printer settings to backend
 */
export async function savePrinterSettings(settings: Partial<MultiPrinterSettings>): Promise<MultiPrinterSettings> {
  const res = await api.post('/api/printer/settings', settings);
  const saved: MultiPrinterSettings = res.data.settings || res.data;
  autoPrintCache = { enabled: saved.autoPrintOnReceipt !== false, at: Date.now() };
  return saved;
}

// "Auto print on receipt" from Printer Settings, re-read at most once a minute
let autoPrintCache: { enabled: boolean; at: number } | null = null;
const AUTO_PRINT_CACHE_MS = 60_000;

/**
 * Prints the label for a just-received roll if "Auto print on receipt" is on. Callers do not wait
 * for it, so a slow or switched-off printer never holds up receiving; onFail tells the worker.
 */
export async function autoPrintReceivedLabel(batchCode: string, onFail?: (message: string) => void): Promise<void> {
  if (!autoPrintCache || Date.now() - autoPrintCache.at > AUTO_PRINT_CACHE_MS) {
    try {
      const settings = await getPrinterSettings();
      autoPrintCache = { enabled: settings.autoPrintOnReceipt !== false, at: Date.now() };
    } catch {
      autoPrintCache = { enabled: true, at: Date.now() };
    }
  }
  if (!autoPrintCache.enabled) return;
  try {
    await printTSPL(batchCode);
  } catch (err: any) {
    console.warn('Auto-print failed:', err?.response?.data?.error || err?.message || err);
    onFail?.(`The label for ${batchCode} did not print. Check the printer, then use Reprint Label.`);
  }
}

/**
 * Register a new printer device in the backend registry
 */
export async function addPrinterDevice(device: Partial<PrinterDevice>): Promise<{
  success: boolean;
  device: PrinterDevice;
  config: MultiPrinterSettings;
  defaultPrinter: PrinterDevice;
}> {
  const res = await api.post('/api/printer/devices', device);
  return res.data;
}

/**
 * Update an existing printer device's configuration
 */
export async function updatePrinterDevice(
  id: string,
  updates: Partial<PrinterDevice>
): Promise<{
  success: boolean;
  device: PrinterDevice;
  config: MultiPrinterSettings;
  defaultPrinter: PrinterDevice;
}> {
  const res = await api.put(`/api/printer/devices/${id}`, updates);
  return res.data;
}

/**
 * Delete a printer device from the registry
 */
export async function deletePrinterDevice(id: string): Promise<{
  success: boolean;
  message: string;
  config: MultiPrinterSettings;
  defaultPrinter: PrinterDevice;
}> {
  const res = await api.delete(`/api/printer/devices/${id}`);
  return res.data;
}

/**
 * Designate a printer device as the primary/default printer
 */
export async function setDefaultPrinter(id: string): Promise<{
  success: boolean;
  defaultPrinter: PrinterDevice;
  config: MultiPrinterSettings;
}> {
  const res = await api.post(`/api/printer/devices/${id}/set-default`);
  return res.data;
}

/**
 * Checks TCP socket connection to printer on Port 9100 without printing or feeding paper.
 * Supports passing (ip, port) or an options object with { ip, port, printerId }.
 */
export async function checkPrinterConnection(
  targetOrIp?: string | { ip?: string; port?: number; printerId?: string },
  port?: number
): Promise<CheckConnectionResult> {
  let payload: { ip?: string; port?: number; printerId?: string } = {};

  if (typeof targetOrIp === 'object' && targetOrIp !== null) {
    payload = targetOrIp;
  } else if (typeof targetOrIp === 'string') {
    payload = { ip: targetOrIp, port };
  }

  const res = await api.post('/api/printer/check-connection', payload);
  return res.data;
}

export interface DiscoveryResponse {
  printers: DiscoveredPrinter[];
  scannedSubnets: string[];
}

/**
 * Automatically scans the local network subnet on Port 9100 to discover thermal printers
 */
export async function discoverPrinters(subnet?: string): Promise<DiscoveryResponse> {
  const res = await api.post('/api/printer/discover', { subnet });
  return {
    printers: res.data.printers || [],
    scannedSubnets: res.data.scannedSubnets || [],
  };
}

/**
 * Transmit a test calibration label (100mm x 50mm) to the designated printer via network
 */
export async function testPrintDirect(
  targetOrIp?: string | { ip?: string; port?: number; printerId?: string; dpi?: number },
  port?: number
): Promise<{ success: boolean; message: string }> {
  let payload: { ip?: string; port?: number; printerId?: string; dpi?: number } = {};

  if (typeof targetOrIp === 'object' && targetOrIp !== null) {
    payload = targetOrIp;
  } else if (typeof targetOrIp === 'string') {
    payload = { ip: targetOrIp, port };
  }

  const res = await api.post('/api/printer/test-print', payload);
  return res.data;
}

const WORKSTATION_PRINTER_KEY = 'olino_workstation_printer_id';

/**
 * Returns the printer ID assigned specifically to this browser / PC workstation.
 * Stored in localStorage so each terminal remembers its assigned printer.
 */
export function getWorkstationPrinterId(): string | null {
  try {
    return localStorage.getItem(WORKSTATION_PRINTER_KEY);
  } catch {
    return null;
  }
}

/**
 * Assigns a designated printer to this specific browser / PC workstation.
 */
export function setWorkstationPrinterId(printerId: string | null): void {
  try {
    if (!printerId) {
      localStorage.removeItem(WORKSTATION_PRINTER_KEY);
    } else {
      localStorage.setItem(WORKSTATION_PRINTER_KEY, printerId);
    }
  } catch {}
}

export interface PrintBatchOptions {
  quantity?: number;
  isRemainder?: boolean;
}

/**
 * Direct network print for a batch code (100mm x 50mm) to the configured printer or specific printerId.
 * Automatically uses this PC's workstation printer if set, otherwise falls back to system default.
 */
export async function printBatchDirect(
  batchCode: string,
  copies?: number,   // left out: the "Copies of each label" setting applies
  printerId?: string,
  options?: PrintBatchOptions
): Promise<{ success: boolean; message: string }> {
  const cleanCode = batchCode.trim();
  const targetPrinterId = printerId || getWorkstationPrinterId() || undefined;
  const payload: any = { printerId: targetPrinterId };
  if (copies !== undefined) payload.copies = copies;
  if (options?.quantity !== undefined) {
    payload.quantity = options.quantity;
  }
  if (options?.isRemainder !== undefined) {
    payload.isRemainder = options.isRemainder;
  }
  const res = await api.post(`/api/printer/print-batch/${encodeURIComponent(cleanCode)}`, payload);
  return res.data;
}

/**
 * Compatibility helper for existing call sites:
 * Prints a batch barcode directly to the network thermal printer.
 * Automatically uses this PC's workstation printer if set, otherwise falls back to system default.
 */
export async function printTSPL(
  batchCodeOrCommands: string, 
  printerId?: string,
  options?: PrintBatchOptions
): Promise<boolean> {
  if (!batchCodeOrCommands) return false;
  const targetPrinterId = printerId || getWorkstationPrinterId() || undefined;

  // The server builds the label for the roll (raw printer commands are not accepted)
  await printBatchDirect(batchCodeOrCommands.trim(), undefined, targetPrinterId, options);
  return true;
}
