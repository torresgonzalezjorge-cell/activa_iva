INSERT INTO empresas (
  rut,
  razon_social,
  regimen_tributario,
  tasa_ppm_pct,
  manejo_ila
)
SELECT '76543210-3', 'Comercial Activa SpA', '14D3 Pro Pyme', 1.00, 'gasto_no_recuperable'
WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE rut = '76543210-3');

INSERT INTO periodos_tributarios (
  empresa_id,
  mes,
  anio,
  valor_utm,
  remanente_anterior_utm,
  retenciones_honorarios
)
SELECT id, 11, 2026, 67294, 0, 45000
FROM empresas
WHERE rut = '76543210-3'
  AND NOT EXISTS (
    SELECT 1
    FROM periodos_tributarios
    WHERE empresa_id = empresas.id AND mes = 11 AND anio = 2026
  );

INSERT INTO documentos_f29 (
  periodo_id, tipo_operacion, tipo_documento, folio, rut_contraparte, razon_contraparte,
  monto_neto, monto_iva
)
SELECT p.id, 'venta', 'factura_afecta', '123', '76123456-0', 'Cliente Andino Ltda.', 2500000, 475000
FROM periodos_tributarios p
JOIN empresas e ON e.id = p.empresa_id
WHERE e.rut = '76543210-3' AND p.mes = 11 AND p.anio = 2026
  AND NOT EXISTS (SELECT 1 FROM documentos_f29 d WHERE d.periodo_id = p.id);

INSERT INTO documentos_f29 (
  periodo_id, tipo_operacion, tipo_documento, folio, razon_contraparte, monto_neto, monto_iva
)
SELECT p.id, 'venta', 'resumen_boletas', '11', 'Clientes varios', 800000, 152000
FROM periodos_tributarios p
JOIN empresas e ON e.id = p.empresa_id
WHERE e.rut = '76543210-3' AND p.mes = 11 AND p.anio = 2026
  AND NOT EXISTS (
    SELECT 1 FROM documentos_f29 d
    WHERE d.periodo_id = p.id AND d.tipo_documento = 'resumen_boletas'
  );

INSERT INTO documentos_f29 (
  periodo_id, tipo_operacion, tipo_documento, folio, rut_contraparte, razon_contraparte,
  monto_neto, monto_iva, acuse_recibo
)
SELECT p.id, 'compra', 'factura_afecta', '456', '76999888-8', 'Proveedor Demo Ltda.', 900000, 171000, TRUE
FROM periodos_tributarios p
JOIN empresas e ON e.id = p.empresa_id
WHERE e.rut = '76543210-3' AND p.mes = 11 AND p.anio = 2026
  AND NOT EXISTS (
    SELECT 1 FROM documentos_f29 d
    WHERE d.periodo_id = p.id AND d.tipo_operacion = 'compra'
  );
