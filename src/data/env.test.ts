import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Supabase mode configuration", () => {
  it("requires both URL and publishable key before enabling cloud mode", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    await vi.resetModules();

    await expect(import("./env")).rejects.toThrow("Set the Supabase project URL");
  });

  it("accepts configured cloud mode and never creates a cloud client in demo mode", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    vi.stubEnv("VITE_SUPABASE_URL", "https://plants.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-placeholder");
    await vi.resetModules();
    const { isDemoMode } = await import("./env");
    const { getSupabaseClient } = await import("./persistence");
    expect(isDemoMode).toBe(true);
    await expect(getSupabaseClient()).resolves.toBeNull();
  });

  it("accepts cloud mode when both browser-safe credentials are configured", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    vi.stubEnv("VITE_SUPABASE_URL", "https://plants.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-placeholder");
    await vi.resetModules();

    const { appEnv, isDemoMode } = await import("./env");
    expect(isDemoMode).toBe(false);
    expect(appEnv.VITE_SUPABASE_PUBLISHABLE_KEY).toBe("public-placeholder");
  });
});
