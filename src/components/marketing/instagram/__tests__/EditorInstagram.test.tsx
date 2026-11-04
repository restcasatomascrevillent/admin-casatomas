/**
 * Marketing › Instagram: formulario según la plantilla, contadores, fotos que no valen,
 * el orden generar → prueba → publicar (con confirmación) y las llamadas a /api con el
 * JWT. jsdom no pinta: la vista previa (iframe + comprobarMaquetacion) se sustituye por
 * un doble que da la maquetación por buena; lo de verdad se ve en las capturas.
 */
import type { ReactNode } from "react";
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const consulta = { select: () => consulta, order: () => consulta, limit: () => Promise.resolve({ data: [], error: null }) };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) },
      from: () => consulta,
    },
  };
});

vi.mock("../VistaPreviaPieza", () => ({
  VistaPreviaPieza: ({ documento, onMaquetacion }: { documento: string | null; onMaquetacion?: (r: { errores: string[]; avisos: string[] }) => void }) => {
    useEffect(() => {
      if (documento) onMaquetacion?.({ errores: [], avisos: [] });
    }, [documento, onMaquetacion]);
    return <div data-testid="vista-previa">{documento ? "documento" : "sin documento"}</div>;
  },
}));

import { EditorInstagram } from "../EditorInstagram";
import { FormularioPieza } from "../FormularioPieza";
import { borradorVacio } from "../pieza";
import { MENSAJE_SIN_SERVIDOR, URL_ESTADO, URL_PUBLICAR, normalizarEstado } from "../api";
import { obtenerPlantilla } from "@/lib/instagram";

function pintar(nodo: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{nodo}</QueryClientProvider>);
}

const respuestaJson = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });

const ID = "44444444-4444-4444-8444-444444444444";

function fetchFalso() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const cuerpo = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === "/api/instagram-render") return respuestaJson({ ok: true, id: ID, estado: "generada", urlJpeg: "https://x.supabase.co/storage/v1/object/public/instagram/piezas/a.jpg?v=1", ancho: 1080, alto: 1350, avisos: [] });
    if (url === URL_ESTADO) return respuestaJson({ ok: true, variables: [], identidad: { igUserId: "1", username: "casatomascrevillent" }, cuota: { usadas: 1, total: 100 }, comprobaciones: [] });
    if (url === URL_PUBLICAR) {
      return cuerpo.dryRun
        ? respuestaJson({ ok: true, estado: "prueba_ok", contenedor: { id: "C1", estado: "FINISHED" }, cuota: { usadas: 3, total: 100, ventanaHoras: 24 }, urlJpeg: "https://x/a.jpg", avisos: [] })
        : respuestaJson({ ok: true, estado: "publicada", contenedor: { id: "C2", estado: "FINISHED" }, permalink: "https://www.instagram.com/p/abc/", avisos: [] });
    }
    return new Response("no", { status: 404 });
  });
}

const llamadasA = (f: ReturnType<typeof vi.fn>, url: string) => f.mock.calls.filter(([u]) => u === url);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchFalso());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FormularioPieza", () => {
  it("solo enseña los campos que admite la plantilla", () => {
    const tz = obtenerPlantilla("tz-tipografica")!;
    const { unmount } = pintar(
      <FormularioPieza
        borrador={borradorVacio("touza", "tz-tipografica", "post")}
        plantilla={tz}
        onCambio={() => {}}
        onMarca={() => {}}
        onPlantilla={() => {}}
        hayEjemplos={false}
        conProblema={new Set()}
        baseFotos="https://x/instagram"
      />,
    );
    expect(screen.getByLabelText(/Numeral/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Titular/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Lista/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Cita/)).toBeNull();
    expect(screen.queryByLabelText(/Botón/)).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Foto" })).toBeNull();
    unmount();

    const ct = obtenerPlantilla("ct-foto-titular")!;
    pintar(
      <FormularioPieza
        borrador={borradorVacio("casa-tomas", "ct-foto-titular", "post")}
        plantilla={ct}
        onCambio={() => {}}
        onMarca={() => {}}
        onPlantilla={() => {}}
        hayEjemplos
        conProblema={new Set()}
        baseFotos="https://x/instagram"
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Foto" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Botón/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Numeral/)).toBeNull();
    expect(screen.queryByRole("group", { name: /Lista/ })).toBeNull();
    // Solo los formatos de la plantilla.
    expect(screen.getByRole("radio", { name: "Story 9:16" })).toBeInTheDocument();
  });

  it("la lista añade filas hasta el límite de la plantilla", () => {
    const tz = obtenerPlantilla("tz-tipografica")!;
    const max = tz.limites!.lista!;
    const onCambio = vi.fn();
    const b = { ...borradorVacio("touza", "tz-tipografica", "post"), lista: Array.from({ length: max }, () => ({ etiqueta: "x", valor: "1 €" })) };
    pintar(
      <FormularioPieza borrador={b} plantilla={tz} onCambio={onCambio} onMarca={() => {}} onPlantilla={() => {}} hayEjemplos={false} conProblema={new Set()} baseFotos="https://x" />,
    );
    expect(screen.getByRole("button", { name: /Añadir fila/ })).toBeDisabled();
    expect(screen.getByText(`${max}/${max} filas`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar la fila 1" }));
    expect(onCambio).toHaveBeenCalledWith({ lista: b.lista.slice(1) });
  });

  it("las fotos que no valen para el formato salen deshabilitadas y explican por qué", () => {
    const ct = obtenerPlantilla("ct-foto-titular")!;
    const onCambio = vi.fn();
    pintar(
      <FormularioPieza borrador={borradorVacio("casa-tomas", "ct-foto-titular", "post")} plantilla={ct} onCambio={onCambio} onMarca={() => {}} onPlantilla={() => {}} hayEjemplos conProblema={new Set()} baseFotos="https://x" />,
    );
    const apaisada = screen.getByTestId("foto-ct-carne-plato");
    expect(apaisada).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(apaisada);
    expect(onCambio).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/apaisada.*ampliarla/i);
    // Una que sí vale se puede elegir.
    expect(screen.getByTestId("foto-ct-salon-1")).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByTestId("foto-ct-salon-1"));
    expect(onCambio).toHaveBeenCalledWith({ foto: "ct-salon-1" });
  });
});

describe("EditorInstagram", () => {
  it("cuenta las palabras del titular y da error por encima de 6", async () => {
    pintar(<EditorInstagram />);
    const titular = screen.getByLabelText(/^Titular/);
    fireEvent.change(titular, { target: { value: "Una dos tres cuatro" } });
    expect(screen.getByTestId("contador-palabras")).toHaveTextContent("4/6 palabras");
    fireEvent.change(titular, { target: { value: "Una dos tres cuatro cinco seis siete" } });
    expect(screen.getByTestId("contador-palabras")).toHaveTextContent("7/6 palabras");
    expect(screen.getByText(/déjalo en 6 como mucho/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId("problemas-pieza")).getByText(/El «Titular» tiene 7 palabras|El titular tiene 7 palabras/)).toBeInTheDocument());
    expect(titular).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /Generar imagen/ })).toBeDisabled();
  });

  it("«Publicar» está desactivado hasta que la prueba sale bien", async () => {
    pintar(<EditorInstagram />);
    expect(screen.getByRole("button", { name: /Publicar en Instagram/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Prueba sin publicar/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: /Generar imagen/ })).toBeEnabled());
  });

  it("generar → probar → confirmar → publicar, con el JWT y el cuerpo correctos", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    pintar(<EditorInstagram />);
    const generar = await screen.findByRole("button", { name: /Generar imagen/ });
    await waitFor(() => expect(generar).toBeEnabled());
    fireEvent.click(generar);

    await screen.findByText(/Imagen guardada/);
    const [, initRender] = llamadasA(f, "/api/instagram-render")[0];
    expect(initRender.method).toBe("POST");
    expect(initRender.headers.Authorization).toBe("Bearer jwt-de-prueba");
    const cuerpoRender = JSON.parse(initRender.body);
    expect(cuerpoRender.id).toBeUndefined();
    expect(cuerpoRender.pieza).toMatchObject({ marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post" });
    expect(cuerpoRender.pieza.titular).toBeTruthy();

    fireEvent.change(screen.getByLabelText("2. Texto de la publicación"), { target: { value: "Hola #casatomas @amigo" } });
    expect(screen.getByText(/Hashtags/)).toHaveTextContent("1/30");
    fireEvent.click(screen.getByRole("button", { name: /Prueba sin publicar/ }));
    await screen.findByText("3 de 100 en 24 h");
    const [, initPrueba] = llamadasA(f, URL_PUBLICAR)[0];
    expect(initPrueba.headers.Authorization).toBe("Bearer jwt-de-prueba");
    // Publicar va a la Edge Function de Supabase (secretos de Meta en Supabase), con la clave pública.
    expect(URL_PUBLICAR).toBe("http://127.0.0.1:54321/functions/v1/instagram-publicar");
    expect(initPrueba.headers.apikey).toBe("clave-anon-de-pruebas");
    expect(JSON.parse(initPrueba.body)).toEqual({ id: ID, caption: "Hola #casatomas @amigo", dryRun: true });

    const publicar = screen.getByRole("button", { name: /Publicar en Instagram/ });
    expect(publicar).toBeEnabled();
    fireEvent.click(publicar);
    const dialogo = await screen.findByRole("alertdialog");
    await within(dialogo).findByText("Se publicará en la cuenta @casatomascrevillent. No se puede deshacer desde aquí.");
    expect(llamadasA(f, URL_ESTADO)).toHaveLength(1);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Publicar" }));

    const enlace = await screen.findByRole("link", { name: /Ver la publicación/ });
    expect(enlace).toHaveAttribute("href", "https://www.instagram.com/p/abc/");
    expect(JSON.parse(llamadasA(f, URL_PUBLICAR)[1][1].body)).toEqual({ id: ID, caption: "Hola #casatomas @amigo", dryRun: false });
  });

  it("si cambias el texto tras la prueba, hay que volver a probar", async () => {
    pintar(<EditorInstagram />);
    const generar = await screen.findByRole("button", { name: /Generar imagen/ });
    await waitFor(() => expect(generar).toBeEnabled());
    fireEvent.click(generar);
    await screen.findByText(/Imagen guardada/);
    fireEvent.click(screen.getByRole("button", { name: /Prueba sin publicar/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Publicar en Instagram/ })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("2. Texto de la publicación"), { target: { value: "otro texto" } });
    expect(screen.getByRole("button", { name: /Publicar en Instagram/ })).toBeDisabled();
    expect(screen.getByText(/vuelve a probar/)).toBeInTheDocument();
  });

  it("«en_proceso»: ofrece «Reintentar» con el mismo contenedor", async () => {
    const base = fetchFalso();
    let primera = true;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === URL_PUBLICAR && primera) {
        primera = false;
        return respuestaJson({ ok: true, estado: "en_proceso", contenedor: { id: "C9", estado: "IN_PROGRESS" }, cuota: { usadas: 1, total: 100 }, reintentar: { contenedorId: "C9" } }, 202);
      }
      return base(url, init);
    });
    vi.stubGlobal("fetch", f);
    pintar(<EditorInstagram />);
    const generar = await screen.findByRole("button", { name: /Generar imagen/ });
    await waitFor(() => expect(generar).toBeEnabled());
    fireEvent.click(generar);
    await screen.findByText(/Imagen guardada/);
    fireEvent.click(screen.getByRole("button", { name: /Prueba sin publicar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(llamadasA(f, URL_PUBLICAR)).toHaveLength(2));
    expect(JSON.parse(llamadasA(f, URL_PUBLICAR)[1][1].body)).toMatchObject({ id: ID, dryRun: true, contenedorId: "C9" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Publicar en Instagram/ })).toBeEnabled());
  });

  it("en local (Vite contesta HTML) lo dice claro en vez de fallar en silencio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })));
    pintar(<EditorInstagram />);
    const generar = await screen.findByRole("button", { name: /Generar imagen/ });
    await waitFor(() => expect(generar).toBeEnabled());
    fireEvent.click(generar);
    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAJE_SIN_SERVIDOR);
  });

  it("un 422 del render enseña los problemas con los nombres del formulario", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaJson({ ok: false, error: "La pieza no es válida", problemas: ["El campo «cta» se desborda (12 px de ancho): acórtalo"] }, 422)),
    );
    pintar(<EditorInstagram />);
    const generar = await screen.findByRole("button", { name: /Generar imagen/ });
    await waitFor(() => expect(generar).toBeEnabled());
    fireEvent.click(generar);
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("La pieza no es válida");
    expect(alerta).toHaveTextContent("El campo «Botón» se desborda");
  });
});

describe("normalizarEstado", () => {
  it("toma la cuenta de «identidad», junta los «cómo arreglarlo» de lo que falla y no inventa valores", () => {
    const r = normalizarEstado({
      ok: false,
      variables: [
        { nombre: "IG_USER_ID", presente: true, estado: "ok", detalle: "presente" },
        { nombre: "META_ACCESS_TOKEN", presente: false, estado: "falla", detalle: "falta", comoArreglarlo: "Añade META_ACCESS_TOKEN en Vercel." },
      ],
      identidad: { igUserId: "17", username: "casatomascrevillent" },
      cuota: { usadas: 2, total: 100, ventanaHoras: 24 },
      comprobaciones: [{ seccion: "Token", nombre: "Caducidad", estado: "aviso", detalle: "caduca pronto", comoArreglarlo: "Regenera el token." }],
      noVerificado: [],
    });
    expect(r.cuenta).toEqual({ id: "17", username: "casatomascrevillent" });
    expect(r.comoArreglarlo).toEqual(["Añade META_ACCESS_TOKEN en Vercel.", "Regenera el token."]);
    expect(r.cuota).toEqual({ usadas: 2, total: 100, ventanaHoras: 24 });
  });
});
