/**
 * Destino de Linear contra un servidor GraphQL simulado que se comporta como
 * Linear (ids únicos, 429, 5xx, clave rechazada) y destino de pruebas.
 */
import { describe, expect, it, vi } from "vitest";
import { crearDestinoLinear, crearDestinoPrueba, ErrorLinear, prioridadLinear, type DatosCrear, type RepoPrueba } from "../linear";

/** Linear simulado: guarda issues por id y rechaza un id repetido como hace la API. */
function linearSimulado(opciones: { fallos?: Array<"429" | "500" | "red" | "perder_respuesta">; clave?: string } = {}) {
  const issues = new Map<string, { id: string; identifier: string; url: string; state: { name: string; type: string }; comentarios: string[] }>();
  const fallos = [...(opciones.fallos ?? [])];
  let n = 0;
  const llamadas: Array<{ query: string; variables: Record<string, unknown>; auth: string | null }> = [];
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body));
    const auth = new Headers(init?.headers).get("authorization");
    llamadas.push({ query, variables, auth });
    if (auth !== (opciones.clave ?? "lin_api_prueba")) return new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), { status: 401 });
    const fallo = fallos.shift();
    if (fallo === "red") throw new TypeError("fetch failed");
    if (fallo === "429") return new Response(JSON.stringify({ errors: [{ message: "Rate limit exceeded" }] }), { status: 429 });
    if (fallo === "500") return new Response("upstream error", { status: 500 });
    const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
    if (query.includes("issueCreate")) {
      const input = variables.input as Record<string, unknown>;
      const id = String(input.id);
      if (issues.has(id)) return new Response(JSON.stringify({ errors: [{ message: "Entity already exists" }] }), { status: 400 });
      const issue = { id, identifier: `CT-${++n}`, url: `https://linear.app/ct/issue/CT-${n}`, state: { name: "Triage", type: "triage" }, comentarios: [] };
      issues.set(id, issue);
      if (fallo === "perder_respuesta") return new Response("gateway timeout", { status: 504 });
      return json({ issueCreate: { success: true, issue } });
    }
    if (query.includes("commentCreate")) {
      const input = variables.input as { issueId: string; body: string };
      issues.get(input.issueId)?.comentarios.push(input.body);
      return json({ commentCreate: { success: true } });
    }
    if (query.includes("issueUpdate")) {
      const i = issues.get(String(variables.id));
      if (i) i.state = { name: "Todo", type: "unstarted" };
      return json({ issueUpdate: { success: Boolean(i) } });
    }
    if (query.includes("issue(id")) return json({ issue: issues.get(String(variables.id)) ?? null });
    return new Response("?", { status: 400 });
  });
  return { fetchFn, issues, llamadas };
}

const datos = (over: Partial<DatosCrear> = {}): DatosCrear => ({
  id: "8f8b4e1c-3c2a-4b8e-9a51-1f2e3d4c5b6a", equipoId: "equipo-1", proyectoId: null, titulo: "TypeError en la carta",
  descripcion: "…", prioridad: 2, etiquetas: ["et-1"], incidenciaId: 7, ...over,
});
const sinEspera = async () => {};

describe("destino Linear real", () => {
  it("crea con el id determinista y la clave en Authorization (sin Bearer)", async () => {
    const l = linearSimulado();
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    const t = await destino.crear(datos());
    expect(t).toMatchObject({ id: datos().id, identificador: "CT-1", estadoTipo: "triage" });
    expect(l.llamadas[0].auth).toBe("lin_api_prueba");
    expect(l.llamadas[0].variables.input).toMatchObject({ id: datos().id, teamId: "equipo-1", labelIds: ["et-1"], priority: 2 });
  });
  it("reintentar la creación NO duplica: recupera el ticket existente", async () => {
    const l = linearSimulado();
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    await destino.crear(datos());
    const otra = await destino.crear(datos());
    expect(otra.identificador).toBe("CT-1");
    expect(l.issues.size).toBe(1);
  });
  it("respuesta perdida (504 tras crear): el reintento lo encuentra y no crea otro", async () => {
    const l = linearSimulado({ fallos: ["perder_respuesta", "perder_respuesta", "perder_respuesta"] });
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera, intentos: 3 });
    const t = await destino.crear(datos());
    expect(t.identificador).toBe("CT-1");
    expect(l.issues.size).toBe(1);
  });
  it("429/5xx/red: reintenta con espera y acaba bien", async () => {
    const l = linearSimulado({ fallos: ["429", "500"] });
    const esperas: number[] = [];
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: async (ms) => { esperas.push(ms); }, intentos: 3 });
    expect((await destino.crear(datos())).identificador).toBe("CT-1");
    expect(esperas).toEqual([1000, 2000]);
  });
  it("si Linear sigue caído, error reintentable (la incidencia queda pendiente)", async () => {
    const l = linearSimulado({ fallos: ["red", "red", "red", "red", "red", "red", "red"] });
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera, intentos: 3 });
    await expect(destino.crear(datos())).rejects.toMatchObject({ reintentable: true });
  });
  it("clave rechazada: error no reintentable", async () => {
    const l = linearSimulado({ clave: "otra" });
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    const e = await destino.crear(datos()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorLinear);
    expect(e.reintentable).toBe(false);
  });
  it("sin equipo no llama a Linear", async () => {
    const l = linearSimulado();
    await expect(crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn }).crear(datos({ equipoId: null }))).rejects.toThrow(/equipo/);
    expect(l.fetchFn).not.toHaveBeenCalled();
  });
  it("comenta, reabre y consulta el estado", async () => {
    const l = linearSimulado();
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    const t = await destino.crear(datos());
    await destino.comentar(t.id, "Reaparecida", 7);
    await destino.reabrir(t.id, "estado-todo", 7);
    expect(l.issues.get(t.id)?.comentarios).toEqual(["Reaparecida"]);
    expect((await destino.consultar(t.id))?.estadoTipo).toBe("unstarted");
  });
});

describe("destino de pruebas", () => {
  it("guarda lo que mandaría y es idempotente por id", async () => {
    const filas: Array<Record<string, unknown>> = [];
    const repo: RepoPrueba = {
      buscarCreado: async (u) => (filas.find((f) => f.linear_uuid === u && f.operacion === "crear") as { id: number }) ?? null,
      insertar: async (f) => { const fila = { ...f, id: filas.length + 1 }; filas.push(fila); return fila; },
    };
    const destino = crearDestinoPrueba(repo, "https://panel.test/");
    const a = await destino.crear(datos());
    const b = await destino.crear(datos());
    expect([a.identificador, b.identificador]).toEqual(["PRUEBA-1", "PRUEBA-1"]);
    expect(a.url).toBe("https://panel.test/super-admin/logs?incidencia=7");
    await destino.comentar(a.id, "x", 7);
    await destino.reabrir(a.id, null, 7);
    expect(filas.map((f) => f.operacion)).toEqual(["crear", "comentar", "reabrir"]);
  });
  it("prioridad por gravedad e impacto", () => {
    expect([prioridadLinear("critico", 1), prioridadLinear("error", 12), prioridadLinear("error", 2), prioridadLinear("aviso", 50)]).toEqual([1, 2, 3, 4]);
  });
});
