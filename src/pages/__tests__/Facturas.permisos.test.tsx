/**
 * Facturas según los permisos (dueño, 06/11/2026; ver lib/facturas/permisos.ts):
 *   · solo «Ver»       → Análisis y Compras en lectura: sin Cargar, sin IA (ni
 *                        botón, ni pantalla completa, ni «Preguntar a la IA» en
 *                        Compras, ni su gasto), con la etiqueta «Solo lectura».
 *   · solo Subida      → solo Cargar (los enlaces a Análisis o Compras llevan a
 *                        ella), sin avisos de compras ni gasto de lectura.
 *   · Subida + «Ver»   → Análisis y Compras en lectura + Cargar.
 *   · «Editar»         → todo, como siempre.
 *   · super admin      → todo.
 * Las pestañas de verdad tienen sus tests: aquí son marcadores que enseñan lo
 * que reciben (si tienen IA, si pueden editar, si hay «Preguntar a la IA»).
 */
import { forwardRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/facturas/compras/TabCompras", () => ({
  TabCompras: ({ onPreguntarIA }: { onPreguntarIA?: unknown }) => (
    <p data-testid="compras">Compras{onPreguntarIA ? " · con «Preguntar a la IA»" : " · sin IA"}</p>
  ),
}));
vi.mock("@/components/facturas/ChatFacturas", () => ({
  ChatFacturas: forwardRef(({ conIa, puedeEditar }: { conIa?: boolean; puedeEditar?: boolean }, _ref) => (
    <p data-testid="analisis">Análisis · IA: {conIa ? "sí" : "no"} · editar: {puedeEditar ? "sí" : "no"}</p>
  )),
}));
vi.mock("@/components/analisis/margenes/MargenesCarta", () => ({
  MargenesCarta: ({ puedeEditar, articuloInicial }: { puedeEditar: boolean; articuloInicial?: { tipo: string; id: string } | null }) => (
    <p data-testid="margenes">
      Márgenes · editar: {puedeEditar ? "sí" : "no"}
      {articuloInicial ? ` · ficha ${articuloInicial.tipo} ${articuloInicial.id}` : ""}
    </p>
  ),
}));
vi.mock("@/components/facturas/SubidaFacturas", () => ({ SubidaFacturas: () => <p data-testid="subida">Subida</p> }));
vi.mock("@/components/facturas/GastoIaPestana", () => ({ GastoIaPestana: () => <span data-testid="gasto-ia-pestana">gasto IA</span> }));
vi.mock("@/components/facturas/MonitorGastoIA", () => ({ MonitorGastoIA: () => <span data-testid="monitor-ocr">gasto lectura</span> }));
vi.mock("@/components/avisos/BotonAvisosSeccion", () => ({ BotonAvisosSeccion: () => <button type="button">Avisos de facturas</button> }));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => <button type="button">Ayuda</button> }));
vi.mock("@/components/facturas/ImportacionHistoricaDialog", () => ({ ImportacionHistoricaDialog: () => null }));
const contador = vi.hoisted(() => ({ opciones: [] as unknown[] }));
vi.mock("@/hooks/useContadorDocumentos", () => ({
  useContadorDocumentos: (o?: unknown) => {
    contador.opciones.push(o);
    return { data: 3 };
  },
}));

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
const h = vi.hoisted(() => ({ permisos: {} as Permisos, superAdmin: false, admin: false }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: h.admin ? "admin" : "staff", isAdmin: h.admin, permissions: [], loading: false }),
  // Como el de verdad: el super admin, todo; si no, lo marcado.
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({
    canAccess: h.superAdmin || !!h.permisos[seccion]?.[tipo],
    loading: false,
  }),
}));

import Facturas from "@/pages/Facturas";

const PERFILES: Record<string, Permisos> = {
  soloVer: { facturas: { view: true } },
  soloSubida: { facturas_subida: { view: true } },
  subidaVer: { facturas: { view: true }, facturas_subida: { view: true } },
  editar: { facturas: { view: true, edit: true } },
};

const ubicacion = { actual: "" };
function Ubicacion() {
  const l = useLocation();
  ubicacion.actual = `${l.pathname}${l.search}`;
  return null;
}

function montar(perfil: keyof typeof PERFILES | "superAdmin", ruta = "/facturas", { admin = false } = {}) {
  h.superAdmin = perfil === "superAdmin";
  h.permisos = perfil === "superAdmin" ? {} : PERFILES[perfil];
  h.admin = admin;
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Ubicacion />
      <Routes>
        <Route path="/facturas" element={<Facturas />} />
        <Route path="/facturas/ia" element={<Facturas />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pestanas = () => within(screen.getByRole("tablist")).getAllByRole("tab").map((p) => p.textContent?.replace(/\d+.*$/, "").trim());

afterEach(() => {
  contador.opciones = [];
});

describe("Facturas con solo «Ver»: consultar", () => {
  it("Análisis, Márgenes y Compras, sin Cargar; etiqueta «Solo lectura» y sin IA", () => {
    montar("soloVer");
    expect(pestanas()).toEqual(["Análisis", "Márgenes", "Compras"]);
    expect(screen.getByTestId("etiqueta-solo-lectura")).toHaveTextContent("Solo lectura");
    expect(screen.getByTestId("analisis")).toHaveTextContent("IA: no · editar: no");
    expect(screen.queryByTestId("gasto-ia-pestana")).toBeNull();
    expect(screen.getByRole("button", { name: "Avisos de facturas" })).toBeInTheDocument();
    expect(screen.queryByTestId("subida")).toBeNull();
  });

  it("Compras sin «Preguntar a la IA»", () => {
    montar("soloVer", "/facturas?tab=compras");
    expect(screen.getByTestId("compras")).toHaveTextContent("sin IA");
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
  });

  it("?tab=cargar le lleva a Análisis (no tiene Cargar)", () => {
    montar("soloVer", "/facturas?tab=cargar");
    expect(screen.getByRole("tab", { name: /^Análisis/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("subida")).toBeNull();
    expect(ubicacion.actual).toBe("/facturas?tab=chat");
  });

  it("/facturas/ia (la IA a pantalla completa) vuelve a /facturas", () => {
    montar("soloVer", "/facturas/ia?c=123");
    expect(ubicacion.actual).toBe("/facturas");
    expect(screen.getByRole("tab", { name: /^Análisis/ })).toHaveAttribute("aria-selected", "true");
  });

  it("un administrador con solo «Ver» tampoco ve la importación histórica", () => {
    montar("soloVer", "/facturas?tab=cargar", { admin: true });
    expect(screen.queryByRole("button", { name: /Importación histórica/ })).toBeNull();
  });
});

describe("Facturas › Márgenes (antes «Análisis general», 10/11/2026)", () => {
  it("con solo «Ver»: la pestaña Márgenes en lectura", () => {
    montar("soloVer", "/facturas?tab=margenes");
    expect(screen.getByRole("tab", { name: /^Márgenes/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("margenes")).toHaveTextContent("Márgenes · editar: no");
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
  });

  it("con «Editar»: puede corregir escandallos y umbrales", () => {
    montar("editar", "/facturas?tab=margenes");
    expect(screen.getByTestId("margenes")).toHaveTextContent("Márgenes · editar: sí");
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
  });

  it("el enlace del Dashboard (?articulo=plato:<id>) abre esa ficha", () => {
    montar("soloVer", "/facturas?tab=margenes&articulo=plato:p-42");
    expect(screen.getByTestId("margenes")).toHaveTextContent("ficha plato p-42");
  });

  it("solo se monta al verla (su consulta es aparte de Análisis)", () => {
    montar("editar");
    expect(screen.queryByTestId("margenes")).toBeNull();
  });

  it("con solo Subida, ?tab=margenes lleva a Cargar", () => {
    montar("soloSubida", "/facturas?tab=margenes");
    expect(screen.getByRole("tab", { name: /^Cargar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("margenes")).toBeNull();
  });
});

describe("Facturas con solo «Facturas · Subida»: solo Cargar", () => {
  it("entra directo en Cargar, la única pestaña, sin «Solo lectura», sin IA ni avisos ni gasto de lectura", () => {
    montar("soloSubida");
    expect(pestanas()).toEqual(["Cargar"]);
    expect(screen.getByRole("tab", { name: /^Cargar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("subida")).toBeInTheDocument();
    expect(screen.queryByTestId("analisis")).toBeNull();
    expect(screen.queryByTestId("compras")).toBeNull();
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
    expect(screen.queryByTestId("gasto-ia-pestana")).toBeNull();
    expect(screen.queryByRole("button", { name: "Avisos de facturas" })).toBeNull();
    expect(screen.queryByTestId("monitor-ocr")).toBeNull();
    expect(screen.getByRole("button", { name: "Ayuda" })).toBeInTheDocument();
    // La URL dice dónde está (la cola sabe así que se ve «Cargar»).
    expect(ubicacion.actual).toBe("/facturas?tab=cargar");
    // Sin Compras no se pide el contador de documentos.
    expect(contador.opciones.every((o) => (o as { enabled?: boolean })?.enabled === false)).toBe(true);
  });

  it.each(["/facturas?tab=compras&modo=documentos&doc=7", "/facturas?tab=chat", "/facturas?tab=productos", "/facturas?prov=12"])(
    "un enlace a Análisis o Compras (%s) le lleva a Cargar",
    (ruta) => {
      montar("soloSubida", ruta);
      expect(screen.getByRole("tab", { name: /^Cargar/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.queryByTestId("compras")).toBeNull();
      expect(ubicacion.actual).toBe("/facturas?tab=cargar");
    },
  );

  it("/facturas/ia le lleva a Cargar", () => {
    montar("soloSubida", "/facturas/ia");
    expect(screen.getByRole("tab", { name: /^Cargar/ })).toHaveAttribute("aria-selected", "true");
    expect(ubicacion.actual).toBe("/facturas?tab=cargar");
  });
});

describe("Facturas con «Facturas · Subida» + «Ver»", () => {
  it("Análisis · Márgenes · Compras · Cargar; Análisis en lectura y sin IA", () => {
    montar("subidaVer");
    expect(pestanas()).toEqual(["Análisis", "Márgenes", "Compras", "Cargar"]);
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
    expect(screen.getByTestId("analisis")).toHaveTextContent("IA: no · editar: no");
    expect(screen.queryByTestId("gasto-ia-pestana")).toBeNull();
  });

  it("en Cargar no sale «Solo lectura» (ahí sube y corrige lo suyo) y sí el gasto de lectura", () => {
    montar("subidaVer", "/facturas?tab=cargar");
    expect(screen.getByTestId("subida")).toBeInTheDocument();
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
    expect(screen.getByTestId("monitor-ocr")).toBeInTheDocument();
  });
});

describe("Facturas con «Editar» o super admin: todo, como siempre", () => {
  it.each(["editar", "superAdmin"] as const)("%s: las tres pestañas, la IA y su gasto, sin «Solo lectura»", (perfil) => {
    montar(perfil);
    expect(pestanas()).toEqual(["Análisis", "Márgenes", "Compras", "Cargar"]);
    expect(screen.getByTestId("analisis")).toHaveTextContent("IA: sí · editar: sí");
    expect(screen.getByTestId("gasto-ia-pestana")).toBeInTheDocument();
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
  });

  it("Compras con «Preguntar a la IA»", () => {
    montar("editar", "/facturas?tab=compras");
    expect(screen.getByTestId("compras")).toHaveTextContent("con «Preguntar a la IA»");
  });

  it("un administrador con «Editar» ve la importación histórica en Cargar", () => {
    montar("editar", "/facturas?tab=cargar", { admin: true });
    expect(screen.getByRole("button", { name: /Importación histórica/ })).toBeInTheDocument();
    expect(screen.getByTestId("monitor-ocr")).toBeInTheDocument();
  });

  it("/facturas/ia se queda en la IA a pantalla completa", () => {
    montar("editar", "/facturas/ia");
    expect(ubicacion.actual).toBe("/facturas/ia");
    expect(screen.getByTestId("analisis")).toHaveTextContent("IA: sí");
  });
});
