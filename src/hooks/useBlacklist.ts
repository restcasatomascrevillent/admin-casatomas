import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { variantesTelefono } from "@/lib/reservas/telefono";

export interface BlacklistEntry {
  id: string;
  tipo: "email" | "telefono";
  valor: string;
  nombre: string | null;
  motivo: string | null;
  created_at: string;
  updated_at: string;
  /**
   * NUEVO (migración 20260920010000_sistema_emails_reserva.sql, aún no
   * aplicada). Todas opcionales a propósito: una entrada dada de alta a mano
   * desde GestionBlacklist.tsx (no pasa por una sugerencia) nunca las tiene,
   * y si la migración no está aplicada tampoco existen en la fila — esto usa
   * `select("*")` así que sencillamente no vienen, sin romper la consulta.
   */
  aprobado_por?: string | null;
  aprobada_en?: string | null;
  /** Fecha (YYYY-MM-DD) a partir de la cual esta entrada deja de aplicar. */
  caduca_el?: string | null;
}

export function useBlacklist() {
  return useQuery({
    queryKey: ["blacklist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blacklist")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as BlacklistEntry[];
    },
  });
}

export function useVerificarBlacklist() {
  return useMutation({
    mutationFn: async ({ email, telefono }: { email?: string; telefono?: string }) => {
      // Antes se comparaba el valor EXACTO: "612345678" no casaba con una
      // entrada guardada como "+34612345678" (formato del bot), y un email con
      // mayúsculas o espacios tampoco. Ahora se buscan todas las variantes.
      const conditions: Array<{ tipo: "email" | "telefono"; valores: string[] }> = [];
      const emailLimpio = email?.trim();
      if (emailLimpio) {
        conditions.push({ tipo: "email", valores: Array.from(new Set([emailLimpio, emailLimpio.toLowerCase()])) });
      }
      const variantes = variantesTelefono(telefono);
      if (variantes.length > 0) {
        conditions.push({ tipo: "telefono", valores: variantes });
      }

      if (conditions.length === 0) return null;

      const hoy = new Date().toISOString().slice(0, 10);
      for (const condition of conditions) {
        const { data, error } = await supabase
          .from("blacklist")
          .select("*")
          .eq("tipo", condition.tipo)
          .in("valor", condition.valores);

        if (error) throw error;
        // Una entrada con caducidad ya vencida (sugerencias aprobadas con
        // `caduca_el`) deja de aplicar.
        const vigente = ((data ?? []) as BlacklistEntry[]).find((e) => !e.caduca_el || e.caduca_el >= hoy);
        if (vigente) return vigente;
      }

      return null;
    },
  });
}

export function useCrearBlacklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entry: Omit<BlacklistEntry, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("blacklist")
        .insert(entry)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      toast.success("Entrada añadida a la blacklist");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("Este valor ya está en la blacklist");
      } else {
        toast.error("Error al añadir a la blacklist");
      }
    },
  });
}

export function useActualizarBlacklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<BlacklistEntry> & { id: string }) => {
      const { data, error } = await supabase
        .from("blacklist")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      toast.success("Blacklist actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar la blacklist");
    },
  });
}

export function useEliminarBlacklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("blacklist").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      toast.success("Entrada eliminada de la blacklist");
    },
    onError: () => {
      toast.error("Error al eliminar de la blacklist");
    },
  });
}
