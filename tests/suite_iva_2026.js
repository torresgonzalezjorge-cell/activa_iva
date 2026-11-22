const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularF29 } = require('../src/services/f29Engine');
const { leerCsv, leerXml, desglosarBruto } = require('../src/services/siiImportService');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const fs = require('node:fs');

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

test('el servidor protege rutas y solo admite tokens WordPress para IVA', async (t) => {
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close((err) => err ? reject(err) : resolve()));

  const secret = 'iva-test-secret';
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      JWT_SECRET: secret,
      PORT: String(port),
      DATABASE_URL: '',
      PGHOST: '',
      PGPORT: '',
      PGDATABASE: '',
      PGUSER: '',
      PGPASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`El servidor IVA no inició: ${output}`)), 10000);
    child.stdout.on('data', (data) => {
      output += data;
      if (output.includes('escuchando')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`El servidor IVA terminó con código ${code}: ${output}`));
    });
  });

  const base = `http://127.0.0.1:${port}`;
  const anonymousPage = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(anonymousPage.status, 302);
  assert.equal(anonymousPage.headers.get('location'), 'https://comercialactivaspa.com');
  assert.equal((await fetch(`${base}/api/empresas`)).status, 401);
  assert.equal((await fetch(`${base}/js/app.js`, { redirect: 'manual' })).status, 302);

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'https://comercialactivaspa.com/',
    aud: 'activa-suite:app_iva_f29',
    app_id: 'app_iva_f29',
    user_id: 7301,
    email: 'cliente@example.test',
    exp: now + 120,
    plan_expires_at: now + 3600,
  };
  for (const changes of [
    { aud: 'activa-suite:130', app_id: '130' },
    { aud: ['activa-suite:app_iva_f29', 'activa-suite:130'] },
    { app_id: '130' },
    { iss: 'https://otro.example/' },
    { exp: now - 1 },
    { plan_expires_at: now - 1 },
  ]) {
    const token = jwt.sign({ ...claims, ...changes }, secret, { algorithm: 'HS256' });
    const result = await fetch(`${base}/auth?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('location'), 'https://comercialactivaspa.com');
    assert.equal(result.headers.get('set-cookie'), null);
  }

  const token = jwt.sign(claims, secret, { algorithm: 'HS256' });
  const login = await fetch(`${base}/auth?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/');
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.equal((await fetch(`${base}/`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/empresas`, { headers })).status, 503);
  assert.equal((await fetch(`${base}/api/empresas`, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://otro.example' },
  })).status, 403);
});

test('el servidor no inicia sin JWT_SECRET', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, JWT_SECRET: '' },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Falta JWT_SECRET/);
});

test('aísla empresas, períodos y documentos de dos usuarios en PostgreSQL', {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/activa_iva_isolation_test');
  const db = new Client({ connectionString: url.toString(), ssl: false });
  await db.connect();
  t.after(() => db.end());
  const existing = await db.query("SELECT to_regclass('public.empresas') AS tabla");
  assert.equal(existing.rows[0].tabla, null, 'La base de pruebas debe estar vacía');
  await db.query(`
    CREATE TABLE empresas (
      id SERIAL PRIMARY KEY, rut VARCHAR(12) UNIQUE NOT NULL, razon_social VARCHAR(160) NOT NULL,
      regimen_tributario VARCHAR(32) NOT NULL DEFAULT '14D3 Pro Pyme',
      tasa_ppm_pct NUMERIC(5,2) NOT NULL DEFAULT 1.00,
      manejo_ila VARCHAR(24) NOT NULL DEFAULT 'gasto_no_recuperable',
      activa BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    INSERT INTO empresas (rut, razon_social) VALUES ('76543210-3', 'Demo anterior');
  `);

  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close((err) => err ? reject(err) : resolve()));
  const secret = 'iva-isolation-test-secret';
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, JWT_SECRET: secret, PORT: String(port), DATABASE_URL: url.toString() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`El servidor IVA no inició: ${output}`)), 10000);
    child.stdout.on('data', (data) => {
      output += data;
      if (output.includes('escuchando')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`El servidor IVA terminó con código ${code}: ${output}`));
    });
  });

  const base = `http://127.0.0.1:${port}`;
  const session = async (id) => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({
      iss: 'https://comercialactivaspa.com/', aud: 'activa-suite:app_iva_f29',
      app_id: 'app_iva_f29', user_id: id, email: `user${id}@example.test`,
      exp: now + 120, plan_expires_at: now + 3600,
    }, secret, { algorithm: 'HS256' });
    const response = await fetch(`${base}/auth?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const a = await session(101);
  const b = await session(202);
  const request = async (cookie, route, method = 'GET', body) => {
    const headers = { Cookie: cookie };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${route}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };

  const [listA, concurrentA] = await Promise.all([
    request(a, '/api/empresas'),
    request(a, '/api/empresas'),
  ]);
  const listB = await request(b, '/api/empresas');
  assert.equal(listA.status, 200);
  assert.equal(concurrentA.status, 200);
  assert.equal(concurrentA.data.empresas.length, 1);
  assert.equal(listB.status, 200);
  assert.equal(listA.data.empresas.length, 1);
  assert.equal(listB.data.empresas.length, 1);
  const companyA = listA.data.empresas[0];
  const companyB = listB.data.empresas[0];
  assert.notEqual(companyA.id, companyB.id);
  assert.equal(companyA.rut, companyB.rut);
  assert.equal(companyA.wordpress_user_id, '101');
  assert.equal(companyB.wordpress_user_id, '202');
  const legacy = await db.query("SELECT wordpress_user_id FROM empresas WHERE razon_social = 'Demo anterior'");
  assert.equal(legacy.rows[0].wordpress_user_id, null);
  await db.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'));

  const periodA = await request(a, `/api/periodos?empresa_id=${companyA.id}&mes=11&anio=2026`);
  const periodB = await request(b, `/api/periodos?empresa_id=${companyB.id}&mes=11&anio=2026`);
  assert.equal(periodA.status, 200);
  assert.equal(periodB.status, 200);
  assert.equal(periodA.data.documentos.length, 3);
  assert.equal(periodB.data.documentos.length, 3);
  assert.deepEqual(periodA.data.f29, periodB.data.f29);
  const pA = periodA.data.periodo.id;
  const pB = periodB.data.periodo.id;
  const docA = periodA.data.documentos[0];
  const docB = periodB.data.documentos[0];

  assert.equal((await request(b, `/api/empresas/${companyA.id}`, 'PUT', { razon_social: 'Otro' })).status, 404);
  assert.equal((await request(b, `/api/empresas/${companyA.id}`, 'DELETE')).status, 404);
  assert.equal((await request(b, `/api/periodos?empresa_id=${companyA.id}&mes=11&anio=2026`)).status, 404);
  assert.equal((await request(b, `/api/historial?empresa_id=${companyA.id}`)).status, 404);
  assert.equal((await request(b, `/api/periodos/${pA}`, 'PUT', { valor_utm: 70000 })).status, 404);
  assert.equal((await request(b, `/api/documentos?periodo_id=${pA}`)).status, 404);
  assert.equal((await request(b, '/api/documentos', 'POST', {
    periodo_id: pA, tipo_operacion: 'venta', tipo_documento: 'factura_afecta',
  })).status, 404);
  const docData = { periodo_id: pB, tipo_operacion: 'venta', tipo_documento: 'factura_afecta' };
  assert.equal((await request(b, `/api/documentos/${docA.id}`, 'PUT', docData)).status, 404);
  assert.equal((await request(b, `/api/documentos/${docA.id}`, 'DELETE')).status, 404);
  assert.equal((await request(a, `/api/documentos/${docA.id}`, 'PUT', docData)).status, 404);
  assert.equal((await request(a, `/api/documentos/${docB.id}`, 'PUT', { ...docData, periodo_id: pA })).status, 404);
  assert.equal((await request(b, '/api/documentos/resumen-rapido', 'POST', {
    periodo_id: pA, boletas_bruto: 119000,
  })).status, 404);

  const upload = (periodoId) => {
    const form = new FormData();
    form.set('periodo_id', String(periodoId));
    form.set('tipo_operacion', 'venta');
    form.append('archivos', new Blob(['Tipo Doc;Folio;Monto Neto;Monto IVA\n33;999;100000;19000']), 'ventas.csv');
    return form;
  };
  const unauthorizedImport = await fetch(`${base}/api/documentos/importar-sii`, {
    method: 'POST', headers: { Cookie: b }, body: upload(pA),
  });
  assert.equal(unauthorizedImport.status, 404);
  const firstImport = await fetch(`${base}/api/documentos/importar-sii`, {
    method: 'POST', headers: { Cookie: a }, body: upload(pA),
  });
  assert.equal(firstImport.status, 200);
  assert.equal((await firstImport.json()).creados, 1);
  const secondImport = await fetch(`${base}/api/documentos/importar-sii`, {
    method: 'POST', headers: { Cookie: a }, body: upload(pA),
  });
  assert.equal(secondImport.status, 200);
  assert.equal((await secondImport.json()).actualizados, 1);
  const createdDoc = await request(a, '/api/documentos', 'POST', {
    periodo_id: pA, tipo_operacion: 'venta', tipo_documento: 'factura_afecta', folio: '1000',
  });
  assert.equal(createdDoc.status, 201);
  assert.equal((await request(a, `/api/documentos/${createdDoc.data.documento.id}`, 'PUT', {
    periodo_id: pA, tipo_operacion: 'venta', tipo_documento: 'factura_afecta', folio: '1001',
  })).status, 200);
  assert.equal((await request(a, `/api/documentos/${createdDoc.data.documento.id}`, 'DELETE')).status, 200);
  assert.equal((await request(a, `/api/historial?empresa_id=${companyA.id}`)).status, 200);
  const ownSummary = await request(a, '/api/documentos/resumen-rapido', 'POST', {
    periodo_id: pA, boletas_bruto: 119000,
  });
  assert.equal(ownSummary.status, 200);
  assert.equal((await request(a, `/api/periodos/${pA}`, 'PUT', { valor_utm: 70000 })).status, 200);
  assert.equal((await request(b, `/api/periodos?empresa_id=${companyB.id}&mes=11&anio=2026`)).data.periodo.valor_utm, '67294.00');
  const createdCompany = await request(a, '/api/empresas', 'POST', {
    rut: '76123456-0', razon_social: 'Empresa de prueba', regimen_tributario: '14D3 Pro Pyme',
  });
  assert.equal(createdCompany.status, 201);
  assert.equal((await request(b, `/api/empresas/${createdCompany.data.empresa.id}`, 'DELETE')).status, 404);
  assert.equal((await request(a, `/api/empresas/${createdCompany.data.empresa.id}`, 'PUT', {
    razon_social: 'Empresa actualizada',
  })).status, 200);
  assert.equal((await request(a, `/api/empresas/${createdCompany.data.empresa.id}`, 'DELETE')).status, 200);
  assert.equal((await request(a, '/api/empresas')).data.empresas.length, 1);

  await db.query('CREATE SCHEMA fresh_install');
  await db.query('SET search_path TO fresh_install');
  await db.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'));
  const demoSql = fs.readFileSync(path.join(__dirname, '..', 'database', 'seed_demo.sql'), 'utf8');
  await db.query(demoSql, [303]);
  await db.query(demoSql, [303]);
  assert.equal((await db.query('SELECT count(*)::int AS total FROM empresas')).rows[0].total, 1);
  assert.equal((await db.query('SELECT count(*)::int AS total FROM documentos_f29')).rows[0].total, 3);
});
