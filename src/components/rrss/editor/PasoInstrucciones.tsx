import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const MAX_INSTRUCCIONES = 1000;

interface Props {
  titulo: string;
  instrucciones: string;
  creativo: boolean;
  onTitulo: (v: string) => void;
  onInstrucciones: (v: string) => void;
  onCreativo: (v: boolean) => void;
}

const EJEMPLOS = [
  "Es el menú de San Valentín: que se note cena especial.",
  "Quiero que se vea el plato y el vino, sin texto encima.",
  "Reel rápido del arroz de la casa, con una frase de reserva al final.",
];

export function PasoInstrucciones({ titulo, instrucciones, creativo, onTitulo, onInstrucciones, onCreativo }: Props) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Todo esto es opcional: sin instrucciones, la IA decide a partir de las fotos y del estilo.</p>
      <div className="space-y-1.5">
        <Label htmlFor="rrss-titulo">Título del trabajo</Label>
        <Input id="rrss-titulo" value={titulo} maxLength={120} onChange={(e) => onTitulo(e.target.value)} placeholder="Ej.: Menú de San Valentín" />
        <p className="text-xs text-muted-foreground">Solo para encontrarlo en la lista y poner nombre a las descargas.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rrss-instrucciones">Qué quieres conseguir</Label>
        <Textarea
          id="rrss-instrucciones"
          rows={4}
          maxLength={MAX_INSTRUCCIONES}
          value={instrucciones}
          onChange={(e) => onInstrucciones(e.target.value)}
          placeholder="Cuéntaselo como se lo contarías a una persona del equipo"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Ejemplos:{" "}
            {EJEMPLOS.map((e, i) => (
              <button key={i} type="button" className="mr-2 underline underline-offset-2 hover:text-foreground" onClick={() => onInstrucciones(e)}>
                {e}
              </button>
            ))}
          </span>
          <span aria-live="polite">
            {instrucciones.length}/{MAX_INSTRUCCIONES}
          </span>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Switch id="rrss-creativo" checked={creativo} onCheckedChange={onCreativo} aria-describedby="rrss-creativo-ayuda" />
        <div className="space-y-1">
          <Label htmlFor="rrss-creativo" className="cursor-pointer">
            Permitir transformaciones creativas
          </Label>
          <p id="rrss-creativo-ayuda" className="text-xs text-muted-foreground">
            Desenfocar o cambiar el fondo modifica la escena. Sin activarlo, solo se corrige luz, color y encuadre: platos, vinos y sala se quedan como son.
          </p>
        </div>
      </div>
    </div>
  );
}
