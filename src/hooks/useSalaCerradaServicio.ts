import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// «Terraza cerrada» por servicio (fecha + turno). Se guarda en la tabla
// `salas_cerradas_servicio` (migración 20261009110000). Si la tabla aún no
// existe, el interruptor vive solo en este navegador (`local = true`) y la
// pantalla lo avisa.

const CLAVE = "salas_cerradas_servicio";
const claveLocal = (espacioId: string, fecha: string, turno: string) => `reservas:sala-cerrada:${espacioId}:${fecha}:${turno}`;

function leerLocal(clave: string): boolean {
  try {
    return localStorage.getItem(clave) === "1";
  } catch {
    return false;
  }
}

function guardarLocal(clave: string, cerrada: boolean) {
  try {
    if (cerrada) localStorage.setItem(clave, "1");
    else localStorage.removeItem(clave);
  } catch {
    // Sin almacenamiento: se queda en memoria.
  }
}

// La tabla no está en los tipos generados hasta que se aplique la migración.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = () => supabase.from(CLAVE as any) as any;

export function useSalaCerradaServicio(espacioId: string | null, fecha: string, turno: string | null) {
  const qc = useQueryClient();
  const activo = !!espacioId && !!turno;
  const local = activo ? claveLocal(espacioId!, fecha, turno!) : "";
  const [enMemoria, setEnMemoria] = useState<Record<string, boolean>>({});

  const { data } = useQuery({
    queryKey: [CLAVE, espacioId, fecha, turno],
    enabled: activo,
    queryFn: async (): Promise<{ cerrada: boolean; local: boolean }> => {
      const { data, error } = await tabla().select("espacio_id").eq("espacio_id", espacioId).eq("fecha", fecha).eq("turno", turno);
      if (error) return { cerrada: leerLocal(local), local: true };
      return { cerrada: (data ?? []).length > 0, local: false };
    },
  });

  const esLocal = data?.local ?? true;
  const cerrada = local in enMemoria ? enMemoria[local] : (data?.cerrada ?? false);

  const cambiar = useCallback(
    async (nueva: boolean) => {
      if (!activo) return;
      setEnMemoria((m) => ({ ...m, [local]: nueva }));
      if (esLocal) {
        guardarLocal(local, nueva);
        return;
      }
      const { error } = nueva
        ? await tabla().insert({ espacio_id: espacioId, fecha, turno })
        : await tabla().delete().eq("espacio_id", espacioId).eq("fecha", fecha).eq("turno", turno);
      if (error && error.code !== "23505") {
        guardarLocal(local, nueva);
        toast.warning("No se ha podido guardar en el servidor: queda solo en este dispositivo.");
      }
      void qc.invalidateQueries({ queryKey: [CLAVE, espacioId, fecha, turno] });
    },
    [activo, local, esLocal, espacioId, fecha, turno, qc],
  );

  return { cerrada, cambiar, local: esLocal };
}
