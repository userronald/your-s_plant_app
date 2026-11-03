export type CareEventType = "water" | "feed" | "prune" | "repot" | "observation";
export type HealthStatus = "good" | "check" | "attention";

export interface CareEvent {
  id: string;
  type: CareEventType;
  date: string;
  note: string;
  soilMoisture?: SoilMoisture;
  plantCondition?: PlantCondition;
}

export type SoilMoisture = "dry" | "slightly_moist" | "wet";
export type PlantCondition = "usual" | "changed";
export type CareTaskType = "soil_check" | "feed" | "prune" | "repot" | "seasonal_review";
export type CareTaskStatus = "pending" | "completed" | "skipped" | "cancelled";

export interface SpeciesCareGuidance {
  minCheckIntervalDays: number;
  maxCheckIntervalDays: number;
  sourceTitle: string;
  sourceUrl: string;
}

export interface PlantEnvironment {
  lightLevel?: "bright" | "medium" | "low";
  potMaterial?: string;
  hasDrainage?: boolean;
  substrate?: string;
  season?: "spring" | "summer" | "autumn" | "winter";
  careGuidance?: SpeciesCareGuidance;
}

export interface CareTask {
  id: string;
  plantId: string;
  type: CareTaskType;
  title: string;
  notes: string;
  dueAt: string;
  status: CareTaskStatus;
  completedAt: string | null;
  skippedAt?: string | null;
  snoozedUntil: string | null;
  rescheduledAt?: string | null;
}

export interface Plant {
  id: string;
  name: string;
  scientificName: string;
  imageUrl: string;
  location: string;
  health: HealthStatus;
  lastWatered: string | null;
  wateringIntervalDays: number;
  light: string;
  environment?: PlantEnvironment;
  events: CareEvent[];
}

export interface Discovery {
  id: string;
  commonName: string;
  scientificName: string;
  imageUrl: string;
  savedAt: string;
  source: "demo" | "manual" | "plantnet" | "other";
  plantId?: string;
  location?: string;
  taxonomyIds?: { gbif?: string | null; powo?: string | null };
  identification?: {
    provider: "Pl@ntNet";
    matchScore: number | null;
    providerVersion: string | null;
    wasCorrected: boolean;
  };
}

export type Symptom = "yellow" | "droop" | "spots" | "pests" | "wilting" | "other";
export type Answer = "yes" | "no" | "unsure";
export type AdviceMode = "manual" | "ai" | "demo";
export type PhotoKind = "whole" | "close-up";

export interface DoctorAnswers {
  soilMoisture: "dry" | "slightly_moist" | "wet" | "unknown";
  wateringChange: Answer;
  drainage: Answer;
  lightChange: Answer;
  pestsSeen: Answer;
  fertilizerChange: Answer;
  temperatureChange: Answer;
  repottedRecently: Answer;
}

export interface DoctorCause {
  cause: string;
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  confidence: number | null;
}

export interface DoctorAssessment {
  version: "1";
  mode: AdviceMode;
  observedSymptoms: string[];
  causes: DoctorCause[];
  immediateActions: string[];
  avoid: string[];
  followUpDays: number;
  seekExpertReview: boolean;
  model: string | null;
  provider: string | null;
  disclaimer: string;
  assessedAt: string;
}

export interface DoctorPhoto {
  name: string;
  url: string;
  kind: PhotoKind;
}

export interface IssueFollowUp {
  id: string;
  note: string;
  observedAt: string;
}

export interface IssueEpisode {
  id: string;
  plantId: string | null;
  independent: boolean;
  title: string;
  symptom: Symptom;
  description: string;
  answers: DoctorAnswers | null;
  photos: DoctorPhoto[];
  assessment: DoctorAssessment;
  followUps: IssueFollowUp[];
  startedAt: string;
}

export type GrowthConfirmation = "confirmed" | "corrected" | "not_confirmed";

export interface GrowthChange {
  aspect: string;
  observation: string;
}

export interface GrowthObservation {
  version: "1";
  mode: AdviceMode;
  provider: string | null;
  model: string | null;
  summary: string;
  visibleObservations: string[];
  cannotDetermine: string[];
  changes: GrowthChange[];
  caveats: string[];
  comparedWithPrevious: boolean;
  disclaimer: string;
  observedAt: string;
}

export interface GrowthPhoto {
  id?: string;
  name: string;
  url: string;
}

export interface GrowthCheck {
  id: string;
  plantId: string;
  photoUrl: string;
  photoName: string;
  photos: GrowthPhoto[];
  previousPhotoUrl: string | null;
  previousCapturedAt: string | null;
  note: string;
  observation: GrowthObservation;
  userConfirmation: GrowthConfirmation;
  userCorrection: string;
  model: string;
  capturedAt: string;
}

export interface AppData {
  plants: Plant[];
  discoveries: Discovery[];
  careTasks?: CareTask[];
  issueEpisodes?: IssueEpisode[];
  growthChecks?: GrowthCheck[];
}
