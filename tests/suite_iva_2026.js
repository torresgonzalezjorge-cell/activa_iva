const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularF29 } = require('../src/services/f29Engine');
const { leerCsv, leerXml, desglosarBruto } = require('../src/services/siiImportService');

const documentosNormales = [
  { tipo_operacion: 'venta', tipo_documento: 'factura_afecta', monto_neto: 1000000, monto_iva: 190000 },
  { tipo_operacion: 'venta', tipo_documento: 'resumen_boletas', monto_neto: 500000, monto_iva: 95000 },
  { tipo_operacion: 'venta', tipo_documento: 'nota_credito', monto_neto: 100000, monto_iva: 19000, fuera_plazo_nc: false },
  { tipo_operacion: 'compra', tipo_documento: 'factura_afecta', monto_neto: 400000, monto_iva: 76000, acuse_recibo: true },
  { tipo_operacion: 'compra', tipo_documento: 'nota_credito', monto_neto: 50000, monto_iva: 9500, acuse_recibo: true },
];

test('cálculo normal de débitos, créditos, PPM y total a pagar', () => {
  const { real, proyeccion } = calcularF29({
    documentos: documentosNormales,
    valorUtm: 67294,
    tasaPpmPct: 1,
    retencionesHonorarios: 20000,
    manejoIla: 'gasto_no_recuperable',
  });

  assert.equal(real.cod_502_debitos, 285000);
  assert.equal(real.cod_509_nc_emitidas, 19000);
  assert.equal(real.cod_538_total_debitos, 266000);
  assert.equal(real.cod_520_creditos, 76000);
  assert.equal(real.cod_504_remanente_anterior, 0);
  assert.equal(real.cod_528_nc_recibidas, 9500);
  assert.equal(real.cod_537_total_creditos, 66500);
  assert.equal(real.cod_89_iva_determinado, 199500);
  assert.equal(real.cod_77_remanente_siguiente_pesos, 0);
  assert.equal(real.remanente_siguiente_utm, 0);
  assert.equal(real.cod_755_iva_postergado, 0);
  assert.equal(real.cod_563_base_ppm, 1400000);
  assert.equal(real.cod_062_ppm, 14000);
  assert.equal(real.cod_151_honorarios, 20000);
  assert.equal(real.cod_91_total_pagar, 233500);
  assert.deepEqual(proyeccion, real);
});

test('cálculo con remanente de crédito fiscal medido en UTM', () => {
  const { real } = calcularF29({
    documentos: [
      { tipo_operacion: 'venta', tipo_documento: 'factura_afecta', monto_neto: 200000, monto_iva: 38000 },
      { tipo_operacion: 'compra', tipo_documento: 'factura_afecta', monto_neto: 100000, monto_iva: 19000, acuse_recibo: true },
    ],
    valorUtm: 67294,
    remanenteAnteriorUtm: 2,
    tasaPpmPct: 1,
  });

  assert.equal(real.cod_504_remanente_anterior, 134588);
  assert.equal(real.cod_538_total_debitos, 38000);
  assert.equal(real.cod_537_total_creditos, 153588);
  assert.equal(real.cod_89_iva_determinado, 0);
  assert.equal(real.cod_77_remanente_siguiente_pesos, 115588);
  assert.equal(real.remanente_siguiente_utm, 1.7177);
  assert.equal(real.cod_755_iva_postergado, 0);
  assert.equal(real.cod_062_ppm, 2000);
  assert.equal(real.cod_91_total_pagar, 2000);
});

test('cálculo con postergación de IVA código 755', () => {
  const sinPostergar = calcularF29({
    documentos: documentosNormales,
    valorUtm: 67294,
    tasaPpmPct: 1,
    retencionesHonorarios: 20000,
    postergarIva: false,
    ivaPostergadoVencido: 80000,
  }).real;
  const conPostergar = calcularF29({
    documentos: documentosNormales,
    valorUtm: 67294,
    tasaPpmPct: 1,
    retencionesHonorarios: 20000,
    postergarIva: true,
    ivaPostergadoVencido: 80000,
  }).real;

  assert.equal(sinPostergar.cod_89_iva_determinado, 199500);
  assert.equal(sinPostergar.cod_755_iva_postergado, 0);
  assert.equal(sinPostergar.cod_91_total_pagar, 313500);
  assert.equal(conPostergar.cod_89_iva_determinado, 199500);
  assert.equal(conPostergar.cod_755_iva_postergado, 199500);
  assert.equal(conPostergar.cod_756_iva_postergado_vence, 80000);
  assert.equal(conPostergar.cod_77_remanente_siguiente_pesos, 0);
  assert.equal(conPostergar.cod_91_total_pagar, 114000);
});

test('proyección de cierre suma guías pendientes y netos todavía no documentados', () => {
  const { real, proyeccion } = calcularF29({
    documentos: [
      ...documentosNormales,
      { tipo_operacion: 'venta', tipo_documento: 'guia_pendiente', monto_neto: 100000, monto_iva: 19000 },
    ],
    ventasProyectadasNetas: 1000000,
    comprasProyectadasNetas: 200000,
    valorUtm: 67294,
    tasaPpmPct: 1,
    retencionesHonorarios: 20000,
  });

  assert.equal(real.cod_538_total_debitos, 266000);
  assert.equal(real.cod_520_creditos, 76000);
  assert.equal(proyeccion.cod_502_debitos, 494000);
  assert.equal(proyeccion.cod_538_total_debitos, 475000);
  assert.equal(proyeccion.cod_520_creditos, 114000);
  assert.equal(proyeccion.cod_537_total_creditos, 104500);
  assert.equal(proyeccion.cod_89_iva_determinado, 370500);
  assert.equal(proyeccion.cod_563_base_ppm, 2500000);
  assert.equal(proyeccion.cod_062_ppm, 25000);
  assert.equal(proyeccion.cod_91_total_pagar, 415500);
});

test('sin acuse no hay crédito y la nota de crédito fuera de plazo no rebaja el débito', () => {
  const { real } = calcularF29({
    documentos: [
      { tipo_operacion: 'venta', tipo_documento: 'factura_afecta', monto_neto: 100000, monto_iva: 19000 },
      { tipo_operacion: 'venta', tipo_documento: 'nota_credito', monto_neto: 10000, monto_iva: 1900, fuera_plazo_nc: true },
      { tipo_operacion: 'compra', tipo_documento: 'factura_afecta', monto_neto: 100000, monto_iva: 19000, acuse_recibo: false, otros_impuestos: 5000 },
      { tipo_operacion: 'compra', tipo_documento: 'factura_afecta', monto_neto: 100000, monto_iva: 19000, acuse_recibo: true, iva_no_recuperable: 4000, otros_impuestos: 1000 },
    ],
    valorUtm: 67294,
    tasaPpmPct: 1,
    manejoIla: 'gasto_no_recuperable',
  });

  assert.equal(real.cod_509_nc_emitidas, 0);
  assert.equal(real.cod_538_total_debitos, 19000);
  assert.equal(real.cod_563_base_ppm, 90000);
  assert.equal(real.cod_520_creditos, 15000);
  assert.equal(real.otros_impuestos_gasto, 10000);
});

test('parseo de CSV del RCV con factura 33, nota de crédito 61 e ILA', () => {
  const csv = [
    'RUT;76543210-3',
    'Razon Social;COMERCIAL ACTIVA',
    'Periodo;2026-11',
    'Nro;Tipo Doc;Tipo Compra;RUT Proveedor;Razon Social;Folio;Fecha Docto;Fecha Acuse;Monto Exento;Monto Neto;Monto IVA Recuperable;Monto IVA No Recuperable;Codigo Otro Impuesto;Valor Otro Impuesto;Tasa Otro Impuesto',
    '1;33;Del Giro;76123456-0;Proveedor Andino Ltda.;1001;01/11/2026;02/11/2026;0;1000000;190000;15000;27;5000;31,5',
    '2;61;Del Giro;76123456-0;Proveedor Andino Ltda.;2002;05/11/2026;;0;100000;19000;0;0;0;0',
    '3;99;Del Giro;76123456-0;Documento raro;9;01/11/2026;;0;10;2;0;;;',
  ].join('\n');
  const { documentos, errores, descartados } = leerCsv(Buffer.from(csv, 'utf8'), 'compra', 'rcv.csv');
  assert.equal(descartados.length, 0);
  assert.equal(documentos.length, 2);
  assert.equal(documentos[0].tipo_documento, 'factura_afecta');
  assert.equal(documentos[0].folio, '1001');
  assert.equal(documentos[0].rut_contraparte, '76123456-0');
  assert.equal(documentos[0].monto_neto, 1000000);
  assert.equal(documentos[0].monto_iva, 190000);
  assert.equal(documentos[0].iva_no_recuperable, 15000);
  assert.equal(documentos[0].otros_impuestos, 5000);
  assert.equal(documentos[0].acuse_recibo, true);
  assert.equal(documentos[1].tipo_documento, 'nota_credito');
  assert.equal(documentos[1].folio, '2002');
  assert.equal(documentos[1].monto_iva, 19000);
  assert.equal(documentos[1].acuse_recibo, false);
  assert.equal(errores.length, 1);
  assert.match(errores[0].motivo, /99/);
  assert.deepEqual(desglosarBruto(119000), { monto_neto: 100000, monto_iva: 19000, monto_exento: 0 });
});

test('parseo de XML de guía de despacho 52 y descarte de traslado interno', () => {
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <EnvioDTE>
      <DTE version="1.0"><Documento><Encabezado>
        <IdDoc><TipoDTE>52</TipoDTE><Folio>55</Folio><IndTraslado>1</IndTraslado></IdDoc>
        <Emisor><RUTEmisor>76543210-3</RUTEmisor><RznSoc>Comercial Activa SpA</RznSoc></Emisor>
        <Receptor><RUTRecep>76123456-0</RUTRecep><RznSocRecep>Cliente Andino Ltda.</RznSocRecep></Receptor>
        <Totales><MntNeto>100000</MntNeto><MntExe>0</MntExe><IVA>19000</IVA>
          <ImptoReten><TipoImp>27</TipoImp><MontoImp>2500</MontoImp></ImptoReten>
        </Totales>
      </Encabezado></Documento></DTE>
      <DTE><Documento><Encabezado>
        <IdDoc><TipoDTE>52</TipoDTE><Folio>56</Folio><IndTraslado>5</IndTraslado></IdDoc>
        <Emisor><RUTEmisor>76543210-3</RUTEmisor><RznSoc>Bodega</RznSoc></Emisor>
        <Receptor><RUTRecep>76543210-3</RUTRecep><RznSocRecep>Bodega</RznSocRecep></Receptor>
        <Totales><MntNeto>10000</MntNeto><IVA>0</IVA></Totales>
      </Encabezado></Documento></DTE>
      <DTE><Documento><Encabezado>
        <IdDoc><TipoDTE>52</TipoDTE><Folio>57</Folio><IndTraslado>6</IndTraslado></IdDoc>
        <Emisor><RUTEmisor>76543210-3</RUTEmisor><RznSoc>Bodega</RznSoc></Emisor>
        <Receptor><RUTRecep>76543210-3</RUTRecep><RznSocRecep>Bodega</RznSocRecep></Receptor>
        <Totales><MntNeto>8000</MntNeto></Totales>
      </Encabezado></Documento></DTE>
    </EnvioDTE>`;
  const { documentos, descartados, errores } = leerXml(Buffer.from(xml, 'utf8'), 'venta', 'guias.xml');
  assert.equal(errores.length, 0);
  assert.equal(documentos.length, 1);
  assert.equal(documentos[0].tipo_documento, 'guia_pendiente');
  assert.equal(documentos[0].folio, '55');
  assert.equal(documentos[0].rut_contraparte, '76123456-0');
  assert.equal(documentos[0].razon_contraparte, 'Cliente Andino Ltda.');
  assert.equal(documentos[0].monto_neto, 100000);
  assert.equal(documentos[0].monto_iva, 19000);
  assert.equal(documentos[0].otros_impuestos, 2500);
  assert.equal(descartados.length, 2);
  assert.equal(descartados[0].folio, '56');
  assert.equal(descartados[1].folio, '57');
  assert.match(descartados[0].motivo, /traslado interno/);
});
