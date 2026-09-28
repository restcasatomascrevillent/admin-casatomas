/**
 * REGRESIÓN del guardado destructivo del editor de plano (producción, 2026-09-27).
 *
 * El `handleSave` original hacía `await supabase.from('mesas').delete().eq('id', …)`
 * SIN leer el `{ error }` que devuelve supabase-js. Y supabase-js RESUELVE (no
 * rechaza) cuando RLS o una clave ajena rechazan la escritura, así que el fallo
 * era invisible y el usuario veía igualmente "Plano guardado correctamente".
 *
 * Este fichero fija los DOS modos en los que la escritura puede fallar sin que
 * supabase-js lance nada, ambos vistos en producción:
 *
 *   1. `{ data: null, error: { code: '42501', message: '…row-level security…' } }`
 *      — el error viene dentro de la respuesta resuelta.
 *   2. `{ data: [], error: null }`
 *      — RLS deniega y la escritura simplemente afecta a CERO filas. NO hay
 *        error que comprobar: la única forma de detectarlo es pedir
 *        `.select('id')` y verificar que la fila que querías tocar ha vuelto.
 *
 * En los dos casos el contrato es el mismo: NUNCA "Plano guardado correctamente",
 * y un `toast.error` que diga QUÉ mesa quedó sin tocar y en qué estado queda el
 * espacio.
 *
 * Los subcomponentes pesados (CanvasPlano/PanelLateral/ToolbarDibujo) se mockean
 * a propósito: este test es sobre el guardado, no sobre Fabric.js, y así no
 * depende de cambios simultáneos en esos ficheros.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ────────────────────────────────────────────────────────────────────

/** Lo único que este test necesita de las props de CanvasPlano. */
interface PropsCanvasMock {
  onMesasChange: (mesas: unknown[]) => void;
  onSelectionChange: (elemento: unknown) => void;
}

/** Lo único que este test necesita de las props de PanelLateral. */
interface PropsPanelMock {
  onUnmergeMesa: (mesaId: string) => void;
}

interface CadenaSupabase {
  tabla: string;
  llamadas: Array<{ metodo: string; args: unknown[] }>;
}

const h = vi.hoisted(() => ({
  /** Props con las que se renderizó por última vez el CanvasPlano mockeado. */
  canvasProps: { current: null as PropsCanvasMock | null },
  /** Props con las que se renderizó por última vez el PanelLateral mockeado. */
  panelProps: { current: null as PropsPanelMock | null },
  /** Lo que devuelve `canvasRef.current.unmergeMesa(...)` en el próximo desagrupe. */
  unmergeResultado: { current: null as unknown[] | null },
  /** Devuelve la respuesta (resuelta) de cada cadena de supabase. */
  responder: { current: null as null | ((cadena: CadenaSupabase) => unknown) },
  /** Todas las cadenas ejecutadas, en orden. */
  cadenas: [] as CadenaSupabase[],
}));

vi.mock("@/integrations/supabase/client", () => {
  // El query builder de supabase-js es "thenable": se puede await en cualquier
  // punto de la cadena. Este mock replica eso — cada método encadena y el
  // `then` resuelve con lo que diga el responder del test.
  const METODOS = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "in", "neq", "order", "limit", "single", "maybeSingle",
  ];
  return {
    supabase: {
      from(tabla: string) {
        const cadena: CadenaSupabase = { tabla, llamadas: [] };
        const builder: Record<string, unknown> = {};
        for (const metodo of METODOS) {
          builder[metodo] = (...args: unknown[]) => {
            cadena.llamadas.push({ metodo, args });
            return builder;
          };
        }
        builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          h.cadenas.push(cadena);
          try {
            return Promise.resolve(h.responder.current?.(cadena)).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        };
        return builder;
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/usePlanosEspacio");
vi.mock("@/hooks/useMesas");

vi.mock("../CanvasPlano", async () => {
  const React = await import("react");
  return {
    CanvasPlano: React.forwardRef<unknown, PropsCanvasMock>((props, ref) => {
      h.canvasProps.current = props;
      React.useImperativeHandle(ref, () => ({
        renameMesaId: vi.fn(),
        removeElement: vi.fn(),
        reloadFromSnapshot: vi.fn(),
        clearCanvas: vi.fn(),
        exportImage: vi.fn(),
        setZoom: vi.fn(),
        centerOnContent: vi.fn(),
        unmergeMesa: vi.fn(() => h.unmergeResultado.current),
        updateMesaNombre: vi.fn(),
        updateMesaBocadillo: vi.fn(),
      }));
      return React.createElement("div", { "data-testid": "canvas-mock" });
    }),
  };
});

vi.mock("../PanelLateral", async () => {
  const React = await import("react");
  return {
    PanelLateral: (props: PropsPanelMock) => {
      h.panelProps.current = props;
      return React.createElement("div", { "data-testid": "panel-mock" });
    },
  };
});

vi.mock("../ToolbarDibujo", async () => {
  const React = await import("react");
  return { ToolbarDibujo: () => React.createElement("div", { "data-testid": "toolbar-mock" }) };
});

import { toast } from "sonner";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useActualizarMesasSilent, useEliminarMesa } from "@/hooks/useMesas";
import { EditorPlanoEspacio } from "../EditorPlanoEspacio";

// ─── Fixtures: el estado real del Salón (unión viva JUNTO a sus originales) ───

const ESPACIO_ID = "e-salon";

/** Los dos originales absorbidos por la unión. Siguen existiendo como filas. */
const ORIGINALES = [
  { id: "m-12", nombre: "12", capacidad: 4, forma: "rectangular" as const, ancho: 80, alto: 80 },
  { id: "m-13", nombre: "13", capacidad: 4, forma: "rectangular" as const, ancho: 80, alto: 80 },
];

const UNION_CANVAS = {
  id: "m-union",
  nombre: "12+13",
  capacidad: 8,
  forma: "rectangular" as const,
  ancho: 160,
  alto: 80,
  posX: 1,
  posY: 1,
  rotacion: 0,
  isMerged: true,
  originalMesas: ORIGINALES,
  etiqueta: null,
};

const MESA_SUELTA_CANVAS = {
  id: "m-14",
  nombre: "14",
  capacidad: 4,
  forma: "rectangular" as const,
  ancho: 80,
  alto: 80,
  posX: 4,
  posY: 1,
  rotacion: 0,
  isMerged: false,
  etiqueta: null,
};

const MESAS_CANVAS = [UNION_CANVAS, MESA_SUELTA_CANVAS];

const filaDB = (id: string, nombre: string, capacidad: number, extra: Record<string, unknown> = {}) => ({
  id,
  espacio_id: ESPACIO_ID,
  nombre,
  capacidad,
  forma: "rectangular",
  ancho: 80,
  alto: 80,
  pos_x: 1,
  pos_y: 1,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...extra,
});

const MESAS_DB = [
  filaDB("m-union", "12+13", 8, { is_merged: true, original_mesas: ORIGINALES, ancho: 160 }),
  filaDB("m-12", "12", 4),
  filaDB("m-13", "13", 4),
  filaDB("m-14", "14", 4),
];

// ─── Utilidades sobre las cadenas de supabase ────────────────────────────────

const tieneMetodo = (c: CadenaSupabase, metodo: string) =>
  c.llamadas.some((l) => l.metodo === metodo);

const apuntaAFila = (c: CadenaSupabase, id: string) =>
  c.llamadas.some((l) => l.metodo === "eq" && l.args[0] === "id" && l.args[1] === id);

/** true si la cadena es la ESCRITURA que retira de circulación la mesa `id`. */
const esEscrituraQueRetira = (c: CadenaSupabase, id: string) =>
  c.tabla === "mesas" && (tieneMetodo(c, "delete") || tieneMetodo(c, "update")) && apuntaAFila(c, id);

const guardarPlanoMock = vi.fn();
const refetchMesasMock = vi.fn();

let contadorInsert = 0;

/**
 * Responder por defecto: todo va bien. Devuelve filas en los `.select()` para
 * que el guardado "con verificación" pueda comprobar que la fila volvió.
 */
function responderTodoOk(c: CadenaSupabase): unknown {
  if (c.tabla === "asignaciones_mesa") {
    if (tieneMetodo(c, "delete") || tieneMetodo(c, "update")) return { data: [], error: null };
    return { data: [], error: null };
  }
  if (c.tabla === "mesas") {
    if (tieneMetodo(c, "insert")) {
      contadorInsert += 1;
      return { data: { id: `m-nueva-${contadorInsert}` }, error: null };
    }
    const idObjetivo = c.llamadas.find((l) => l.metodo === "eq" && l.args[0] === "id")?.args[1];
    // Lectura de confirmación (`select('id, activa').eq('id', …).maybeSingle()`):
    // por defecto la fila existe y está activa.
    if (tieneMetodo(c, "maybeSingle")) {
      return { data: idObjetivo ? { id: idObjetivo, activa: true } : null, error: null };
    }
    return { data: idObjetivo ? [{ id: idObjetivo }] : [], error: null };
  }
  return { data: [], error: null };
}

/**
 * Responder con estado: una tablita `mesas` de verdad, para poder distinguir
 * las tres lecturas de "cero filas" (fila ausente / ya cumplida / denegada).
 * `denegadas` son los ids sobre los que el UPDATE se rechaza en silencio —
 * devuelve 0 filas SIN error, como hace RLS.
 */
function responderConFilas(
  filas: Map<string, { activa: boolean }>,
  denegadas: Set<string> = new Set(),
) {
  return (c: CadenaSupabase): unknown => {
    if (c.tabla === "asignaciones_mesa") return { data: [], error: null, count: 0 };
    if (c.tabla !== "mesas") return { data: [], error: null };

    const idObjetivo = c.llamadas.find((l) => l.metodo === "eq" && l.args[0] === "id")?.args[1] as
      | string
      | undefined;

    if (tieneMetodo(c, "insert")) {
      contadorInsert += 1;
      const id = `m-nueva-${contadorInsert}`;
      filas.set(id, { activa: true });
      return { data: { id }, error: null };
    }

    if (tieneMetodo(c, "update")) {
      if (!idObjetivo || !filas.has(idObjetivo) || denegadas.has(idObjetivo)) {
        return { data: [], error: null };
      }
      const cuerpo = c.llamadas.find((l) => l.metodo === "update")?.args[0] as
        | Record<string, unknown>
        | undefined;
      if (cuerpo && typeof cuerpo.activa === "boolean") {
        filas.set(idObjetivo, { activa: cuerpo.activa });
      }
      return { data: [{ id: idObjetivo }], error: null };
    }

    if (tieneMetodo(c, "maybeSingle")) {
      const fila = idObjetivo ? filas.get(idObjetivo) : undefined;
      return { data: fila ? { id: idObjetivo, activa: fila.activa } : null, error: null };
    }

    return { data: [...filas.keys()].map((id) => ({ id })), error: null };
  };
}

function montar(mesasDB: unknown[] = MESAS_DB) {
  vi.mocked(usePlanoEspacio).mockReturnValue({
    data: { configuracion: {}, ancho_metros: 12, alto_metros: 8 },
    isLoading: false,
  } as never);
  vi.mocked(useCrearOActualizarPlano).mockReturnValue({
    mutateAsync: guardarPlanoMock,
    isPending: false,
  } as never);
  vi.mocked(useMesas).mockReturnValue({
    data: mesasDB,
    isLoading: false,
    refetch: refetchMesasMock,
  } as never);
  vi.mocked(useActualizarMesasSilent).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  } as never);
  vi.mocked(useEliminarMesa).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  } as never);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <EditorPlanoEspacio espacioId={ESPACIO_ID} espacioNombre="Salón" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

/** Siembra el estado del lienzo y pulsa "Guardar". */
async function sembrarYGuardar() {
  await act(async () => {
    h.canvasProps.current?.onMesasChange(MESAS_CANVAS);
  });

  const boton = screen.getByRole("button", { name: "Guardar" });
  await act(async () => {
    boton.click();
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });
}

const mensajesDeError = () =>
  vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));

/**
 * Responder para los tests de "Limpiar": el recuento previo ve las 4 filas de
 * `MESAS_DB` y el DELETE masivo devuelve lo que diga `respuestaBorrado`.
 * OJO al orden de las comprobaciones: la cadena del borrado verificado lleva
 * `delete` Y `select`.
 */
function responderLimpieza(respuestaBorrado: unknown) {
  return (c: CadenaSupabase): unknown => {
    if (c.tabla === "mesas" && tieneMetodo(c, "delete")) return respuestaBorrado;
    if (c.tabla === "mesas") return { data: MESAS_DB.map((m) => ({ id: m.id })), error: null };
    if (c.tabla === "asignaciones_mesa") return { data: [], error: null, count: 0 };
    return { data: [], error: null };
  };
}

/** Abre el diálogo de "Limpiar" y confirma el borrado. */
async function limpiarTodo() {
  await act(async () => {
    screen.getByRole("button", { name: "Limpiar" }).click();
  });
  const confirmar = await screen.findByRole("button", { name: "Limpiar todo" });
  await act(async () => {
    confirmar.click();
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("EditorPlanoEspacio — guardado sin fallos silenciosos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.cadenas.length = 0;
    h.canvasProps.current = null;
    h.responder.current = responderTodoOk;
    contadorInsert = 0;
    guardarPlanoMock.mockResolvedValue({ id: "plano-1" });
  });

  it("caso 1 (error dentro de la respuesta resuelta): RLS devuelve 42501 al retirar la mesa 12", async () => {
    h.responder.current = (c) => {
      if (esEscrituraQueRetira(c, "m-12")) {
        return {
          data: null,
          error: {
            code: "42501",
            message: 'new row violates row-level security policy for table "mesas"',
          },
        };
      }
      return responderTodoOk(c);
    };

    montar();
    await sembrarYGuardar();

    expect(toast.success).not.toHaveBeenCalledWith("Plano guardado correctamente");
    expect(toast.error).toHaveBeenCalled();

    const mensajes = mensajesDeError();
    expect(mensajes.join(" | ")).toMatch(/mesa 12/);
  });

  it("caso 2 (cero filas sin error): RLS deniega en silencio y la escritura no afecta a ninguna fila", async () => {
    h.responder.current = (c) => {
      if (esEscrituraQueRetira(c, "m-12")) {
        // Ni `error`, ni filas. Este es el caso que NO se detecta comprobando
        // solo `{ error }`: hace falta `.select('id')` y contar lo que vuelve.
        return { data: [], error: null };
      }
      return responderTodoOk(c);
    };

    montar();
    await sembrarYGuardar();

    expect(toast.success).not.toHaveBeenCalledWith("Plano guardado correctamente");
    expect(toast.error).toHaveBeenCalled();

    const mensajes = mensajesDeError();
    expect(mensajes.join(" | ")).toMatch(/mesa 12/);
  });

  it("el mensaje de error dice qué se aplicó y qué quedó a medias, y pide recargar", async () => {
    h.responder.current = (c) => {
      if (esEscrituraQueRetira(c, "m-12")) return { data: [], error: null };
      return responderTodoOk(c);
    };

    montar();
    await sembrarYGuardar();

    const mensaje = mensajesDeError().join(" | ");
    expect(mensaje).toMatch(/plano/i);
    expect(mensaje).toMatch(/12\+13/);
    expect(mensaje).toMatch(/recarga/i);
  });

  it("ninguna mesa se BORRA: las originales absorbidas se desactivan", async () => {
    montar();
    await sembrarYGuardar();

    const borradosDeMesas = h.cadenas.filter(
      (c) => c.tabla === "mesas" && tieneMetodo(c, "delete"),
    );
    expect(borradosDeMesas).toHaveLength(0);

    const desactivaciones = h.cadenas.filter(
      (c) =>
        c.tabla === "mesas" &&
        tieneMetodo(c, "update") &&
        c.llamadas.some(
          (l) => l.metodo === "update" && (l.args[0] as Record<string, unknown>)?.activa === false,
        ),
    );
    const idsDesactivados = desactivaciones
      .map((c) => c.llamadas.find((l) => l.metodo === "eq" && l.args[0] === "id")?.args[1])
      .sort();
    expect(idsDesactivados).toEqual(["m-12", "m-13"]);
  });

  it("cuando todo va bien sí muestra el éxito", async () => {
    montar();
    await sembrarYGuardar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Plano guardado correctamente");
  });
});

/**
 * "Limpiar" borra TODAS las mesas del espacio y, por el ON DELETE CASCADE de
 * `asignaciones_mesa.mesa_id`, arrastra el historial de reservas. Es la acción
 * más destructiva del editor, así que tiene el mismo contrato que el guardado:
 * se cuenta lo que se borró de verdad y un borrado parcial jamás se anuncia
 * como éxito.
 */
describe("EditorPlanoEspacio — Limpiar verifica lo que borró", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.cadenas.length = 0;
    h.canvasProps.current = null;
    h.responder.current = responderTodoOk;
    contadorInsert = 0;
    guardarPlanoMock.mockResolvedValue({ id: "plano-1" });
  });

  it("caso 1 (42501): RLS deniega el borrado masivo con error", async () => {
    h.responder.current = responderLimpieza({
      data: null,
      error: {
        code: "42501",
        message: 'new row violates row-level security policy for table "mesas"',
      },
    });

    montar();
    await limpiarTodo();

    expect(toast.success).not.toHaveBeenCalled();
    expect(mensajesDeError().join(" | ")).toBe(
      "No se ha podido limpiar el plano (permisos). Las 4 mesas del espacio siguen ahí: " +
        "recarga la página antes de volver a intentarlo.",
    );
  });

  it("caso 2 (cero filas sin error): el DELETE no afecta a ninguna fila", async () => {
    h.responder.current = responderLimpieza({ data: [], error: null });

    montar();
    await limpiarTodo();

    expect(toast.success).not.toHaveBeenCalled();
    expect(mensajesDeError().join(" | ")).toBe(
      "No se ha eliminado ninguna de las 4 mesas del espacio (permisos). " +
        "El plano sigue como estaba: recarga la página antes de volver a intentarlo.",
    );
  });

  it("borrado PARCIAL: dice cuántas cayeron y cuántas sobreviven", async () => {
    h.responder.current = responderLimpieza({
      data: [{ id: "m-12" }, { id: "m-13" }],
      error: null,
    });

    montar();
    await limpiarTodo();

    expect(toast.success).not.toHaveBeenCalled();
    expect(mensajesDeError().join(" | ")).toBe(
      "Se eliminaron 2 de 4 mesas, pero 2 mesas siguen en el espacio (permisos). " +
        "El plano ha quedado a medio limpiar: recarga la página antes de volver a intentarlo.",
    );
  });

  it("el borrado masivo pide .select('id') (si no, no hay forma de contarlo)", async () => {
    h.responder.current = responderLimpieza({
      data: MESAS_DB.map((m) => ({ id: m.id })),
      error: null,
    });

    montar();
    await limpiarTodo();

    const borrado = h.cadenas.find((c) => c.tabla === "mesas" && tieneMetodo(c, "delete"));
    expect(borrado).toBeDefined();
    expect(tieneMetodo(borrado!, "select")).toBe(true);
  });

  it("cuando se borran todas sí muestra el éxito", async () => {
    h.responder.current = responderLimpieza({
      data: MESAS_DB.map((m) => ({ id: m.id })),
      error: null,
    });

    montar();
    await limpiarTodo();

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Plano y mesas eliminados correctamente");
  });

  it("si no se puede contar lo que hay, ni siquiera abre el diálogo", async () => {
    h.responder.current = (c) => {
      if (c.tabla === "mesas") {
        return { data: null, error: { code: "42501", message: "row-level security" } };
      }
      return { data: [], error: null };
    };

    montar();
    await act(async () => {
      screen.getByRole("button", { name: "Limpiar" }).click();
    });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mensajesDeError().join(" | ")).toMatch(/no se abre el diálogo de limpiar/i);
  });
});

/**
 * El diálogo de "Eliminar mesa" enseña cuántas reservas se van a desvincular.
 * Si esa cuenta falla, antes se enseñaba un "0" tranquilizador — justo la cifra
 * falsa en el momento en el que el usuario más necesita la de verdad.
 */
describe("EditorPlanoEspacio — el diálogo de borrar mesa no miente con un 0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.cadenas.length = 0;
    h.canvasProps.current = null;
    h.responder.current = responderTodoOk;
    contadorInsert = 0;
    guardarPlanoMock.mockResolvedValue({ id: "plano-1" });
  });

  it("no abre el diálogo si no se puede contar las reservas de la mesa", async () => {
    h.responder.current = (c) => {
      if (c.tabla === "asignaciones_mesa") {
        return {
          data: null,
          count: null,
          error: { code: "42501", message: "row-level security" },
        };
      }
      return responderTodoOk(c);
    };

    montar();
    await act(async () => {
      h.canvasProps.current?.onSelectionChange({ id: "m-14", tipo: "mesa", nombre: "14" });
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mensajesDeError().join(" | ")).toMatch(/no se abre el diálogo de borrado/i);
  });

  it("con la cuenta disponible sí abre el diálogo", async () => {
    h.responder.current = (c) => {
      if (c.tabla === "asignaciones_mesa") return { data: null, count: 3, error: null };
      return responderTodoOk(c);
    };

    montar();
    await act(async () => {
      h.canvasProps.current?.onSelectionChange({ id: "m-14", tipo: "mesa", nombre: "14" });
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    });

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/**
 * LA FORMA TERRAZA — el espacio que la primera versión de este arreglo dejó
 * INSALVABLE.
 *
 * En la Terraza los borrados silenciosos SÍ funcionaron: las mesas originales
 * ya no existen y sus ids solo sobreviven dentro del JSON `original_mesas` de
 * las uniones. El plan emite una desactivación por cada una de esas filas
 * fantasma; el UPDATE devuelve 0 filas porque no hay nada que casar, y leer ese
 * 0 como "sin permisos" abortaba el guardado con un mensaje que culpaba a RLS
 * de algo que en realidad ya estaba cumplido de sobra.
 */
describe("EditorPlanoEspacio — forma Terraza (originales ya borradas de verdad)", () => {
  const ORIGINALES_TZ = [
    { id: "m-tz-o1", nombre: "T1", capacidad: 4, forma: "rectangular" as const, ancho: 80, alto: 80 },
    { id: "m-tz-o2", nombre: "T2", capacidad: 4, forma: "rectangular" as const, ancho: 80, alto: 80 },
  ];

  const UNION_TZ = {
    id: "m-tz-u1",
    nombre: "T1+T2",
    capacidad: 8,
    forma: "rectangular" as const,
    ancho: 160,
    alto: 80,
    posX: 1,
    posY: 1,
    rotacion: 0,
    isMerged: true,
    originalMesas: ORIGINALES_TZ,
    etiqueta: null,
  };

  // En la BBDD SOLO está la unión: las dos originales se borraron de verdad.
  const DB_TZ = [
    filaDB("m-tz-u1", "T1+T2", 8, { is_merged: true, original_mesas: ORIGINALES_TZ, ancho: 160 }),
  ];

  const filasVivas = () => new Map([["m-tz-u1", { activa: true }]]);

  beforeEach(() => {
    vi.clearAllMocks();
    h.cadenas.length = 0;
    h.canvasProps.current = null;
    h.panelProps.current = null;
    h.unmergeResultado.current = null;
    contadorInsert = 0;
    guardarPlanoMock.mockResolvedValue({ id: "plano-1" });
  });

  it("guarda LIMPIAMENTE aunque las originales del JSON ya no existan", async () => {
    h.responder.current = responderConFilas(filasVivas());

    montar(DB_TZ);
    await act(async () => {
      h.canvasProps.current?.onMesasChange([UNION_TZ]);
    });
    await act(async () => {
      screen.getByRole("button", { name: "Guardar" }).click();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Plano guardado correctamente");
  });

  it("una fila fantasma no se culpa a los permisos ni corta el guardado", async () => {
    h.responder.current = responderConFilas(filasVivas());

    montar(DB_TZ);
    await act(async () => {
      h.canvasProps.current?.onMesasChange([UNION_TZ]);
    });
    await act(async () => {
      screen.getByRole("button", { name: "Guardar" }).click();
    });

    // Se INTENTÓ desactivarlas (el plan no cambia)…
    const intentos = h.cadenas.filter(
      (c) =>
        c.tabla === "mesas" &&
        tieneMetodo(c, "update") &&
        c.llamadas.some(
          (l) => l.metodo === "eq" && l.args[0] === "id" && String(l.args[1]).startsWith("m-tz-o"),
        ),
    );
    expect(intentos).toHaveLength(2);
    // …y al devolver 0 filas se LEYÓ la fila para desempatar.
    const confirmaciones = h.cadenas.filter(
      (c) => c.tabla === "mesas" && tieneMetodo(c, "maybeSingle"),
    );
    expect(confirmaciones.length).toBeGreaterThanOrEqual(2);
    expect(mensajesDeError()).toEqual([]);
  });

  it("Desagrupar recupera los NÚMEROS reales: inserta T1 y T2 y desactiva la unión", async () => {
    const filas = filasVivas();
    h.responder.current = responderConFilas(filas);
    h.unmergeResultado.current = [
      { id: "mesa-temp-1", nombre: "T1", capacidad: 4, forma: "rectangular", ancho: 80, alto: 80, posX: 1, posY: 1 },
      { id: "mesa-temp-2", nombre: "T2", capacidad: 4, forma: "rectangular", ancho: 80, alto: 80, posX: 3, posY: 1 },
    ];

    montar(DB_TZ);
    await act(async () => {
      h.canvasProps.current?.onMesasChange([UNION_TZ]);
    });
    await act(async () => {
      h.panelProps.current?.onUnmergeMesa("m-tz-u1");
    });
    // CanvasPlano real sustituye la unión por sus hijas; aquí a mano.
    await act(async () => {
      h.canvasProps.current?.onMesasChange(h.unmergeResultado.current!);
    });
    await act(async () => {
      screen.getByRole("button", { name: "Guardar" }).click();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Plano guardado correctamente");

    const insertados = h.cadenas
      .filter((c) => c.tabla === "mesas" && tieneMetodo(c, "insert"))
      .map((c) => (c.llamadas.find((l) => l.metodo === "insert")?.args[0] as { nombre: string }).nombre);
    expect(insertados).toEqual(["T1", "T2"]);

    // La unión queda desactivada, no borrada.
    expect(filas.get("m-tz-u1")).toEqual({ activa: false });
    expect(h.cadenas.filter((c) => c.tabla === "mesas" && tieneMetodo(c, "delete"))).toHaveLength(0);
  });
});

/**
 * Las otras dos lecturas de "cero filas": la fila que ya estaba inactiva (no
 * hay nada que hacer) y la fila que está, sigue activa y aun así no se deja
 * tocar (ese sí es un rechazo de permisos de verdad).
 */
describe("EditorPlanoEspacio — las otras dos lecturas de 'cero filas'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.cadenas.length = 0;
    h.canvasProps.current = null;
    h.panelProps.current = null;
    contadorInsert = 0;
    guardarPlanoMock.mockResolvedValue({ id: "plano-1" });
  });

  const filasSalon = (activaM12: boolean) =>
    new Map([
      ["m-union", { activa: true }],
      ["m-12", { activa: activaM12 }],
      ["m-13", { activa: true }],
      ["m-14", { activa: true }],
    ]);

  it("la fila existe, sigue ACTIVA y no se deja tocar -> sigue siendo un fallo de permisos", async () => {
    h.responder.current = responderConFilas(filasSalon(true), new Set(["m-12"]));

    montar();
    await sembrarYGuardar();

    expect(toast.success).not.toHaveBeenCalled();
    expect(mensajesDeError().join(" | ")).toContain("no se pudo desactivar la mesa 12 (permisos)");
  });

  it("la fila existe y YA estaba inactiva -> la desactivación está cumplida, se guarda", async () => {
    h.responder.current = responderConFilas(filasSalon(false), new Set(["m-12"]));

    montar();
    await sembrarYGuardar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Plano guardado correctamente");
  });

  it("una mesa que otra sesión borró se reporta como 'ya no existe', no como permisos", async () => {
    // `m-14` está en el lienzo pero ya no en la BBDD.
    const filas = new Map([
      ["m-union", { activa: true }],
      ["m-12", { activa: true }],
      ["m-13", { activa: true }],
    ]);
    h.responder.current = responderConFilas(filas);

    montar();
    await sembrarYGuardar();

    expect(toast.success).not.toHaveBeenCalled();
    const mensaje = mensajesDeError().join(" | ");
    expect(mensaje).toContain("no se pudo mover la mesa 14 (ya no existe)");
    expect(mensaje).toContain("Otra sesión las ha borrado");
  });
});
