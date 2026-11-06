import { useEffect, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MARCAS } from "@/lib/instagram";
import { ErrorInstagram, textoError, type Cuota, type EstadoDrive, type RespuestaEstado } from "./api";
import { useConexionInstagram } from "./useConexionInstagram";
import { ParaOficiosos } from "@/components/instagram/ParaOficiosos";

/**
 * Piezas de «Conexión con Instagram» (Edge Function instagram-estado). La
 * función nunca devuelve valores secretos: aquí solo se pintan nombre,
 * estado y detalle.
 */
export function iconoEstado(estado: string) {
  if (estado === "ok") return { Icono: CheckCircle2, clase: "text-emerald-600", texto: "Correcto" };
  if (estado === "aviso") return { Icono: AlertTriangle, clase: "text-amber-600", texto: "Aviso" };
  return { Icono: XCircle, clase: "text-destructive", texto: "Falta o falla" };
}

export function estadoCuota(usadas: number, total: number | null): string {
  if (total === null) return "aviso";
  return usadas >= total ? "falla" : usadas >= total * 0.8 ? "aviso" : "ok";
}

/** «3 de 100 en 24 h». */
export function textoCuota(c: Cuota): string {
  const horas = c.ventanaHoras ?? 24;
  return c.total === null ? `${c.usadas} usadas en ${horas} h (Meta no da el máximo)` : `${c.usadas} de ${c.total} en ${horas} h`;
}

function Linea({ estado, children }: { estado: string; children: ReactNode }) {
  const { Icono, clase, texto } = iconoEstado(estado);
  return (
    <li className="flex items-start gap-1.5">
      <Icono className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", clase)} aria-label={texto} role="img" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Bloque «Google Drive» del resultado de Comprobar. */
export function BloqueDrive({ drive }: { drive: EstadoDrive | null }) {
  if (!drive) {
    return (
      <p className="text-muted-foreground" data-testid="drive-conexion">
        Google Drive: la función desplegada aún no lo comprueba (despliega instagram-estado de nuevo).
      </p>
    );
  }
  const pasos = [...new Set(drive.comprobaciones.filter((c) => c.estado !== "ok" && c.comoArreglarlo).map((c) => c.comoArreglarlo as string))];
  return (
    <div className="space-y-1 border-t pt-2" data-testid="drive-conexion">
      <p className={cn("font-medium", drive.ok ? "text-emerald-700" : "text-destructive")}>
        {drive.ok
          ? `Google Drive listo${drive.carpeta ? `: carpeta «${drive.carpeta.nombre}»` : ""}.`
          : "Google Drive no está listo: las fotos y las piezas publicadas no se pueden archivar."}
      </p>
      <ul className="space-y-1">
        {drive.comprobaciones.map((c) => (
          <Linea key={c.nombre} estado={c.estado}>
            <span className="break-words">Drive · {c.nombre}</span>
            {c.detalle && <span className="text-muted-foreground"> · {c.detalle}</span>}
          </Linea>
        ))}
      </ul>
      {drive.avisos.map((a) => (
        <p key={a} className="flex items-start gap-1.5 text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {a}
        </p>
      ))}
      {pasos.length > 0 && (
        <div>
          <p className="font-medium">Cómo arreglar Drive</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
            {pasos.map((p) => <li key={p}>{p}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

interface Props {
  /** Avisa al editor de la cuenta (para el diálogo de publicar). */
  onEstado?: (estado: RespuestaEstado) => void;
  className?: string;
  /** Sin el título (dentro de un diálogo que ya lo lleva). */
  sinTitulo?: boolean;
}

/**
 * «Conexión con Instagram» en llano (evaluación de diseño C6): si está todo
 * listo, en qué cuenta publica cada marca, cuántas publicaciones quedan hoy y
 * si las fotos de Drive están disponibles. Lo técnico (secretos IG_USER_ID…,
 * comprobaciones, alcance del token de Drive) va plegado en «Para Oficiosos».
 * Usa la misma consulta que el indicador «● @cuenta» de la barra.
 */
export function ConexionInstagram({ onEstado, className, sinTitulo }: Props) {
  const conexion = useConexionInstagram();
  const { estado, error: errorConsulta, comprobando } = conexion;

  useEffect(() => {
    if (estado) onEstado?.(estado);
  }, [estado, onEstado]);

  const error = errorConsulta
    ? {
        texto: textoError(errorConsulta),
        pasos: errorConsulta instanceof ErrorInstagram && errorConsulta.comoArreglarlo ? [errorConsulta.comoArreglarlo].flat() : [],
      }
    : null;
  const pasos = estado?.comoArreglarlo ?? [];
  const cuentas: Array<{ marca: string; username: string | null; estado: string }> = estado
    ? estado.cuentasPorMarca.length
      ? estado.cuentasPorMarca.map((c) => ({ marca: c.marca, username: c.username, estado: c.estado }))
      : ["casa-tomas", "touza"].map((m) => ({ marca: m, username: estado.cuenta?.username ?? null, estado: estado.cuenta ? "ok" : "falla" }))
    : [];

  return (
    <section
      aria-labelledby={sinTitulo ? undefined : "titulo-conexion-ig"}
      aria-label={sinTitulo ? "Conexión con Instagram" : undefined}
      className={cn("rounded-lg border bg-card p-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        {!sinTitulo && (
          <h3 id="titulo-conexion-ig" className="flex items-center gap-2 text-sm font-medium">
            <PlugZap className="h-4 w-4 text-primary" aria-hidden="true" />
            Conexión con Instagram
          </h3>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => void conexion.comprobar()} disabled={comprobando} className="ml-auto pointer-coarse:min-h-11">
          {comprobando && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
          Comprobar
        </Button>
      </div>

      <div aria-live="polite" className="mt-2 space-y-2 text-sm">
        {comprobando && !estado && <p className="text-muted-foreground">Comprobando la conexión…</p>}
        {error && !comprobando && (
          <div className="space-y-1">
            <p className="flex items-start gap-1.5 text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              No hemos podido comprobar la conexión con Instagram.
            </p>
            <p className="text-xs text-muted-foreground">Vuelve a pulsar «Comprobar» en un rato. Si sigue igual, avisa a Oficiosos.</p>
            <ParaOficiosos>
              <p>{error.texto}</p>
              {error.pasos.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5">
                  {error.pasos.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </ParaOficiosos>
          </div>
        )}
        {estado && (
          <>
            <p className={cn("flex items-start gap-1.5 font-medium", estado.ok ? "text-[#117e39]" : "text-destructive")}>
              {estado.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              {estado.ok ? "Todo listo para publicar." : "Falta algo para poder publicar. Avisa a Oficiosos."}
            </p>
            <ul className="space-y-1" data-testid="cuentas-conexion">
              {cuentas.map((c) => (
                <Linea key={c.marca} estado={c.estado}>
                  <span data-testid={`cuenta-marca-${c.marca}`}>
                    {MARCAS[c.marca as keyof typeof MARCAS]?.nombre ?? c.marca} publica en{" "}
                    {c.username ? <strong>@{c.username}</strong> : <span className="text-muted-foreground">una cuenta sin identificar</span>}
                  </span>
                </Linea>
              ))}
              {estado.cuota && (
                <Linea estado={estadoCuota(estado.cuota.usadas, estado.cuota.total)}>Publicaciones: {textoCuota(estado.cuota)}</Linea>
              )}
              {estado.drive && (
                <Linea estado={estado.drive.ok ? "ok" : "aviso"}>
                  {estado.drive.ok ? "Fotos de Google Drive disponibles" : "Las fotos de Google Drive no están disponibles"}
                </Linea>
              )}
            </ul>
            <ParaOficiosos>
              <ul className="space-y-1" data-testid="variables-conexion">
                <Linea estado={estado.cuenta ? "ok" : "falla"}>
                  Cuenta general: {estado.cuenta ? <strong>@{estado.cuenta.username}</strong> : "sin identificar"}
                </Linea>
                {estado.cuentasPorMarca.map((c) => (
                  <Linea key={c.marca} estado={c.estado}>
                    {MARCAS[c.marca]?.nombre ?? c.marca}: {c.propia ? `cuenta propia (${c.variableIgUserId})` : "cuenta general (IG_USER_ID)"}
                    {c.detalle ? ` · ${c.detalle}` : ""}
                  </Linea>
                ))}
                {[...estado.variables, ...estado.comprobaciones.filter((c) => c.estado !== "ok")].map((v) => (
                  <Linea key={`${v.seccion ?? "var"}-${v.nombre}`} estado={v.estado}>
                    <span className="break-words">
                      {v.seccion ? `${v.seccion} · ` : ""}
                      {v.nombre}
                    </span>
                    {v.detalle && <span> · {v.detalle}</span>}
                  </Linea>
                ))}
                {estado.comprobaciones.some((c) => c.estado === "ok") && (
                  <Linea estado="ok">
                    {(() => {
                      const n = estado.comprobaciones.filter((c) => c.estado === "ok").length;
                      return n === 1 ? "1 comprobación más, bien" : `${n} comprobaciones más, todas bien`;
                    })()}
                  </Linea>
                )}
              </ul>
              {estado.avisos.map((a) => (
                <p key={a} className="flex items-start gap-1.5 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {a}
                </p>
              ))}
              {pasos.length > 0 && (
                <div>
                  <p className="font-medium text-foreground">Cómo arreglarlo</p>
                  <ol className="list-decimal space-y-0.5 pl-5">
                    {pasos.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ol>
                </div>
              )}
              <BloqueDrive drive={estado.drive} />
            </ParaOficiosos>
          </>
        )}
      </div>
    </section>
  );
}
