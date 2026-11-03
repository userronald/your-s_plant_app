import { z } from "zod";

export const observationSchema = z.object({
  note: z.string().trim().min(3, "Add a little more detail (at least 3 characters).").max(500),
});

export const plantNameSchema = z.object({
  name: z.string().trim().min(1, "Plant name is required.").max(60),
});

export const environmentSchema = z.object({
  location: z.string().trim().min(1, "Choose a location.").max(80),
});

export const symptomSchema = z.enum(["yellow", "droop", "spots", "pests", "wilting", "other"]);

export const doctorSchema = z.object({
  symptom: symptomSchema,
  context: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
});

export const doctorAnswersSchema = z.object({
  soilMoisture: z.enum(["dry", "slightly_moist", "wet", "unknown"]),
  wateringChange: z.enum(["yes", "no", "unsure"]),
  drainage: z.enum(["yes", "no", "unsure"]),
  lightChange: z.enum(["yes", "no", "unsure"]),
  pestsSeen: z.enum(["yes", "no", "unsure"]),
  fertilizerChange: z.enum(["yes", "no", "unsure"]),
  temperatureChange: z.enum(["yes", "no", "unsure"]),
  repottedRecently: z.enum(["yes", "no", "unsure"]),
});

export const doctorPhotoSchema = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  kind: z.enum(["whole", "close-up"]),
  name: z.string().max(200).optional(),
});

export const plantDoctorRequestSchema = z.object({
  mode: z.enum(["manual", "ai"]).default("manual"),
  plantId: z.string().min(1).max(120).optional().nullable(),
  independent: z.boolean().default(false),
  photos: z.array(doctorPhotoSchema).max(6).optional().default([]),
  symptom: symptomSchema,
  context: z.string().trim().max(1000).optional().default(""),
  answers: doctorAnswersSchema,
});

export const growthSchema = z.object({
  plantId: z.string().min(1, "Choose a plant."),
  note: z.string().trim().min(3, "Add a brief observation.").max(500),
});

export const growthCheckRequestSchema = z.object({
  plantId: z.string().min(1).max(120),
  photos: z.array(z.object({
    dataUrl: z.string().startsWith("data:image/"),
    name: z.string().max(200).optional(),
  })).min(1).max(4),
  note: z.string().trim().max(1000).optional().default(""),
  previousPhotoDataUrl: z.string().startsWith("data:image/").optional(),
  previousCapturedAt: z.iso.datetime().optional(),
});

export const growthCheckConfirmationSchema = z.object({
  growthCheckId: z.string().min(1),
  userConfirmation: z.enum(["confirmed", "corrected", "not_confirmed"]),
  userCorrection: z.string().trim().max(1000).optional().default(""),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name.").max(80, "Keep the name under 80 characters."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(128, "Password must be 128 characters or fewer."),
});

export type ObservationInput = z.infer<typeof observationSchema>;
export type DoctorInput = z.infer<typeof doctorSchema>;
export type DoctorAnswersInput = z.infer<typeof doctorAnswersSchema>;
export type DoctorPhotoInput = z.infer<typeof doctorPhotoSchema>;
export type PlantDoctorRequestInput = z.infer<typeof plantDoctorRequestSchema>;
export type GrowthInput = z.infer<typeof growthSchema>;
export type GrowthCheckRequestInput = z.infer<typeof growthCheckRequestSchema>;
export type GrowthCheckConfirmationInput = z.infer<typeof growthCheckConfirmationSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
