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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-w-2xl w-full max-h-[90vh] bg-white border border-[#E2E8F0] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#0F172A]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="shrink-0 px-4 py-3.5 sm:px-6 sm:py-4 border-b border-[#E2E8F0] bg-white flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-purple-50 border border-purple-200 text-[#7C3AED] shrink-0">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-[#0F172A] leading-tight">
                Crear Inventario Personalizado
              </h3>
              <p className="text-xs text-[#64748B]">
                Selecciona productos de diferentes departamentos y almacenes para un conteo a medida
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0] cursor-pointer transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Búsqueda y Filtros */}
        <div className="p-4 sm:p-5 border-b border-[#E2E8F0] bg-[#F8FAFC] space-y-3">
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
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-[#CBD5E1] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20 text-xs sm:text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none shadow-xs"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-bold text-xs shadow-sm transition cursor-pointer flex items-center gap-1.5 shrink-0 active:scale-95"
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
                className="flex items-center gap-1 text-[#64748B] hover:text-[#0F172A] text-[11px] font-medium disabled:opacity-40 cursor-pointer"
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#7C3AED]" />
                <span>Marcar visibles ({searchResults.length})</span>
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={handleDeselectAllVisible}
                disabled={selectedItems.size === 0}
                className="flex items-center gap-1 text-[#64748B] hover:text-[#0F172A] text-[11px] font-medium disabled:opacity-40 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 text-[#94A3B8]" />
                <span>Desmarcar visibles</span>
              </button>
            </div>

            {/* Contador en Tiempo Real */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-[#7C3AED] font-bold text-xs">
              <span className="inline-block w-2 h-2 rounded-full bg-[#7C3AED] animate-pulse"></span>
              <span>{selectedItems.size} productos seleccionados</span>
            </div>
          </div>
        </div>

        {/* Lista de Resultados con Checkbox */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 min-h-[220px] bg-slate-50/50">
          {isSearching && (
            <div className="py-12 text-center text-[#64748B] space-y-2">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#7C3AED]" />
              <p className="text-xs">Consultando catálogo global de Odoo 17...</p>
            </div>
          )}

          {!isSearching && searchResults.length === 0 && (
            <div className="py-12 text-center text-[#64748B] space-y-2">
              <Boxes className="w-10 h-10 mx-auto text-slate-400" />
              <p className="text-sm font-semibold text-[#0F172A]">No se encontraron productos con ese criterio</p>
              <p className="text-xs text-[#64748B]">Prueba buscando otro término o deja el campo vacío para ver todos.</p>
            </div>
          )}

          {!isSearching && searchResults.map((item) => {
            const isChecked = selectedItems.has(item.id);
            return (
              <div
                key={item.id}
                onClick={() => toggleSelectItem(item)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 shadow-xs ${
                  isChecked
                    ? 'bg-purple-50/70 border-2 border-[#7C3AED] text-[#0F172A]'
                    : 'bg-white border-[#E2E8F0] hover:border-slate-300 text-[#0F172A]'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-5 h-5 text-[#7C3AED]" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-xs sm:text-sm font-bold truncate leading-tight text-[#0F172A]">
                      {item.productName}
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap text-[10px] text-[#64748B] font-mono">
                      {item.defaultCode && (
                        <span className="bg-[#F8FAFC] px-1.5 py-0.5 rounded border border-[#E2E8F0]">
                          Ref: {item.defaultCode}
                        </span>
                      )}
                      {item.barcode && (
                        <span className="bg-[#F8FAFC] px-1.5 py-0.5 rounded border border-[#E2E8F0]">
                          EAN: {item.barcode}
                        </span>
                      )}
                      {item.categName && (
                        <span className="bg-purple-50 text-[#7C3AED] px-1.5 py-0.5 rounded border border-purple-200">
                          {item.categName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10px] text-[#64748B] block font-medium">QS (Sistema)</span>
                  <span className="text-xs sm:text-sm font-bold font-mono text-[#0F172A]">
                    {item.quantity} uds.
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Panel Resumen de Selección (Píldoras Removibles) */}
        {selectedItems.size > 0 && (
          <div className="px-4 py-2.5 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center gap-2 overflow-x-auto text-xs shrink-0 scrollbar-none">
            <span className="text-[11px] text-[#7C3AED] font-bold shrink-0">Seleccionados:</span>
            {Array.from(selectedItems.values()).map((it) => (
              <span
                key={it.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-purple-200 text-[#7C3AED] text-[11px] font-medium truncate max-w-[180px] shrink-0 shadow-2xs"
              >
                <span className="truncate">{it.productName}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveSelectedItem(it.id);
                  }}
                  className="hover:text-red-500 cursor-pointer text-[#64748B]"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Mensaje de Error si ocurre */}
        {errorMessage && (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Pie de Página: Nombre del Auditor y Botón de Inicio */}
        <div className="shrink-0 p-4 sm:p-5 border-t border-[#E2E8F0] bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="w-full sm:w-auto flex-1 max-w-xs space-y-1">
            <label className="text-[10px] text-[#64748B] font-semibold block uppercase tracking-wider">
              Auditor Asignado:
            </label>
            <input
              type="text"
              value={auditorName}
              onChange={(e) => setAuditorName(e.target.value)}
              placeholder="Nombre del auditor..."
              className="w-full px-3 py-2 rounded-xl bg-white border border-[#CBD5E1] text-xs text-[#0F172A] placeholder-[#94A3B8] outline-none focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED]/20 shadow-xs"
            />
          </div>

          <button
            type="button"
            onClick={handleStartAudit}
            disabled={selectedItems.size === 0 || isSubmitting}
            className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm shadow-md transition active:scale-95 cursor-pointer"
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
