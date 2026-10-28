import React, { useState, useEffect, useMemo } from 'react';
import {
  Boxes,
  Search,
  CheckCircle2,
  X,
  Plus,
  Loader2,
  ArrowRight,
  FolderKanban,
  Building2,
  Tag,
  CheckSquare,
  Square,
  AlertCircle,
  Sparkles,
  Trash2
} from 'lucide-react';
import { QuantItem, OdooConnectionConfig, AuditSession } from '../types';
import { searchGlobalProductsForCustomAudit } from '../lib/odoo';
import { generateSessionPin, registerSessionInSupabase, getSupabaseClient } from '../lib/supabase';
import { sound } from '../lib/audio';

interface CustomInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  odooConfig: OdooConnectionConfig;
  isDemo: boolean;
  currentAuditorName?: string;
  currentPin?: string;
  onStartCustomAudit: (
    session: AuditSession,
    config: OdooConnectionConfig,
    items: QuantItem[],
    isDemo: boolean
  ) => void;
}

export const CustomInventoryModal: React.FC<CustomInventoryModalProps> = ({
  isOpen,
  onClose,
  odooConfig,
  isDemo,
  currentAuditorName = '',
  currentPin,
  onStartCustomAudit,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<QuantItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Map<number, QuantItem>>(new Map());
  const [auditorName, setAuditorName] = useState(currentAuditorName || '');
  const [customTitle, setCustomTitle] = useState('Inventario Multi-Departamento');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Carga inicial o al abrir el modal
  useEffect(() => {
    if (isOpen) {
      handleSearch('');
    }
  }, [isOpen]);

  const handleSearch = async (term: string) => {
    setIsSearching(true);
    setErrorMessage(null);
    try {
      const results = await searchGlobalProductsForCustomAudit(odooConfig, term, isDemo);
      setSearchResults(results);
    } catch (err: any) {
      console.error('Error buscando productos:', err);
      setErrorMessage(err.message || 'Error al consultar productos de Odoo');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleSelectItem = (item: QuantItem) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, {
          ...item,
          countedQuantity: 0,
          difference: -item.quantity,
          isLocked: false,
          countHistory: [],
        });
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      for (const item of searchResults) {
        if (!next.has(item.id)) {
          next.set(item.id, {
            ...item,
            countedQuantity: 0,
            difference: -item.quantity,
            isLocked: false,
            countHistory: [],
          });
        }
      }
      return next;
    });
  };

  const handleDeselectAllVisible = () => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      for (const item of searchResults) {
        next.delete(item.id);
      }
      return next;
    });
  };

  const handleRemoveSelectedItem = (id: number) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const handleStartAudit = async () => {
    if (selectedItems.size === 0) {
      setErrorMessage('Debes seleccionar al menos un producto para iniciar la auditoría.');
      return;
    }

    const finalAuditor = auditorName.trim() || 'Auditor Multi-Área';
    const pin = currentPin || generateSessionPin();
    const finalItems = Array.from(selectedItems.values());

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      sound.playScan();

      const newSession: AuditSession = {
        pin,
        auditorName: finalAuditor,
        role: 'lead',
        createdAt: new Date().toISOString(),
        companyId: odooConfig.companyId || 1,
        companyName: odooConfig.companyName || 'FV GRUPO EMPRESARIAL, C.A.',
        locationId: undefined,
        locationName: 'Multi-Ubicación / Global',
        categoryId: undefined,
        categoryName: customTitle.trim() || 'Inventario Multi-Departamento',
        startedAt: new Date().toISOString(),
      };

      // 1. Guardar estructura del inventario personalizado en LocalStorage
      const storageKeyCustom = `odoo_audit_custom_inventory_${pin}`;
      const storageKeyOffline = `odoo_audit_offline_items_${pin}`;
      try {
        localStorage.setItem(storageKeyCustom, JSON.stringify(finalItems));
        localStorage.setItem(storageKeyOffline, JSON.stringify(finalItems));
      } catch (storageErr) {
        console.warn('Error guardando en LocalStorage:', storageErr);
      }

      // 2. Registrar sesión en Supabase
      await registerSessionInSupabase(newSession, odooConfig);

      // 3. Pre-insertar los productos seleccionados en la tabla 'audit_items' con su QS (sistema)
      const supabase = getSupabaseClient();
      if (supabase) {
        const recordsToInsert = finalItems.map((it) => ({
          id: `${pin}_${it.productId || it.id}`,
          pin,
          product_id: it.productId || it.id,
          quant_id: it.id,
          product_name: it.productName,
          barcode: it.barcode || null,
          system_quantity: it.quantity,
          counted_quantity: 0,
          qty: 0,
          is_locked: false,
          auditor_name: finalAuditor,
          notes: JSON.stringify({ isCustomInventory: true, category: it.categName }),
          updated_at: new Date().toISOString(),
        }));

        try {
          await supabase.from('audit_items').upsert(recordsToInsert, { onConflict: 'pin,product_id' });
        } catch (itemInsertErr) {
          console.warn('Error al insertar items en audit_items:', itemInsertErr);
        }
      }

      // 4. Redirigir a la pantalla principal cargando solo los productos seleccionados
      onStartCustomAudit(newSession, odooConfig, finalItems, isDemo);
      onClose();
    } catch (err: any) {
      console.error('Error iniciando auditoría personalizada:', err);
      setErrorMessage(err.message || 'Error al iniciar la sesión');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-w-2xl w-full max-h-[90vh] bg-[#1E293B] border border-[#334155] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#F8FAFC]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="shrink-0 px-4 py-3.5 sm:px-6 sm:py-4 border-b border-[#334155] bg-[#1E293B] flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-950/60 border border-[#2563EB]/40 text-blue-400 shrink-0">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-[#F8FAFC] leading-tight">
                Crear Inventario Personalizado
              </h3>
              <p className="text-xs text-[#94A3B8]">
                Selecciona productos de diferentes departamentos y almacenes para un conteo a medida
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-[#94A3B8] hover:text-[#F8FAFC] border border-[#334155] cursor-pointer transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Búsqueda y Filtros */}
        <div className="p-4 sm:p-5 border-b border-[#334155] bg-[#0F172A]/80 space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch(searchTerm);
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nombre, código de barras o ref. interna..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0F172A] border border-[#334155] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/25 text-xs sm:text-sm text-[#F8FAFC] placeholder-[#94A3B8] outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-500 text-white font-bold text-xs shadow-md transition cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Buscar</span>
            </button>
          </form>

          {/* Acciones de Selección Rápida y Contador en Vivo */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllVisible}
                disabled={searchResults.length === 0}
                className="flex items-center gap-1 text-[#94A3B8] hover:text-[#F8FAFC] text-[11px] disabled:opacity-40 cursor-pointer"
              >
                <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                <span>Marcar visibles ({searchResults.length})</span>
              </button>
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={handleDeselectAllVisible}
                disabled={selectedItems.size === 0}
                className="flex items-center gap-1 text-[#94A3B8] hover:text-[#F8FAFC] text-[11px] disabled:opacity-40 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 text-[#94A3B8]" />
                <span>Desmarcar visibles</span>
              </button>
            </div>

            {/* Contador en Tiempo Real */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-950/80 border border-[#2563EB]/50 text-blue-300 font-bold text-xs shadow-inner">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
              <span>{selectedItems.size} productos seleccionados</span>
            </div>
          </div>
        </div>

        {/* Lista de Resultados con Checkbox */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 min-h-[220px]">
          {isSearching && (
            <div className="py-12 text-center text-[#94A3B8] space-y-2">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-400" />
              <p className="text-xs">Consultando catálogo global de Odoo 17...</p>
            </div>
          )}

          {!isSearching && searchResults.length === 0 && (
            <div className="py-12 text-center text-[#94A3B8] space-y-2">
              <Boxes className="w-10 h-10 mx-auto text-slate-600" />
              <p className="text-sm font-semibold text-[#F8FAFC]">No se encontraron productos con ese criterio</p>
              <p className="text-xs text-[#94A3B8]">Prueba buscando otro término o deja el campo vacío para ver todos.</p>
            </div>
          )}

          {!isSearching && searchResults.map((item) => {
            const isChecked = selectedItems.has(item.id);
            return (
              <div
                key={item.id}
                onClick={() => toggleSelectItem(item)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isChecked
                    ? 'bg-blue-950/50 border-2 border-[#2563EB] shadow-md shadow-blue-950/50 text-[#F8FAFC]'
                    : 'bg-[#0F172A]/60 border border-[#334155] hover:border-slate-500 text-[#94A3B8]'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-5 h-5 text-blue-400 fill-blue-400/20" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-500" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-xs sm:text-sm font-bold truncate leading-tight text-[#F8FAFC]">
                      {item.productName}
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap text-[10px] text-[#94A3B8] font-mono">
                      {item.defaultCode && (
                        <span className="bg-[#0F172A] px-1.5 py-0.5 rounded border border-[#334155]">
                          Ref: {item.defaultCode}
                        </span>
                      )}
                      {item.barcode && (
                        <span className="bg-[#0F172A] px-1.5 py-0.5 rounded border border-[#334155]">
                          EAN: {item.barcode}
                        </span>
                      )}
                      {item.categName && (
                        <span className="bg-blue-950/80 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800/40">
                          {item.categName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10px] text-[#94A3B8] block font-medium">QS (Sistema)</span>
                  <span className="text-xs sm:text-sm font-bold font-mono text-[#F8FAFC]">
                    {item.quantity} uds.
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Panel Resumen de Selección (Píldoras Removibles) */}
        {selectedItems.size > 0 && (
          <div className="px-4 py-2.5 bg-[#0F172A] border-t border-[#334155] flex items-center gap-2 overflow-x-auto text-xs shrink-0 scrollbar-none">
            <span className="text-[11px] text-blue-300 font-bold shrink-0">Seleccionados:</span>
            {Array.from(selectedItems.values()).map((it) => (
              <span
                key={it.id}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-950/80 border border-[#2563EB]/40 text-[#F8FAFC] text-[11px] truncate max-w-[180px] shrink-0"
              >
                <span className="truncate">{it.productName}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveSelectedItem(it.id);
                  }}
                  className="hover:text-red-400 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Mensaje de Error si ocurre */}
        {errorMessage && (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-rose-950/80 border border-rose-600/50 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Pie de Página: Nombre del Auditor y Botón de Inicio */}
        <div className="shrink-0 p-4 sm:p-5 border-t border-[#334155] bg-[#0F172A]/90 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="w-full sm:w-auto flex-1 max-w-xs space-y-1">
            <label className="text-[10px] text-[#94A3B8] font-semibold block">
              Auditor Asignado:
            </label>
            <input
              type="text"
              value={auditorName}
              onChange={(e) => setAuditorName(e.target.value)}
              placeholder="Nombre del auditor..."
              className="w-full px-3 py-1.5 rounded-xl bg-[#0F172A] border border-[#334155] text-xs text-[#F8FAFC] placeholder-[#94A3B8] outline-none focus:border-[#2563EB]"
            />
          </div>

          <button
            type="button"
            onClick={handleStartAudit}
            disabled={selectedItems.size === 0 || isSubmitting}
            className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-[#2563EB] hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm shadow-xl shadow-blue-950 transition active:scale-95 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Inicializando sesión y Supabase...</span>
              </>
            ) : (
              <>
                <span>Iniciar Auditoría Personalizada ({selectedItems.size})</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
