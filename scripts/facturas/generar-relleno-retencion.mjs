#!/usr/bin/env node
// Genera supabase/snippets/2026-11-06_retencion_irpf_historico.sql: la retención
// de IRPF de las facturas importadas del histórico, sacada de los JSON de
// facturas-conocimiento/importar (campo retencion_irpf) y casada por
// facturas.import_clave = la «clave» de importar/manifest.json.
//
//   node scripts/facturas/generar-relleno-retencion.mjs <carpeta importar> [salida.sql]
//
// Ejemplo: node scripts/facturas/generar-relleno-retencion.mjs ../facturas-conocimiento/importar
import fs from "node:fs";
import path from "node:path";

const [, , carpeta, salida = "supabase/snippets/2026-11-06_retencion_irpf_historico.sql"] = process.argv;
if (!carpeta) {
  console.error("Uso: node scripts/facturas/generar-relleno-retencion.mjs <carpeta importar> [salida.sql]");
  process.exit(1);
}

/** Número de un campo del JSON (igual que importar-factura-historica/mapeo.ts). */
export function numero(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim().replace(/\s|€/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

const manifest = JSON.parse(fs.readFileSync(path.join(carpeta, "manifest.json"), "utf8"));
const filas = [];
for (const m of manifest) {
  const d = JSON.parse(fs.readFileSync(path.join(carpeta, m.json), "utf8"));
  const r = numero(d.retencion_irpf);
  if (!r) continue;
  const base = numero(d.subtotal);
  const pctJson = numero(d.retencion_irpf_pct);
  const pct = pctJson && pctJson > 0 && pctJson <= 50
    ? pctJson
    : base ? Math.round((10000 * Math.abs(r)) / Math.abs(base)) / 100 : null;
  filas.push({ clave: m.clave, r: Math.abs(r), pct: pct && pct > 0 && pct <= 50 ? pct : null, prov: d.proveedor, fecha: d.fecha });
}
filas.sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.clave.localeCompare(b.clave));

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const valores = filas
  .map((f, i) =>
    `  (${lit(f.clave)}, ${f.r.toFixed(2)}, ${f.pct === null ? "null" : f.pct.toFixed(2)})${i < filas.length - 1 ? "," : ""}` +
    `  -- ${f.fecha} ${String(f.prov ?? "").replace(/\s+/g, " ")}`)
  .join("\n");

const sql = `set client_encoding = 'UTF8';
-- ============================================================================
-- Relleno de facturas.retencion_irpf del histórico importado (06/11/2026)
-- ----------------------------------------------------------------------------
-- Generado con scripts/facturas/generar-relleno-retencion.mjs desde los JSON de
-- facturas-conocimiento/importar (${filas.length} facturas con retención). Casa por
-- facturas.import_clave. NO es una migración: se ejecuta a mano en la demo y,
-- en producción, DESPUÉS de la importación histórica y de 20261106300000.
--   supabase db query --linked -f supabase/snippets/2026-11-06_retencion_irpf_historico.sql
-- Es repetible: no toca las que ya tienen la retención, ni las que no cuadran
-- (base + IVA − retención ≠ total, ±0,05 €), que salen en la lista final.
-- El signo sigue al total (negativa en un abono). Después recalcula sus avisos
-- (se va el «iva_incoherente»).
-- ============================================================================
begin;

create temp table _retencion_historico (import_clave text primary key, retencion numeric(12,2), pct numeric(5,2))
  on commit drop;
insert into _retencion_historico (import_clave, retencion, pct) values
${valores}
;

create temp table _retencion_aplicada on commit drop as
with upd as (
  update public.facturas f
     set retencion_irpf = case when f.total < 0 then -r.retencion else r.retencion end,
         retencion_irpf_pct = r.pct
    from _retencion_historico r
   where f.import_clave = r.import_clave
     and f.retencion_irpf is null
     and (f.subtotal is null or f.iva is null or f.total is null
          or abs(abs(f.subtotal + f.iva - f.total) - r.retencion) <= 0.05)
  returning f.id
)
select id from upd;

select public.recalcular_alertas_factura(a.id) from _retencion_aplicada a;

-- Resumen: aplicadas ahora, ya tenían, no encontradas y no cuadran.
select 'aplicadas' as estado, count(*) as n from _retencion_aplicada
union all
select 'con retención (total)', count(*) from public.facturas f join _retencion_historico r using (import_clave)
 where f.retencion_irpf is not null
union all
select 'clave no encontrada', count(*) from _retencion_historico r
 where not exists (select 1 from public.facturas f where f.import_clave = r.import_clave)
union all
select 'no cuadra (revisar): ' || string_agg(r.import_clave, ', '), count(*)
  from _retencion_historico r join public.facturas f using (import_clave)
 where f.retencion_irpf is null;

commit;
`;
fs.writeFileSync(salida, sql);
console.log(`${filas.length} facturas con retención → ${salida}`);
