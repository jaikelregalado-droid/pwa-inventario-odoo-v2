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

    // Extraer posible referencia entre corchetes del nombre del producto si existe: ej. "[REF-001] Tomate"
    const bracketMatch = q.productName ? q.productName.match(/^\[(.*?)\]/) : null;
    const bracketCode = bracketMatch ? bracketMatch[1].trim() : '';

    // 1. Referencia Interna de Odoo (campo 'default_code' o extraída de corchetes)
    // NUNCA ID interno numérico (productId / id)
    const rawRef = (q.defaultCode || bracketCode || '').trim();
    const internalReference = (rawRef && rawRef !== '-' && rawRef !== 'false' && rawRef !== 'null') ? rawRef : '-';

    // 2. REQUISITO CRÍTICO: Código de Barras Oficial del Sistema (campo 'barcode' de Odoo, ej: 607869262442)
    // NUNCA debe tomar un ID interno de base de datos ni la referencia interna.
    let officialBarcode = '-';
    if (q.barcode !== undefined && q.barcode !== null) {
      const bStr = String(q.barcode).trim();
      if (bStr && bStr !== '-' && bStr !== 'false' && bStr !== 'None' && bStr !== 'null' && bStr !== 'undefined') {
        // Descartar si por error fuera idéntico a un ID interno secuencial corto de base de datos
        const isDbId = (bStr === String(q.id) || bStr === String(q.productId)) && bStr.length < 7;
        if (!isDbId) {
          officialBarcode = bStr;
        }
      }
    }

    return {
      'ID Quant (Odoo)': q.id,
      'Referencia Interna': internalReference,
      'Código de Barras': officialBarcode,
      'Producto': q.productName,
      'Categoría': q.categName || 'General',
      'Ubicación': q.locationName || locationName,
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

  // Asegurar formato de texto plano ('@') para Código de Barras (columna C) y Referencia (columna B)
  // evitando notación científica (ej. 6.07869E+11) o pérdida de ceros iniciales
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:M1');
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    // Columna B: Referencia Interna
    const refCellRef = XLSX.utils.encode_cell({ r, c: 1 });
    const refCell = worksheet[refCellRef];
    if (refCell && refCell.v !== undefined && refCell.v !== null) {
      refCell.t = 's';
      refCell.z = '@';
      refCell.v = String(refCell.v);
    }

    // Columna C: Código de Barras oficial
    const barcodeCellRef = XLSX.utils.encode_cell({ r, c: 2 });
    const barcodeCell = worksheet[barcodeCellRef];
    if (barcodeCell && barcodeCell.v !== undefined && barcodeCell.v !== null) {
      barcodeCell.t = 's';
      barcodeCell.z = '@';
      barcodeCell.v = String(barcodeCell.v);
    }
  }

  // Ajustar ancho de columnas
  worksheet['!cols'] = [
    { wch: 14 }, // ID Quant
    { wch: 20 }, // Ref
    { wch: 24 }, // Barcode oficial
    { wch: 42 }, // Producto
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
