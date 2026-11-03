import type {
  IdentificationCandidate,
  IdentificationPhoto,
  IdentificationResultContract,
  PlantIdentificationProvider,
  PlantTaxonomy,
} from "../domain/identification";
import { getSupabaseClient } from "./persistence";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDecision(value: unknown): value is IdentificationResultContract["decision"] {
  return value === "likely_match" || value === "ambiguous" || value === "no_candidates";
}

function nullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function readResult(value: unknown): IdentificationResultContract {
  if (!isRecord(value) || value.contractVersion !== "1"
    || value.provider !== "Pl@ntNet"
    || (value.resultMode !== "live" && value.resultMode !== "demo")
    || !isDecision(value.decision)
    || !Array.isArray(value.candidates)
    || typeof value.providerApiVersion !== "string"
    || !nullableString(value.providerVersion)
    || typeof value.elapsedMs !== "number" || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) {
    throw new Error("The identification service returned an invalid response contract.");
  }
  const candidates: IdentificationCandidate[] = [];
  for (const candidate of value.candidates) {
    if (!isRecord(candidate) || typeof candidate.scientificName !== "string"
      || !nullableString(candidate.authorship)
      || !Array.isArray(candidate.commonNames)
      || !candidate.commonNames.every((name) => typeof name === "string")
      || !(candidate.matchScore === null || (typeof candidate.matchScore === "number"
        && Number.isFinite(candidate.matchScore) && candidate.matchScore >= 0 && candidate.matchScore <= 1))
      || !isRecord(candidate.taxonomy)
      || !nullableString(candidate.taxonomy.family)
      || !nullableString(candidate.taxonomy.genus)
      || !nullableString(candidate.taxonomy.species)
      || !isRecord(candidate.taxonomy.externalIds)
      || !nullableString(candidate.taxonomy.externalIds.gbif)
      || !nullableString(candidate.taxonomy.externalIds.powo)) {
      throw new Error("The identification service returned a malformed candidate.");
    }
    const taxonomy: PlantTaxonomy = {
      family: candidate.taxonomy.family,
      genus: candidate.taxonomy.genus,
      species: candidate.taxonomy.species,
      externalIds: {
        gbif: candidate.taxonomy.externalIds.gbif,
        powo: candidate.taxonomy.externalIds.powo,
      },
    };
    candidates.push({
      scientificName: candidate.scientificName,
      authorship: candidate.authorship,
      commonNames: candidate.commonNames,
      matchScore: candidate.matchScore,
      taxonomy,
    });
  }
  return {
    contractVersion: "1",
    provider: "Pl@ntNet",
    providerApiVersion: value.providerApiVersion,
    providerVersion: value.providerVersion,
    elapsedMs: value.elapsedMs,
    resultMode: value.resultMode,
    decision: value.decision,
    candidates,
  };
}

async function errorFromFunction(error: { message: string; context?: unknown }): Promise<Error> {
  const context = error.context;
  if (context instanceof Response) {
    try {
      const body: unknown = await context.json();
      if (isRecord(body) && typeof body.message === "string") {
        return new Error(body.message);
      }
    } catch {
      return new Error(error.message || "Plant identification could not be completed.");
    }
  }
  return new Error(error.message || "Plant identification could not be completed.");
}

export { prepareIdentificationPhoto } from "./plantPhotoCompression";

export function createLivePlantIdentificationProvider(): PlantIdentificationProvider {
  return {
    mode: "live",
    async identify(photos: IdentificationPhoto[]) {
      const supabase = await getSupabaseClient();
      if (!supabase) throw new Error("Live identification needs a configured Supabase account. Demo mode remains on this device.");
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(`Could not check your sign-in: ${sessionError.message}`);
      if (!session) throw new Error("Sign in to use live plant identification. Demo results are not based on your photos.");
      if (photos.length < 1 || photos.length > 5) throw new Error("Choose between one and five photos of the same plant.");

      const form = new FormData();
      for (const { file, organ } of photos) {
        form.append("images", file, file.name);
        form.append("organs", organ);
      }
      const { data, error } = await supabase.functions.invoke("identify-plant", { body: form });
      if (error) throw await errorFromFunction(error);
      return readResult(data);
    },
  };
}
