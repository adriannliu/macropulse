import { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatOneDReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { lookupBarcode, normalizeBarcode } from '../barcodeApi';
import type { NutritionSearchResult } from '../nutritionApi';
import { calcKcal } from '../mathEngine';
import { ScanBarcode, Loader2, Check, X, CameraOff, RotateCcw } from 'lucide-react';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmLog: (product: NutritionSearchResult, grams: number) => void;
}

type Phase = 'scanning' | 'looking_up' | 'result' | 'not_found';

// Retail packaging barcodes only; skipping QR/2D formats keeps decoding fast
const SCAN_HINTS = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E],
  ],
]);

export function BarcodeScannerModal({ isOpen, onClose, onConfirmLog }: BarcodeScannerModalProps) {
  const [phase, setPhase] = useState<Phase>('scanning');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [lastCode, setLastCode] = useState('');
  const [product, setProduct] = useState<NutritionSearchResult | null>(null);
  const [grams, setGrams] = useState(100);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Reset to a fresh scan whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setPhase('scanning');
      setErrorMsg(null);
      setCameraError(null);
      setManualCode('');
      setProduct(null);
    }
  }, [isOpen]);

  // Camera lifecycle: runs only while the modal is open and in the scanning phase
  useEffect(() => {
    if (!isOpen || phase !== 'scanning' || !videoRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not available in this browser. Enter the barcode digits below.');
      return;
    }

    let cancelled = false;
    let controls: IScannerControls | null = null;
    const reader = new BrowserMultiFormatOneDReader(SCAN_HINTS);

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (result, _err, ctrl) => {
          if (result && !cancelled) {
            cancelled = true;
            ctrl.stop();
            handleLookup(result.getText());
          }
        }
      )
      .then((ctrl) => {
        // Effect may have been torn down while the camera was starting
        if (cancelled) ctrl.stop();
        else controls = ctrl;
      })
      .catch((err: any) => {
        if (cancelled) return;
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission denied. Enter the barcode digits below instead.'
            : 'Could not start the camera. Enter the barcode digits below instead.'
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // handleLookup only uses state setters, so it is safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, phase]);

  const handleLookup = async (rawCode: string) => {
    const code = normalizeBarcode(rawCode);
    if (!code) {
      setErrorMsg('Barcodes are 8 to 14 digits.');
      return;
    }

    setErrorMsg(null);
    setLastCode(code);
    setPhase('looking_up');

    try {
      const found = await lookupBarcode(code);
      if (found) {
        setProduct(found);
        setGrams(found.defaultGrams);
        setPhase('result');
      } else {
        setPhase('not_found');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lookup failed. Check your connection.');
      setPhase('not_found');
    }
  };

  const handleRescan = () => {
    setProduct(null);
    setErrorMsg(null);
    setManualCode('');
    setPhase('scanning');
  };

  if (!isOpen) return null;

  const ratio = grams / 100;
  const portion = product
    ? { p: product.p * ratio, c: product.c * ratio, f: product.f * ratio }
    : { p: 0, c: 0, f: 0 };
  const portionKcal = Math.round(calcKcal(portion.p, portion.c, portion.f));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <ScanBarcode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Barcode Scanner</h2>
              <p className="text-xs text-slate-400">Packaged food lookup via Open Food Facts.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {phase === 'scanning' && (
            <>
              {cameraError ? (
                <div className="aspect-video rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <CameraOff className="w-6 h-6 text-slate-500" />
                  <p className="text-xs text-slate-400">{cameraError}</p>
                </div>
              ) : (
                <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-slate-800">
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  {/* Aiming guide */}
                  <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-20 border-2 border-indigo-400/80 rounded-lg pointer-events-none" />
                  <div className="absolute bottom-2 inset-x-0 text-center text-[11px] font-mono text-slate-300">
                    Center the barcode in the box
                  </div>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleLookup(manualCode);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Or type barcode digits (e.g. 012345678905)"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono transition disabled:opacity-50"
                >
                  Look Up
                </button>
              </form>
              {errorMsg && <p className="text-xs text-rose-400 font-mono">{errorMsg}</p>}
            </>
          )}

          {phase === 'looking_up' && (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-xs font-mono">Looking up {lastCode}…</span>
            </div>
          )}

          {phase === 'not_found' && (
            <div className="py-6 space-y-3 text-center">
              <p className="text-sm text-slate-200">
                {errorMsg || (
                  <>
                    No nutrition data found for <span className="font-mono">{lastCode}</span>.
                  </>
                )}
              </p>
              <p className="text-xs text-slate-500">
                Try rescanning, or add it with Smart Custom Food using the name on the package.
              </p>
              <button
                onClick={handleRescan}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-mono inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Scan Again
              </button>
            </div>
          )}

          {phase === 'result' && product && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-sm font-semibold text-white">{product.name}</div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  {lastCode} · per 100g: {product.kcal} kcal ·{' '}
                  <span className="text-emerald-400">{product.p}g P</span> ·{' '}
                  <span className="text-amber-400">{product.c}g C</span> ·{' '}
                  <span className="text-rose-400">{product.f}g F</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] text-slate-400 font-mono">Portion</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      value={grams}
                      onChange={(e) => setGrams(Math.max(0, Number(e.target.value) || 0))}
                      className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-right text-white"
                    />
                    <span className="text-xs font-mono text-slate-500">g</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(500, product.defaultGrams * 3)}
                  step={5}
                  value={grams}
                  onChange={(e) => setGrams(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-sm font-bold font-mono text-white">{portionKcal}</div>
                  <div className="text-[10px] text-slate-500 font-mono">kcal</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-sm font-bold font-mono text-emerald-400">{portion.p.toFixed(1)}</div>
                  <div className="text-[10px] text-slate-500 font-mono">P (g)</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-sm font-bold font-mono text-amber-400">{portion.c.toFixed(1)}</div>
                  <div className="text-[10px] text-slate-500 font-mono">C (g)</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-sm font-bold font-mono text-rose-400">{portion.f.toFixed(1)}</div>
                  <div className="text-[10px] text-slate-500 font-mono">F (g)</div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleRescan}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-mono inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Rescan
                </button>
                <button
                  onClick={() => onConfirmLog(product, grams)}
                  disabled={grams <= 0}
                  className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-mono font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  Log {grams}g
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
