/**
 * Generador de reportes de auditoría en formato Excel (.xlsx) con la librería xlsx
 */

import * as XLSX from 'xlsx';
import { QuantItem } from '../types';

export function exportAuditToExcel(
  items: QuantItem[],
  locationName: string,
  companyName: string,
  sessionPin: string
) {
  if (!items || items.length === 0) {
    throw new Error('No hay productos en la lista para exportar.');
  }

  // Mapear los datos para las filas
  const rows = items.map((q) => {
    let status = 'Exacto (Sin diferencia)';
    if (q.difference < 0) {
      status = `Faltante (${q.difference})`;
    } else if (q.difference > 0) {
      status = `Sobrante (+${q.difference})`;
    }

    return {
      'ID Quant (Odoo)': q.id,
      'Referencia Interna': q.defaultCode || '-',
      'Código de Barras': q.barcode || '-',
      'Producto': q.productName,
      'Categoría': q.categName || 'General',
      'Ubicación': q.locationName,
      'QS (Sistema Odoo)': q.quantity,
      'QC (Físico Contado)': q.countedQuantity,
      'DQ (Diferencia)': q.difference,
      'Estado Auditoría': status,
      'Auditor': q.lastAuditedBy || 'No especificado',
      'Último Conteo': q.lastAuditedAt ? new Date(q.lastAuditedAt).toLocaleString() : '-',
      'Enviado a Odoo': q.syncedToOdoo ? 'Sí' : 'Pendiente',
    };
  });

  // Crear hoja de cálculo
  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Ajustar ancho de columnas
  worksheet['!cols'] = [
    { wch: 14 }, // ID Quant
    { wch: 18 }, // Ref
    { wch: 18 }, // Barcode
    { wch: 38 }, // Producto
    { wch: 22 }, // Categoría
    { wch: 26 }, // Ubicación
    { wch: 16 }, // QS
    { wch: 18 }, // QC
    { wch: 14 }, // DQ
    { wch: 22 }, // Estado
    { wch: 18 }, // Auditor
    { wch: 20 }, // Fecha
    { wch: 16 }, // Sincronizado
  ];

  // Crear libro de trabajo
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Auditoría Física');

  // Metadatos
  const cleanLoc = locationName.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 25);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const filename = `Auditoria_Odoo17_${cleanLoc}_PIN${sessionPin}_${dateStr}.xlsx`;

  XLSX.writeFile(workbook, filename);
}
