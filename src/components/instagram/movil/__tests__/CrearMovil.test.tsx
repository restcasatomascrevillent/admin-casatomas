/**
 * Asistente móvil de Instagram de punta a punta con los servicios simulados
 * (sin red ni IA; la conversión de fotos va simulada porque jsdom no decodifica
 * imágenes):
 *  - 6 fotos → reordenar → Montar → editar el texto → Programar (carrusel);
 *  - 1 foto → post → Publicar ahora → enlace a la publicación;
 *  - sin red → espera a la cobertura y reintenta la subida;
 *  - borrar una foto;
 *  - la IA no se vuelve a llamar con las mismas fotos y texto;
 *  - el borrador guardado en el móvil se recupera.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } }));

import { CrearMovil } from "../CrearMovil";
import { serviciosSimulados, type ServiciosMovil } from "../servicios";
import { crearMontarSimulado } from "../montar";
import { crearApiPublicacionSimulada } from "../publicar";
import { crearAlmacenMemoria } from "../almacen";

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:prueba/${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

/** Servicios simulados: cada foto recuerda su nombre para comprobar el orden. */
function preparar(over: Partial<ServiciosMovil> = {}) {
  const nombres = new WeakMap<Blob, string>();
  const base = serviciosSimulados({ espera: 0 });
  const montar = crearMontarSimulado();
  const api = crearApiPublicacionSimulada();
  const subirFoto = vi.fn(async (blob: Blob, uuid: string, medidas: { ancho: number | null; alto: number | null }) => ({
    id: `subida:${uuid}`,
    url: `https://x.supabase.co/storage/v1/object/public/instagram/tmp/${nombres.get(blob)}`,
    ancho: medidas.ancho,
    alto: medidas.alto,
  }));
  const archivar = vi.fn(async (f: Array<{ blob: Blob }>) => f.length);
  const s: ServiciosMovil = {
    ...base,
    convertir: vi.fn(async (f: File) => {
      const blob = new Blob([f.name], { type: "image/jpeg" });
      nombres.set(blob, f.name);
      return { blob, ancho: 1080, alto: 1350 };
    }),
    subirFoto,
    montar,
    api,
    archivar,
    almacen: crearAlmacenMemoria(),
    reintento: { dormir: async () => {}, esperaBaseMs: 0 },
    ...over,
  };
  return { s, montar, api, subirFoto, archivar };
}

const ficheros = (n: number) => Array.from({ length: n }, (_, i) => new File([`foto${i + 1}`], `foto${i + 1}.jpg`, { type: "image/jpeg" }));

async function elegir(n: number) {
  const input = await screen.findByTestId("input-carrete");
  await act(async () => {
    fireEvent.change(input, { target: { files: ficheros(n) } });
  });
}

const urlsMontadas = (montar: ReturnType<typeof crearMontarSimulado>, i = 0) => montar.llamadas[i].fotos.map((f) => f.url.split("/").pop());

describe("CrearMovil", () => {
  it("6 fotos → reordenar → Montar → editar el texto → Programar un carrusel", async () => {
    const { s, montar, api, archivar } = preparar();
    render(<CrearMovil servicios={s} />);
    await elegir(6);
    await screen.findByText(/6 fotos listas/);

    // La 2.ª pasa a ser la portada.
    fireEvent.click(screen.getByRole("button", { name: /^Foto 2 de 6/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mover antes" }));
    fireEvent.click(screen.getByRole("button", { name: "Hecho" }));
    expect(screen.getByRole("button", { name: /^Foto 1 de 6 \(portada\)/ }).querySelector("img")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Algo que contar/), { target: { value: "llegó la centolla" } });
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));

    expect(await screen.findByTestId("resumen-ia")).toHaveTextContent("He entendido: 6 fotos");
    expect(urlsMontadas(montar)).toEqual(["foto2.jpg", "foto1.jpg", "foto3.jpg", "foto4.jpg", "foto5.jpg", "foto6.jpg"]);
    expect(montar.llamadas[0].indicacion).toBe("llegó la centolla");
    expect(screen.getByTestId("carrusel-previa").querySelectorAll("[aria-roledescription='imagen']")).toHaveLength(6);

    fireEvent.change(screen.getByLabelText("Texto de la publicación"), { target: { value: "Centolla del Cantábrico, solo hoy. #Crevillent" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente: publicar" }));

    fireEvent.click(screen.getByRole("button", { name: "Mañana" }));
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Programar · mañana a las 13:00/ }));

    expect(await screen.findByText("Programada")).toBeInTheDocument();
    expect(api.programadas).toHaveLength(1);
    expect(api.programadas[0]).toMatchObject({ formato: "carrusel", caption: "Centolla del Cantábrico, solo hoy. #Crevillent" });
    expect(api.programadas[0].piezaIds).toHaveLength(6);
    expect(api.renders.map((r) => r.foto.url.split("/").pop())).toEqual(["foto2.jpg", "foto1.jpg", "foto3.jpg", "foto4.jpg", "foto5.jpg", "foto6.jpg"]);
    expect(api.publicadas).toHaveLength(0);
    // Después, las fotos van al archivo de Drive.
    await waitFor(() => expect(archivar).toHaveBeenCalledTimes(1));
    expect(archivar.mock.calls[0][0]).toHaveLength(6);
    // Y el borrador del móvil se borra.
    await waitFor(async () => expect(await s.almacen.leer()).toBeNull());
  });

  it("1 foto → post → Publicar ahora → enlace a Instagram", async () => {
    const { s, api } = preparar();
    render(<CrearMovil servicios={s} />);
    await elegir(1);
    await screen.findByText(/1 foto lista: saldrá un post/);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    await screen.findByTestId("resumen-ia");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente: publicar" }));
    expect(screen.getByText(/Post de 1 foto · Casa Tomás/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publicar ahora" }));
    expect(await screen.findByText("¡Publicada!")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver en Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/p/SIMULADA1/");
    expect(api.publicadas[0].formato).toBe("post");
    expect(api.renders).toHaveLength(1);
  });

  it("sin red: avisa, espera a la cobertura y reintenta la subida", async () => {
    let red = false;
    const { s, subirFoto } = preparar({ enLinea: () => red });
    const original = subirFoto.getMockImplementation()!;
    subirFoto.mockImplementation(async (...a) => {
      if (!red) throw new TypeError("Failed to fetch");
      return original(...a);
    });
    render(<CrearMovil servicios={s} />);
    expect(await screen.findByText(/Sin cobertura/)).toBeInTheDocument();
    await elegir(2);
    await waitFor(() => expect(subirFoto).toHaveBeenCalled());
    expect(screen.queryByText(/fotos listas/)).toBeNull();

    // Vuelve la red.
    red = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await screen.findByText(/2 fotos listas/);
    expect(subirFoto.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/Sin cobertura/)).toBeNull();
  });

  it("una subida que falla por un corte se reintenta sola", async () => {
    const { s, subirFoto } = preparar({ enLinea: () => true });
    const original = subirFoto.getMockImplementation()!;
    let fallos = 0;
    subirFoto.mockImplementation(async (...a) => {
      if (fallos++ < 2) throw new TypeError("Load failed");
      return original(...a);
    });
    render(<CrearMovil servicios={s} />);
    await elegir(1);
    await screen.findByText(/1 foto lista/);
    expect(subirFoto).toHaveBeenCalledTimes(3);
  });

  it("borrar una foto la quita del montaje", async () => {
    const { s, montar } = preparar();
    render(<CrearMovil servicios={s} />);
    await elegir(3);
    await screen.findByText(/3 fotos listas/);
    fireEvent.click(screen.getByRole("button", { name: "Quitar la foto 2" }));
    await screen.findByText(/2 fotos listas/);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    await screen.findByTestId("resumen-ia");
    expect(urlsMontadas(montar)).toEqual(["foto1.jpg", "foto3.jpg"]);
  });

  it("no gasta IA de más: mismas fotos y texto reutilizan el montaje; «Otra versión» y «Cambiar tono» sí llaman", async () => {
    const { s, montar } = preparar();
    render(<CrearMovil servicios={s} />);
    await elegir(2);
    await screen.findByText(/2 fotos listas/);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    await screen.findByTestId("resumen-ia");
    fireEvent.click(screen.getByRole("button", { name: "Volver al paso anterior" }));
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    await screen.findByTestId("resumen-ia");
    expect(montar.llamadas).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Otra versión/ }));
    await waitFor(() => expect(montar.llamadas).toHaveLength(2));
    await screen.findByTestId("resumen-ia");
    fireEvent.click(screen.getByRole("button", { name: "Cambiar tono" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Elige el tono" })).getByRole("button", { name: "Con retranca" }));
    await waitFor(() => expect(montar.llamadas).toHaveLength(3));
    expect(montar.llamadas[2].tono).toBe("retranca");
    expect(await screen.findByTestId("resumen-ia")).toHaveTextContent(/retranca/);
  });

  it("si la IA falla, no reintenta sola: el usuario decide", async () => {
    const { s } = preparar();
    const montar = crearMontarSimulado({ fallar: (n) => (n === 1 ? Object.assign(new Error("Cupo"), {}) : null) });
    render(<CrearMovil servicios={{ ...s, montar }} />);
    await elegir(1);
    await screen.findByText(/1 foto lista/);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cupo");
    expect(montar.llamadas).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Probar otra vez/ }));
    await screen.findByTestId("resumen-ia");
    expect(montar.llamadas).toHaveLength(2);
  });

  it("mientras la IA trabaja enseña SUS fotos, los pasos y lo que contó (no un spinner en el vacío)", async () => {
    const { s } = preparar();
    let soltar: () => void = () => {};
    const base = crearMontarSimulado();
    const montar = (async (p: Parameters<typeof base>[0]) => {
      await new Promise<void>((r) => (soltar = r));
      return base(p);
    }) as typeof base;
    render(<CrearMovil servicios={{ ...s, montar }} />);
    await elegir(3);
    await screen.findByText(/3 fotos listas/);
    fireEvent.change(screen.getByLabelText(/Algo que contar/), { target: { value: "llegó la centolla" } });
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));

    const previa = await screen.findByTestId("montando-previa");
    expect(previa).toHaveTextContent("Montando tu carrusel de 3 fotos");
    expect(within(previa).getAllByRole("img")).toHaveLength(3);
    expect(within(previa).getAllByTestId("brillo")).toHaveLength(3);
    expect(await within(previa).findByRole("status")).toHaveTextContent("Mirando las fotos…");
    expect(within(screen.getByTestId("pasos-ia")).getByText("Pensando el orden…")).toBeInTheDocument();
    expect(screen.getByTestId("lo-que-me-has-contado")).toHaveTextContent("Lo que me has contado:«llegó la centolla»");
    expect(screen.getByTestId("cabecera-asistente")).toHaveTextContent(/Paso 2\/3 ·.*Montar con IA/);

    await act(async () => soltar());
    expect(await screen.findByTestId("resumen-ia")).toBeInTheDocument();
    expect(screen.queryByTestId("montando-previa")).toBeNull();
  });

  it("si la IA falla, los botones quedan abajo: «Probar otra vez» y «Volver a las fotos»", async () => {
    const { s } = preparar();
    const montar = crearMontarSimulado({ fallar: () => new Error("Cupo") });
    render(<CrearMovil servicios={{ ...s, montar }} />);
    await elegir(2);
    await screen.findByText(/2 fotos listas/);
    fireEvent.click(screen.getByRole("button", { name: /Montar con IA/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cupo");
    // Sigue viéndose la publicación (sin brillo): no queda la pantalla vacía.
    expect(screen.getByTestId("montando-previa")).toHaveTextContent("Tu carrusel de 2 fotos");
    expect(screen.queryByTestId("brillo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Volver a las fotos" }));
    expect(screen.getByTestId("cabecera-asistente")).toHaveTextContent(/Paso 1\/3 ·.*Fotos/);
  });

  it("en la pestaña: punto de la cuenta en la cabecera, «Pantalla completa» y «Editor completo»", () => {
    const { s } = preparar();
    const pantallaCompleta = vi.fn();
    const editor = vi.fn();
    render(<CrearMovil servicios={s} incrustado cuenta={<button type="button">cuenta</button>} onPantallaCompleta={pantallaCompleta} onEditorCompleto={editor} />);
    expect(within(screen.getByTestId("cabecera-asistente")).getByRole("button", { name: "cuenta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
    expect(pantallaCompleta).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Editor completo/ }));
    expect(editor).toHaveBeenCalledTimes(1);
  });

  it("recupera lo que se dejó a medias en el móvil", async () => {
    const { s } = preparar();
    const blob = new Blob(["x"], { type: "image/jpeg" });
    await s.almacen.guardar({
      version: 1,
      marca: "touza",
      indicacion: "para el finde",
      tono: "cercano",
      fotos: [{ clave: "11111111-1111-4111-8111-111111111111", origen: "subida", nombre: "a.jpg", blob, ancho: 1080, alto: 1350, estado: "subida", subida: { id: "subida:11111111-1111-4111-8111-111111111111", url: "https://x/a.jpg" }, subidaEn: Date.now() }],
      montaje: null,
      firmaMontaje: null,
      caption: "",
      paso: "fotos",
      guardadoEn: Date.now(),
    });
    render(<CrearMovil servicios={s} />);
    expect(await screen.findByText(/Hemos recuperado/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Algo que contar/)).toHaveValue("para el finde");
    expect(screen.getByRole("button", { name: "Touza" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/1 foto lista/)).toBeInTheDocument();
  });
});
