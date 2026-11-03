import { useId, useRef, useState, type FormEvent, type Ref } from "react";
import { Check, Circle, Eye, EyeOff, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { cambiarMiContrasena, reglasContrasena, type CodigoCambioContrasena } from "@/lib/contrasena";

interface CampoContrasenaProps {
  id: string;
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string | null;
  describedBy?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

/** Campo de contraseña con botón «Mostrar / Ocultar» (44 px, con nombre accesible y aria-pressed). */
function CampoContrasena({ id, etiqueta, valor, onCambio, autoComplete, error, describedBy, disabled, autoFocus, inputRef }: CampoContrasenaProps) {
  const [visible, setVisible] = useState(false);
  const idError = `${id}-error`;
  const descripcion = [error ? idError : null, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          type={visible ? "text" : "password"}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={descripcion}
          className={cn("h-11 pr-12 text-base", error && "border-destructive focus-visible:ring-destructive")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-11 w-11 text-muted-foreground hover:text-foreground"
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${etiqueta.toLocaleLowerCase("es")}`}
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
      {error && (
        <p id={idError} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface FormularioCambioContrasenaProps {
  /** Email de la cuenta: va en un campo oculto para que el gestor de contraseñas guarde la nueva en su sitio. */
  email?: string | null;
  /** Tras cambiarla (p. ej. cerrar el diálogo). */
  onCambiada?: () => void;
  onCancelar?: () => void;
  autoFocus?: boolean;
}

const CAMPO_DEL_ERROR: Partial<Record<CodigoCambioContrasena, "actual" | "nueva">> = {
  falta_actual: "actual",
  contrasena_actual_incorrecta: "actual",
  contrasena_corta: "nueva",
  contrasena_larga: "nueva",
  misma_contrasena: "nueva",
  contrasena_debil: "nueva",
};

/**
 * Cambio de la PROPIA contraseña: actual, nueva y repetir, con los requisitos a la
 * vista y marcados según se escribe. Lo usan «Mi cuenta» (pie del menú) y Super
 * Admin › Usuarios («Cambiar mi contraseña»). Las contraseñas solo viven en el
 * estado de este formulario (se borran al cambiarla o al cerrarlo) y solo viajan a
 * la función `cambiar-mi-contrasena`; nunca se escriben en el log ni en el navegador.
 */
export function FormularioCambioContrasena({ email, onCambiada, onCancelar, autoFocus }: FormularioCambioContrasenaProps) {
  const id = useId();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [errorActual, setErrorActual] = useState<string | null>(null);
  const [errorNueva, setErrorNueva] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [cambiada, setCambiada] = useState(false);
  const refActual = useRef<HTMLInputElement>(null);
  const refNueva = useRef<HTMLInputElement>(null);
  const refRepetir = useRef<HTMLInputElement>(null);

  const reglas = reglasContrasena({ actual, nueva, repetir });
  const idReglas = `${id}-reglas`;
  const pendientes = reglas.filter((r) => r.obligatoria && !r.cumple);

  const limpiarErrores = () => {
    setErrorActual(null);
    setErrorNueva(null);
    setErrorGeneral(null);
    setCambiada(false);
  };

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (enviando) return;
    setIntentado(true);
    limpiarErrores();
    if (!actual) {
      setErrorActual("Escribe tu contraseña actual.");
      refActual.current?.focus();
      return;
    }
    if (pendientes.length > 0) {
      setErrorGeneral("Revisa los requisitos de la nueva contraseña.");
      (pendientes.every((r) => r.id === "coincide") ? refRepetir : refNueva).current?.focus();
      return;
    }
    setEnviando(true);
    const resultado = await cambiarMiContrasena(actual, nueva);
    setEnviando(false);
    if (resultado.ok) {
      setActual("");
      setNueva("");
      setRepetir("");
      setIntentado(false);
      setCambiada(true);
      toast.success("Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos.");
      onCambiada?.();
      return;
    }
    const campo = resultado.codigo ? CAMPO_DEL_ERROR[resultado.codigo] : undefined;
    const mensaje = resultado.mensaje ?? "No se pudo cambiar la contraseña. Inténtalo de nuevo.";
    if (campo === "actual") {
      setErrorActual(mensaje);
      refActual.current?.select();
      refActual.current?.focus();
    } else if (campo === "nueva") {
      setErrorNueva(mensaje);
      refNueva.current?.focus();
    } else {
      setErrorGeneral(mensaje);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void enviar(e)} className="space-y-4" aria-label="Cambiar contraseña">
      {/* Para los gestores de contraseñas (Chrome, iCloud): a qué cuenta pertenece la nueva. */}
      {email && (
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden aria-hidden="true" tabIndex={-1} />
      )}
      <CampoContrasena
        id={`${id}-actual`}
        etiqueta="Contraseña actual"
        valor={actual}
        onCambio={(v) => { setActual(v); setErrorActual(null); }}
        autoComplete="current-password"
        error={errorActual}
        disabled={enviando}
        autoFocus={autoFocus}
        inputRef={refActual}
      />
      <CampoContrasena
        id={`${id}-nueva`}
        etiqueta="Nueva contraseña"
        valor={nueva}
        onCambio={(v) => { setNueva(v); setErrorNueva(null); }}
        autoComplete="new-password"
        error={errorNueva}
        describedBy={idReglas}
        disabled={enviando}
        inputRef={refNueva}
      />
      <CampoContrasena
        id={`${id}-repetir`}
        etiqueta="Repite la nueva contraseña"
        valor={repetir}
        onCambio={setRepetir}
        autoComplete="new-password"
        describedBy={idReglas}
        disabled={enviando}
        inputRef={refRepetir}
      />

      <ul id={idReglas} aria-label="Requisitos de la nueva contraseña" className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
        {reglas.map((regla) => {
          const falla = intentado && regla.obligatoria && !regla.cumple;
          return (
            <li key={regla.id} className={cn("flex items-start gap-2", regla.cumple ? "text-foreground" : falla ? "text-destructive" : "text-muted-foreground")}>
              {regla.cumple ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-confirmed" aria-hidden="true" />
              ) : falla ? (
                <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {regla.texto}
                <span className="sr-only">{regla.cumple ? ": cumplido" : regla.obligatoria ? ": pendiente" : ": opcional"}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Al cambiarla se cerrará la sesión en tus otros dispositivos; en este seguirás dentro.
      </p>

      {errorGeneral && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {errorGeneral}
        </p>
      )}
      {cambiada && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-status-confirmed/40 bg-status-confirmed/10 p-3 text-sm font-medium text-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-status-confirmed" aria-hidden="true" />
          Contraseña cambiada correctamente.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancelar && (
          <Button type="button" variant="outline" className="h-11 px-5" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="h-11 px-5" disabled={enviando}>
          {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {enviando ? "Cambiando…" : "Cambiar contraseña"}
        </Button>
      </div>
    </form>
  );
}
