import { z } from "zod";
import type { AdviceMode, DoctorAnswers, DoctorAssessment, Symptom } from "./types";

export const doctorAssessmentSchema = z.object({
  version: z.literal("1"),
  mode: z.enum(["manual", "ai", "demo"]),
  observedSymptoms: z.array(z.string().min(1).max(600)).max(12),
  causes: z.array(z.object({
    cause: z.string().min(1).max(240),
    supportingEvidence: z.array(z.string().max(240)).max(8),
    contradictoryEvidence: z.array(z.string().max(240)).max(8),
    confidence: z.number().min(0).max(1).nullable(),
  })).min(1).max(5),
  immediateActions: z.array(z.string().min(1).max(300)).min(1).max(8),
  avoid: z.array(z.string().min(1).max(300)).max(8),
  followUpDays: z.number().int().min(1).max(30),
  seekExpertReview: z.boolean(),
  model: z.string().max(120).nullable(),
  provider: z.string().max(80).nullable(),
  disclaimer: z.string().min(1).max(1000),
  assessedAt: z.iso.datetime(),
});

export type DoctorAssessmentInput = z.infer<typeof doctorAssessmentSchema>;

export const symptomNames: Record<Symptom, string> = {
  yellow: "yellowing leaves",
  droop: "drooping leaves",
  spots: "spots or marks",
  pests: "possible insects or residue",
  wilting: "wilting",
  other: "another visible change",
};

export const MANUAL_ASSESSMENT_DISCLAIMER =
  "This checklist organizes your own observations. It is not a diagnosis, and a visible symptom is not proof of a specific cause.";
export const DEMO_ASSESSMENT_DISCLAIMER =
  "Demo guidance only. No image was analyzed and this is not a diagnosis of your plant.";
export const AI_ASSESSMENT_DISCLAIMER =
  "AI observations are limited to what is visible in the provided photos and your answers. They are possibilities to check, not a diagnosis.";

function baseAnswers(answers: DoctorAnswers) {
  return {
    moistureEvidence: [
      ...(answers.soilMoisture === "wet" ? ["You report that the soil is wet."] : []),
      ...(answers.soilMoisture === "dry" ? ["You report that the soil is dry."] : []),
      ...(answers.wateringChange === "yes" ? ["You report a recent watering change."] : []),
      ...(answers.drainage === "no" ? ["You report that the pot may not drain freely."] : []),
    ],
    moistureAgainst: [
      ...(answers.soilMoisture === "slightly_moist" ? ["You report slightly moist soil, which does not by itself establish prolonged dryness or waterlogging."] : []),
      ...(answers.drainage === "yes" ? ["You report that the pot has drainage."] : []),
      ...(answers.soilMoisture === "unknown" ? ["Soil moisture is unknown, so water-related causes remain unconfirmed."] : []),
    ],
    environmentEvidence: [
      ...(answers.lightChange === "yes" ? ["You report a recent change in light."] : []),
      ...(answers.temperatureChange === "yes" ? ["You report a recent temperature change."] : []),
      ...(answers.fertilizerChange === "yes" ? ["You report a recent fertilizer change."] : []),
      ...(answers.repottedRecently === "yes" ? ["You report recent repotting."] : []),
    ],
    environmentAgainst: [
      ...(answers.lightChange === "no" ? ["You report no recent light change."] : []),
      ...(answers.temperatureChange === "no" ? ["You report no recent temperature change."] : []),
      ...(answers.fertilizerChange === "no" ? ["You report no recent fertilizer change."] : []),
      ...(answers.repottedRecently === "no" ? ["You report no recent repotting."] : []),
    ],
    pestEvidence: answers.pestsSeen === "yes" ? ["You report seeing possible insects."] : [],
    pestAgainst: answers.pestsSeen === "no" ? ["You report that you did not see pests; this does not fully rule them out."] : [],
  };
}

function buildCauses(symptom: Symptom, answers: DoctorAnswers): DoctorAssessment["causes"] {
  const { moistureEvidence, moistureAgainst, environmentEvidence, environmentAgainst, pestEvidence, pestAgainst } = baseAnswers(answers);
  const causes: DoctorAssessment["causes"] = [];
  if (moistureEvidence.length || symptom === "yellow" || symptom === "droop" || symptom === "wilting") {
    causes.push({
      cause: "Water availability or drainage may be contributing.",
      supportingEvidence: moistureEvidence,
      contradictoryEvidence: moistureAgainst,
      confidence: null,
    });
  }
  if (environmentEvidence.length || symptom === "yellow" || symptom === "droop") {
    causes.push({
      cause: "A recent environmental or handling change may be relevant.",
      supportingEvidence: environmentEvidence,
      contradictoryEvidence: environmentAgainst,
      confidence: null,
    });
  }
  if (symptom === "spots" || symptom === "pests") {
    causes.push({
      cause: answers.pestsSeen === "yes"
        ? "Insects or residue are worth checking closely."
        : "Leaf marks may have several causes, including physical or environmental damage.",
      supportingEvidence: pestEvidence,
      contradictoryEvidence: pestAgainst,
      confidence: null,
    });
  }
  return causes;
}

function buildActions(answers: DoctorAnswers): { immediateActions: string[]; avoid: string[] } {
  return {
    immediateActions: [
      "Check the soil moisture and drainage without watering or treating solely from this checklist.",
      "Inspect both sides of leaves and note whether the change is spreading.",
      ...(answers.pestsSeen === "yes" ? ["If insects are visible, keep the plant separated from nearby plants while you identify them."] : []),
      ...(answers.soilMoisture === "wet" ? ["If the soil is wet, pause watering and confirm the pot drains freely."] : []),
    ],
    avoid: [
      "Do not use pesticides, fungicides, fertilizer, or other treatments based only on a visual symptom.",
      "Do not repot or change several care conditions at once unless there is an immediate safety concern.",
    ],
  };
}

export function createManualAssessment(
  symptom: Symptom,
  answers: DoctorAnswers,
  notes: string,
  hasPhotos: boolean,
): DoctorAssessment {
  const observedSymptoms = [symptomNames[symptom], ...(notes.trim() ? [`User-reported notes: ${notes.trim()}`] : [])];
  const causes = buildCauses(symptom, answers);
  if (!causes.length) {
    causes.push({
      cause: "The available observations do not distinguish between possible causes.",
      supportingEvidence: hasPhotos ? ["Photos were provided, but this manual flow does not analyze images."] : [],
      contradictoryEvidence: [],
      confidence: null,
    });
  }
  const actions = buildActions(answers);
  return doctorAssessmentSchema.parse({
    version: "1",
    mode: "manual",
    observedSymptoms,
    causes: causes.slice(0, 4),
    immediateActions: actions.immediateActions,
    avoid: actions.avoid,
    followUpDays: 3,
    seekExpertReview: true,
    model: null,
    provider: null,
    disclaimer: MANUAL_ASSESSMENT_DISCLAIMER,
    assessedAt: new Date().toISOString(),
  });
}

export function createDemoAssessment(
  symptom: Symptom,
  answers: DoctorAnswers,
  notes: string,
  hasPhotos: boolean,
): DoctorAssessment {
  const causes = buildCauses(symptom, answers);
  if (!causes.length) {
    causes.push({
      cause: "The available observations do not distinguish between possible causes.",
      supportingEvidence: [],
      contradictoryEvidence: [],
      confidence: null,
    });
  }
  const actions = buildActions(answers);
  return doctorAssessmentSchema.parse({
    version: "1",
    mode: "demo",
    observedSymptoms: [symptomNames[symptom], ...(notes.trim() ? [`User-reported notes: ${notes.trim()}`] : [])],
    causes: causes.slice(0, 4),
    immediateActions: [
      ...actions.immediateActions.map((action) => `[Example] ${action}`),
      hasPhotos
        ? "Demo mode did not analyze the selected photo; use the observation checklist yourself."
        : "No photo was analyzed in demo mode; describe the visible change in your notes.",
    ],
    avoid: actions.avoid,
    followUpDays: 3,
    seekExpertReview: true,
    model: "demo-checklist-v1",
    provider: "Demo",
    disclaimer: DEMO_ASSESSMENT_DISCLAIMER,
    assessedAt: new Date().toISOString(),
  });
}

export function assessmentFromAi(
  value: Omit<DoctorAssessment, "version" | "mode" | "provider" | "disclaimer" | "assessedAt"> & {
    provider?: string | null;
    model?: string | null;
  },
): DoctorAssessment {
  return doctorAssessmentSchema.parse({
    ...value,
    version: "1",
    mode: "ai",
    provider: value.provider ?? "AI vision",
    model: value.model ?? null,
    disclaimer: AI_ASSESSMENT_DISCLAIMER,
    assessedAt: new Date().toISOString(),
  });
}

export function assessmentModeLabel(mode: AdviceMode): string {
  return mode === "ai" ? "AI-assisted observation" : mode === "demo" ? "Demo example" : "Your checklist";
}
