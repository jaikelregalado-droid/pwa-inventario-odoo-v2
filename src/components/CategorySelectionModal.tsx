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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 shrink-0">
              <FolderKanban className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>Selección de Categorías Obligatoria</span>
                <span className="px-1.5 py-0.5 rounded bg-indigo-500 text-[10px] font-extrabold uppercase text-white tracking-wider">
                  Multiselect
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Marca una o varias categorías simultáneamente (ej: Frutas, Verduras, Lácteos) para cargar los productos combinados.
              </p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 transition cursor-pointer shrink-0"
              title="Cerrar ventana de categoría (X)"
              aria-label="Cerrar modal de categoría"
            >
              <X className="w-5 h-5 text-slate-300" />
            </button>
          )}
        </div>

        {/* Resumen de Sesión Activa */}
        <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              {auditorName}
            </span>
            <span className="flex items-center gap-1 font-mono text-indigo-300">
              <Key className="w-3.5 h-3.5 text-indigo-400" />
              PIN: {sessionPin}
            </span>
            <span className="flex items-center gap-1 truncate max-w-[180px]" title={locationName}>
              <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">{locationName}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition ${
                count > 0
                  ? 'bg-indigo-950 text-indigo-300 border-indigo-500/50'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {count} {count === 1 ? 'categoría marcada' : 'categorías marcadas'}
            </span>
          </div>
        </div>

        {/* Buscador de Categorías y Acciones Rápidas */}
        <div className="p-3.5 border-b border-slate-800 bg-slate-900/50 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar categorías para marcar..."
              autoFocus
              className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs sm:text-sm text-white placeholder-slate-500 outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Botones de acción rápida: Marcar todas filtradas / Desmarcar */}
          <div className="flex items-center justify-between text-[11px] pt-1">
            <span className="text-slate-400">
              Disponibles: <strong className="text-slate-200">{filteredCategories.length}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                disabled={filteredCategories.length === 0}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-300 hover:text-white font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <CheckSquare className="w-3 h-3 text-indigo-400" />
                <span>Marcar visibles</span>
              </button>
              {count > 0 && (
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-rose-300 hover:text-rose-200 font-medium transition cursor-pointer flex items-center gap-1"
                >
                  <Square className="w-3 h-3 text-rose-400" />
                  <span>Desmarcar todas</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Barra con botón azul redondeado para Crear Inventario Personalizado */}
        {onOpenCustomInventory && (
          <div className="px-4 py-2.5 sm:px-6 bg-gradient-to-r from-blue-950/70 via-slate-900 to-indigo-950/70 border-b border-blue-500/25 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1.5 rounded-lg bg-blue-600/30 text-blue-400 border border-blue-500/30 shrink-0">
                <Boxes className="w-4 h-4" />
              </span>
              <div className="truncate">
                <span className="text-xs font-bold text-white block truncate">¿Múltiples almacenes o buscador global?</span>
                <span className="text-[10px] text-slate-400 block truncate">Arma un inventario a medida con selección de productos</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenCustomInventory}
              className="px-3.5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-blue-950 transition cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Crear Personalizado</span>
            </button>
          </div>
        )}

        {/* Lista de Categorías con scroll y casillas de verificación (checkboxes) */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2 min-h-[220px]">
          {isLoadingCategories ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-7 h-7 animate-spin text-indigo-400 mx-auto" />
              <p className="text-xs text-slate-400 font-medium">
                Cargando categorías desde Odoo 17...
              </p>
            </div>
          ) : loadError ? (
            <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono text-[11px] leading-relaxed">{loadError}</span>
              </div>
              {onRetryLoadCategories && (
                <button
                  type="button"
                  onClick={onRetryLoadCategories}
                  className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs cursor-pointer"
                >
                  Reintentar Carga
                </button>
              )}
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-xs space-y-1">
              <FolderKanban className="w-8 h-8 mx-auto text-slate-600" />
              <p className="font-medium text-slate-400">No se encontraron categorías</p>
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
                      ? 'bg-indigo-950/70 border-indigo-500 shadow-md shadow-indigo-950/40 text-white'
                      : 'bg-slate-950/50 hover:bg-slate-800/60 border-slate-800/80 text-slate-300'
                  }`}
                >
                  {/* Casilla de verificación (Checkbox) */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm shadow-indigo-950'
                          : 'border-slate-700 bg-slate-900/80 text-transparent hover:border-slate-600'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>

                    <div className="truncate">
                      <div className={`font-semibold text-xs sm:text-sm truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                        {cat.name}
                      </div>
                      {cat.complete_name && cat.complete_name !== cat.name && (
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {cat.complete_name}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                      Marcada
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pie de Acción con Contador Visual en Botón Iniciar Conteo */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-950/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-400 truncate max-w-full sm:max-w-xs">
            {count > 0 ? (
              <span className="text-slate-300 truncate block">
                {count === 1 ? (
                  <>Seleccionada: <strong className="text-indigo-300 font-semibold">{selectedCategoryObjects[0]?.name}</strong></>
                ) : (
                  <>Seleccionadas: <strong className="text-indigo-300 font-semibold">{selectedCategoryObjects.map((c) => c.name).join(', ')}</strong></>
                )}
              </span>
            ) : (
              <span className="text-amber-400/90 font-medium">Marca al menos una categoría para continuar</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto w-full sm:w-auto">
            {onClose && canClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white font-medium text-xs transition cursor-pointer"
                title="Cerrar ventana y auditar todos los productos"
              >
                Saltar
              </button>
            )}
            <button
              type="button"
              disabled={count === 0 || isLoadingCategories}
              onClick={handleStartCount}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition cursor-pointer shadow-lg ${
                count > 0 && !isLoadingCategories
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950 active:scale-95'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
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
