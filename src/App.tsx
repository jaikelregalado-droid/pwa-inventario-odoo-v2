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
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ArrowUpDown,
  ArrowUp,
  Boxes,
  Layers,
  Sparkles,
  Wifi,
  WifiOff,
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
import {
  fetchQuants,
  fetchCategories,
  fetchLocations,
  getDemoFVGrupoData,
  ensureAuthenticatedUid,
  lookupGlobalProductInOdoo
} from './lib/odoo';
import {
  subscribeToAuditSession,
  broadcastCountUpdate,
  getSavedSupabaseSettings,
  fetchSessionCountsFromSupabase,
  updateSessionCategoryInSupabase,
  updateSessionCategoriesInSupabase,
  saveAuditItemsToSupabase
} from './lib/supabase';
import { exportAuditToExcel } from './lib/exportExcel';
import { sound } from './lib/audio';
import {
  saveOfflineCatalog,
  loadOfflineCatalog,
  queuePendingCount,
  getPendingCounts,
  syncPendingCounts,
} from './lib/offlineSync';
import { AuthForm } from './components/AuthForm';
import { SessionBar } from './components/SessionBar';
import { ProductCard } from './components/ProductCard';
import { OdooSyncModal } from './components/OdooSyncModal';
import { ProductOtherLocationModal } from './components/ProductOtherLocationModal';
import { SyncModal } from './components/SyncModal';
import { ScannerModal } from './components/ScannerModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { CategorySelectionModal } from './components/CategorySelectionModal';
import { CustomInventoryModal } from './components/CustomInventoryModal';

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

  // Botón flotante Volver Arriba (Scroll to top > 300px)
  const [showScrollTop, setShowScrollTop] = useState<boolean>(false);

  // Modo Offline y cola de sincronización automática
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Retroalimentación visual y alertas del escáner con código de colores (Verde Éxito / Rojo Error)
  const [scannerAlert, setScannerAlert] = useState<{
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    id: number;
  } | null>(null);

  // Apertura directa del modal de lote tras escaneo (sin autoincremento +1)
  const [autoOpenBatchQuantId, setAutoOpenBatchQuantId] = useState<number | null>(null);

  // Modal para productos detectados en otras ubicaciones / departamentos
  const [otherLocationModalData, setOtherLocationModalData] = useState<{
    product: any;
    locations: Array<{ quantId: number; locationId: number; locationName: string; quantity: number }>;
  } | null>(null);

  // Búsqueda y Escáner Continuo USB / Bluetooth
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [continuousScanMode, setContinuousScanMode] = useState<boolean>(true);
  const [focusedQuantId, setFocusedQuantId] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modales
  const [showOdooModal, setShowOdooModal] = useState<boolean>(false);
  const [showRealtimeModal, setShowRealtimeModal] = useState<boolean>(false);
  const [showCameraScanner, setShowCameraScanner] = useState<boolean>(false);
  const [showCustomInventoryModal, setShowCustomInventoryModal] = useState<boolean>(false);

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

  // 1. REQUISITO: Botón flotante 'Volver Arriba' (> 300px)
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 2. REQUISITO: Escuchar conectividad de red y re-sincronizar automáticamente hacia Supabase
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      triggerAutoResync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cargar conteos pendientes previos al inicializar la sesión
    if (session?.pin) {
      const pending = getPendingCounts(session.pin);
      setPendingSyncCount(pending.length);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [session?.pin]);

  // 3. REQUISITO: Guardar catálogo cargado y estados de conteo en LocalStorage para contingencia offline
  useEffect(() => {
    if (session?.pin && items.length > 0) {
      saveOfflineCatalog(session.pin, items);
    }
  }, [items, session?.pin]);

  // Temporizador para auto-descartar alertas del escáner
  useEffect(() => {
    if (!scannerAlert) return;
    const timeout = scannerAlert.type === 'error' || scannerAlert.type === 'warning' ? 5000 : 3500;
    const timer = setTimeout(() => {
      setScannerAlert(null);
    }, timeout);
    return () => clearTimeout(timer);
  }, [scannerAlert?.id]);

  // Ejecución de sincronización automática de conteos pendientes al recuperar conexión
  const triggerAutoResync = async () => {
    if (!session?.pin || !navigator.onLine) return;
    const currentQueue = getPendingCounts(session.pin);
    if (currentQueue.length === 0) {
      setPendingSyncCount(0);
      return;
    }

    const { synced, failed } = await syncPendingCounts(session.pin, (remaining) => {
      setPendingSyncCount(remaining);
    });

    setPendingSyncCount(failed);

    if (synced > 0) {
      sound.playSuccess();
      setScannerAlert({
        message: `✓ Sincronizados ${synced} conteo(s) pendiente(s) con Supabase`,
        type: 'success',
        id: Date.now(),
      });
    }
  };

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

  // Cargar datos de Odoo o Demo filtrados obligatoriamente por categorías sin truncar a 500
  // y recuperar el estado actual de conteos desde Supabase (SELECT)
  const loadInventoryData = async (
    cfg: OdooConnectionConfig,
    locId?: number,
    isDemo = false,
    catId?: number | number[],
    cachedCounts?: RealtimeCountUpdate[]
  ) => {
    const targetCatIds: number[] = Array.isArray(catId)
      ? catId
      : (typeof catId === 'number' && catId > 0
          ? [catId]
          : (session?.categoryIds && session.categoryIds.length > 0
              ? session.categoryIds
              : (session?.categoryId ? [session.categoryId] : [])));

    // REQUISITO 1: Restablecer filtro de categoría a 'all' (Todas las Categorías) por defecto
    setSelectedCategoryFilter('all');
    setItems([]); // Limpiar la lista anterior obligatoriamente
    setIsLoadingItems(true);
    setLoadError(null);

    const activePin = session?.pin || localStorage.getItem('odoo_audit_active_pin');

    // REQUISITO: Verificar si la sesión activa corresponde a un Inventario Personalizado Multi-Departamento
    if (activePin) {
      const customRaw = localStorage.getItem(`odoo_audit_custom_inventory_${activePin}`);
      if (customRaw) {
        try {
          const parsedCustom = JSON.parse(customRaw);
          if (Array.isArray(parsedCustom) && parsedCustom.length > 0) {
            setItems(parsedCustom);
            setIsLoadingItems(false);
            return;
          }
        } catch {}
      }
    }

    // REQUISITO: Si estamos offline y hay datos guardados localmente, cargar catálogo de inmediato
    if (!navigator.onLine && activePin) {
      const cachedOffline = loadOfflineCatalog(activePin);
      if (cachedOffline && cachedOffline.length > 0) {
        setItems(cachedOffline);
        setIsLoadingItems(false);
        setScannerAlert({
          message: 'Modo Offline: trabajando con catálogo guardado en este dispositivo',
          type: 'info',
          id: Date.now(),
        });
        return;
      }
    }

    if (isDemo) {
      const demo = getDemoFVGrupoData();
      let filteredQuants = targetCatIds.length > 0
        ? demo.quants.filter((q) => q.categId && targetCatIds.includes(q.categId))
        : demo.quants;

      // Sincronizar conteos guardados en Supabase o pasados inicialmente
      if (activePin) {
        try {
          const remoteCounts = await fetchSessionCountsFromSupabase(activePin);
          const effectiveCounts = remoteCounts.length > 0 ? remoteCounts : (cachedCounts || []);
          if (effectiveCounts.length > 0) {
            const productCountsMap = new Map<number, RealtimeCountUpdate>();
            const quantCountsMap = new Map<number, RealtimeCountUpdate>();
            for (const c of effectiveCounts) {
              if (c.productId) productCountsMap.set(c.productId, c);
              if (c.quantId) quantCountsMap.set(c.quantId, c);
            }

            filteredQuants = filteredQuants.map((item) => {
              const remote = (item.productId && productCountsMap.get(item.productId)) || quantCountsMap.get(item.id);
              if (remote) {
                const isLocked = Boolean(remote.isLocked);
                const effectiveSysQty = (isLocked && remote.systemQuantity !== undefined && remote.systemQuantity !== null)
                  ? remote.systemQuantity
                  : item.quantity;
                return {
                  ...item,
                  quantity: effectiveSysQty,
                  countedQuantity: remote.countedQuantity,
                  difference: remote.countedQuantity - effectiveSysQty,
                  isLocked,
                  countHistory: remote.countHistory !== undefined ? remote.countHistory : item.countHistory,
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
      if (activePin && filteredQuants.length > 0) {
        try {
          await saveAuditItemsToSupabase(activePin, filteredQuants, session?.auditorName);
        } catch (saveErr) {
          console.warn('Aviso guardando lote demo en audit_items de Supabase:', saveErr);
        }
        saveOfflineCatalog(activePin, filteredQuants);
      }
      setIsLoadingItems(false);
      return;
    }

    try {
      if (!cfg.uid) {
        await ensureAuthenticatedUid(cfg);
      }

      // Consulta de 100% de productos filtrados por categ_id con operador 'in' sin truncar a 500
      const quantsData = await fetchQuants(cfg, locId, targetCatIds);

      // Si habían productos inmovilizados (is_locked) en la sesión actual, proteger su QS
      if (items.length > 0) {
        const lockedMap = new Map<number, number>();
        for (const it of items) {
          if (it.isLocked) {
            lockedMap.set(it.productId, it.quantity);
          }
        }
        for (const item of quantsData) {
          if (lockedMap.has(item.productId)) {
            item.isLocked = true;
            item.quantity = lockedMap.get(item.productId)!;
            item.difference = item.countedQuantity - item.quantity;
          }
        }
      }

      // Recuperar el estado actual del inventario y los conteos realizados desde Supabase (SELECT a audit_items)
      if (activePin) {
        try {
          const remoteCounts = await fetchSessionCountsFromSupabase(activePin);
          const effectiveCounts = remoteCounts.length > 0 ? remoteCounts : (cachedCounts || []);
          if (effectiveCounts && effectiveCounts.length > 0) {
            const productCountsMap = new Map<number, RealtimeCountUpdate>();
            const quantCountsMap = new Map<number, RealtimeCountUpdate>();
            for (const c of effectiveCounts) {
              if (c.productId) productCountsMap.set(c.productId, c);
              if (c.quantId) quantCountsMap.set(c.quantId, c);
            }

            for (const item of quantsData) {
              const remote = (item.productId && productCountsMap.get(item.productId)) || quantCountsMap.get(item.id);
              if (remote) {
                item.countedQuantity = remote.countedQuantity;
                if (remote.isLocked) {
                  item.isLocked = true;
                  // Si el producto está inmovilizado, mantener la cantidad del sistema protegida
                  if (remote.systemQuantity !== undefined && remote.systemQuantity !== null) {
                    item.quantity = remote.systemQuantity;
                  }
                }
                item.difference = remote.countedQuantity - item.quantity;
                if (remote.countHistory) item.countHistory = remote.countHistory;
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

      // REQUISITO: Carga e inserta automáticamente todos los productos pertenecientes a esas categorías combinadas
      // dentro de la tabla 'audit_items' en Supabase bajo el mismo PIN de auditoría.
      if (activePin && quantsData.length > 0) {
        try {
          await saveAuditItemsToSupabase(activePin, quantsData, session?.auditorName);
        } catch (saveErr) {
          console.warn('Aviso guardando lote de productos en audit_items de Supabase:', saveErr);
        }
        // Persistir en almacenamiento local para modo offline
        saveOfflineCatalog(activePin, quantsData);
      }

      if (quantsData.length === 0) {
        setLoadError(
          'Odoo retornó 0 productos para la categoría seleccionada en esta ubicación.'
        );
      }
    } catch (err: any) {
      console.error('Error transparente recibido de Odoo:', err);
      // REQUISITO: Si falla la conexión a Odoo pero tenemos el catálogo guardado localmente, usarlo
      if (activePin) {
        const cachedOffline = loadOfflineCatalog(activePin);
        if (cachedOffline && cachedOffline.length > 0) {
          setItems(cachedOffline);
          setLoadError(null);
          setScannerAlert({
            message: 'Modo Offline: operando con catálogo en almacenamiento local',
            type: 'warning',
            id: Date.now(),
          });
          return;
        }
      }
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
    catId: number | number[] | undefined = (session?.categoryIds && session.categoryIds.length > 0)
      ? session.categoryIds
      : session?.categoryId
  ) => {
    if (!cfg) return;
    return loadInventoryData(cfg, locId, demo, catId);
  };

  // Efecto para verificar si se requiere selección de categoría o recargar al cambiar ubicación/categoría
  useEffect(() => {
    if (session && odooConfig) {
      const hasCategories = Boolean(
        (session.categoryIds && session.categoryIds.length > 0) || session.categoryId
      );
      if (!hasCategories) {
        // Flujo obligatorio: abrir modal y NO cargar productos generales
        loadCategoriesOnly(odooConfig, isDemoMode);
        setIsCategoryModalOpen(true);
      } else {
        const catFilter = session.categoryIds && session.categoryIds.length > 0
          ? session.categoryIds
          : session.categoryId;
        loadInventoryData(odooConfig, session.locationId, isDemoMode, catFilter);
      }
    }
  }, [
    session?.pin,
    session?.locationId,
    session?.categoryId,
    session?.categoryIds ? session.categoryIds.join(',') : '',
  ]);

  // Manejador de selección múltiple de categorías confirmada
  const handleCategoriesSelected = async (selectedCats: OdooCategory[]) => {
    if (!session || !odooConfig || selectedCats.length === 0) return;

    const selectedCatIds = selectedCats.map((c) => c.id);
    const combinedCategoryName = selectedCats.map((c) => c.name).join(', ');

    // REQUISITO 1: Restablecer filtro de categoría a 'all' (Todas las Categorías) por defecto
    setSelectedCategoryFilter('all');

    const updatedSession: AuditSession = {
      ...session,
      categoryId: selectedCatIds[0],
      categoryIds: selectedCatIds,
      categoryName: combinedCategoryName,
      categoryNames: selectedCats.map((c) => c.name),
    };

    setSession(updatedSession);
    setIsCategoryModalOpen(false);
    sound.playSuccess();

    // Actualizar categorías en Supabase para sincronizar a otros auditores
    updateSessionCategoriesInSupabase(updatedSession.pin, selectedCatIds, combinedCategoryName);

    // Cargar e insertar automáticamente todos los productos pertenecientes a esas categorías
    await loadInventoryData(odooConfig, updatedSession.locationId, isDemoMode, selectedCatIds);

    setScannerAlert({
      message: `✓ Categorías asignadas: ${combinedCategoryName}`,
      type: 'success',
      id: Date.now(),
    });
  };

  // Manejador de selección de categoría única (compatibilidad)
  const handleCategorySelected = (cat: OdooCategory) => {
    handleCategoriesSelected([cat]);
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
            const matches = item.id === update.quantId || (update.productId && item.productId === update.productId);
            if (matches) {
              const newLocked = update.isLocked !== undefined ? update.isLocked : (item.isLocked ?? false);
              const effectiveQty = (newLocked && update.systemQuantity !== undefined && update.systemQuantity !== null)
                ? update.systemQuantity
                : item.quantity;
              const diff = update.countedQuantity - effectiveQty;
              return {
                ...item,
                quantity: effectiveQty,
                countedQuantity: update.countedQuantity,
                difference: diff,
                isLocked: newLocked,
                lastAuditedBy: update.auditorName,
                lastAuditedAt: update.timestamp,
                photoUrl: update.photoUrl !== undefined ? update.photoUrl : item.photoUrl,
                notes: update.notes !== undefined ? update.notes : item.notes,
                countHistory: update.countHistory !== undefined ? update.countHistory : item.countHistory,
              };
            }
            return item;
          });
        });

        // Notificación visual de actualización por compañero de equipo
        if (update.auditorName !== session.auditorName) {
          sound.playScan();
          setLastAuditNotification(`${update.auditorName} actualizó ${update.productName ? `"${update.productName}"` : `Quant #${update.quantId}`} a ${update.countedQuantity} uds.${update.isLocked ? ' 🔒' : ''}`);
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

  // Manejo de actualización de conteo local, persistencia offline y emisión a Supabase
  const handleUpdateCount = async (
    quantId: number,
    newCount: number,
    photoUrl?: string,
    newHistory?: number[]
  ) => {
    if (!session) return;

    const now = new Date().toISOString();
    const targetItem = items.find((it) => it.id === quantId);
    const cleanCount = Math.round(newCount * 1000) / 1000;
    const effectiveHistory = newHistory !== undefined ? newHistory : targetItem?.countHistory;

    // Actualizar estado local inmediatamente para latencia cero en UI
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === quantId) {
          return {
            ...item,
            countedQuantity: cleanCount,
            difference: Math.round((cleanCount - item.quantity) * 1000) / 1000,
            countHistory: effectiveHistory,
            lastAuditedBy: session.auditorName,
            lastAuditedAt: now,
            photoUrl: photoUrl !== undefined ? photoUrl : item.photoUrl,
            syncedToOdoo: false,
          };
        }
        return item;
      })
    );

    // Emitir por Supabase Realtime a todos los auditores con el mismo PIN y persistir en audit_items con (pin, product_id)
    const updatePayload: RealtimeCountUpdate = {
      quantId,
      productId: targetItem?.productId,
      productName: targetItem?.productName,
      barcode: targetItem?.barcode,
      countedQuantity: cleanCount,
      systemQuantity: targetItem?.quantity,
      isLocked: targetItem?.isLocked ?? false,
      auditorName: session.auditorName,
      timestamp: now,
      pin: session.pin,
      photoUrl,
      countHistory: effectiveHistory,
    };

    // Si estamos offline, encolar en LocalStorage para sincronización automática
    if (!navigator.onLine) {
      const qLen = queuePendingCount(session.pin, updatePayload);
      setPendingSyncCount(qLen);
      return;
    }

    try {
      const res = await broadcastCountUpdate(updatePayload);
      if (!res.success) {
        const qLen = queuePendingCount(session.pin, updatePayload);
        setPendingSyncCount(qLen);
      }
    } catch {
      const qLen = queuePendingCount(session.pin, updatePayload);
      setPendingSyncCount(qLen);
    }
  };

  // Alternar candado de inmovilización / bloqueo de producto
  const handleToggleLock = async (quantId: number) => {
    if (!session) return;
    const targetItem = items.find((it) => it.id === quantId);
    if (!targetItem) return;

    const nextLocked = !targetItem.isLocked;
    const now = new Date().toISOString();

    setItems((prev) =>
      prev.map((item) => {
        if (item.id === quantId) {
          return {
            ...item,
            isLocked: nextLocked,
            lastAuditedAt: now,
          };
        }
        return item;
      })
    );

    if (nextLocked) {
      sound.playSuccess();
      setLastAuditNotification(`🔒 "${targetItem.productName}" inmovilizado (QS = ${targetItem.quantity} congelado).`);
    } else {
      sound.playCountDown();
      setLastAuditNotification(`🔓 "${targetItem.productName}" desbloqueado.`);
    }
    setTimeout(() => setLastAuditNotification(null), 3000);

    // Guardar y sincronizar en tiempo real el estado 'is_locked' en Supabase dentro de la tabla 'audit_items'
    const updatePayload: RealtimeCountUpdate = {
      quantId: targetItem.id,
      productId: targetItem.productId,
      productName: targetItem.productName,
      barcode: targetItem.barcode,
      countedQuantity: targetItem.countedQuantity,
      systemQuantity: targetItem.quantity,
      isLocked: nextLocked,
      auditorName: session.auditorName,
      timestamp: now,
      pin: session.pin,
      photoUrl: targetItem.photoUrl,
      notes: targetItem.notes,
      countHistory: targetItem.countHistory,
    };

    if (!navigator.onLine) {
      const qLen = queuePendingCount(session.pin, updatePayload);
      setPendingSyncCount(qLen);
      return;
    }

    try {
      const res = await broadcastCountUpdate(updatePayload);
      if (!res.success) {
        const qLen = queuePendingCount(session.pin, updatePayload);
        setPendingSyncCount(qLen);
      }
    } catch {
      const qLen = queuePendingCount(session.pin, updatePayload);
      setPendingSyncCount(qLen);
    }
  };

  // Procesar código escaneado (desde escáner físico USB/Bluetooth o cámara)
  const handleBarcodeScanned = async (rawCode: string) => {
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

    // 4. REQUISITO: ESCÁNER CON ENFOQUE DIRECTO (SIN AUTOINCREMENTO +1)
    if (found) {
      sound.playScan();
      setFocusedQuantId(found.id);
      setAutoOpenBatchQuantId(found.id);
      setSearchQuery('');

      // 6. REQUISITO: RETROALIMENTACIÓN VISUAL VERDE PARA ÉXITO
      setScannerAlert({
        message: `✓ Encontrado: "${found.productName}" (Ingresa la cantidad contada)`,
        type: 'success',
        id: Date.now(),
      });

      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
      return;
    }

    // 5. REQUISITO: DETECCIÓN DE PRODUCTOS EN OTROS DEPARTAMENTOS / UBICACIONES EN ODOO
    setScannerAlert({
      message: `Buscando código "${clean}" en catálogo general de Odoo...`,
      type: 'info',
      id: Date.now(),
    });

    try {
      if (odooConfig) {
        const lookup = await lookupGlobalProductInOdoo(odooConfig, clean, isDemoMode);
        if (lookup.found && lookup.product) {
          sound.playScan();
          setScannerAlert({
            message: `⚠️ Producto "${lookup.product.name}" detectado en otra ubicación en Odoo`,
            type: 'warning',
            id: Date.now(),
          });
          setOtherLocationModalData({
            product: lookup.product,
            locations: lookup.locations || [],
          });
          return;
        }
      }
    } catch (lookupErr) {
      console.warn('Error consultando catálogo global de Odoo:', lookupErr);
    }

    // 6. REQUISITO: MENSAJES DE ERROR / NO EXISTE -> Fondo/Texto ROJO destellante
    sound.playError();
    setScannerAlert({
      message: `✕ Código no encontrado: "${clean}" (No existe en la lista ni en Odoo)`,
      type: 'error',
      id: Date.now(),
    });

    // Devolver el foco al input para el siguiente disparo del lector láser
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // 5. REQUISITO: Vincular producto de otra ubicación a la auditoría actual
  const handleLinkProductToCurrentAudit = (
    product: any,
    locations: Array<{ quantId: number; locationId: number; locationName: string; quantity: number }>
  ) => {
    if (!session) return;
    const existingInLocation = locations.find((l) => l.locationId === session.locationId);
    const newQuantId = existingInLocation?.quantId || Date.now();

    const newItem: QuantItem = {
      id: newQuantId,
      productId: product.id,
      productName: product.name,
      defaultCode: product.defaultCode || '',
      barcode: product.barcode || '',
      locationId: session.locationId || 0,
      locationName: session.locationName,
      categId: session.categoryId || product.categId,
      categName: session.categoryName || product.categName,
      companyId: session.companyId,
      quantity: existingInLocation?.quantity || 0,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -(existingInLocation?.quantity || 0),
      isLocked: false,
      countHistory: [],
      syncedToOdoo: false,
    };

    setItems((prev) => [newItem, ...prev]);
    setOtherLocationModalData(null);
    sound.playSuccess();
    setFocusedQuantId(newItem.id);
    setAutoOpenBatchQuantId(newItem.id);

    setScannerAlert({
      message: `✓ Vinculado "${newItem.productName}" al conteo actual`,
      type: 'success',
      id: Date.now(),
    });
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

  // 3. BARRA DE PESTAÑAS DINÁMICA: Pestaña individual por cada categoría seleccionada en el modal
  const dynamicCategoryTabs = useMemo(() => {
    // Resolver nombres de categorías desde catálogo cargado y desde items
    const catMap = new Map<number, string>();
    for (const c of categories) {
      if (c && typeof c.id === 'number') {
        catMap.set(c.id, c.name || c.complete_name || `Categoría #${c.id}`);
      }
    }
    for (const it of items) {
      if (it.categId && it.categName && !catMap.has(it.categId)) {
        catMap.set(it.categId, it.categName);
      }
    }

    // IDs seleccionados en la sesión activa
    const selectedIds = session?.categoryIds && session.categoryIds.length > 0
      ? session.categoryIds
      : (session?.categoryId ? [session.categoryId] : []);

    if (selectedIds.length > 0) {
      return selectedIds.map((id) => {
        const rawName = catMap.get(id) || `Categoría #${id}`;
        const displayName = rawName.includes('/') ? rawName.split('/').pop()?.trim() || rawName : rawName;
        return {
          id,
          name: displayName,
          fullName: rawName,
          count: items.filter((i) => Number(i.categId) === Number(id)).length,
        };
      });
    }

    // Fallback: Si no hay IDs explícitos en la sesión, deducir de los items cargados
    const uniqueIds = Array.from(new Set(items.map((i) => i.categId).filter((id): id is number => typeof id === 'number')));
    return uniqueIds.map((id) => {
      const rawName = catMap.get(id) || `Categoría #${id}`;
      const displayName = rawName.includes('/') ? rawName.split('/').pop()?.trim() || rawName : rawName;
      return {
        id,
        name: displayName,
        fullName: rawName,
        count: items.filter((i) => Number(i.categId) === Number(id)).length,
      };
    });
  }, [session?.categoryIds, session?.categoryId, categories, items]);

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

      // Filtro por categoría: 'all' muestra la totalidad de productos de las categorías seleccionadas
      if (selectedCategoryFilter !== 'all') {
        const itemCatId = item.categId !== undefined ? Number(item.categId) : null;
        const targetCatId = Number(selectedCategoryFilter);
        if (itemCatId !== targetCatId) return false;
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
          onSessionStarted={(newSession, config, isDemo, initialCounts, initialCustomItems) => {
            setIsDemoMode(isDemo);
            setOdooConfig(config);
            setSession(newSession);

            if (initialCustomItems && initialCustomItems.length > 0) {
              // REQUISITO: Cargar directamente los productos elegidos del inventario multi-departamento
              setItems(initialCustomItems);
              saveOfflineCatalog(newSession.pin, initialCustomItems);
              setIsCategoryModalOpen(false);
              return;
            }

            setItems([]); // Limpiar la lista anterior explícitamente

            // Si la sesión ya tiene categorías configuradas en Supabase (ej. creada previamente por el Lead)
            // cargar directamente el inventario con los conteos de otros auditores
            const sessionCat = (newSession.categoryIds && newSession.categoryIds.length > 0)
              ? newSession.categoryIds
              : newSession.categoryId;

            if (sessionCat) {
              loadInventoryData(config, newSession.locationId, isDemo, sessionCat, initialCounts);
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
      {/* 1. BARRA SUPERIOR FIJA DE SESIÓN (PIN, Estado WebSocket, Auditores en Vivo, Modo Offline) */}
      <SessionBar
        session={session}
        connectionStatus={isOnline ? connectionStatus : 'local_only'}
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        onTriggerPendingSync={triggerAutoResync}
        auditors={auditors}
        onLogout={handleLogout}
        onLeaveSession={handleLogout}
        onOpenSyncModal={() => setShowRealtimeModal(true)}
        onOpenOdooModal={() => setShowOdooModal(true)}
      />

      {/* 6. REQUISITO: Notificaciones Visuales y Colores de Alertas del Escáner (Verde Éxito / Rojo Error) */}
      {scannerAlert && (
        <div
          className={`fixed top-14 sm:top-16 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] sm:w-auto px-4 py-3 rounded-2xl text-xs sm:text-sm font-bold shadow-2xl transition-all duration-300 flex items-center justify-between gap-3 ${
            scannerAlert.type === 'success'
              ? 'bg-emerald-950/95 border-2 border-emerald-500 text-emerald-100 shadow-emerald-950/80 animate-in fade-in slide-in-from-top-3'
              : scannerAlert.type === 'error'
              ? 'bg-rose-950/95 border-2 border-rose-500 text-rose-100 shadow-rose-950/80 animate-pulse'
              : scannerAlert.type === 'warning'
              ? 'bg-amber-950/95 border-2 border-amber-500 text-amber-100 shadow-amber-950/80 animate-in fade-in slide-in-from-top-3'
              : 'bg-indigo-950/95 border-2 border-indigo-500 text-indigo-100 shadow-indigo-950/80 animate-in fade-in slide-in-from-top-3'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {scannerAlert.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
            {scannerAlert.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 animate-bounce" />}
            {scannerAlert.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />}
            {scannerAlert.type === 'info' && <RefreshCw className="w-5 h-5 text-indigo-400 shrink-0 animate-spin" />}
            <span className="leading-snug truncate">{scannerAlert.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setScannerAlert(null)}
            className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition shrink-0 cursor-pointer text-xs"
            title="Cerrar notificación"
          >
            ✕
          </button>
        </div>
      )}

      {/* Banner de notificación en vivo cuando otro auditor hace un conteo */}
      {lastAuditNotification && !scannerAlert && (
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
              <span className="text-[11px] text-slate-400 block font-medium">
                {session.categoryIds && session.categoryIds.length > 1
                  ? `Áreas de Auditoría (${session.categoryIds.length} Categorías combinadas):`
                  : 'Área de Auditoría Asignada:'}
              </span>
              <strong className="text-white text-xs sm:text-sm font-bold truncate block" title={session.categoryName}>
                {session.categoryName || 'Selecciona una o más categorías para comenzar'}
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleBarcodeScanned(searchQuery);
            }}
            className="relative flex-1"
          >
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
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1 rounded-md text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              )}
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-indigo-300 border border-slate-700">
                Enter = Enfocar
              </span>
            </div>
          </form>

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

        {/* 3. BARRA DE PESTAÑAS DINÁMICA: "Todas las Categorías" + pestaña individual por cada categoría seleccionada en el modal */}
        {dynamicCategoryTabs.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
            {/* Pestaña: "Todas las Categorías (N)" donde N es la suma exacta de todos los productos */}
            <button
              type="button"
              onClick={() => setSelectedCategoryFilter('all')}
              className={`px-3.5 py-1.5 rounded-xl font-bold shrink-0 transition cursor-pointer border flex items-center gap-1.5 shadow-sm ${
                selectedCategoryFilter === 'all'
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-indigo-950/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <span>Todas las Categorías</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  selectedCategoryFilter === 'all'
                    ? 'bg-indigo-500/80 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {items.length}
              </span>
            </button>

            {/* Pestaña individual por cada categoría seleccionada en el modal */}
            {dynamicCategoryTabs.map((tab) => {
              const isTabActive = selectedCategoryFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedCategoryFilter(tab.id)}
                  className={`px-3.5 py-1.5 rounded-xl font-medium shrink-0 transition cursor-pointer border flex items-center gap-1.5 shadow-sm ${
                    isTabActive
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-indigo-950/60 font-bold'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span>{tab.name}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      isTabActive
                        ? 'bg-indigo-500/80 text-white'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tab.count}
                  </span>
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
              onToggleLock={handleToggleLock}
              isFocused={focusedQuantId === item.id}
              autoOpenBatch={autoOpenBatchQuantId === item.id}
              onBatchModalOpened={() => setAutoOpenBatchQuantId(null)}
            />
          ))}
        </div>
      </main>

      {/* 1. REQUISITO: Botón flotante circular 'Volver Arriba' (> 300px) */}
      {showScrollTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-20 right-4 sm:bottom-22 sm:right-6 z-40 w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-90 text-white shadow-2xl shadow-indigo-950 flex items-center justify-center border-2 border-indigo-400/40 transition-all duration-300 animate-in fade-in zoom-in cursor-pointer select-none"
          title="Volver al inicio de la lista"
          aria-label="Volver arriba"
        >
          <ArrowUp className="w-5 h-5 stroke-[2.5]" />
        </button>
      )}

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

      {/* 5. REQUISITO: Modal para Productos Detectados en Otras Ubicaciones / Departamentos */}
      {otherLocationModalData && (
        <ProductOtherLocationModal
          isOpen={Boolean(otherLocationModalData)}
          onClose={() => setOtherLocationModalData(null)}
          product={otherLocationModalData.product}
          locations={otherLocationModalData.locations}
          currentLocationName={session.locationName}
          currentCategoryName={session.categoryName}
          onLinkToCurrentAudit={() =>
            handleLinkProductToCurrentAudit(
              otherLocationModalData.product,
              otherLocationModalData.locations
            )
          }
        />
      )}

      {/* Modal Obligatorio de Selección de Categoría (Multiselect) */}
      <CategorySelectionModal
        isOpen={isCategoryModalOpen}
        categories={categories}
        isLoadingCategories={isLoadingCategories}
        loadError={categoryLoadError}
        auditorName={session.auditorName}
        sessionPin={session.pin}
        locationName={session.locationName}
        currentCategoryId={session.categoryId}
        currentCategoryIds={session.categoryIds}
        canClose={true}
        onSelectCategories={handleCategoriesSelected}
        onClose={handleCategoryModalClose}
        onRetryLoadCategories={() => loadCategoriesOnly(odooConfig, isDemoMode)}
        onOpenCustomInventory={() => {
          setIsCategoryModalOpen(false);
          setShowCustomInventoryModal(true);
        }}
      />

      {/* Modal para Crear Inventario Personalizado Multi-Departamento desde Selección de Categorías */}
      {showCustomInventoryModal && odooConfig && session && (
        <CustomInventoryModal
          isOpen={showCustomInventoryModal}
          onClose={() => {
            setShowCustomInventoryModal(false);
            if (!session.categoryId && (!items || items.length === 0)) {
              setIsCategoryModalOpen(true);
            }
          }}
          odooConfig={odooConfig}
          isDemo={isDemoMode}
          currentAuditorName={session.auditorName}
          currentPin={session.pin}
          onStartCustomAudit={(customSession, _cfg, customItems) => {
            setSession(customSession);
            setItems(customItems);
            saveOfflineCatalog(customSession.pin, customItems);
            setIsCategoryModalOpen(false);
            setShowCustomInventoryModal(false);
            sound.playSuccess();
            setScannerAlert({
              message: `✓ Inventario personalizado cargado (${customItems.length} productos)`,
              type: 'success',
              id: Date.now(),
            });
          }}
        />
      )}
    </div>
  );
}
