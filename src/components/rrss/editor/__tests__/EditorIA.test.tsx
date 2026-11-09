/**
 * Editor IA (RRSS › Subida de fotos): subida de archivos con validación y
 * progreso, destino/contenido/estilo, flujo «Generar con IA» (plan → motor),
 * edición básica sin IA, ajustes de una foto, textos y el interruptor creativo.
 * La capa de datos (`@/components/rrss/api`) va simulada; jsdom no pinta, así
 * que las comparaciones visuales se comprueban por los estilos que se aplican.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) }, storage: { from: () => ({}) } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/rrss/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/rrss/api")>();
  return {
    ...real,
    listarProyectos: vi.fn(),
    leerProyecto: vi.fn(),
    crearProyecto: vi.fn(),
    actualizarProyecto: vi.fn(),
    borrarProyecto: vi.fn(),
    listarArchivos: vi.fn(),
    subirArchivo: vi.fn(),
    analizarArchivo: vi.fn(),
    quitarArchivo: vi.fn(),
    ordenarArchivos: vi.fn(),
    generar: vi.fn(),
    leerUltimaGeneracion: vi.fn(),
    cancelarGeneracion: vi.fn(),
    listarResultados: vi.fn(),
    urlsFirmadas: vi.fn(),
    descargar: vi.fn(),
    proponerPlan: vi.fn(),
    proponerPieza: vi.fn(),
    proponerTextos: vi.fn(),
    transcribir: vi.fn(),
  };
});

import * as api from "@/components/rrss/api";
import { ErrorRrss, type Archivo, type Generacion, type Proyecto, type Resultado } from "@/components/rrss/api";
import { ESTILOS_IDS } from "@/lib/rrss/estilos";
import { piezaFotoNeutra, type PlanEdicion, type PiezaVideo } from "@/lib/rrss/plan";
import { toast } from "sonner";
import { EditorIA } from "../EditorIA";

vi.setConfig({ testTimeout: 30_000 });

const AHORA = "2026-11-08T10:00:00Z";
const proy = (o: Partial<Proyecto> = {}): Proyecto => ({
  id: "p1", marca: "casa-tomas", canal: "instagram", tipo: "publicacion", estilo: "elegante", instrucciones: "", permitir_creativo: false, origen: "editor", titulo: "Menú de San Valentín",
  plan: null, plan_ia: null, textos: {}, estado: "borrador", creado_por: null, created_at: AHORA, updated_at: AHORA, ...o,
});
const foto = (o: Partial<Archivo> = {}): Archivo => ({
  id: "a1", proyecto_id: "p1", tipo: "foto", ruta: "originales/p1/a1.jpg", nombre: "plato.jpg", mime: "image/jpeg", bytes: 2_000_000, ancho: 4000, alto: 3000, duracion_s: null, orden: 0, estado: "listo",
  analisis: { previa_ruta: "previas/p1/a1.jpg" }, error: null, created_at: AHORA, ...o,
});
const video = (o: Partial<Archivo> = {}): Archivo => foto({ id: "v1", tipo: "video", ruta: "originales/p1/v1.mp4", nombre: "arroz.mp4", mime: "video/mp4", duracion_s: 12, analisis: { previa_ruta: "previas/p1/v1.jpg", audio_ruta: "audio/p1/v1.m4a", tiene_audio: true }, ...o });
const gen = (o: Partial<Generacion> = {}): Generacion => ({ id: "g1", proyecto_id: "p1", medio: "foto", piezas: null, estado: "pendiente", progreso: {}, avisos: [], error: null, created_at: AHORA, updated_at: AHORA, terminado_at: null, ...o });
const resultadoFoto = (o: Partial<Resultado> = {}): Resultado => ({ id: "r1", proyecto_id: "p1", generacion_id: "g1", indice: 0, medio: "foto", ruta: "resultados/p1/g1/0.jpg", portada_ruta: null, ancho: 1080, alto: 1350, duracion_s: null, bytes: 1, receta: {}, avisos: [], vigente: true, created_at: AHORA, ...o });
const planFoto = (o: Partial<PlanEdicion> = {}): PlanEdicion => ({ version: 1, estilo: "elegante", resumen: "Foto del plato con luz cálida", preguntas: [], piezas: [piezaFotoNeutra("a1")], textos: { caption: "Cena de hoy", hashtags: ["#casatomas"], titular: "Cena" }, avisos: [], ...o });
const piezaVideo = (): PiezaVideo => ({
  tipo: "video", tomas: [{ archivo: "v1", medio: "video", inicio: 0, fin: 8, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: "ninguno", motivo: "" }], titulos: [], subtitulos: false, transicion: "fundido", duracionTransicion: 0.5,
  audio: "original", correccion: { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 }, cierre: { mostrar: false }, logo: false, nota: "",
});

const m = <T extends (...a: never[]) => unknown>(f: T) => vi.mocked(f);

function pintar(nodo: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{nodo}</QueryClientProvider>);
}

/** Datos del trabajo abierto. */
function trabajo(o: { proyecto?: Proyecto; archivos?: Archivo[]; generacion?: Generacion | null; resultados?: Resultado[] } = {}) {
  m(api.leerProyecto).mockResolvedValue(o.proyecto ?? proy());
  m(api.listarArchivos).mockResolvedValue(o.archivos ?? [foto()]);
  m(api.leerUltimaGeneracion).mockResolvedValue(o.generacion ?? null);
  m(api.listarResultados).mockResolvedValue(o.resultados ?? []);
}

const irAlPaso = async (n: number) => {
  fireEvent.click(await screen.findByTestId(`paso:${n}`));
};

beforeEach(() => {
  vi.resetAllMocks();
  m(api.listarProyectos).mockResolvedValue([]);
  m(api.leerProyecto).mockResolvedValue(null);
  m(api.listarArchivos).mockResolvedValue([]);
  m(api.leerUltimaGeneracion).mockResolvedValue(null);
  m(api.listarResultados).mockResolvedValue([]);
  m(api.urlsFirmadas).mockResolvedValue({ "previas/p1/a1.jpg": "https://x.test/previa-a1.jpg", "previas/p1/v1.jpg": "https://x.test/previa-v1.jpg", "resultados/p1/g1/0.jpg": "https://x.test/resultado-0.jpg" });
  m(api.actualizarProyecto).mockImplementation(async (_id, c) => proy(c as Partial<Proyecto>));
  m(api.generar).mockImplementation(async (_id, medio, _plan, piezas) => gen({ medio, piezas: piezas ?? null }));
});

describe("lista de trabajos", () => {
  it("sin trabajos explica cómo empezar", async () => {
    pintar(<EditorIA />);
    expect(await screen.findByTestId("sin-trabajos")).toHaveTextContent("Nuevo trabajo");
  });

  it("enseña el estado de la última generación de cada trabajo", async () => {
    m(api.listarProyectos).mockResolvedValue([proy()]);
    m(api.leerUltimaGeneracion).mockResolvedValue(gen({ estado: "procesando" }));
    pintar(<EditorIA />);
    const fila = await screen.findByTestId("trabajo:p1");
    expect(fila).toHaveTextContent("Menú de San Valentín");
    expect(fila).toHaveTextContent("Instagram");
    await waitFor(() => expect(fila).toHaveTextContent("Generando"));
  });
});

describe("paso 1: archivos", () => {
  it("al subir el primer archivo crea el trabajo con los valores por defecto y enseña el progreso", async () => {
    trabajo({ archivos: [] });
    m(api.crearProyecto).mockResolvedValue(proy());
    m(api.subirArchivo).mockImplementation(async (_id, _f, _o, opts) => {
      opts?.alProgreso?.(0.45);
      return new Promise(() => undefined);
    });
    pintar(<EditorIA />);
    const f = new File(["x"], "plato.jpg", { type: "image/jpeg" });
    fireEvent.change(await screen.findByTestId("entrada-archivos"), { target: { files: [f] } });
    expect(await screen.findByText("Subiendo 45 %")).toBeInTheDocument();
    expect(screen.getByTestId("subida:plato.jpg")).toHaveTextContent("plato.jpg");
    expect(api.crearProyecto).toHaveBeenCalledWith(expect.objectContaining({ marca: "casa-tomas", canal: "instagram", tipo: "publicacion", estilo: "elegante", origen: "editor" }));
    expect(api.subirArchivo).toHaveBeenCalledWith("p1", f, 0, expect.any(Object));
  });

  it("con un vídeo el trabajo nace como reel; con canal fijo usa ese canal y origen", async () => {
    trabajo({ archivos: [], proyecto: proy({ canal: "facebook", tipo: "reel", origen: "facebook" }) });
    m(api.crearProyecto).mockResolvedValue(proy({ canal: "facebook", tipo: "reel", origen: "facebook" }));
    m(api.subirArchivo).mockReturnValue(new Promise(() => undefined));
    pintar(<EditorIA canalFijo="facebook" origen="facebook" />);
    fireEvent.change(await screen.findByTestId("entrada-archivos"), { target: { files: [new File(["x"], "clip.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(api.crearProyecto).toHaveBeenCalledWith(expect.objectContaining({ canal: "facebook", tipo: "reel", origen: "facebook" })));
  });

  it("cuando acaba la subida pide al motor que lo analice y muestra «Preparando…»", async () => {
    trabajo({ archivos: [] });
    m(api.crearProyecto).mockResolvedValue(proy());
    m(api.subirArchivo).mockResolvedValue(foto({ estado: "subido", analisis: {} }));
    m(api.analizarArchivo).mockReturnValue(new Promise(() => undefined));
    pintar(<EditorIA />);
    fireEvent.change(await screen.findByTestId("entrada-archivos"), { target: { files: [new File(["x"], "plato.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(api.analizarArchivo).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" })));
    expect(await screen.findByText("Preparando…")).toBeInTheDocument();
  });

  it("un archivo no válido enseña el motivo y no sube nada", async () => {
    pintar(<EditorIA />);
    const pdf = new File(["x"], "notas.pdf", { type: "application/pdf" });
    const enorme = new File(["x"], "gigante.mp4", { type: "video/mp4" });
    Object.defineProperty(enorme, "size", { value: 60 * 1024 * 1024 });
    fireEvent.change(await screen.findByTestId("entrada-archivos"), { target: { files: [pdf, enorme] } });
    const aviso = await screen.findByTestId("rechazos");
    expect(within(aviso).getByText(/«notas.pdf»: solo se admiten fotos/)).toBeInTheDocument();
    expect(within(aviso).getByText(/«gigante.mp4» pesa 60 MB/)).toBeInTheDocument();
    expect(api.crearProyecto).not.toHaveBeenCalled();
    expect(api.subirArchivo).not.toHaveBeenCalled();
  });

  it("un archivo con error enseña el motivo y «Reintentar» vuelve a analizarlo", async () => {
    trabajo({ archivos: [foto({ estado: "error", error: "No se pudo leer la imagen", analisis: {} })] });
    m(api.analizarArchivo).mockResolvedValue(foto());
    pintar(<EditorIA trabajoInicial="p1" />);
    expect(await screen.findByText(/No se pudo leer la imagen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(api.analizarArchivo).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" })));
  });

  it("quitar un archivo pide confirmación", async () => {
    trabajo();
    m(api.quitarArchivo).mockResolvedValue(undefined);
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Quitar plato.jpg" }));
    expect(api.quitarArchivo).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Quitar" }));
    await waitFor(() => expect(api.quitarArchivo).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" })));
  });

  it("reordena con las flechas y guarda el orden", async () => {
    trabajo({ archivos: [foto(), foto({ id: "a2", nombre: "vino.jpg", orden: 1 })] });
    m(api.ordenarArchivos).mockResolvedValue(undefined);
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Bajar plato.jpg" }));
    await waitFor(() => expect(api.ordenarArchivos).toHaveBeenCalledWith(["a2", "a1"]));
  });
});

describe("pasos 3 y 4: contenido y estilo", () => {
  it("deshabilita con el motivo los contenidos que no casan con los archivos", async () => {
    trabajo({ archivos: [video()] });
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("arroz.mp4");
    await irAlPaso(3);
    expect(await screen.findByTestId("tipo:publicacion")).toBeDisabled();
    expect(screen.getByTestId("tipo:publicacion")).toHaveTextContent(/solo admite fotos/);
    expect(screen.getByTestId("tipo:carrusel")).toBeDisabled();
    expect(screen.getByTestId("tipo:animada")).toBeDisabled();
    expect(screen.getByTestId("tipo:reel")).toBeEnabled();
    expect(screen.getByTestId("tipo:story")).toBeEnabled();
    expect(screen.getByTestId("tipo:reel")).toHaveTextContent("1080×1920 px · 9:16");
  });

  it("un carrusel con una sola foto queda deshabilitado", async () => {
    trabajo({ archivos: [foto()] });
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(3);
    expect(await screen.findByTestId("tipo:carrusel")).toBeDisabled();
    expect(screen.getByTestId("tipo:carrusel")).toHaveTextContent(/al menos 2 fotos/);
    expect(screen.getByTestId("tipo:publicacion")).toBeEnabled();
  });

  it("la vista previa de cada estilo usa tu foto y aplica filtros distintos", async () => {
    trabajo();
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(4);
    const filtros = new Set<string>();
    for (const id of ESTILOS_IDS) {
      const img = await screen.findByTestId(`imagen-estilo:${id}`);
      await waitFor(() => expect(img).toHaveAttribute("src", "https://x.test/previa-a1.jpg"));
      const f = img.getAttribute("data-filtro") ?? "";
      expect(f).toMatch(/brightness\(/);
      expect(img.getAttribute("style") ?? "").toContain("filter");
      filtros.add(f);
    }
    expect(filtros.size).toBe(ESTILOS_IDS.length);
    expect(screen.getByText(/Vista previa aproximada: el resultado lo hace el motor/)).toBeInTheDocument();
  });

  it("elegir un estilo lo guarda en el trabajo", async () => {
    trabajo();
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(4);
    fireEvent.click(await screen.findByTestId("estilo:moderno"));
    await waitFor(() => expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", { estilo: "moderno" }));
  });
});

describe("paso 5: instrucciones", () => {
  it("el interruptor «Permitir transformaciones creativas» se guarda", async () => {
    trabajo();
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(5);
    const interruptor = await screen.findByRole("switch", { name: /Permitir transformaciones creativas/ });
    expect(interruptor).not.toBeChecked();
    expect(screen.getByText(/Desenfocar o cambiar el fondo modifica la escena/)).toBeInTheDocument();
    fireEvent.click(interruptor);
    await waitFor(() => expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", { permitir_creativo: true }));
    expect(interruptor).toBeChecked();
  });
});

describe("paso 6: generar", () => {
  it.each([
    ["foto", [foto()], proy(), planFoto()],
    ["video", [video()], proy({ tipo: "reel" }), planFoto({ piezas: [piezaVideo()] })],
  ] as const)("«Generar con IA» propone el plan y luego genera (%s)", async (medio, archivos, proyecto, plan) => {
    trabajo({ archivos: [...archivos], proyecto });
    m(api.proponerPlan).mockResolvedValue({ plan, avisos: [], modelo: "m" });
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText(medio === "foto" ? "plato.jpg" : "arroz.mp4");
    await irAlPaso(6);
    const boton = await screen.findByRole("button", { name: "Generar con IA" });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    await waitFor(() => expect(api.generar).toHaveBeenCalledWith("p1", medio, plan, null));
    expect(api.proponerPlan).toHaveBeenCalledWith("p1");
    expect(m(api.proponerPlan).mock.invocationCallOrder[0]).toBeLessThan(m(api.generar).mock.invocationCallOrder[0]);
    // El plan se guarda en el trabajo y el botón queda apagado mientras hay generación activa.
    expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", expect.objectContaining({ plan }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generar con IA" })).toBeDisabled());
    expect(await screen.findByTestId("generacion-activa")).toBeInTheDocument();
  });

  it("si vuelves con una generación activa sigue enseñando su progreso y no deja lanzar otra", async () => {
    trabajo({ generacion: gen({ estado: "procesando", piezas: [0, 1, 2], progreso: { fraccion: 0.4, paso: "Aplicando el estilo" } }) });
    pintar(<EditorIA trabajoInicial="p1" />);
    expect(await screen.findByText("Editando fotos 2 de 3…")).toBeInTheDocument();
    expect(screen.getByText("Aplicando el estilo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar con IA" })).toBeDisabled();
    expect(api.proponerPlan).not.toHaveBeenCalled();
  });

  it("en vídeo dice «Montando el vídeo…» y «Cancelar» cancela la generación", async () => {
    trabajo({ archivos: [video()], proyecto: proy({ tipo: "reel" }), generacion: gen({ medio: "video", estado: "procesando", progreso: { fraccion: 0.5 } }) });
    m(api.cancelarGeneracion).mockResolvedValue(undefined);
    pintar(<EditorIA trabajoInicial="p1" />);
    expect(await screen.findByText("Montando el vídeo…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(api.cancelarGeneracion).toHaveBeenCalledWith("g1"));
  });

  it("si la IA pregunta, se contesta y se vuelve a proponer, o se sigue así", async () => {
    trabajo();
    m(api.proponerPlan).mockResolvedValue({ plan: planFoto({ preguntas: ["¿Qué fecha tiene el evento?"] }), avisos: [], modelo: "m" });
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(6);
    const boton = await screen.findByRole("button", { name: "Generar con IA" });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    expect(await screen.findByText("¿Qué fecha tiene el evento?")).toBeInTheDocument();
    expect(api.generar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Tu respuesta"), { target: { value: "El 14 de febrero" } });
    fireEvent.click(screen.getByRole("button", { name: /Añadir respuesta a las instrucciones y volver a proponer/ }));
    await waitFor(() => expect(api.proponerPlan).toHaveBeenCalledTimes(2));
    expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", expect.objectContaining({ instrucciones: "El 14 de febrero" }));
  });

  it("«Seguir así» genera con el plan propuesto aunque tenga preguntas", async () => {
    trabajo();
    const plan = planFoto({ preguntas: ["¿Qué fecha tiene el evento?"] });
    m(api.proponerPlan).mockResolvedValue({ plan, avisos: [], modelo: "m" });
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(6);
    const boton = await screen.findByRole("button", { name: "Generar con IA" });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    fireEvent.click(await screen.findByRole("button", { name: "Seguir así" }));
    await waitFor(() => expect(api.generar).toHaveBeenCalledWith("p1", "foto", plan, null));
  });

  it("si la IA no está disponible ofrece la edición básica (sin IA) y genera con ella", async () => {
    trabajo();
    m(api.proponerPlan).mockRejectedValue(new ErrorRrss("La IA no está disponible ahora", "ia_no_disponible", 503));
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(6);
    const boton = await screen.findByRole("button", { name: "Generar con IA" });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    const alerta = await screen.findByTestId("error-generacion");
    expect(alerta).toHaveTextContent("La IA no está disponible ahora");
    expect(within(alerta).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    fireEvent.click(within(alerta).getByRole("button", { name: "Generar con la edición básica (sin IA)" }));
    await waitFor(() => expect(api.generar).toHaveBeenCalled());
    const [id, medio, plan, piezas] = m(api.generar).mock.calls[0];
    expect([id, medio, piezas]).toEqual(["p1", "foto", null]);
    expect(plan.resumen).toMatch(/Edición básica/);
    expect(plan.piezas[0]).toMatchObject({ tipo: "foto", archivo: "a1" });
  });

  it("al llegar al cupo no hay reintento ni edición básica", async () => {
    trabajo();
    m(api.proponerPlan).mockRejectedValue(new ErrorRrss("Has llegado al tope diario de la IA", "cupo", 429));
    pintar(<EditorIA trabajoInicial="p1" />);
    await screen.findByText("plato.jpg");
    await irAlPaso(6);
    const boton = await screen.findByRole("button", { name: "Generar con IA" });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    const alerta = await screen.findByTestId("error-generacion");
    expect(alerta).toHaveTextContent("Has llegado al tope diario de la IA");
    expect(within(alerta).queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(within(alerta).queryByRole("button", { name: /edición básica/ })).not.toBeInTheDocument();
  });

  it("un error del motor se enseña en rojo con «Reintentar»", async () => {
    trabajo({ generacion: gen({ estado: "error", error: "Se ha agotado el tiempo" }) });
    pintar(<EditorIA trabajoInicial="p1" />);
    await irAlPaso(6);
    const tarjeta = await screen.findByTestId("generacion-error");
    expect(tarjeta).toHaveTextContent("Se ha agotado el tiempo");
    expect(within(tarjeta).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("con archivos sin preparar o sin archivos explica por qué no se puede generar", async () => {
    trabajo({ archivos: [] });
    pintar(<EditorIA trabajoInicial="p1" />);
    await irAlPaso(6);
    expect(await screen.findByText(/Sube al menos una foto o un vídeo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar con IA" })).toBeDisabled();
  });
});

describe("paso 7: resultado y ajustes", () => {
  const conResultado = (extra: Parameters<typeof trabajo>[0] = {}) =>
    trabajo({ proyecto: proy({ plan: planFoto(), textos: { caption: "Cena de hoy", hashtags: ["#casatomas"], titular: "Cena" } }), resultados: [resultadoFoto()], generacion: gen({ estado: "listo" }), ...extra });

  it("abre en el resultado: resumen de la IA, comparador antes/después, descarga y nota de que nada se publica", async () => {
    conResultado();
    pintar(<EditorIA trabajoInicial="p1" />);
    expect(await screen.findByTestId("resumen-ia")).toHaveTextContent("Foto del plato con luz cálida");
    expect(await screen.findByLabelText("Comparar antes y después")).toBeInTheDocument();
    expect(screen.getByText("Antes")).toBeInTheDocument();
    expect(screen.getByText("Después")).toBeInTheDocument();
    expect(screen.getByTestId("nota-no-publica")).toHaveTextContent("Nada se publica solo: descarga o copia el contenido para publicarlo");
    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));
    await waitFor(() => expect(api.descargar).toHaveBeenCalledWith("resultados/p1/g1/0.jpg", "menu-de-san-valentin-01.jpg"));
  });

  it("«Aplicar ajustes» guarda el plan y solo rehace esa pieza", async () => {
    conResultado();
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar" }));
    fireEvent.change(await screen.findByLabelText("Exposición"), { target: { value: "0.3" } });
    fireEvent.change(within(screen.getByTestId("ajustes-foto")).getByLabelText("Titular"), { target: { value: "Cena especial" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ajustes" }));
    await waitFor(() => expect(api.generar).toHaveBeenCalled());
    const [id, medio, plan, piezas] = m(api.generar).mock.calls[0];
    expect([id, medio, piezas]).toEqual(["p1", "foto", [0]]);
    expect(plan.piezas[0]).toMatchObject({ archivo: "a1", correccion: { exposicion: 0.3 }, rotulos: { titulo: "Cena especial", posicion: "auto" } });
    expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", expect.objectContaining({ plan }));
  });

  it("«Pedir otra propuesta a la IA» llama a proponerPieza con la indicación y rehace solo esa foto", async () => {
    conResultado();
    const nuevo = planFoto({ resumen: "Otra propuesta" });
    m(api.proponerPieza).mockResolvedValue({ plan: nuevo, indice: 0, avisos: [], modelo: "m" });
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar" }));
    fireEvent.change(await screen.findByLabelText(/Indicación para la IA/), { target: { value: "más cálida" } });
    fireEvent.click(screen.getByRole("button", { name: /Pedir otra propuesta a la IA para esta foto/ }));
    await waitFor(() => expect(api.generar).toHaveBeenCalledWith("p1", "foto", nuevo, [0]));
    expect(api.proponerPieza).toHaveBeenCalledWith("p1", 0, "más cálida");
  });

  it("la transformación creativa solo se ofrece si el trabajo la permite", async () => {
    conResultado();
    const { unmount } = pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar" }));
    await screen.findByLabelText("Exposición");
    expect(screen.queryByLabelText(/Transformación creativa/)).not.toBeInTheDocument();
    unmount();
    conResultado({ proyecto: proy({ permitir_creativo: true, plan: planFoto() }) });
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar" }));
    expect(await screen.findByLabelText(/Transformación creativa/)).toBeInTheDocument();
  });

  it("«Copiar texto» copia la publicación con sus hashtags y avisa", async () => {
    conResultado();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Copiar texto/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Cena de hoy\n\n#casatomas"));
    expect(toast.success).toHaveBeenCalledWith("Texto copiado");
  });

  it("el texto se guarda solo y se puede regenerar sin tocar las fotos", async () => {
    conResultado();
    m(api.proponerTextos).mockResolvedValue({ textos: { caption: "Texto nuevo", hashtags: ["#vino"], titular: "Nuevo" }, avisos: [] });
    pintar(<EditorIA trabajoInicial="p1" />);
    const caja = await screen.findByLabelText("Texto");
    fireEvent.change(caja, { target: { value: "Cena de hoy en Casa Tomás" } });
    await waitFor(() => expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", { textos: { caption: "Cena de hoy en Casa Tomás", hashtags: ["#casatomas"], titular: "Cena" } }), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Regenerar solo el texto" }));
    await waitFor(() => expect(api.proponerTextos).toHaveBeenCalledWith("p1", undefined));
    await waitFor(() => expect(screen.getByLabelText("Texto")).toHaveValue("Texto nuevo"));
    expect(api.generar).not.toHaveBeenCalled();
  });

  it("«Guardar borrador» y «Marcar como listo» cambian el estado; «Borrar trabajo» pide confirmación", async () => {
    conResultado();
    m(api.borrarProyecto).mockResolvedValue(undefined);
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Guardar borrador/ }));
    await waitFor(() => expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", { estado: "borrador" }));
    expect(toast.success).toHaveBeenCalledWith("Borrador guardado");
    fireEvent.click(screen.getByRole("button", { name: /Marcar como listo/ }));
    await waitFor(() => expect(api.actualizarProyecto).toHaveBeenCalledWith("p1", { estado: "listo" }));
    fireEvent.click(screen.getByRole("button", { name: /Borrar trabajo/ }));
    expect(api.borrarProyecto).not.toHaveBeenCalled();
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Borrar trabajo" }));
    await waitFor(() => expect(api.borrarProyecto).toHaveBeenCalledWith("p1"));
  });

  it("«Descargar todo» descarga cada resultado vigente", async () => {
    conResultado({ resultados: [resultadoFoto(), resultadoFoto({ id: "r2", indice: 1, ruta: "resultados/p1/g1/1.jpg" })] });
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Descargar todo/ }));
    await waitFor(() => expect(api.descargar).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(api.descargar).toHaveBeenCalledWith("resultados/p1/g1/1.jpg", "menu-de-san-valentin-02.jpg");
  });
});

describe("vídeo: resultado y ajustes", () => {
  const conVideo = (archivo: Archivo = video()) => {
    m(api.urlsFirmadas).mockResolvedValue({ "resultados/p1/g1/video.mp4": "https://x.test/video.mp4", "resultados/p1/g1/portada.jpg": "https://x.test/portada.jpg" });
    trabajo({
      proyecto: proy({ tipo: "reel", plan: planFoto({ piezas: [piezaVideo()] }) }),
      archivos: [archivo],
      generacion: gen({ medio: "video", estado: "listo" }),
      resultados: [resultadoFoto({ id: "rv", medio: "video", ruta: "resultados/p1/g1/video.mp4", portada_ruta: "resultados/p1/g1/portada.jpg", ancho: 1080, alto: 1920, duracion_s: 8 })],
    });
  };

  it("enseña el reproductor con póster y la duración total frente al formato", async () => {
    conVideo();
    pintar(<EditorIA trabajoInicial="p1" />);
    await waitFor(() => expect(document.querySelector("video")).toHaveAttribute("src", "https://x.test/video.mp4"));
    expect(document.querySelector("video")).toHaveAttribute("poster", "https://x.test/portada.jpg");
    expect(document.querySelector("video")).toHaveAttribute("controls");
    fireEvent.click(screen.getByRole("button", { name: "Ajustar el vídeo" }));
    expect(await screen.findByTestId("duracion-total")).toHaveTextContent("8,0 s");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("avisa si el montaje se sale del formato y lo recalcula al cambiar una toma", async () => {
    conVideo();
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar el vídeo" }));
    const fin = await screen.findByLabelText("Fin (s)");
    fireEvent.change(fin, { target: { value: "2" } });
    fireEvent.blur(fin);
    await waitFor(() => expect(screen.getByTestId("duracion-total")).toHaveTextContent("2,0 s"));
    expect(screen.getByRole("alert")).toHaveTextContent(/menos de 5 s/);
  });

  it("«Aplicar cambios» guarda el plan y rehace el vídeo entero", async () => {
    conVideo();
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar el vídeo" }));
    fireEvent.click(await screen.findByLabelText("Mantener el sonido original de los clips"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }));
    await waitFor(() => expect(api.generar).toHaveBeenCalled());
    const [id, medio, plan, piezas] = m(api.generar).mock.calls[0];
    expect([id, medio, piezas]).toEqual(["p1", "video", null]);
    expect(plan.piezas[0]).toMatchObject({ tipo: "video", audio: "silencio" });
  });

  it("un clip con voz y sin transcripción ofrece «Transcribir la voz»", async () => {
    conVideo();
    m(api.transcribir).mockResolvedValue({ segmentos: [], texto: "hola" });
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar el vídeo" }));
    fireEvent.click(await screen.findByRole("button", { name: /Transcribir la voz/ }));
    await waitFor(() => expect(api.transcribir).toHaveBeenCalledWith("v1"));
  });

  it("con transcripción la enseña en lugar del botón", async () => {
    conVideo(video({ analisis: { previa_ruta: "previas/p1/v1.jpg", audio_ruta: "audio/p1/v1.m4a", transcripcion_texto: "Bienvenidos a Casa Tomás", transcripcion: [{ inicio: 0, fin: 2, texto: "Bienvenidos a Casa Tomás" }] } }));
    pintar(<EditorIA trabajoInicial="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar el vídeo" }));
    expect(await screen.findByText("Bienvenidos a Casa Tomás")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Transcribir la voz/ })).not.toBeInTheDocument();
  });
});
