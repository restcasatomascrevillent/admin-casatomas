import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NoticiaHosteleria {
  titulo: string;
  fuente: string;
  fecha: string;
  categoria: string;
  enlace: string;
  descripcion?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { categoria } = await req.json().catch(() => ({ categoria: "todas" }));

    // URLs de feeds RSS y fuentes confiables de hostelería
    const fuentes = [
      {
        url: "https://www.hosteleriayturismo.com",
        nombre: "Hostelería y Turismo",
        categoria: "General",
      },
      {
        url: "https://www.restauracioncolectiva.com",
        nombre: "Restauración Colectiva",
        categoria: "Gestión",
      },
      {
        url: "https://www.infohoreca.com",
        nombre: "InfoHoreca",
        categoria: "Tecnología",
      },
    ];

    // Aquí harías scraping real o llamadas a APIs de noticias
    // Por ahora, simulamos noticias basadas en las fuentes reales
    const noticias: NoticiaHosteleria[] = [
      {
        titulo: "El sector hostelero español factura 142.000 millones en 2024",
        fuente: "Hostelería y Turismo",
        fecha: new Date(Date.now() - 86400000 * 1).toISOString(),
        categoria: "Tendencias",
        enlace: "https://www.hosteleriayturismo.com",
        descripcion: "Crecimiento del 8% respecto al año anterior",
      },
      {
        titulo: "Nuevas normativas de seguridad alimentaria entran en vigor",
        fuente: "InfoHoreca",
        fecha: new Date(Date.now() - 86400000 * 2).toISOString(),
        categoria: "Legislación",
        enlace: "https://www.infohoreca.com",
        descripcion: "Cambios obligatorios para todos los establecimientos",
      },
      {
        titulo: "IA en restaurantes: Predicción de demanda con machine learning",
        fuente: "Restauración Colectiva",
        fecha: new Date(Date.now() - 86400000 * 3).toISOString(),
        categoria: "Tecnología",
        enlace: "https://www.restauracioncolectiva.com",
        descripcion: "Reducción del desperdicio hasta un 30%",
      },
      {
        titulo: "Estrategias para reducir rotación de personal en hostelería",
        fuente: "Hostelería y Turismo",
        fecha: new Date(Date.now() - 86400000 * 4).toISOString(),
        categoria: "RRHH",
        enlace: "https://www.hosteleriayturismo.com",
        descripcion: "Programas de incentivos y formación continua",
      },
      {
        titulo: "Subvenciones Kit Digital para digitalización de restaurantes",
        fuente: "InfoHoreca",
        fecha: new Date(Date.now() - 86400000 * 5).toISOString(),
        categoria: "Gestión",
        enlace: "https://www.infohoreca.com",
        descripcion: "Hasta 12.000€ para pequeñas empresas",
      },
      {
        titulo: "Tendencia del momento: Menús sostenibles y km 0",
        fuente: "Restauración Colectiva",
        fecha: new Date(Date.now() - 86400000 * 6).toISOString(),
        categoria: "Tendencias",
        enlace: "https://www.restauracioncolectiva.com",
        descripcion: "El 65% de los comensales prefieren opciones locales",
      },
      {
        titulo: "Cambios en el SMI afectan a 40% de trabajadores de hostelería",
        fuente: "Hostelería y Turismo",
        fecha: new Date(Date.now() - 86400000 * 7).toISOString(),
        categoria: "Legislación",
        enlace: "https://www.hosteleriayturismo.com",
        descripcion: "Nuevo salario mínimo interprofesional desde enero",
      },
      {
        titulo: "TPVs en la nube: La revolución de los sistemas de cobro",
        fuente: "InfoHoreca",
        fecha: new Date(Date.now() - 86400000 * 8).toISOString(),
        categoria: "Tecnología",
        enlace: "https://www.infohoreca.com",
        descripcion: "Ventajas de los sistemas cloud vs tradicionales",
      },
    ];

    // Filtrar por categoría si se especifica
    const noticiasFiltradas =
      categoria !== "todas"
        ? noticias.filter((n) => n.categoria === categoria)
        : noticias;

    return new Response(JSON.stringify({ noticias: noticiasFiltradas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching noticias:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
