// ============================================
// CONFIGURACIÓN
// ============================================
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbx6JXvDm8vS3nBn_jdohfaioZSReJgUUk4UGO-7LqxN4_zw45YBDMxQqVqUF8gVWGyy/exec'
};

const ACCENTS = {
  'PALET 01': 'var(--loc-palet01)',
  'PALET 02': 'var(--loc-palet02)',
  'PALET 03': 'var(--loc-palet03)',
  'ESTANTE 04': 'var(--loc-estante04)',
  'PISO': 'var(--loc-piso)',
  'REVISAR PESO': 'var(--loc-revisar)',
  'YA_COMPLETA': 'var(--loc-revisar)'
};

let currentAwb = null;
let html5QrCode = null;
let scanning = false;

// ============================================
// FETCH CON REINTENTOS — la red del almacén puede ser intermitente;
// esto reintenta antes de mostrar error, en vez de fallar a la primera.
// ============================================
async function fetchConReintentos(url, options, intentos) {
  intentos = intentos || 3;
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      ultimoError = err;
      if (i < intentos - 1) {
        await new Promise(function (resolve) { setTimeout(resolve, 1000 * (i + 1)); });
      }
    }
  }
  throw ultimoError;
}

// ============================================
// ELEMENTOS
// ============================================
const els = {
  reader: document.getElementById('reader'),
  toggleScanBtn: document.getElementById('toggleScanBtn'),
  manualForm: document.getElementById('manualForm'),
  awbInput: document.getElementById('awbInput'),
  errorMsg: document.getElementById('errorMsg'),
  result: document.getElementById('result'),
  placard: document.getElementById('placard'),
  placardLabel: document.getElementById('placardLabel'),
  placardValue: document.getElementById('placardValue'),
  dataAwb: document.getElementById('dataAwb'),
  dataCliente: document.getElementById('dataCliente'),
  dataPeso: document.getElementById('dataPeso'),
  dataTipo: document.getElementById('dataTipo'),
  dataCasillero: document.getElementById('dataCasillero'),
  overridePills: document.getElementById('overridePills'),
  nextBtn: document.getElementById('nextBtn'),
  statusDot: document.getElementById('statusDot'),
  statusLabel: document.getElementById('statusLabel'),
  operadorInput: document.getElementById('operadorInput'),
  progressLabel: document.getElementById('progressLabel'),
  progressFill: document.getElementById('progressFill'),
  tabs: document.querySelectorAll('.tab'),
  tabEscanear: document.getElementById('tabEscanear'),
  tabCliente: document.getElementById('tabCliente'),
  tabManifiestos: document.getElementById('tabManifiestos'),
  clienteForm: document.getElementById('clienteForm'),
  clienteInput: document.getElementById('clienteInput'),
  clienteResultados: document.getElementById('clienteResultados'),
  manifiestosResultados: document.getElementById('manifiestosResultados'),
  confirmOverlay: document.getElementById('confirmOverlay'),
  confirmCard: document.getElementById('confirmCard'),
  confirmValue: document.getElementById('confirmValue')
};

// ============================================
// ESTADO / UI HELPERS
// ============================================
function setStatus(state) {
  const textos = { esperando: 'esperando', ok: 'conectado', error: 'sin conexión' };
  els.statusDot.dataset.state = state;
  els.statusLabel.textContent = textos[state] || state;
}

function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.hidden = false;
}

function hideError() {
  els.errorMsg.hidden = true;
  els.errorMsg.textContent = '';
}

function hideResult() {
  els.result.hidden = true;
  currentAwb = null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// ============================================
// CARTEL DE CONFIRMACIÓN (overlay, solo en registro exitoso)
// ============================================
let overlayTimer = null;

function mostrarConfirmacion(mensaje, accentKey) {
  clearTimeout(overlayTimer);
  els.confirmCard.style.setProperty('--loc-accent', ACCENTS[accentKey] || 'var(--loc-palet01)');
  els.confirmValue.textContent = mensaje;
  els.confirmOverlay.hidden = false;
  overlayTimer = setTimeout(ocultarConfirmacion, 1800);
}

function ocultarConfirmacion() {
  clearTimeout(overlayTimer);
  els.confirmOverlay.hidden = true;
}

els.confirmOverlay.addEventListener('click', ocultarConfirmacion);

// ============================================
// OPERADOR (recordado en este navegador)
// ============================================
function cargarOperador() {
  const guardado = localStorage.getItem('crsOperador');
  if (guardado) els.operadorInput.value = guardado;
}

function guardarOperador() {
  localStorage.setItem('crsOperador', els.operadorInput.value.trim());
}

// ============================================
// PROGRESO DEL MANIFIESTO (guías completas / total)
// ============================================
function pintarProgreso(resumen) {
  els.progressLabel.textContent = resumen.totalCompletas + ' / ' + resumen.totalEsperado + ' guías completas';
  const porcentaje = resumen.totalEsperado > 0 ? (resumen.totalCompletas / resumen.totalEsperado) * 100 : 0;
  els.progressFill.style.width = porcentaje + '%';
}

async function actualizarProgreso() {
  try {
    const res = await fetch(CONFIG.API_URL + '?accion=resumen');
    const data = await res.json();
    if (data.error) return;
    pintarProgreso(data);
  } catch (err) {
    // silencioso: el contador no es crítico para poder seguir escaneando
  }
}

// El progreso ya se actualiza al instante con cada escaneo (ver arriba).
// Este intervalo es solo respaldo — por si otro operador registra algo
// desde otro dispositivo mientras esta pantalla está abierta sin escanear.
setInterval(actualizarProgreso, 30000);

// ============================================
// CÁMARA (secundaria — el método principal es la pistola/manual)
// ============================================
async function toggleScan() {
  if (scanning) {
    await stopScan();
    return;
  }
  els.reader.hidden = false;
  els.toggleScanBtn.textContent = 'Detener cámara';
  scanning = true;

  html5QrCode = new Html5Qrcode('reader');
  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decodedText) => onCodeScanned(decodedText),
      () => { /* fotograma sin código legible, se ignora */ }
    );
  } catch (err) {
    showError('No se pudo activar la cámara. Usa el campo manual mientras tanto.');
    await stopScan();
  }
}

async function stopScan() {
  scanning = false;
  els.toggleScanBtn.textContent = '📷 Usar cámara del celular';
  els.reader.hidden = true;
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) { /* ya estaba detenida */ }
    html5QrCode = null;
  }
}

function onCodeScanned(decodedText) {
  stopScan();
  procesarEscaneo(decodedText.trim());
}

// ============================================
// ESCANEO — registro automático, sin paso de confirmar
// ============================================
async function procesarEscaneo(awb) {
  hideError();
  const operador = els.operadorInput.value.trim();
  if (!operador) {
    showError('Escribe el nombre del operador antes de escanear.');
    els.operadorInput.focus();
    return;
  }

  setStatus('esperando');
  const botonBuscar = els.manualForm.querySelector('button[type="submit"]');
  botonBuscar.disabled = true;
  botonBuscar.textContent = 'Buscando…';

  try {
    const res = await fetchConReintentos(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS con Apps Script
      body: JSON.stringify({ awb: awb, operador: operador })
    });
    const data = await res.json();
    setStatus('ok');

    if (!data.ok) {
      showError(data.error || 'No se pudo procesar el AWB.');
      return;
    }

    els.awbInput.value = '';
    renderResultado(data);
    if (data.resumen) pintarProgreso(data.resumen);
  } catch (err) {
    setStatus('error');
    showError('No se pudo conectar con el servicio incluso tras varios intentos. Revisa la conexión.');
  } finally {
    botonBuscar.disabled = false;
    botonBuscar.textContent = 'Buscar';
  }
}

function renderResultado(data) {
  currentAwb = data.awb;
  const yaCompleta = data.registrado === false && data.completa === true;
  const ubicacion = data.ubicacionFinal || data.ubicacionSugerida;

  // Cartel de confirmación por encima — solo en el momento del evento
  if (yaCompleta) {
    mostrarConfirmacion('YA ESTABA COMPLETA (' + data.cajaActual + '/' + data.cajasTotal + ')', 'YA_COMPLETA');
  } else if (data.cajasTotal <= 1) {
    mostrarConfirmacion('GUÍA ÚNICA COMPLETA', 'PALET 01');
  } else if (data.cajaActual >= data.cajasTotal) {
    mostrarConfirmacion('GUÍA COMPLETADA (' + data.cajaActual + '/' + data.cajasTotal + ')', 'PALET 01');
  } else {
    mostrarConfirmacion('REGISTRADO ' + data.cajaActual + '/' + data.cajasTotal, 'ESTANTE 04');
  }

  if (yaCompleta) {
    pintarPlacard('YA_COMPLETA', 'UBICACIÓN REGISTRADA', ubicacion);
  } else {
    pintarPlacard(ubicacion, 'UBICACIÓN', ubicacion);
  }

  els.dataAwb.textContent = data.awb;
  els.dataCliente.textContent = data.cliente || '—';
  els.dataPeso.textContent = (typeof data.pesoTotal === 'number' ? data.pesoTotal.toFixed(2) : data.pesoTotal) + ' kg';
  els.dataTipo.textContent = data.tipoCliente;
  els.dataCasillero.textContent = data.casillero || '—';

  actualizarPills(ubicacion);
  els.result.hidden = false;
}

function pintarPlacard(accentKey, label, valor) {
  els.placard.style.setProperty('--loc-accent', ACCENTS[accentKey] || 'var(--text-muted)');
  els.placardLabel.textContent = label;
  els.placardValue.textContent = valor;
}

function actualizarPills(ubicacionActiva) {
  document.querySelectorAll('.pill').forEach((btn) => {
    btn.dataset.active = btn.dataset.loc === ubicacionActiva ? 'true' : 'false';
  });
}

// ============================================
// CORRECCIÓN MANUAL — inmediata al tocar una pastilla
// ============================================
els.overridePills.addEventListener('click', async (e) => {
  const btn = e.target.closest('.pill');
  if (!btn || !currentAwb) return;

  const nuevaUbicacion = btn.dataset.loc;
  const operador = els.operadorInput.value.trim();

  document.querySelectorAll('.pill').forEach((p) => (p.disabled = true));

  try {
    const res = await fetchConReintentos(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: 'corregir', awb: currentAwb, ubicacion: nuevaUbicacion, operador: operador })
    });
    const data = await res.json();

    if (!data.ok) {
      showError(data.error || 'No se pudo corregir la ubicación.');
      return;
    }

    actualizarPills(nuevaUbicacion);
    pintarPlacard(nuevaUbicacion, 'CORREGIDO MANUALMENTE', nuevaUbicacion);
  } catch (err) {
    showError('No se pudo guardar la corrección.');
  } finally {
    document.querySelectorAll('.pill').forEach((p) => (p.disabled = false));
  }
});

// ============================================
// BÚSQUEDA POR CLIENTE
// ============================================
async function buscarCliente(nombre) {
  els.clienteResultados.innerHTML = '<p class="cliente-loading">Buscando…</p>';
  try {
    const res = await fetchConReintentos(CONFIG.API_URL + '?accion=cliente&nombre=' + encodeURIComponent(nombre));
    const data = await res.json();
    renderResultadosCliente(data);
  } catch (err) {
    els.clienteResultados.innerHTML = '<p class="error">No se pudo buscar tras varios intentos. Revisa la conexión.</p>';
  }
}

function renderResultadosCliente(data) {
  if (!data.guias || data.guias.length === 0) {
    els.clienteResultados.innerHTML = '<p class="cliente-empty">No se encontraron guías para "' + escapeHtml(data.cliente) + '".</p>';
    return;
  }

  const filas = data.guias.map(function (g) {
    const estadoTexto = g.completa
      ? escapeHtml(g.ubicacionActual || g.ubicacionSugerida)
      : 'Pendiente (' + g.cajaActual + '/' + g.cajasTotal + ')';
    const estadoClave = g.completa ? 'completa' : 'pendiente';

    return '<div class="cliente-item">' +
      '<div class="cliente-item__awb">' + escapeHtml(g.awb) + '</div>' +
      '<div class="cliente-item__meta">' + escapeHtml(g.hoja) + ' · ' + g.pesoTotal.toFixed(2) + ' kg · ' + escapeHtml(g.tipoCliente) + '</div>' +
      '<span class="cliente-item__estado" data-estado="' + estadoClave + '">' + estadoTexto + '</span>' +
      '</div>';
  }).join('');

  els.clienteResultados.innerHTML = '<p class="cliente-total">' + data.totalGuias + ' guía(s) encontradas</p>' + filas;
}

// ============================================
// MANIFIESTOS — progreso por hoja Mxxx
// ============================================
async function buscarManifiestos() {
  els.manifiestosResultados.innerHTML = '<p class="cliente-loading">Cargando…</p>';
  try {
    const res = await fetchConReintentos(CONFIG.API_URL + '?accion=manifiestos');
    const data = await res.json();
    renderManifiestos(data);
  } catch (err) {
    els.manifiestosResultados.innerHTML = '<p class="error">No se pudo cargar. Revisa la conexión.</p>';
  }
}

function renderManifiestos(data) {
  if (!data.manifiestos || data.manifiestos.length === 0) {
    els.manifiestosResultados.innerHTML = '<p class="cliente-empty">No se detectaron hojas de manifiesto.</p>';
    return;
  }

  els.manifiestosResultados.innerHTML = data.manifiestos.map(function (m) {
    const porcentaje = m.totalEsperado > 0 ? (m.totalCompletas / m.totalEsperado) * 100 : 0;
    const badge = m.completado ? '<span class="manifiesto-item__badge">MANIFIESTO COMPLETADO</span>' : '';

    return '<div class="manifiesto-item" data-completo="' + m.completado + '">' +
      '<div class="manifiesto-item__header">' +
      '<span class="manifiesto-item__nombre">' + escapeHtml(m.hoja) + '</span>' +
      '<button type="button" class="manifiesto-item__conteo-btn" data-hoja="' + escapeHtml(m.hoja) + '">' + m.totalCompletas + ' / ' + m.totalEsperado + '</button>' +
      '</div>' +
      '<div class="manifiesto-item__track"><div class="manifiesto-item__fill" style="width:' + porcentaje + '%"></div></div>' +
      badge +
      '</div>';
  }).join('');
}

async function verDetalleManifiesto(hoja) {
  els.manifiestosResultados.innerHTML = '<p class="cliente-loading">Cargando ' + escapeHtml(hoja) + '…</p>';
  try {
    const res = await fetchConReintentos(CONFIG.API_URL + '?accion=manifiesto&hoja=' + encodeURIComponent(hoja));
    const data = await res.json();
    renderDetalleManifiesto(data);
  } catch (err) {
    els.manifiestosResultados.innerHTML = '<p class="error">No se pudo cargar. Revisa la conexión.</p>';
  }
}

function renderDetalleManifiesto(data) {
  const encabezado = '<button type="button" class="manifiesto-detalle__volver">← Volver a manifiestos</button>' +
    '<p class="cliente-total">' + escapeHtml(data.hoja) + ' — ' + data.totalGuias + ' guía(s)</p>';

  if (!data.guias || data.guias.length === 0) {
    els.manifiestosResultados.innerHTML = encabezado + '<p class="cliente-empty">Sin guías en este manifiesto.</p>';
    return;
  }

  const filas = data.guias.map(function (g) {
    const estadoTexto = g.completa
      ? escapeHtml(g.ubicacionActual || g.ubicacionSugerida)
      : 'Pendiente (' + g.cajaActual + '/' + g.cajasTotal + ')';
    const estadoClave = g.completa ? 'completa' : 'pendiente';

    return '<div class="cliente-item">' +
      '<div class="cliente-item__awb">' + escapeHtml(g.awb) + '</div>' +
      '<div class="cliente-item__meta">' + escapeHtml(g.cliente) + ' · ' + g.pesoTotal.toFixed(2) + ' kg · ' + escapeHtml(g.tipoCliente) + '</div>' +
      '<span class="cliente-item__estado" data-estado="' + estadoClave + '">' + estadoTexto + '</span>' +
      '</div>';
  }).join('');

  els.manifiestosResultados.innerHTML = encabezado + filas;
}

// Delegación de clics: el contenido de manifiestosResultados se regenera
// completo en cada render, así que los listeners van en el contenedor fijo.
els.manifiestosResultados.addEventListener('click', function (e) {
  const botonConteo = e.target.closest('.manifiesto-item__conteo-btn');
  if (botonConteo) {
    verDetalleManifiesto(botonConteo.dataset.hoja);
    return;
  }
  const botonVolver = e.target.closest('.manifiesto-detalle__volver');
  if (botonVolver) {
    buscarManifiestos();
  }
});

// ============================================
// TABS
// ============================================
els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    const activo = tab.dataset.tab;
    els.tabEscanear.hidden = activo !== 'escanear';
    els.tabCliente.hidden = activo !== 'cliente';
    els.tabManifiestos.hidden = activo !== 'manifiestos';
    if (activo === 'escanear') els.awbInput.focus();
    if (activo === 'manifiestos') buscarManifiestos();
  });
});

// ============================================
// EVENTOS
// ============================================
els.toggleScanBtn.addEventListener('click', toggleScan);

els.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const awb = els.awbInput.value.trim();
  if (!awb) return;
  procesarEscaneo(awb);
});

els.clienteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nombre = els.clienteInput.value.trim();
  if (!nombre) return;
  buscarCliente(nombre);
});

els.operadorInput.addEventListener('change', guardarOperador);
els.operadorInput.addEventListener('blur', guardarOperador);

els.nextBtn.addEventListener('click', () => {
  hideResult();
  hideError();
  els.awbInput.value = '';
  els.awbInput.focus();
});

setStatus('esperando');
cargarOperador();
actualizarProgreso();
els.awbInput.focus();
