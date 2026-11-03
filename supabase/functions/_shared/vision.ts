export interface VisionImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface VisionResult {
  provider: string;
  model: string;
  content: string;
}

export class VisionRequestError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "VisionRequestError";
  }
}

function imageDataUrl(image: VisionImage): string {
  let binary = "";
  for (const byte of image.bytes) binary += String.fromCharCode(byte);
  return `data:${image.mimeType};base64,${btoa(binary)}`;
}

export async function requestVisionJson(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  images: VisionImage[],
): Promise<VisionResult> {
  const endpoint = Deno.env.get("VISION_API_URL") ?? "https://api.openai.com/v1/chat/completions";
  const model = Deno.env.get("VISION_MODEL") ?? "gpt-4o-mini";
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new VisionRequestError("The configured vision endpoint URL is invalid.", 503);
  }
  if (endpointUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(endpointUrl.hostname)) {
    throw new VisionRequestError("The configured vision endpoint must use HTTPS.", 503);
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              ...images.map((image) => ({
                type: "image_url",
                image_url: { url: imageDataUrl(image), detail: "high" },
              })),
            ],
          },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new VisionRequestError("The vision service took too long. Please try again or use the checklist.", 504);
    }
    console.error(JSON.stringify({ event: "vision_provider_request_failed", message: error instanceof Error ? error.message : "unknown" }));
    throw new VisionRequestError("The vision service is temporarily unavailable. Please try again or use the checklist.", 503);
  }

  if (!response.ok) {
    console.error(JSON.stringify({ event: "vision_provider_error", status: response.status }));
    throw new VisionRequestError("The vision service could not complete this request. Please try again or use the checklist.", 502);
  }

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !("choices" in payload) || !Array.isArray(payload.choices)) {
    throw new VisionRequestError("The vision service returned an invalid response.");
  }
  const first = payload.choices[0];
  if (typeof first !== "object" || first === null || !("message" in first) || typeof first.message !== "object" || first.message === null
    || !("content" in first.message) || typeof first.message.content !== "string") {
    throw new VisionRequestError("The vision service returned an invalid response.");
  }

  return { provider: endpointUrl.hostname, model, content: first.message.content };
}

export function uploadedImage(file: File): Promise<VisionImage> {
  return file.arrayBuffer().then((buffer) => ({
    bytes: new Uint8Array(buffer),
    mimeType: file.type.toLowerCase(),
  }));
}
