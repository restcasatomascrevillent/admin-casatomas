// Comprueba que ninguna migración nueva repite versión (los 14 dígitos del
// nombre). Supabase guarda la versión en supabase_migrations.schema_migrations
// con clave única: dos ficheros con la misma versión chocan en `db reset`,
// `db push` o `migration list` (aquí se aplican con `db query -f`, que no la
// mira, pero el día que se use la CLI completa fallaría).
//
// Las repetidas que YA existen están aplicadas en demo y producción y NO se
// renombran (cambiar el nombre de una migración aplicada descuadra el
// historial): quedan en REPETIDAS_HISTORICAS. Cualquier otra repetida falla.
// Ver docs/instagram.md, «Versiones de migración repetidas».
//
//   npm run test:migraciones
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Versiones repetidas conocidas (05/11/2026). No añadir ninguna más. */
export const REPETIDAS_HISTORICAS = Object.freeze({
  "20261003190000": ["20261003190000_facturacion_eliminar.sql", "20261003190000_ocultar_tickets_pendientes.sql"],
  "20261007190000": ["20261007190000_audit_log_identidad_obligatoria.sql", "20261007190000_cheques_manual_plantilla.sql"],
  "20261009100000": ["20261009100000_canal_presencial.sql", "20261009100000_openai_gasto_por_clave.sql"],
  "20261009110000": ["20261009110000_salas_cerradas_servicio.sql", "20261009110000_tope_gasto_ia.sql"],
  "20261010140000": ["20261010140000_auditoria_storage_owner.sql", "20261010140000_facturas_recalcular_alertas.sql"],
  // La de Instagram (B6 de la evaluación del 05/11/2026): instagram_fotos se
  // aplicó con la misma versión que vincular_albaranes_por_sentencia.
  "20261105120000": ["20261105120000_instagram_fotos.sql", "20261105120000_vincular_albaranes_por_sentencia.sql"],
});

/** Problemas de una lista de nombres de fichero de migración. */
export function problemasVersiones(nombres) {
  const problemas = [];
  const porVersion = new Map();
  for (const n of nombres) {
    if (!n.endsWith(".sql")) continue;
    // Las antiguas (Lovable) llevan un uuid con guiones tras la versión.
    const m = /^(\d{14})_[A-Za-z0-9_-]+\.sql$/.exec(n);
    if (!m) {
      problemas.push(`Nombre de migración no válido (AAAAMMDDhhmmss_nombre.sql): ${n}`);
      continue;
    }
    porVersion.set(m[1], [...(porVersion.get(m[1]) ?? []), n]);
  }
  for (const [version, ficheros] of porVersion) {
    if (ficheros.length < 2) continue;
    const conocidas = REPETIDAS_HISTORICAS[version] ?? [];
    const nuevas = ficheros.filter((f) => !conocidas.includes(f));
    if (nuevas.length) problemas.push(`Versión ${version} repetida: ${ficheros.sort().join(", ")}. Usa otra versión (por ejemplo +100).`);
  }
  return problemas;
}

export async function comprobarCarpeta(carpeta) {
  return problemasVersiones(await readdir(carpeta));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problemas = await comprobarCarpeta(path.join(raiz, "supabase", "migrations"));
  if (problemas.length) {
    for (const p of problemas) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log("Versiones de migración: sin repetidas nuevas.");
}
