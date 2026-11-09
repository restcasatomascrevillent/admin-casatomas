/**
 * Puntuación Parker en el panel (08/11/2026): reglas de los estados, búsqueda en
 * segundo plano y el bloque del formulario tras leer una etiqueta.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  anadaDeNombre,
  faltaParaVerificar,
  filaDeAnada,
  filaParaGuardar,
  resultadoManual,
  resumenParker,
  textoPuntos,
  type FilaParker,
  type ResultadoParker,
} from "../parker/parker";
import { useBusquedaParker } from "../parker/useBusquedaParker";
import { PanelParker } from "../parker/PanelParker";
import type { DatosVinoFoto } from "../leerVinoFoto";

const RES: ResultadoParker = {
  estado: "verificada", motivo: null, anada: 2021, sin_anada: false, puntos_texto: "94", puntos_min: 94, puntos_max: 94,
  provisional: false, vino_evaluado: "Aalto 2021", entidad: "Robert Parker Wine Advocate", critico: "Luis Gutiérrez",
  fecha_valoracion: "2024-06", fuente_nombre: "Vin Chicago", fuente_url: "https://vinchicago.com/aalto-2021", fuente_tipo: "secundaria",
  cita: "Wine Advocate: 94 Points", fecha_consulta: "2026-11-08", discrepancias: [], notas: null, comprobado_en_pagina: true,
};
const fila = (p: Partial<FilaParker>): FilaParker => ({ ...RES, id: "f", vino_id: "v", origen: "revision", updated_at: "", ...p });

describe("reglas Parker del panel", () => {
  it("añada del nombre y fila de la añada que se sirve (nunca otra)", () => {
    expect(anadaDeNombre("Vega Sicilia Valbuena 2018 (Magnum)")).toBe(2018);
    expect(anadaDeNombre("Gran Reserva 904 (La Rioja Alta)")).toBeNull();
    const filas = [fila({ id: "a", anada: 2021 }), fila({ id: "nv", anada: null, sin_anada: true })];
    expect(filaDeAnada(filas, 2021, false)?.id).toBe("a");
    expect(filaDeAnada(filas, 2022, false)).toBeNull();
    expect(filaDeAnada(filas, null, true)?.id).toBe("nv");
    expect(filaDeAnada(filas, null, false)).toBeNull();
  });

  it("intervalos y provisionales se enseñan tal cual", () => {
    expect(textoPuntos({ puntos_texto: "(93-95)", puntos_min: 93, puntos_max: 95, provisional: true })).toBe("(93-95) (provisional)");
    expect(textoPuntos({ puntos_texto: null, puntos_min: 93, puntos_max: 95, provisional: false })).toBe("93–95");
    expect(textoPuntos({ puntos_texto: null, puntos_min: null, puntos_max: null, provisional: false })).toBeNull();
  });

  it("resumen de la lista: publicada, falta añada, revisar, añada desconocida", () => {
    expect(resumenParker({ puntuacion_parker: 94, puntuacion_parker_texto: "94+", puntuacion_parker_anada: 2021 }, []).texto).toBe("94+ RP");
    expect(resumenParker({ anada: null }, [fila({ anada: 2022 })]).tipo).toBe("falta_anada");
    expect(resumenParker({ anada: null }, [fila({ estado: "revision" })]).tipo).toBe("revision");
    expect(resumenParker({ anada: null }, [fila({ estado: "no_localizada", motivo: "anada_desconocida", anada: null, puntos_min: null })]).tipo).toBe("anada_desconocida");
    expect(resumenParker({ anada: 2023 }, [fila({ anada: 2021 })]).tipo).toBe("pendiente");
    expect(resumenParker({ anada: 2021 }, [fila({ estado: "no_localizada", motivo: "no_localizada", puntos_min: null })]).texto).toBe("Parker: no localizada");
    expect(resumenParker({}, []).tipo).toBe("sin_datos");
  });

  it("verificada exige puntos, fuente con URL y añada; a mano solo si se ha comprobado", () => {
    expect(faltaParaVerificar({ ...RES, fuente_url: null, anada: null })).toEqual(["la URL de la fuente", "la añada"]);
    const sinComprobar = resultadoManual({ puntos: "94+", anada: 2021, sin_anada: false, fuente_nombre: "robertparker.com", fuente_url: "https://www.robertparker.com/x", comprobada: false });
    expect(sinComprobar.resultado).toMatchObject({ estado: "revision", puntos_texto: "94+", puntos_min: 94, fuente_tipo: "manual" });
    expect(resultadoManual({ puntos: "94", anada: 2021, sin_anada: false, fuente_nombre: "x", fuente_url: "", comprobada: true }).error).toMatch(/URL/);
    expect(resultadoManual({ puntos: "noventa", anada: 2021, sin_anada: false, fuente_nombre: "x", fuente_url: "", comprobada: false }).error).toMatch(/94/);
    expect(resultadoManual({ puntos: "93-95", anada: 2021, sin_anada: false, fuente_nombre: "x", fuente_url: "https://x.es", comprobada: true }).resultado)
      .toMatchObject({ estado: "verificada", puntos_min: 93, puntos_max: 95 });
    expect(filaParaGuardar("v", { ...RES, sin_anada: true, anada: 2015 }, "foto")).toMatchObject({ vino_id: "v", anada: null, sin_anada: true, origen: "foto" });
  });
});

describe("useBusquedaParker", () => {
  it("buscando → hecha; una respuesta vieja se ignora", async () => {
    let resolver: (v: { resultado: ResultadoParker; desdeCache: boolean }) => void = () => {};
    const buscar = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolver = r; })).mockResolvedValueOnce({ resultado: { ...RES, anada: 2022 }, desdeCache: true });
    const { result } = renderHook(() => useBusquedaParker(buscar));
    act(() => { void result.current.lanzar({ nombre: "Aalto", anada: 2021, sin_anada: false }); });
    expect(result.current.fase).toBe("buscando");
    await act(async () => { await result.current.lanzar({ nombre: "Aalto", anada: 2022, sin_anada: false }); });
    await act(async () => { resolver({ resultado: RES, desdeCache: false }); });
    expect(result.current).toMatchObject({ fase: "hecha", desdeCache: true, resultado: { anada: 2022 } });
  });

  it("si falla: «fallida» con el motivo (la ficha se puede guardar igual)", async () => {
    const { result } = renderHook(() => useBusquedaParker(vi.fn().mockRejectedValue(new Error("Sin saldo en OpenAI"))));
    await act(async () => { await result.current.lanzar({ nombre: "Aalto", anada: 2021, sin_anada: false }); });
    expect(result.current).toMatchObject({ fase: "fallida", error: "Sin saldo en OpenAI", resultado: { estado: "fallida", motivo: "busqueda_fallida", anada: 2021 } });
  });
});

function Prueba({ datos, buscar, valores = {} }: { datos: DatosVinoFoto | null; buscar: ReturnType<typeof vi.fn>; valores?: Record<string, unknown> }) {
  const form = useForm({ defaultValues: { nombre: "Cuesta de las Liebres", denominacion_origen: "D.O. Ribera del Duero", anada: "", sin_anada: false, ...valores } });
  const busqueda = useBusquedaParker(buscar);
  return (
    <Form {...form}>
      <PanelParker control={form.control} getValues={form.getValues} setValue={form.setValue} busqueda={busqueda} datosEtiqueta={datos} incluirConFicha onIncluirConFicha={() => {}} />
    </Form>
  );
}

const etiqueta = (p: Partial<DatosVinoFoto>): DatosVinoFoto => ({
  nombre: "Cuesta de las Liebres", categoria: null, descripcion: null, ingredientes: null, denominacion_origen: null,
  ubicacion_region: null, ubicacion_pais: null, bodega: "Pago de Carraovejas", cuvee: "Cuesta de las Liebres",
  anada: null, sin_anada: false, identificacion_ambigua: false, motivo_ambiguedad: null, puntuaciones_etiqueta: [], ...p,
});

describe("PanelParker tras leer la etiqueta", () => {
  it("añada legible: la pone y busca sola en segundo plano; enseña la fuente", async () => {
    const buscar = vi.fn().mockResolvedValue({ resultado: { ...RES, vino_evaluado: "Cuesta de las Liebres 2021" }, desdeCache: false });
    render(<Prueba datos={etiqueta({ anada: 2021 })} buscar={buscar} />);
    await waitFor(() => expect(buscar).toHaveBeenCalledWith(expect.objectContaining({ nombre: "Cuesta de las Liebres", bodega: "Pago de Carraovejas", anada: 2021, sin_anada: false, forzar: false })));
    expect(screen.getByLabelText("Añada que se sirve")).toHaveValue("2021");
    const resultado = await screen.findByTestId("parker-resultado");
    expect(resultado).toHaveTextContent("Verificada");
    expect(resultado).toHaveTextContent("94 pts");
    expect(screen.getByRole("link", { name: /Vin Chicago/ })).toHaveAttribute("href", "https://vinchicago.com/aalto-2021");
    expect(resultado).toHaveTextContent("consultada el 08/11/2026");
  });

  it("sin añada legible: no busca y pide confirmarla; al escribirla se puede buscar", async () => {
    const buscar = vi.fn().mockResolvedValue({ resultado: RES, desdeCache: false });
    render(<Prueba datos={etiqueta({ anada: null })} buscar={buscar} />);
    expect(await screen.findByTestId("parker-pide-anada")).toHaveTextContent("No se distingue la añada");
    expect(buscar).not.toHaveBeenCalled();
    const boton = screen.getByRole("button", { name: "Buscar puntuación" });
    expect(boton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Añada que se sirve"), { target: { value: "2021" } });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    await waitFor(() => expect(buscar).toHaveBeenCalledWith(expect.objectContaining({ anada: 2021 })));
  });

  it("identificación dudosa: no busca hasta que se confirme", async () => {
    const buscar = vi.fn();
    render(<Prueba datos={etiqueta({ anada: 2021, identificacion_ambigua: true, motivo_ambiguedad: "Solo se lee la bodega" })} buscar={buscar} />);
    expect(await screen.findByText(/no tiene claro qué vino es: Solo se lee la bodega/)).toBeInTheDocument();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("puntuaciones impresas: con su entidad y nunca como Parker", async () => {
    render(
      <Prueba
        buscar={vi.fn().mockResolvedValue({ resultado: RES, desdeCache: false })}
        datos={etiqueta({
          anada: 2021,
          puntuaciones_etiqueta: [
            { texto: "93 Peñín", puntos: 93, entidad: "Guía Peñín", entidad_tipo: "otra", anada: 2021 },
            { texto: "95 pts", puntos: 95, entidad: null, entidad_tipo: "desconocida", anada: 2019 },
          ],
        })}
      />,
    );
    const lista = await screen.findByTestId("parker-etiqueta");
    expect(lista).toHaveTextContent("93 pts · Guía Peñín — no es Parker");
    expect(lista).toHaveTextContent("95 pts · entidad no legible — no se da por Parker (dice añada 2019)");
  });

  it("si la búsqueda falla lo dice y se puede reintentar", async () => {
    const buscar = vi.fn().mockRejectedValueOnce(new Error("La búsqueda ha tardado demasiado")).mockResolvedValueOnce({ resultado: RES, desdeCache: false });
    render(<Prueba datos={etiqueta({ anada: 2021 })} buscar={buscar} />);
    expect(await screen.findByText(/La búsqueda falló: La búsqueda ha tardado demasiado\. Puedes guardar la ficha sin puntuación/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buscar de nuevo" }));
    await waitFor(() => expect(buscar).toHaveBeenLastCalledWith(expect.objectContaining({ forzar: true })));
  });

  it("NV de la etiqueta: marca «Sin añada» y busca la edición", async () => {
    const buscar = vi.fn().mockResolvedValue({ resultado: { ...RES, anada: null, sin_anada: true }, desdeCache: false });
    render(<Prueba datos={etiqueta({ nombre: "Krug Grande Cuvée 170ème Édition", sin_anada: true })} buscar={buscar} valores={{ nombre: "Krug Grande Cuvée 170ème Édition" }} />);
    await waitFor(() => expect(buscar).toHaveBeenCalledWith(expect.objectContaining({ anada: null, sin_anada: true })));
    expect(screen.getByLabelText("Añada que se sirve")).toBeDisabled();
  });
});
