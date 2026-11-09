// Tablero de Facturas › Análisis EN UNA PANTALLA (maqueta aprobada por el dueño,
// 07/11/2026: «se pierde con tanto scroll»). Sin scroll de página: arriba
//   1. cuatro cifras que también son navegación (Gasto, Precios que han subido,
//      Puedes ahorrar, Por revisar): pulsar una abre su vista y queda marcada;
//   2. las pastillas de las vistas; y
//   3. UNA vista a la vez, que reparte el alto que queda entre sus cajas (cada
//      lista hace scroll DENTRO de su caja):
//        · Qué decidir hoy  las 5 decisiones que más dinero mueven + gasto por mes;
//        · Precios          maestro-detalle: lista y gráfica del elegido;
//        · Ahorro           mismo producto más barato en otro proveedor, explicado;
//        · Gasto            familias frente a su media, gastos fijos, abonos…;
//        · Proveedores      maestro-detalle: lista comparada con el anterior y ficha del elegido;
//        · Por revisar      albaranes sin factura y los demás avisos.
// (La vista «Explorar» se quitó el 08/11/2026; las gráficas fijadas salen en «Qué decidir hoy».)
// La vista elegida se recuerda (?vista= y localStorage; la lleva ChatFacturas).
// «Personalizar» (ConfiguradorTablero) sigue eligiendo qué módulos se ven: cada
// uno vive en su vista (lib/facturas/vistasAnalisis › VISTA_DE_MODULO), y las
// cifras que elige salen en «Gasto».
// Sin facturas_decision (migración sin aplicar) se quedan las tarjetas de antes.
// `pendiente`: las cifras son las del periodo ANTERIOR mientras llega el nuevo
// (placeholderData): se atenúan y no se pueden tocar.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Pin, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, plural } from "@/components/facturas/shared/formatters";
import type { GraficaFijada } from "@/lib/facturas/graficasCopiloto";
import {
  ENLACE_PRODUCTOS_COMPRAS,
  enlaceProveedorCompras,
  fechasPeriodo,
  nombreCorto,
  textoMesesIncompletos,
  textoPct,
  textoRangoMeses,
  textoVariacion,
  type TableroCompras as Datos,
} from "@/lib/facturas/tableroCompras";
import { etiquetaMes } from "@/lib/facturas/agrupacionDocumentos";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import { notaRetencionGasto } from "@/lib/facturas/retencion";
import { formasEntero, formasImporte } from "@/lib/facturas/cifras";
import { elegirProducto, type IdCifra, type IdModulo, type ModuloActivo } from "@/lib/facturas/widgetsTablero";
import type { IdDetalle } from "@/lib/facturas/detalleModulo";
import { type ExploracionFijada, type LocalRpc, type Medida } from "@/lib/facturas/explorador";
import { peticionSimple, type PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import { consultaTablero } from "@/hooks/useTableroCompras";
import { useConfigTablero } from "@/hooks/useConfigTablero";
import { useAlertasFacturas } from "@/hooks/useAlertasFacturas";
import { alertasDelPeriodo, umbralSubida } from "@/lib/facturas/alertas";
import { useDecisionFacturas } from "@/hooks/useDecisionFacturas";
import { resumenDecision } from "@/lib/facturas/decision";
import { resumenCortoAlerta, tituloCortoAlerta } from "@/lib/facturas/alertas";
import { VISTAS, type IdVista } from "@/lib/facturas/vistasAnalisis";
import { FamiliasFrenteMedia } from "./Decision";
import { ProveedoresTop } from "./GraficasPrincipales";
import { AbonosPorProveedor, CasaTomasYTouza, GastoPorFamilia, GastosFijos, LoQueMasHaSubido } from "./TarjetasDetalle";
import { AlbaranesPorRevisar, EvolucionProducto, GastoPorMesModulo, ProductosMasComprados, RegaladoPorProveedor } from "./ModulosExtra";
import { FijadasDelTablero } from "./FijadasDelTablero";
import { DetalleModulo } from "./DetalleModulo";
import { ConfiguradorTablero } from "./ConfiguradorTablero";
import { VistaProveedores } from "./VistaProveedores";
import { AhorroExplicado, AvisosPorRevisar, Caja, PreciosMaestroDetalle, QueDecidirHoy } from "./Vistas";
import { Cifra } from "./Cifra";
import { FOCO, Indicador, SinDatos, TarjetaLlena, type AccionMenu } from "./piezas";

interface Props {
  datos: Datos;
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  onDocumentos: (p: PeticionDocumentos) => void;
  onIrA: (enlace: string) => void;
  fijadasIa: GraficaFijada[];
  onQuitarFijadaIa: (id: string) => void;
  fijadasExplorador: ExploracionFijada[];
  onQuitarFijadaExplorador: (id: string) => void;
  /** Se ven las cifras del periodo anterior mientras llega el nuevo. */
  pendiente?: boolean;
  /** «Personalizar» abierto (el botón está en la barra de Análisis). */
  personalizando?: boolean;
  onPersonalizando?: (v: boolean) => void;
  /** La vista que se ve (la recuerda ChatFacturas en la URL). */
  vista?: IdVista;
  onVista?: (v: IdVista) => void;
}

const ICONO = "h-4 w-4 text-muted-foreground";
/** Cifras que ya están arriba (navegación) o en «Qué decidir hoy»: no se repiten en «Gasto». */
const CIFRAS_NAVEGACION = new Set<IdCifra>(["gasto", "precios_suben", "ahorro_posible", "familias_fuera", "por_revisar"]);
/** Rejilla de cada vista: una columna en estrecho (y entonces la vista hace scroll); en ancho, lado a lado y sin scroll. */
const DOS = "grid grid-cols-1 gap-3 @[48rem]/tablero:h-full @[48rem]/tablero:[grid-template-rows:minmax(0,1fr)]";
const COLUMNA = "grid min-h-0 grid-cols-1 gap-3 @[48rem]/tablero:[grid-auto-rows:minmax(0,1fr)]";

export function TableroCompras({
  datos,
  periodo,
  local,
  onDocumentos,
  onIrA,
  fijadasIa,
  onQuitarFijadaIa,
  fijadasExplorador,
  onQuitarFijadaExplorador,
  pendiente = false,
  personalizando = false,
  onPersonalizando,
  vista: vistaProp,
  onVista,
}: Props) {
  const { config, guardar } = useConfigTablero();
  const [detalle, setDetalle] = useState<IdDetalle | null>(null);
  const [vistaPropia, setVistaPropia] = useState<IdVista>("decidir");
  const vista = vistaProp ?? vistaPropia;
  const irAVista = (v: IdVista) => (onVista ? onVista(v) : setVistaPropia(v));
  /** Precio elegido en la vista «Precios» («Ver precio» desde «Qué decidir hoy»). */
  const [precioElegido, setPrecioElegido] = useState<string | null>(null);
  // Alertas vigentes: las gráficas marcan las de su periodo.
  const alertasQ = useAlertasFacturas(local);
  const alertas = useMemo(() => alertasQ.data ?? [], [alertasQ.data]);
  const alertasPeriodo = useMemo(() => alertasDelPeriodo(alertas, periodo, local), [alertas, periodo, local]);
  const umbral = umbralSubida(alertas) ?? 10;
  // Gráficas de decisión (null = migración sin aplicar: se quedan las tarjetas de antes).
  const decisionQ = useDecisionFacturas(periodo.desde, periodo.hasta, local);
  const dec = decisionQ.data ?? null;
  const rd = useMemo(() => (dec ? resumenDecision(dec) : null), [dec]);
  const otrosAvisos = dec?.cambios.otros ?? [];
  const i = datos.indicadores;
  const variacion = textoVariacion(datos);
  const notaRetencion = notaRetencionGasto(i.gasto, i.retencionIrpf);
  const mesesIncompletos = textoMesesIncompletos(datos.mesesIncompletos ?? []);
  const activos = useMemo(() => new Map(config.modulos.map((m) => [m.id, m])), [config.modulos]);
  const activo = (id: IdModulo) => activos.get(id);

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
  const ampliar = (id: IdDetalle) => () => setDetalle(id);
  // Familias: el tramo que comparan (el periodo o, con «Año»/«Todo», su último mes completo).
  const tramoFamilias = dec?.periodo.comparado ?? null;
  const docsFamilia = (f: { id: number | null; familia: string; importe: number }) =>
    f.id !== null &&
    docs(f.familia, "base", {
      agrupar: "familia",
      clave: String(f.id),
      cifra: f.importe,
      detalle: "Base sin IVA de sus líneas",
      ...(tramoFamilias?.modo === "ultimo_mes" ? { desde: tramoFamilias.desde, hasta: tramoFamilias.hasta } : {}),
    });

  // ─── Más cifras (las que elige «Personalizar»; salen en la vista «Gasto») ─

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
            avisos={[
              ...(i.albaranesSinFactura > 0
                ? [
                    `${plural(i.albaranesSinFactura, "albarán aún no está", "albaranes aún no están")} en una factura (${formatCurrency(i.albaranesSinFacturaImporte)} con IVA).`,
                  ]
                : []),
              // Las alertas que no son de precio ni de familia (proveedor nuevo, importe
              // inusual, duplicados…): aquí, con su texto corto.
              ...otrosAvisos
                .filter((o) => o.alerta.tipo !== "facturas_albaran_sin_factura")
                .map((o) => (
                  <span key={o.alerta.id} data-testid="aviso-por-revisar">
                    <strong className="font-medium">{tituloCortoAlerta(o.alerta)}</strong> · {resumenCortoAlerta(o.alerta)}
                  </span>
                )),
            ]}
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

  const comunesExtra = { periodo, local, onDocumentos, onIrA, pendiente };
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
            umbralPct={umbral}
            alertas={alertasPeriodo}
            acciones={siListo((s: Datos["subidas"]["productos"][number]) => [
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
        if (dec)
          return (
            <FamiliasFrenteMedia
              decision={dec}
              tamano={t}
              onAmpliar={ampliar("familias")}
              pendiente={pendiente}
              sinClasificar={datos.familias.sinClasificar}
              onClasificar={() => onIrA(ENLACE_PRODUCTOS_COMPRAS)}
              acciones={siListo((f: { id: number | null; familia: string; importe: number }) =>
                f.id === null
                  ? []
                  : [
                      verDocs(() => docsFamilia(f)),
                    ],
              )}
            />
          );
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
        return (
          <GastoPorMesModulo
            tamano={t}
            onAmpliar={ampliar("gasto_mes")}
            meses={datos.meses}
            periodo={periodo}
            local={local}
            onDocumentos={onDocumentos}
            onIrA={onIrA}
            pendiente={pendiente}
            alertas={alertas}
          />
        );
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

  /** Un módulo del configurador en su vista (si está activo), en una celda que llena su hueco. */
  const celda = (a: ModuloActivo): ReactNode => (
    <div key={a.id} className="h-full min-h-0 min-w-0" data-modulo={a.id}>
      {modulo(a)}
    </div>
  );
  const m = (id: IdModulo): ReactNode => {
    const a = activo(id);
    return a ? celda(a) : null;
  };

  // ─── Las cuatro cifras de arriba (navegación) ─────────────────────────────

  const nombreGasto = datos.meses.length === 1 ? `Gasto de ${etiquetaMes(datos.meses[0].mes).toLowerCase().replace(/\s\d{4}$/, "")}` : "Gasto del periodo";
  const pctNormal = rd?.variacionBasePct ?? null;
  const usaNormal = pctNormal !== null && dec?.periodo.comparado?.modo !== "ultimo_mes";
  const cifrasNav: { vista: IdVista; etiqueta: string; valor: string[]; detalle: ReactNode; aviso?: boolean; listo: boolean }[] = [
    {
      vista: "gasto",
      etiqueta: nombreGasto,
      valor: formasImporte(i.gasto),
      detalle: (
        <>
          con IVA
          {usaNormal ? (
            <span className={cn("font-medium", (pctNormal as number) > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
              {" "}· {textoPct(pctNormal as number)} que lo normal
            </span>
          ) : variacion ? (
            <span className={cn("font-medium", variacion.sube ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")} title={variacion.texto}>
              {" "}· {variacion.texto.split(" frente")[0]} que el anterior
            </span>
          ) : null}
        </>
      ),
      aviso: !!mesesIncompletos || !!i.variacionAviso,
      listo: true,
    },
    {
      vista: "precios",
      etiqueta: "Precios que han subido",
      valor: rd ? formasEntero(rd.subidas) : ["…"],
      detalle: rd ? (
        rd.subidas ? (
          <>
            te cuestan <b className="font-medium text-foreground tabular-nums">+{formatEntero(Math.round(rd.impactoMes))} €</b> al mes
          </>
        ) : (
          "ninguno por encima del umbral"
        )
      ) : (
        "Cargando…"
      ),
      listo: !!rd || !!(decisionQ.isError || (!decisionQ.isPending && !dec)),
    },
    {
      vista: "ahorro",
      etiqueta: "Puedes ahorrar",
      valor: rd ? formasImporte(Math.round(rd.ahorro90)) : ["…"],
      detalle: rd ? `cada 90 días · ${plural(rd.masBarato, "producto", "productos")}` : "Cargando…",
      listo: !!rd || !!(decisionQ.isError || (!decisionQ.isPending && !dec)),
    },
    {
      vista: "revisar",
      etiqueta: "Por revisar",
      valor: formasEntero(i.albaranesSinFactura),
      detalle: `${i.albaranesSinFactura === 1 ? "albarán sin factura" : "albaranes sin factura"}${otrosAvisos.length ? ` · ${plural(otrosAvisos.length, "con aviso", "con avisos")}` : ""}`,
      aviso: otrosAvisos.length > 0,
      listo: true,
    },
  ];

  // ─── Las vistas ───────────────────────────────────────────────────────────

  const extras = config.cifras.filter((c) => !CIFRAS_NAVEGACION.has(c));
  let contenido: ReactNode;
  switch (vista) {
    case "decidir": {
      const decidir = (
        <div className={cn(DOS, activo("gasto_mes") && "@[48rem]/tablero:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]")}>
          {dec ? (
            <QueDecidirHoy
              decision={dec}
              pendiente={pendiente}
              onIrA={onIrA}
              onVerFamilia={(f) => docsFamilia(f)}
              onVerPrecio={(id) => {
                setPrecioElegido(`a:${id}`);
                irAVista("precios");
              }}
            />
          ) : (
            <Caja titulo="Qué decidir hoy" testId="caja-decidir">
              <SinDatos>{decisionQ.isPending ? "Calculando…" : "Las decisiones necesitan la migración «facturas_decision». Mientras, mira «Precios» y «Gasto»."}</SinDatos>
            </Caja>
          )}
          {m("gasto_mes")}
        </div>
      );
      const hayFijadas = fijadasExplorador.length > 0 || fijadasIa.length > 0;
      contenido = hayFijadas ? (
        <div className="h-full min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1" data-testid="vista-decidir-scroll">
          <div className="h-full min-h-[22rem]">{decidir}</div>
          <section aria-labelledby="titulo-fijadas" className="space-y-2">
            <h3 id="titulo-fijadas" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <Pin className="h-3.5 w-3.5" aria-hidden /> Tus gráficas fijadas
            </h3>
            <FijadasDelTablero
              periodo={periodo}
              local={local}
              explorador={fijadasExplorador}
              onQuitarExplorador={onQuitarFijadaExplorador}
              ia={fijadasIa}
              onQuitarIa={onQuitarFijadaIa}
            />
          </section>
        </div>
      ) : (
        decidir
      );
      break;
    }
    case "precios":
      contenido = dec ? (
        <div className={cn(DOS, "@[48rem]/tablero:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
          <PreciosMaestroDetalle
            decision={dec}
            periodo={periodo}
            local={local}
            pendiente={pendiente}
            conTop={!!activo("precios_top")}
            elegida={precioElegido}
            onElegida={setPrecioElegido}
            onIrA={onIrA}
            onVerDocumentosTop={(p) =>
              docs(p.producto, "base", {
                filtros: { productos: [p.linea ?? p.producto], ...(p.proveedorId !== null ? { proveedores: [p.proveedorId] } : {}) },
                desde: dec.topDesde,
                hasta: dec.periodo.hasta || periodo.hasta,
                detalle: "Base sin IVA de sus líneas",
              })
            }
          />
        </div>
      ) : (
        celda({ id: "subidas", tamano: "l" })
      );
      break;
    case "ahorro":
      contenido = dec ? (
        <div className="h-full min-h-0">
          <AhorroExplicado decision={dec} pendiente={pendiente} onIrA={onIrA} />
        </div>
      ) : (
        <Caja titulo="¿Dónde puedo ahorrar?">
          <SinDatos>{decisionQ.isPending ? "Calculando…" : "Necesita la migración «facturas_decision»."}</SinDatos>
        </Caja>
      );
      break;
    case "gasto": {
      const derecha = (["fijos", "abonos", "productos", "precio_producto"] as IdModulo[]).filter((id) => activo(id));
      contenido = (
        <div className="flex flex-col gap-3 @[48rem]/tablero:h-full">
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground" data-testid="franja-gasto">
            <button
              type="button"
              disabled={pendiente}
              onClick={() => docs("Gasto con IVA", "gasto", { cifra: i.gasto })}
              className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium text-foreground hover:border-primary/50 disabled:opacity-50 pointer-coarse:min-h-11", FOCO)}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden /> Ver los documentos del gasto
            </button>
            <span>{textoRangoMeses(datos.meses)}</span>
            {variacion && <span title={i.variacionAviso ?? undefined}>{variacion.texto}{i.variacionAviso ? " (no fiable)" : ""}</span>}
            {notaRetencion && <span data-testid="nota-retencion-irpf">{notaRetencion}</span>}
            {mesesIncompletos && <span className="text-amber-800 dark:text-amber-300" data-testid="nota-meses-incompletos">{mesesIncompletos}</span>}
          </div>
          {extras.length > 0 && (
            <ul className={cn("grid shrink-0 grid-cols-2 gap-2 @[48rem]/tablero:grid-cols-4", atenuar)} aria-label="Más cifras del periodo">
              {extras.map(cifra)}
            </ul>
          )}
          <div className={cn(DOS, "min-h-0 flex-1", derecha.length > 0 && "@[48rem]/tablero:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]")}>
            {celda({ id: "familias", tamano: "l" })}
            {derecha.length > 0 && <div className={COLUMNA}>{derecha.map((id) => m(id))}</div>}
          </div>
        </div>
      );
      break;
    }
    case "proveedores": {
      // Maestro-detalle (09/11/2026): la lista con comparación y la ficha del elegido;
      // «Casa Tomás y Touza» va en la franja de arriba y «Regalado por proveedor», bajo la ficha.
      const regalado = activo("regalado");
      contenido = (
        <VistaProveedores
          datos={datos}
          periodo={periodo}
          local={local}
          decision={dec}
          pendiente={pendiente}
          conLocales={!!activo("locales")}
          extra={regalado ? celda(regalado) : undefined}
          onVerDocumentos={(f, tramo) =>
            f.id !== null &&
            docs(nombreCorto(f.nombre), "gasto", {
              agrupar: "proveedor",
              clave: String(f.id),
              cifra: f.estado === "dejado" ? f.anterior : f.gasto,
              desde: tramo.desde,
              hasta: tramo.hasta,
            })
          }
          onVerLocal={(l, gasto) => docs(l === "touza" ? "Touza" : "Casa Tomás", "gasto", { agrupar: "local", clave: l, cifra: gasto, sinLocal: true })}
          onAbrirEnCompras={(id) => onIrA(enlaceProveedorCompras(id))}
          onVerPrecio={(id) => {
            setPrecioElegido(`a:${id}`);
            irAVista("precios");
          }}
          onIrAVista={irAVista}
          onAmpliar={ampliar("proveedores")}
        />
      );
      break;
    }
    case "revisar":
      contenido = (
        <div className={cn(DOS, dec && "@[48rem]/tablero:grid-cols-2")}>
          {celda(activo("por_revisar") ?? { id: "por_revisar", tamano: "l" })}
          {dec && <AvisosPorRevisar decision={dec} pendiente={pendiente} />}
        </div>
      );
      break;
  }

  return (
    <div className="@container/tablero flex h-full min-h-0 flex-col gap-2.5">
      {/* 1 · Cifras que también son navegación */}
      <ul className={cn("grid shrink-0 grid-cols-2 gap-2 @[48rem]/tablero:grid-cols-4 @[48rem]/tablero:gap-2.5", atenuar)} aria-label="Indicadores del periodo" aria-busy={pendiente || undefined} data-tour="facturas-analisis-indicadores">
        {cifrasNav.map((c) => (
          <li key={c.vista} className="@container min-w-0">
            <button
              type="button"
              aria-pressed={vista === c.vista}
              disabled={pendiente || !c.listo}
              onClick={() => irAVista(c.vista)}
              data-testid={`cifra-${c.vista}`}
              className={cn(
                "relative grid h-full w-full min-w-0 content-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
                "border-transparent bg-muted/50 hover:border-border/70 hover:bg-muted disabled:cursor-default disabled:hover:bg-muted/50",
                "aria-pressed:border-foreground/70 aria-pressed:bg-card",
                FOCO,
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium leading-snug text-muted-foreground">
                <span className="truncate">{c.etiqueta}</span>
                {c.aviso && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="con avisos" />}
              </span>
              <Cifra formas={c.valor} className="text-[clamp(1.0625rem,0.55rem+4.5cqi,1.375rem)] font-semibold leading-tight tabular-nums tracking-tight text-foreground" />
              <span className="line-clamp-1 text-xs leading-snug text-muted-foreground">{c.detalle}</span>
            </button>
          </li>
        ))}
      </ul>

      {/* 2 · Una vista a la vez */}
      <div role="group" aria-label="Vista del análisis" className="flex min-w-0 shrink-0 gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="pastillas-vistas">
        {VISTAS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={vista === v.id}
            onClick={() => irAVista(v.id)}
            className={cn(
              "min-h-9 shrink-0 whitespace-nowrap rounded-full border border-transparent px-3 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11",
              "aria-pressed:border-border aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground",
              FOCO,
            )}
          >
            {v.etiqueta}
          </button>
        ))}
      </div>

      {/* 3 · La vista: reparte el alto que queda (en estrecho, una columna con scroll dentro) */}
      <div
        className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain @[48rem]/tablero:overflow-hidden", atenuar)}
        role="region"
        aria-label={`Vista: ${VISTAS.find((v) => v.id === vista)?.etiqueta ?? ""}`}
        aria-busy={pendiente || undefined}
        data-vista={vista}
        data-testid="vista-analisis"
      >
        <TarjetaLlena.Provider value>{contenido}</TarjetaLlena.Provider>
      </div>
      <DetalleModulo
        modulo={detalle}
        producto={config.modulos.find((x) => x.id === "precio_producto")?.producto ?? null}
        onCerrar={() => setDetalle(null)}
        periodo={periodo}
        local={local}
        onDocumentos={onDocumentos}
        onIrA={onIrA}
      />
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

