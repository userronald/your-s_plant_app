import type { IdentificationPhoto, PlantOrgan } from "./identification.ts";
import {
  IdentificationError,
  MAX_IDENTIFICATION_IMAGE_BYTES,
  MAX_IDENTIFICATION_IMAGES,
  MAX_IDENTIFICATION_TOTAL_BYTES,
  identifyWithPlantNet,
  isPlantOrgan,
} from "./plantnet.ts";

type Reservation =
  | { allowed: true; requestId: string }
  | { allowed: false; reason: string };

export interface IdentifyHandlerDependencies {
  authenticate: (request: Request) => Promise<string | null>;
  reserve: (ownerId: string) => Promise<Reservation>;
  complete: (requestId: string, data: {
    status: "succeeded" | "invalid_upload" | "not_a_plant" | "provider_timeout" | "provider_error" | "missing_credentials";
    imageCount: number;
    latencyMs: number;
    providerVersion: string | null;
    estimatedCostEur: number | null;
    errorCode: string | null;
  }) => Promise<void>;
  apiKey: string | undefined;
  project: string;
  minimumMatchScore: number;
  ambiguousGap: number;
  timeoutMs: number;
  estimatedCostEur: number | null;
  identify?: typeof identifyWithPlantNet;
}

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function errorStatus(error: IdentificationError): number {
  return error.httpStatus;
}

function storedErrorStatus(code: string): "invalid_upload" | "not_a_plant" | "provider_timeout" | "provider_error" | "missing_credentials" {
  if (code === "invalid_upload") return "invalid_upload";
  if (code === "not_a_plant") return "not_a_plant";
  if (code === "provider_timeout") return "provider_timeout";
  if (code === "missing_credentials") return "missing_credentials";
  return "provider_error";
}

async function validateImages(form: FormData): Promise<IdentificationPhoto[]> {
  const images = form.getAll("images");
  const organs = form.getAll("organs");
  if (images.length < 1 || images.length > MAX_IDENTIFICATION_IMAGES) {
    throw new IdentificationError("invalid_upload", "Choose between one and five photos of the same plant.", 400);
  }
  if (organs.length !== images.length || organs.some((organ) => typeof organ !== "string" || !isPlantOrgan(organ))) {
    throw new IdentificationError("invalid_upload", "Choose a valid plant part for each photo.", 400);
  }

  let totalBytes = 0;
  const validated: IdentificationPhoto[] = [];
  for (const [index, image] of images.entries()) {
    if (!(image instanceof File)) {
      throw new IdentificationError("invalid_upload", "Each upload must be a JPEG or PNG image.", 400);
    }
    const mimeType = image.type.toLowerCase();
    if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
      throw new IdentificationError("invalid_upload", "Only JPEG and PNG images are supported.", 400);
    }
    if (image.size < 1 || image.size > MAX_IDENTIFICATION_IMAGE_BYTES) {
      throw new IdentificationError("invalid_upload", "Each image must be no larger than 8 MB.", 400);
    }
    totalBytes += image.size;
    if (totalBytes > MAX_IDENTIFICATION_TOTAL_BYTES) {
      throw new IdentificationError("invalid_upload", "The combined image size must be no larger than 20 MB.", 400);
    }
    const signature = new Uint8Array(await image.slice(0, 8).arrayBuffer());
    const validJpeg = mimeType === "image/jpeg" && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
    const validPng = mimeType === "image/png" && signature.length >= 8
      && signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47
      && signature[4] === 0x0d && signature[5] === 0x0a && signature[6] === 0x1a && signature[7] === 0x0a;
    if (!validJpeg && !validPng) {
      throw new IdentificationError("invalid_upload", "The file contents do not match a JPEG or PNG image.", 400);
    }
    validated.push({ file: image, organ: organs[index] as PlantOrgan });
  }
  return validated;
}

export function createIdentifyPlantHandler(dependencies: IdentifyHandlerDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return json(405, { code: "method_not_allowed", message: "Use POST to identify plant photos." });
    const ownerId = await dependencies.authenticate(request);
    if (!ownerId) return json(401, { code: "unauthorized", message: "Sign in before requesting a live identification." });

    const reservation = await dependencies.reserve(ownerId);
    if (!reservation.allowed) {
      console.info(JSON.stringify({ event: "plant_identification_rate_limited", reason: reservation.reason }));
      return json(429, { code: "rate_limited", message: "You’ve reached the identification limit. Please wait before trying again." });
    }

    let images: IdentificationPhoto[] = [];
    let attemptedImageCount = 0;
    const startedAt = performance.now();
    try {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw new IdentificationError("invalid_upload", "The photo upload could not be read. Please choose the images again.", 400);
      }
      attemptedImageCount = form.getAll("images").length;
      images = await validateImages(form);
      if (!dependencies.apiKey) {
        throw new IdentificationError("missing_credentials", "Live plant identification is not configured. Demo results are clearly marked and are not based on your photo.", 503);
      }
      const identify = dependencies.identify ?? identifyWithPlantNet;
      const result = await identify(images, {
        apiKey: dependencies.apiKey,
        project: dependencies.project,
        minimumMatchScore: dependencies.minimumMatchScore,
        ambiguousGap: dependencies.ambiguousGap,
        timeoutMs: dependencies.timeoutMs,
      });
      await dependencies.complete(reservation.requestId, {
        status: "succeeded",
        imageCount: images.length,
        latencyMs: result.elapsedMs,
        providerVersion: result.providerVersion,
        estimatedCostEur: dependencies.estimatedCostEur,
        errorCode: null,
      });
      console.info(JSON.stringify({
        event: "plant_identification_completed",
        requestId: reservation.requestId,
        provider: result.provider,
        providerVersion: result.providerVersion,
        latencyMs: result.elapsedMs,
        imageCount: attemptedImageCount,
        estimatedCostEur: dependencies.estimatedCostEur,
      }));
      return json(200, result);
    } catch (error) {
      const identificationError = error instanceof IdentificationError
        ? error
        : new IdentificationError("provider_error", "Plant identification could not be completed. Please try again.", 502);
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      try {
        await dependencies.complete(reservation.requestId, {
          status: storedErrorStatus(identificationError.code),
          imageCount: attemptedImageCount,
          latencyMs,
          providerVersion: null,
          estimatedCostEur: null,
          errorCode: identificationError.code,
        });
      } catch (logError) {
        console.error(JSON.stringify({
          event: "plant_identification_log_failed",
          requestId: reservation.requestId,
          error: logError instanceof Error ? logError.message : "unknown",
        }));
        return json(500, { code: "request_log_failed", message: "The request could not be recorded safely. Please try again later." });
      }
      console.error(JSON.stringify({
        event: "plant_identification_failed",
        requestId: reservation.requestId,
        code: identificationError.code,
        latencyMs,
        imageCount: images.length,
      }));
      return json(errorStatus(identificationError), { code: identificationError.code, message: identificationError.message });
    }
  };
}
