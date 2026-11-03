import { z } from "zod";
import type { AdviceMode, GrowthObservation } from "../domain/types";
import { createDemoGrowthObservation, createManualGrowthObservation, growthObservationFromAi } from "../domain/growthMonitoring";
import { prepareIdentificationPhoto } from "./plantPhotoCompression";
import { invokeMonitoringFunction, MonitoringRequestError, fileToDataUrl, signedInSupabase, urlToFile } from "./monitoringShared";

export interface PreparedGrowthPhoto {
  file: File;
  dataUrl: string;
}

export interface GrowthCheckRequest {
  mode: AdviceMode;
  plantId: string;
  note: string;
  photos: File[];
  previousPhotoUrl: string | null;
  previousCapturedAt: string | null;
}

export interface GrowthCheckResult {
  observation: GrowthObservation;
  photos: PreparedGrowthPhoto[];
}

const aiObservationShape = z.object({
  summary: z.string().min(1).max(400),
  visibleObservations: z.array(z.string().min(1).max(300)).min(1).max(8),
  cannotDetermine: z.array(z.string().min(1).max(300)).min(1).max(8),
  changes: z.array(z.object({
    aspect: z.string().min(1).max(80),
    observation: z.string().min(1).max(240),
  })).max(6),
  caveats: z.array(z.string().min(1).max(300)).min(1).max(8),
  comparedWithPrevious: z.boolean(),
});

const growthResponseSchema = z.object({
  contractVersion: z.literal("1"),
  provider: z.string().min(1).max(80),
  model: z.string().max(120).nullable(),
  resultMode: z.literal("live"),
  elapsedMs: z.number().nonnegative(),
  observation: aiObservationShape,
  disclaimer: z.string().min(1).max(1000),
});

export const MAX_GROWTH_PHOTOS = 2;

export async function prepareGrowthPhotos(files: File[]): Promise<PreparedGrowthPhoto[]> {
  if (files.length < 1) throw new MonitoringRequestError("Choose a new photo for this growth check.", "invalid_photo");
  if (files.length > MAX_GROWTH_PHOTOS) {
    throw new MonitoringRequestError(`Choose no more than ${MAX_GROWTH_PHOTOS} photos.`, "invalid_photo");
  }
  const prepared: PreparedGrowthPhoto[] = [];
  for (const input of files) {
    try {
      const file = await prepareIdentificationPhoto(input);
      prepared.push({ file, dataUrl: await fileToDataUrl(file) });
    } catch (error) {
      throw new MonitoringRequestError(error instanceof Error ? error.message : "This photo could not be prepared.", "invalid_photo");
    }
  }
  return prepared;
}

export async function requestGrowthCheck(input: GrowthCheckRequest): Promise<GrowthCheckResult> {
  const photos = await prepareGrowthPhotos(input.photos);
  if (input.mode === "manual") {
    return {
      observation: createManualGrowthObservation(input.note, input.previousCapturedAt),
      photos,
    };
  }
  if (input.mode === "demo") {
    return {
      observation: createDemoGrowthObservation(input.note, input.previousCapturedAt),
      photos,
    };
  }

  const supabase = await signedInSupabase();
  if (!supabase) throw new MonitoringRequestError("Live comparison is unavailable.", "not_configured");
  const form = new FormData();
  let previousFile: File | null = null;
  if (input.previousPhotoUrl) {
    const previous = await urlToFile(input.previousPhotoUrl, "previous-growth-photo.jpg");
    if (!previous) throw new MonitoringRequestError("The earlier photo could not be loaded. Select another previous check-in or choose a new baseline.", "previous_photo_unavailable");
    try {
      previousFile = await prepareIdentificationPhoto(previous);
    } catch (error) {
      throw new MonitoringRequestError(error instanceof Error ? error.message : "The earlier photo could not be prepared.", "invalid_photo");
    }
  }
  form.append("payload", JSON.stringify({
    plantId: input.plantId,
    note: input.note,
  }));
  for (const photo of photos) form.append("images", photo.file, photo.file.name);
  if (previousFile) form.append("previous", previousFile, previousFile.name);
  const data = await invokeMonitoringFunction(supabase, "growth-check", form);
  const parsed = growthResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new MonitoringRequestError("The comparison service returned an invalid response. Try the checklist or demo option instead.", "invalid_response");
  }
  return {
    observation: growthObservationFromAi({
      ...parsed.data.observation,
      provider: parsed.data.provider,
      model: parsed.data.model,
    }),
    photos,
  };
}
