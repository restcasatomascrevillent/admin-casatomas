import { describe, expect, it } from "vitest";
import {
  actualizarTrabajo,
  cancelarTrabajo,
  contenidoNotificacion,
  encolarTrabajo,
  MAX_TERMINADOS,
  recortarTerminados,
  reintentarTrabajo,
  rutaPlatoEnPanel,
  siguienteTrabajo,
  textoIndicador,
  trabajoDePlato,
  trabajosActivos,
  trabajoCambioFondo,
  type NuevoTrabajoVideo,
  type TrabajoVideo,
} from "../video/colaVideos";

const archivo = new File(["x"], "IMG_1.MOV", { type: "video/quicktime" });
const nuevo = (platoId: string, nombre = `Plato ${platoId}`): NuevoTrabajoVideo => ({ platoId, nombre, archivo, tema: "arena", urlActual: null });

function cola(...pasos: Array<[string, string]>): TrabajoVideo[] {
  let l: TrabajoVideo[] = [];
  for (const [id, plato] of pasos) l = encolarTrabajo(l, nuevo(plato), id).lista;
  return l;
}

describe("encolar y orden", () => {
  it("entran esperando, en orden de llegada, y se procesa uno cada vez", () => {
    let l = cola(["t1", "a"], ["t2", "b"]);
    expect(l.map((t) => [t.id, t.estado])).toEqual([
      ["t1", "esperando"],
      ["t2", "esperando"],
    ]);
    expect(siguienteTrabajo(l)?.id).toBe("t1");
    l = actualizarTrabajo(l, "t1", { estado: "procesando" });
    expect(siguienteTrabajo(l)).toBeUndefined();
    l = actualizarTrabajo(l, "t1", { estado: "guardando" });
    expect(siguienteTrabajo(l)).toBeUndefined();
    l = actualizarTrabajo(l, "t1", { estado: "listo" });
    expect(siguienteTrabajo(l)?.id).toBe("t2");
  });
  it("un vídeo nuevo del mismo plato cancela el que tenía activo", () => {
    let l = cola(["t1", "a"]);
    l = actualizarTrabajo(l, "t1", { estado: "procesando" });
    const r = encolarTrabajo(l, nuevo("a"), "t2");
    expect(r.cancelados).toEqual(["t1"]);
    expect(r.lista.find((t) => t.id === "t1")?.estado).toBe("cancelado");
    expect(siguienteTrabajo(r.lista)?.id).toBe("t2");
  });
  it("no cancela los terminados del mismo plato", () => {
    let l = cola(["t1", "a"]);
    l = actualizarTrabajo(l, "t1", { estado: "listo" });
    expect(encolarTrabajo(l, nuevo("a"), "t2").cancelados).toEqual([]);
  });
});

describe("cancelar y reintentar", () => {
  it("cancelar solo afecta a activos; el siguiente pasa", () => {
    let l = cola(["t1", "a"], ["t2", "b"]);
    l = actualizarTrabajo(l, "t1", { estado: "procesando" });
    l = cancelarTrabajo(l, "t1");
    expect(l[0].estado).toBe("cancelado");
    expect(siguienteTrabajo(l)?.id).toBe("t2");
    l = actualizarTrabajo(l, "t2", { estado: "listo" });
    expect(cancelarTrabajo(l, "t2")[1].estado).toBe("listo");
  });
  it("reintentar un fallo lo vuelve a poner esperando y limpia el mensaje", () => {
    let l = cola(["t1", "a"]);
    l = actualizarTrabajo(l, "t1", { estado: "fallo", mensaje: "x", seOculto: true });
    l = reintentarTrabajo(l, "t1");
    expect(l[0]).toMatchObject({ estado: "esperando", mensaje: undefined, seOculto: false });
    expect(siguienteTrabajo(l)?.id).toBe("t1");
  });
  it("reintentar algo que no falló no hace nada", () => {
    const l = cola(["t1", "a"]);
    expect(reintentarTrabajo(l, "t1")).toEqual(l);
  });
});

describe("trabajoDePlato / activos / recorte", () => {
  it("el más reciente no cancelado del plato", () => {
    let l = cola(["t1", "a"], ["t2", "b"]);
    l = actualizarTrabajo(l, "t1", { estado: "listo" });
    l = encolarTrabajo(l, nuevo("a"), "t3").lista;
    l = cancelarTrabajo(l, "t3");
    expect(trabajoDePlato(l, "a")?.id).toBe("t1");
    expect(trabajoDePlato(l, "z")).toBeUndefined();
    expect(trabajosActivos(l).map((t) => t.id)).toEqual(["t2"]);
  });
  it("conserva como mucho MAX_TERMINADOS terminados y nunca quita activos", () => {
    let l: TrabajoVideo[] = [];
    for (let i = 0; i < MAX_TERMINADOS + 5; i++) {
      l = encolarTrabajo(l, nuevo(`p${i}`), `t${i}`).lista;
      l = actualizarTrabajo(l, `t${i}`, { estado: "listo" });
    }
    l = encolarTrabajo(l, nuevo("activo"), "ta").lista;
    l = recortarTerminados(l);
    expect(l.filter((t) => t.estado === "listo")).toHaveLength(MAX_TERMINADOS);
    expect(l.some((t) => t.id === "ta")).toBe(true);
    expect(l.some((t) => t.id === "t0")).toBe(false);
  });
});

describe("textos", () => {
  const base = cola(["t1", "a"])[0];
  const t = { ...base, nombre: "Arroz meloso" };
  it("indicador: «Vídeo de Arroz meloso 23/48»", () => {
    expect(textoIndicador({ ...t, estado: "procesando", progreso: { fase: "componiendo", hecho: 23, total: 48 } })).toBe("Vídeo de Arroz meloso 23/48");
    expect(textoIndicador({ ...t, estado: "procesando", progreso: { fase: "recortando", hecho: 3, total: 12, restanteMs: 1 } })).toBe(
      "Vídeo de Arroz meloso 3/12",
    );
    expect(textoIndicador({ ...t, estado: "procesando", progreso: { fase: "convirtiendo", pct: 40 } })).toBe("Vídeo de Arroz meloso: convirtiendo 40 %");
    expect(textoIndicador({ ...t, estado: "procesando", progreso: null })).toBe("Vídeo de Arroz meloso: preparando");
    expect(textoIndicador({ ...t, estado: "esperando" })).toBe("Vídeo de Arroz meloso: en cola");
    expect(textoIndicador({ ...t, estado: "guardando" })).toBe("Vídeo de Arroz meloso: guardando");
  });
  it("ruta del plato en el panel", () => {
    expect(rutaPlatoEnPanel("ab c")).toBe("/gestion-web?tab=carta&plato=ab%20c");
  });
  it("notificación de listo y de fallo", () => {
    expect(contenidoNotificacion("Arroz meloso", "listo").titulo).toBe("Vídeo listo: Arroz meloso");
    const f = contenidoNotificacion("Arroz meloso", "fallo", "Este vídeo está en HEVC.");
    expect(f.titulo).toBe("No se pudo generar el vídeo: Arroz meloso");
    expect(f.cuerpo).toBe("Este vídeo está en HEVC. Toca para reintentarlo.");
  });
});

describe("trabajoCambioFondo", () => {
  const base = { platoId: "p1", nombre: "Arroz", tema: "carbon" as const, urlActual: "https://x/p1-video.mp4?t=1&fondo=arena" };

  it("con el archivo de esta sesión en memoria lo reutiliza (sin descargar ni volver a subir)", () => {
    expect(trabajoCambioFondo({ ...base, previo: { archivo }, original: "videos-originales/p1.mov" })).toEqual({
      ...base,
      archivo,
      guardarOriginal: false,
    });
  });

  it("si el original no llegó a guardarse, lo vuelve a intentar con el archivo en memoria", () => {
    expect(trabajoCambioFondo({ ...base, previo: { archivo }, original: false })?.guardarOriginal).toBe(true);
  });

  it("sin archivo: rehace desde el original guardado", () => {
    expect(trabajoCambioFondo({ ...base, original: "videos-originales/p1.mov" })).toEqual({
      ...base,
      rutaOriginal: "videos-originales/p1.mov",
      guardarOriginal: false,
    });
    expect(trabajoCambioFondo({ ...base, previo: { rutaOriginal: "videos-originales/p1.mp4" }, original: null })?.rutaOriginal).toBe(
      "videos-originales/p1.mp4",
    );
  });

  it("vídeo antiguo sin original: null", () => {
    expect(trabajoCambioFondo({ ...base, original: false })).toBeNull();
    expect(trabajoCambioFondo({ ...base, previo: null, original: null })).toBeNull();
  });

  it("el trabajo de cambio de fondo entra en la cola como cualquier otro y sustituye al activo del plato", () => {
    const n = trabajoCambioFondo({ ...base, original: "videos-originales/p1.mov" })!;
    const r = encolarTrabajo(cola(["t1", "p1"]), n, "t2");
    expect(r.cancelados).toEqual(["t1"]);
    expect(siguienteTrabajo(r.lista)).toMatchObject({ id: "t2", rutaOriginal: "videos-originales/p1.mov", tema: "carbon" });
  });
});
