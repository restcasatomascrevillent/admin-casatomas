import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  TAM_PAGINA,
  useCatalogoEventos,
  useEventos,
  useSesiones,
  type Categoria,
  type Entorno,
  type FiltrosActividad,
  type Gravedad,
} from "@/hooks/useLogsWeb";
import { NOMBRE_DISPOSITIVO, NOMBRE_ORIGEN } from "@/components/trafico-web/comportamiento/definiciones";
import { describirEvento, fmtDuracion, fmtFechaHora, NOMBRE_CATEGORIA, NOMBRE_TIPO } from "./calculos";
import { Buscador, FiltroSelect, Interruptor, Paginacion } from "./Controles";

interface PestanaActividadProps {
  desde: string;
  hasta: string;
  entorno: Entorno | null;
  autoRefresco: number | false;
  onAbrirSesion: (id: string) => void;
  onAbrirIncidencia: (id: number) => void;
  /** Errores sueltos (pestaña de incidencias): solo eventos, categoría error. */
  soloErrores?: boolean;
}

const OPCIONES_ORIGEN = Object.entries(NOMBRE_ORIGEN).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const OPCIONES_DISPOSITIVO = Object.entries(NOMBRE_DISPOSITIVO).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const OPCIONES_SI_NO = [{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }];
const triestado = (v: string | null) => (v === "si" ? true : v === "no" ? false : null);
const deTriestado = (v: boolean | null) => (v === true ? "si" : v === false ? "no" : null);

/**
 * Actividad: sesiones (recorridos) o eventos sueltos, con filtros, búsqueda y
 * paginación. Las sesiones solo existen para visitantes que aceptaron
 * «Estadísticas»; los errores llegan de todos.
 */
export function PestanaActividad({ desde, hasta, entorno, autoRefresco, onAbrirSesion, onAbrirIncidencia, soloErrores = false }: PestanaActividadProps) {
  const [vista, setVista] = useState<"sesiones" | "eventos">(soloErrores ? "eventos" : "sesiones");
  const [texto, setTexto] = useState("");
  const textoFiltro = useDebouncedValue(texto, 350);
  const [ruta, setRuta] = useState("");
  const rutaFiltro = useDebouncedValue(ruta, 350);
  const [tipo, setTipo] = useState<string | null>(null);
  const [origen, setOrigen] = useState<string | null>(null);
  const [dispositivo, setDispositivo] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<Categoria | null>(soloErrores ? "error" : null);
  const [gravedad, setGravedad] = useState<Gravedad | null>(null);
  const [fuente, setFuente] = useState<string | null>(null);
  const [conError, setConError] = useState<boolean | null>(null);
  const [conConversion, setConConversion] = useState<boolean | null>(null);
  const [incluirInternos, setIncluirInternos] = useState(false);
  const [incluirBots, setIncluirBots] = useState(false);
  const [pagina, setPagina] = useState(0);
  const catalogo = useCatalogoEventos();

  const filtros: FiltrosActividad = useMemo(() => ({
    desde, hasta, entorno, texto: textoFiltro.trim(), ruta: rutaFiltro.trim() || null, tipo, origen, dispositivo, categoria, fuente, gravedad,
    conError, conConversion, incluirInternos, incluirBots,
  }), [desde, hasta, entorno, textoFiltro, rutaFiltro, tipo, origen, dispositivo, categoria, fuente, gravedad, conError, conConversion, incluirInternos, incluirBots]);
  useEffect(() => setPagina(0), [filtros, vista]);

  const sesiones = useSesiones(filtros, pagina, vista === "sesiones" ? autoRefresco : false);
  const eventos = useEventos(filtros, pagina, vista === "eventos" ? autoRefresco : false, TAM_PAGINA);
  const q = vista === "sesiones" ? sesiones : eventos;

  const opcionesTipo = (catalogo.data ?? []).map((c) => ({ valor: c.tipo, etiqueta: NOMBRE_TIPO[c.tipo] ?? c.tipo }));

  return (
    <div className={soloErrores ? "space-y-3" : "space-y-3 pt-3"} data-testid={soloErrores ? "errores-sueltos" : "pestana-actividad"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!soloErrores && (
          <SelectorSubrayado aria-label="Ver" valor={vista} onCambio={(v) => setVista(v as "sesiones" | "eventos")}
            opciones={[{ valor: "sesiones", etiqueta: "Sesiones" }, { valor: "eventos", etiqueta: "Eventos" }]} />
        )}
        <Buscador valor={texto} onCambio={setTexto} placeholder={vista === "sesiones" ? "Buscar sesión, página o campaña" : "Buscar página, botón, mensaje o tipo"} />
        <input
          value={ruta}
          onChange={(e) => setRuta(e.target.value)}
          placeholder="Página exacta (p. ej. /reservas)"
          aria-label="Página"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-56"
        />
        <FiltroSelect etiqueta="Acción" valor={tipo} onCambio={setTipo} opciones={opcionesTipo} />
        <FiltroSelect etiqueta="Dispositivo" valor={dispositivo} onCambio={setDispositivo} opciones={OPCIONES_DISPOSITIVO} ancho="sm:w-[160px]" />
        {vista === "sesiones" ? (
          <>
            <FiltroSelect etiqueta="Origen" valor={origen} onCambio={setOrigen} opciones={OPCIONES_ORIGEN} ancho="sm:w-[160px]" />
            <FiltroSelect etiqueta="Con error" valor={deTriestado(conError)} onCambio={(v) => setConError(triestado(v))} opciones={OPCIONES_SI_NO} ancho="sm:w-[150px]" />
            <FiltroSelect etiqueta="Con conversión" valor={deTriestado(conConversion)} onCambio={(v) => setConConversion(triestado(v))} opciones={OPCIONES_SI_NO} ancho="sm:w-[170px]" />
          </>
        ) : (
          <>
            {!soloErrores && (
              <FiltroSelect etiqueta="Categoría" valor={categoria} onCambio={(v) => setCategoria(v as Categoria | null)}
                opciones={(["actividad", "tecnico", "error"] as const).map((c) => ({ valor: c, etiqueta: NOMBRE_CATEGORIA[c] }))} ancho="sm:w-[170px]" />
            )}
            <FiltroSelect etiqueta="Gravedad" valor={gravedad} onCambio={(v) => setGravedad(v as Gravedad | null)}
              opciones={[{ valor: "critico", etiqueta: "Crítica" }, { valor: "error", etiqueta: "Error" }, { valor: "aviso", etiqueta: "Aviso" }]} ancho="sm:w-[150px]" />
            <FiltroSelect etiqueta="Fuente" valor={fuente} onCambio={setFuente}
              opciones={["navegador", "servidor", "base_datos", "integracion", "hosting"].map((f) => ({ valor: f, etiqueta: f.replace("_", " ") }))} ancho="sm:w-[150px]" />
          </>
        )}
        <Interruptor id="act-internos" etiqueta="Internas y pruebas" valor={incluirInternos} onCambio={setIncluirInternos} />
        <Interruptor id="act-bots" etiqueta="Bots" valor={incluirBots} onCambio={setIncluirBots} />
      </div>

      {q.isError ? (
        <EstadoErrorCarga titulo={vista === "sesiones" ? "las sesiones" : "los eventos"} error={q.error} onReintentar={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : vista === "sesiones" ? (
        sesiones.data?.filas.length ? (
          <Table data-testid="tabla-sesiones">
            <TableHeader>
              <TableRow>
                <TableHead>Inicio</TableHead>
                <TableHead>Entrada y procedencia</TableHead>
                <TableHead className="hidden md:table-cell">Dispositivo</TableHead>
                <TableHead className="text-right">Páginas</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Activo</TableHead>
                <TableHead>Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sesiones.data.filas.map((s) => (
                <TableRow key={s.sesion_id} className="cursor-pointer" onClick={() => onAbrirSesion(s.sesion_id)} tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onAbrirSesion(s.sesion_id)} data-testid="fila-sesion">
                  <TableCell className="whitespace-nowrap tabular-nums">{fmtFechaHora(s.inicio)}</TableCell>
                  <TableCell>
                    <span className="block max-w-[16rem] truncate">{s.pagina_entrada ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{NOMBRE_ORIGEN[s.origen_tipo ?? "desconocido"] ?? s.origen_tipo}{s.campana ? ` · ${s.campana}` : s.origen_detalle ? ` · ${s.origen_detalle}` : ""}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs">{NOMBRE_DISPOSITIVO[s.dispositivo ?? "desconocido"] ?? s.dispositivo} · {s.navegador ?? "?"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.paginas_vistas}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtDuracion(s.tiempo_activo_ms)}</TableCell>
                  <TableCell className="space-x-1">
                    {s.conversiones > 0 && <Badge className="gap-1 bg-emerald-600"><CheckCircle2 className="h-3 w-3" />{s.conversiones}</Badge>}
                    {s.inicio_operacion && s.conversiones === 0 && <Badge variant="outline">empezó y no terminó</Badge>}
                    {s.errores > 0 && <Badge variant="destructive" className="gap-1"><AlertOctagon className="h-3 w-3" />{s.errores}</Badge>}
                    {(s.es_interno || s.es_prueba || s.es_bot) && <Badge variant="outline">{s.es_bot ? "bot" : s.es_prueba ? "prueba" : "interno"}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="sin-sesiones">No hay sesiones con estos filtros en el periodo.</p>
        )
      ) : eventos.data?.filas.length ? (
        <Table data-testid="tabla-eventos">
          <TableHeader>
            <TableRow>
              <TableHead>Hora</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Qué pasó</TableHead>
              <TableHead className="hidden lg:table-cell">Página</TableHead>
              <TableHead className="hidden md:table-cell">Origen del dato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventos.data.filas.map((e) => (
              <TableRow key={e.id} data-testid="fila-evento" className={e.categoria === "error" ? "bg-destructive/5" : undefined}>
                <TableCell className="whitespace-nowrap tabular-nums text-xs">{fmtFechaHora(e.ocurrido_en)}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant={e.categoria === "error" ? "destructive" : "outline"} className="whitespace-nowrap">{NOMBRE_TIPO[e.tipo] ?? e.tipo}</Badge>
                </TableCell>
                <TableCell className="max-w-[28rem] text-sm">
                  <span className="break-words">{describirEvento(e)}</span>
                  <span className="ml-2 space-x-2 text-xs">
                    {e.sesion_id && <button type="button" className="text-primary underline underline-offset-2" onClick={() => onAbrirSesion(e.sesion_id!)}>sesión</button>}
                    {e.incidencia_id && <button type="button" className="text-primary underline underline-offset-2" onClick={() => onAbrirIncidencia(e.incidencia_id!)}>incidencia #{e.incidencia_id}</button>}
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs">{e.ruta ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{e.fuente}{e.entorno !== "produccion" ? ` · ${e.entorno}` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground" data-testid="sin-eventos">No hay eventos con estos filtros en el periodo.</p>
      )}

      {!q.isLoading && !q.isError && (
        <Paginacion pagina={pagina} tam={TAM_PAGINA} total={q.data?.total ?? 0} onCambio={setPagina} cargando={q.isFetching} />
      )}
    </div>
  );
}
