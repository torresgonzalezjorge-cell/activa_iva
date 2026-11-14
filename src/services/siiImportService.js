const { validarRut, normalizarRut } = require('../controllers/empresaController');

const TIPOS_SII = {
  33: 'factura_afecta',
  34: 'factura_exenta',
  39: 'resumen_boletas',
  41: 'factura_exenta',
  43: 'factura_afecta',
  46: 'factura_afecta',
  48: 'resumen_vouchers',
  52: 'guia_pendiente',
  56: 'nota_debito',
  61: 'nota_credito',
};

const ALIAS = {
  tipo: ['tipo doc', 'tipo documento', 'tipo dte', 'tipo docto', 'tipodoc'],
  folio: ['folio', 'folio documento', 'nro folio'],
  exento: ['monto exento'],
  neto: ['monto neto'],
  iva: ['monto iva recuperable', 'iva recuperable', 'monto iva', 'iva'],
  ivaNo: ['monto iva no recuperable', 'iva no recuperable'],
  otro: ['valor otro impuesto', 'valor otro imp', 'valor otro imp.'],
  fuera: ['iva fuera de plazo'],
  acuse: ['fecha acuse', 'fecha acuse recibo', 'fecha acuse rec'],
};

const RUT_COMPRA = ['rut proveedor', 'rut emisor', 'rut emisor liquidacion factura'];
const RUT_VENTA = ['rut cliente', 'rut receptor', 'rut recep', 'rut contraparte'];
const RAZON = ['razon social', 'razon social proveedor', 'razon social cliente', 'rzn soc', 'rzn soc recep'];

function claveNombre(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '');
}

function decodificar(buffer) {
  const utf8 = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (utf8.includes('\uFFFD')) return buffer.toString('latin1').replace(/^\uFEFF/, '');
  return utf8;
}

function detectarSeparador(linea) {
  let comillas = false;
  let puntoComa = 0;
  let coma = 0;
  for (let i = 0; i < linea.length; i += 1) {
    const caracter = linea[i];
    if (caracter === '"') comillas = !comillas;
    else if (!comillas && caracter === ';') puntoComa += 1;
    else if (!comillas && caracter === ',') coma += 1;
  }
  if (puntoComa === 0 && coma === 0) return ';';
  return puntoComa >= coma ? ';' : ',';
}

function separarLinea(linea, separador) {
  const celdas = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const caracter = linea[i];
    if (caracter === '"') {
      if (comillas && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else comillas = !comillas;
    } else if (caracter === separador && !comillas) {
      celdas.push(actual.trim());
      actual = '';
    } else actual += caracter;
  }
  celdas.push(actual.trim());
  return celdas;
}

function leerMonto(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.abs(Math.round(valor));
  let texto = String(valor ?? '').trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!texto) return 0;
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, '');
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  return Math.abs(Math.round(numero));
}

function indice(encabezados, nombres) {
  return encabezados.findIndex((nombre) => nombres.includes(nombre));
}

function indices(encabezados, nombres) {
  const encontrados = [];
  encabezados.forEach((nombre, posicion) => {
    if (nombres.includes(nombre)) encontrados.push(posicion);
  });
  return encontrados;
}

function celda(fila, posicion) {
  if (posicion < 0) return '';
  return fila[posicion] == null ? '' : String(fila[posicion]).trim();
}

function sumar(fila, posiciones) {
  let total = 0;
  for (let i = 0; i < posiciones.length; i += 1) {
    const monto = leerMonto(celda(fila, posiciones[i]));
    if (monto === null) return null;
    total += monto;
  }
  return total;
}

function tipoNumero(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  const numero = Number(texto.replace(',', '.'));
  if (!Number.isInteger(numero)) return null;
  return numero;
}

function armarDocumento(datos) {
  const tipo = TIPOS_SII[datos.tipo];
  if (!tipo) {
    return { error: `El tipo de documento ${datos.tipo || 'vacío'} no se carga en el F29.` };
  }
  let rut = '';
  if (datos.rut) {
    if (!validarRut(datos.rut)) return { error: `El RUT ${datos.rut} no es válido.` };
    rut = normalizarRut(datos.rut);
  }
  const folio = String(datos.folio || '').trim();
  if (folio.length > 20) return { error: `El folio ${folio} es demasiado largo.` };
  return {
    documento: {
      tipo_documento: tipo,
      folio: folio || null,
      rut_contraparte: rut || null,
      razon_contraparte: String(datos.razon || '').trim().slice(0, 160) || null,
      monto_exento: datos.exento,
      monto_neto: datos.neto,
      monto_iva: datos.iva,
      iva_no_recuperable: datos.ivaNo,
      otros_impuestos: datos.otro,
      acuse_recibo: datos.acuse !== false,
      fuera_plazo_nc: Boolean(datos.fuera),
      archivo: datos.archivo,
      fila: datos.fila,
    },
  };
}

function leerCsv(buffer, tipoOperacion, archivo) {
  const texto = decodificar(buffer);
  const lineas = texto.split(/\r?\n/).filter((linea) => linea.trim() !== '');
  const documentos = [];
  const errores = [];
  const descartados = [];
  if (lineas.length === 0) {
    errores.push({ archivo, fila: 0, motivo: 'El archivo está vacío.' });
    return { documentos, errores, descartados };
  }
  const separador = detectarSeparador(lineas[0]);
  const filas = lineas.map((linea) => separarLinea(linea, separador));
  const inicio = filas.findIndex((fila) => fila.some((valor) => ALIAS.tipo.includes(claveNombre(valor))));
  if (inicio < 0) {
    errores.push({ archivo, fila: 1, motivo: 'No encontramos la columna Tipo Doc del RCV.' });
    return { documentos, errores, descartados };
  }
  const encabezados = filas[inicio].map(claveNombre);
  const colTipo = indice(encabezados, ALIAS.tipo);
  const colFolio = indice(encabezados, ALIAS.folio);
  const preferidos = tipoOperacion === 'venta' ? RUT_VENTA.concat(RUT_COMPRA) : RUT_COMPRA.concat(RUT_VENTA);
  const colRut = indice(encabezados, preferidos);
  const colRazon = indice(encabezados, RAZON);
  const colExento = indice(encabezados, ALIAS.exento);
  const colNeto = indice(encabezados, ALIAS.neto);
  const colIva = indices(encabezados, ALIAS.iva);
  const colIvaNo = indices(encabezados, ALIAS.ivaNo);
  const colOtro = indices(encabezados, ALIAS.otro);
  const colFuera = indice(encabezados, ALIAS.fuera);
  const colAcuse = indice(encabezados, ALIAS.acuse);
  if (colFolio < 0 || colNeto < 0) {
    errores.push({ archivo, fila: inicio + 1, motivo: 'El RCV debe traer Folio y Monto Neto.' });
    return { documentos, errores, descartados };
  }

  filas.slice(inicio + 1).forEach((fila, desplazamiento) => {
    const numeroFila = inicio + desplazamiento + 2;
    const tipo = tipoNumero(celda(fila, colTipo));
    const folio = celda(fila, colFolio);
    if (!tipo && !folio) return;
    if (!tipo) {
      errores.push({ archivo, fila: numeroFila, folio, motivo: 'Falta el tipo de documento.' });
      return;
    }
    const neto = leerMonto(celda(fila, colNeto));
    const exento = leerMonto(celda(fila, colExento));
    const iva = sumar(fila, colIva);
    const ivaNo = sumar(fila, colIvaNo);
    const otro = sumar(fila, colOtro);
    if ([neto, exento, iva, ivaNo, otro].includes(null)) {
      errores.push({ archivo, fila: numeroFila, folio, motivo: 'Hay un monto que no se pudo leer.' });
      return;
    }
    const fechaAcuse = celda(fila, colAcuse);
    const armado = armarDocumento({
      tipo,
      folio,
      rut: celda(fila, colRut),
      razon: celda(fila, colRazon),
      exento: exento || 0,
      neto: neto || 0,
      iva: iva || 0,
      ivaNo: ivaNo || 0,
      otro: otro || 0,
      acuse: colAcuse < 0 ? true : fechaAcuse !== '',
      fuera: (leerMonto(celda(fila, colFuera)) || 0) > 0 && tipo === 61,
      archivo,
      fila: numeroFila,
    });
    if (armado.error) {
      errores.push({ archivo, fila: numeroFila, folio, motivo: armado.error });
      return;
    }
    documentos.push(armado.documento);
  });
  return { documentos, errores, descartados };
}

function textoTag(xml, tag) {
  const coincidencia = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!coincidencia) return '';
  return coincidencia[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
}

function sumarTag(xml, tag) {
  const expresion = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let total = 0;
  let coincidencia = expresion.exec(xml);
  while (coincidencia) {
    const monto = leerMonto(coincidencia[1].replace(/<[^>]+>/g, ''));
    if (monto) total += monto;
    coincidencia = expresion.exec(xml);
  }
  return total;
}

function bloquesDte(xml) {
  const partes = xml.split(/<DTE\b/i);
  if (partes.length > 1) {
    return partes.slice(1).map((parte) => parte.split(/<\/DTE>/i)[0]);
  }
  return [xml];
}

function leerXml(buffer, tipoOperacion, archivo) {
  const xml = decodificar(buffer);
  const documentos = [];
  const errores = [];
  const descartados = [];
  const bloques = bloquesDte(xml).filter((bloque) => /<TipoDTE\b/i.test(bloque));
  if (bloques.length === 0) {
    errores.push({ archivo, fila: 0, motivo: 'El XML no trae un DTE reconocible.' });
    return { documentos, errores, descartados };
  }
  bloques.forEach((bloque, indice) => {
    const fila = indice + 1;
    const tipo = tipoNumero(textoTag(bloque, 'TipoDTE'));
    const folio = textoTag(bloque, 'Folio');
    const indTraslado = Number(textoTag(bloque, 'IndTraslado'));
    if (tipo === 52 && (indTraslado === 5 || indTraslado === 6)) {
      descartados.push({
        archivo,
        fila,
        folio,
        motivo: 'Guía de traslado interno',
      });
      return;
    }
    const rut = tipoOperacion === 'venta' ? textoTag(bloque, 'RUTRecep') : textoTag(bloque, 'RUTEmisor');
    const razon = tipoOperacion === 'venta' ? textoTag(bloque, 'RznSocRecep') : textoTag(bloque, 'RznSoc');
    const armado = armarDocumento({
      tipo,
      folio,
      rut,
      razon,
      exento: leerMonto(textoTag(bloque, 'MntExe')) || 0,
      neto: leerMonto(textoTag(bloque, 'MntNeto')) || 0,
      iva: leerMonto(textoTag(bloque, 'IVA')) || 0,
      ivaNo: 0,
      otro: sumarTag(bloque, 'MontoImp'),
      acuse: true,
      fuera: false,
      archivo,
      fila,
    });
    if (armado.error) {
      errores.push({ archivo, fila, folio, motivo: armado.error });
      return;
    }
    documentos.push(armado.documento);
  });
  return { documentos, errores, descartados };
}

function desglosarBruto(bruto) {
  const total = Math.round(Number(bruto) || 0);
  const neto = Math.round(total / 1.19);
  return { monto_neto: neto, monto_iva: total - neto, monto_exento: 0 };
}

module.exports = { leerCsv, leerXml, desglosarBruto, TIPOS_SII };
