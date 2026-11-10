import { Facebook, Instagram } from "lucide-react";
import { MARCAS, MARCAS_IDS, type MarcaId } from "@/lib/instagram/tokens";
import { NOMBRE_CANAL, CANALES, type Canal } from "@/lib/rrss/formatos";
import { cn } from "@/lib/utils";

interface Props {
  canal: Canal;
  /** Si viene, el canal no se puede cambiar. */
  canalFijo?: Canal;
  marca: MarcaId;
  onCanal: (c: Canal) => void;
  onMarca: (m: MarcaId) => void;
}

const NOMBRE_MARCA: Record<MarcaId, string> = { "casa-tomas": "Casa Tomás", touza: "TOUZA" };

function Opcion({ activa, onClick, titulo, children, prueba }: { activa: boolean; onClick: () => void; titulo: string; children?: React.ReactNode; prueba: string }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      data-testid={prueba}
      onClick={onClick}
      className={cn(
        "flex min-h-11 flex-1 items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        activa ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted",
      )}
    >
      {children}
      {titulo}
    </button>
  );
}

export function PasoDestino({ canal, canalFijo, marca, onCanal, onMarca }: Props) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="destino-canal" className="space-y-2">
        <h3 id="destino-canal" className="text-sm font-semibold">
          Dónde lo vas a publicar
        </h3>
        {canalFijo ? (
          <p className="text-sm text-muted-foreground">
            Este editor trabaja para <strong className="text-foreground">{NOMBRE_CANAL[canalFijo]}</strong>.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {CANALES.map((c) => (
              <Opcion key={c} prueba={`canal:${c}`} activa={canal === c} onClick={() => onCanal(c)} titulo={NOMBRE_CANAL[c]}>
                {c === "instagram" ? <Instagram className="h-4 w-4" aria-hidden="true" /> : <Facebook className="h-4 w-4" aria-hidden="true" />}
              </Opcion>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="destino-marca" className="space-y-2">
        <h3 id="destino-marca" className="text-sm font-semibold">
          Marca
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          {MARCAS_IDS.map((m) => (
            <Opcion key={m} prueba={`marca:${m}`} activa={marca === m} onClick={() => onMarca(m)} titulo={NOMBRE_MARCA[m]} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MARCAS[marca].nombre}: las fuentes, los colores y el logo de la marca se aplican a los rótulos.</p>
      </section>
    </div>
  );
}
