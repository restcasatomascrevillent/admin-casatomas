'use strict';
const crypto = require('crypto');
const fs = require('fs');

// ---------- Config ----------
const MARKER = '[DEMO-SEED]';
const TODAY = '2026-09-23';
const BLACKOUT_DATES = new Set(['2026-09-25']); // hoy+2: cron de recordatorios a las 08:00
const PAST_DAYS = 30;   // ultimo mes
const FUTURE_DAYS = 14; // proximas dos semanas

const ESPACIOS = {
  comedor:  { id: '449cffc7-1189-4f3c-a0b3-b60b3442979d', marca: 'casa_tomas' },
  salon:    { id: 'db8be4e2-2e67-4110-99b1-9e1d779514cc', marca: 'casa_tomas' },
  terraza:  { id: '5888d22a-f228-41f5-8a9d-c8b3ee255863', marca: 'casa_tomas' },
  reservado:{ id: '1c976f78-0bd7-4d10-b7bf-5208c910d16d', marca: 'touza' },
};
const CASA_TOMAS_ESPACIOS = ['comedor', 'salon', 'terraza'];
const CAP_CASA_TOMAS = 150;
const CAP_TOUZA = 20;

let SEED = 20260923;
function rnd() { // mulberry32, reproducible
  SEED |= 0; SEED = (SEED + 0x6D2B79F5) | 0;
  let t = Math.imul(SEED ^ (SEED >>> 15), 1 | SEED);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function choice(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function int(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
function weighted(pairs) { // [[value,weight], ...]
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) { if (r < w) return v; r -= w; }
  return pairs[pairs.length - 1][0];
}
function esc(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function uuid() { return crypto.randomUUID(); }
function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N');
}

// ---------- Name pools ----------
const NOMBRES = ['Lucia','Marcos','Elena','Sergio','Paula','Raul','Marta','Nuria','Hector','Alba',
  'Ruben','Silvia','Ismael','Cristina','Oscar','Patricia','Ignacio','Yolanda','Victor','Monica',
  'Alvaro','Beatriz','Emilio','Rosa','Gonzalo','Teresa','Ricardo','Sonia','Felipe','Irene',
  'Damian','Noelia','Ezequiel','Celia','Anton','Lorena','Guillermo','Vanesa','Mateo','Esperanza'];
const APELLIDOS = ['Garcia','Martinez','Lopez','Sanchez','Perez','Gomez','Fernandez','Diaz','Alvarez',
  'Romero','Navarro','Molina','Ortega','Delgado','Castro','Ramos','Vega','Serrano','Iglesias','Nunez',
  'Cabrera','Reyes','Cortes','Guerrero','Prieto','Santos','Rubio','Marin','Crespo','Vidal'];

function nombreCompleto() { return choice(NOMBRES) + ' ' + choice(APELLIDOS) + ' ' + choice(APELLIDOS); }

// ---------- Notas pool (siempre con marcador) ----------
const NOTAS = [
  '', 'Cumpleanos, tarta sorpresa', 'Alergia a frutos secos', 'Mesa tranquila si es posible',
  'Silla para bebe', 'Aniversario', 'Grupo de trabajo, cena de empresa', 'Sin gluten',
  'Ventana si puede ser', 'Celiaco, extremar precaucion', 'Piden tarta de cumpleanos',
  'Cena de despedida de soltera', 'Prefieren terraza', 'Intolerancia a la lactosa',
  'Vienen en silla de ruedas, mesa accesible', 'Mesa junto a la entrada', 'Reunion familiar',
  '', '', ''
];
function notaCliente() {
  const extra = choice(NOTAS);
  return extra ? MARKER + ' ' + extra : MARKER;
}

// ---------- Fechas ----------
function toISO(d) { return d.toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return toISO(d); }
function dow(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); } // 0=domingo

const fechas = [];
for (let i = -PAST_DAYS; i <= FUTURE_DAYS; i++) {
  const f = addDays(TODAY, i);
  if (!BLACKOUT_DATES.has(f)) fechas.push(f);
}

// ---------- Horas ----------
const COMIDA_SLOTS = [['13:00',1],['13:30',2],['14:00',3],['14:30',3],['15:00',2],['15:30',1]];
const CENA_SLOTS = [['20:00',1],['20:30',2],['21:00',3],['21:30',3],['22:00',2],['22:30',1]];
function horaComida() { return weighted(COMIDA_SLOTS); }
function horaCena() { return weighted(CENA_SLOTS); }

const PARTY_SIZES = [2,2,2,3,3,3,3,4,4,4,4,5,5,6,6,7,8,8,10,12];
function partySize() { return choice(PARTY_SIZES); }

const CANALES = [['web',50],['telefono',35],['manual',15]];
function canal() { return weighted(CANALES); }

// day-of-week profile: [min,max] intentos por turno (0=domingo..6=sabado)
const PROFILE = {
  0: { comida: [4,6], cena: [2,4] },
  1: { comida: [1,2], cena: [1,2] },
  2: { comida: [1,2], cena: [1,2] },
  3: { comida: [1,3], cena: [1,3] },
  4: { comida: [1,3], cena: [1,3] },
  5: { comida: [2,4], cena: [4,6] },
  6: { comida: [3,5], cena: [5,8] },
};

// ---------- Estado por tier ----------
function estadoPast() {
  return weighted([['confirmada',55],['completada',20],['no_show',10],['cancelada',15]]);
}
function estadoToday() {
  return weighted([['confirmada',75],['verificada',15],['pendiente',5],['cancelada',5]]);
}
function estadoFuture() {
  return weighted([['confirmada',55],['verificada',20],['pendiente',20],['cancelada',5]]);
}
const ACTIVE_STATES = new Set(['pendiente','verificada','confirmada']);

// ---------- Telefonos / emails ----------
const usedPhones = [];
function telefono(fecha, usedTodayForFecha) {
  // 15% de probabilidad de reutilizar un telefono ya usado (cliente habitual),
  // respetando como maximo 2 reservas por telefono y por fecha (regla de negocio real).
  if (usedPhones.length > 5 && rnd() < 0.15) {
    for (let tries = 0; tries < 5; tries++) {
      const cand = choice(usedPhones);
      const key = cand + '|' + fecha;
      if ((usedTodayForFecha.get(key) || 0) < 2) return cand;
    }
  }
  const n = int(0, 999);
  const tel = '600000' + String(n).padStart(3, '0');
  usedPhones.push(tel);
  return tel;
}
function emailFor(nombreCompletoStr) {
  if (rnd() < 0.35) return null; // email_obligatorio = false
  const parts = stripAccents(nombreCompletoStr).toLowerCase().split(' ');
  return parts[0] + '.' + parts[1] + int(1,99) + '@example.com';
}

// ---------- Generacion de reservas ----------
const reservas = [];
const activeSum = new Map(); // key fecha|turno|marca -> suma comensales activos
const phoneDayCount = new Map(); // key tel|fecha -> count

function keyOf(fecha, turno, marca) { return fecha + '|' + turno + '|' + marca; }

function tryAddReserva(opts) {
  const fecha = opts.fecha, hora = opts.hora, turno = opts.turno, marca = opts.marca, espacioKey = opts.espacioKey;
  const nombre = nombreCompleto();
  const comensales = partySize();
  const tel = telefono(fecha, phoneDayCount);
  const dk = tel + '|' + fecha;
  phoneDayCount.set(dk, (phoneDayCount.get(dk) || 0) + 1);
  const email = emailFor(nombre);
  const ch = canal();
  const importante = rnd() < 0.05;
  const tier = fecha < TODAY ? 'past' : (fecha === TODAY ? 'today' : 'future');
  let estado = tier === 'past' ? estadoPast() : (tier === 'today' ? estadoToday() : estadoFuture());

  if (ACTIVE_STATES.has(estado)) {
    const cap = marca === 'touza' ? CAP_TOUZA : CAP_CASA_TOMAS;
    const k = keyOf(fecha, turno, marca);
    const cur = activeSum.get(k) || 0;
    if (cur + comensales > cap) {
      estado = 'cancelada'; // no cabe: se queda como reserva que no llego a confirmarse
    } else {
      activeSum.set(k, cur + comensales);
    }
  }

  const espacio = espacioKey ? ESPACIOS[espacioKey].id : null;

  reservas.push({
    fecha: fecha, hora: hora, numero_comensales: comensales, estado: estado, nombre: nombre,
    telefono: tel, email: email, canal: ch, marca: marca, espacio_id: espacio,
    importante: importante, notas_cliente: notaCliente(),
  });
}

for (const fecha of fechas) {
  const d = dow(fecha);
  const prof = PROFILE[d];
  let comidaN, cenaN;
  if (fecha === TODAY) { comidaN = int(6, 8); cenaN = int(6, 8); }
  else { comidaN = int(prof.comida[0], prof.comida[1]); cenaN = int(prof.cena[0], prof.cena[1]); }

  for (let i = 0; i < comidaN; i++) {
    tryAddReserva({ fecha: fecha, hora: horaComida(), turno: 'comida', marca: 'casa_tomas', espacioKey: rnd() < 0.9 ? choice(CASA_TOMAS_ESPACIOS) : null });
  }
  for (let i = 0; i < cenaN; i++) {
    tryAddReserva({ fecha: fecha, hora: horaCena(), turno: 'cena', marca: 'casa_tomas', espacioKey: rnd() < 0.9 ? choice(CASA_TOMAS_ESPACIOS) : null });
  }
  // Touza / El Reservado: volumen mucho menor, aforo 20
  if (rnd() < 0.22) {
    const turno = rnd() < 0.5 ? 'comida' : 'cena';
    tryAddReserva({ fecha: fecha, hora: turno === 'comida' ? horaComida() : horaCena(), turno: turno, marca: 'touza', espacioKey: 'reservado' });
  }
  if (d === 6 && rnd() < 0.3) { // sabado, segunda reserva touza ocasional
    tryAddReserva({ fecha: fecha, hora: horaCena(), turno: 'cena', marca: 'touza', espacioKey: 'reservado' });
  }
}

// ---------- Autochequeo de aforo ----------
for (const entry of activeSum.entries()) {
  const k = entry[0], sum = entry[1];
  const marca = k.split('|')[2];
  const cap = marca === 'touza' ? CAP_TOUZA : CAP_CASA_TOMAS;
  if (sum > cap) throw new Error('AFORO SUPERADO en ' + k + ': ' + sum + ' > ' + cap);
}

// ---------- Trabajadores demo ----------
const TRABAJADORES_BASE = [
  { nombre: 'Lucia',   apellidos: 'Ortega Vega',      puesto: 'cocinero' },
  { nombre: 'Marcos',  apellidos: 'Delgado Rubio',    puesto: 'ayudante_cocina' },
  { nombre: 'Elena',   apellidos: 'Prieto Santos',    puesto: 'camarero' },
  { nombre: 'Sergio',  apellidos: 'Cabrera Reyes',    puesto: 'camarero' },
  { nombre: 'Paula',   apellidos: 'Iglesias Nunez',   puesto: 'ayudante_camarero' },
  { nombre: 'Raul',    apellidos: 'Serrano Marin',    puesto: 'gerente' },
  { nombre: 'Nuria',   apellidos: 'Crespo Vidal',     puesto: 'limpieza' },
];
const TRABAJADORES = TRABAJADORES_BASE.map(function(t) {
  const id = uuid();
  const tel = '600000' + String(int(0, 999)).padStart(3, '0');
  const email = stripAccents(t.nombre).toLowerCase() + '.' + stripAccents(t.apellidos.split(' ')[0]).toLowerCase() + '.demo@example.com';
  const salario = (int(950, 1400) / 100).toFixed(2);
  const notas = MARKER + ' Personal ficticio para poblar el panel de demostracion.';
  return { nombre: t.nombre, apellidos: t.apellidos, puesto: t.puesto, id: id, telefono: tel, email: email, salario_hora: salario, notas: notas };
});

// ---------- Turnos (2 semanas: hoy-7 .. hoy+6) ----------
function shiftsFor(puesto, d) { // d = dia de la semana 0..6
  if (puesto === 'gerente') {
    if (d === 1) return []; // libra lunes
    return [['12:00','16:00'], ['19:30','23:30']];
  }
  if (puesto === 'cocinero' || puesto === 'ayudante_cocina') {
    if (d === 1 || d === 2) return []; // libra lunes y martes
    return [['12:00','16:00'], ['19:30','23:30']];
  }
  if (puesto === 'camarero' || puesto === 'ayudante_camarero') {
    if (d === 2 || d === 3) return []; // libra martes y miercoles
    return [['12:30','16:00'], ['20:00','23:45']];
  }
  if (puesto === 'limpieza') {
    if (d === 0) return []; // libra domingo
    return [['09:00','13:00']];
  }
  if (puesto === 'recepcionista') {
    if (d === 1) return [];
    return [['18:00','23:00']];
  }
  return [['12:00','16:00']];
}

const turnos = [];
for (const t of TRABAJADORES) {
  for (let i = -7; i <= 6; i++) {
    const fecha = addDays(TODAY, i);
    const d = dow(fecha);
    const estadoTurno = fecha < TODAY ? 'completado' : (fecha === TODAY ? 'activo' : 'programado');
    const turnosDelDia = shiftsFor(t.puesto, d);
    for (const par of turnosDelDia) {
      turnos.push({ trabajador_id: t.id, fecha: fecha, hora_inicio: par[0], hora_fin: par[1], estado: estadoTurno, notas: MARKER });
    }
  }
}

// ---------- registro_horas: fichados ahora mismo (hoy, sin hora_salida) ----------
const registroHoras = TRABAJADORES.map(function(t) {
  const turnosHoy = shiftsFor(t.puesto, dow(TODAY));
  const horaEntrada = turnosHoy.length > 0 ? turnosHoy[0][0] : '12:00';
  return {
    trabajador_id: t.id,
    fecha: TODAY,
    hora_entrada: TODAY + ' ' + horaEntrada + ':00+02',
    notas: MARKER + ' Fichaje de demostracion (sin hora de salida = personal activo ahora).',
  };
});

// ---------- SQL ----------
let sql = '-- =====================================================================\n' +
'-- Casa Tomas / Touza - datos de DEMOSTRACION para el panel admin\n' +
'-- Generado automaticamente. Marcador de demo: ' + MARKER + '\n' +
'-- NUNCA ejecutar contra una base con datos reales. Ver README.md.\n' +
'-- =====================================================================\n\n' +
'BEGIN;\n\n' +
'-- ---------------------------------------------------------------------\n' +
'-- trabajadores (personal ficticio)\n' +
'-- ---------------------------------------------------------------------\n' +
'INSERT INTO public.trabajadores (id, nombre, apellidos, telefono, email, puesto, activo, salario_hora, notas) VALUES\n';

sql += TRABAJADORES.map(function(t) {
  return '  (' + esc(t.id) + ', ' + esc(t.nombre) + ', ' + esc(t.apellidos) + ', ' + esc(t.telefono) + ', ' + esc(t.email) + ', ' + esc(t.puesto) + ', true, ' + t.salario_hora + ', ' + esc(t.notas) + ')';
}).join(',\n') + ';\n\n';

sql += '-- ---------------------------------------------------------------------\n' +
'-- turnos (planificacion: 7 dias atras .. 6 dias adelante)\n' +
'-- ---------------------------------------------------------------------\n' +
'INSERT INTO public.turnos (trabajador_id, fecha, hora_inicio, hora_fin, estado, notas) VALUES\n';
sql += turnos.map(function(s) {
  return '  (' + esc(s.trabajador_id) + ', ' + esc(s.fecha) + ', ' + esc(s.hora_inicio) + ', ' + esc(s.hora_fin) + ', ' + esc(s.estado) + ', ' + esc(s.notas) + ')';
}).join(',\n') + ';\n\n';

sql += '-- ---------------------------------------------------------------------\n' +
'-- registro_horas (fichajes de hoy, sin hora_salida => "trabajando ahora")\n' +
'-- ---------------------------------------------------------------------\n' +
'INSERT INTO public.registro_horas (trabajador_id, fecha, hora_entrada, hora_salida, notas) VALUES\n';
sql += registroHoras.map(function(r) {
  return '  (' + esc(r.trabajador_id) + ', ' + esc(r.fecha) + ', ' + esc(r.hora_entrada) + '::timestamptz, NULL, ' + esc(r.notas) + ')';
}).join(',\n') + ';\n\n';

sql += '-- ---------------------------------------------------------------------\n' +
'-- reservas (ultimo mes + proximas dos semanas; se excluye ' + Array.from(BLACKOUT_DATES).join(', ') + ' por el cron de recordatorios de las 08:00)\n' +
'-- ---------------------------------------------------------------------\n' +
'INSERT INTO public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, notas_cliente) VALUES\n';
sql += reservas.map(function(r) {
  return '  (' + esc(r.fecha) + ', ' + esc(r.hora) + ', ' + r.numero_comensales + ', ' + esc(r.estado) + ', ' + esc(r.nombre) + ', ' + esc(r.telefono) + ', ' + esc(r.email) + ', ' + esc(r.canal) + ', ' + esc(r.marca) + ', ' + (r.espacio_id ? esc(r.espacio_id) : 'NULL') + ', ' + r.importante + ', ' + esc(r.notas_cliente) + ')';
}).join(',\n') + ';\n\n';

sql += 'COMMIT;\n';

const OUT = process.argv[2];
fs.writeFileSync(OUT, sql, 'utf8');

// ---------- Resumen ----------
function count(arr, fn) { const m = new Map(); for (const x of arr) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); } return Object.fromEntries(m); }
const resumen = {
  trabajadores: TRABAJADORES.length,
  turnos: turnos.length,
  registro_horas: registroHoras.length,
  reservas_total: reservas.length,
  reservas_por_estado: count(reservas, function(r){ return r.estado; }),
  reservas_por_marca: count(reservas, function(r){ return r.marca; }),
  reservas_por_canal: count(reservas, function(r){ return r.canal; }),
  reservas_hoy: reservas.filter(function(r){ return r.fecha === TODAY; }).length,
  reservas_hoy_confirmadas: reservas.filter(function(r){ return r.fecha === TODAY && r.estado === 'confirmada'; }).length,
  fecha_min: fechas[0], fecha_max: fechas[fechas.length - 1],
  dias_incluidos: fechas.length,
  sql_bytes: sql.length,
};
console.log(JSON.stringify(resumen, null, 2));
