import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData, CareEvent, CareEventType, CareTask, CareTaskType, Discovery, DoctorAnswers, DoctorAssessment, DoctorPhoto, GrowthCheck, GrowthObservation, GrowthPhoto, IssueEpisode, IssueFollowUp, Plant, PlantCondition, SoilMoisture, Symptom } from "../domain/types";
import { getSupabaseClient } from "./persistence";
import type { Database, Json } from "./database.types";
import { validatePlantPhoto } from "./photoValidation";
import { createManualAssessment, doctorAssessmentSchema } from "../domain/monitoring";
import { createManualGrowthObservation, growthObservationSchema } from "../domain/growthMonitoring";
import { doctorAnswersSchema } from "../domain/validation";

export type CloudClient = SupabaseClient<Database>;
type PlantRow = Database["public"]["Tables"]["plant_instances"]["Row"];
type DiscoveryRow = Database["public"]["Tables"]["discoveries"]["Row"];
type PlacementRow = Database["public"]["Tables"]["placements"]["Row"];
type CareEventRow = Database["public"]["Tables"]["care_events"]["Row"];
type CareTaskRow = Database["public"]["Tables"]["care_tasks"]["Row"];
type PhotoRow = Database["public"]["Tables"]["photos"]["Row"];
type GrowthCheckRow = Database["public"]["Tables"]["growth_checks"]["Row"];
type IssueEpisodeRow = Database["public"]["Tables"]["issue_episodes"]["Row"];
type IssueFollowUpRow = Database["public"]["Tables"]["issue_followups"]["Row"];

// helpers reserved for future cloud mapping

export interface NewPlantInput {
  nickname: string;
  scientificName: string;
  commonName?: string;
  location?: string;
  light?: string;
  wateringIntervalDays?: number;
  substrateType?: string;
  season?: NonNullable<Plant["environment"]>["season"];
  potMaterial?: string;
  hasDrainage?: boolean | null;
  image?: File;
}

export interface NewDiscoveryInput {
  commonName: string;
  scientificName: string;
  source?: Database["public"]["Enums"]["discovery_source"];
  observedAt?: string;
  location?: string;
  notes?: string;
  externalTaxonomyIds?: { gbif?: string | null; powo?: string | null };
  matchScore?: number | null;
  providerVersion?: string | null;
  wasCorrected?: boolean;
}

export interface CloudExport {
  exportedAt: string;
  account: { id: string; email: string | null; createdAt: string | undefined };
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null;
  taxa: Database["public"]["Tables"]["taxa"]["Row"][];
  knowledgeSources: Database["public"]["Tables"]["knowledge_sources"]["Row"][];
  plants: PlantRow[];
  discoveries: DiscoveryRow[];
  placements: PlacementRow[];
  pots: Database["public"]["Tables"]["pots"]["Row"][];
  photos: PhotoRow[];
  careEvents: CareEventRow[];
  careTasks: Database["public"]["Tables"]["care_tasks"]["Row"][];
  growthChecks: GrowthCheckRow[];
  issueEpisodes: IssueEpisodeRow[];
  issueFollowups: IssueFollowUpRow[];
  aiInferences: Database["public"]["Tables"]["ai_inferences"]["Row"][];
  assistantConversations: Database["public"]["Tables"]["assistant_conversations"]["Row"][];
  assistantMessages: Database["public"]["Tables"]["assistant_messages"]["Row"][];
  assistantUsage: Database["public"]["Tables"]["assistant_usage"]["Row"][];
}

async function client(): Promise<CloudClient> {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error("Supabase account mode is not configured; local demo data is not cloud-synced.");
  return supabase;
}

function throwIfError(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

async function requireUserId(supabase: CloudClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  throwIfError(error, "Could not verify your signed-in account");
  if (!data.user) throw new Error("Sign in to use account-backed plant data.");
  return data.user.id;
}

async function singleOrThrow<T>(request: PromiseLike<{ data: T; error: { message: string } | null }>, action: string): Promise<NonNullable<T>> {
  const { data, error } = await request;
  throwIfError(error, action);
  if (data == null) throw new Error(`${action}: the record was not found or you do not have access.`);
  return data;
}

async function signedPhotoUrl(supabase: CloudClient, path: string | undefined): Promise<string> {
  if (!path) return "/plant-placeholder.svg";
  const { data, error } = await supabase.storage.from("plant-photos").createSignedUrl(path, 15 * 60);
  throwIfError(error, "Could not load a private plant photo");
  if (!data) throw new Error("Could not load a private plant photo: no signed URL was returned.");
  return data.signedUrl;
}

export async function loadCloudAppData(): Promise<AppData> {
  const supabase = await client();
  await requireUserId(supabase);
  const [plantResult, discoveryResult, placementResult, eventResult, photoResult, taxaResult, potResult, guidanceResult] = await Promise.all([
    supabase.from("plant_instances").select("*").is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("discoveries").select("*").order("observed_at", { ascending: false }),
    supabase.from("placements").select("*").is("removed_at", null),
    supabase.from("care_events").select("*").order("occurred_at", { ascending: false }),
    supabase.from("photos").select("*").order("captured_at", { ascending: false }),
    supabase.from("taxa").select("id,scientific_name,common_name"),
    supabase.from("pots").select("*"),
    supabase.from("care_guidance").select("*"),
  ]);
  throwIfError(plantResult.error, "Could not load plants");
  throwIfError(discoveryResult.error, "Could not load discoveries");
  throwIfError(placementResult.error, "Could not load plant placements");
  throwIfError(eventResult.error, "Could not load care events");
  throwIfError(photoResult.error, "Could not load private photo metadata");
  throwIfError(taxaResult.error, "Could not load plant taxonomy");
  throwIfError(potResult.error, "Could not load plant pot details");
  throwIfError(guidanceResult.error, "Could not load verified plant care guidance");

  const photos = photoResult.data ?? [];
  const photoUrls = new Map<string, string>();
  await Promise.all(photos.map(async (photo) => {
    photoUrls.set(photo.id, await signedPhotoUrl(supabase, photo.storage_path));
  }));
  const taxa = new Map((taxaResult.data ?? []).map((taxon) => [taxon.id, taxon]));
  const guidance = new Map((guidanceResult.data ?? []).map((entry) => [entry.taxon_id, entry]));
  const placements = new Map((placementResult.data ?? []).map((placement) => [placement.plant_id, placement]));
  const pots = new Map((potResult.data ?? []).filter((pot) => pot.plant_id).map((pot) => [pot.plant_id!, pot]));
  const eventsByPlant = new Map<string, CareEvent[]>();
  for (const event of eventResult.data ?? []) {
    const current = eventsByPlant.get(event.plant_id) ?? [];
    current.push(toCareEvent(event));
    eventsByPlant.set(event.plant_id, current);
  }
  const photoByPlant = new Map<string, PhotoRow>();
  for (const photo of photos) {
    if (photo.plant_id && !photoByPlant.has(photo.plant_id)) photoByPlant.set(photo.plant_id, photo);
  }
  const photoByDiscovery = new Map<string, PhotoRow>();
  for (const photo of photos) {
    if (photo.discovery_id && !photoByDiscovery.has(photo.discovery_id)) photoByDiscovery.set(photo.discovery_id, photo);
  }

  return {
    plants: await Promise.all((plantResult.data ?? []).map(async (row) => toPlant(
      row, placements.get(row.id), taxa.get(row.taxon_id ?? ""), pots.get(row.id),
      row.taxon_id ? guidance.get(row.taxon_id) : undefined,
      photoUrls.get(photoByPlant.get(row.id)?.id ?? ""), eventsByPlant.get(row.id) ?? [],
    ))),
    discoveries: await Promise.all((discoveryResult.data ?? []).map(async (row) => toDiscovery(
      row, taxa.get(row.taxon_id ?? ""), photoUrls.get(photoByDiscovery.get(row.id)?.id ?? ""),
    ))),
  };
}

export async function loadCloudCareTasks(): Promise<CareTask[]> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data, error } = await supabase.from("care_tasks").select("*")
    .eq("owner_id", ownerId).order("due_at", { ascending: true });
  throwIfError(error, "Could not load care tasks");
  return (data ?? []).map(toCareTask);
}

export async function loadCloudMonitoringData(): Promise<Pick<AppData, "issueEpisodes" | "growthChecks">> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const [growthResult, issueResult, followUpResult, photoResult] = await Promise.all([
    supabase.from("growth_checks").select("*").eq("owner_id", ownerId).order("captured_at", { ascending: false }),
    supabase.from("issue_episodes").select("*").eq("owner_id", ownerId).order("started_at", { ascending: false }),
    supabase.from("issue_followups").select("*").eq("owner_id", ownerId).order("observed_at", { ascending: true }),
    supabase.from("photos").select("*").eq("owner_id", ownerId).in("kind", ["growth", "issue"]).order("captured_at", { ascending: true }),
  ]);
  throwIfError(growthResult.error, "Could not load growth checks");
  throwIfError(issueResult.error, "Could not load plant issue episodes");
  throwIfError(followUpResult.error, "Could not load issue follow-ups");
  throwIfError(photoResult.error, "Could not load monitoring photos");

  const photosById = new Map<string, PhotoRow>();
  const urlsById = new Map<string, string>();
  await Promise.all((photoResult.data ?? []).map(async (photo) => {
    photosById.set(photo.id, photo);
    urlsById.set(photo.id, await signedPhotoUrl(supabase, photo.storage_path));
  }));
  const followUpsByIssue = new Map<string, IssueFollowUp[]>();
  for (const row of followUpResult.data ?? []) {
    const items = followUpsByIssue.get(row.issue_id) ?? [];
    items.push({ id: row.id, note: row.note, observedAt: row.observed_at });
    followUpsByIssue.set(row.issue_id, items);
  }
  const issueEpisodes: IssueEpisode[] = (issueResult.data ?? []).map((row) => {
    const assessment = row.assessment === null
      ? doctorAssessmentSchema.safeParse(createManualAssessment(
        ["yellow", "droop", "spots", "pests", "wilting", "other"].includes(row.symptom) ? row.symptom as Symptom : "other",
        doctorAnswersSchema.parse({
          soilMoisture: "unknown",
          wateringChange: "unsure",
          drainage: "unsure",
          lightChange: "unsure",
          pestsSeen: "unsure",
          fertilizerChange: "unsure",
          temperatureChange: "unsure",
          repottedRecently: "unsure",
        }),
        row.description,
        false,
      ))
      : doctorAssessmentSchema.safeParse(row.assessment);
    if (!assessment.success) throw new Error(`Plant issue ${row.id} has an invalid saved assessment and could not be loaded.`);
    const answers = row.answers === null ? null : doctorAnswersSchema.safeParse(row.answers);
    if (answers !== null && !answers.success) throw new Error(`Plant issue ${row.id} has invalid saved follow-up answers and could not be loaded.`);
    const issuePhotos: DoctorPhoto[] = row.photo_ids.map((id) => {
      const photo = photosById.get(id);
      const url = urlsById.get(id);
      if (!photo || !url || (photo.kind !== "issue") || photo.issue_id !== row.id) {
        throw new Error(`Plant issue ${row.id} references an unavailable photo.`);
      }
      return { name: id, url, kind: photo.issue_photo_kind ?? "whole" };
    });
    return {
      id: row.id,
      plantId: row.plant_id,
      independent: row.independent,
      title: row.title,
      symptom: row.symptom as Symptom,
      description: row.description,
      answers: answers === null ? null : answers.data,
      photos: issuePhotos,
      assessment: assessment.data,
      followUps: followUpsByIssue.get(row.id) ?? [],
      startedAt: row.started_at,
    };
  });
  const growthChecks: GrowthCheck[] = (growthResult.data ?? []).map((row) => {
    const parsedObservation = row.observation === null
      ? growthObservationSchema.safeParse({
        ...createManualGrowthObservation(row.note, row.previous_captured_at),
        observedAt: row.captured_at,
      })
      : growthObservationSchema.safeParse(row.observation);
    if (!parsedObservation.success) throw new Error(`Growth check ${row.id} has an invalid saved observation and could not be loaded.`);
    const photoIds = row.photo_ids.length ? row.photo_ids : row.photo_id ? [row.photo_id] : [];
    const growthPhotos: GrowthPhoto[] = photoIds.map((id) => {
      const photo = photosById.get(id);
      const url = urlsById.get(id);
      if (!photo || !url || photo.kind !== "growth" || photo.plant_id !== row.plant_id) {
        throw new Error(`Growth check ${row.id} references an unavailable photo.`);
      }
      return { id, name: id, url };
    });
    const previousUrl = row.previous_photo_id ? urlsById.get(row.previous_photo_id) : null;
    if (row.previous_photo_id && !previousUrl) throw new Error(`Growth check ${row.id} references an unavailable earlier photo.`);
    return {
      id: row.id,
      plantId: row.plant_id,
      photoUrl: growthPhotos[0]?.url ?? "",
      photoName: growthPhotos[0]?.name ?? "Photo unavailable",
      photos: growthPhotos,
      previousPhotoUrl: previousUrl ?? null,
      previousCapturedAt: row.previous_captured_at,
      note: row.note,
      observation: parsedObservation.data,
      userConfirmation: row.user_confirmation,
      userCorrection: row.user_correction,
      model: row.model,
      capturedAt: row.captured_at,
    };
  });
  return { issueEpisodes, growthChecks };
}

async function removeUploadedPhotos(supabase: CloudClient, photos: PhotoRow[]): Promise<void> {
  for (const photo of photos) {
    const { error: storageError } = await supabase.storage.from("plant-photos").remove([photo.storage_path]);
    if (storageError) throw new Error(`Could not clean up uploaded photo: ${storageError.message}`);
    const { error: recordError } = await supabase.from("photos").delete().eq("id", photo.id);
    throwIfError(recordError, "Could not clean up uploaded photo metadata");
  }
}

export async function createCloudIssueEpisode(input: {
  plantId: string | null;
  independent: boolean;
  symptom: Symptom;
  description: string;
  answers: DoctorAnswers;
  photos: Array<{ file: File; kind: "whole" | "close-up" }>;
  assessment: DoctorAssessment;
}): Promise<IssueEpisode> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  if (input.independent === (input.plantId !== null)) throw new Error("Choose either an owned plant or an independent assessment.");
  if (input.photos.length > 3) throw new Error("Choose no more than three issue photos.");
  const assessment = doctorAssessmentSchema.parse(input.assessment);
  const answers = doctorAnswersSchema.parse(input.answers);
  const { data: row, error } = await supabase.from("issue_episodes").insert({
    owner_id: ownerId,
    plant_id: input.plantId,
    independent: input.independent,
    title: input.plantId ? "Plant doctor assessment" : "Plant doctor assessment (independent)",
    symptom: input.symptom,
    description: input.description.trim(),
    answers: JSON.parse(JSON.stringify(answers)) as Json,
    mode: assessment.mode,
    provider: assessment.provider ?? "",
    model: assessment.model ?? "",
    disclaimer: assessment.disclaimer,
    assessment: JSON.parse(JSON.stringify(assessment)) as Json,
    started_at: new Date().toISOString(),
    status: "open",
  }).select("*").single();
  throwIfError(error, "Could not save plant doctor episode");
  if (!row) throw new Error("Could not save plant doctor episode: no record was returned.");

  const uploaded: PhotoRow[] = [];
  try {
    for (const photo of input.photos) {
      uploaded.push(await uploadPlantPhoto(photo.file, { issueId: row.id, kind: "issue", viewKind: photo.kind }));
    }
    if (uploaded.length) {
      const { error: updateError } = await supabase.from("issue_episodes").update({ photo_ids: uploaded.map((photo) => photo.id) })
        .eq("id", row.id).eq("owner_id", ownerId);
      throwIfError(updateError, "Could not link plant doctor photos");
    }
  } catch (error) {
    try {
      await removeUploadedPhotos(supabase, uploaded);
      const { error: deleteError } = await supabase.from("issue_episodes").delete().eq("id", row.id).eq("owner_id", ownerId);
      throwIfError(deleteError, "Could not remove incomplete plant doctor episode");
    } catch (cleanupError) {
      throw new Error(`${error instanceof Error ? error.message : "Could not save plant doctor photos."} Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : "unknown error"}`);
    }
    throw error;
  }

  const savedPhotos: DoctorPhoto[] = await Promise.all(uploaded.map(async (photo) => ({
    name: photo.id,
    url: await signedPhotoUrl(supabase, photo.storage_path),
    kind: photo.issue_photo_kind ?? "whole",
  })));
  return {
    id: row.id,
    plantId: row.plant_id,
    independent: row.independent,
    title: row.title,
    symptom: row.symptom as Symptom,
    description: row.description,
    answers,
    photos: savedPhotos,
    assessment,
    followUps: [],
    startedAt: row.started_at,
  };
}

export async function createCloudIssueFollowUp(issueId: string, note: string): Promise<IssueFollowUp> {
  const text = note.trim();
  if (!text || text.length > 2000) throw new Error("Write a follow-up between 1 and 2,000 characters.");
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data, error } = await supabase.from("issue_followups").insert({
    owner_id: ownerId,
    issue_id: issueId,
    note: text,
    observed_at: new Date().toISOString(),
  }).select("*").single();
  throwIfError(error, "Could not save plant issue follow-up");
  if (!data) throw new Error("Could not save plant issue follow-up: no record was returned.");
  return { id: data.id, note: data.note, observedAt: data.observed_at };
}

export async function createCloudGrowthCheck(input: {
  plantId: string;
  photos: File[];
  previousCheckId: string | null;
  previousPhotoId: string | null;
  previousCapturedAt: string | null;
  note: string;
  observation: GrowthObservation;
}): Promise<GrowthCheck> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  if (input.photos.length < 1 || input.photos.length > 2) throw new Error("Choose one or two new photos.");
  if (input.note.trim().length > 2000) throw new Error("Keep the note under 2,000 characters.");
  const observation = growthObservationSchema.parse(input.observation);
  let previousCapturedAt: string | null = null;
  if (input.previousPhotoId) {
    const { data: previous, error: previousError } = await supabase.from("growth_checks").select("photo_id,photo_ids,captured_at")
      .eq("id", input.previousCheckId ?? "").eq("owner_id", ownerId).eq("plant_id", input.plantId).maybeSingle();
    throwIfError(previousError, "Could not verify the earlier growth check");
    if (!previous || !(previous.photo_ids.includes(input.previousPhotoId) || previous.photo_id === input.previousPhotoId)) {
      throw new Error("The earlier photo is not available in this plant's history.");
    }
    previousCapturedAt = previous.captured_at;
  }

  const uploaded: PhotoRow[] = [];
  let savedRow: GrowthCheckRow | null = null;
  try {
    for (const file of input.photos) uploaded.push(await uploadPlantPhoto(file, { plantId: input.plantId, kind: "growth" }));
    const photoIds = uploaded.map((photo) => photo.id);
    const { data: row, error } = await supabase.from("growth_checks").insert({
      owner_id: ownerId,
      plant_id: input.plantId,
      photo_id: photoIds[0],
      photo_ids: photoIds,
      previous_photo_id: input.previousPhotoId,
      previous_captured_at: previousCapturedAt,
      note: input.note.trim(),
      observation: JSON.parse(JSON.stringify(observation)) as Json,
      mode: observation.mode,
      provider: observation.provider ?? "",
      model: observation.model ?? "",
      disclaimer: observation.disclaimer,
      captured_at: new Date().toISOString(),
      user_confirmation: "not_confirmed",
      user_correction: "",
    }).select("*").single();
    throwIfError(error, "Could not save growth check");
    if (!row) throw new Error("Could not save growth check: no record was returned.");
    savedRow = row;
  } catch (error) {
    try {
      await removeUploadedPhotos(supabase, uploaded);
    } catch (cleanupError) {
      throw new Error(`${error instanceof Error ? error.message : "Could not save growth check."} Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : "unknown error"}`);
    }
    throw error;
  }

  const growthPhotos: GrowthPhoto[] = await Promise.all(uploaded.map(async (photo) => ({
    id: photo.id,
    name: photo.id,
    url: await signedPhotoUrl(supabase, photo.storage_path),
  })));
  let previousPhotoUrl: string | null = null;
  if (input.previousPhotoId) {
    const { data: previousPhoto, error: previousPhotoError } = await supabase.from("photos").select("storage_path")
      .eq("id", input.previousPhotoId).eq("owner_id", ownerId).single();
    throwIfError(previousPhotoError, "Could not load the earlier growth photo");
    if (!previousPhoto) throw new Error("The earlier growth photo is no longer available.");
    previousPhotoUrl = await signedPhotoUrl(supabase, previousPhoto.storage_path);
  }
  if (!savedRow) throw new Error("Could not save growth check: no record was returned.");
  return {
    id: savedRow.id,
    plantId: savedRow.plant_id,
    photoUrl: growthPhotos[0].url,
    photoName: growthPhotos[0].name,
    photos: growthPhotos,
    previousPhotoUrl,
    previousCapturedAt: savedRow.previous_captured_at,
    note: savedRow.note,
    observation,
    userConfirmation: savedRow.user_confirmation,
    userCorrection: savedRow.user_correction,
    model: savedRow.model,
    capturedAt: savedRow.captured_at,
  };
}

export async function updateCloudGrowthConfirmation(
  growthCheckId: string,
  confirmation: "confirmed" | "corrected" | "not_confirmed",
  correction: string,
): Promise<void> {
  const text = correction.trim();
  if (text.length > 1000) throw new Error("Keep your correction under 1,000 characters.");
  if (confirmation === "corrected" && !text) throw new Error("Add a correction before selecting corrected.");
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data, error } = await supabase.from("growth_checks").update({
    user_confirmation: confirmation,
    user_correction: text,
  }).eq("id", growthCheckId).eq("owner_id", ownerId).select("id").maybeSingle();
  throwIfError(error, "Could not save growth observation confirmation");
  if (!data) throw new Error("Growth check was not found or is not available in this account.");
}

function hasIds(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && keys.every((key) => typeof (value as Record<string, unknown>)[key] === "string");
}

export async function recordCloudCareCheck(input: {
  taskId: string;
  soilMoisture: SoilMoisture;
  plantCondition: PlantCondition;
  action: "water" | "skip" | "inspect";
  note: string;
  recommendationReason: string;
  nextIntervalDays: number;
  nextDueAt: string;
}): Promise<{ data: AppData; tasks: CareTask[] }> {
  const supabase = await client();
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc("record_care_check", {
    p_task_id: input.taskId,
    p_soil_moisture: input.soilMoisture,
    p_plant_condition: input.plantCondition,
    p_action: input.action,
    p_note: input.note,
    p_recommendation_reason: input.recommendationReason,
    p_next_interval_days: input.nextIntervalDays,
    p_next_due_at: input.nextDueAt,
  });
  throwIfError(error, "Could not save the soil check");
  if (!hasIds(data, ["event_id", "completed_task_id", "next_task_id"])) {
    throw new Error("Could not save the soil check: the server returned an invalid result.");
  }
  const [appData, tasks] = await Promise.all([loadCloudAppData(), loadCloudCareTasks()]);
  return { data: appData, tasks };
}

export async function completeCloudCareTask(taskId: string, outcome: "completed" | "skipped", note: string): Promise<{ data: AppData; tasks: CareTask[] }> {
  const supabase = await client();
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc("complete_care_task", {
    p_task_id: taskId,
    p_outcome: outcome,
    p_note: note,
  });
  throwIfError(error, "Could not save the care task");
  if (!hasIds(data, ["event_id", "task_id"])) {
    throw new Error("Could not save the care task: the server returned an invalid result.");
  }
  const [appData, tasks] = await Promise.all([loadCloudAppData(), loadCloudCareTasks()]);
  return { data: appData, tasks };
}

export async function createCareTask(input: {
  plantId: string;
  type: CareTaskType;
  title: string;
  notes?: string;
  dueAt: string;
}): Promise<CareTask> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data, error } = await supabase.from("care_tasks").insert({
    owner_id: ownerId,
    plant_id: input.plantId,
    task_type: input.type === "seasonal_review" ? "observe" : input.type,
    title: input.title.trim(),
    notes: input.notes?.trim() ?? "",
    due_at: input.dueAt,
  }).select("*").single();
  if (error?.code === "23505" && input.type === "soil_check") {
    const { data: existing, error: existingError } = await supabase.from("care_tasks").select("*")
      .eq("plant_id", input.plantId).eq("owner_id", ownerId).eq("task_type", "soil_check")
      .eq("status", "pending").single();
    throwIfError(existingError, "Could not load the existing soil-check task");
    if (existing) return toCareTask(existing);
  }
  throwIfError(error, "Could not create care task");
  if (!data) throw new Error("Could not create care task: no task record was returned.");
  return toCareTask(data);
}

export async function updateCareTask(taskId: string, changes: Partial<Pick<CareTask, "status" | "dueAt" | "snoozedUntil" | "completedAt" | "skippedAt" | "rescheduledAt" | "notes">>): Promise<CareTask> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const update: Database["public"]["Tables"]["care_tasks"]["Update"] = {};
  if (changes.status !== undefined) update.status = changes.status;
  if (changes.dueAt !== undefined) update.due_at = changes.dueAt;
  if (changes.snoozedUntil !== undefined) update.snoozed_until = changes.snoozedUntil;
  if (changes.completedAt !== undefined) update.completed_at = changes.completedAt;
  if (changes.skippedAt !== undefined) update.skipped_at = changes.skippedAt;
  if (changes.rescheduledAt !== undefined) update.rescheduled_at = changes.rescheduledAt;
  if (changes.notes !== undefined) update.notes = changes.notes;
  const { data, error } = await supabase.from("care_tasks").update(update)
    .eq("id", taskId).eq("owner_id", ownerId).select("*").single();
  throwIfError(error, "Could not update care task");
  if (!data) throw new Error("Could not update care task: the task was not found or is not accessible.");
  return toCareTask(data);
}

function toPlant(
  row: PlantRow,
  placement: PlacementRow | undefined,
  taxon: { scientific_name: string; common_name: string } | undefined,
  pot: Database["public"]["Tables"]["pots"]["Row"] | undefined,
  guidance: Database["public"]["Tables"]["care_guidance"]["Row"] | undefined,
  imageUrl: string | undefined,
  events: CareEvent[],
): Plant {
  return {
    id: row.id,
    name: row.nickname,
    scientificName: taxon?.scientific_name ?? "Unknown species",
    imageUrl: imageUrl ?? "/plant-placeholder.svg",
    location: placement?.location_name ?? "Choose a location",
    health: row.health_status,
    lastWatered: row.last_watered_at,
    light: placement?.light_level || row.light_notes || "Not set",
    wateringIntervalDays: row.watering_interval_days,
    environment: {
      lightLevel: classifyLight(placement?.light_level || row.light_notes),
      potMaterial: pot?.material || undefined,
      hasDrainage: pot?.has_drainage ?? undefined,
      substrate: row.substrate_type || undefined,
      season: row.care_season ?? undefined,
      ...(guidance ? { careGuidance: {
        minCheckIntervalDays: guidance.min_check_interval_days,
        maxCheckIntervalDays: guidance.max_check_interval_days,
        sourceTitle: guidance.source_title,
        sourceUrl: guidance.source_url,
      } } : {}),
    },
    events,
  };
}

function classifyLight(value: string): "bright" | "medium" | "low" | undefined {
  const light = value.toLowerCase();
  if (light.includes("bright")) return "bright";
  if (light.includes("medium")) return "medium";
  if (light.includes("low")) return "low";
  return undefined;
}

function toDiscovery(row: DiscoveryRow, taxon: { scientific_name: string; common_name: string } | undefined, imageUrl: string | undefined): Discovery {
  const externalIds = row.external_taxonomy_ids;
  const taxonomyIds = typeof externalIds === "object" && externalIds !== null && !Array.isArray(externalIds)
    ? {
      ...(typeof externalIds.gbif === "string" || externalIds.gbif === null ? { gbif: externalIds.gbif } : {}),
      ...(typeof externalIds.powo === "string" || externalIds.powo === null ? { powo: externalIds.powo } : {}),
    }
    : {};
  return {
    id: row.id,
    commonName: row.common_name || taxon?.common_name || "Unidentified plant",
    scientificName: row.scientific_name || taxon?.scientific_name || "Unknown species",
    imageUrl: imageUrl ?? "/plant-placeholder.svg",
    savedAt: row.created_at,
    source: row.source,
    location: row.location_label || undefined,
    taxonomyIds,
    ...(row.source === "plantnet" ? {
      identification: {
        provider: "Pl@ntNet" as const,
        matchScore: row.identification_match_score,
        providerVersion: row.identification_provider_version,
        wasCorrected: row.identification_was_corrected,
      },
    } : {}),
  };
}

function toCareEvent(row: CareEventRow): CareEvent {
  return {
    id: row.id,
    type: row.event_type,
    date: row.occurred_at,
    note: row.note,
    ...(row.soil_moisture ? { soilMoisture: row.soil_moisture } : {}),
    ...(row.plant_condition ? { plantCondition: row.plant_condition } : {}),
  };
}

function toCareTask(row: CareTaskRow): CareTask {
  return {
    id: row.id,
    plantId: row.plant_id,
    type: row.task_type === "soil_check" || row.task_type === "feed" || row.task_type === "prune" || row.task_type === "repot"
      ? row.task_type : "seasonal_review",
    title: row.title,
    notes: row.notes,
    dueAt: row.due_at,
    status: row.status,
    completedAt: row.completed_at,
    skippedAt: row.skipped_at,
    snoozedUntil: row.snoozed_until,
    rescheduledAt: row.rescheduled_at,
  };
}

async function findTaxonId(supabase: CloudClient, scientificName: string): Promise<string | null> {
  const { data, error } = await supabase.from("taxa").select("id").eq("scientific_name", scientificName).maybeSingle();
  throwIfError(error, "Could not match the plant taxonomy");
  return data?.id ?? null;
}

export async function createPlant(input: NewPlantInput): Promise<Plant> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const taxonId = await findTaxonId(supabase, input.scientificName);
  const row = await singleOrThrow(
    supabase.from("plant_instances").insert({
      owner_id: ownerId,
      taxon_id: taxonId,
      nickname: input.nickname.trim(),
      light_notes: input.light ?? "",
      watering_interval_days: input.wateringIntervalDays ?? 7,
      substrate_type: input.substrateType?.trim() ?? "",
      care_season: input.season ?? null,
    }).select("*").single(),
    "Could not create plant",
  );
  try {
    if (input.location) await createPlacement({ plantId: row.id, locationName: input.location, lightLevel: input.light });
    if (input.potMaterial || input.hasDrainage !== undefined) {
      await savePlantPot({
        plantId: row.id,
        material: input.potMaterial ?? "",
        hasDrainage: input.hasDrainage ?? null,
      });
    }
    if (input.image) await uploadPlantPhoto(input.image, { plantId: row.id, kind: "plant" });
  } catch (error) {
    try {
      await deletePlant(row.id);
    } catch (rollbackError) {
      console.error("Plant setup failed and the new record could not be rolled back.", rollbackError);
      const reason = error instanceof Error ? error.message : "unknown setup failure";
      throw new Error(`Plant setup failed (${reason}); the created plant also could not be rolled back. Check your collection before retrying.`);
    }
    throw error;
  }
  return toPlant(
    row,
    undefined,
    { scientific_name: input.scientificName, common_name: input.commonName ?? "" },
    undefined,
    undefined,
    undefined,
    [],
  );
}

export async function updatePlant(plantId: string, changes: Partial<Pick<Plant, "name" | "location" | "light" | "health" | "wateringIntervalDays">> & {
  substrateType?: string;
  season?: NonNullable<Plant["environment"]>["season"] | null;
  potMaterial?: string;
  hasDrainage?: boolean | null;
}): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const databaseChanges: Database["public"]["Tables"]["plant_instances"]["Update"] = {};
  if (changes.name !== undefined) databaseChanges.nickname = changes.name.trim();
  if (changes.health !== undefined) databaseChanges.health_status = changes.health;
  if (changes.light !== undefined) databaseChanges.light_notes = changes.light;
  if (changes.wateringIntervalDays !== undefined) databaseChanges.watering_interval_days = changes.wateringIntervalDays;
  if (changes.substrateType !== undefined) databaseChanges.substrate_type = changes.substrateType.trim();
  if (changes.season !== undefined) databaseChanges.care_season = changes.season;
  if (Object.keys(databaseChanges).length) {
    await singleOrThrow(
      supabase.from("plant_instances").update(databaseChanges).eq("id", plantId).eq("owner_id", ownerId).select("id").maybeSingle(),
      "Could not update plant",
    );
  }
  if (changes.location !== undefined || changes.light !== undefined) {
    const { data: activePlacement, error } = await supabase.from("placements").select("id")
      .eq("plant_id", plantId).is("removed_at", null).maybeSingle();
    throwIfError(error, "Could not load plant placement");
    if (activePlacement) {
      const placementChanges: Database["public"]["Tables"]["placements"]["Update"] = {};
      if (changes.location !== undefined) placementChanges.location_name = changes.location.trim();
      if (changes.light !== undefined) placementChanges.light_level = changes.light;
      const { error: updateError } = await supabase.from("placements").update(placementChanges)
        .eq("id", activePlacement.id).eq("owner_id", ownerId);
      throwIfError(updateError, "Could not update plant placement");
    } else if (changes.location?.trim()) {
      await createPlacement({ plantId, locationName: changes.location, lightLevel: changes.light });
    }
  }
  if (changes.potMaterial !== undefined || changes.hasDrainage !== undefined) {
    await savePlantPot({
      plantId,
      material: changes.potMaterial,
      hasDrainage: changes.hasDrainage,
    });
  }
}

async function savePlantPot(input: { plantId: string; material?: string; hasDrainage?: boolean | null }): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data: current, error } = await supabase.from("pots").select("id")
    .eq("plant_id", input.plantId).eq("owner_id", ownerId).maybeSingle();
  throwIfError(error, "Could not load plant pot details");
  const values = {
    material: input.material?.trim() ?? "",
    has_drainage: input.hasDrainage ?? null,
  };
  if (current) {
    const { error: updateError } = await supabase.from("pots").update(values)
      .eq("id", current.id).eq("owner_id", ownerId);
    throwIfError(updateError, "Could not save plant pot details");
  } else {
    const { error: insertError } = await supabase.from("pots").insert({
      owner_id: ownerId,
      plant_id: input.plantId,
      ...values,
    });
    throwIfError(insertError, "Could not save plant pot details");
  }
}

export async function archivePlant(plantId: string): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  await singleOrThrow(
    supabase.from("plant_instances").update({ archived_at: new Date().toISOString() })
      .eq("id", plantId).eq("owner_id", ownerId).is("archived_at", null).select("id").maybeSingle(),
    "Could not archive plant",
  );
}

export async function deletePlant(plantId: string): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data: photos, error: photoError } = await supabase.from("photos").select("storage_path")
    .eq("plant_id", plantId).eq("owner_id", ownerId);
  throwIfError(photoError, "Could not prepare plant photo cleanup");
  if (photos?.length) {
    const { error: storageError } = await supabase.storage.from("plant-photos")
      .remove(photos.map((photo) => photo.storage_path));
    throwIfError(storageError, "Could not remove plant photos; the plant record has not been deleted");
  }
  await singleOrThrow(
    supabase.from("plant_instances").delete().eq("id", plantId).eq("owner_id", ownerId).select("id").maybeSingle(),
    "Could not delete plant",
  );
}

export async function createDiscovery(input: NewDiscoveryInput): Promise<Discovery> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const taxonId = await findTaxonId(supabase, input.scientificName);
  const row = await singleOrThrow(
    supabase.from("discoveries").insert({
      owner_id: ownerId,
      taxon_id: taxonId,
      common_name: input.commonName.trim(),
      scientific_name: input.scientificName.trim(),
      source: input.source ?? "manual",
      observed_at: input.observedAt,
      location_label: input.location?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      external_taxonomy_ids: input.externalTaxonomyIds ?? {},
      identification_match_score: input.matchScore ?? null,
      identification_provider_version: input.providerVersion ?? null,
      identification_was_corrected: input.wasCorrected ?? false,
    }).select("*").single(),
    "Could not save discovery",
  );
  return toDiscovery(row, { scientific_name: row.scientific_name, common_name: row.common_name }, undefined);
}

export async function updateDiscovery(discoveryId: string, changes: Partial<Pick<NewDiscoveryInput, "commonName" | "scientificName" | "observedAt" | "location" | "notes">>): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const update: Database["public"]["Tables"]["discoveries"]["Update"] = {};
  if (changes.commonName !== undefined) update.common_name = changes.commonName.trim();
  if (changes.scientificName !== undefined) {
    update.scientific_name = changes.scientificName.trim();
    update.taxon_id = await findTaxonId(supabase, changes.scientificName);
  }
  if (changes.observedAt !== undefined) update.observed_at = changes.observedAt;
  if (changes.location !== undefined) update.location_label = changes.location.trim();
  if (changes.notes !== undefined) update.notes = changes.notes.trim();
  await singleOrThrow(
    supabase.from("discoveries").update(update).eq("id", discoveryId).eq("owner_id", ownerId).select("id").maybeSingle(),
    "Could not update discovery",
  );
}

export async function deleteDiscovery(discoveryId: string): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data: photos, error } = await supabase.from("photos").select("storage_path")
    .eq("discovery_id", discoveryId).eq("owner_id", ownerId);
  throwIfError(error, "Could not prepare discovery photo cleanup");
  if (photos?.length) {
    const { error: storageError } = await supabase.storage.from("plant-photos")
      .remove(photos.map((photo) => photo.storage_path));
    throwIfError(storageError, "Could not remove discovery photos; the discovery has not been deleted");
  }
  await singleOrThrow(
    supabase.from("discoveries").delete().eq("id", discoveryId).eq("owner_id", ownerId).select("id").maybeSingle(),
    "Could not delete discovery",
  );
}

export async function createPlantFromDiscovery(discoveryId: string): Promise<Plant> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const discovery = await singleOrThrow(
    supabase.from("discoveries").select("*").eq("id", discoveryId).eq("owner_id", ownerId).single(),
    "Could not load saved discovery",
  );
  return createPlant({
    nickname: discovery.common_name,
    commonName: discovery.common_name,
    scientificName: discovery.scientific_name,
    location: "Choose a location",
  });
}

export async function createPlacement(input: { plantId: string; locationName: string; lightLevel?: string; notes?: string }): Promise<PlacementRow> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const { data: current, error: findError } = await supabase.from("placements").select("id")
    .eq("plant_id", input.plantId).is("removed_at", null).maybeSingle();
  throwIfError(findError, "Could not check current plant placement");
  if (current) throw new Error("This plant already has an active placement. Update it or move it first.");
  return singleOrThrow(
    supabase.from("placements").insert({
      owner_id: ownerId,
      plant_id: input.plantId,
      location_name: input.locationName.trim(),
      light_level: input.lightLevel ?? "",
      notes: input.notes ?? "",
    }).select("*").single(),
    "Could not create plant placement",
  );
}

export async function updatePlacement(placementId: string, changes: Partial<Pick<PlacementRow, "location_name" | "light_level" | "notes" | "removed_at">>): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  await singleOrThrow(
    supabase.from("placements").update(changes).eq("id", placementId).eq("owner_id", ownerId).select("id").maybeSingle(),
    "Could not update plant placement",
  );
}

export async function createCareEvent(
  plantId: string,
  eventType: CareEventType,
  note: string,
  occurredAt = new Date().toISOString(),
  observation?: { soilMoisture?: SoilMoisture; plantCondition?: PlantCondition; recommendationReason?: string },
): Promise<CareEvent> {
  if (eventType === "water") {
    throw new Error("Watering events must be recorded through a confirmed soil-check decision.");
  }
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const row = await singleOrThrow(
    supabase.from("care_events").insert({
      owner_id: ownerId,
      plant_id: plantId,
      event_type: eventType,
      note: note.trim(),
      occurred_at: occurredAt,
      soil_moisture: observation?.soilMoisture ?? null,
      plant_condition: observation?.plantCondition ?? null,
      recommendation_reason: observation?.recommendationReason ?? "",
    }).select("*").single(),
    "Could not save care event",
  );
  return toCareEvent(row);
}

export async function updateCareEvent(eventId: string, changes: Partial<Pick<CareEventRow, "event_type" | "note" | "occurred_at">>): Promise<void> {
  if (changes.event_type === "water") {
    throw new Error("A watering event can only be created through a confirmed soil-check decision.");
  }
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  await singleOrThrow(
    supabase.from("care_events").update(changes).eq("id", eventId).eq("owner_id", ownerId).select("id").maybeSingle(),
    "Could not update care event",
  );
}

export async function deleteCareEvent(eventId: string): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  await singleOrThrow(
    supabase.from("care_events").delete().eq("id", eventId).eq("owner_id", ownerId).select("id").maybeSingle(),
    "Could not delete care event",
  );
}

export async function uploadPlantPhoto(file: File, target: { plantId: string; kind: "plant" | "care" | "growth" } | { discoveryId: string; kind: "discovery" } | { issueId: string; kind: "issue"; viewKind: "whole" | "close-up" }): Promise<PhotoRow> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  await validatePlantPhoto(file);
  const mimeType = file.type.toLowerCase();
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = extensions[mimeType];
  if (!extension) throw new Error("Choose a JPG, PNG, or WEBP image.");
  const path = `${ownerId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("plant-photos").upload(path, file, {
    contentType: mimeType,
    upsert: false,
    cacheControl: "3600",
  });
  throwIfError(uploadError, "Could not upload photo");
  const { data: photo, error: recordError } = await supabase.from("photos").insert({
    owner_id: ownerId,
    plant_id: "plantId" in target ? target.plantId : null,
    discovery_id: "discoveryId" in target ? target.discoveryId : null,
    issue_id: "issueId" in target ? target.issueId : null,
    issue_photo_kind: "issueId" in target ? target.viewKind : null,
    kind: target.kind,
    storage_path: path,
    mime_type: mimeType,
    byte_size: file.size,
  }).select("*").single();
  if (recordError) {
    const { error: cleanupError } = await supabase.storage.from("plant-photos").remove([path]);
    if (cleanupError) {
      console.error("Uploaded photo could not be cleaned up after metadata failure.", cleanupError);
      throw new Error(`Photo metadata could not be saved, and uploaded file cleanup failed: ${cleanupError.message}`);
    }
    throw new Error(`Could not save photo metadata: ${recordError.message}`);
  }
  if (!photo) {
    const { error: cleanupError } = await supabase.storage.from("plant-photos").remove([path]);
    if (cleanupError) throw new Error(`Photo metadata was not returned and uploaded file cleanup failed: ${cleanupError.message}`);
    throw new Error("Could not save photo metadata: no photo record was returned.");
  }
  return photo;
}

export async function exportUserData(): Promise<CloudExport> {
  const supabase = await client();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  throwIfError(authError, "Could not verify your signed-in account for export");
  const user = authData.user;
  if (!user) throw new Error("Sign in to export account data.");
  const userId = user.id;
  const [profile, taxa, knowledgeSources, plants, discoveries, placements, pots, photos, careEvents, careTasks, growthChecks, issueEpisodes, issueFollowups, aiInferences, assistantConversations, assistantMessages, assistantUsage] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("taxa").select("*"),
    supabase.from("knowledge_sources").select("*"),
    supabase.from("plant_instances").select("*"),
    supabase.from("discoveries").select("*"),
    supabase.from("placements").select("*"),
    supabase.from("pots").select("*"),
    supabase.from("photos").select("*"),
    supabase.from("care_events").select("*"),
    supabase.from("care_tasks").select("*"),
    supabase.from("growth_checks").select("*"),
    supabase.from("issue_episodes").select("*"),
    supabase.from("issue_followups").select("*"),
    supabase.from("ai_inferences").select("*"),
    supabase.from("assistant_conversations").select("*"),
    supabase.from("assistant_messages").select("*"),
    supabase.from("assistant_usage").select("*"),
  ]);
  const results = [profile, taxa, knowledgeSources, plants, discoveries, placements, pots, photos, careEvents, careTasks, growthChecks, issueEpisodes, issueFollowups, aiInferences, assistantConversations, assistantMessages, assistantUsage];
  for (const result of results) throwIfError(result.error, "Could not export account data");
  return {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null, createdAt: user.created_at },
    profile: profile.data,
    taxa: taxa.data ?? [],
    knowledgeSources: knowledgeSources.data ?? [],
    plants: plants.data ?? [],
    discoveries: discoveries.data ?? [],
    placements: placements.data ?? [],
    pots: pots.data ?? [],
    photos: photos.data ?? [],
    careEvents: careEvents.data ?? [],
    careTasks: careTasks.data ?? [],
    growthChecks: (growthChecks.data ?? []) as GrowthCheckRow[],
    issueEpisodes: (issueEpisodes.data ?? []) as IssueEpisodeRow[],
    issueFollowups: (issueFollowups.data ?? []) as IssueFollowUpRow[],
    aiInferences: aiInferences.data ?? [],
    assistantConversations: assistantConversations.data ?? [],
    assistantMessages: assistantMessages.data ?? [],
    assistantUsage: assistantUsage.data ?? [],
  };
}

export async function loadProfilePreferences(): Promise<Database["public"]["Tables"]["profiles"]["Row"]> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  return singleOrThrow(
    supabase.from("profiles").select("*").eq("id", ownerId).single(),
    "Could not load account preferences",
  );
}

export async function requestAccountDeletion(): Promise<void> {
  const supabase = await client();
  await requireUserId(supabase);
  const { error } = await supabase.functions.invoke("delete-account", { body: {} });
  throwIfError(error, "Could not request account deletion");
  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  throwIfError(signOutError, "Account deletion was requested, but sign-out did not complete");
}

export async function updateProfilePreferences(input: {
  units?: Database["public"]["Enums"]["measurement_unit"];
  notificationPreferences?: Record<string, boolean>;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}): Promise<void> {
  const supabase = await client();
  const ownerId = await requireUserId(supabase);
  const update: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (input.units !== undefined) update.units = input.units;
  if (input.notificationPreferences !== undefined) update.notification_preferences = input.notificationPreferences;
  if (input.quietHoursStart !== undefined) update.quiet_hours_start = input.quietHoursStart;
  if (input.quietHoursEnd !== undefined) update.quiet_hours_end = input.quietHoursEnd;
  await singleOrThrow(
    supabase.from("profiles").update(update).eq("id", ownerId).select("id").maybeSingle(),
    "Could not save account preferences",
  );
}
