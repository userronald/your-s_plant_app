import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlantAssistantHistory, PlantAssistantError } from "./plantAssistant";
import { validateAssistantImage } from "../../supabase/functions/_shared/assistant-validation";

vi.mock("./persistence", () => ({
  getSupabaseClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "test-session-token" } }, error: null }) },
  })),
}));

vi.mock("./env", () => ({
  appEnv: {
    VITE_SUPABASE_URL: "https://plant-test.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe("plant assistant response validation", () => {
  it("accepts only image bytes whose signature matches their declared MIME type", () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1));
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 1));

    expect(validateAssistantImage({ mimeType: "image/png", base64: png })).toBe(true);
    expect(validateAssistantImage({ mimeType: "image/jpeg", base64: png })).toBe(false);
    expect(validateAssistantImage({ mimeType: "image/jpeg", base64: jpeg })).toBe(true);
    expect(validateAssistantImage({ mimeType: "image/webp", base64: "not-an-image" })).toBe(false);
  });

  it("rejects malformed or schema-invalid structured output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      action: "history",
      conversations: [{ id: "not-a-uuid", title: "", updatedAt: "yesterday" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(loadPlantAssistantHistory()).rejects.toMatchObject({
      code: "invalid_response",
      message: "The assistant returned an invalid response. Please retry.",
    } satisfies Partial<PlantAssistantError>);
  });

  it("surfaces provider errors so the page can show its fallback and retry action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: "invalid_output",
      message: "The assistant response did not match the required safe schema.",
    }), { status: 503, headers: { "Content-Type": "application/json" } })));

    await expect(loadPlantAssistantHistory()).rejects.toMatchObject({
      code: "invalid_output",
      message: "The assistant response did not match the required safe schema.",
    });
  });
});
