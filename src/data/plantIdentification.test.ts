// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { IdentificationResultContract } from "../domain/identification";
import { createIdentifyPlantHandler } from "../../supabase/functions/_shared/identify-handler";
import { IdentificationError, identifyWithPlantNet, normalizePlantNetResult } from "../../supabase/functions/_shared/plantnet";

const liveResult: IdentificationResultContract = {
  contractVersion: "1",
  provider: "Pl@ntNet",
  providerApiVersion: "v2",
  providerVersion: "v2",
  elapsedMs: 41,
  resultMode: "live",
  decision: "likely_match",
  candidates: [{
    scientificName: "Monstera deliciosa",
    authorship: null,
    commonNames: ["Swiss cheese plant"],
    matchScore: 0.74,
    taxonomy: {
      family: "Araceae",
      genus: "Monstera",
      species: "Monstera deliciosa",
      externalIds: { gbif: "2878518", powo: "urn:lsid:ipni.org:names:88468-1" },
    },
  }],
};

function validForm(): FormData {
  const form = new FormData();
  form.append("images", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0x00])], "plant.jpg", { type: "image/jpeg" }));
  form.append("organs", "leaf");
  return form;
}

function makeHandler(overrides: Partial<Parameters<typeof createIdentifyPlantHandler>[0]> = {}) {
  const complete = vi.fn(async () => {});
  const identify = vi.fn(async () => liveResult);
  const handler = createIdentifyPlantHandler({
    authenticate: async () => "user-1",
    reserve: async () => ({ allowed: true, requestId: "request-1" }),
    complete,
    apiKey: "server-only-key",
    project: "all",
    minimumMatchScore: 0.15,
    ambiguousGap: 0.08,
    timeoutMs: 20000,
    estimatedCostEur: null,
    identify: identify as typeof identifyWithPlantNet,
    ...overrides,
  });
  return { handler, complete, identify };
}

async function postForm(form: FormData): Promise<Request> {
  return new Request("https://app.example.test/functions/v1/identify-plant", { method: "POST", body: form });
}

describe("Pl@ntNet identification provider", () => {
  it("normalizes scientific names, common names, scores, taxonomy and provider metadata", () => {
    const result = normalizePlantNetResult({
      version: "provider-build-2026-10",
      results: [{
        score: 0.82,
        species: {
          scientificNameWithoutAuthor: "Monstera deliciosa",
          scientificNameAuthorship: "Liebm.",
          commonNames: ["Swiss cheese plant"],
          genus: { scientificNameWithoutAuthor: "Monstera" },
          family: { scientificNameWithoutAuthor: "Araceae" },
        },
        gbif: { id: "2878518" },
        powo: { id: "urn:lsid:ipni.org:names:88468-1" },
      }],
    }, 68, { minimumMatchScore: 0.15, ambiguousGap: 0.08 });

    expect(result).toMatchObject({
      provider: "Pl@ntNet",
      providerApiVersion: "v2",
      providerVersion: "provider-build-2026-10",
      elapsedMs: 68,
      decision: "likely_match",
      candidates: [{
        scientificName: "Monstera deliciosa",
        authorship: "Liebm.",
        commonNames: ["Swiss cheese plant"],
        matchScore: 0.82,
        taxonomy: { family: "Araceae", genus: "Monstera", externalIds: { gbif: "2878518" } },
      }],
    });
  });

  it("marks close candidates as ambiguous without converting match scores into certainty", () => {
    const result = normalizePlantNetResult({
      results: [
        { score: 0.51, species: { scientificNameWithoutAuthor: "Species A" } },
        { score: 0.48, species: { scientificNameWithoutAuthor: "Species B" } },
      ],
    }, 20, { minimumMatchScore: 0.15, ambiguousGap: 0.08 });
    expect(result.decision).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.matchScore)).toEqual([0.51, 0.48]);
  });

  it("sends multiple photos and their plant-part labels to the provider", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      expect(requestUrl.origin).toBe("https://my-api.plantnet.org");
      expect(requestUrl.searchParams.get("api-key")).toBe("server-only-key");
      const body = init?.body as FormData;
      expect(body.getAll("images")).toHaveLength(2);
      expect(body.getAll("organs")).toEqual(["flower", "leaf"]);
      return new Response(JSON.stringify({ version: "model-v1", results: [{ score: 0.7, species: { scientificName: "Species A" } }] }), { status: 200 });
    });
    const photos = [
      { file: new File(["flower"], "one.jpg", { type: "image/jpeg" }), organ: "flower" as const },
      { file: new File(["leaf"], "two.png", { type: "image/png" }), organ: "leaf" as const },
    ];
    const result = await identifyWithPlantNet(photos, {
      apiKey: "server-only-key",
      project: "all",
      minimumMatchScore: 0.15,
      ambiguousGap: 0.08,
      timeoutMs: 1000,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.candidates[0].scientificName).toBe("Species A");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not call Pl@ntNet when server credentials are missing", async () => {
    const fetchImpl = vi.fn();
    await expect(identifyWithPlantNet(
      [{ file: new File(["photo"], "plant.jpg", { type: "image/jpeg" }), organ: "leaf" }],
      { apiKey: "", project: "all", minimumMatchScore: 0.15, ambiguousGap: 0.08, timeoutMs: 1000, fetchImpl },
    )).rejects.toMatchObject({ code: "missing_credentials", httpStatus: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider rejection of non-plant images to an actionable error", async () => {
    await expect(identifyWithPlantNet(
      [{ file: new File(["photo"], "plant.jpg", { type: "image/jpeg" }), organ: "leaf" }],
      {
        apiKey: "server-only-key", project: "all", minimumMatchScore: 0.15, ambiguousGap: 0.08, timeoutMs: 1000,
        fetchImpl: async () => new Response("{}", { status: 404 }),
      },
    )).rejects.toMatchObject({ code: "not_a_plant", httpStatus: 422 });
  });

  it("times out without retrying a potentially billable identification request", async () => {
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "TimeoutError")), { once: true });
    });
    await expect(identifyWithPlantNet(
      [{ file: new File(["photo"], "plant.jpg", { type: "image/jpeg" }), organ: "leaf" }],
      {
        apiKey: "server-only-key", project: "all", minimumMatchScore: 0.15, ambiguousGap: 0.08, timeoutMs: 2, fetchImpl,
      },
    )).rejects.toMatchObject({ code: "provider_timeout", httpStatus: 504 });
  });
});

describe("identify-plant endpoint contract", () => {
  it("returns normalized candidates and records latency and provider version", async () => {
    const { handler, complete, identify } = makeHandler();
    const response = await handler(await postForm(validForm()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ contractVersion: "1", resultMode: "live", provider: "Pl@ntNet" });
    expect(identify).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith("request-1", expect.objectContaining({
      status: "succeeded",
      imageCount: 1,
      latencyMs: 41,
      providerVersion: "v2",
    }));
  });

  it("rejects invalid uploads before calling the provider", async () => {
    const { handler, complete, identify } = makeHandler();
    const form = new FormData();
    form.append("images", new File(["not an image"], "not-an-image.gif", { type: "image/gif" }));
    form.append("organs", "leaf");
    const response = await handler(await postForm(form));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_upload" });
    expect(identify).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith("request-1", expect.objectContaining({ status: "invalid_upload", imageCount: 1 }));
  });

  it("rejects image content whose file signature does not match its declared MIME type", async () => {
    const { handler, identify } = makeHandler();
    const form = new FormData();
    form.append("images", new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "spoof.jpg", { type: "image/jpeg" }));
    form.append("organs", "leaf");
    const response = await handler(await postForm(form));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_upload" });
    expect(identify).not.toHaveBeenCalled();
  });

  it("requires sign-in and reports rate limits without starting a provider request", async () => {
    const unauthenticated = makeHandler({ authenticate: async () => null });
    expect((await unauthenticated.handler(await postForm(validForm()))).status).toBe(401);

    const limited = makeHandler({ reserve: async () => ({ allowed: false, reason: "user_per_day" }) });
    const response = await limited.handler(await postForm(validForm()));
    expect(response.status).toBe(429);
    expect(limited.identify).not.toHaveBeenCalled();
    expect(limited.complete).not.toHaveBeenCalled();
  });

  it("returns a distinct missing-credentials error and logs the attempt", async () => {
    const { handler, complete, identify } = makeHandler({ apiKey: undefined });
    const response = await handler(await postForm(validForm()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "missing_credentials" });
    expect(identify).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith("request-1", expect.objectContaining({ status: "missing_credentials" }));
  });

  it("keeps ambiguous live candidates available for user review", async () => {
    const ambiguous = { ...liveResult, decision: "ambiguous" as const };
    const { handler } = makeHandler({ identify: async () => ambiguous });
    const response = await handler(await postForm(validForm()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ decision: "ambiguous", candidates: liveResult.candidates });
  });

  it("reports non-plant results and provider failures without success-shaped responses", async () => {
    const notAPlant = makeHandler({
      identify: async () => { throw new IdentificationError("not_a_plant", "No plant found.", 422); },
    });
    const noPlantResponse = await notAPlant.handler(await postForm(validForm()));
    expect(noPlantResponse.status).toBe(422);
    expect(await noPlantResponse.json()).toMatchObject({ code: "not_a_plant" });

    const unavailable = makeHandler({
      identify: async () => { throw new IdentificationError("provider_error", "Provider failed.", 502); },
    });
    const providerResponse = await unavailable.handler(await postForm(validForm()));
    expect(providerResponse.status).toBe(502);
    expect(await providerResponse.json()).toMatchObject({ code: "provider_error" });
  });
});
