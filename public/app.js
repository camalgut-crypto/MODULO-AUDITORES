// Módulo de Auditores: lee aud_solicitudes de Supabase, filtra, y descarga en Excel.
const CFG = window.AUD_CONFIG;
const LOCAL = new URLSearchParams(location.search).has('local');
const $ = id => document.getElementById(id);

// Columnas de la imagen de referencia; la pestaña Auditadas agrega fecha y usuario de auditoría
const COLS = [
  { k: 'solicitud', t: 'Solicitud' },
  { k: 'llave', t: 'Llave' },
  { k: 'estado', t: 'Estado' },
  { k: 'tipo_credito', t: 'Tipo_Credito' },
  { k: 'categorizacion', t: 'Categorizacion' },
  { k: 'fecha_aprobado_informa', t: 'Fecha aprobacion informa', fecha: true },
  { k: 'fecha_formalizado', t: 'Fecha Formalizado', fecha: true },
  { k: 'fecha_digitalizado', t: 'Fecha de digitalizado', fecha: true },
  { k: 'promotor', t: 'Promotor' },
  { k: 'usuario_formaliza', t: 'Usuario Formaliza' },
  { k: 'usuario_digitaliza', t: 'Usuario digitaliza' },
];
const COLS_AUD = [...COLS,
  { k: 'fecha_auditado', t: 'Fecha Auditado', fecha: true },
  { k: 'usuario_audita', t: 'Usuario Audita' },
];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const S = { datos: [], periodo: null, tab: 'pendientes', orden: { k: 'fecha_aprobado_informa', asc: true } };

// ---------- Datos ----------
async function rest(ruta, opciones = {}) {
  const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${ruta}`, {
    ...opciones,
    headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
               'Content-Type': 'application/json', ...(opciones.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

async function leerTodo() {
  // PostgREST entrega como máximo 1000 filas por llamada: se pide por páginas
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const p = await rest('aud_solicitudes?select=*&order=solicitud', { headers: { Range: `${desde}-${desde + 999}` } });
    filas.push(...p);
    if (p.length < 1000) return filas;
  }
}

async function cargar() {
  let ultima = null;
  if (LOCAL) {
    const d = await (await fetch('local/datos.json', { cache: 'no-store' })).json();
    S.datos = d.solicitudes; ultima = d.ultima_actualizacion;
  } else {
    const [filas, conf] = await Promise.all([leerTodo(), rest('aud_config?select=valor&clave=eq.ultima_actualizacion')]);
    S.datos = filas; ultima = conf[0]?.valor;
  }
  $('ultima').textContent = ultima ? `Actualizado ${new Date(ultima).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Sin datos aún';
  armarPeriodos();
  armarFiltros();
  pintar();
}

// ---------- Mes ----------
function nombreMes(p) { const [a, m] = p.split('-'); return `${MESES[+m - 1]} ${a}`; }

function armarPeriodos() {
  const ps = [...new Set(S.datos.map(r => r.periodo))].sort();
  if (!ps.includes(S.periodo)) {
    // Del 1 al 5 se abre el mes anterior (cierre); después, el mes en curso
    const hoy = new Date();
    const ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const pAnt = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`;
    S.periodo = hoy.getDate() <= 5 && ps.includes(pAnt) ? pAnt : ps[ps.length - 1] || null;
  }
  $('periodos').innerHTML = ps.map(p => `<button type="button" data-p="${p}" class="${p === S.periodo ? 'on' : ''}">${nombreMes(p)}</button>`).join('')
    || '<button type="button" disabled>—</button>';
}

function armarFiltros() {
  const del = S.datos.filter(r => r.periodo === S.periodo);
  for (const [id, k] of [['fTipo', 'tipo_credito'], ['fEstado', 'estado'], ['fCat', 'categorizacion']]) {
    const el = $(id), actual = el.value;
    const vals = [...new Set(del.map(r => r[k]).filter(Boolean))].sort();
    el.innerHTML = '<option value="">Todos</option>' + vals.map(v => `<option>${esc(v)}</option>`).join('');
    if (vals.includes(actual)) el.value = actual;
  }
}

// ---------- Filtros y vista ----------
function filtrar(tab) {
  const q = $('fBuscar').value.trim().toUpperCase();
  const tipo = $('fTipo').value, est = $('fEstado').value, cat = $('fCat').value;
  return S.datos.filter(r => r.periodo === S.periodo
    && (tab === 'auditadas') === (r.estado === 'AUDITADO')
    && (!tipo || r.tipo_credito === tipo) && (!est || r.estado === est) && (!cat || r.categorizacion === cat)
    && (!q || [r.solicitud, r.llave, r.promotor, r.usuario_formaliza, r.usuario_digitaliza, r.usuario_audita]
      .some(v => v != null && String(v).toUpperCase().includes(q))));
}

function ordenar(filas) {
  const { k, asc } = S.orden;
  return filas.sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
  });
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtFecha = v => { const [d, h] = v.split(' '); const [a, m, dd] = d.split('-'); return `${dd}/${m}/${a} ${h.slice(0, 5)}`; };
function claseEstado(e) {
  if (e === 'AUDITADO' || e === 'FORMALIZADO' || e === 'REVISADO') return e;
  if (/INCOMPLETO/.test(e)) return 'INCOMPLETO';
  if (/CORREGIDO/.test(e)) return 'CORREGIDO';
  return '';
}

function kpis() {
  const del = S.datos.filter(r => r.periodo === S.periodo);
  const n = del.length, pct = x => n ? `${Math.round(100 * x / n)}% del mes` : '';
  const form = del.filter(r => r.fecha_formalizado).length;
  const dig = del.filter(r => r.fecha_digitalizado).length;
  const aud = del.filter(r => r.estado === 'AUDITADO').length;
  const t = [['Aprobadas Informa', n, S.periodo ? nombreMes(S.periodo) : '', 'navy'],
             ['Formalizadas', form, pct(form), 'cielo'],
             ['Digitalizadas', dig, pct(dig), 'lima'],
             ['Auditadas', aud, pct(aud), ''],
             ['Por auditar', n - aud, pct(n - aud), 'naranja']];
  $('kpis').innerHTML = t.map(([l, v, s, c]) =>
    `<div class="kpi ${c}"><div class="l">${l}</div><div class="v">${v.toLocaleString('es-NI')}</div><div class="s">${s}</div></div>`).join('');
}

function pintar() {
  kpis();
  const pend = filtrar('pendientes'), aud = filtrar('auditadas');
  $('cntPend').textContent = pend.length.toLocaleString('es-NI');
  $('cntAud').textContent = aud.length.toLocaleString('es-NI');
  const cols = S.tab === 'auditadas' ? COLS_AUD : COLS;
  const filas = ordenar(S.tab === 'auditadas' ? aud : pend);
  $('thead').innerHTML = '<tr>' + cols.map(c =>
    `<th data-k="${c.k}">${c.t}${S.orden.k === c.k ? `<span class="flecha">${S.orden.asc ? '▲' : '▼'}</span>` : ''}</th>`).join('') + '</tr>';
  $('tbody').innerHTML = filas.map(r => '<tr>' + cols.map(c => {
    const v = r[c.k];
    if (v == null || v === '') return '<td class="nada">—</td>';
    if (c.fecha) return `<td class="fecha">${fmtFecha(v)}</td>`;
    if (c.k === 'estado') return `<td><span class="est ${claseEstado(v)}">${esc(v)}</span></td>`;
    return `<td>${esc(v)}</td>`;
  }).join('') + '</tr>').join('');
  $('vacio').hidden = filas.length > 0;
}

// ---------- Descarga ----------
function hoja(filas, cols) {
  const datos = filas.map(r => Object.fromEntries(cols.map(c => {
    const v = r[c.k];
    return [c.t, v == null ? '' : c.fecha ? new Date(v.replace(' ', 'T')) : v];
  })));
  const ws = XLSX.utils.json_to_sheet(datos, { header: cols.map(c => c.t), cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' });
  ws['!cols'] = cols.map(c => ({ wch: c.fecha ? 17 : Math.max(c.t.length + 2, c.k === 'promotor' || c.k.startsWith('usuario') ? 34 : 14) }));
  return ws;
}

function descargar() {
  if (!S.periodo) return;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja(ordenar(filtrar('pendientes')), COLS), 'Por auditar');
  XLSX.utils.book_append_sheet(wb, hoja(ordenar(filtrar('auditadas')), COLS_AUD), 'Auditadas');
  XLSX.writeFile(wb, `Modulo Auditores ${nombreMes(S.periodo)}.xlsx`);
}

// ---------- Actualizar ----------
function aviso(texto, error = false) {
  $('aviso').hidden = !texto;
  $('aviso').textContent = texto || '';
  $('aviso').classList.toggle('error', error);
}

async function actualizar() {
  if (LOCAL) return cargar();
  const btn = $('btnActualizar');
  btn.disabled = true; btn.textContent = 'Actualizando…';
  try {
    const [p] = await rest('aud_actualizaciones', { method: 'POST', body: '{}', headers: { Prefer: 'return=representation' } });
    const t0 = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 4000));
      const [e] = await rest(`aud_actualizaciones?select=estado,mensaje&id=eq.${p.id}`);
      if (e.estado === 'ok') { aviso(''); await cargar(); break; }
      if (e.estado === 'error') { aviso(`La actualización falló: ${e.mensaje || ''}`, true); break; }
      if (e.estado === 'pendiente' && Date.now() - t0 > 60000) {
        aviso('El proceso de actualización no respondió: la PC que lo ejecuta puede estar apagada. Se muestran los últimos datos cargados; la solicitud queda en cola.', true);
        break;
      }
    }
  } catch (err) {
    aviso(`No se pudo pedir la actualización: ${err.message}`, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Actualizar';
  }
}

// ---------- Eventos ----------
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  pintar();
});
$('periodos').addEventListener('click', e => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  S.periodo = b.dataset.p;
  armarPeriodos(); armarFiltros(); pintar();
});
$('thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-k]');
  if (!th) return;
  S.orden = { k: th.dataset.k, asc: S.orden.k === th.dataset.k ? !S.orden.asc : true };
  pintar();
});
for (const id of ['fTipo', 'fEstado', 'fCat']) $(id).addEventListener('change', pintar);
$('fBuscar').addEventListener('input', pintar);
$('btnDescargar').addEventListener('click', descargar);
$('btnActualizar').addEventListener('click', actualizar);

cargar().catch(err => aviso(`No se pudieron leer los datos: ${err.message}`, true));
