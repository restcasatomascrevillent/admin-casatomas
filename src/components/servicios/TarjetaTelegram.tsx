import { useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  chatIdValido,
  type ConfigAvisosTelegram,
  useAvisosTelegram,
  useGuardarAvisosTelegram,
  useProbarTelegram,
} from "@/hooks/useAvisosTelegram";
import { SECCIONES_AVISOS } from "@/lib/avisos";
import { haceCuanto } from "@/lib/servicios";
import { Bloque } from "./Bloque";

const SELECT_CLASE =
  "h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const HORAS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Tipos que se pueden mandar al momento: los de Reservas y Facturas de la página Avisos. */
const TIPOS = [...SECCIONES_AVISOS.reservas.tipos, ...SECCIONES_AVISOS.facturas.tipos];

type Formulario = Omit<ConfigAvisosTelegram, "resumen_ultimo_dia">;

const formularioDe = (c: ConfigAvisosTelegram): Formulario => ({
  activo: c.activo,
  chat_id: c.chat_id ?? "",
  hora_resumen: c.hora_resumen,
  tipos_al_momento: c.tipos_al_momento ?? [],
  silencio_activo: c.silencio_activo,
  silencio_desde: c.silencio_desde,
  silencio_hasta: c.silencio_hasta,
});

function SelectHora({ id, valor, onCambio }: { id: string; valor: number; onCambio: (h: number) => void }) {
  return (
    <select id={id} className={SELECT_CLASE} value={valor} onChange={(e) => onCambio(Number(e.target.value))}>
      {HORAS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
    </select>
  );
}

/**
 * Super Admin › Servicios › Configurar › Telegram (11/11/2026): los avisos del panel por Telegram,
 * al momento (tipos marcados) y en un resumen diario. Lo envía la Edge Function `avisos-telegram`;
 * el token del bot es su secreto TELEGRAM_BOT_TOKEN (no pasa por el panel).
 */
export function TarjetaTelegram() {
  const q = useAvisosTelegram();
  const guardar = useGuardarAvisosTelegram();
  const probar = useProbarTelegram();
  const [form, setForm] = useState<Formulario | null>(null);

  const config = q.data?.disponible ? q.data.config : null;
  useEffect(() => {
    if (config) setForm(formularioDe(config));
  }, [config]);

  const cambiado = useMemo(() => !!form && !!config && JSON.stringify(form) !== JSON.stringify(formularioDe(config)), [form, config]);
  const chatOk = !!form && chatIdValido(form.chat_id ?? "");

  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const alternarTipo = (tipo: string, marcado: boolean) =>
    setForm((f) => (f ? { ...f, tipos_al_momento: marcado ? [...new Set([...f.tipos_al_momento, tipo])] : f.tipos_al_momento.filter((t) => t !== tipo) } : f));

  const onGuardar = async () => {
    if (!form) return;
    if (form.activo && !chatOk) {
      toast.error("Para activarlo hace falta un chat_id válido.");
      return;
    }
    try {
      await guardar.mutateAsync({ ...form, chat_id: form.chat_id?.trim() || null });
      toast.success(form.activo ? "Telegram guardado y activo" : "Telegram guardado (desactivado)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar.");
    }
  };

  const onProbar = async () => {
    const r = await probar.mutateAsync();
    if (r.ok) toast.success("Prueba enviada: mira el chat de Telegram.");
    else toast.error(r.error ?? "No se pudo enviar la prueba.");
  };

  let contenido;
  if (q.isLoading) {
    contenido = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
      </p>
    );
  } else if (q.isError) {
    contenido = <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "No se pudo cargar."}</p>;
  } else if (!q.data?.disponible) {
    contenido = (
      <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Falta aplicar en Supabase la migración 20261126001000_avisos_telegram.
      </p>
    );
  } else if (form) {
    const { ultimoEnvio, ultimoError } = q.data;
    contenido = (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch id="tg-activo" checked={form.activo} onCheckedChange={(v) => set("activo", v)} />
          <Label htmlFor="tg-activo">{form.activo ? "Activado" : "Desactivado"}</Label>
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="tg-chat">chat_id del grupo o chat</Label>
            <Input
              id="tg-chat"
              inputMode="text"
              placeholder="-1001234567890"
              value={form.chat_id ?? ""}
              onChange={(e) => set("chat_id", e.target.value)}
              aria-invalid={!!form.chat_id && !chatOk}
            />
            {!!form.chat_id && !chatOk && <p className="text-xs text-destructive">Un número (los grupos empiezan por -100) o @nombre_del_canal.</p>}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="tg-hora">Resumen diario (hora de Madrid)</Label>
            <SelectHora id="tg-hora" valor={form.hora_resumen} onCambio={(h) => set("hora_resumen", h)} />
          </div>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">Al momento (el resto, solo en el resumen)</legend>
          <div className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2">
            {TIPOS.map((t) => (
              <label key={t.tipo} className="flex min-w-0 items-center gap-2 text-sm">
                <Checkbox
                  checked={form.tipos_al_momento.includes(t.tipo)}
                  onCheckedChange={(v) => alternarTipo(t.tipo, v === true)}
                  aria-label={`${t.etiqueta} al momento`}
                />
                <span className="min-w-0 break-words">{t.etiqueta}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Switch id="tg-silencio" checked={form.silencio_activo} onCheckedChange={(v) => set("silencio_activo", v)} />
          <Label htmlFor="tg-silencio">Silencio nocturno de</Label>
          <SelectHora id="tg-silencio-desde" valor={form.silencio_desde} onCambio={(h) => set("silencio_desde", h)} />
          <Label htmlFor="tg-silencio-hasta">a</Label>
          <SelectHora id="tg-silencio-hasta" valor={form.silencio_hasta} onCambio={(h) => set("silencio_hasta", h)} />
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">Lo que salte en ese tramo espera a que acabe.</p>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void onGuardar()} disabled={!cambiado || guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => void onProbar()} disabled={probar.isPending || !chatOk || cambiado}>
            {probar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Enviar prueba
          </Button>
        </div>

        <dl className="grid min-w-0 gap-1 text-sm" data-testid="tg-estado">
          <div className="flex min-w-0 flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Último envío:</dt>
            <dd>{ultimoEnvio ? `${haceCuanto(ultimoEnvio.enviado_en)} (${ultimoEnvio.tipo})` : "ninguno"}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Último error:</dt>
            <dd className={ultimoError ? "break-words text-destructive" : undefined}>
              {ultimoError ? `${haceCuanto(ultimoError.enviado_en)}: ${ultimoError.error ?? "sin detalle"}` : "ninguno"}
            </dd>
          </div>
        </dl>

        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Cómo montarlo (una vez)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>En Telegram, habla con @BotFather, escribe /newbot y sigue los pasos. Te da un token.</li>
            <li>En Supabase › Edge Functions › Secrets, crea el secreto TELEGRAM_BOT_TOKEN con ese token (en la demo y en producción). No lo pegues aquí.</li>
            <li>Crea un grupo (o usa uno), añade el bot y escribe un mensaje en el grupo.</li>
            <li>Abre https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates y copia el número de «chat» › «id» (en grupos empieza por -100).</li>
            <li>Pégalo arriba como chat_id, guarda, pulsa «Enviar prueba» y, si llega, activa y guarda.</li>
          </ol>
        </details>
      </div>
    );
  }

  return (
    <Bloque
      id="configurar-telegram"
      icono={<Send />}
      titulo="Telegram"
      descripcion="Los avisos del panel en un chat de Telegram: los marcados al momento y todos en un resumen diario."
    >
      {contenido}
    </Bloque>
  );
}
