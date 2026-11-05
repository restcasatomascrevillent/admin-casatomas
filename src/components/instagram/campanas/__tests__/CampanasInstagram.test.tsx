/**
 * Pantalla «Campañas», «Sugerencia de la semana» y borradores en el
 * calendario, con Supabase y la función instagram-ia simulados (sin red):
 * lista y ficha con línea de tiempo y «falta foto», «¿Qué quieres empujar?»
 * llega a la IA, «Proponer de nuevo» descarta la anterior solo después,
 * «Aceptar y llevar al calendario» manda SOLO las piezas marcadas a
 * instagram_aceptar_campana y nunca programa, los borradores se abren en
 * «Crear», y el calendario pinta los borradores con borde discontinuo.
 */
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sbFalso = vi.hoisted(() => ({
  datos: {} as Record<string, unknown[]>,
  rpc: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "gte", "lt", "order", "limit", "not", "eq"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: (sbFalso.datos[tabla] ?? [])[0] ?? null, error: null });
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: sbFalso.datos[tabla] ?? [], error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) },
      from: consulta,
      rpc: (...a: unknown[]) => sbFalso.rpc(...a),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CampanasInstagram, SugerenciaSemana } from "../index";
import { CalendarioInstagram } from "@/components/instagram/programar";
import { URL_IA } from "@/components/instagram/ia/api";
import { toast } from "sonner";

const AHORA = new Date("2026-11-05T10:00:00Z");

const pieza = (n: number, extra: Record<string, unknown> = {}) => ({
  fecha: `2026-11-${String(9 + n * 4).padStart(2, "0")}`,
  hora: "13:00",
  formato: "post",
  plantilla: "ct-foto-titular",
  platoId: "pulpo",
  plato: { id: "pulpo", nombre: "Pulpo a la gallega" },
  foto: "drive:FotoDelPulpo0001",
  faltaFoto: false,
  antetitulo: "",
  titular: `Pieza ${n}`,
  gancho: `Gancho ${n}`,
  caption: `Texto ${n}`,
  hashtags: ["#CasaTomás"],
  altText: "Pulpo.",
  porQue: `Motivo ${n}`,
  fase: n < 2 ? 0 : 1,
  encargoSugerido: "",
  avisos: [],
  ...extra,
});

const CAMPANA = {
  id: "c1",
  marca: "casa-tomas",
  titulo: "Temporada de setas",
  objetivo: "Llenar los mediodías",
  publico: "Familias",
  mensaje: "El otoño llega a la mesa",
  razonamiento: "San Martín cae en miércoles.",
  peticion: "setas",
  desde: "2026-11-09",
  hasta: "2026-11-29",
  estado: "propuesta",
  piezas_aceptadas: null,
  created_at: "2026-11-05T09:00:00Z",
  propuesta: {
    titulo: "Temporada de setas",
    objetivo: "Llenar los mediodías",
    publico: "Familias",
    mensaje: "El otoño llega a la mesa",
    razonamiento: "San Martín cae en miércoles.",
    desde: "2026-11-09",
    hasta: "2026-11-29",
    fases: [
      { nombre: "Anuncio", desde: "2026-11-09", hasta: "2026-11-15" },
      { nombre: "Plato a plato", desde: "2026-11-16", hasta: "2026-11-29" },
    ],
    piezas: [pieza(0), pieza(1, { foto: null, faltaFoto: true, titular: "Revuelto de boletus" }), pieza(2)],
  },
};

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

let fetchFalso: Mock;
/** Llamadas a la IA (las miniaturas de Drive de las piezas también usan fetch). */
const llamadasIA = () => fetchFalso.mock.calls.filter(([u]) => u === URL_IA);
const respuesta = (cuerpo: unknown, estado = 200) => Promise.resolve(new Response(JSON.stringify(cuerpo), { status: estado }));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  sbFalso.datos = { instagram_campanas: [CAMPANA] };
  sbFalso.rpc = vi.fn().mockResolvedValue({ data: { ok: true, piezas: [{ id: "b1", indice: 0 }, { id: "b2", indice: 2 }] }, error: null });
  fetchFalso = vi.fn();
  vi.stubGlobal("fetch", fetchFalso);
  vi.mocked(toast.success).mockClear();
});

describe("CampanasInstagram", () => {
  it("pinta la ficha: objetivo, público, mensaje, línea de tiempo, fases y la pieza sin foto", async () => {
    envolver(<CampanasInstagram />);
    expect(await screen.findByRole("heading", { name: "Temporada de setas" }, { timeout: 5000 })).toBeInTheDocument();
    const ficha = screen.getByTestId("ficha-campana");
    for (const t of ["Llenar los mediodías", "Familias", "El otoño llega a la mesa"]) expect(within(ficha).getByText(t)).toBeInTheDocument();
    expect(within(ficha).getByRole("group", { name: "Línea de tiempo de la campaña" })).toBeInTheDocument();
    expect(within(ficha).getByText("1. Anuncio", { selector: "h3 span" })).toBeInTheDocument();
    expect(within(ficha).getByText("1 sin foto")).toBeInTheDocument();
    expect(within(ficha).getByText(/Falta foto/)).toBeInTheDocument();
    expect(within(ficha).getAllByTestId("pieza-campana")).toHaveLength(3);
    expect(within(ficha).getByText(/3 de 3/)).toBeInTheDocument();
  });

  it("aceptar manda SOLO las piezas marcadas como borradores y nunca programa", async () => {
    envolver(<CampanasInstagram />);
    const casilla = await screen.findByRole("checkbox", { name: "Incluir «Revuelto de boletus»" });
    fireEvent.click(casilla);
    expect(screen.getByText(/2 de 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y llevar al calendario" }));
    await waitFor(() => expect(sbFalso.rpc).toHaveBeenCalledWith("instagram_aceptar_campana", { p_campana_id: "c1", p_piezas: [0, 2] }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 borradores añadidos al calendario", expect.anything()));
    const llamadas = sbFalso.rpc.mock.calls.map((c) => c[0]);
    expect(llamadas.some((n) => /programar|publicar/.test(String(n)))).toBe(false);
    expect(llamadasIA()).toHaveLength(0);
  });

  it("«¿Qué quieres empujar?» llega a la IA y la nueva campaña queda elegida", async () => {
    fetchFalso.mockImplementation(() =>
      respuesta({ ok: true, accion: "proponer_campana", campanaId: "c2", campana: { ...CAMPANA.propuesta, titulo: "Menú de empresa" }, descartadas: [], avisos: ["Se han quitado los emoji (la marca no los usa)."] }),
    );
    envolver(<CampanasInstagram />);
    await screen.findByRole("heading", { name: "Temporada de setas" });
    // Con campañas en la lista el formulario va plegado: se abre con «Pedir otra campaña».
    expect(screen.queryByLabelText("¿Qué quieres empujar?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pedir otra campaña" }));
    fireEvent.change(screen.getByLabelText("¿Qué quieres empujar?"), { target: { value: "Llenar los mediodías de diciembre" } });
    fireEvent.click(screen.getByRole("radio", { name: "2 semanas" }));
    sbFalso.datos.instagram_campanas = [{ ...CAMPANA, id: "c2", titulo: "Menú de empresa" }, CAMPANA];
    fireEvent.click(screen.getByRole("button", { name: "Proponer campaña" }));
    await waitFor(() => expect(llamadasIA().length).toBeGreaterThan(0));
    const [url, init] = llamadasIA()[0] as [string, RequestInit];
    expect(url).toBe(URL_IA);
    expect(JSON.parse(String(init.body))).toMatchObject({
      accion: "proponer_campana",
      marca: "casa-tomas",
      semanas: 2,
      piezasPorSemana: 3,
      desde: "2026-11-06",
      objetivo: "Llenar los mediodías de diciembre",
    });
    expect(await screen.findByRole("heading", { name: "Menú de empresa" })).toBeInTheDocument();
    expect(screen.getByText("Se han quitado los emoji (la marca no los usa).")).toBeInTheDocument();
  });

  it("«Proponer de nuevo» pide otra igual y descarta la anterior solo cuando ya hay otra", async () => {
    fetchFalso.mockImplementation(() => respuesta({ ok: true, campanaId: "c3", campana: CAMPANA.propuesta, descartadas: [], avisos: [] }));
    envolver(<CampanasInstagram />);
    fireEvent.click(await screen.findByRole("button", { name: "Proponer de nuevo" }));
    await waitFor(() => expect(sbFalso.rpc).toHaveBeenCalledWith("instagram_descartar_campana", { p_campana_id: "c1" }));
    expect(JSON.parse(String((llamadasIA()[0] as [string, RequestInit])[1].body))).toMatchObject({
      accion: "proponer_campana", desde: "2026-11-09", semanas: 3, piezasPorSemana: 1, objetivo: "setas",
    });
  });

  it("si la IA rechaza (422) enseña los motivos y no descarta nada", async () => {
    fetchFalso.mockImplementation(() => respuesta({ ok: false, error: "La campaña no ha pasado las comprobaciones", descartadas: [{ donde: "Campaña", motivos: ["TOUZA no admite reservas"] }] }, 422));
    envolver(<CampanasInstagram />);
    fireEvent.click(await screen.findByRole("button", { name: "Proponer de nuevo" }));
    expect(await screen.findByText(/no ha pasado las comprobaciones/)).toBeInTheDocument();
    expect(screen.getByText("TOUZA no admite reservas")).toBeInTheDocument();
    expect(sbFalso.rpc).not.toHaveBeenCalled();
  });

  it("una campaña aceptada lista sus borradores y los abre en «Crear»", async () => {
    const onAbrir = vi.fn();
    sbFalso.datos = {
      instagram_campanas: [{ ...CAMPANA, estado: "aceptada", piezas_aceptadas: 1 }],
      instagram_piezas: [{ id: "b1", marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", datos: { titular: "Pieza 0" }, estado: "borrador", fecha_prevista: "2026-11-09T12:00:00Z" }],
    };
    envolver(<CampanasInstagram onAbrirBorrador={onAbrir} />);
    const lista = await screen.findByTestId("borradores-campana");
    fireEvent.click(await within(lista).findByRole("button", { name: /Abrir en Crear/ }));
    expect(onAbrir).toHaveBeenCalledWith("b1");
    expect(screen.queryByRole("button", { name: "Aceptar y llevar al calendario" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("Campañas: fotos de las piezas", () => {
  it("las piezas con foto llevan miniatura; las que no, «Pedir foto a Oficiosos» con el formulario ya rellenado", async () => {
    envolver(<CampanasInstagram />);
    const ficha = await screen.findByTestId("ficha-campana");
    await within(ficha).findByRole("heading", { name: "Temporada de setas" }, { timeout: 5000 });
    // Las dos piezas con foto de Drive llevan su miniatura; la que no, el hueco discontinuo y el botón.
    expect(within(ficha).getAllByTestId("miniatura-foto")).toHaveLength(2);
    const botones = within(ficha).getAllByRole("button", { name: "Pedir foto a Oficiosos" });
    expect(botones).toHaveLength(1);
    fireEvent.click(botones[0]);
    const form = await screen.findByTestId("formulario-encargo");
    expect((within(form).getByLabelText("Título") as HTMLInputElement).value).toBe("Foto: Pulpo a la gallega");
    // Para dos días antes de la pieza (vie 13 nov).
    expect((within(form).getByLabelText("Para cuándo") as HTMLInputElement).value).toBe("2026-11-11");
    expect(within(form).getByDisplayValue(/Foto para la campaña «Temporada de setas»/)).toBeInTheDocument();
  });
});

describe("SugerenciaSemana", () => {
  it("enseña las fechas de la semana sin IA y solo pide ideas al pulsar", async () => {
    sbFalso.rpc = vi.fn().mockResolvedValue({ data: [{ titulo: "San Martín y la matanza", desde: "2026-11-11", hasta: "2026-11-11", verificacion: "verificada" }], error: null });
    fetchFalso.mockImplementation(() =>
      respuesta({
        ok: true, accion: "ideas_semana", desde: "2026-11-02", hasta: "2026-11-08", fechas: [], avisos: [],
        ideas: [
          { fecha: "2026-11-06", titulo: "El cocido del viernes", idea: "Cuchara para el frío.", motivo: "temporada", formato: "post", plantilla: "ct-foto-titular", platoId: null, plato: null, gancho: "Ya hace frío.", avisos: [] },
          { fecha: "2026-11-07", titulo: "Sábado de pulpo", idea: "El plato destacado.", motivo: "plato", formato: "story", plantilla: "ct-foto-titular", platoId: "pulpo", plato: { id: "pulpo", nombre: "Pulpo a la gallega" }, gancho: "", avisos: [] },
        ],
      }),
    );
    const onCrear = vi.fn();
    envolver(<SugerenciaSemana marca="casa-tomas" onCrear={onCrear} />);
    expect(await screen.findByText("San Martín y la matanza")).toBeInTheDocument();
    expect(sbFalso.rpc).toHaveBeenCalledWith("marketing_fechas_entre", { p_desde: "2026-11-02", p_hasta: "2026-11-08", p_marca: "casa-tomas" });
    expect(llamadasIA()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Pedir ideas a la IA" }));
    expect(await screen.findByText("El cocido del viernes")).toBeInTheDocument();
    expect(JSON.parse(String((llamadasIA()[0] as [string, RequestInit])[1].body))).toEqual({ accion: "ideas_semana", marca: "casa-tomas", semana: "2026-11-02" });
    fireEvent.click(screen.getByRole("button", { name: /Otra idea/ }));
    expect(screen.getByText("Sábado de pulpo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    expect(onCrear).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Sábado de pulpo", platoId: "pulpo" }));
  });
});

describe("CalendarioInstagram con borradores", () => {
  const BASE = { marca: "casa-tomas", formato: "post", plantilla: "ct-foto-titular", imagen_ruta: null, estado: "borrador" };
  beforeEach(() => {
    sbFalso.datos = {
      instagram_programaciones: [
        { id: "a", pieza_id: "p9", marca: "casa-tomas", programada_para: "2026-11-06T12:00:00Z", estado: "programada", intentos: 0, ultimo_error: null, pieza: { ...BASE, id: "p9", datos: { titular: "Ya programada" } } },
      ],
      instagram_piezas: [
        { ...BASE, id: "b1", datos: { titular: "Borrador de setas" }, fecha_prevista: "2026-11-06T12:00:00Z", programaciones: [] },
        // Ya tiene una programación activa: sale como programada, no como borrador.
        { ...BASE, id: "p9", datos: { titular: "Ya programada" }, fecha_prevista: "2026-11-07T12:00:00Z", programaciones: [{ estado: "programada" }] },
      ],
    };
  });

  it("pinta los borradores con borde discontinuo y los abre en el editor si hay callback", async () => {
    const onAbrir = vi.fn();
    envolver(<CalendarioInstagram onAbrirPieza={onAbrir} />);
    await waitFor(() => expect(screen.getAllByTestId("evento-instagram").some((e) => e.getAttribute("data-estado") === "borrador")).toBe(true));
    const borradores = screen.getAllByTestId("evento-instagram").filter((e) => e.getAttribute("data-estado") === "borrador");
    expect(borradores).toHaveLength(1);
    expect(borradores[0].className).toMatch(/border-dashed/);
    expect(borradores[0]).toHaveAccessibleName(/Borrador de setas · Borrador sin programar/);
    fireEvent.click(borradores[0]);
    expect(onAbrir).toHaveBeenCalledWith("b1");
  });

  it("sin callback, el borrador se ve pero no es un botón", async () => {
    envolver(<CalendarioInstagram />);
    await waitFor(() => expect(screen.getAllByTestId("evento-instagram").some((e) => e.getAttribute("data-estado") === "borrador")).toBe(true));
    const b = screen.getAllByTestId("evento-instagram").find((e) => e.getAttribute("data-estado") === "borrador")!;
    expect(b.tagName).toBe("DIV");
  });
});
