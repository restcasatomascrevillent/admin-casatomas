/**
 * Logs › Configuración › Linear «para tontos»: probar la clave del servidor y
 * elegir equipo, proyecto, etiquetas y estado en desplegables.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigLogsWeb, EquipoLinear, ResultadoConexionLinear } from "@/hooks/useLogsWeb";

let respuesta: ResultadoConexionLinear | null = null;
let fallo: string | null = null;
const mutate = vi.fn((_v: undefined, o?: { onSuccess?: (r: ResultadoConexionLinear) => void; onError?: (e: Error) => void }) => {
  if (fallo) o?.onError?.(new Error(fallo));
  else if (respuesta) o?.onSuccess?.(respuesta);
});
vi.mock("@/hooks/useLogsWeb", async (original) => {
  const real = await original<typeof import("@/hooks/useLogsWeb")>();
  return { ...real, useProbarLinear: () => ({ mutate, isPending: false, data: fallo ? undefined : respuesta ?? undefined }) };
});

const { ConexionLinear, avisoConfigLinear, cambiosAlElegirEquipo } = await import("../ConexionLinear");

const EQUIPO: EquipoLinear = {
  id: "eq-web", nombre: "Web", clave: "WEB",
  proyectos: [{ id: "pr-1", nombre: "Logs" }],
  estados: [{ id: "st-todo", nombre: "Por hacer", tipo: "unstarted" }, { id: "st-hecho", nombre: "Hecho", tipo: "completed" }],
  etiquetas: [{ id: "et-bug", nombre: "Bug" }],
  estadoReabrirPorDefecto: { id: "st-todo", nombre: "Por hacer" },
};
const OTRO: EquipoLinear = { ...EQUIPO, id: "eq-alm", nombre: "Almacén", clave: "ALM", proyectos: [], estados: [], etiquetas: [], estadoReabrirPorDefecto: null };

type Campos = Pick<ConfigLogsWeb, "linear_modo" | "linear_equipo_id" | "linear_proyecto_id" | "linear_etiquetas" | "linear_estado_reabrir_id">;
const valores = (o: Partial<Campos> = {}): Campos => ({
  linear_modo: "prueba", linear_equipo_id: null, linear_proyecto_id: null, linear_etiquetas: [], linear_estado_reabrir_id: null, ...o,
});

beforeEach(() => {
  respuesta = null;
  fallo = null;
  mutate.mockClear();
});

describe("reglas de la configuración de Linear", () => {
  it("cambiar de equipo quita lo que era del anterior (proyecto, etiquetas, estado)", () => {
    const actual = valores({ linear_equipo_id: "eq-web", linear_proyecto_id: "pr-1", linear_etiquetas: ["et-bug"], linear_estado_reabrir_id: "st-todo" });
    expect(cambiosAlElegirEquipo(OTRO, actual)).toEqual({ linear_equipo_id: "eq-alm", linear_proyecto_id: null, linear_etiquetas: [], linear_estado_reabrir_id: null });
    expect(cambiosAlElegirEquipo(EQUIPO, actual)).toEqual({ linear_equipo_id: "eq-web", linear_proyecto_id: "pr-1", linear_etiquetas: ["et-bug"], linear_estado_reabrir_id: "st-todo" });
    expect(cambiosAlElegirEquipo(null, actual).linear_equipo_id).toBeNull();
  });
  it("avisa si se elige «Linear» sin equipo o con la conexión rota; en pruebas, nada", () => {
    expect(avisoConfigLinear(valores(), null)).toBeNull();
    expect(avisoConfigLinear(valores({ linear_modo: "real" }), null)).toMatch(/falta el equipo/);
    expect(avisoConfigLinear(valores({ linear_modo: "real", linear_equipo_id: "eq-web" }), { ok: false, estado: "clave_mal", mensaje: "x" })).toMatch(/no se crearán/);
    expect(avisoConfigLinear(valores({ linear_modo: "real", linear_equipo_id: "eq-web" }), null)).toBeNull();
  });
});

describe("botón «Probar conexión con Linear»", () => {
  it("sin clave en el servidor: lo dice claro y remite a los pasos", () => {
    respuesta = { ok: false, estado: "sin_clave", mensaje: "Falta la clave de Linear (LINEAR_API_KEY) en el servidor. En Linear: Settings…" };
    render(<ConexionLinear valores={valores()} onCambio={vi.fn()} />);
    fireEvent.click(screen.getByTestId("probar-linear"));
    expect(mutate).toHaveBeenCalledTimes(1);
    const r = screen.getByTestId("conexion-linear");
    expect(r).toHaveAttribute("data-estado", "sin_clave");
    expect(r).toHaveTextContent("Falta la clave de Linear: sigue los pasos de «Cómo conectar Linear», justo encima.");
    expect(screen.getByTestId("pasos-linear")).toHaveTextContent("LINEAR_API_KEY");
    expect(screen.queryByLabelText("Equipo de Linear")).toBeNull();
  });
  it("clave mala: enseña el mensaje del servidor", () => {
    respuesta = { ok: false, estado: "clave_mal", mensaje: "Linear no acepta la clave guardada: puede estar mal copiada, caducada o revocada." };
    render(<ConexionLinear valores={valores({ linear_modo: "real", linear_equipo_id: "eq-web" })} onCambio={vi.fn()} />);
    expect(screen.getByTestId("conexion-linear")).toHaveTextContent("no acepta la clave");
    expect(screen.getByTestId("aviso-linear")).toHaveTextContent("no se crearán");
  });
  it("la función no responde: error en pantalla, sin romper", () => {
    fallo = "No se pudo contactar con la función «procesar-logs-web» (¿está desplegada?).";
    render(<ConexionLinear valores={valores()} onCambio={vi.fn()} />);
    fireEvent.click(screen.getByTestId("probar-linear"));
    expect(screen.getByRole("alert")).toHaveTextContent("¿está desplegada?");
  });
  it("conectado: nombre del espacio, desplegables de equipo, proyecto y estado, y etiquetas del equipo", () => {
    respuesta = { ok: true, estado: "ok", mensaje: "Conectado con Linear («Casa Tomás»). Elige el equipo donde se crean los tickets.", usuario: "Tomás", espacio: { nombre: "Casa Tomás", urlKey: "ct" }, equipos: [OTRO, EQUIPO] };
    const onCambio = vi.fn();
    render(<ConexionLinear valores={valores({ linear_equipo_id: "eq-web" })} onCambio={onCambio} />);
    expect(screen.getByTestId("conexion-linear")).toHaveTextContent("Conectado con Linear («Casa Tomás»)");
    expect(screen.getByLabelText("Equipo de Linear")).toHaveTextContent("Web (WEB)");
    expect(screen.getByLabelText("Proyecto de Linear")).toHaveTextContent("Sin proyecto");
    expect(screen.getByLabelText("Estado al reabrir")).toHaveTextContent("Automático («Por hacer»)");
    fireEvent.click(screen.getByRole("checkbox", { name: "Bug" }));
    expect(onCambio).toHaveBeenCalledWith({ linear_etiquetas: ["et-bug"] });
  });
  it("con un solo equipo y ninguno elegido, lo elige solo", () => {
    respuesta = { ok: true, estado: "ok", mensaje: "Conectado", usuario: null, espacio: null, equipos: [EQUIPO] };
    const onCambio = vi.fn();
    render(<ConexionLinear valores={valores()} onCambio={onCambio} />);
    fireEvent.click(screen.getByTestId("probar-linear"));
    expect(onCambio).toHaveBeenCalledWith(expect.objectContaining({ linear_equipo_id: "eq-web" }));
  });
});
