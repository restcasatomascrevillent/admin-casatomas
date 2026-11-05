import { useLayoutEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, EyeOff, FileText, Receipt, SearchX } from "lucide-react";
import type { Factura } from "@/hooks/useFacturas";
import { Button } from "@/components/ui/button";
import { BotonOriginal } from "@/components/facturas/shared/BotonOriginal";
import { urlSegura } from "@/lib/url-segura";
import { formatDateCorta, formatImporte, plural } from "@/components/facturas/shared/formatters";
import { esAlbaranSinFactura } from "@/lib/facturas/compras";
import type { ResolverProveedor } from "@/lib/facturas/proveedores";
import { esAbono, localDe } from "@/lib/facturas/resumenCompras";
import {
  agruparDocumentos,
  claveEstadoMes,
  guardarPlegado,
  leerPlegado,
  MESES_ABIERTOS_BUSCANDO,
  mesAbierto,
  type EstadoPlegado,
  type GrupoMes,
} from "@/lib/facturas/agrupacionDocumentos";
import { CABECERA_COLUMNAS, EstadoVacio, FOCO, FONDO_CABECERA, Hueso, Marca, filaEstado } from "./estilo";

const SIN_ESTADO: EstadoPlegado = {};

/** Alto de reserva de un mes fuera de pantalla (`content-visibility: auto`): cabecera 49 px, documento 53 (dos líneas) o 45 (una, ≥1024 px). */
function altoEstimadoMes(mes: GrupoMes, abierto: boolean): number {
  return abierto ? 49 + mes.documentos.length * 53 : 49;
}

/**
 * Compras › Documentos (rediseño del 05/11/2026): lista a TODO EL ANCHO,
 * agrupada por MES (el actual primero). La cabecera del mes se queda fija al
 * desplazar la lista y enseña cuántos documentos hay, cuánto suman con IVA
 * (facturas + albaranes sin factura; un albarán ya facturado sale tachado con
 * «Incluido en F-xxx» y no suma) y lo que restan los abonos.
 *
 * Cada fila: fecha · proveedor · nº de documento · marcas (Albarán / Abono,
 * Touza, avisos, sin revisar, sin factura: todas a la vista, sin tooltip) ·
 * importe. Desde 1024 px en columnas; por debajo (tablet en vertical) en dos
 * líneas: proveedor e importe arriba, fecha · número · marcas debajo.
 *
 * Plegado: mes actual y anterior desplegados, el resto plegados (o el único
 * mes, si solo hay uno); lo que el usuario pliega o despliega se recuerda
 * (localStorage). Con texto buscado se abren solo los 3 meses más recientes
 * con resultados y arriba sale «Abrir todos» / «Plegar todos». Con
 * `recordar={false}` (despliegue de un proveedor) se abren los 3 meses más
 * recientes y no se guarda nada. Cada mes lleva `content-visibility: auto`.
 */
export function ListaDocumentos({
  documentos,
  facturas,
  resolver,
  avisosPorId,
  seleccionadoId,
  cargando,
  hayFiltros,
  busqueda = "",
  onAbrir,
  hoy,
  conProveedor = true,
  recordar = true,
  cabecerasFijas = true,
  mesPedido = null,
  etiqueta = "Documentos",
  onQuitarFiltros,
}: {
  /** Los documentos ya filtrados (buscador, chip, local y periodo). */
  documentos: Factura[];
  /** Todas las facturas (sin filtrar): para decir «Incluido en F-xxx» aunque esa factura no salga en la lista. */
  facturas: Factura[];
  resolver: ResolverProveedor;
  avisosPorId: Map<number, unknown[]>;
  /** El último documento abierto (se marca con `aria-current`). */
  seleccionadoId: number | null;
  cargando: boolean;
  hayFiltros: boolean;
  /** Texto buscado (vacío si no hay búsqueda): decide qué meses salen abiertos. */
  busqueda?: string;
  onAbrir: (id: number) => void;
  /** Para pruebas y capturas: el «hoy» que decide qué meses salen desplegados. */
  hoy?: Date;
  /** Columna de proveedor (no hace falta dentro del despliegue de un proveedor). */
  conProveedor?: boolean;
  /** Recordar el plegado en localStorage (lista principal) o no (despliegue de un proveedor). */
  recordar?: boolean;
  /** Cabeceras de mes fijas al desplazar (solo en la lista principal). */
  cabecerasFijas?: boolean;
  /** Abre ese mes (al tocar una barra del resumen); cada `n` nuevo vuelve a aplicarlo. */
  mesPedido?: { mes: string; n: number } | null;
  etiqueta?: string;
  /** «Quitar filtros» en la lista vacía (solo en la lista principal). */
  onQuitarFiltros?: () => void;
}) {
  const [ahora] = useState(() => hoy ?? new Date());
  const [plegado, setPlegado] = useState<EstadoPlegado>(() => (recordar ? leerPlegado() : {}));
  // Meses abiertos o plegados a mano durante UNA búsqueda: al cambiar el texto se olvida.
  const [plegadoBusqueda, setPlegadoBusqueda] = useState<{ texto: string; estado: EstadoPlegado }>({ texto: "", estado: SIN_ESTADO });
  const grupos = useMemo(() => agruparDocumentos(documentos), [documentos]);
  const facturaPorId = useMemo(() => new Map(facturas.map((f) => [f.id, f])), [facturas]);
  const posicionMes = useMemo(() => new Map(grupos.map((g, i) => [g.clave, i])), [grupos]);

  const buscando = busqueda.trim() !== "";
  const porPosicion = buscando || !recordar;
  const estadoMeses = buscando ? (plegadoBusqueda.texto === busqueda ? plegadoBusqueda.estado : SIN_ESTADO) : plegado;
  const abiertoMes = (mes: string) =>
    mesAbierto(mes, estadoMeses, ahora, porPosicion ? (posicionMes.get(mes) ?? 0) : null, grupos.length);

  const cambiarMeses = (cambios: EstadoPlegado) => {
    if (buscando) {
      setPlegadoBusqueda((e) => ({ texto: busqueda, estado: { ...(e.texto === busqueda ? e.estado : SIN_ESTADO), ...cambios } }));
      return;
    }
    setPlegado((e) => {
      const siguiente = { ...e, ...cambios };
      if (recordar) guardarPlegado(siguiente);
      return siguiente;
    });
  };

  const algunMesPlegado = porPosicion && grupos.some((g) => !abiertoMes(g.clave));
  const verBotonTodos = porPosicion && (algunMesPlegado || grupos.length > MESES_ABIERTOS_BUSCANDO);
  const todosLosMeses = (abierto: boolean) => cambiarMeses(Object.fromEntries(grupos.map((g) => [claveEstadoMes(g.clave), abierto])));

  // Al tocar un mes en la gráfica del resumen: ese mes, desplegado.
  useLayoutEffect(() => {
    if (mesPedido && !abiertoMes(mesPedido.mes)) cambiarMeses({ [claveEstadoMes(mesPedido.mes)]: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesPedido?.n]);

  if (cargando) return <EsqueletoDocumentos conProveedor={conProveedor} />;
  if (documentos.length === 0) {
    return hayFiltros ? (
      <EstadoVacio
        icono={<SearchX />}
        titulo="Ningún documento coincide"
        texto="Prueba con otra palabra o quita los filtros de tipo, local o periodo."
        accion={onQuitarFiltros ? { etiqueta: "Quitar filtros", onClick: onQuitarFiltros } : undefined}
      />
    ) : (
      <EstadoVacio
        icono={<FileText />}
        titulo="No hay documentos registrados"
        texto="Las facturas y albaranes que subas desde «Cargar» aparecerán aquí, ordenados por mes."
      />
    );
  }

  const Titulo = cabecerasFijas ? "h3" : "h4";
  const columnas = conProveedor ? COLUMNAS_CON_PROVEEDOR : COLUMNAS_SIN_PROVEEDOR;

  return (
    <div aria-label={etiqueta} data-testid={recordar ? "documentos-agrupados" : undefined}>
      {verBotonTodos && (
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pl-3 text-xs text-muted-foreground" data-testid="barra-meses">
          <span className="min-w-0 truncate">{plural(grupos.length, "mes", "meses")}{buscando ? " con resultados" : ""}</span>
          <Button variant="ghost" className="h-11 shrink-0 px-3 text-sm" onClick={() => todosLosMeses(algunMesPlegado)}>
            {algunMesPlegado ? "Abrir todos" : "Plegar todos"}
          </Button>
        </div>
      )}
      {/* Cabecera de columnas (solo en la lista principal y desde 1024 px, donde la fila va en columnas). */}
      {cabecerasFijas && (
        <div className={`sticky top-0 z-20 hidden h-9 items-center border-b border-border/70 bg-card lg:flex ${CABECERA_COLUMNAS}`} aria-hidden="true" data-testid="cabecera-columnas">
          <div className={`grid min-w-0 flex-1 items-center gap-x-3 pl-3 pr-1 ${columnas}`}>
            <span>Fecha</span>
            {conProveedor && <span>Proveedor</span>}
            <span>Nº de documento</span>
            <span>Tipo y avisos</span>
            <span className="text-right">Importe</span>
          </div>
          <span className="w-11 shrink-0 text-center">Doc.</span>
        </div>
      )}
      {grupos.map((mes) => {
        const abierto = abiertoMes(mes.clave);
        return (
          <section
            key={mes.clave}
            aria-label={mes.etiqueta}
            data-mes={mes.clave}
            // Lo que queda fuera de pantalla no se maqueta ni se pinta (años de histórico en tablet).
            className="[content-visibility:auto]"
            style={{ containIntrinsicSize: `auto ${altoEstimadoMes(mes, abierto)}px` }}
          >
            <Titulo className={`m-0 border-b border-border/60 text-sm ${FONDO_CABECERA} ${cabecerasFijas ? "sticky top-0 z-10 lg:top-9" : ""}`}>
              <button
                type="button"
                aria-expanded={abierto}
                onClick={() => cambiarMeses({ [claveEstadoMes(mes.clave)]: !abierto })}
                className={`flex min-h-12 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60 motion-reduce:transition-none ${FOCO}`}
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${abierto ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className="truncate font-semibold text-foreground">{mes.etiqueta}</span>
                  <span className="sr-only"> · </span>
                  <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">
                    {plural(mes.documentos.length, "documento", "documentos")}
                  </span>
                  <span className="sr-only"> · </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-baseline justify-end gap-x-1 text-right">
                  <span className="text-[13px] font-semibold tabular-nums text-foreground/80">{formatImporte(mes.total)}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    <span className="sr-only"> </span>con IVA
                    {mes.abonos < 0 && (
                      <span className="text-emerald-700 dark:text-emerald-400" data-abonos-mes>
                        {" "}· incl. abonos {formatImporte(mes.abonos)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </Titulo>
            {abierto && (
              <ul className="divide-y divide-border/50" aria-label={`Documentos de ${mes.etiqueta}`}>
                {mes.documentos.map((d) => (
                  <FilaDocumento
                    key={d.id}
                    d={d}
                    proveedor={conProveedor ? (d.proveedor && d.proveedor.trim() ? resolver(d.proveedor).nombre : "Sin proveedor") : null}
                    avisos={(avisosPorId.get(d.id) ?? []).length}
                    abierto={seleccionadoId === d.id}
                    factura={d.facturado_en_id != null ? (facturaPorId.get(d.facturado_en_id) ?? null) : null}
                    columnas={columnas}
                    onAbrir={onAbrir}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Columnas desde 1024 px (la cabecera y las filas usan las mismas). */
const COLUMNAS_CON_PROVEEDOR = "lg:grid-cols-[5.25rem_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.5fr)_7.5rem]";
const COLUMNAS_SIN_PROVEEDOR = "lg:grid-cols-[5.25rem_minmax(0,1fr)_minmax(0,2fr)_7.5rem]";

/** Esqueleto con la forma de la lista: una cabecera de mes y filas con sus columnas. */
function EsqueletoDocumentos({ conProveedor }: { conProveedor: boolean }) {
  return (
    <div role="status" aria-busy="true" data-testid="esqueleto-documentos">
      <span className="sr-only">Cargando documentos…</span>
      <div className={`flex h-12 items-center gap-3 border-b border-border/60 px-3 ${FONDO_CABECERA}`}>
        <Hueso className="h-3.5 w-28" />
        <Hueso className="ml-auto h-3.5 w-20" />
      </div>
      <ul className="divide-y divide-border/50" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <li key={i} className="flex min-h-12 items-center gap-3 py-2 pl-3 pr-1">
            <div className="min-w-0 flex-1 space-y-1.5 lg:hidden">
              <Hueso className={`h-3.5 ${i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-2/5" : "w-1/2"}`} />
              <Hueso className="h-3 w-1/3" />
            </div>
            <div className={`hidden min-w-0 flex-1 items-center gap-x-3 lg:grid ${conProveedor ? COLUMNAS_CON_PROVEEDOR : COLUMNAS_SIN_PROVEEDOR}`}>
              <Hueso className="h-3.5 w-16" />
              {conProveedor && <Hueso className={`h-3.5 ${i % 2 ? "w-2/3" : "w-1/2"}`} />}
              <Hueso className="h-3.5 w-24" />
              <Hueso className={`h-4 ${i % 3 ? "w-14" : "w-24"}`} />
              <Hueso className="ml-auto h-3.5 w-16" />
            </div>
            <Hueso className="h-3.5 w-16 lg:hidden" />
            <span className="w-11 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilaDocumento({
  d,
  proveedor,
  avisos,
  abierto,
  factura,
  columnas,
  onAbrir,
}: {
  d: Factura;
  /** Nombre canónico del proveedor; null = sin columna de proveedor. */
  proveedor: string | null;
  avisos: number;
  abierto: boolean;
  /** La factura que recoge este albarán, si consta. */
  factura: Factura | null;
  /** Plantilla de columnas desde 1024 px (la misma que la cabecera). */
  columnas: string;
  onAbrir: (id: number) => void;
}) {
  // Albarán ya recogido en una factura: se enseña atenuado y tachado, y no suma en los totales.
  const facturado = d.tipo === "albaran" && d.facturado_en_id != null;
  const abono = esAbono(d);
  const touza = localDe(d) === "touza";
  const conProveedor = proveedor !== null;
  const tieneOriginal = Boolean(d.archivo_path || urlSegura(d.drive_url));
  const tipo = abono ? "abono" : d.tipo === "albaran" ? "albarán" : "factura";
  return (
    <li className={`flex items-center ${filaEstado(abierto)}`}>
      <button
        type="button"
        onClick={() => onAbrir(d.id)}
        aria-current={abierto ? "true" : undefined}
        data-doc-id={d.id}
        data-facturado={facturado ? "true" : undefined}
        className={`grid min-h-12 min-w-0 flex-1 scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-1.5 pl-3 pr-1 text-left active:bg-muted/50 lg:gap-y-0 ${columnas} ${FOCO}`}
      >
        {/* Línea 1 (estrecho): proveedor —o el número, si no hay columna de proveedor—. */}
        <span className={`col-start-1 row-start-1 min-w-0 truncate text-sm font-medium lg:col-start-2 ${facturado ? "text-muted-foreground" : "text-foreground"}`}>
          {conProveedor ? proveedor : <span data-numero className="tabular-nums">{d.numero_documento}</span>}
        </span>

        {/* Línea 2 (estrecho): fecha · número · marcas. Desde 1024 px, cada cosa en su columna (`lg:contents`). */}
        <span className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground lg:contents">
          <span className="whitespace-nowrap tabular-nums lg:col-start-1 lg:row-start-1 lg:text-[13px]">{formatDateCorta(d.fecha)}</span>
          {conProveedor && (
            <>
              <span aria-hidden="true" className="lg:hidden">·</span>
              <span className="min-w-0 truncate tabular-nums text-foreground/80 lg:col-start-3 lg:row-start-1 lg:text-[13px]" data-numero>
                {d.numero_documento}
              </span>
            </>
          )}
          <span className={`flex min-w-0 flex-wrap items-center gap-1 lg:row-start-1 ${conProveedor ? "lg:col-start-4" : "lg:col-start-3"}`}>
            {d.tipo === "albaran" && <Marca tono="neutro">Albarán</Marca>}
            {abono && <Marca tono="abono">Abono</Marca>}
            {touza && <Marca tono="touza">Touza</Marca>}
            {avisos > 0 && (
              <Marca tono="aviso" icono={<AlertTriangle aria-hidden="true" />}>
                {plural(avisos, "aviso", "avisos")}
              </Marca>
            )}
            {!d.verificada && (
              <Marca tono="pendiente" icono={<EyeOff aria-hidden="true" />}>
                Sin revisar
              </Marca>
            )}
            {esAlbaranSinFactura(d) && (
              <Marca tono="sinFactura" icono={<Receipt aria-hidden="true" />}>
                Sin factura
              </Marca>
            )}
            {facturado && (
              <span className="whitespace-nowrap text-xs text-muted-foreground" data-en-factura>
                Incluido en {factura?.numero_documento ?? "una factura"} · no suma
              </span>
            )}
          </span>
        </span>

        <span
          className={`col-start-2 row-span-2 row-start-1 self-center whitespace-nowrap text-right text-sm font-semibold tabular-nums lg:row-span-1 ${
            conProveedor ? "lg:col-start-5" : "lg:col-start-4"
          } ${facturado ? "font-normal text-muted-foreground line-through decoration-muted-foreground/60" : ""} ${abono ? "text-emerald-700 dark:text-emerald-400" : ""}`}
        >
          {d.total != null ? formatImporte(d.total) : "—"}
        </span>
      </button>
      {/* El original, a un toque desde la fila (PDF, foto o Drive). Sin original, el hueco se mantiene para no descuadrar. */}
      <span className="flex w-11 shrink-0 items-center justify-center">
        {tieneOriginal && (
          <BotonOriginal driveUrl={d.drive_url} archivoPath={d.archivo_path} variant="fila" label={`Abrir el original de ${tipo} ${d.numero_documento}`} />
        )}
      </span>
    </li>
  );
}
