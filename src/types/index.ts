/**
 * Tipos de datos para la aplicación de Auditoría de Inventario Odoo 17 + Supabase Realtime
 */

export interface OdooConnectionConfig {
  url: string;             // URL limpia del servidor Odoo (ej: https://erp.pruebas.fvgrupoempresarial.com)
  db: string;              // Nombre de la base de datos
  username: string;        // Usuario o correo electrónico
  apiKey: string;          // Contraseña o API Key de Odoo
  proxyUrl: string;        // URL del proxy CORS (ej: https://corsproxy.io/?)
  uid?: number;            // ID de usuario obtenido tras autenticación
  companyId?: number;      // ID de compañía seleccionada (ej: FV GRUPO EMPRESARIAL, C.A.)
  companyName?: string;    // Nombre de la compañía
  allowedCompanyIds?: number[];
}

export interface OdooCompany {
  id: number;
  name: string;
  currency_id?: [number, string];
}

export interface OdooLocation {
  id: number;
  name: string;
  complete_name: string;   // Ej: 'WH/Stock/Existencias'
  usage: string;           // 'internal', 'inventory', etc.
}

export interface OdooCategory {
  id: number;
  name: string;
  complete_name: string;
}

export interface QuantItem {
  id: number;                     // ID de stock.quant en Odoo
  productId: number;              // ID de product.product
  productName: string;            // Nombre limpio del producto (display_name)
  defaultCode: string;            // Referencia interna limpia (sin corchetes)
  barcode: string;                // Código de barras limpio
  locationId: number;             // ID de ubicación stock.location
  locationName: string;           // Nombre completo de la ubicación
  categId?: number;               // ID de product.category
  categName?: string;             // Nombre de categoría
  companyId?: number;             // ID de la compañía
  quantity: number;               // QS: Cantidad Teórica en Sistema (NO se sobreescribe)
  inventoryQuantity: number;      // Cantidad en inventario registrada previamente en Odoo
  countedQuantity: number;        // QC: Cantidad Contada en físico por los auditores
  difference: number;             // DQ: QC - QS (Diferencia)
  isLocked?: boolean;             // Candado de inmovilización: congela la cantidad del sistema (QS)
  lastAuditedBy?: string;         // Nombre del auditor que hizo el último conteo
  lastAuditedAt?: string;         // Marca de tiempo ISO
  photoUrl?: string;              // Imagen de evidencia capturada desde la cámara móvil
  syncedToOdoo?: boolean;         // Si ya fue enviado a Odoo (inventory_quantity)
  notes?: string;                 // Notas de auditoría opcionales
}

export interface AuditSession {
  id?: string;                    // ID único de sesión en Supabase
  pin: string;                    // PIN de 4 dígitos
  auditorName: string;            // Nombre del auditor en el dispositivo
  role: 'lead' | 'auditor';
  createdAt: string;
  companyName: string;
  companyId?: number;
  locationName: string;
  locationId?: number;
  categoryId?: number;
  categoryName?: string;
}

export interface RealtimeCountUpdate {
  quantId: number;
  productId?: number;
  productName?: string;
  barcode?: string;
  countedQuantity: number;
  systemQuantity?: number;
  isLocked?: boolean;
  auditorName: string;
  timestamp: string;
  pin: string;
  photoUrl?: string;
  notes?: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  tableName: string;              // por defecto 'audit_counts'
  connected: boolean;
}

export interface AuditorPresence {
  id: string;
  name: string;
  pin: string;
  device: string;
  joinedAt: string;
  lastActive: string;
}
