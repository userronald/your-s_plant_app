import { z } from "zod";

export const assistantContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owned_plant"), id: z.string().uuid() }),
  z.object({
    kind: z.literal("discovery"),
    id: z.string().uuid().optional(),
    commonName: z.string().trim().min(1).max(120),
    scientificName: z.string().trim().min(1).max(200),
    source: z.enum(["demo", "manual", "plantnet", "other"]),
    savedAt: z.iso.datetime({ offset: true }),
  }),
  z.object({ kind: z.literal("species"), scientificName: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal("general") }),
]);

export const assistantReplySchema = z.object({
  answer: z.string().trim().min(1).max(5000),
  uncertainty: z.string().trim().min(1).max(1000),
  curatedFacts: z.array(z.string().trim().min(1).max(500)).max(8),
  userReportedData: z.array(z.string().trim().min(1).max(500)).max(8),
  imageObservations: z.array(z.string().trim().min(1).max(500)).max(8),
  aiInferences: z.array(z.string().trim().min(1).max(500)).max(8),
  safetyNotice: z.string().trim().max(1000),
});

export const assistantMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(6000),
  createdAt: z.iso.datetime({ offset: true }),
  response: assistantReplySchema.nullable(),
});

export const assistantConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  updatedAt: z.iso.datetime({ offset: true }),
  messages: z.array(assistantMessageSchema).max(40),
});

export const assistantResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    conversationId: z.string().uuid(),
    message: assistantMessageSchema.extend({ response: assistantReplySchema }),
    provider: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    latencyMs: z.number().int().nonnegative(),
    remainingRequests: z.number().int().min(0),
  }),
  z.object({
    action: z.literal("history"),
    conversations: z.array(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(120),
      updatedAt: z.iso.datetime({ offset: true }),
    })).max(50),
  }),
  z.object({
    action: z.literal("load"),
    conversation: assistantConversationSchema,
  }),
  z.object({ action: z.literal("clear"), deletedCount: z.number().int().nonnegative() }),
]);

export type AssistantContext = z.infer<typeof assistantContextSchema>;
export type AssistantReply = z.infer<typeof assistantReplySchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type AssistantConversation = z.infer<typeof assistantConversationSchema>;

export function needsPlantContext(message: string): boolean {
  return /\b(my plant|my (?:fern|pothos|monstera|plant)|this plant|these leaves|it(?:'s| is) wilting|yellow leaves|plant problem|plant health|sick plant)\b/i.test(message);
}

export const ASSISTANT_SUGGESTIONS = [
  "How should I check whether it needs water?",
  "What changes should I watch for this week?",
  "Could this symptom have more than one cause?",
  "Is this plant or its sap toxic to pets or people?",
];

export const ASSISTANT_FALLBACK =
  "The plant assistant is unavailable right now, so I couldn't check your plant records or verify an AI answer. You can retry, or describe what you can directly observe. For possible ingestion or exposure, contact a local poison-control service or medical/veterinary professional promptly; don't wait for an AI response.";
