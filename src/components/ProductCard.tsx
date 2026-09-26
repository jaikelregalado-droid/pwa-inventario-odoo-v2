import React, { useState, useEffect, useRef } from 'react';
import { Camera, Check, AlertCircle, Plus, Minus, ArrowUpRight, ArrowDownRight, Clock, User, Eye, Trash2 } from 'lucide-react';
import { QuantItem } from '../types';
import { sound } from '../lib/audio';

interface ProductCardProps {
  item: QuantItem;
  onUpdateCount: (quantId: number, newCount: number, photoUrl?: string) => void;
  isFocused?: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  item,
  onUpdateCount,
  isFocused = false,
}) => {
  // Estado local para input inmediato y fluido
  const [localQC, setLocalQC] = useState<string>(String(item.countedQuantity));
  const [showPhotoModal, setShowPhotoModal] = useState<boolean>(false);
  const [isSavedRecently, setIsSavedRecently] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Mantener sincronizado si llega una actualización Realtime desde otro auditor
  useEffect(() => {
    setLocalQC(String(item.countedQuantity));
  }, [item.countedQuantity]);

  // Si se enfoca por escáner de código de barras
  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isFocused]);

  const commitCount = (val: number, photo?: string) => {
    const validNumber = Math.max(0, isNaN(val) ? 0 : Math.round(val * 100) / 100);
    setLocalQC(String(validNumber));
    onUpdateCount(item.id, validNumber, photo !== undefined ? photo : item.photoUrl);

    setIsSavedRecently(true);
    setTimeout(() => setIsSavedRecently(false), 1200);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQC(e.target.value);
  };

  const handleInputBlur = () => {
    const parsed = parseFloat(localQC);
    if (!isNaN(parsed) && parsed !== item.countedQuantity) {
      sound.playCountUp();
      commitCount(parsed);
    } else if (isNaN(parsed)) {
      setLocalQC(String(item.countedQuantity));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const increment = (delta: number) => {
    const current = parseFloat(localQC) || 0;
    const nextVal = Math.max(0, current + delta);
    if (delta > 0) {
      sound.playCountUp();
    } else {
      sound.playCountDown();
    }
    commitCount(nextVal);
  };

  // Captura de fotografía de evidencia con cámara nativa
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        sound.playScan();
        commitCount(item.countedQuantity, base64);
      }
    };
    reader.readAsDataURL(file);
    // Limpiar input
    e.target.value = '';
  };

  const removePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    commitCount(item.countedQuantity, '');
  };

  // Cálculo de Diferencia
  const currentCounted = parseFloat(localQC) || 0;
  const difference = currentCounted - item.quantity;
  const isExact = difference === 0;
  const isSurplus = difference > 0;
  const isDeficit = difference < 0;

  return (
    <div
      ref={cardRef}
      className={`relative rounded-2xl bg-slate-900/90 border transition-all duration-200 overflow-hidden shadow-lg ${
        isFocused
          ? 'border-emerald-500 ring-4 ring-emerald-500/40 shadow-2xl shadow-emerald-950/80 scale-[1.02] bg-slate-900/95'
          : 'border-slate-800 hover:border-slate-700/80 shadow-slate-950/50'
      }`}
    >
      {/* Indicador superior de estado de sincronización */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-1 border-b border-slate-800/60 text-[11px]">
        <div className="flex items-center gap-1.5 font-mono text-slate-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
          <span className="font-semibold text-slate-300">ID #{item.id}</span>
          {item.locationName && (
            <span className="truncate max-w-[130px] text-slate-500" title={item.locationName}>
              • {item.locationName.split('/').pop()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {item.lastAuditedBy && (
            <span className="flex items-center gap-1 text-slate-400">
              <User className="w-3 h-3 text-slate-500" />
              <span className="truncate max-w-[90px]">{item.lastAuditedBy}</span>
            </span>
          )}
          {isSavedRecently && (
            <span className="flex items-center gap-1 text-emerald-400 animate-pulse font-medium">
              <Check className="w-3 h-3" />
              Guardado
            </span>
          )}
        </div>
      </div>

      <div className="p-3.5 space-y-3">
        {/* Cabecera del Producto: Nombre y Códigos */}
        <div>
          <h3 className="text-sm font-bold text-slate-100 leading-snug line-clamp-2">
            {item.productName}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {item.defaultCode && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 font-mono text-indigo-300 text-[11px] font-semibold">
                Ref: {item.defaultCode}
              </span>
            )}
            {item.barcode && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/80 font-mono text-slate-300 text-[11px]">
                EAN: {item.barcode}
              </span>
            )}
            {item.categName && (
              <span className="text-[11px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800/40">
                {item.categName}
              </span>
            )}
          </div>
        </div>

        {/* Métricas Principales: QS (Sistema), QC (Contado) y DQ (Diferencia) */}
        <div className="grid grid-cols-3 gap-2 p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
          {/* QS: Sistema */}
          <div className="flex flex-col items-center justify-center p-1.5 rounded-lg bg-slate-900/60">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              QS (Sistema)
            </span>
            <span className="text-base font-extrabold text-slate-200 mt-0.5">
              {item.quantity}
            </span>
          </div>

          {/* QC: Contado Físico */}
          <div className="flex flex-col items-center justify-center p-1.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20">
            <span className="text-[10px] font-medium uppercase tracking-wider text-indigo-300">
              QC (Físico)
            </span>
            <span className="text-base font-extrabold text-white mt-0.5">
              {currentCounted}
            </span>
          </div>

          {/* DQ: Diferencia Codificada por Color */}
          <div
            className={`flex flex-col items-center justify-center p-1.5 rounded-lg border ${
              isExact
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400'
                : isSurplus
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                : 'bg-rose-950/40 border-rose-500/50 text-rose-400'
            }`}
          >
            <div className="flex items-center gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wider">
                DQ (Dif.)
              </span>
              {isSurplus && <ArrowUpRight className="w-3 h-3 text-emerald-400" />}
              {isDeficit && <ArrowDownRight className="w-3 h-3 text-rose-400" />}
            </div>
            <span className="text-base font-extrabold mt-0.5">
              {isSurplus ? `+${difference}` : difference}
            </span>
          </div>
        </div>

        {/* Zona de Edición Rápida de QC: Input numérico directo + Botones táctiles -1 / +1 */}
        <div className="pt-1">
          <div className="text-[11px] font-medium text-slate-400 mb-1 flex items-center justify-between">
            <span>Ajuste de Conteo Físico:</span>
            <span className="text-[10px] text-slate-500">Auto-guarda al salir o Enter</span>
          </div>

          <div className="flex items-stretch gap-2">
            {/* Botón táctil -1 */}
            <button
              type="button"
              onClick={() => increment(-1)}
              className="flex-1 flex items-center justify-center min-h-[46px] rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 font-bold transition cursor-pointer select-none"
              aria-label="Restar 1 unidad"
            >
              <Minus className="w-5 h-5 text-rose-400" />
            </button>

            {/* Input Editable Directo para números grandes de un solo golpe (ej: 60) */}
            <div className="relative w-28">
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min="0"
                step="any"
                value={localQC}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                className="w-full h-[46px] rounded-xl bg-slate-950 border-2 border-indigo-500/60 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30 text-center font-mono text-xl font-bold text-white transition outline-none"
                placeholder="0"
                title="Escribe la cantidad contada directamente"
              />
            </div>

            {/* Botón táctil +1 */}
            <button
              type="button"
              onClick={() => increment(1)}
              className="flex-1 flex items-center justify-center min-h-[46px] rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold transition cursor-pointer select-none shadow-md shadow-indigo-950"
              aria-label="Sumar 1 unidad"
            >
              <Plus className="w-5 h-5" />
            </button>

            {/* Accesos rápidos +5 o +10 en botones pequeños */}
            <button
              type="button"
              onClick={() => increment(5)}
              className="px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-indigo-300 font-mono text-xs font-bold transition cursor-pointer"
              title="Sumar 5 unidades"
            >
              +5
            </button>
          </div>
        </div>

        {/* Barra inferior: Evidencia Fotográfica y Detalles */}
        <div className="pt-1 flex items-center justify-between border-t border-slate-800/60 text-xs">
          {/* Captura de foto nativa */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
              id={`photo-input-${item.id}`}
            />

            <label
              htmlFor={`photo-input-${item.id}`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer text-xs"
              title="Capturar foto de evidencia con la cámara"
            >
              <Camera className="w-3.5 h-3.5 text-indigo-400" />
              <span>{item.photoUrl ? 'Cambiar Foto' : 'Foto Evidencia'}</span>
            </label>

            {item.photoUrl && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowPhotoModal(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-950/60 border border-indigo-800/50 text-indigo-300 hover:text-white text-[11px] cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  <span>Ver Foto</span>
                </button>
                <button
                  type="button"
                  onClick={removePhoto}
                  className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                  title="Eliminar foto"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Fecha / Hora */}
          {item.lastAuditedAt && (
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock className="w-3 h-3" />
              <span>{new Date(item.lastAuditedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </div>
      </div>

      {/* Modal para visualizar la foto capturada en alta resolución */}
      {showPhotoModal && item.photoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in"
          onClick={() => setShowPhotoModal(false)}
        >
          <div
            className="relative max-w-sm w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-left">
              <div>
                <h4 className="text-sm font-bold text-white line-clamp-1">{item.productName}</h4>
                <p className="text-xs text-slate-400">Evidencia de Auditoría Quant #{item.id}</p>
              </div>
              <button
                onClick={() => setShowPhotoModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="my-3 max-h-[60vh] overflow-hidden rounded-xl bg-black flex items-center justify-center">
              <img
                src={item.photoUrl}
                alt={`Evidencia ${item.productName}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="text-xs text-slate-400">
              {item.lastAuditedBy ? `Auditor: ${item.lastAuditedBy}` : 'Auditoría local'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
