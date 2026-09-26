import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Flashlight, AlertCircle } from 'lucide-react';
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
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;

    async function startCamera() {
      try {
        setErrorMsg(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
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

        // Iniciar detección de código de barras
        startBarcodeDetection();
      } catch (err: any) {
        if (!isSubscribed) return;
        setHasPermission(false);
        setErrorMsg(
          err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Concede permiso en el navegador.'
            : 'No se pudo acceder a la cámara del dispositivo.'
        );
      }
    }

    startCamera();

    return () => {
      isSubscribed = false;
      stopCamera();
    };
  }, [isOpen]);

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startBarcodeDetection = () => {
    // Si la API nativa de BarcodeDetector está disponible (Chrome Android / iOS 17+)
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const barcodeDetector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
        });

        scanIntervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;

          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              if (code) {
                sound.playScan();
                onBarcodeDetected(code);
                onClose();
              }
            }
          } catch {
            // Ignorar errores esporádicos de frame
          }
        }, 300);
      } catch (err) {
        console.warn('BarcodeDetector no soportado:', err);
      }
    }
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
        // Torch no soportado en este dispositivo
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
            <span className="text-xs font-bold text-white">Escáner de Código de Barras</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTorch}
              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                isTorchOn
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
              title="Linterna"
            >
              <Flashlight className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
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
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-8">
            <div className="relative w-48 h-32 border-2 border-indigo-500/80 rounded-xl shadow-2xl">
              {/* Esquinas resaltadas */}
              <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-indigo-400"></div>
              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-indigo-400"></div>
              <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-indigo-400"></div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-indigo-400"></div>

              {/* Láser de escaneo animado */}
              <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-bounce mt-16"></div>
            </div>
          </div>

          {errorMsg && (
            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-rose-400" />
              <p className="text-xs text-rose-200">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Instrucciones de pie */}
        <div className="p-3 bg-slate-950/80 text-center text-xs text-slate-400 border-t border-slate-800">
          Apunta el código de barras o QR hacia el centro del visor.
        </div>
      </div>
    </div>
  );
};
