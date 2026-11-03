import { z } from "zod";
import type { AdviceMode, DoctorAnswers, DoctorAssessment, PhotoKind, Symptom } from "../domain/types";
import { assessmentFromAi, createDemoAssessment, createManualAssessment } from "../domain/monitoring";
import { prepareIdentificationPhoto } from "./plantPhotoCompression";
import { invokeMonitoringFunction, MonitoringRequestError, fileToDataUrl, signedInSupabase } from "./monitoringShared";

export interface DoctorPhotoSelection {
  file: File;
  kind: PhotoKind;
}

export interface PlantDoctorRequest {
  mode: AdviceMode;
  plantId: string | null;
  independent: boolean;
  symptom: Symptom;
  context: string;
  answers: DoctorAnswers;
  photos: DoctorPhotoSelection[];
}

export interface PreparedDoctorPhoto extends DoctorPhotoSelection {
  dataUrl: string;
}

const aiAssessmentShape = z.object({
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
});

const doctorResponseSchema = z.object({
  contractVersion: z.literal("1"),
  provider: z.string().min(1).max(80),
  model: z.string().max(120).nullable(),
  resultMode: z.literal("live"),
  elapsedMs: z.number().nonnegative(),
  assessment: aiAssessmentShape,
  disclaimer: z.string().min(1).max(1000),
});

export const MAX_DOCTOR_PHOTOS = 3;

export async function prepareDoctorPhoto(file: File): Promise<File> {
  try {
    return await prepareIdentificationPhoto(file);
  } catch (error) {
    throw new MonitoringRequestError(error instanceof Error ? error.message : "This photo could not be prepared.", "invalid_photo");
  }
}

export async function prepareDoctorPhotos(photos: DoctorPhotoSelection[]): Promise<PreparedDoctorPhoto[]> {
  if (photos.length > MAX_DOCTOR_PHOTOS) {
    throw new MonitoringRequestError(`Choose no more than ${MAX_DOCTOR_PHOTOS} photos.`, "invalid_photo");
  }
  const prepared: PreparedDoctorPhoto[] = [];
  for (const photo of photos) {
    const file = await prepareDoctorPhoto(photo.file);
    prepared.push({ ...photo, file, dataUrl: await fileToDataUrl(file) });
  }
  return prepared;
}

export async function requestPlantDoctor(input: PlantDoctorRequest): Promise<DoctorAssessment> {
  if (input.mode === "manual") {
    return createManualAssessment(input.symptom, input.answers, input.context, input.photos.length > 0);
  }
  if (input.mode === "demo") {
    return createDemoAssessment(input.symptom, input.answers, input.context, input.photos.length > 0);
  }

  const supabase = await signedInSupabase();
  if (!supabase) throw new MonitoringRequestError("Live analysis is unavailable.", "not_configured");
  if (input.photos.length === 0) throw new MonitoringRequestError("Add at least one symptom photo for live AI analysis. Use checklist or demo without a photo.", "invalid_photo");
  const form = new FormData();
  const prepared = await prepareDoctorPhotos(input.photos);
  form.append("payload", JSON.stringify({
    plantId: input.independent ? null : input.plantId,
    independent: input.independent,
    symptom: input.symptom,
    context: input.context,
    answers: input.answers,
  }));
  for (const photo of prepared) {
    form.append("images", photo.file, photo.file.name);
    form.append("kinds", photo.kind);
  }
  const data = await invokeMonitoringFunction(supabase, "plant-doctor", form);
  const parsed = doctorResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new MonitoringRequestError("The analysis service returned an invalid response. Try the checklist or demo option instead.", "invalid_response");
  }
  return assessmentFromAi({
    ...parsed.data.assessment,
    provider: parsed.data.provider,
    model: parsed.data.model,
  });
}
