export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type OwnedRow = { id: string; owner_id: string; created_at: string };
type UpdatedRow = { id: string; created_at: string; updated_at: string };
type UpdatedOwnedRow = OwnedRow & { updated_at: string };

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        { id: string; display_name: string; units: Database["public"]["Enums"]["measurement_unit"]; notification_preferences: Json; quiet_hours_start: string | null; quiet_hours_end: string | null; created_at: string; updated_at: string },
        { id: string; display_name?: string; units?: Database["public"]["Enums"]["measurement_unit"]; notification_preferences?: Json; quiet_hours_start?: string | null; quiet_hours_end?: string | null }
      >;
      taxa: Table<
        UpdatedRow & { scientific_name: string; common_name: string; rank: Database["public"]["Enums"]["taxon_rank"]; parent_taxon_id: string | null; description: string },
        { scientific_name: string; common_name?: string; rank?: Database["public"]["Enums"]["taxon_rank"]; parent_taxon_id?: string | null; description?: string }
      >;
      knowledge_sources: Table<
        UpdatedRow & { taxon_id: string | null; title: string; source_url: string | null; publisher: string; license: string; content_summary: string; published_at: string | null },
        { taxon_id?: string | null; title: string; source_url?: string | null; publisher?: string; license?: string; content_summary?: string; published_at?: string | null }
      >;
      plant_instances: Table<
        UpdatedOwnedRow & { taxon_id: string | null; nickname: string; health_status: Database["public"]["Enums"]["plant_health"]; light_notes: string; watering_interval_days: number; last_watered_at: string | null; acquired_at: string | null; archived_at: string | null; substrate_type: string; care_season: "spring" | "summer" | "autumn" | "winter" | null },
        { id?: string; owner_id?: string; taxon_id?: string | null; nickname: string; health_status?: Database["public"]["Enums"]["plant_health"]; light_notes?: string; watering_interval_days?: number; last_watered_at?: string | null; acquired_at?: string | null; archived_at?: string | null; substrate_type?: string; care_season?: "spring" | "summer" | "autumn" | "winter" | null }
      >;
      discoveries: Table<
        UpdatedOwnedRow & { taxon_id: string | null; common_name: string; scientific_name: string; source: Database["public"]["Enums"]["discovery_source"]; observed_at: string; location_label: string; notes: string; external_taxonomy_ids: Json; identification_match_score: number | null; identification_provider_version: string | null; identification_was_corrected: boolean },
        { id?: string; owner_id?: string; taxon_id?: string | null; common_name: string; scientific_name: string; source?: Database["public"]["Enums"]["discovery_source"]; observed_at?: string; location_label?: string; notes?: string; external_taxonomy_ids?: Json; identification_match_score?: number | null; identification_provider_version?: string | null; identification_was_corrected?: boolean }
      >;
      identification_requests: Table<
        OwnedRow & { provider: "plantnet"; status: "pending" | "succeeded" | "invalid_upload" | "not_a_plant" | "provider_timeout" | "provider_error" | "missing_credentials"; image_count: number; latency_ms: number | null; provider_version: string | null; estimated_cost_eur: number | null; error_code: string | null; completed_at: string | null },
        { id?: string; owner_id: string; provider: "plantnet"; status: "pending" | "succeeded" | "invalid_upload" | "not_a_plant" | "provider_timeout" | "provider_error" | "missing_credentials"; image_count?: number; latency_ms?: number | null; provider_version?: string | null; estimated_cost_eur?: number | null; error_code?: string | null; created_at?: string; completed_at?: string | null }
      >;
      placements: Table<
        UpdatedOwnedRow & { plant_id: string; location_name: string; light_level: string; notes: string; placed_at: string; removed_at: string | null },
        { id?: string; owner_id?: string; plant_id: string; location_name: string; light_level?: string; notes?: string; placed_at?: string; removed_at?: string | null }
      >;
      pots: Table<
        UpdatedOwnedRow & { plant_id: string | null; label: string; material: string; diameter_cm: number | null; has_drainage: boolean | null; notes: string },
        { id?: string; owner_id?: string; plant_id?: string | null; label?: string; material?: string; diameter_cm?: number | null; has_drainage?: boolean | null; notes?: string }
      >;
      photos: Table<
        OwnedRow & { plant_id: string | null; discovery_id: string | null; issue_id: string | null; issue_photo_kind: "whole" | "close-up" | null; kind: Database["public"]["Enums"]["photo_kind"]; storage_path: string; mime_type: string; byte_size: number; captured_at: string },
        { id?: string; owner_id?: string; plant_id?: string | null; discovery_id?: string | null; issue_id?: string | null; issue_photo_kind?: "whole" | "close-up" | null; kind: Database["public"]["Enums"]["photo_kind"]; storage_path: string; mime_type: string; byte_size: number; captured_at?: string }
      >;
      care_events: Table<
        UpdatedOwnedRow & { plant_id: string; photo_id: string | null; event_type: Database["public"]["Enums"]["care_event_type"]; note: string; occurred_at: string; soil_moisture: "dry" | "slightly_moist" | "wet" | null; plant_condition: "usual" | "changed" | null; recommendation_reason: string },
        { id?: string; owner_id?: string; plant_id: string; photo_id?: string | null; event_type: Database["public"]["Enums"]["care_event_type"]; note?: string; occurred_at?: string; soil_moisture?: "dry" | "slightly_moist" | "wet" | null; plant_condition?: "usual" | "changed" | null; recommendation_reason?: string }
      >;
      care_tasks: Table<
        UpdatedOwnedRow & { plant_id: string; task_type: Database["public"]["Enums"]["care_task_type"]; title: string; notes: string; due_at: string; status: Database["public"]["Enums"]["care_task_status"]; completed_at: string | null; snoozed_until: string | null; skipped_at: string | null; rescheduled_at: string | null },
        { id?: string; owner_id?: string; plant_id: string; task_type: Database["public"]["Enums"]["care_task_type"]; title: string; notes?: string; due_at: string; status?: Database["public"]["Enums"]["care_task_status"]; completed_at?: string | null; snoozed_until?: string | null; skipped_at?: string | null; rescheduled_at?: string | null }
      >;
      care_guidance: Table<
        UpdatedRow & { taxon_id: string; min_check_interval_days: number; max_check_interval_days: number; source_title: string; source_url: string; verified_at: string },
        { id?: string; taxon_id: string; min_check_interval_days: number; max_check_interval_days: number; source_title: string; source_url: string; verified_at: string }
      >;
      growth_checks: Table<
        OwnedRow & {
          plant_id: string;
          photo_id: string | null;
          photo_ids: string[];
          previous_photo_id: string | null;
          previous_captured_at: string | null;
          note: string;
          observation: Json | null;
          mode: "manual" | "ai" | "demo";
          provider: string;
          model: string;
          disclaimer: string;
          user_confirmation: "confirmed" | "corrected" | "not_confirmed";
          user_correction: string;
          inference_id: string | null;
          captured_at: string;
        },
        {
          id?: string;
          owner_id?: string;
          plant_id: string;
          photo_id?: string | null;
          photo_ids?: string[];
          previous_photo_id?: string | null;
          previous_captured_at?: string | null;
          note?: string;
          observation?: Json | null;
          mode?: "manual" | "ai" | "demo";
          provider?: string;
          model?: string;
          disclaimer?: string;
          user_confirmation?: "confirmed" | "corrected" | "not_confirmed";
          user_correction?: string;
          inference_id?: string | null;
          captured_at?: string;
        }
      >;
      issue_episodes: Table<
        UpdatedOwnedRow & {
          plant_id: string | null;
          independent: boolean;
          title: string;
          symptom: string;
          description: string;
          answers: Json | null;
          status: Database["public"]["Enums"]["issue_status"];
          mode: "manual" | "ai" | "demo";
          provider: string;
          model: string;
          disclaimer: string;
          assessment: Json | null;
          photo_ids: string[];
          inference_id: string | null;
          started_at: string;
          resolved_at: string | null;
        },
        {
          id?: string;
          owner_id?: string;
          plant_id?: string | null;
          independent?: boolean;
          title: string;
          symptom: string;
          description?: string;
          answers?: Json | null;
          status?: Database["public"]["Enums"]["issue_status"];
          mode?: "manual" | "ai" | "demo";
          provider?: string;
          model?: string;
          disclaimer?: string;
          assessment?: Json | null;
          photo_ids?: string[];
          inference_id?: string | null;
          started_at?: string;
          resolved_at?: string | null;
        }
      >;
      issue_followups: Table<
        OwnedRow & { issue_id: string; note: string; observed_at: string },
        { id?: string; owner_id?: string; issue_id: string; note: string; observed_at?: string }
      >;
      ai_inferences: Table<
        OwnedRow & { plant_id: string | null; discovery_id: string | null; inference_kind: Database["public"]["Enums"]["inference_kind"]; provider: string; model: string; result: Json; confidence: number | null; disclaimer: string },
        { id?: string; owner_id?: string; plant_id?: string | null; discovery_id?: string | null; inference_kind: Database["public"]["Enums"]["inference_kind"]; provider: string; model?: string; result: Json; confidence?: number | null; disclaimer?: string }
      >;
      ai_inference_sources: Table<
        { inference_id: string; knowledge_source_id: string; created_at: string },
        { inference_id: string; knowledge_source_id: string; created_at?: string }
      >;
      assistant_conversations: Table<
        OwnedRow & { title: string; updated_at: string },
        { id?: string; owner_id?: string; title: string; created_at?: string; updated_at?: string }
      >;
      assistant_messages: Table<
        OwnedRow & {
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          response: Json | null;
          context_kind: "owned_plant" | "discovery" | "species" | "general" | null;
          context_id: string | null;
          context_ref: string;
        },
        {
          id?: string;
          owner_id: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          response?: Json | null;
          context_kind?: "owned_plant" | "discovery" | "species" | "general" | null;
          context_id?: string | null;
          context_ref: string;
          created_at?: string;
        }
      >;
      assistant_usage: Table<
        OwnedRow & {
          provider: string;
          model: string;
          status: "reserved" | "succeeded" | "provider_error" | "invalid_output";
          prompt_tokens: number | null;
          completion_tokens: number | null;
          latency_ms: number | null;
          completed_at: string | null;
        },
        {
          id?: string;
          owner_id: string;
          provider?: string;
          model?: string;
          status?: "reserved" | "succeeded" | "provider_error" | "invalid_output";
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          latency_ms?: number | null;
          created_at?: string;
          completed_at?: string | null;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      reserve_plant_identification: {
        Args: { p_owner_id: string; p_user_per_minute: number; p_user_per_day: number; p_provider_per_day: number; p_max_concurrent: number };
        Returns: Json;
      };
      record_care_check: {
        Args: {
          p_task_id: string;
          p_soil_moisture: "dry" | "slightly_moist" | "wet";
          p_plant_condition: "usual" | "changed";
          p_action: "water" | "skip" | "inspect";
          p_note: string;
          p_recommendation_reason: string;
          p_next_interval_days: number;
          p_next_due_at: string;
        };
        Returns: Json;
      };
      complete_care_task: {
        Args: { p_task_id: string; p_outcome: "completed" | "skipped"; p_note: string };
        Returns: Json;
      };
      reserve_plant_assistant_request: {
        Args: { p_owner_id: string };
        Returns: Json;
      };
    };
    Enums: {
      measurement_unit: "metric" | "imperial";
      taxon_rank: "species" | "genus" | "family" | "other";
      plant_health: "good" | "check" | "attention";
      discovery_source: "manual" | "plantnet" | "demo" | "other";
      photo_kind: "plant" | "discovery" | "care" | "growth" | "issue";
      care_event_type: "water" | "feed" | "prune" | "repot" | "observation";
      care_task_status: "pending" | "completed" | "skipped" | "cancelled";
      care_task_type: "soil_check" | "water" | "feed" | "prune" | "repot" | "observe" | "custom";
      issue_status: "open" | "monitoring" | "resolved" | "dismissed";
      inference_kind: "identification" | "diagnosis" | "care_advice";
    };
    CompositeTypes: Record<string, never>;
  };
}
