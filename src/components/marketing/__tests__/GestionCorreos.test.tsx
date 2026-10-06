/**
 * Pestaña «Suscriptores» de Newsletter (`GestionCorreos`): el dueño pidió quitar los dos recuadros informativos
 * que había encima de los contadores («Cómo se apunta la gente» y «Las bajas se hacen solas», 2026-10-06). La
 * pestaña empieza directamente por los contadores y la lista. Supabase mockeado: nunca se llama a nada real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("GestionCorreos (pestaña Suscriptores)", () => {
  it("ya no enseña los recuadros «Cómo se apunta la gente» ni «Las bajas se hacen solas»", async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <GestionCorreos />
      </QueryClientProvider>,
    );

    // La pestaña ya cargó: contadores, lista y tarjeta de la lista de envío (así la ausencia de los textos
    // no se debe a que todavía no se hubiera pintado nada).
    expect(await screen.findByRole("tab", { name: "Activos (2)" })).toBeInTheDocument();
    expect(await screen.findByText("Lista de envío")).toBeInTheDocument();
    expect(screen.getByText("Suscriptores activos")).toBeInTheDocument();
    expect(screen.getByText("Lista de suscriptores")).toBeInTheDocument();
    expect(screen.getByText(/dados de baja \(no reciben nada\)/)).toBeInTheDocument();

    const texto = document.body.textContent ?? "";
    for (const quitado of TEXTOS_QUITADOS) expect(texto).not.toContain(quitado);
  });
});
