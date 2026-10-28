import React, { useState, useMemo, useEffect } from 'react';
import {
  FolderKanban,
  Search,
  Play,
  Check,
  RefreshCw,
  AlertTriangle,
  User,
  MapPin,
  Key,
  X,
  Boxes,
  Sparkles,
  CheckSquare,
  Square
} from 'lucide-react';
import { OdooCategory } from '../types';

interface CategorySelectionModalProps {
  isOpen: boolean;
  categories: OdooCategory[];
  isLoadingCategories: boolean;
  loadError?: string | null;
  auditorName: string;
  sessionPin: string;
  locationName: string;
  currentCategoryId?: number;
  currentCategoryIds?: number[];
  canClose?: boolean;
  onSelectCategory?: (category: OdooCategory) => void;
  onSelectCategories?: (categories: OdooCategory[]) => void;
  onClose?: () => void;
  onRetryLoadCategories?: () => void;
  onOpenCustomInventory?: () => void;
}

export const CategorySelectionModal: React.FC<CategorySelectionModalProps> = ({
  isOpen,
  categories,
  isLoadingCategories,
  loadError,
  auditorName,
  sessionPin,
  locationName,
  currentCategoryId,
  currentCategoryIds,
  canClose = false,
  onSelectCategory,
  onSelectCategories,
  onClose,
  onRetryLoadCategories,
  onOpenCustomInventory,
}) => {
  // Lista de IDs de categorías seleccionadas (Multiselect)
  const [selectedCatIds, setSelectedCatIds] = useState<number[]>(() => {
    if (currentCategoryIds && currentCategoryIds.length > 0) return currentCategoryIds;
    if (currentCategoryId) return [currentCategoryId];
    return [];
  });
  const [search, setSearch] = useState('');

  // Sincronizar selección inicial cuando cambian los props
  useEffect(() => {
    if (currentCategoryIds && currentCategoryIds.length > 0) {
      setSelectedCatIds(currentCategoryIds);
    } else if (currentCategoryId) {
      setSelectedCatIds([currentCategoryId]);
    }
  }, [currentCategoryId, currentCategoryIds]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase().trim();
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.complete_name && c.complete_name.toLowerCase().includes(q))
    );
  }, [categories, search]);

  const selectedCategoryObjects = useMemo(() => {
    return categories.filter((c) => selectedCatIds.includes(c.id));
  }, [categories, selectedCatIds]);

  if (!isOpen) return null;

  const handleToggleCategory = (catId: number) => {
    setSelectedCatIds((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredCategories.map((c) => c.id);
    setSelectedCatIds((prev) => {
      const combined = new Set([...prev, ...filteredIds]);
      return Array.from(combined);
    });
  };

  const handleDeselectAll = () => {
    setSelectedCatIds([]);
  };

  const handleStartCount = () => {
    if (selectedCategoryObjects.length > 0) {
      if (onSelectCategories) {
        onSelectCategories(selectedCategoryObjects);
      } else if (onSelectCategory) {
        onSelectCategory(selectedCategoryObjects[0]);
      }
    }
  };

  const count = selectedCatIds.length;
  const buttonLabel =
    count === 0
      ? 'Iniciar Conteo (0 Categorías seleccionadas)'
      : count === 1
      ? 'Iniciar Conteo (1 Categoría seleccionada)'
      : `Iniciar Conteo (${count} Categorías seleccionadas)`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-white border border-[#E2E8F0] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="p-4 sm:p-5 border-b border-[#E2E8F0] bg-white flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-purple-50 border border-purple-200 text-[#7C3AED] shrink-0">
              <FolderKanban className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#0F172A] flex items-center gap-2">
                <span>Selección de Categorías Obligatoria</span>
                <span className="px-1.5 py-0.5 rounded bg-[#7C3AED] text-[10px] font-extrabold uppercase text-white tracking-wider">
                  Multiselect
                </span>
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                Marca una o varias categorías simultáneamente (ej: Frutas, Verduras, Lácteos) para cargar los productos combinados.
              </p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#64748B] hover:text-[#0F172A] hover:bg-slate-100 border border-[#E2E8F0] transition cursor-pointer shrink-0"
              title="Cerrar ventana de categoría (X)"
              aria-label="Cerrar modal de categoría"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          )}
        </div>

        {/* Resumen de Sesión Activa */}
        <div className="px-4 py-2 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1 text-[#0F172A] font-medium">
              <User className="w-3.5 h-3.5 text-[#7C3AED]" />
              {auditorName}
            </span>
            <span className="flex items-center gap-1 font-mono text-[#7C3AED] font-semibold">
              <Key className="w-3.5 h-3.5 text-[#7C3AED]" />
              PIN: {sessionPin}
            </span>
            <span className="flex items-center gap-1 truncate max-w-[180px]" title={locationName}>
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">{locationName}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition ${
                count > 0
                  ? 'bg-purple-50 text-[#7C3AED] border-purple-200'
                  : 'bg-white text-[#64748B] border-[#E2E8F0]'
              }`}
            >
              {count} {count === 1 ? 'categoría marcada' : 'categorías marcadas'}
            </span>
          </div>
        </div>

        {/* Buscador de Categorías y Acciones Rápidas */}
        <div className="p-3.5 border-b border-[#E2E8F0] bg-white space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar categorías para marcar..."
              autoFocus
              className="w-full pl-9 pr-9 py-2 rounded-xl bg-white border border-[#CBD5E1] focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED] text-xs sm:text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#64748B] hover:text-[#0F172A] text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Botones de acción rápida: Marcar todas filtradas / Desmarcar */}
          <div className="flex items-center justify-between text-[11px] pt-1">
            <span className="text-[#64748B]">
              Disponibles: <strong className="text-[#0F172A]">{filteredCategories.length}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                disabled={filteredCategories.length === 0}
                className="px-2 py-1 rounded-lg bg-[#F8FAFC] hover:bg-purple-50 border border-[#E2E8F0] text-[#7C3AED] font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 shadow-xs"
              >
                <CheckSquare className="w-3 h-3 text-[#7C3AED]" />
                <span>Marcar visibles</span>
              </button>
              {count > 0 && (
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="px-2 py-1 rounded-lg bg-[#F8FAFC] hover:bg-rose-50 border border-[#E2E8F0] text-[#EF4444] font-medium transition cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <Square className="w-3 h-3 text-[#EF4444]" />
                  <span>Desmarcar todas</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Barra con botón redondeado para Crear Inventario Personalizado */}
        {onOpenCustomInventory && (
          <div className="px-4 py-2.5 sm:px-6 bg-purple-50/60 border-b border-purple-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1.5 rounded-lg bg-white text-[#7C3AED] border border-purple-200 shrink-0 shadow-xs">
                <Boxes className="w-4 h-4" />
              </span>
              <div className="truncate">
                <span className="text-xs font-bold text-[#0F172A] block truncate">¿Múltiples almacenes o buscador global?</span>
                <span className="text-[10px] text-[#64748B] block truncate">Arma un inventario a medida con selección de productos</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenCustomInventory}
              className="px-3.5 py-1.5 rounded-full bg-[#7C3AED] hover:bg-[#6D28D9] active:scale-95 text-white font-bold text-xs shadow-sm transition cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Crear Personalizado</span>
            </button>
          </div>
        )}

        {/* Lista de Categorías con scroll y casillas de verificación (checkboxes) */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2 min-h-[220px] bg-white">
          {isLoadingCategories ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-7 h-7 animate-spin text-[#7C3AED] mx-auto" />
              <p className="text-xs text-[#64748B] font-medium">
                Cargando categorías desde Odoo 17...
              </p>
            </div>
          ) : loadError ? (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="font-mono text-[11px] leading-relaxed">{loadError}</span>
              </div>
              {onRetryLoadCategories && (
                <button
                  type="button"
                  onClick={onRetryLoadCategories}
                  className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs cursor-pointer"
                >
                  Reintentar Carga
                </button>
              )}
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="py-10 text-center text-[#64748B] text-xs space-y-1">
              <FolderKanban className="w-8 h-8 mx-auto text-slate-300" />
              <p className="font-medium text-[#0F172A]">No se encontraron categorías</p>
              <p className="text-[11px]">Prueba con otro término de búsqueda.</p>
            </div>
          ) : (
            filteredCategories.map((cat) => {
              const isSelected = selectedCatIds.includes(cat.id);
              return (
                <div
                  key={cat.id}
                  onClick={() => handleToggleCategory(cat.id)}
                  className={`w-full text-left p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 select-none ${
                    isSelected
                      ? 'bg-purple-50/70 border-2 border-[#7C3AED] shadow-xs text-[#0F172A]'
                      : 'bg-[#F8FAFC] hover:bg-slate-100 border border-[#E2E8F0] text-[#64748B]'
                  }`}
                >
                  {/* Casilla de verificación (Checkbox) */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        isSelected
                          ? 'bg-[#7C3AED] border-[#7C3AED] text-white shadow-xs'
                          : 'border-[#CBD5E1] bg-white text-transparent hover:border-[#7C3AED]'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>

                    <div className="truncate">
                      <div className={`font-semibold text-xs sm:text-sm truncate ${isSelected ? 'text-[#0F172A]' : 'text-slate-800'}`}>
                        {cat.name}
                      </div>
                      {cat.complete_name && cat.complete_name !== cat.name && (
                        <div className="text-[11px] text-[#64748B] truncate mt-0.5">
                          {cat.complete_name}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-[#7C3AED] border border-purple-200">
                      Marcada
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pie de Acción con Contador Visual en Botón Iniciar Conteo */}
        <div className="p-3.5 sm:p-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#64748B] truncate max-w-full sm:max-w-xs">
            {count > 0 ? (
              <span className="text-[#0F172A] truncate block">
                {count === 1 ? (
                  <>Seleccionada: <strong className="text-[#7C3AED] font-semibold">{selectedCategoryObjects[0]?.name}</strong></>
                ) : (
                  <>Seleccionadas: <strong className="text-[#7C3AED] font-semibold">{selectedCategoryObjects.map((c) => c.name).join(', ')}</strong></>
                )}
              </span>
            ) : (
              <span className="text-amber-600 font-medium">Marca al menos una categoría para continuar</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto w-full sm:w-auto">
            {onClose && canClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] font-medium text-xs transition cursor-pointer shadow-xs"
                title="Cerrar ventana y auditar todos los productos"
              >
                Saltar
              </button>
            )}
            <button
              type="button"
              disabled={count === 0 || isLoadingCategories}
              onClick={handleStartCount}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition cursor-pointer shadow-md ${
                count > 0 && !isLoadingCategories
                  ? 'bg-[#7C3AED] hover:bg-[#6D28D9] text-white shadow-[#7C3AED]/25 active:scale-95'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{buttonLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
