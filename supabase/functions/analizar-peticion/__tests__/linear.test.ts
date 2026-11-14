// analizar-peticion / linear.ts · «Enviar a Linear»: prioridad, id determinista, descripción en castellano
// (sin emails), etiqueta del tipo solo si existe y el envío contra un Linear simulado (crear, reintento sin
// duplicar, modos, sin equipo, sin clave, errores legibles).
import { describe, expect, it, vi } from "vitest";
import {
  cuerpoLinear,
  enviarPeticionALinear,
  etiquetaDeTipo,
  MENSAJES_ENVIO,
  nombreParaLinear,
  prioridadLinearDePeticion,
  urlTicketPanel,
  uuidLinearDePeticion,
  type ConfigLinearPeticiones,
  type DepsEnvioLinear,
  type PeticionParaLinear,
} from "../linear";
import { MENSAJES_LINEAR } from "../../procesar-logs-web/linear";

const ANALISIS = {
  resumen: "Que al guardar una reserva desde la tablet se guarde.",
  tipo: "error",
  tarea_propuesta: "Revisar el botón Guardar del formulario de reservas.",
  pasos: ["Reproducir en tablet", "Corregir el guardado"],
  modulos_afectados: ["Reservas"],
  repo: "panel",
  riesgo: { nivel: "alto", motivo: "Afecta a reservas de clientes." },
  toca_bd: false,
  criterios_aceptacion: ["La reserva aparece en la lista"],
  preguntas: ["¿Pasa con todas las reservas?"],
  prompt_ia: "## Contexto\nPanel.\n\n```ts\nconst a = 1;\n```\n\n## Reglas del repositorio\n- PR a staging",
};

const PETICION: PeticionParaLinear = {
  id: "11111111-2222-4333-8444-555555555555",
  titulo: "No se guarda la reserva",
  prioridad: "alta",
  modulo: "reservas",
  descripcion: "Al pulsar Guardar no pasa nada.\nSe queda la pantalla igual.",
  ruta: "/reservas?tab=hoy&id=9",
  dispositivo: "Mozilla/5.0 (iPad)",
  captura_path: null,
  creado_por_nombre: "Ana Sala",
  created_at: "2026-11-13T10:00:00Z",
  estado: "en_analisis",
  analisis: ANALISIS,
  analisis_estado: "hecho",
  linear_id: null,
  linear_url: null,
};

const CONFIG: ConfigLinearPeticiones = { linear_modo: "real", linear_equipo_id: "eq-cas", linear_proyecto_id: "pr-1", linear_etiquetas: ["et-panel"] };

const ETIQUETAS = [
  { id: "et-bug", name: "Bug", isGroup: false, team: null },
  { id: "et-improvement", name: "Improvement", isGroup: false, team: null },
  { id: "et-otro-equipo", name: "Question", isGroup: false, team: { id: "eq-otro" } },
  { id: "et-panel", name: "Panel", isGroup: false, team: { id: "eq-cas" } },
];

/** Linear simulado: ids únicos (rechaza uno repetido como la API), etiquetas y fallos a demanda. */
function linearSimulado(o: { fallos?: Array<"perder_respuesta" | "500" | "etiqueta_rechazada" | "proyecto_rechazado">; etiquetas?: typeof ETIQUETAS; sinIdentificador?: boolean } = {}) {
  const issues = new Map<string, Record<string, unknown>>();
  const fallos = [...(o.fallos ?? [])];
  const creaciones: Array<Record<string, unknown>> = [];
  let n = 11;
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body));
    if (new Headers(init?.headers).get("authorization") !== "lin_api_prueba") {
      return new Response(JSON.stringify({ errors: [{ message: "Authentication required, not authenticated", extensions: { code: "AUTHENTICATION_ERROR" } }] }), { status: 400 });
    }
    const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
    if (query.includes("EtiquetasTicketPanel")) return json({ issueLabels: { nodes: o.etiquetas ?? ETIQUETAS } });
    if (query.includes("issueCreate")) {
      const input = variables.input as Record<string, unknown>;
      creaciones.push(input);
      const fallo = fallos.shift();
      if (fallo === "500") return new Response("upstream", { status: 500 });
      if (fallo === "etiqueta_rechazada" && (input.labelIds as string[] | undefined)?.includes("et-bug")) {
        return new Response(JSON.stringify({ errors: [{ message: "Argument Validation Error", extensions: { userPresentableMessage: "Labels from the same group are mutually exclusive." } }] }), { status: 400 });
      }
      if (fallo === "proyecto_rechazado") {
        return new Response(JSON.stringify({ errors: [{ message: "Argument Validation Error", extensions: { userPresentableMessage: "Project does not belong to the team." } }] }), { status: 400 });
      }
      const id = String(input.id);
      if (issues.has(id)) return new Response(JSON.stringify({ errors: [{ message: "Entity already exists" }] }), { status: 400 });
      n++;
      const issue = { id, identifier: o.sinIdentificador ? null : `CAS-${n}`, url: `https://linear.app/casa-tomas/issue/CAS-${n}/no-se-guarda`, state: { name: "Todo", type: "unstarted" } };
      issues.set(id, issue);
      if (fallo === "perder_respuesta") return new Response("gateway timeout", { status: 504 });
      return json({ issueCreate: { success: true, issue } });
    }
    if (query.includes("issue(id")) {
      const i = issues.get(String(variables.id));
      if (!i) return new Response(JSON.stringify({ errors: [{ message: "Entity not found: Issue" }] }), { status: 400 });
      return json({ issue: i });
    }
    return new Response(JSON.stringify({ errors: [{ message: `consulta no simulada: ${query.slice(0, 40)}` }] }), { status: 400 });
  });
  return { fetchFn, issues, creaciones };
}

function deps(o: Partial<DepsEnvioLinear> & { config?: ConfigLinearPeticiones | null; linear?: ReturnType<typeof linearSimulado> } = {}) {
  const guardado: Array<{ linear_id: string; linear_url: string }> = [];
  const prueba: Array<Record<string, unknown>> = [];
  const aceptar = vi.fn(async () => true);
  const linear = o.linear ?? linearSimulado();
  const d: DepsEnvioLinear = {
    leerConfig: async () => (o.config === undefined ? CONFIG : o.config),
    guardarEnviado: async (v) => { guardado.push(v); },
    aceptar,
    prueba: {
      async buscarCreado(uuid) {
        const i = prueba.findIndex((f) => f.linear_uuid === uuid && f.operacion === "crear");
        return i >= 0 ? { id: i + 1 } : null;
      },
      async insertar(f) {
        prueba.push(f);
        return { id: prueba.length };
      },
    },
    apiKey: "lin_api_prueba",
    urlPanel: "https://admin-casatomas-git-staging-casa-tomas.vercel.app/",
    fetchFn: linear.fetchFn,
    esperar: async () => {},
    ...o,
  };
  return { d, guardado, prueba, aceptar, linear };
}

describe("lo básico", () => {
  it("prioridad: urgente 1, alta 2, normal 3, baja 4 (y normal si no se conoce)", () => {
    expect(["urgente", "alta", "normal", "baja", "rara"].map(prioridadLinearDePeticion)).toEqual([1, 2, 3, 4, 3]);
  });

  it("id determinista: UUID v4, siempre el mismo para la misma petición y distinto entre peticiones", async () => {
    const a = await uuidLinearDePeticion(PETICION.id);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await uuidLinearDePeticion(PETICION.id.toUpperCase())).toBe(a);
    expect(a).not.toBe(PETICION.id);
    expect(await uuidLinearDePeticion("11111111-2222-4333-8444-555555555556")).not.toBe(a);
  });

  it("nunca un email como nombre de quien lo envió", () => {
    expect(nombreParaLinear("Ana Sala")).toBe("Ana Sala");
    expect(nombreParaLinear("ana@restaurante.es")).toBe("Un usuario del panel");
    expect(nombreParaLinear(null)).toBe("Un usuario del panel");
  });

  it("enlace de vuelta al ticket del panel", () => {
    expect(urlTicketPanel("https://panel.ejemplo/", "abc")).toBe("https://panel.ejemplo/super-admin/tickets?ticket=abc");
  });
});

describe("descripción de la incidencia", () => {
  const cuerpo = cuerpoLinear(PETICION, "https://panel.ejemplo/super-admin/tickets?ticket=x");

  it("en castellano, con todos los apartados y en orden", () => {
    const orden = ["## En pocas palabras", "**Enviado por:** Ana Sala", "## Lo que ha escrito", "## Tarea propuesta", "## Pasos", "## Criterios de aceptación", "## Riesgo", "## Preguntas para quien lo envió", "## Prompt para la IA", "[Ver el ticket en el panel](https://panel.ejemplo/super-admin/tickets?ticket=x)"];
    const posiciones = orden.map((t) => cuerpo.indexOf(t));
    expect(posiciones.every((p) => p >= 0)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    expect(cuerpo).toContain(ANALISIS.resumen);
    expect(cuerpo).toContain("**Módulo:** Reservas (desde `/reservas` · tablet)");
    expect(cuerpo).toContain("**Prioridad:** Alta · **Tipo:** Error · **Repositorio:** Panel (admin-casatomas)");
    expect(cuerpo).toContain("13/11/2026");
    expect(cuerpo).toContain("> Al pulsar Guardar no pasa nada.\n> Se queda la pantalla igual.");
    expect(cuerpo).toContain("1. Reproducir en tablet\n2. Corregir el guardado");
    expect(cuerpo).toContain("- [ ] La reserva aparece en la lista");
    expect(cuerpo).toContain("**Alto** · Afecta a reservas de clientes.");
  });

  it("sin parámetros de la página ni el user agent completo, ni emails", () => {
    const conEmail = cuerpoLinear({ ...PETICION, creado_por_nombre: "ana@restaurante.es" }, "https://p/x");
    expect(conEmail).not.toContain("@restaurante.es");
    expect(conEmail).toContain("Un usuario del panel");
    expect(cuerpo).not.toContain("id=9");
    expect(cuerpo).not.toContain("Mozilla");
  });

  it("el prompt va entero en un bloque de código que no se rompe con ``` dentro", () => {
    expect(cuerpo).toContain(`\`\`\`\`markdown\n${ANALISIS.prompt_ia}\n\`\`\`\``);
  });

  it("sin análisis: lo dice y manda lo que escribió y el enlace", () => {
    const c = cuerpoLinear({ ...PETICION, analisis: null, analisis_estado: "error", captura_path: "u/x.jpg" }, "https://p/x");
    expect(c).toContain("La IA no ha podido analizar este ticket");
    expect(c).toContain("> Al pulsar Guardar no pasa nada.");
    expect(c).toContain("Adjuntó una captura");
    expect(c).not.toContain("## Prompt para la IA");
    expect(c).toContain("[Ver el ticket en el panel](https://p/x)");
  });
});

describe("etiqueta del tipo", () => {
  it("Bug para un error, Improvement para una mejora; solo si existe, del equipo o de todo el espacio, nunca un grupo", () => {
    expect(etiquetaDeTipo("error", ETIQUETAS, "eq-cas")).toBe("et-bug");
    expect(etiquetaDeTipo("mejora", ETIQUETAS, "eq-cas")).toBe("et-improvement");
    expect(etiquetaDeTipo("duda", ETIQUETAS, "eq-cas")).toBeNull(); // «Question» es de otro equipo
    expect(etiquetaDeTipo("error", [{ id: "g", name: "Bug", isGroup: true, team: null }], "eq-cas")).toBeNull();
    expect(etiquetaDeTipo("mejora", [{ id: "f", name: "feature", team: null }], "eq-cas")).toBe("f");
    expect(etiquetaDeTipo("error", [{ id: "w", name: "Bug", team: null }, { id: "t", name: "Bug", team: { id: "eq-cas" } }], "eq-cas")).toBe("t");
    expect(etiquetaDeTipo(null, ETIQUETAS, "eq-cas")).toBeNull();
  });
});

describe("enviarPeticionALinear · modo real", () => {
  it("crea la incidencia (equipo, proyecto, prioridad, etiquetas, id determinista), guarda el enlace y la acepta", async () => {
    const { d, guardado, aceptar, linear } = deps();
    const r = await enviarPeticionALinear(PETICION, d);
    expect(r).toEqual({ ok: true, destino: "real", identificador: "CAS-12", url: "https://linear.app/casa-tomas/issue/CAS-12/no-se-guarda", repetido: false, aceptada: true });
    expect(linear.creaciones).toHaveLength(1);
    const input = linear.creaciones[0];
    expect(input).toMatchObject({ id: await uuidLinearDePeticion(PETICION.id), teamId: "eq-cas", projectId: "pr-1", title: "No se guarda la reserva", priority: 2, labelIds: ["et-panel", "et-bug"] });
    expect(String(input.description)).toContain("## Prompt para la IA");
    expect(String(input.description)).toContain("https://admin-casatomas-git-staging-casa-tomas.vercel.app/super-admin/tickets?ticket=11111111-2222-4333-8444-555555555555");
    expect(guardado).toEqual([{ linear_id: "CAS-12", linear_url: "https://linear.app/casa-tomas/issue/CAS-12/no-se-guarda" }]);
    expect(aceptar).toHaveBeenCalledTimes(1);
  });

  it("doble clic o reintento: la misma incidencia, nunca otra", async () => {
    const linear = linearSimulado();
    const a = deps({ linear });
    const b = deps({ linear });
    const [r1, r2] = await Promise.all([enviarPeticionALinear(PETICION, a.d), enviarPeticionALinear(PETICION, b.d)]);
    expect(linear.issues.size).toBe(1);
    expect(r1.ok && r2.ok && r1.identificador === r2.identificador).toBe(true);
    expect(b.guardado[0]).toEqual(a.guardado[0]);
  });

  it("si Linear la creó pero la respuesta se perdió, el reintento la recupera (sin duplicar)", async () => {
    const { d, linear, guardado } = deps({ linear: linearSimulado({ fallos: ["perder_respuesta"] }) });
    const r = await enviarPeticionALinear(PETICION, d);
    expect(r).toMatchObject({ ok: true, identificador: "CAS-12" });
    expect(linear.issues.size).toBe(1);
    expect(guardado).toHaveLength(1);
  });

  it("ya enviada: no vuelve a llamar a Linear", async () => {
    const { d, linear } = deps();
    const r = await enviarPeticionALinear({ ...PETICION, linear_id: "CAS-3", linear_url: "https://linear.app/x/issue/CAS-3" }, d);
    expect(r).toMatchObject({ ok: true, repetido: true, identificador: "CAS-3", url: "https://linear.app/x/issue/CAS-3" });
    expect(linear.fetchFn).not.toHaveBeenCalled();
  });

  it("una mejora lleva «Improvement»; si no hay etiqueta del tipo, solo las de la configuración", async () => {
    const mejora = deps();
    await enviarPeticionALinear({ ...PETICION, analisis: { ...ANALISIS, tipo: "mejora" } }, mejora.d);
    expect(mejora.linear.creaciones[0].labelIds).toEqual(["et-panel", "et-improvement"]);
    const sin = deps({ linear: linearSimulado({ etiquetas: [] }), config: { ...CONFIG, linear_etiquetas: [], linear_proyecto_id: null } });
    await enviarPeticionALinear(PETICION, sin.d);
    expect(sin.linear.creaciones[0].labelIds).toBeUndefined();
    expect(sin.linear.creaciones[0].projectId).toBeUndefined();
  });

  it("si Linear rechaza la etiqueta del tipo, la crea sin ella", async () => {
    const { d, linear } = deps({ linear: linearSimulado({ fallos: ["etiqueta_rechazada"] }) });
    const r = await enviarPeticionALinear(PETICION, d);
    expect(r.ok).toBe(true);
    expect(linear.creaciones.map((c) => c.labelIds)).toEqual([["et-panel", "et-bug"], ["et-panel"]]);
  });

  it("no la acepta si ya estaba aceptada o hecha (lo decide la BD) y el envío sigue valiendo", async () => {
    const { d } = deps({ aceptar: vi.fn(async () => false) });
    expect(await enviarPeticionALinear({ ...PETICION, estado: "hecha" }, d)).toMatchObject({ ok: true, aceptada: false });
  });

  it("sin equipo elegido → «Elige el equipo en Logs › Configuración › Linear», sin llamar a Linear", async () => {
    const { d, linear } = deps({ config: { ...CONFIG, linear_equipo_id: null } });
    expect(await enviarPeticionALinear(PETICION, d)).toEqual({ ok: false, status: 409, error: MENSAJES_ENVIO.sinEquipo });
    expect(MENSAJES_ENVIO.sinEquipo).toBe("Elige el equipo en Logs › Configuración › Linear.");
    expect(linear.fetchFn).not.toHaveBeenCalled();
  });

  it("sin LINEAR_API_KEY → dice dónde se crea la clave", async () => {
    const { d } = deps({ apiKey: "" });
    expect(await enviarPeticionALinear(PETICION, d)).toEqual({ ok: false, status: 503, error: MENSAJES_LINEAR.sinClave });
  });

  it("clave rechazada o proyecto que no es del equipo → frase legible, sin guardar nada", async () => {
    const mala = deps({ apiKey: "lin_api_mala" });
    expect(await enviarPeticionALinear(PETICION, mala.d)).toEqual({ ok: false, status: 502, error: MENSAJES_LINEAR.clave });
    expect(mala.guardado).toHaveLength(0);
    const proyecto = deps({ linear: linearSimulado({ fallos: ["proyecto_rechazado"] }), config: { ...CONFIG, linear_etiquetas: [] }, });
    const r = await enviarPeticionALinear({ ...PETICION, analisis: { ...ANALISIS, tipo: "duda" } }, proyecto.d);
    expect(r).toEqual({ ok: false, status: 502, error: "Linear rechaza la petición: Project does not belong to the team." });
  });

  it("Linear caído → lo dice y que se puede repetir sin duplicar", async () => {
    const { d } = deps({ linear: linearSimulado({ fallos: ["500", "500", "500"] }), config: { ...CONFIG, linear_etiquetas: [] } });
    const r = await enviarPeticionALinear({ ...PETICION, analisis: null, analisis_estado: "error" }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(502);
      expect(r.error).toMatch(/^Linear no responde ahora mismo/);
      expect(r.error).toContain("no se duplicará");
      expect(r.error).not.toContain("Se reintenta solo");
    }
  });

  it("si no se puede guardar el enlace, lo dice (y repetir no duplica)", async () => {
    const { d } = deps({ guardarEnviado: async () => { throw new Error("db"); } });
    const r = await enviarPeticionALinear(PETICION, d);
    expect(r).toEqual({ ok: false, status: 503, error: "Se ha creado en Linear (CAS-12), pero no se ha podido guardar en el ticket. Vuelve a pulsar «Enviar a Linear»: no se duplicará." });
  });
});

describe("enviarPeticionALinear · otros modos y casos", () => {
  it("desactivado (o sin configuración) → mensaje claro, sin llamar a Linear", async () => {
    for (const config of [{ ...CONFIG, linear_modo: "desactivado" }, null]) {
      const { d, linear } = deps({ config });
      expect(await enviarPeticionALinear(PETICION, d)).toEqual({ ok: false, status: 409, error: MENSAJES_ENVIO.desactivado });
      expect(linear.fetchFn).not.toHaveBeenCalled();
    }
  });

  it("prueba → al destino de pruebas, nunca a Linear; repetir da el mismo PRUEBA-n; no cambia el estado", async () => {
    const { d, linear, prueba, guardado, aceptar } = deps({ config: { ...CONFIG, linear_modo: "prueba", linear_equipo_id: null } });
    const r1 = await enviarPeticionALinear(PETICION, d);
    const r2 = await enviarPeticionALinear(PETICION, d);
    expect(r1).toEqual({ ok: true, destino: "prueba", identificador: "PRUEBA-1", url: null, repetido: false, aceptada: false });
    expect(r2).toMatchObject({ identificador: "PRUEBA-1" });
    expect(prueba).toHaveLength(1);
    expect(prueba[0]).toMatchObject({ incidencia_id: null, operacion: "crear", linear_uuid: await uuidLinearDePeticion(PETICION.id), titulo: "No se guarda la reserva", prioridad: 2, etiquetas: ["et-panel"] });
    expect(String(prueba[0].cuerpo)).toContain("## En pocas palabras");
    expect(linear.fetchFn).not.toHaveBeenCalled();
    expect(guardado).toHaveLength(0);
    expect(aceptar).not.toHaveBeenCalled();
  });

  it("mientras la IA analiza, o descartada → no se envía", async () => {
    const { d, linear } = deps();
    expect(await enviarPeticionALinear({ ...PETICION, analisis_estado: "analizando" }, d)).toEqual({ ok: false, status: 409, error: MENSAJES_ENVIO.analizando });
    expect(await enviarPeticionALinear({ ...PETICION, estado: "descartada" }, d)).toEqual({ ok: false, status: 409, error: MENSAJES_ENVIO.descartada });
    expect(linear.fetchFn).not.toHaveBeenCalled();
  });

  it("si no se puede leer la configuración → 503 legible", async () => {
    const { d } = deps({ leerConfig: async () => { throw new Error("permission denied"); } });
    expect(await enviarPeticionALinear(PETICION, d)).toEqual({ ok: false, status: 503, error: MENSAJES_ENVIO.sinConfig });
  });
});
