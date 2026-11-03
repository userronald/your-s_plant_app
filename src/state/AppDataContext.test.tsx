import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_STORAGE_KEY, initialDemoData } from "../data/demo";
import { calculateCareSchedule } from "../domain/care";
import { AppDataProvider, useAppData } from "./AppDataContext";

function DataProbe() {
  const { plants, discoveries, addDiscovery, addPlantFromDiscovery, addEvent } = useAppData();
  const saveExample = () => {
    const discovery = addDiscovery({
      commonName: "Sample fern",
      scientificName: "Sample fern species",
      imageUrl: "/sample-fern.jpg",
    });
    window.sessionStorage.setItem("last-discovery", discovery.id);
  };
  const addExample = async () => {
    const discoveryId = window.sessionStorage.getItem("last-discovery");
    if (discoveryId) await addPlantFromDiscovery(discoveryId);
  };

  return <>
    <output aria-label="Plant count">{plants.length}</output>
    <output aria-label="Discovery count">{discoveries.length}</output>
    <button onClick={saveExample}>Save sample discovery</button>
    <button onClick={addExample}>Add sample to plants</button>
    <button onClick={() => addEvent(plants[0].id, "observation", "Noticed a new leaf.")}>Record observation</button>
  </>;
}

function WateringProbe() {
  const { plants, careTasks, addEvent, recordSoilCheck } = useAppData();
  const [error, setError] = useState("");
  const plant = plants[0];
  const task = careTasks.find((item) => item.plantId === plant?.id && item.type === "soil_check" && item.status === "pending");
  const wateringCount = plant?.events.filter((event) => event.type === "water").length ?? 0;
  return <>
    <output aria-label="Watering event count">{wateringCount}</output>
    <button onClick={() => void addEvent(plant.id, "water", "Watered").catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "failed"))}>Try direct watering log</button>
    <button onClick={() => {
      if (!task) return;
      const recommendation = calculateCareSchedule({
        currentIntervalDays: plant.wateringIntervalDays,
        soilMoisture: "dry",
        plantCondition: "usual",
        environment: plant.environment,
      });
      void recordSoilCheck(task.id, plant, "dry", "usual", "water", recommendation).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "failed"));
    }}>Confirm dry soil and water</button>
    {error && <p role="alert">{error}</p>}
  </>;
}

describe("AppDataProvider", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists a saved discovery and adds it to the plant collection", async () => {
    render(<AppDataProvider><DataProbe /></AppDataProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Save sample discovery" }));
    fireEvent.click(screen.getByRole("button", { name: "Add sample to plants" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Plant count")).toHaveTextContent("4");
      expect(screen.getByLabelText("Discovery count")).toHaveTextContent("1");
    });
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY) ?? "{}") as { plants?: unknown[]; discoveries?: unknown[] };
      expect(saved.plants).toHaveLength(4);
      expect(saved.discoveries).toHaveLength(1);
    });
  });

  it("returns the created plant so callers can navigate to its passport", async () => {
    let plantId = "";
    function NavigationProbe() {
      const { addDiscovery, addPlantFromDiscovery } = useAppData();
      return <button onClick={() => void (async () => {
        const discovery = addDiscovery({ commonName: "Sample fern", scientificName: "Sample fern species", imageUrl: "/sample.jpg" });
        plantId = (await addPlantFromDiscovery(discovery.id))?.id ?? "";
      })()}>Create passport</button>;
    }
    render(<AppDataProvider><NavigationProbe /></AppDataProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Create passport" }));
    await waitFor(() => expect(plantId).toBeTruthy());
  });

  it("records a user-selected observation in the plant timeline and persistent data", async () => {
    render(<AppDataProvider><DataProbe /></AppDataProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Record observation" }));

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY) ?? "{}") as {
        plants?: Array<{ events?: Array<{ type: string; note: string }> }>;
      };
      expect(saved.plants?.[0].events?.[0]).toMatchObject({
        type: "observation",
        note: "Noticed a new leaf.",
      });
    });
  });

  it("does not log watering directly, and records it after an explicit dry-soil confirmation", async () => {
    render(<AppDataProvider><WateringProbe /></AppDataProvider>);
    const initialWateringCount = initialDemoData.plants[0].events.filter((event) => event.type === "water").length;

    fireEvent.click(screen.getByRole("button", { name: "Try direct watering log" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Record watering only after confirming dry soil and usual plant condition.");
    expect(screen.getByLabelText("Watering event count")).toHaveTextContent(String(initialWateringCount));

    fireEvent.click(screen.getByRole("button", { name: "Confirm dry soil and water" }));
    await waitFor(() => expect(screen.getByLabelText("Watering event count")).toHaveTextContent(String(initialWateringCount + 1)));
  });
});
