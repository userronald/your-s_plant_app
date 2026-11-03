import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createIdentifyPlantHandler } from "../_shared/identify-handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const plantNetApiKey = Deno.env.get("PLANTNET_API_KEY");
const allowedOrigins = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

function numberSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function estimatedCost(): number | null {
  const raw = Deno.env.get("PLANTNET_ESTIMATED_COST_EUR");
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("PLANTNET_ESTIMATED_COST_EUR must be a non-negative number.");
  }
  return value;
}

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

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(origin);
  if (origin && !allowedOrigins.includes(origin)) {
    return jsonResponse(403, { code: "origin_not_allowed", message: "This app origin is not allowed." }, null);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error(JSON.stringify({ event: "plant_identification_not_configured", code: "missing_supabase_secrets" }));
    return jsonResponse(503, { code: "missing_credentials", message: "Plant identification is not configured. No images were processed." }, origin);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const handler = createIdentifyPlantHandler({
      apiKey: plantNetApiKey,
      project: Deno.env.get("PLANTNET_PROJECT") || "all",
      minimumMatchScore: numberSetting("PLANTNET_MINIMUM_MATCH_SCORE", 0.15, 0, 1),
      ambiguousGap: numberSetting("PLANTNET_AMBIGUOUS_SCORE_GAP", 0.08, 0, 1),
      timeoutMs: numberSetting("PLANTNET_TIMEOUT_MS", 20000, 1000, 60000),
      estimatedCostEur: estimatedCost(),
      authenticate: async (incomingRequest) => {
        const token = incomingRequest.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) return null;
        const userClient = createClient(supabaseUrl, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data, error } = await userClient.auth.getUser(token);
        if (error || !data.user) return null;
        return data.user.id;
      },
      reserve: async (ownerId) => {
        const { data, error } = await admin.rpc("reserve_plant_identification", {
          p_owner_id: ownerId,
          p_user_per_minute: numberSetting("PLANTNET_USER_PER_MINUTE", 5, 1, 100),
          p_user_per_day: numberSetting("PLANTNET_USER_PER_DAY", 20, 1, 1000),
          p_provider_per_day: numberSetting("PLANTNET_APP_DAILY_LIMIT", 450, 1, 500000),
          p_max_concurrent: numberSetting("PLANTNET_MAX_CONCURRENT", 20, 1, 20),
        });
        if (error) throw new Error(`Could not reserve identification quota: ${error.message}`);
        if (typeof data !== "object" || data === null || !("allowed" in data) || typeof data.allowed !== "boolean") {
          throw new Error("The identification rate-limit reservation returned an invalid response.");
        }
        if (!data.allowed) {
          return { allowed: false, reason: "reason" in data && typeof data.reason === "string" ? data.reason : "limit" };
        }
        if (!("request_id" in data) || typeof data.request_id !== "string") {
          throw new Error("The identification rate-limit reservation did not return a request ID.");
        }
        return { allowed: true, requestId: data.request_id };
      },
      complete: async (requestId, completion) => {
        const { error } = await admin.from("identification_requests").update({
          status: completion.status,
          image_count: completion.imageCount,
          latency_ms: completion.latencyMs,
          provider_version: completion.providerVersion,
          estimated_cost_eur: completion.estimatedCostEur,
          error_code: completion.errorCode,
          completed_at: new Date().toISOString(),
        }).eq("id", requestId);
        if (error) throw new Error(`Could not persist identification usage: ${error.message}`);
      },
    });
    const response = await handler(request);
    response.headers.set("Access-Control-Allow-Origin", origin ?? allowedOrigins[0] ?? "");
    response.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set("Vary", "Origin");
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: "plant_identification_endpoint_error",
      message: error instanceof Error ? error.message : "unknown endpoint error",
    }));
    return jsonResponse(500, { code: "endpoint_error", message: "Plant identification is temporarily unavailable. Please try again later." }, origin);
  }
});
