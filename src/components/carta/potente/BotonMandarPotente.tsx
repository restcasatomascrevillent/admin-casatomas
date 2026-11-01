import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Cpu, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { MAX_BYTES_BRUTO, MS_SONDEO, type TrabajoVideo } from "./colaPendientes";
import { leerMedidaCacheada } from "./dispositivoPotente";
import { activarAvisosPush, permisoNotificaciones, pushDisponible } from "./pushVideo";
import { cancelarTrabajo, mandarAPotente, trabajosVivos } from "./trabajosVideo";

interface Props {
  /** Id del plato ya guardado; sin él (plato nuevo) solo se explica que hay que guardarlo antes. */
  platoId?: string | null;
  /** Fondo elegido para el vídeo. */
  tema: string;
  /** true mientras se procesa aquí (no se puede mandar a la vez). */
  ocupado?: boolean;
  /** Avisa al padre de si hay un vídeo pendiente en otro dispositivo (para ocultar «procesar aquí» si quiere). */
  onPendiente?: (t: TrabajoVideo | null) => void;
}

type Fase =
  | { f: "cargando" }
  | { f: "sin-migracion" }
  | { f: "libre" }
  | { f: "subiendo" }
  | { f: "pendiente"; t: TrabajoVideo }
  | { f: "fallo"; mensaje: string };

/**
 * «Mandar a un dispositivo potente»: sube el vídeo en bruto y crea un trabajo
 * que un PC con WebGPU procesará (AvisoTrabajosVideo). Mientras tanto el
 * plato muestra «Vídeo pendiente». Sin la migración aplicada no se muestra.
 */
export function BotonMandarPotente({ platoId, tema, ocupado, onPendiente }: Props) {
  const { user } = useAuth();
  const [fase, setFase] = useState<Fase>({ f: "cargando" });
  const [aviso, setAviso] = useState<string | null>(null);
  const [permiso, setPermiso] = useState(permisoNotificaciones());
  const entrada = useRef<HTMLInputElement>(null);
  const esPotente = leerMedidaCacheada()?.potente === true;
  const avisarPadre = useRef(onPendiente);
  avisarPadre.current = onPendiente;

  const refrescar = useCallback(async () => {
    if (!platoId) {
      setFase({ f: "libre" });
      return;
    }
    try {
      const r = await trabajosVivos(platoId);
      if (!r.disponible) {
        setFase({ f: "sin-migracion" });
        return;
      }
      const t = r.trabajos[0] ?? null;
      setFase((prev) => (prev.f === "subiendo" ? prev : t ? { f: "pendiente", t } : { f: "libre" }));
    } catch {
      setFase((prev) => (prev.f === "cargando" ? { f: "libre" } : prev));
    }
  }, [platoId]);

  useEffect(() => {
    void refrescar();
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void refrescar();
    }, MS_SONDEO);
    return () => clearInterval(id);
  }, [refrescar]);

  useEffect(() => {
    avisarPadre.current?.(fase.f === "pendiente" ? fase.t : null);
  }, [fase]);

  const activarAvisos = async () => {
    const r = await activarAvisosPush();
    setPermiso(permisoNotificaciones());
    setAviso("motivo" in r ? r.motivo : "Te avisaremos en este dispositivo cuando el vídeo esté listo.");
  };

  const alElegir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo || !platoId || !user) return;
    if (archivo.size > MAX_BYTES_BRUTO) {
      setFase({ f: "fallo", mensaje: `El vídeo pesa ${Math.round(archivo.size / 1048576)} MB; el máximo son ${MAX_BYTES_BRUTO / 1048576} MB. Graba solo 3–4 s.` });
      return;
    }
    setAviso(null);
    setFase({ f: "subiendo" });
    try {
      const t = await mandarAPotente({ platoId, archivo, tema, userId: user.id });
      setFase({ f: "pendiente", t });
      // Con permiso ya concedido, suscribir sin preguntar; si no, se ofrece el botón.
      if (permisoNotificaciones() === "granted") void activarAvisos();
    } catch (err) {
      setFase({ f: "fallo", mensaje: (err as Error)?.message || "No se pudo mandar el vídeo" });
    }
  };

  const cancelar = async (t: TrabajoVideo) => {
    try {
      const ok = await cancelarTrabajo(t);
      if (!ok) setAviso("Ya se está procesando en otro dispositivo; no se puede cancelar.");
      await refrescar();
    } catch (err) {
      setAviso((err as Error)?.message || "No se pudo cancelar");
    }
  };

  if (fase.f === "cargando" || fase.f === "sin-migracion") return null;
  if (!platoId)
    return (
      <p className="text-xs text-muted-foreground">
        Para mandar el vídeo a un dispositivo potente, guarda primero el plato y vuelve a abrirlo.
      </p>
    );

  const push = pushDisponible();

  if (fase.f === "pendiente") {
    const t = fase.t;
    const procesando = t.estado === "procesando";
    return (
      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-700 dark:bg-amber-950/40" aria-live="polite">
        <p className="flex items-center gap-2 font-medium">
          {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
          Vídeo pendiente
        </p>
        <p className="text-xs text-muted-foreground">
          {procesando
            ? `Se está procesando${t.dispositivo_proceso ? ` en ${t.dispositivo_proceso}` : " en otro dispositivo"}.`
            : "Se procesará en el primer ordenador potente que tenga el panel abierto."}{" "}
          Puedes cerrar el panel.
        </p>
        <div className="flex flex-wrap gap-2">
          {"ok" in push && permiso !== "granted" && permiso !== "denied" && (
            <Button type="button" size="sm" variant="outline" onClick={() => void activarAvisos()}>
              <Bell className="mr-1 h-4 w-4" /> Avisarme cuando esté listo
            </Button>
          )}
          {!procesando && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void cancelar(t)}>
              <X className="mr-1 h-4 w-4" /> Cancelar envío
            </Button>
          )}
        </div>
        {"motivo" in push && <p className="text-xs text-muted-foreground">{push.motivo}</p>}
        {permiso === "denied" && (
          <p className="text-xs text-muted-foreground">Las notificaciones están bloqueadas en este navegador; mira el plato más tarde.</p>
        )}
        {aviso && <p className="text-xs">{aviso}</p>}
      </div>
    );
  }

  if (esPotente) return null; // este equipo ya procesa rápido: no tiene sentido mandarlo a otro

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        onClick={() => entrada.current?.click()}
        disabled={ocupado || fase.f === "subiendo" || !user}
      >
        {fase.f === "subiendo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cpu className="mr-2 h-4 w-4" />}
        {fase.f === "subiendo" ? "Subiendo vídeo…" : "Mandar a un dispositivo potente"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Sube el vídeo tal cual (máx. {MAX_BYTES_BRUTO / 1048576} MB) y lo procesa un ordenador con el panel abierto. Más
        rápido y sin gastar batería.
      </p>
      {fase.f === "fallo" && <p className="text-sm text-destructive">{fase.mensaje}</p>}
      {aviso && <p className="text-xs">{aviso}</p>}
      <input ref={entrada} type="file" accept="video/*" className="hidden" onChange={(e) => void alElegir(e)} />
    </div>
  );
}
