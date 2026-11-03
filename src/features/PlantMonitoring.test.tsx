import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DEMO_STORAGE_KEY } from "../data/demo";
import { AppDataProvider } from "../state/AppDataContext";
import { GrowthCheckPage, PlantDoctorPage } from "./FeaturePages";

vi.mock("../data/plantDoctor", () => ({
  prepareDoctorPhotos: vi.fn(async (photos: Array<{ file: File; kind: "whole" | "close-up" }>) =>
    photos.map((photo) => ({ ...photo, dataUrl: "data:image/jpeg;base64,cGxhbnQ=" })),
  ),
  requestPlantDoctor: vi.fn(),
}));

vi.mock("../data/growthCheck", () => ({
  requestGrowthCheck: vi.fn(async (input: { photos: File[]; note: string; previousCapturedAt: string | null; mode: "manual" | "ai" | "demo" }) => ({
    observation: {
      version: "1",
      mode: input.mode,
      provider: input.mode === "manual" ? null : "Demo",
      model: null,
      summary: input.previousCapturedAt ? "No obvious change can be confirmed." : "A dated photo was saved as a baseline.",
      visibleObservations: [input.note || "No written observation was provided."],
      cannotDetermine: ["Precise growth cannot be determined from this photo."],
      changes: [],
      caveats: ["Angle and lighting can mislead."],
      comparedWithPrevious: false,
      disclaimer: "Visual observations only; no calibrated measurement.",
      observedAt: new Date().toISOString(),
    },
    photos: input.photos.map((file) => ({ file, dataUrl: "data:image/jpeg;base64,cGxhbnQ=" })),
  })),
}));

function renderPage(page: ReactNode) {
  return render(<MemoryRouter><AppDataProvider>{page}</AppDataProvider></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(DEMO_STORAGE_KEY);
});

describe("Plant Doctor and Growth Check journeys", () => {
  it("collects symptom context and photos, then records an issue follow-up", async () => {
    renderPage(<PlantDoctorPage />);
    const file = new File(["photo"], "leaf.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Add symptom photos (up to 3)"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Soil moisture"), { target: { value: "wet" } });
    fireEvent.change(screen.getByLabelText("Has watering changed recently?"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Notes (where/when/change)"), { target: { value: "Lower leaves are yellowing." } });
    fireEvent.click(screen.getByRole("button", { name: "Get checklist" }));

    expect(await screen.findByText("Possible causes to check (not a diagnosis)")).toBeInTheDocument();
    expect(screen.getAllByText("You report that the soil is wet.").length).toBeGreaterThan(0);
    expect(screen.getByText(/Saved to Plant Doctor history/)).toBeInTheDocument();
    const saved = JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY) ?? "{}") as {
      issueEpisodes?: Array<{ photos: unknown[]; answers: { soilMoisture: string }; followUps: Array<{ note: string }> }>;
    };
    expect(saved.issueEpisodes?.[0]).toMatchObject({
      answers: { soilMoisture: "wet" },
      photos: [{ name: "leaf.png" }],
      followUps: [],
    });

    fireEvent.click(screen.getByText("Assessment and follow-up (0)"));
    fireEvent.change(screen.getByLabelText("Add follow-up observation"), { target: { value: "No further yellowing today." } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByText(/No further yellowing today/)).toBeInTheDocument();
  });

  it("saves dated growth photos and persists a user correction", async () => {
    renderPage(<GrowthCheckPage />);
    const plantSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(plantSelect, { target: { value: (plantSelect as HTMLSelectElement).options[1].value } });
    const file = new File(["photo"], "new-leaf.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Add new growth photos (up to 2)"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("What did you notice?"), { target: { value: "A possible new leaf." } });
    fireEvent.click(screen.getByRole("button", { name: "Save growth check" }));

    expect(await screen.findByText("Growth observation")).toBeInTheDocument();
    expect(screen.getAllByText(/baseline/).length).toBeGreaterThan(0);
    expect(screen.getByText(/New photo ·/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("If corrected, describe your correction"), { target: { value: "It is an existing leaf opening." } });
    fireEvent.click(screen.getByRole("button", { name: "Corrected" }));
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY) ?? "{}") as {
        growthChecks?: Array<{ userConfirmation: string; userCorrection: string; photos: unknown[] }>;
      };
      expect(saved.growthChecks?.[0]).toMatchObject({
        userConfirmation: "corrected",
        userCorrection: "It is an existing leaf opening.",
        photos: [{ name: "new-leaf.png" }],
      });
    });
  });
});
