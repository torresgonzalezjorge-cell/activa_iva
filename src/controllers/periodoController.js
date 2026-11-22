const { calcularF29 } = require('../services/f29Engine');
const { error, pool, numero, booleano, idParam, userId } = require('./empresaController');

function mesAnio(valorMes, valorAnio) {
  const mes = Number(valorMes);
  const anio = Number(valorAnio);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw error('El mes debe estar entre 1 y 12.', 400);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw error('El año no es válido.', 400);
  return { mes, anio };
}

async function documentosDe(periodoId, wordpressUserId) {
  const { rows } = await pool().query(
    `SELECT d.* FROM documentos_f29 d
     JOIN periodos_tributarios p ON p.id = d.periodo_id
     JOIN empresas e ON e.id = p.empresa_id
     WHERE p.id = $1 AND e.wordpress_user_id = $2 ORDER BY d.tipo_operacion, d.id`,
    [periodoId, wordpressUserId]
  );
  return rows;
}

async function armarF29(periodo, wordpressUserId) {
  if (!periodo) throw error('No encontramos ese período.', 404);
  const empresa = await pool().query(
    `SELECT e.* FROM empresas e
     JOIN periodos_tributarios p ON p.empresa_id = e.id
     WHERE p.id = $1 AND e.wordpress_user_id = $2`,
    [periodo.id, wordpressUserId]
  );
  if (!empresa.rows[0]) throw error('No encontramos la empresa del período.', 404);
  const documentos = await documentosDe(periodo.id, wordpressUserId);
  return {
    periodo,
    empresa: empresa.rows[0],
    documentos,
    f29: calcularF29({ periodo, empresa: empresa.rows[0], documentos }),
  };
}

async function asegurar(req, res) {
  const empresaId = idParam(req.query.empresa_id || req.query.empresaId);
  const wordpressUserId = userId(req);
  const { mes, anio } = mesAnio(req.query.mes, req.query.anio);
  const existe = await pool().query('SELECT id FROM empresas WHERE id = $1 AND wordpress_user_id = $2', [empresaId, wordpressUserId]);
  if (!existe.rows[0]) throw error('No encontramos esa empresa.', 404);
  await pool().query(
    `INSERT INTO periodos_tributarios (empresa_id, mes, anio)
     SELECT id, $2, $3 FROM empresas WHERE id = $1 AND wordpress_user_id = $4
     ON CONFLICT (empresa_id, mes, anio) DO NOTHING`,
    [empresaId, mes, anio, wordpressUserId]
  );
  const { rows } = await pool().query(
    `SELECT p.* FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
     WHERE p.empresa_id = $1 AND p.mes = $2 AND p.anio = $3 AND e.wordpress_user_id = $4`,
    [empresaId, mes, anio, wordpressUserId]
  );
  res.json(await armarF29(rows[0], wordpressUserId));
}

function leerPeriodo(body) {
  const datos = body || {};
  const periodo = {};
  const asignar = (destino, valor, nombre, minimo) => {
    if (valor === undefined) return;
    periodo[destino] = numero(valor, nombre, minimo);
  };
  asignar('valor_utm', datos.valor_utm ?? datos.valorUtm, 'la UTM', 0);
  asignar('remanente_anterior_utm', datos.remanente_anterior_utm ?? datos.remanenteAnteriorUtm, 'el remanente anterior en UTM', 0);
  asignar('ventas_proyectadas_netas', datos.ventas_proyectadas_netas ?? datos.ventasProyectadasNetas, 'las ventas proyectadas', 0);
  asignar('compras_proyectadas_netas', datos.compras_proyectadas_netas ?? datos.comprasProyectadasNetas, 'las compras proyectadas', 0);
  asignar('retenciones_honorarios', datos.retenciones_honorarios ?? datos.retencionesHonorarios, 'las retenciones de honorarios', 0);
  asignar('iva_postergado_vencido', datos.iva_postergado_vencido ?? datos.ivaPostergadoVencido, 'el IVA postergado que vence', 0);
  if (datos.postergar_iva !== undefined || datos.postergarIva !== undefined) {
    periodo.postergar_iva = booleano(datos.postergar_iva ?? datos.postergarIva, false);
  }
  if (datos.estado !== undefined) {
    if (!['abierto', 'cerrado'].includes(datos.estado)) throw error('El estado debe ser abierto o cerrado.', 400);
    periodo.estado = datos.estado;
  }
  return periodo;
}

async function editar(req, res) {
  const id = idParam(req.params.id);
  const periodo = leerPeriodo(req.body);
  const campos = Object.keys(periodo);
  if (campos.length === 0) throw error('No hay datos para actualizar.', 400);
  const valores = campos.map((campo) => periodo[campo]);
  const asignaciones = campos.map((campo, indice) => `${campo} = $${indice + 1}`);
  const wordpressUserId = userId(req);
  valores.push(id, wordpressUserId);
  const { rows } = await pool().query(
    `UPDATE periodos_tributarios SET ${asignaciones.join(', ')}
     WHERE id = $${valores.length - 1}
       AND EXISTS (SELECT 1 FROM empresas e WHERE e.id = periodos_tributarios.empresa_id AND e.wordpress_user_id = $${valores.length})
     RETURNING *`,
    valores
  );
  if (!rows[0]) throw error('No encontramos ese período.', 404);
  res.json(await armarF29(rows[0], wordpressUserId));
}

async function historial(req, res) {
  const empresaId = idParam(req.query.empresa_id || req.query.empresaId);
  const wordpressUserId = userId(req);
  const empresa = await pool().query('SELECT id FROM empresas WHERE id = $1 AND wordpress_user_id = $2', [empresaId, wordpressUserId]);
  if (!empresa.rows[0]) throw error('No encontramos esa empresa.', 404);
  const { rows } = await pool().query(
    `SELECT p.* FROM periodos_tributarios p JOIN empresas e ON e.id = p.empresa_id
     WHERE p.empresa_id = $1 AND e.wordpress_user_id = $2 ORDER BY p.anio DESC, p.mes DESC`,
    [empresaId, wordpressUserId]
  );
  const periodos = [];
  for (let i = 0; i < rows.length; i += 1) {
    const armado = await armarF29(rows[i], wordpressUserId);
    periodos.push({
      ...armado.periodo,
      cod_91_total_pagar: armado.f29.real.cod_91_total_pagar,
      cod_77_remanente_siguiente_pesos: armado.f29.real.cod_77_remanente_siguiente_pesos,
      remanente_siguiente_utm: armado.f29.real.remanente_siguiente_utm,
    });
  }
  res.json({ periodos });
}

module.exports = { asegurar, editar, historial, armarF29 };
