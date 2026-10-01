/**
 * El propio doble de Supabase de los tests de hooks (`dobleSupabaseTablas.ts`): lo que su cabecera dice que
 * imita de PostgREST, lo imita. Aquí solo se fija lo fácil de equivocar y que ningún test de hook ve:
 *
 *   · el orden de los NULL, como el `ORDER BY` de Postgres: AL FINAL en ascendente y AL PRINCIPIO en
 *     descendente (`NULLS LAST` / `NULLS FIRST` por defecto). Antes los ponía al revés (primero en
 *     ascendente y últimos en descendente), así que un hook que ordenara por una columna con NULL veía
 *     aquí un orden que en producción no existe;
 *   · que un NULL no pasa ningún filtro de rango, ni como valor de la columna ni como argumento (en SQL,
 *     comparar con NULL no da verdadero).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { crearDobleTablas } from "./dobleSupabaseTablas";

/** Lo que de la consulta del doble usan estos tests (`doble.from` es un `vi.fn`, que no se puede llamar con tipos). */
interface Consulta extends PromiseLike<{ data: Array<Record<string, unknown>> | null; error: unknown }> {
  order(columna: string, opciones?: { ascending?: boolean }): Consulta;
  gt(columna: string, valor: unknown): Consulta;
  gte(columna: string, valor: unknown): Consulta;
  lt(columna: string, valor: unknown): Consulta;
  lte(columna: string, valor: unknown): Consulta;
}

describe("dobleSupabaseTablas · orden con NULL (como el ORDER BY de Postgres)", () => {
  const doble = crearDobleTablas();
  const desde = doble.from as unknown as (tabla: string) => Consulta;

  beforeEach(() => {
    doble.reiniciar();
    // `b`, `d` y `e` son NULL en `n` (`e` ni siquiera trae la columna). En la tabla van en este orden.
    doble.tablas.t = [{ id: "a", n: 5 }, { id: "b", n: null }, { id: "c", n: 1 }, { id: "d", n: null }, { id: "e" }];
  });

  const ids = async (consulta: Consulta) => (await consulta).data!.map((fila) => fila.id);

  it("ascendente: los NULL van AL FINAL (NULLS LAST), empatados entre sí, y la columna siguiente los desempata", async () => {
    expect(await ids(desde("t").order("n"))).toEqual(["c", "a", "b", "d", "e"]);
    // Los tres NULL empatan: con `id` descendente como segundo criterio salen e, d, b (y los demás, en su sitio).
    expect(await ids(desde("t").order("n").order("id", { ascending: false }))).toEqual(["c", "a", "e", "d", "b"]);
  });

  it("descendente: los NULL van AL PRINCIPIO (NULLS FIRST), empatados entre sí, y la columna siguiente los desempata", async () => {
    expect(await ids(desde("t").order("n", { ascending: false }))).toEqual(["b", "d", "e", "a", "c"]);
    expect(await ids(desde("t").order("n", { ascending: false }).order("id", { ascending: false }))).toEqual([
      "e",
      "d",
      "b",
      "a",
      "c",
    ]);
  });

  it("un NULL no pasa ningún filtro de rango: ni como valor de la columna ni como argumento", async () => {
    expect(await ids(desde("t").gte("n", 0))).toEqual(["a", "c"]);
    expect(await ids(desde("t").lte("n", 100))).toEqual(["a", "c"]);
    for (const consulta of [
      desde("t").gt("n", null),
      desde("t").gte("n", null),
      desde("t").lt("n", null),
      desde("t").lte("n", null),
    ]) {
      expect(await ids(consulta)).toEqual([]);
    }
  });
});
