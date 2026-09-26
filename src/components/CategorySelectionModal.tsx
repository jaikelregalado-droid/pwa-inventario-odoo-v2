import React, { useState, useMemo } from 'react';
import {
  FolderKanban,
  Search,
  Play,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  User,
  MapPin,
  Key,
  X
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
  canClose?: boolean;
  onSelectCategory: (category: OdooCategory) => void;
  onClose?: () => void;
  onRetryLoadCategories?: () => void;
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
  canClose = false,
  onSelectCategory,
  onClose,
  onRetryLoadCategories,
}) => {
  const [selectedCatId, setSelectedCatId] = useState<number | null>(currentCategoryId || null);
  const [search, setSearch] = useState('');

  // Sincronizar selección inicial
  React.useEffect(() => {
    if (currentCategoryId) {
      setSelectedCatId(currentCategoryId);
    }
  }, [currentCategoryId]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase().trim();
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.complete_name && c.complete_name.toLowerCase().includes(q))
    );
  }, [categories, search]);

  const selectedCategoryObj = useMemo(() => {
    return categories.find((c) => c.id === selectedCatId) || null;
  }, [categories, selectedCatId]);

  if (!isOpen) return null;

  const handleStartCount = () => {
    if (selectedCategoryObj) {
      onSelectCategory(selectedCategoryObj);
    }
  };

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
                Selección de Categoría Obligatoria
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Selecciona el área de productos en la que vas a trabajar. Solo se cargarán los productos de esta categoría.
              </p>
            </div>
          </div>
          {canClose && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Resumen de Sesión Activa */}
        <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1 text-slate-300 font-medium">
            <User className="w-3.5 h-3.5 text-indigo-400" />
            {auditorName}
          </span>
          <span className="flex items-center gap-1 font-mono text-indigo-300">
            <Key className="w-3.5 h-3.5 text-indigo-400" />
            PIN: {sessionPin}
          </span>
          <span className="flex items-center gap-1 truncate max-w-[200px]" title={locationName}>
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{locationName}</span>
          </span>
        </div>

        {/* Buscador de Categorías */}
        <div className="p-3.5 border-b border-slate-800 bg-slate-900/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar categoría de producto..."
              autoFocus
              className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs sm:text-sm text-white placeholder-slate-500 outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Lista de Categorías con scroll */}
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
              const isSelected = selectedCatId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCatId(cat.id)}
                  className={`w-full text-left p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-indigo-950/70 border-indigo-500 shadow-md shadow-indigo-950/40 text-white'
                      : 'bg-slate-950/50 hover:bg-slate-800/60 border-slate-800/80 text-slate-300'
                  }`}
                >
                  <div className="truncate">
                    <div className="font-semibold text-xs sm:text-sm text-white truncate">
                      {cat.name}
                    </div>
                    {cat.complete_name && cat.complete_name !== cat.name && (
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {cat.complete_name}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isSelected ? (
                      <CheckCircle2 className="w-5 h-5 text-indigo-400" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-slate-700 bg-slate-900" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Pie de Acción con Botón Iniciar Conteo */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400 truncate max-w-[220px] sm:max-w-xs">
            {selectedCategoryObj ? (
              <span className="text-slate-300">
                Seleccionada: <strong className="text-indigo-300 font-semibold">{selectedCategoryObj.name}</strong>
              </span>
            ) : (
              <span className="text-amber-400/90 font-medium">Debes elegir una categoría para continuar</span>
            )}
          </div>

          <button
            type="button"
            disabled={!selectedCatId || isLoadingCategories}
            onClick={handleStartCount}
            className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition cursor-pointer shadow-lg shrink-0 ${
              selectedCatId && !isLoadingCategories
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950 active:scale-95'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
            }`}
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Iniciar Conteo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
