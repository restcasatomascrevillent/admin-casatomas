import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sin tipos
import { comprobarCarpeta, problemasVersiones } from "../../comprobar-versiones-migraciones.mjs";

describe("versiones de migración (B6 de la evaluación)", () => {
  it("la carpeta real no tiene repetidas nuevas", async () => {
    expect(await comprobarCarpeta(path.resolve(__dirname, "../../../supabase/migrations"))).toEqual([]);
  });

  it("las repetidas históricas pasan; una nueva, no", () => {
    expect(problemasVersiones(["20261105120000_instagram_fotos.sql", "20261105120000_vincular_albaranes_por_sentencia.sql"])).toEqual([]);
    const p = problemasVersiones(["20261111000000_instagram_seguridad.sql", "20261111000000_otra.sql"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/20261111000000 repetida/);
  });

  it("una tercera con una versión histórica también falla", () => {
    expect(
      problemasVersiones([
        "20261105120000_instagram_fotos.sql",
        "20261105120000_vincular_albaranes_por_sentencia.sql",
        "20261105120000_nueva.sql",
      ]),
    ).toHaveLength(1);
  });

  it("nombres mal formados", () => {
    expect(problemasVersiones(["2026_mal.sql", "README.md"])).toEqual(["Nombre de migración no válido (AAAAMMDDhhmmss_nombre.sql): 2026_mal.sql"]);
  });
});
