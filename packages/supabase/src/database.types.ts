export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_memberships: {
        Row: {
          created_at: string
          onboarding_completed_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          onboarding_completed_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          onboarding_completed_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          agreed_at: string
          document_kind: string
          document_version: string
          user_id: string
        }
        Insert: {
          agreed_at?: string
          document_kind: string
          document_version: string
          user_id: string
        }
        Update: {
          agreed_at?: string
          document_kind?: string
          document_version?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_document_fk"
            columns: ["document_kind", "document_version"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["kind", "version"]
          },
        ]
      }
      current_legal_documents: {
        Row: {
          document_version: string
          kind: string
        }
        Insert: {
          document_version: string
          kind: string
        }
        Update: {
          document_version?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "current_legal_documents_document_fk"
            columns: ["kind", "document_version"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["kind", "version"]
          },
        ]
      }
      dive_logs: {
        Row: {
          created_at: string
          deleted_at: string | null
          dive_mode: string | null
          duration_seconds: number | null
          ended_at: string | null
          id: string
          local_id: string
          manual_data: Json
          max_depth_meters: number | null
          mobile_data: Json
          payload_sha256: string
          profile_byte_count: number | null
          profile_content_revision: string | null
          profile_path: string | null
          profile_preview: Json | null
          profile_sample_count: number | null
          profile_sha256: string | null
          provenance: Json
          rating: number | null
          revision: number
          site_name: string | null
          source: string
          source_plan_id: string | null
          started_at: string
          title: string | null
          updated_at: string
          user_id: string
          watch_metadata: Json | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          dive_mode?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          local_id: string
          manual_data: Json
          max_depth_meters?: number | null
          mobile_data: Json
          payload_sha256: string
          profile_byte_count?: number | null
          profile_content_revision?: string | null
          profile_path?: string | null
          profile_preview?: Json | null
          profile_sample_count?: number | null
          profile_sha256?: string | null
          provenance: Json
          rating?: number | null
          revision?: number
          site_name?: string | null
          source: string
          source_plan_id?: string | null
          started_at: string
          title?: string | null
          updated_at?: string
          user_id: string
          watch_metadata?: Json | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          dive_mode?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          local_id?: string
          manual_data?: Json
          max_depth_meters?: number | null
          mobile_data?: Json
          payload_sha256?: string
          profile_byte_count?: number | null
          profile_content_revision?: string | null
          profile_path?: string | null
          profile_preview?: Json | null
          profile_sample_count?: number | null
          profile_sha256?: string | null
          provenance?: Json
          rating?: number | null
          revision?: number
          site_name?: string | null
          source?: string
          source_plan_id?: string | null
          started_at?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          watch_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "dive_logs_user_id_source_plan_id_fkey"
            columns: ["user_id", "source_plan_id"]
            isOneToOne: false
            referencedRelation: "dive_plans"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      dive_plans: {
        Row: {
          converted_log_id: string | null
          created_at: string
          deleted_at: string | null
          dive_mode: string | null
          id: string
          local_id: string
          payload_sha256: string
          plan_data: Json
          planned_at: string | null
          revision: number
          site_name: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          converted_log_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dive_mode?: string | null
          id?: string
          local_id: string
          payload_sha256: string
          plan_data: Json
          planned_at?: string | null
          revision?: number
          site_name?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          converted_log_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dive_mode?: string | null
          id?: string
          local_id?: string
          payload_sha256?: string
          plan_data?: Json
          planned_at?: string | null
          revision?: number
          site_name?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dive_plans_converted_log_owner_fk"
            columns: ["user_id", "converted_log_id"]
            isOneToOne: false
            referencedRelation: "dive_logs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      guest_claim_batches: {
        Row: {
          abandoned_at: string | null
          client_batch_id: string
          committed_at: string | null
          created_at: string
          expected_log_count: number
          expected_plan_count: number
          id: string
          manifest_sha256: string
          status: string
          user_id: string
        }
        Insert: {
          abandoned_at?: string | null
          client_batch_id: string
          committed_at?: string | null
          created_at?: string
          expected_log_count: number
          expected_plan_count: number
          id?: string
          manifest_sha256: string
          status?: string
          user_id: string
        }
        Update: {
          abandoned_at?: string | null
          client_batch_id?: string
          committed_at?: string | null
          created_at?: string
          expected_log_count?: number
          expected_plan_count?: number
          id?: string
          manifest_sha256?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      guest_claim_records: {
        Row: {
          batch_id: string
          client_record_id: string
          converted_log_client_record_id: string | null
          created_at: string
          entity_kind: string
          id: string
          payload: Json
          payload_sha256: string
          profile_byte_count: number | null
          profile_content_revision: string | null
          profile_path: string | null
          profile_sample_count: number | null
          profile_sha256: string | null
          source_plan_client_record_id: string | null
          target_record_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          batch_id: string
          client_record_id: string
          converted_log_client_record_id?: string | null
          created_at?: string
          entity_kind: string
          id?: string
          payload: Json
          payload_sha256: string
          profile_byte_count?: number | null
          profile_content_revision?: string | null
          profile_path?: string | null
          profile_sample_count?: number | null
          profile_sha256?: string | null
          source_plan_client_record_id?: string | null
          target_record_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          batch_id?: string
          client_record_id?: string
          converted_log_client_record_id?: string | null
          created_at?: string
          entity_kind?: string
          id?: string
          payload?: Json
          payload_sha256?: string
          profile_byte_count?: number | null
          profile_content_revision?: string | null
          profile_path?: string | null
          profile_sample_count?: number | null
          profile_sha256?: string | null
          source_plan_client_record_id?: string | null
          target_record_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_claim_records_batch_id_user_id_fkey"
            columns: ["batch_id", "user_id"]
            isOneToOne: false
            referencedRelation: "guest_claim_batches"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          document_url: string
          effective_at: string
          kind: string
          version: string
        }
        Insert: {
          document_url: string
          effective_at: string
          kind: string
          version: string
        }
        Update: {
          document_url?: string
          effective_at?: string
          kind?: string
          version?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abandon_guest_claim: {
        Args: { p_batch_id: string; p_user_id: string }
        Returns: Json
      }
      complete_onboarding: {
        Args: { requested_documents: Json }
        Returns: Json
      }
      finalize_guest_claim: {
        Args: {
          p_batch_id: string
          p_user_id: string
          p_verified_profiles: Json
        }
        Returns: Json
      }
      get_onboarding_status: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
