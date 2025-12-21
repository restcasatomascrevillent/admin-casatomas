import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BlacklistEntry {
  id: string;
  tipo: "email" | "telefono";
  valor: string;
  nombre: string | null;
  motivo: string | null;
  created_at: string;
  updated_at: string;
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
      const conditions = [];
      
      if (email) {
        conditions.push({ tipo: "email", valor: email });
      }
      if (telefono) {
        conditions.push({ tipo: "telefono", valor: telefono });
      }

      if (conditions.length === 0) return null;

      // Check each condition separately
      for (const condition of conditions) {
        const { data, error } = await supabase
          .from("blacklist")
          .select("*")
          .eq("tipo", condition.tipo)
          .eq("valor", condition.valor)
          .maybeSingle();

        if (error) throw error;
        if (data) return data as BlacklistEntry;
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
