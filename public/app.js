// Módulo de Auditores: ingreso con usuario, lee aud_solicitudes de Supabase, filtra y descarga en Excel.
const CFG = window.AUD_CONFIG;
const LOCAL = new URLSearchParams(location.search).has('local');
const sb = LOCAL ? null : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const DOMINIO = '@tiemposdac.local';
const CLAVE_INICIAL = '12345678';
const ROLES = { admin: 'Administrador', jefe: 'Jefe DAC', gerente: 'Gerente DAC', auditor: 'Auditor' };
// "Hilcia Paola Morales Mendez" → "hilcia.paola.morales.mendez" (igual que Tiempos DAC)
const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

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

const S = { perfil: null, datos: [], periodo: null, tab: 'pendientes', orden: { k: 'fecha_aprobado_informa', asc: true } };

// ---------- Sesión ----------
async function perfilActual() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  return ok(await sb.from('aud_perfiles').select('*').eq('id', data.session.user.id).maybeSingle());
}

function mostrarLogin(msg = '') {
  $('app').hidden = true;
  $('login').hidden = false;
  $('flog').hidden = false;
  $('fclave').hidden = true;
  $('lmsg').textContent = msg;
}

$('flog').addEventListener('submit', async e => {
  e.preventDefault();
  const clave = $('lp').value;
  try {
    ok(await sb.auth.signInWithPassword({ email: slug($('lu').value) + DOMINIO, password: clave }));
    const p = await perfilActual();
    if (!p || !p.activo) { await sb.auth.signOut(); return mostrarLogin('Usuario sin acceso al Módulo de Auditores'); }
    S.perfil = p;
    $('lp').value = '';
  } catch {
    return mostrarLogin('Usuario o contraseña incorrectos');
  }
  // Con la contraseña genérica no se entra hasta elegir una propia
  if (clave === CLAVE_INICIAL) {
    $('flog').hidden = true;
    $('fclave').hidden = false;
    $('cmsg').textContent = '';
    return $('cn1').focus();
  }
  await iniciar();
});

$('fclave').addEventListener('submit', async e => {
  e.preventDefault();
  const n1 = $('cn1').value, n2 = $('cn2').value;
  if (n1.length < 8) return ($('cmsg').textContent = 'La contraseña debe tener al menos 8 caracteres.');
  if (n1 === CLAVE_INICIAL) return ($('cmsg').textContent = 'Use una contraseña distinta de la genérica.');
  if (n1 !== n2) return ($('cmsg').textContent = 'Las dos contraseñas no coinciden.');
  try {
    ok(await sb.auth.updateUser({ password: n1 }));
    $('cn1').value = $('cn2').value = '';
    await iniciar();
  } catch (err) { $('cmsg').textContent = err.message; }
});

async function iniciar() {
  $('login').hidden = true;
  $('app').hidden = false;
  const rol = S.perfil?.rol;
  $('yoNombre').textContent = S.perfil?.nombre || 'Vista previa local';
  $('yoRol').textContent = ROLES[rol] || '';
  $('tabAdmin').hidden = !(rol === 'admin' || rol === 'jefe');
  $('btnClave').hidden = $('btnSalir').hidden = LOCAL;
  await cargar();
}

// ---------- Datos ----------
async function leerTodo(tabla, orden) {
  // PostgREST entrega como máximo 1000 filas por llamada: se pide por páginas
  const filas = [];
  for (let i = 0; ; i += 1000) {
    const p = ok(await sb.from(tabla).select('*').order(orden).range(i, i + 999));
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
    const [filas, conf] = await Promise.all([leerTodo('aud_solicitudes', 'solicitud'),
      sb.from('aud_config').select('valor').eq('clave', 'ultima_actualizacion').then(ok)]);
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
// Supabase devuelve "2026-10-09T11:01:48"; el archivo local, "2026-10-09 11:01:48"
const fmtFecha = v => { const [d, h] = v.split(/[ T]/); const [a, m, dd] = d.split('-'); return `${dd}/${m}/${a} ${h.slice(0, 5)}`; };
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
  const admin = S.tab === 'admin';
  $('vistaDatos').hidden = admin;
  $('vistaAdmin').hidden = !admin;
  $('btnDescargar').hidden = admin;
  if (admin) return pintarUsuarios();
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
    const p = ok(await sb.from('aud_actualizaciones').insert({ solicitado_nombre: S.perfil.nombre }).select().single());
    const t0 = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 4000));
      const e = ok(await sb.from('aud_actualizaciones').select('estado,mensaje').eq('id', p.id).single());
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

// ---------- Administración (admin: todo; Jefe DAC: solo crear auditores) ----------
async function pintarUsuarios() {
  const admin = S.perfil?.rol === 'admin';
  const roles = admin ? Object.keys(ROLES) : ['auditor'];
  $('nRol').innerHTML = roles.map(r => `<option value="${r}">${ROLES[r]}</option>`).join('');
  if (LOCAL) { $('tusuarios').innerHTML = '<tr><td colspan="4" class="nada">Vista previa local: sin usuarios</td></tr>'; return; }
  try {
    const us = ok(await sb.from('aud_perfiles').select('*').order('nombre'));
    $('tusuarios').innerHTML = us.map(u => `<tr data-id="${u.id}">
      <td>${esc(u.nombre)}</td>
      <td>${admin ? `<select data-campo="rol">${Object.entries(ROLES).map(([k, t]) => `<option value="${k}"${k === u.rol ? ' selected' : ''}>${t}</option>`).join('')}</select>` : ROLES[u.rol]}</td>
      <td>${admin ? `<input type="checkbox" data-campo="activo"${u.activo ? ' checked' : ''}>` : (u.activo ? 'Sí' : 'No')}</td>
      <td>${admin ? '<button class="btn mini lin" data-acc="clave">Restablecer contraseña</button>' : ''}</td></tr>`).join('');
  } catch (err) { aviso(err.message, true); }
}

$('fnuevo').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = $('nNombre').value.trim().replace(/\s+/g, ' ');
  try {
    ok(await sb.rpc('aud_crear_usuario', { p_usuario: slug(nombre), p_nombre: nombre, p_rol: $('nRol').value, p_password: CLAVE_INICIAL }));
    $('nNombre').value = '';
    alert(`Usuario creado. Ingresa con su nombre completo "${nombre}" y la contraseña ${CLAVE_INICIAL}; la primera vez se le pide cambiarla (si ya usaba Tiempos DAC, entra con su contraseña de siempre).`);
    pintarUsuarios();
  } catch (err) { alert(err.message); }
});

$('tusuarios').addEventListener('change', async e => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  try {
    ok(await sb.rpc('aud_editar_usuario', { p_id: tr.dataset.id, p_rol: tr.querySelector('[data-campo=rol]').value,
                                             p_activo: tr.querySelector('[data-campo=activo]').checked }));
  } catch (err) { alert(err.message); pintarUsuarios(); }
});

$('tusuarios').addEventListener('click', async e => {
  const b = e.target.closest('button[data-acc=clave]');
  if (!b || !confirm(`¿Restablecer la contraseña a ${CLAVE_INICIAL}?`)) return;
  try {
    ok(await sb.rpc('aud_restablecer_clave', { p_id: b.closest('tr').dataset.id, p_password: CLAVE_INICIAL }));
    alert(`Contraseña restablecida a ${CLAVE_INICIAL}.`);
  } catch (err) { alert(err.message); }
});

$('btnClave').addEventListener('click', async () => {
  const actual = prompt('Contraseña actual:');
  if (!actual) return;
  const nueva = prompt('Nueva contraseña (mínimo 8 caracteres). Si usa Tiempos DAC, también cambia allá:');
  if (!nueva) return;
  if (nueva.length < 8) return alert('La contraseña debe tener al menos 8 caracteres.');
  if (nueva === CLAVE_INICIAL) return alert('Use una contraseña distinta de la genérica.');
  try {
    ok(await sb.auth.signInWithPassword({ email: S.perfil.usuario + DOMINIO, password: actual }));
    ok(await sb.auth.updateUser({ password: nueva }));
    alert('Contraseña cambiada.');
  } catch { alert('La contraseña actual no es correcta.'); }
});

$('btnSalir').addEventListener('click', async () => { await sb.auth.signOut(); S.perfil = null; mostrarLogin(); });

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

(async () => {
  try {
    if (LOCAL) return await iniciar();
    // Sin sesión guardada: hay que ingresar (así también se revisa si trae la contraseña genérica)
    S.perfil = await perfilActual();
    if (S.perfil?.activo) await iniciar(); else mostrarLogin();
  } catch (err) {
    mostrarLogin(`No se pudo iniciar: ${err.message}`);
  }
})();
