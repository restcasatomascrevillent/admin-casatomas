import { describe, expect, it, vi } from "vitest";
import { decidirAccion, huellaTapas, semanaDe, type AccionStoryTapas } from "@/lib/instagram/tapas";
import { TAPAS_EJEMPLO } from "@/lib/instagram";
import { asegurarStoryTapas, publicarAhoraAviso, storyTapasManual, type AjustesStoryTapas, type DepsStoryTapas, type FilaCompleta } from "../storyTapas";

/**
 * Servidor simulado: una fila por semana con la MISMA regla que la RPC
 * (decidirAccion), programaciones y publicaciones contadas.
 */
function simulado(opciones: { ajustes?: AjustesStoryTapas | null; web?: boolean; ahora?: string; turnos?: string | null } = {}) {
  const filas = new Map<string, FilaCompleta>();
  const programaciones = new Map<string, { piezaId: string; para: string; estado: "programada" | "cancelada" }>();
  let nPieza = 0;
  let nProg = 0;
  const ahora = new Date(opciones.ahora ?? "2026-11-10T09:00:00Z");
  const publicadas: string[] = [];
  const renders: Array<{ pieza: Record<string, unknown>; piezaId: string | null }> = [];
  const deps: DepsStoryTapas = {
    leerAjustes: async () => (opciones.ajustes === undefined ? { activa: true, hora: "12:00", plantilla: "ct-tapas", foto: null } : opciones.ajustes),
    tapasEnLaWeb: async () => opciones.web ?? true,
    turnos: async () => (opciones.turnos === undefined ? "20:30 y 22:00" : opciones.turnos),
    reclamar: async (fecha, huella, manual) => {
      const semana = semanaDe(fecha);
      const f = filas.get(semana) ?? null;
      const accion: AccionStoryTapas = decidirAccion(f, huella, { manual, ahora });
      const fila: FilaCompleta = f ?? { semana, estado: "preparando", huella: null, pieza_id: null, programacion_id: null, fecha_tapas: fecha, programada_para: null };
      filas.set(semana, fila);
      return { accion, fila: { ...fila } };
    },
    prepararFoto: async () => null,
    renderizar: vi.fn(async (pieza: Record<string, unknown>, piezaId: string | null) => {
      renders.push({ pieza, piezaId });
      return { id: piezaId ?? `pieza-${++nPieza}` };
    }),
    cancelarProgramacion: vi.fn(async (id: string) => {
      const p = programaciones.get(id);
      if (p) p.estado = "cancelada";
    }),
    programar: vi.fn(async (piezaId: string, instante: Date) => {
      const id = `prog-${++nProg}`;
      programaciones.set(id, { piezaId, para: instante.toISOString(), estado: "programada" });
      return { id, programadaPara: instante.toISOString() };
    }),
    registrar: async (semana, piezaId, programacionId, huella) => {
      const f = filas.get(semana)!;
      const nueva: FilaCompleta = {
        ...f,
        pieza_id: piezaId,
        programacion_id: programacionId,
        huella,
        estado: programacionId ? "programada" : "preparando",
        programada_para: programacionId ? programaciones.get(programacionId)!.para : null,
      };
      filas.set(semana, nueva);
      return nueva;
    },
    fallo: async (semana, error) => {
      const f = filas.get(semana);
      if (f) filas.set(semana, { ...f, estado: "error", error });
    },
    publicar: vi.fn(async (piezaId: string) => {
      publicadas.push(piezaId);
      for (const [s, f] of filas) if (f.pieza_id === piezaId) filas.set(s, { ...f, estado: "publicada" });
      return { estado: "publicada", permalink: "https://instagram.com/stories/x", contenedorId: null };
    }),
    ahora: () => ahora,
  };
  return { deps, filas, programaciones, publicadas, renders };
}

describe("story del jueves de tapas: automático", () => {
  it("crea la story y la programa el jueves a las 12:00 de Madrid", async () => {
    const s = simulado();
    const r = await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    expect(r).toMatchObject({ estado: "programada", regenerada: false, programadaPara: "2026-11-12T11:00:00.000Z" });
    expect(s.renders[0].pieza).toMatchObject({ plantilla: "ct-tapas", formato: "story", titular: "Jueves", cita: "12 de noviembre", pie: "Turnos 20:30 y 22:00" });
    expect(s.filas.get("2026-11-09")?.estado).toBe("programada");
  });

  it("si ya ha pasado la hora, en 15 minutos", async () => {
    const s = simulado({ ahora: "2026-11-12T12:30:00Z" });
    const r = await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    expect(r).toMatchObject({ estado: "programada", programadaPara: "2026-11-12T12:45:00.000Z" });
  });

  it("guardar otra vez las mismas tapas no hace nada; con otras, regenera la MISMA pieza a la misma hora", async () => {
    const s = simulado();
    await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    expect((await asegurarStoryTapas({ fecha: "2026-11-12", tapas: [...TAPAS_EJEMPLO] }, s.deps)).estado).toBe("nada");
    expect(s.deps.renderizar).toHaveBeenCalledTimes(1);

    const r = await asegurarStoryTapas({ fecha: "2026-11-12", tapas: [...TAPAS_EJEMPLO.slice(0, 6), "Patatas bravas"] }, s.deps);
    expect(r).toMatchObject({ estado: "programada", regenerada: true, programadaPara: "2026-11-12T11:00:00.000Z" });
    expect(s.deps.cancelarProgramacion).toHaveBeenCalledWith("prog-1");
    expect(s.renders[1].piezaId).toBe("pieza-1");
    expect(s.renders[1].pieza.lista).toContainEqual({ etiqueta: "Patatas bravas" });
    expect([...s.programaciones.values()].filter((p) => p.estado === "programada")).toHaveLength(1);
    expect(s.filas.get("2026-11-09")?.huella).toBe(huellaTapas("2026-11-12", [...TAPAS_EJEMPLO.slice(0, 6), "Patatas bravas"]));
  });

  it("si la hora se cambió a mano, la regeneración la respeta", async () => {
    const s = simulado();
    await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    const f = s.filas.get("2026-11-09")!;
    s.filas.set("2026-11-09", { ...f, programada_para: "2026-11-12T17:30:00.000Z" });
    const r = await asegurarStoryTapas({ fecha: "2026-11-12", tapas: ["Gambón rebozado", "Bravas", "Croquetas", "Tarta"] }, s.deps);
    expect(r).toMatchObject({ estado: "programada", programadaPara: "2026-11-12T17:30:00.000Z" });
  });

  it("una por semana: publicada, nunca otra (ni en automático ni a mano)", async () => {
    const s = simulado();
    await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    const f = s.filas.get("2026-11-09")!;
    s.filas.set("2026-11-09", { ...f, estado: "publicada" });
    expect(await asegurarStoryTapas({ fecha: "2026-11-12", tapas: ["Otra cosa", "Más", "Y más", "Fin"] }, s.deps)).toMatchObject({ estado: "nada", motivo: "publicada" });
    const manual = await storyTapasManual({ fecha: "2026-11-12", tapas: ["Otra"], plantilla: "ct-tapas", foto: null, turnos: null, programarPara: null }, s.deps);
    expect(manual).toMatchObject({ estado: "nada", motivo: "publicada" });
    expect(s.publicadas).toEqual([]);
    expect(s.deps.renderizar).toHaveBeenCalledTimes(1);
  });

  it("no hace nada si está apagada, sin Marketing, con «Tapas» apagado en la web o con el día pasado", async () => {
    expect(await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, simulado({ ajustes: { activa: false, hora: "12:00", plantilla: "ct-tapas", foto: null } }).deps)).toMatchObject({ motivo: "desactivada" });
    expect(await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, simulado({ ajustes: null }).deps)).toMatchObject({ motivo: "sin-permiso" });
    expect(await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, simulado({ web: false }).deps)).toMatchObject({ motivo: "web-apagada" });
    expect(await asegurarStoryTapas({ fecha: "2026-11-05", tapas: TAPAS_EJEMPLO }, simulado().deps)).toMatchObject({ motivo: "pasada" });
  });

  it("si el render falla, suelta la semana con el error (y la siguiente vez se reintenta)", async () => {
    const s = simulado();
    (s.deps.renderizar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Render caído"));
    const r = await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    expect(r).toMatchObject({ estado: "error" });
    expect(s.filas.get("2026-11-09")).toMatchObject({ estado: "error", error: "Render caído" });
    expect((await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps)).estado).toBe("programada");
  });

  it("la clásica no lleva fecha ni turnos", async () => {
    const s = simulado({ ajustes: { activa: true, hora: "12:00", plantilla: "ct-tapas-clasica", foto: "drive:abc" } });
    await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    expect(s.renders[0].pieza).toMatchObject({ plantilla: "ct-tapas-clasica", foto: "drive:abc" });
    expect(s.renders[0].pieza).not.toHaveProperty("cita");
    expect(s.renders[0].pieza).not.toHaveProperty("pie");
  });
});

describe("story del jueves de tapas: manual y aviso", () => {
  it("«Publicar ahora» desde el editor: genera, registra y publica una vez", async () => {
    const s = simulado();
    const r = await storyTapasManual({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO, plantilla: "ct-tapas", foto: null, turnos: null, programarPara: null }, s.deps);
    expect(r).toMatchObject({ estado: "publicada", piezaId: "pieza-1" });
    expect(s.publicadas).toEqual(["pieza-1"]);
    // Ya publicada: el automático no la vuelve a crear.
    expect((await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps)).estado).toBe("nada");
  });

  it("«Publicar ahora» del aviso cancela la programación antes de publicar", async () => {
    const s = simulado();
    await asegurarStoryTapas({ fecha: "2026-11-12", tapas: TAPAS_EJEMPLO }, s.deps);
    const r = await publicarAhoraAviso({ piezaId: "pieza-1", programacionId: "prog-1" }, s.deps);
    expect(r.estado).toBe("publicada");
    expect(s.programaciones.get("prog-1")?.estado).toBe("cancelada");
    expect(s.publicadas).toEqual(["pieza-1"]);
  });
});
