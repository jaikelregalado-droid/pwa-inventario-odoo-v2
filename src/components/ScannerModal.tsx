import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Camera,
  Flashlight,
  AlertCircle,
  Scan,
  CheckCircle2,
  RefreshCw,
  Image as ImageIcon,
  ArrowRight
} from 'lucide-react';
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import Tesseract from 'tesseract.js';
import { sound } from '../lib/audio';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBarcodeDetected: (code: string) => void;
}

/**
 * Extrae secuencias numéricas o alfanuméricas representativas de un código de barras
 * a partir del texto extraído por OCR
 */
function extractBarcodeFromOcrText(rawText: string): string | null {
  if (!rawText) return null;

  // 1. Buscar secuencias numéricas continuas de 8 a 14 dígitos (EAN-13, UPC-A, EAN-8)
  const numbersOnlyMatches = rawText.match(/\b\d{8,14}\b/g);
  if (numbersOnlyMatches && numbersOnlyMatches.length > 0) {
    const ean13 = numbersOnlyMatches.find((m) => m.length === 13);
    if (ean13) return ean13;
    const upcA = numbersOnlyMatches.find((m) => m.length === 12);
    if (upcA) return upcA;
    const ean8 = numbersOnlyMatches.find((m) => m.length === 8);
    if (ean8) return ean8;
    return numbersOnlyMatches[0];
  }

  // 2. Extraer líneas donde los dígitos vengan separados por espacios (ej. "7 5 9 1 2 3 4 5 6 7 8 9 0")
  const lines = rawText.split('\n');
  for (const line of lines) {
    const compactDigits = line.replace(/\D/g, '');
    if (compactDigits.length >= 8 && compactDigits.length <= 14) {
      return compactDigits;
    }
  }

  // 3. Buscar códigos alfanuméricos estructurados (Code 128 / Code 39)
  const alnumMatches = rawText.match(/[A-Z0-9-]{5,18}/g);
  if (alnumMatches && alnumMatches.length > 0) {
    // Filtrar palabras comunes no deseadas
    const candidate = alnumMatches.find(
      (m) => !['PRODUCT', 'ARTICULO', 'CODIGO', 'PRECIO', 'TOTAL'].includes(m.toUpperCase())
    );
    if (candidate) return candidate;
  }

  return null;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onBarcodeDetected,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState<string>('');

  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  // Inicializar cámara en vivo para encuadre
  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;
    setCapturedImage(null);
    setDetectedCode(null);
    setIsProcessing(false);
    setErrorMsg(null);
    setManualCodeInput('');

    // Configurar ZXing MultiFormat Reader
    const hints = new Map<DecodeHintType, any>();
    const supportedFormats = [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
    ];
    hints.set(DecodeHintType.POSSIBLE_FORMATS, supportedFormats);
    hints.set(DecodeHintType.TRY_HARDER, true);
    readerRef.current = new BrowserMultiFormatReader(hints);

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
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
      } catch (err: any) {
        if (!isSubscribed) return;
        setHasPermission(false);
        setErrorMsg(
          err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Permite el acceso para capturar fotos de códigos.'
            : 'No se pudo iniciar la cámara del dispositivo. Puedes subir una foto de la etiqueta.'
        );
      }
    }

    startCamera();

    return () => {
      isSubscribed = false;
      cleanupCamera();
    };
  }, [isOpen]);

  const cleanupCamera = () => {
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
        // Torch no soportado
      }
    }
  };

  // 1. CAPTURAR FOTOGRAFÍA ESTÁTICA Y APLICAR PROCESAMIENTO OCR + DECODIFICADOR
  const handleCapturePhoto = async () => {
    if (!videoRef.current || isProcessing) return;

    try {
      setIsProcessing(true);
      setErrorMsg(null);
      setProcessingStatus('Capturando fotografía en alta resolución...');

      const video = videoRef.current;
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo inicializar contexto 2D');

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      setCapturedImage(dataUrl);

      // Pausar video mientras se procesa
      video.pause();

      await analyzeStaticImage(canvas);
    } catch (err: any) {
      console.error('Error al capturar foto:', err);
      setErrorMsg(err.message || 'Error al capturar la fotografía');
      setIsProcessing(false);
    }
  };

  // 2. ANALIZAR IMAGEN ESTÁTICA: DECODIFICADOR GRÁFICO (ZXing) + OCR (Tesseract.js)
  const analyzeStaticImage = async (canvas: HTMLCanvasElement) => {
    let finalCode: string | null = null;

    // FASE A: Decodificador Gráfico Instantáneo sobre Canvas (ZXing)
    setProcessingStatus('Analizando patrón de barras (EAN/UPC/Code128)...');
    try {
      if (readerRef.current) {
        const zxingResult = readerRef.current.decodeFromCanvas(canvas);
        if (zxingResult) {
          const raw = zxingResult.getText()?.trim();
          if (raw) {
            finalCode = raw;
          }
        }
      }
    } catch {
      // Fallback a detección nativa si ZXing directo no encontró barras
    }

    // FASE B: Acelerador nativo BarcodeDetector si está disponible
    if (!finalCode && typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const barcodeDetector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });
        const barcodes = await barcodeDetector.detect(canvas);
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          finalCode = barcodes[0].rawValue.trim();
        }
      } catch {
        // Continuar a OCR
      }
    }

    // FASE C: OCR (Tesseract.js) para extraer la secuencia numérica impresa
    if (!finalCode) {
      setProcessingStatus('Leyendo dígitos numéricos impresos con OCR...');
      try {
        const ocrResult = await Tesseract.recognize(canvas, 'eng');
        const text = ocrResult?.data?.text || '';
        const extracted = extractBarcodeFromOcrText(text);
        if (extracted) {
          finalCode = extracted;
        }
      } catch (ocrErr) {
        console.warn('OCR procesamiento omitido:', ocrErr);
      }
    }

    // FASE D: Sanitización y Resultado
    if (finalCode) {
      // Sanitizar: eliminar espacios, comillas o caracteres no alfanuméricos
      const sanitized = finalCode.trim().replace(/[^a-zA-Z0-9-]/g, '');
      setDetectedCode(sanitized);
      setProcessingStatus(`✓ Código identificado: ${sanitized}`);
      sound.playScan();

      // REQUISITO: Detener la cámara inmediatamente para liberar la memoria RAM antes del teclado
      cleanupCamera();

      setTimeout(() => {
        onBarcodeDetected(sanitized);
        onClose();
      }, 350);
    } else {
      sound.playError();
      setErrorMsg(
        'No se detectó un código de barras claro ni dígitos legibles. Puedes reintentar enfocando más cerca o ingresar el código manualmente.'
      );
    }

    setIsProcessing(false);
  };

  // Reanudar la vista en vivo para tomar otra foto
  const handleRetake = () => {
    setCapturedImage(null);
    setDetectedCode(null);
    setErrorMsg(null);
    setIsProcessing(false);
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  // Procesar archivo de imagen cargado desde la galería
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();

    reader.onload = (event) => {
      const src = event.target?.result as string;
      setCapturedImage(src);
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = img.naturalWidth || 1280;
        canvas.height = img.naturalHeight || 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          setIsProcessing(true);
          analyzeStaticImage(canvas);
        }
      };
      img.src = src;
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Confirmar código escrito manualmente
  const handleConfirmManualCode = () => {
    const clean = manualCodeInput.trim();
    if (!clean) return;
    cleanupCamera();
    sound.playScan();
    onBarcodeDetected(clean);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-4 animate-in fade-in">
      <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
        {/* Cabecera */}
        <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-950/90">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-400" />
            <div>
              <span className="text-xs font-bold text-white block">Captura de Código Barcode</span>
              <span className="text-[10px] text-slate-400 block">Foto Fija + OCR / Decodificador</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!capturedImage && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`p-1.5 rounded-xl border transition cursor-pointer ${
                  isTorchOn
                    ? 'bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/30'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                }`}
                title="Linterna / Flash"
              >
                <Flashlight className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 transition cursor-pointer"
              title="Cerrar cámara"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Visor de Cámara o Foto Fija */}
        <div className="relative w-full aspect-4/3 bg-black flex items-center justify-center overflow-hidden">
          {/* Video en vivo si no se ha capturado foto */}
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover ${capturedImage ? 'hidden' : 'block'}`}
          />

          {/* Imagen fija capturada */}
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Foto capturada"
              className="w-full h-full object-contain bg-slate-950"
            />
          )}

          {/* Canvas oculto para procesamiento de imagen y OCR */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Marco de enfoque y alineación para la toma de foto */}
          {!capturedImage && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
              <div className="relative w-64 h-36 border-2 border-indigo-400/80 rounded-2xl shadow-[0_0_25px_rgba(99,102,241,0.25)] flex items-center justify-center">
                {/* Esquinas resaltadas */}
                <div className="absolute -top-1 -left-1 w-5 h-5 border-t-3 border-l-3 border-indigo-300 rounded-tl-lg"></div>
                <div className="absolute -top-1 -right-1 w-5 h-5 border-t-3 border-r-3 border-indigo-300 rounded-tr-lg"></div>
                <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-3 border-l-3 border-indigo-300 rounded-bl-lg"></div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-3 border-r-3 border-indigo-300 rounded-br-lg"></div>

                {/* Línea guía de encuadre */}
                <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_12px_#f43f5e] opacity-80"></div>
              </div>
            </div>
          )}

          {/* Indicador de Procesamiento de Imagen */}
          {isProcessing && (
            <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center space-y-3 animate-in fade-in">
              <RefreshCw className="w-9 h-9 text-indigo-400 animate-spin" />
              <p className="text-xs font-semibold text-slate-200">{processingStatus}</p>
            </div>
          )}

          {/* Notificación de Detección Exitosa */}
          {detectedCode && !isProcessing && (
            <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center space-y-2 animate-in fade-in">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-bounce" />
              <span className="text-xs font-bold text-emerald-300">¡Código Detectado!</span>
              <span className="font-mono text-sm font-black text-white px-3 py-1 bg-emerald-900/80 border border-emerald-500/50 rounded-xl">
                {detectedCode}
              </span>
            </div>
          )}
        </div>

        {/* Mensaje de Error si la foto no pudo ser procesada */}
        {errorMsg && !isProcessing && (
          <div className="p-3 bg-rose-950/90 border-t border-rose-800/80 text-rose-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="leading-snug">{errorMsg}</p>
          </div>
        )}

        {/* Panel de Botón de Disparo y Acciones */}
        <div className="p-3.5 bg-slate-950 border-t border-slate-800 space-y-3">
          {!capturedImage ? (
            <div className="flex items-center gap-2">
              {/* Botón Principal: TOMAR FOTO */}
              <button
                type="button"
                onClick={handleCapturePhoto}
                disabled={isProcessing}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-sm shadow-xl shadow-indigo-950 transition cursor-pointer"
              >
                <Camera className="w-5 h-5" />
                <span>Tomar Foto y Escanear</span>
              </button>

              {/* Botón secundario para cargar foto de archivo */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                title="Subir imagen de la galería"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRetake}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer"
                >
                  Volver a Tomar Foto
                </button>
              </div>

              {/* Entrada Manual de Respaldo */}
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="text"
                  value={manualCodeInput}
                  onChange={(e) => setManualCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmManualCode()}
                  placeholder="O escribe el código aquí..."
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleConfirmManualCode}
                  disabled={!manualCodeInput.trim()}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1"
                >
                  <span>OK</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Formatos Soportados */}
          <div className="flex items-center justify-center gap-1 text-[10px] font-mono text-slate-500 pt-0.5">
            <Scan className="w-3 h-3 text-indigo-400" />
            <span>EAN-13 • EAN-8 • UPC-A/E • Code 128 • OCR</span>
          </div>
        </div>
      </div>
    </div>
  );
};
