import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { TAM_PAGINA, useIncidencias, type Entorno, type FiltrosIncidencias, type Gravedad, type OrdenIncidencias } from "@/hooks/useLogsWeb";
import { causaDeFila, fmtFechaHora, NOMBRE_ESTADO, NOMBRE_GRAVEDAD, NOMBRE_LINEAR, NOMBRE_TIPO } from "./calculos";
import { Buscador, FiltroSelect, Interruptor, Paginacion } from "./Controles";

const TIPOS_ERROR = Object.entries(NOMBRE_TIPO).filter(([t]) => t.startsWith("error_")).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const ORDENES: Array<{ valor: OrdenIncidencias; etiqueta: string }> = [
  { valor: "recientes", etiqueta: "Más recientes" },
  { valor: "ocurrencias", etiqueta: "Más ocurrencias" },
  { valor: "sesiones", etiqueta: "Más sesiones" },
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
  const [pagina, setPagina] = useState(0);
  const filtros = useMemo<FiltrosIncidencias>(
    () => ({ entorno, estado, gravedad, fuente, tipo, ocultarRuido, orden, texto: textoFiltro }),
    [entorno, estado, gravedad, fuente, tipo, ocultarRuido, orden, textoFiltro],
  );
  useEffect(() => setPagina(0), [filtros]);
  const q = useIncidencias(filtros, pagina, vista === "incidencias" ? autoRefresco : false);

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
            <Interruptor id="logs-ocultar-ruido" etiqueta="Ocultar las de solo bots y pruebas" valor={ocultarRuido} onCambio={setOcultarRuido} />
          </div>
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
                {q.data.filas.map((i) => { const causa = causaDeFila(i); return (
                  <TableRow key={i.id} className="cursor-pointer" tabIndex={0} onClick={() => onAbrirIncidencia(i.id)}
                    onKeyDown={(e) => e.key === "Enter" && onAbrirIncidencia(i.id)} data-testid="fila-incidencia">
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Badge variant={i.gravedad === "critico" || i.gravedad === "error" ? "destructive" : "outline"} className="shrink-0">{NOMBRE_GRAVEDAD[i.gravedad]}</Badge>
                        <span className="line-clamp-2 break-words">{i.titulo}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{NOMBRE_TIPO[i.tipo] ?? i.tipo} · {i.fuente}{i.rutas[0] ? ` · ${i.rutas[0].ruta}` : ""}</span>
                      {(causa || i.ocurrencias === 0) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {causa && <Badge variant="outline" className="rounded-md whitespace-normal border-sky-500/50 text-left text-[11px] font-normal text-sky-800 dark:text-sky-300" data-testid="causa-conocida-fila">Causa conocida: {causa.titulo}</Badge>}
                          {i.ocurrencias === 0 && <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">solo bots o pruebas</Badge>}
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
                ); })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="sin-incidencias">No hay incidencias con estos filtros.</p>
          )}
          {!q.isLoading && !q.isError && <Paginacion pagina={pagina} tam={TAM_PAGINA} total={q.data?.total ?? 0} onCambio={setPagina} cargando={q.isFetching} />}
        </>
      )}
    </div>
  );
}

/** Los eventos de error tal cual, con el mismo componente de la actividad (filtrado a errores). */
function ErroresSueltos(props: Omit<PestanaIncidenciasProps, "onAbrirIncidencia"> & { onAbrirIncidencia: (id: number) => void }) {
  return <PestanaActividad {...props} soloErrores />;
}
