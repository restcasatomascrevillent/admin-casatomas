import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, EyeOff, FileText, Receipt } from "lucide-react";
import type { Factura } from "@/hooks/useFacturas";
import { Button } from "@/components/ui/button";
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

const SIN_ESTADO: EstadoPlegado = {};

/** Alto de reserva de un mes fuera de pantalla (`content-visibility: auto`): cabecera 49 px, documento 53 (dos líneas) o 45 (una, ≥1024 px). */
function altoEstimadoMes(mes: GrupoMes, abierto: boolean): number {
  return abierto ? 49 + mes.documentos.length * 53 : 49;
}

/** Insignia de texto (12 px, sin depender del color: siempre lleva palabra). */
export const Insignia = ({ children, clase }: { children: ReactNode; clase: string }) => (
  <span className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-xs font-medium ${clase}`}>{children}</span>
);

export const CLASE_TOUZA = "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
export const CLASE_ABONO = "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
const CLASE_ALBARAN = "border-border bg-muted/50 text-foreground";

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

  if (cargando) return <p className="p-4 text-sm text-muted-foreground">Cargando documentos…</p>;
  if (documentos.length === 0) {
    return (
      <div className="p-6 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">
          {hayFiltros ? "Ningún documento coincide" : "No hay documentos registrados"}
        </p>
      </div>
    );
  }

  const Titulo = cabecerasFijas ? "h3" : "h4";

  return (
    <div aria-label={etiqueta} data-testid={recordar ? "documentos-agrupados" : undefined}>
      {verBotonTodos && (
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pl-2 text-xs text-muted-foreground" data-testid="barra-meses">
          <span className="min-w-0 truncate">{plural(grupos.length, "mes", "meses")}{buscando ? " con resultados" : ""}</span>
          <Button variant="ghost" className="h-11 shrink-0 px-3 text-sm" onClick={() => todosLosMeses(algunMesPlegado)}>
            {algunMesPlegado ? "Abrir todos" : "Plegar todos"}
          </Button>
        </div>
      )}
      {grupos.map((mes) => {
        const abierto = abiertoMes(mes.clave);
        const Chevron = abierto ? ChevronDown : ChevronRight;
        return (
          <section
            key={mes.clave}
            aria-label={mes.etiqueta}
            data-mes={mes.clave}
            // Lo que queda fuera de pantalla no se maqueta ni se pinta (años de histórico en tablet).
            className="[content-visibility:auto]"
            style={{ containIntrinsicSize: `auto ${altoEstimadoMes(mes, abierto)}px` }}
          >
            <Titulo className={`m-0 border-b border-border/60 bg-card text-[15px] ${cabecerasFijas ? "sticky top-0 z-10" : ""}`}>
              <button
                type="button"
                aria-expanded={abierto}
                onClick={() => cambiarMeses({ [claveEstadoMes(mes.clave)]: !abierto })}
                className="flex min-h-12 w-full items-center gap-2 px-2 py-1 text-left font-semibold transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate">{mes.etiqueta}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    <span className="sr-only"> · </span>
                    {plural(mes.documentos.length, "documento", "documentos")}
                    <span className="sr-only"> · </span>
                  </span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <span className="tabular-nums">{formatImporte(mes.total)}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
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

function FilaDocumento({
  d,
  proveedor,
  avisos,
  abierto,
  factura,
  onAbrir,
}: {
  d: Factura;
  /** Nombre canónico del proveedor; null = sin columna de proveedor. */
  proveedor: string | null;
  avisos: number;
  abierto: boolean;
  /** La factura que recoge este albarán, si consta. */
  factura: Factura | null;
  onAbrir: (id: number) => void;
}) {
  // Albarán ya recogido en una factura: se enseña atenuado y tachado, y no suma en los totales.
  const facturado = d.tipo === "albaran" && d.facturado_en_id != null;
  const abono = esAbono(d);
  const touza = localDe(d) === "touza";
  const conProveedor = proveedor !== null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(d.id)}
        aria-current={abierto ? "true" : undefined}
        data-doc-id={d.id}
        data-facturado={facturado ? "true" : undefined}
        className={`grid min-h-12 w-full scroll-mt-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-2 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary lg:gap-y-0 ${
          conProveedor
            ? "lg:grid-cols-[5.5rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.5fr)_8rem]"
            : "lg:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,2fr)_8rem]"
        } ${abierto ? "bg-muted/70" : ""}`}
      >
        {/* Línea 1 (estrecho): proveedor —o el número, si no hay columna de proveedor—. */}
        <span className="col-start-1 row-start-1 min-w-0 truncate text-sm font-semibold lg:col-start-2">
          {conProveedor ? proveedor : <span data-numero>{d.numero_documento}</span>}
        </span>

        {/* Línea 2 (estrecho): fecha · número · marcas. Desde 1024 px, cada cosa en su columna (`lg:contents`). */}
        <span className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground lg:contents">
          <span className="whitespace-nowrap tabular-nums lg:col-start-1 lg:row-start-1 lg:text-sm">{formatDateCorta(d.fecha)}</span>
          {conProveedor && (
            <>
              <span aria-hidden="true" className="lg:hidden">·</span>
              <span className="min-w-0 truncate font-medium text-foreground lg:col-start-3 lg:row-start-1 lg:text-sm lg:font-normal" data-numero>
                {d.numero_documento}
              </span>
            </>
          )}
          <span className={`flex min-w-0 flex-wrap items-center gap-1 lg:row-start-1 ${conProveedor ? "lg:col-start-4" : "lg:col-start-3"}`}>
            {d.tipo === "albaran" && <Insignia clase={CLASE_ALBARAN}>Albarán</Insignia>}
            {abono && <Insignia clase={CLASE_ABONO}>Abono</Insignia>}
            {touza && <Insignia clase={CLASE_TOUZA}>Touza</Insignia>}
            {avisos > 0 && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-red-700 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {plural(avisos, "aviso", "avisos")}
              </span>
            )}
            {!d.verificada && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-muted-foreground">
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Sin revisar
              </span>
            )}
            {esAlbaranSinFactura(d) && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-amber-700 dark:text-amber-400">
                <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> Sin factura
              </span>
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
    </li>
  );
}
