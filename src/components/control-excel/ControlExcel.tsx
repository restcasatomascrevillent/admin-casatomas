import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type CambioControl,
  type Cobro,
  type ControlNoDisponible,
  ErrorControlExcel,
  type EstadoControl,
  type Gasto,
  useCambiarControlExcel,
  useControlExcel,
} from "@/hooks/useControlExcel";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { cn } from "@/lib/utils";
import { DialogoCobro, DialogoMarcarCobrado } from "./DialogoCobro";
import { DialogoFicha } from "./DialogoFicha";
import { DialogoGasto } from "./DialogoGasto";
import { eur, fechaCorta, fechaHora } from "./formato";

type Dialogo =
  | null
  | { tipo: "ficha" }
  | { tipo: "cobro"; cobro: Cobro | null }
  | { tipo: "marcar"; cobro: Cobro }
  | { tipo: "gasto"; gasto: Gasto | null }
  | { tipo: "borrar"; cambio: CambioControl; titulo: string; texto: string };

const TONO_VERDE = "border-transparent bg-green-100 text-green-900";
const TONO_AMBAR = "border-transparent bg-amber-100 text-amber-950";
const TONO_AZUL = "border-transparent bg-sky-100 text-sky-950";
const TONO_GRIS = "border-transparent bg-muted text-muted-foreground";
const TONO_ROJO = "border-transparent bg-destructive/10 text-destructive";

const tonoCliente = (estado: string) => (estado === "Activo" ? TONO_VERDE : estado === "Pausado" ? TONO_AMBAR : TONO_GRIS);
const tonoCobro = (estado: string) => (estado === "Cobrado" ? TONO_VERDE : estado === "Parcial" ? TONO_AZUL : estado === "Pendiente" ? TONO_AMBAR : TONO_ROJO);

const TITULOS_NO_DISPONIBLE: Record<ControlNoDisponible["motivo"], string> = {
  sin_config: "Este entorno no está conectado a Google Drive",
  sin_acceso: "El panel no puede abrir el Excel",
  solo_lectura: "El panel solo puede leer el Excel",
  sin_cliente: "El cliente no está en el Excel",
  formato: "El Excel no tiene el formato esperado",
};

function Tarjeta({ titulo, valor, tono, children }: { titulo: string; valor: string; tono?: "bien" | "aviso"; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className={cn("mt-1 break-words text-lg font-semibold leading-tight", tono === "bien" && "text-green-700", tono === "aviso" && "text-amber-700")}>{valor}</p>
      {children && <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * Un dato con su etiqueta: en tarjeta «Etiqueta: valor»; en tabla la etiqueta está en la cabecera.
 * La tabla empieza en `xl` y no en `md`: el menú lateral se come 16rem y con menos ancho no caben 7 columnas.
 */
function Dato({ etiqueta, children, className }: { etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <p className={cn("min-w-0 text-sm xl:text-right", className)}>
      <span className="text-xs text-muted-foreground xl:hidden">{etiqueta}: </span>
      {children}
    </p>
  );
}

const REJILLA_COBROS = "xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_minmax(0,0.9fr)_auto] xl:items-center xl:gap-3";
const REJILLA_GASTOS = "xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] xl:items-center xl:gap-3";

function Cabecera({ columnas, rejilla }: { columnas: Array<[string, boolean?]>; rejilla: string }) {
  return (
    <div aria-hidden="true" className={cn("hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground", rejilla)}>
      {columnas.map(([c, derecha]) => <span key={c} className={derecha ? "text-right" : undefined}>{c}</span>)}
    </div>
  );
}

function Seccion({ titulo, cuenta, accion, children }: { titulo: string; cuenta?: number; accion?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="min-w-0 rounded-xl border bg-card">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <h3 className="min-w-0 text-base font-semibold">
          {titulo}
          {cuenta != null && <span className="ml-2 text-sm font-normal text-muted-foreground">{cuenta}</span>}
        </h3>
        {accion}
      </header>
      <div className="min-w-0 p-3">{children}</div>
    </section>
  );
}

function NoDisponible({ datos, recargando, onRecargar }: { datos: ControlNoDisponible; recargando: boolean; onRecargar: () => void }) {
  return (
    <div role="alert" className="mx-auto flex min-w-0 max-w-xl flex-col items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
        {TITULOS_NO_DISPONIBLE[datos.motivo] ?? "El Excel no está disponible"}
      </p>
      <p className="break-words text-sm">{datos.mensaje}</p>
      {datos.cuentaGoogle && (
        <p className="break-all text-sm">
          Cuenta de Google del panel: <strong>{datos.cuentaGoogle}</strong>
        </p>
      )}
      {datos.motivo === "sin_config" && <p className="text-sm">En la demo es lo normal: la cuenta de Google solo está puesta en producción.</p>}
      <Button type="button" variant="outline" className="h-11 gap-2 bg-background" onClick={onRecargar} disabled={recargando}>
        <RefreshCw className={cn("h-4 w-4", recargando && "animate-spin")} aria-hidden="true" />
        Volver a comprobar
      </Button>
    </div>
  );
}

/**
 * Super Admin › Gestor Gasto › «Control (Excel)»: el estado del cliente de este
 * panel en el Excel de control de OficiosOsIA y la edición de SUS datos (ficha,
 * cobros y gastos) sin abrir el Excel. Lo de otros clientes y lo del negocio
 * (gastos propios, socios) no pasa por aquí. No lleva layout de página: va
 * dentro de una pestaña con su propio scroll.
 */
export function ControlExcel() {
  const consulta = useControlExcel();
  const cambiar = useCambiarControlExcel();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const cerrar = () => setDialogo(null);

  /** Guarda un cambio. Devuelve null si ya está (o si hay que recargar) y el texto del error si hay que corregir algo. */
  const ejecutar = async (cambio: CambioControl, hecho: string): Promise<string | null> => {
    try {
      await cambiar.mutateAsync(cambio);
      toast.success(hecho);
      return null;
    } catch (e) {
      if (e instanceof ErrorControlExcel && e.hayQueRecargar) {
        toast.error(e.message);
        void consulta.refetch();
        return null;
      }
      if (e instanceof ErrorControlExcel && e.codigo === "datos_invalidos") return e.message;
      const mensaje = mensajeUsuario(e, "No se ha podido guardar en el Excel. Inténtalo de nuevo.");
      toast.error(mensaje);
      return mensaje;
    }
  };

  if (consulta.isLoading) {
    return (
      <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Abriendo el Excel de control…
      </p>
    );
  }
  if (consulta.isError || !consulta.data) {
    return (
      <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        <p>{mensajeUsuario(consulta.error, "No se ha podido abrir el Excel de control.")}</p>
        <Button type="button" variant="outline" className="h-11" onClick={() => void consulta.refetch()} disabled={consulta.isFetching}>Reintentar</Button>
      </div>
    );
  }
  // Con `strict: false` TypeScript no estrecha la unión por `disponible`: se hace a mano.
  if (!consulta.data.disponible) return <NoDisponible datos={consulta.data as ControlNoDisponible} recargando={consulta.isFetching} onRecargar={() => void consulta.refetch()} />;

  const datos = consulta.data as EstadoControl;
  const { ficha, resumen, listas, cobros, gastos } = datos;
  const ocupado = cambiar.isPending || consulta.isFetching;
  const bloqueado = ocupado || datos.soloLectura;
  const modificado = fechaHora(datos.archivo.modificado);
  const confirmarBorrado = async () => {
    if (dialogo?.tipo !== "borrar") return;
    const { cambio } = dialogo;
    cerrar();
    await ejecutar(cambio, cambio.accion === "borrar_cobro" ? "Cobro borrado del Excel" : "Gasto borrado del Excel");
  };

  return (
    <div data-testid="control-excel" className="flex min-w-0 flex-col gap-4 pb-4">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-lg font-semibold">
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
            <span className="min-w-0 break-words">{datos.cliente}</span>
            {ficha.estado && <Badge className={tonoCliente(ficha.estado)}>{ficha.estado}</Badge>}
          </h2>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            Excel «{datos.archivo.nombre}»{modificado ? ` · modificado el ${modificado}` : ""}. Aquí solo se ve y se cambia lo de este cliente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-11 gap-2">
            <a href={datos.archivo.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir en Drive
            </a>
          </Button>
          <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => void consulta.refetch()} disabled={ocupado}>
            <RefreshCw className={cn("h-4 w-4", consulta.isFetching && "animate-spin")} aria-hidden="true" /> Recargar
          </Button>
        </div>
      </header>

      {datos.soloLectura && (
        <p role="alert" className="flex min-w-0 items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            Solo lectura: la cuenta de Google del panel{datos.cuentaGoogle ? ` (${datos.cuentaGoogle})` : ""} no puede editar el Excel. Compártelo con esa cuenta como editor para poder guardar desde aquí.
          </span>
        </p>
      )}

      <div aria-label="Estado del cliente" role="group" className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta
          titulo="Instalación"
          valor={ficha.instalacionPactada == null ? "Sin pactar" : resumen.instalacionPendiente > 0 ? `${eur(resumen.instalacionPendiente)} pendiente` : "Cobrada"}
          tono={ficha.instalacionPactada == null ? undefined : resumen.instalacionPendiente > 0 ? "aviso" : "bien"}
        >
          <p>Pactada: {eur(ficha.instalacionPactada)}</p>
          <p>Cobrada: {eur(resumen.instalacionCobrada)}</p>
        </Tarjeta>
        <Tarjeta titulo="Cuota mensual" valor={ficha.cuotaPactada == null ? "Sin pactar" : `${eur(ficha.cuotaPactada)} al mes`}>
          <p>Día de cobro: {ficha.diaCobro ?? "—"}</p>
          <p>Cuotas cobradas: {eur(resumen.cuotasCobradas)}</p>
        </Tarjeta>
        <Tarjeta titulo="Pendiente de cobro" valor={eur(resumen.pendienteCobro)} tono={resumen.pendienteCobro > 0 ? "aviso" : "bien"}>
          <p>{resumen.cobrosPendientes === 1 ? "1 cobro pendiente" : `${resumen.cobrosPendientes} cobros pendientes`}</p>
          <p>Cobrado en total: {eur(resumen.cobradoTotal)}</p>
        </Tarjeta>
        <Tarjeta titulo="Gastos por recuperar" valor={eur(resumen.costesPorRecuperar)} tono={resumen.costesPorRecuperar > 0 ? "aviso" : "bien"}>
          <p>Repercutibles: {eur(resumen.gastosRepercutibles)}</p>
          <p>Reembolsados: {eur(resumen.reembolsosCobrados)}</p>
        </Tarjeta>
      </div>

      <Seccion
        titulo="Ficha del cliente"
        accion={
          <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => setDialogo({ tipo: "ficha" })} disabled={bloqueado}>
            <Pencil className="h-4 w-4" aria-hidden="true" /> Editar ficha
          </Button>
        }
      >
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-5">
          {([["Estado", ficha.estado || "—"], ["Cliente desde", fechaCorta(ficha.desde)], ["Instalación pactada", eur(ficha.instalacionPactada)], ["Cuota pactada", ficha.cuotaPactada == null ? "—" : `${eur(ficha.cuotaPactada)} al mes`], ["Día de cobro", ficha.diaCobro == null ? "—" : String(ficha.diaCobro)]] as const).map(([dt, dd]) => (
            <div key={dt} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{dt}</dt>
              <dd className="break-words font-medium">{dd}</dd>
            </div>
          ))}
          <div className="col-span-2 min-w-0 lg:col-span-5">
            <dt className="text-xs text-muted-foreground">Notas</dt>
            <dd className="whitespace-pre-wrap break-words">{ficha.notas || "—"}</dd>
          </div>
        </dl>
      </Seccion>

      <Seccion
        titulo="Cobros"
        cuenta={cobros.length}
        accion={
          <Button type="button" className="h-11 gap-2" onClick={() => setDialogo({ tipo: "cobro", cobro: null })} disabled={bloqueado || datos.filasLibres.cobros === 0}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Nuevo cobro
          </Button>
        }
      >
        {cobros.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hay cobros apuntados para este cliente.</p>
        ) : (
          <>
            <Cabecera rejilla={REJILLA_COBROS} columnas={[["Concepto"], ["Fechas"], ["Pactado", true], ["Cobrado", true], ["Pendiente", true], ["Estado"], ["Acciones", true]]} />
            <ul className="min-w-0 divide-y">
              {cobros.map((c) => {
                const nombre = [c.tipo, c.detalle].filter(Boolean).join(" · ") || `Cobro de la fila ${c.fila}`;
                return (
                  <li key={c.fila} data-testid={`cobro-${c.fila}`} className={cn("min-w-0 space-y-2 px-1 py-3 xl:space-y-0 xl:px-3", REJILLA_COBROS)}>
                    <div className="min-w-0">
                      <p className="break-words font-medium">{c.tipo || "Sin tipo"}</p>
                      {c.detalle && <p className="break-words text-sm text-muted-foreground">{c.detalle}</p>}
                      {c.notas && <p className="break-words text-xs text-muted-foreground">{c.notas}</p>}
                      {c.comprobar && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {c.comprobar}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 text-sm text-muted-foreground">
                      <p>Previsto: {fechaCorta(c.fechaPrevista)}</p>
                      {c.fechaCobro && <p>Cobrado: {fechaCorta(c.fechaCobro)}</p>}
                      {(c.metodo || c.recibidoPor) && <p className="break-words text-xs">{[c.metodo, c.recibidoPor && `lo recibe ${c.recibidoPor}`].filter(Boolean).join(" · ")}</p>}
                    </div>
                    <Dato etiqueta="Pactado">{eur(c.pactado)}</Dato>
                    <Dato etiqueta="Cobrado">{eur(c.cobrado)}</Dato>
                    <Dato etiqueta="Pendiente" className={c.pendiente > 0 ? "font-semibold" : undefined}>{eur(c.pendiente)}</Dato>
                    <div><Badge className={tonoCobro(c.estado)}>{c.estado}</Badge></div>
                    <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap xl:justify-end">
                      {c.pendiente > 0 && (
                        <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => setDialogo({ tipo: "marcar", cobro: c })} disabled={bloqueado}>
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Marcar cobrado
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Editar cobro: ${nombre}`} onClick={() => setDialogo({ tipo: "cobro", cobro: c })} disabled={bloqueado}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                        aria-label={`Borrar cobro: ${nombre}`}
                        onClick={() => setDialogo({ tipo: "borrar", cambio: { accion: "borrar_cobro", fila: c.fila }, titulo: "Borrar cobro", texto: `Vas a borrar del Excel el cobro «${nombre}» (${eur(c.pactado)}). No se puede deshacer desde aquí.` })}
                        disabled={bloqueado}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Seccion>

      <Seccion
        titulo="Gastos del cliente"
        cuenta={gastos.length}
        accion={
          <Button type="button" className="h-11 gap-2" onClick={() => setDialogo({ tipo: "gasto", gasto: null })} disabled={bloqueado || datos.filasLibres.gastos === 0}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Nuevo gasto
          </Button>
        }
      >
        {gastos.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hay gastos apuntados para este cliente.</p>
        ) : (
          <>
            <Cabecera rejilla={REJILLA_GASTOS} columnas={[["Proveedor"], ["Pago"], ["Importe", true], ["¿Se repercute?"], ["Acciones", true]]} />
            <ul className="min-w-0 divide-y">
              {gastos.map((g) => {
                const nombre = [g.proveedor, g.detalle].filter(Boolean).join(" · ") || `Gasto de la fila ${g.fila}`;
                return (
                  <li key={g.fila} data-testid={`gasto-${g.fila}`} className={cn("min-w-0 space-y-2 px-1 py-3 xl:space-y-0 xl:px-3", REJILLA_GASTOS)}>
                    <div className="min-w-0">
                      <p className="break-words font-medium">
                        {g.proveedor || "Sin proveedor"}
                        {g.tipo && <span className="ml-2 text-xs font-normal text-muted-foreground">{g.tipo}</span>}
                      </p>
                      {g.detalle && <p className="break-words text-sm text-muted-foreground">{g.detalle}</p>}
                      {g.notas && <p className="break-words text-xs text-muted-foreground">{g.notas}</p>}
                      {g.comprobar && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {g.comprobar}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 text-sm text-muted-foreground">
                      <p>Pagado: {fechaCorta(g.fecha)}</p>
                      {(g.pagadoPor || g.metodo) && <p className="break-words text-xs">{[g.pagadoPor && `lo paga ${g.pagadoPor}`, g.metodo].filter(Boolean).join(" · ")}</p>}
                    </div>
                    <Dato etiqueta="Importe" className="font-semibold">{g.importe == null ? "Sin importe" : eur(g.importe)}</Dato>
                    <div>
                      <Badge className={g.repercutir === "Sí" ? TONO_AZUL : g.repercutir === "No" ? TONO_GRIS : TONO_AMBAR}>
                        {g.repercutir === "Sí" ? "Se repercute" : g.repercutir === "No" ? "No se repercute" : "Sin decidir"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 xl:justify-end">
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Editar gasto: ${nombre}`} onClick={() => setDialogo({ tipo: "gasto", gasto: g })} disabled={bloqueado}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                        aria-label={`Borrar gasto: ${nombre}`}
                        onClick={() => setDialogo({ tipo: "borrar", cambio: { accion: "borrar_gasto", fila: g.fila }, titulo: "Borrar gasto", texto: `Vas a borrar del Excel el gasto «${nombre}»${g.importe == null ? "" : ` (${eur(g.importe)})`}. No se puede deshacer desde aquí.` })}
                        disabled={bloqueado}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 border-t pt-2 text-right text-sm text-muted-foreground">
              Total gastado en este cliente: <strong className="text-foreground">{eur(resumen.gastosTotal)}</strong>
            </p>
          </>
        )}
      </Seccion>

      <DialogoFicha
        abierto={dialogo?.tipo === "ficha"}
        cliente={datos.cliente}
        ficha={ficha}
        listas={listas}
        onGuardar={(f) => ejecutar({ accion: "guardar_ficha", ficha: f }, "Ficha guardada en el Excel")}
        onCerrar={cerrar}
      />
      <DialogoCobro
        abierto={dialogo?.tipo === "cobro"}
        cobro={dialogo?.tipo === "cobro" ? dialogo.cobro : null}
        listas={listas}
        onGuardar={(c) => ejecutar({ accion: "guardar_cobro", cobro: c }, c.fila ? "Cobro actualizado en el Excel" : "Cobro apuntado en el Excel")}
        onCerrar={cerrar}
      />
      <DialogoMarcarCobrado
        cobro={dialogo?.tipo === "marcar" ? dialogo.cobro : null}
        listas={listas}
        onGuardar={(c) => ejecutar({ accion: "guardar_cobro", cobro: c }, "Cobro marcado como cobrado")}
        onCerrar={cerrar}
      />
      <DialogoGasto
        abierto={dialogo?.tipo === "gasto"}
        gasto={dialogo?.tipo === "gasto" ? dialogo.gasto : null}
        listas={listas}
        onGuardar={(g) => ejecutar({ accion: "guardar_gasto", gasto: g }, g.fila ? "Gasto actualizado en el Excel" : "Gasto apuntado en el Excel")}
        onCerrar={cerrar}
      />
      <AlertDialog open={dialogo?.tipo === "borrar"} onOpenChange={(v) => !v && cerrar()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogo?.tipo === "borrar" ? dialogo.titulo : ""}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{dialogo?.tipo === "borrar" ? dialogo.texto : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void confirmarBorrado()}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
