import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const googleApiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (!googleApiKey) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_PLACES_API_KEY secret not configured in Supabase" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener configuración de Google Places
    const { data: config, error: configError } = await supabaseClient
      .from("config_google_places")
      .select("*")
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: "No Google Places configuration found in config_google_places table" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const placeId = config.place_id;

    // ── Google Places API (New) → Place Details ─────────────────────────────
    // Usamos la API v1 que devuelve los campos de reseñas
    const placesUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=displayName,rating,userRatingCount,reviews&languageCode=es`;

    const placesRes = await fetch(placesUrl, {
      headers: {
        "X-Goog-Api-Key": googleApiKey,
      },
    });

    if (!placesRes.ok) {
      const errText = await placesRes.text();
      console.error("Google Places API error:", errText);
      return new Response(
        JSON.stringify({ error: `Google Places API error: ${placesRes.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const placesData = await placesRes.json();
    const reviews: any[] = placesData.reviews ?? [];
    const overallRating: number = placesData.rating ?? config.rating_promedio ?? 0;
    const totalCount: number = placesData.userRatingCount ?? config.total_resenas ?? 0;

    // ── Upsert reseñas ───────────────────────────────────────────────────────
    let synced = 0;
    let updated = 0;

    for (const review of reviews) {
      // El ID único en Google Places (New) viene en review.name  p.ej. places/ChIJ.../reviews/Axxxxxxxxx
      const googleReviewId = review.name ?? `${placeId}_${review.authorAttribution?.displayName}_${review.publishTime}`;
      const authorName: string = review.authorAttribution?.displayName ?? "Anónimo";
      const rating: number = review.rating ?? 0;
      const text: string = review.text?.text ?? review.originalText?.text ?? "";
      const publishTime: string = review.publishTime ?? new Date().toISOString();
      const fecha = publishTime.split("T")[0];

      const upsertPayload = {
        nombre_cliente: authorName,
        valoracion: rating,
        comentario: text,
        fuente: "google",
        fecha,
        google_review_id: googleReviewId,
        google_rating: rating,
        estado: "publicada",
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabaseClient
        .from("resenas")
        .select("id, comentario")
        .eq("google_review_id", googleReviewId)
        .maybeSingle();

      if (!existing) {
        await supabaseClient.from("resenas").insert(upsertPayload);
        synced++;
      } else if (existing.comentario !== text) {
        // Si el texto cambió, actualizamos
        await supabaseClient
          .from("resenas")
          .update({ comentario: text, google_rating: rating, updated_at: new Date().toISOString() })
          .eq("google_review_id", googleReviewId);
        updated++;
      }
    }

    // ── Actualizar estadísticas en config ────────────────────────────────────
    await supabaseClient
      .from("config_google_places")
      .update({
        total_resenas: totalCount,
        rating_promedio: overallRating,
        ultima_sincronizacion: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    return new Response(
      JSON.stringify({
        success: true,
        reviews_found: reviews.length,
        reviews_inserted: synced,
        reviews_updated: updated,
        overall_rating: overallRating,
        total_count: totalCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("sync-google-reviews error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
