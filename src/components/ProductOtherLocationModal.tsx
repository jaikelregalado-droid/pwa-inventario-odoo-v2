import React from 'react';
import { AlertTriangle, MapPin, Plus, X, Package, Layers } from 'lucide-react';

interface ProductOtherLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: number;
    name: string;
    defaultCode: string;
    barcode: string;
    categName?: string;
  };
  locations: Array<{
    quantId: number;
    locationId: number;
    locationName: string;
    quantity: number;
  }>;
  currentLocationName: string;
  currentCategoryName?: string;
  onLinkToCurrentAudit: () => void;
}

export const ProductOtherLocationModal: React.FC<ProductOtherLocationModalProps> = ({
  isOpen,
  onClose,
  product,
  locations,
  currentLocationName,
  currentCategoryName,
  onLinkToCurrentAudit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full bg-slate-900 border-2 border-amber-500/60 rounded-3xl shadow-2xl p-5 text-slate-100 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera de Alerta */}
        <div className="flex items-start justify-between pb-3.5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">
                Producto en Otra Ubicación / Dpto.
              </h3>
              <p className="text-xs text-amber-300 font-medium">
                Detectado en el catálogo global de Odoo
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cuerpo del modal con scroll */}
        <div className="flex-1 overflow-y-auto py-3.5 space-y-3.5 text-xs">
          {/* Ficha del Producto */}
          <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-950/80 border border-indigo-500/40 text-indigo-400 font-mono text-[10px] font-bold">
                <Package className="w-3 h-3" />
                ID #{product.id}
              </span>
              {product.defaultCode && (
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono text-[10px]">
                  Ref: {product.defaultCode}
                </span>
              )}
              {product.barcode && (
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono text-[10px]">
                  EAN: {product.barcode}
                </span>
              )}
              {product.categName && (
                <span className="px-2 py-0.5 rounded-md bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 text-[10px]">
                  {product.categName}
                </span>
              )}
            </div>

            <h4 className="text-sm font-black text-white leading-snug">
              {product.name}
            </h4>
          </div>

          {/* Ubicaciones donde existe actualmente en Odoo */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
              Ubicaciones Asignadas en Odoo:
            </span>

            {locations.length > 0 ? (
              <div className="space-y-1.5">
                {locations.map((loc, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <Layers className="w-4 h-4 text-slate-500 shrink-0" />
                      <span className="font-medium text-slate-200 truncate" title={loc.locationName}>
                        {loc.locationName}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-amber-300 shrink-0">
                      {loc.quantity} uds.
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400 text-center">
                El producto está registrado en Odoo pero no tiene existencias fijas asignadas en esta sede.
              </div>
            )}
          </div>

          {/* Nota de Auditoría */}
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs space-y-1">
            <span className="font-bold block">Auditoría en Curso:</span>
            <p className="text-amber-300/90 leading-relaxed text-[11px]">
              Tu sesión actual está asignada a la ubicación <strong className="text-white">{currentLocationName}</strong>
              {currentCategoryName ? ` y departamento ${currentCategoryName}` : ''}.
              Si este producto se encuentra físicamente aquí, puedes vincularlo excepcionalmente para contarlo en esta auditoría.
            </p>
          </div>
        </div>

        {/* Botones de Acción */}
        <div className="pt-3 border-t border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer text-center"
          >
            Cancelar / Ignorar
          </button>

          <button
            type="button"
            onClick={onLinkToCurrentAudit}
            className="flex-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs sm:text-sm shadow-xl shadow-indigo-950 transition cursor-pointer flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Vincular al Conteo Actual</span>
          </button>
        </div>
      </div>
    </div>
  );
};
