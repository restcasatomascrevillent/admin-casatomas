import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

/**
 * «Aplicar el precio sugerido» (14/11/2026, petición del dueño): el aviso de Telegram «Margen bajo» trae un
 * enlace a esta pantalla (/aplicar-precio/<aviso>). Exige sesión del panel y permiso de EDITAR la carta (la
 * ruta pide gestor_carta y la RPC lo vuelve a comprobar). El precio lo calcula el servidor
 * (avisos_precio_sugerido, migración 20261130160000); aquí se ve, se puede retocar y se confirma. Vale una
 * sola vez por aviso.
 */

interface Sugerencia {
  canal: "plato" | "vino";
  nombre: string;
  precio_actual: number | null;
  precio_sugerido: number | null;
  venta_sin_iva_minima: number | null;
  coste: number | null;
  limite: number | null;
  valor: number | null;
  iva_pct: number | null;
  aplicado: { precio?: number; en?: string } | null;
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc).call(supabase, fn, args);

const eur = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);

const ERRORES: Record<string, string> = {
  sin_permiso: "No tienes permiso para cambiar la carta. Pídeselo a quien lleve el panel.",
  ya_aplicado: "Este precio ya se aplicó antes. Si quieres cambiarlo otra vez, hazlo en la carta.",
  sin_sugerencia: "Este aviso ya no sugiere ningún precio (puede que la carta ya esté al día).",
  precio_fuera_de_rango: "El precio tiene que estar entre 0,50 € y 9.999 €.",
  aviso_no_encontrado: "No se encuentra el aviso.",
};
const textoError = (m: string | undefined) => {
  const clave = Object.keys(ERRORES).find((k) => m?.includes(k));
  return clave ? ERRORES[clave] : `No se ha podido: ${m ?? "error desconocido"}`;
};

/** «24,50» o «24.5» → 24.5; null si no es un número. */
const leerPrecio = (t: string): number | null => {
  const n = Number(t.trim().replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

function Explicacion({ s }: { s: Sugerencia }) {
  if (s.canal === "plato" && s.limite !== null) {
    return (
      <p>
        Los ingredientes de este plato cuestan {eur(s.coste)} (sin IVA). Para que sean como mucho el {s.limite} % de lo que cobras,
        el plato tiene que venderse al menos a {eur(s.venta_sin_iva_minima)} sin IVA, es decir, {eur(s.precio_sugerido)} con IVA
        (redondeado a 0,50 €).
      </p>
    );
  }
  return (
    <p>
      La botella te cuesta {eur(s.coste)} (sin IVA). Para cobrar al menos {String(s.limite ?? "").replace(".", ",")} veces lo que pagas,
      tiene que venderse a {eur(s.venta_sin_iva_minima)} sin IVA, es decir, {eur(s.precio_sugerido)} con IVA (redondeado a 0,50 €).
    </p>
  );
}

export default function AplicarPrecio() {
  const { avisoId = "" } = useParams();
  const qc = useQueryClient();
  const [texto, setTexto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const consulta = useQuery({
    queryKey: ["aviso-precio-sugerido", avisoId],
    enabled: /^[0-9a-f-]{36}$/i.test(avisoId),
    queryFn: async () => {
      const { data, error } = await rpc("avisos_precio_sugerido", { p_aviso: avisoId });
      if (error) throw new Error(error.message);
      return (data ?? null) as Sugerencia | null;
    },
  });
  const s = consulta.data ?? null;
  const precio = leerPrecio(texto ?? (s?.precio_sugerido !== null && s?.precio_sugerido !== undefined ? String(s.precio_sugerido).replace(".", ",") : ""));

  const aplicar = useMutation({
    mutationFn: async () => {
      const { data, error } = await rpc("avisos_aplicar_precio_sugerido", { p_aviso: avisoId, p_precio: precio });
      if (error) throw new Error(error.message);
      return data as { nombre: string; antes: number | null; precio: number };
    },
    onSuccess: (r) => {
      // 14/11/2026: el precio nuevo se publica también en la web (como al guardar en la carta).
      notificarGuardadoYPublicacion(s?.canal === "vino" ? "vino" : "plato", `«${r.nombre}» ya cuesta ${eur(r.precio)} en la carta`);
      void qc.invalidateQueries({ queryKey: ["aviso-precio-sugerido", avisoId] });
    },
    onSettled: () => setConfirmando(false),
  });

  const precioValido = precio !== null && precio >= 0.5 && precio <= 9999;
  const hecho = aplicar.data ?? (s?.aplicado?.precio !== undefined ? { nombre: s.nombre, antes: s.precio_actual, precio: s.aplicado.precio } : null);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-lg pb-8">
        <Card>
          <CardHeader>
            <CardTitle>Cambiar el precio en la carta</CardTitle>
            <CardDescription>Desde el aviso «Margen bajo»: el coste ha subido y el precio se ha quedado corto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {consulta.isLoading && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
              </p>
            )}
            {(consulta.isError || (!consulta.isLoading && !s)) && (
              <p className="text-destructive">{consulta.isError ? textoError((consulta.error as Error).message) : "Este aviso no sugiere ningún precio."}</p>
            )}

            {s && hecho && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/10 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <p>
                  Hecho: «{hecho.nombre}» pasa de {eur(hecho.antes)} a <strong>{eur(hecho.precio)}</strong> en la carta.
                </p>
              </div>
            )}

            {s && !hecho && s.precio_sugerido === null && (
              <p>
                «{s.nombre}» ya está a {eur(s.precio_actual)}: no hace falta subirlo. Si quieres, revísalo en{" "}
                <Link className="underline" to="/facturas?tab=margenes">Facturas › Márgenes</Link>.
              </p>
            )}

            {s && !hecho && s.precio_sugerido !== null && (
              <>
                <div className="space-y-1">
                  <p className="text-base font-medium">{s.nombre}</p>
                  <p>
                    Ahora: <strong>{eur(s.precio_actual)}</strong> · Sugerido: <strong>{eur(s.precio_sugerido)}</strong> (con IVA, lo que paga el cliente)
                  </p>
                </div>
                <div className="text-muted-foreground">
                  <Explicacion s={s} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="precio-nuevo">Precio nuevo en la carta (con IVA)</Label>
                  <Input
                    id="precio-nuevo"
                    inputMode="decimal"
                    value={texto ?? String(s.precio_sugerido).replace(".", ",")}
                    onChange={(e) => {
                      setTexto(e.target.value);
                      setConfirmando(false);
                    }}
                    aria-invalid={!precioValido}
                  />
                  {!precioValido && <p className="text-destructive">Pon un precio entre 0,50 € y 9.999 €.</p>}
                </div>
                {aplicar.isError && <p className="text-destructive">{textoError((aplicar.error as Error).message)}</p>}
                {!confirmando ? (
                  <Button className="w-full" disabled={!precioValido} onClick={() => setConfirmando(true)}>
                    Aplicar {precioValido ? eur(precio) : ""}
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-md border p-3">
                    <p>
                      ¿Seguro? «{s.nombre}» pasará de {eur(s.precio_actual)} a <strong>{eur(precio)}</strong> en la carta.
                    </p>
                    <div className="flex gap-2">
                      <Button className="flex-1" disabled={aplicar.isPending} onClick={() => aplicar.mutate()}>
                        {aplicar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Sí, cambiar el precio
                      </Button>
                      <Button variant="outline" className="flex-1" disabled={aplicar.isPending} onClick={() => setConfirmando(false)}>
                        No
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
