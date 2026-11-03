import type {
  IdentificationCandidate,
  IdentificationPhoto,
  IdentificationResultContract,
  PlantOrgan,
} from "./identification.ts";

export const IDENTIFICATION_CONTRACT_VERSION = "1" as const;
export const MAX_IDENTIFICATION_IMAGES = 5;
export const MAX_IDENTIFICATION_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IDENTIFICATION_TOTAL_BYTES = 20 * 1024 * 1024;
export const PLANTNET_API_VERSION = "v2";

export class IdentificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "IdentificationError";
  }
}

interface ProviderSpecies {
  scientificNameWithoutAuthor?: unknown;
  scientificNameAuthorship?: unknown;
  scientificName?: unknown;
  genus?: { scientificNameWithoutAuthor?: unknown } | null;
  family?: { scientificNameWithoutAuthor?: unknown } | null;
  commonNames?: unknown;
}

interface ProviderResult {
  score?: unknown;
  species?: ProviderSpecies | null;
  gbif?: { id?: unknown } | null;
  powo?: { id?: unknown } | null;
}

interface ProviderResponse {
  results?: unknown;
  version?: unknown;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function taxonomyId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function mapCandidate(value: unknown): IdentificationCandidate | null {
  if (typeof value !== "object" || value === null || !("species" in value)) return null;
  const result = value as ProviderResult;
  const species = result.species;
  if (typeof species !== "object" || species === null) return null;
  const scientificName = optionalString(species.scientificNameWithoutAuthor)
    ?? optionalString(species.scientificName);
  if (!scientificName) return null;

  const score = typeof result.score === "number" && Number.isFinite(result.score)
    && result.score >= 0 && result.score <= 1 ? result.score : null;
  const commonNames = Array.isArray(species.commonNames)
    ? species.commonNames.filter((name): name is string => typeof name === "string" && Boolean(name.trim())).map((name) => name.trim())
    : [];

  return {
    scientificName,
    authorship: optionalString(species.scientificNameAuthorship),
    commonNames,
    matchScore: score,
    taxonomy: {
      family: optionalString(species.family?.scientificNameWithoutAuthor),
      genus: optionalString(species.genus?.scientificNameWithoutAuthor),
      species: scientificName,
      externalIds: {
        gbif: taxonomyId(result.gbif?.id),
        powo: taxonomyId(result.powo?.id),
      },
    },
  };
}

export function normalizePlantNetResult(
  input: unknown,
  elapsedMs: number,
  thresholds: { minimumMatchScore: number; ambiguousGap: number },
): IdentificationResultContract {
  if (typeof input !== "object" || input === null || !("results" in input)) {
    throw new IdentificationError("invalid_provider_response", "The identification service returned an unreadable response.", 502);
  }
  const response = input as ProviderResponse;
  const candidates = Array.isArray(response.results)
    ? response.results.map(mapCandidate).filter((candidate): candidate is IdentificationCandidate => candidate !== null).slice(0, 5)
    : [];
  const first = candidates[0];
  const second = candidates[1];
  const score = first?.matchScore ?? null;
  const gap = score !== null && second?.matchScore !== null && second?.matchScore !== undefined
    ? score - second.matchScore
    : null;
  const isAmbiguous = candidates.length === 0
    || score === null
    || score < thresholds.minimumMatchScore
    || (gap !== null && gap < thresholds.ambiguousGap);

  return {
    contractVersion: IDENTIFICATION_CONTRACT_VERSION,
    provider: "Pl@ntNet",
    providerApiVersion: PLANTNET_API_VERSION,
    providerVersion: optionalString(response.version),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    resultMode: "live",
    decision: candidates.length === 0 ? "no_candidates" : isAmbiguous ? "ambiguous" : "likely_match",
    candidates,
  };
}

export async function identifyWithPlantNet(
  photos: IdentificationPhoto[],
  options: {
    apiKey: string;
    project: string;
    minimumMatchScore: number;
    ambiguousGap: number;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
  },
): Promise<IdentificationResultContract> {
  if (!options.apiKey) {
    throw new IdentificationError("missing_credentials", "Live plant identification is not configured.", 503);
  }
  if (photos.length < 1 || photos.length > MAX_IDENTIFICATION_IMAGES) {
    throw new IdentificationError("invalid_upload", "Choose between one and five photos of the same plant.", 400);
  }

  const body = new FormData();
  for (const photo of photos) {
    body.append("images", photo.file, "plant-photo");
    body.append("organs", photo.organ);
  }

  const url = new URL(`https://my-api.plantnet.org/v2/identify/${encodeURIComponent(options.project)}`);
  url.searchParams.set("api-key", options.apiKey);
  url.searchParams.set("nb-results", "5");
  url.searchParams.set("lang", "en");
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      body,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new IdentificationError("provider_timeout", "Plant identification took too long. You can try again.", 504);
    }
    throw new IdentificationError("provider_unavailable", "The plant identification service could not be reached. You can try again.", 502);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new IdentificationError("not_a_plant", "No plant could be identified from these photos. Try a closer, clearer photo of the plant.", 422);
    }
    if (response.status === 429) {
      throw new IdentificationError("provider_rate_limit", "The plant identification service has reached its current request limit. Please try again later.", 429);
    }
    throw new IdentificationError("provider_error", "The plant identification service returned an error. Please try again later.", 502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new IdentificationError("invalid_provider_response", "The identification service returned an unreadable response.", 502);
  }
  const result = normalizePlantNetResult(payload, performance.now() - startedAt, {
    minimumMatchScore: options.minimumMatchScore,
    ambiguousGap: options.ambiguousGap,
  });
  if (result.decision === "no_candidates") {
    throw new IdentificationError("not_a_plant", "No plant candidates were returned. Try a clearer photo of the plant.", 422);
  }
  return result;
}

export function isPlantOrgan(value: string): value is PlantOrgan {
  return ["flower", "fruit", "leaf", "habit", "bark", "other"].includes(value);
}
