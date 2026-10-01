'use strict';
// =============================================================================
// Generador de la DEMO DE OCTUBRE 2026: reservas CONFIRMADAS de Casa Tomás
// =============================================================================
// Escribe junto a este script:
//   20261001_demo_reservas_octubre.sql            (crea las reservas)
//   20261001_demo_reservas_octubre_LIMPIEZA.sql   (las borra)
// y valida FUERA de la BD lo que genera (si algo falla, sale con código 1 y no
// escribe nada).
//
// Solo Casa Tomás: Touza no admite reservas (decisión del dueño, 2026-10-01).
//
// La demo ENTREGADA se genera así (desde adminpanelct/supabase/seeds/):
//   node gen_demo_reservas_octubre.js --sin-telefono
// Variantes:
//   - Sin --sin-telefono: teléfonos ficticios únicos +3460000[1-9]xxx. OJO: el cron
//     emails-reserva-detectar-ausencias crea 1 sugerencia de lista negra por cada
//     reserva que pasa sin marcar «Llegó» si tiene teléfono o email (no filtra
//     [DEMO-SEED]). Sin teléfono ni email no crea ninguna.
//   - --perfil completo --max-rows 2000: el perfil literal del encargo. SOLO cuando
//     esté desplegada la paginación del calendario (o subido "Max rows" de la API,
//     hoy 1000): si no, el calendario mensual perdería en silencio los últimos días.
//
// Determinista: misma semilla + mismas opciones -> mismas filas (los id los pone la
// BD). No lee la BD: la ocupación existente es la foto EXISTENTES (SELECT del
// 2026-10-01 ~18:20 Madrid); el SQL la vuelve a comprobar en vivo y aborta si ya no cabe.
// =============================================================================
const fs = require('fs');
const path = require('path');

// ---------- Opciones ----------
const ARGS = process.argv.slice(2);
function opcion(nombre, porDefecto) {
  const i = ARGS.indexOf(nombre);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : porDefecto;
}
const PERFIL = opcion('--perfil', 'seguro'); // 'seguro' | 'completo'
if (!['seguro', 'completo'].includes(PERFIL)) throw new Error('--perfil debe ser seguro o completo');
const SIN_TELEFONO = ARGS.includes('--sin-telefono');
// "Max rows" de PostgREST (docs/funcionalidades/07: 1000). El calendario desplegado
// (CalendarioOcupacion.tsx) pide el mes entero en una consulta sin paginar.
const MAX_ROWS = parseInt(opcion('--max-rows', '1000'), 10);
const COMANDO = 'node gen_demo_reservas_octubre.js' + (ARGS.length ? ' ' + ARGS.join(' ') : '');

// ---------- Constantes (foto de producción 2026-10-01) ----------
const MARCA = '[DEMO-SEED][oct-2026]';
const SEMILLA = 20261001;
const FECHA_INI = '2026-10-02';
const FECHA_FIN = '2026-10-31';
const HOY = '2026-10-01';
const AFORO_CT = 170;             // SUM(capacidad_maxima) de salas activas casa_tomas (lo que suma el trigger)
const TOPE_GEN = 0.95;            // al generar: existentes + demo <= 95 % (margen >= 5 %)
const TOPE_APLICAR = 0.97;        // al aplicar (comprobación en vivo): <= 97 % (margen >= 3 %)
const HOLGURA_FILAS_GEN = 60;     // filas libres que se dejan en octubre bajo MAX_ROWS al generar
const HOLGURA_FILAS_APLICAR = 30; // y en la comprobación en vivo
const TEL_PREFIJO = '+3460000';   // + 1000..9999 -> 600 001 000 .. 600 009 999 (la demo vieja usa 600000xxx)
const TEL_REGEX_SQL = '^\\+3460000[1-9][0-9]{3}$';

// Comensales VIVOS (pendiente/verificada/confirmada) de Casa Tomás ya existentes por
// fecha|turno (comida si hora < 17:00, como validar_capacidad_reserva). Incluye las
// [DEMO-SEED] antiguas (02-09/10) y 5 reales. Foto del 2026-10-01.
const EXISTENTES = {
  '2026-10-02|comida': 14, '2026-10-02|cena': 27, '2026-10-03|comida': 8, '2026-10-03|cena': 32,
  '2026-10-04|comida': 28, '2026-10-04|cena': 12, '2026-10-05|comida': 3, '2026-10-05|cena': 2,
  '2026-10-06|comida': 11, '2026-10-06|cena': 6, '2026-10-07|comida': 4, '2026-10-07|cena': 10,
  '2026-10-08|comida': 13, '2026-10-08|cena': 3, '2026-10-09|comida': 14, '2026-10-09|cena': 16,
  '2026-10-14|comida': 4, '2026-10-15|comida': 2, '2026-10-16|comida': 6, '2026-10-21|comida': 3,
  '2026-10-29|comida': 2,
};
// Filas de octubre (01-31, cualquier negocio) no canceladas ya existentes: las que cuenta el calendario.
const EXISTENTES_OCT_NO_CANCELADAS = 54;

// ---------- PRNG (mulberry32, igual que gen_seed.js) ----------
let S = SEMILLA;
function rnd() {
  S |= 0; S = (S + 0x6D2B79F5) | 0;
  let t = Math.imul(S ^ (S >>> 15), 1 | S);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const choice = (a) => a[Math.floor(rnd() * a.length)];
function weighted(pares) {
  const total = pares.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pares) { if (r < w) return v; r -= w; }
  return pares[pares.length - 1][0];
}

// ---------- Fechas ----------
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); } // 0 = domingo
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const FECHAS = [];
for (let f = FECHA_INI; f <= FECHA_FIN; f = addDays(f, 1)) FECHAS.push(f);

// ---------- Perfiles de carga: [% comida, % cena] del aforo, CONTANDO lo existente ----------
// "completo": literal del encargo (V/S 85-95 %, domingos de comida fuertes, entre semana
//   25-60 %, 12/10 festivo alto). No cabe bajo max_rows = 1000.
// "seguro" (el entregado): lo mismo en los primeros 12 días (el viernes, el fin de semana
//   de la ventana de 48 h, el puente del Pilar) y después una curva de llenado (cuanto más
//   lejos, menos reservado), manteniendo la forma de cada semana.
const PERFIL_COMPLETO = { 5: [91, 93], 6: [90, 94], 0: [86, 34], 1: [30, 26], 2: [34, 30], 3: [42, 40], 4: [52, 56] };
const AJUSTES_COMPLETO = { '2026-10-02': [93, 95], '2026-10-11': [86, 60], '2026-10-12': [90, 70], '2026-10-25': [84, 30] };
const PERFIL_SEGURO = {
  '2026-10-02': [93, 95], '2026-10-03': [90, 94], '2026-10-04': [86, 24], '2026-10-05': [26, 25],
  '2026-10-06': [27, 25], '2026-10-07': [30, 28], '2026-10-08': [34, 36],
  '2026-10-09': [88, 92], '2026-10-10': [87, 93], '2026-10-11': [85, 45], '2026-10-12': [90, 55],
  '2026-10-13': [16, 14], '2026-10-14': [18, 15], '2026-10-15': [22, 24],
  '2026-10-16': [68, 78], '2026-10-17': [70, 80], '2026-10-18': [66, 14], '2026-10-19': [10, 8],
  '2026-10-20': [10, 8], '2026-10-21': [12, 10], '2026-10-22': [13, 14],
  '2026-10-23': [50, 60], '2026-10-24': [52, 64], '2026-10-25': [52, 10], '2026-10-26': [7, 6],
  '2026-10-27': [7, 6], '2026-10-28': [8, 7], '2026-10-29': [10, 11],
  '2026-10-30': [42, 52], '2026-10-31': [44, 56],
};
function carga(fecha) {
  if (PERFIL === 'seguro') return PERFIL_SEGURO[fecha];
  return AJUSTES_COMPLETO[fecha] || PERFIL_COMPLETO[dow(fecha)];
}

// ---------- Tamaños de grupo ----------
// 'G' = grupo grande 14-20 (solo canal manual: max_comensales_por_reserva = 12 en web/bot).
const MIX_PICO = [[2, 20], [3, 9], [4, 26], [5, 9], [6, 13], [7, 3], [8, 7], [9, 2], [10, 4], [11, 1], [12, 3], ['G', 2]];
const MIX_NORMAL = [[2, 36], [3, 13], [4, 26], [5, 7], [6, 9], [7, 2], [8, 4], [10, 2], [12, 1]];
const GRANDES = [[14, 3], [15, 2], [16, 3], [18, 2], [20, 1]];

// Un grupo grande seguro en servicios clave (el viernes, el sábado, el festivo) para
// probar a repartirlo entre varias mesas; el resto de grandes salen al azar (máx. 1/turno).
const GRUPO_GRANDE_FIJO = { '2026-10-02|cena': 16, '2026-10-03|comida': 14, '2026-10-10|cena': 18, '2026-10-12|comida': 15 };

function rellenarTurno(objetivo, tope, mix, maxGrandes, grandeFijo) {
  const grupos = grandeFijo ? [grandeFijo] : [];
  let suma = grandeFijo || 0, grandes = grandeFijo ? 1 : 0, intentos = 0;
  while (suma < objetivo && intentos++ < 2000) {
    let g = weighted(mix);
    if (g === 'G') { if (grandes >= maxGrandes) continue; g = weighted(GRANDES); }
    const resto = objetivo - suma;
    if (g > resto) { if (resto >= 2 && resto <= 12) g = resto; else if (resto < 2) break; else continue; }
    if (suma + g > tope) break;
    grupos.push(g); suma += g; if (g >= 14) grandes++;
  }
  return grupos;
}

// ---------- Horas (cuartos de hora dentro de los turnos reales 13:00-16:00 / 20:00-23:00) ----------
const SLOTS = {
  comida: [['13:00', 3], ['13:15', 2], ['13:30', 5], ['13:45', 4], ['14:00', 9], ['14:15', 7], ['14:30', 9], ['14:45', 6], ['15:00', 5], ['15:15', 3], ['15:30', 2], ['15:45', 1]],
  cena: [['20:00', 2], ['20:15', 2], ['20:30', 5], ['20:45', 5], ['21:00', 9], ['21:15', 8], ['21:30', 9], ['21:45', 6], ['22:00', 5], ['22:15', 3], ['22:30', 2], ['22:45', 1]],
};
const SLOTS_GRUPO = { comida: [['13:30', 3], ['14:00', 4], ['14:30', 3]], cena: [['20:30', 3], ['21:00', 4], ['21:30', 3]] };
// La web solo ofrece lo que abre la escalera (configuracion_turnos: 60 min de base,
// 30 min desde el 70 %, 15 min desde el 85 %): en turnos flojos, las de la web caen en punto.
function slotsWeb(turno, pct) {
  const base = SLOTS[turno];
  if (pct >= 85) return base;
  if (pct >= 70) return base.filter(([h]) => h.endsWith(':00') || h.endsWith(':30'));
  return base.filter(([h]) => h.endsWith(':00'));
}

// ---------- Personas, notas, canal ----------
const NOMBRES = ['Lucía', 'María', 'Carmen', 'Ana', 'Laura', 'Marta', 'Elena', 'Paula', 'Sara', 'Cristina', 'Isabel', 'Raquel',
  'Beatriz', 'Patricia', 'Nuria', 'Silvia', 'Pilar', 'Rocío', 'Irene', 'Alba', 'Teresa', 'Inés', 'Clara', 'Noelia', 'Lorena',
  'Begoña', 'Montse', 'Ainhoa', 'Natalia', 'Julia', 'Antonio', 'José', 'Manuel', 'Francisco', 'David', 'Javier', 'Daniel',
  'Carlos', 'Jesús', 'Alejandro', 'Miguel', 'Rafael', 'Pablo', 'Sergio', 'Fernando', 'Jorge', 'Alberto', 'Álvaro', 'Diego',
  'Adrián', 'Iván', 'Rubén', 'Óscar', 'Andrés', 'Ignacio', 'Gonzalo', 'Víctor', 'Raúl', 'Hugo', 'Mario'];
const APELLIDOS = ['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín',
  'Jiménez', 'Hernández', 'Ruiz', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Gutiérrez', 'Alonso', 'Navarro', 'Torres',
  'Domínguez', 'Ramos', 'Vázquez', 'Gil', 'Serrano', 'Ramírez', 'Blanco', 'Molina', 'Morales', 'Suárez', 'Ortega', 'Delgado',
  'Castro', 'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Iglesias', 'Núñez', 'Medina', 'Garrido', 'Cortés', 'Castillo', 'Santos',
  'Lozano', 'Guerrero', 'Cano', 'Prieto', 'Méndez', 'Cruz', 'Calvo', 'Gallego', 'Vidal', 'León', 'Herrera', 'Márquez', 'Peña', 'Cabrera'];
function nombreCompleto() {
  return choice(NOMBRES) + ' ' + choice(APELLIDOS) + (rnd() < 0.35 ? ' ' + choice(APELLIDOS) : '');
}
// {S} = «Comida» o «Cena» según el turno; NOTAS_GRUPO_COMIDA solo se usa a mediodía.
const NOTAS = ['Alergia a frutos secos', 'Celíaco: todo sin gluten, por favor', 'Intolerancia a la lactosa', 'Alergia al marisco',
  'Una persona vegana', 'Dos vegetarianos', 'Sin cebolla ni ajo (alergia)', 'Embarazada: nada crudo ni poco hecho',
  'Necesitan trona', 'Vienen con carrito de bebé', 'Dos tronas, por favor', 'Mesa tranquila si es posible',
  'Mesa junto a la ventana si puede ser', 'Prefieren terraza si hace bueno', 'Prefieren interior',
  'Persona en silla de ruedas: mesa accesible', 'Cumpleaños: traen tarta, ¿la guardáis en cámara?',
  'Cumpleaños, una vela en el postre', 'Aniversario de boda', 'Llegarán unos 15 minutos tarde', 'Clientes habituales',
  'Primera visita, vienen recomendados', '{S} de trabajo, necesitan factura', 'Vienen con perro pequeño (terraza)',
  'Piden mesa redonda', 'Celebran una jubilación'];
const NOTAS_GRUPO = ['{S} de empresa, factura a nombre de la empresa', '{S} familiar, vienen los abuelos',
  'Cumpleaños de 40: traen decoración', 'Despedida de soltera', 'Despedida de soltero', 'Reunión de antiguos alumnos',
  '{S} de peña, quieren menú cerrado', 'Celebración de jubilación, menú cerrado'];
const NOTAS_GRUPO_COMIDA = ['Bautizo: varios niños, necesitan 2 tronas', 'Grupo de senderismo, llegan todos a la vez'];
const NOTAS_DIA = {
  '2026-10-12': { comida: ['Comida familiar por el día del Pilar', 'Festivo: vienen con los abuelos'], cena: ['Festivo: cena familiar'] },
  '2026-10-25': { comida: ['Cambio de hora: confirman que vienen a la hora nueva'], cena: ['Cambio de hora: confirman que vienen a la hora nueva'] },
  '2026-10-31': { comida: [], cena: ['Cena de Halloween, vienen disfrazados'] },
};
function notaPara(fecha, pax, turno) {
  const S = turno === 'comida' ? 'Comida' : 'Cena';
  const delDia = NOTAS_DIA[fecha] ? NOTAS_DIA[fecha][turno] : [];
  let nota = '';
  if (delDia.length && rnd() < 0.18) nota = choice(delDia);
  else if (pax >= 9) nota = choice(turno === 'comida' ? NOTAS_GRUPO.concat(NOTAS_GRUPO_COMIDA) : NOTAS_GRUPO);
  else nota = rnd() < 0.35 ? choice(NOTAS) : '';
  return nota.replace('{S}', S);
}
function canalPara(pax) {
  if (pax > 12) return 'manual';
  if (pax >= 9) return weighted([['telefono', 50], ['manual', 35], ['web', 15]]);
  return weighted([['web', 50], ['telefono', 30], ['manual', 20]]);
}

// ---------- Generación ----------
const reservas = [];
const resumenTurnos = []; // {fecha, turno, existentes, demo_pax, demo_n}
for (const fecha of FECHAS) {
  const d = dow(fecha);
  const [pctC, pctN] = carga(fecha);
  for (const [turno, pct] of [['comida', pctC], ['cena', pctN]]) {
    const existentes = EXISTENTES[`${fecha}|${turno}`] || 0;
    const tope = Math.floor(AFORO_CT * TOPE_GEN) - existentes;
    const objetivo = Math.min(Math.round(AFORO_CT * pct / 100) - existentes, tope);
    // Grupos más grandes en los servicios de fin de semana/festivo (familias, celebraciones).
    const servicioFuerte = d === 5 || d === 6 || (turno === 'comida' && (d === 0 || fecha === '2026-10-12'))
      || (turno === 'cena' && fecha === '2026-10-11');
    const mix = servicioFuerte ? MIX_PICO : MIX_NORMAL;
    const grandeFijo = PERFIL === 'seguro' || PERFIL === 'completo' ? GRUPO_GRANDE_FIJO[`${fecha}|${turno}`] : undefined;
    const grupos = objetivo > 0 ? rellenarTurno(objetivo, tope, mix, servicioFuerte && pct >= 80 ? 1 : 0, grandeFijo) : [];
    for (const pax of grupos) {
      const canal = canalPara(pax);
      const hora = pax >= 9 ? weighted(SLOTS_GRUPO[turno]) : weighted(canal === 'web' ? slotsWeb(turno, pct) : SLOTS[turno]);
      reservas.push({ fecha, hora, pax, canal, turno });
    }
    resumenTurnos.push({ fecha, turno, existentes, demo_pax: grupos.reduce((s, g) => s + g, 0), demo_n: grupos.length });
  }
}

// Orden estable dentro de cada día y datos personales después.
reservas.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora) || a.pax - b.pax);
const TELEFONOS = [];
for (let n = 1000; n <= 9999; n++) TELEFONOS.push(TEL_PREFIJO + String(n));
for (let i = TELEFONOS.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [TELEFONOS[i], TELEFONOS[j]] = [TELEFONOS[j], TELEFONOS[i]]; }
reservas.forEach((r, i) => {
  r.nombre = nombreCompleto();
  r.telefono = SIN_TELEFONO ? null : TELEFONOS[i];
  const nota = notaPara(r.fecha, r.pax, r.turno);
  r.notas = nota ? `${MARCA} ${nota}` : MARCA;
  r.sorteo = rnd();
});
// «importante»: exactamente el 3 % (redondeado), primero los grupos grandes y luego al azar.
const N_IMPORTANTES = Math.round(reservas.length * 0.03);
reservas.map((r, i) => i)
  .sort((a, b) => (reservas[b].pax >= 14) - (reservas[a].pax >= 14) || reservas[a].sorteo - reservas[b].sorteo)
  .forEach((i, pos) => { reservas[i].importante = pos < N_IMPORTANTES; });

// ---------- Validación fuera de BD ----------
const errores = [];
const exige = (cond, msg) => { if (!cond) errores.push(msg); };
const sumas = new Map();
for (const r of reservas) {
  const k = `${r.fecha}|${r.hora < '17:00' ? 'comida' : 'cena'}`;
  sumas.set(k, (sumas.get(k) || 0) + r.pax);
  exige(r.fecha >= FECHA_INI && r.fecha <= FECHA_FIN && r.fecha !== HOY, `fecha fuera de rango: ${r.fecha}`);
  const h = r.hora;
  const enTurno = (h >= '13:00' && h <= '15:45') || (h >= '20:00' && h <= '22:45');
  exige(enTurno && /^\d\d:(00|15|30|45)$/.test(h), `hora fuera de turno o de cuarto: ${r.fecha} ${h}`);
  exige(r.notas.startsWith(MARCA), `fila sin marca: ${r.fecha} ${h}`);
  exige(Number.isInteger(r.pax) && r.pax > 0 && r.pax <= 20, `comensales inválidos: ${r.pax}`);
  exige(['web', 'telefono', 'manual'].includes(r.canal), `canal inválido: ${r.canal}`);
  exige(r.pax <= 12 || r.canal === 'manual', `grupo > 12 por web/teléfono: ${r.fecha} ${h}`);
}
for (const [k, pax] of sumas) {
  const total = pax + (EXISTENTES[k] || 0);
  exige(total <= Math.floor(AFORO_CT * TOPE_GEN), `aforo (margen 5 %) superado en ${k}: ${total}/${AFORO_CT}`);
}
if (SIN_TELEFONO) exige(reservas.every((r) => r.telefono === null), 'hay teléfonos con --sin-telefono');
else {
  exige(new Set(reservas.map((r) => r.telefono)).size === reservas.length, 'teléfonos duplicados o vacíos');
  exige(reservas.every((r) => /^\+3460000[1-9]\d{3}$/.test(r.telefono)), 'teléfono fuera del patrón ficticio');
}
const filasOct = EXISTENTES_OCT_NO_CANCELADAS + reservas.length;
exige(filasOct <= MAX_ROWS - HOLGURA_FILAS_GEN,
  `octubre tendría ${filasOct} filas no canceladas (> ${MAX_ROWS} - ${HOLGURA_FILAS_GEN}): el calendario truncaría. Usa --perfil seguro, o pasa --max-rows si ya está desplegada la paginación`);

// ---------- Resumen por consola (también si la validación falla) ----------
const pax = (a) => a.reduce((s, r) => s + r.pax, 0);
const porCanal = {}; for (const r of reservas) porCanal[r.canal] = (porCanal[r.canal] || 0) + 1;
const porTam = { '2-6': 0, '7-12': 0, '14-20': 0 };
for (const r of reservas) porTam[r.pax <= 6 ? '2-6' : r.pax <= 12 ? '7-12' : '14-20']++;
console.log(`perfil=${PERFIL} sin_telefono=${SIN_TELEFONO} semilla=${SEMILLA}`);
console.log(`reservas=${reservas.length} comensales=${pax(reservas)} (solo Casa Tomás)`);
console.log(`filas octubre no canceladas tras aplicar=${filasOct} (max_rows ${MAX_ROWS})`);
console.log(`canal=${JSON.stringify(porCanal)} tamaños=${JSON.stringify(porTam)} importantes=${reservas.filter((r) => r.importante).length}` +
  ` con_nota=${reservas.filter((r) => r.notas !== MARCA).length}`);
console.log('fecha      dia | comida n/pax/%     | cena n/pax/%');
for (const fecha of FECHAS) {
  const t = (tu) => resumenTurnos.find((x) => x.fecha === fecha && x.turno === tu);
  const fmt = (x) => `${x.demo_n}/${x.existentes + x.demo_pax}/${Math.round(100 * (x.existentes + x.demo_pax) / AFORO_CT)}%`;
  console.log(`${fecha} ${DIA[dow(fecha)].slice(0, 3)} | ${fmt(t('comida')).padEnd(18)} | ${fmt(t('cena'))}`);
}
if (errores.length) { console.error('VALIDACIÓN FALLIDA (no se escribe nada):\n - ' + errores.slice(0, 30).join('\n - ')); process.exit(1); }

// ---------- SQL de creación ----------
const esc = (s) => (s === null || s === undefined ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'");
const totalesTurno = [...sumas.entries()].sort(([a], [b]) => a.localeCompare(b));

const cabecera = `-- =============================================================================
-- DEMO OCTUBRE 2026 - reservas CONFIRMADAS de demostración, SOLO CASA TOMÁS
-- =============================================================================
-- GENERADO con: ${COMANDO}
-- (supabase/seeds/gen_demo_reservas_octubre.js, semilla ${SEMILLA}, perfil "${PERFIL}").
-- No editar a mano: regenerar.
--
-- QUÉ CREA (solo filas en public.reservas):
--   ${reservas.length} reservas de Casa Tomás, ${pax(reservas)} comensales, del ${FECHA_INI} (viernes) al ${FECHA_FIN}.
--   HOY (${HOY}) queda fuera a propósito. Touza: ninguna (no admite reservas).
--   Todas con estado 'confirmada', marca 'casa_tomas' y espacio_id NULL (sin sala; la sala y
--   las mesas las asigna el personal), email NULL, ${SIN_TELEFONO ? 'telefono NULL' : 'teléfonos ficticios únicos ' + TEL_PREFIJO + '1000..9999'},
--   en_blacklist y consentimiento_newsletter false, y sin asignaciones_mesa.
--   Marca: notas_cliente empieza por '${MARCA}'. Lleva [DEMO-SEED], el marcador que
--   ya excluyen la campana «reserva sin asignar» y el recordatorio T-2.
--
-- EFECTOS AUTOMÁTICOS DE LA BD:
--   · trg_validar_capacidad valida el aforo fila a fila; si algo no cupiera, aborta TODO.
--   · trigger_actualizar_ocupacion recalcula public.ocupacion_diaria (dato derivado).
--   · El cron emails-reserva-detectar-ausencias (04:00 UTC) pasará cada noche a 'no_show'
--     las del día anterior que nadie marque «Llegó». ${SIN_TELEFONO
    ? 'No crea sugerencias de lista negra: sin\n--     teléfono ni email se las salta.'
    : 'Creará además 1 sugerencia de lista\n--     negra por cada una (no filtra [DEMO-SEED]; la LIMPIEZA las borra en cascada).'}
--
-- APLICAR (desde adminpanelct/, hoy o como muy tarde el viernes por la mañana):
--   npx supabase db query --linked -f supabase/seeds/20261001_demo_reservas_octubre.sql
--   Es todo o nada. Antes de insertar comprueba en vivo que la marca no está aplicada, que el
--   aforo deja un margen >= 3 %, que octubre queda bajo max_rows (${MAX_ROWS})${SIN_TELEFONO ? '' : ', que los teléfonos están libres'}
--   y la fecha. Si algo falla, no escribe nada. Un 55P03 (lock_timeout) tampoco escribe
--   nada: reintentar. La salida es la tabla de verificación.
--
-- LIMPIAR:
--   npx supabase db query --linked -f supabase/seeds/20261001_demo_reservas_octubre_LIMPIEZA.sql
--   OJO: el cleanup_demo_data.sql antiguo (LIKE '[DEMO-SEED]%') TAMBIÉN borraría estas reservas.
--
-- PERFIL COMPLETO DEL ENCARGO: cuando esté desplegada la paginación del calendario
-- (o subido "Max rows" de la API), regenerar con:
--   node gen_demo_reservas_octubre.js${SIN_TELEFONO ? ' --sin-telefono' : ''} --perfil completo --max-rows 2000
-- =============================================================================
`;

const totalesValues = totalesTurno.map(([k, p]) => {
  const [f, t] = k.split('|');
  return `      ('${f}'::date, '${t}', ${p})`;
}).join(',\n');

const precheck = `
-- 0) Comprobaciones en vivo: si alguna falla, RAISE y no se escribe nada.
do $precheck$
declare
  v_aforo      integer;
  v_conflictos text;
  v_filas_oct  integer;
begin
  if (now() at time zone 'Europe/Madrid')::date > date '2026-10-02' then
    raise exception 'Demo caducada: el viernes 2026-10-02 ya ha pasado. Regenerar con otras fechas.';
  end if;
  if exists (select 1 from public.reservas where notas_cliente like '${MARCA}%') then
    raise exception 'La demo de octubre YA está aplicada (hay filas con la marca ${MARCA}). Limpia antes con la LIMPIEZA.';
  end if;
${SIN_TELEFONO ? '' : `  if exists (select 1 from public.reservas where telefono ~ '${TEL_REGEX_SQL}') then
    raise exception 'Hay reservas con teléfonos del rango ficticio ${TEL_PREFIJO}[1-9]xxx: revisar antes de aplicar.';
  end if;
`}
  -- Aforo de Casa Tomás: el mismo cálculo que validar_capacidad_reserva (salas activas del negocio).
  select coalesce(sum(capacidad_maxima), 0) into v_aforo
    from public.espacios_reserva
   where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';

  -- Vivas ahora (pendiente/verificada/confirmada) + demo <= 97 % del aforo en cada turno.
  select string_agg(format('%s %s: %s+%s > %s', d.fecha, d.turno, e.pax, d.pax, floor(v_aforo * ${TOPE_APLICAR})), '; ')
    into v_conflictos
    from (values
${totalesValues}
    ) as d(fecha, turno, pax)
    cross join lateral (
      select coalesce(sum(r.numero_comensales), 0) as pax
        from public.reservas r
       where r.fecha = d.fecha
         and coalesce(r.marca, 'casa_tomas') = 'casa_tomas'
         and r.estado in ('pendiente', 'verificada', 'confirmada')
         and ((d.turno = 'comida') = (r.hora < time '17:00'))
    ) e
   where e.pax + d.pax > floor(v_aforo * ${TOPE_APLICAR});
  if v_conflictos is not null then
    raise exception 'Aforo de Casa Tomás: no cabe con margen del 3 %%: %. Regenerar con la ocupación actual.', v_conflictos;
  end if;

  -- Tope de filas de la API (max_rows = ${MAX_ROWS}): el calendario pide el mes entero de una vez.
  select count(*) into v_filas_oct
    from public.reservas
   where fecha between date '2026-10-01' and date '2026-10-31' and estado <> 'cancelada';
  if v_filas_oct + ${reservas.length} > ${MAX_ROWS - HOLGURA_FILAS_APLICAR} then
    raise exception 'Octubre tendría % filas no canceladas (> %): el calendario truncaría el mes.',
      v_filas_oct + ${reservas.length}, ${MAX_ROWS - HOLGURA_FILAS_APLICAR};
  end if;
end
$precheck$;
`;

const columnas = 'fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente';
let inserts = '\n-- 1) Inserciones, un lote por día.\n';
for (const fecha of FECHAS) {
  const delDia = reservas.filter((r) => r.fecha === fecha);
  if (!delDia.length) continue;
  inserts += `\n-- ${fecha} (${DIA[dow(fecha)]}): ${delDia.length} reservas, ${pax(delDia)} comensales\n`;
  inserts += `insert into public.reservas (${columnas}) values\n`;
  inserts += delDia.map((r) => `  (${esc(r.fecha)}, ${esc(r.hora)}, ${r.pax}, 'confirmada', ${esc(r.nombre)}, ${esc(r.telefono)}, NULL, ${esc(r.canal)}, 'casa_tomas', NULL, ${r.importante}, false, false, ${esc(r.notas)})`).join(',\n') + ';\n';
}

const verificacion = `
-- 2) Verificación (solo lectura; es lo que imprime la CLI). Por día y turno de Casa Tomás:
--    reservas demo, comensales VIVOS en total (demo + existentes) y % del aforo actual.
--    Columnas de control: demo_fuera_de_norma (marca <> casa_tomas, con sala, con email,
--    ${SIN_TELEFONO ? 'con teléfono, ' : ''}estado <> confirmada o fuera de 02-31/10; debe ser 0). Última fila: TOTAL.
with aforo as (
  select coalesce(sum(capacidad_maxima), 0) as ct from public.espacios_reserva
   where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas'
), demo as (
  select * from public.reservas where notas_cliente like '${MARCA}%'
), r as (
  select fecha, hora < time '17:00' as comida, numero_comensales as pax,
         estado in ('pendiente', 'verificada', 'confirmada') as viva,
         notas_cliente like '${MARCA}%' as es_demo
    from public.reservas
   where fecha between date '${FECHA_INI}' and date '${FECHA_FIN}'
     and coalesce(marca, 'casa_tomas') = 'casa_tomas'
), dia as (
  select g.fecha::date as fecha,
    count(r.*) filter (where es_demo and comida)       as comida_demo,
    sum(pax) filter (where viva and comida)            as comida_pax,
    count(r.*) filter (where es_demo and not comida)   as cena_demo,
    sum(pax) filter (where viva and not comida)        as cena_pax,
    sum(pax) filter (where es_demo)                    as demo_comensales
  from generate_series(date '${FECHA_INI}', date '${FECHA_FIN}', interval '1 day') as g(fecha)
  left join r on r.fecha = g.fecha::date
  group by g.fecha
)
select * from (
  select d.fecha::text as fecha,
    (array['dom','lun','mar','mié','jue','vie','sáb'])[extract(dow from d.fecha)::int + 1] as dia,
    d.comida_demo, coalesce(d.comida_pax, 0) as comida_pax, round(100.0 * coalesce(d.comida_pax, 0) / a.ct) as comida_pct,
    d.cena_demo,   coalesce(d.cena_pax, 0)   as cena_pax,   round(100.0 * coalesce(d.cena_pax, 0) / a.ct)   as cena_pct,
    coalesce(d.demo_comensales, 0) as demo_comensales, null::bigint as demo_fuera_de_norma
  from dia d cross join aforo a
  union all
  select 'TOTAL', '', sum(comida_demo), sum(coalesce(comida_pax, 0)), null, sum(cena_demo), sum(coalesce(cena_pax, 0)), null,
         sum(coalesce(demo_comensales, 0)),
         (select count(*) from demo
           where marca <> 'casa_tomas' or espacio_id is not null or email is not null${SIN_TELEFONO ? ' or telefono is not null' : ''}
              or estado <> 'confirmada' or fecha not between date '${FECHA_INI}' and date '${FECHA_FIN}')
  from dia
) v
order by v.fecha;
`;

const sqlSeed = cabecera + `
set client_encoding = 'UTF8';
begin;
set local lock_timeout = '5s';
` + precheck + inserts + `
commit;
` + verificacion;

// ---------- SQL de limpieza ----------
const sqlLimpieza = `-- =============================================================================
-- LIMPIEZA de la DEMO OCTUBRE 2026 (pareja de 20261001_demo_reservas_octubre.sql)
-- =============================================================================
-- Borra SOLO las reservas cuyas notas_cliente empiezan por '${MARCA}' y, antes,
-- las asignaciones_mesa que el personal les haya puesto. Nada más se borra a mano.
--
-- Efectos automáticos de la BD al borrar esas reservas (por diseño de las FK):
--   · ON DELETE CASCADE: desaparecen con ellas sus filas en sugerencias_blacklist,
--     avisos_reserva_enviados y envios_email_reserva.
--   · ON DELETE SET NULL: solicitudes_pendientes.reserva_id queda a NULL si alguna apuntaba.
--   · trigger_actualizar_ocupacion recalcula ocupacion_diaria (y borra las horas vacías).
-- NO se borra (no tiene FK; la salida lo cuenta y el PASO 0 comentado trae el borrado
-- exacto, que solo funciona ANTES de borrar las reservas):
--   · notificaciones_dashboard que apunten a estas reservas (referencia_id).
--   · asignaciones_mesa_descartadas de estas reservas.
--   · blacklist creada al APROBAR una sugerencia de una reserva demo.
--   · reservas demo a las que alguien quitó la marca de la nota: se reconocen porque
--     tienen el mismo created_at que las demo (toda la demo entra en una transacción).
-- OJO: el cleanup_demo_data.sql antiguo (LIKE '[DEMO-SEED]%') TAMBIÉN borraría estas reservas.
--
-- Ejecutar (desde adminpanelct/):
--   npx supabase db query --linked -f supabase/seeds/20261001_demo_reservas_octubre_LIMPIEZA.sql
-- Es todo o nada (begin/commit propios, lock_timeout de 5 s: un 55P03 no borra nada, reintentar).
-- La salida es una fila con el inventario ANTES y DESPUÉS.
-- =============================================================================
set client_encoding = 'UTF8';
begin;
set local lock_timeout = '5s';

create temp table _demo_oct_ids as
  select id, created_at from public.reservas where notas_cliente like '${MARCA}%';

create temp table _demo_oct_antes as
select
  (select count(*) from _demo_oct_ids)                                                    as reservas_demo,
  (select count(*) from public.reservas)                                                  as reservas_total,
  (select count(*) from public.asignaciones_mesa where reserva_id in (select id from _demo_oct_ids))       as asignaciones_mesa,
  (select count(*) from public.sugerencias_blacklist where reserva_id in (select id from _demo_oct_ids))   as sugerencias_cascade,
  (select count(*) from public.sugerencias_blacklist where reserva_id in (select id from _demo_oct_ids)
      and blacklist_id is not null)                                                        as sugerencias_aprobadas,
  (select count(*) from public.avisos_reserva_enviados where reserva_id in (select id from _demo_oct_ids)) as avisos_cascade,
  (select count(*) from public.envios_email_reserva where reserva_id in (select id from _demo_oct_ids))    as envios_cascade,
  (select count(*) from public.solicitudes_pendientes where reserva_id in (select id from _demo_oct_ids))  as solicitudes_set_null,
  (select count(*) from public.notificaciones_dashboard where referencia_tipo = 'reserva'
      and referencia_id in (select id from _demo_oct_ids))                                 as notificaciones_no_se_borran,
  (select count(*) from public.asignaciones_mesa_descartadas where reserva_id in (select id from _demo_oct_ids)) as descartadas_no_se_borran,
  (select count(*) from public.reservas
    where created_at in (select distinct created_at from _demo_oct_ids)
      and coalesce(notas_cliente, '') not like '${MARCA}%')                                as demo_sin_marca_no_se_borran;

-- PASO 0 (OPCIONAL; NO se ejecuta). Si alguna columna *_no_se_borran o
-- sugerencias_aprobadas salió > 0 en una ejecución anterior, descomentar aquí lo que
-- haga falta (antes de borrar las reservas). Criterio exacto:
-- delete from public.notificaciones_dashboard
--  where referencia_tipo = 'reserva' and referencia_id in (select id from _demo_oct_ids);
-- delete from public.asignaciones_mesa_descartadas
--  where reserva_id in (select id from _demo_oct_ids);
-- delete from public.blacklist where id in (
--   select blacklist_id from public.sugerencias_blacklist
--    where reserva_id in (select id from _demo_oct_ids) and blacklist_id is not null);
-- delete from public.reservas  -- revisar antes la lista: misma transacción que la demo, sin marca
--  where created_at in (select distinct created_at from _demo_oct_ids)
--    and coalesce(notas_cliente, '') not like '${MARCA}%';

-- 1) Mesas que el personal haya asignado a reservas demo (antes que las reservas).
delete from public.asignaciones_mesa where reserva_id in (select id from _demo_oct_ids);
-- 2) Las reservas demo, y solo ellas.
delete from public.reservas where id in (select id from _demo_oct_ids);

commit;

-- Inventario antes / después (solo lectura).
select a.reservas_demo                     as antes_reservas_demo,
       (select count(*) from public.reservas where notas_cliente like '${MARCA}%') as despues_reservas_demo,
       a.reservas_total                    as antes_reservas_total,
       (select count(*) from public.reservas) as despues_reservas_total,
       a.asignaciones_mesa                 as antes_asignaciones_mesa,
       (select count(*) from public.asignaciones_mesa where reserva_id in (select id from _demo_oct_ids)) as despues_asignaciones_mesa,
       a.sugerencias_cascade, a.sugerencias_aprobadas, a.avisos_cascade, a.envios_cascade, a.solicitudes_set_null,
       a.notificaciones_no_se_borran, a.descartadas_no_se_borran, a.demo_sin_marca_no_se_borran
  from _demo_oct_antes a;
`;

const DIR = __dirname;
fs.writeFileSync(path.join(DIR, '20261001_demo_reservas_octubre.sql'), sqlSeed, 'utf8');
fs.writeFileSync(path.join(DIR, '20261001_demo_reservas_octubre_LIMPIEZA.sql'), sqlLimpieza, 'utf8');
console.log('VALIDACIÓN OK: aforo con margen, horas en turno, marca en todas, solo Casa Tomás sin sala, fechas 02-31/10, filas < max_rows. Ficheros escritos.');
