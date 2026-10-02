/**
 * Gestor de persistencia Offline y cola de sincronización automática hacia Supabase
 */
import { QuantItem, RealtimeCountUpdate } from '../types';
import { broadcastCountUpdate } from './supabase';

const PREFIX_OFFLINE_ITEMS = 'odoo_audit_offline_items_';
const PREFIX_PENDING_QUEUE = 'odoo_audit_pending_queue_';

/**
 * Guarda en almacenamiento local (LocalStorage) el catálogo cargado y estado de conteos
 */
export function saveOfflineCatalog(pin: string, items: QuantItem[]): void {
  if (!pin || !items) return;
  try {
    localStorage.setItem(`${PREFIX_OFFLINE_ITEMS}${pin}`, JSON.stringify(items));
  } catch (err) {
    console.warn('Advertencia guardando catálogo offline (posible cuota excedida):', err);
  }
}

/**
 * Recupera el catálogo guardado localmente para una sesión/PIN
 */
export function loadOfflineCatalog(pin: string): QuantItem[] | null {
  if (!pin) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX_OFFLINE_ITEMS}${pin}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Añade o actualiza una acción de conteo en la cola de sincronización pendiente
 * Retorna la cantidad de conteos pendientes
 */
export function queuePendingCount(pin: string, update: RealtimeCountUpdate): number {
  if (!pin) return 0;
  try {
    const queue = getPendingCounts(pin);
    const key = update.productId || update.quantId;

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
 * Ejecuta el UPSERT en Supabase de todos los conteos pendientes de la sesión
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
