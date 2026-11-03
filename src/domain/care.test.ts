import { describe, expect, it } from "vitest";
import { calculateCareSchedule, getNextWateringDate, getWateringStatus, initialSoilCheckDueAt } from "./care";
import type { Plant } from "./types";

const plant = (lastWatered: string | null, wateringIntervalDays = 7): Pick<Plant, "lastWatered" | "wateringIntervalDays"> => ({
  lastWatered,
  wateringIntervalDays,
});

describe("getWateringStatus", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");

  it("asks the user to check the soil when no watering is recorded", () => {
    expect(getWateringStatus(plant(null), now)).toBe("due");
  });

  it("keeps a recently watered plant in the all-good state", () => {
    expect(getWateringStatus(plant("2026-10-20T12:00:00.000Z"), now)).toBe("all-good");
  });

  it("marks the plant upcoming in the final two days of the interval", () => {
    expect(getWateringStatus(plant("2026-10-19T12:00:00.000Z"), now)).toBe("upcoming");
  });

  it("marks the plant due when the interval has elapsed", () => {
    expect(getWateringStatus(plant("2026-10-17T12:00:00.000Z"), now)).toBe("due");
  });

  it("does not report a future watering date as elapsed", () => {
    expect(getWateringStatus(plant("2026-10-25T12:00:00.000Z"), now)).toBe("all-good");
  });
});

describe("getNextWateringDate", () => {
  it("returns no date until a watering event exists", () => {
    expect(getNextWateringDate(plant(null))).toBeNull();
  });

  describe("calculateCareSchedule", () => {
    const input = {
      currentIntervalDays: 7,
      plantCondition: "usual" as const,
    };

    it("never recommends watering wet soil and schedules a short recheck", () => {
      const result = calculateCareSchedule({ ...input, soilMoisture: "wet" });

      expect(result.action).toBe("inspect");
      expect(result.nextCheckDays).toBe(2);
      expect(result.why.join(" ")).toContain("do not add water");
    });

    it("moves checks later after two recent slightly moist observations, within the general bounds", () => {
      const result = calculateCareSchedule({
        ...input,
        soilMoisture: "slightly_moist",
        recentObservations: [
          { soilMoisture: "slightly_moist", intervalDays: 7 },
          { soilMoisture: "slightly_moist", intervalDays: 7 },
          { soilMoisture: "dry", intervalDays: 7 },
        ],
      });

      expect(result.action).toBe("skip");
      expect(result.nextIntervalDays).toBe(9);
      expect(result.why.join(" ")).toContain("3 recent checks");
    });

    it("shortens a missed check modestly when the soil is dry without treating the reminder as watering", () => {
      const result = calculateCareSchedule({
        ...input,
        soilMoisture: "dry",
        missedCheckIn: true,
      });

      expect(result.action).toBe("water");
      expect(result.nextIntervalDays).toBe(6);
      expect(result.nextCheckDays).toBe(6);
    });

    it("resets the learned interval to the validated midpoint when the species changes", () => {
      const result = calculateCareSchedule({
        ...input,
        currentIntervalDays: 20,
        soilMoisture: "slightly_moist",
        speciesChanged: true,
        environment: {
          careGuidance: {
            minCheckIntervalDays: 5,
            maxCheckIntervalDays: 15,
            sourceTitle: "Verified species guidance",
            sourceUrl: "https://example.org/care",
          },
        },
      });

      expect(result.nextIntervalDays).toBe(10);
      expect(result.guidance?.sourceTitle).toBe("Verified species guidance");
      expect(result.why.join(" ")).toContain("species changed");
    });

    it("uses conservative defaults for sparse history and applies only bounded environmental changes", () => {
      const result = calculateCareSchedule({
        ...input,
        soilMoisture: "dry",
        environment: {
          lightLevel: "bright",
          potMaterial: "terracotta",
          hasDrainage: false,
          substrate: "fast-draining",
          season: "summer",
        },
      });

      expect(result.nextIntervalDays).toBe(5);
      expect(result.why.join(" ")).toContain("conservative 3–21 day guardrail");
    });

    it("initially schedules new plants within sourced bounds and never infers a watering event", () => {
      const now = new Date("2026-10-24T12:00:00.000Z");
      const dueAt = initialSoilCheckDueAt({
        lastWatered: null,
        wateringIntervalDays: 7,
        environment: {
          careGuidance: {
            minCheckIntervalDays: 10,
            maxCheckIntervalDays: 14,
            sourceTitle: "Verified species guidance",
            sourceUrl: "https://example.org/care",
          },
        },
      }, now);

      expect(dueAt).toBe("2026-11-03T12:00:00.000Z");
    });
  });

  it("calculates a reminder from the last recorded watering", () => {
    expect(getNextWateringDate(plant("2026-10-17T12:00:00.000Z"))?.toISOString()).toBe("2026-10-24T12:00:00.000Z");
  });
});
