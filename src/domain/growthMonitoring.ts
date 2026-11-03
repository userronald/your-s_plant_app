import { z } from "zod";
import type { AdviceMode, GrowthObservation } from "./types";

export const growthObservationSchema = z.object({
  version: z.literal("1"),
  mode: z.enum(["manual", "ai", "demo"]),
  provider: z.string().max(80).nullable(),
  model: z.string().max(120).nullable(),
  summary: z.string().min(1).max(400),
  visibleObservations: z.array(z.string().min(1).max(300)).min(1).max(8),
  cannotDetermine: z.array(z.string().min(1).max(300)).min(1).max(8),
  changes: z.array(z.object({
    aspect: z.string().min(1).max(80),
    observation: z.string().min(1).max(240),
  })).max(6),
  caveats: z.array(z.string().min(1).max(300)).min(1).max(8),
  comparedWithPrevious: z.boolean(),
  disclaimer: z.string().min(1).max(1000),
  observedAt: z.iso.datetime(),
});

export type GrowthObservationInput = z.infer<typeof growthObservationSchema>;

export const GROWTH_CAVEATS = [
  "Photos taken from different angles, distances, or lighting can look different even when the plant has not changed.",
  "Leaf colour can shift with camera white balance, so colour differences alone are not reliable evidence of growth.",
  "Plant size cannot be precisely measured from a 2D photo; any size observation is approximate.",
];

export const MANUAL_GROWTH_DISCLAIMER =
  "This entry records your own note and a dated photo. It is not a measurement and does not infer growth.";
export const DEMO_GROWTH_DISCLAIMER =
  "Demo comparison only. No image was analyzed, and no growth is measured or inferred.";
export const AI_GROWTH_DISCLAIMER =
  "AI observations describe visible differences between the provided photos. They are not measurements, and angle, lighting, distance, and image quality can mislead.";

function comparisonCaveats(hasPrevious: boolean): string[] {
  return [
    ...GROWTH_CAVEATS,
    ...(!hasPrevious
      ? ["No earlier photo was supplied, so no before-and-after comparison is possible; this is a new baseline."]
      : ["The earlier image may have been taken with a different camera, lens, distance, or orientation."]),
  ];
}

export function createManualGrowthObservation(
  _note: string,
  previousCapturedAt: string | null,
): GrowthObservation {
  const hasPrevious = previousCapturedAt !== null;
  return growthObservationSchema.parse({
    version: "1",
    mode: "manual",
    provider: null,
    model: null,
    summary: hasPrevious
      ? "A dated photo and note were saved as a visual record next to an earlier check-in."
      : "A dated photo and note were saved as the first visual baseline. No comparison was made.",
    visibleObservations: ["No image observation was made in checklist mode."],
    cannotDetermine: [
      "Growth amount, leaf count change, and health trend cannot be determined from this manual entry.",
      hasPrevious ? "Differences caused by angle, distance, or lighting cannot be separated from real changes." : "There is no earlier photo to compare against.",
    ],
    changes: [],
    caveats: comparisonCaveats(hasPrevious),
    comparedWithPrevious: false,
    disclaimer: MANUAL_GROWTH_DISCLAIMER,
    observedAt: new Date().toISOString(),
  });
}

export function createDemoGrowthObservation(
  note: string,
  previousCapturedAt: string | null,
): GrowthObservation {
  const trimmed = note.trim();
  const hasPrevious = previousCapturedAt !== null;
  const lower = trimmed.toLowerCase();
  const changes = lower.includes("leaf") || lower.includes("leaves")
    ? [{ aspect: "Foliage (from your note)", observation: "Your note mentions leaf changes. Demo mode did not verify this from the photo." }]
    : [];
  return growthObservationSchema.parse({
    version: "1",
    mode: "demo",
    provider: "Demo",
    model: "demo-growth-checklist-v1",
    summary: hasPrevious
      ? "Demo example: an earlier photo is available for a side-by-side view, but no image analysis was performed."
      : "Demo example: this is the first visual record for a future comparison. No image analysis was performed.",
    visibleObservations: ["No image observation was made in demo mode."],
    cannotDetermine: [
      "Demo mode did not inspect pixel content, so no visible differences are reported.",
      "Demo mode cannot measure size, growth rate, or health.",
    ],
    changes,
    caveats: comparisonCaveats(hasPrevious),
    comparedWithPrevious: false,
    disclaimer: DEMO_GROWTH_DISCLAIMER,
    observedAt: new Date().toISOString(),
  });
}

export function growthObservationFromAi(
  value: Omit<GrowthObservation, "version" | "mode" | "provider" | "disclaimer" | "observedAt"> & {
    provider?: string | null;
    model?: string | null;
  },
): GrowthObservation {
  return growthObservationSchema.parse({
    ...value,
    version: "1",
    mode: "ai",
    provider: value.provider ?? "AI vision",
    model: value.model ?? null,
    disclaimer: AI_GROWTH_DISCLAIMER,
    observedAt: new Date().toISOString(),
  });
}

export function observationModeLabel(mode: AdviceMode): string {
  return mode === "ai" ? "AI-assisted comparison" : mode === "demo" ? "Demo example" : "Your observation";
}
