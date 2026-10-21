import { Router, Request, Response } from 'express';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import prisma from '../../lib/prisma';
import { formatDate } from '../../utils/format';
import { requireAuth, requirePermission } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

// Changing printers or probing the network needs the Printer Settings screen permission
const requirePrinterAdmin = requirePermission('ops.printer', 'admin.dashboard');

// Printers live on the warehouse LAN; never let the server connect anywhere else
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// The label layout is designed for 100 x 50 mm stock
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 50;

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

export interface MultiPrinterConfig {
  printers: PrinterDevice[];
  autoPrintOnReceipt: boolean;
  copies: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), 'printer-config.json');

const DEFAULT_PRINTER: PrinterDevice = {
  id: 'printer-primary',
  name: 'Receiving Dock (TSC TE210)',
  model: 'TSC TE210',
  ip: '192.168.1.150',
  port: 9100,
  dpi: 203,
  labelWidthMm: 100,
  labelHeightMm: 50,
  gapMm: 3,
  direction: 1,
  isDefault: true,
  station: 'INBOUND',
};

// Returns a fresh copy so callers can mutate it before saving.
function defaultConfig(): MultiPrinterConfig {
  return { printers: [{ ...DEFAULT_PRINTER }], autoPrintOnReceipt: true, copies: 1 };
}

export function getPrinterConfig(): MultiPrinterConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const fallback = defaultConfig();
      const printers: PrinterDevice[] = Array.isArray(raw.printers) && raw.printers.length > 0
        ? raw.printers
        : fallback.printers;

      // Ensure at least one printer is default
      if (!printers.some(p => p.isDefault)) {
        printers[0].isDefault = true;
      }

      return {
        printers,
        autoPrintOnReceipt: raw.autoPrintOnReceipt ?? fallback.autoPrintOnReceipt,
        copies: raw.copies ?? fallback.copies,
      };
    }
  } catch (err) {
    console.error('Failed to read printer-config.json:', err);
  }
  return defaultConfig();
}

export function savePrinterConfig(cfg: Partial<MultiPrinterConfig>): MultiPrinterConfig {
  const current = getPrinterConfig();
  const updated: MultiPrinterConfig = {
    printers: cfg.printers ?? current.printers,
    autoPrintOnReceipt: cfg.autoPrintOnReceipt ?? current.autoPrintOnReceipt,
    copies: cfg.copies ?? current.copies,
  };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save printer-config.json:', err);
  }
  return updated;
}

export function getDefaultPrinter(cfg?: MultiPrinterConfig): PrinterDevice {
  const config = cfg || getPrinterConfig();
  const found = config.printers.find(p => p.isDefault);
  return found || config.printers[0] || DEFAULT_PRINTER;
}

export function getPrinterDevice(idOrIp?: string, cfg?: MultiPrinterConfig): PrinterDevice {
  const config = cfg || getPrinterConfig();
  if (idOrIp) {
    const byId = config.printers.find(p => p.id === idOrIp);
    if (byId) return byId;
    const byIp = config.printers.find(p => p.ip === idOrIp);
    if (byIp) return byIp;
  }
  return getDefaultPrinter(config);
}

/**
 * Transmits raw TSPL string or Buffer directly to TSC TE210 via TCP Socket on Port 9100
 */
export async function sendTsplToPrinter(
  tspl: string | Buffer,
  targetIp?: string,
  targetPort?: number,
  timeoutMs = 4000
): Promise<{ success: boolean; message: string }> {
  const fallback = getDefaultPrinter();
  const ip = (targetIp || fallback.ip || '').trim();
  const port = targetPort || fallback.port || 9100;

  return new Promise((resolve, reject) => {
    if (!ip) {
      return reject(new Error('Printer IP address is not configured. Please set the IP in Printer Settings.'));
    }

    const client = new net.Socket();
    client.setTimeout(timeoutMs);

    client.connect(port, ip, () => {
      const data = Buffer.isBuffer(tspl) ? tspl : Buffer.from(tspl, 'utf8');
      client.write(data, () => {
        client.end();
        resolve({
          success: true,
          message: `Label sent to TSC TE210 at ${ip}:${port}`,
        });
      });
    });

    client.on('timeout', () => {
      client.destroy();
      reject(
        new Error(
          `Connection to printer at ${ip}:${port} timed out (${timeoutMs}ms). Check if the printer is turned on and connected to the Ethernet network.`
        )
      );
    });

    client.on('error', (err: any) => {
      client.destroy();
      let errorMsg = `Printer connection error (${ip}:${port}): ${err.message}`;
      if (err.code === 'ECONNREFUSED') {
        errorMsg = `Connection refused by printer at ${ip}:${port}. Ensure Port 9100 is open on the printer.`;
      } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
        errorMsg = `Printer host unreachable at ${ip}. Ensure your PC and the printer are on the same local network subnet.`;
      }
      reject(new Error(errorMsg));
    });
  });
}

export interface DiscoveredPrinter {
  ip: string;
  port: number;
  model: string;
  latencyMs: number;
}

/**
 * Checks TCP connectivity to the printer without printing or feeding any label.
 * Returns response latency and model information.
 */
export async function checkPrinterConnection(
  targetIp?: string,
  targetPort?: number,
  timeoutMs = 2500
): Promise<{ success: boolean; latencyMs: number; model: string; message: string }> {
  const fallback = getDefaultPrinter();
  const ip = (targetIp || fallback.ip || '').trim();
  const port = Number(targetPort || fallback.port || 9100);

  if (!ip) {
    throw new Error('Printer IP address is required to check connection.');
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let modelName = '';
    let settled = false;

    client.setTimeout(timeoutMs);

    client.connect(port, ip, () => {
      const latencyMs = Date.now() - startTime;

      // Query model identifier via TSPL query
      try {
        client.write('~!T\r\n');
      } catch (_) {}

      setTimeout(() => {
        if (!settled) {
          settled = true;
          client.end();
          const cleanModel = modelName.trim().replace(/[\r\n\x00]+/g, ' ') || 'TSC TE210 (TSPL Compatible)';
          resolve({
            success: true,
            latencyMs,
            model: cleanModel,
            message: `Printer online & reachable (${latencyMs}ms)`,
          });
        }
      }, 250);
    });

    client.on('data', (chunk) => {
      modelName += chunk.toString('utf8');
    });

    client.on('timeout', () => {
      if (!settled) {
        settled = true;
        client.destroy();
        reject(
          new Error(
            `Connection timed out (${timeoutMs}ms). Ensure the printer is powered on and connected to the Ethernet network.`
          )
        );
      }
    });

    client.on('error', (err: any) => {
      if (!settled) {
        settled = true;
        client.destroy();
        let errorMsg = `Unable to connect to ${ip}:${port} (${err.message})`;
        if (err.code === 'ECONNREFUSED') {
          errorMsg = `Port ${port} connection refused at ${ip}. Check if Port 9100 is open.`;
        } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
          errorMsg = `Printer host unreachable at ${ip}. Check Ethernet cable and subnet.`;
        }
        reject(new Error(errorMsg));
      }
    });
  });
}

/**
 * Detects all non-virtual IPv4 physical network subnets on this computer.
 */
export function getDetectedSubnets(): string[] {
  const subnets: string[] = [];
  const interfaces = os.networkInterfaces();
  const candidates: { subnet: string; name: string; priority: number }[] = [];

  for (const [name, ifaceList] of Object.entries(interfaces)) {
    if (!ifaceList) continue;
    const lower = name.toLowerCase();
    // Exclude virtual adapters, hypervisors, WSL, VPNs, and loopback
    if (
      lower.includes('vethernet') ||
      lower.includes('wsl') ||
      lower.includes('virtual') ||
      lower.includes('vmware') ||
      lower.includes('loopback') ||
      lower.includes('bluetooth') ||
      lower.includes('tap') ||
      lower.includes('npcap') ||
      lower.includes('tailscale') ||
      lower.includes('docker')
    ) {
      continue;
    }

    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        if (ip.startsWith('169.254.')) continue; // ignore APIPA autoconfig
        if (ip.startsWith('192.168.56.')) continue; // ignore VirtualBox Host-Only default
        const parts = ip.split('.');
        if (parts.length === 4) {
          const sub = `${parts[0]}.${parts[1]}.${parts[2]}`;
          let prio = 2;
          if (lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('wlan')) {
            prio = 0; // Highest priority for active Wi-Fi
          } else if (lower.includes('ethernet') || lower.includes('lan')) {
            prio = 1;
          }
          candidates.push({ subnet: sub, name, priority: prio });
        }
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  for (const c of candidates) {
    if (!subnets.includes(c.subnet)) {
      subnets.push(c.subnet);
    }
  }

  // Common Indian/office router subnets fallback
  if (subnets.length === 0) {
    subnets.push('192.168.1', '192.168.0', '192.168.29');
  }

  return subnets;
}

export interface DiscoveryResult {
  printers: DiscoveredPrinter[];
  scannedSubnets: string[];
}

/**
 * Automatically scans the local subnet on Port 9100 to discover thermal printers.
 */
export async function discoverLocalPrinters(customSubnet?: string): Promise<DiscoveryResult> {
  let subnetsToScan: string[] = [];
  let singleIpTarget: string | null = null;

  if (customSubnet && customSubnet.trim()) {
    const clean = customSubnet.trim();
    const parts = clean.split('.');
    if (parts.length === 4) {
      // User provided a full IP address like 192.168.1.150
      singleIpTarget = clean;
      subnetsToScan = [`${parts[0]}.${parts[1]}.${parts[2]}`];
    } else if (parts.length === 3) {
      subnetsToScan = [clean];
    } else if (parts.length === 2) {
      subnetsToScan = [`${parts[0]}.${parts[1]}.1`];
    } else {
      subnetsToScan = getDetectedSubnets();
    }
  } else {
    subnetsToScan = getDetectedSubnets();
  }

  const probeHost = (host: string): Promise<DiscoveredPrinter | null> => {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      const startTime = Date.now();
      let response = '';
      let resolved = false;

      const finish = (result: DiscoveredPrinter | null) => {
        if (!resolved) {
          resolved = true;
          sock.destroy();
          resolve(result);
        }
      };

      sock.setTimeout(550);

      sock.connect(9100, host, () => {
        const latency = Date.now() - startTime;
        try {
          sock.write('~!T\r\n');
        } catch (_) {}

        setTimeout(() => {
          const cleanModel = response.trim().replace(/[\r\n\x00]+/g, ' ') || 'TSC Thermal Printer';
          finish({
            ip: host,
            port: 9100,
            model: cleanModel,
            latencyMs: latency,
          });
        }, 120);
      });

      sock.on('data', (d) => {
        response += d.toString('utf8');
      });

      sock.on('error', () => {
        finish(null);
      });

      sock.on('timeout', () => {
        finish(null);
      });
    });
  };

  const discovered: DiscoveredPrinter[] = [];

  if (singleIpTarget) {
    const res = await probeHost(singleIpTarget);
    if (res) {
      discovered.push(res);
    }
  } else {
    for (const subnet of subnetsToScan) {
      const hosts: string[] = [];
      for (let i = 1; i <= 254; i++) {
        hosts.push(`${subnet}.${i}`);
      }

      const batchSize = 45;
      for (let i = 0; i < hosts.length; i += batchSize) {
        const chunk = hosts.slice(i, i + batchSize);
        const results = await Promise.all(chunk.map(probeHost));
        for (const res of results) {
          if (res && !discovered.some((d) => d.ip === res.ip)) {
            discovered.push(res);
          }
        }
      }
    }
  }

  return {
    printers: discovered,
    scannedSubnets: subnetsToScan,
  };
}

/**
 * Builds TSPL for 100mm x 50mm label for a batch (TSC TE210 @ 203 DPI or 300 DPI)
 * Clean, balanced 3-zone layout with native crisp typography, QR code, and full-width barcode.
 */
// Keeps user-entered text from breaking out of a quoted TSPL argument
function tsplText(value: string): string {
  return value.replace(/["\r\n\\]/g, ' ').trim();
}

// Media settings taken from the printer's registry entry
function tsplMediaHeader(device?: Pick<PrinterDevice, 'gapMm' | 'direction'>): string {
  const gap = Number(device?.gapMm) > 0 ? Number(device?.gapMm) : 3;
  const direction = device?.direction === 0 ? 0 : 1;
  return `SIZE ${LABEL_WIDTH_MM} mm, ${LABEL_HEIGHT_MM} mm\nGAP ${gap} mm, 0 mm\nDIRECTION ${direction}\nCLS\n`;
}

export function build100x50Tspl(batch: any, copies = 1, dpi = 203, device?: Pick<PrinterDevice, 'gapMm' | 'direction'>): Buffer {
  const isFabric = (batch.itemType || 'FABRIC') === 'FABRIC';
  const itemType = batch.itemType || 'FABRIC';

  // Format short UOM: "M" for fabric/meters, "PCS", "PAIRS", etc.
  const rawUom = (batch.uom || '').toUpperCase().trim();
  let uomShort = 'M';
  if (isFabric || rawUom === 'METERS' || rawUom === 'METER' || rawUom === 'M') {
    uomShort = 'M';
  } else if (rawUom === 'PCS' || rawUom === 'PIECES' || rawUom === 'PIECE' || itemType === 'READY_MADE') {
    uomShort = 'PCS';
  } else if (rawUom) {
    uomShort = rawUom;
  }

  const brand = tsplText(batch.brand || '');
  const quality = tsplText(batch.quality || batch.category || '');
  const shade = tsplText(batch.shade || '');
  const artNo = tsplText(batch.artNo || '');
  const size = tsplText(batch.size || '');
  const name = tsplText(batch.name || '');
  const batchCode = tsplText(batch.batchCode || 'BAT-0000');

  // Order received date (DD-MM-YYYY in IST)
  const dateFormatted = formatDate(batch.createdAt || new Date());

  // Scaling helper for 300 DPI vs 203 DPI (8 dots/mm vs ~12 dots/mm)
  const scale = dpi === 300 ? (300 / 203) : 1;
  const s = (v: number) => scale === 1 ? v : Math.round(v * scale);
  const mul = dpi === 300 ? 2 : 1;

  let cmd = tsplMediaHeader(device);

  // Zone 1: Top Header (Crisp native text logo + Receive Date)
  cmd += `TEXT ${s(40)},${s(18)},"3",0,${mul},${mul},"OLINO UNIFORMS"\n`;
  cmd += `TEXT ${s(530)},${s(22)},"2",0,${mul},${mul},"REC: ${dateFormatted}"\n`;
  cmd += `BAR ${s(40)},${s(56)},${s(720)},${dpi === 300 ? 3 : 2}\n`;

  // Zone 2: Middle Section
  // Left: Item Specs (Full quality/brand/shade without truncating)
  const font = "2";
  if (isFabric) {
    cmd += `TEXT ${s(40)},${s(72)},"${font}",0,${mul},${mul},"BRAND : ${(brand || 'N/A').substring(0, 30)}"\n`;
    cmd += `TEXT ${s(40)},${s(108)},"${font}",0,${mul},${mul},"QUAL  : ${(quality || 'N/A').substring(0, 30)}"\n`;
    cmd += `TEXT ${s(40)},${s(144)},"${font}",0,${mul},${mul},"SHADE : ${(shade || 'N/A').substring(0, 30)}"\n`;
  } else if (itemType === 'READY_MADE') {
    cmd += `TEXT ${s(40)},${s(72)},"${font}",0,${mul},${mul},"ITEM  : ${(name || 'N/A').substring(0, 30)}"\n`;
    cmd += `TEXT ${s(40)},${s(108)},"${font}",0,${mul},${mul},"ART   : ${(artNo || 'N/A').substring(0, 30)}"\n`;
    cmd += `TEXT ${s(40)},${s(144)},"${font}",0,${mul},${mul},"SIZE  : ${(size || 'N/A').substring(0, 30)}"\n`;
  } else {
    cmd += `TEXT ${s(40)},${s(72)},"${font}",0,${mul},${mul},"ITEM  : ${(name || 'N/A').substring(0, 30)}"\n`;
    cmd += `TEXT ${s(40)},${s(108)},"${font}",0,${mul},${mul},"SPEC  : ${(quality || 'N/A').substring(0, 30)}"\n`;
    cmd += `TEXT ${s(40)},${s(144)},"${font}",0,${mul},${mul},"SIZE  : ${(size || 'N/A').substring(0, 30)}"\n`;
  }

  // Center-Right: Roll Quantity (Bold & Prominent)
  const isRemainder = Boolean(batch.isRemainder || batch.status === 'PARTIALLY_USED');
  const qtyLabel = isRemainder ? "REMAINDER" : "ROLL QTY";
  const numQty = typeof batch.quantity === 'number' ? batch.quantity : parseFloat(batch.quantity);
  const formattedQty = !isNaN(numQty) ? (Number.isInteger(numQty) ? String(numQty) : numQty.toFixed(2).replace(/\.?0+$/, '')) : batch.quantity;
  cmd += `TEXT ${s(435)},${s(80)},"1",0,${mul},${mul},"${qtyLabel}"\n`;
  cmd += `TEXT ${s(435)},${s(104)},"4",0,${mul},${mul},"${formattedQty} ${uomShort}"\n`;

  // Far Right: Crisp 2D QR Code
  const qrCell = dpi === 300 ? 7 : 5;
  cmd += `QRCODE ${s(600)},${s(70)},L,${qrCell},A,0,"${batchCode}"\n`;

  // Divider Line
  cmd += `BAR ${s(40)},${s(218)},${s(720)},${dpi === 300 ? 3 : 2}\n`;

  // Zone 3: Bottom Section (Centered Code 128 Barcode with human-readable text)
  const narrow = dpi === 300 ? 3 : 2;
  const wide = dpi === 300 ? 6 : 4;
  cmd += `BARCODE ${s(80)},${s(235)},"128",${s(85)},1,0,${narrow},${wide},"${batchCode}"\n`;

  cmd += `PRINT ${copies || 1}\n`;

  return Buffer.from(cmd, 'utf8');
}

/**
 * Builds TSPL for 100mm x 50mm test calibration label with clean typography
 */
export function buildTestTspl(ip: string, port: number, dpi = 203, device?: Pick<PrinterDevice, 'gapMm' | 'direction'>): Buffer {
  const scale = dpi === 300 ? (300 / 203) : 1;
  const s = (v: number) => scale === 1 ? v : Math.round(v * scale);
  const mul = dpi === 300 ? 2 : 1;

  let cmd = tsplMediaHeader(device);

  // Zone 1: Header
  cmd += `TEXT ${s(40)},${s(18)},"3",0,${mul},${mul},"OLINO UNIFORMS"\n`;
  cmd += `TEXT ${s(490)},${s(22)},"2",0,${mul},${mul},"CALIBRATION TEST"\n`;
  cmd += `BAR ${s(40)},${s(56)},${s(720)},${dpi === 300 ? 3 : 2}\n`;

  // Zone 2: Middle Specs & Status
  cmd += `TEXT ${s(40)},${s(72)},"2",0,${mul},${mul},"DEVICE : TSC THERMAL PRINTER"\n`;
  cmd += `TEXT ${s(40)},${s(108)},"2",0,${mul},${mul},"RESOL  : ${dpi} DPI (100 x 50 mm)"\n`;
  cmd += `TEXT ${s(40)},${s(144)},"2",0,${mul},${mul},"PORT   : ${port} (TSPL SOCKET)"\n`;

  cmd += `TEXT ${s(435)},${s(80)},"1",0,${mul},${mul},"LINK STATUS"\n`;
  cmd += `TEXT ${s(435)},${s(104)},"4",0,${mul},${mul},"ONLINE"\n`;

  const qrCell = dpi === 300 ? 7 : 5;
  cmd += `QRCODE ${s(600)},${s(70)},L,${qrCell},A,0,"TSC-${ip}:${port}"\n`;

  // Divider Line
  cmd += `BAR ${s(40)},${s(218)},${s(720)},${dpi === 300 ? 3 : 2}\n`;

  // Zone 3: Bottom Barcode
  const narrow = dpi === 300 ? 3 : 2;
  const wide = dpi === 300 ? 6 : 4;
  cmd += `BARCODE ${s(80)},${s(235)},"128",${s(85)},1,0,${narrow},${wide},"TSC-${ip}"\n`;

  cmd += `PRINT 1\n`;

  return Buffer.from(cmd, 'utf8');
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// GET /api/printer/settings — Get current printer configuration & all devices
router.get('/settings', (_req: Request, res: Response) => {
  const config = getPrinterConfig();
  const defaultPrinter = getDefaultPrinter(config);
  res.json({
    ...config,
    defaultPrinter,
  });
});

// POST /api/printer/settings — Update global printer settings
router.post('/settings', requirePrinterAdmin, (req: Request, res: Response) => {
  // Only the global switches; devices are managed through /devices
  const { autoPrintOnReceipt, copies } = req.body || {};
  const updated = savePrinterConfig({
    ...(typeof autoPrintOnReceipt === 'boolean' && { autoPrintOnReceipt }),
    ...(copies !== undefined && Number(copies) >= 1 && { copies: Math.floor(Number(copies)) }),
  });
  const defaultPrinter = getDefaultPrinter(updated);
  res.json({ success: true, settings: updated, defaultPrinter });
});

// POST /api/printer/devices — Add a new printer device
router.post('/devices', requirePrinterAdmin, (req: Request, res: Response) => {
  const { name, model, ip, port, dpi, gapMm, direction, station, isDefault } = req.body;
  if (!name || !ip) {
    res.status(400).json({ success: false, error: 'Printer name and IP address are required' });
    return;
  }
  if (!isPrivateIPv4(ip)) {
    res.status(400).json({ success: false, error: 'Printer IP must be a local network address (10.x, 172.16-31.x or 192.168.x)' });
    return;
  }

  const config = getPrinterConfig();
  const id = `prn-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const shouldBeDefault = Boolean(isDefault || config.printers.length === 0);

  if (shouldBeDefault) {
    config.printers.forEach(p => p.isDefault = false);
  }

  const newDevice: PrinterDevice = {
    id,
    name: name.trim(),
    model: (model || 'TSC TE210').trim(),
    ip: ip.trim(),
    port: Number(port || 9100),
    dpi: Number(dpi || 203),
    labelWidthMm: LABEL_WIDTH_MM,
    labelHeightMm: LABEL_HEIGHT_MM,
    gapMm: Number(gapMm || 3),
    direction: Number(direction || 1),
    isDefault: shouldBeDefault,
    station: station || 'INBOUND',
  };

  config.printers.push(newDevice);
  const updated = savePrinterConfig(config);
  res.json({ success: true, device: newDevice, config: updated, defaultPrinter: getDefaultPrinter(updated) });
});

// PUT /api/printer/devices/:id — Update an existing printer device
router.put('/devices/:id', requirePrinterAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const config = getPrinterConfig();
  const index = config.printers.findIndex(p => p.id === id);

  if (index === -1) {
    res.status(404).json({ success: false, error: 'Printer device not found' });
    return;
  }

  const updates = req.body || {};
  if (updates.ip && !isPrivateIPv4(updates.ip)) {
    res.status(400).json({ success: false, error: 'Printer IP must be a local network address (10.x, 172.16-31.x or 192.168.x)' });
    return;
  }
  if (updates.isDefault) {
    config.printers.forEach(p => p.isDefault = false);
  }

  const current = config.printers[index];
  config.printers[index] = {
    id: id as string, // Keep ID immutable
    name: updates.name ? String(updates.name).trim() : current.name,
    model: updates.model ? String(updates.model).trim() : current.model,
    ip: updates.ip ? String(updates.ip).trim() : current.ip,
    port: Number(updates.port || current.port),
    dpi: Number(updates.dpi || current.dpi),
    labelWidthMm: LABEL_WIDTH_MM,
    labelHeightMm: LABEL_HEIGHT_MM,
    gapMm: Number(updates.gapMm || current.gapMm),
    direction: Number(updates.direction ?? current.direction) === 0 ? 0 : 1,
    isDefault: updates.isDefault ? true : current.isDefault,
    station: updates.station || current.station,
  };

  if (!config.printers.some(p => p.isDefault)) {
    config.printers[0].isDefault = true;
  }

  const updated = savePrinterConfig(config);
  res.json({ success: true, device: config.printers[index], config: updated, defaultPrinter: getDefaultPrinter(updated) });
});

// DELETE /api/printer/devices/:id — Remove a printer device
router.delete('/devices/:id', requirePrinterAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const config = getPrinterConfig();

  if (config.printers.length <= 1) {
    res.status(400).json({ success: false, error: 'Cannot delete the only registered printer. At least one printer must remain.' });
    return;
  }

  const index = config.printers.findIndex(p => p.id === id);
  if (index === -1) {
    res.status(404).json({ success: false, error: 'Printer device not found' });
    return;
  }

  const wasDefault = config.printers[index].isDefault;
  config.printers.splice(index, 1);

  if (wasDefault && config.printers.length > 0) {
    config.printers[0].isDefault = true;
  }

  const updated = savePrinterConfig(config);
  res.json({ success: true, message: 'Printer removed successfully', config: updated, defaultPrinter: getDefaultPrinter(updated) });
});

// POST /api/printer/devices/:id/set-default — Set active default printer
router.post('/devices/:id/set-default', requirePrinterAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const config = getPrinterConfig();
  const target = config.printers.find(p => p.id === id);

  if (!target) {
    res.status(404).json({ success: false, error: 'Printer device not found' });
    return;
  }

  config.printers.forEach(p => {
    p.isDefault = (p.id === id);
  });

  const updated = savePrinterConfig(config);
  res.json({ success: true, defaultPrinter: target, config: updated });
});

// POST /api/printer/check-connection — Test connection by IP/port OR by printerId
router.post('/check-connection', requirePrinterAdmin, async (req: Request, res: Response) => {
  const { ip, port, printerId } = req.body;
  let targetIp = (ip || '').trim();
  let targetPort = Number(port || 0);

  if (printerId) {
    const dev = getPrinterDevice(printerId);
    if (dev) {
      targetIp = dev.ip;
      targetPort = dev.port;
    }
  }

  if (!targetIp) {
    const def = getDefaultPrinter();
    targetIp = def.ip;
    targetPort = def.port;
  }

  if (!isPrivateIPv4(targetIp)) {
    res.status(400).json({ success: false, error: 'Printer IP must be a local network address (10.x, 172.16-31.x or 192.168.x)' });
    return;
  }

  try {
    const result = await checkPrinterConnection(targetIp, targetPort);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/printer/subnets — Return detected physical subnets on the host
router.get('/subnets', requirePrinterAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, subnets: getDetectedSubnets() });
});

// POST /api/printer/discover — Auto-scan local network subnet on Port 9100
router.post('/discover', requirePrinterAdmin, async (req: Request, res: Response) => {
  const { subnet } = req.body || {};
  if (subnet && String(subnet).trim()) {
    // Accept a full IP or a 3-part subnet; check it as an address on that subnet
    const parts = String(subnet).trim().split('.');
    const probe = parts.length === 4 ? parts.join('.') : [...parts.slice(0, 3), '1'].join('.');
    if (parts.length < 3 || !isPrivateIPv4(probe)) {
      res.status(400).json({ success: false, error: 'Only local network subnets (10.x, 172.16-31.x, 192.168.x) can be scanned' });
      return;
    }
  }
  try {
    const result = await discoverLocalPrinters(subnet);
    res.json({
      success: true,
      count: result.printers.length,
      printers: result.printers,
      scannedSubnets: result.scannedSubnets,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/printer/test-print — Send test calibration label to printer
router.post('/test-print', requirePrinterAdmin, async (req: Request, res: Response) => {
  const { ip, port, printerId, dpi } = req.body;
  let targetDevice: PrinterDevice | undefined;

  if (printerId) {
    targetDevice = getPrinterDevice(printerId);
  }

  const config = getPrinterConfig();
  const def = getDefaultPrinter(config);

  const targetIp = (ip || targetDevice?.ip || def.ip || '').trim();
  const targetPort = Number(port || targetDevice?.port || def.port || 9100);
  const targetDpi = Number(dpi || targetDevice?.dpi || def.dpi || 203);

  if (!targetIp) {
    res.status(400).json({ success: false, error: 'Printer IP address is required' });
    return;
  }
  if (!isPrivateIPv4(targetIp)) {
    res.status(400).json({ success: false, error: 'Printer IP must be a local network address (10.x, 172.16-31.x or 192.168.x)' });
    return;
  }

  try {
    const tspl = buildTestTspl(targetIp, targetPort, targetDpi, targetDevice || def);
    const result = await sendTsplToPrinter(tspl, targetIp, targetPort);
    res.json(result);
  } catch (err: any) {
    console.error('Test print failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/printer/print-batch/:batchCode — Send batch label to specific or default printer
router.post('/print-batch/:batchCode', async (req: Request, res: Response) => {
  const { batchCode } = req.params;
  const { copies, printerId, quantity, isRemainder } = req.body || {};

  try {
    const batch = await prisma.itemBatch.findUnique({
      where: { batchCode: batchCode as string },
      include: {
        poLine: {
          include: {
            po: true,
          },
        },
      },
    });

    if (!batch) {
      res.status(404).json({ success: false, error: 'Batch not found' });
      return;
    }

    if (quantity !== undefined && quantity !== null && !isNaN(Number(quantity))) {
      batch.quantity = Number(quantity);
    }
    if (isRemainder !== undefined) {
      (batch as any).isRemainder = Boolean(isRemainder);
    }

    const config = getPrinterConfig();
    const targetDevice = getPrinterDevice(printerId, config);
    const numCopies = copies || config.copies || 1;
    const tspl = build100x50Tspl(batch, numCopies, targetDevice.dpi || 203, targetDevice);

    await sendTsplToPrinter(tspl, targetDevice.ip, targetDevice.port);
    res.json({
      success: true,
      message: `Label for ${batchCode} printed on ${targetDevice.name} (${targetDevice.ip})`,
      batchCode,
      printer: targetDevice.name,
      ip: targetDevice.ip,
      quantity: batch.quantity,
      isRemainder: (batch as any).isRemainder,
    });
  } catch (err: any) {
    console.error(`Print batch ${batchCode} failed:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/printer/raw-tspl — Send raw TSPL commands directly to the printer
router.post('/raw-tspl', async (req: Request, res: Response) => {
  const { tspl, printerId } = req.body;
  if (!tspl) {
    res.status(400).json({ success: false, error: 'TSPL command string required' });
    return;
  }
  try {
    // Use this workstation's printer when given, otherwise the default
    const device = getPrinterDevice(printerId);
    const result = await sendTsplToPrinter(tspl, device.ip, device.port);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
