// ============================================================================
// PlantillaTipoEditor — el formulario completo de UNA plantilla (un tipo):
// carga la versión actual, deja editar los campos de texto/color/bloques con
// ayuda de tokens, vista previa en vivo (VistaPreviaEmail), guardar como
// versión nueva (useGuardarPlantilla), historial + restaurar
// (HistorialVersionesPlantilla) y enviar una prueba
// (useEnviarPruebaPlantilla). No sabe nada de los otros 4 tipos ni de
// permisos globales — quien decide la pestaña activa y si `puedeEditar` es
// EditorPlantillasEmail.
//
// Solo texto plano con tokens {{...}}: nunca se ofrece un editor de HTML
// libre (ver la cabecera de supabase/functions/emails-reserva/plantillas.ts
// — es una decisión deliberada del contrato, no un descuido de esta
// pantalla).
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Save, Send, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  useVersionesPlantilla,
  useGuardarPlantilla,
  useEnviarPruebaPlantilla,
  type TipoPlantilla,
  type CamposEditablesPlantilla,
  type PlantillaEmailVersion,
} from "@/hooks/usePlantillasEmail";
import { DESCRIPCION_TIPO, ETIQUETA_TIPO, BLOQUES_DISPONIBLES, leerBloque } from "./catalogoTokens";
import { VistaPreviaEmail } from "./VistaPreviaEmail";
import { SelectorVariable } from "./SelectorVariable";
import { HistorialVersionesPlantilla } from "./HistorialVersionesPlantilla";
import { CampoColorMarca } from "./CampoColorMarca";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto del editor: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_EDITOR = 360;

const CAMPOS_VACIOS: CamposEditablesPlantilla = {
  asunto: "",
  saludo: "",
  cuerpo: "",
  texto_boton_principal: null,
  texto_boton_secundario: null,
  pie: null,
  color_acento: "#B8936A",
  color_oscuro: "#1C1F22",
  logo_url: null,
  bloques: {},
};

function extraerCampos(v: PlantillaEmailVersion): CamposEditablesPlantilla {
  return {
    asunto: v.asunto,
    saludo: v.saludo,
    cuerpo: v.cuerpo,
    texto_boton_principal: v.texto_boton_principal,
    texto_boton_secundario: v.texto_boton_secundario,
    pie: v.pie,
    color_acento: v.color_acento,
    color_oscuro: v.color_oscuro,
    logo_url: v.logo_url,
    bloques: v.bloques,
  };
}

// --- Campo de texto reutilizable: Label + SelectorVariable + Input/Textarea ---

interface CampoBaseProps {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
  opcional?: boolean;
  ayuda?: string;
}

/** Refs concretos (no la unión que exige SelectorVariable) para no necesitar casts al pasarlos al <input>/<textarea> real. */
function CampoInput({ id, etiqueta, valor, onChange, disabled, opcional, ayuda }: CampoBaseProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {etiqueta}
          {opcional && <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>}
        </Label>
        {!disabled && <SelectorVariable targetRef={ref} valor={valor} onChange={onChange} />}
      </div>
      <Input id={id} ref={ref} value={valor} onChange={(e) => onChange(e.target.value)} readOnly={disabled} className="h-11 text-base md:text-base" />
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

function CampoTextarea({ id, etiqueta, valor, onChange, disabled, opcional, ayuda }: CampoBaseProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {etiqueta}
          {opcional && <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>}
        </Label>
        {!disabled && <SelectorVariable targetRef={ref} valor={valor} onChange={onChange} />}
      </div>
      <Textarea id={id} ref={ref} value={valor} onChange={(e) => onChange(e.target.value)} readOnly={disabled} rows={5} className="text-base md:text-base" />
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

interface PlantillaTipoEditorProps {
  tipo: TipoPlantilla;
  puedeEditar: boolean;
  emailUsuario: string;
}

export function PlantillaTipoEditor({ tipo, puedeEditar, emailUsuario }: PlantillaTipoEditorProps) {
  const { data: versiones, isLoading, isError, error, refetch } = useVersionesPlantilla(tipo);
  const guardar = useGuardarPlantilla(tipo);
  const enviarPrueba = useEnviarPruebaPlantilla(tipo);

  const versionActual = useMemo<PlantillaEmailVersion | null>(
    () => versiones?.find((v) => v.es_actual) ?? versiones?.[0] ?? null,
    [versiones],
  );

  const [campos, setCampos] = useState<CamposEditablesPlantilla>(CAMPOS_VACIOS);
  const [guardado, setGuardado] = useState<CamposEditablesPlantilla>(CAMPOS_VACIOS);
  const [notaVersion, setNotaVersion] = useState("");
  const [destinatario, setDestinatario] = useState(emailUsuario);
  // Cerrada por defecto: la marca (colores + logo) se configura una vez y
  // no debería competir por espacio con el contenido, que se edita a diario.
  const [marcaAbierta, setMarcaAbierta] = useState(false);
  // Por debajo de 1280 px la vista previa no cabe al lado del formulario (con el
  // menú lateral quedan ~430 px para el formulario y ~280 para la vista): va en un
  // desplegable encima del formulario, cerrado por defecto.
  const [vistaPreviaAbierta, setVistaPreviaAbierta] = useState(false);
  // Alto de la pantalla (regla del dueño, 2026-10-07): el editor mide lo que
  // queda hasta el fondo del viewport; la cabecera (versión + historial) queda
  // fija y el resto hace scroll en su región. Sin medida (jsdom, primer
  // pintado) cae al layout de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_EDITOR);

  // Se re-sincroniza SOLO cuando cambia de verdad la versión actual cargada
  // (carga inicial, guardado nuevo o restauración) — nunca en cada tecla que
  // pulsa el usuario mientras edita.
  useEffect(() => {
    const base = versionActual ? extraerCampos(versionActual) : CAMPOS_VACIOS;
    setCampos(base);
    setGuardado(base);
    setNotaVersion("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionActual?.id]);

  const actualizarCampo = <K extends keyof CamposEditablesPlantilla>(clave: K, valor: CamposEditablesPlantilla[K]) => {
    setCampos((prev) => ({ ...prev, [clave]: valor }));
  };

  const sucio = JSON.stringify(campos) !== JSON.stringify(guardado);

  const handleGuardar = () => {
    guardar.mutate(
      { campos, notaVersion, versionBase: versionActual?.version ?? 0 },
      { onSuccess: () => setNotaVersion("") },
    );
  };

  const handleEnviarPrueba = () => {
    if (!destinatario.trim()) {
      toast.error("Escribe una dirección de correo para la prueba");
      return;
    }
    enviarPrueba.mutate({ destinatario: destinatario.trim(), plantilla: campos });
  };

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Cargando plantilla...</div>;
  }

  if (isError) {
    return (
      <EstadoErrorCarga
        titulo={`la plantilla «${ETIQUETA_TIPO[tipo]}»`}
        error={error}
        onReintentar={() => refetch()}
      />
    );
  }

  return (
    <div ref={setRaiz} className="flex flex-col gap-4" style={alto ? { height: alto } : undefined}>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{DESCRIPCION_TIPO[tipo]}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {versionActual ? (
              <>
                <Badge variant="outline">Versión {versionActual.version}</Badge>
                <span>
                  Guardada el{" "}
                  {new Date(versionActual.creado_at).toLocaleString("es-ES", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </>
            ) : (
              <Badge variant="outline">Todavía sin guardar</Badge>
            )}
          </div>
        </div>
        <HistorialVersionesPlantilla tipo={tipo} versiones={versiones ?? []} puedeRestaurar={puedeEditar} />
      </div>

      {/*
        Región con scroll (2026-10-07, regla del dueño «el alto de la página es
        el de la pantalla»). Antes era `xl:max-h-[calc(100dvh-7rem)]
        xl:overflow-y-auto`: una constante puesta a ojo, solo desde `xl`, que
        convivía con el scroll de la página (doble scroll). Ahora el editor
        mide su alto (`useAlturaDisponible`, arriba) y esta región se queda con
        lo que sobra bajo la cabecera, a cualquier ancho. La vista previa
        desplegable de < xl va DENTRO, encima del formulario: abierta (~700 px)
        aplastaría la región si fuera fija. El `sticky` de la columna de vista
        previa (xl) se refiere a esta región, no a la ventana.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain">
      <Collapsible
        open={vistaPreviaAbierta}
        onOpenChange={setVistaPreviaAbierta}
        className="rounded-lg border xl:hidden"
      >
        <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium">
          Vista previa del correo
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-2 pb-3">
          {vistaPreviaAbierta && <VistaPreviaEmail tipo={tipo} campos={campos} />}
        </CollapsibleContent>
      </Collapsible>

      <div className="grid gap-6 xl:grid-cols-5 xl:items-start">
        {/* Columna izquierda: formulario — más ancha, es lo que se edita a diario */}
        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contenido</CardTitle>
              <CardDescription>Texto plano con variables — nunca HTML libre.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CampoInput
                id={`asunto-${tipo}`}
                etiqueta="Asunto"
                valor={campos.asunto}
                onChange={(v) => actualizarCampo("asunto", v)}
                disabled={!puedeEditar}
              />
              <CampoInput
                id={`saludo-${tipo}`}
                etiqueta="Saludo"
                valor={campos.saludo}
                onChange={(v) => actualizarCampo("saludo", v)}
                disabled={!puedeEditar}
              />
              <CampoTextarea
                id={`cuerpo-${tipo}`}
                etiqueta="Cuerpo"
                valor={campos.cuerpo}
                onChange={(v) => actualizarCampo("cuerpo", v)}
                disabled={!puedeEditar}
                ayuda="Una línea en blanco separa párrafos."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoInput
                  id={`boton-principal-${tipo}`}
                  etiqueta="Texto botón principal"
                  valor={campos.texto_boton_principal ?? ""}
                  onChange={(v) => actualizarCampo("texto_boton_principal", v || null)}
                  disabled={!puedeEditar}
                  opcional
                />
                <CampoInput
                  id={`boton-secundario-${tipo}`}
                  etiqueta="Texto botón secundario"
                  valor={campos.texto_boton_secundario ?? ""}
                  onChange={(v) => actualizarCampo("texto_boton_secundario", v || null)}
                  disabled={!puedeEditar}
                  opcional
                />
              </div>
              <CampoTextarea
                id={`pie-${tipo}`}
                etiqueta="Pie de contacto"
                valor={campos.pie ?? ""}
                onChange={(v) => actualizarCampo("pie", v || null)}
                disabled={!puedeEditar}
                opcional
              />
            </CardContent>
          </Card>

          <Card>
            <Collapsible open={marcaAbierta} onOpenChange={setMarcaAbierta}>
              <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between gap-2 p-6 pb-3 text-left">
                <div className="space-y-1">
                  <CardTitle className="text-base">Marca</CardTitle>
                  <CardDescription>Colores y logo del correo — se configuran una vez y casi nunca cambian.</CardDescription>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 pt-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <CampoColorMarca
                      id={`color-acento-${tipo}`}
                      etiqueta="Color de acento"
                      valor={campos.color_acento}
                      onChange={(v) => actualizarCampo("color_acento", v)}
                      disabled={!puedeEditar}
                    />
                    <CampoColorMarca
                      id={`color-oscuro-${tipo}`}
                      etiqueta="Color oscuro (pie)"
                      valor={campos.color_oscuro}
                      onChange={(v) => actualizarCampo("color_oscuro", v)}
                      disabled={!puedeEditar}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`logo-${tipo}`}>URL del logo (opcional)</Label>
                    <Input
                      id={`logo-${tipo}`}
                      value={campos.logo_url ?? ""}
                      onChange={(e) => actualizarCampo("logo_url", e.target.value || null)}
                      readOnly={!puedeEditar}
                      placeholder="https://.../logo.png"
                      type="url"
                      inputMode="url"
                      autoCapitalize="none"
                      className="h-11 text-base md:text-base"
                    />
                    <p className="text-xs text-muted-foreground">
                      Si se deja vacío, se muestra el nombre "Casa Tomás" en su lugar.
                    </p>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Bloques</CardTitle>
              <CardDescription>Qué secciones opcionales se muestran en este correo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {BLOQUES_DISPONIBLES.map((bloque) => (
                // <label> entero: tocar el texto también activa el interruptor (el
                // interruptor solo mide 44x24).
                <label key={bloque.clave} className="flex min-h-11 cursor-pointer items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5 pr-4">
                    <span className="text-sm font-medium leading-none">{bloque.etiqueta}</span>
                    <p className="text-xs text-muted-foreground">{bloque.descripcion}</p>
                  </div>
                  <Switch
                    checked={leerBloque(campos.bloques, bloque.clave, bloque.porDefecto)}
                    onCheckedChange={(checked) =>
                      actualizarCampo("bloques", { ...(campos.bloques ?? {}), [bloque.clave]: checked })
                    }
                    disabled={!puedeEditar}
                    aria-label={bloque.etiqueta}
                  />
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                {tipo === "reserva_modificada"
                  ? "El bloque «Cambios en tu reserva» (antes y ahora de lo que cambió) y la frase según el estado no son uno de estos interruptores: los pone el correo solo, siempre. Los botones solo se ven si la reserva aún está pendiente de que el cliente la confirme."
                  : 'El aviso de "pediste X, te ofrecemos Y" no es uno de estos interruptores: aparece solo (y siempre) cuando de verdad se le ofrece al cliente una HORA distinta de la que pidió. Un cambio de sala no lo dispara: la sala no sale en el correo del cliente.'}
              </p>
            </CardContent>
          </Card>

          {puedeEditar && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Guardar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`nota-${tipo}`}>Nota de esta versión (opcional)</Label>
                  <Input
                    id={`nota-${tipo}`}
                    value={notaVersion}
                    onChange={(e) => setNotaVersion(e.target.value)}
                    placeholder="Ej: cambio de tono, nuevo color de marca..."
                    className="h-11 text-base md:text-base"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {sucio ? "Hay cambios sin guardar." : "No hay cambios sin guardar."}
                  </p>
                  <Button onClick={handleGuardar} disabled={!sucio || guardar.isPending} className="h-11 px-5">
                    {guardar.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Guardar como nueva versión
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {puedeEditar && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Enviar prueba</CardTitle>
                <CardDescription>Usa datos de ejemplo (no una reserva real) y no guarda nada.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="email"
                    value={destinatario}
                    onChange={(e) => setDestinatario(e.target.value)}
                    placeholder="tu@correo.com"
                    autoCapitalize="none"
                    autoCorrect="off"
                    aria-label="Correo al que enviar la prueba"
                    className="h-11 sm:max-w-xs"
                  />
                  <Button variant="outline" onClick={handleEnviarPrueba} disabled={enviarPrueba.isPending} className="h-11 px-5">
                    {enviarPrueba.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Enviar prueba
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Resend está en modo sandbox: hoy solo entrega a la dirección del propietario de la cuenta. Si la
                  prueba falla por eso, el aviso lo explicará en vez de un "error al enviar" genérico.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Columna derecha: vista previa — pegada arriba (sticky) para que se
            vea sin desplazarse mientras se edita el formulario, más largo, de
            la izquierda. Las variables ya no viven aquí como lista aparte:
            cada campo tiene su propio botón "{ } Variable" justo al lado. */}
        <div className="hidden xl:col-span-2 xl:block">
          <div className="xl:sticky xl:top-0">
            <VistaPreviaEmail tipo={tipo} campos={campos} />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
