import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// LIMITACIÓN DE GOOGLE (no es un bug nuestro):
// Places API (Details) devuelve como MÁXIMO 5 reseñas por lugar y no admite
// paginación. No existe parámetro para pedir más. Para traer el histórico
// completo de la ficha hace falta Google Business Profile API (OAuth como
// propietario verificado de la ficha), que es otra integración distinta.
const GOOGLE_MAX_REVIEWS = 5;

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

    const placeId: string = config.place_id;

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
    let skipped = 0;
    const errors: string[] = [];

    for (const review of reviews) {
      // review.name viene como "places/{placeId}/reviews/{reviewId}".
      // Guardamos SOLO el último segmento: así la deduplicación sigue funcionando
      // aunque Google migre el place_id de la ficha (si guardásemos el nombre
      // completo, un cambio de place_id duplicaría todas las reseñas).
      const rawName: string | undefined = review.name;
      const googleReviewId = rawName
        ? rawName.split("/").pop()!
        : `${placeId}_${review.authorAttribution?.displayName ?? "anon"}_${review.publishTime ?? ""}`;

      const authorName: string = review.authorAttribution?.displayName ?? "Anónimo";
      const text: string = review.text?.text ?? review.originalText?.text ?? "";
      const publishTime: string = review.publishTime ?? new Date().toISOString();
      const fecha = publishTime.split("T")[0];

      // La tabla tiene CHECK (valoracion >= 1 AND valoracion <= 5). Si Google no
      // manda rating, el antiguo `?? 0` producía un INSERT que la BD rechazaba
      // en silencio (el error nunca se leía) y el contador mentía.
      const rawRating = Number(review.rating);
      if (!Number.isFinite(rawRating) || rawRating < 1 || rawRating > 5) {
        skipped++;
        errors.push(`Reseña ${googleReviewId} descartada: valoración inválida (${review.rating})`);
        continue;
      }
      const rating = Math.round(rawRating);

      const insertPayload = {
        nombre_cliente: authorName,
        valoracion: rating,
        // Mejor NULL que cadena vacía: las reseñas sin texto no deben pintarse
        // como tarjetas vacías en la web.
        comentario: text.trim() ? text : null,
        fuente: "google",
        fecha,
        google_review_id: googleReviewId,
        google_rating: rawRating,
        estado: "publicada",
        updated_at: new Date().toISOString(),
      };

      // No usamos .maybeSingle(): google_review_id NO tiene índice UNIQUE, así
      // que si alguna vez hubiera dos filas con el mismo id, maybeSingle()
      // reventaría la sincronización entera. Con limit(1) es tolerante.
      const { data: existingRows, error: selectError } = await supabaseClient
        .from("resenas")
        .select("id, comentario, valoracion")
        .eq("google_review_id", googleReviewId)
        .limit(1);

      if (selectError) {
        errors.push(`Error buscando ${googleReviewId}: ${selectError.message}`);
        continue;
      }

      const existing = existingRows?.[0];

      if (!existing) {
        const { error: insertError } = await supabaseClient.from("resenas").insert(insertPayload);
        if (insertError) {
          errors.push(`Error insertando ${googleReviewId}: ${insertError.message}`);
          continue;
        }
        synced++;
      } else if (existing.comentario !== insertPayload.comentario || existing.valoracion !== rating) {
        // Si el texto o la puntuación cambiaron, actualizamos SOLO esa fila.
        const { error: updateError } = await supabaseClient
          .from("resenas")
          .update({
            comentario: insertPayload.comentario,
            valoracion: rating,
            google_rating: rawRating,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (updateError) {
          errors.push(`Error actualizando ${googleReviewId}: ${updateError.message}`);
          continue;
        }
        updated++;
      }
    }

    // ── Actualizar estadísticas en config ────────────────────────────────────
    const { error: configUpdateError } = await supabaseClient
      .from("config_google_places")
      .update({
        total_resenas: totalCount,
        rating_promedio: overallRating,
        ultima_sincronizacion: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    if (configUpdateError) {
      errors.push(`Error actualizando config: ${configUpdateError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        reviews_found: reviews.length,
        reviews_inserted: synced,
        reviews_updated: updated,
        reviews_skipped: skipped,
        errors,
        // `total_count` es el nº de reseñas que Google dice que tiene la ficha;
        // `reviews_found` es cuántas nos deja descargar (tope de 5).
        overall_rating: overallRating,
        total_count: totalCount,
        google_api_limit: GOOGLE_MAX_REVIEWS,
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
