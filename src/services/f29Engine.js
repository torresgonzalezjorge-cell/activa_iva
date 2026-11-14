/**
 * Previsión del Formulario 29.
 *
 * Real hoy usa los documentos ya registrados, salvo las guías pendientes.
 * Proyección de cierre suma esas guías y las ventas o compras netas
 * todavía no documentadas. El IVA de esa proyección es el 19% del neto.
 *
 * 538 = 502 − 509
 * 537 = 520 + 504 − 528
 * Si 538 > 537, el código 89 es la diferencia y el 77 queda en cero.
 * Si 537 > 538, el código 89 queda en cero y el 77 es el remanente en pesos.
 * El remanente siguiente en UTM es 77 / UTM del período.
 * Con postergación, el 755 toma el 89 y ese monto sale del código 91.
 * El 756 (IVA postergado que vence) sí se paga en el 91.
 */

const IVA = 0.19;

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function pesos(valor) {
  return Math.round(numero(valor));
}

function campo(origen, snake, camel, defecto) {
  const fuente = origen || {};
  if (fuente[snake] !== undefined && fuente[snake] !== null && fuente[snake] !== '') return fuente[snake];
  if (camel && fuente[camel] !== undefined && fuente[camel] !== null && fuente[camel] !== '') return fuente[camel];
  return defecto;
}

function esVerdadero(valor, defecto) {
  if (valor === undefined || valor === null || valor === '') return defecto;
  if (typeof valor === 'boolean') return valor;
  return valor === true || valor === 'true' || valor === 't' || valor === 1 || valor === '1';
}

function ivaDocumento(doc) {
  const iva = numero(doc.monto_iva);
  if (doc.tipo_documento === 'guia_pendiente' && iva === 0) {
    return Math.round(Math.max(0, numero(doc.monto_neto)) * IVA);
  }
  return Math.max(0, iva);
}

function columna(comun, incluirProyeccion) {
  let debitos = 0;
  let ncEmitidas = 0;
  let creditos = 0;
  let ncRecibidas = 0;
  let basePpm = 0;
  let gasto = 0;
  let ila = 0;

  comun.documentos.forEach((doc) => {
    if (!doc) return;
    const guia = doc.tipo_documento === 'guia_pendiente';
    if (guia && !incluirProyeccion) return;

    const notaCredito = doc.tipo_documento === 'nota_credito';
    const exenta = doc.tipo_documento === 'factura_exenta';
    const signo = notaCredito ? -1 : 1;
    const iva = ivaDocumento(doc);
    const noRecuperable = Math.max(0, numero(doc.iva_no_recuperable));
    const recuperable = Math.max(0, iva - noRecuperable);
    const conAcuse = esVerdadero(doc.acuse_recibo, true);
    const fueraDePlazo = esVerdadero(doc.fuera_plazo_nc, false);
    const ingreso = Math.max(0, numero(doc.monto_neto)) + Math.max(0, numero(doc.monto_exento));
    const otros = Math.max(0, numero(doc.otros_impuestos));

    if (doc.tipo_operacion === 'venta') {
      basePpm += signo * ingreso;
      if (!exenta && !notaCredito) debitos += iva;
      if (notaCredito && !fueraDePlazo) ncEmitidas += iva;
    } else if (doc.tipo_operacion === 'compra') {
      if (!exenta && !notaCredito && conAcuse) creditos += recuperable;
      if (notaCredito && !fueraDePlazo && conAcuse) ncRecibidas += recuperable;
    }

    gasto += signo * noRecuperable;
    if (comun.manejoIla === 'retenedor_ila') ila += signo * otros;
    else gasto += signo * otros;
  });

  if (incluirProyeccion) {
    const ventas = Math.max(0, comun.ventasProyectadasNetas);
    const compras = Math.max(0, comun.comprasProyectadasNetas);
    debitos += Math.round(ventas * IVA);
    creditos += Math.round(compras * IVA);
    basePpm += ventas;
  }

  const cod502 = pesos(debitos);
  const cod509 = pesos(ncEmitidas);
  const cod538 = Math.max(0, cod502 - cod509);
  const cod520 = pesos(creditos);
  const cod504 = pesos(comun.remanenteAnteriorUtm * comun.valorUtm);
  const cod528 = pesos(ncRecibidas);
  const cod537 = Math.max(0, cod520 + cod504 - cod528);
  const aPagar = cod538 > cod537;
  const cod89 = aPagar ? cod538 - cod537 : 0;
  const cod77 = aPagar ? 0 : cod537 - cod538;
  const remanenteUtm = comun.valorUtm > 0
    ? Math.round((cod77 / comun.valorUtm) * 10000) / 10000
    : 0;
  const cod755 = comun.postergarIva && cod89 > 0 ? cod89 : 0;
  const cod756 = pesos(comun.ivaPostergadoVencido);
  const cod563 = Math.max(0, pesos(basePpm));
  const cod062 = pesos((cod563 * comun.tasaPpmPct) / 100);
  const cod151 = pesos(comun.retencionesHonorarios);
  const ilaPesos = pesos(ila);
  const cod91 = Math.max(0, (cod89 - cod755) + cod756 + cod062 + cod151 + ilaPesos);

  return {
    cod_502_debitos: cod502,
    cod_509_nc_emitidas: cod509,
    cod_538_total_debitos: cod538,
    cod_520_creditos: cod520,
    cod_504_remanente_anterior: cod504,
    cod_528_nc_recibidas: cod528,
    cod_537_total_creditos: cod537,
    cod_89_iva_determinado: cod89,
    cod_77_remanente_siguiente_pesos: cod77,
    remanente_siguiente_utm: remanenteUtm,
    cod_755_iva_postergado: cod755,
    cod_756_iva_postergado_vence: cod756,
    cod_563_base_ppm: cod563,
    cod_062_ppm: cod062,
    cod_151_honorarios: cod151,
    cod_91_total_pagar: cod91,
    otros_impuestos_gasto: pesos(gasto),
  };
}

function calcularF29(entrada) {
  const src = entrada || {};
  const periodo = src.periodo || src;
  const empresa = src.empresa || src;
  const documentos = Array.isArray(src.documentos)
    ? src.documentos
    : (Array.isArray(periodo.documentos) ? periodo.documentos : []);
  const comun = {
    documentos,
    valorUtm: numero(campo(periodo, 'valor_utm', 'valorUtm', 67294)),
    remanenteAnteriorUtm: numero(campo(periodo, 'remanente_anterior_utm', 'remanenteAnteriorUtm', 0)),
    ventasProyectadasNetas: numero(campo(periodo, 'ventas_proyectadas_netas', 'ventasProyectadasNetas', 0)),
    comprasProyectadasNetas: numero(campo(periodo, 'compras_proyectadas_netas', 'comprasProyectadasNetas', 0)),
    retencionesHonorarios: numero(campo(periodo, 'retenciones_honorarios', 'retencionesHonorarios', 0)),
    postergarIva: esVerdadero(campo(periodo, 'postergar_iva', 'postergarIva', false), false),
    ivaPostergadoVencido: numero(campo(periodo, 'iva_postergado_vencido', 'ivaPostergadoVencido', 0)),
    tasaPpmPct: numero(campo(empresa, 'tasa_ppm_pct', 'tasaPpmPct', 1)),
    manejoIla: campo(empresa, 'manejo_ila', 'manejoIla', 'gasto_no_recuperable'),
  };

  return {
    real: columna(comun, false),
    proyeccion: columna(comun, true),
  };
}

module.exports = { calcularF29, IVA };
