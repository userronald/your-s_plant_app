import { getSupabaseClient } from "./persistence";
import { appEnv } from "./env";
import type { SupabaseClient } from "@supabase/supabase-js";

export class MonitoringRequestError extends Error {
  readonly code: string;

  constructor(message: string, code = "monitoring_request_failed") {
    super(message);
    this.name = "MonitoringRequestError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function readFunctionError(error: { message: string; context?: unknown }): Promise<MonitoringRequestError> {
  const context = error.context;
  if (context instanceof Response) {
    try {
      const body: unknown = await context.json();
      if (isRecord(body) && typeof body.message === "string") {
        return new MonitoringRequestError(body.message, typeof body.code === "string" ? body.code : "monitoring_request_failed");
      }
    } catch {
      return new MonitoringRequestError(error.message || "The monitoring service could not complete the request.");
    }
  }
  return new MonitoringRequestError(error.message || "The monitoring service could not complete the request.");
}

export async function signedInSupabase(): Promise<Awaited<ReturnType<typeof getSupabaseClient>>> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    throw new MonitoringRequestError("Live analysis needs a configured Supabase account. Use the demo or checklist option on this device.", "not_configured");
  }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new MonitoringRequestError(`Could not check your sign-in: ${error.message}`, "session_error");
  if (!session) {
    throw new MonitoringRequestError("Sign in to use live analysis, or choose the demo or checklist option. Demo results are not based on your photos.", "not_signed_in");
  }
  return supabase;
}

export async function invokeMonitoringFunction(
  supabase: SupabaseClient,
  name: "plant-doctor" | "growth-check",
  body: FormData,
): Promise<unknown> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new MonitoringRequestError(`Could not check your sign-in: ${sessionError.message}`, "session_error");
  if (!session) throw new MonitoringRequestError("Sign in to use live plant monitoring.", "not_signed_in");
  if (!appEnv.VITE_SUPABASE_URL || !appEnv.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new MonitoringRequestError("Live analysis is not configured. Use the demo or checklist option.", "not_configured");
  }

  let response: Response;
  try {
    response = await fetch(`${appEnv.VITE_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: appEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new MonitoringRequestError("The analysis took too long. Please try again or use the checklist/demo option.", "timeout");
    }
    throw new MonitoringRequestError("The analysis service is temporarily unavailable. Please try again or use the checklist/demo option.", "network_error");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new MonitoringRequestError("The analysis service returned an invalid response.", "invalid_response");
  }
  if (!response.ok) {
    if (isRecord(data) && typeof data.message === "string") {
      throw new MonitoringRequestError(data.message, typeof data.code === "string" ? data.code : "monitoring_request_failed");
    }
    throw new MonitoringRequestError(`The analysis service failed (${response.status}).`, "monitoring_request_failed");
  }
  return data;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new MonitoringRequestError("The selected image could not be read."));
    };
    reader.onerror = () => reject(new MonitoringRequestError("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

export async function urlToFile(url: string, name: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return null;
    return new File([blob], name, { type: blob.type, lastModified: Date.now() });
  } catch {
    return null;
  }
}
