const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const TIPOS = [
  ['factura_afecta', 'Factura afecta'],
  ['factura_exenta', 'Factura exenta'],
  ['nota_credito', 'Nota de crédito'],
  ['nota_debito', 'Nota de débito'],
  ['resumen_boletas', 'Resumen de boletas'],
  ['resumen_vouchers', 'Resumen de vouchers'],
  ['guia_pendiente', 'Guía pendiente'],
];
const FILAS = [
  ['538', 'cod_538_total_debitos', 'Total débitos'],
  ['537', 'cod_537_total_creditos', 'Total créditos'],
  ['89', 'cod_89_iva_determinado', 'IVA determinado'],
  ['77', 'cod_77_remanente_siguiente_pesos', 'Remanente para el mes siguiente'],
  ['755', 'cod_755_iva_postergado', 'IVA postergado'],
  ['062', 'cod_062_ppm', 'PPM'],
  ['151', 'cod_151_honorarios', 'Retención de honorarios'],
  ['91', 'cod_91_total_pagar', 'Total a pagar'],
];
const DETALLE = [
  ['502', 'cod_502_debitos', 'Débitos de facturas, boletas y notas de débito'],
  ['509', 'cod_509_nc_emitidas', 'Notas de crédito emitidas'],
  ['520', 'cod_520_creditos', 'Crédito fiscal con acuse de recibo'],
  ['504', 'cod_504_remanente_anterior', 'Remanente del mes anterior'],
  ['528', 'cod_528_nc_recibidas', 'Notas de crédito recibidas'],
  ['563', 'cod_563_base_ppm', 'Base imponible PPM'],
  ['756', 'cod_756_iva_postergado_vence', 'IVA postergado que vence'],
];

const hoy = new Date();
const estado = {
  vista: 'resumen',
  empresas: [],
  empresaId: null,
  mes: hoy.getMonth() + 1,
  anio: hoy.getFullYear(),
  periodo: null,
  empresa: null,
  documentos: [],
  f29: null,
  historial: [],
  editEmpresaId: null,
  editDocumentoId: null,
};

const main = document.getElementById('main');
const selectEmpresa = document.getElementById('empresa-select');
const selectMes = document.getElementById('mes-select');
const selectAnio = document.getElementById('anio-select');
const inputUtm = document.getElementById('utm-periodo');
const modalEmpresa = document.getElementById('modal-empresa');
const formEmpresa = document.getElementById('form-empresa');

function formatoClp(valor) {
  const numero = Math.round(Number(valor) || 0);
  const signo = numero < 0 ? '-' : '';
  const miles = Math.abs(numero).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${signo}$ ${miles}`;
}

function formatoUtm(valor) {
  return (Number(valor) || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function leerPesos(texto) {
  const limpio = String(texto || '').replace(/\D/g, '');
  return limpio ? Number(limpio) : 0;
}

function leerDecimal(texto) {
  let s = String(texto || '').trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (letra) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[letra]));
}

function toast(mensaje) {
  const aviso = document.getElementById('toast');
  aviso.hidden = false;
  aviso.textContent = mensaje;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { aviso.hidden = true; }, 2800);
}

async function api(url, opciones) {
  const respuesta = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
  return datos;
}

function empresaActual() {
  return estado.empresas.find((empresa) => empresa.id === estado.empresaId) || estado.empresa;
}

function etiquetaTipo(tipo) {
  return (TIPOS.find((fila) => fila[0] === tipo) || [tipo, tipo])[1];
}

function pintarTabs() {
  document.querySelectorAll('.tabs button').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.view === estado.vista);
  });
}

function filaF29(codigo, campo, concepto) {
  const real = estado.f29 ? estado.f29.real[campo] : 0;
  const proyeccion = estado.f29 ? estado.f29.proyeccion[campo] : 0;
  const clase = codigo === '91' ? 'pagar' : (codigo === '755' ? 'postergado' : '');
  const extra = codigo === '77' && estado.f29
    ? `<div class="ayuda">Real ${formatoUtm(estado.f29.real.remanente_siguiente_utm)} UTM · Proyección ${formatoUtm(estado.f29.proyeccion.remanente_siguiente_utm)} UTM</div>`
    : '';
  return `<tr class="${clase}" data-fila="${codigo}">
    <td class="codigo">${codigo}</td>
    <td>${concepto}${extra}</td>
    <td class="num" data-col="real" data-cod="${codigo}">${formatoClp(real)}</td>
    <td class="num" data-col="proyeccion" data-cod="${codigo}">${formatoClp(proyeccion)}</td>
  </tr>`;
}

function tablaF29() {
  return `<table class="f29" id="tabla-f29">
    <thead>
      <tr><th>Código</th><th>Concepto</th><th class="num">Real hoy</th><th class="num">Proyección cierre</th></tr>
    </thead>
    <tbody>
      ${FILAS.map((fila) => filaF29(fila[0], fila[1], fila[2])).join('')}
    </tbody>
  </table>`;
}

function pintarCeldas() {
  if (!estado.f29) return;
  document.querySelectorAll('[data-col][data-cod]').forEach((celda) => {
    const columna = celda.dataset.col === 'proyeccion' ? estado.f29.proyeccion : estado.f29.real;
    const fila = [...FILAS, ...DETALLE].find((item) => item[0] === celda.dataset.cod);
    if (fila) celda.textContent = formatoClp(columna[fila[1]]);
  });
  const ayuda = document.querySelector('[data-fila="77"] .ayuda');
  if (ayuda) {
    ayuda.textContent = `Real ${formatoUtm(estado.f29.real.remanente_siguiente_utm)} UTM · Proyección ${formatoUtm(estado.f29.proyeccion.remanente_siguiente_utm)} UTM`;
  }
  const gasto = document.getElementById('otros-gasto');
  if (gasto) {
    gasto.textContent = `Otros impuestos y IVA no recuperable llevados a gasto: real ${formatoClp(estado.f29.real.otros_impuestos_gasto)} · proyección ${formatoClp(estado.f29.proyeccion.otros_impuestos_gasto)}`;
  }
}

function vistaResumen() {
  const empresa = empresaActual();
  const periodo = estado.periodo || {};
  const postergar = periodo.postergar_iva === true;
  return `
    <div class="page-head">
      <div>
        <h1>Resumen F29</h1>
        <p class="muted">${escapeHtml(empresa ? empresa.razon_social : '')} · ${MESES[estado.mes - 1]} ${estado.anio} · PPM ${formatoUtm(empresa?.tasa_ppm_pct || 0)}% · UTM ${formatoUtm(periodo.valor_utm)}</p>
      </div>
      <button type="button" class="btn no-print" id="imprimir">Imprimir borrador</button>
    </div>
    <section class="panel controles no-print">
      <label class="switch">
        <input type="checkbox" id="postergar-iva" ${postergar ? 'checked' : ''}>
        <span class="switch-ui"></span>
        Postergación de IVA (Cód. 755)
      </label>
      <p class="ayuda">El interruptor mueve el IVA determinado desde el código 91 hacia el 755. El IVA postergado que ya venció se paga igual, en el código 756.</p>
    </section>
    <section class="panel grid cuatro no-print">
      <label>Ventas proyectadas netas
        <input id="ventas-proy" class="pesos" inputmode="numeric" value="${formatoClp(periodo.ventas_proyectadas_netas)}" autocomplete="off">
      </label>
      <label>Compras proyectadas netas
        <input id="compras-proy" class="pesos" inputmode="numeric" value="${formatoClp(periodo.compras_proyectadas_netas)}" autocomplete="off">
      </label>
      <label>Remanente anterior (UTM)
        <input id="remanente-utm" inputmode="decimal" value="${formatoUtm(periodo.remanente_anterior_utm)}" autocomplete="off">
      </label>
      <label>Retenciones honorarios (151)
        <input id="honorarios" class="pesos" inputmode="numeric" value="${formatoClp(periodo.retenciones_honorarios)}" autocomplete="off">
      </label>
      <label>IVA postergado que vence (756)
        <input id="iva-vence" class="pesos" inputmode="numeric" value="${formatoClp(periodo.iva_postergado_vencido)}" autocomplete="off">
      </label>
    </section>
    ${tablaF29()}
    <section class="panel">
      <h2>Detalle de la liquidación</h2>
      <table class="f29" id="tabla-detalle">
        <thead><tr><th>Código</th><th>Concepto</th><th class="num">Real hoy</th><th class="num">Proyección cierre</th></tr></thead>
        <tbody>${DETALLE.map((fila) => filaF29(fila[0], fila[1], fila[2])).join('')}</tbody>
      </table>
      <p class="ayuda" id="otros-gasto"></p>
    </section>`;
}

function opcionesTipo(seleccionado) {
  return TIPOS.map(([valor, texto]) => `<option value="${valor}" ${valor === seleccionado ? 'selected' : ''}>${texto}</option>`).join('');
}

function brutoResumen(tipo, folio) {
  const doc = estado.documentos.find((item) => (
    item.tipo_operacion === 'venta' && item.tipo_documento === tipo && String(item.folio) === folio
  ));
  if (!doc) return 0;
  return Math.round(Number(doc.monto_neto) + Number(doc.monto_iva) + Number(doc.monto_exento));
}

function bandaF29() {
  const real = estado.f29 ? estado.f29.real : {};
  return `<p class="banda-f29 panel">IVA determinado (89): <strong data-col="real" data-cod="89">${formatoClp(real.cod_89_iva_determinado)}</strong> · Total a pagar (91): <strong data-col="real" data-cod="91">${formatoClp(real.cod_91_total_pagar)}</strong></p>`;
}

function tarjetaResumenSii() {
  return `
    <form id="form-resumen-sii" class="panel no-print">
      <h2>Resumen mensual boletas y vouchers</h2>
      <div class="grid dos">
        <label>Boletas electrónicas (Cód. 39), monto bruto
          <input class="pesos" name="boletas_bruto" inputmode="numeric" value="${formatoClp(brutoResumen('resumen_boletas', '39'))}" autocomplete="off">
        </label>
        <label>Vouchers POS (Cód. 48), monto bruto
          <input class="pesos" name="vouchers_bruto" inputmode="numeric" value="${formatoClp(brutoResumen('resumen_vouchers', '48'))}" autocomplete="off">
        </label>
      </div>
      <p class="ayuda">Use el total bruto del resumen del SII. El neto y el IVA se separan al 19%.</p>
      <button class="btn btn-primary" type="submit">Guardar resumen</button>
    </form>`;
}

function vistaDocumentos(operacion) {
  const titulo = operacion === 'venta' ? 'Ventas (débito fiscal)' : 'Compras (crédito fiscal)';
  const editado = estado.documentos.find((doc) => doc.id === estado.editDocumentoId && doc.tipo_operacion === operacion);
  const filas = estado.documentos.filter((doc) => doc.tipo_operacion === operacion).map((doc) => `
    <tr>
      <td>${escapeHtml(etiquetaTipo(doc.tipo_documento))}</td>
      <td>${escapeHtml(doc.folio || '')}</td>
      <td>${escapeHtml(doc.rut_contraparte || '')}</td>
      <td>${escapeHtml(doc.razon_contraparte || '')}</td>
      <td class="num">${formatoClp(doc.monto_neto)}</td>
      <td class="num">${formatoClp(doc.monto_iva)}</td>
      <td>${doc.acuse_recibo ? 'Sí' : 'No'}</td>
      <td>${doc.fuera_plazo_nc ? 'Sí' : 'No'}</td>
      <td class="no-print fila-acciones">
        ${operacion === 'compra' ? `<button type="button" class="btn" data-acuse="${doc.id}">${doc.acuse_recibo ? 'Quitar acuse' : 'Marcar recuperable'}</button>` : ''}
        <button type="button" class="btn" data-editar-doc="${doc.id}">Editar</button>
        <button type="button" class="btn btn-danger" data-borrar-doc="${doc.id}">Eliminar</button>
      </td>
    </tr>`).join('');
  return `
    <div class="page-head">
      <h1>${titulo}</h1>
      <button type="button" class="btn no-print" data-importar="${operacion}">Importar CSV / XML del SII</button>
    </div>
    ${bandaF29()}
    ${operacion === 'venta' ? tarjetaResumenSii() : ''}
    <form id="form-documento" class="panel grid cuatro no-print" data-operacion="${operacion}">
      <label>Documento
        <select name="tipo_documento">${opcionesTipo(editado?.tipo_documento || 'factura_afecta')}</select>
      </label>
      <label>Folio<input name="folio" value="${escapeHtml(editado?.folio || '')}" maxlength="20"></label>
      <label>RUT contraparte<input name="rut_contraparte" value="${escapeHtml(editado?.rut_contraparte || '')}" placeholder="76.123.456-0"></label>
      <label>Razón social<input name="razon_contraparte" value="${escapeHtml(editado?.razon_contraparte || '')}" maxlength="160"></label>
      <label>Monto exento<input class="pesos" name="monto_exento" inputmode="numeric" value="${editado ? formatoClp(editado.monto_exento) : ''}"></label>
      <label>Monto neto<input class="pesos" name="monto_neto" inputmode="numeric" value="${editado ? formatoClp(editado.monto_neto) : ''}"></label>
      <label>IVA<input class="pesos" name="monto_iva" inputmode="numeric" value="${editado ? formatoClp(editado.monto_iva) : ''}"></label>
      <label>IVA no recuperable<input class="pesos" name="iva_no_recuperable" inputmode="numeric" value="${editado ? formatoClp(editado.iva_no_recuperable) : ''}"></label>
      <label>Otros impuestos<input class="pesos" name="otros_impuestos" inputmode="numeric" value="${editado ? formatoClp(editado.otros_impuestos) : ''}"></label>
      <label class="check"><input name="acuse_recibo" type="checkbox" ${!editado || editado.acuse_recibo ? 'checked' : ''}> Acuse de recibo</label>
      <label class="check"><input name="fuera_plazo_nc" type="checkbox" ${editado?.fuera_plazo_nc ? 'checked' : ''}> NC fuera de plazo</label>
      <div class="fila-acciones">
        <button class="btn btn-primary" type="submit">${editado ? 'Guardar cambios' : 'Agregar documento'}</button>
        ${editado ? '<button class="btn" type="button" id="cancelar-doc">Cancelar</button>' : ''}
      </div>
    </form>
    <div class="panel">
      <table>
        <thead><tr><th>Tipo</th><th>Folio</th><th>RUT</th><th>Contraparte</th><th class="num">Neto</th><th class="num">IVA</th><th>Acuse</th><th>Fuera de plazo</th><th class="no-print"></th></tr></thead>
        <tbody>${filas || '<tr><td colspan="9">Todavía no hay documentos en este período.</td></tr>'}</tbody>
      </table>
      <p class="ayuda">Las guías pendientes no entran en Real hoy. Se suman solo en Proyección de cierre. Una compra sin acuse no genera crédito fiscal. Una nota de crédito fuera de plazo no rebaja el IVA del mes.</p>
    </div>`;
}

function vistaHistorial() {
  const filas = estado.historial.map((periodo) => `
    <tr>
      <td>${MESES[periodo.mes - 1]} ${periodo.anio}</td>
      <td>${periodo.estado}</td>
      <td class="num">${formatoUtm(periodo.valor_utm)}</td>
      <td class="num">${formatoClp(periodo.cod_91_total_pagar)}</td>
      <td class="num">${formatoUtm(periodo.remanente_siguiente_utm)}</td>
      <td class="no-print"><button type="button" class="btn" data-abrir="${periodo.mes}" data-anio="${periodo.anio}">Abrir</button></td>
    </tr>`).join('');
  const empresa = empresaActual();
  return `
    <div class="page-head">
      <h1>Historial</h1>
      <div class="fila-acciones no-print">
        <button type="button" class="btn" id="cerrar-periodo">${estado.periodo?.estado === 'cerrado' ? 'Reabrir período' : 'Cerrar período'}</button>
        <button type="button" class="btn btn-primary" id="imprimir">Imprimir borrador</button>
      </div>
    </div>
    <div class="panel no-print">
      <table>
        <thead><tr><th>Período</th><th>Estado</th><th class="num">UTM</th><th class="num">Total a pagar (91)</th><th class="num">Remanente UTM</th><th class="no-print"></th></tr></thead>
        <tbody>${filas || '<tr><td colspan="6">Todavía no hay períodos guardados.</td></tr>'}</tbody>
      </table>
    </div>
    <article class="panel" id="borrador">
      <div class="borrador-cabecera">
        <div>
          <h1>Borrador Formulario 29</h1>
          <p class="muted">${escapeHtml(empresa?.razon_social || '')} · RUT ${escapeHtml(empresa?.rut || '')}</p>
          <p class="muted">${escapeHtml(empresa?.regimen_tributario || '')} · ${MESES[estado.mes - 1]} ${estado.anio} · UTM ${formatoUtm(estado.periodo?.valor_utm)}</p>
        </div>
        <p class="muted">Previsión interna. No reemplaza la declaración en sii.cl.</p>
      </div>
      ${tablaF29()}
      <div class="firma">
        <div>Preparado por</div>
        <div>Revisado por</div>
      </div>
    </article>`;
}

function render() {
  pintarTabs();
  if (!estado.empresaId || !estado.periodo) {
    main.innerHTML = '<p class="vacio">Cree o seleccione una empresa para abrir el período.</p>';
    return;
  }
  if (estado.vista === 'ventas') main.innerHTML = vistaDocumentos('venta');
  else if (estado.vista === 'compras') main.innerHTML = vistaDocumentos('compra');
  else if (estado.vista === 'historial') main.innerHTML = vistaHistorial();
  else main.innerHTML = vistaResumen();
  pintarCeldas();
}

async function cargarEmpresas() {
  const datos = await api('/api/empresas');
  estado.empresas = datos.empresas || [];
  if (!estado.empresas.some((empresa) => empresa.id === estado.empresaId)) {
    estado.empresaId = estado.empresas[0] ? estado.empresas[0].id : null;
  }
  selectEmpresa.innerHTML = estado.empresas.map((empresa) => (
    `<option value="${empresa.id}">${escapeHtml(empresa.razon_social)}</option>`
  )).join('');
  if (estado.empresaId) selectEmpresa.value = String(estado.empresaId);
}

async function cargarPeriodo() {
  if (!estado.empresaId) {
    estado.periodo = null;
    estado.f29 = null;
    estado.documentos = [];
    return;
  }
  const datos = await api(`/api/periodos?empresa_id=${estado.empresaId}&mes=${estado.mes}&anio=${estado.anio}`);
  estado.periodo = datos.periodo;
  estado.empresa = datos.empresa;
  estado.documentos = datos.documentos || [];
  estado.f29 = datos.f29;
  if (document.activeElement !== inputUtm) inputUtm.value = formatoUtm(datos.periodo.valor_utm);
}

async function cargarHistorial() {
  if (!estado.empresaId) {
    estado.historial = [];
    return;
  }
  const datos = await api(`/api/historial?empresa_id=${estado.empresaId}`);
  estado.historial = datos.periodos || [];
}

let esperaGuardado = null;
let ticketGuardado = 0;
function programarGuardado(cambios) {
  clearTimeout(esperaGuardado);
  esperaGuardado = setTimeout(() => {
    guardarPeriodo(cambios).catch((error) => toast(error.message));
  }, 350);
}

async function guardarPeriodo(cambios) {
  const ticket = ++ticketGuardado;
  const datos = await api(`/api/periodos/${estado.periodo.id}`, {
    method: 'PUT',
    body: JSON.stringify(cambios),
  });
  if (ticket !== ticketGuardado) return;
  estado.periodo = datos.periodo;
  estado.empresa = datos.empresa;
  estado.documentos = datos.documentos || [];
  estado.f29 = datos.f29;
  if (document.getElementById('tabla-f29')) pintarCeldas();
  else render();
}

function abrirEmpresa(empresa) {
  estado.editEmpresaId = empresa ? empresa.id : null;
  formEmpresa.reset();
  document.getElementById('titulo-empresa').textContent = empresa ? 'Editar empresa' : 'Nueva empresa';
  document.getElementById('btn-empresa-eliminar').hidden = !empresa;
  document.getElementById('error-empresa').hidden = true;
  if (empresa) {
    formEmpresa.rut.value = empresa.rut;
    formEmpresa.razon_social.value = empresa.razon_social;
    formEmpresa.regimen_tributario.value = empresa.regimen_tributario;
    formEmpresa.tasa_ppm_pct.value = formatoUtm(empresa.tasa_ppm_pct);
    formEmpresa.manejo_ila.value = empresa.manejo_ila;
    formEmpresa.activa.checked = empresa.activa !== false;
  }
  modalEmpresa.showModal();
}

function llenarSelectores() {
  selectMes.innerHTML = MESES.map((nombre, indice) => `<option value="${indice + 1}">${nombre}</option>`).join('');
  const anioActual = hoy.getFullYear();
  const anios = [];
  for (let anio = anioActual + 1; anio >= anioActual - 4; anio -= 1) anios.push(anio);
  selectAnio.innerHTML = anios.map((anio) => `<option value="${anio}">${anio}</option>`).join('');
  selectMes.value = String(estado.mes);
  selectAnio.value = String(estado.anio);
}

document.querySelector('.tabs').addEventListener('click', (evento) => {
  const boton = evento.target.closest('button');
  if (!boton) return;
  estado.vista = boton.dataset.view;
  estado.editDocumentoId = null;
  const cargar = estado.vista === 'historial' ? cargarHistorial() : Promise.resolve();
  cargar.then(render).catch((error) => toast(error.message));
});

selectEmpresa.addEventListener('change', () => {
  estado.empresaId = Number(selectEmpresa.value);
  estado.editDocumentoId = null;
  cargarPeriodo().then(render).catch((error) => toast(error.message));
});

selectMes.addEventListener('change', () => {
  estado.mes = Number(selectMes.value);
  estado.editDocumentoId = null;
  cargarPeriodo().then(render).catch((error) => toast(error.message));
});

selectAnio.addEventListener('change', () => {
  estado.anio = Number(selectAnio.value);
  estado.editDocumentoId = null;
  cargarPeriodo().then(render).catch((error) => toast(error.message));
});

inputUtm.addEventListener('change', () => {
  if (!estado.periodo) return;
  guardarPeriodo({ valor_utm: leerDecimal(inputUtm.value) })
    .then(() => { inputUtm.value = formatoUtm(estado.periodo.valor_utm); })
    .catch((error) => toast(error.message));
});

document.getElementById('btn-empresa-nueva').addEventListener('click', () => abrirEmpresa(null));
document.getElementById('btn-empresa-editar').addEventListener('click', () => {
  const empresa = empresaActual();
  if (!empresa) return toast('Primero cree una empresa.');
  abrirEmpresa(empresa);
});
modalEmpresa.addEventListener('click', (evento) => {
  if (evento.target.closest('[data-close]')) modalEmpresa.close();
});
formEmpresa.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const errorEmpresa = document.getElementById('error-empresa');
  const datos = {
    rut: formEmpresa.rut.value,
    razon_social: formEmpresa.razon_social.value,
    regimen_tributario: formEmpresa.regimen_tributario.value,
    tasa_ppm_pct: leerDecimal(formEmpresa.tasa_ppm_pct.value),
    manejo_ila: formEmpresa.manejo_ila.value,
    activa: formEmpresa.activa.checked,
  };
  try {
    if (estado.editEmpresaId) {
      await api(`/api/empresas/${estado.editEmpresaId}`, { method: 'PUT', body: JSON.stringify(datos) });
    } else {
      const creada = await api('/api/empresas', { method: 'POST', body: JSON.stringify(datos) });
      estado.empresaId = creada.empresa.id;
    }
    modalEmpresa.close();
    await cargarEmpresas();
    await cargarPeriodo();
    render();
    toast('Empresa guardada.');
  } catch (error) {
    errorEmpresa.hidden = false;
    errorEmpresa.textContent = error.message;
  }
});
document.getElementById('btn-empresa-eliminar').addEventListener('click', async () => {
  if (!estado.editEmpresaId) return;
  if (!window.confirm('¿Eliminar la empresa y sus períodos?')) return;
  try {
    await api(`/api/empresas/${estado.editEmpresaId}`, { method: 'DELETE' });
    estado.empresaId = null;
    modalEmpresa.close();
    await cargarEmpresas();
    await cargarPeriodo();
    render();
  } catch (error) {
    toast(error.message);
  }
});

main.addEventListener('click', async (evento) => {
  if (evento.target.id === 'imprimir') {
    window.print();
    return;
  }
  if (evento.target.id === 'cancelar-doc') {
    estado.editDocumentoId = null;
    render();
    return;
  }
  if (evento.target.id === 'cerrar-periodo' && estado.periodo) {
    try {
      await guardarPeriodo({ estado: estado.periodo.estado === 'cerrado' ? 'abierto' : 'cerrado' });
      await cargarHistorial();
      render();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const abrir = evento.target.closest('[data-abrir]');
  if (abrir) {
    estado.mes = Number(abrir.dataset.abrir);
    estado.anio = Number(abrir.dataset.anio);
    selectMes.value = String(estado.mes);
    selectAnio.value = String(estado.anio);
    estado.vista = 'resumen';
    cargarPeriodo().then(render).catch((error) => toast(error.message));
    return;
  }
  const editar = evento.target.closest('[data-editar-doc]');
  if (editar) {
    estado.editDocumentoId = Number(editar.dataset.editarDoc);
    render();
    return;
  }
  const borrar = evento.target.closest('[data-borrar-doc]');
  if (borrar) {
    try {
      await api(`/api/documentos/${borrar.dataset.borrarDoc}`, { method: 'DELETE' });
      await cargarPeriodo();
      render();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const importar = evento.target.closest('[data-importar]');
  if (importar) {
    estado.importarOperacion = importar.dataset.importar;
    document.getElementById('titulo-importar').textContent = estado.importarOperacion === 'venta'
      ? 'Importar ventas del SII'
      : 'Importar compras del SII';
    document.getElementById('form-importar').reset();
    document.getElementById('reporte-importar').innerHTML = '';
    document.getElementById('modal-importar').showModal();
    return;
  }
  const acuse = evento.target.closest('[data-acuse]');
  if (acuse) {
    const doc = estado.documentos.find((item) => item.id === Number(acuse.dataset.acuse));
    if (!doc) return;
    try {
      await api(`/api/documentos/${doc.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          periodo_id: estado.periodo.id,
          tipo_operacion: doc.tipo_operacion,
          tipo_documento: doc.tipo_documento,
          folio: doc.folio || '',
          rut_contraparte: doc.rut_contraparte || '',
          razon_contraparte: doc.razon_contraparte || '',
          monto_exento: Number(doc.monto_exento) || 0,
          monto_neto: Number(doc.monto_neto) || 0,
          monto_iva: Number(doc.monto_iva) || 0,
          iva_no_recuperable: Number(doc.iva_no_recuperable) || 0,
          otros_impuestos: Number(doc.otros_impuestos) || 0,
          acuse_recibo: !doc.acuse_recibo,
          fuera_plazo_nc: Boolean(doc.fuera_plazo_nc),
        }),
      });
      await cargarPeriodo();
      render();
      toast(`IVA determinado ${formatoClp(estado.f29.real.cod_89_iva_determinado)} · Total a pagar ${formatoClp(estado.f29.real.cod_91_total_pagar)}`);
    } catch (error) {
      toast(error.message);
    }
  }
});

main.addEventListener('change', (evento) => {
  if (evento.target.id === 'postergar-iva') {
    guardarPeriodo({ postergar_iva: evento.target.checked }).catch((error) => toast(error.message));
  }
});

main.addEventListener('input', (evento) => {
  const id = evento.target.id;
  if (id === 'ventas-proy' || id === 'compras-proy') {
    programarGuardado({
      ventas_proyectadas_netas: leerPesos(document.getElementById('ventas-proy').value),
      compras_proyectadas_netas: leerPesos(document.getElementById('compras-proy').value),
    });
  }
  if (id === 'remanente-utm') programarGuardado({ remanente_anterior_utm: leerDecimal(evento.target.value) });
  if (id === 'honorarios') programarGuardado({ retenciones_honorarios: leerPesos(evento.target.value) });
  if (id === 'iva-vence') programarGuardado({ iva_postergado_vencido: leerPesos(evento.target.value) });
  if (evento.target.name === 'monto_neto') {
    const iva = evento.target.form.querySelector('[name="monto_iva"]');
    if (iva && document.activeElement !== iva) iva.value = formatoClp(Math.round(leerPesos(evento.target.value) * 0.19));
  }
});

main.addEventListener('focusout', (evento) => {
  if (evento.target.classList.contains('pesos') && evento.target.value) {
    evento.target.value = formatoClp(leerPesos(evento.target.value));
  }
});

function pintarReporte(reporte) {
  const detalles = []
    .concat((reporte.descartados || []).map((item) => `Descartado ${item.folio || ''}: ${item.motivo}`))
    .concat((reporte.errores || []).map((item) => `Error ${item.archivo || ''} fila ${item.fila || ''}: ${item.motivo}`));
  document.getElementById('reporte-importar').innerHTML = `
    <p>Creados: ${reporte.creados}. Actualizados: ${reporte.actualizados}. Descartados: ${(reporte.descartados || []).length}. Errores: ${(reporte.errores || []).length}.</p>
    ${detalles.length ? `<ul>${detalles.map((texto) => `<li>${escapeHtml(texto)}</li>`).join('')}</ul>` : ''}`;
}

document.getElementById('modal-importar').addEventListener('click', (evento) => {
  if (evento.target.closest('[data-close]')) document.getElementById('modal-importar').close();
});

document.getElementById('form-importar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const archivos = document.getElementById('archivos-sii').files;
  if (!archivos.length || !estado.periodo) return;
  const cuerpo = new FormData();
  cuerpo.append('periodo_id', String(estado.periodo.id));
  cuerpo.append('tipo_operacion', estado.importarOperacion);
  Array.from(archivos).forEach((archivo) => cuerpo.append('archivos', archivo));
  try {
    const respuesta = await fetch('/api/documentos/importar-sii', { method: 'POST', body: cuerpo });
    const reporte = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(reporte.error || 'No se pudo importar.');
    pintarReporte(reporte);
    await cargarPeriodo();
    render();
    toast('Documentos del SII cargados.');
  } catch (error) {
    document.getElementById('reporte-importar').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
});

main.addEventListener('submit', async (evento) => {
  const form = evento.target;
  if (form.id === 'form-resumen-sii') {
    evento.preventDefault();
    try {
      await api('/api/documentos/resumen-rapido', {
        method: 'POST',
        body: JSON.stringify({
          periodo_id: estado.periodo.id,
          boletas_bruto: leerPesos(form.boletas_bruto.value),
          vouchers_bruto: leerPesos(form.vouchers_bruto.value),
        }),
      });
      await cargarPeriodo();
      render();
      toast(`IVA determinado ${formatoClp(estado.f29.real.cod_89_iva_determinado)} · Total a pagar ${formatoClp(estado.f29.real.cod_91_total_pagar)}`);
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (form.id !== 'form-documento') return;
  evento.preventDefault();
  const datos = {
    periodo_id: estado.periodo.id,
    tipo_operacion: form.dataset.operacion,
    tipo_documento: form.tipo_documento.value,
    folio: form.folio.value,
    rut_contraparte: form.rut_contraparte.value,
    razon_contraparte: form.razon_contraparte.value,
    monto_exento: leerPesos(form.monto_exento.value),
    monto_neto: leerPesos(form.monto_neto.value),
    monto_iva: leerPesos(form.monto_iva.value),
    iva_no_recuperable: leerPesos(form.iva_no_recuperable.value),
    otros_impuestos: leerPesos(form.otros_impuestos.value),
    acuse_recibo: form.acuse_recibo.checked,
    fuera_plazo_nc: form.fuera_plazo_nc.checked,
  };
  try {
    if (estado.editDocumentoId) {
      await api(`/api/documentos/${estado.editDocumentoId}`, { method: 'PUT', body: JSON.stringify(datos) });
    } else {
      await api('/api/documentos', { method: 'POST', body: JSON.stringify(datos) });
    }
    estado.editDocumentoId = null;
    await cargarPeriodo();
    render();
    toast('Documento guardado.');
  } catch (error) {
    toast(error.message);
  }
});

llenarSelectores();
cargarEmpresas()
  .then(cargarPeriodo)
  .then(render)
  .catch((error) => {
    main.innerHTML = `<p class="vacio">${escapeHtml(error.message)}</p>`;
  });
