import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialDemoData } from "../data/demo";
import { CareActionDialog } from "./PlantUi";

const task = {
  id: "soil-task-1",
  plantId: initialDemoData.plants[0].id,
  type: "soil_check" as const,
  title: "Check soil moisture",
  notes: "",
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  status: "pending" as const,
  completedAt: null,
  snoozedUntil: null,
};

describe("CareActionDialog", () => {
  afterEach(cleanup);

  it("requires soil and plant-condition observations before enabling a decision", () => {
    const onDecision = vi.fn();
    render(<CareActionDialog plant={initialDemoData.plants[0]} task={task} onClose={vi.fn()} onDecision={onDecision} />);

    expect(screen.getByRole("button", { name: "Water" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip and recheck" })).toBeDisabled();
    expect(onDecision).not.toHaveBeenCalled();
  });

  it("does not recommend watering when the soil is not dry", () => {
    const onDecision = vi.fn();
    render(<CareActionDialog plant={initialDemoData.plants[0]} task={task} onClose={vi.fn()} onDecision={onDecision} />);

    fireEvent.click(screen.getByRole("button", { name: "Slightly moist" }));
    fireEvent.click(screen.getByRole("button", { name: "As usual" }));

    expect(screen.getByText("Recommendation: Skip and recheck")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Water" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Skip and recheck" }));
    expect(onDecision).toHaveBeenCalledOnce();
    expect(onDecision.mock.calls[0][0]).toBe("skip");
  });

  it("allows watering only after dry-soil and usual-condition observations", () => {
    const onDecision = vi.fn();
    render(<CareActionDialog plant={initialDemoData.plants[0]} task={task} onClose={vi.fn()} onDecision={onDecision} />);

    fireEvent.click(screen.getByRole("button", { name: "Dry" }));
    expect(screen.getByRole("button", { name: "Water" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "As usual" }));
    expect(screen.getByRole("button", { name: "Water" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    expect(onDecision.mock.calls[0][0]).toBe("water");
  });
});
