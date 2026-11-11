import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Package, Pencil, Plus, Sparkles, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlertaValidacion, Factura, ProductoFactura } from "@/hooks/useFacturas";
import { usePuedeCorregirDocumento } from "@/hooks/usePermisosFacturas";
import { formatDate, formatDateTime, formatImporte, type MediaPrecioLinea } from "@/components/facturas/shared/formatters";
import { etiquetaRetencion } from "@/lib/facturas/retencion";
import { EXPLICACION_IMPORTES, etiquetaIva, importesIva } from "@/lib/facturas/importesIva";
import { OriginalIncrustado } from "@/components/facturas/shared/OriginalIncrustado";
import { vistaPreviaDrive } from "@/lib/facturas/documentosCifra";
import { EstadoDocumento } from "@/components/facturas/shared/EstadoDocumento";
import { FilaProducto } from "@/components/facturas/shared/FilaProducto";
import { esAlbaranSinFactura } from "@/lib/facturas/compras";
import { esAbono, localDe, regaladoDocumento } from "@/lib/facturas/resumenCompras";
import { Marca, TITULO_SECCION } from "./estilo";
import { AlbaranesDeFactura } from "./AlbaranesDeFactura";
import { FacturaDelAlbaran } from "./FacturaDelAlbaran";
import { CosteLecturaFactura } from "@/components/facturas/CosteLecturaDocumento";

/** Línea vacía para «Añadir línea». */
const LINEA_VACIA: ProductoFactura = { id: 0, producto_nombre: "", precio: 0, proveedor: null };

/** Ancho de la ficha a partir del cual el original va a la derecha (tablet en horizontal). */
const ANCHO_VISOR_LATERAL = 880;

/** Si el elemento mide al menos `min` px de ancho (ResizeObserver; sin él, no). */
function useAnchoMinimo(ref: RefObject<HTMLElement>, min: number): boolean {
  const [cumple, setCumple] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const medir = (ancho: number) => setCumple(ancho >= min);
    medir(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => medir(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return cumple;
}

/**
 * Observaciones: dos líneas como mucho; el resto, tras «ver más». El botón va
 * FUERA del párrafo recortado (dentro del `line-clamp` quedaba oculto, QA de
 * diseño F2) y solo sale si el texto de verdad no cabe.
 */
function Observaciones({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const [desborda, setDesborda] = useState(false);
  const parrafo = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = parrafo.current;
    if (!el || abierto) return;
    // En jsdom no hay medidas (todo 0): se cae a la regla de antes (largo o con saltos de línea).
    const medir = () => setDesborda(el.clientHeight > 0 ? el.scrollHeight > el.clientHeight + 1 : texto.length > 120 || texto.includes("\n"));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [texto, abierto]);
  return (
    <section aria-label="Observaciones" className="space-y-1">
      <h3 className={TITULO_SECCION}>Observaciones</h3>
      <p ref={parrafo} className={`text-sm text-foreground/90 ${abierto ? "whitespace-pre-line" : "line-clamp-2"}`}>
        {texto}
      </p>
      {(desborda || abierto) && (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="relative text-sm font-medium text-primary underline underline-offset-2 before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:decoration-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {abierto ? "ver menos" : "ver más"}
        </button>
      )}
    </section>
  );
}

/** Una cifra del bloque de importes: etiqueta pequeña arriba, valor grande debajo. */
const Cifra = ({ etiqueta, children, destacada = false, testId }: { etiqueta: ReactNode; children: ReactNode; destacada?: boolean; testId?: string }) => (
  <div className={`min-w-0 px-3 py-2 ${destacada ? "bg-muted/25" : ""}`} data-testid={testId}>
    <dt className="truncate text-xs font-medium text-muted-foreground">{etiqueta}</dt>{" "}
    <dd className={`tabular-nums ${destacada ? "text-lg font-semibold leading-7" : "text-base font-medium leading-7"}`}>{children}</dd>
  </div>
);

/** Separador del texto de la cabecera, pegado al FINAL de cada dato: si la línea se parte, no empieza por «·». */
const Punto = () => (
  <span aria-hidden="true" className="text-muted-foreground/60">
    {" "}·
  </span>
);

/**
 * Compras › Documentos › ficha (acabado del 05/11/2026): un visor de documento.
 *   · Cabecera a todo el ancho: tipo y número, estado, y debajo proveedor (enlace),
 *     fecha, CIF y local; a la derecha las acciones agrupadas (Editar · Preguntar a la IA).
 *   · Importes en una franja (Base · IVA · Total · Regalado) y las líneas en una
 *     tabla limpia (columnas cuando cabe; nombre e importe con el detalle debajo si no).
 *     11/11/2026 (dueño: «calcular con bases imponibles, antes de impuestos y después de
 *     impuestos… explicándolos para tontos»): el IVA dice su % (o «varios tipos»), la base o
 *     el IVA que falten se calculan con el total, una frase explica qué es cada cifra y el
 *     importe de las líneas dice «sin IVA».
 *   · El ORIGINAL (vista previa de Drive o copia de Storage) grande: a la derecha,
 *     a todo el alto y con su propio scroll, si la ficha mide 880 px o más (tablet
 *     en horizontal); si no, debajo de los importes. Es el ÚNICO sitio del original
 *     (dueño, 09/11/2026): ya no hay botón «Original» en la cabecera.
 * Cada línea con producto asignado enlaza con la ficha de ese producto.
 */
export function FichaDocumento({
  doc,
  avisos,
  mediaPrecio,
  facturaDelAlbaran,
  albaranesDeLaFactura,
  onEditar,
  onPreguntarIA,
  onAbrirProducto,
  onAbrirProveedor,
  onAbrirDocumento,
}: {
  doc: Factura;
  avisos: AlertaValidacion[];
  /**
   * Media de referencia del precio de cada línea (documentos del mismo tipo y
   * proveedor), calculada UNA vez en `TabCompras` con `indicePreciosLinea`.
   */
  mediaPrecio?: MediaPrecioLinea;
  /** Si es un albarán ya facturado: la factura que lo recoge (si está en la lista; basta su número). */
  facturaDelAlbaran: Pick<Factura, "numero_documento"> | null;
  /** Si es una factura: los albaranes que recoge (cabeceras de la lista). */
  albaranesDeLaFactura: Pick<Factura, "id" | "numero_documento" | "fecha" | "subtotal">[];
  onEditar: (doc: Factura) => void;
  onPreguntarIA?: (doc: Factura) => void;
  onAbrirProducto: (productoId: number) => void;
  onAbrirProveedor: (nombre: string) => void;
  onAbrirDocumento: (id: number) => void;
}) {
  // Corregir este documento: con «Editar» en Facturas, cualquiera; con «Facturas · Subida»,
  // solo si lo subió él (06/11/2026). Vincular albaranes, etc., lo deciden sus piezas («Editar»).
  const puedeEditar = usePuedeCorregirDocumento(doc.id);
  const [añadiendo, setAñadiendo] = useState(false);
  // Al cambiar de documento se cierra el formulario de línea nueva.
  useEffect(() => setAñadiendo(false), [doc.id]);
  const raiz = useRef<HTMLDivElement>(null);
  const ancha = useAnchoMinimo(raiz, ANCHO_VISOR_LATERAL);
  const esAlbaran = doc.tipo === "albaran";
  const abono = esAbono(doc);
  const nombreTipo = abono ? "Abono" : esAlbaran ? "Albarán" : "Factura";
  const titulo = `${nombreTipo} ${doc.numero_documento}`;
  const regalado = regaladoDocumento(doc);
  const hayImportes = doc.subtotal != null || doc.iva != null || doc.total != null;
  const touza = localDe(doc) === "touza";
  // El visor lateral solo tiene sentido con algo que incrustar: vista previa de Drive o copia en Storage.
  const hayVisor = Boolean(vistaPreviaDrive(doc.drive_url) || doc.archivo_path);
  const visorLateral = ancha && hayVisor;

  const original = <OriginalIncrustado driveUrl={doc.drive_url} archivoPath={doc.archivo_path} titulo={titulo} relleno={visorLateral} />;

  const cabecera = (
    // Bajo 640 px (móvil) el título ocupa su fila entera y las acciones van en otra
    // debajo (QA M7: a 390 px el título se quedaba estrujado al lado de los botones).
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border/60 px-4 py-3 sm:px-5">
      <div className="w-full min-w-0 space-y-1 sm:w-auto sm:flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h2 className="break-words text-xl font-semibold leading-tight tracking-tight">{titulo}</h2>
          {abono && esAlbaran && <Marca tono="neutro" grande>Albarán</Marca>}
          <EstadoDocumento
            alertas={avisos}
            verificada={doc.verificada}
            origen={doc.verificacion_origen}
            // «Sin revisar» solo lleva al diálogo de edición a quien puede editar (QA C-09).
            onRevisar={puedeEditar ? () => onEditar(doc) : undefined}
            compacto={false}
            enLinea
          />
          {esAlbaran && (esAlbaranSinFactura(doc) ? <Marca tono="sinFactura" grande>Sin factura todavía</Marca> : <Marca tono="ok" grande>Ya facturado</Marca>)}
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
          {doc.proveedor ? (
            <span className="inline-flex min-w-0 items-center">
              <button
                type="button"
                onClick={() => onAbrirProveedor(doc.proveedor as string)}
                className="relative inline-flex min-w-0 items-center gap-1.5 rounded-sm text-left font-medium text-foreground underline decoration-border underline-offset-4 before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={`Ver el proveedor ${doc.proveedor}`}
              >
                <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="break-words">{doc.proveedor}</span>
              </button>
              <Punto />
            </span>
          ) : (
            <span className="whitespace-nowrap">
              Sin proveedor
              <Punto />
            </span>
          )}
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(doc.fecha)}
            <Punto />
          </span>
          {doc.cif && (
            <span className="whitespace-nowrap">
              CIF {doc.cif}
              <Punto />
            </span>
          )}
          {touza ? <Marca tono="touza">Touza</Marca> : <span className="whitespace-nowrap">Casa Tomás</span>}
        </p>
      </div>

      {/* Acciones agrupadas: icono + palabra, también en tablet. Sin ninguna (solo «Ver», sin IA), no sale la caja vacía. */}
      {(puedeEditar || onPreguntarIA) && (
        <div role="group" aria-label="Acciones del documento" className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/70 bg-background p-0.5" data-tour="facturas-ficha-acciones">
          {/* «Editar» solo con permiso de edición (QA C-09: se ofrecía a quien solo puede ver). */}
          {puedeEditar && (
            <Button variant="ghost" className="h-11 min-w-11 shrink-0 gap-1.5 px-3 text-sm font-medium hover:bg-muted active:bg-muted/80" onClick={() => onEditar(doc)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              <span>Editar</span>
            </Button>
          )}
          {onPreguntarIA && (
            <>
              {puedeEditar && <span className="h-6 w-px bg-border/70" aria-hidden="true" />}
              <Button
                variant="ghost"
                className="h-11 min-w-11 shrink-0 gap-1.5 px-3 text-sm font-medium text-gold-strong hover:bg-gold/10 hover:text-gold-deep dark:text-gold-strong"
                onClick={() => onPreguntarIA(doc)}
                aria-label="Preguntar a la IA"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span aria-hidden="true">
                  <span className="hidden sm:inline">Preguntar a la </span>IA
                </span>
              </Button>
            </>
          )}
        </div>
      )}
    </header>
  );

  const retencion = doc.retencion_irpf ?? null;
  const conIva = importesIva(doc);
  const importes = hayImportes && (
    <div className="space-y-1">
      <dl aria-label="Importes" className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] divide-x divide-border/60 border-y border-border/60">
        {conIva.base != null && (
          <Cifra etiqueta={`Base imponible${conIva.baseCalculada ? " (calculada)" : ""}`}>{formatImporte(conIva.base)}</Cifra>
        )}
        {conIva.iva != null && <Cifra etiqueta={etiquetaIva(conIva)}>{formatImporte(conIva.iva)}</Cifra>}
        {retencion != null && (
          <Cifra etiqueta={etiquetaRetencion(doc.retencion_irpf_pct)} testId="retencion-documento">
            {formatImporte(-retencion)}
          </Cifra>
        )}
        {doc.total != null && (
          <Cifra etiqueta={`${retencion != null ? "Total a pagar" : "Total"}${doc.total_origen === "deducido" ? " (calculado, no leído)" : ""}`} destacada>
            <span className={abono ? "text-emerald-700 dark:text-emerald-400" : ""}>{formatImporte(doc.total)}</span>
          </Cifra>
        )}
        {regalado.importe > 0 && (
          <Cifra etiqueta="Regalado / descuentos" testId="regalado-documento">
            {formatImporte(regalado.importe)}
            <span className="text-xs font-normal text-muted-foreground"> sin IVA{regalado.estimado ? " · estimado" : ""}</span>
          </Cifra>
        )}
      </dl>
      {conIva.base != null && conIva.iva != null && (
        <p className="text-xs text-muted-foreground" data-testid="explicacion-importes">{EXPLICACION_IMPORTES}</p>
      )}
    </div>
  );

  const lineas = (
    <section aria-label="Líneas del documento" className="space-y-1 [container-type:inline-size]">
      <h3 className={TITULO_SECCION}>
        <Package className="h-3.5 w-3.5" aria-hidden="true" /> Líneas ({doc.productos.length})
      </h3>
      {doc.productos.length === 0 ? (
        !añadiendo && <p className="py-2 text-sm text-muted-foreground">Este documento no tiene líneas.</p>
      ) : (
        <div>
          {/* Cabecera de la tabla: solo cuando las columnas caben (ver FilaProducto). */}
          <div
            className="hidden border-b border-border/70 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground [@container(min-width:30rem)]:grid [@container(min-width:30rem)]:grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_7rem_2.75rem] [@container(min-width:30rem)]:gap-x-3"
            aria-hidden="true"
          >
            <span>Producto</span>
            <span className="text-right">Cantidad</span>
            <span className="text-right">Precio</span>
            <span className="text-right">Importe sin IVA</span>
            <span />
          </div>
          {doc.productos.map((p) => (
            <FilaProducto key={p.id} p={p} isMobile mediaReferencia={mediaPrecio?.(p, doc)} onAbrirProducto={onAbrirProducto} editable={puedeEditar} />
          ))}
        </div>
      )}
      {puedeEditar &&
        (añadiendo ? (
          <FilaProducto key={`nueva-${doc.id}`} p={LINEA_VACIA} isMobile nuevaEnFacturaId={doc.id} onCerrarNueva={() => setAñadiendo(false)} />
        ) : (
          <Button variant="ghost" className="-ml-3 h-11 gap-1.5 px-3 text-sm text-muted-foreground hover:text-foreground" onClick={() => setAñadiendo(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Añadir línea
          </Button>
        ))}
    </section>
  );

  const detalles = (
    <div className="space-y-5 px-4 py-4 sm:px-5">
      {importes}
      {/* En vertical (o sin sitio a la derecha), el original va aquí, grande, justo después de los importes. */}
      {!visorLateral && original}

      {/* Albarán ↔ factura: vínculo, candidatos y cotejo (migración 20261010110000). */}
      <div className="empty:hidden" data-tour="facturas-ficha-vinculo">
        {esAlbaran ? (
          <FacturaDelAlbaran albaran={doc} factura={facturaDelAlbaran} onAbrirDocumento={onAbrirDocumento} />
        ) : (
          <AlbaranesDeFactura factura={doc} albaranesCargados={albaranesDeLaFactura} onAbrirDocumento={onAbrirDocumento} />
        )}
      </div>

      {doc.observaciones && <Observaciones texto={doc.observaciones} />}

      {lineas}

      <div className="space-y-0.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        {(doc.procesado_en || doc.created_at) && (
          <p>
            {doc.procesado_en && <>Procesado {formatDateTime(doc.procesado_en)}</>}
            {doc.procesado_en && doc.created_at && " · "}
            {doc.created_at && <>Creado {formatDateTime(doc.created_at)}</>}
          </p>
        )}
        <CosteLecturaFactura facturaId={doc.id} className="text-xs text-muted-foreground" />
      </div>
    </div>
  );

  if (visorLateral) {
    return (
      <div ref={raiz} className="flex h-full min-h-0 flex-col" data-vista="lateral">
        {cabecera}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-h-0 overflow-y-auto overscroll-contain" data-testid="ficha-detalles">
            {detalles}
          </div>
          <div className="flex min-h-0 flex-col border-l border-border/60 bg-muted/20 p-3">{original}</div>
        </div>
      </div>
    );
  }
  return (
    <div ref={raiz} data-vista="apilada">
      {cabecera}
      {detalles}
    </div>
  );
}
