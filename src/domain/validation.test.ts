import { describe, expect, it } from "vitest";
import { doctorSchema, growthSchema, observationSchema, signInSchema, signUpSchema } from "./validation";

describe("form validation", () => {
  it("requires meaningful observation notes", () => {
    expect(observationSchema.safeParse({ note: "ok" }).success).toBe(false);
    expect(observationSchema.safeParse({ note: "A new leaf is opening" }).success).toBe(true);
  });

  it("requires a selected symptom for a doctor example", () => {
    expect(doctorSchema.safeParse({ symptom: "" }).success).toBe(false);
    expect(doctorSchema.safeParse({ symptom: "yellow", context: "The lower leaves changed" }).success).toBe(true);
  });

  it("validates growth notes and an associated plant", () => {
    expect(growthSchema.safeParse({ plantId: "", note: "new leaf" }).success).toBe(false);
    expect(growthSchema.safeParse({ plantId: "demo-monstera", note: "A new leaf is opening" }).success).toBe(true);
  });

  it("validates account credentials before submitting to Supabase Auth", () => {
    expect(signInSchema.safeParse({ email: "invalid", password: "password" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "gardener@example.test", password: "password" }).success).toBe(true);
    expect(signUpSchema.safeParse({ displayName: "", email: "gardener@example.test", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ displayName: "Gardener", email: "gardener@example.test", password: "plant-care-password" }).success).toBe(true);
  });
});
