/**
 * Destino de Linear contra un servidor GraphQL simulado que se comporta como
 * Linear (ids únicos, 429, 5xx, clave rechazada) y destino de pruebas.
 */
import { describe, expect, it, vi } from "vitest";
import {
  clasificarErrorLinear, crearDestinoLinear, crearDestinoPrueba, ErrorLinear, estadoParaReabrir, MENSAJES_LINEAR, prioridadLinear, probarConexion, QUERIES_CONEXION,
  type DatosCrear, type RepoPrueba,
} from "../linear";

const ESTADOS = [
  { id: "st-triage", name: "Triage", type: "triage", position: 0 },
  { id: "st-backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "st-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "st-todo-0", name: "Por hacer", type: "unstarted", position: 0 },
  { id: "st-curso", name: "En curso", type: "started", position: 0 },
  { id: "st-hecho", name: "Done", type: "completed", position: 0 },
  { id: "st-cancel", name: "Canceled", type: "canceled", position: 0 },
];

/** Linear simulado: guarda issues por id y rechaza un id repetido como hace la API. */
function linearSimulado(opciones: { fallos?: Array<"429" | "500" | "red" | "perder_respuesta">; clave?: string; estiloAuth?: "401" | "400" } = {}) {
  const issues = new Map<string, { id: string; identifier: string; url: string; state: { name: string; type: string }; comentarios: string[] }>();
  const fallos = [...(opciones.fallos ?? [])];
  let n = 0;
  const llamadas: Array<{ query: string; variables: Record<string, unknown>; auth: string | null }> = [];
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body));
    const auth = new Headers(init?.headers).get("authorization");
    llamadas.push({ query, variables, auth });
    if (auth !== (opciones.clave ?? "lin_api_prueba")) {
      // Linear de verdad: 400 con AUTHENTICATION_ERROR (no 401).
      if (opciones.estiloAuth === "400") {
        return new Response(JSON.stringify({ errors: [{ message: "Authentication required, not authenticated", extensions: { type: "authentication error", code: "AUTHENTICATION_ERROR", userPresentableMessage: "Authentication required, not authenticated." } }] }), { status: 400 });
      }
      return new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), { status: 401 });
    }
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
      const st = ESTADOS.find((e) => e.id === (variables.input as { stateId: string }).stateId) ?? { name: "?", type: "unstarted" };
      if (i) i.state = { name: st.name, type: st.type };
      return json({ issueUpdate: { success: Boolean(i) } });
    }
    if (query.includes("issue(id")) {
      const i = issues.get(String(variables.id));
      if (!i) return new Response(JSON.stringify({ errors: [{ message: "Entity not found: Issue", extensions: { code: "INVALID_INPUT" } }] }), { status: 400 });
      return json({ issue: query.includes("team {") ? { ...i, team: { states: { nodes: ESTADOS } } } : i });
    }
    if (query.includes("ProbarConexionCuenta")) {
      return json({
        viewer: { name: "Tomás" },
        organization: { name: "Casa Tomás", urlKey: "casatomas" },
        teams: { nodes: [{ id: "eq-web", name: "Web", key: "WEB" }, { id: "eq-alm", name: "Almacén", key: "ALM" }] },
      });
    }
    if (query.includes("ProbarConexionEstados")) {
      return json({ workflowStates: { nodes: ESTADOS.map((e) => ({ ...e, team: { id: "eq-web" } })) } });
    }
    if (query.includes("ProbarConexionProyectos")) {
      return json({ projects: { nodes: [
        { id: "pr-1", name: "Logs", completedAt: null, canceledAt: null, teams: { nodes: [{ id: "eq-web" }] } },
        { id: "pr-viejo", name: "Antiguo", completedAt: "2026-01-01", canceledAt: null, teams: { nodes: [{ id: "eq-web" }] } },
      ] } });
    }
    if (query.includes("ProbarConexionEtiquetas")) {
      return json({ issueLabels: { nodes: [
        { id: "et-bug", name: "Bug", team: null },
        { id: "et-web", name: "Web", team: { id: "eq-web" } },
        { id: "et-alm", name: "Stock", team: { id: "eq-alm" } },
      ] } });
    }
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
    expect(e.codigo).toBe("clave");
  });
  it("clave rechazada como la rechaza Linear (400 + AUTHENTICATION_ERROR): mensaje en español con qué hacer", async () => {
    const l = linearSimulado({ clave: "otra", estiloAuth: "400" });
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    const e = await destino.crear(datos()).catch((x) => x);
    expect(e).toMatchObject({ codigo: "clave", reintentable: false });
    expect(e.message).toMatch(/no acepta la clave/);
    expect(e.message).toMatch(/Personal API keys/);
    expect(l.fetchFn).toHaveBeenCalledTimes(1); // sin reintentos inútiles
  });
  it("sin equipo no llama a Linear", async () => {
    const l = linearSimulado();
    await expect(crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn }).crear(datos({ equipoId: null }))).rejects.toThrow(/equipo/);
    expect(l.fetchFn).not.toHaveBeenCalled();
  });
  it("comenta, reabre un ticket cerrado al estado elegido y consulta el estado", async () => {
    const l = linearSimulado();
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    const t = await destino.crear(datos());
    l.issues.get(t.id)!.state = { name: "Done", type: "completed" };
    await destino.comentar(t.id, "Reaparecida", 7);
    expect(await destino.reabrir(t.id, "st-curso", 7)).toBe("En curso");
    expect(l.issues.get(t.id)?.comentarios).toEqual(["Reaparecida"]);
    expect((await destino.consultar(t.id))?.estadoTipo).toBe("started");
  });
  it("sin estado elegido, reabre al primer «por hacer» del equipo", async () => {
    const l = linearSimulado();
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    const t = await destino.crear(datos());
    l.issues.get(t.id)!.state = { name: "Canceled", type: "canceled" };
    expect(await destino.reabrir(t.id, null, 7)).toBe("Por hacer");
    expect(l.issues.get(t.id)?.state).toEqual({ name: "Por hacer", type: "unstarted" });
  });
  it("si el ticket sigue abierto en Linear no lo mueve (no lo devuelve de «En curso» a «Por hacer»)", async () => {
    const l = linearSimulado();
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    const t = await destino.crear(datos());
    l.issues.get(t.id)!.state = { name: "En curso", type: "started" };
    expect(await destino.reabrir(t.id, "st-todo", 7)).toBeNull();
    expect(l.issues.get(t.id)?.state.type).toBe("started");
    expect(l.llamadas.some((x) => x.query.includes("issueUpdate"))).toBe(false);
  });
  it("ticket borrado en Linear: consultar devuelve null y reabrir da un error «no encontrado» legible", async () => {
    const l = linearSimulado();
    const destino = crearDestinoLinear({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    expect(await destino.consultar("no-existe")).toBeNull();
    await expect(destino.reabrir("no-existe", null, 7)).rejects.toMatchObject({ codigo: "no_encontrado" });
  });
});

describe("errores de Linear legibles", () => {
  it("cada fallo dice qué pasa y si se reintenta", () => {
    expect(clasificarErrorLinear(429, [{ message: "x", extensions: { code: "RATELIMITED" } }])).toMatchObject({ codigo: "limite", reintentable: true });
    expect(clasificarErrorLinear(400, [{ message: "Rate limit exceeded" }])).toMatchObject({ codigo: "limite", reintentable: true });
    expect(clasificarErrorLinear(400, [{ message: "Forbidden", extensions: { code: "FORBIDDEN" } }])).toMatchObject({ codigo: "permiso", reintentable: false });
    expect(clasificarErrorLinear(503, [], "upstream")).toMatchObject({ codigo: "caido", reintentable: true });
    expect(clasificarErrorLinear(400, [{ message: "Argument Validation Error", extensions: { userPresentableMessage: "teamId must be a UUID" } }]).message)
      .toBe("Linear rechaza la petición: teamId must be a UUID");
  });
  it("estado para reabrir: primero «por hacer» (el de menor posición), luego pendiente o triaje", () => {
    expect(estadoParaReabrir(ESTADOS)).toEqual({ id: "st-todo-0", name: "Por hacer" });
    expect(estadoParaReabrir(ESTADOS.filter((e) => e.type !== "unstarted"))).toEqual({ id: "st-backlog", name: "Backlog" });
    expect(estadoParaReabrir([])).toBeNull();
  });
});

describe("probar la conexión (botón del panel)", () => {
  it("ninguna consulta supera el límite de complejidad de Linear (10.000; la anterior daba 21.482)", () => {
    // Estimación como la de Linear: cada campo cuenta 1 multiplicado por el `first` de las conexiones que lo contienen.
    const complejidad = (q: string) => {
      const pila: number[] = [1];
      let total = 0;
      let pendiente = 1;
      for (const tok of q.replace(/query \w+/, "").match(/first:\s*\d+|\{|\}|[A-Za-z_]\w*/g) ?? []) {
        if (tok.startsWith("first")) pendiente = Number(tok.split(":")[1]);
        else if (tok === "{") { pila.push(pila[pila.length - 1] * pendiente); pendiente = 1; }
        else if (tok === "}") pila.pop();
        else if (tok !== "nodes") total += pila[pila.length - 1];
      }
      return total;
    };
    for (const [nombre, q] of Object.entries(QUERIES_CONEXION)) {
      expect(complejidad(q), nombre).toBeLessThan(5000);
    }
  });
  it("sin clave: lo dice en español con los pasos y no llama a Linear", async () => {
    const l = linearSimulado();
    const r = await probarConexion({ apiKey: "", fetchFn: l.fetchFn });
    expect(r).toMatchObject({ ok: false, estado: "sin_clave", mensaje: MENSAJES_LINEAR.sinClave });
    expect(r.mensaje).toMatch(/^Falta la clave de Linear/);
    expect(l.fetchFn).not.toHaveBeenCalled();
  });
  it("clave mala: «clave_mal» con qué hacer (también con el 400 de Linear)", async () => {
    for (const estiloAuth of ["401", "400"] as const) {
      const l = linearSimulado({ clave: "otra", estiloAuth });
      const r = await probarConexion({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
      expect(r).toMatchObject({ ok: false, estado: "clave_mal" });
      expect(r.mensaje).toMatch(/no acepta la clave/);
    }
  });
  it("Linear caído: «sin_respuesta», sin quedarse colgado", async () => {
    const l = linearSimulado({ fallos: ["red", "red", "red"] });
    const r = await probarConexion({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    expect(r).toMatchObject({ ok: false, estado: "sin_respuesta" });
    expect(r.mensaje).toMatch(/Prueba otra vez/);
  });
  it("clave buena: espacio, equipos con proyectos abiertos, estados y etiquetas del equipo y del espacio", async () => {
    const l = linearSimulado();
    const r = await probarConexion({ apiKey: "lin_api_prueba", fetchFn: l.fetchFn, esperar: sinEspera });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.espacio).toEqual({ nombre: "Casa Tomás", urlKey: "casatomas" });
    expect(r.usuario).toBe("Tomás");
    expect(r.mensaje).toMatch(/Conectado con Linear \(«Casa Tomás»\)/);
    expect(r.equipos.map((e) => e.nombre)).toEqual(["Almacén", "Web"]);
    const web = r.equipos.find((e) => e.id === "eq-web")!;
    expect(web.proyectos).toEqual([{ id: "pr-1", nombre: "Logs" }]);
    expect(web.etiquetas.map((e) => e.id)).toEqual(["et-bug", "et-web"]);
    expect(web.estadoReabrirPorDefecto).toEqual({ id: "st-todo-0", nombre: "Por hacer" });
    expect(web.estados[0]).toMatchObject({ tipo: expect.any(String), nombre: expect.any(String) });
    // La clave solo viaja en la cabecera hacia Linear: nunca en la respuesta.
    expect(JSON.stringify(r)).not.toContain("lin_api_prueba");
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
