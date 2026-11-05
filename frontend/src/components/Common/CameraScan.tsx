import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Flashlight, X } from 'lucide-react';
import type { ReadInputBarcodeFormat } from 'zxing-wasm/reader';

/**
 * Scanning with the device camera: reads the QR code and the Code 128 barcode on roll labels, shelf
 * barcodes and document numbers. The picture is decoded on the device itself; only the code text
 * goes on, exactly as a handheld scanner would type it, so the server does no extra work.
 * The decoder (zxing-wasm) loads the first time someone opens the camera and is served by our own
 * server, so it works on a warehouse network without internet.
 */

const FORMATS: ReadInputBarcodeFormat[] = ['QRCode', 'Code128'];

// Browsers allow the camera only on https (or localhost); elsewhere the button stays hidden
const cameraApiAvailable = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Camera icon for a scan box; calls onScan with the code read, like pressing Enter after a scan. */
export function CameraScanButton({ onScan, title = 'Scan with camera', disabled, size = 48 }: {
  onScan: (code: string) => void;
  title?: string;
  disabled?: boolean;
  size?: number;
}) {
  const [hasCamera, setHasCamera] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!cameraApiAvailable()) return;
    let live = true;
    navigator.mediaDevices.enumerateDevices()
      .then(devices => { if (live) setHasCamera(devices.some(d => d.kind === 'videoinput')); })
      .catch(() => { /* no camera list, no button */ });
    return () => { live = false; };
  }, []);

  if (!hasCamera) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary camera-scan-button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={title}
        aria-label={title}
        style={{ width: size, minWidth: size, height: size, minHeight: size }}
      >
        <Camera size={20} />
      </button>
      {open && <CameraScanner onClose={() => setOpen(false)} onScan={code => { setOpen(false); onScan(code); }} />}
    </>
  );
}

function cameraError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was refused. Allow the camera for this site in the browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is in use by another app. Close it and try again.';
  return 'The camera could not be started.';
}

// A short beep and buzz, so staff know the code was read without looking at the screen
function confirmRead() {
  navigator.vibrate?.(80);
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = 1500;
    volume.gain.value = 0.15;
    tone.connect(volume).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.12);
    tone.onended = () => { audio.close().catch(() => {}); };
  } catch { /* silent devices still get the vibration */ }
}

function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onScanRef = useRef(onScan);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [error, setError] = useState('');
  const [torch, setTorch] = useState<boolean | null>(null); // null: this camera has no light

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
          import('zxing-wasm/reader'),
          import('zxing-wasm/reader/zxing_reader.wasm?url'),
        ]);
        prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video || !ctx) return;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        if ((track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setTorch(false);
        setStatus('scanning');

        const tick = async () => {
          if (stopped) return;
          const w = video.videoWidth, h = video.videoHeight;
          if (w && h) {
            // Only the middle of the picture, where the guide box is: smaller frames decode faster
            const cw = Math.round(w * 0.85), ch = Math.round(h * 0.6);
            canvas.width = cw;
            canvas.height = ch;
            ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
            const results = await readBarcodes(ctx.getImageData(0, 0, cw, ch), { formats: FORMATS, tryHarder: true, maxNumberOfSymbols: 1 });
            const code = results.find(r => r.isValid && r.text.trim())?.text.trim();
            if (code && !stopped) {
              stopped = true;
              confirmRead();
              onScanRef.current(code);
              return;
            }
          }
          timer = window.setTimeout(tick, 120);
        };
        tick();
      } catch (err) {
        if (!stopped) { setStatus('error'); setError(cameraError(err)); }
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Close with Escape; the page behind does not scroll while the camera is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch { setTorch(null); }
  };

  return createPortal(
    <div className="camera-scan" role="dialog" aria-label="Scan with camera">
      <div className="camera-scan-bar">
        <strong>Scan with camera</strong>
        <div className="camera-scan-actions">
          {torch !== null && (
            <button type="button" className={`btn ${torch ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleTorch}>
              <Flashlight size={18} /> Light
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            <X size={18} /> Close
          </button>
        </div>
      </div>
      <div className="camera-scan-view">
        <video ref={videoRef} className="camera-scan-video" playsInline muted />
        {status !== 'error' && <div className="camera-scan-guide" aria-hidden="true" />}
        <div className="camera-scan-hint">
          {status === 'starting' && 'Starting the camera…'}
          {status === 'scanning' && 'Point at the QR code or barcode'}
          {status === 'error' && error}
        </div>
      </div>
    </div>,
    document.body,
  );
}
