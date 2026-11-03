import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./data/AuthContext";
import { DEMO_STORAGE_KEY } from "./data/demo";
import { AppDataProvider } from "./state/AppDataContext";

vi.mock("./data/plantPhotoCompression", () => ({
  prepareIdentificationPhoto: vi.fn(async (file: File) => file),
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <AppDataProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AppDataProvider>
    </AuthProvider>,
  );
}

describe("Plant AI Companion routes and primary flows", () => {
  beforeEach(() => {
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:plant-photo") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it.each([
    ["/plants", "My plants"],
    ["/plants/demo-monstera", "Monstera"],
    ["/scan/growth", "Track changes over time"],
    ["/scan/location", "Explore by growing spot"],
    ["/passport", "Plant passport"],
    ["/doctor", "Plant Doctor"],
    ["/assistant", "Plant assistant"],
    ["/explore", "Explore plants"],
    ["/profile", "Profile & settings"],
  ])("renders %s", async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });
  it("renders /", () => { renderAt("/"); expect(screen.getByText(/A good day to grow/i)).toBeInTheDocument(); });
  it("renders /scan", () => { renderAt("/scan"); expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(); });

  it("keeps demo identification visibly labeled, saves the accepted discovery, and adds it to the collection", async () => {
    renderAt("/scan");
    const image = new File(["plant"], "plant.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choose plant photos from gallery"), { target: { files: [image] } });
    fireEvent.click(await screen.findByRole("button", { name: "Preview demo result" }));
    expect(await screen.findByText("DEMO RESULT · NOT IDENTIFIED FROM YOUR PHOTO")).toBeInTheDocument();
    expect(screen.getByText(/No match score is generated in demo mode/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save demo discovery" }));
    expect(screen.getByText("Demo discovery saved to this browser.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to My plants" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Swiss cheese plant" })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("link", { name: "Plant passport" })[0]);
    expect(screen.getByText("DEMO RESULT")).toBeInTheDocument();
    expect(screen.getByText("Swiss cheese plant")).toBeInTheDocument();
  });

  it("persists a user-corrected candidate without retaining unrelated provider taxonomy IDs", async () => {
    renderAt("/scan");
    fireEvent.change(screen.getByLabelText("Choose plant photos from gallery"), {
      target: { files: [new File(["plant"], "plant.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Preview demo result" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Golden pothos/ }));
    fireEvent.change(screen.getByLabelText("Common name"), { target: { value: "My corrected plant" } });
    fireEvent.change(screen.getByLabelText("Scientific name"), { target: { value: "Accepted taxon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save demo discovery" }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY) ?? "{}");
      expect(stored.discoveries[0]).toMatchObject({
        commonName: "My corrected plant",
        scientificName: "Accepted taxon",
        source: "demo",
        taxonomyIds: { gbif: null, powo: null },
        identification: { provider: "Pl@ntNet", matchScore: null, wasCorrected: true },
      });
    });
  });

  it("updates plant health and keeps the profile editor keyboard accessible", async () => {
    renderAt("/plants/demo-monstera");
    const editButton = screen.getByRole("button", { name: "Edit profile" });
    editButton.focus();
    fireEvent.click(editButton);
    const closeButton = screen.getByRole("button", { name: "Close" });
    const saveButton = screen.getByRole("button", { name: "Save profile" });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(saveButton).toHaveFocus();
    fireEvent.keyDown(saveButton, { key: "Tab" });
    expect(closeButton).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Health"), { target: { value: "attention" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(editButton).toHaveFocus();
  });

  it("requires a symptom before showing clearly labeled example guidance", async () => {
    renderAt("/doctor");
    fireEvent.click(screen.getByRole("button", { name: "Get checklist" }));
    expect(await screen.findByRole("heading", { name: "Possible causes to check (not a diagnosis)" })).toBeInTheDocument();
    expect(screen.getAllByText(/not a diagnosis/).length).toBeGreaterThan(0);
  });

  it("filters the plant collection by name", () => {
    renderAt("/plants");
    fireEvent.change(screen.getByRole("textbox", { name: "Search your plants" }), { target: { value: "Golden pothos" } });
    expect(screen.getByRole("link", { name: "Open Golden pothos profile" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Monstera profile" })).not.toBeInTheDocument();
  });

  it("persists local preferences and deletes demo data without reseeding the garden", async () => {
    renderAt("/profile");
    fireEvent.click(screen.getByRole("button", { name: "Toggle care notifications preference" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle quiet hours preference" }));
    expect(screen.getByLabelText("Quiet hours start")).toHaveValue("21:00");
    await waitFor(() => {
      expect(window.localStorage.getItem("plant-ai-companion-settings-v1")).toContain('"notifications":true');
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete local data" }));
    expect(screen.getByRole("status")).toHaveTextContent("Demo plants and discoveries were deleted");
    expect(JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY) ?? "{}")).toEqual({ plants: [], discoveries: [], careTasks: [], issueEpisodes: [], growthChecks: [] });
    fireEvent.click(screen.getAllByRole("link", { name: "Today" })[0]);
    expect(screen.getByRole("heading", { name: "Your garden starts here" })).toBeInTheDocument();
  });
});
