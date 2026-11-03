export type PlantOrgan = "flower" | "fruit" | "leaf" | "habit" | "bark" | "other";

export interface IdentificationPhoto {
  file: File;
  organ: PlantOrgan;
}

export interface PlantTaxonomy {
  family: string | null;
  genus: string | null;
  species: string | null;
  externalIds: {
    gbif: string | null;
    powo: string | null;
  };
}

export interface IdentificationCandidate {
  scientificName: string;
  authorship: string | null;
  commonNames: string[];
  matchScore: number | null;
  taxonomy: PlantTaxonomy;
}

export interface IdentificationResult {
  provider: "Pl@ntNet";
  providerApiVersion: string;
  providerVersion: string | null;
  elapsedMs: number;
  resultMode: "live" | "demo";
  decision: "likely_match" | "ambiguous" | "no_candidates";
  candidates: IdentificationCandidate[];
}

export interface IdentificationResultContract extends IdentificationResult {
  contractVersion: "1";
}

export interface PlantIdentificationProvider {
  readonly mode: "live" | "demo";
  identify(photos: IdentificationPhoto[]): Promise<IdentificationResultContract>;
}

export function createDemoIdentificationProvider(): PlantIdentificationProvider {
  return {
    mode: "demo",
    async identify() {
      return {
        contractVersion: "1",
        provider: "Pl@ntNet",
        providerApiVersion: "demo",
        providerVersion: null,
        elapsedMs: 0,
        resultMode: "demo",
        decision: "ambiguous",
        candidates: [{
          scientificName: "Monstera deliciosa",
          authorship: null,
          commonNames: ["Swiss cheese plant"],
          matchScore: null,
          taxonomy: {
            family: "Araceae",
            genus: "Monstera",
            species: "Monstera deliciosa",
            externalIds: { gbif: null, powo: null },
          },
        }, {
          scientificName: "Epipremnum aureum",
          authorship: null,
          commonNames: ["Golden pothos"],
          matchScore: null,
          taxonomy: {
            family: "Araceae",
            genus: "Epipremnum",
            species: "Epipremnum aureum",
            externalIds: { gbif: null, powo: null },
          },
        }],
      };
    },
  };
}

export function displayNameForCandidate(candidate: IdentificationCandidate): string {
  return candidate.commonNames[0] ?? candidate.scientificName;
}
