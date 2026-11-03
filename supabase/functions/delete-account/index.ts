import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const configuredOrigins = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

function jsonResponse(status: number, body: Record<string, string>, origin: string | null): Response {
  const allowedOrigin = origin && configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });
}

function preflightResponse(origin: string | null): Response {
  const allowedOrigin = origin && configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });
}

function hasRecentAuthentication(token: string): boolean {
  try {
    const encodedClaims = token.split(".")[1];
    if (!encodedClaims) return false;
    const base64 = encodedClaims.replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (typeof claims !== "object" || claims === null || !("auth_time" in claims)) return false;
    const authTime = claims.auth_time;
    const now = Math.floor(Date.now() / 1000);
    return typeof authTime === "number" && authTime <= now + 60 && now - authTime <= 15 * 60;
  } catch {
    return false;
  }
}

async function collectUserObjectPaths(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const directories = [prefix];
  while (directories.length) {
    const directory = directories.pop();
    if (!directory) continue;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await admin.storage.from(bucket).list(directory, { limit: 100, offset });
      if (error) throw new Error(`Could not list private storage objects: ${error.message}`);
      const entries = data ?? [];
      for (const entry of entries) {
        const path = `${directory}/${entry.name}`;
        if (entry.id === null) directories.push(path);
        else paths.push(path);
      }
      if (entries.length < 100) break;
    }
  }
  return paths;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && !configuredOrigins.includes(origin)) {
    return jsonResponse(403, { error: "Origin is not allowed." }, origin);
  }
  if (request.method === "OPTIONS") return preflightResponse(origin);
  if (request.method !== "POST") return jsonResponse(405, { error: "Use POST to request account deletion." }, origin);
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error("Account deletion function is missing required server configuration.");
    return jsonResponse(503, { error: "Account deletion is not configured. No account data was changed." }, origin);
  }
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return jsonResponse(401, { error: "Sign in to delete your account." }, origin);

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return jsonResponse(401, { error: "Your session could not be verified." }, origin);
  if (!hasRecentAuthentication(token)) {
    return jsonResponse(403, { error: "Sign in again before deleting your account. No account data was changed." }, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: photoBucket, error: bucketError } = await admin.storage.getBucket("plant-photos");
    if (bucketError && bucketError.message !== "Bucket not found") {
      throw new Error(`Could not inspect private photo storage: ${bucketError.message}`);
    }
    if (photoBucket) {
      const paths = await collectUserObjectPaths(admin, photoBucket.name, user.id);
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await admin.storage.from(photoBucket.name).remove(paths.slice(index, index + 100));
        if (error) throw new Error(`Could not remove private photos: ${error.message}`);
      }
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error(`Private files were removed but account deletion failed: ${deleteError.message}`);
    return jsonResponse(200, { status: "deleted" }, origin);
  } catch (error) {
    console.error("Account deletion failed.", error);
    const message = error instanceof Error ? error.message : "Account deletion could not be completed.";
    return jsonResponse(500, { error: `${message}. The account itself was not deleted unless otherwise stated.` }, origin);
  }
});
