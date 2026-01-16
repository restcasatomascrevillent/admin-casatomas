import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ResendStats {
  stats: {
    total: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
  };
  rates: {
    deliveryRate: string;
    openRate: string;
    clickRate: string;
    bounceRate: string;
  };
  lastUpdated: string;
}

export function useResendStats() {
  return useQuery({
    queryKey: ['resend-stats'],
    queryFn: async (): Promise<ResendStats> => {
      const { data, error } = await supabase.functions.invoke('resend-stats');
      
      if (error) {
        throw new Error(error.message);
      }
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      return data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
