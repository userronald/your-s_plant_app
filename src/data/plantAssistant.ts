import { assistantResponseSchema, type AssistantContext, type AssistantConversation, type AssistantMessage } from "../domain/assistant";
import { getSupabaseClient } from "./persistence";
import { appEnv } from "./env";
import { prepareIdentificationPhoto } from "./plantPhotoCompression";

type AssistantAction = { action: "history" }
  | { action: "load"; conversationId: string }
  | { action: "clear"; conversationId?: string | null };

export class PlantAssistantError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PlantAssistantError";
  }
}

async function callAssistant(payload: Record<string, unknown>, signal?: AbortSignal) {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new PlantAssistantError("Sign in to use the contextual plant assistant.", "unauthorized");
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new PlantAssistantError(error.message, "session_error");
  if (!session?.access_token) throw new PlantAssistantError("Sign in to use the contextual plant assistant.", "unauthorized");
  const baseUrl = appEnv.VITE_SUPABASE_URL;
  if (!baseUrl) throw new PlantAssistantError("The plant assistant endpoint is not configured.", "not_configured");
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/functions/v1/plant-assistant`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: appEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PlantAssistantError("The assistant request timed out. Please retry.", "timeout");
    }
    throw new PlantAssistantError("The assistant service could not be reached. Please retry.", "network_error");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PlantAssistantError("The assistant service returned an unreadable response.", "invalid_response");
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
      ? body.message : "The assistant request failed. Please retry.";
    const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code : `http_${response.status}`;
    throw new PlantAssistantError(message, code);
  }
  const parsed = assistantResponseSchema.safeParse(body);
  if (!parsed.success) throw new PlantAssistantError("The assistant returned an invalid response. Please retry.", "invalid_response");
  return parsed.data;
}

export async function sendPlantAssistantMessage(input: {
  conversationId: string | null;
  context: AssistantContext;
  message: string;
  image?: File;
  signal?: AbortSignal;
}): Promise<{ conversationId: string; message: AssistantMessage; provider: string; model: string }> {
  let image: { mimeType: string; base64: string } | undefined;
  if (input.image) {
    try {
      const file = await prepareIdentificationPhoto(input.image);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected image."));
        reader.onerror = () => reject(new Error("Could not read the selected image."));
        reader.readAsDataURL(file);
      });
      const comma = dataUrl.indexOf(",");
      if (comma < 0) throw new Error("The selected image could not be prepared.");
      const mimeType = file.type;
      if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
        throw new Error("Choose a JPEG, PNG, or WEBP photo.");
      }
      image = { mimeType, base64: dataUrl.slice(comma + 1) };
    } catch (error) {
      throw new PlantAssistantError(
        error instanceof Error ? error.message : "The selected image could not be prepared.",
        "invalid_image",
      );
    }
  }
  const result = await callAssistant({
    action: "send",
    conversationId: input.conversationId,
    context: input.context,
    message: input.message,
    image,
  }, input.signal);
  if (result.action !== "send") throw new PlantAssistantError("The assistant returned an unexpected response.", "invalid_response");
  return { conversationId: result.conversationId, message: result.message, provider: result.provider, model: result.model };
}

export async function loadPlantAssistantHistory(): Promise<Array<Pick<AssistantConversation, "id" | "title" | "updatedAt">>> {
  const result = await callAssistant({ action: "history" });
  if (result.action !== "history") throw new PlantAssistantError("The assistant returned an unexpected response.", "invalid_response");
  return result.conversations;
}

export async function loadPlantAssistantConversation(conversationId: string): Promise<AssistantConversation> {
  const result = await callAssistant({ action: "load", conversationId });
  if (result.action !== "load") throw new PlantAssistantError("The assistant returned an unexpected response.", "invalid_response");
  return result.conversation;
}

export async function clearPlantAssistantHistory(conversationId?: string | null): Promise<number> {
  const action: AssistantAction = { action: "clear", conversationId };
  const result = await callAssistant(action);
  if (result.action !== "clear") throw new PlantAssistantError("The assistant returned an unexpected response.", "invalid_response");
  return result.deletedCount;
}
