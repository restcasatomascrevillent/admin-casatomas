import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { llamarContestador, type AjustesContestador as Ajustes, type EstadoContestador } from "@/lib/resenas/contestador";

interface Props {
  ajustes: Ajustes | null | undefined;
  estado: EstadoContestador | null | undefined;
  onCambio: () => void;
}

/** Preferencias del contestador. La respuesta automática va APAGADA por defecto. */
export function AjustesContestadorForm({ ajustes, estado, onCambio }: Props) {
  const [f, setF] = useState<Ajustes | null>(ajustes ?? null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setF(ajustes ?? null), [ajustes]);

  if (!f) {
    return <p className="text-sm text-muted-foreground">Falta aplicar la migración del contestador en este Supabase (20261122143000_resenas_contestador).</p>;
  }
  const cambiar = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => setF({ ...f, [k]: v });
  const estrella = (n: number, on: boolean) =>
    cambiar("autorespuesta_estrellas", (on ? [...f.autorespuesta_estrellas, n] : f.autorespuesta_estrellas.filter((x) => x !== n)).filter((x, i, a) => a.indexOf(x) === i).sort());
  const googleListo = !!estado?.google.conectada && !!estado.google.ubicacion;

  const guardar = async () => {
    setGuardando(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("resenas_ajustes").update({
        proponer_automatico: f.proponer_automatico,
        autorespuesta_activa: f.autorespuesta_activa,
        autorespuesta_estrellas: f.autorespuesta_estrellas,
        autorespuesta_sin_texto: f.autorespuesta_sin_texto,
        firma: f.firma.trim() || "El equipo de Casa Tomás",
        indicaciones: f.indicaciones.trim(),
      }).eq("id", true);
      if (error) throw error;
      toast.success("Ajustes del contestador guardados");
      onCambio();
    } catch (e) {
      toast.error(`No se pudieron guardar: ${mensajeUsuario(e, "inténtalo de nuevo")}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="resenas-ajustes-form">
      <label className="flex items-start justify-between gap-4">
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">Proponer respuesta a las reseñas nuevas</span>
          <span className="block text-xs text-muted-foreground">La IA deja un borrador en cada reseña nueva (dos veces al día). No se publica nada.</span>
        </span>
        <Switch checked={f.proponer_automatico} onCheckedChange={(v) => cambiar("proponer_automatico", v)} aria-label="Proponer respuesta a las reseñas nuevas" />
      </label>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <label className="flex items-start justify-between gap-4">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Responder solas algunas reseñas</span>
            <span className="block text-xs text-muted-foreground">
              Apagado por defecto. Si lo enciendes, la propuesta de la IA se publica en Google sin pasar por ti, solo en las reseñas con las estrellas que marques.
              {!googleListo && " Necesita Google Business Profile conectado."}
            </span>
          </span>
          <Switch checked={f.autorespuesta_activa} onCheckedChange={(v) => cambiar("autorespuesta_activa", v)} aria-label="Responder solas algunas reseñas" />
        </label>
        <fieldset disabled={!f.autorespuesta_activa} className="space-y-2 disabled:opacity-50">
          <legend className="text-xs text-muted-foreground">Estrellas que se responden solas</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {[5, 4, 3, 2, 1].map((n) => (
              <label key={n} className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox checked={f.autorespuesta_estrellas.includes(n)} onCheckedChange={(v) => estrella(n, v === true)} aria-label={`${n} estrellas`} />
                {n} ★
              </label>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox checked={f.autorespuesta_sin_texto} onCheckedChange={(v) => cambiar("autorespuesta_sin_texto", v === true)} />
            También las reseñas sin texto (solo estrellas)
          </label>
        </fieldset>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="resenas-firma">Firma</Label>
          <Input id="resenas-firma" value={f.firma} maxLength={120} onChange={(e) => cambiar("firma", e.target.value)} className="h-11 text-base md:text-sm" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="resenas-indicaciones">Indicaciones para la IA (siempre)</Label>
          <Textarea id="resenas-indicaciones" value={f.indicaciones} maxLength={1500} rows={3} onChange={(e) => cambiar("indicaciones", e.target.value)}
            placeholder="p. ej. Si hablan de la terraza, di que está abierta todo el año. No menciones el aparcamiento." className="text-base md:text-sm" />
        </div>
      </div>
      <Button className="h-11 px-5" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar ajustes"}</Button>
    </div>
  );
}

/** Conexión con Google Business Profile (para publicar respuestas y traer todas las reseñas). */
export function ConexionGoogle({ estado, onCambio }: { estado: EstadoContestador | null | undefined; onCambio: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const g = estado?.google;

  const conectar = async () => {
    setOcupado(true);
    try {
      const r = await llamarContestador<{ url: string }>({ accion: "google_conectar", volver: window.location.origin });
      window.location.href = r.url;
    } catch (e) {
      toast.error(mensajeUsuario(e, "No se pudo iniciar la conexión con Google."));
      setOcupado(false);
    }
  };
  const desconectar = async () => {
    setOcupado(true);
    try {
      await llamarContestador({ accion: "google_desconectar" });
      toast.success("Cuenta de Google desconectada");
      onCambio();
    } catch (e) {
      toast.error(mensajeUsuario(e));
    } finally {
      setOcupado(false);
    }
  };

  if (!estado) return <p className="text-sm text-muted-foreground">Comprobando la conexión…</p>;

  return (
    <div className="space-y-3 text-sm" data-testid="resenas-google">
      {g?.conectada ? (
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Conectada{g.email ? ` con ${g.email}` : ""}
          </p>
          <p className="text-muted-foreground">
            Ficha: {g.ubicacion_nombre ?? g.ubicacion ?? "sin elegir"}
            {g.ultima_sincronizacion ? ` · reseñas leídas ${format(new Date(g.ultima_sincronizacion), "d MMM HH:mm", { locale: es })}` : ""}
          </p>
          {g.ultimo_error && <p className="text-amber-700 dark:text-amber-400">Último aviso de Google: {g.ultimo_error}</p>}
          <Button variant="outline" size="sm" className="h-11 gap-2 px-4" onClick={desconectar} disabled={ocupado}>
            <Unlink className="h-4 w-4" /> Desconectar
          </Button>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground">
            Sin conectar: las respuestas aprobadas se copian y se publican a mano en Google (botón «Copiar y abrir en Google»). Al conectar la cuenta del negocio,
            «Aprobar» las publica directamente y se leen <strong>todas</strong> las reseñas (Google Places solo deja leer las 5 últimas).
          </p>
          {g?.ultimo_error && <p className="text-amber-700 dark:text-amber-400">Último aviso de Google: {g.ultimo_error}</p>}
          <Button className="h-11 gap-2 px-5" onClick={conectar} disabled={ocupado || !g?.configurada}>
            <Link2 className="h-4 w-4" /> Conectar cuenta de Google del negocio
          </Button>
          {!g?.configurada && (
            <ol className="ml-4 list-decimal space-y-1 text-muted-foreground" data-testid="resenas-google-pasos">
              <li>Pide acceso a la API de Google Business Profile (formulario de Google, gratis; tarda unos días).</li>
              <li>En Google Cloud (el proyecto del cliente OAuth de Drive o uno nuevo) habilita «My Business Account Management API», «My Business Business Information API» y «Google My Business API».</li>
              <li>En <em>Credenciales → ID de cliente OAuth (Aplicación web)</em> añade la URI de redirección:
                <code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs">{g?.redirect_uri ?? "https://<proyecto>.supabase.co/functions/v1/resenas-contestador"}</code></li>
              <li>En Supabase → Edge Functions → Secrets crea <code className="rounded bg-muted px-1">GOOGLE_BUSINESS_CLIENT_ID</code> y <code className="rounded bg-muted px-1">GOOGLE_BUSINESS_CLIENT_SECRET</code> (o reutiliza los de Drive).</li>
              <li>Vuelve aquí y pulsa «Conectar», entrando con la cuenta de Google que administra la ficha de Casa Tomás.</li>
            </ol>
          )}
        </>
      )}
    </div>
  );
}
