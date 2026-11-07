/**
 * Gestor de persistencia Offline y cola de sincronización automática bidireccional hacia Supabase
 * Incluye compatibilidad retroactiva con versiones anteriores de la PWA e IndexedDB como respaldo.
 */
import { QuantItem, RealtimeCountUpdate } from '../types';
import { broadcastCountUpdate, fetchSessionAuditState } from './supabase';

const PREFIX_OFFLINE_ITEMS = 'odoo_audit_offline_items_';
const PREFIX_PENDING_QUEUE = 'odoo_audit_pending_queue_';

// Claves de versiones anteriores para garantizar que ninguna actualización borre datos previos
const getLegacyStorageKeys = (pin: string): string[] => [
  `odoo_audit_offline_items_${pin}`,
  `odoo_audit_custom_inventory_${pin}`,
  `odoo_audit_counts_cache_${pin}`,
  `odoo_audit_items_${pin}`,
  `audit_items_${pin}`,
  `odoo_audit_local_session_${pin}`,
];

// =========================================================================
// 1. CAPA DE PERSISTENCIA ROBUSTA CON INDEXEDDB (Sin límite de 5MB)
// =========================================================================

const IDB_NAME = 'OdooAudit_OfflineDB_v1';
const IDB_STORE_CATALOGS = 'catalogs';
const IDB_STORE_PENDING = 'pending_queue';

function openAuditDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, 1);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_CATALOGS)) {
          db.createObjectStore(IDB_STORE_CATALOGS, { keyPath: 'pin' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_PENDING)) {
          db.createObjectStore(IDB_STORE_PENDING, { keyPath: 'pin' });
        }
      };

      request.onsuccess = (event: any) => {
        resolve(event.target.result);
      };

      request.onerror = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Guarda de forma asíncrona en IndexedDB como respaldo inmutable
 */
export async function saveCatalogToIDB(pin: string, items: QuantItem[]): Promise<void> {
  if (!pin || !items) return;
  try {
    const db = await openAuditDB();
    if (!db) return;
    const tx = db.transaction(IDB_STORE_CATALOGS, 'readwrite');
    const store = tx.objectStore(IDB_STORE_CATALOGS);
    store.put({ pin, items, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('Advertencia guardando en IndexedDB:', err);
  }
}

/**
 * Recupera el catálogo desde IndexedDB
 */
export async function loadCatalogFromIDB(pin: string): Promise<QuantItem[] | null> {
  if (!pin) return null;
  try {
    const db = await openAuditDB();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE_CATALOGS, 'readonly');
      const store = tx.objectStore(IDB_STORE_CATALOGS);
      const req = store.get(pin);

      req.onsuccess = () => {
        const res = req.result;
        if (res && Array.isArray(res.items) && res.items.length > 0) {
          resolve(res.items);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// =========================================================================
// 2. PERSISTENCIA EN LOCALSTORAGE CON RETROCOMPATIBILIDAD
// =========================================================================

/**
 * Guarda en almacenamiento local (LocalStorage + IndexedDB) el catálogo y estado de conteos
 */
export function saveOfflineCatalog(pin: string, items: QuantItem[]): void {
  if (!pin || !items) return;

  // 1. Guardar sincrónicamente en LocalStorage para lectura inmediata en render
  try {
    localStorage.setItem(`${PREFIX_OFFLINE_ITEMS}${pin}`, JSON.stringify(items));
  } catch (err) {
    console.warn('Advertencia guardando catálogo en LocalStorage (posible cuota excedida, respaldando en IndexedDB):', err);
  }

  // 2. Respaldar asíncronamente en IndexedDB (sin restricción de 5MB)
  saveCatalogToIDB(pin, items).catch(() => {});
}

/**
 * Recupera el catálogo guardado localmente para una sesión/PIN
 * Revisa tanto la clave actual como todas las claves de versiones anteriores para no perder avance
 */
export function loadOfflineCatalog(pin: string): QuantItem[] | null {
  if (!pin) return null;

  // 1. Intentar clave estándar actual
  try {
    const raw = localStorage.getItem(`${PREFIX_OFFLINE_ITEMS}${pin}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}

  // 2. Retrocompatibilidad: buscar en claves legacy utilizadas por versiones anteriores
  const legacyKeys = getLegacyStorageKeys(pin);
  for (const key of legacyKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Migrar automáticamente a la clave estándar actual sin borrar la anterior
          try {
            localStorage.setItem(`${PREFIX_OFFLINE_ITEMS}${pin}`, JSON.stringify(parsed));
          } catch {}
          return parsed;
        }
      }
    } catch {}
  }

  return null;
}

// =========================================================================
// 3. COLA DE CONTEOS PENDIENTES OFFLINE
// =========================================================================

/**
 * Añade o actualiza una acción de conteo en la cola de sincronización pendiente
 * Retorna la cantidad de conteos pendientes
 */
export function queuePendingCount(pin: string, update: RealtimeCountUpdate): number {
  if (!pin) return 0;
  try {
    const queue = getPendingCounts(pin);

    // Si ya existe un conteo pendiente para este producto, actualizarlo con la versión más reciente
    const existingIndex = queue.findIndex(
      (item) => (item.productId && item.productId === update.productId) || item.quantId === update.quantId
    );

    if (existingIndex >= 0) {
      queue[existingIndex] = update;
    } else {
      queue.push(update);
    }

    localStorage.setItem(`${PREFIX_PENDING_QUEUE}${pin}`, JSON.stringify(queue));
    return queue.length;
  } catch (err) {
    console.warn('Error encolando conteo pendiente:', err);
    return 0;
  }
}

/**
 * Obtiene la lista de conteos pendientes por sincronizar
 */
export function getPendingCounts(pin: string): RealtimeCountUpdate[] {
  if (!pin) return [];
  try {
    const raw = localStorage.getItem(`${PREFIX_PENDING_QUEUE}${pin}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Limpia la cola de sincronización pendiente
 */
export function clearPendingCounts(pin: string): void {
  if (!pin) return;
  try {
    localStorage.removeItem(`${PREFIX_PENDING_QUEUE}${pin}`);
  } catch {}
}

/**
 * Ejecuta el UPSERT en Supabase de todos los conteos pendientes de la sesión (PUSH)
 */
export async function syncPendingCounts(
  pin: string,
  onProgress?: (remaining: number) => void
): Promise<{ synced: number; failed: number }> {
  if (!pin) return { synced: 0, failed: 0 };
  const queue = getPendingCounts(pin);
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const failedItems: RealtimeCountUpdate[] = [];
  let syncedCount = 0;

  for (const item of queue) {
    try {
      const res = await broadcastCountUpdate(item);
      if (res.success) {
        syncedCount++;
      } else {
        failedItems.push(item);
      }
    } catch (err) {
      console.warn('Error sincronizando item pendiente:', err);
      failedItems.push(item);
    }

    if (onProgress) {
      onProgress(failedItems.length + (queue.length - syncedCount - failedItems.length));
    }
  }

  // Guardar solo los que fallaron
  try {
    if (failedItems.length > 0) {
      localStorage.setItem(`${PREFIX_PENDING_QUEUE}${pin}`, JSON.stringify(failedItems));
    } else {
      clearPendingCounts(pin);
    }
  } catch {}

  return { synced: syncedCount, failed: failedItems.length };
}

// =========================================================================
// 4. FUSIÓN INTELIGENTE Y SINCRONIZACIÓN BIDIRECCIONAL (PUSH + PULL + MERGE)
// =========================================================================

/**
 * Fusiona de forma inteligente los productos locales con los remotos de Supabase:
 * - Prioridad 1: Conteos pendientes en cola local (el usuario los contó sin red y aún no suben).
 * - Prioridad 2: Timestamp más reciente (LWW - Last Write Wins) para productos con conteos.
 * - Prioridad 3: Conserva los productos auditados y recalcula diferencias exactas.
 */
export function mergeAuditItems(
  localItems: QuantItem[],
  remoteItems: QuantItem[],
  pendingQueue: RealtimeCountUpdate[] = []
): QuantItem[] {
  const mergedMap = new Map<string, QuantItem>();

  const getProductKey = (item: { productId?: number; id?: number }): string => {
    return item.productId ? `prod_${item.productId}` : `quant_${item.id}`;
  };

  // Crear mapa rápido de conteos pendientes locales
  const pendingMap = new Map<string, RealtimeCountUpdate>();
  for (const p of pendingQueue) {
    const key = p.productId ? `prod_${p.productId}` : `quant_${p.quantId}`;
    pendingMap.set(key, p);
  }

  // 1. Agregar todos los productos locales como base
  for (const loc of localItems) {
    const key = getProductKey(loc);
    mergedMap.set(key, { ...loc });
  }

  // 2. Fusionar con los productos remotos provenientes del servidor
  for (const rem of remoteItems) {
    const key = getProductKey(rem);
    const existing = mergedMap.get(key);

    if (!existing) {
      // Si el producto está en el servidor pero no localmente (ej: dispositivo nuevo), añadirlo
      mergedMap.set(key, { ...rem });
      continue;
    }

    // Si hay un conteo local pendiente no enviado, tiene prioridad sobre la versión del servidor
    if (pendingMap.has(key)) {
      continue;
    }

    // Si ambos existen, comparar cuál tiene la auditoría más reciente
    const existingAudited = Boolean(existing.lastAuditedAt);
    const remoteAudited = Boolean(rem.lastAuditedAt);

    if (remoteAudited && !existingAudited) {
      // El servidor tiene el producto auditado y lo local no: adoptar el servidor
      existing.countedQuantity = rem.countedQuantity;
      existing.lastAuditedAt = rem.lastAuditedAt;
      existing.lastAuditedBy = rem.lastAuditedBy;
      existing.difference = rem.difference;
      existing.isLocked = rem.isLocked ?? existing.isLocked;
      existing.photoUrl = rem.photoUrl ?? existing.photoUrl;
      existing.notes = rem.notes ?? existing.notes;
      existing.countHistory = rem.countHistory ?? existing.countHistory;
    } else if (remoteAudited && existingAudited) {
      // Ambos auditados: comparar marcas de tiempo ISO
      const locTime = new Date(existing.lastAuditedAt!).getTime();
      const remTime = new Date(rem.lastAuditedAt!).getTime();

      if (remTime > locTime) {
        // La versión del servidor es más reciente (auditada por otro dispositivo)
        existing.countedQuantity = rem.countedQuantity;
        existing.lastAuditedAt = rem.lastAuditedAt;
        existing.lastAuditedBy = rem.lastAuditedBy;
        existing.difference = rem.difference;
        existing.isLocked = rem.isLocked ?? existing.isLocked;
        existing.photoUrl = rem.photoUrl ?? existing.photoUrl;
        existing.notes = rem.notes ?? existing.notes;
        existing.countHistory = rem.countHistory ?? existing.countHistory;
      }
    }

    // Conservar datos maestros del sistema si el servidor los trajo
    if (rem.quantity !== undefined && rem.quantity !== null) {
      if (!existing.isLocked) {
        existing.quantity = rem.quantity;
      }
    }
    if (rem.productName && !existing.productName) existing.productName = rem.productName;
    if (rem.barcode && !existing.barcode) existing.barcode = rem.barcode;

    // Recalcular diferencia precisa
    const cleanQC = existing.countedQuantity || 0;
    const cleanQS = existing.quantity || 0;
    existing.difference = Math.round((cleanQC - cleanQS) * 1000) / 1000;
  }

  // 3. Aplicar cualquier pendiente local que aún no se haya reflejado
  for (const [key, pending] of pendingMap.entries()) {
    const item = mergedMap.get(key);
    if (item) {
      item.countedQuantity = pending.countedQuantity;
      item.lastAuditedAt = pending.timestamp;
      item.lastAuditedBy = pending.auditorName;
      if (pending.isLocked !== undefined) item.isLocked = pending.isLocked;
      if (pending.photoUrl) item.photoUrl = pending.photoUrl;
      if (pending.countHistory) item.countHistory = pending.countHistory;
      item.difference = Math.round((pending.countedQuantity - item.quantity) * 1000) / 1000;
    }
  }

  return Array.from(mergedMap.values());
}

/**
 * SINCRONIZACIÓN AUTOMÁTICA BIDIRECCIONAL COMPLETA:
 * 1. PUSH: Envía conteos locales pendientes a Supabase.
 * 2. PULL: Consulta el estado más reciente de la sesión y productos en Supabase.
 * 3. MERGE: Fusiona bidireccionalmente sin perder progreso.
 * 4. PERSIST: Guarda los datos fusionados en LocalStorage e IndexedDB.
 */
export async function performBidirectionalSync(
  pin: string,
  currentItems: QuantItem[]
): Promise<{
  success: boolean;
  items: QuantItem[];
  syncedPushCount: number;
  pendingCount: number;
  auditedCount: number;
  diffCount: number;
}> {
  if (!pin) {
    return {
      success: false,
      items: currentItems,
      syncedPushCount: 0,
      pendingCount: 0,
      auditedCount: currentItems.filter((i) => Boolean(i.lastAuditedAt)).length,
      diffCount: currentItems.filter((i) => Boolean(i.lastAuditedAt) && Math.abs(i.difference) > 0.0001).length,
    };
  }

  let pushed = 0;
  const pendingBefore = getPendingCounts(pin);

  // 1. PUSH: Si hay red, sincronizar pendientes locales primero
  if (navigator.onLine && pendingBefore.length > 0) {
    const syncRes = await syncPendingCounts(pin);
    pushed = syncRes.synced;
  }

  const remainingPending = getPendingCounts(pin);

  // 2. PULL: Consultar estado dinámico del servidor
  if (navigator.onLine) {
    try {
      const serverState = await fetchSessionAuditState(pin);

      if (serverState.exists && serverState.items.length > 0) {
        // 3. MERGE: Fusionar estado del servidor con los items en memoria/locales
        const merged = mergeAuditItems(currentItems, serverState.items, remainingPending);

        // 4. PERSIST: Guardar copia actualizada para modo offline
        saveOfflineCatalog(pin, merged);

        const auditedCount = merged.filter((i) => Boolean(i.lastAuditedAt)).length;
        const diffCount = merged.filter((i) => Boolean(i.lastAuditedAt) && Math.abs(i.difference) > 0.0001).length;

        return {
          success: true,
          items: merged,
          syncedPushCount: pushed,
          pendingCount: remainingPending.length,
          auditedCount,
          diffCount,
        };
      }
    } catch (err) {
      console.warn('Aviso en pull de sincronización bidireccional:', err);
    }
  }

  // Si no hay red o falló el pull, mantener el estado local actual
  saveOfflineCatalog(pin, currentItems);
  const auditedCount = currentItems.filter((i) => Boolean(i.lastAuditedAt)).length;
  const diffCount = currentItems.filter((i) => Boolean(i.lastAuditedAt) && Math.abs(i.difference) > 0.0001).length;

  return {
    success: true,
    items: currentItems,
    syncedPushCount: pushed,
    pendingCount: remainingPending.length,
    auditedCount,
    diffCount,
  };
}
