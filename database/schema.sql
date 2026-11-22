CREATE TABLE IF NOT EXISTS empresas (
  id SERIAL PRIMARY KEY,
  rut VARCHAR(12) NOT NULL,
  wordpress_user_id BIGINT,
  razon_social VARCHAR(160) NOT NULL,
  regimen_tributario VARCHAR(32) NOT NULL DEFAULT '14D3 Pro Pyme'
    CHECK (regimen_tributario IN ('14D3 Pro Pyme', '14D8 Transparente', '14A General')),
  tasa_ppm_pct NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  manejo_ila VARCHAR(24) NOT NULL DEFAULT 'gasto_no_recuperable'
    CHECK (manejo_ila IN ('gasto_no_recuperable', 'retenedor_ila')),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS wordpress_user_id BIGINT;
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_rut_key;
CREATE UNIQUE INDEX IF NOT EXISTS empresas_wordpress_user_rut_idx ON empresas (wordpress_user_id, rut);

CREATE TABLE IF NOT EXISTS periodos_tributarios (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  anio SMALLINT NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  valor_utm NUMERIC(10,2) NOT NULL DEFAULT 67294,
  remanente_anterior_utm NUMERIC(10,4) NOT NULL DEFAULT 0,
  ventas_proyectadas_netas NUMERIC(12,2) NOT NULL DEFAULT 0,
  compras_proyectadas_netas NUMERIC(12,2) NOT NULL DEFAULT 0,
  retenciones_honorarios NUMERIC(12,2) NOT NULL DEFAULT 0,
  postergar_iva BOOLEAN NOT NULL DEFAULT FALSE,
  iva_postergado_vencido NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(10) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  UNIQUE (empresa_id, mes, anio)
);

CREATE TABLE IF NOT EXISTS documentos_f29 (
  id SERIAL PRIMARY KEY,
  periodo_id INTEGER NOT NULL REFERENCES periodos_tributarios(id) ON DELETE CASCADE,
  tipo_operacion VARCHAR(10) NOT NULL CHECK (tipo_operacion IN ('venta', 'compra')),
  tipo_documento VARCHAR(20) NOT NULL CHECK (tipo_documento IN (
    'factura_afecta', 'factura_exenta', 'nota_credito', 'nota_debito',
    'resumen_boletas', 'resumen_vouchers', 'guia_pendiente'
  )),
  folio VARCHAR(20),
  rut_contraparte VARCHAR(12),
  razon_contraparte VARCHAR(160),
  monto_exento NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_neto NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_no_recuperable NUMERIC(12,2) NOT NULL DEFAULT 0,
  otros_impuestos NUMERIC(12,2) NOT NULL DEFAULT 0,
  acuse_recibo BOOLEAN NOT NULL DEFAULT TRUE,
  fuera_plazo_nc BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS periodos_empresa_idx ON periodos_tributarios (empresa_id, anio, mes);
CREATE INDEX IF NOT EXISTS documentos_periodo_idx ON documentos_f29 (periodo_id, tipo_operacion);
CREATE UNIQUE INDEX IF NOT EXISTS documentos_f29_clave_sii
  ON documentos_f29 (
    periodo_id,
    tipo_operacion,
    tipo_documento,
    COALESCE(folio, ''),
    COALESCE(rut_contraparte, '')
  );
