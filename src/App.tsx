import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Barcode,
  Camera,
  Download,
  Send,
  Filter,
  RefreshCw,
  Plus,
  CheckCircle,
  AlertTriangle,
  ArrowUpDown,
  Boxes,
  Layers,
  Sparkles,
  Wifi,
  FileSpreadsheet,
  SlidersHorizontal,
  ChevronDown,
  FolderKanban
} from 'lucide-react';
import {
  OdooConnectionConfig,
  AuditSession,
  QuantItem,
  AuditorPresence,
  RealtimeCountUpdate,
  OdooCategory,
  OdooLocation
} from './types';
import { fetchQuants, fetchCategories, fetchLocations, getDemoFVGrupoData, ensureAuthenticatedUid } from './lib/odoo';
import {
  subscribeToAuditSession,
  broadcastCountUpdate,
  getSavedSupabaseSettings,
  fetchSessionCountsFromSupabase,
  updateSessionCategoryInSupabase
} from './lib/supabase';
import { exportAuditToExcel } from './lib/exportExcel';
import { sound } from './lib/audio';
import { AuthForm } from './components/AuthForm';
import { SessionBar } from './components/SessionBar';
import { ProductCard } from './components/ProductCard';
import { OdooSyncModal } from './components/OdooSyncModal';
import { SyncModal } from './components/SyncModal';
import { ScannerModal } from './components/ScannerModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { CategorySelectionModal } from './components/CategorySelectionModal';

const STORAGE_SESSION_KEY = 'odoo_audit_session_data';
const STORAGE_CONFIG_KEY = 'odoo_audit_config_data';

export default function App() {
  // Estado de Sesión y Configuración Odoo
  const [session, setSession] = useState<AuditSession | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [odooConfig, setOdooConfig] = useState<OdooConnectionConfig | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.proxyUrl === 'https://corsproxy.io/?') {
          parsed.proxyUrl = '/api/odoo-proxy';
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

  // Lista de Productos en Almacén ('stock.quant')
  const [items, setItems] = useState<QuantItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Catálogos auxiliares para filtros en caliente
  const [categories, setCategories] = useState<OdooCategory[]>([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<number | 'all'>('all');
  const [discrepancyFilter, setDiscrepancyFilter] = useState<'all' | 'diff' | 'exact' | 'deficit' | 'surplus'>('all');

  // Estado para selección de categoría obligatoria
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);
  const [isLoadingCategories, setIsLoadingCategories] = useState<boolean>(false);
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);

  // Supabase Realtime y Presencia
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'local_only'>('connecting');
  const [auditors, setAuditors] = useState<AuditorPresence[]>([]);
  const [lastAuditNotification, setLastAuditNotification] = useState<string | null>(null);

  // Búsqueda y Escáner Continuo USB / Bluetooth
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [continuousScanMode, setContinuousScanMode] = useState<boolean>(true);
  const [focusedQuantId, setFocusedQuantId] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modales
  const [showOdooModal, setShowOdooModal] = useState<boolean>(false);
  const [showRealtimeModal, setShowRealtimeModal] = useState<boolean>(false);
  const [showCameraScanner, setShowCameraScanner] = useState<boolean>(false);

  // Guardar sesión en localStorage para mantener al auditor dentro aunque recargue
  useEffect(() => {
    if (session) {
      localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
      localStorage.setItem('odoo_audit_active_pin', session.pin);
      if (session.id) {
        localStorage.setItem('odoo_audit_session_id', session.id);
      }
    } else {
      localStorage.removeItem(STORAGE_SESSION_KEY);
      localStorage.removeItem('odoo_audit_active_pin');
      localStorage.removeItem('odoo_audit_session_id');
    }
  }, [session]);

  useEffect(() => {
    if (odooConfig) {
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(odooConfig));
    }
  }, [odooConfig]);

  // Cargar catálogo de categorías desde Odoo o Demo
  const loadCategoriesOnly = async (cfg: OdooConnectionConfig, isDemo = false) => {
    setIsLoadingCategories(true);
    setCategoryLoadError(null);

    if (isDemo) {
      const demo = getDemoFVGrupoData();
      setCategories(demo.categories);
      setIsLoadingCategories(false);
      return demo.categories;
    }

    try {
      if (!cfg.uid) {
        await ensureAuthenticatedUid(cfg);
      }
      const cats = await fetchCategories(cfg);
      setCategories(cats);
      return cats;
    } catch (err: any) {
      console.error('Error cargando categorías de Odoo:', err);
      setCategoryLoadError(err.message || 'Error al obtener la lista de categorías desde Odoo 17');
      return [];
    } finally {
      setIsLoadingCategories(false);
    }
  };

  // Cargar datos de Odoo o Demo filtrados obligatoriamente por categoría sin truncar a 500
  // y recuperar el estado actual de conteos desde Supabase (SELECT)
  const loadInventoryData = async (
    cfg: OdooConnectionConfig,
    locId?: number,
    isDemo = false,
    catId?: number,
    cachedCounts?: RealtimeCountUpdate[]
  ) => {
    const targetCatId = catId !== undefined ? catId : session?.categoryId;
    setItems([]); // Limpiar la lista anterior obligatoriamente
    setIsLoadingItems(true);
    setLoadError(null);

    const activePin = session?.pin || localStorage.getItem('odoo_audit_active_pin');

    if (isDemo) {
      const demo = getDemoFVGrupoData();
      let filteredQuants = targetCatId
        ? demo.quants.filter((q) => q.categId === targetCatId)
        : demo.quants;

      // Sincronizar conteos guardados en Supabase o pasados inicialmente
      if (activePin) {
        try {
          const remoteCounts = await fetchSessionCountsFromSupabase(activePin);
          const effectiveCounts = remoteCounts.length > 0 ? remoteCounts : (cachedCounts || []);
          if (effectiveCounts.length > 0) {
            const countsMap = new Map(effectiveCounts.map((c) => [c.quantId, c]));
            filteredQuants = filteredQuants.map((item) => {
              const remote = countsMap.get(item.id);
              if (remote) {
                return {
                  ...item,
                  countedQuantity: remote.countedQuantity,
                  difference: remote.countedQuantity - item.quantity,
                  lastAuditedBy: remote.auditorName,
                  lastAuditedAt: remote.timestamp,
                  photoUrl: remote.photoUrl || item.photoUrl,
                  notes: remote.notes || item.notes,
                };
              }
              return item;
            });
          }
        } catch {
          // noop
        }
      }

      setItems(filteredQuants);
      setCategories(demo.categories);
      setIsLoadingItems(false);
      return;
    }

    try {
      if (!cfg.uid) {
        await ensureAuthenticatedUid(cfg);
      }

      // Consulta de 100% de productos filtrados por categ_id sin truncar a 500
      const quantsData = await fetchQuants(cfg, locId, targetCatId);

      // Recuperar el estado actual del inventario y los conteos realizados por otros auditores desde Supabase (SELECT)
      if (activePin) {
        try {
          const remoteCounts = await fetchSessionCountsFromSupabase(activePin);
          const effectiveCounts = remoteCounts.length > 0 ? remoteCounts : (cachedCounts || []);
          if (effectiveCounts && effectiveCounts.length > 0) {
            const countsMap = new Map(effectiveCounts.map((c) => [c.quantId, c]));
            for (const item of quantsData) {
              const remote = countsMap.get(item.id);
              if (remote) {
                item.countedQuantity = remote.countedQuantity;
                item.difference = remote.countedQuantity - item.quantity;
                item.lastAuditedBy = remote.auditorName;
                item.lastAuditedAt = remote.timestamp;
                if (remote.photoUrl) item.photoUrl = remote.photoUrl;
                if (remote.notes) item.notes = remote.notes;
              }
            }
          }
        } catch (supErr) {
          console.warn('Aviso: no se pudieron sincronizar conteos remotos iniciales:', supErr);
        }
      }

      setItems(quantsData);

      if (quantsData.length === 0) {
        setLoadError(
          'Odoo retornó 0 productos para la categoría seleccionada en esta ubicación.'
        );
      }
    } catch (err: any) {
      console.error('Error transparente recibido de Odoo:', err);
      setLoadError(err.message || String(err) || 'Error desconocido al comunicar con Odoo 17');
    } finally {
      setIsLoadingItems(false);
    }
  };

  // Alias para invocaciones explícitas de recarga de productos
  const loadProducts = (
    cfg = odooConfig,
    locId = session?.locationId,
    demo = isDemoMode,
    catId = session?.categoryId
  ) => {
    if (!cfg) return;
    return loadInventoryData(cfg, locId, demo, catId);
  };

  // Efecto para verificar si se requiere selección de categoría o recargar al cambiar ubicación/categoría
  useEffect(() => {
    if (session && odooConfig) {
      if (!session.categoryId) {
        // Flujo obligatorio: abrir modal y NO cargar productos generales
        loadCategoriesOnly(odooConfig, isDemoMode);
        setIsCategoryModalOpen(true);
      } else {
        loadInventoryData(odooConfig, session.locationId, isDemoMode, session.categoryId);
      }
    }
  }, [session?.pin, session?.locationId, session?.categoryId]);

  // Manejador de selección de categoría confirmada
  const handleCategorySelected = (cat: OdooCategory) => {
    if (!session || !odooConfig) return;
    const updatedSession: AuditSession = {
      ...session,
      categoryId: cat.id,
      categoryName: cat.name,
    };
    setSession(updatedSession);
    setIsCategoryModalOpen(false);
    sound.playSuccess();
    // Actualizar categoría en Supabase para sincronizar a otros auditores
    updateSessionCategoryInSupabase(updatedSession.pin, cat.id, cat.name);
    loadInventoryData(odooConfig, updatedSession.locationId, isDemoMode, cat.id);
  };

  // Manejador para cerrar o saltar la selección obligatoria de categoría
  const handleCategoryModalClose = () => {
    setIsCategoryModalOpen(false);
    // Si aún no hay productos cargados en memoria, cargar todos los productos de la ubicación
    if (items.length === 0 && odooConfig && session) {
      loadInventoryData(odooConfig, session.locationId, isDemoMode, undefined);
    }
  };

  // Subscripción Supabase Realtime para la sesión activa
  useEffect(() => {
    if (!session) return;

    const auditorId = `${session.auditorName}_${Math.random().toString(36).substring(2, 7)}`;
    const unsubscribe = subscribeToAuditSession(
      session.pin,
      { id: auditorId, name: session.auditorName },
      (update: RealtimeCountUpdate) => {
        // Actualizar el conteo de la tarjeta de forma reactiva
        setItems((prevItems) => {
          return prevItems.map((item) => {
            if (item.id === update.quantId) {
              const diff = update.countedQuantity - item.quantity;
              return {
                ...item,
                countedQuantity: update.countedQuantity,
                difference: diff,
                lastAuditedBy: update.auditorName,
                lastAuditedAt: update.timestamp,
                photoUrl: update.photoUrl || item.photoUrl,
                notes: update.notes || item.notes,
              };
            }
            return item;
          });
        });

        // Notificación visual de actualización por compañero de equipo
        if (update.auditorName !== session.auditorName) {
          sound.playScan();
          setLastAuditNotification(`${update.auditorName} actualizó Quant #${update.quantId} a ${update.countedQuantity} uds.`);
          setTimeout(() => setLastAuditNotification(null), 3500);
        }
      },
      (newAuditors) => {
        setAuditors(newAuditors);
      },
      (newStatus) => {
        setConnectionStatus(newStatus);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [session?.pin]);

  // Manejo de actualización de conteo local y emisión a Supabase
  const handleUpdateCount = async (quantId: number, newCount: number, photoUrl?: string) => {
    if (!session) return;

    const now = new Date().toISOString();

    // Actualizar estado local inmediatamente para latencia cero en UI
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === quantId) {
          return {
            ...item,
            countedQuantity: newCount,
            difference: newCount - item.quantity,
            lastAuditedBy: session.auditorName,
            lastAuditedAt: now,
            photoUrl: photoUrl !== undefined ? photoUrl : item.photoUrl,
            syncedToOdoo: false,
          };
        }
        return item;
      })
    );

    // Emitir por Supabase Realtime a todos los auditores con el mismo PIN
    const updatePayload: RealtimeCountUpdate = {
      quantId,
      countedQuantity: newCount,
      auditorName: session.auditorName,
      timestamp: now,
      pin: session.pin,
      photoUrl,
    };

    await broadcastCountUpdate(updatePayload);
  };

  // Procesar código escaneado (desde escáner físico USB/Bluetooth o cámara)
  const handleBarcodeScanned = (rawCode: string) => {
    const clean = (rawCode || '').trim();
    if (!clean) return;

    const code = clean.toLowerCase();
    const digitsOnly = code.replace(/\D/g, '');

    // 1. Buscar coincidencia exacta o normalizada (EAN-13, EAN-8, UPC, Code128, Ref Interna)
    let found = items.find((item) => {
      const itemBarcode = (item.barcode || '').trim().toLowerCase();
      const itemDefault = (item.defaultCode || '').trim().toLowerCase();

      // Coincidencia directa por barcode o código interno (Code 128, etc.)
      if (itemBarcode === code || itemDefault === code) return true;

      // Coincidencia numérica flexible (EAN-13, EAN-8, UPC-A, UPC-E)
      const itemDigits = itemBarcode.replace(/\D/g, '');
      if (digitsOnly.length > 0 && itemDigits.length > 0) {
        if (digitsOnly === itemDigits) return true;
        // UPC-A (12 dígitos) vs EAN-13 (13 dígitos con 0 inicial)
        const dNoZeros = digitsOnly.replace(/^0+/, '');
        const iNoZeros = itemDigits.replace(/^0+/, '');
        if (dNoZeros.length >= 6 && dNoZeros === iNoZeros) return true;
        // Relleno a 13 dígitos
        if (digitsOnly.padStart(13, '0') === itemDigits.padStart(13, '0')) return true;
      }

      return false;
    });

    // 2. Coincidencia secundaria si no hubo exacta
    if (!found) {
      found = items.find(
        (item) =>
          (item.barcode && item.barcode.toLowerCase().includes(code)) ||
          (item.defaultCode && item.defaultCode.toLowerCase().includes(code))
      );
    }

    if (found) {
      sound.playCountUp();
      setFocusedQuantId(found.id);

      // Sumar o abrir el conteo de inmediato (+1 a la cantidad contada actual)
      const nextCount = Math.round(((found.countedQuantity || 0) + 1) * 100) / 100;
      handleUpdateCount(found.id, nextCount);

      setSearchQuery('');
      setLastAuditNotification(`✓ ${found.productName} [+1] → Conteo: ${nextCount} uds.`);
      setTimeout(() => setLastAuditNotification(null), 3500);
    } else {
      sound.playError();
      setLastAuditNotification(`⚠️ Código no encontrado: "${rawCode}"`);
      setTimeout(() => setLastAuditNotification(null), 3500);
    }

    // Devolver el foco al input para el siguiente disparo del lector láser
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // Manejador del input de búsqueda / escáner físico: listener para Enter y NumpadEnter
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === 'Enter' ||
      e.code === 'Enter' ||
      e.code === 'NumpadEnter' ||
      (e as any).keyCode === 13
    ) {
      e.preventDefault();
      handleBarcodeScanned(searchQuery);
    }
  };

  // Listener global para capturar disparos de pistolas lectoras Bluetooth / USB en la PWA
  useEffect(() => {
    if (!session) return;
    let barcodeBuffer = '';
    let lastKeyTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');
      if (isInput && target !== searchInputRef.current) {
        return;
      }

      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (barcodeBuffer.trim().length >= 3) {
          e.preventDefault();
          handleBarcodeScanned(barcodeBuffer.trim());
          barcodeBuffer = '';
          return;
        }
      }

      const now = Date.now();
      if (now - lastKeyTime > 150) {
        barcodeBuffer = '';
      }
      lastKeyTime = now;

      if (e.key.length === 1) {
        barcodeBuffer += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [items, session]);

  // Exportar reporte a Excel (.xlsx)
  const handleExportExcel = () => {
    if (!session) return;
    try {
      sound.playScan();
      exportAuditToExcel(
        items,
        session.locationName,
        session.companyName,
        session.pin
      );
      setLastAuditNotification('✓ Reporte Excel descargado correctamente');
      setTimeout(() => setLastAuditNotification(null), 3000);
    } catch (err: any) {
      sound.playError();
      setLastAuditNotification(`⚠️ ${err.message || 'Error al exportar Excel'}`);
      setTimeout(() => setLastAuditNotification(null), 3500);
    }
  };

  // Función para cerrar sesión / volver a pantalla de selección y login
  const handleLogout = () => {
    sound.playScan();
    // Limpiar estados activos de la sesión actual
    setSession(null);
    setItems([]);
    setSearchQuery('');
    setFocusedQuantId(null);
    setSelectedCategoryFilter('all');
    setDiscrepancyFilter('all');
    localStorage.removeItem(STORAGE_SESSION_KEY);
  };

  // Categorías deduplicadas para los botones de filtrado
  const deduplicatedCategories = useMemo(() => {
    const seenNames = new Set<string>();
    const seenIds = new Set<number>();
    const list: OdooCategory[] = [];
    for (const cat of categories) {
      if (!cat || typeof cat.id !== 'number') continue;
      const key = (cat.complete_name || cat.name || '').trim().toLowerCase();
      if (seenIds.has(cat.id) || (key && seenNames.has(key))) continue;
      seenIds.add(cat.id);
      if (key) seenNames.add(key);
      list.push(cat);
    }
    return list;
  }, [categories]);

  // Filtros aplicados a los productos
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Filtro de búsqueda por texto o código
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          item.productName.toLowerCase().includes(q) ||
          item.defaultCode.toLowerCase().includes(q) ||
          item.barcode.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Filtro por categoría
      if (selectedCategoryFilter !== 'all') {
        if (item.categId !== selectedCategoryFilter) return false;
      }

      // Filtro por discrepancia
      if (discrepancyFilter === 'diff' && item.difference === 0) return false;
      if (discrepancyFilter === 'exact' && item.difference !== 0) return false;
      if (discrepancyFilter === 'deficit' && item.difference >= 0) return false;
      if (discrepancyFilter === 'surplus' && item.difference <= 0) return false;

      return true;
    });
  }, [items, searchQuery, selectedCategoryFilter, discrepancyFilter]);

  // Resumen de estadísticas
  const totalAuditedCount = items.filter((i) => i.lastAuditedAt).length;
  const countWithDiff = items.filter((i) => i.difference !== 0).length;

  // Si no hay sesión iniciada, mostrar el formulario de acceso
  if (!session || !odooConfig) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
        <AuthForm
          onSessionStarted={(newSession, config, isDemo, initialCounts) => {
            setIsDemoMode(isDemo);
            setOdooConfig(config);
            setSession(newSession);
            setItems([]); // Limpiar la lista anterior explícitamente

            // Si la sesión ya tiene categoría configurada en Supabase (ej. creada previamente por el Lead)
            // cargar directamente el inventario con los conteos de otros auditores
            if (newSession.categoryId) {
              loadInventoryData(config, newSession.locationId, isDemo, newSession.categoryId, initialCounts);
            } else {
              // Si aún no tiene categoría, abrir el modal obligatorio de selección
              loadCategoriesOnly(config, isDemo);
              setIsCategoryModalOpen(true);
            }
          }}
          savedConfig={odooConfig || undefined}
        />
        <footer className="py-4 text-center text-xs text-slate-500 border-t border-slate-900">
          Odoo 17 JSON-RPC Strict • Multicompañía • Supabase Realtime • PWA Offline Ready
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col pb-24 selection:bg-indigo-500 selection:text-white">
      {/* 1. BARRA SUPERIOR FIJA DE SESIÓN (PIN, Estado WebSocket, Auditores en Vivo) */}
      <SessionBar
        session={session}
        connectionStatus={connectionStatus}
        auditors={auditors}
        onLogout={handleLogout}
        onLeaveSession={handleLogout}
        onOpenSyncModal={() => setShowRealtimeModal(true)}
        onOpenOdooModal={() => setShowOdooModal(true)}
      />

      {/* Banner de notificación en vivo cuando otro auditor hace un conteo */}
      {lastAuditNotification && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-2xl shadow-indigo-950/80 animate-in fade-in slide-in-from-top-2 border border-indigo-400/40">
          {lastAuditNotification}
        </div>
      )}

      {/* 2. ZONA PRINCIPAL DE BÚSQUEDA Y ESCANEO RÁPIDO */}
      <main className="max-w-5xl w-full mx-auto px-3.5 pt-3.5 space-y-3.5">
        {/* Banner de Categoría Obligatoria Activa y Botón de Cambio */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 text-xs shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-600/30 border border-indigo-500/40 text-indigo-400 shrink-0">
              <FolderKanban className="w-4 h-4" />
            </div>
            <div className="min-w-0 truncate">
              <span className="text-[11px] text-slate-400 block font-medium">Área de Auditoría Asignada:</span>
              <strong className="text-white text-xs sm:text-sm font-bold truncate block">
                {session.categoryName || 'Selecciona una categoría para comenzar'}
              </strong>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              loadCategoriesOnly(odooConfig, isDemoMode);
              setIsCategoryModalOpen(true);
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-indigo-300 hover:text-white font-medium text-xs transition cursor-pointer active:scale-95 shrink-0 self-end sm:self-auto"
            title="Cambiar categoría de auditoría"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Cambiar Área</span>
          </button>
        </div>

        {/* Barra de Búsqueda y Escáner Láser con Autofocus Constante */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Escanear código de barras o buscar producto..."
              autoFocus
              className="w-full pl-10 pr-24 py-2.5 rounded-2xl bg-slate-900 border border-slate-700/80 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium text-white placeholder-slate-500 outline-none shadow-md shadow-slate-950"
            />
            {/* Indicador de modo escáner rápido */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="p-1 rounded-md text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              )}
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-indigo-300 border border-slate-700">
                Enter = +1
              </span>
            </div>
          </div>

          {/* Botón de Cámara para Escaneo en Vivo */}
          <button
            type="button"
            onClick={() => setShowCameraScanner(true)}
            className="flex items-center justify-center p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-300 hover:text-white shadow-md transition active:scale-95 cursor-pointer"
            title="Abrir cámara del dispositivo para escanear código"
          >
            <Camera className="w-5 h-5" />
          </button>
        </div>

        {/* 3. FILTROS Y ESTADÍSTICAS RÁPIDAS */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-xs">
          {/* Métricas rápidas */}
          <div className="flex items-center gap-3 text-slate-300">
            <span className="font-semibold">
              Total: <strong className="text-white">{items.length}</strong>
            </span>
            <span>•</span>
            <span className="text-indigo-300">
              Auditados: <strong>{totalAuditedCount}</strong>
            </span>
            <span>•</span>
            <span className={countWithDiff > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
              Diferencias: <strong>{countWithDiff}</strong>
            </span>
          </div>

          {/* Filtro por estado de discrepancia */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setDiscrepancyFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                discrepancyFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setDiscrepancyFilter('diff')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                discrepancyFilter === 'diff'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              Con Dif.
            </button>
            <button
              onClick={() => setDiscrepancyFilter('deficit')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                discrepancyFilter === 'deficit'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              Faltantes
            </button>
            <button
              onClick={() => setDiscrepancyFilter('surplus')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                discrepancyFilter === 'surplus'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              Sobrantes
            </button>
          </div>
        </div>

        {/* Filtro por Categorías de Producto si hay varias */}
        {deduplicatedCategories.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
            <button
              onClick={() => setSelectedCategoryFilter('all')}
              className={`px-3 py-1.5 rounded-xl font-medium shrink-0 transition cursor-pointer border ${
                selectedCategoryFilter === 'all'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              Todas las Categorías ({items.length})
            </button>
            {deduplicatedCategories.map((cat) => {
              const countInCat = items.filter((i) => i.categId === cat.id).length;
              if (countInCat === 0) return null;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryFilter(cat.id)}
                  className={`px-3 py-1.5 rounded-xl font-medium shrink-0 transition cursor-pointer border ${
                    selectedCategoryFilter === cat.id
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {cat.name} ({countInCat})
                </button>
              );
            })}
          </div>
        )}

        {/* Indicador de Carga */}
        {isLoadingItems && (
          <div className="py-16 text-center space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto" />
            <p className="text-sm font-medium text-slate-300">
              Extrayendo productos desde Odoo 17 (stock.quant)...
            </p>
          </div>
        )}

        {/* Mensaje de Error de Carga Transparente */}
        {loadError && !isLoadingItems && (
          <div className="p-4 rounded-2xl bg-rose-950/80 border border-rose-600 text-rose-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl shadow-rose-950/60">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="block text-rose-100 font-bold mb-0.5">Respuesta de Odoo:</strong>
                <span className="font-mono text-[11px] leading-relaxed break-words">{loadError}</span>
              </div>
            </div>
            <button
              onClick={() => loadProducts(odooConfig, session.locationId, isDemoMode)}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer shrink-0 transition active:scale-95 text-center self-end sm:self-auto"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* 4. LISTADO DE PRODUCTOS EN MODO OSCURO ADAPTADO A MÓVILES */}
        {!isLoadingItems && filteredItems.length === 0 && (
          <div className="py-16 text-center rounded-2xl border border-dashed border-slate-800 p-8 space-y-2">
            <Boxes className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-slate-300">No se encontraron productos</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Prueba cambiando el criterio de búsqueda o seleccionando otra ubicación/categoría.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredItems.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              onUpdateCount={handleUpdateCount}
              isFocused={focusedQuantId === item.id}
            />
          ))}
        </div>
      </main>

      {/* 5. BARRA INFERIOR FIJA FLOTANTE PARA ACCIONES PRINCIPALES (Enviar a Odoo + Exportar Excel) */}
      <footer className="fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 px-4 py-2.5 shadow-2xl">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          {/* Botón Exportar a Excel (.xlsx) */}
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold shadow-md transition active:scale-95 cursor-pointer"
            title="Descargar reporte en formato Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Exportar Excel (.xlsx)</span>
            <span className="sm:hidden">Excel</span>
          </button>

          {/* Botón Principal: Enviar Ajuste a Odoo 17 */}
          <button
            type="button"
            onClick={() => setShowOdooModal(true)}
            className="flex-1 max-w-sm flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs sm:text-sm shadow-xl shadow-indigo-950 transition active:scale-95 cursor-pointer"
            title="Escribe únicamente en inventory_quantity de stock.quant"
          >
            <Send className="w-4 h-4" />
            <span>Enviar Ajuste a Odoo ({countWithDiff} dif.)</span>
          </button>
        </div>
      </footer>

      {/* 6. MODALES */}
      {/* Modal para Enviar a Odoo con Resumen y Garantía de Integridad */}
      <OdooSyncModal
        isOpen={showOdooModal}
        onClose={() => setShowOdooModal(false)}
        items={items}
        odooConfig={odooConfig}
        isDemo={isDemoMode}
        onSuccess={(updatedIds) => {
          setItems((prev) =>
            prev.map((i) =>
              updatedIds.includes(i.id) ? { ...i, syncedToOdoo: true } : i
            )
          );
        }}
      />

      {/* Modal de Supabase Realtime & Configuración */}
      <SyncModal
        isOpen={showRealtimeModal}
        onClose={() => setShowRealtimeModal(false)}
        pin={session.pin}
        connectionStatus={connectionStatus}
        onReconnect={() => {
          // Reactivar suscripción
          setConnectionStatus('connecting');
        }}
      />

      {/* Modal de Cámara para Escaneo en Vivo */}
      <ScannerModal
        isOpen={showCameraScanner}
        onClose={() => setShowCameraScanner(false)}
        onBarcodeDetected={handleBarcodeScanned}
      />

      {/* Modal Obligatorio de Selección de Categoría */}
      <CategorySelectionModal
        isOpen={isCategoryModalOpen}
        categories={categories}
        isLoadingCategories={isLoadingCategories}
        loadError={categoryLoadError}
        auditorName={session.auditorName}
        sessionPin={session.pin}
        locationName={session.locationName}
        canClose={true}
        onSelectCategory={handleCategorySelected}
        onClose={handleCategoryModalClose}
        onRetryLoadCategories={() => loadCategoriesOnly(odooConfig, isDemoMode)}
      />
    </div>
  );
}
