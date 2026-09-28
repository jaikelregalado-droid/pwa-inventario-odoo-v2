import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Check,
  AlertCircle,
  Plus,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  User,
  Eye,
  Trash2,
  Lock,
  Unlock,
  Calculator,
  Edit3,
  X,
  Layers,
  ArrowRight
} from 'lucide-react';
import { QuantItem } from '../types';
import { sound } from '../lib/audio';

interface ProductCardProps {
  item: QuantItem;
  onUpdateCount: (quantId: number, newCount: number, photoUrl?: string) => void;
  onToggleLock?: (quantId: number) => void;
  isFocused?: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  item,
  onUpdateCount,
  onToggleLock,
  isFocused = false,
}) => {
  // Estado local para input inmediato y fluido
  const [localQC, setLocalQC] = useState<string>(String(item.countedQuantity));
  const [showPhotoModal, setShowPhotoModal] = useState<boolean>(false);
  const [isSavedRecently, setIsSavedRecently] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Estado para cuadro de diálogo/modal numérico rápido para ingreso por lote
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [batchInputValue, setBatchInputValue] = useState<string>('');
  const [batchMode, setBatchMode] = useState<'add' | 'replace'>('add'); // 'add' = Sumar al acumulado, 'replace' = Corregir/reemplazar total
  const batchInputRef = useRef<HTMLInputElement>(null);

  const openBatchModal = (mode: 'add' | 'replace' = 'add') => {
    setBatchMode(mode);
    setBatchInputValue('');
    setShowBatchModal(true);
    setTimeout(() => {
      batchInputRef.current?.focus();
      batchInputRef.current?.select();
    }, 100);
  };

  const handleConfirmBatch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const inputNum = parseFloat(batchInputValue);
    if (isNaN(inputNum)) {
      setShowBatchModal(false);
      return;
    }

    const currentCount = parseFloat(localQC) || 0;
    // Fórmula: Si modo Suma -> QC_actual + Valor_ingresado (ej: 15 + 20 = 35)
    // Fórmula: Si modo Reemplazar -> Valor_ingresado (ej: 20 sustituye a 15)
    const nextQC = batchMode === 'add'
      ? Math.max(0, Math.round((currentCount + inputNum) * 100) / 100)
      : Math.max(0, Math.round(inputNum * 100) / 100);

    sound.playCountUp();
    commitCount(nextQC);
    setShowBatchModal(false);
  };

  const applyPreset = (preset: number) => {
    const currentEntered = parseFloat(batchInputValue) || 0;
    setBatchInputValue(String(currentEntered + preset));
    batchInputRef.current?.focus();
  };

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
          {item.isLocked && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-500/50 shadow-xs">
              <Lock className="w-2.5 h-2.5 text-amber-400" />
              <span>Inmovilizado</span>
            </span>
          )}
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
          {/* QS: Sistema (inmovilizado si is_locked está activo) */}
          <div
            className={`flex flex-col items-center justify-center p-1.5 rounded-lg border transition-colors ${
              item.isLocked
                ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
                : 'bg-slate-900/60 border-transparent text-slate-400'
            }`}
            title={
              item.isLocked
                ? 'Cantidad de Sistema inmovilizada / congelada'
                : 'Cantidad de Sistema obtenida de Odoo 17'
            }
          >
            <div className="flex items-center gap-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${
                item.isLocked ? 'text-amber-300 font-bold' : 'text-slate-400'
              }`}>
                QS (Sistema)
              </span>
              {item.isLocked && <Lock className="w-2.5 h-2.5 text-amber-400" />}
            </div>
            <span className={`text-base font-extrabold mt-0.5 ${
              item.isLocked ? 'text-amber-200 font-mono' : 'text-slate-200'
            }`}>
              {item.quantity}
            </span>
          </div>

          {/* QC: Contado Físico (Haz clic para ingreso rápido por lote o corrección) */}
          <button
            type="button"
            onClick={() => openBatchModal('add')}
            className="flex flex-col items-center justify-center p-1.5 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/60 active:scale-95 border border-indigo-500/30 hover:border-indigo-400 transition cursor-pointer select-none group text-left"
            title="Toca para ingresar cantidad por lote o corregir total"
          >
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-indigo-300">
                QC (Físico)
              </span>
              <Plus className="w-2.5 h-2.5 text-indigo-400 opacity-70 group-hover:opacity-100" />
            </div>
            <span className="text-base font-extrabold text-white mt-0.5 group-hover:text-indigo-200">
              {currentCounted}
            </span>
          </button>

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

        {/* Zona de Edición Rápida de QC: Input numérico directo + Botón '+' para ingreso por lote */}
        <div className="pt-1">
          <div className="text-[11px] font-medium text-slate-400 mb-1 flex items-center justify-between">
            <span>Ajuste de Conteo Físico:</span>
            <span className="text-[10px] text-slate-500">Toca '+' para suma por lote</span>
          </div>

          <div className="flex items-stretch gap-2">
            {/* Botón táctil -1 */}
            <button
              type="button"
              onClick={() => increment(-1)}
              className="px-3.5 flex items-center justify-center min-h-[46px] rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 font-bold transition cursor-pointer select-none"
              aria-label="Restar 1 unidad"
              title="Restar 1 unidad"
            >
              <Minus className="w-5 h-5 text-rose-400" />
            </button>

            {/* Input Editable Directo para números rápidos */}
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

            {/* Botón '+' principal: Abre el cuadro de diálogo/modal numérico rápido para ingreso por lote */}
            <button
              type="button"
              onClick={() => openBatchModal('add')}
              className="flex-1 flex items-center justify-center gap-1.5 min-h-[46px] px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold transition cursor-pointer select-none shadow-md shadow-indigo-950"
              aria-label="Ingreso rápido por lote"
              title="Abre el cuadro de diálogo para sumar por lote o corregir"
            >
              <Plus className="w-5 h-5" />
              <span className="text-xs sm:text-sm">Lote</span>
            </button>

            {/* Acceso rápido +1 unitario directo */}
            <button
              type="button"
              onClick={() => increment(1)}
              className="px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-indigo-300 font-mono text-xs font-bold transition cursor-pointer"
              title="Sumar 1 unidad directa (+1)"
            >
              +1
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

            {/* Candado de Inmovilización / Bloqueo por Producto */}
            {onToggleLock && (
              <button
                type="button"
                onClick={() => onToggleLock(item.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition active:scale-95 cursor-pointer select-none ${
                  item.isLocked
                    ? 'bg-amber-950/70 border-amber-500/70 text-amber-300 hover:bg-amber-900/80 shadow-xs shadow-amber-950/50'
                    : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
                title={
                  item.isLocked
                    ? 'Inmovilizado: QS protegido contra variaciones de ventas/entradas en Odoo durante la auditoría. Clic para desbloquear.'
                    : 'Desbloqueado: Clic para inmovilizar la cantidad de sistema (QS).'
                }
              >
                {item.isLocked ? (
                  <>
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Inmovilizado</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Inmovilizar</span>
                  </>
                )}
              </button>
            )}

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

      {/* Modal/Cuadro de Diálogo Numérico Rápido para Ingreso por Lote y Corrección */}
      {showBatchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setShowBatchModal(false)}
        >
          <div
            className="relative max-w-md w-full bg-slate-900 border border-slate-700/80 rounded-3xl overflow-hidden shadow-2xl p-5 text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera del modal */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-800">
              <div className="space-y-1 pr-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-500/40 text-indigo-400 font-mono text-[11px] font-bold">
                    <Layers className="w-3 h-3" />
                    Quant #{item.id}
                  </span>
                  {item.defaultCode && (
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      Ref: {item.defaultCode}
                    </span>
                  )}
                  {item.barcode && (
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      EAN: {item.barcode}
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-white leading-snug line-clamp-2">
                  {item.productName}
                </h4>
              </div>

              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conmutador de Modo: Sumar al Acumulado vs Reemplazar / Corregir Total */}
            <div className="mt-4 p-1 rounded-2xl bg-slate-950 border border-slate-800 flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setBatchMode('add');
                  batchInputRef.current?.focus();
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition cursor-pointer select-none ${
                  batchMode === 'add'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Sumar al Acumulado</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBatchMode('replace');
                  batchInputRef.current?.focus();
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition cursor-pointer select-none ${
                  batchMode === 'replace'
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Reemplazar / Corregir Total</span>
              </button>
            </div>

            {/* Información del Estado Actual */}
            <div className="mt-3.5 flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">QS (Sistema)</span>
                <span className="font-extrabold text-slate-200 text-sm">{item.quantity} uds.</span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-medium">QC Actual (Contado)</span>
                <span className="font-black text-indigo-300 text-base">{parseFloat(localQC) || 0} uds.</span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Operación</span>
                <span className={`font-bold text-xs ${batchMode === 'add' ? 'text-indigo-400' : 'text-amber-400'}`}>
                  {batchMode === 'add' ? 'Suma (+ Lote)' : 'Sustitución'}
                </span>
              </div>
            </div>

            {/* Formulario de Entrada */}
            <form onSubmit={handleConfirmBatch} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor={`batch-input-${item.id}`} className="font-medium text-slate-300">
                    {batchMode === 'add'
                      ? 'Cantidad del lote a sumar (+):'
                      : 'Nueva cantidad total sustituta:'}
                  </label>
                  {batchInputValue && (
                    <button
                      type="button"
                      onClick={() => setBatchInputValue('')}
                      className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
                    >
                      Limpiar
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    ref={batchInputRef}
                    id={`batch-input-${item.id}`}
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min="0"
                    step="any"
                    autoFocus
                    value={batchInputValue}
                    onChange={(e) => setBatchInputValue(e.target.value)}
                    placeholder="0"
                    className={`w-full py-3.5 px-4 rounded-2xl bg-slate-950 border-2 text-center font-mono text-3xl font-black text-white outline-none transition ${
                      batchMode === 'add'
                        ? 'border-indigo-500/70 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/20'
                        : 'border-amber-500/70 focus:border-amber-400 focus:ring-4 focus:ring-amber-500/20'
                    }`}
                  />
                </div>
              </div>

              {/* Botones de Presets Rápidos (+1, +5, +10, +20, +50, +100) */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  {batchMode === 'add' ? 'Atajos para sumar al lote:' : 'Atajos numéricos:'}
                </span>
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 5, 10, 20, 50, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 font-mono text-xs font-bold text-slate-200 hover:text-white transition cursor-pointer select-none"
                    >
                      +{preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tarjeta de Cálculo y Fórmula en Tiempo Real */}
              <div className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                batchMode === 'add'
                  ? 'bg-indigo-950/30 border-indigo-500/30 text-indigo-200'
                  : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
              }`}>
                <div className="flex items-center justify-between font-medium">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Calculator className="w-3.5 h-3.5" />
                    <span>Fórmula en tiempo real:</span>
                  </span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    {batchMode === 'add' ? 'Nuevo QC = QC_actual + Lote' : 'Nuevo QC = Valor ingresado'}
                  </span>
                </div>

                <div className="text-sm font-mono font-bold text-white flex items-center justify-between pt-1 border-t border-slate-800/80">
                  {batchMode === 'add' ? (
                    <>
                      <span>{parseFloat(localQC) || 0} + {parseFloat(batchInputValue) || 0}</span>
                      <ArrowRight className="w-4 h-4 text-indigo-400" />
                      <span className="text-lg font-black text-indigo-300">
                        {Math.max(0, Math.round(((parseFloat(localQC) || 0) + (parseFloat(batchInputValue) || 0)) * 100) / 100)} uds.
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="line-through text-slate-500">{parseFloat(localQC) || 0}</span>
                      <ArrowRight className="w-4 h-4 text-amber-400" />
                      <span className="text-lg font-black text-amber-300">
                        {Math.max(0, Math.round((parseFloat(batchInputValue) || 0) * 100) / 100)} uds.
                      </span>
                    </>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                  <span>Diferencia vs Sistema ({item.quantity}):</span>
                  {(() => {
                    const finalQC = batchMode === 'add'
                      ? Math.max(0, Math.round(((parseFloat(localQC) || 0) + (parseFloat(batchInputValue) || 0)) * 100) / 100)
                      : Math.max(0, Math.round((parseFloat(batchInputValue) || 0) * 100) / 100);
                    const finalDiff = Math.round((finalQC - item.quantity) * 100) / 100;
                    return (
                      <span className={`font-mono font-bold ${
                        finalDiff === 0
                          ? 'text-emerald-400'
                          : finalDiff > 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}>
                        {finalDiff > 0 ? `+${finalDiff}` : finalDiff} uds.
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={!batchInputValue.trim() && batchInputValue !== '0'}
                  className={`flex-2 py-3 px-4 rounded-xl text-white font-black text-xs sm:text-sm shadow-xl transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                    batchMode === 'add'
                      ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-950'
                      : 'bg-amber-600 hover:bg-amber-500 shadow-amber-950'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {batchMode === 'add'
                      ? `Confirmar y Sumar (+${parseFloat(batchInputValue) || 0})`
                      : `Confirmar Total (${parseFloat(batchInputValue) || 0})`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
