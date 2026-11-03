import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.24.1";
import { requestVisionJson, uploadedImage, VisionRequestError } from "../_shared/vision.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const payloadSchema = z.object({
  plantId: z.string().min(1).max(120),
  note: z.string().max(1000).optional().default(""),
});

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(status: number, body: Record<string, unknown>, origin: string | null): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function errorMessage(status: number, code: string, message: string, origin: string | null): Response {
  return jsonResponse(status, { code, message }, origin);
}

function isImage(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png" && type !== "image/webp") return false;
  if (file.size < 1 || file.size > 8 * 1024 * 1024) return false;
  return true;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(origin);
  if (origin && !allowedOrigins.includes(origin)) {
    return errorMessage(403, "origin_not_allowed", "This app origin is not allowed.", null);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return errorMessage(503, "missing_credentials", "Growth comparison is not configured. Use the checklist or demo option.", origin);
  }

  try {
    const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return errorMessage(401, "unauthorized", "Sign in to use live comparison, or choose the demo or checklist option.", origin);
    const userClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return errorMessage(401, "unauthorized", "Sign in to use live comparison, or choose the demo or checklist option.", origin);

    let form: FormData;
    try { form = await request.formData(); } catch {
      return errorMessage(400, "invalid_upload", "The request could not be read. Try again.", origin);
    }
    const payloadRaw = form.get("payload");
    if (typeof payloadRaw !== "string") return errorMessage(400, "invalid_upload", "Missing comparison details.", origin);
    let payloadJson: unknown;
    try { payloadJson = JSON.parse(payloadRaw); } catch {
      return errorMessage(400, "invalid_upload", "Comparison details could not be parsed.", origin);
    }
    const parsedPayload = payloadSchema.safeParse(payloadJson);
    if (!parsedPayload.success) return errorMessage(400, "invalid_upload", "Comparison details are invalid.", origin);

    const images = form.getAll("images");
    if (images.length < 1 || images.length > 2) return errorMessage(400, "invalid_upload", "Choose one or two new photos for this check-in.", origin);
    for (const image of images) {
      if (!(image instanceof File) || !isImage(image)) return errorMessage(400, "invalid_upload", "Only JPG, PNG, or WEBP images up to 8 MB are supported.", origin);
    }
    const previousValue = form.get("previous");
    if (previousValue !== null && (!(previousValue instanceof File) || !isImage(previousValue))) {
      return errorMessage(400, "invalid_upload", "The earlier photo could not be read. Continue without a comparison or choose another photo.", origin);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: plant, error: plantError } = await admin.from("plant_instances")
      .select("id").eq("id", parsedPayload.data.plantId).eq("owner_id", userData.user.id).is("archived_at", null).maybeSingle();
    if (plantError) return errorMessage(500, "plant_lookup_failed", "The selected plant could not be verified.", origin);
    if (!plant) return errorMessage(404, "plant_not_found", "The selected plant is not available in this account.", origin);

    const apiKey = Deno.env.get("GROWTH_CHECK_API_KEY") ?? Deno.env.get("VISION_API_KEY");
    if (!apiKey) {
      return errorMessage(503, "missing_credentials", "Live growth comparison is not configured. Use the demo or checklist option.", origin);
    }

    const previous = previousValue instanceof File ? previousValue : null;
    const startedAt = performance.now();
    const prompt = [
      "Describe only defensible visual observations from the supplied plant photo(s). Return JSON with exactly:",
      "summary:string; visibleObservations:string[]; cannotDetermine:string[]; changes:array (0-6) of {aspect:string, observation:string}; caveats:string[]; comparedWithPrevious:boolean.",
      previous
        ? "The first image is the earlier dated photo; subsequent images are the new check-in. Report only possible visible differences; if angle, lighting, distance, framing, or quality prevent a fair comparison, say so and report no change rather than guessing."
        : "There is no earlier image. Treat the image(s) as a baseline and set comparedWithPrevious false. Do not claim change or growth.",
      "Never claim precise biological growth, height, area, leaf counts, rate, or health trend from uncalibrated 2D images. Changes are possible visual observations, not measurements. Explicitly mention image-quality and perspective uncertainty.",
        `User note (not image-verified, and stored separately): ${parsedPayload.data.note}. Do not repeat it as a visible observation unless independently confirmed in the image.`,
    ].join("\n");
    const orderedImages = [
      ...(previous ? [previous] : []),
      ...images as File[],
    ];
    const vision = await requestVisionJson(
      apiKey,
      "You are a cautious visual comparison assistant. Do not infer more than the images show.",
      prompt,
      await Promise.all(orderedImages.map(uploadedImage)),
    );
    let modelOutput: unknown;
    try { modelOutput = JSON.parse(vision.content); } catch {
      return errorMessage(502, "invalid_model_response", "The comparison service returned an invalid response. Try the checklist or demo option.", origin);
    }
    const parsedObservation = observationSchema.safeParse(modelOutput);
    if (!parsedObservation.success || parsedObservation.data.comparedWithPrevious !== Boolean(previous)) {
      return errorMessage(502, "invalid_model_response", "The comparison service returned an invalid response. Try the checklist or demo option.", origin);
    }
    const textToCheck = [
      parsedObservation.data.summary,
      ...parsedObservation.data.visibleObservations,
      ...parsedObservation.data.changes.map((change) => change.observation),
    ];
    if (textToCheck.some((text) => /\b\d+(?:\.\d+)?\s*(?:(?:mm|cm|inches?|percent|leaves?|leaf count)\b|%)|\b(?:growth rate|grew by|growth of)\b/i.test(text))) {
      return errorMessage(502, "invalid_model_response", "The comparison service returned an unsupported measurement. Try the checklist or demo option.", origin);
    }
    const observation = {
      ...parsedObservation.data,
      changes: previous ? parsedObservation.data.changes : [],
      caveats: [
        ...parsedObservation.data.caveats,
        "Different camera angles, lighting, distance, framing, and image quality can create apparent changes.",
        "No calibrated measurement or precise biological growth is inferred from these 2D images.",
      ].slice(0, 8),
      cannotDetermine: [
        ...parsedObservation.data.cannotDetermine,
        "Precise biological growth, size, leaf count, or growth rate.",
      ].slice(0, 8),
    };
    const response = jsonResponse(200, {
      contractVersion: "1",
      provider: vision.provider,
      model: vision.model,
      resultMode: "live",
      elapsedMs: Math.round(performance.now() - startedAt),
      observation,
      disclaimer: "AI observations describe visible differences between the provided photos. They are not measurements, and angle, lighting, distance, and image quality can mislead.",
    }, origin);
    response.headers.set("Access-Control-Allow-Origin", origin ?? allowedOrigins[0] ?? "");
    response.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set("Vary", "Origin");
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "growth_check_endpoint_error", message: error instanceof Error ? error.message : "unknown" }));
    if (error instanceof VisionRequestError) return errorMessage(error.status, "vision_unavailable", error.message, origin);
    return errorMessage(500, "endpoint_error", "Growth comparison is temporarily unavailable. Please try the demo or checklist option.", origin);
  }
});
