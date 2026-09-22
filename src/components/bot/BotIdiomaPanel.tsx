import { Bot, Loader2, MessageSquare, Save, Search, Utensils, Wine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import type { DraftBotWeb, IdiomaBotWeb } from "@/hooks/useConfigBotWeb";
import type { Plato } from "@/hooks/usePlatos";
import type { Vino } from "@/hooks/useVinos";
import { CampoExplicado } from "./CampoExplicado";
import { AvisoHorarioContacto } from "./AvisoHorarioContacto";
import { VistaPreviaBot } from "./VistaPreviaBot";
import { EstadoGuardadoBadge } from "./EstadoGuardadoBadge";
import { TONO_OPTIONS, combinarConInstruccionesEspañol } from "./constantesBot";

interface BotIdiomaPanelProps {
  idioma: IdiomaBotWeb;
  draft: DraftBotWeb;
  draftEspañol: DraftBotWeb;
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  onChange: (patch: Partial<DraftBotWeb>) => void;
  onTogglePlato: (nombre: string) => void;
  onToggleVino: (nombre: string) => void;
  onSave: () => void;
  platosPorCategoria: Record<string, Plato[]>;
  vinosPorCategoria: Record<string, Vino[]>;
  loadingPlatos: boolean;
  loadingVinos: boolean;
  buscarPlato: string;
  buscarVino: string;
  onBuscarPlatoChange: (v: string) => void;
  onBuscarVinoChange: (v: string) => void;
}

export function BotIdiomaPanel({
  idioma,
  draft,
  draftEspañol,
  canEdit,
  dirty,
  saving,
  saveError,
  onChange,
  onTogglePlato,
  onToggleVino,
  onSave,
  platosPorCategoria,
  vinosPorCategoria,
  loadingPlatos,
  loadingVinos,
  buscarPlato,
  buscarVino,
  onBuscarPlatoChange,
  onBuscarVinoChange,
}: BotIdiomaPanelProps) {
  const tonoOptions = TONO_OPTIONS[idioma];

  return (
    <div className="space-y-6">
      <AvisoHorarioContacto
        idioma={idioma}
        texto={draft.instrucciones_extra}
        textoEspañol={draftEspañol.instrucciones_extra}
        canEdit={canEdit}
        onCopiarDesdeEspañol={() =>
          onChange({ instrucciones_extra: combinarConInstruccionesEspañol(draft.instrucciones_extra, draftEspañol.instrucciones_extra) })
        }
      />

      {/* Tono */}
      <CampoExplicado
        icono={<Bot className="h-5 w-5" />}
        pregunta="¿Cómo quieres que hable el bot?"
        explicacion="Se inserta literalmente en las instrucciones del bot para este idioma — cambia CÓMO suena, no lo que sabe ni lo que puede hacer."
        ejemplo={
          <>
            con "Divertido" un aviso de que no hay mesa libre puede sonar a "Uy, hoy nos lo ponéis difícil…"; con
            "Formal" sonará más a "Lamentamos informarle de que no hay disponibilidad".
          </>
        }
      >
        <ToggleGroup
          type="single"
          value={draft.tono}
          onValueChange={(val) => val && canEdit && onChange({ tono: val })}
          className="flex flex-wrap gap-2"
        >
          {tonoOptions.map((t) => (
            <ToggleGroupItem
              key={t.value}
              value={t.value}
              disabled={!canEdit}
              className="flex flex-col items-start gap-1 h-auto py-3 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-xs opacity-70">{t.desc}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CampoExplicado>

      {/* Mensaje de bienvenida */}
      <CampoExplicado
        icono={<MessageSquare className="h-5 w-5" />}
        pregunta="¿Qué dice el bot al saludar?"
        explicacion="Sugerencia para el primer mensaje de cada conversación nueva en este idioma."
        ejemplo={
          <>
            no se envía tal cual: el bot ya calcula su propio "Buenos días / Buenas tardes / Buenas noches" según
            la hora — esto se le da como lo que debería decir justo después de saludar.
          </>
        }
      >
        <Textarea
          value={draft.mensaje_bienvenida}
          onChange={(e) => onChange({ mensaje_bienvenida: e.target.value })}
          placeholder="¡Hola! Soy el asistente virtual de Casa Tomás. ¿En qué puedo ayudarte?"
          rows={2}
          disabled={!canEdit}
        />
      </CampoExplicado>

      {/* Platos a recomendar */}
      <CampoExplicado
        icono={<Utensils className="h-5 w-5" />}
        pregunta="¿Qué platos debe recomendar?"
        explicacion={`Los platos que el bot priorizará cuando un cliente pida sugerencias.${
          draft.platos.length ? ` (${draft.platos.length} seleccionados)` : ""
        }`}
        ejemplo={
          <>
            es solo una prioridad DENTRO de lo que sigue activo en Gestor Carta: si marcas un plato aquí pero lo
            desactivas allí, el bot deja de poder mencionarlo — nunca inventa platos que no existan en la carta
            real.
          </>
        }
      >
        {draft.platos.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2 border-b">
            {draft.platos.map((nombre) => (
              <span
                key={nombre}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
              >
                {nombre}
                {canEdit && (
                  <button type="button" onClick={() => onTogglePlato(nombre)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar platos..."
            value={buscarPlato}
            onChange={(e) => onBuscarPlatoChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-64 overflow-y-auto space-y-3 border rounded-md p-3">
          {loadingPlatos ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : Object.keys(platosPorCategoria).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No se encontraron platos</p>
          ) : (
            Object.entries(platosPorCategoria).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
                <div className="space-y-1">
                  {items.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={draft.platos.includes(p.nombre || "")}
                        onCheckedChange={() => onTogglePlato(p.nombre || "")}
                        disabled={!canEdit}
                      />
                      <span className="text-sm flex-1">{p.nombre}</span>
                      {p.precio_eur != null && (
                        <span className="text-xs text-muted-foreground">{p.precio_eur.toFixed(2)}€</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </CampoExplicado>

      {/* Vinos a recomendar */}
      <CampoExplicado
        icono={<Wine className="h-5 w-5" />}
        pregunta="¿Qué vinos debe recomendar?"
        explicacion={`Los vinos que el bot priorizará cuando un cliente pida sugerencias.${
          draft.vinos.length ? ` (${draft.vinos.length} seleccionados)` : ""
        }`}
        ejemplo={<>igual que con los platos: es prioridad dentro de los vinos activos en Gestor Carta, nunca una lista cerrada ni inventada.</>}
      >
        {draft.vinos.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2 border-b">
            {draft.vinos.map((nombre) => (
              <span
                key={nombre}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
              >
                {nombre}
                {canEdit && (
                  <button type="button" onClick={() => onToggleVino(nombre)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar vinos..."
            value={buscarVino}
            onChange={(e) => onBuscarVinoChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-64 overflow-y-auto space-y-3 border rounded-md p-3">
          {loadingVinos ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : Object.keys(vinosPorCategoria).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No se encontraron vinos</p>
          ) : (
            Object.entries(vinosPorCategoria).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
                <div className="space-y-1">
                  {items.map((v) => (
                    <label
                      key={v.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={draft.vinos.includes(v.nombre || "")}
                        onCheckedChange={() => onToggleVino(v.nombre || "")}
                        disabled={!canEdit}
                      />
                      <span className="text-sm flex-1">{v.nombre}</span>
                      {v.precio_eur != null && (
                        <span className="text-xs text-muted-foreground">{v.precio_eur.toFixed(2)}€</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </CampoExplicado>

      {/* Instrucciones extra */}
      <CampoExplicado
        pregunta="¿Algo más que deba saber el bot?"
        explicacion="Instrucciones libres en lenguaje natural. Es el ÚNICO sitio del que el bot saca horarios, dirección, teléfono, política de reservas, alérgenos especiales o cualquier otro dato que no esté en la carta."
        ejemplo={<>el bot las cumple literalmente (regla del prompt: "si hay instrucciones extra, cúmplelas al pie de la letra") — a diferencia del tono, esto sí se traslada tal cual.</>}
      >
        <Textarea
          value={draft.instrucciones_extra}
          onChange={(e) => onChange({ instrucciones_extra: e.target.value })}
          placeholder={"Ej:\n- Horario: martes a jueves 09:30-23:00, viernes 09:00-23:30...\n- Teléfono: 966 10 78 87\n- Dirección: Carrer Santa Maria de la Cabeza 2, Crevillent\n- No se admiten reservas por la web, solo por teléfono"}
          rows={6}
          disabled={!canEdit}
        />
      </CampoExplicado>

      {/* Frases personalizadas */}
      <CampoExplicado
        pregunta="¿Alguna frase o coletilla que quieras que use?"
        explicacion="Frases de referencia que el bot puede recoger cuando venga a cuento."
        ejemplo={<>a diferencia de "Instrucciones extra", el prompt no obliga a usarlas siempre — trátalas como inspiración de estilo, no como un guion que se repita en cada respuesta.</>}
      >
        <Textarea
          value={draft.frases_personalizadas}
          onChange={(e) => onChange({ frases_personalizadas: e.target.value })}
          placeholder={"Ej:\n- ¡Que aproveche!\n- Te esperamos con los brazos abiertos"}
          rows={3}
          disabled={!canEdit}
        />
      </CampoExplicado>

      <VistaPreviaBot idioma={idioma} draft={draft} />

      {/* Barra de guardado — honesta: nunca dice "guardado" hasta que Supabase lo confirma. */}
      {canEdit && (
        <div className="flex items-center justify-end gap-3 pb-6 sticky bottom-0 bg-background/95 backdrop-blur py-3 border-t">
          <EstadoGuardadoBadge dirty={dirty} saving={saving} error={saveError} />
          <Button size="lg" onClick={onSave} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Guardar cambios en {idioma.toUpperCase()}
          </Button>
        </div>
      )}
    </div>
  );
}
