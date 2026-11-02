// Límites de los cubos de fotos contra un Postgres en memoria (PGlite), con
// la migración REAL del repo. Nunca toca Supabase.
//
//   npm run test:cubos-fotos:db
//
// Cubre 20261101200000_cubos_fotos_limites.sql: 5 MB e imágenes en vinos,
// bebidas, cocteles y novedades; imágenes + vídeo y 50 MB en platos; no toca
// otros cubos; idempotente; no falla si falta algún cubo.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG = await readFile("supabase/migrations/20261101200000_cubos_fotos_limites.sql", "utf8");
const IMAGENES = ["image/jpeg", "image/png", "image/webp"];
const VIDEOS = ["video/mp4", "video/webm", "video/quicktime", "video/3gpp", "video/x-matroska"];
let n = 0;
const igual = (v, e, m) => { assert.deepEqual(v, e, m); n++; };

const db = new PGlite();
await db.exec(`
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  insert into storage.buckets (id, name, public) values
    ('platos','platos',true), ('vinos','vinos',true), ('bebidas','bebidas',true),
    ('novedades','novedades',true), ('ecommerce','ecommerce',true);
  insert into storage.buckets values
    ('facturas-originales','facturas-originales',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
`); // sin 'cocteles' a propósito: la migración no debe fallar

await db.exec(MIG);
await db.exec(MIG); // idempotente

const fila = async (id) => (await db.query("select file_size_limit::int l, allowed_mime_types t from storage.buckets where id = $1", [id])).rows[0];

for (const id of ["vinos", "bebidas", "novedades"]) {
  igual(await fila(id), { l: 5 * 1024 * 1024, t: IMAGENES }, `${id}: 5 MB y JPG/PNG/WebP`);
}
const platos = await fila("platos");
igual(platos.l, 50 * 1024 * 1024, "platos: 50 MB por el vídeo en bruto");
igual(platos.t, [...IMAGENES, ...VIDEOS], "platos: imágenes y los vídeos del panel");
for (const malo of ["application/x-msdownload", "application/octet-stream", "application/x-dosexec", "image/svg+xml", "text/html"]) {
  igual(platos.t.includes(malo) || (await fila("vinos")).t.includes(malo), false, `${malo} no se admite`);
}
igual(await fila("ecommerce"), { l: null, t: null }, "ecommerce no se toca");
igual((await fila("facturas-originales")).l, 10485760, "facturas-originales no se toca");
igual((await db.query("select count(*)::int c from storage.buckets where id = 'cocteles'")).rows[0].c, 0, "no crea cubos que no existen");

// tipoMimeBruto del panel: todo lo que sube el flujo de vídeo debe caber en platos.
const cola = await readFile("src/components/carta/potente/colaPendientes.ts", "utf8");
const tiposPanel = [...cola.matchAll(/"(video\/[a-z0-9.+-]+)"/g)].map((m) => m[1]);
assert.ok(tiposPanel.length >= 4, "se leen los tipos de vídeo del panel");
for (const t of new Set(tiposPanel)) igual(platos.t.includes(t), true, `platos admite ${t} (tipoMimeBruto)`);
const max = /MAX_BYTES_BRUTO\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(cola);
igual(Number(max[1]) * 1024 * 1024 <= platos.l, true, "el límite de platos cubre MAX_BYTES_BRUTO");

console.log(`cubos de fotos: ${n} comprobaciones OK`);
