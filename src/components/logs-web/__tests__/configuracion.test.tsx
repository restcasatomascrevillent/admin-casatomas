/**
 * Super Admin › Logs › Configuración en subpestañas (petición del dueño,
 * 14/11/2026: «añade subpestañas para que no haya scroll infinito»): un solo
 * borrador y un solo «Guardar», marca de cambios sin guardar por subpestaña,
 * subpestaña en la URL y el interruptor de los servicios externos.
 */
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigLogsWeb } from "@/hooks/useLogsWeb";

let config: ConfigLogsWeb;
const guardar = vi.fn();
vi.mock("@/hooks/useLogsWeb", async (original) => {
  const real = await original<typeof import("@/hooks/useLogsWeb")>();
  const q = <T,>(data: T) => ({ data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() });
  return {
    ...real,
    useConfigLogs: () => q(config),
    useCatalogoEventos: () => q([]),
    useGuardarConfigLogs: () => ({ mutate: guardar, isPending: false }),
    useProcesarAhora: () => ({ mutate: vi.fn(), isPending: false }),
    useProbarLinear: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
  };
});

const { PestanaConfiguracion } = await import("../PestanaConfiguracion");
const { subpestanaConfig, subpestanasConCambios, SUBPESTANAS_CONFIG } = await import("../subpestanasConfig");
type Sub = Parameters<typeof subpestanaConfig>[0];

const base = (o: Partial<ConfigLogsWeb> = {}): ConfigLogsWeb => ({
  recoger_actividad: true, recoger_errores_navegador: true, recoger_peticiones: true, recoger_errores_servidor: true, recoger_integraciones: true, recoger_hosting: true,
  entornos_aceptados: ["produccion", "demo"], entornos_ticket: ["produccion"], rutas_excluidas: [], mensajes_ignorados: ["ResizeObserver loop"],
  umbral_ocurrencias: 3, umbral_sesiones: 2, umbral_ventana_horas: 24, tickets_404: false, umbral_404_diario: 20, excluir_pruebas_tickets: true, reapertura: "reabrir",
  retencion_actividad_dias: 90, retencion_errores_dias: 180, limite_eventos_dia: 50000, limite_eventos_sesion: 400, limite_eventos_ip_minuto: 300,
  linear_modo: "prueba", linear_equipo_id: null, linear_proyecto_id: null, linear_etiquetas: [], linear_estado_reabrir_id: null, linear_max_tickets_dia: 10,
  ia_activada: true, ia_max_analisis_dia: 20, linear_tickets_externos: false, entorno_bd: "demo", actualizado_en: "2026-11-14T08:00:00Z", ...o,
});

/** Como la página: la subpestaña vive fuera (en la URL). */
function ConUrl({ inicial = "recogida", onSub, onCambios }: { inicial?: Sub; onSub?: (s: string) => void; onCambios?: (h: boolean) => void }) {
  const [sub, setSub] = useState(subpestanaConfig(inicial));
  return <PestanaConfiguracion estado={undefined} sub={sub} onSub={(s) => { onSub?.(s); setSub(s); }} onCambiosSinGuardar={onCambios} />;
}
const irA = (nombre: RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name: nombre }), { button: 0, ctrlKey: false });

beforeEach(() => {
  config = base();
  guardar.mockClear();
});

describe("subpestañas (lógica)", () => {
  it("la de la URL o, si no existe, «Recogida»", () => {
    expect(subpestanaConfig("linear")).toBe("linear");
    expect(subpestanaConfig("inventada")).toBe("recogida");
    expect(subpestanaConfig(null)).toBe("recogida");
    expect(SUBPESTANAS_CONFIG.map((x) => x.etiqueta)).toEqual(["Recogida", "Incidencias y avisos", "Linear", "IA y costes", "Retención y límites", "Estado y cobertura"]);
  });
  it("sabe qué subpestañas tienen cambios sin guardar", () => {
    expect(subpestanasConCambios(base(), base())).toEqual([]);
    expect(subpestanasConCambios(base(), base({ retencion_errores_dias: 30, linear_max_tickets_dia: 3 }))).toEqual(["linear", "retencion"]);
    expect(subpestanasConCambios(base(), base({ linear_tickets_externos: true }))).toEqual(["incidencias"]);
  });
});

describe("Configuración en subpestañas", () => {
  it("solo se ve la subpestaña elegida (sin scroll infinito) y al cambiar se guarda en la URL", () => {
    const onSub = vi.fn();
    render(<ConUrl onSub={onSub} />);
    // Radix deja el panel oculto vacío: lo que importa es que su contenido no está.
    expect(screen.getByLabelText(/Rutas excluidas/)).toBeInTheDocument();
    expect(screen.queryByTestId("pasos-linear")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tabla-cobertura")).not.toBeInTheDocument();
    irA(/^Linear/);
    expect(onSub).toHaveBeenLastCalledWith("linear");
    expect(screen.getByTestId("pasos-linear")).toHaveTextContent("Cómo conectar Linear");
    expect(screen.queryByLabelText(/Rutas excluidas/)).not.toBeInTheDocument();
  });
  it("un enlace con ?config=retencion abre esa subpestaña", () => {
    render(<ConUrl inicial="retencion" />);
    expect(screen.getByLabelText("Retención de errores (días)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Rutas excluidas/)).not.toBeInTheDocument();
  });
  it("un solo borrador: lo cambiado en una subpestaña se marca, se conserva al cambiar de subpestaña y se guarda todo junto", () => {
    const onCambios = vi.fn();
    render(<ConUrl inicial="retencion" onCambios={onCambios} />);
    expect(screen.queryByTestId("aviso-sin-guardar")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Retención de errores (días)"), { target: { value: "30" } });
    expect(screen.getByTestId("sin-guardar-retencion")).toBeInTheDocument();
    expect(screen.getByTestId("aviso-sin-guardar")).toHaveTextContent("Cambios sin guardar en: Retención y límites.");
    expect(onCambios).toHaveBeenLastCalledWith(true);
    irA(/^Linear/);
    fireEvent.change(screen.getByLabelText("Tickets nuevos por día (máx.)"), { target: { value: "4" } });
    expect(screen.getByTestId("aviso-sin-guardar")).toHaveTextContent("Cambios sin guardar en: Linear, Retención y límites.");
    fireEvent.click(screen.getByRole("button", { name: /Guardar configuración/ }));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0][0]).toMatchObject({ retencion_errores_dias: 30, linear_max_tickets_dia: 4 });
    expect(guardar.mock.calls[0][0]).not.toHaveProperty("entorno_bd");
  });
  it("«Descartar» vuelve a lo guardado", () => {
    render(<ConUrl inicial="ia" />);
    fireEvent.change(screen.getByLabelText("Llamadas de IA por día"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }));
    expect(screen.queryByTestId("aviso-sin-guardar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Llamadas de IA por día")).toHaveValue(20);
  });
  it("«Incidencias y avisos»: colores y el interruptor de los servicios externos", () => {
    render(<ConUrl inicial="incidencias" />);
    const panel = screen.getByTestId("config-incidencias");
    expect(within(panel).getByTestId("leyenda-origen")).toBeInTheDocument();
    const interruptor = within(panel).getByRole("switch", { name: /servicios externos .* también pueden abrir ticket/ });
    expect(interruptor).toHaveAttribute("aria-checked", "false");
    fireEvent.click(interruptor);
    expect(screen.getByTestId("sin-guardar-incidencias")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Guardar configuración/ }));
    expect(guardar.mock.calls[0][0]).toMatchObject({ linear_tickets_externos: true });
  });
  it("sin la migración del origen, lo dice en vez del interruptor", () => {
    const { linear_tickets_externos: _x, ...sin } = base();
    config = sin as ConfigLogsWeb;
    render(<ConUrl inicial="incidencias" />);
    expect(screen.queryByRole("switch", { name: /servicios externos/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("config-incidencias")).toHaveTextContent(/20261130100000_logs_web_origen/);
  });
});
