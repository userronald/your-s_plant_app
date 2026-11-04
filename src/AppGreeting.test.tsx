import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { AppDataProvider } from "./state/AppDataContext";

const mockUser = vi.hoisted(() => ({
  id: "user-1",
  email: "ram@example.com",
  user_metadata: { display_name: "ram" },
}));

vi.mock("./data/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, loading: false, configured: true, error: "" }),
  useOptionalAuth: () => null,
}));

describe("Today greeting", () => {
  it("uses the registered user's display name", () => {
    render(
      <AppDataProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </AppDataProvider>,
    );

    expect(screen.getByText(/Good (morning|afternoon|evening), ram\./)).toBeInTheDocument();
  });
});
