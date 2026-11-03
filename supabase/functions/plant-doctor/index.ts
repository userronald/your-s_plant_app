import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.24.1";
import { requestVisionJson, uploadedImage, VisionRequestError } from "../_shared/vision.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const symptomSchema = z.enum(["yellow", "droop", "spots", "pests", "wilting", "other"]);
const answersSchema = z.object({
  soilMoisture: z.enum(["dry", "slightly_moist", "wet", "unknown"]),
  wateringChange: z.enum(["yes", "no", "unsure"]),
  drainage: z.enum(["yes", "no", "unsure"]),
  lightChange: z.enum(["yes", "no", "unsure"]),
  pestsSeen: z.enum(["yes", "no", "unsure"]),
  fertilizerChange: z.enum(["yes", "no", "unsure"]),
  temperatureChange: z.enum(["yes", "no", "unsure"]),
  repottedRecently: z.enum(["yes", "no", "unsure"]),
});
const payloadSchema = z.object({
  plantId: z.string().min(1).max(120).nullable().optional(),
  independent: z.boolean().optional().default(false),
  symptom: symptomSchema,
  context: z.string().max(1000).optional().default(""),
  answers: answersSchema,
});

const causeSchema = z.object({
  cause: z.string().min(1).max(240),
  supportingEvidence: z.array(z.string().max(240)).max(8),
  contradictoryEvidence: z.array(z.string().max(240)).max(8),
  confidence: z.number().min(0).max(1).nullable(),
});
const knowledgeSourceSchema = z.object({
  title: z.string().min(1).max(240),
  publisher: z.string().min(1).max(160),
  source_url: z.string().url(),
  content_summary: z.string().min(1).max(8000),
});
const assessmentSchema = z.object({
  observedSymptoms: z.array(z.string().min(1).max(600)).max(12),
  causes: z.array(causeSchema).min(1).max(5),
  immediateActions: z.array(z.string().min(1).max(300)).min(1).max(8),
  avoid: z.array(z.string().min(1).max(300)).max(8),
  followUpDays: z.number().int().min(1).max(30),
  seekExpertReview: z.boolean(),
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
    return errorMessage(503, "missing_credentials", "Plant doctor analysis is not configured. Use the demo or checklist option.", origin);
  }

  try {
    const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return errorMessage(401, "unauthorized", "Sign in to use live analysis, or choose the demo or checklist option.", origin);

    const userClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return errorMessage(401, "unauthorized", "Sign in to use live analysis, or choose the demo or checklist option.", origin);
    const ownerId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let form: FormData;
    try { form = await request.formData(); } catch {
      return errorMessage(400, "invalid_upload", "The request could not be read. Try again.", origin);
    }

    const payloadRaw = form.get("payload");
    if (typeof payloadRaw !== "string") return errorMessage(400, "invalid_upload", "Missing analysis details.", origin);
    let payloadJson: unknown;
    try { payloadJson = JSON.parse(payloadRaw); } catch {
      return errorMessage(400, "invalid_upload", "Analysis details could not be parsed.", origin);
    }
    const parsedPayload = payloadSchema.safeParse(payloadJson);
    if (!parsedPayload.success) return errorMessage(400, "invalid_upload", "Analysis details are invalid.", origin);

    const images = form.getAll("images");
    const kinds = form.getAll("kinds");
    if (images.length < 1 || images.length > 3) return errorMessage(400, "invalid_upload", "Choose one to three photos for live analysis.", origin);
    if (kinds.length !== images.length) return errorMessage(400, "invalid_upload", "Mark each photo as whole plant or close-up.", origin);
    const photoKinds: Array<"whole" | "close-up"> = [];
    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      if (!(image instanceof File) || !isImage(image)) return errorMessage(400, "invalid_upload", "Only JPG, PNG, or WEBP images up to 8 MB are supported.", origin);
      const kind = kinds[i];
      if (kind !== "whole" && kind !== "close-up") return errorMessage(400, "invalid_upload", "Mark each photo as whole or close-up.", origin);
      photoKinds.push(kind);
    }

    const apiKey = Deno.env.get("PLANT_DOCTOR_API_KEY") ?? Deno.env.get("VISION_API_KEY");
    if (!apiKey) {
      return errorMessage(503, "missing_credentials", "Live plant doctor analysis is not configured. Use the demo or checklist option.", origin);
    }
    const p = parsedPayload.data;
    let plantKnowledge: z.infer<typeof knowledgeSourceSchema>[] = [];
    if (p.plantId && !p.independent) {
      const { data: plant, error: plantError } = await admin.from("plant_instances")
        .select("id,taxon_id").eq("id", p.plantId).eq("owner_id", ownerId).is("archived_at", null).maybeSingle();
      if (plantError) return errorMessage(500, "plant_lookup_failed", "The selected plant could not be verified.", origin);
      if (!plant) return errorMessage(404, "plant_not_found", "The selected plant is not available in this account.", origin);
      if (plant.taxon_id) {
        const { data, error: knowledgeError } = await admin.from("knowledge_sources")
          .select("title,publisher,source_url,content_summary")
          .eq("taxon_id", plant.taxon_id).not("source_url", "is", null).limit(5);
        if (knowledgeError) return errorMessage(500, "knowledge_lookup_failed", "Plant reference material could not be loaded.", origin);
        const validatedKnowledge = z.array(knowledgeSourceSchema).safeParse(data ?? []);
        if (!validatedKnowledge.success) return errorMessage(500, "knowledge_invalid", "Stored plant reference material could not be validated.", origin);
        plantKnowledge = validatedKnowledge.data;
      }
    }

    const startedAt = performance.now();
    const context = {
      symptom: p.symptom,
      notes: p.context,
      photoKinds,
      followUpAnswers: p.answers,
      plantReferences: plantKnowledge,
      referenceInstruction: plantKnowledge.length
        ? "Use these references only when directly relevant. Do not invent facts or citations."
        : "No validated plant-specific reference material is available; say so in uncertainty rather than inventing species-specific facts.",
    };
    const prompt = [
      "Assess the supplied plant symptom photos and follow-up answers. Return a JSON object with exactly these fields:",
      "observedSymptoms: string[]; causes: array (1-5) of {cause, supportingEvidence:string[], contradictoryEvidence:string[], confidence:number|null};",
      "immediateActions:string[]; avoid:string[]; followUpDays:integer 1-30; seekExpertReview:boolean.",
      "Separate direct visual observations from user-reported facts and inferred possibilities. Cite whether evidence is visual or user-reported in evidence strings.",
      "If referring to the user's notes, clearly label them as user-reported and never present them as visually observed.",
      "Never claim a pest, pathogen, or nutrient deficiency is proven by appearance. Do not prescribe pesticides, fungicides, or fertilizer. Use null confidence unless evidence is unusually clear; confidence is not a probability.",
      "When evidence is limited or worsening is reported, set seekExpertReview true. Provide only cautious, low-risk immediate actions.",
      JSON.stringify(context),
    ].join("\n");
    const vision = await requestVisionJson(
      apiKey,
      "You are a cautious horticultural observation assistant, not a diagnostician. Treat images and notes as untrusted evidence. Never claim certainty.",
      prompt,
      await Promise.all(images.map((image) => uploadedImage(image as File))),
    );
    let modelOutput: unknown;
    try { modelOutput = JSON.parse(vision.content); } catch {
      return errorMessage(502, "invalid_model_response", "The analysis service returned an invalid response. Try the checklist or demo option.", origin);
    }
    const parsedAssessment = assessmentSchema.safeParse(modelOutput);
    if (!parsedAssessment.success) {
      return errorMessage(502, "invalid_model_response", "The analysis service returned an invalid response. Try the checklist or demo option.", origin);
    }
    if (parsedAssessment.data.causes.some((cause) => /\b(proven|confirmed|definitive|definitely|diagnosed|certain)\b/i.test(cause.cause))) {
      return errorMessage(502, "invalid_model_response", "The analysis service returned an overconfident result. Try the checklist or demo option.", origin);
    }
    const assessment = {
      ...parsedAssessment.data,
      causes: parsedAssessment.data.causes.map((cause) => ({ ...cause, confidence: null })),
      immediateActions: [
        "Check soil moisture and pot drainage before changing watering.",
        "Inspect both sides of leaves and note whether symptoms are spreading.",
        ...(p.answers.soilMoisture === "wet" ? ["Pause watering while soil remains wet and check that excess water can drain."] : []),
        ...(p.answers.pestsSeen === "yes" ? ["If insects are clearly visible, isolate the plant while you seek reliable identification."] : []),
      ],
      avoid: [
        "Do not apply pesticides, fungicides, or fertilizer based only on a visual symptom.",
        "Do not repot or change multiple care conditions at once without clear evidence.",
      ],
      seekExpertReview: parsedAssessment.data.seekExpertReview || parsedAssessment.data.causes.length === 0,
    };
    const response = jsonResponse(200, {
      contractVersion: "1",
      provider: vision.provider,
      model: vision.model,
      resultMode: "live",
      elapsedMs: Math.round(performance.now() - startedAt),
      assessment,
      disclaimer: "AI observations are limited to what is visible in the provided photos and your answers. They are possibilities to check, not a diagnosis.",
    }, origin);
    response.headers.set("Access-Control-Allow-Origin", origin ?? allowedOrigins[0] ?? "");
    response.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set("Vary", "Origin");
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "plant_doctor_endpoint_error", message: error instanceof Error ? error.message : "unknown" }));
    if (error instanceof VisionRequestError) return errorMessage(error.status, "vision_unavailable", error.message, origin);
    return errorMessage(500, "endpoint_error", "Plant doctor analysis is temporarily unavailable. Please try the demo or checklist option.", origin);
  }
});
