// @vitest-environment node
/**
 * Copias controladas entre Supabase y Vercel (fase 0 de Instagram, 6.7 de la
 * propuesta). Vercel no puede importar de supabase/functions, así que estos
 * ficheros viven dos veces. Si alguien cambia uno y no el otro (por ejemplo,
 * registra un secreto nuevo para taparlo en los registros solo en un lado),
 * este test falla.
 *
 *   Fuente (se edita aquí)                              Copia (cp, sin tocar)
 *   supabase/functions/_shared/instagram/validacion.ts → api/_lib/instagram/validacion.ts
 *   supabase/functions/_shared/instagram/secretos.ts   → api/_lib/instagram/secretos.ts
 *
 * http.ts y supabase.ts NO son copias: cada lado tiene lo suyo (Deno/Edge
 * frente a Node/Vercel) y divergen a propósito.
 *
 * El panel (navegador) no tiene copia: src/components/marketing/instagram/
 * contadores.ts importa directamente la fuente.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as contadores from "../../../src/components/marketing/instagram/contadores";
import * as fuente from "../../../supabase/functions/_shared/instagram/validacion";

const raiz = path.resolve(__dirname, "../../..");
const leer = (r: string) => readFileSync(path.join(raiz, r), "utf8").replace(/\r\n/g, "\n");

describe("copias de Instagram entre Supabase y Vercel", () => {
  for (const nombre of ["validacion.ts", "secretos.ts"]) {
    it(`api/_lib/instagram/${nombre} es idéntica a supabase/functions/_shared/instagram/${nombre}`, () => {
      const original = leer(`supabase/functions/_shared/instagram/${nombre}`);
      const copia = leer(`api/_lib/instagram/${nombre}`);
      expect(
        copia === original,
        `api/_lib/instagram/${nombre} diverge de la fuente. Copia la de Supabase: cp supabase/functions/_shared/instagram/${nombre} api/_lib/instagram/${nombre}`,
      ).toBe(true);
    });
  }

  it("el panel cuenta igual que el servidor (misma fuente)", () => {
    const texto = "Hola #casatomas @amigo #touza 🍷";
    expect(contadores.contarHashtags(texto)).toBe(fuente.contarHashtags(texto));
    expect(contadores.contarMenciones(texto)).toBe(fuente.contarMenciones(texto));
    expect(contadores.MAX_CAPTION).toBe(fuente.LIMITES_CAPTION.caracteres);
    expect(contadores.MAX_HASHTAGS).toBe(fuente.LIMITES_CAPTION.hashtags);
    expect(contadores.MAX_MENCIONES).toBe(fuente.LIMITES_CAPTION.menciones);
    expect(contadores.MAX_ALT_TEXT).toBe(fuente.MAX_ALT_TEXT);
  });
});
