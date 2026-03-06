import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Star, Users, ExternalLink } from "lucide-react";
import { useResenas } from "@/hooks/useResenas";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function ResumenMarketing() {
  const navigate = useNavigate();
  const { data: resenas } = useResenas();

  const { data: statsRedes } = useQuery({
    queryKey: ["stats-redes-resumen"],
    queryFn: async () => {
      const { data } = await supabase
        .from("estadisticas_redes")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(1);
      return data?.[0];
    },
  });

  const valoracionMedia =
    resenas && resenas.length > 0
      ? (resenas.reduce((acc, r) => acc + r.valoracion, 0) / resenas.length).toFixed(1)
      : "0.0";

  const resenasNuevasSemana =
    resenas?.filter((r) => {
      const fecha = new Date(r.fecha);
      const hace7dias = new Date();
      hace7dias.setDate(hace7dias.getDate() - 7);
      return fecha >= hace7dias;
    }).length || 0;

  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Resumen de Newsletter</CardTitle>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              <Star className="h-3 w-3" />
              <span>Valoración</span>
            </div>
            <div className="text-2xl font-bold text-primary">{valoracionMedia}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              <Star className="h-3 w-3" />
              <span>Nuevas</span>
            </div>
            <div className="text-2xl font-bold text-primary">{resenasNuevasSemana}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              <Users className="h-3 w-3" />
              <span>Seguidores</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              {statsRedes?.seguidores || 0}
            </div>
          </div>
        </div>

        <div className="pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => navigate("/marketing")}
          >
            Ver panel completo de Newsletter
            <ExternalLink className="h-3 w-3 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
