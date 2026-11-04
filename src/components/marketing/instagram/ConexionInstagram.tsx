import { useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { comprobarConexion, ErrorInstagram, textoError, type Cuota, type EstadoDrive, type RespuestaEstado } from "./api";

/**
 * «Conexión con Instagram»: llama a la Edge Function instagram-estado y enseña ✔/✖/⚠ por
 * variable, la cuenta y el cupo, con «Cómo arreglarlo». Debajo, Google Drive
 * (donde se archivan las fotos y las piezas publicadas): secretos, permiso
 * (alcance) del token y si la carpeta «marketing» se ve y se puede escribir.
 * La función nunca devuelve valores secretos: aquí solo se pintan nombre,
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
}

export function ConexionInstagram({ onEstado, className }: Props) {
  const [cargando, setCargando] = useState(false);
  const [estado, setEstado] = useState<RespuestaEstado | null>(null);
  const [error, setError] = useState<{ texto: string; pasos: string[] } | null>(null);

  const comprobar = async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await comprobarConexion();
      setEstado(r);
      onEstado?.(r);
    } catch (e) {
      const pasos = e instanceof ErrorInstagram && e.comoArreglarlo ? [e.comoArreglarlo].flat() : [];
      setError({ texto: textoError(e), pasos });
      setEstado(null);
    } finally {
      setCargando(false);
    }
  };

  const pasos = estado?.comoArreglarlo ?? [];

  return (
    <section aria-labelledby="titulo-conexion-ig" className={cn("rounded-lg border bg-card p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 id="titulo-conexion-ig" className="flex items-center gap-2 text-sm font-medium">
          <PlugZap className="h-4 w-4 text-primary" aria-hidden="true" />
          Conexión con Instagram
        </h3>
        <Button type="button" size="sm" variant="outline" onClick={comprobar} disabled={cargando} className="pointer-coarse:min-h-11">
          {cargando && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
          Comprobar
        </Button>
      </div>

      <div aria-live="polite" className="mt-2 space-y-2 text-xs">
        {!estado && !error && !cargando && (
          <p className="text-muted-foreground">Pulsa «Comprobar» para ver si la cuenta está bien enlazada.</p>
        )}
        {error && (
          <div className="space-y-1">
            <p className="flex items-start gap-1.5 text-destructive">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {error.texto}
            </p>
            {error.pasos.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {error.pasos.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
        )}
        {estado && (
          <>
            <p className={cn("font-medium", estado.ok ? "text-emerald-700" : "text-destructive")}>
              {estado.ok ? "Todo listo para publicar." : "Falta algo para poder publicar."}
            </p>
            <ul className="space-y-1" data-testid="variables-conexion">
              <Linea estado={estado.cuenta ? "ok" : "falla"}>
                Cuenta: {estado.cuenta ? <strong>@{estado.cuenta.username}</strong> : <span className="text-muted-foreground">sin identificar</span>}
              </Linea>
              {estado.cuota && (
                <Linea estado={estadoCuota(estado.cuota.usadas, estado.cuota.total)}>
                  Publicaciones: {textoCuota(estado.cuota)}
                </Linea>
              )}
              {[...estado.variables, ...estado.comprobaciones.filter((c) => c.estado !== "ok")].map((v) => (
                <Linea key={`${v.seccion ?? "var"}-${v.nombre}`} estado={v.estado}>
                  <span className="break-words">{v.seccion ? `${v.seccion} · ` : ""}{v.nombre}</span>
                  {v.detalle && <span className="text-muted-foreground"> · {v.detalle}</span>}
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
              <p key={a} className="flex items-start gap-1.5 text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {a}
              </p>
            ))}
            {pasos.length > 0 && (
              <div>
                <p className="font-medium">Cómo arreglarlo</p>
                <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                  {pasos.map((p) => <li key={p}>{p}</li>)}
                </ol>
              </div>
            )}
            <BloqueDrive drive={estado.drive} />
          </>
        )}
      </div>
    </section>
  );
}
