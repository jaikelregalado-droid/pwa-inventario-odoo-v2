/**
 * Cliente Odoo 17 JSON-RPC con soporte para CORS Proxy, Multicompañía y Extracción Segura de stock.quant
 */

import { OdooConnectionConfig, OdooCompany, OdooLocation, OdooCategory, QuantItem } from '../types';

/**
 * Sanitiza la URL del servidor Odoo eliminando sufijos web, hashes, parámetros y barras finales
 * Ejemplo de entrada: "https://erp.pruebas.fvgrupoempresarial.com/web#cids=1&action=12"
 * Salida: "https://erp.pruebas.fvgrupoempresarial.com"
 */
export function sanitizeOdooUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();

  // Asegurar protocolo
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    // Eliminar paths como /web, /web/login, etc.
    let pathname = parsed.pathname.replace(/\/web(\/.*)?$/i, '');
    if (pathname === '/') pathname = '';
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    // Limpieza manual con regex si falla new URL
    return url
      .replace(/\/web(\/.*)?$/i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
}

/**
 * Limpia y sanitiza referencias internas y códigos de barras
 * Elimina corchetes [ y ], comillas simples/dobles y espacios residuales
 * Ejemplo: "[REF-9940]" -> "REF-9940"
 */
export function cleanCode(val?: string | null): string {
  if (!val) return '';
  return String(val)
    .replace(/[\[\]"']/g, '')
    .trim();
}

// 1. Guardar el UID de usuario en memoria y en localStorage
let inMemoryUid: number | null = null;

export function setCachedUid(uid: number | null) {
  inMemoryUid = uid;
  if (typeof window !== 'undefined') {
    if (uid && uid > 0) {
      localStorage.setItem('odoo_auth_uid', String(uid));
    } else {
      localStorage.removeItem('odoo_auth_uid');
    }
  }
}

export function getCachedUid(): number | null {
  if (inMemoryUid && typeof inMemoryUid === 'number' && inMemoryUid > 0) {
    return inMemoryUid;
  }
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('odoo_auth_uid');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 0) {
        inMemoryUid = parsed;
        return parsed;
      }
    }
  }
  return null;
}

/**
 * 3. Auto-reautenticación antes de consultar:
 * Si el 'uid' no está presente en memoria antes de hacer loadProducts o loadInventoryData,
 * ejecuta una autenticación automática previa con las credenciales activas antes de realizar el search_read.
 */
export async function ensureAuthenticatedUid(config: OdooConnectionConfig): Promise<number> {
  if (config.uid && typeof config.uid === 'number' && config.uid > 0) {
    setCachedUid(config.uid);
    return config.uid;
  }

  const cached = getCachedUid();
  if (cached && typeof cached === 'number' && cached > 0) {
    config.uid = cached;
    return cached;
  }

  console.info('UID no presente en memoria. Ejecutando auto-reautenticación previa en Odoo 17...');
  const auth = await authenticateOdoo(config);
  config.uid = auth.uid;
  setCachedUid(auth.uid);
  return auth.uid;
}

/**
 * Ejecutor estricto JSON-RPC para Odoo 17
 * Soporta Petición Directa (Sin Proxy), Proxy Serverless Local y Proxies Públicos alternativos.
 * Envía directamente las cabeceras requeridas: Content-Type: application/json y Accept: application/json.
 */
export async function executeJsonRpc<T = any>(
  config: OdooConnectionConfig,
  service: 'common' | 'object',
  method: string,
  args: any[],
  kwargs: Record<string, any> = {}
): Promise<T> {
  const cleanBase = sanitizeOdooUrl(config.url);
  if (!cleanBase) {
    throw new Error('La URL del servidor Odoo es inválida o está vacía.');
  }

  const endpoint = `${cleanBase}/jsonrpc`;
  const rawProxy = (config.proxyUrl || 'direct').trim();

  // Configurar la URL final según el tipo de proxy seleccionado
  let requestUrl = endpoint;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (!rawProxy || rawProxy === 'direct' || rawProxy === 'none') {
    // 1. Petición Directa (Sin Proxy): Para Odoo con CORS habilitado o red local
    requestUrl = endpoint;
  } else if (rawProxy === '/api/odoo-proxy' || rawProxy.startsWith('/api/')) {
    // 2. Proxy Serverless / Middleware local integrado de la app (Sin bloqueos 403)
    requestUrl = `${rawProxy}?target=${encodeURIComponent(endpoint)}`;
    headers['x-target-url'] = endpoint;
  } else if (rawProxy.includes('allorigins.win')) {
    // 3. allorigins proxy
    if (rawProxy.endsWith('?') || rawProxy.endsWith('=')) {
      requestUrl = `${rawProxy}${encodeURIComponent(endpoint)}`;
    } else {
      requestUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(endpoint)}`;
    }
  } else if (rawProxy.endsWith('?') || rawProxy.endsWith('=')) {
    requestUrl = `${rawProxy}${encodeURIComponent(endpoint)}`;
  } else {
    requestUrl = `${rawProxy}/${endpoint}`;
  }

  // 2. Incluir UID en todas las llamadas execute_kw:
  // args debe tener la estructura exacta requerida por Odoo 17:
  // [db, uid, password_or_api_key, model, method, args_list, kwargs_dict]
  if (service === 'object' && Array.isArray(args) && args.length >= 2) {
    if (!args[1] || typeof args[1] !== 'number' || args[1] <= 0) {
      const activeUid = getCachedUid() || config.uid;
      if (activeUid && typeof activeUid === 'number') {
        args[1] = activeUid;
      }
    }
  }

  const payload = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service,
      method,
      args: service === 'object' ? [...args, kwargs] : args,
    },
    id: Math.floor(Math.random() * 10000000),
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(
          `Error HTTP 403 (Forbidden) en el proxy "${rawProxy}". El servicio de proxy público bloqueó la petición POST. Te recomendamos cambiar al "Proxy Integrado (/api/odoo-proxy)", "Petición Directa (Sin Proxy)" o "api.allorigins.win" en el selector de Proxy.`
        );
      }
      throw new Error(`Error HTTP ${response.status}: ${response.statusText} al comunicar con Odoo (${requestUrl.slice(0, 50)}...).`);
    }

    const json = await response.json();

    if (json.error) {
      const err = json.error;
      const message =
        err.data?.message ||
        err.data?.name ||
        err.message ||
        (typeof err === 'string' ? err : 'Error desconocido de Odoo');
      throw new Error(`Odoo 17 RPC Error: ${message}`);
    }

    return json.result as T;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado (25s) al conectar con Odoo. Verifica tu proxy o la red.');
    }
    // Si fue un fallo de red o CORS en modo directo
    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.name === 'TypeError')) {
      if (!rawProxy || rawProxy === 'direct') {
        throw new Error(
          `Bloqueo de CORS o falla de conexión directa con ${cleanBase}. Si el servidor Odoo no tiene CORS habilitado para este origen en el navegador, selecciona el "Proxy Integrado (/api/odoo-proxy)" o un proxy alternativo en el desplegable.`
        );
      }
    }
    throw err;
  }
}

/**
 * Autentica al usuario en Odoo 17 mediante common.authenticate
 * Obtiene el UID y busca las compañías asociadas, priorizando "FV GRUPO EMPRESARIAL, C.A."
 */
export async function authenticateOdoo(
  config: OdooConnectionConfig
): Promise<{ uid: number; companies: OdooCompany[]; activeCompany: OdooCompany }> {
  const cleanUrl = sanitizeOdooUrl(config.url);
  const { db, username, apiKey } = config;

  if (!cleanUrl || !db || !username || !apiKey) {
    throw new Error('Por favor completa todos los campos de conexión (URL, Base de Datos, Usuario y Clave).');
  }

  // 1. common.authenticate(db, login, password, user_agent_env)
  const uid = await executeJsonRpc<number | false>(
    { ...config, url: cleanUrl },
    'common',
    'authenticate',
    [db, username, apiKey, {}]
  );

  if (!uid || typeof uid !== 'number' || uid <= 0) {
    throw new Error('Credenciales incorrectas o API Key inválida.');
  }

  // 1. Guardar el UID de usuario retornado
  setCachedUid(uid);
  config.uid = uid;

  // 2. Consultar compañías accesibles por el usuario en res.company
  let companies: OdooCompany[] = [];
  try {
    companies = await executeJsonRpc<OdooCompany[]>(
      { ...config, uid },
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'res.company',
        'search_read',
        [[]], // todas las autorizadas
      ],
      {
        fields: ['id', 'name'],
        limit: 100,
      }
    );
  } catch (compErr) {
    console.warn('No se pudo consultar res.company directamente:', compErr);
    companies = [{ id: 1, name: 'FV GRUPO EMPRESARIAL, C.A.' }];
  }

  if (!companies || companies.length === 0) {
    companies = [{ id: 1, name: 'FV GRUPO EMPRESARIAL, C.A.' }];
  }

  // Buscar específicamente "FV GRUPO EMPRESARIAL, C.A." o asignar la primera
  const targetCompany =
    companies.find((c) =>
      c.name.toLowerCase().includes('fv grupo empresarial') ||
      c.name.toLowerCase().includes('fv grupo')
    ) || companies[0];

  return {
    uid,
    companies,
    activeCompany: targetCompany,
  };
}

/**
 * Recupera las categorías de producto ('product.category')
 * Deduplica estrictamente por complete_name o por ID único para evitar repeticiones.
 * Pasa el contexto de la compañía seleccionada para mayor consistencia.
 */
export async function fetchCategories(config: OdooConnectionConfig): Promise<OdooCategory[]> {
  const { db, apiKey, companyId } = config;
  const uid = await ensureAuthenticatedUid(config);

  const compId = companyId || 1;
  const context = { allowed_company_ids: [compId], company_id: compId };

  let results: Array<{ id: number; name: string; complete_name?: string }> = [];

  try {
    results = await executeJsonRpc<Array<{ id: number; name: string; complete_name?: string }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'product.category',
        'search_read',
        [[]], // sin restricciones
      ],
      {
        fields: ['id', 'name', 'complete_name'],
        limit: 0, // Carga 100% de categorías sin truncar
        order: 'complete_name asc',
        context,
      }
    );
  } catch (err) {
    console.warn('Error al consultar product.category en Odoo:', err);
    return [];
  }

  // Deduplicación estricta por complete_name normalizado y por id único
  const seenNames = new Set<string>();
  const seenIds = new Set<number>();
  const categories: OdooCategory[] = [];

  for (const cat of results || []) {
    if (!cat || typeof cat.id !== 'number') continue;
    const rawFullName = cat.complete_name || cat.name || `Categoría #${cat.id}`;
    const cleanFullName = rawFullName.trim();
    const normalizedKey = cleanFullName.toLowerCase();

    // Si ya existe el ID o el mismo complete_name, descartar duplicado
    if (seenIds.has(cat.id) || seenNames.has(normalizedKey)) {
      continue;
    }

    seenIds.add(cat.id);
    seenNames.add(normalizedKey);

    categories.push({
      id: cat.id,
      name: (cat.name || cleanFullName).trim(),
      complete_name: cleanFullName,
    });
  }

  return categories.sort((a, b) => a.complete_name.localeCompare(b.complete_name));
}

/**
 * Recupera las ubicaciones físicas de almacén ('stock.location')
 * Extrae siempre el campo 'complete_name' para evitar ambigüedades.
 * Filtra por la compañía activa si aplica.
 */
export async function fetchLocations(config: OdooConnectionConfig): Promise<OdooLocation[]> {
  const { db, apiKey, companyId } = config;
  const uid = await ensureAuthenticatedUid(config);

  const domain: any[] = [
    ['usage', 'in', ['internal', 'transit', 'inventory']],
  ];

  if (companyId) {
    domain.push(['company_id', 'in', [companyId, false]]);
  }

  const results = await executeJsonRpc<Array<{ id: number; name: string; complete_name?: string; usage: string }>>(
    config,
    'object',
    'execute_kw',
    [
      db,
      uid,
      apiKey,
      'stock.location',
      'search_read',
      [domain],
    ],
    {
      fields: ['id', 'name', 'complete_name', 'usage'],
      limit: 0, // Carga 100% de ubicaciones sin truncar
      order: 'complete_name asc',
      context: { allowed_company_ids: [companyId || 1], company_id: companyId || 1 },
    }
  );

  return (results || []).map((loc) => ({
    id: loc.id,
    name: loc.name,
    complete_name: loc.complete_name || loc.name,
    usage: loc.usage,
  }));
}

/**
 * Carga segura y flexible de productos en inventario mediante 'stock.quant' con fallback a 'product.product'
 * Reglas exactas:
 * 1. Contexto de Compañía Obligatorio: En todas las peticiones RPC (search_read) de stock.quant y product.product:
 *    context: { allowed_company_ids: [companyId], company_id: companyId }
 * 2. stock.quant:
 *    - Si no hay location_id ("Todas las ubicaciones"): dominio []
 *    - Si hay location_id: [['location_id', 'child_of', locationId]]
 *    - Campos planos: ['id', 'product_id', 'location_id', 'quantity', 'inventory_quantity']
 * 3. Búsqueda de Reserva (Fallback) en product.product:
 *    - Dominio permisivo: [['active', '=', true], ['sale_ok', '=', true]]
 *    - Campos planos: ['id', 'display_name', 'default_code', 'barcode', 'categ_id', 'qty_available']
 * 4. Mapeo de Productos:
 *    - Asigna 'qty_available' como la cantidad teórica en stock (QS), permitiendo auditar de inmediato
 *      aunque no existan quants creados previamente en esa ubicación.
 */
export async function fetchQuants(
  config: OdooConnectionConfig,
  locationId?: number,
  categoryId?: number,
  searchQuery?: string
): Promise<QuantItem[]> {
  const { db, apiKey, companyId } = config;
  const uid = await ensureAuthenticatedUid(config);
  if (!uid || typeof uid !== 'number' || uid <= 0) {
    throw new Error('Credenciales incorrectas o API Key inválida.');
  }

  const compId = companyId || 1;

  // 1. Contexto de Compañía para stock.quant y product.product
  const companyContext = {
    allowed_company_ids: [compId],
    company_id: compId,
  };

  // 1.1 Localizar obligatoriamente la ubicación principal 'WH/Existencias' (o internas que inicien por WH)
  // Ignorando por completo sedes ajenas como ZL, clientes o proveedores
  let whLocationIds: number[] = [];
  let mainWhLocationId: number | undefined = undefined;

  try {
    const locResults = await executeJsonRpc<Array<{ id: number; name: string; complete_name?: string; usage: string }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'stock.location',
        'search_read',
        [[
          ['usage', '=', 'internal'],
          '|',
          ['complete_name', 'ilike', 'WH%'],
          ['name', 'ilike', 'Existencias%']
        ]],
      ],
      {
        fields: ['id', 'name', 'complete_name', 'usage'],
        limit: 0,
        context: companyContext,
      }
    );

    if (locResults && locResults.length > 0) {
      // Filtrar estrictamente: descartar ZL, clientes, proveedores y no internas
      const cleanWhLocs = locResults.filter((l) => {
        const full = (l.complete_name || l.name || '').toUpperCase();
        return (
          (full.startsWith('WH') || full.includes('EXISTENCIAS')) &&
          !full.startsWith('ZL') &&
          !full.includes('/ZL') &&
          !full.includes('CLIENTES') &&
          !full.includes('PROVEEDORES') &&
          !full.includes('CUSTOMER') &&
          !full.includes('PARTNER')
        );
      });

      // Priorizar la ubicación específica 'WH/Existencias'
      const existenciasLoc = cleanWhLocs.find((l) => {
        const full = (l.complete_name || l.name || '').toUpperCase();
        return full === 'WH/EXISTENCIAS' || full.includes('WH/EXISTENCIAS');
      }) || cleanWhLocs[0];

      if (existenciasLoc) {
        mainWhLocationId = existenciasLoc.id;
      }
      whLocationIds = cleanWhLocs.map((l) => l.id);
    }
  } catch (locErr) {
    console.warn('Error resolviendo ubicaciones WH en stock.location:', locErr);
  }

  // 2. Dominio en stock.quant:
  // - Filtrar OBLIGATORIAMENTE por ubicación principal WH/Existencias (o ubicaciones internas con usage = 'internal' que inicien por WH)
  // - Filtrar por categoría seleccionada si aplica
  const quantDomain: any[] = [];

  if (locationId) {
    quantDomain.push(['location_id', 'child_of', locationId]);
  } else if (mainWhLocationId) {
    quantDomain.push(['location_id', 'child_of', mainWhLocationId]);
  } else if (whLocationIds.length > 0) {
    quantDomain.push(['location_id', 'in', whLocationIds]);
  } else {
    // Si no se pudieron precargar IDs, usar dominio directo en RPC
    quantDomain.push(['location_id.usage', '=', 'internal']);
    quantDomain.push(['location_id.complete_name', 'ilike', 'WH%']);
  }

  if (categoryId) {
    quantDomain.push(['product_id.categ_id', 'child_of', categoryId]);
  }

  let rawQuants: Array<{
    id: number;
    product_id: [number, string] | number | false;
    location_id: [number, string] | number | false;
    quantity: number;
    inventory_quantity?: number;
  }> = [];

  let quantError: Error | null = null;

  try {
    rawQuants = await executeJsonRpc<Array<{
      id: number;
      product_id: [number, string] | number | false;
      location_id: [number, string] | number | false;
      quantity: number;
      inventory_quantity?: number;
    }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'stock.quant',
        'search_read',
        [quantDomain],
      ],
      {
        fields: ['id', 'product_id', 'location_id', 'quantity', 'inventory_quantity'],
        limit: 0, // Carga el 100% de los quants sin truncar a 500
        context: companyContext,
      }
    );
  } catch (err: any) {
    console.warn('Fallo en búsqueda directa de stock.quant con filtro estricto, intentando simplificado con IDs:', err);
    try {
      const fallbackDomain: any[] = [];
      if (mainWhLocationId) {
        fallbackDomain.push(['location_id', 'child_of', mainWhLocationId]);
      } else if (whLocationIds.length > 0) {
        fallbackDomain.push(['location_id', 'in', whLocationIds]);
      }
      if (categoryId) {
        fallbackDomain.push(['product_id.categ_id', 'child_of', categoryId]);
      }
      rawQuants = await executeJsonRpc(
        config,
        'object',
        'execute_kw',
        [db, uid, apiKey, 'stock.quant', 'search_read', [fallbackDomain]],
        {
          fields: ['id', 'product_id', 'location_id', 'quantity', 'inventory_quantity'],
          limit: 0,
          context: companyContext,
        }
      );
    } catch (e2) {
      quantError = err instanceof Error ? err : new Error(String(err?.message || err));
      rawQuants = [];
    }
  }

  // 3. Consulta de Catálogo product.product filtrado directamente por categ_id (100% de ítems sin límite)
  // Permite traer todos los productos de la categoría seleccionada, incluso si aún no tienen stock.quant
  let catalogProducts: Array<{
    id: number;
    name?: string;
    display_name?: string;
    default_code?: string | false;
    barcode?: string | false;
    categ_id?: [number, string] | false;
  }> = [];

  const productDomain: any[] = [];
  if (categoryId) {
    productDomain.push(['categ_id', 'child_of', categoryId]);
  }

  try {
    catalogProducts = await executeJsonRpc<Array<{
      id: number;
      name?: string;
      display_name?: string;
      default_code?: string | false;
      barcode?: string | false;
      categ_id?: [number, string] | false;
    }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'product.product',
        'search_read',
        [productDomain],
      ],
      {
        fields: ['id', 'name', 'display_name', 'default_code', 'barcode', 'categ_id'],
        limit: 0, // Carga 100% del catálogo sin truncar a 500
        context: companyContext,
      }
    );
  } catch (productErr: any) {
    console.warn('Consulta en product.product:', productErr);
    if (!rawQuants || rawQuants.length === 0) {
      if (quantError) {
        throw new Error(`[Odoo Error] stock.quant: ${quantError.message} | product.product: ${productErr.message}`);
      }
      throw productErr;
    }
  }

  // Mapa de productos de catálogo por ID para enriquecimiento inmediato
  const catalogMap = new Map<number, typeof catalogProducts[0]>();
  for (const p of catalogProducts) {
    catalogMap.set(p.id, p);
  }

  // 4. AGRUPAR POR PRODUCTO ÚNICO (Map con clave productId)
  // Garantiza que cada producto aparezca UNA SOLA VEZ en la interfaz con la cantidad en la ubicación principal WH,
  // ignorando por completo ubicaciones externas, de clientes, proveedores o de otras sedes (como ZL).
  const itemsByProduct = new Map<number, QuantItem>();

  for (const q of rawQuants || []) {
    let pId = 0;
    let rawProdName = 'Producto Sin Nombre';

    if (Array.isArray(q.product_id)) {
      pId = q.product_id[0];
      rawProdName = q.product_id[1] || rawProdName;
    } else if (typeof q.product_id === 'number') {
      pId = q.product_id;
      rawProdName = `Producto #${pId}`;
    }

    if (!pId || pId <= 0) continue;

    const locId = Array.isArray(q.location_id) ? q.location_id[0] : Number(q.location_id) || 1;
    const locName = Array.isArray(q.location_id)
      ? q.location_id[1]
      : `Ubicación #${locId}`;

    // Validar ubicación: ignorar sedes ajenas como ZL, clientes, proveedores o virtuales
    const locNameUpper = locName.toUpperCase();
    const isWh =
      (locNameUpper.startsWith('WH') || locNameUpper.includes('EXISTENCIAS')) &&
      !locNameUpper.startsWith('ZL') &&
      !locNameUpper.includes('/ZL') &&
      !locNameUpper.includes('CLIENTES') &&
      !locNameUpper.includes('PROVEEDORES') &&
      !locNameUpper.includes('PARTNER') &&
      !locNameUpper.includes('CUSTOMER');

    if (!isWh) continue;

    const systemQty = Number(q.quantity) || 0;
    const invQty = Number(q.inventory_quantity) || 0;

    // Si ya existe este producto en el mapa, agruparlo / sumar el stock en WH
    // Si ya existe este producto en el mapa, agruparlo / sumar el stock en WH
    if (itemsByProduct.has(pId)) {
      const existing = itemsByProduct.get(pId)!;
      existing.quantity += systemQty;
      existing.inventoryQuantity = (existing.inventoryQuantity || 0) + invQty;
      // BLIND COUNT: Por defecto en 0 para obligar a realizar el conteo físico desde cero
      existing.countedQuantity = 0;
      existing.difference = -existing.quantity;
      continue;
    }

    const catalogProd = catalogMap.get(pId);
    if (catalogProd?.display_name) {
      rawProdName = catalogProd.display_name;
    }

    const bracketMatch = rawProdName.match(/^\[(.*?)\]/);
    const bracketCode = bracketMatch ? cleanCode(bracketMatch[1]) : '';

    let cleanName = rawProdName.replace(/^\[.*?\]\s*/, '').trim();
    if (!cleanName) {
      cleanName = rawProdName.trim();
    }

    const defaultCode =
      cleanCode(catalogProd?.default_code ? String(catalogProd.default_code) : '') || bracketCode;
    const barcode = cleanCode(catalogProd?.barcode ? String(catalogProd.barcode) : '');

    let itemCategId = categoryId;
    let itemCategName: string | undefined;
    if (catalogProd && Array.isArray(catalogProd.categ_id)) {
      itemCategId = catalogProd.categ_id[0];
      itemCategName = catalogProd.categ_id[1];
    }

    // BLIND COUNT: Por defecto en 0 para obligar a realizar el conteo físico desde cero
    const initialCounted = 0;

    const item: QuantItem = {
      id: q.id,
      productId: pId,
      productName: cleanName,
      defaultCode,
      barcode,
      locationId: locId,
      locationName: locName,
      categId: itemCategId,
      categName: itemCategName,
      companyId: compId,
      quantity: systemQty,
      inventoryQuantity: invQty,
      countedQuantity: initialCounted,
      difference: initialCounted - systemQty,
      isLocked: false,
      syncedToOdoo: false,
    };

    itemsByProduct.set(pId, item);
  }

  // 5. Incluir productos de la categoría que no tenían registro en stock.quant (1 sola vez por producto con quantity: 0)
  for (const p of catalogProducts) {
    if (itemsByProduct.has(p.id)) continue;

    const rawName = p.display_name || p.name || `Producto #${p.id}`;
    const bracketMatch = rawName.match(/^\[(.*?)\]/);
    const bracketCode = bracketMatch ? cleanCode(bracketMatch[1]) : '';

    let cleanName = rawName.replace(/^\[.*?\]\s*/, '').trim();
    if (!cleanName) cleanName = rawName.trim();

    const defaultCode = cleanCode(p.default_code ? String(p.default_code) : '') || bracketCode;
    const barcode = cleanCode(p.barcode ? String(p.barcode) : '');

    let itemCategId = categoryId;
    let itemCategName: string | undefined;
    if (Array.isArray(p.categ_id)) {
      itemCategId = p.categ_id[0];
      itemCategName = p.categ_id[1];
    }

    const item: QuantItem = {
      id: -p.id, // ID negativo temporal para productos sin quant inicial
      productId: p.id,
      productName: cleanName,
      defaultCode,
      barcode,
      locationId: mainWhLocationId || locationId || 1,
      locationName: 'WH/Existencias',
      categId: itemCategId,
      categName: itemCategName,
      companyId: compId,
      quantity: 0,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: 0,
      syncedToOdoo: false,
    };

    itemsByProduct.set(p.id, item);
  }

  let items = Array.from(itemsByProduct.values());

  // 6. Si quedaron productos sin barcode y faltan datos de catálogo, enriquecer de forma segura
  const missingBarcodeItems = items.filter((i) => !i.barcode && i.productId > 0 && !catalogMap.has(i.productId));
  if (missingBarcodeItems.length > 0) {
    try {
      const missingIds = Array.from(new Set(missingBarcodeItems.map((i) => i.productId)));
      const extraProds = await executeJsonRpc<Array<{
        id: number;
        default_code?: string | false;
        barcode?: string | false;
        categ_id?: [number, string] | false;
      }>>(
        config,
        'object',
        'execute_kw',
        [
          db,
          uid,
          apiKey,
          'product.product',
          'search_read',
          [[['id', 'in', missingIds]]],
        ],
        {
          fields: ['id', 'default_code', 'barcode', 'categ_id'],
          limit: 0, // Sin truncar
          context: companyContext,
        }
      );

      const extraMap = new Map(extraProds.map((p) => [p.id, p]));
      for (const item of items) {
        const ep = extraMap.get(item.productId);
        if (ep) {
          if (ep.barcode && !item.barcode) item.barcode = cleanCode(String(ep.barcode));
          if (ep.default_code && !item.defaultCode) item.defaultCode = cleanCode(String(ep.default_code));
          if (Array.isArray(ep.categ_id) && !item.categId) {
            item.categId = ep.categ_id[0];
            item.categName = ep.categ_id[1];
          }
        }
      }
    } catch {
      // Ignorar fallo secundario de enriquecimiento
    }
  }

  if (searchQuery) {
    const qClean = searchQuery.toLowerCase().trim();
    items = items.filter(
      (item) =>
        item.productName.toLowerCase().includes(qClean) ||
        item.defaultCode.toLowerCase().includes(qClean) ||
        item.barcode.toLowerCase().includes(qClean)
    );
  }

  return items;
}

/**
 * Enviar Ajuste a Odoo 17 (Seguro)
 * REGLA CRÍTICA:
 * - Envía ÚNICAMENTE el valor numérico de QC al campo 'inventory_quantity' del modelo 'stock.quant'
 * - NO sobreescribe la cantidad teórica ('quantity' / QS)
 * - Permite al supervisor validar y asentar el ajuste desde Odoo con cálculo exacto de diferencia.
 */
export async function sendInventoryAdjustmentToOdoo(
  config: OdooConnectionConfig,
  items: { id: number; countedQuantity: number; productId?: number; locationId?: number }[]
): Promise<{ successCount: number; failedCount: number; errors: string[] }> {
  const { db, apiKey, companyId } = config;
  const uid = await ensureAuthenticatedUid(config);
  if (!uid || typeof uid !== 'number' || uid <= 0) {
    throw new Error('Credenciales incorrectas o API Key inválida.');
  }

  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  const compId = companyId || 1;
  const context = { allowed_company_ids: [compId], company_id: compId };

  for (const item of items) {
    try {
      let updated = false;

      // 1. Intentar escribir sobre 'inventory_quantity' en stock.quant
      try {
        const writeResult = await executeJsonRpc<boolean>(
          config,
          'object',
          'execute_kw',
          [
            db,
            uid,
            apiKey,
            'stock.quant',
            'write',
            [
              [item.id],
              {
                inventory_quantity: item.countedQuantity,
              },
            ],
          ],
          { context }
        );
        if (writeResult) {
          updated = true;
          successCount++;
        }
      } catch {
        updated = false;
      }

      if (updated) continue;

      // 2. Si falló (ej. producto cargado por fallback sin registro previo en stock.quant):
      const prodId = item.productId || item.id;
      const locId = item.locationId || 1;

      // Buscar si ya existe un quant para este producto y ubicación
      const existingQuants = await executeJsonRpc<Array<{ id: number }>>(
        config,
        'object',
        'execute_kw',
        [
          db,
          uid,
          apiKey,
          'stock.quant',
          'search_read',
          [[['product_id', '=', prodId], ['location_id', '=', locId]]],
        ],
        { fields: ['id'], limit: 1, context }
      ).catch(() => []);

      if (existingQuants && existingQuants.length > 0) {
        await executeJsonRpc<boolean>(
          config,
          'object',
          'execute_kw',
          [
            db,
            uid,
            apiKey,
            'stock.quant',
            'write',
            [
              [existingQuants[0].id],
              {
                inventory_quantity: item.countedQuantity,
              },
            ],
          ],
          { context }
        );
        successCount++;
      } else {
        // Crear el registro en stock.quant con el valor de inventario físico contado
        await executeJsonRpc<number>(
          config,
          'object',
          'execute_kw',
          [
            db,
            uid,
            apiKey,
            'stock.quant',
            'create',
            [
              {
                product_id: prodId,
                location_id: locId,
                inventory_quantity: item.countedQuantity,
              },
            ],
          ],
          { context }
        );
        successCount++;
      }
    } catch (err: any) {
      failedCount++;
      errors.push(`Quant #${item.id}: ${err.message || 'Error al actualizar en Odoo'}`);
    }
  }

  return { successCount, failedCount, errors };
}

/**
 * Datos demo realistas de FV GRUPO EMPRESARIAL, C.A. para auditoría offline o pruebas
 */
export function getDemoFVGrupoData(): {
  locations: OdooLocation[];
  categories: OdooCategory[];
  quants: QuantItem[];
} {
  const locations: OdooLocation[] = [
    { id: 101, name: 'Existencias', complete_name: 'WH/Existencias', usage: 'internal' },
    { id: 102, name: 'Piso de Venta', complete_name: 'WH/Sucursal Centro/Piso de Venta', usage: 'internal' },
    { id: 103, name: 'Almacén Repuestos', complete_name: 'WH/Taller/Almacén Repuestos', usage: 'internal' },
    { id: 104, name: 'Cuarentena / Dañados', complete_name: 'WH/Control Calidad/Cuarentena', usage: 'inventory' },
  ];

  const categories: OdooCategory[] = [
    { id: 206, name: 'Frutas y Verduras', complete_name: 'Alimentos / Frutas y Verduras' },
    { id: 201, name: 'Lubricantes y Fluidos', complete_name: 'Automotriz / Lubricantes y Fluidos' },
    { id: 202, name: 'Filtros y Mantenimiento', complete_name: 'Automotriz / Filtros y Mantenimiento' },
    { id: 203, name: 'Frenos y Suspensión', complete_name: 'Repuestos / Frenos y Suspensión' },
    { id: 204, name: 'Herramientas y Equipos', complete_name: 'Ferretería / Herramientas y Equipos' },
    { id: 205, name: 'Baterías y Eléctrico', complete_name: 'Electricidad / Baterías y Eléctrico' },
  ];

  const quants: QuantItem[] = [
    {
      id: 507,
      productId: 1007,
      productName: 'Tomate Perita FV Por Peso',
      defaultCode: 'TOM-PERITA-FV',
      barcode: '7591234001077',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 206,
      categName: 'Frutas y Verduras',
      companyId: 1,
      quantity: 135.93,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -135.93,
      isLocked: false,
    },
    {
      id: 501,
      productId: 1001,
      productName: 'Aceite Sintético 5W-30 Ultra Protection 1L',
      defaultCode: 'LUB-5W30-01',
      barcode: '7591234001015',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 201,
      categName: 'Lubricantes y Fluidos',
      companyId: 1,
      quantity: 48,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -48,
      isLocked: false,
    },
    {
      id: 502,
      productId: 1002,
      productName: 'Filtro de Aceite Blindado Heavy Duty PH-4967',
      defaultCode: 'FIL-PH-4967',
      barcode: '7591234001022',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 202,
      categName: 'Filtros y Mantenimiento',
      companyId: 1,
      quantity: 24,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -24,
      isLocked: false,
    },
    {
      id: 503,
      productId: 1003,
      productName: 'Pastillas de Freno Delanteras Cerámica D-866',
      defaultCode: 'BRK-D866-CER',
      barcode: '7591234001039',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 203,
      categName: 'Frenos y Suspensión',
      companyId: 1,
      quantity: 15,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -15,
      isLocked: false,
    },
    {
      id: 504,
      productId: 1004,
      productName: 'Batería Automotriz 12V 70Ah 650CCA Libre Mant.',
      defaultCode: 'BAT-12V-70AH',
      barcode: '7591234001046',
      locationId: 102,
      locationName: 'FV/Sucursal Centro/Piso de Venta',
      categId: 205,
      categName: 'Baterías y Eléctrico',
      companyId: 1,
      quantity: 10,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -10,
      isLocked: false,
    },
    {
      id: 505,
      productId: 1005,
      productName: 'Refrigerante Orgánico Larga Vida 50/50 3.785L',
      defaultCode: 'REF-ORG-5050',
      barcode: '7591234001053',
      locationId: 102,
      locationName: 'FV/Sucursal Centro/Piso de Venta',
      categId: 201,
      categName: 'Lubricantes y Fluidos',
      companyId: 1,
      quantity: 32,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -32,
      isLocked: false,
    },
    {
      id: 506,
      productId: 1006,
      productName: 'Juego de Llaves Combinadas Cromo Vanadio 8-19mm',
      defaultCode: 'HRR-LLV-COMB819',
      barcode: '7591234001060',
      locationId: 103,
      locationName: 'FV/Taller/Almacén Repuestos',
      categId: 204,
      categName: 'Herramientas y Equipos',
      companyId: 1,
      quantity: 6,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -6,
      isLocked: false,
    },
    {
      id: 507,
      productId: 1007,
      productName: 'Líquido de Frenos DOT 4 Racing Formula 500ml',
      defaultCode: 'LUB-DOT4-500',
      barcode: '7591234001077',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 201,
      categName: 'Lubricantes y Fluidos',
      companyId: 1,
      quantity: 60,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -60,
      isLocked: false,
    },
    {
      id: 508,
      productId: 1008,
      productName: 'Amortiguador Trasero a Gas Reforzado HD',
      defaultCode: 'SUS-AMORT-GAS-HD',
      barcode: '7591234001084',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 203,
      categName: 'Frenos y Suspensión',
      companyId: 1,
      quantity: 8,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -8,
      isLocked: false,
    }
  ];

  return { locations, categories, quants };
}
