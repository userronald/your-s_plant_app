import { z } from "zod";

const envSchema = z.object({
  VITE_DEMO_MODE: z.enum(["true", "false"]).default("true"),
  VITE_SUPABASE_URL: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().url().optional(),
  ),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(1).optional(),
  ),
}).superRefine((value, context) => {
  if (value.VITE_DEMO_MODE === "false") {
    if (!value.VITE_SUPABASE_URL) context.addIssue({ code: z.ZodIssueCode.custom, path: ["VITE_SUPABASE_URL"], message: "Set the Supabase project URL to enable account-backed mode." });
    if (!value.VITE_SUPABASE_PUBLISHABLE_KEY) context.addIssue({ code: z.ZodIssueCode.custom, path: ["VITE_SUPABASE_PUBLISHABLE_KEY"], message: "Set the Supabase publishable client key to enable account-backed mode." });
  }
});

export const appEnv = envSchema.parse(import.meta.env);
export const isDemoMode = appEnv.VITE_DEMO_MODE === "true";
