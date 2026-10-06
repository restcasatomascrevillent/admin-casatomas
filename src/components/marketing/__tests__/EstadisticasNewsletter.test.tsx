/**
 * Pestaña Newsletter › Estadísticas: las tarjetas, el desglose y los porcentajes salen de la MISMA
 * cuenta y cuadran entre sí. Supabase: doble en memoria con el tope de 1.000 filas de PostgREST.
 *
 * Y todo cabe en el alto de la ventana sin scroll (petición del dueño, 2026-10-06): cabecera en una
 * fila con la explicación larga en una ayuda, tarjetas bajas, la gráfica en un contenedor flexible
 * que ocupa el resto y el historial al lado. jsdom no calcula layout: aquí se prueba la estructura
 * (las medidas reales están en las capturas de Playwright).
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleSupabase } = await import("@/lib/reservas/__tests__/dobleSupabaseLotes");
  return { supabase: crearDobleSupabase() };
});

// Recharts en jsdom no mide nada; la tendencia se prueba en lib/newsletter. El contenedor sí se
// pinta, con el ancho y el alto que se le piden: la gráfica tiene que llenar su hueco flexible.
vi.mock("recharts", async () => {
  const { createElement } = await import("react");
  const Nada = () => null;
  return {
    LineChart: Nada,
    Line: Nada,
    XAxis: Nada,
    YAxis: Nada,
    CartesianGrid: Nada,
    Tooltip: Nada,
    Legend: Nada,
    ResponsiveContainer: ({ width, height }: { width?: number | string; height?: number | string }) =>
      createElement("div", { "data-testid": "contenedor-recharts", "data-ancho": String(width), "data-alto": String(height) }),
  };
});

import { supabase } from "@/integrations/supabase/client";
import type { DobleSupabase } from "@/lib/reservas/__tests__/dobleSupabaseLotes";
import { EstadisticasNewsletter } from "../EstadisticasNewsletter";

const doble = supabase as unknown as DobleSupabase;

let secuencia = 0;
function fila(email_id: string, tipo_evento: string, instante?: string) {
  secuencia++;
  const cuando = instante ?? new Date(Date.UTC(2026, 9, 5, 8, 0, 0) + secuencia * 1000).toISOString();
  return {
    id: `ev-${String(secuencia).padStart(6, "0")}`,
    email_id,
    tipo_evento,
    email_destinatario: `${email_id}@example.com`,
    timestamp_evento: cuando,
    created_at: cuando,
    metadata: null,
  };
}

/** Correos de HOY (enviados y entregados): así la tendencia de 7 días no está vacía y se pinta la gráfica. */
function correosDeHoy(n: number) {
  const hoy = new Date().toISOString();
  return Array.from({ length: n }, (_, i) => [fila(`hoy-${i}`, "sent", hoy), fila(`hoy-${i}`, "delivered", hoy)]).flat();
}

function pintar(historial?: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EstadisticasNewsletter historial={historial} />
    </QueryClientProvider>,
  );
}

/** Tarjeta superior por su título: su porcentaje y su línea «n de N correos». */
function tarjeta(titulo: string) {
  const el = screen.getAllByText(titulo)[0].closest(".rounded-lg") as HTMLElement;
  return within(el);
}

/** Casilla del desglose por su etiqueta: la cifra grande de encima. */
function desglose(etiqueta: string) {
  const seccion = screen.getByText("Desglose").closest(".rounded-lg") as HTMLElement;
  const casilla = within(seccion).getByText(etiqueta).parentElement as HTMLElement;
  return casilla.firstElementChild?.textContent;
}

const TEXTO_LARGO = /todos los correos que envía el restaurante: los de las reservas y los de la newsletter/i;

beforeEach(() => {
  doble.reiniciar();
  secuencia = 0;
});

describe("EstadisticasNewsletter", () => {
  it("el caso del dueño (30 enviados, 30 entregados, 5 abiertos, 4 con clic) cuadra en tarjetas y desglose", async () => {
    const filas = [];
    for (let i = 0; i < 30; i++) {
      filas.push(fila(`m${i}`, "sent"), fila(`m${i}`, "delivered"));
      if (i < 5) filas.push(fila(`m${i}`, "opened"), fila(`m${i}`, "opened")); // dos aperturas
      if (i < 4) filas.push(fila(`m${i}`, "clicked"));
    }
    filas.push(fila("contact.updated:c1", "contact.updated")); // no es un correo
    doble.tablas.email_eventos = filas;

    pintar();
    await screen.findByText("Desglose");

    // Antes: «39 entregados» y «9 abiertos» en las tarjetas.
    expect(screen.queryByText(/39 entregados/)).toBeNull();
    expect(screen.queryByText(/9 abiertos/)).toBeNull();

    expect(tarjeta("Entregados").getByText("100%")).toBeInTheDocument();
    expect(tarjeta("Entregados").getByText("30 de 30 correos")).toBeInTheDocument();
    expect(tarjeta("Abiertos").getByText("17%")).toBeInTheDocument();
    expect(tarjeta("Abiertos").getByText("5 de 30 correos")).toBeInTheDocument();
    expect(tarjeta("Con clic").getByText("13%")).toBeInTheDocument();
    expect(tarjeta("Con clic").getByText("4 de 30 correos")).toBeInTheDocument();

    expect(desglose("Enviados")).toBe("30");
    expect(desglose("Entregados")).toBe("30");
    expect(desglose("Abiertos")).toBe("5");
    expect(desglose("Con clic")).toBe("4");

    // La explicación en llano de qué correos cuenta sigue ahí: en la ayuda «i» de la cabecera.
    fireEvent.click(screen.getByRole("button", { name: "Qué cuentan estas estadísticas" }));
    expect(await screen.findByText(TEXTO_LARGO)).toBeInTheDocument();
  });

  it("con más de 1.000 eventos (tope de PostgREST) sigue contando todos los correos", async () => {
    const filas = [];
    for (let i = 0; i < 400; i++) filas.push(fila(`m${i}`, "sent"), fila(`m${i}`, "delivered"), fila(`m${i}`, "opened"));
    doble.tablas.email_eventos = filas;

    pintar();
    await screen.findByText("Desglose");
    expect(desglose("Enviados")).toBe("400");
    expect(desglose("Abiertos")).toBe("400");
    expect(tarjeta("Abiertos").getByText("100%")).toBeInTheDocument();
  });

  it("ya no muestra los últimos movimientos ni el aviso del webhook", async () => {
    doble.tablas.email_eventos = [fila("a", "sent"), fila("a", "delivered")];
    pintar();
    await screen.findByText("Desglose");
    expect(screen.queryByText(/Últimos movimientos/i)).toBeNull();
    expect(screen.queryByText(/Detalle técnico/i)).toBeNull();
    expect(screen.queryByText(/webhook/i)).toBeNull();
    expect(screen.queryByText(/a@example.com/)).toBeNull();
  });
});

describe("EstadisticasNewsletter · todo cabe sin scroll (2026-10-06)", () => {
  it("cabecera en UNA fila: título de sección, ayuda «i» con el texto largo y Actualizar compacto que refresca", async () => {
    doble.tablas.email_eventos = correosDeHoy(3);
    pintar();
    const titulo = await screen.findByRole("heading", { name: "Estadísticas de los correos" });
    // Tamaño de sección, no de página.
    expect(titulo).toHaveClass("text-base");
    expect(titulo).not.toHaveClass("text-lg");

    // El párrafo largo ya no ocupa alto: solo se lee al abrir la ayuda (con un toque o con el teclado).
    expect(screen.queryByText(TEXTO_LARGO)).toBeNull();
    const ayuda = screen.getByRole("button", { name: "Qué cuentan estas estadísticas" });
    const actualizar = screen.getByRole("button", { name: "Actualizar" });

    // Título, ayuda y botón en la misma fila, que no se parte en dos.
    const filaCabecera = actualizar.parentElement as HTMLElement;
    expect(filaCabecera).toContainElement(titulo);
    expect(filaCabecera).toContainElement(ayuda);
    expect(filaCabecera).toHaveClass("flex", "items-center", "justify-between");
    expect(filaCabecera.className).not.toMatch(/flex-wrap/);

    // Botón compacto con icono y texto: 36 px con ratón y 44 px con el dedo.
    expect(actualizar).toHaveClass("h-9", "pointer-coarse:h-11");
    expect(actualizar).not.toHaveClass("min-h-11");
    expect(actualizar.querySelector("svg")).not.toBeNull();

    fireEvent.click(ayuda);
    expect(await screen.findByRole("dialog")).toHaveTextContent(TEXTO_LARGO);

    // Actualizar vuelve a leer los correos.
    const lecturas = () => doble.peticiones.filter((p) => p.tabla === "email_eventos").length;
    const antes = lecturas();
    fireEvent.click(actualizar);
    await waitFor(() => expect(lecturas()).toBeGreaterThan(antes));
  });

  it("las 4 tarjetas van en UNA fila, bajas, cada una con su nombre accesible, su cifra y su «n de N correos»", async () => {
    doble.tablas.email_eventos = [...correosDeHoy(3), fila("hoy-0", "opened", new Date().toISOString())];
    pintar();
    await screen.findByText("Desglose");

    const filaTarjetas = screen.getByTestId("tarjetas-correos");
    expect(filaTarjetas).toHaveClass("grid", "sm:grid-cols-4");
    const tarjetas = within(filaTarjetas).getAllByRole("group");
    expect(tarjetas.map((t) => t.getAttribute("aria-labelledby") && document.getElementById(t.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Enviados",
      "Entregados",
      "Abiertos",
      "Con clic",
    ]);

    const datos: Array<[string, string, string]> = [
      ["Enviados", "3", "correos enviados"],
      ["Entregados", "100%", "3 de 3 correos"],
      ["Abiertos", "33%", "1 de 3 correos"],
      ["Con clic", "0%", "0 de 3 correos"],
    ];
    for (const [nombre, cifra, detalle] of datos) {
      const t = screen.getByRole("group", { name: nombre });
      // Menos relleno que la tarjeta de siempre (CardHeader + CardContent, 24 px por lado).
      expect(t).toHaveClass("p-3");
      expect(t.querySelector('[class*="p-6"]')).toBeNull();
      // La cifra sigue grande (24 px) y el detalle legible (12 px), en la misma tarjeta.
      expect(within(t).getByText(cifra)).toHaveClass("text-2xl", "font-bold");
      expect(within(t).getByText(detalle)).toHaveClass("text-xs");
    }
  });

  it("la gráfica llena el hueco que queda: contenedor flexible con ResponsiveContainer al 100 %, leyenda en la fila del título y tabla para el lector de pantalla", async () => {
    doble.tablas.email_eventos = correosDeHoy(2);
    pintar(<p>Historial de prueba</p>);
    const figura = await screen.findByRole("figure", { name: "Últimos 7 días" });

    const contenedor = within(figura).getByTestId("contenedor-recharts");
    expect(contenedor).toHaveAttribute("data-ancho", "100%");
    expect(contenedor).toHaveAttribute("data-alto", "100%");
    // Ya no es una caja de alto fijo (`h-64`): ocupa lo que le deja la tarjeta, que crece.
    const capa = contenedor.parentElement as HTMLElement;
    expect(capa).toHaveClass("absolute", "inset-0");
    const lienzo = capa.parentElement as HTMLElement;
    expect(lienzo).toHaveClass("relative", "flex-1", "min-h-0");
    expect(figura).toHaveClass("flex", "flex-1", "flex-col");
    expect(figura.querySelector(".h-64")).toBeNull();

    // La zona de la gráfica se queda con el resto del alto; desde `lg`, en dos columnas con el historial.
    const zona = screen.getByTestId("zona-grafica");
    expect(zona).toHaveClass("md:flex-1");
    expect(zona.className).toContain("md:grid-rows-[minmax(15rem,1fr)_minmax(0,auto)]");
    expect(zona.className).toContain("lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]");
    expect(zona).toContainElement(screen.getByText("Historial de prueba"));

    // Título pequeño con la leyenda (las 4 series) en la misma fila.
    const titulo = within(figura).getByRole("heading", { name: "Últimos 7 días" });
    expect(titulo).toHaveClass("text-sm");
    const leyenda = within(figura).getByRole("list", { name: "Leyenda" });
    expect(leyenda.parentElement).toContainElement(titulo);
    expect(within(leyenda).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Enviados", "Entregados", "Abiertos", "Con clic"]);

    // Los datos de la gráfica, legibles sin verla: una fila por día de los últimos 7. Oculta a la vista
    // con un <div> `sr-only` alrededor: en la propia <table> no vale (no respeta el ancho de 1 px y
    // desbordaba el móvil 40 px en horizontal).
    const tabla = within(figura).getByRole("table");
    expect(within(tabla).getAllByRole("row")).toHaveLength(8);
    expect(tabla.parentElement).toHaveClass("sr-only");
    expect(tabla).not.toHaveClass("sr-only");
  });

  it("sin scroll interno cuando cabe: el bloque mide justo el alto de la pestaña y nada dentro desplaza; el historial recibe el alto que sobra", async () => {
    doble.tablas.email_eventos = correosDeHoy(2);
    pintar(<p>Historial de prueba</p>);
    await screen.findByRole("figure", { name: "Últimos 7 días" });

    const raiz = screen.getByTestId("estadisticas-correos");
    expect(raiz).toHaveClass("flex", "flex-col", "md:h-full");
    expect(raiz.className).not.toMatch(/space-y-6/);
    // Ningún contenedor con scroll propio en las estadísticas (cabecera, tarjetas, gráfica, desglose).
    expect(raiz.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="overflow-scroll"]')).toHaveLength(0);
    // Cabecera y tarjetas no encogen; la zona de la gráfica sí se reparte el resto.
    expect(screen.getByTestId("tarjetas-correos")).toHaveClass("shrink-0");

    // El historial va en la columna del desglose, con el alto que quede (flex-1) y sin forzar más.
    const historial = screen.getByText("Historial de prueba");
    expect(historial.parentElement).toHaveClass("flex-1", "min-h-0");
    const columna = (screen.getByText("Desglose").closest(".rounded-lg") as HTMLElement).parentElement as HTMLElement;
    expect(columna).toContainElement(historial);
  });

  it("estado de carga intacto: indicador con nombre accesible y el historial sigue a la vista", async () => {
    doble.opciones.antesDeResponder = () => new Promise<void>(() => {}); // la lectura no termina nunca
    pintar(<p>Historial de prueba</p>);
    expect(await screen.findByRole("status", { name: "Cargando las estadísticas" })).toBeInTheDocument();
    expect(screen.getByText("Historial de prueba")).toBeInTheDocument();
    expect(screen.queryByText("Desglose")).toBeNull();
  });

  it("estado vacío intacto: sin correos, todo a cero, sin gráfica y el desglose y el historial a todo el ancho", async () => {
    doble.tablas.email_eventos = [];
    pintar(<p>Historial de prueba</p>);
    await screen.findByText("Desglose");

    expect(within(screen.getByRole("group", { name: "Enviados" })).getByText("0")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Enviados" })).getByText("correos enviados")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Entregados" })).getByText("0%")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Entregados" })).getByText("0 de 0 correos")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.queryByTestId("contenedor-recharts")).toBeNull();
    expect(desglose("No entregados")).toBe("0");
    expect(desglose("Marcados como spam")).toBe("0");

    // Sin gráfica no hay dos columnas: desglose (6 en fila) e historial ocupan todo el ancho.
    const zona = screen.getByTestId("zona-grafica");
    expect(zona.className).not.toContain("lg:grid-cols-");
    const rejillaDesglose = (screen.getByText("Desglose").closest(".rounded-lg") as HTMLElement).querySelector(".grid") as HTMLElement;
    expect(rejillaDesglose).toHaveClass("sm:grid-cols-6");
    expect(rejillaDesglose.className).not.toContain("lg:grid-cols-3");
    expect(screen.getByText("Historial de prueba")).toBeInTheDocument();
  });

  it("si falla la lectura: aviso con Reintentar y el historial sigue a la vista", async () => {
    doble.opciones.fallar = () => ({ message: "fallo de prueba" });
    pintar(<p>Historial de prueba</p>);
    expect(await screen.findByText("No se pudieron cargar las estadísticas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getByText("Historial de prueba")).toBeInTheDocument();
  });
});
