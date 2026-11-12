/**
 * Pestaña «Suscriptores» de Newsletter (`GestionCorreos`): el dueño pidió quitar los dos recuadros informativos
 * que había encima de los contadores («Cómo se apunta la gente» y «Las bajas se hacen solas», 2026-10-06). La
 * pestaña empieza directamente por los contadores y la lista. Supabase mockeado: nunca se llama a nada real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), filas: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: async () => ({ data: mock.filas, error: null }) }) }),
    functions: { invoke: (...a: unknown[]) => mock.invoke(...a) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
// Sin permiso de escritura: la tarjeta «Lista de envío» no se actualiza sola y no hay llamadas de más.
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: false, loading: false }) }));

import { GestionCorreos } from "../GestionCorreos";

const suscriptor = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@ejemplo.es`,
  nombre: null,
  activo: true,
  created_at: "2026-09-01T10:00:00Z",
  fecha_baja: null,
  origen_baja: null,
  origen_alta: "reserva_web",
  ...extra,
});

const pasada = {
  id: "p1",
  origen: "panel",
  estado: "ok",
  iniciada_at: new Date().toISOString(),
  terminada_at: new Date().toISOString(),
  segment_id: "seg-1",
  contactos_resend: 2,
  contactos_segmento: 2,
  contactos_ajenos: 0,
  destinatarios: 2,
  altas: 0,
  actualizados: 0,
  borrados: 0,
  bajas_resend: 0,
  errores: 0,
  pendientes: 0,
  mensaje_error: null,
};

// Todo lo que decían los dos recuadros: los títulos y una frase característica de cada párrafo, por si
// vuelven con otro título o con el texto partido en varios elementos.
const TEXTOS_QUITADOS = [
  "Cómo se apunta la gente",
  "Se apuntan al reservar en la web",
  "no suscriben a nadie",
  "Las bajas se hacen solas",
  "Cada newsletter incluye un enlace para darse de baja",
  "Las bajas aparecen aquí solas",
];

beforeEach(() => {
  mock.invoke.mockReset();
  mock.invoke.mockResolvedValue({
    data: {
      success: true,
      canal: "transaccional",
      configurado: { api_key: true, segment_id: "seg-1", cron_secret: false },
      limite_contactos: 1000,
      contactos_resend: 2,
      nivel_cuota: "ok",
      ultima_pasada: pasada,
      ultima_terminada: pasada,
    },
    error: null,
  });
  mock.filas = [
    suscriptor("ana"),
    suscriptor("luis"),
    suscriptor("baja", { activo: false, fecha_baja: "2026-10-02T18:30:00Z", origen_baja: "enlace_email" }),
  ];
});

function pintar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <GestionCorreos />
    </QueryClientProvider>,
  );
}

describe("GestionCorreos (pestaña Suscriptores)", () => {
  it("ya no enseña los recuadros «Cómo se apunta la gente» ni «Las bajas se hacen solas»", async () => {
    pintar();

    // La pestaña ya cargó: contadores, lista y tarjeta de la lista de envío (así la ausencia de los textos
    // no se debe a que todavía no se hubiera pintado nada).
    expect(await screen.findByRole("tab", { name: /^Activos\s*2 activos$/ })).toBeInTheDocument();
    expect(await screen.findByText("Lista de envío")).toBeInTheDocument();
    // Las cifras, en una tira (sin tarjetas): activos y dados de baja con su explicación corta.
    const tira = screen.getByTestId("cifras-suscriptores");
    expect(within(tira).getByText("Suscriptores activos")).toBeInTheDocument();
    expect(within(tira).getByText("Dados de baja")).toBeInTheDocument();
    expect(within(tira).getByText("no reciben nada")).toBeInTheDocument();
    // «Lista de envío» en una sola línea compacta.
    expect(screen.getByTestId("lista-envio-compacta")).toBeInTheDocument();

    const texto = document.body.textContent ?? "";
    for (const quitado of TEXTOS_QUITADOS) expect(texto).not.toContain(quitado);
  });

  // jsdom no calcula alturas: lo que se puede comprobar es el CONTRATO del diseño (clases), que es lo que hace
  // que en el navegador la pestaña mida justo el alto de la pantalla (medido con el navegador real, 2026-10-06).
  it("la lista toma el alto que sobra y hace scroll por dentro: sin alturas fijas y con toda la cadena pudiendo encoger", async () => {
    const { container } = pintar();
    await screen.findByRole("tab", { name: /^Activos\s*2 activos$/ });

    // La pestaña llena el alto que le da la página (Marketing mide la pantalla) y no pone scroll propio: el
    // de la pestaña es el de Marketing y el del listado, el de la propia lista.
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).toMatch(/(^|\s)h-full(\s|$)/);
    expect(raiz.className).not.toMatch(/overflow/);

    const tarjeta = screen.getByTestId("tarjeta-lista-suscriptores");
    const comprobarLista = () => {
      // Dentro de la zona de la lista no queda ningún alto fijo (el antiguo `h-[300px]`, `h-[20rem]`…).
      const fijos = [tarjeta, ...Array.from(tarjeta.querySelectorAll("*"))].filter((el) =>
        /(^|\s)h-\[[\d.]+(px|rem)\]/.test(el.getAttribute("class") ?? ""),
      );
      expect(fijos).toEqual([]);

      // La zona con scroll es la propia lista plana (`ul`)…
      const lista = tarjeta.querySelector("ul[aria-label^='Suscriptores']") as HTMLElement;
      expect(lista).not.toBeNull();
      expect(lista.className).toMatch(/overflow-y-auto/);
      // …y ella y cada contenedor hasta la zona pueden crecer y encoger (flex-1 + min-h-0): si falla uno,
      // la lista empuja al resto y la pestaña vuelve a hacer scroll.
      const cadena: HTMLElement[] = [lista];
      for (let el = lista.parentElement; el && el !== tarjeta; el = el.parentElement) cadena.push(el);
      for (const el of [...cadena, tarjeta]) {
        expect(el.className).toMatch(/(^|\s)flex-1(\s|$)/);
        expect(el.className).toMatch(/(^|\s)min-h-(0|\[16rem\])(\s|$)/);
      }
    };

    comprobarLista(); // sub-pestaña «Activos»
    // Radix solo monta la sub-pestaña activa: hay que abrir «Dados de baja» para ver también su lista.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Dados de baja/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByText(/No reciben ninguna newsletter/)).toBeInTheDocument();
    comprobarLista();
  });
});
