import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData } from "../domain/types";
import type { Database } from "./database.types";
import { DEMO_STORAGE_KEY } from "./demo";
import { appEnv, isDemoMode } from "./env";

let clientPromise: Promise<SupabaseClient<Database> | null> | undefined;

export function getSupabaseClient(): Promise<SupabaseClient<Database> | null> {
  const url = appEnv.VITE_SUPABASE_URL;
  const publishableKey = appEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (isDemoMode || !url || !publishableKey) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) => createClient<Database>(
      url,
      publishableKey,
      { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } },
    ));
  }
  return clientPromise;
}

export function loadDemoData(fallback: AppData): AppData {
  const serialized = window.localStorage.getItem(DEMO_STORAGE_KEY);
  if (!serialized) return fallback;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (isAppData(parsed)) return parsed;
    throw new Error("Saved demo data has an invalid shape.");
  } catch (error) {
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    console.error("Could not restore saved demo data.", error);
    return fallback;
  }
}

export function saveDemoData(data: AppData): void {
  const toSave: AppData = {
    ...data,
    issueEpisodes: data.issueEpisodes ?? [],
    growthChecks: data.growthChecks ?? [],
  };
  window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(toSave));
}

function isAppData(value: unknown): value is AppData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.plants) || !Array.isArray(candidate.discoveries)) return false;
  if (candidate.issueEpisodes !== undefined && !Array.isArray(candidate.issueEpisodes)) return false;
  if (candidate.growthChecks !== undefined && !Array.isArray(candidate.growthChecks)) return false;
  return true;
}
