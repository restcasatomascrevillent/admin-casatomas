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
      <Input id={id} ref={ref} value={valor} onChange={(e) => onChange(e.target.value)} readOnly={disabled} />
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
      <Textarea id={id} ref={ref} value={valor} onChange={(e) => onChange(e.target.value)} readOnly={disabled} rows={5} />
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
        Corrección 2026-09-25: esta pantalla (Plantillas de Correo) cuelga de
        SuperAdminLayout, no de DashboardLayout — ambos compartían el mismo
        bug (overflow-x-hidden sin overflow-y explícito en <main>, que el
        navegador traduce a overflow-y:auto implícito y rompe cualquier
        `position: sticky` de dentro, porque <main> nunca desborda de verdad
        y pasa a ser el "contenedor de scroll" de referencia en vez del
        viewport). Ya está arreglado en la raíz (DashboardLayout.tsx y
        SuperAdminLayout.tsx), así que el sticky de más abajo (columna de
        vista previa) ya funcionaría solo contra el viewport.
        El contenedor de abajo (max-h + overflow-y-auto) se mantiene de
        todos modos, ahora como elección deliberada: dentro de un formulario
        largo interesa que la vista previa quede pegada en una región propia
        acotada en vez de perseguir todo el scroll de la página.
      */}
      <div className="lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
      <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
        {/* Columna izquierda: formulario — más ancha, es lo que se edita a diario */}
        <div className="space-y-4 lg:col-span-3">
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
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 p-6 pb-3 text-left">
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
                <div key={bloque.clave} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5 pr-4">
                    <Label>{bloque.etiqueta}</Label>
                    <p className="text-xs text-muted-foreground">{bloque.descripcion}</p>
                  </div>
                  <Switch
                    checked={leerBloque(campos.bloques, bloque.clave, bloque.porDefecto)}
                    onCheckedChange={(checked) =>
                      actualizarCampo("bloques", { ...(campos.bloques ?? {}), [bloque.clave]: checked })
                    }
                    disabled={!puedeEditar}
                  />
                </div>
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
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {sucio ? "Hay cambios sin guardar." : "No hay cambios sin guardar."}
                  </p>
                  <Button onClick={handleGuardar} disabled={!sucio || guardar.isPending}>
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
                    className="sm:max-w-xs"
                  />
                  <Button variant="outline" onClick={handleEnviarPrueba} disabled={enviarPrueba.isPending}>
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
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-0">
            <VistaPreviaEmail tipo={tipo} campos={campos} />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
