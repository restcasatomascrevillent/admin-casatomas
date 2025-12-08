import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { points, canvasWidth, canvasHeight, pixelsPerMeter } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Convertir puntos a metros para el prompt
    const pointsInMeters = points.map((p: { x: number; y: number }) => ({
      x: (p.x / pixelsPerMeter).toFixed(2),
      y: (p.y / pixelsPerMeter).toFixed(2),
    }));

    const prompt = `Eres un experto en arquitectura y diseño de planos. Te doy una serie de puntos que representan un dibujo a mano alzada del perímetro de un espacio (restaurante, sala, etc).

Los puntos están en metros. El canvas tiene ${(canvasWidth / pixelsPerMeter).toFixed(1)}m x ${(canvasHeight / pixelsPerMeter).toFixed(1)}m.

Puntos del dibujo (cada 10 puntos aprox del trazo):
${JSON.stringify(pointsInMeters.slice(0, 100), null, 2)}

Tu tarea es:
1. Analizar estos puntos y detectar las paredes del perímetro
2. Simplificar el trazo a líneas rectas (paredes)
3. Identificar las esquinas principales
4. Devolver las paredes como segmentos de línea

IMPORTANTE: Responde SOLO con un JSON válido en este formato exacto, sin texto adicional:
{
  "walls": [
    { "x1": 0, "y1": 0, "x2": 5, "y2": 0, "length": 5.0 },
    { "x1": 5, "y1": 0, "x2": 5, "y2": 4, "length": 4.0 }
  ],
  "corners": [
    { "x": 0, "y": 0 },
    { "x": 5, "y": 0 }
  ],
  "perimeter": 18.0,
  "area": 20.0
}

Las coordenadas deben estar en metros. Intenta crear un perímetro cerrado y coherente.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Extraer JSON de la respuesta
    let result;
    try {
      // Intentar parsear directamente
      result = JSON.parse(content);
    } catch {
      // Buscar JSON en el contenido
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No se pudo extraer JSON válido de la respuesta");
      }
    }

    // Convertir metros de vuelta a píxeles
    const wallsInPixels = result.walls.map((wall: any) => ({
      x1: parseFloat(wall.x1) * pixelsPerMeter,
      y1: parseFloat(wall.y1) * pixelsPerMeter,
      x2: parseFloat(wall.x2) * pixelsPerMeter,
      y2: parseFloat(wall.y2) * pixelsPerMeter,
      lengthMeters: parseFloat(wall.length),
    }));

    const cornersInPixels = result.corners.map((corner: any) => ({
      x: parseFloat(corner.x) * pixelsPerMeter,
      y: parseFloat(corner.y) * pixelsPerMeter,
    }));

    return new Response(JSON.stringify({
      walls: wallsInPixels,
      corners: cornersInPixels,
      perimeter: result.perimeter,
      area: result.area,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error processing drawing:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Error processing drawing" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
