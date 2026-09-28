import { useState, useDeferredValue, useMemo } from "react";
import { useFacturas, Factura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

// Re-export FilaProducto for consumers that import from TablaFacturas
export { FilaProducto } from "./shared/FilaProducto";

const COLUMNAS_FACTURAS: ColumnaType[] = [
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

// "Escaneo" ya NO es una columna conmutable: el boton de ver el original vive
// en el grupo de acciones (ver `AccionesDocumento`), donde no se puede apagar
// sin querer y no gasta una columna entera de ancho.
//
// `estado` entra encendida: es donde se ven los avisos del validador y el
// "Sin revisar". De los 5 documentos reales en produccion NINGUNO esta
// verificado y 2 traen avisos, asi que es la columna que mas dice ahora mismo.
const DEFAULTS_FACTURAS: Record<string, boolean> = {
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

const FilaFacturaMobile = ({
  factura,
  avisos,
  onPreguntarIA,
  onEdit,
  todasFacturas,
}: {
  factura: Factura;
  avisos: ReturnType<typeof avisosDocumento>;
  onPreguntarIA?: (doc: Factura) => void;
  onEdit: (doc: Factura) => void;
  todasFacturas: Factura[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;

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
              <CardTitle className="truncate text-sm font-semibold text-foreground">
                {factura.numero_documento}
              </CardTitle>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={factura.proveedor ?? undefined}>
                {factura.proveedor || "Sin proveedor"}
              </p>
              <div className="mt-1.5">
                <EstadoDocumento
                  alertas={avisos}
                  verificada={factura.verificada}
                  onRevisar={() => onEdit(factura)}
                  compacto={false}
                />
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="whitespace-nowrap text-sm font-semibold tabular-nums tracking-tight">
              {formatCurrency(factura.total)}
            </p>
            <p className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">{formatDate(factura.fecha)}</p>
          </div>
        </div>
      </CardHeader>

      {/* Botonera de acciones rápida unida al Header en mobile */}
      <div className="grid grid-cols-2 gap-1.5 border-t border-border/30 bg-muted/20 px-3 py-2">
        <BotonOriginal
          driveUrl={factura.drive_url}
          archivoPath={factura.archivo_path}
          variant="mobile"
          label="Escaneo"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full min-w-0 justify-center gap-1 border border-border/40 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(factura);
          }}
        >
          <Pencil className="h-3 w-3" /> Editar
        </Button>
        {onPreguntarIA && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full min-w-0 justify-center gap-1 border border-[hsl(38,59%,45%)/0.2] bg-[hsl(38,59%,45%)/0.05] px-2 text-[11px] font-medium text-[hsl(38,59%,45%)] transition-colors hover:bg-[hsl(38,59%,45%)/0.15] hover:text-[hsl(38,59%,45%)]"
            onClick={(e) => {
              e.stopPropagation();
              onPreguntarIA(factura);
            }}
          >
            <Sparkles className="h-3 w-3" /> IA
          </Button>
        )}
      </div>

      {isOpen && (
        <CardContent className="bg-muted/5 pb-4 pt-3">
          <div className="space-y-2.5 text-sm">
            {factura.cif && (
              <div className="flex justify-between border-b border-border/30 pb-1.5">
                <span className="text-muted-foreground">CIF</span>
                <span className="font-medium">{factura.cif}</span>
              </div>
            )}
            <div className="flex justify-between border-b border-border/30 pb-1.5">
              <span className="text-muted-foreground">Base imponible</span>
              <span className="font-medium tabular-nums">{formatCurrency(factura.subtotal)}</span>
            </div>
            <div className="flex justify-between border-b border-border/30 pb-1.5">
              <span className="text-muted-foreground">IVA</span>
              <span className="font-medium tabular-nums">{formatCurrency(factura.iva)}</span>
            </div>
            {factura.observaciones && (
              <div className="py-1">
                <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                  Observaciones
                </span>
                <p className="rounded-md border border-border/50 bg-muted/30 p-2 text-sm">{factura.observaciones}</p>
              </div>
            )}

            {tieneProductos && (
              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Package className="h-3.5 w-3.5" /> Desglose ({factura.productos.length})
                </p>
                <div className="space-y-1.5">
                  {factura.productos.map((p) => (
                    <FilaProducto key={p.id} p={p} isMobile={true} allDocs={todasFacturas} />
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

const FilaFacturaDesktop = ({
  factura,
  avisos,
  visibles,
  todasFacturas,
  onPreguntarIA,
  onEdit,
}: {
  factura: Factura;
  avisos: ReturnType<typeof avisosDocumento>;
  visibles: Record<string, boolean>;
  todasFacturas: Factura[];
  onPreguntarIA?: (doc: Factura) => void;
  onEdit: (doc: Factura) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;
  // chevron + columnas encendidas + acciones
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
            <span className="block truncate" title={factura.numero_documento}>
              {factura.numero_documento}
            </span>
          </TableCell>
        )}
        {visibles.proveedor && (
          <TableCell className={`${CELDA} ${ANCHO_PROVEEDOR} font-medium`}>
            <span className="block truncate" title={factura.proveedor ?? undefined}>
              {factura.proveedor || "-"}
            </span>
          </TableCell>
        )}
        {visibles.estado && (
          <TableCell className={`${CELDA} ${ANCHO_ESTADO}`}>
            <EstadoDocumento alertas={avisos} verificada={factura.verificada} onRevisar={() => onEdit(factura)} />
          </TableCell>
        )}
        {visibles.fecha && (
          <TableCell className={`${CELDA} ${ANCHO_FECHA} whitespace-nowrap text-xs tabular-nums text-muted-foreground xl:text-sm`}>
            <span className="xl:hidden">{formatDateCorta(factura.fecha)}</span>
            <span className="hidden xl:inline">{formatDate(factura.fecha)}</span>
          </TableCell>
        )}
        {visibles.subtotal && (
          <TableCell className={`${CELDA} ${ANCHO_IMPORTE} whitespace-nowrap text-right tabular-nums`}>
            {formatCurrency(factura.subtotal)}
          </TableCell>
        )}
        {visibles.iva && (
          <TableCell className={`${CELDA} ${ANCHO_IMPORTE} whitespace-nowrap text-right tabular-nums`}>
            {formatCurrency(factura.iva)}
          </TableCell>
        )}
        {visibles.total && (
          <TableCell
            className={`${CELDA} ${ANCHO_TOTAL} whitespace-nowrap text-right font-bold tabular-nums text-foreground`}
          >
            {formatCurrency(factura.total)}
          </TableCell>
        )}
        {visibles.observaciones && (
          <TableCell className={`${CELDA} ${ANCHO_OBSERVACIONES}`}>
            {factura.observaciones && factura.observaciones.length > 24 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block cursor-help truncate text-sm text-muted-foreground">
                      {truncateText(factura.observaciones, 24)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    <p className="text-sm">{factura.observaciones}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="block truncate text-sm text-muted-foreground">{factura.observaciones || "-"}</span>
            )}
          </TableCell>
        )}
        {visibles.items && (
          <TableCell className={`${CELDA} ${ANCHO_ITEMS} text-center`}>
            {tieneProductos ? (
              <Badge variant="secondary" className="font-mono text-xs">
                {factura.productos.length}
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
            {formatDateTime(factura.procesado_en)}
          </TableCell>
        )}
        {visibles.creado && (
          <TableCell
            className={`${CELDA} ${ANCHO_FECHA_LARGA} whitespace-nowrap text-xs tabular-nums text-muted-foreground`}
          >
            {formatDateTime(factura.created_at)}
          </TableCell>
        )}

        {/* Ver original · Editar · IA. Siempre las tres, siempre en la misma X. */}
        <TableCell className={`${CELDA} ${ANCHO_ACCIONES} pr-2 text-right xl:pr-3`}>
          <AccionesDocumento
            driveUrl={factura.drive_url}
            archivoPath={factura.archivo_path}
            onEditar={() => onEdit(factura)}
            onPreguntarIA={onPreguntarIA ? () => onPreguntarIA(factura) : undefined}
            tipo="factura"
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
                    {factura.productos.map((p) => (
                      <FilaProducto key={p.id} p={p} allDocs={todasFacturas} />
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

export const TablaFacturas = ({ onPreguntarIA }: { onPreguntarIA?: (doc: Factura) => void }) => {
  const { data: facturas, isLoading, error } = useFacturas();
  const [busqueda, setBusqueda] = useState("");
  const busquedaDeferida = useDeferredValue(busqueda); // No bloquea el thread durante escritura rápida
  const [columnasVisibles, setColumnasVisibles] = useState<Record<string, boolean>>(DEFAULTS_FACTURAS);
  const [filtro, setFiltro] = useState<FiltroRevision>("todos");
  const [facturaEditando, setFacturaEditando] = useState<Factura | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleEditFactura = (factura: Factura) => {
    setFacturaEditando(factura);
    setIsEditDialogOpen(true);
  };

  const toggleColumna = (key: string, checked: boolean) => {
    setColumnasVisibles((prev) => ({ ...prev, [key]: checked }));
  };

  const todas = useMemo(() => facturas || [], [facturas]);

  // Los avisos se calculan una vez por documento: `avisosDocumento` recorre
  // TODOS los productos de TODOS los documentos, asi que llamarlo desde el
  // render de cada fila lo volvia cuadratico.
  const avisosPorId = useMemo(() => {
    const mapa = new Map<number, ReturnType<typeof avisosDocumento>>();
    todas.forEach((f) => mapa.set(f.id, avisosDocumento(f, todas)));
    return mapa;
  }, [todas]);

  const conAvisos = todas.filter((f) => (avisosPorId.get(f.id) ?? []).length > 0).length;
  const sinRevisar = todas.filter((f) => !f.verificada).length;

  const facturasFiltradas = todas.filter((f) => {
    if (filtro === "avisos" && (avisosPorId.get(f.id) ?? []).length === 0) return false;
    if (filtro === "sin_revisar" && f.verificada) return false;
    const termino = busquedaDeferida.toLowerCase();
    return (
      f.numero_documento.toLowerCase().includes(termino) ||
      (f.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (f.cif?.toLowerCase().includes(termino) ?? false) ||
      (f.observaciones?.toLowerCase().includes(termino) ?? false)
    );
  });

  const isFiltrandoBusqueda = busqueda !== busquedaDeferida;

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <p className="flex items-center gap-2 font-medium text-destructive">
            ⚠️ Error al cargar facturas: {error.message}
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
          {busqueda || filtro !== "todos" ? "No se encontraron facturas" : "No hay facturas registradas"}
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
            placeholder="Buscar por número, proveedor, CIF u observaciones..."
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
            total={todas.length}
            conAvisos={conAvisos}
            sinRevisar={sinRevisar}
            filtro={filtro}
            onFiltro={setFiltro}
          />
          {/* El selector solo aplica a la tabla, que no existe por debajo de `lg`. */}
          <div className="hidden lg:block">
            <SelectorColumnas columnas={COLUMNAS_FACTURAS} visibles={columnasVisibles} onChange={toggleColumna} />
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
          {/* Tarjetas apiladas: TODO lo que no llega a 1024 px. El menu lateral
              aparece a 768 px y se lleva 16rem, asi que entre 768 y 1023 px a
              la tabla le quedan ~397 px utiles: ocho columnas no caben de
              ninguna manera. Ver el bloque de `shared/tabla.ts`. */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar lg:hidden">
            {facturasFiltradas.length === 0
              ? vacio
              : facturasFiltradas.map((f) => (
                  <FilaFacturaMobile
                    key={f.id}
                    factura={f}
                    avisos={avisosPorId.get(f.id) ?? []}
                    onPreguntarIA={onPreguntarIA}
                    onEdit={handleEditFactura}
                    todasFacturas={todas}
                  />
                ))}
          </div>

          {facturasFiltradas.length === 0 ? (
            <div className="hidden lg:block">{vacio}</div>
          ) : (
            /* Sin `min-w`: la tabla nunca es mas ancha que su contenedor. Lo
               que se ajusta es el contenido. El `overflow-x-hidden` es un
               cinturon de seguridad: si algun dia una celda volviera a pedir
               mas de lo que hay, se vera recortada en la pantalla —y se
               arreglara— pero NUNCA reaparecera la barra que escondia los
               importes. El scroll vertical se queda. */
            <div className="relative hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-border/60 bg-background shadow-sm custom-scrollbar lg:block">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-muted/95 shadow-[0_1px_3px_rgba(0,0,0,0.05)] backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <TableRow className="border-b-border/60 hover:bg-transparent">
                    <TableHead className={`${ANCHO_CHEVRON} pl-2 pr-0`}></TableHead>
                    {columnasVisibles.numero && (
                      <TableHead className={`${CELDA} ${ANCHO_NUMERO} whitespace-nowrap font-semibold`}>
                        Nº Factura
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
                  {facturasFiltradas.map((f) => (
                    <FilaFacturaDesktop
                      key={f.id}
                      factura={f}
                      avisos={avisosPorId.get(f.id) ?? []}
                      visibles={columnasVisibles}
                      todasFacturas={todas}
                      onPreguntarIA={onPreguntarIA}
                      onEdit={handleEditFactura}
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
