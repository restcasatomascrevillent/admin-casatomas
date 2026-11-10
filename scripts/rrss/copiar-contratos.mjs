// Copia los contratos de RRSS de src/lib/rrss a la Edge Function
// (supabase/functions/_shared/rrss), que no puede importar de src/ y en Deno
// necesita las extensiones .ts en los imports.
//
//   node scripts/rrss/copiar-contratos.mjs          → escribe las copias
//   node scripts/rrss/copiar-contratos.mjs --comprobar → falla si no coinciden (lo usa el test)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FICHEROS = ["formatos.ts", "estilos.ts", "plan.ts"];
const ORIGEN = "src/lib/rrss";
const DESTINO = "supabase/functions/_shared/rrss";
const CABECERA = "// COPIA GENERADA de src/lib/rrss (node scripts/rrss/copiar-contratos.mjs). No editar a mano.\n";

export function copiaDe(texto) {
  return (
    CABECERA +
    texto
      .replace(/import type \{ MarcaId \} from "\.\.\/instagram\/tokens(?:\.js)?";/, 'type MarcaId = "casa-tomas" | "touza";')
      .replace(/from "\.\/(\w+)(?:\.js)?";/g, 'from "./$1.ts";')
  );
}

export function comprobar(raiz = process.cwd()) {
  const distintos = [];
  for (const f of FICHEROS) {
    const esperado = copiaDe(readFileSync(path.join(raiz, ORIGEN, f), "utf8"));
    let actual = "";
    try {
      actual = readFileSync(path.join(raiz, DESTINO, f), "utf8");
    } catch {
      /* falta */
    }
    if (actual !== esperado) distintos.push(f);
  }
  return distintos;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--comprobar")) {
    const d = comprobar();
    if (d.length) {
      console.error(`Copias desactualizadas: ${d.join(", ")}. Ejecuta node scripts/rrss/copiar-contratos.mjs`);
      process.exit(1);
    }
    console.log("Copias de RRSS al día");
  } else {
    for (const f of FICHEROS) writeFileSync(path.join(DESTINO, f), copiaDe(readFileSync(path.join(ORIGEN, f), "utf8")));
    console.log(`Copiados ${FICHEROS.length} ficheros a ${DESTINO}`);
  }
}
