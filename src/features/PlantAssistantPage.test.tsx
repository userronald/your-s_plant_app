import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../domain/assistant";
import { loadPlantAssistantHistory, sendPlantAssistantMessage } from "../data/plantAssistant";
import { PlantAssistantPage } from "./PlantAssistantPage";

const mockAuth = vi.hoisted(() => ({ user: null as { id: string } | null, loading: false }));

vi.mock("../data/AuthContext", () => ({
  useAuth: () => mockAuth,
  useOptionalAuth: () => null,
}));

vi.mock("../state/AppDataContext", () => ({
  useAppData: () => ({
    plants: [{ id: "c04fb044-aeb7-4e8d-a938-22ebf62db127", name: "Fern", scientificName: "Nephrolepis exaltata" }],
    discoveries: [],
  }),
}));

vi.mock("../data/plantAssistant", () => ({
  clearPlantAssistantHistory: vi.fn(),
  loadPlantAssistantConversation: vi.fn(),
  loadPlantAssistantHistory: vi.fn(async () => []),
  PlantAssistantError: class PlantAssistantError extends Error {},
  sendPlantAssistantMessage: vi.fn(),
}));

const response = {
  answer: "Check the soil before changing the watering routine.",
  uncertainty: "I cannot determine the cause from a short description alone.",
  curatedFacts: [],
  userReportedData: ["A garden record was selected."],
  imageObservations: [],
  aiInferences: ["Several causes remain possible."],
  safetyNotice: "",
};

function assistantMessage(): AssistantMessage {
  return {
    id: "7e0b1c71-a9b2-4c33-9aad-5777794c1400",
    role: "assistant",
    content: response.answer,
    createdAt: new Date().toISOString(),
    response,
  };
}

function renderPage() {
  return render(<PlantAssistantPage />);
}

beforeEach(() => {
  mockAuth.user = { id: "signed-in-user" };
  vi.mocked(loadPlantAssistantHistory).mockResolvedValue([]);
  vi.mocked(sendPlantAssistantMessage).mockReset();
});

afterEach(() => {
  cleanup();
  mockAuth.user = null;
});

describe("Plant assistant", () => {
  it("does not claim personal context when no plant is selected", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "How is my plant doing?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findAllByText(/This question may need your plant's context/)).not.toHaveLength(0);
    expect(sendPlantAssistantMessage).not.toHaveBeenCalled();
  });

  it("sends selected plant context and displays uncertainty and evidence categories", async () => {
    vi.mocked(sendPlantAssistantMessage).mockResolvedValue({
      conversationId: "e79ef139-d686-419c-9c3e-01b748d98fb4",
      message: assistantMessage(),
      provider: "configured",
      model: "plant-chat",
    });
    renderPage();
    const context = screen.getByLabelText("Ask in context") as HTMLSelectElement;
    const plantOption = Array.from(context.options).find((option) => option.value.startsWith("plant:"));
    expect(plantOption).toBeDefined();
    fireEvent.change(context, { target: { value: plantOption!.value } });
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "What should I check first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(response.answer)).toBeInTheDocument();
    expect(screen.getByText(response.uncertainty)).toBeInTheDocument();
    expect(screen.getByText("Assistant inferences")).toBeInTheDocument();
    expect(sendPlantAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ kind: "owned_plant" }),
      message: "What should I check first?",
    }));
  });

  it("offers a clearly labelled fallback and retry when the provider fails", async () => {
    vi.mocked(sendPlantAssistantMessage)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({
        conversationId: "e79ef139-d686-419c-9c3e-01b748d98fb4",
        message: assistantMessage(),
        provider: "configured",
        model: "plant-chat",
      });
    renderPage();
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "How do I inspect the leaves?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Assistant unavailable")).toBeInTheDocument();
    expect(screen.getByText(/couldn't check your plant records or verify an AI answer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(sendPlantAssistantMessage).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(response.answer)).toBeInTheDocument();
  });

  it("keeps signed-out notes local without sending them to the assistant service", () => {
    mockAuth.user = null;
    renderPage();
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "A leaf is curling on my fern." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("A leaf is curling on my fern.")).toBeInTheDocument();
    expect(screen.getByText(/not analyzed, saved, or sent to an AI service while signed out/)).toBeInTheDocument();
    expect(sendPlantAssistantMessage).not.toHaveBeenCalled();
  });

  it("clears the previous account's visible conversation when the signed-in user changes", async () => {
    vi.mocked(loadPlantAssistantHistory)
      .mockResolvedValueOnce([{
        id: "e79ef139-d686-419c-9c3e-01b748d98fb4",
        title: "Private account conversation",
        updatedAt: new Date().toISOString(),
      }])
      .mockResolvedValueOnce([]);
    vi.mocked(sendPlantAssistantMessage).mockResolvedValue({
      conversationId: "e79ef139-d686-419c-9c3e-01b748d98fb4",
      message: assistantMessage(),
      provider: "configured",
      model: "plant-chat",
    });
    const view = renderPage();
    expect(await screen.findByText("Private account conversation")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "General question about houseplants" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(response.answer)).toBeInTheDocument();

    mockAuth.user = { id: "another-user" };
    view.rerender(<PlantAssistantPage />);

    await waitFor(() => expect(screen.queryByText(response.answer)).not.toBeInTheDocument());
    expect(screen.getByText("What would you like to know?")).toBeInTheDocument();
  });
});
