import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./env", () => ({
  appEnv: {
    VITE_SUPABASE_URL: "https://example.supabase.co/",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  },
  isDemoMode: false,
}));

import { invokeMonitoringFunction } from "./monitoringShared";

function signedInClient(): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-access-token" } },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

afterEach(() => vi.unstubAllGlobals());

describe("monitoring function requests", () => {
  it("uses the signed-in function request and surfaces endpoint errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "missing_credentials", message: "Use the checklist or demo option." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("payload", "{}");

    await expect(invokeMonitoringFunction(signedInClient(), "plant-doctor", form))
      .rejects.toMatchObject({ code: "missing_credentials", message: "Use the checklist or demo option." });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/plant-doctor",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-access-token",
          apikey: "test-publishable-key",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reports a timed-out vision function instead of returning fallback data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
    await expect(invokeMonitoringFunction(signedInClient(), "growth-check", new FormData()))
      .rejects.toMatchObject({ code: "timeout" });
  });
});
