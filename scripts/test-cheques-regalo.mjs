// Ciclo de vida completo de un cheque regalo contra un Postgres en memoria
// (PGlite), con las funciones y el trigger REALES de las migraciones del repo.
// Nunca toca Supabase: ni producción ni ningún otro entorno.
//
//   npm run test:cheques:db
//
// Cubre: pago (las mismas sentencias que lanza el webhook de Stripe de
// casa-tomas-story), idempotencia ante eventos repetidos, listado y
// contadores, verificación, canje único (desde el 06/11/2026 basta con «Ver»
// en Cheques: migración 20261106520000), caducidad (último día incluido),
// reembolso, factura única y compra manual idempotente (esa sigue pidiendo
// «Editar»).
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACIONES = "supabase/migrations";
const FUNCIONES = [
  "private.cheques_controlar_caducidad",
  "public.verificar_cheque_regalo",
  "public.canjear_cheque_regalo",
  "public.listar_cheques_regalo_v3",
  "public.emitir_factura_cheque",
  "public.detalle_cheque_regalo",
  "public.crear_cheque_manual",
  "public.crear_cheque_manual_v2",
  "public.metricas_cheques_regalo",
];

/** Última definición (por orden de migración) de cada función pedida. */
async function definiciones() {
  const ultima = new Map();
  for (const fichero of (await readdir(MIGRACIONES)).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = await readFile(`${MIGRACIONES}/${fichero}`, "utf8");
    const re = /create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.\w+)\s*\([\s\S]*?\bas\s+(\$\w*\$)[\s\S]*?\2[^;]*;/gi;
    for (const m of sql.matchAll(re)) ultima.set(m[1].toLowerCase(), m[0].replace(/^create\s+function/i, "create or replace function"));
  }
  return FUNCIONES.map((nombre) => {
    if (!ultima.has(nombre)) throw new Error(`No se encontró ${nombre} en las migraciones`);
    return ultima.get(nombre);
  });
}

const db = new PGlite();
const sql = (texto, params) => db.query(texto, params);
const una = async (texto, params) => (await sql(texto, params)).rows[0];
let comprobaciones = 0;
const igual = (valor, esperado, nombre) => { assert.deepEqual(valor, esperado, nombre); comprobaciones++; };
const falla = async (promesa, patron, nombre) => { await assert.rejects(promesa, patron, nombre); comprobaciones++; };

const EDITOR = "10000000-0000-0000-0000-000000000001";
const LECTOR = "20000000-0000-0000-0000-000000000002";
const AJENO = "30000000-0000-0000-0000-000000000003";
const como = (usuario) => db.exec(`set test.actor = '${usuario ?? ""}'`);

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
  insert into auth.users values ('${EDITOR}', 'editor@test.local'), ('${LECTOR}', 'lector@test.local'), ('${AJENO}', 'ajeno@test.local');

  -- Permisos de sección simulados: 'edit' implica 'view', como en el panel.
  create table public.permisos_prueba (user_id uuid, seccion text, permiso text);
  insert into public.permisos_prueba values ('${EDITOR}', 'cheques', 'edit'), ('${LECTOR}', 'cheques', 'view');
  create function public.has_section_permission(_user_id uuid, _section text, _permission text)
  returns boolean language sql stable as $$
    select exists (select 1 from public.permisos_prueba p where p.user_id = _user_id and p.seccion = _section
      and (p.permiso = _permission or (p.permiso = 'edit' and _permission = 'view')))
  $$;

  -- Mismas columnas y restricciones que la tabla de producción (consultadas en el catálogo).
  create table public.cheques_regalo (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    importe_eur numeric not null check (importe_eur > 0),
    comprador_nombre text not null, comprador_email text not null, comprador_telefono text,
    destinatario_nombre text, mensaje text, fecha_entrega_deseada date,
    estado text not null default 'pendiente' check (estado in ('pendiente','pagado','cancelado')),
    codigo text unique, stripe_session_id text unique, stripe_payment_intent_id text,
    email_enviado_en timestamptz, usado boolean not null default false,
    canjeado_en timestamptz, canjeado_por uuid references auth.users(id),
    solicita_factura boolean not null default false, datos_factura jsonb,
    origen text not null default 'web' check (origen in ('web','manual')),
    pago_manual_metodo text check (pago_manual_metodo in ('efectivo','tarjeta','transferencia','cortesia')),
    ocultar_importe boolean not null default false, creado_por uuid references auth.users(id),
    solicitud_manual_id uuid unique, plantilla_cheque jsonb,
    emitido_en timestamptz, caduca_el date, stripe_fee_eur numeric,
    gastos_gestion_eur numeric(10,2) not null default 0 check (gastos_gestion_eur >= 0)
  );
  create table public.plantilla_cheques_regalo (
    id boolean primary key default true check (id),
    pdf_titulo text not null default 'Cheque regalo',
    caducidad_meses integer not null default 12 check (caducidad_meses between 1 and 120),
    gastos_gestion_activos boolean not null default false,
    gastos_gestion_porcentaje numeric(5,2) not null default 1.5 check (gastos_gestion_porcentaje >= 0 and gastos_gestion_porcentaje < 10),
    gastos_gestion_fijo_eur numeric(6,2) not null default 0.25 check (gastos_gestion_fijo_eur >= 0 and gastos_gestion_fijo_eur <= 5)
  );
  insert into public.plantilla_cheques_regalo(id) values (true);
  create table public.plantilla_factura_cheques (
    id boolean primary key default true check (id),
    emisor_nombre text not null default '', emisor_nif text not null default '', emisor_direccion text not null default '',
    logo_data text not null default '', iva_porcentaje numeric(5,2) not null default 0,
    pie text not null default '', actualizado_en timestamptz not null default now(), email_mensaje text not null default ''
  );
  insert into public.plantilla_factura_cheques(id, emisor_nombre, emisor_nif, emisor_direccion, iva_porcentaje)
  values (true, 'Casa Tomás', 'B00000000', 'Crevillent', 10);
  create sequence public.facturas_cheques_numero_seq;
  create table public.facturas_cheques (
    id uuid primary key default gen_random_uuid(),
    cheque_id uuid not null unique references public.cheques_regalo(id),
    numero text not null unique default ('CT-' || lpad(nextval('public.facturas_cheques_numero_seq')::text, 8, '0')),
    emitida_en timestamptz not null default now(), emisor jsonb not null, cliente jsonb not null,
    importe_eur numeric(10,2) not null, iva_porcentaje numeric(5,2) not null, email_enviado_en timestamptz,
    gastos_gestion_eur numeric(10,2) not null default 0 check (gastos_gestion_eur >= 0)
  );
`);
for (const definicion of await definiciones()) await db.exec(definicion);
await db.exec(`create trigger cheques_controlar_caducidad before insert or update on public.cheques_regalo
  for each row execute function private.cheques_controlar_caducidad();`);

const hoy = (await una(`select (clock_timestamp() at time zone 'Europe/Madrid')::date::text as d`)).d;
const listar = async (filtros = {}) => (await una(
  `select public.listar_cheques_regalo_v3($1, $2, $3, $4, $5, $6, $7) as r`,
  [filtros.pagina ?? 0, filtros.busqueda ?? "", filtros.tamano ?? 6, filtros.orden ?? "fecha_desc", filtros.estado ?? "todos", null, null],
)).r;
const verificar = async (codigo) => (await una(`select public.verificar_cheque_regalo($1) as r`, [codigo])).r;
const canjear = async (codigo) => (await una(`select public.canjear_cheque_regalo($1) as r`, [codigo])).r;

/** Compra web: fila «pendiente» como la crea `cheques-regalo-web/crear`. */
const crearPendiente = async (importe = 50, extra = {}) => (await una(
  `insert into public.cheques_regalo (importe_eur, comprador_nombre, comprador_email, solicita_factura, datos_factura, gastos_gestion_eur)
   values ($1, 'Ana Prueba', 'ana@test.local', $2, $3, $4) returning id`,
  [importe, extra.solicita_factura ?? false, extra.datos_factura ?? null, extra.gastos_gestion_eur ?? 0],
)).id;

/** Exactamente la sentencia de `procesarPagoCompletado` en el webhook. */
const pagar = async (id, codigo, intento) => (await sql(
  `update public.cheques_regalo set estado = 'pagado', codigo = $1, stripe_payment_intent_id = $2
   where id = $3 and estado = 'pendiente' returning *`, [codigo, intento, id])).rows;

// --- 1. Pendiente de pago: ni código, ni caducidad, ni visible como disponible -------------
const web = await crearPendiente(50, { solicita_factura: true, datos_factura: { nombre: "Ana SL", nif: "B11111111", direccion: "Calle 1" } });
let fila = await una(`select * from public.cheques_regalo where id = $1`, [web]);
igual([fila.estado, fila.codigo, fila.caduca_el, fila.emitido_en], ["pendiente", null, null, null], "pendiente sin código ni caducidad");
await como(LECTOR);
let listado = await listar();
igual([listado.expedidos, listado.disponibles, listado.tickets.length], [0, 0, 0], "un pendiente no aparece ni cuenta como disponible");
await falla(sql(`select public.emitir_factura_cheque($1)`, [web]), /no pagado/, "no se factura un cheque sin pagar");

// --- 2. Pago confirmado por Stripe ------------------------------------------------------------
igual((await pagar(web, "CT-AAAA2222", "pi_1")).length, 1, "el primer evento marca el cheque como pagado");
fila = await una(`select *, caduca_el::text as caduca from public.cheques_regalo where id = $1`, [web]);
const esperado = (await una(`select (($1::date) + make_interval(months => 12))::date::text as d`, [hoy])).d;
igual([fila.estado, fila.codigo, fila.caduca], ["pagado", "CT-AAAA2222", esperado], "caduca a los 12 meses (Europe/Madrid)");
igual((await pagar(web, "CT-BBBB3333", "pi_1")).length, 0, "un evento repetido no genera un segundo código");
igual((await una(`select codigo from public.cheques_regalo where id = $1`, [web])).codigo, "CT-AAAA2222", "el código no cambia con el reintento");
// `checkout.session.expired` que llega tarde no anula un cheque ya pagado.
igual((await sql(`update public.cheques_regalo set estado = 'cancelado' where id = $1 and estado = 'pendiente' returning id`, [web])).rows.length, 0, "una sesión caducada no cancela un pago");
// Cambiar el plazo en el panel no prorroga cheques ya emitidos.
await db.exec(`update public.plantilla_cheques_regalo set caducidad_meses = 24`);
await sql(`update public.cheques_regalo set email_enviado_en = now() where id = $1`, [web]);
igual((await una(`select caduca_el::text c from public.cheques_regalo where id = $1`, [web])).c, esperado, "ni el reintento ni la plantilla prorrogan la caducidad");
await db.exec(`update public.plantilla_cheques_regalo set caducidad_meses = 12`);

// --- 3. Factura única aunque Stripe repita el evento ------------------------------------------
const f1 = (await una(`select public.emitir_factura_cheque($1) as f`, [web])).f;
const f2 = (await una(`select public.emitir_factura_cheque($1) as f`, [web])).f;
igual([f1.numero, f2.numero, Number(f1.importe_eur)], ["CT-00000001", "CT-00000001", 50], "una sola factura por cheque");

// --- 4. Listado, verificación y permisos ------------------------------------------------------
listado = await listar();
igual([listado.expedidos, listado.disponibles, listado.tickets[0].codigo], [1, 1, "CT-AAAA2222"], "el pagado aparece disponible");
let v = await verificar(" ct-aaaa2222 ");
igual([v.encontrado, v.valido, v.caducado, v.dias_restantes > 360], [true, true, false, true], "verificación normaliza el código y calcula días");
await como(AJENO);
await falla(verificar("CT-AAAA2222"), /permiso/, "sin permiso de Cheques no se puede verificar");
await falla(listar(), /permiso/, "sin permiso de Cheques no se puede listar");
await falla(canjear("CT-AAAA2222"), /permiso/, "sin permiso de Cheques no se puede canjear");
await como(null);
await falla(verificar("CT-AAAA2222"), /permiso/, "sin sesión no se puede verificar");
await falla(canjear("CT-AAAA2222"), /permiso/, "sin sesión no se puede canjear");
await como(LECTOR);
await falla(listar({ tamano: 7 }), /Paginación inválida/, "tamaño de página no permitido");
await falla(listar({ estado: "pendiente" }), /Filtro u orden inválido/, "estado de filtro no permitido");

// --- 5. Canje único -----------------------------------------------------------------------------
await como(EDITOR);
v = await canjear("CT-AAAA2222");
igual([v.usado, v.valido], [true, false], "canje correcto");
const canje = await una(`select canjeado_por, canjeado_en from public.cheques_regalo where id = $1`, [web]);
igual([canje.canjeado_por, canje.canjeado_en !== null], [EDITOR, true], "queda registrado quién y cuándo canjeó");
await falla(canjear("CT-AAAA2222"), /ya ha sido canjeado/, "no se puede canjear dos veces");
listado = await listar({ estado: "canjeado" });
igual([listado.coincidencias, listado.canjeados, listado.disponibles], [1, 1, 0], "el canjeado deja de estar disponible");

// --- 6. Caducidad: último día incluido, después imposible de canjear ------------------------------
const crearPagado = async (codigo, importe = 30) => {
  const id = await crearPendiente(importe);
  await pagar(id, codigo, `pi_${codigo}`);
  return id;
};
const fijarCaducidad = async (id, fecha) => {
  // Solo la prueba puede mover la fecha: el trigger la congela una vez emitida.
  await db.exec(`alter table public.cheques_regalo disable trigger cheques_controlar_caducidad`);
  await sql(`update public.cheques_regalo set caduca_el = $1::date where id = $2`, [fecha, id]);
  await db.exec(`alter table public.cheques_regalo enable trigger cheques_controlar_caducidad`);
};
const ultimoDia = await crearPagado("CT-CCCC4444");
await fijarCaducidad(ultimoDia, hoy);
v = await verificar("CT-CCCC4444");
igual([v.valido, v.caducado, v.dias_restantes], [true, false, 0], "el último día todavía es válido");
// Este lo canjea solo lectura (solo «Ver» en Cheques): basta desde el 06/11/2026, y queda quién fue.
await como(LECTOR);
igual((await canjear("CT-CCCC4444")).usado, true, "se puede canjear el último día (y con solo «Ver»)");
igual((await una(`select canjeado_por from public.cheques_regalo where codigo = 'CT-CCCC4444'`)).canjeado_por, LECTOR, "queda registrado el lector que canjeó");
await falla(canjear("CT-CCCC4444"), /ya ha sido canjeado/, "tampoco el lector canjea dos veces");
await como(EDITOR);

const caducado = await crearPagado("CT-DDDD5555");
const ayer = (await una(`select ($1::date - 1)::text as d`, [hoy])).d;
await fijarCaducidad(caducado, ayer);
v = await verificar("CT-DDDD5555");
igual([v.valido, v.caducado, v.dias_restantes], [false, true, 0], "caducado ayer: no válido");
await falla(canjear("CT-DDDD5555"), /caducado/, "un cheque caducado no se canjea por RPC");
await falla(sql(`update public.cheques_regalo set usado = true where id = $1`, [caducado]), /caducado/, "ni con una actualización directa");
listado = await listar({ estado: "caducado" });
igual([listado.coincidencias, listado.caducados], [1, 1], "aparece como caducado en el listado");
await sql(`update public.cheques_regalo set caduca_el = '2099-01-01' where id = $1`, [caducado]);
igual((await una(`select caduca_el::text c from public.cheques_regalo where id = $1`, [caducado])).c, ayer, "la caducidad no se puede prorrogar con un UPDATE");

// --- 7. Reembolso total desde Stripe (`charge.refunded`) ----------------------------------------
const reembolsado = await crearPagado("CT-EEEE6666", 80);
igual((await sql(`update public.cheques_regalo set estado = 'cancelado' where stripe_payment_intent_id = $1 and estado = 'pagado' returning id`, ["pi_CT-EEEE6666"])).rows.length, 1, "el reembolso anula el cheque");
v = await verificar("CT-EEEE6666");
igual([v.estado, v.valido], ["cancelado", false], "un cheque reembolsado no es válido");
await falla(canjear("CT-EEEE6666"), /no es válido/, "ni se puede canjear");
listado = await listar({ estado: "cancelado" });
igual(listado.coincidencias, 1, "aparece como cancelado");
await falla(sql(`insert into public.cheques_regalo (importe_eur, comprador_nombre, comprador_email, usado) values (20, 'X', 'x@test.local', true)`), /no es válido para canjear/, "no se puede crear un cheque ya usado sin pagar");

// --- 8. Orden, búsqueda y paginación ANTES de paginar -------------------------------------------
for (let i = 0; i < 7; i++) await crearPagado(`CT-ORD${i}AAA`, 10 + i * 100);
await como(LECTOR);
listado = await listar({ orden: "importe_desc" });
igual(listado.tickets.map((t) => Number(t.importe_eur)), [610, 510, 410, 310, 210, 110], "ordena por importe sobre TODOS los cheques y luego pagina");
listado = await listar({ orden: "importe_desc", pagina: 1 });
igual([listado.expedidos, listado.tickets.length], [11, 5], "11 expedidos: la segunda página trae los 5 restantes");
listado = await listar({ busqueda: "ord3" });
igual([listado.coincidencias, listado.tickets[0].codigo], [1, "CT-ORD3AAA"], "busca por código sin distinguir mayúsculas");
listado = await listar({ busqueda: "ANA@test" });
igual(listado.coincidencias, 11, "busca por email del comprador");

// --- 9. Compra manual idempotente ---------------------------------------------------------------
await como(EDITOR);
const solicitud = "40000000-0000-0000-0000-000000000004";
const datos = { importe_eur: 25, comprador_nombre: "Luis", comprador_email: "luis@test.local", pago_manual_metodo: "efectivo" };
const m1 = (await una(`select public.crear_cheque_manual_v2($1, $2) as c`, [solicitud, datos])).c;
const m2 = (await una(`select public.crear_cheque_manual_v2($1, $2) as c`, [solicitud, datos])).c;
igual([m1.id === m2.id, m1.codigo === m2.codigo, m1.estado, m1.origen, m1.caduca_el !== null], [true, true, "pagado", "manual", true], "reintentar la compra manual no crea otro cheque");
await falla(sql(`select public.crear_cheque_manual($1, $2)`, ["50000000-0000-0000-0000-000000000005", { ...datos, importe_eur: 5 }]), /importe/, "importe mínimo de 10 €");
await como(LECTOR);
await falla(sql(`select public.crear_cheque_manual($1, $2)`, ["60000000-0000-0000-0000-000000000006", datos]), /permiso/, "solo lectura no expide cheques");

// --- 10. Gastos de gestión: factura y métricas de la pestaña Stripe -----------------------------
await como(AJENO);
await falla(sql(`select public.metricas_cheques_regalo()`), /permiso/, "sin permiso de Cheques no hay métricas");
await como(LECTOR);
const metricas = async () => (await una(`select public.metricas_cheques_regalo() as m`)).m;
const antes = await metricas();
// Cheque de 50 € con 1,02 € de gastos y la comisión real que guarda el webhook (1,02 €).
const conGastos = await crearPendiente(50, { gastos_gestion_eur: 1.02, solicita_factura: true, datos_factura: { nombre: "Ana SL", nif: "B11111111", direccion: "Calle 1" } });
await pagar(conGastos, "CT-GGGG7777", "pi_gastos");
await sql(`update public.cheques_regalo set stripe_fee_eur = 1.02 where id = $1`, [conGastos]);
const factura = (await una(`select public.emitir_factura_cheque($1) as f`, [conGastos])).f;
igual([Number(factura.importe_eur), Number(factura.gastos_gestion_eur)], [50, 1.02], "la factura recoge el cheque y los gastos por separado");
// Cheque de 100 € con 1,78 € de gastos y sin comisión real todavía: se estima sobre lo cobrado.
await pagar(await crearPendiente(100, { gastos_gestion_eur: 1.78 }), "CT-HHHH8888", "pi_estimada");
// Una compra manual nunca entra en las métricas de Stripe.
await como(EDITOR);
await sql(`select public.crear_cheque_manual_v2($1, $2)`, ["70000000-0000-0000-0000-000000000007", { ...datos, importe_eur: 40 }]);
await como(LECTOR);
const despues = await metricas();
const delta = (campo) => Math.round((Number(despues[campo]) - Number(antes[campo])) * 100) / 100;
igual([delta("pagos"), delta("pagos_con_gastos")], [2, 2], "cuenta los dos pagos web con gastos y no la compra manual");
igual([delta("valor_cheques_eur"), delta("gastos_gestion_eur"), delta("bruto_eur")], [150, 2.8, 152.8], "separa valor de los cheques, gastos y lo cobrado");
// 1,02 real + round(101,78 × 1,5 % + 0,25) = 1,78 estimada.
igual([delta("comision_eur"), delta("neto_eur")], [2.8, 150], "los gastos cubren la comisión: al restaurante le queda el valor íntegro");
igual(despues.comision_incompleta, true, "avisa de que hay comisiones estimadas");

console.log(`test-cheques-regalo: ${comprobaciones} comprobaciones superadas`);
