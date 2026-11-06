/**
 * Pantalla Crear (dos columnas): elegir varias fotos → Montar con IA
 * (simulado) → carrusel en la vista previa → Publicar (simulado) con progreso
 * y resultado; Programar con la hora sugerida; «Ajustar a mano» cambia un
 * rótulo; sin fotos, los botones se apagan y explican por qué.
 *
 * Drive va simulado con fetch (como en el editor antiguo). jsdom no pinta:
 * la vista previa (iframe) se sustituye por un doble que enseña el HTML de la
 * pieza en `data-documento` y da la maquetación por buena.
 */
import type { ReactNode } from "react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    not: () => consulta,
    order: () => consulta,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) },
      from: () => consulta,
    },
  };
});

vi.mock("@/components/marketing/instagram/VistaPreviaPieza", () => ({
  VistaPreviaPieza: ({ documento, onMaquetacion, vacio }: { documento: string | null; vacio?: string; onMaquetacion?: (r: { errores: string[]; avisos: string[] }) => void }) => {
    useEffect(() => {
      if (documento) onMaquetacion?.({ errores: [], avisos: [] });
    }, [documento, onMaquetacion]);
    return (
      <div data-testid="vista-previa" data-documento={documento ?? ""}>
        {documento ? "documento" : vacio ?? "sin documento"}
      </div>
    );
  },
}));

import { CrearInstagram } from "../CrearInstagram";
import { crearMontadorSimulado } from "../montar";
import { crearApiSimulada } from "../publicar";
import { URL_DRIVE } from "@/components/marketing/instagram/api";
import { textoInstante } from "@/components/instagram/programar/logica";

vi.setConfig({ testTimeout: 30_000 });

const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });
const TMP = "tmp/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg";
const IDS = ["1FotoMarisco0000000000001", "1FotoMarisco0000000000002", "1FotoMarisco0000000000003"];
const FOTOS_DRIVE = IDS.map((driveId, i) => ({
  driveId,
  nombre: `m${i}.jpg`,
  ancho: 1080,
  alto: 1350,
  tipo: "plato",
  descripcion: `Marisco ${i + 1}`,
  filaId: `f${i}`,
  creada: null,
  problema: null,
}));

function fetchDrive() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.startsWith(URL_DRIVE)) return new Response("no", { status: 404 });
    if (url.includes("accion=miniatura")) return new Response(new Blob([new Uint8Array([1])], { type: "image/jpeg" }), { status: 200, headers: { "content-type": "image/jpeg" } });
    const c = JSON.parse(String(init?.body ?? "{}"));
    if (c.accion === "listar") return json({ ok: true, alcance: "completo", avisos: [], fotos: c.marca === "casa-tomas" ? FOTOS_DRIVE : [] });
    if (c.accion === "preparar") return json({ ok: true, ruta: TMP, url: `https://x.supabase.co/storage/v1/object/public/instagram/${TMP}?${c.id}`, ancho: 1080, alto: 1350 });
    return json({ ok: false }, 400);
  });
}

function pintar(nodo: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{nodo}</QueryClientProvider>);
}

async function elegir(n: number) {
  for (const id of IDS.slice(0, n)) fireEvent.click(await screen.findByTestId(`foto-drive:${id}`, undefined, { timeout: 5000 }));
}

const documento = () => screen.getByTestId("vista-previa").getAttribute("data-documento") ?? "";

beforeEach(() => {
  vi.stubGlobal("fetch", fetchDrive());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Crear (dos columnas)", () => {
  it("sin fotos, Montar con IA y Publicar están apagados y explican por qué", async () => {
    pintar(<CrearInstagram montar={crearMontadorSimulado()} api={crearApiSimulada().api} />);
    expect(screen.getByRole("button", { name: /Montar con IA/ })).toBeDisabled();
    expect(screen.getByTestId("ayuda-montar")).toHaveTextContent("Elige al menos una foto");
    expect(screen.getByRole("button", { name: /Publicar ahora/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Programar$/ })).toBeDisabled();
    expect(screen.getByTestId("motivo-no-publicar")).toHaveTextContent("Elige al menos una foto.");
    // Sin pasos de prueba ni pestañas de Historial / Conexión.
    expect(screen.queryByText(/Prueba sin publicar/)).toBeNull();
    expect(screen.queryByText(/Generar imagen/)).toBeNull();
    expect(screen.queryByText(/^Historial$/)).toBeNull();
    expect(screen.queryByText(/^Conexión$/)).toBeNull();
    await screen.findByTestId(`foto-drive:${IDS[0]}`, undefined, { timeout: 5000 });
  });

  it("varias fotos → Montar con IA → carrusel navegable → Publicar ahora con progreso y enlace", async () => {
    const montar = crearMontadorSimulado();
    const { api, llamadas } = crearApiSimulada({ retraso: 30 });
    pintar(<CrearInstagram montar={montar} api={api} />);
    await elegir(3);
    expect(screen.getByTestId("contador-fotos")).toHaveTextContent("3 de 10");
    expect(within(screen.getByTestId("orden-fotos")).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/Pulsa «Montar con IA» para ver/)).toBeInTheDocument();
    expect(screen.getByTestId("motivo-no-publicar")).toHaveTextContent("Montar con IA");

    fireEvent.change(screen.getByLabelText(/¿Qué quieres contar\?/), { target: { value: "marisco fresco del finde" } });
    fireEvent.click(screen.getByRole("radio", { name: "Elegante" }));
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));

    expect(await screen.findByTestId("resumen-ia")).toHaveTextContent("He entendido: 3 fotos");
    expect(montar.peticiones[0]).toMatchObject({ marca: "casa-tomas", formato: "auto", indicacion: "marisco fresco del finde", tono: "elegante" });
    expect(montar.peticiones[0].fotos.map((f) => f.id)).toEqual(IDS.map((i) => `drive:${i}`));
    expect(montar.peticiones[0].fotos[0].url).toContain("/storage/v1/object/public/instagram/tmp/");
    expect((screen.getByLabelText("Texto de la publicación") as HTMLTextAreaElement).value).toMatch(/marisco fresco del finde/);
    expect(within(screen.getByTestId("hashtags")).getByText("#casatomas")).toBeInTheDocument();

    // Carrusel: imagen 1 de 3, flechas.
    await waitFor(() => expect(documento()).toContain("Recién llegado"));
    expect(screen.getByTestId("marco-instagram")).toHaveAttribute("aria-label", expect.stringContaining("imagen 1 de 3"));
    expect(screen.queryByRole("button", { name: "Imagen anterior" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Imagen siguiente" }));
    await waitFor(() => expect(documento()).toContain("Del mar a la mesa"));
    expect(screen.getByTestId("puntos-carrusel").children).toHaveLength(3);

    await waitFor(() => expect(screen.getByRole("button", { name: /Publicar ahora/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Publicar ahora/ }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("carrusel de 3 imágenes");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Publicar" }));

    expect(await screen.findByText(/Preparando imágenes \d\/3/)).toBeInTheDocument();
    const resultado = await screen.findByTestId("resultado-publicacion", undefined, { timeout: 5000 });
    expect(resultado).toHaveTextContent("Publicada en Instagram.");
    expect(within(resultado).getByRole("link", { name: /Ver la publicación/ })).toHaveAttribute("href", "https://www.instagram.com/p/simulada/");

    expect(llamadas.renderizar).toHaveLength(3);
    expect(llamadas.renderizar[0].fotoPreparada?.url).toContain(TMP);
    expect(llamadas.renderizar[1].pieza).toMatchObject({ formato: "post", titular: "Del mar a la mesa", foto: `drive:${IDS[1]}` });
    expect(llamadas.publicarAhora[0]).toMatchObject({ formato: "carrusel", piezaIds: ["pieza-1", "pieza-2", "pieza-3"] });
    expect(llamadas.publicarAhora[0].caption).toMatch(/#casatomas #crevillent #comerbien$/);
    expect(llamadas.publicarAhora[0].altTexts[0]).toMatch(/Foto 1 de 3/);

    fireEvent.click(within(resultado).getByRole("button", { name: "Crear otra" }));
    expect(screen.getByTestId("contador-fotos")).toHaveTextContent("0 de 10");
  });

  it("Programar usa la hora sugerida por la IA", async () => {
    const sugerida = new Date(Date.now() + 3 * 86_400_000);
    sugerida.setUTCSeconds(0, 0);
    const montar = crearMontadorSimulado({ horaSugerida: sugerida.toISOString() });
    const { api, llamadas } = crearApiSimulada();
    const onVerCalendario = vi.fn();
    pintar(<CrearInstagram montar={montar} api={api} onVerCalendario={onVerCalendario} />);
    await elegir(1);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    await screen.findByTestId("resumen-ia");
    expect(screen.getByTestId("hora-programar")).toHaveTextContent(textoInstante(sugerida));

    await waitFor(() => expect(screen.getByRole("button", { name: /^Programar$/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^Programar$/ }));
    const resultado = await screen.findByTestId("resultado-publicacion");
    expect(resultado).toHaveTextContent(`Programada para el ${textoInstante(sugerida)}`);
    expect(llamadas.publicarAhora).toHaveLength(0);
    expect(llamadas.programar).toHaveLength(1);
    expect(llamadas.programar[0].instante.toISOString()).toBe(sugerida.toISOString());
    expect(llamadas.programar[0]).toMatchObject({ formato: "post", piezaIds: ["pieza-1"] });
    fireEvent.click(within(resultado).getByRole("button", { name: "Ver en el calendario" }));
    expect(onVerCalendario).toHaveBeenCalled();
  });

  it("«Ajustar a mano» cambia el rótulo de una imagen y la vista previa lo enseña", async () => {
    pintar(<CrearInstagram montar={crearMontadorSimulado()} api={crearApiSimulada().api} />);
    await elegir(2);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    await screen.findByTestId("resumen-ia");

    fireEvent.click(screen.getByRole("button", { name: /Ajustar a mano/ }));
    const ajustes = await screen.findByTestId("ajustar-a-mano");
    fireEvent.click(within(ajustes).getByRole("button", { name: "2" }));
    expect(within(ajustes).getByText("Imagen 2 de 2")).toBeInTheDocument();
    expect((within(ajustes).getByLabelText(/Texto alternativo/) as HTMLTextAreaElement).value).toMatch(/Foto 2 de 2/);
    const titular = within(ajustes).getByLabelText("Titular") as HTMLInputElement;
    expect(titular.value).toBe("Del mar a la mesa");
    fireEvent.change(titular, { target: { value: "Gamba roja" } });
    // La vista previa sigue a la imagen que se retoca.
    await waitFor(() => expect(documento()).toContain("Gamba roja"));
    expect(screen.getByTestId("marco-instagram")).toHaveAttribute("aria-label", expect.stringContaining("imagen 2 de 2"));
  });

  it("si la IA falla, lo dice y no cambia nada", async () => {
    pintar(<CrearInstagram montar={crearMontadorSimulado({ fallo: "La IA no está disponible ahora." })} api={crearApiSimulada().api} />);
    await elegir(1);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La IA no está disponible ahora.");
    expect(screen.queryByTestId("resumen-ia")).toBeNull();
    expect(screen.getByRole("button", { name: /Publicar ahora/ })).toBeDisabled();
  });
});
