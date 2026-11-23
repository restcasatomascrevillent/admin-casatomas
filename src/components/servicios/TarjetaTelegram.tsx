import { useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type CampoChat,
  chatIdValido,
  CHATS_CANAL,
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

/** Todos los campos de chat y los que reciben avisos del negocio (Fallos técnicos no cuenta para activar). */
const CAMPOS_CHAT: CampoChat[] = ["chat_id", ...CHATS_CANAL.map((c) => c.campo)];
const CAMPOS_NEGOCIO: CampoChat[] = ["chat_id", "chat_reservas", "chat_facturas", "chat_resumenes"];

type Formulario = Omit<ConfigAvisosTelegram, "resumen_ultimo_dia">;

const formularioDe = (c: ConfigAvisosTelegram): Formulario => ({
  activo: c.activo,
  chat_id: c.chat_id ?? "",
  chat_reservas: c.chat_reservas ?? "",
  chat_facturas: c.chat_facturas ?? "",
  chat_resumenes: c.chat_resumenes ?? "",
  chat_fallos: c.chat_fallos ?? "",
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

function CampoChatTelegram({ id, etiqueta, ayuda, valor, onCambio }: { id: string; etiqueta: string; ayuda: string; valor: string; onCambio: (v: string) => void }) {
  const mal = !!valor.trim() && !chatIdValido(valor);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        inputMode="text"
        placeholder="-1001234567890"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        aria-invalid={mal}
        aria-describedby={`${id}-ayuda`}
      />
      <p id={`${id}-ayuda`} className={mal ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {mal ? "Un número (los grupos empiezan por -100) o @nombre_del_canal." : ayuda}
      </p>
    </div>
  );
}

/**
 * Super Admin › Servicios › Configurar › Telegram (11/11/2026): los avisos del panel por Telegram.
 * 22/11/2026: un chat por canal (Reservas, Facturas y márgenes, Resúmenes y Fallos técnicos) para que uno no
 * se llene con lo de otro; los que se dejan vacíos usan el chat general, salvo Fallos técnicos (no se envían).
 * Lo envía la Edge Function `avisos-telegram`; el token del bot es su secreto TELEGRAM_BOT_TOKEN (no pasa por el panel).
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
  const valido = (c: CampoChat) => !!form && chatIdValido(form[c] ?? "");
  const chatsMal = form ? CAMPOS_CHAT.filter((c) => (form[c] ?? "").trim() && !chatIdValido(form[c] ?? "")) : [];
  const hayChat = CAMPOS_CHAT.some(valido);
  const hayChatNegocio = CAMPOS_NEGOCIO.some(valido);

  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const alternarTipo = (tipo: string, marcado: boolean) =>
    setForm((f) => (f ? { ...f, tipos_al_momento: marcado ? [...new Set([...f.tipos_al_momento, tipo])] : f.tipos_al_momento.filter((t) => t !== tipo) } : f));

  const onGuardar = async () => {
    if (!form) return;
    if (chatsMal.length) {
      toast.error("Algún chat no es válido: un número (los grupos empiezan por -100) o @nombre_del_canal.");
      return;
    }
    if (form.activo && !hayChatNegocio) {
      toast.error("Para activarlo hace falta al menos un chat válido (el general o el de un canal).");
      return;
    }
    const chats = Object.fromEntries(CAMPOS_CHAT.map((c) => [c, form[c]?.trim() || null])) as Pick<Formulario, CampoChat>;
    try {
      await guardar.mutateAsync({ ...form, ...chats });
      toast.success(form.activo ? "Telegram guardado y activo" : "Telegram guardado (desactivado)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar.");
    }
  };

  const onProbar = async () => {
    const r = await probar.mutateAsync();
    const n = r.resultados?.length ?? 1;
    if (r.ok) toast.success(n > 1 ? `Prueba enviada a ${n} chats: mira Telegram.` : "Prueba enviada: mira el chat de Telegram.");
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
        Falta aplicar en Supabase la migración {q.data && "migracion" in q.data ? q.data.migracion : "20261126001000_avisos_telegram"}.
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

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-foreground">Chats (uno por canal, para que no se mezclen)</legend>
          <CampoChatTelegram
            id="tg-chat"
            etiqueta="Chat general"
            ayuda="Para los canales que no tengan el suyo (menos Fallos técnicos)."
            valor={form.chat_id ?? ""}
            onCambio={(v) => set("chat_id", v)}
          />
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {CHATS_CANAL.map((c) => (
              <CampoChatTelegram
                key={c.campo}
                id={`tg-${c.campo}`}
                etiqueta={`Chat de ${c.etiqueta}`}
                ayuda={c.ayuda}
                valor={form[c.campo] ?? ""}
                onCambio={(v) => set(c.campo, v)}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="tg-hora">Resumen diario (hora de Madrid)</Label>
          <SelectHora id="tg-hora" valor={form.hora_resumen} onCambio={(h) => set("hora_resumen", h)} />
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
        <p className="-mt-2 text-xs text-muted-foreground">Lo que salte en ese tramo espera a que acabe (los fallos técnicos, no).</p>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void onGuardar()} disabled={!cambiado || guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => void onProbar()} disabled={probar.isPending || !hayChat || chatsMal.length > 0 || cambiado}>
            {probar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Enviar prueba a cada chat
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
            <li>Crea un grupo por canal (Reservas, Facturas y márgenes, Resúmenes y, para desarrolladores, Fallos técnicos), añade el bot a cada uno y escribe un mensaje en cada grupo.</li>
            <li>Abre https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates y copia el número de «chat» › «id» de cada grupo (en grupos empieza por -100).</li>
            <li>Pega cada uno en su canal (los que dejes vacíos usan el chat general), guarda, pulsa «Enviar prueba a cada chat» y, si llega a todos, activa y guarda.</li>
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
      descripcion="Los avisos del panel por Telegram, cada canal en su chat: reservas y facturas al momento, resúmenes y fallos técnicos."
    >
      {contenido}
    </Bloque>
  );
}
