const multer = require('multer');
const { error, pool, numero, booleano, idParam, userId, validarRut, normalizarRut } = require('./empresaController');
const { armarF29 } = require('./periodoController');
const sii = require('../services/siiImportService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 30 },
});

const TIPOS = [
  'factura_afecta', 'factura_exenta', 'nota_credito', 'nota_debito',
  'resumen_boletas', 'resumen_vouchers', 'guia_pendiente',
];

function textoOpcional(valor, maximo) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const limpio = String(valor).trim();
  if (limpio.length > maximo) throw error('Uno de los textos es demasiado largo.', 400);
  return limpio;
}

function leerDocumento(body) {
  const datos = body || {};
  if (!['venta', 'compra'].includes(datos.tipo_operacion)) {
    throw error('La operación debe ser venta o compra.', 400);
  }
  if (!TIPOS.includes(datos.tipo_documento)) throw error('El tipo de documento no es válido.', 400);
  const periodoId = idParam(datos.periodo_id || datos.periodoId);
  let rut = textoOpcional(datos.rut_contraparte, 20);
  if (rut) {
    if (!validarRut(rut)) throw error('El RUT de la contraparte no es válido.', 400);
    rut = normalizarRut(rut);
  }
  return {
    periodo_id: periodoId,
    tipo_operacion: datos.tipo_operacion,
    tipo_documento: datos.tipo_documento,
    folio: textoOpcional(datos.folio, 20),
    rut_contraparte: rut,
    razon_contraparte: textoOpcional(datos.razon_contraparte, 160),
    monto_exento: numero(datos.monto_exento ?? 0, 'el monto exento', 0),
    monto_neto: numero(datos.monto_neto ?? 0, 'el monto neto', 0),
    monto_iva: numero(datos.monto_iva ?? 0, 'el monto de IVA', 0),
    iva_no_recuperable: numero(datos.iva_no_recuperable ?? 0, 'el IVA no recuperable', 0),
    otros_impuestos: numero(datos.otros_impuestos ?? 0, 'los otros impuestos', 0),
    acuse_recibo: booleano(datos.acuse_recibo, true),
    fuera_plazo_nc: booleano(datos.fuera_plazo_nc, false),
  };
}

async function listar(req, res) {
  const periodoId = idParam(req.query.periodo_id || req.query.periodoId);
  const operacion = req.query.tipo_operacion;
  const wordpressUserId = userId(req);
  await periodoAutorizado(pool(), periodoId, wordpressUserId);
  const valores = [periodoId, wordpressUserId];
  let filtro = '';
  if (operacion) {
    if (!['venta', 'compra'].includes(operacion)) throw error('La operación debe ser venta o compra.', 400);
    valores.push(operacion);
    filtro = ' AND d.tipo_operacion = $3';
  }
  const { rows } = await pool().query(
    `SELECT d.* FROM documentos_f29 d
     JOIN periodos_tributarios p ON p.id = d.periodo_id JOIN empresas e ON e.id = p.empresa_id
     WHERE d.periodo_id = $1 AND e.wordpress_user_id = $2${filtro} ORDER BY d.id`,
    valores
  );
  res.json({ documentos: rows });
}

async function crear(req, res) {
  const doc = leerDocumento(req.body);
  const wordpressUserId = userId(req);
  const { rows } = await pool().query(
    `INSERT INTO documentos_f29 (
      periodo_id, tipo_operacion, tipo_documento, folio, rut_contraparte, razon_contraparte,
      monto_exento, monto_neto, monto_iva, iva_no_recuperable, otros_impuestos,
      acuse_recibo, fuera_plazo_nc
    ) SELECT p.id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
      WHERE p.id = $1 AND e.wordpress_user_id = $14
    RETURNING *`,
    [
      doc.periodo_id, doc.tipo_operacion, doc.tipo_documento, doc.folio, doc.rut_contraparte,
      doc.razon_contraparte, doc.monto_exento, doc.monto_neto, doc.monto_iva,
      doc.iva_no_recuperable, doc.otros_impuestos, doc.acuse_recibo, doc.fuera_plazo_nc, wordpressUserId,
    ]
  );
  if (!rows[0]) throw error('No encontramos ese período.', 404);
  res.status(201).json({ documento: rows[0] });
}

async function editar(req, res) {
  const id = idParam(req.params.id);
  const doc = leerDocumento(req.body);
  const wordpressUserId = userId(req);
  const { rows } = await pool().query(
    `UPDATE documentos_f29 SET
      periodo_id = $1, tipo_operacion = $2, tipo_documento = $3, folio = $4,
      rut_contraparte = $5, razon_contraparte = $6, monto_exento = $7, monto_neto = $8,
      monto_iva = $9, iva_no_recuperable = $10, otros_impuestos = $11,
      acuse_recibo = $12, fuera_plazo_nc = $13
     WHERE id = $14
       AND EXISTS (
         SELECT 1 FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
         WHERE p.id = documentos_f29.periodo_id AND e.wordpress_user_id = $15
       )
       AND EXISTS (
         SELECT 1 FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
         WHERE p.id = $1 AND e.wordpress_user_id = $15
       )
     RETURNING *`,
    [
      doc.periodo_id, doc.tipo_operacion, doc.tipo_documento, doc.folio, doc.rut_contraparte,
      doc.razon_contraparte, doc.monto_exento, doc.monto_neto, doc.monto_iva,
      doc.iva_no_recuperable, doc.otros_impuestos, doc.acuse_recibo, doc.fuera_plazo_nc, id, wordpressUserId,
    ]
  );
  if (!rows[0]) throw error('No encontramos ese documento.', 404);
  res.json({ documento: rows[0] });
}

async function eliminar(req, res) {
  const id = idParam(req.params.id);
  const { rowCount } = await pool().query(
    `DELETE FROM documentos_f29 WHERE id = $1 AND EXISTS (
       SELECT 1 FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
       WHERE p.id = documentos_f29.periodo_id AND e.wordpress_user_id = $2
     )`,
    [id, userId(req)]
  );
  if (!rowCount) throw error('No encontramos ese documento.', 404);
  res.json({ ok: true });
}

function recibirArchivos(req, res) {
  return new Promise((resolve, reject) => {
    upload.array('archivos', 30)(req, res, (err) => {
      if (err) {
        reject(error('No se pudo leer los archivos. Use CSV o XML de hasta 8 MB.', 400));
        return;
      }
      resolve();
    });
  });
}

function esXml(archivo) {
  const nombre = archivo.originalname || '';
  if (/\.xml$/i.test(nombre)) return true;
  if (/\.csv$|\.txt$/i.test(nombre)) return false;
  return archivo.buffer.slice(0, 400).toString('utf8').includes('<');
}

async function periodoAutorizado(client, periodoId, wordpressUserId, lock = false) {
  const result = await client.query(
    `SELECT p.* FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
     WHERE p.id = $1 AND e.wordpress_user_id = $2${lock ? ' FOR UPDATE OF p' : ''}`,
    [periodoId, wordpressUserId]
  );
  if (!result.rows[0]) throw error('No encontramos ese período.', 404);
  return result.rows[0];
}

async function guardarClave(client, periodoId, tipoOperacion, doc, wordpressUserId) {
  const folio = doc.folio || '';
  const rut = doc.rut_contraparte || '';
  const valores = [
    doc.razon_contraparte || null,
    doc.monto_exento || 0,
    doc.monto_neto || 0,
    doc.monto_iva || 0,
    doc.iva_no_recuperable || 0,
    doc.otros_impuestos || 0,
    doc.acuse_recibo !== false,
    Boolean(doc.fuera_plazo_nc),
  ];
  const existente = await client.query(
    `SELECT d.id FROM documentos_f29 d
     JOIN periodos_tributarios p ON p.id = d.periodo_id JOIN empresas e ON e.id = p.empresa_id
     WHERE d.periodo_id = $1 AND d.tipo_operacion = $2 AND d.tipo_documento = $3
       AND COALESCE(d.folio, '') = $4 AND COALESCE(d.rut_contraparte, '') = $5
       AND e.wordpress_user_id = $6`,
    [periodoId, tipoOperacion, doc.tipo_documento, folio, rut, wordpressUserId]
  );
  if (existente.rows[0]) {
    await client.query(
      `UPDATE documentos_f29 SET
        razon_contraparte = $1, monto_exento = $2, monto_neto = $3, monto_iva = $4,
        iva_no_recuperable = $5, otros_impuestos = $6, acuse_recibo = $7, fuera_plazo_nc = $8
       WHERE id = $9 AND EXISTS (
         SELECT 1 FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
         WHERE p.id = documentos_f29.periodo_id AND e.wordpress_user_id = $10
       )`,
      valores.concat(existente.rows[0].id, wordpressUserId)
    );
    return 'actualizado';
  }
  await client.query(
    `INSERT INTO documentos_f29 (
      periodo_id, tipo_operacion, tipo_documento, folio, rut_contraparte, razon_contraparte,
      monto_exento, monto_neto, monto_iva, iva_no_recuperable, otros_impuestos,
      acuse_recibo, fuera_plazo_nc
    ) SELECT p.id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
      WHERE p.id = $1 AND e.wordpress_user_id = $14`,
    [
      periodoId, tipoOperacion, doc.tipo_documento, folio || null, rut || null,
      valores[0], valores[1], valores[2], valores[3], valores[4], valores[5], valores[6], valores[7], wordpressUserId,
    ]
  );
  return 'creado';
}

async function responderPeriodo(res, periodoId, wordpressUserId, reporte, status) {
  const periodo = await periodoAutorizado(pool(), periodoId, wordpressUserId);
  const armado = await armarF29(periodo, wordpressUserId);
  res.status(status || 200).json({ ...reporte, ...armado });
}

async function importarSii(req, res) {
  await recibirArchivos(req, res);
  const tipoOperacion = (req.body || {}).tipo_operacion;
  if (!['venta', 'compra'].includes(tipoOperacion)) throw error('La operación debe ser venta o compra.', 400);
  const periodoId = idParam((req.body || {}).periodo_id);
  const wordpressUserId = userId(req);
  const archivos = req.files || [];
  if (archivos.length === 0) throw error('Seleccione al menos un CSV o XML del SII.', 400);

  const documentos = [];
  const errores = [];
  const descartados = [];
  archivos.forEach((archivo) => {
    const nombre = archivo.originalname || 'archivo';
    if (!/\.(xml|csv|txt)$/i.test(nombre) && !esXml(archivo)) {
      errores.push({ archivo: nombre, fila: 0, motivo: 'El archivo debe ser .csv o .xml.' });
      return;
    }
    const leido = esXml(archivo)
      ? sii.leerXml(archivo.buffer, tipoOperacion, nombre)
      : sii.leerCsv(archivo.buffer, tipoOperacion, nombre);
    documentos.push(...leido.documentos);
    errores.push(...leido.errores);
    descartados.push(...leido.descartados);
  });

  const client = await pool().connect();
  let creados = 0;
  let actualizados = 0;
  try {
    await client.query('BEGIN');
    await periodoAutorizado(client, periodoId, wordpressUserId, true);
    for (let i = 0; i < documentos.length; i += 1) {
      const doc = documentos[i];
      await client.query('SAVEPOINT sp_doc');
      try {
        const accion = await guardarClave(client, periodoId, tipoOperacion, doc, wordpressUserId);
        if (accion === 'creado') creados += 1;
        else actualizados += 1;
        await client.query('RELEASE SAVEPOINT sp_doc');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT sp_doc');
        errores.push({
          archivo: doc.archivo,
          fila: doc.fila,
          folio: doc.folio,
          motivo: 'No se pudo guardar el documento.',
        });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await responderPeriodo(res, periodoId, wordpressUserId, { creados, actualizados, descartados, errores });
}

async function resumenRapido(req, res) {
  const datos = req.body || {};
  const periodoId = idParam(datos.periodo_id || datos.periodoId);
  const wordpressUserId = userId(req);
  if (datos.boletas_bruto === undefined && datos.vouchers_bruto === undefined) {
    throw error('Ingrese el monto bruto de boletas o de vouchers.', 400);
  }
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await periodoAutorizado(client, periodoId, wordpressUserId, true);
    if (datos.boletas_bruto !== undefined) {
      const bruto = numero(datos.boletas_bruto, 'las boletas', 0);
      const montos = sii.desglosarBruto(bruto);
      await guardarClave(client, periodoId, 'venta', {
        tipo_documento: 'resumen_boletas',
        folio: '39',
        razon_contraparte: 'Resumen SII boletas',
        ...montos,
        acuse_recibo: true,
      }, wordpressUserId);
    }
    if (datos.vouchers_bruto !== undefined) {
      const bruto = numero(datos.vouchers_bruto, 'los vouchers', 0);
      const montos = sii.desglosarBruto(bruto);
      await guardarClave(client, periodoId, 'venta', {
        tipo_documento: 'resumen_vouchers',
        folio: '48',
        razon_contraparte: 'Resumen SII vouchers',
        ...montos,
        acuse_recibo: true,
      }, wordpressUserId);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await responderPeriodo(res, periodoId, wordpressUserId, { ok: true });
}

module.exports = { listar, crear, editar, eliminar, importarSii, resumenRapido };
