import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Flashlight, AlertCircle, Scan, CheckCircle2 } from 'lucide-react';
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import { sound } from '../lib/audio';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBarcodeDetected: (code: string) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onBarcodeDetected,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [detectedCode, setDetectedCode] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const hasTriggeredRef = useRef<boolean>(false);
  const scanIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;
    hasTriggeredRef.current = false;
    setDetectedCode(null);

    async function initCameraAndScanner() {
      try {
        setErrorMsg(null);

        // 1. Solicitar acceso a la cámara trasera con alta resolución para códigos 1D
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            // Priorizar enfoque continuo si el navegador lo soporta
            advanced: [{ focusMode: 'continuous' }] as any,
          },
        });

        if (!isSubscribed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setHasPermission(true);

        // 2. Configurar ZXing MultiFormat Reader con formatos prioritarios (EAN-13, EAN-8, UPC, Code128)
        const hints = new Map<DecodeHintType, any>();
        const supportedFormats = [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
        ];
        hints.set(DecodeHintType.POSSIBLE_FORMATS, supportedFormats);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const zxingReader = new BrowserMultiFormatReader(hints);

        // Iniciar escaneo continuo por ZXing
        if (videoRef.current) {
          try {
            const controls = await zxingReader.decodeFromVideoElement(
              videoRef.current,
              (result) => {
                if (result && !hasTriggeredRef.current && isSubscribed) {
                  const raw = result.getText()?.trim();
                  if (raw) {
                    handleSuccessScan(raw);
                  }
                }
              }
            );
            controlsRef.current = controls;
          } catch (readerErr) {
            console.warn('ZXing reader error al iniciar:', readerErr);
          }
        }

        // 3. Acelerador nativo BarcodeDetector si está disponible en Android Chrome / iOS 17+
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
          try {
            const barcodeDetector = new (window as any).BarcodeDetector({
              formats: [
                'ean_13',
                'ean_8',
                'upc_a',
                'upc_e',
                'code_128',
                'code_39',
                'itf',
                'qr_code',
              ],
            });

            scanIntervalRef.current = window.setInterval(async () => {
              if (
                !videoRef.current ||
                videoRef.current.readyState < 2 ||
                hasTriggeredRef.current ||
                !isSubscribed
              ) {
                return;
              }

              try {
                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes.length > 0 && !hasTriggeredRef.current) {
                  const code = barcodes[0].rawValue?.trim();
                  if (code) {
                    handleSuccessScan(code);
                  }
                }
              } catch {
                // Silenciar errores esporádicos entre cuadros
              }
            }, 250);
          } catch (nativeErr) {
            console.warn('BarcodeDetector nativo no inicializado:', nativeErr);
          }
        }
      } catch (err: any) {
        if (!isSubscribed) return;
        setHasPermission(false);
        setErrorMsg(
          err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Permite el acceso a la cámara en el navegador o PWA.'
            : 'No se pudo acceder a la cámara trasera del dispositivo.'
        );
      }
    }

    initCameraAndScanner();

    return () => {
      isSubscribed = false;
      cleanupScanner();
    };
  }, [isOpen]);

  const handleSuccessScan = (code: string) => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    setDetectedCode(code);
    sound.playScan();

    // Pequeño retardo visual para feedback del código detectado antes de cerrar
    setTimeout(() => {
      onBarcodeDetected(code);
      onClose();
    }, 400);
  };

  const cleanupScanner = () => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        // noop
      }
      controlsRef.current = null;
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsTorchOn(false);
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && 'applyConstraints' in track) {
      try {
        const nextTorch = !isTorchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextTorch }],
        });
        setIsTorchOn(nextTorch);
      } catch {
        // Linterna no disponible en este dispositivo o lente
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 animate-in fade-in">
      <div className="relative w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl flex flex-col">
        {/* Cabecera */}
        <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold text-white">Escáner Barcode PWA</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                isTorchOn
                  ? 'bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/30'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
              title="Linterna / Flash"
            >
              <Flashlight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
              title="Cerrar cámara"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Visor de Cámara */}
        <div className="relative w-full aspect-4/3 bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {/* Cuadro de enfoque y animación láser */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
            <div className="relative w-64 h-36 border-2 border-indigo-400/80 rounded-2xl shadow-[0_0_30px_rgba(99,102,241,0.25)] flex items-center justify-center">
              {/* Esquinas resaltadas */}
              <div className="absolute -top-1 -left-1 w-5 h-5 border-t-3 border-l-3 border-indigo-300 rounded-tl-lg"></div>
              <div className="absolute -top-1 -right-1 w-5 h-5 border-t-3 border-r-3 border-indigo-300 rounded-tr-lg"></div>
              <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-3 border-l-3 border-indigo-300 rounded-bl-lg"></div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-3 border-r-3 border-indigo-300 rounded-br-lg"></div>

              {/* Láser de escaneo animado */}
              <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-pulse"></div>

              {/* Indicador de detección exitosa */}
              {detectedCode && (
                <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-xs flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-emerald-400">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 animate-bounce" />
                  <span className="font-mono text-xs font-black text-emerald-200 px-2 py-0.5 bg-emerald-900/60 rounded">
                    {detectedCode}
                  </span>
                </div>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-4 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-rose-400" />
              <p className="text-xs text-rose-200 max-w-xs">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Formatos Soportados e Instrucción */}
        <div className="p-3 bg-slate-950/90 text-center space-y-1.5 border-t border-slate-800">
          <div className="flex items-center justify-center gap-1 text-[11px] font-mono text-indigo-300">
            <Scan className="w-3.5 h-3.5 text-indigo-400" />
            <span>EAN-13 • EAN-8 • UPC-A/E • Code 128</span>
          </div>
          <p className="text-[10px] text-slate-400">
            Enfoca el código de barras dentro del recuadro para detectar y sumar automáticamente.
          </p>
        </div>
      </div>
    </div>
  );
};
