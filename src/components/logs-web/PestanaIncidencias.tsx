import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { TAM_PAGINA, useIncidencias, type Entorno, type FiltroOrigen, type FiltrosIncidencias, type Gravedad, type OrdenIncidencias } from "@/hooks/useLogsWeb";
import { cn } from "@/lib/utils";
import { causaDeFila, fmtFechaHora, NOMBRE_ESTADO, NOMBRE_GRAVEDAD, NOMBRE_LINEAR, NOMBRE_TIPO, origenDeFila, proveedorDeFila, sencilloDeFila } from "./calculos";
import { Buscador, FiltroSelect, Interruptor, Paginacion } from "./Controles";
import { BadgeOrigen, LeyendaOrigen, ResumenOrigenes } from "./Origen";
import { estiloDe } from "./origenEstilos";
import { grupoDeOrigen } from "../../../supabase/functions/_shared/logs-web/origen";

const TIPOS_ERROR = Object.entries(NOMBRE_TIPO).filter(([t]) => t.startsWith("error_")).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const ORDENES: Array<{ valor: OrdenIncidencias; etiqueta: string }> = [
  { valor: "recientes", etiqueta: "Más recientes" },
  { valor: "ocurrencias", etiqueta: "Más ocurrencias" },
  { valor: "sesiones", etiqueta: "Más sesiones" },
];
/** «Origen: todos» es el null del FiltroSelect; por defecto, fallos de la web y externos. */
const OPCIONES_ORIGEN: Array<{ valor: FiltroOrigen; etiqueta: string }> = [
  { valor: "web_externos", etiqueta: "Fallos de la web y externos" },
  { valor: "web", etiqueta: "Fallo de la web" },
  { valor: "externo", etiqueta: "Externos" },
  { valor: "no_depende", etiqueta: "No dependen de la web" },
];
import { PestanaActividad } from "./PestanaActividad";

interface PestanaIncidenciasProps {
  desde: string;
  hasta: string;
  entorno: Entorno | null;
  autoRefresco: number | false;
  onAbrirIncidencia: (id: number) => void;
  onAbrirSesion: (id: string) => void;
}

/** Errores agrupados (incidencias) con su seguimiento; y, aparte, los errores sueltos. */
export function PestanaIncidencias({ desde, hasta, entorno, autoRefresco, onAbrirIncidencia, onAbrirSesion }: PestanaIncidenciasProps) {
  const [vista, setVista] = useState<"incidencias" | "errores">("incidencias");
  const [texto, setTexto] = useState("");
  const textoFiltro = useDebouncedValue(texto, 350);
  const [estado, setEstado] = useState<FiltrosIncidencias["estado"]>("activas");
  const [gravedad, setGravedad] = useState<Gravedad | null>(null);
  const [fuente, setFuente] = useState<string | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [ocultarRuido, setOcultarRuido] = useState(true);
  const [orden, setOrden] = useState<OrdenIncidencias>("recientes");
  const [origen, setOrigen] = useState<FiltroOrigen | null>("web_externos");
  const [pagina, setPagina] = useState(0);
  const filtros = useMemo<FiltrosIncidencias>(
    () => ({ entorno, estado, gravedad, fuente, tipo, ocultarRuido, orden, texto: textoFiltro, origen }),
    [entorno, estado, gravedad, fuente, tipo, ocultarRuido, orden, textoFiltro, origen],
  );
  useEffect(() => setPagina(0), [filtros]);
  const q = useIncidencias(filtros, pagina, vista === "incidencias" ? autoRefresco : false, { conteos: true });
  // Sin la migración del origen, la lista sale como antes (sin colores de la base de datos ni filtro de origen).
  const conOrigen = !q.data?.sinOrigen;
  const conteos = q.data?.conteos;

  return (
    <div className="space-y-3 pt-3" data-testid="pestana-incidencias">
      <SelectorSubrayado aria-label="Ver" valor={vista} onCambio={(v) => setVista(v as "incidencias" | "errores")}
        opciones={[{ valor: "incidencias", etiqueta: "Incidencias agrupadas" }, { valor: "errores", etiqueta: "Errores sueltos" }]} />
      {vista === "errores" ? (
        <ErroresSueltos desde={desde} hasta={hasta} entorno={entorno} autoRefresco={autoRefresco} onAbrirIncidencia={onAbrirIncidencia} onAbrirSesion={onAbrirSesion} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Buscador valor={texto} onCambio={setTexto} placeholder="Buscar mensaje, pila o ticket" />
            <FiltroSelect etiqueta="Estado" valor={estado} onCambio={(v) => setEstado(v as FiltrosIncidencias["estado"])}
              opciones={[{ valor: "activas", etiqueta: "Activas (nuevas, abiertas, reabiertas)" }, ...Object.entries(NOMBRE_ESTADO).map(([valor, etiqueta]) => ({ valor, etiqueta }))]} ancho="sm:w-[230px]" />
            <FiltroSelect etiqueta="Gravedad" valor={gravedad} onCambio={(v) => setGravedad(v as Gravedad | null)}
              opciones={Object.entries(NOMBRE_GRAVEDAD).map(([valor, etiqueta]) => ({ valor, etiqueta }))} ancho="sm:w-[150px]" />
            <FiltroSelect etiqueta="Fuente" valor={fuente} onCambio={setFuente}
              opciones={["navegador", "servidor", "integracion", "hosting"].map((f) => ({ valor: f, etiqueta: f }))} ancho="sm:w-[150px]" />
            <FiltroSelect etiqueta="Tipo" valor={tipo} onCambio={setTipo} opciones={TIPOS_ERROR} ancho="sm:w-[190px]" />
            <Select value={orden} onValueChange={(v) => setOrden(v as OrdenIncidencias)}>
              <SelectTrigger aria-label="Orden" className="h-11 w-full sm:w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>{ORDENES.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.etiqueta}</SelectItem>)}</SelectContent>
            </Select>
            {conOrigen && (
              <FiltroSelect etiqueta="Origen" valor={origen} onCambio={(v) => setOrigen(v as FiltroOrigen | null)} opciones={OPCIONES_ORIGEN} ancho="sm:w-[230px]" />
            )}
            <Interruptor id="logs-ocultar-ruido" etiqueta="Ocultar las de solo bots y pruebas" valor={ocultarRuido} onCambio={setOcultarRuido} />
          </div>
          {conOrigen && conteos && <ResumenOrigenes conteos={conteos} filtro={origen} onFiltro={setOrigen} />}
          {conOrigen && <LeyendaOrigen />}
          <p className="text-xs text-muted-foreground">
            Cada incidencia agrupa las repeticiones de un mismo fallo (huella estable). El estado y los tickets se actualizan en segundo plano cada 5 minutos, aunque esta pantalla esté cerrada.
          </p>
          {q.isError ? (
            <EstadoErrorCarga titulo="las incidencias" error={q.error} onReintentar={() => q.refetch()} />
          ) : q.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : q.data?.filas.length ? (
            <Table data-testid="tabla-incidencias">
              <TableHeader>
                <TableRow>
                  <TableHead>Incidencia</TableHead>
                  <TableHead className="text-right">Ocurrencias</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Sesiones</TableHead>
                  <TableHead className="hidden md:table-cell">Última vez</TableHead>
                  <TableHead>Seguimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.filas.map((i) => {
                  const causa = causaDeFila(i);
                  const o = origenDeFila(i);
                  const noDepende = grupoDeOrigen(o) === "no_depende";
                  const sencillo = sencilloDeFila(i);
                  return (
                  <TableRow key={i.id} className={cn("cursor-pointer", noDepende && "text-muted-foreground")} tabIndex={0} onClick={() => onAbrirIncidencia(i.id)}
                    onKeyDown={(e) => e.key === "Enter" && onAbrirIncidencia(i.id)} data-testid="fila-incidencia" data-origen={o}>
                    <TableCell className={cn("border-l-4", o === "web" ? "border-l-destructive" : o === "externo" ? "border-l-amber-500" : "border-l-slate-300 dark:border-l-slate-600")}>
                      <span className="flex flex-wrap items-center gap-2">
                        <BadgeOrigen origen={o} proveedor={o === "externo" ? proveedorDeFila(i) : null} />
                        {i.gravedad === "critico" && o === "web" && <Badge variant="destructive" className="shrink-0">{NOMBRE_GRAVEDAD.critico}</Badge>}
                        <span className={cn("min-w-0 basis-full line-clamp-2 break-words sm:basis-auto", !noDepende && "text-foreground")}>{i.titulo}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{NOMBRE_TIPO[i.tipo] ?? i.tipo} · {i.fuente}{i.rutas[0] ? ` · ${i.rutas[0].ruta}` : ""} · gravedad {NOMBRE_GRAVEDAD[i.gravedad]?.toLowerCase() ?? i.gravedad}</span>
                      {sencillo && <span className={cn("mt-0.5 block text-xs line-clamp-2", o === "externo" ? estiloDe(o).texto : noDepende ? "text-muted-foreground" : "text-foreground/80")} data-testid="sencillo-fila">{sencillo}</span>}
                      {causa && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline" className="rounded-md whitespace-normal border-sky-500/50 text-left text-[11px] font-normal text-sky-800 dark:text-sky-300" data-testid="causa-conocida-fila">Causa conocida: {causa.titulo}</Badge>
                          {causa.id === "chunk_caducado" && (i.ocurrencias_tras_publicar ?? 0) > 0 && !(i.repetidas_tras_recargar ?? 0) && (
                            <Badge variant="outline" className="border-emerald-500/50 text-[11px] font-normal text-emerald-700 dark:text-emerald-300" data-testid="sin-impacto-fila">esperado tras publicar · sin impacto</Badge>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.ocurrencias}<span className="block text-xs text-muted-foreground">{i.ocurrencias_24h} en 24 h</span></TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{i.sesiones_afectadas}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-xs md:table-cell">{fmtFechaHora(i.ultima_vez)}</TableCell>
                    <TableCell className="space-y-1 text-xs">
                      <Badge variant="outline">{NOMBRE_ESTADO[i.estado]}</Badge>
                      <span className="block text-muted-foreground">
                        {i.linear_identificador ? `${i.linear_identificador}${i.linear_destino === "prueba" ? " (pruebas)" : ""}` : NOMBRE_LINEAR[i.linear_estado]}
                      </span>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="sin-incidencias">
              {conOrigen && origen === "web_externos" ? "No hay fallos de la web ni de servicios externos con estos filtros." : "No hay incidencias con estos filtros."}
            </p>
          )}
          {!q.isLoading && !q.isError && <Paginacion pagina={pagina} tam={TAM_PAGINA} total={q.data?.total ?? 0} onCambio={setPagina} cargando={q.isFetching} />}
          {conOrigen && origen === "web_externos" && (conteos?.no_depende ?? 0) > 0 && (
            <button type="button" onClick={() => setOrigen("no_depende")} data-testid="ver-no-dependen"
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 text-left text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-200">
              <span>No dependen de la web ({conteos!.no_depende}): conexión del visitante, navegador o extensión, versión antigua, bots y pruebas.</span>
              <span className="shrink-0 font-medium underline underline-offset-2">Ver</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Los eventos de error tal cual, con el mismo componente de la actividad (filtrado a errores). */
function ErroresSueltos(props: Omit<PestanaIncidenciasProps, "onAbrirIncidencia"> & { onAbrirIncidencia: (id: number) => void }) {
  return <PestanaActividad {...props} soloErrores />;
}
