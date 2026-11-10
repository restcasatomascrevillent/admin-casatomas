/**
 * «Enviar Newsletter» con plantillas por bloques y «Crear con IA»
 * (petición del dueño, 10/11/2026). Lo importante: la IA solo propone (nunca
 * envía), se puede revisar y guardar como plantilla, y enviar pide
 * confirmación avisando de huecos sin completar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  prueba: vi.fn(),
  guardar: vi.fn(),
  borrar: vi.fn(),
  ia: vi.fn(),
  guardadas: [] as unknown[],
}));

vi.mock("@/hooks/useNewsletterSuscriptores", () => ({ useNewsletterSuscriptores: () => ({ totalSuscriptores: 57 }) }));
vi.mock("@/hooks/useEnviarNewsletter", () => ({
  useEnviarNewsletter: () => ({ mutate: h.enviar, isPending: false }),
  useEnviarPruebaNewsletter: () => ({ mutate: h.prueba, isPending: false }),
}));
vi.mock("@/hooks/useNewsletterPlantillas", () => ({
  useNewsletterPlantillas: () => ({ plantillas: h.guardadas, disponible: true, cargando: false }),
  useGuardarPlantillaNewsletter: () => ({ mutate: h.guardar, isPending: false }),
  useBorrarPlantillaNewsletter: () => ({ mutate: h.borrar, isPending: false }),
  useCrearNewsletterIA: () => ({ mutate: h.ia, isPending: false }),
}));
vi.mock("../SincronizacionResend", () => ({ CanalEnvio: () => <p>Canal de envío</p> }));
vi.mock("../SelectorImagenGaleria", () => ({
  useGaleriaImagenes: () => ({ data: ["https://x.supabase.co/storage/v1/object/public/platos/a.jpg"] }),
  SelectorImagenGaleria: ({ etiqueta }: { etiqueta?: string }): ReactNode => <p>{etiqueta}</p>,
}));

import { CreadorNewsletter } from "../CreadorNewsletter";

const vistaPrevia = () => document.querySelector("iframe")?.getAttribute("srcdoc") ?? "";

const PROPUESTA = {
  tipo: "evento",
  titulo: "Cena de San Valentín",
  insignia: "San Valentín",
  preheader: "El 14 de febrero",
  bloques: [
    { tipo: "texto", texto: "Os esperamos el [día]." },
    { tipo: "boton", texto: "Reservar mesa", url: "https://restaurantecasatomascrevillente.es/reservas" },
  ],
};

beforeEach(() => {
  for (const f of [h.enviar, h.prueba, h.guardar, h.borrar, h.ia]) f.mockReset();
  h.guardadas = [];
});

describe("CreadorNewsletter", () => {
  it("ofrece las plantillas de siempre y las nuevas; sin elegir, no se puede enviar", () => {
    render(<CreadorNewsletter />);
    const grupo = screen.getByRole("radiogroup", { name: "Plantilla" });
    const nombres = within(grupo).getAllByRole("radio").map((r) => r.textContent);
    expect(nombres).toEqual(["Anuncio", "Nuevo menú", "Oferta", "Menú de temporada", "Evento", "Novedades", "Cheques regalo", "En blanco"]);
    expect(screen.getByRole("button", { name: /Enviar a 57 suscriptores/ })).toBeDisabled();
    expect(screen.getByText(/Elige una plantilla o crea el correo con IA/)).toBeInTheDocument();
  });

  it("al elegir una plantilla se carga en el editor y en la vista previa con la estética nueva", () => {
    render(<CreadorNewsletter />);
    fireEvent.click(screen.getByRole("radio", { name: /Menú de temporada/ }));
    expect(screen.getByRole("radio", { name: /Menú de temporada/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Asunto")).toHaveValue("Llega el menú de temporada");
    expect(vistaPrevia()).toContain("Llega el menú de temporada");
    expect(vistaPrevia()).toContain("Libre Baskerville");
    expect(vistaPrevia()).toContain('data-pie-baja="obligatorio"');
    // Editar un bloque cambia la vista previa.
    const primerTexto = screen.getAllByLabelText(/Texto \(deja una línea en blanco/)[0];
    fireEvent.change(primerTexto, { target: { value: "Vuelve el cocido de los jueves." } });
    expect(vistaPrevia()).toContain("Vuelve el cocido de los jueves.");
  });

  it("enviar pide confirmación, avisa de huecos sin completar y manda bloques y versión de texto", () => {
    render(<CreadorNewsletter />);
    fireEvent.click(screen.getByRole("radio", { name: /Menú de temporada/ }));
    fireEvent.click(screen.getByRole("button", { name: /Enviar a 57 suscriptores/ }));
    expect(h.enviar).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByText(/Quedan huecos sin completar/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Sí, enviar a todos" }));
    expect(h.enviar).toHaveBeenCalledTimes(1);
    const payload = h.enviar.mock.calls[0][0];
    expect(payload.tipo).toBe("menu_temporada");
    expect(payload.titulo).toBe("Llega el menú de temporada");
    expect(payload.bloques.length).toBeGreaterThan(2);
    expect(payload.mensaje).toContain("Con el cambio de estación");
  });

  it("un bloque vacío bloquea el envío y dice por qué", () => {
    render(<CreadorNewsletter />);
    fireEvent.click(screen.getByRole("radio", { name: /En blanco/ }));
    fireEvent.change(screen.getByLabelText("Asunto"), { target: { value: "Hola" } });
    expect(screen.getByText(/está vacío/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar a 57 suscriptores/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enviar prueba/ })).toBeDisabled();
  });

  it("«Crear con IA» carga la propuesta para revisarla y NO envía nada", async () => {
    h.ia.mockImplementation((_p, opts) => opts.onSuccess({ propuesta: PROPUESTA, avisos: ["Falta completar: día."], modelo: "gpt-5.6-luna" }));
    render(<CreadorNewsletter />);
    fireEvent.click(screen.getByRole("button", { name: /Crear con IA/ }));
    const redactar = screen.getByRole("button", { name: /Redactar con IA/ });
    expect(redactar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("¿Qué quieres contar?"), { target: { value: "Cena de San Valentín con menú especial" } });
    fireEvent.click(redactar);
    expect(h.ia).toHaveBeenCalledTimes(1);
    expect(h.ia.mock.calls[0][0]).toMatchObject({ descripcion: "Cena de San Valentín con menú especial", tipo: null, tono: "cercano", base: null });
    expect(h.ia.mock.calls[0][0].imagenes).toHaveLength(1);
    await waitFor(() => expect(screen.getByText("Propuesta de la IA cargada")).toBeInTheDocument());
    expect(screen.getByText("Falta completar: día.")).toBeInTheDocument();
    expect(screen.getByLabelText("Asunto")).toHaveValue("Cena de San Valentín");
    expect(vistaPrevia()).toContain("Os esperamos el [día].");
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.prueba).not.toHaveBeenCalled();
    expect(h.guardar).not.toHaveBeenCalled();
  });

  it("guardar como plantilla guarda el diseño (con origen IA si viene de la IA) sin enviarlo", async () => {
    h.ia.mockImplementation((_p, opts) => opts.onSuccess({ propuesta: PROPUESTA, avisos: [], modelo: "m" }));
    render(<CreadorNewsletter />);
    fireEvent.click(screen.getByRole("button", { name: /Crear con IA/ }));
    fireEvent.change(screen.getByLabelText("¿Qué quieres contar?"), { target: { value: "Cena de San Valentín con menú especial" } });
    fireEvent.click(screen.getByRole("button", { name: /Redactar con IA/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Guardar como plantilla/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Guardar como plantilla/ }));
    expect(screen.getByLabelText("Nombre de la plantilla")).toHaveValue("Cena de San Valentín");
    fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));
    expect(h.guardar).toHaveBeenCalledTimes(1);
    expect(h.guardar.mock.calls[0][0]).toMatchObject({ nombre: "Cena de San Valentín", origen: "ia", diseno: { tipo: "evento" } });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("las plantillas guardadas salen en «Tus plantillas», se cargan y se pueden borrar con confirmación", () => {
    h.guardadas = [{ id: "p1", nombre: "Jornadas del arroz", descripcion: "", tipo: "menu_temporada", titulo: "Jornadas del arroz", insignia: "Jornadas", preheader: "",
      bloques: [{ tipo: "texto", texto: "Vuelven las jornadas." }], origen: "ia", created_at: "", updated_at: "" }];
    render(<CreadorNewsletter />);
    fireEvent.click(screen.getByRole("button", { name: /^Jornadas del arroz/ }));
    expect(screen.getByLabelText("Asunto")).toHaveValue("Jornadas del arroz");
    expect(vistaPrevia()).toContain("Vuelven las jornadas.");
    fireEvent.click(screen.getByRole("button", { name: "Borrar la plantilla «Jornadas del arroz»" }));
    expect(h.borrar).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Borrar" }));
    expect(h.borrar).toHaveBeenCalledWith("p1");
  });

  it("los bloques se reordenan, se quitan y se añaden", () => {
    render(<CreadorNewsletter />);
    fireEvent.click(screen.getByRole("radio", { name: /^Anuncio/ }));
    const lista = screen.getByRole("list", { name: "Bloques del correo" });
    const tipos = () => within(lista).getAllByRole("listitem").filter((li) => li.parentElement === lista).map((li) => li.querySelector("span.flex-1")?.textContent);
    expect(tipos()).toEqual(["Texto", "Botón", "Firma"]);
    fireEvent.click(screen.getByRole("button", { name: "Bajar el bloque 1" }));
    expect(tipos()).toEqual(["Botón", "Texto", "Firma"]);
    fireEvent.click(screen.getByRole("button", { name: "Quitar el bloque 3" }));
    expect(tipos()).toEqual(["Botón", "Texto"]);
  });
});
