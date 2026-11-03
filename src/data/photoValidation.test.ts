import { describe, expect, it } from "vitest";
import { validatePlantPhoto } from "./photoValidation";

describe("validatePlantPhoto", () => {
  it.each([
    ["image/jpeg", [0xff, 0xd8, 0xff, 0x00]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]],
  ])("accepts a supported %s signature", async (mimeType, signature) => {
    const file = new File([new Uint8Array(signature)], "leaf", { type: mimeType });
    await expect(validatePlantPhoto(file)).resolves.toBeUndefined();
  });

  it("rejects images with an unsupported MIME type", async () => {
    const file = new File(["payload"], "plant.svg", { type: "image/svg+xml" });
    await expect(validatePlantPhoto(file)).rejects.toThrow("Choose a JPG, PNG, or WEBP image.");
  });

  it("rejects a forged image MIME type when the file signature does not match", async () => {
    const file = new File(["not really a jpeg"], "plant.jpg", { type: "image/jpeg" });
    await expect(validatePlantPhoto(file)).rejects.toThrow("do not match");
  });

  it("rejects empty and oversized files", async () => {
    await expect(validatePlantPhoto(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow("no larger than 8 MB");
    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    await expect(validatePlantPhoto(oversized)).rejects.toThrow("no larger than 8 MB");
  });
});
