import React, { useState } from 'react';
import { X, Send, AlertCircle, CheckCircle2, ShieldCheck, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { QuantItem, OdooConnectionConfig } from '../types';
import { sendInventoryAdjustmentToOdoo } from '../lib/odoo';
import { sound } from '../lib/audio';

interface OdooSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: QuantItem[];
  odooConfig: OdooConnectionConfig;
  isDemo: boolean;
  onSuccess: (updatedQuantIds: number[]) => void;
}

export const OdooSyncModal: React.FC<OdooSyncModalProps> = ({
  isOpen,
  onClose,
  items,
  odooConfig,
  isDemo,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    successCount: number;
    failedCount: number;
    errors: string[];
  } | null>(null);

  if (!isOpen) return null;

  // Filtrar quants que tienen conteo físico registrado o diferencia
  const itemsWithCounts = items.filter((q) => q.countedQuantity !== undefined);
  const itemsWithDiscrepancy = items.filter((q) => q.difference !== 0);

  const totalSurplus = items.reduce((acc, q) => (q.difference > 0 ? acc + q.difference : acc), 0);
  const totalDeficit = items.reduce((acc, q) => (q.difference < 0 ? acc + Math.abs(q.difference) : acc), 0);

  const handleSendToOdoo = async () => {
    setIsSubmitting(true);
    setResult(null);

    const payload = items.map((q) => ({
      id: q.id,
      productId: q.productId,
      locationId: q.locationId,
      countedQuantity: q.countedQuantity,
    }));

    if (isDemo) {
      // Simulación en modo demo
      setTimeout(() => {
        setIsSubmitting(false);
        setResult({
          successCount: payload.length,
          failedCount: 0,
          errors: [],
        });
        sound.playSuccess();
        onSuccess(payload.map((p) => p.id));
      }, 1000);
      return;
    }

    try {
      const res = await sendInventoryAdjustmentToOdoo(odooConfig, payload);
      setResult(res);
      if (res.successCount > 0) {
        sound.playSuccess();
        onSuccess(payload.map((p) => p.id));
      } else {
        sound.playError();
      }
    } catch (err: any) {
      sound.playError();
      setResult({
        successCount: 0,
        failedCount: payload.length,
        errors: [err.message || 'Error general al conectar con Odoo'],
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
      <div
        className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-950/60 border border-indigo-500/30 text-indigo-400">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Enviar Ajuste a Odoo 17</h3>
              <p className="text-xs text-slate-400">Actualización del campo inventory_quantity</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Alerta de Seguridad Estricta Odoo 17 */}
          <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="block font-bold text-indigo-300">
                Garantía de Integridad Odoo 17:
              </strong>
              <p className="text-indigo-200/90 leading-relaxed">
                Este proceso escribe <strong>ÚNICAMENTE</strong> sobre el campo <code className="px-1 py-0.5 rounded bg-indigo-900/60 font-mono">inventory_quantity</code> del modelo <code className="px-1 py-0.5 rounded bg-indigo-900/60 font-mono">stock.quant</code>.
                La cantidad teórica (<code className="px-1 py-0.5 rounded bg-indigo-900/60 font-mono">quantity</code>) jamás se sobreescribe, asegurando que el supervisor audite y asiente el ajuste en Odoo.
              </p>
            </div>
          </div>

          {/* Resumen Estadístico */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Quants</span>
              <span className="text-lg font-black text-white mt-0.5 block">{items.length}</span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-center">
              <span className="text-[10px] uppercase font-bold text-emerald-400 block">Sobrante Total</span>
              <span className="text-lg font-black text-emerald-300 mt-0.5 block">+{totalSurplus}</span>
            </div>

            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-center">
              <span className="text-[10px] uppercase font-bold text-rose-400 block">Faltante Total</span>
              <span className="text-lg font-black text-rose-300 mt-0.5 block">-{totalDeficit}</span>
            </div>
          </div>

          {/* Estado de resultado post-envío */}
          {result && (
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                result.failedCount === 0
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                  : 'bg-amber-950/50 border-amber-500/40 text-amber-200'
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                {result.failedCount === 0 ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>¡Ajustes enviados exitosamente a Odoo 17!</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    <span>Ajuste completado con algunas observaciones:</span>
                  </>
                )}
              </div>
              <p>
                {result.successCount} registros actualizados en stock.quant.
                {result.failedCount > 0 && ` (${result.failedCount} errores).`}
              </p>
              {result.errors.length > 0 && (
                <ul className="list-disc list-inside text-[11px] text-rose-300 space-y-0.5">
                  {result.errors.slice(0, 3).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isDemo && (
            <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-600/30 text-[11px] text-amber-300">
              ⚡ Estás en modo demostración con datos de FV Grupo Empresarial. Los ajustes se simularán de forma local.
            </div>
          )}
        </div>

        {/* Pie de página con acciones */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition cursor-pointer"
          >
            {result ? 'Cerrar' : 'Cancelar'}
          </button>

          <button
            type="button"
            onClick={handleSendToOdoo}
            disabled={isSubmitting || items.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-indigo-950 transition active:scale-95 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Transmitiendo a Odoo...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Confirmar y Enviar a Odoo</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
