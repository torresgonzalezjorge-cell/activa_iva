const { getPool, seedDemo } = require('../config/db');

const REGIMENES = ['14D3 Pro Pyme', '14D8 Transparente', '14A General'];
const MANEJOS = ['gasto_no_recuperable', 'retenedor_ila'];

function error(mensaje, status) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

function pool() {
  const actual = getPool();
  if (!actual) throw error('PostgreSQL no está configurado. Defina DATABASE_URL o las variables PG* para administrar empresas.', 503);
  return actual;
}

function validarRut(rut) {
  if (typeof rut !== 'string') return false;
  const limpio = rut.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i -= 1) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado;
}

function normalizarRut(rut) {
  const limpio = rut.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

function texto(valor, nombre, maximo) {
  if (typeof valor !== 'string' || valor.trim() === '') throw error(`Ingrese ${nombre}.`, 400);
  const limpio = valor.trim();
  if (limpio.length > maximo) throw error(`${nombre} es demasiado largo.`, 400);
  return limpio;
}

function numero(valor, nombre, minimo) {
  let n;
  if (typeof valor === 'number') n = valor;
  else {
    let textoValor = String(valor ?? '').trim().replace(/\s/g, '');
    if (textoValor.includes(',') && textoValor.includes('.')) {
      textoValor = textoValor.replace(/\./g, '').replace(',', '.');
    } else if (textoValor.includes(',')) {
      textoValor = textoValor.replace(',', '.');
    }
    n = Number(textoValor);
  }
  if (!Number.isFinite(n) || n < minimo) throw error(`Ingrese un valor válido en ${nombre}.`, 400);
  return n;
}

function booleano(valor, porDefecto) {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  if (typeof valor === 'boolean') return valor;
  if (valor === 'true' || valor === '1') return true;
  if (valor === 'false' || valor === '0') return false;
  throw error('Use verdadero o falso en el campo indicado.', 400);
}

function leerEmpresa(body, parcial) {
  const datos = body || {};
  const empresa = {};
  if (!parcial || datos.rut !== undefined) {
    const rut = texto(datos.rut, 'el RUT', 20);
    if (!validarRut(rut)) throw error('El RUT no es válido. Revise el dígito verificador.', 400);
    empresa.rut = normalizarRut(rut);
  }
  if (!parcial || datos.razon_social !== undefined || datos.razonSocial !== undefined) {
    empresa.razon_social = texto(datos.razon_social || datos.razonSocial, 'la razón social', 160);
  }
  if (!parcial || datos.regimen_tributario !== undefined || datos.regimenTributario !== undefined) {
    const regimen = texto(datos.regimen_tributario || datos.regimenTributario, 'el régimen tributario', 32);
    if (!REGIMENES.includes(regimen)) {
      throw error('El régimen debe ser 14D3 Pro Pyme, 14D8 Transparente o 14A General.', 400);
    }
    empresa.regimen_tributario = regimen;
  }
  if (datos.tasa_ppm_pct !== undefined || datos.tasaPpmPct !== undefined || !parcial) {
    empresa.tasa_ppm_pct = numero(datos.tasa_ppm_pct ?? datos.tasaPpmPct ?? 1, 'la tasa de PPM', 0);
  }
  if (datos.manejo_ila !== undefined || datos.manejoIla !== undefined || !parcial) {
    const manejo = String(datos.manejo_ila ?? datos.manejoIla ?? 'gasto_no_recuperable');
    if (!MANEJOS.includes(manejo)) throw error('El manejo de ILA debe ser gasto no recuperable o retenedor de ILA.', 400);
    empresa.manejo_ila = manejo;
  }
  if (datos.activa !== undefined || !parcial) empresa.activa = booleano(datos.activa, true);
  return empresa;
}

function idParam(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw error('El registro indicado no es válido.', 400);
  return id;
}

function userId(req) {
  const id = req.sessionUser && req.sessionUser.user_id;
  if (!Number.isSafeInteger(id) || id <= 0) throw error('Sesión inválida o vencida.', 401);
  return id;
}

async function listar(req, res) {
  const id = userId(req);
  const db = pool();
  await seedDemo(id);
  const { rows } = await db.query('SELECT * FROM empresas WHERE wordpress_user_id = $1 ORDER BY razon_social', [id]);
  res.json({ empresas: rows });
}

async function crear(req, res) {
  const empresa = leerEmpresa(req.body, false);
  try {
    const { rows } = await pool().query(
      `INSERT INTO empresas (rut, razon_social, regimen_tributario, tasa_ppm_pct, manejo_ila, activa, wordpress_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        empresa.rut,
        empresa.razon_social,
        empresa.regimen_tributario,
        empresa.tasa_ppm_pct,
        empresa.manejo_ila,
        empresa.activa,
        userId(req),
      ]
    );
    res.status(201).json({ empresa: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw error('Ya existe una empresa con ese RUT.', 409);
    throw err;
  }
}

async function editar(req, res) {
  const id = idParam(req.params.id);
  const empresa = leerEmpresa(req.body, true);
  const campos = Object.keys(empresa);
  if (campos.length === 0) throw error('No hay datos para actualizar.', 400);
  const valores = campos.map((campo) => empresa[campo]);
  const asignaciones = campos.map((campo, indice) => `${campo} = $${indice + 1}`);
  valores.push(id, userId(req));
  try {
    const { rows } = await pool().query(
      `UPDATE empresas SET ${asignaciones.join(', ')} WHERE id = $${valores.length - 1} AND wordpress_user_id = $${valores.length} RETURNING *`,
      valores
    );
    if (!rows[0]) throw error('No encontramos esa empresa.', 404);
    res.json({ empresa: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw error('Ya existe una empresa con ese RUT.', 409);
    throw err;
  }
}

async function eliminar(req, res) {
  const id = idParam(req.params.id);
  const { rowCount } = await pool().query('DELETE FROM empresas WHERE id = $1 AND wordpress_user_id = $2', [id, userId(req)]);
  if (!rowCount) throw error('No encontramos esa empresa.', 404);
  res.json({ ok: true });
}

module.exports = {
  listar,
  crear,
  editar,
  eliminar,
  validarRut,
  normalizarRut,
  error,
  pool,
  numero,
  booleano,
  idParam,
  userId,
};
