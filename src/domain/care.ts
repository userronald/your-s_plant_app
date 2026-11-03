import type {
  CareTask,
  CareTaskStatus,
  Plant,
  PlantCondition,
  SoilMoisture,
  SpeciesCareGuidance,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CHECK_INTERVAL = { min: 3, max: 21, initial: 7 } as const;

export interface CareScheduleInput {
  currentIntervalDays: number;
  soilMoisture: SoilMoisture;
  plantCondition: PlantCondition;
  environment?: Plant["environment"];
  recentObservations?: Array<{ soilMoisture: SoilMoisture; intervalDays: number }>;
  missedCheckIn?: boolean;
  speciesChanged?: boolean;
}

export interface CareScheduleRecommendation {
  action: "water" | "skip" | "inspect";
  nextCheckDays: number;
  nextIntervalDays: number;
  why: string[];
  guidance: SpeciesCareGuidance | null;
}

export function careIntervalBounds(guidance?: SpeciesCareGuidance): { min: number; max: number } {
  if (guidance
    && Number.isInteger(guidance.minCheckIntervalDays)
    && Number.isInteger(guidance.maxCheckIntervalDays)
    && guidance.minCheckIntervalDays >= 1
    && guidance.maxCheckIntervalDays >= guidance.minCheckIntervalDays
    && /^https:\/\//i.test(guidance.sourceUrl)) {
    return { min: guidance.minCheckIntervalDays, max: guidance.maxCheckIntervalDays };
  }
  return { min: DEFAULT_CHECK_INTERVAL.min, max: DEFAULT_CHECK_INTERVAL.max };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function environmentalAdjustment(environment: Plant["environment"]): { days: number; reasons: string[] } {
  if (!environment) return { days: 0, reasons: [] };
  let days = 0;
  const reasons: string[] = [];
  if (environment.lightLevel === "bright") {
    days -= 1;
    reasons.push("Bright light can dry the pot sooner, so the check is slightly earlier.");
  }
  if (environment.lightLevel === "low") {
    days += 1;
    reasons.push("Lower light may slow drying, so the check can be slightly later.");
  }
  if (environment.potMaterial?.toLowerCase() === "terracotta") {
    days -= 1;
    reasons.push("Terracotta can release moisture through the pot, so the check is slightly earlier.");
  }
  if (environment.hasDrainage === false) {
    days -= 1;
    reasons.push("The pot has no drainage holes, so checking sooner helps avoid prolonged wet soil.");
  }
  if (environment.substrate?.toLowerCase() === "fast-draining") {
    days -= 1;
    reasons.push("The fast-draining mix may dry sooner.");
  }
  if (environment.season === "summer") {
    days -= 1;
    reasons.push("You selected summer, when the mix may dry sooner.");
  } else if (environment.season === "winter") {
    days += 1;
    reasons.push("You selected winter, when growth and drying may slow.");
  }
  return { days: clamp(days, -2, 2), reasons };
}

export function calculateCareSchedule(input: CareScheduleInput): CareScheduleRecommendation {
  const guidance = input.environment?.careGuidance ?? null;
  const { min, max } = careIntervalBounds(guidance ?? undefined);
  const why: string[] = [];
  const history = input.recentObservations ?? [];
  const priorInterval = clamp(input.currentIntervalDays, min, max);
  let interval = input.speciesChanged
    ? clamp(Math.round((min + max) / 2), min, max)
    : priorInterval;

  if (input.speciesChanged) {
    why.push("The plant’s identified species changed, so its learned interval was reset within the new care range.");
  } else if (input.soilMoisture === "slightly_moist") {
    let moistCount = 1;
    for (const observation of history) {
      if (observation.soilMoisture !== "slightly_moist") break;
      moistCount += 1;
    }
    interval += Math.min(2, Math.max(1, moistCount));
    why.push(moistCount > 1
      ? `Soil was still slightly moist at ${moistCount} recent checks, so the next routine check moves later.`
      : "The soil was still slightly moist, so the next routine check moves a little later.");
  } else if (input.soilMoisture === "dry" && input.missedCheckIn) {
    interval -= 1;
    why.push("The check was overdue and the soil was dry; the next interval is shortened slightly.");
  } else if (input.soilMoisture === "dry") {
    why.push("The soil is dry. Water only after confirming the plant looks usual and watering is appropriate.");
  } else {
    why.push("The soil is wet, so do not add water; check again soon.");
  }

  const environment = environmentalAdjustment(input.environment);
  if (!input.speciesChanged && input.soilMoisture !== "wet") interval += environment.days;
  why.push(...environment.reasons);
  interval = clamp(interval, min, max);

  const action = input.plantCondition === "changed"
    ? "inspect"
    : input.soilMoisture === "dry" ? "water"
      : input.soilMoisture === "wet" ? "inspect" : "skip";
  if (input.plantCondition === "changed") {
    why.push("You noticed a change in the plant, so inspect it before changing its care.");
  }
  if (guidance) {
    why.push(`The routine interval stays within the sourced ${min}–${max} day range: ${guidance.sourceTitle}.`);
  } else {
    why.push(`No verified species interval is available; the conservative ${min}–${max} day guardrail is used.`);
  }
  const nextCheckDays = input.plantCondition === "changed" ? 1
    : input.soilMoisture === "wet" ? 2
      : interval;

  return {
    action,
    nextCheckDays,
    nextIntervalDays: interval,
    why,
    guidance,
  };
}

export function initialSoilCheckDueAt(
  plant: Pick<Plant, "lastWatered" | "wateringIntervalDays"> & Partial<Pick<Plant, "environment">>,
  now = new Date(),
): string {
  if (!plant.lastWatered) {
    const { min, max } = careIntervalBounds(plant.environment?.careGuidance);
    const adjustment = environmentalAdjustment(plant.environment).days;
    const initial = clamp(DEFAULT_CHECK_INTERVAL.initial + adjustment, min, max);
    return new Date(now.getTime() + initial * DAY_MS).toISOString();
  }
  const { min, max } = careIntervalBounds(plant.environment?.careGuidance);
  const interval = clamp(plant.wateringIntervalDays, min, max);
  const lastWatered = new Date(plant.lastWatered);
  if (!Number.isFinite(lastWatered.getTime())) {
    throw new Error("The saved watering date is invalid; a care check cannot be scheduled.");
  }
  return new Date(lastWatered.getTime() + interval * DAY_MS).toISOString();
}

export function careTaskState(task: Pick<CareTask, "status" | "dueAt" | "snoozedUntil">, now = new Date()): CareTaskStatus | "overdue" | "snoozed" {
  if (task.status !== "pending") return task.status;
  if (task.snoozedUntil && new Date(task.snoozedUntil).getTime() > now.getTime()) return "snoozed";
  return new Date(task.dueAt).getTime() <= now.getTime() ? "overdue" : "pending";
}

export function daysSince(date: string, now = new Date()): number {
  const elapsed = now.getTime() - new Date(date).getTime();
  return Math.max(0, Math.floor(elapsed / DAY_MS));
}

export function getWateringStatus(
  plant: Pick<Plant, "lastWatered" | "wateringIntervalDays">,
  now = new Date(),
): "due" | "upcoming" | "all-good" {
  if (!plant.lastWatered) return "due";
  const elapsedDays = daysSince(plant.lastWatered, now);
  if (elapsedDays >= plant.wateringIntervalDays) return "due";
  if (elapsedDays >= plant.wateringIntervalDays - 2) return "upcoming";
  return "all-good";
}

export function getNextWateringDate(plant: Pick<Plant, "lastWatered" | "wateringIntervalDays">): Date | null {
  if (!plant.lastWatered) return null;
  const nextDate = new Date(plant.lastWatered);
  nextDate.setDate(nextDate.getDate() + plant.wateringIntervalDays);
  return nextDate;
}
