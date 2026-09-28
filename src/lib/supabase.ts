/**
 * Módulo de Conexión y Sincronización en Tiempo Real con Supabase
 * Soporta canales postgres_changes sobre la tabla 'audit_counts', Realtime Broadcast y Presence
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RealtimeCountUpdate, AuditorPresence, AuditSession } from '../types';

const STORAGE_KEY_CONFIG = 'odoo_audit_supabase_config';
const STORAGE_KEY_COUNTS = 'odoo_audit_counts_cache_';

export interface SupabaseSettings {
  url: string;
  anonKey: string;
}

let activeClient: SupabaseClient | null = null;
let activeChannel: RealtimeChannel | null = null;
let localBroadcastChannel: BroadcastChannel | null = null;

export const DEFAULT_SUPABASE_URL = 'https://sepeawvmamugivoptfyf.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_MOfmPfFZNjTEfQndXvDM-w_C18epU2N';

// Inmediata invalidación y limpieza preventiva de claves obsoletas/truncadas en localStorage
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        !parsed.anonKey ||
        parsed.anonKey === 'sb_publishable_MOfmPFfZnJTEfQndXvDM-w_C18ep' ||
        parsed.anonKey.includes('...') ||
        parsed.url?.includes('su-proyecto') ||
        parsed.url?.includes('xyzcompany') ||
        parsed.url?.includes('your-project') ||
        parsed.anonKey.length < 35
      ) {
        window.localStorage.setItem(
          STORAGE_KEY_CONFIG,
          JSON.stringify({
            url: DEFAULT_SUPABASE_URL,
            anonKey: DEFAULT_SUPABASE_ANON_KEY,
          })
        );
      }
    }
  }
} catch {
  // noop
}

/**
 * Obtiene la configuración de Supabase guardada, o los valores por defecto oficiales del proyecto
 */
export function getSavedSupabaseSettings(): SupabaseSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed.url &&
        parsed.anonKey &&
        parsed.anonKey !== 'sb_publishable_MOfmPFfZnJTEfQndXvDM-w_C18ep' &&
        !parsed.anonKey.includes('...') &&
        parsed.anonKey.length >= 35 &&
        !parsed.url.includes('su-proyecto') &&
        !parsed.url.includes('xyzcompany') &&
        !parsed.url.includes('your-project')
      ) {
        return parsed;
      }
    }
  } catch {
    // noop
  }
  return {
    url: DEFAULT_SUPABASE_URL,
    anonKey: DEFAULT_SUPABASE_ANON_KEY,
  };
}

/**
 * Guarda las credenciales de Supabase
 */
export function saveSupabaseSettings(settings: SupabaseSettings) {
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(settings));
    // Reiniciar cliente si cambió
    activeClient = null;
  } catch {
    // noop
  }
}

/**
 * Verifica si las credenciales de Supabase están configuradas con una URL válida real.
 * Si están vacías o contienen placeholders, retorna false (activando modo Local / P2P).
 */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSavedSupabaseSettings();
  if (!url || !anonKey) return false;
  const cleanUrl = url.trim().toLowerCase();
  if (
    cleanUrl.includes('xyzcompany') ||
    cleanUrl.includes('your-project') ||
    cleanUrl.includes('su-proyecto') ||
    cleanUrl.includes('example.supabase.co') ||
    !cleanUrl.startsWith('http') ||
    anonKey.trim().length < 10
  ) {
    return false;
  }
  return true;
}

/**
 * Obtiene o inicializa la instancia de SupabaseClient
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (activeClient) return activeClient;

  const { url, anonKey } = getSavedSupabaseSettings();
  try {
    activeClient = createClient(url.trim(), anonKey.trim(), {
      realtime: {
        params: {
          eventsPerSecond: 15,
        },
      },
    });
    return activeClient;
  } catch (err) {
    console.error('Error al inicializar cliente Supabase:', err);
    return null;
  }
}

/**
 * Genera un PIN aleatorio de 4 dígitos para una nueva sesión de auditoría
 */
export function generateSessionPin(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return String(num);
}

/**
 * Suscribe a los cambios en tiempo real para una sesión con un PIN específico
 * Implementa tanto 'postgres_changes' como 'broadcast' y 'presence' para redundancia y velocidad
 */
export function subscribeToAuditSession(
  pin: string,
  currentAuditor: { id: string; name: string },
  onCountUpdate: (update: RealtimeCountUpdate) => void,
  onAuditorsChange: (auditors: AuditorPresence[]) => void,
  onStatusChange: (status: 'connected' | 'connecting' | 'disconnected' | 'local_only') => void
): () => void {
  // Limpiar canal anterior si existe
  if (activeChannel) {
    activeChannel.unsubscribe();
    activeChannel = null;
  }

  // Soporte de BroadcastChannel nativo del navegador para sincronización inmediata multi-pestaña/ventana
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    if (localBroadcastChannel) {
      localBroadcastChannel.close();
    }
    localBroadcastChannel = new BroadcastChannel(`odoo_audit_channel_${pin}`);
    localBroadcastChannel.onmessage = (event) => {
      if (event.data?.type === 'COUNT_UPDATE' && event.data.payload) {
        onCountUpdate(event.data.payload);
      }
    };
  }

  const client = getSupabaseClient();

  if (!client) {
    // Si no hay Supabase configurado, operamos en modo local/broadcast altamente funcional
    onStatusChange('local_only');
    onAuditorsChange([
      {
        id: currentAuditor.id,
        name: currentAuditor.name,
        pin,
        device: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Escritorio',
        joinedAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      },
    ]);

    return () => {
      if (localBroadcastChannel) {
        localBroadcastChannel.close();
        localBroadcastChannel = null;
      }
    };
  }

  onStatusChange('connecting');

  // Canal unificado para Broadcast, Presence y Postgres Changes
  const channel = client.channel(`audit_session_${pin}`, {
    config: {
      presence: {
        key: currentAuditor.id,
      },
      broadcast: {
        self: false,
      },
    },
  });

  // 1. Escuchar mensajes 'broadcast' directos para latencia de milisegundos
  channel.on('broadcast', { event: 'count_update' }, ({ payload }) => {
    if (payload && payload.pin === pin) {
      onCountUpdate(payload as RealtimeCountUpdate);
    }
  });

  // 2. Escuchar 'postgres_changes' en 'audit_items' filtrando por pin
  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'audit_items',
      filter: `pin=eq.${pin}`,
    },
    (payload) => {
      const row = (payload.new || payload.old) as any;
      if (row && (row.quant_id || row.product_id)) {
        onCountUpdate({
          quantId: Number(row.quant_id || row.product_id),
          productId: Number(row.product_id || row.quant_id),
          productName: row.product_name || undefined,
          barcode: row.barcode || undefined,
          countedQuantity: Number(row.counted_quantity ?? row.qty ?? row.count ?? 0),
          systemQuantity: row.system_quantity !== undefined && row.system_quantity !== null ? Number(row.system_quantity) : undefined,
          isLocked: Boolean(row.is_locked),
          auditorName: row.auditor_name || 'Auditor',
          timestamp: row.updated_at || row.created_at || new Date().toISOString(),
          pin: row.pin,
          photoUrl: row.photo_url || undefined,
          notes: row.notes || undefined,
        });
      }
    }
  );

  // Escuchar 'postgres_changes' en 'audit_counts' por compatibilidad
  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'audit_counts',
      filter: `pin=eq.${pin}`,
    },
    (payload) => {
      const row = (payload.new || payload.old) as any;
      if (row && (row.quant_id || row.product_id)) {
        onCountUpdate({
          quantId: Number(row.quant_id || row.product_id),
          productId: Number(row.product_id || row.quant_id),
          productName: row.product_name || undefined,
          barcode: row.barcode || undefined,
          countedQuantity: Number(row.counted_quantity ?? row.qty ?? row.count ?? 0),
          systemQuantity: row.system_quantity !== undefined && row.system_quantity !== null ? Number(row.system_quantity) : undefined,
          isLocked: Boolean(row.is_locked),
          auditorName: row.auditor_name || 'Auditor',
          timestamp: row.updated_at || row.created_at || new Date().toISOString(),
          pin: row.pin,
          photoUrl: row.photo_url || undefined,
          notes: row.notes || undefined,
        });
      }
    }
  );

  // 3. Manejo de Presencia (Presence) de auditores en vivo
  channel.on('presence', { event: 'sync' }, () => {
    const presenceState = channel.presenceState();
    const activeAuditors: AuditorPresence[] = [];

    for (const key in presenceState) {
      const entries = presenceState[key] as any[];
      if (entries && entries.length > 0) {
        const item = entries[0];
        activeAuditors.push({
          id: key,
          name: item.name || 'Auditor',
          pin,
          device: item.device || 'Dispositivo',
          joinedAt: item.joinedAt || new Date().toISOString(),
          lastActive: new Date().toISOString(),
        });
      }
    }

    if (activeAuditors.length === 0) {
      activeAuditors.push({
        id: currentAuditor.id,
        name: currentAuditor.name,
        pin,
        device: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Escritorio',
        joinedAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      });
    }

    onAuditorsChange(activeAuditors);
  });

  // Suscribirse y rastrear presencia
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      onStatusChange('connected');
      await channel.track({
        id: currentAuditor.id,
        name: currentAuditor.name,
        device: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Escritorio',
        joinedAt: new Date().toISOString(),
      });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onStatusChange('disconnected');
    }
  });

  activeChannel = channel;

  return () => {
    channel.unsubscribe();
    if (activeChannel === channel) {
      activeChannel = null;
    }
    if (localBroadcastChannel) {
      localBroadcastChannel.close();
      localBroadcastChannel = null;
    }
  };
}

/**
 * Emite una actualización de conteo al canal Realtime y a la base de datos Supabase
 */
export async function broadcastCountUpdate(update: RealtimeCountUpdate): Promise<void> {
  // 1. Enviar por canal local de navegador para sincronizar pestañas instantáneamente
  if (localBroadcastChannel) {
    try {
      localBroadcastChannel.postMessage({
        type: 'COUNT_UPDATE',
        payload: update,
      });
    } catch {
      // noop
    }
  }

  // 2. Enviar por WebSocket Supabase si el canal está activo
  if (activeChannel) {
    try {
      await activeChannel.send({
        type: 'broadcast',
        event: 'count_update',
        payload: update,
      });
    } catch (err) {
      console.warn('Error al transmitir por Supabase broadcast:', err);
    }
  }

  // 3. Persistir y realizar UPSERT directo en la tabla 'audit_items' usando ('pin', 'product_id')
  const client = getSupabaseClient();
  if (client) {
    const pId = Number(update.productId || update.quantId);
    const qId = Number(update.quantId || update.productId);

    try {
      // 3.1 Intentar UPSERT en 'audit_items' con esquema enriquecido
      const enrichedRecord: Record<string, any> = {
        id: `${update.pin}_${pId}`,
        pin: update.pin,
        product_id: pId,
        quant_id: qId,
        counted_quantity: update.countedQuantity,
        qty: update.countedQuantity,
        is_locked: update.isLocked ?? false,
        auditor_name: update.auditorName,
        photo_url: update.photoUrl || null,
        notes: update.notes || null,
        updated_at: update.timestamp,
      };
      if (update.productName) enrichedRecord.product_name = update.productName;
      if (update.barcode) enrichedRecord.barcode = update.barcode;
      if (update.systemQuantity !== undefined) enrichedRecord.system_quantity = update.systemQuantity;

      let { error: itemError } = await client
        .from('audit_items')
        .upsert(enrichedRecord, { onConflict: 'pin,product_id' });

      // Si la columna qty en Supabase fue configurada como integer (código de error 22P02),
      // reintentar redondeando qty pero conservando el valor decimal exacto de hasta 3 dígitos en counted_quantity
      if (itemError && (itemError.code === '22P02' || itemError.message?.includes('integer'))) {
        enrichedRecord.qty = Math.round(update.countedQuantity);
        const resRetry = await client
          .from('audit_items')
          .upsert(enrichedRecord, { onConflict: 'pin,product_id' });
        itemError = resRetry.error;
      }

      // Si falla porque alguna columna aún no existe en Supabase (ej: auditor_name, quant_id)
      if (itemError && (itemError.code === 'PGRST204' || itemError.message?.includes('column'))) {
        const basicRecord = {
          id: `${update.pin}_${pId}`,
          pin: update.pin,
          product_id: pId,
          qty: Math.round(update.countedQuantity),
          is_locked: update.isLocked ?? false,
          updated_at: update.timestamp,
        };
        const resBasic = await client
          .from('audit_items')
          .upsert(basicRecord, { onConflict: 'id' });
        itemError = resBasic.error;
      }

      // Si la tabla no tiene constraint compuesto (pin, product_id) sino solo 'id' como clave primaria
      if (itemError && (itemError.code === '42P10' || itemError.message?.includes('conflict') || itemError.message?.includes('constraint'))) {
        const idRecord = {
          id: `${update.pin}_${pId}`,
          pin: update.pin,
          product_id: pId,
          qty: Math.round(update.countedQuantity),
          is_locked: update.isLocked ?? false,
          updated_at: update.timestamp,
        };
        const resId = await client
          .from('audit_items')
          .upsert(idRecord, { onConflict: 'id' });
        itemError = resId.error;
      }

      if (itemError) {
        console.warn('Nota upsert en audit_items:', itemError.message);
      }
    } catch (err) {
      console.warn('Excepción en upsert audit_items:', err);
    }

    // 3.2 Como respaldo secundario y compatibilidad, actualizar también audit_counts
    try {
      await client.from('audit_counts').upsert({
        id: `${update.pin}_${qId}`,
        pin: update.pin,
        quant_id: qId,
        product_id: pId,
        product_name: update.productName || null,
        barcode: update.barcode || null,
        qty: update.countedQuantity,
        auditor_name: update.auditorName,
        updated_at: update.timestamp,
      }, { onConflict: 'pin,quant_id' });
    } catch {
      // noop
    }
  }
}

/**
 * 1. Verifica si una sesión con el PIN provisto ya existe en Supabase
 * Consulta tanto la tabla 'audit_sessions' como 'audit_items' / 'audit_counts'
 */
export async function checkSessionExistsInSupabase(pin: string): Promise<{
  configured: boolean;
  exists: boolean;
  session?: Partial<AuditSession> & { odooUrl?: string; odooDb?: string };
  counts?: RealtimeCountUpdate[];
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    // Si no hay cliente Supabase configurado (o URL placeholder), consultar en cache local P2P
    const localSession = localStorage.getItem(`odoo_audit_local_session_${pin}`);
    const localCache = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);

    let parsedSession: Partial<AuditSession> | undefined;
    let parsedCounts: RealtimeCountUpdate[] = [];

    if (localSession) {
      try {
        parsedSession = JSON.parse(localSession);
      } catch {}
    }
    if (localCache) {
      try {
        parsedCounts = JSON.parse(localCache);
      } catch {}
    }

    if (parsedSession || parsedCounts.length > 0) {
      return {
        configured: false,
        exists: true,
        session: parsedSession || { pin, id: `session_${pin}` },
        counts: parsedCounts,
      };
    }
    return { configured: false, exists: false };
  }

  try {
    // 1. SELECT en audit_sessions / inventory_sessions / sessions por PIN
    let sessionRecord: any = null;
    const sessionTables = ['audit_sessions', 'inventory_sessions', 'sessions'];
    for (const table of sessionTables) {
      try {
        const { data, error } = await client
          .from(table)
          .select('*')
          .eq('pin', pin)
          .maybeSingle();

        if (!error && data) {
          sessionRecord = data;
          break;
        }
      } catch {
        // continuar a siguiente tabla
      }
    }

    // 2. SELECT en audit_items / audit_counts / inventory_counts / counts para cargar los conteos actuales
    let countsRows: any[] = [];
    const countTables = ['audit_items', 'audit_counts', 'inventory_counts', 'counts'];
    for (const table of countTables) {
      try {
        const { data: countsData, error: countsErr } = await client
          .from(table)
          .select('*')
          .eq('pin', pin)
          .order('updated_at', { ascending: false });

        if (!countsErr && countsData && countsData.length > 0) {
          countsRows = countsData;
          break;
        }
      } catch {
        // continuar a siguiente tabla
      }
    }

    const hasSession = !!sessionRecord || countsRows.length > 0;
    if (!hasSession) {
      // Verificar si existe en almacenamiento local para sincronización inmediata
      const localSession = localStorage.getItem(`odoo_audit_local_session_${pin}`);
      if (localSession) {
        try {
          const parsed = JSON.parse(localSession);
          return {
            configured: true,
            exists: true,
            session: parsed,
            counts: [],
          };
        } catch {}
      }
      return { configured: true, exists: false };
    }

    const counts: RealtimeCountUpdate[] = countsRows.map((row) => ({
      quantId: Number(row.quant_id || row.product_id || 0),
      productId: Number(row.product_id || row.quant_id || 0),
      productName: row.product_name || undefined,
      barcode: row.barcode || undefined,
      countedQuantity: Number(row.counted_quantity ?? row.qty ?? row.count ?? 0),
      systemQuantity: row.system_quantity !== undefined && row.system_quantity !== null ? Number(row.system_quantity) : undefined,
      isLocked: Boolean(row.is_locked),
      auditorName: row.auditor_name || 'Auditor',
      timestamp: row.updated_at || row.created_at || new Date().toISOString(),
      pin: row.pin,
      photoUrl: row.photo_url || undefined,
      notes: row.notes || undefined,
    }));

    // Cachear localmente para contingencia offline
    try {
      localStorage.setItem(`${STORAGE_KEY_COUNTS}${pin}`, JSON.stringify(counts));
    } catch {
      // noop
    }

    const foundSession: Partial<AuditSession> & { odooUrl?: string; odooDb?: string } = {
      id: sessionRecord?.id || `session_${pin}`,
      pin,
      createdAt: sessionRecord?.created_at,
      companyName: sessionRecord?.company_name || 'FV GRUPO EMPRESARIAL, C.A.',
      companyId: sessionRecord?.company_id || undefined,
      locationName: sessionRecord?.location_name || 'WH/Existencias',
      locationId: sessionRecord?.location_id || undefined,
      categoryId: sessionRecord?.category_id || undefined,
      categoryName: sessionRecord?.category_name || undefined,
      odooUrl: sessionRecord?.odoo_url || undefined,
      odooDb: sessionRecord?.odoo_db || undefined,
    };

    return {
      configured: true,
      exists: true,
      session: foundSession,
      counts,
    };
  } catch (err: any) {
    console.error('Error al verificar sesión en Supabase:', err);
    return {
      configured: true,
      exists: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * 2. Recupera los conteos y estados (incluyendo is_locked) de los productos mediante SELECT en Supabase
 * Ejecuta primero la consulta en 'audit_items' filtrando por PIN
 */
export async function fetchSessionCountsFromSupabase(pin: string): Promise<RealtimeCountUpdate[]> {
  if (!pin) return [];

  const client = getSupabaseClient();
  if (!client) {
    try {
      const local = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);
      return local ? JSON.parse(local) : [];
    } catch {
      return [];
    }
  }

  try {
    // 1. SELECT prioritario en la tabla 'audit_items' filtrando por 'pin'
    const { data: itemsData, error: itemsError } = await client
      .from('audit_items')
      .select('*')
      .eq('pin', pin)
      .order('updated_at', { ascending: false });

    if (!itemsError && itemsData && itemsData.length > 0) {
      const mapped: RealtimeCountUpdate[] = itemsData.map((row: any) => ({
        quantId: Number(row.quant_id || row.product_id || 0),
        productId: Number(row.product_id || row.quant_id || 0),
        productName: row.product_name || undefined,
        barcode: row.barcode || undefined,
        countedQuantity: Number(row.counted_quantity ?? row.qty ?? row.count ?? 0),
        systemQuantity: row.system_quantity !== undefined && row.system_quantity !== null ? Number(row.system_quantity) : undefined,
        isLocked: Boolean(row.is_locked),
        auditorName: row.auditor_name || 'Auditor',
        timestamp: row.updated_at || row.created_at || new Date().toISOString(),
        pin: row.pin,
        photoUrl: row.photo_url || undefined,
        notes: row.notes || undefined,
      }));

      try {
        localStorage.setItem(`${STORAGE_KEY_COUNTS}${pin}`, JSON.stringify(mapped));
      } catch {}

      return mapped;
    }

    // 2. Consulta de respaldo en 'audit_counts' por retrocompatibilidad
    const { data: countsData, error: countsError } = await client
      .from('audit_counts')
      .select('*')
      .eq('pin', pin)
      .order('updated_at', { ascending: false });

    if (!countsError && countsData && countsData.length > 0) {
      const mapped: RealtimeCountUpdate[] = countsData.map((row: any) => ({
        quantId: Number(row.quant_id || row.product_id || 0),
        productId: Number(row.product_id || row.quant_id || 0),
        productName: row.product_name || undefined,
        barcode: row.barcode || undefined,
        countedQuantity: Number(row.counted_quantity ?? row.qty ?? row.count ?? 0),
        systemQuantity: row.system_quantity !== undefined && row.system_quantity !== null ? Number(row.system_quantity) : undefined,
        isLocked: Boolean(row.is_locked),
        auditorName: row.auditor_name || 'Auditor',
        timestamp: row.updated_at || row.created_at || new Date().toISOString(),
        pin: row.pin,
        photoUrl: row.photo_url || undefined,
        notes: row.notes || undefined,
      }));

      try {
        localStorage.setItem(`${STORAGE_KEY_COUNTS}${pin}`, JSON.stringify(mapped));
      } catch {}

      return mapped;
    }

    // 3. Fallback a caché local
    const local = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);
    return local ? JSON.parse(local) : [];
  } catch (err) {
    console.warn('Error al recuperar conteos de Supabase:', err);
    try {
      const local = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);
      return local ? JSON.parse(local) : [];
    } catch {
      return [];
    }
  }
}

/**
 * Registra o actualiza de forma obligatoria la metadata de la sesión en Supabase mediante UPSERT o INSERT
 */
export async function registerSessionInSupabase(
  session: AuditSession,
  odooConfig?: any
): Promise<{ success: boolean; isLocal?: boolean; error?: string }> {
  // 1. Si Supabase no está configurado (o es xyzcompany), operar en Modo Soberano / Local P2P
  if (!isSupabaseConfigured()) {
    try {
      localStorage.setItem(`odoo_audit_local_session_${session.pin}`, JSON.stringify(session));
      console.info(`ℹ Operando en Modo Soberano / Local P2P para sesión ${session.pin}`);
      return { success: true, isLocal: true };
    } catch {
      return { success: true, isLocal: true };
    }
  }

  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Cliente de Supabase no disponible a pesar de tener URL configurada' };
  }

  const sessionId = session.id || `session_${session.pin}_${Date.now()}`;
  const now = new Date().toISOString();

  // Tablas compatibles soportadas (audit_sessions, inventory_sessions, sessions)
  const sessionTables = ['audit_sessions', 'inventory_sessions', 'sessions'];
  let lastError: string | null = null;
  let saved = false;

  for (const table of sessionTables) {
    try {
      // 1. Intentar con todos los campos disponibles si la tabla tiene el esquema completo
      const fullPayload: Record<string, any> = {
        id: sessionId,
        pin: session.pin,
        auditor_name: session.auditorName || 'Auditor',
        company_name: session.companyName || null,
        company_id: session.companyId || null,
        location_name: session.locationName || null,
        location_id: session.locationId || null,
        category_name: session.categoryName || null,
        category_id: session.categoryId || null,
        odoo_url: odooConfig?.url || null,
        odoo_db: odooConfig?.db || null,
        status: 'active',
        created_at: session.createdAt || now,
        updated_at: now,
      };

      const { error: fullError } = await client
        .from(table)
        .upsert(fullPayload, { onConflict: 'pin' });

      if (!fullError) {
        console.info(`✓ Sesión PIN ${session.pin} guardada en tabla '${table}' de Supabase (UPSERT exitoso)`);
        saved = true;
        break;
      }

      // Si falla por columna inexistente (schema reducido), intentar solo con columnas básicas
      if (fullError.message?.toLowerCase().includes('column') || fullError.code === '42703') {
        const basicPayload = {
          pin: session.pin,
          auditor_name: session.auditorName || 'Auditor',
          status: 'active',
          created_at: session.createdAt || now,
        };
        const { error: basicError } = await client
          .from(table)
          .upsert(basicPayload, { onConflict: 'pin' });

        if (!basicError) {
          console.info(`✓ Sesión PIN ${session.pin} guardada en tabla '${table}' de Supabase (columnas básicas)`);
          saved = true;
          break;
        } else {
          lastError = basicError.message;
        }
      } else {
        lastError = fullError.message;
      }

      // Si hay una advertencia de RLS (seguridad a nivel de filas)
      if (
        fullError?.code === '42501' ||
        fullError?.message?.toLowerCase().includes('row-level security') ||
        fullError?.message?.toLowerCase().includes('permission denied')
      ) {
        console.warn(`Aviso RLS en '${table}': ${fullError.message}. Guardando copia local para acceso inmediato.`);
        try {
          localStorage.setItem(`odoo_audit_local_session_${session.pin}`, JSON.stringify(session));
        } catch {}
        return {
          success: true,
          isLocal: false,
          error: 'RLS_WARNING',
        };
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  // Guardar siempre respaldo local
  try {
    localStorage.setItem(`odoo_audit_local_session_${session.pin}`, JSON.stringify(session));
  } catch {}

  if (saved) {
    return { success: true };
  }

  return {
    success: true,
    isLocal: true,
    error: lastError ? `Aviso de base de datos: ${lastError}` : undefined,
  };
}

/**
 * Actualiza la categoría activa de una sesión en Supabase
 */
export async function updateSessionCategoryInSupabase(
  pin: string,
  categoryId: number,
  categoryName: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client
      .from('audit_sessions')
      .update({
        category_id: categoryId,
        category_name: categoryName,
        updated_at: new Date().toISOString(),
      })
      .eq('pin', pin);
  } catch {
    // noop
  }
}

/**
 * Script SQL para inicializar las tablas 'audit_sessions', 'audit_items' y 'audit_counts' en Supabase
 */
export const SUPABASE_SQL_SCHEMA = `-- =========================================================================
-- SCRIPT SQL SUPABASE: Tablas y Políticas RLS para Odoo Inventory Auditor
-- Copiar y ejecutar en Supabase Dashboard > SQL Editor > New Query > Run
-- =========================================================================

-- 1. TABLA: audit_sessions
CREATE TABLE IF NOT EXISTS public.audit_sessions (
    id TEXT PRIMARY KEY,
    pin VARCHAR(10) NOT NULL UNIQUE,
    auditor_name VARCHAR(100) NOT NULL,
    company_name VARCHAR(150),
    company_id INTEGER,
    location_name VARCHAR(200),
    location_id INTEGER,
    category_name VARCHAR(150),
    category_id INTEGER,
    odoo_url TEXT,
    odoo_db TEXT,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA: audit_items (Productos/conteos auditados en tiempo real por PIN)
CREATE TABLE IF NOT EXISTS public.audit_items (
    id TEXT PRIMARY KEY,
    pin VARCHAR(10) NOT NULL,
    product_id BIGINT NOT NULL,
    quant_id BIGINT,
    product_name TEXT,
    barcode TEXT,
    system_quantity NUMERIC(14, 3) DEFAULT 0,
    counted_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0,
    qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
    is_locked BOOLEAN DEFAULT FALSE,
    auditor_name VARCHAR(100),
    photo_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT audit_items_pin_product_unique UNIQUE (pin, product_id)
);

-- Asegurar columnas si la tabla audit_items ya existía y admitir hasta 3 decimales
ALTER TABLE IF EXISTS public.audit_items 
    ADD COLUMN IF NOT EXISTS product_id BIGINT,
    ADD COLUMN IF NOT EXISTS quant_id BIGINT,
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS system_quantity NUMERIC(14, 3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS counted_quantity NUMERIC(14, 3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS qty NUMERIC(14, 3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS product_name TEXT,
    ADD COLUMN IF NOT EXISTS barcode TEXT,
    ADD COLUMN IF NOT EXISTS auditor_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Modificar columnas numéricas para admitir hasta 3 decimales (peso, fracciones, litros)
ALTER TABLE IF EXISTS public.audit_items 
    ALTER COLUMN counted_quantity TYPE NUMERIC(14, 3) USING counted_quantity::numeric,
    ALTER COLUMN qty TYPE NUMERIC(14, 3) USING qty::numeric,
    ALTER COLUMN system_quantity TYPE NUMERIC(14, 3) USING system_quantity::numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_items_pin_product_unique'
  ) THEN
    ALTER TABLE public.audit_items ADD CONSTRAINT audit_items_pin_product_unique UNIQUE (pin, product_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 3. TABLA: audit_counts (Compatibilidad previa)
CREATE TABLE IF NOT EXISTS public.audit_counts (
    id TEXT PRIMARY KEY,
    pin VARCHAR(10) NOT NULL,
    quant_id BIGINT NOT NULL,
    product_id BIGINT,
    product_name TEXT,
    barcode TEXT,
    counted_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
    qty NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_locked BOOLEAN DEFAULT FALSE,
    auditor_name VARCHAR(100),
    photo_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT audit_counts_pin_quant_unique UNIQUE (pin, quant_id)
);

-- 4. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.audit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_counts ENABLE ROW LEVEL SECURITY;

-- 5. POLÍTICAS RLS PÚBLICAS PARA CLAVE ANON / PUBLISHABLE (Lectura, Inserción y Upsert)
DROP POLICY IF EXISTS "Public select sessions" ON public.audit_sessions;
CREATE POLICY "Public select sessions" ON public.audit_sessions
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Public all sessions" ON public.audit_sessions;
CREATE POLICY "Public all sessions" ON public.audit_sessions
    FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public select items" ON public.audit_items;
CREATE POLICY "Public select items" ON public.audit_items
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Public all items" ON public.audit_items;
CREATE POLICY "Public all items" ON public.audit_items
    FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public all counts" ON public.audit_counts;
CREATE POLICY "Public all counts" ON public.audit_counts
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 6. HABILITAR REALTIME
ALTER TABLE public.audit_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.audit_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.audit_counts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'audit_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'audit_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'audit_counts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_counts;
  END IF;
END $$;
`;

