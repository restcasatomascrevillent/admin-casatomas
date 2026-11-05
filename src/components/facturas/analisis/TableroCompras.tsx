// Tablero de Facturas › Análisis: sale hecho al abrir la pestaña.
//   1. Cuatro indicadores (gasto con IVA, abonos, regalado, por revisar): cada
//      uno abre los documentos que forman su cifra.
//   2. EXPLORAR: la gráfica a medida (por defecto, el gasto por mes y local).
//   3. Detalle en rejilla (2 columnas en tablet, 3 en pantallas anchas, 1 en
//      móvil): proveedores, lo que más ha subido, familias, gastos fijos,
//      abonos y Casa Tomás frente a Touza. Cada fila abre un menú: ver sus
//      documentos, abrirlo en Compras o llevarlo al explorador.
//   4. Las gráficas fijadas (del explorador y de la IA).
// Solo este bloque hace scroll (la página no): lo pone quien lo usa.
// `pendiente`: las cifras son las del periodo ANTERIOR mientras llega el nuevo
// (placeholderData): se atenúan y no se pueden tocar (sus documentos serían
// de otro periodo).
import type { ReactNode } from "react";
import { BarChart3, FileText, LineChart, Pin, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, formatImporte, plural } from "@/components/facturas/shared/formatters";
import type { GraficaFijada } from "@/lib/facturas/graficasCopiloto";
import {
  ENLACE_PRODUCTOS_COMPRAS,
  enlaceProveedorCompras,
  nombreCorto,
  textoRangoMeses,
  textoVariacion,
  type TableroCompras as Datos,
} from "@/lib/facturas/tableroCompras";
import { FILTROS_VACIOS, type ConfigExplorador, type ExploracionFijada, type LocalRpc, type Medida } from "@/lib/facturas/explorador";
import { peticionSimple, type PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import { ProveedoresTop } from "./GraficasPrincipales";
import { AbonosPorProveedor, CasaTomasYTouza, GastoPorFamilia, GastosFijos, LoQueMasHaSubido } from "./TarjetasDetalle";
import { FijadasDelTablero } from "./FijadasDelTablero";
import { Indicador, type AccionMenu } from "./piezas";

interface Props {
  datos: Datos;
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  /** La tarjeta «Explorar» (la monta quien tiene su estado). */
  explorador: ReactNode;
  onDocumentos: (p: PeticionDocumentos) => void;
  onIrA: (enlace: string) => void;
  /** Lleva una configuración al explorador (y lo enseña). */
  onExplorar: (c: Partial<ConfigExplorador>) => void;
  fijadasIa: GraficaFijada[];
  onQuitarFijadaIa: (id: string) => void;
  fijadasExplorador: ExploracionFijada[];
  onQuitarFijadaExplorador: (id: string) => void;
  /** Se ven las cifras del periodo anterior mientras llega el nuevo. */
  pendiente?: boolean;
}

const ICONO = "h-4 w-4 text-muted-foreground";

export function TableroCompras({
  datos,
  periodo,
  local,
  explorador,
  onDocumentos,
  onIrA,
  onExplorar,
  fijadasIa,
  onQuitarFijadaIa,
  fijadasExplorador,
  onQuitarFijadaExplorador,
  pendiente = false,
}: Props) {
  const i = datos.indicadores;
  const variacion = textoVariacion(datos);

  const docs = (
    titulo: string,
    medida: Medida,
    extra: {
      filtros?: Record<string, unknown>;
      agrupar?: "proveedor" | "familia" | "local";
      clave?: string;
      cifra?: number | null;
      desde?: string | null;
      hasta?: string | null;
      detalle?: string;
      sinLocal?: boolean;
    } = {},
  ) =>
    onDocumentos(
      peticionSimple({
        titulo,
        detalle: extra.detalle,
        desde: extra.desde !== undefined ? extra.desde : periodo.desde,
        hasta: extra.hasta !== undefined ? extra.hasta : periodo.hasta,
        medida,
        filtros: extra.filtros,
        local: extra.sinLocal ? null : local,
        agrupar: extra.agrupar,
        clave: extra.clave,
        cifra: extra.cifra,
      }),
    );

  const atenuar = cn("transition-opacity", pendiente && "opacity-60");
  /** Mientras carga otro periodo, nada se puede tocar (las filas quedan desactivadas). */
  const siListo = <T,>(f: (x: T) => AccionMenu[]) => (x: T): AccionMenu[] => (pendiente ? [] : f(x));
  const verDocs = (onClick: () => void): AccionMenu => ({ etiqueta: "Ver documentos", icono: <FileText className={ICONO} aria-hidden />, onClick });
  const enCompras = (id: number | null): AccionMenu[] =>
    id === null ? [] : [{ etiqueta: "Abrir en Compras", icono: <ShoppingCart className={ICONO} aria-hidden />, onClick: () => onIrA(enlaceProveedorCompras(id)) }];
  const explorar = (etiqueta: string, c: Partial<ConfigExplorador>): AccionMenu => ({
    etiqueta,
    icono: <BarChart3 className={ICONO} aria-hidden />,
    onClick: () => onExplorar(c),
  });

  return (
    <div className="space-y-4 pb-4">
      {/* 1 · Indicadores */}
      {/* 2 columnas hasta 1024 px: a 4 no caben las cifras ni las notas en 768/1024 (QA 05/11/2026). */}
      <ul
        className={cn("grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4", atenuar)}
        aria-label="Indicadores del periodo"
        aria-busy={pendiente || undefined}
        data-tour="facturas-analisis-indicadores"
      >
        <Indicador
          etiqueta="Gasto con IVA"
          valor={formatCurrency(i.gasto)}
          onVer={pendiente ? undefined : () => docs("Gasto con IVA", "gasto", { cifra: i.gasto })}
          nota={
            <>
              {textoRangoMeses(datos.meses)}
              {variacion && (
                <span className={cn("ml-1 font-medium", variacion.sube ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                  · {variacion.texto}
                </span>
              )}
            </>
          }
        />
        <Indicador
          etiqueta="Abonos"
          valor={formatImporte(i.abonos)}
          nota={plural(i.abonosN, "documento", "documentos")}
          onVer={pendiente ? undefined : () => docs("Abonos", "abonos", { cifra: -i.abonos, detalle: "Importe devuelto" })}
        />
        <Indicador
          etiqueta="Regalado y descuentos"
          valor={formatCurrency(i.regalado)}
          onVer={pendiente ? undefined : () => docs("Regalado y descuentos", "regalado", { cifra: i.regalado, detalle: "Lo que valía menos lo que se pagó" })}
          nota={
            <>
              lo que valía {formatCurrency(i.regaladoValia)}
              {i.regaladoEstimadas > 0 && <> · {formatEntero(i.regaladoEstimadas)} estimados</>}
            </>
          }
        />
        <Indicador
          etiqueta="Por revisar"
          valor={formatEntero(i.albaranesSinFactura)}
          nota={i.albaranesSinFactura === 1 ? "albarán sin factura" : "albaranes sin factura"}
          claseNota={i.albaranesSinFactura > 0 ? "font-medium text-amber-800 dark:text-amber-400" : undefined}
          onVer={
            pendiente
              ? undefined
              : () =>
            docs("Albaranes sin factura", "gasto", {
              filtros: { tipos: ["albaran"] },
              cifra: i.albaranesSinFacturaImporte,
              detalle: "Gasto con IVA de los albaranes que aún no están en una factura",
            })
          }
        />
      </ul>

      {/* 2 · Explorar */}
      {explorador}

      {/* 3 · Detalle */}
      <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-3", atenuar)} aria-busy={pendiente || undefined}>
        <ProveedoresTop
          proveedores={datos.proveedores}
          acciones={siListo((p: Datos["proveedores"][number]) =>
            p.id === null
              ? []
              : [
                  verDocs(() => docs(nombreCorto(p.nombre), "gasto", { agrupar: "proveedor", clave: String(p.id), cifra: p.gasto })),
                  ...enCompras(p.id),
                  explorar("Ver su gasto por mes", {
                    medida: "gasto",
                    agrupar: "mes",
                    desglose: null,
                    filtros: { ...FILTROS_VACIOS, proveedores: [{ id: p.id, nombre: nombreCorto(p.nombre) }] },
                  }),
                ],
          )}
        />
        <LoQueMasHaSubido
          subidas={datos.subidas}
          acciones={siListo((s: Datos["subidas"]["productos"][number]) => [
            {
              etiqueta: "Ver su precio en el explorador",
              icono: <LineChart className={ICONO} aria-hidden />,
              onClick: () =>
                onExplorar({
                  medida: "precio",
                  agrupar: "mes",
                  desglose: "proveedor",
                  filtros: { ...FILTROS_VACIOS, productos: [s.producto], unidad: s.unidad ? s.unidad.toLowerCase() : null },
                }),
            },
            ...(s.proveedor_id !== null
              ? [
                  verDocs(() =>
                    docs(`${s.producto} · ${nombreCorto(s.proveedor)}`, "base", {
                      filtros: { proveedores: [s.proveedor_id], productos: [s.producto] },
                      detalle: "Base sin IVA de sus líneas",
                    }),
                  ),
                  ...enCompras(s.proveedor_id),
                ]
              : []),
          ])}
        />
        <GastoPorFamilia
          familias={datos.familias}
          onClasificar={() => onIrA(ENLACE_PRODUCTOS_COMPRAS)}
          acciones={siListo((f: Datos["familias"]["familias"][number]) =>
            f.id === null
              ? []
              : [
                  verDocs(() => docs(f.familia, "base", { agrupar: "familia", clave: String(f.id), cifra: f.importe, detalle: "Base sin IVA de sus líneas" })),
                  explorar("Ver por mes en el explorador", {
                    medida: "base",
                    agrupar: "mes",
                    desglose: null,
                    filtros: { ...FILTROS_VACIOS, familias: [{ id: f.id as number, nombre: f.familia }] },
                  }),
                ],
          )}
        />
        <GastosFijos
          fijos={datos.fijos}
          acciones={siListo((f: Datos["fijos"]["proveedores"][number]) =>
            f.id === null
              ? []
              : [
                  verDocs(() =>
                    docs(nombreCorto(f.nombre), "gasto", {
                      filtros: { proveedores: [f.id], tipos: ["factura"] },
                      // Los meses de SU media (si la RPC los da): ni uno más (QA 05/11/2026).
                      desde: f.desdeMedia ?? datos.fijos.ventana?.desde ?? periodo.desde,
                      hasta: f.hastaMedia ?? datos.fijos.ventana?.hasta ?? periodo.hasta,
                      detalle: `Sus facturas · media de ${plural(f.meses, "mes", "meses")}: ${formatCurrency(f.medio_mes)} al mes`,
                    }),
                  ),
                  ...enCompras(f.id),
                ],
          )}
        />
        <AbonosPorProveedor
          abonos={datos.abonos}
          acciones={siListo((a: Datos["abonos"][number]) =>
            a.id === null
              ? []
              : [verDocs(() => docs(`Abonos de ${nombreCorto(a.nombre)}`, "abonos", { agrupar: "proveedor", clave: String(a.id), cifra: -a.importe })), ...enCompras(a.id)],
          )}
        />
        <CasaTomasYTouza
          locales={datos.locales}
          onVer={pendiente ? undefined : (l, gasto) => docs(l === "touza" ? "Touza" : "Casa Tomás", "gasto", { agrupar: "local", clave: l, cifra: gasto, sinLocal: true })}
        />
      </div>

      {/* 4 · Fijadas */}
      {(fijadasExplorador.length > 0 || fijadasIa.length > 0) && (
        <section aria-labelledby="titulo-fijadas" className="space-y-2">
          <h3 id="titulo-fijadas" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <Pin className="h-3.5 w-3.5" aria-hidden /> Tus gráficas fijadas
          </h3>
          <FijadasDelTablero
            periodo={periodo}
            local={local}
            explorador={fijadasExplorador}
            onQuitarExplorador={onQuitarFijadaExplorador}
            onAbrir={(c) => onExplorar(c)}
            ia={fijadasIa}
            onQuitarIa={onQuitarFijadaIa}
          />
        </section>
      )}
    </div>
  );
}
