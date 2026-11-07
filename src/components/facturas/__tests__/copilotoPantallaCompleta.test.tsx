// «Pregúntale a la IA» a pantalla completa (06/11/2026, petición del dueño):
// desde el panel lateral, «Pantalla completa» lleva a `/facturas/ia?c=<id>`
// conservando la conversación en curso; esa URL se puede abrir en otra pestaña
// (carga la conversación de la base de datos) y «Volver a Análisis» devuelve al
// panel lateral. Se monta la página de Facturas DE VERDAD con las dos rutas.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./dobleAnalisis")).doble.supabase }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
// Lo que no es de Análisis, como en Facturas.test.tsx.
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/facturas/compras/TabCompras", () => ({ TabCompras: () => <p>Compras</p> }));
vi.mock("@/components/facturas/SubidaFacturas", () => ({ SubidaFacturas: () => <p>Subida</p> }));
vi.mock("@/components/facturas/GastoIaPestana", () => ({ GastoIaPestana: () => <span data-testid="gasto-ia-pestana">0,01 € este mes</span> }));
vi.mock("@/components/avisos/BotonAvisosSeccion", () => ({ BotonAvisosSeccion: () => null }));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => null }));
vi.mock("@/hooks/useContadorDocumentos", () => ({ useContadorDocumentos: () => ({ data: 3 }) }));
// Con «Editar» en Facturas: la IA solo sale con él (06/11/2026; sin él, ver Facturas.permisos.test.tsx).
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: null, isAdmin: false, permissions: [], loading: false }),
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import { doble, explorar, SERIE, TABLERO } from "./dobleAnalisis";
import Facturas from "@/pages/Facturas";

const ubicacion = { actual: "", estado: null as unknown };
function Ubicacion() {
  const l = useLocation();
  ubicacion.actual = `${l.pathname}${l.search}`;
  ubicacion.estado = l.state;
  return null;
}

function montar(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Las dos rutas, como en App.tsx: el mismo árbol, así que la página no se desmonta al cambiar.
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Ubicacion />
        <Routes>
          <Route path="/facturas" element={<Facturas />} />
          <Route path="/facturas/ia" element={<Facturas />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const panel = () => screen.getByRole("dialog", { name: "Pregúntale a la IA" });
const completa = () => screen.getByTestId("copiloto-pantalla-completa-vista");
const lecturasMensajes = () => doble.lecturas.filter((l) => l.tabla === "chat_facturas_mensajes" && !l.llamadas.some((x) => x.metodo === "insert")).length;

async function abrirPanel() {
  await screen.findByText("1.362.491,57 €");
  fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
  return panel();
}

function preguntarEn(donde: HTMLElement, texto: string) {
  fireEvent.change(within(donde).getByLabelText("Pregunta para el asistente"), { target: { value: texto } });
  fireEvent.click(within(donde).getByRole("button", { name: /enviar pregunta/i }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  doble.reiniciar();
  doble.rpcs.tablero_compras = () => TABLERO;
  doble.rpcs.explorar_compras = explorar;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 6, 12));
});

describe("copiloto: «Pantalla completa» en el panel lateral", () => {
  it("es un enlace de verdad a /facturas/ia con la conversación; ctrl/cmd-clic se lo deja al navegador (otra pestaña)", async () => {
    doble.invoke.mockResolvedValue({ data: { respuesta: "En octubre, 30.225,87 €." }, error: null });
    montar("/facturas?tab=chat");
    const p = await abrirPanel();
    const enlace = within(p).getByRole("link", { name: "Pantalla completa" });
    expect(enlace).toHaveAttribute("href", "/facturas/ia");
    preguntarEn(p, "¿Cuánto gasté en octubre?");
    expect(await within(panel()).findByText("En octubre, 30.225,87 €.")).toBeInTheDocument();
    expect(within(panel()).getByRole("link", { name: "Pantalla completa" })).toHaveAttribute("href", "/facturas/ia?c=c1");

    // Ctrl-clic: la app no lo intercepta (lo abre el navegador en otra pestaña) y esta pestaña no cambia.
    let prevenidoPorLaApp: boolean | null = null;
    const alFinal = (e: Event) => {
      prevenidoPorLaApp = e.defaultPrevented;
      e.preventDefault(); // jsdom no navega
    };
    window.addEventListener("click", alFinal);
    fireEvent.click(within(panel()).getByRole("link", { name: "Pantalla completa" }), { ctrlKey: true });
    window.removeEventListener("click", alFinal);
    expect(prevenidoPorLaApp).toBe(false);
    expect(ubicacion.actual).toBe("/facturas?tab=chat");
  });

  it("pasa a pantalla completa SIN perder la conversación en curso (ni la respuesta que aún no ha llegado) y vuelve al panel", async () => {
    let responder: (v: unknown) => void = () => {};
    doble.invoke.mockImplementation(() => new Promise((r) => (responder = r)));
    montar("/facturas?tab=chat&local=touza");
    const p = await abrirPanel();
    // Con el panel abierto se sigue viendo lo gastado del chatbot este mes (06/11/2026).
    expect(within(within(panel()).getByTestId("copiloto-gasto")).getByTestId("gasto-ia-pestana")).toBeInTheDocument();
    preguntarEn(p, "¿Qué ha subido este mes?");
    await within(panel()).findByText("¿Qué ha subido este mes?");
    await waitFor(() => expect(doble.invoke).toHaveBeenCalled());
    const leidasAntes = lecturasMensajes();

    // Pantalla completa mientras la IA aún contesta.
    fireEvent.click(within(panel()).getByRole("link", { name: "Pantalla completa" }));
    expect(ubicacion.actual).toBe("/facturas/ia?c=c1");
    expect(ubicacion.estado).toEqual({ volverA: "/facturas?tab=chat&local=touza" });
    const vista = completa();
    expect(within(vista).getByRole("heading", { name: "Pregúntale a la IA" })).toBeInTheDocument();
    expect(within(vista).getByText("¿Qué ha subido este mes?")).toBeInTheDocument();
    // Sin pestañas, sin tablero (ocultos, siguen montados) y sin el panel lateral: solo el chat.
    expect(screen.getByTestId("pestanas-pagina")).toHaveClass("hidden");
    expect(screen.getByTestId("tablero-analisis")).toHaveClass("hidden");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pregúntale a la IA" })).not.toBeInTheDocument());

    // Llega la respuesta: sale a pantalla completa (es el mismo chat, no se ha vuelto a cargar).
    responder({ data: { respuesta: "El pan de cristal, un 46,5 %.", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] }, error: null });
    expect(await within(completa()).findByText("El pan de cristal, un 46,5 %.")).toBeInTheDocument();
    expect(lecturasMensajes()).toBe(leidasAntes);
    // La gráfica, a buen tamaño, y «Fijar en el tablero» como en el panel.
    expect(within(completa()).getByRole("figure", { name: "Evolución del precio de Merluza" })).toBeInTheDocument();
    fireEvent.click(within(completa()).getByRole("button", { name: "Fijar en el tablero" }));
    expect(within(completa()).getByRole("button", { name: /fijada en el tablero/i })).toHaveAttribute("aria-pressed", "true");

    // Lo escrito en la caja sigue al volver.
    fireEvent.change(within(completa()).getByLabelText("Pregunta para el asistente"), { target: { value: "¿Y la merluza?" } });
    fireEvent.click(within(completa()).getByRole("button", { name: "Volver a Análisis" }));
    await waitFor(() => expect(ubicacion.actual).toBe("/facturas?tab=chat&local=touza"));
    const otraVez = await screen.findByRole("dialog", { name: "Pregúntale a la IA" });
    expect(within(otraVez).getByText("El pan de cristal, un 46,5 %.")).toBeInTheDocument();
    expect(within(otraVez).getByLabelText("Pregunta para el asistente")).toHaveValue("¿Y la merluza?");
    // El tablero, como estaba (y con la gráfica fijada desde pantalla completa).
    expect(screen.getByTestId("tablero-analisis")).not.toHaveClass("hidden");
    expect(screen.getByTestId("pestanas-pagina")).not.toHaveClass("hidden");
    // Las gráficas fijadas viven en la vista «Explorar» (Análisis en una pantalla, 07/11/2026).
    fireEvent.click(within(screen.getByRole("group", { name: "Vista del análisis" })).getByRole("button", { name: "Explorar" }));
    expect(within(screen.getByRole("group", { name: "Gráficas fijadas" })).getByRole("region", { name: "Evolución del precio · Merluza" })).toBeInTheDocument();
  });
});

describe("copiloto: /facturas/ia abierta en otra pestaña", () => {
  it("carga la conversación de `?c=` de la base de datos, con su historial al lado, y «Volver» lleva al panel lateral", async () => {
    doble.bd.conversaciones = [
      { id: "c7", session_id: "s7", titulo: "Gasto de octubre", created_at: "2026-11-05T10:00:00Z", updated_at: "2026-11-05T10:00:00Z" },
      { id: "c8", session_id: "s8", titulo: "Proveedores de pescado", created_at: "2026-11-04T10:00:00Z", updated_at: "2026-11-04T10:00:00Z" },
    ];
    doble.bd.mensajes = [
      { id: "m1", conversacion_id: "c7", rol: "user", contenido: "¿Cuánto gasté en octubre?", created_at: "2026-11-05T10:00:00Z" },
      { id: "m2", conversacion_id: "c7", rol: "assistant", contenido: "En octubre, 30.225,87 €.", created_at: "2026-11-05T10:00:05Z" },
    ];
    montar("/facturas/ia?c=c7");
    const vista = await screen.findByTestId("copiloto-pantalla-completa-vista");
    expect(await within(vista).findByText("En octubre, 30.225,87 €.")).toBeInTheDocument();
    expect(within(vista).getByText("Gasto de octubre", { selector: "p" })).toBeInTheDocument();
    const historial = within(vista).getByRole("complementary", { name: "Historial de conversaciones" });
    expect(within(historial).getByText("Proveedores de pescado")).toBeInTheDocument();
    // Lo gastado del chatbot este mes también a pantalla completa (sin pestañas arriba, 06/11/2026).
    expect(within(completa()).getByTestId("gasto-ia-pestana")).toBeInTheDocument();

    // Cambiar de conversación desde el historial: la URL la sigue (sin apilar historial).
    fireEvent.click(within(historial).getByText("Proveedores de pescado"));
    await waitFor(() => expect(ubicacion.actual).toBe("/facturas/ia?c=c8"));

    fireEvent.click(within(completa()).getByRole("button", { name: "Volver a Análisis" }));
    await waitFor(() => expect(ubicacion.actual).toBe("/facturas?tab=chat"));
    expect(await screen.findByRole("dialog", { name: "Pregúntale a la IA" })).toBeInTheDocument();
    expect(screen.getByTestId("tablero-analisis")).not.toHaveClass("hidden");
  });

  it("una conversación que ya no existe: lo dice, quita `?c=` y deja preguntar", async () => {
    montar("/facturas/ia?c=borrada");
    expect(await within(await screen.findByTestId("copiloto-pantalla-completa-vista")).findByText(/No se encuentra esa conversación/)).toBeInTheDocument();
    await waitFor(() => expect(ubicacion.actual).toBe("/facturas/ia"));
    expect(within(completa()).getByLabelText("Pregunta para el asistente")).toBeEnabled();
  });
});
