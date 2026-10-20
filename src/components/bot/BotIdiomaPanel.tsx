import { Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { DraftBotWeb } from "@/hooks/useConfigBotWeb";
import type { Plato } from "@/hooks/usePlatos";
import type { Vino } from "@/hooks/useVinos";
import { CampoExplicado } from "./CampoExplicado";
import { SeccionBot } from "./SeccionBot";
import { SelectorCartaBot } from "./SelectorCartaBot";
import { AvisoHorarioContacto } from "./AvisoHorarioContacto";
import { MAX_INSTRUCCIONES_EXTRA, TONO_OPTIONS, TONOS_UI } from "./constantesBot";

interface BotIdiomaPanelProps {
  draft: DraftBotWeb;
  canEdit: boolean;
  onChange: (patch: Partial<DraftBotWeb>) => void;
  onTogglePlato: (nombre: string) => void;
  onToggleVino: (nombre: string) => void;
  platosPorCategoria: Record<string, Plato[]>;
  vinosPorCategoria: Record<string, Vino[]>;
  loadingPlatos: boolean;
  loadingVinos: boolean;
  buscarPlato: string;
  buscarVino: string;
  onBuscarPlatoChange: (v: string) => void;
  onBuscarVinoChange: (v: string) => void;
}

// Formulario del bot en ESPAÑOL (el único idioma que se edita a mano: EN y
// FR se traducen solos al guardar, ver useTraduccionBotWeb). El guardado
// vive en la barra superior de TabBotWeb; aquí solo se edita el borrador.
export function BotIdiomaPanel({
  draft,
  canEdit,
  onChange,
  onTogglePlato,
  onToggleVino,
  platosPorCategoria,
  vinosPorCategoria,
  loadingPlatos,
  loadingVinos,
  buscarPlato,
  buscarVino,
  onBuscarPlatoChange,
  onBuscarVinoChange,
}: BotIdiomaPanelProps) {
  const tonoOptions = TONO_OPTIONS.es;
  const tonoConocido = tonoOptions.some((t) => t.value === draft.tono);
  const ids = {
    bienvenida: "bot-es-bienvenida",
    frases: "bot-es-frases",
    instrucciones: "bot-es-instrucciones",
    tono: "bot-es-tono",
    contador: "bot-es-instrucciones-contador",
  };
  const largoInstrucciones = draft.instrucciones_extra.length;
  const instruccionesExcedidas = largoInstrucciones > MAX_INSTRUCCIONES_EXTRA;

  return (
    <div className="space-y-4">
      <SeccionBot titulo="Personalidad" descripcion="Cómo suena el bot. No cambia lo que sabe ni lo que puede hacer.">
        <CampoExplicado
          etiqueta="Tono"
          efecto={
            <>
              Se inserta en las instrucciones del bot (en inglés y francés, con su equivalente: "Divertido" → "fun" /
              "amusant"). Con "Divertido", un aviso de que no hay mesa puede sonar a "Uy, hoy nos lo ponéis difícil…";
              con "Formal", a "Lamentamos informarle de que no hay disponibilidad".
            </>
          }
        >
          <RadioGroup
            value={tonoConocido ? draft.tono : ""}
            onValueChange={(val) => canEdit && onChange({ tono: val })}
            disabled={!canEdit}
            aria-label="Tono del bot"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
          >
            {tonoOptions.map((t, idx) => {
              const ui = TONOS_UI[idx] ?? { label: t.label, desc: t.desc };
              const seleccionado = draft.tono === t.value;
              const itemId = `${ids.tono}-${t.value}`;
              return (
                <label
                  key={t.value}
                  htmlFor={itemId}
                  className={cn(
                    "relative flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/40",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    seleccionado && "border-primary bg-primary/5 hover:bg-primary/5",
                    !canEdit && "cursor-not-allowed opacity-60",
                  )}
                >
                  <RadioGroupItem id={itemId} value={t.value} className="mt-0.5 focus-visible:ring-0 focus-visible:ring-offset-0" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-sm font-medium leading-none">{ui.label}</span>
                    <span className="block text-xs text-muted-foreground">{ui.desc}</span>
                  </span>
                  {seleccionado && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </label>
              );
            })}
          </RadioGroup>
          {!tonoConocido && draft.tono && (
            <p className="text-xs text-muted-foreground">
              Valor actual personalizado: <span className="font-mono">{draft.tono}</span>. Elige una opción para
              sustituirlo.
            </p>
          )}
        </CampoExplicado>
      </SeccionBot>

      <SeccionBot titulo="Mensajes" descripcion="Qué dice el bot al empezar y qué frases puede usar.">
        <CampoExplicado
          htmlFor={ids.bienvenida}
          etiqueta="Mensaje de bienvenida"
          ayuda="Lo que dice justo después de saludar en una conversación nueva."
          efecto={
            <>
              No se envía tal cual: el bot ya calcula su propio "Buenos días / Buenas tardes / Buenas noches" según la
              hora, y esto es lo que debería decir justo después.
            </>
          }
        >
          <Textarea
            id={ids.bienvenida}
            value={draft.mensaje_bienvenida}
            onChange={(e) => onChange({ mensaje_bienvenida: e.target.value })}
            placeholder="¡Hola! Soy el asistente virtual de Casa Tomás. ¿En qué puedo ayudarte?"
            rows={2}
            disabled={!canEdit}
          />
        </CampoExplicado>

        <CampoExplicado
          htmlFor={ids.frases}
          etiqueta="Frases personalizadas"
          ayuda="Frases de referencia que puede usar cuando vengan a cuento."
          efecto={
            <>
              A diferencia de "Instrucciones extra", el bot no está obligado a usarlas: son inspiración de estilo, no un
              guion que se repita en cada respuesta.
            </>
          }
        >
          <Textarea
            id={ids.frases}
            value={draft.frases_personalizadas}
            onChange={(e) => onChange({ frases_personalizadas: e.target.value })}
            placeholder={"Ej.:\n- ¡Que aproveche!\n- Te esperamos con los brazos abiertos"}
            rows={3}
            disabled={!canEdit}
          />
        </CampoExplicado>
      </SeccionBot>

      <SeccionBot
        titulo="Conocimiento"
        descripcion="Datos que el bot no tiene por su cuenta: horario, contacto, dirección, política de reservas…"
      >
        <CampoExplicado
          htmlFor={ids.instrucciones}
          etiqueta="Instrucciones extra"
          ayuda="Texto libre en lenguaje natural. Es el único sitio del que el bot saca datos que no están en la carta."
          accesorio={
            <span
              id={ids.contador}
              className={cn(
                "text-xs tabular-nums",
                instruccionesExcedidas ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              {largoInstrucciones.toLocaleString("es-ES")} / {MAX_INSTRUCCIONES_EXTRA.toLocaleString("es-ES")}
              <span className="sr-only"> caracteres</span>
              {instruccionesExcedidas && <span className="sr-only">. Excede el máximo, recórtalo antes de guardar.</span>}
            </span>
          }
          efecto={
            <>
              El bot las cumple al pie de la letra (regla del prompt: "si hay instrucciones extra, cúmplelas al pie de la
              letra"). Se traduce automáticamente a inglés y francés al guardar, conservando horas, teléfonos y
              direcciones tal cual.
            </>
          }
        >
          <AvisoHorarioContacto texto={draft.instrucciones_extra} />
          <Textarea
            id={ids.instrucciones}
            value={draft.instrucciones_extra}
            onChange={(e) => onChange({ instrucciones_extra: e.target.value })}
            maxLength={MAX_INSTRUCCIONES_EXTRA}
            aria-describedby={ids.contador}
            aria-invalid={instruccionesExcedidas || undefined}
            placeholder={
              "Ej.:\n- Horario: martes a jueves 09:30-23:00, viernes 09:00-23:30…\n- Teléfono: 966 10 78 87\n- Dirección: Carrer Santa Maria de la Cabeza 2, Crevillent\n- No se admiten reservas por la web, solo por teléfono"
            }
            rows={7}
            disabled={!canEdit}
          />
        </CampoExplicado>
      </SeccionBot>

      <SeccionBot
        titulo="Recomendaciones"
        descripcion="Lo que el bot prioriza cuando un cliente pide sugerencias. Solo cuenta lo que siga activo en la Carta."
      >
        <div className="grid gap-5 lg:grid-cols-2 lg:gap-4">
          <CampoExplicado
            etiqueta="Platos"
            accesorio={
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.platos.length} seleccionado{draft.platos.length === 1 ? "" : "s"}
              </span>
            }
            efecto={
              <>
                Es una prioridad dentro de lo activo en la pestaña Carta: si desactivas allí un plato marcado aquí, el bot
                deja de mencionarlo. Nunca inventa platos que no estén en la carta real.
              </>
            }
          >
            <SelectorCartaBot
              tipo="platos"
              seleccionados={draft.platos}
              porCategoria={platosPorCategoria}
              loading={loadingPlatos}
              buscar={buscarPlato}
              onBuscarChange={onBuscarPlatoChange}
              onToggle={onTogglePlato}
              canEdit={canEdit}
            />
          </CampoExplicado>

          <CampoExplicado
            etiqueta="Vinos"
            accesorio={
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.vinos.length} seleccionado{draft.vinos.length === 1 ? "" : "s"}
              </span>
            }
            efecto={<>Igual que con los platos: prioridad dentro de los vinos activos en la Carta, nunca una lista cerrada.</>}
          >
            <SelectorCartaBot
              tipo="vinos"
              seleccionados={draft.vinos}
              porCategoria={vinosPorCategoria}
              loading={loadingVinos}
              buscar={buscarVino}
              onBuscarChange={onBuscarVinoChange}
              onToggle={onToggleVino}
              canEdit={canEdit}
            />
          </CampoExplicado>
        </div>
      </SeccionBot>
    </div>
  );
}
