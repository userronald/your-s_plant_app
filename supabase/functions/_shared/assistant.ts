import { z } from "https://esm.sh/zod@3.24.1";

const modelResponseSchema = z.object({
  answer: z.string().trim().min(1).max(5000),
  uncertainty: z.string().trim().min(1).max(1000),
  imageObservations: z.array(z.string().trim().min(1).max(500)).max(8),
  aiInferences: z.array(z.string().trim().min(1).max(500)).max(8),
  safetyNotice: z.string().trim().max(1000),
}).strict();

export type ModelAssistantResponse = z.infer<typeof modelResponseSchema>;

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}

export class AssistantProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "configuration" | "timeout" | "provider" | "invalid_output",
  ) {
    super(message);
    this.name = "AssistantProviderError";
  }
}

function providerConfig() {
  const apiKey = Deno.env.get("AI_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
  const endpoint = Deno.env.get("AI_API_URL") ?? "https://api.openai.com/v1/chat/completions";
  const model = Deno.env.get("AI_MODEL");
  if (!apiKey || !model) throw new AssistantProviderError("The plant assistant is not configured.", "configuration");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AssistantProviderError("The plant assistant provider URL is invalid.", "configuration");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new AssistantProviderError("The plant assistant provider URL must use HTTPS.", "configuration");
  }
  return { apiKey, endpoint: url.toString(), model };
}

export async function requestAssistantResponse(input: {
  system: string;
  turns: AssistantTurn[];
  images: AssistantImage[];
}): Promise<{
  response: ModelAssistantResponse;
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}> {
  const config = providerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const startedAt = Date.now();
  try {
    const messages = [
      { role: "system", content: input.system },
      ...input.turns.map((turn, index) => {
        if (turn.role === "user" && index === input.turns.length - 1 && input.images.length > 0) {
          return {
            role: turn.role,
            content: [
              { type: "text", text: turn.content },
              ...input.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "low" },
              })),
            ],
          };
        }
        return { role: turn.role, content: turn.content };
      }),
    ];
    const result = await fetch(config.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });
if (!result.ok) {
  const errorBody = await result.text();

  console.error("AI provider request failed:", {
    status: result.status,
    statusText: result.statusText,
    body: errorBody.slice(0, 2000),
  });

  throw new AssistantProviderError(
    `The plant assistant provider returned HTTP ${result.status}.`,
    "provider",
  );
}    const envelope = await result.json() as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = envelope.choices?.[0]?.message?.content;
    if (!content) throw new AssistantProviderError("The assistant returned an empty response.", "invalid_output");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AssistantProviderError("The assistant returned malformed structured output.", "invalid_output");
    }
    const response = modelResponseSchema.safeParse(parsed);
    if (!response.success) throw new AssistantProviderError("The assistant response did not match the required safe schema.", "invalid_output");
    return {
      response: response.data,
      provider: new URL(config.endpoint).hostname,
      model: config.model,
      latencyMs: Date.now() - startedAt,
      promptTokens: Number.isInteger(envelope.usage?.prompt_tokens) ? envelope.usage!.prompt_tokens! : null,
      completionTokens: Number.isInteger(envelope.usage?.completion_tokens) ? envelope.usage!.completion_tokens! : null,
    };
  } catch (error) {
    if (error instanceof AssistantProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AssistantProviderError("The plant assistant request timed out.", "timeout");
    }
    throw new AssistantProviderError("The plant assistant could not reach its provider.", "provider");
  } finally {
    clearTimeout(timeout);
  }
}
