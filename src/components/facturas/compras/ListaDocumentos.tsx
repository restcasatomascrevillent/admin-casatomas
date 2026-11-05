import { useLayoutEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, EyeOff, FileText, Receipt } from "lucide-react";
import type { Factura } from "@/hooks/useFacturas";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateCorta, plural } from "@/components/facturas/shared/formatters";
import { esAlbaranSinFactura } from "@/lib/facturas/compras";
import type { ResolverProveedor } from "@/lib/facturas/proveedores";
import {
  agruparDocumentos,
  claveEstadoMes,
  claveEstadoProveedor,
  guardarPlegado,
  leerPlegado,
  MESES_ABIERTOS_BUSCANDO,
  mesAbierto,
  proveedorAbierto,
  ubicacionDocumento,
  type EstadoPlegado,
  type GrupoMes,
} from "@/lib/facturas/agrupacionDocumentos";

const ETIQUETA_TIPO: Record<string, string> = { factura: "Factura", albaran: "Albarán" };

const SIN_ESTADO: EstadoPlegado = {};

/** Altura de reserva de un mes fuera de pantalla (`content-visibility: auto`): cabecera 45 px, proveedor 44, documento 49. */
function altoEstimadoMes(mes: GrupoMes, abierto: boolean, provAbierto: (prov: string) => boolean): number {
  if (!abierto) return 45;
  return mes.proveedores.reduce((alto, p) => alto + 44 + (provAbierto(p.clave) ? p.documentos.length * 49 : 0), 45);
}

/** «con IVA» / «sin IVA» bajo un importe, discreto. */
const RotuloIva = ({ texto }: { texto: string }) => (
  <span className="block text-[11px] font-normal pointer-coarse:text-xs text-muted-foreground">
    <span className="sr-only"> </span>
    {texto}
  </span>
);

/**
 * Compras › Documentos: lista agrupada por MES (el actual primero) y, dentro,
 * por PROVEEDOR. La cabecera del mes se queda fija al desplazar la lista y
 * enseña cuántos documentos hay y cuánto suman (facturas + albaranes sin
 * factura: un albarán ya facturado sale atenuado con «en F-xxx» y no suma).
 * Mes actual y anterior desplegados, el resto plegados; lo que el usuario
 * pliega o despliega se recuerda (localStorage). Los chips no despliegan nada.
 * Con texto buscado se abren solo los 3 meses más recientes con resultados (lo
 * que se pliegue o despliegue mientras dura esa búsqueda no se recuerda) y
 * arriba sale «Abrir todos» / «Plegar todos». Cada mes lleva
 * `content-visibility: auto`: lo que queda fuera de pantalla no se pinta.
 * Los totales llevan IVA (rótulo «con IVA»). Cada fila: número · tipo y
 * total en la primera línea, fecha · líneas en la segunda, y una sola insignia.
 * Cada nivel se tabula: mes a ras, proveedor con sangría de 16 px y documentos de
 * 32 px con una guía vertical fina que los une a su proveedor (8/16 px en <640 px).
 * Los importes quedan alineados a la derecha en los tres niveles.
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
}: {
  /** Los documentos ya filtrados (buscador y chip). */
  documentos: Factura[];
  /** Todas las facturas (sin filtrar): para decir «en F-xxx» aunque esa factura no salga en la lista. */
  facturas: Factura[];
  resolver: ResolverProveedor;
  avisosPorId: Map<number, unknown[]>;
  seleccionadoId: number | null;
  cargando: boolean;
  hayFiltros: boolean;
  /** Texto buscado (vacío si no hay búsqueda): decide qué meses salen abiertos. */
  busqueda?: string;
  onAbrir: (id: number) => void;
  /** Para pruebas y capturas: el «hoy» que decide qué meses salen desplegados. */
  hoy?: Date;
}) {
  const [ahora] = useState(() => hoy ?? new Date());
  const [plegado, setPlegado] = useState<EstadoPlegado>(leerPlegado);
  // Meses abiertos o plegados a mano durante UNA búsqueda: al cambiar el texto se olvida.
  const [plegadoBusqueda, setPlegadoBusqueda] = useState<{ texto: string; estado: EstadoPlegado }>({ texto: "", estado: SIN_ESTADO });
  const grupos = useMemo(() => agruparDocumentos(documentos, resolver), [documentos, resolver]);
  const facturaPorId = useMemo(() => new Map(facturas.map((f) => [f.id, f])), [facturas]);
  const posicionMes = useMemo(() => new Map(grupos.map((g, i) => [g.clave, i])), [grupos]);

  const buscando = busqueda.trim() !== "";
  const estadoMeses = buscando ? (plegadoBusqueda.texto === busqueda ? plegadoBusqueda.estado : SIN_ESTADO) : plegado;
  const abiertoMes = (mes: string) => mesAbierto(mes, estadoMeses, ahora, buscando ? (posicionMes.get(mes) ?? 0) : null);

  /** Cambia el estado recordado (localStorage): proveedores siempre, meses sin búsqueda. */
  const recordar = (cambios: EstadoPlegado) =>
    setPlegado((e) => {
      const siguiente = { ...e, ...cambios };
      guardarPlegado(siguiente);
      return siguiente;
    });
  const cambiarMeses = (cambios: EstadoPlegado) => {
    if (!buscando) return recordar(cambios);
    setPlegadoBusqueda((e) => ({ texto: busqueda, estado: { ...(e.texto === busqueda ? e.estado : SIN_ESTADO), ...cambios } }));
  };

  const algunMesPlegado = buscando && grupos.some((g) => !abiertoMes(g.clave));
  const verBotonTodos = buscando && (algunMesPlegado || grupos.length > MESES_ABIERTOS_BUSCANDO);
  const todosLosMeses = (abierto: boolean) => cambiarMeses(Object.fromEntries(grupos.map((g) => [claveEstadoMes(g.clave), abierto])));

  // Enlace profundo o salto desde una ficha: si el documento abierto está en un
  // mes o proveedor plegado, se despliega (antes de pintar, para que la fila exista
  // cuando `TabCompras` la deje a la vista). Un clic en una fila ya visible no cambia nada.
  const doc = seleccionadoId === null ? undefined : documentos.find((d) => d.id === seleccionadoId);
  const hayDoc = doc !== undefined;
  useLayoutEffect(() => {
    if (!doc) return;
    const { mes, proveedor } = ubicacionDocumento(doc, resolver);
    if (!abiertoMes(mes)) cambiarMeses({ [claveEstadoMes(mes)]: true });
    if (!proveedorAbierto(mes, proveedor, plegado)) recordar({ [claveEstadoProveedor(mes, proveedor)]: true });
    // Solo cuando cambia el documento abierto (o aparece en la lista): si luego el usuario
    // pliega ese grupo, se respeta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionadoId, hayDoc]);

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

  return (
    <div aria-label="Documentos" data-testid="documentos-agrupados">
      {verBotonTodos && (
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pl-2 text-xs text-muted-foreground" data-testid="barra-meses">
          <span className="min-w-0 truncate">{plural(grupos.length, "mes", "meses")} con resultados</span>
          <Button variant="ghost" className="h-11 shrink-0 px-3 text-sm" onClick={() => todosLosMeses(algunMesPlegado)}>
            {algunMesPlegado ? "Abrir todos" : "Plegar todos"}
          </Button>
        </div>
      )}
      {grupos.map((mes) => {
        const abierto = abiertoMes(mes.clave);
        const Chevron = abierto ? ChevronDown : ChevronRight;
        const alto = altoEstimadoMes(mes, abierto, (p) => proveedorAbierto(mes.clave, p, plegado));
        return (
          <section
            key={mes.clave}
            aria-label={mes.etiqueta}
            data-mes={mes.clave}
            // Lo que queda fuera de pantalla no se maqueta ni se pinta (años de histórico en tablet).
            className="[content-visibility:auto]"
            style={{ containIntrinsicSize: `auto ${alto}px` }}
          >
            {/* Cabecera del mes: fija dentro del scroll de la lista. */}
            <h3 className="sticky top-0 z-10 m-0 border-b border-border/60 bg-card text-[15px]">
              <button
                type="button"
                aria-expanded={abierto}
                onClick={() => cambiarMeses({ [claveEstadoMes(mes.clave)]: !abierto })}
                className="flex min-h-11 w-full items-center gap-2 px-2 py-1 text-left font-semibold transition-colors hover:bg-muted/40"
              >
                <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {/* Mes arriba, nº de documentos debajo en pequeño; el total a la derecha, alineado. */}
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate">{mes.etiqueta}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    <span className="sr-only"> · </span>
                    {plural(mes.documentos, "documento", "documentos")}
                    <span className="sr-only"> · </span>
                  </span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <span className="tabular-nums">{formatCurrency(mes.total)}</span>
                  <RotuloIva texto="con IVA" />
                </span>
              </button>
            </h3>
            {abierto &&
              mes.proveedores.map((prov) => {
                const provAbierto = proveedorAbierto(mes.clave, prov.clave, plegado);
                const ChevronProv = provAbierto ? ChevronDown : ChevronRight;
                return (
                  <div key={prov.clave || "sin-proveedor"} data-proveedor={prov.clave}>
                    {/* Nivel 2: sangría 16 px (8 en estrecho); el chevron queda sobre la guía de los documentos. */}
                    <h4 className="m-0 ml-2 bg-muted/30 text-[13px] sm:ml-4" data-nivel="proveedor">
                      <button
                        type="button"
                        aria-expanded={provAbierto}
                        onClick={() => recordar({ [claveEstadoProveedor(mes.clave, prov.clave)]: !provAbierto })}
                        className="flex min-h-11 w-full items-center gap-2 px-2 py-1 text-left font-medium transition-colors hover:bg-muted/50"
                      >
                        <ChevronProv className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 flex-col leading-tight">
                          <span className="truncate">{prov.nombre}</span>
                          <span className="truncate text-[11px] font-normal text-muted-foreground">
                            <span className="sr-only"> · </span>
                            {plural(prov.documentos.length, "doc", "docs")}
                            <span className="sr-only"> · </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right leading-tight">
                          <span className="tabular-nums">{formatCurrency(prov.total)}</span>
                          <RotuloIva texto="con IVA" />
                        </span>
                      </button>
                    </h4>
                    {provAbierto && (
                      <ul
                        className="ml-4 divide-y divide-border/50 border-l border-border sm:ml-8"
                        data-nivel="documentos"
                        aria-label={`${prov.nombre}, ${mes.etiqueta}`}
                      >
                        {prov.documentos.map((d) => (
                          <FilaDocumento
                            key={d.id}
                            d={d}
                            avisos={(avisosPorId.get(d.id) ?? []).length}
                            abierto={seleccionadoId === d.id}
                            factura={d.facturado_en_id != null ? (facturaPorId.get(d.facturado_en_id) ?? null) : null}
                            onAbrir={onAbrir}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}

function FilaDocumento({
  d,
  avisos,
  abierto,
  factura,
  onAbrir,
}: {
  d: Factura;
  avisos: number;
  abierto: boolean;
  /** La factura que recoge este albarán, si consta. */
  factura: Factura | null;
  onAbrir: (id: number) => void;
}) {
  // Albarán ya recogido en una factura: se enseña atenuado y no suma en los totales.
  const facturado = d.tipo === "albaran" && d.facturado_en_id != null;
  // Una sola insignia visible: la más importante (avisos > sin revisar > sin factura).
  // Las demás van en el tooltip de la fila.
  const marcas: { clave: string; texto: string; icono: typeof AlertTriangle; clase: string }[] = [];
  if (avisos > 0) marcas.push({ clave: "avisos", texto: `${avisos} ${avisos === 1 ? "aviso" : "avisos"}`, icono: AlertTriangle, clase: "text-red-700 dark:text-red-400" });
  if (!d.verificada) marcas.push({ clave: "sin-revisar", texto: "Sin revisar", icono: EyeOff, clase: "text-muted-foreground" });
  if (esAlbaranSinFactura(d)) marcas.push({ clave: "sin-factura", texto: "Sin factura", icono: Receipt, clase: "text-amber-700 dark:text-amber-400" });
  const principal = marcas[0];
  const Icono = principal?.icono;
  const textoFactura = facturado ? `en ${factura?.numero_documento ?? "una factura"}` : null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(d.id)}
        aria-current={abierto ? "true" : undefined}
        title={
          facturado
            ? `Ya incluido en ${factura ? `la factura ${factura.numero_documento}` : "una factura"}: no suma en los totales`
            : marcas.length > 1
              ? marcas.map((m) => m.texto).join(" · ")
              : undefined
        }
        data-facturado={facturado ? "true" : undefined}
        className={`flex min-h-12 w-full scroll-mt-12 items-center gap-3 px-2 py-1.5 text-left transition-colors hover:bg-muted/40 ${abierto ? "bg-muted/70" : ""} ${facturado ? "opacity-60" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="min-w-0 truncate text-sm font-semibold">
              <span data-numero>{d.numero_documento}</span>
              <span className="font-normal text-muted-foreground"> · {ETIQUETA_TIPO[d.tipo] ?? d.tipo}</span>
            </span>
            {principal && Icono && (
              <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] pointer-coarse:text-xs font-medium ${principal.clase}`}>
                <Icono className="h-3 w-3" aria-hidden="true" /> {principal.texto}
                {marcas.length > 1 && <span className="font-normal text-muted-foreground">+{marcas.length - 1}</span>}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatDateCorta(d.fecha)}
            {textoFactura && <span data-en-factura> · {textoFactura}</span>}
            {d.productos.length > 0 && ` · ${plural(d.productos.length, "línea", "líneas")}`}
          </span>
        </span>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${facturado ? "font-normal line-through decoration-muted-foreground/60" : ""}`}>
          {d.total != null ? formatCurrency(d.total) : "—"}
        </span>
      </button>
    </li>
  );
}
