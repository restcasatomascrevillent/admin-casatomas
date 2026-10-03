import { useState, useDeferredValue, useMemo } from "react";
import { useAlbaranes, Factura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search, FileText, Package, Sparkles, Pencil } from "lucide-react";
import { EditarFacturaDialog } from "./EditarFacturaDialog";
import {
  formatCurrency,
  formatDate,
  formatDateCorta,
  formatDateTime,
  truncateText,
  avisosDocumento,
} from "./shared/formatters";
import { SelectorColumnas, type ColumnaType } from "./shared/SelectorColumnas";
import { FilaProducto } from "./shared/FilaProducto";
import { BotonOriginal, AccionesDocumento } from "./shared/BotonOriginal";
import { TextoLargoPopover } from "./shared/TextoLargoPopover";
import { EstadoDocumento, ResumenRevision, type FiltroRevision } from "./shared/EstadoDocumento";
import {
  CELDA,
  ALTO_FILA,
  ANCHO_CHEVRON,
  ANCHO_NUMERO,
  ANCHO_PROVEEDOR,
  ANCHO_ESTADO,
  ANCHO_FECHA,
  ANCHO_FECHA_LARGA,
  ANCHO_IMPORTE,
  ANCHO_TOTAL,
  ANCHO_OBSERVACIONES,
  ANCHO_ITEMS,
  ANCHO_ACCIONES,
} from "./shared/tabla";

const COLUMNAS_ALBARANES: ColumnaType[] = [
  { key: "numero", label: "Número" },
  { key: "proveedor", label: "Proveedor" },
  { key: "estado", label: "Estado" },
  { key: "fecha", label: "Fecha" },
  { key: "subtotal", label: "Base imponible" },
  { key: "iva", label: "IVA" },
  { key: "total", label: "Total" },
  { key: "observaciones", label: "Observaciones" },
  { key: "items", label: "Líneas" },
  { key: "procesado_en", label: "Procesado en" },
  { key: "creado", label: "Creado" },
];

// 2026-09-28 · Total pasa a estar ENCENDIDA por defecto y Observaciones apagada.
// Estaba justo al reves, y era la peor combinacion posible: el albaran 2509134
// de Joselito suma 120.580 € por un error de lectura del OCR (12 jamones a
// 9.316,67 €/ud) y ese numero no se veia por ningun sitio en la lista, mientras
// que la columna que si se veia era un campo de texto libre del proveedor.
// Lo primero que hay que poder comprobar de un albaran es cuanto dice que vale.
const DEFAULTS_ALBARANES: Record<string, boolean> = {
  numero: true,
  proveedor: true,
  estado: true,
  fecha: true,
  subtotal: false,
  iva: false,
  total: true,
  observaciones: false,
  items: true,
  procesado_en: false,
  creado: false,
};

const FilaAlbaranMobile = ({
  albaran,
  avisos,
  onPreguntarIA,
  allDocs,
  onEdit,
}: {
  albaran: Factura;
  avisos: ReturnType<typeof avisosDocumento>;
  onPreguntarIA?: (doc: Factura) => void;
  allDocs: Factura[];
  onEdit: (doc: Factura) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;

  return (
    <Card className="mb-3 overflow-hidden border-border/50 shadow-sm">
      <CardHeader
        className="cursor-pointer py-3 transition-colors hover:bg-muted/30"
        onClick={() => tieneProductos && setIsOpen(!isOpen)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {tieneProductos ? (
              isOpen ? (
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )
            ) : (
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <CardTitle className="break-words text-sm font-semibold text-foreground">
                {albaran.numero_documento}
              </CardTitle>
              <p className="mt-0.5 break-words text-xs text-muted-foreground" title={albaran.proveedor ?? undefined}>
                {albaran.proveedor || "Sin proveedor"}
              </p>
              <div className="mt-1.5">
                <EstadoDocumento
                  alertas={avisos}
                  verificada={albaran.verificada}
                  onRevisar={() => onEdit(albaran)}
                  compacto={false}
                />
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            {albaran.total != null && (
              <p className="whitespace-nowrap text-sm font-semibold tabular-nums tracking-tight">
                {formatCurrency(albaran.total)}
              </p>
            )}
            <p className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">{formatDate(albaran.fecha)}</p>
            {tieneProductos && (
              <Badge variant="secondary" className="mt-1.5 bg-muted/80 text-xs font-bold uppercase">
                {albaran.productos.length} líneas
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Botonera de acciones rápida unida al Header en mobile */}
      <div className="grid grid-cols-2 gap-1.5 border-t border-border/30 bg-muted/20 px-3 py-2">
        <BotonOriginal driveUrl={albaran.drive_url} archivoPath={albaran.archivo_path} variant="mobile" label="Doc" />
        <Button
          variant="ghost"
          size="sm"
          className="h-11 w-full min-w-0 justify-center gap-1.5 border border-border/40 px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(albaran);
          }}
        >
          <Pencil className="h-4 w-4" /> Editar
        </Button>
        {onPreguntarIA && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-full min-w-0 justify-center gap-1.5 border border-[hsl(38,59%,45%)/0.2] bg-[hsl(38,59%,45%)/0.05] px-2 text-sm font-medium text-[hsl(38,59%,45%)] transition-colors hover:bg-[hsl(38,59%,45%)/0.15] hover:text-[hsl(38,59%,45%)]"
            onClick={(e) => {
              e.stopPropagation();
              onPreguntarIA(albaran);
            }}
          >
            <Sparkles className="h-4 w-4" /> IA
          </Button>
        )}
      </div>

      {isOpen && (
        <CardContent className="bg-muted/5 pb-4 pt-3">
          <div className="space-y-2.5 text-sm">
            {albaran.cif && (
              <div className="flex justify-between border-b border-border/30 pb-1.5">
                <span className="text-muted-foreground">CIF</span>
                <span className="font-medium">{albaran.cif}</span>
              </div>
            )}
            {albaran.subtotal != null && (
              <div className="flex justify-between border-b border-border/30 pb-1.5">
                <span className="text-muted-foreground">Base imponible</span>
                <span className="font-medium tabular-nums">{formatCurrency(albaran.subtotal)}</span>
              </div>
            )}
            {albaran.iva != null && (
              <div className="flex justify-between border-b border-border/30 pb-1.5">
                <span className="text-muted-foreground">IVA</span>
                <span className="font-medium tabular-nums">{formatCurrency(albaran.iva)}</span>
              </div>
            )}
            {albaran.total != null && (
              <div className="flex justify-between border-b border-border/30 pb-1.5">
                <span className="font-semibold text-foreground">Total</span>
                <span className="font-bold tabular-nums text-foreground">{formatCurrency(albaran.total)}</span>
              </div>
            )}
            {albaran.observaciones && (
              <div className="py-1">
                <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                  Observaciones
                </span>
                <p className="rounded-md border border-border/50 bg-muted/30 p-2 text-sm">{albaran.observaciones}</p>
              </div>
            )}

            {tieneProductos && (
              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Package className="h-3.5 w-3.5" /> Desglose ({albaran.productos.length})
                </p>
                <div className="space-y-1.5">
                  {albaran.productos.map((p) => (
                    <FilaProducto key={p.id} p={p} isMobile allDocs={allDocs} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
};

const FilaAlbaranDesktop = ({
  albaran,
  avisos,
  visibles,
  onPreguntarIA,
  allDocs,
  onEdit,
}: {
  albaran: Factura;
  avisos: ReturnType<typeof avisosDocumento>;
  visibles: Record<string, boolean>;
  onPreguntarIA?: (doc: Factura) => void;
  allDocs: Factura[];
  onEdit: (doc: Factura) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;
  const colSpan = 2 + Object.values(visibles).filter(Boolean).length;

  return (
    <>
      <TableRow
        className={`group cursor-pointer transition-colors hover:bg-muted/30 ${ALTO_FILA}`}
        onClick={() => tieneProductos && setIsOpen(!isOpen)}
      >
        <TableCell className={`${CELDA} ${ANCHO_CHEVRON} pl-2 pr-0`}>
          {tieneProductos ? (
            isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )
          ) : null}
        </TableCell>
        {visibles.numero && (
          <TableCell className={`${CELDA} ${ANCHO_NUMERO} text-[13px] font-semibold text-foreground xl:text-sm`}>
            <span className="block truncate" title={albaran.numero_documento}>
              {albaran.numero_documento}
            </span>
          </TableCell>
        )}
        {visibles.proveedor && (
          <TableCell className={`${CELDA} ${ANCHO_PROVEEDOR} font-medium`}>
            <span className="block truncate" title={albaran.proveedor ?? undefined}>
              {albaran.proveedor || "-"}
            </span>
          </TableCell>
        )}
        {visibles.estado && (
          <TableCell className={`${CELDA} ${ANCHO_ESTADO}`}>
            <EstadoDocumento alertas={avisos} verificada={albaran.verificada} onRevisar={() => onEdit(albaran)} />
          </TableCell>
        )}
        {visibles.fecha && (
          <TableCell className={`${CELDA} ${ANCHO_FECHA} whitespace-nowrap text-xs tabular-nums text-muted-foreground xl:text-sm`}>
            <span className="xl:hidden">{formatDateCorta(albaran.fecha)}</span>
            <span className="hidden xl:inline">{formatDate(albaran.fecha)}</span>
          </TableCell>
        )}
        {visibles.subtotal && (
          <TableCell className={`${CELDA} ${ANCHO_IMPORTE} whitespace-nowrap text-right tabular-nums`}>
            {formatCurrency(albaran.subtotal)}
          </TableCell>
        )}
        {visibles.iva && (
          <TableCell className={`${CELDA} ${ANCHO_IMPORTE} whitespace-nowrap text-right tabular-nums`}>
            {formatCurrency(albaran.iva)}
          </TableCell>
        )}
        {visibles.total && (
          <TableCell
            className={`${CELDA} ${ANCHO_TOTAL} whitespace-nowrap text-right font-bold tabular-nums text-foreground`}
          >
            {formatCurrency(albaran.total)}
          </TableCell>
        )}
        {visibles.observaciones && (
          <TableCell className={`${CELDA} ${ANCHO_OBSERVACIONES}`}>
            {albaran.observaciones && albaran.observaciones.length > 24 ? (
              <TextoLargoPopover completo={albaran.observaciones} corto={truncateText(albaran.observaciones, 24)} />
            ) : (
              <span className="block truncate text-sm text-muted-foreground">{albaran.observaciones || "-"}</span>
            )}
          </TableCell>
        )}
        {visibles.items && (
          <TableCell className={`${CELDA} ${ANCHO_ITEMS} text-center`}>
            {tieneProductos ? (
              <Badge variant="secondary" className="font-mono text-xs">
                {albaran.productos.length}
              </Badge>
            ) : (
              "-"
            )}
          </TableCell>
        )}
        {visibles.procesado_en && (
          <TableCell
            className={`${CELDA} ${ANCHO_FECHA_LARGA} whitespace-nowrap text-xs tabular-nums text-muted-foreground`}
          >
            {formatDateTime(albaran.procesado_en)}
          </TableCell>
        )}
        {visibles.creado && (
          <TableCell
            className={`${CELDA} ${ANCHO_FECHA_LARGA} whitespace-nowrap text-xs tabular-nums text-muted-foreground`}
          >
            {formatDateTime(albaran.created_at)}
          </TableCell>
        )}

        {/* Ver original · Editar · IA. Siempre las tres, siempre en la misma X. */}
        <TableCell className={`${CELDA} ${ANCHO_ACCIONES} pr-2 text-right xl:pr-3`}>
          <AccionesDocumento
            driveUrl={albaran.drive_url}
            archivoPath={albaran.archivo_path}
            onEditar={() => onEdit(albaran)}
            onPreguntarIA={onPreguntarIA ? () => onPreguntarIA(albaran) : undefined}
            tipo="albarán"
          />
        </TableCell>
      </TableRow>
      {isOpen && tieneProductos && (
        <TableRow className="bg-muted/10 hover:bg-muted/10">
          <TableCell colSpan={colSpan} className="border-b p-0">
            <div className="p-3 pl-8 pr-4 xl:pl-12 xl:pr-6">
              <div className="max-h-[300px] overflow-y-auto rounded-md border border-border/40 bg-background shadow-sm custom-scrollbar">
                {/* `table-fixed`: ver el comentario de FilaProducto. */}
                <Table className="table-fixed">
                  <TableHeader className="sticky top-0 z-10 border-b border-border/40 bg-muted/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 text-xs font-semibold uppercase tracking-wider">Producto</TableHead>
                      <TableHead className="h-9 w-[92px] text-right text-xs font-semibold uppercase tracking-wider xl:w-[120px]">
                        Cant. / U.
                      </TableHead>
                      <TableHead className="h-9 w-[92px] text-right text-xs font-semibold uppercase tracking-wider xl:w-[120px]">
                        P. Unitario
                      </TableHead>
                      <TableHead className="h-9 w-[100px] text-right text-xs font-semibold uppercase tracking-wider xl:w-[120px]">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {albaran.productos.map((p) => (
                      <FilaProducto key={p.id} p={p} allDocs={allDocs} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

export const TablaAlbaranes = ({ onPreguntarIA }: { onPreguntarIA?: (doc: Factura) => void }) => {
  const { data: albaranes, isLoading, error } = useAlbaranes();
  const [busqueda, setBusqueda] = useState("");
  const busquedaDeferida = useDeferredValue(busqueda); // No bloquea el thread durante escritura rápida
  const [columnasVisibles, setColumnasVisibles] = useState<Record<string, boolean>>(DEFAULTS_ALBARANES);
  const [filtro, setFiltro] = useState<FiltroRevision>("todos");
  const [facturaEditando, setFacturaEditando] = useState<Factura | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleEditAlbaran = (albaran: Factura) => {
    setFacturaEditando(albaran);
    setIsEditDialogOpen(true);
  };

  const toggleColumna = (key: string, checked: boolean) => {
    setColumnasVisibles((prev) => ({ ...prev, [key]: checked }));
  };

  const todos = useMemo(() => albaranes || [], [albaranes]);

  // Una vez por documento, no una vez por render de fila: `avisosDocumento`
  // recorre todos los productos de todos los documentos.
  const avisosPorId = useMemo(() => {
    const mapa = new Map<number, ReturnType<typeof avisosDocumento>>();
    todos.forEach((a) => mapa.set(a.id, avisosDocumento(a, todos)));
    return mapa;
  }, [todos]);

  const conAvisos = todos.filter((a) => (avisosPorId.get(a.id) ?? []).length > 0).length;
  const sinRevisar = todos.filter((a) => !a.verificada).length;

  const albaranesFiltrados = todos.filter((a) => {
    if (filtro === "avisos" && (avisosPorId.get(a.id) ?? []).length === 0) return false;
    if (filtro === "sin_revisar" && a.verificada) return false;
    const termino = busquedaDeferida.toLowerCase();
    return (
      a.numero_documento.toLowerCase().includes(termino) ||
      (a.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (a.observaciones?.toLowerCase().includes(termino) ?? false)
    );
  });

  const isFiltrandoBusqueda = busqueda !== busquedaDeferida;

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <p className="flex items-center gap-2 font-medium text-destructive">
            ⚠️ Error al cargar albaranes: {error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const vacio = (
    <Card className="border-border/50 bg-muted/10 shadow-none">
      <CardContent className="pb-8 pt-8 text-center">
        <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
        <p className="font-medium text-muted-foreground">
          {busqueda || filtro !== "todos" ? "No se encontraron albaranes" : "No hay albaranes registrados"}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pb-2">
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, proveedor u observaciones..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={[
              "border-border/60 bg-background pl-9 shadow-sm transition-colors focus-visible:border-primary",
              isFiltrandoBusqueda ? "opacity-70" : "",
            ].join(" ")}
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <ResumenRevision
            total={todos.length}
            conAvisos={conAvisos}
            sinRevisar={sinRevisar}
            filtro={filtro}
            onFiltro={setFiltro}
          />
          {/* El selector solo aplica a la tabla, que no existe por debajo de `xl`. */}
          <div className="hidden xl:block">
            <SelectorColumnas columnas={COLUMNAS_ALBARANES} visibles={columnasVisibles} onChange={toggleColumna} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-[60px] w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Tarjetas por debajo de 1280 px (tablet: botones de 44 px; dos columnas
              entre 1024 y 1279 px). Ver `shared/tabla.ts`. */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar xl:hidden">
            {albaranesFiltrados.length === 0 ? (
              vacio
            ) : (
              <div className="grid items-start gap-x-3 lg:grid-cols-2">
                {albaranesFiltrados.map((a) => (
                  <FilaAlbaranMobile
                    key={a.id}
                    albaran={a}
                    avisos={avisosPorId.get(a.id) ?? []}
                    onPreguntarIA={onPreguntarIA}
                    allDocs={todos}
                    onEdit={handleEditAlbaran}
                  />
                ))}
              </div>
            )}
          </div>

          {albaranesFiltrados.length === 0 ? (
            <div className="hidden xl:block">{vacio}</div>
          ) : (
            /* Sin `min-w`: la tabla nunca es mas ancha que su contenedor.
               Ver el comentario equivalente en TablaFacturas. */
            <div className="relative hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-border/60 bg-background shadow-sm custom-scrollbar xl:block">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-muted/95 shadow-[0_1px_3px_rgba(0,0,0,0.05)] backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <TableRow className="border-b-border/60 hover:bg-transparent">
                    <TableHead className={`${ANCHO_CHEVRON} pl-2 pr-0`}></TableHead>
                    {columnasVisibles.numero && (
                      <TableHead className={`${CELDA} ${ANCHO_NUMERO} whitespace-nowrap font-semibold`}>
                        Nº Albarán
                      </TableHead>
                    )}
                    {columnasVisibles.proveedor && (
                      <TableHead className={`${CELDA} ${ANCHO_PROVEEDOR} font-semibold`}>Proveedor</TableHead>
                    )}
                    {columnasVisibles.estado && (
                      <TableHead className={`${CELDA} ${ANCHO_ESTADO} font-semibold`}>Estado</TableHead>
                    )}
                    {columnasVisibles.fecha && (
                      <TableHead className={`${CELDA} ${ANCHO_FECHA} whitespace-nowrap font-semibold`}>
                        Fecha
                      </TableHead>
                    )}
                    {columnasVisibles.subtotal && (
                      <TableHead className={`${CELDA} ${ANCHO_IMPORTE} whitespace-nowrap text-right font-semibold`}>
                        <span className="xl:hidden">Base</span>
                        <span className="hidden xl:inline">Base imp.</span>
                      </TableHead>
                    )}
                    {columnasVisibles.iva && (
                      <TableHead className={`${CELDA} ${ANCHO_IMPORTE} whitespace-nowrap text-right font-semibold`}>
                        IVA
                      </TableHead>
                    )}
                    {columnasVisibles.total && (
                      <TableHead
                        className={`${CELDA} ${ANCHO_TOTAL} whitespace-nowrap text-right font-bold text-foreground`}
                      >
                        Total
                      </TableHead>
                    )}
                    {columnasVisibles.observaciones && (
                      <TableHead className={`${CELDA} ${ANCHO_OBSERVACIONES} font-semibold`}>Obs.</TableHead>
                    )}
                    {columnasVisibles.items && (
                      <TableHead className={`${CELDA} ${ANCHO_ITEMS} text-center font-semibold`}>
                        {/* "Nº" a secas se confundia con "Nº Factura"/"Nº Albaran" dos columnas
                            antes, asi que en la franja estrecha va el icono. */}
                        <Package className="mx-auto h-3.5 w-3.5 xl:hidden" aria-hidden="true" />
                        <span className="sr-only xl:hidden">Líneas</span>
                        <span className="hidden xl:inline">Líneas</span>
                      </TableHead>
                    )}
                    {columnasVisibles.procesado_en && (
                      <TableHead className={`${CELDA} ${ANCHO_FECHA_LARGA} whitespace-nowrap font-semibold`}>
                        Procesado
                      </TableHead>
                    )}
                    {columnasVisibles.creado && (
                      <TableHead className={`${CELDA} ${ANCHO_FECHA_LARGA} whitespace-nowrap font-semibold`}>
                        Creado
                      </TableHead>
                    )}
                    <TableHead className={`${CELDA} ${ANCHO_ACCIONES} pr-2 text-right xl:pr-3 font-semibold`}>
                      Acciones
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {albaranesFiltrados.map((a) => (
                    <FilaAlbaranDesktop
                      key={a.id}
                      albaran={a}
                      avisos={avisosPorId.get(a.id) ?? []}
                      visibles={columnasVisibles}
                      onPreguntarIA={onPreguntarIA}
                      allDocs={todos}
                      onEdit={handleEditAlbaran}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <EditarFacturaDialog factura={facturaEditando} open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen} />
    </div>
  );
};
