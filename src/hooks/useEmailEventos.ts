import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface EmailEvento {
  id: string;
  email_id: string;
  tipo_evento: string;
  email_destinatario: string | null;
  timestamp_evento: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface EmailEventosStats {
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
}

export interface EmailEventosPorDia {
  fecha: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
}

export function useEmailEventos() {
  return useQuery({
    queryKey: ["email-eventos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_eventos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data as EmailEvento[];
    },
  });
}

export function useEmailEventosStats() {
  return useQuery({
    queryKey: ["email-eventos-stats"],
    queryFn: async () => {
      // Obtener todos los eventos con email_id para contar únicos
      const { data, error } = await supabase
        .from("email_eventos")
        .select("tipo_evento, email_id");

      if (error) throw error;

      // Contar emails únicos por tipo de evento
      const emailsPorTipo: Record<string, Set<string>> = {
        sent: new Set(),
        delivered: new Set(),
        opened: new Set(),
        clicked: new Set(),
        bounced: new Set(),
        complained: new Set(),
      };

      data.forEach((evento) => {
        const tipo = evento.tipo_evento;
        if (tipo in emailsPorTipo) {
          emailsPorTipo[tipo].add(evento.email_id);
        }
      });

      const stats: EmailEventosStats = {
        total: data.length,
        sent: emailsPorTipo.sent.size,
        delivered: emailsPorTipo.delivered.size,
        opened: emailsPorTipo.opened.size,
        clicked: emailsPorTipo.clicked.size,
        bounced: emailsPorTipo.bounced.size,
        complained: emailsPorTipo.complained.size,
      };

      // Calcular tasas - todas basadas en emails únicos enviados (100%)
      const rates = {
        deliveryRate: stats.sent > 0 ? Math.round((stats.delivered / stats.sent) * 100) : 0,
        openRate: stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0,
        clickRate: stats.sent > 0 ? Math.round((stats.clicked / stats.sent) * 100) : 0,
        bounceRate: stats.sent > 0 ? Math.round((stats.bounced / stats.sent) * 100) : 0,
      };

      return { stats, rates };
    },
  });
}

export function useEmailEventosPorDia(dias: number = 7) {
  return useQuery({
    queryKey: ["email-eventos-por-dia", dias],
    queryFn: async () => {
      const fechaInicio = new Date();
      fechaInicio.setDate(fechaInicio.getDate() - dias);

      const { data, error } = await supabase
        .from("email_eventos")
        .select("tipo_evento, timestamp_evento")
        .gte("timestamp_evento", fechaInicio.toISOString())
        .order("timestamp_evento", { ascending: true });

      if (error) throw error;

      // Agrupar por día
      const porDia: Record<string, EmailEventosPorDia> = {};

      data.forEach((evento) => {
        if (!evento.timestamp_evento) return;
        
        const fecha = evento.timestamp_evento.split("T")[0];
        if (!porDia[fecha]) {
          porDia[fecha] = { fecha, sent: 0, delivered: 0, opened: 0, clicked: 0 };
        }

        const tipo = evento.tipo_evento as keyof Omit<EmailEventosPorDia, "fecha">;
        if (tipo in porDia[fecha]) {
          porDia[fecha][tipo]++;
        }
      });

      return Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha));
    },
  });
}

export function useEmailEventosRecientes(limite: number = 10) {
  return useQuery({
    queryKey: ["email-eventos-recientes", limite],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_eventos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limite);

      if (error) throw error;
      return data as EmailEvento[];
    },
    refetchInterval: 30000, // Refrescar cada 30 segundos
  });
}
