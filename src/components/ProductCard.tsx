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
  ArrowRight,
  History
} from 'lucide-react';
import { QuantItem } from '../types';
import { sound } from '../lib/audio';

interface ProductCardProps {
  item: QuantItem;
  onUpdateCount: (quantId: number, newCount: number, photoUrl?: string, newHistory?: number[]) => void;
  onToggleLock?: (quantId: number) => void;
  isFocused?: boolean;
  autoOpenBatch?: boolean;
  onBatchModalOpened?: () => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  item,
  onUpdateCount,
  onToggleLock,
  isFocused = false,
  autoOpenBatch = false,
  onBatchModalOpened,
}) => {
  // Estado local para input inmediato y fluido
  const [localQC, setLocalQC] = useState<string>(String(item.countedQuantity));
  const [showPhotoModal, setShowPhotoModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [isSavedRecently, setIsSavedRecently] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Estado para cuadro de diálogo/modal numérico rápido para ingreso por lote
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [batchInputValue, setBatchInputValue] = useState<string>('');
  const [batchMode, setBatchMode] = useState<'add' | 'replace'>('add'); // 'add' = Sumar al acumulado, 'replace' = Corregir/reemplazar total
  const batchInputRef = useRef<HTMLInputElement>(null);

  // Función de formateo en tiempo real: reemplaza automáticamente comas por puntos y admite hasta 3 decimales
  const sanitizeDecimalInput = (raw: string): string => {
    if (!raw) return '';
    // 1. Reemplazar todas las comas por puntos
    let sanitized = raw.replace(/,/g, '.');
    // 2. Permitir solo dígitos numéricos y punto
    sanitized = sanitized.replace(/[^0-9.]/g, '');
    // 3. Si hay más de un punto, conservar únicamente el primero
    const parts = sanitized.split('.');
    if (parts.length > 2) {
      sanitized = parts[0] + '.' + parts.slice(1).join('');
    }
    // 4. Limitar a máximo 3 decimales (peso / fracciones)
    if (parts.length === 2 && parts[1].length > 3) {
      sanitized = parts[0] + '.' + parts[1].slice(0, 3);
    }
    return sanitized;
  };

  // Convierte un string a float seguro con redondeo de hasta 3 decimales
  const parseSafeFloat = (val: string | number | undefined | null): number => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val * 1000) / 1000;
    const sanitized = sanitizeDecimalInput(String(val));
    const parsed = parseFloat(sanitized);
    return isNaN(parsed) ? 0 : Math.round(parsed * 1000) / 1000;
  };

  const openBatchModal = (mode: 'add' | 'replace' = 'add') => {
    setBatchMode(mode);
    setBatchInputValue('');
    setShowBatchModal(true);
    // REQUISITO: Scroll al inicio con scroll-margin-top 120px para mantener la tarjeta visible arriba
    if (cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // REQUISITO: Diferimiento asíncrono controlado con 150ms para no colapsar el hilo de renderizado
    setTimeout(() => {
      batchInputRef.current?.focus();
      batchInputRef.current?.select();
    }, 150);
  };

  // Apertura automática del modal de lote tras escaneo sin auto-incremento +1
  useEffect(() => {
    if (autoOpenBatch) {
      openBatchModal('add');
      onBatchModalOpened?.();
    }
  }, [autoOpenBatch]);

  const handleConfirmBatch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sanitized = sanitizeDecimalInput(batchInputValue);
    const inputNum = parseFloat(sanitized);
    if (isNaN(inputNum)) {
      setShowBatchModal(false);
      return;
    }

    const currentCount = parseSafeFloat(localQC);
    let nextQC: number;
    let nextHistory: number[];

    if (batchMode === 'add') {
      nextQC = Math.max(0, Math.round((currentCount + inputNum) * 1000) / 1000);
      nextHistory = [...(item.countHistory || []), inputNum];
    } else {
      nextQC = Math.max(0, Math.round(inputNum * 1000) / 1000);
      nextHistory = [inputNum];
    }

    sound.playCountUp();
    commitCount(nextQC, undefined, nextHistory);
    setShowBatchModal(false);
  };

  const applyPreset = (preset: number) => {
    const currentEntered = parseSafeFloat(batchInputValue);
    const nextVal = Math.round((currentEntered + preset) * 1000) / 1000;
    setBatchInputValue(String(nextVal));
    batchInputRef.current?.focus();
  };

  // Mantener sincronizado si llega una actualización Realtime desde otro auditor
  useEffect(() => {
    setLocalQC(String(item.countedQuantity));
  }, [item.countedQuantity]);

  // Si se enfoca por escáner de código de barras
  useEffect(() => {
    if (isFocused && cardRef.current) {
      // REQUISITO: Utiliza 'block: start' con un margen de desplazamiento superior (scroll-margin-top: 120px)
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isFocused]);

  // Estados para edición y eliminación individual en el historial de conteos parciales
  const [editingHistoryIdx, setEditingHistoryIdx] = useState<number | null>(null);
  const [editingHistoryVal, setEditingHistoryVal] = useState<string>('');

  const handleDeleteHistoryEntry = (idxToDelete: number) => {
    const prevHistory = item.countHistory || [];
    const nextHistory = prevHistory.filter((_, idx) => idx !== idxToDelete);
    // Recalcular automáticamente el total de QC sumando todos los valores actualizados
    const nextQC = Math.max(0, Math.round(nextHistory.reduce((sum, n) => sum + n, 0) * 1000) / 1000);
    sound.playCountDown();
    commitCount(nextQC, undefined, nextHistory);
    if (editingHistoryIdx === idxToDelete) {
      setEditingHistoryIdx(null);
    }
  };

  const handleStartEditHistoryEntry = (idx: number, currentVal: number) => {
    setEditingHistoryIdx(idx);
    setEditingHistoryVal(String(currentVal));
  };

  const handleSaveEditHistoryEntry = (idx: number) => {
    const sanitized = sanitizeDecimalInput(editingHistoryVal);
    const parsed = parseFloat(sanitized);
    if (isNaN(parsed)) return;

    const validVal = Math.round(parsed * 1000) / 1000;
    const prevHistory = item.countHistory || [];
    const nextHistory = prevHistory.map((val, i) => (i === idx ? validVal : val));
    // Recalcular automáticamente el total de QC sumando todos los valores actualizados
    const nextQC = Math.max(0, Math.round(nextHistory.reduce((sum, n) => sum + n, 0) * 1000) / 1000);
    sound.playScan();
    commitCount(nextQC, undefined, nextHistory);
    setEditingHistoryIdx(null);
  };

  const commitCount = (val: number, photo?: string, newHistory?: number[]) => {
    // Admite hasta 3 decimales para productos por peso o fracción
    const validNumber = Math.max(0, isNaN(val) ? 0 : Math.round(val * 1000) / 1000);
    setLocalQC(String(validNumber));
    const finalHistory = newHistory !== undefined ? newHistory : (item.countHistory || []);
    onUpdateCount(item.id, validNumber, photo !== undefined ? photo : item.photoUrl, finalHistory);

    setIsSavedRecently(true);
    setTimeout(() => setIsSavedRecently(false), 1200);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = sanitizeDecimalInput(e.target.value);
    setLocalQC(formatted);
  };

  const handleInputBlur = () => {
    const sanitized = sanitizeDecimalInput(localQC);
    const parsed = parseFloat(sanitized);
    if (!isNaN(parsed) && parsed !== item.countedQuantity) {
      sound.playCountUp();
      const current = item.countedQuantity || 0;
      const delta = Math.round((parsed - current) * 1000) / 1000;
      const nextHistory = (item.countHistory && item.countHistory.length > 0)
        ? [...item.countHistory, delta]
        : [parsed];
      commitCount(parsed, undefined, nextHistory);
    } else if (isNaN(parsed)) {
      setLocalQC(String(item.countedQuantity));
    } else {
      setLocalQC(String(Math.round(parsed * 1000) / 1000));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  const increment = (delta: number) => {
    const current = parseSafeFloat(localQC);
    const nextVal = Math.max(0, Math.round((current + delta) * 1000) / 1000);
    const nextHistory = [...(item.countHistory || []), delta];
    if (delta > 0) {
      sound.playCountUp();
    } else {
      sound.playCountDown();
    }
    commitCount(nextVal, undefined, nextHistory);
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

  // Cálculo de Diferencia (soporta hasta 3 decimales para productos por peso o fracción)
  const currentCounted = parseSafeFloat(localQC);
  const difference = Math.round((currentCounted - item.quantity) * 1000) / 1000;
  const isExact = difference === 0;
  const isSurplus = difference > 0;
  const isDeficit = difference < 0;

  // Estados y Contraste de Auditoría:
  // 1. Sin Auditar: Sin marca de tiempo de auditoría previa y conteo en 0
  const isUnaudited = !item.lastAuditedAt && (item.countedQuantity === 0 || item.countedQuantity === undefined) && (!item.countHistory || item.countHistory.length === 0);
  // 2. Conteo Correcto / Físico Registrado: Ha sido auditado y la diferencia es 0
  const isCountCorrect = !isUnaudited && isExact;
  // 3. Con Diferencia (Dif. DQ): Registrado y con diferencia diferente de 0
  const hasDiscrepancy = !isUnaudited && !isExact;

  const stateBorderClass = isFocused
    ? 'border-[#7C3AED] ring-4 ring-[#7C3AED]/20 shadow-xl scale-[1.01]'
    : hasDiscrepancy
    ? 'border-[#E2E8F0] border-t-4 border-t-[#EF4444] shadow-[0_1px_3px_rgba(0,0,0,0.05)]'
    : isCountCorrect
    ? 'border-[#E2E8F0] border-t-4 border-t-[#10B981] shadow-[0_1px_3px_rgba(0,0,0,0.05)]'
    : 'border-[#E2E8F0] border-t-4 border-t-[#CBD5E1] shadow-[0_1px_3px_rgba(0,0,0,0.05)]';

  return (
    <div
      ref={cardRef}
      style={{ scrollMarginTop: '120px' }}
      className={`relative rounded-2xl bg-white border transition-all duration-300 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)] scroll-mt-[120px] ${stateBorderClass}`}
    >
      {/* Indicador superior de estado de sincronización y estado visual */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-1.5 border-b border-[#E2E8F0] text-[11px] bg-white">
        <div className="flex items-center gap-1.5 font-mono text-[#64748B]">
          <span className={`inline-block w-2 h-2 rounded-full ${
            hasDiscrepancy
              ? 'bg-[#EF4444]'
              : isCountCorrect
              ? 'bg-[#10B981]'
              : 'bg-[#94A3B8]'
          }`}></span>
          <span className="font-semibold text-[#0F172A]">ID #{item.id}</span>
          {item.locationName && (
            <span className="truncate max-w-[130px] text-[#64748B]" title={item.locationName}>
              • {item.locationName.split('/').pop()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Badge de Estado Visual Claro */}
          {hasDiscrepancy && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-[#EF4444] border border-rose-200">
              Dif: {difference > 0 ? `+${difference}` : difference}
            </span>
          )}
          {isCountCorrect && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-[#10B981] border border-emerald-200 flex items-center gap-1">
              <Check className="w-3 h-3 stroke-[3]" />
              <span>Correcto</span>
            </span>
          )}
          {isUnaudited && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-[#64748B] border border-[#E2E8F0]">
              Sin Auditar
            </span>
          )}

          {/* Botón de Historial de Conteos Parciales */}
          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border transition cursor-pointer ${
              item.countHistory && item.countHistory.length > 0
                ? 'bg-purple-50 border-[#7C3AED]/30 text-[#7C3AED] hover:bg-purple-100'
                : 'bg-slate-50 border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
            }`}
            title="Ver desglose de conteos parciales"
          >
            <History className="w-3 h-3 text-[#7C3AED]" />
            <span>Historial{item.countHistory && item.countHistory.length > 0 ? ` (${item.countHistory.length})` : ''}</span>
          </button>

          {item.isLocked && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 shadow-xs">
              <Lock className="w-2.5 h-2.5 text-amber-600" />
              <span>Inmovilizado</span>
            </span>
          )}
          {item.lastAuditedBy && (
            <span className="flex items-center gap-1 text-[#64748B]">
              <User className="w-3 h-3 text-slate-400" />
              <span className="truncate max-w-[90px]">{item.lastAuditedBy}</span>
            </span>
          )}
          {isSavedRecently && (
            <span className="flex items-center gap-1 text-[#10B981] animate-pulse font-medium">
              <Check className="w-3 h-3" />
              Guardado
            </span>
          )}
        </div>
      </div>

      <div className="p-3.5 space-y-3 bg-white">
        {/* Cabecera del Producto: Nombre y Códigos */}
        <div>
          <h3 className="text-sm font-bold text-[#0F172A] leading-snug line-clamp-2">
            {item.productName}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {item.defaultCode && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 border border-purple-200 font-mono text-[#7C3AED] text-[11px] font-semibold">
                Ref: {item.defaultCode}
              </span>
            )}
            {item.barcode && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 border border-[#E2E8F0] font-mono text-[#64748B] text-[11px]">
                EAN: {item.barcode}
              </span>
            )}
            {item.categName && (
              <span className="text-[11px] text-[#64748B] px-1.5 py-0.5 rounded bg-slate-50 border border-[#E2E8F0]">
                {item.categName}
              </span>
            )}
          </div>

          {/* Desglose de Historial si existen aportes registrados */}
          {item.countHistory && item.countHistory.length > 0 && (
            <div
              onClick={() => setShowHistoryModal(true)}
              className="mt-2 flex items-center justify-between p-1.5 px-2.5 rounded-lg bg-purple-50/70 border border-[#7C3AED]/25 text-[11px] font-mono text-[#7C3AED] hover:bg-purple-100/70 transition cursor-pointer"
              title="Haz clic para ver el desglose completo de aportes"
            >
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className="text-[#64748B] font-sans font-medium text-[10px]">Historial:</span>
                <span className="truncate">{item.countHistory.map(n => n >= 0 ? `+${n}` : `${n}`).join(' ')}</span>
              </div>
              <span className="font-bold text-[#7C3AED] shrink-0 ml-2">= Total {currentCounted}</span>
            </div>
          )}
        </div>

        {/* Métricas Principales: QS (Sistema), QC (Contado) y DQ (Diferencia) */}
        <div className="grid grid-cols-3 gap-2 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          {/* QS: Sistema (inmovilizado si is_locked está activo) */}
          <div
            className={`flex flex-col items-center justify-center p-1.5 rounded-lg border transition-colors ${
              item.isLocked
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-white border-slate-200/60 text-[#64748B]'
            }`}
            title={
              item.isLocked
                ? 'Cantidad de Sistema inmovilizada / congelada'
                : 'Cantidad de Sistema obtenida de Odoo 17'
            }
          >
            <div className="flex items-center gap-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${
                item.isLocked ? 'text-amber-800 font-bold' : 'text-[#64748B]'
              }`}>
                QS (Sistema)
              </span>
              {item.isLocked && <Lock className="w-2.5 h-2.5 text-amber-600" />}
            </div>
            <span className={`text-base font-extrabold mt-0.5 ${
              item.isLocked ? 'text-amber-900 font-mono' : 'text-[#0F172A]'
            }`}>
              {item.quantity}
            </span>
          </div>

          {/* QC: Contado Físico (Haz clic para ingreso rápido por lote o corrección) */}
          <button
            type="button"
            onClick={() => openBatchModal('add')}
            className="flex flex-col items-center justify-center p-1.5 rounded-lg bg-purple-50 hover:bg-purple-100/80 active:scale-95 border border-[#7C3AED]/30 transition cursor-pointer select-none group text-left shadow-xs"
            title="Toca para ingresar cantidad por lote o corregir total"
          >
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#7C3AED]">
                QC (Físico)
              </span>
              <Plus className="w-2.5 h-2.5 text-[#7C3AED] opacity-70 group-hover:opacity-100" />
            </div>
            <span className="text-base font-extrabold text-[#0F172A] mt-0.5 group-hover:text-[#7C3AED]">
              {currentCounted}
            </span>
          </button>

          {/* DQ: Diferencia Codificada por Color */}
          <div
            className={`flex flex-col items-center justify-center p-1.5 rounded-lg border ${
              isCountCorrect
                ? 'bg-emerald-50 border-emerald-200 text-[#10B981]'
                : hasDiscrepancy
                ? 'bg-rose-50 border-rose-200 text-[#EF4444]'
                : 'bg-white border-[#E2E8F0] text-[#64748B]'
            }`}
          >
            <div className="flex items-center gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wider">
                DQ (Dif.)
              </span>
              {isSurplus && <ArrowUpRight className="w-3 h-3 text-[#10B981]" />}
              {isDeficit && <ArrowDownRight className="w-3 h-3 text-[#EF4444]" />}
            </div>
            <span className="text-base font-extrabold mt-0.5">
              {isSurplus ? `+${difference}` : difference}
            </span>
          </div>
        </div>

        {/* Zona de Edición Rápida de QC: Input numérico directo + Botón '+' para ingreso por lote */}
        <div className="pt-1">
          <div className="text-[11px] font-medium text-[#64748B] mb-1 flex items-center justify-between">
            <span>Ajuste de Conteo Físico:</span>
            <span className="text-[10px] text-slate-400">Toca '+' para suma por lote</span>
          </div>

          <div className="flex items-stretch gap-2">
            {/* Botón táctil -1 */}
            <button
              type="button"
              onClick={() => increment(-1)}
              className="px-3.5 flex items-center justify-center min-h-[46px] rounded-xl bg-white hover:bg-rose-50 active:scale-95 border border-[#E2E8F0] text-[#EF4444] font-bold transition cursor-pointer select-none shadow-xs"
              aria-label="Restar 1 unidad"
              title="Restar 1 unidad"
            >
              <Minus className="w-5 h-5 text-[#EF4444]" />
            </button>

            {/* Input Editable Directo para números enteros o decimales */}
            <form onSubmit={(e) => { e.preventDefault(); }} className="relative w-28">
              <input
                type="text"
                inputMode="decimal"
                value={localQC}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                className="w-full h-[46px] rounded-xl bg-white border-2 border-[#7C3AED] focus:border-[#6D28D9] focus:ring-2 focus:ring-[#7C3AED]/20 text-center font-mono text-xl font-bold text-[#0F172A] transition outline-none shadow-xs"
                placeholder="0"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                title="Escribe la cantidad contada con decimales (ej. 2.51)"
              />
            </form>

            {/* Botón '+' principal: Abre el cuadro de diálogo para lote */}
            <button
              type="button"
              onClick={() => openBatchModal('add')}
              className="flex-1 flex items-center justify-center gap-1.5 min-h-[46px] px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] active:scale-95 text-white font-bold transition cursor-pointer select-none shadow-sm shadow-[#7C3AED]/30"
              aria-label="Ingreso rápido por lote"
              title="Abre el cuadro de diálogo para sumar por lote o corregir"
            >
              <Plus className="w-5 h-5" />
              <span className="text-xs sm:text-sm font-bold">Lote</span>
            </button>

            {/* Acceso rápido +1 unitario directo */}
            <button
              type="button"
              onClick={() => increment(1)}
              className="px-2.5 rounded-xl bg-white hover:bg-purple-50 active:scale-95 border border-[#E2E8F0] text-[#7C3AED] font-mono text-xs font-bold transition cursor-pointer shadow-xs"
              title="Sumar 1 unidad directa (+1)"
            >
              +1
            </button>
          </div>
        </div>

        {/* Barra inferior: Evidencia Fotográfica y Detalles */}
        <div className="pt-1 flex items-center justify-between border-t border-[#E2E8F0] text-xs">
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 active:scale-95 border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] transition cursor-pointer text-xs shadow-xs"
              title="Capturar foto de evidencia con la cámara"
            >
              <Camera className="w-3.5 h-3.5 text-[#7C3AED]" />
              <span>{item.photoUrl ? 'Cambiar Foto' : 'Foto Evidencia'}</span>
            </label>

            {/* Candado de Inmovilización / Bloqueo por Producto */}
            {onToggleLock && (
              <button
                type="button"
                onClick={() => onToggleLock(item.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition active:scale-95 cursor-pointer select-none shadow-xs ${
                  item.isLocked
                    ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                    : 'bg-white hover:bg-slate-50 border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
                }`}
                title={
                  item.isLocked
                    ? 'Inmovilizado: QS protegido contra variaciones de ventas/entradas en Odoo durante la auditoría. Clic para desbloquear.'
                    : 'Desbloqueado: Clic para inmovilizar la cantidad de sistema (QS).'
                }
              >
                {item.isLocked ? (
                  <>
                    <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
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
                  className="flex items-center gap-1 px-2 py-1 rounded bg-purple-50 border border-purple-200 text-[#7C3AED] hover:text-[#6D28D9] text-[11px] cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  <span>Ver Foto</span>
                </button>
                <button
                  type="button"
                  onClick={removePhoto}
                  className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                  title="Eliminar foto"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Fecha / Hora */}
          {item.lastAuditedAt && (
            <div className="flex items-center gap-1 text-[10px] text-[#64748B]">
              <Clock className="w-3 h-3" />
              <span>{new Date(item.lastAuditedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </div>
      </div>

      {/* Modal para visualizar la foto capturada en alta resolución */}
      {showPhotoModal && item.photoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in"
          onClick={() => setShowPhotoModal(false)}
        >
          <div
            className="relative max-w-sm w-full bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-2xl p-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] text-left">
              <div>
                <h4 className="text-sm font-bold text-[#0F172A] line-clamp-1">{item.productName}</h4>
                <p className="text-xs text-[#64748B]">Evidencia de Auditoría Quant #{item.id}</p>
              </div>
              <button
                onClick={() => setShowPhotoModal(false)}
                className="p-1.5 rounded-lg bg-[#F8FAFC] hover:bg-slate-100 text-[#64748B] hover:text-[#0F172A] cursor-pointer border border-[#E2E8F0]"
              >
                ✕
              </button>
            </div>

            <div className="my-3 max-h-[60vh] overflow-hidden rounded-xl bg-slate-100 border border-[#E2E8F0] flex items-center justify-center">
              <img
                src={item.photoUrl}
                alt={`Evidencia ${item.productName}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="text-xs text-[#64748B]">
              {item.lastAuditedBy ? `Auditor: ${item.lastAuditedBy}` : 'Auditoría local'}
            </div>
          </div>
        </div>
      )}

      {/* Modal/Cuadro de Diálogo Numérico Rápido para Ingreso por Lote configurado como Bottom Sheet */}
      {showBatchModal && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in"
          onClick={() => setShowBatchModal(false)}
        >
          <div
            className="relative w-full max-w-2xl mx-auto bg-white border-t-2 border-x-2 sm:border-2 border-[#7C3AED]/40 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[58vh] flex flex-col overflow-hidden text-[#0F172A] animate-in slide-in-from-bottom duration-300 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Tirador visual de Bottom Sheet para dispositivos táctiles */}
            <div className="w-12 h-1.5 rounded-full bg-slate-300 mx-auto mt-2.5 mb-0.5 sm:hidden shrink-0"></div>

            {/* 1. Cabecera fija superior */}
            <div className="shrink-0 px-4 pt-2.5 pb-2.5 sm:px-5 sm:pt-4 sm:pb-3 border-b border-[#E2E8F0] bg-white flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0 pr-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-50 border border-purple-200 text-[#7C3AED] font-mono text-[10px] font-bold">
                    <Layers className="w-2.5 h-2.5" />
                    Quant #{item.id}
                  </span>
                  {item.defaultCode && (
                    <span className="text-[10px] font-mono text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.5 rounded">
                      Ref: {item.defaultCode}
                    </span>
                  )}
                  {item.barcode && (
                    <span className="text-[10px] font-mono text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.5 rounded">
                      EAN: {item.barcode}
                    </span>
                  )}
                </div>
                <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] leading-snug line-clamp-1">
                  {item.productName}
                </h4>
              </div>

              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="p-1.5 rounded-lg bg-[#F8FAFC] hover:bg-slate-100 text-[#64748B] hover:text-[#0F172A] cursor-pointer transition shrink-0 border border-[#E2E8F0]"
                aria-label="Cerrar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 2. Cuerpo desplazable */}
            <form
              id={`batch-form-${item.id}`}
              onSubmit={handleConfirmBatch}
              className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-3.5 space-y-2.5 sm:space-y-3 bg-white"
            >
              {/* Conmutador de Modo: Sumar al Acumulado vs Reemplazar / Corregir Total */}
              <div className="p-1 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setBatchMode('add');
                    batchInputRef.current?.focus();
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 sm:py-2 px-2 rounded-lg text-xs font-bold transition cursor-pointer select-none ${
                    batchMode === 'add'
                      ? 'bg-[#7C3AED] text-white shadow-sm'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Sumar al Acumulado</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBatchMode('replace');
                    batchInputRef.current?.focus();
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 sm:py-2 px-2 rounded-lg text-xs font-bold transition cursor-pointer select-none ${
                    batchMode === 'replace'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5 shrink-0" />
                  <span>Corregir Total</span>
                </button>
              </div>

              {/* Información del Estado Actual en 1 fila compacta */}
              <div className="grid grid-cols-3 gap-1.5 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-center">
                <div className="flex flex-col items-center justify-center">
                  <span className="text-[9px] uppercase tracking-wider text-[#64748B]">QS (Sistema)</span>
                  <span className="font-extrabold text-[#0F172A] text-xs sm:text-sm">{item.quantity} uds.</span>
                </div>
                <div className="flex flex-col items-center justify-center border-x border-[#E2E8F0] px-1">
                  <span className="text-[9px] uppercase tracking-wider text-[#7C3AED] font-medium">QC Actual</span>
                  <span className="font-black text-[#7C3AED] text-xs sm:text-sm">{parseFloat(localQC) || 0} uds.</span>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-[9px] uppercase tracking-wider text-[#64748B]">Operación</span>
                  <span className={`font-bold text-[10px] sm:text-xs truncate ${batchMode === 'add' ? 'text-[#7C3AED]' : 'text-amber-600'}`}>
                    {batchMode === 'add' ? '+ Suma Lote' : 'Sustitución'}
                  </span>
                </div>
              </div>

              {/* Formulario de Entrada */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor={`batch-input-${item.id}`} className="font-medium text-[#0F172A] text-[11px] sm:text-xs">
                    {batchMode === 'add' ? 'Cantidad a sumar (+):' : 'Nueva cantidad total:'}
                  </label>
                  {batchInputValue && (
                    <button
                      type="button"
                      onClick={() => setBatchInputValue('')}
                      className="text-[10px] sm:text-[11px] text-[#EF4444] hover:text-red-700 cursor-pointer"
                    >
                      Limpiar
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    ref={batchInputRef}
                    id={`batch-input-${item.id}`}
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={batchInputValue}
                    onChange={(e) => {
                      const formatted = sanitizeDecimalInput(e.target.value);
                      setBatchInputValue(formatted);
                    }}
                    placeholder="0"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    className={`w-full py-2.5 sm:py-3 px-3 rounded-xl bg-white border-2 text-center font-mono text-2xl sm:text-3xl font-black text-[#0F172A] outline-none transition shadow-xs ${
                      batchMode === 'add'
                        ? 'border-[#7C3AED] focus:border-[#6D28D9] focus:ring-2 focus:ring-[#7C3AED]/20'
                        : 'border-amber-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20'
                    }`}
                  />
                </div>
              </div>

              {/* Atajos Rápidos Compactos (+1, +5, +10, +20, +50, +100) */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold flex items-center justify-between">
                  <span>{batchMode === 'add' ? 'Atajos para sumar:' : 'Atajos numéricos:'}</span>
                  <span className="text-[9px] text-slate-400">Un toque para agregar</span>
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {[1, 5, 10, 20, 50, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="py-1 px-0.5 rounded-lg bg-[#F8FAFC] hover:bg-purple-50 active:scale-95 border border-[#E2E8F0] font-mono text-xs font-bold text-[#0F172A] transition cursor-pointer select-none text-center shadow-xs"
                    >
                      +{preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tarjeta de Cálculo y Fórmula en Tiempo Real */}
              <div className={`p-2 sm:p-2.5 rounded-xl border text-[11px] sm:text-xs space-y-1 ${
                batchMode === 'add'
                  ? 'bg-purple-50/70 border-[#7C3AED]/25 text-[#0F172A]'
                  : 'bg-amber-50/80 border-amber-200 text-[#0F172A]'
              }`}>
                <div className="flex items-center justify-between text-[10px] text-[#64748B]">
                  <span className="flex items-center gap-1 font-medium text-[#0F172A]">
                    <Calculator className="w-3 h-3 text-[#7C3AED]" />
                    <span>Fórmula en tiempo real:</span>
                  </span>
                  <span className="font-mono">
                    {batchMode === 'add' ? 'QC_actual + Lote' : 'Sustitución directa'}
                  </span>
                </div>

                <div className="text-xs sm:text-sm font-mono font-bold text-[#0F172A] flex items-center justify-between pt-0.5 border-t border-[#E2E8F0]">
                  {batchMode === 'add' ? (
                    <>
                      <span>{parseSafeFloat(localQC)} + {parseSafeFloat(batchInputValue)}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#7C3AED] shrink-0" />
                      <span className="text-sm sm:text-base font-black text-[#7C3AED]">
                        {Math.max(0, Math.round((parseSafeFloat(localQC) + parseSafeFloat(batchInputValue)) * 1000) / 1000)} uds.
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="line-through text-slate-400">{parseSafeFloat(localQC)}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="text-sm sm:text-base font-black text-amber-600">
                        {Math.max(0, parseSafeFloat(batchInputValue))} uds.
                      </span>
                    </>
                  )}
                </div>

                <div className="text-[10px] text-[#64748B] flex items-center justify-between pt-0.5">
                  <span>Diferencia vs Sistema ({item.quantity}):</span>
                  {(() => {
                    const finalQC = batchMode === 'add'
                      ? Math.max(0, Math.round((parseSafeFloat(localQC) + parseSafeFloat(batchInputValue)) * 1000) / 1000)
                      : Math.max(0, parseSafeFloat(batchInputValue));
                    const finalDiff = Math.round((finalQC - item.quantity) * 1000) / 1000;
                    return (
                      <span className={`font-mono font-bold ${
                        finalDiff === 0
                          ? 'text-[#10B981]'
                          : finalDiff > 0
                          ? 'text-[#10B981]'
                          : 'text-[#EF4444]'
                      }`}>
                        {finalDiff > 0 ? `+${finalDiff}` : finalDiff} uds.
                      </span>
                    );
                  })()}
                </div>
              </div>
            </form>

            {/* 3. Botones de acción fijados permanentemente en la parte inferior */}
            <div className="shrink-0 px-4 py-2.5 sm:px-5 sm:py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-white hover:bg-slate-100 active:scale-95 text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0] font-bold text-xs transition cursor-pointer text-center shadow-xs"
              >
                Cancelar
              </button>

              <button
                type="submit"
                form={`batch-form-${item.id}`}
                disabled={!batchInputValue.trim() && batchInputValue !== '0'}
                className={`flex-2 py-2.5 px-3 rounded-xl text-white font-black text-xs sm:text-sm shadow-md transition active:scale-95 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                  batchMode === 'add'
                    ? 'bg-[#7C3AED] hover:bg-[#6D28D9] shadow-[#7C3AED]/25'
                    : 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                }`}
              >
                <Check className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {batchMode === 'add'
                    ? `Confirmar y Sumar (${parseSafeFloat(batchInputValue) ? `+${parseSafeFloat(batchInputValue)}` : '0'})`
                    : `Confirmar Total (${parseSafeFloat(batchInputValue)})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Historial de Conteos Parciales */}
      {showHistoryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setShowHistoryModal(false)}
        >
          <div
            className="relative max-w-sm w-full bg-white border border-[#E2E8F0] rounded-3xl shadow-2xl p-5 text-[#0F172A] overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 text-[#7C3AED]">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#0F172A]">Historial de Aportes</h4>
                  <p className="text-[11px] text-[#64748B] line-clamp-1">{item.productName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="p-1.5 rounded-lg bg-[#F8FAFC] hover:bg-slate-100 text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3.5 space-y-2 text-xs">
              {item.countHistory && item.countHistory.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {item.countHistory.map((val, idx) => {
                      const isEditing = editingHistoryIdx === idx;
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-mono transition-colors hover:border-[#7C3AED]/40"
                        >
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[#64748B] font-sans text-[11px] font-bold shadow-xs">
                              [#{idx + 1}]
                            </span>
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-[#64748B] font-sans">Cantidad:</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editingHistoryVal}
                                  onChange={(e) => setEditingHistoryVal(sanitizeDecimalInput(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveEditHistoryEntry(idx);
                                    } else if (e.key === 'Escape') {
                                      setEditingHistoryIdx(null);
                                    }
                                  }}
                                  autoFocus
                                  className="w-20 px-2 py-1 rounded-lg bg-white border-2 border-[#7C3AED] font-mono text-xs font-bold text-[#0F172A] outline-none"
                                />
                              </div>
                            ) : (
                              <span className="text-[#64748B] font-sans text-xs">
                                Cantidad: <strong className={`font-mono text-sm ${val >= 0 ? 'text-[#7C3AED]' : 'text-red-500'}`}>{val}</strong>
                              </span>
                            )}
                          </div>

                          {/* Botones de Acción: Editar y Eliminar */}
                          <div className="flex items-center gap-1 shrink-0">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditHistoryEntry(idx)}
                                  className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer shadow-xs"
                                  title="Guardar cambio y recalcular total"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingHistoryIdx(null)}
                                  className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0] transition cursor-pointer shadow-xs"
                                  title="Cancelar edición"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditHistoryEntry(idx, val)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white hover:bg-purple-50 hover:text-[#7C3AED] text-[#64748B] border border-[#E2E8F0] transition cursor-pointer text-[11px] shadow-xs"
                                  title="Editar esta cantidad"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span className="hidden sm:inline font-sans">Editar</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHistoryEntry(idx)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white hover:bg-rose-50 hover:text-rose-600 text-[#64748B] border border-[#E2E8F0] transition cursor-pointer text-[11px] shadow-xs"
                                  title="Eliminar este aporte"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span className="hidden sm:inline font-sans">Eliminar</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 p-3 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-between font-mono">
                    <span className="text-[#64748B] font-sans font-bold text-xs">Total Conteo Físico (QC):</span>
                    <span className="text-base font-black text-[#0F172A]">{currentCounted} uds.</span>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-[#64748B] space-y-1">
                  <p className="font-medium">Sin aportes registrados aún.</p>
                  <p className="text-[11px] text-slate-400">
                    Usa el botón '+' o el ajuste rápido para registrar lotes.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[#E2E8F0] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="w-full py-2.5 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 text-[#0F172A] border border-[#E2E8F0] font-bold text-xs transition cursor-pointer text-center shadow-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
