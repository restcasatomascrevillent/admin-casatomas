// Tablero de Facturas › Análisis: sale hecho al abrir la pestaña.
//   1. Cifras de arriba (por defecto: gasto con IVA, abonos, regalado, por
//      revisar): cada una abre los documentos que forman su cifra.
//   2. Módulos en una rejilla «bento» (pequeño 1 columna, mediano 2, grande 3;
//      los pequeños se empaquetan juntos): proveedores, lo que más ha subido,
//      familias, gastos fijos, abonos, Casa Tomás frente a Touza y los del
//      catálogo. Cada fila abre un menú (ver sus documentos, Compras o el
//      explorador) y la CABECERA de cada tarjeta la amplía: detalle en grande
//      con tabla, gráfica y filtros (DetalleModulo).
//   3. EXPLORAR, la gráfica a medida: es un módulo fijo (se mueve, no se quita)
//      que parte la rejilla en dos.
//   4. Las gráficas fijadas (del explorador y de la IA).
// Qué se ve, en qué orden y de qué tamaño lo elige cada usuario con
// «Personalizar» (ConfiguradorTablero; se guarda en `dashboard_config`).
//
// CONTAINER QUERIES: el tablero es un contenedor (`@container/tablero`); la
// rejilla y las tarjetas se ordenan por SU ancho (con la IA abierta se
// estrecha ~360 px aunque la pantalla siga siendo ancha).
// Solo este bloque hace scroll (la página no): lo pone quien lo usa.
// `pendiente`: las cifras son las del periodo ANTERIOR mientras llega el nuevo
// (placeholderData): se atenúan y no se pueden tocar (sus documentos serían
// de otro periodo).
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, FileText, LayoutGrid, LineChart, Pin, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, plural } from "@/components/facturas/shared/formatters";
import type { GraficaFijada } from "@/lib/facturas/graficasCopiloto";
import {
  ENLACE_PRODUCTOS_COMPRAS,
  enlaceProveedorCompras,
  fechasPeriodo,
  nombreCorto,
  textoMesesIncompletos,
  textoRangoMeses,
  textoVariacion,
  type TableroCompras as Datos,
} from "@/lib/facturas/tableroCompras";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import { notaRetencionGasto } from "@/lib/facturas/retencion";
import { formasEntero, formasImporte } from "@/lib/facturas/cifras";
import { elegirProducto, tramosModulos, type IdCifra, type ModuloActivo } from "@/lib/facturas/widgetsTablero";
import type { IdDetalle } from "@/lib/facturas/detalleModulo";
import { FILTROS_VACIOS, type ConfigExplorador, type ExploracionFijada, type LocalRpc, type Medida } from "@/lib/facturas/explorador";
import { peticionSimple, type PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import { consultaTablero } from "@/hooks/useTableroCompras";
import { useConfigTablero } from "@/hooks/useConfigTablero";
import { ProveedoresTop } from "./GraficasPrincipales";
import { AbonosPorProveedor, CasaTomasYTouza, GastoPorFamilia, GastosFijos, LoQueMasHaSubido } from "./TarjetasDetalle";
import { AlbaranesPorRevisar, EvolucionProducto, GastoPorMesModulo, ProductosMasComprados, RegaladoPorProveedor } from "./ModulosExtra";
import { FijadasDelTablero } from "./FijadasDelTablero";
import { DetalleModulo } from "./DetalleModulo";
import { ConfiguradorTablero } from "./ConfiguradorTablero";
import { COLUMNAS_TAMANO, FOCO, Indicador, REJILLA_BENTO, rejillaCifras, type AccionMenu } from "./piezas";

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
  /** «Personalizar» abierto (el botón está en la barra de Análisis). */
  personalizando?: boolean;
  onPersonalizando?: (v: boolean) => void;
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
  personalizando = false,
  onPersonalizando,
}: Props) {
  const { config, guardar } = useConfigTablero();
  const [detalle, setDetalle] = useState<IdDetalle | null>(null);
  const i = datos.indicadores;
  const variacion = textoVariacion(datos);
  const notaRetencion = notaRetencionGasto(i.gasto, i.retencionIrpf);
  const mesesIncompletos = textoMesesIncompletos(datos.mesesIncompletos ?? []);

  // «Gasto este mes» (solo si está en el tablero): el tablero del mes en curso,
  // que Análisis ya precarga, así que casi siempre sale de la caché.
  const mesActual = useMemo(() => fechasPeriodo("mes", new Date()), []);
  const conMes = config.cifras.includes("gasto_este_mes");
  const tableroMes = useQuery({ ...consultaTablero(mesActual.desde, mesActual.hasta, local), enabled: conMes });

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
  /** Al llevar algo al explorador desde el detalle, el detalle ya se ha cerrado. */
  const ampliar = (id: IdDetalle) => () => setDetalle(id);

  // ─── Cifras de arriba ─────────────────────────────────────────────────────

  const cifra = (id: IdCifra): ReactNode => {
    switch (id) {
      case "gasto":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Gasto con IVA"
            valor={formasImporte(i.gasto)}
            onVer={pendiente ? undefined : () => docs("Gasto con IVA", "gasto", { cifra: i.gasto })}
            nota={
              <>
                {textoRangoMeses(datos.meses)}
                {variacion && (
                  <span
                    className={cn("ml-1 font-medium", variacion.sube ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}
                    title={i.variacionAviso ?? undefined}
                  >
                    · {variacion.texto}
                    {i.variacionAviso && <span className="font-normal text-amber-800 dark:text-amber-400"> (no fiable)</span>}
                  </span>
                )}
              </>
            }
            extra={
              notaRetencion && (
                <span className="block" data-testid="nota-retencion-irpf">
                  {notaRetencion}
                </span>
              )
            }
            avisos={[
              ...(mesesIncompletos ? [<span key="m" data-testid="nota-meses-incompletos">{mesesIncompletos}</span>] : []),
              ...(i.variacionAviso ? [<span key="v">{i.variacionAviso}</span>] : []),
            ]}
          />
        );
      case "abonos":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Abonos"
            valor={formasImporte(i.abonos)}
            nota={plural(i.abonosN, "documento", "documentos")}
            onVer={pendiente ? undefined : () => docs("Abonos", "abonos", { cifra: -i.abonos, detalle: "Importe devuelto" })}
          />
        );
      case "regalado":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Regalado y descuentos"
            valor={formasImporte(i.regalado)}
            onVer={pendiente ? undefined : () => docs("Regalado y descuentos", "regalado", { cifra: i.regalado, detalle: "Lo que valía menos lo que se pagó" })}
            nota={
              <>
                lo que valía {formatCurrency(i.regaladoValia)}
                {i.regaladoEstimadas > 0 && <> · {formatEntero(i.regaladoEstimadas)} estimados</>}
              </>
            }
          />
        );
      case "por_revisar":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Por revisar"
            valor={formasEntero(i.albaranesSinFactura)}
            nota={i.albaranesSinFactura === 1 ? "albarán sin factura" : "albaranes sin factura"}
            avisos={
              i.albaranesSinFactura > 0
                ? [
                    `${plural(i.albaranesSinFactura, "albarán aún no está", "albaranes aún no están")} en una factura (${formatCurrency(i.albaranesSinFacturaImporte)} con IVA).`,
                  ]
                : []
            }
            accion="Ver los albaranes sin factura"
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
        );
      case "gasto_este_mes": {
        const d = tableroMes.data;
        const mes = mesActual.desde ? mesCorto(mesActual.desde.slice(0, 7), true) : "";
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Gasto este mes"
            valor={d ? formasImporte(d.indicadores.gasto) : "…"}
            nota={d ? `${mes} · ${plural(d.indicadores.documentos, "documento", "documentos")}` : "Cargando…"}
            onVer={!d || pendiente ? undefined : () => docs(`Gasto con IVA · ${mes}`, "gasto", { cifra: d.indicadores.gasto, desde: mesActual.desde, hasta: mesActual.hasta })}
          />
        );
      }
      case "media_mes": {
        const n = datos.meses.filter((m) => m.documentos > 0).length;
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Media al mes"
            valor={formasImporte(n ? i.gasto / n : 0)}
            nota={n ? `con IVA · ${plural(n, "mes con documentos", "meses con documentos")}` : "sin meses con documentos"}
            onVer={pendiente ? undefined : ampliar("gasto_mes")}
            accion="Ver en grande, con filtros"
          />
        );
      }
      case "documentos":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Documentos"
            valor={formasEntero(i.documentos)}
            nota={`${plural(i.facturas, "factura", "facturas")} · ${plural(i.abonosN, "abono", "abonos")}`}
            onVer={pendiente ? undefined : () => docs("Documentos del periodo", "documentos", { cifra: i.documentos })}
          />
        );
      case "proveedores":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Proveedores"
            valor={formasEntero(i.proveedores)}
            nota="con compras en el periodo"
            onVer={pendiente ? undefined : ampliar("proveedores")}
            accion="Ver en grande, con filtros"
          />
        );
      case "fijos_mes":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Gastos fijos al mes"
            valor={formasImporte(datos.fijos.totalMedioMes)}
            nota={datos.fijos.proveedores.length ? `con IVA · ${plural(datos.fijos.proveedores.length, "proveedor", "proveedores")}` : "sin gastos fijos detectados"}
            onVer={pendiente ? undefined : ampliar("fijos")}
            accion="Ver en grande, con filtros"
          />
        );
      case "retencion":
        return (
          <Indicador
            key={id}
            deshabilitado={pendiente}
            etiqueta="Retención IRPF"
            valor={formasImporte(i.retencionIrpf)}
            nota={i.retencionIrpfDocumentos ? `en ${plural(i.retencionIrpfDocumentos, "documento", "documentos")} · el gasto ya la descuenta` : "ningún documento con retención"}
            onVer={pendiente ? undefined : () => docs("Retención IRPF", "retencion_irpf", { cifra: i.retencionIrpf })}
          />
        );
      default:
        return null;
    }
  };

  // ─── Módulos ──────────────────────────────────────────────────────────────

  const comunesExtra = { periodo, local, onDocumentos, onIrA, onExplorar, pendiente };
  const modulo = (m: ModuloActivo): ReactNode => {
    const t = m.tamano;
    switch (m.id) {
      case "proveedores":
        return (
          <ProveedoresTop
            tamano={t}
            onAmpliar={ampliar("proveedores")}
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
        );
      case "subidas":
        return (
          <LoQueMasHaSubido
            tamano={t}
            onAmpliar={ampliar("subidas")}
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
        );
      case "familias":
        return (
          <GastoPorFamilia
            tamano={t}
            onAmpliar={ampliar("familias")}
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
        );
      case "fijos":
        return (
          <GastosFijos
            tamano={t}
            onAmpliar={ampliar("fijos")}
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
        );
      case "abonos":
        return (
          <AbonosPorProveedor
            tamano={t}
            onAmpliar={ampliar("abonos")}
            abonos={datos.abonos}
            acciones={siListo((a: Datos["abonos"][number]) =>
              a.id === null
                ? []
                : [verDocs(() => docs(`Abonos de ${nombreCorto(a.nombre)}`, "abonos", { agrupar: "proveedor", clave: String(a.id), cifra: -a.importe })), ...enCompras(a.id)],
            )}
          />
        );
      case "locales":
        return (
          <CasaTomasYTouza
            tamano={t}
            onAmpliar={ampliar("locales")}
            locales={datos.locales}
            onVer={pendiente ? undefined : (l, gasto) => docs(l === "touza" ? "Touza" : "Casa Tomás", "gasto", { agrupar: "local", clave: l, cifra: gasto, sinLocal: true })}
          />
        );
      case "gasto_mes":
        return <GastoPorMesModulo tamano={t} onAmpliar={ampliar("gasto_mes")} meses={datos.meses} periodo={periodo} local={local} onDocumentos={onDocumentos} pendiente={pendiente} />;
      case "productos":
        return <ProductosMasComprados {...comunesExtra} tamano={t} onAmpliar={ampliar("productos")} />;
      case "por_revisar":
        return <AlbaranesPorRevisar {...comunesExtra} tamano={t} onAmpliar={ampliar("por_revisar")} />;
      case "regalado":
        return <RegaladoPorProveedor {...comunesExtra} tamano={t} onAmpliar={ampliar("regalado")} />;
      case "precio_producto":
        return (
          <EvolucionProducto
            periodo={periodo}
            local={local}
            tamano={t}
            producto={m.producto}
            // El producto elegido se guarda con el tablero (como cualquier otro cambio de «Personalizar»).
            onElegir={(p) => void guardar(elegirProducto(config, p))}
            onAmpliar={ampliar("precio_producto")}
          />
        );
      default:
        return null;
    }
  };

  const rejilla = (lista: ModuloActivo[], etiqueta: string) =>
    lista.length > 0 && (
      <div className={cn(REJILLA_BENTO, atenuar)} aria-busy={pendiente || undefined} role="group" aria-label={etiqueta} data-testid="rejilla-modulos">
        {lista.map((m) => (
          <div key={m.id} className={cn("min-w-0", COLUMNAS_TAMANO[m.tamano])} data-modulo={m.id} data-tamano={m.tamano}>
            {modulo(m)}
          </div>
        ))}
      </div>
    );

  const { antes, despues } = tramosModulos(config);
  const vacio = config.cifras.length === 0 && antes.length === 0 && despues.length === 0;

  return (
    <div className="@container/tablero space-y-4 pb-4">
      {/* 1 · Cifras */}
      {config.cifras.length > 0 && (
        <ul className={cn(rejillaCifras(config.cifras.length), atenuar)} aria-label="Indicadores del periodo" aria-busy={pendiente || undefined} data-tour="facturas-analisis-indicadores">
          {config.cifras.map(cifra)}
        </ul>
      )}

      {/* 2 · Módulos antes de Explorar, 3 · Explorar, módulos después */}
      {rejilla(antes, "Módulos")}
      {explorador}
      {rejilla(despues, antes.length ? "Más módulos" : "Módulos")}

      {/* Al final, como en los tableros de widgets: añadir o quitar módulos (en el móvil
          es la única entrada; en la barra no cabe sin dejar sola a la IA). */}
      {onPersonalizando && (
        <button
          type="button"
          onClick={() => onPersonalizando(true)}
          aria-haspopup="dialog"
          className={cn(
            "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground",
            FOCO,
          )}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
          {vacio ? "Has quitado todo: añade cifras o módulos" : "Añadir o quitar módulos"}
        </button>
      )}

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

      <DetalleModulo
        modulo={detalle}
        producto={config.modulos.find((m) => m.id === "precio_producto")?.producto ?? null}
        onCerrar={() => setDetalle(null)} periodo={periodo} local={local} onDocumentos={onDocumentos} onIrA={onIrA} onExplorar={onExplorar} />
      <ConfiguradorTablero
        abierto={personalizando}
        config={config}
        onCerrar={() => onPersonalizando?.(false)}
        onGuardar={async (c) => {
          const r = await guardar(c);
          if (r.enCuenta) toast.success("Tablero guardado en tu cuenta");
          else toast.info("Tablero guardado en este navegador", { description: "No se ha podido guardar en tu cuenta; se recuerda solo aquí." });
        }}
      />
    </div>
  );
}
