export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      crm_leads: {
        Row: {
          created_at: string
          email: string | null
          first_response_at: string | null
          id: string
          lead_id: string | null
          name: string | null
          phone: string | null
          seller_name: string | null
          stage_name: string | null
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_response_at?: string | null
          id?: string
          lead_id?: string | null
          name?: string | null
          phone?: string | null
          seller_name?: string | null
          stage_name?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          first_response_at?: string | null
          id?: string
          lead_id?: string | null
          name?: string | null
          phone?: string | null
          seller_name?: string | null
          stage_name?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      crm_opportunities: {
        Row: {
          created_at: string
          id: string
          lead_id: string | null
          name: string | null
          opportunity_id: string
          pending_tasks: number
          seller_name: string | null
          stage_name: string | null
          status: string | null
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id?: string | null
          name?: string | null
          opportunity_id: string
          pending_tasks?: number
          seller_name?: string | null
          stage_name?: string | null
          status?: string | null
          updated_at?: string
          value?: number
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string | null
          name?: string | null
          opportunity_id?: string
          pending_tasks?: number
          seller_name?: string | null
          stage_name?: string | null
          status?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      crm_tasks: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          lead_id: string | null
          task_id: string
          user_name: string | null
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          lead_id?: string | null
          task_id: string
          user_name?: string | null
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          lead_id?: string | null
          task_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      google_ads_metrics: {
        Row: {
          campaign_id: string | null
          campaign_name: string
          clicks: number
          created_at: string
          date: string
          id: string
          impressions: number
          spend: number
          utm_campaign: string | null
        }
        Insert: {
          campaign_id?: string | null
          campaign_name: string
          clicks?: number
          created_at?: string
          date: string
          id?: string
          impressions?: number
          spend?: number
          utm_campaign?: string | null
        }
        Update: {
          campaign_id?: string | null
          campaign_name?: string
          clicks?: number
          created_at?: string
          date?: string
          id?: string
          impressions?: number
          spend?: number
          utm_campaign?: string | null
        }
        Relationships: []
      }
      meta_ads_metrics: {
        Row: {
          campaign_id: string | null
          campaign_name: string
          clicks: number
          created_at: string
          date: string
          id: string
          impressions: number
          spend: number
          utm_campaign: string | null
        }
        Insert: {
          campaign_id?: string | null
          campaign_name: string
          clicks?: number
          created_at?: string
          date: string
          id?: string
          impressions?: number
          spend?: number
          utm_campaign?: string | null
        }
        Update: {
          campaign_id?: string | null
          campaign_name?: string
          clicks?: number
          created_at?: string
          date?: string
          id?: string
          impressions?: number
          spend?: number
          utm_campaign?: string | null
        }
        Relationships: []
      }
      reservations: {
        Row: {
          car_category: string | null
          created_at: string
          customer_email: string | null
          customer_phone: string | null
          discount_amount: number
          id: string
          rental_days: number
          reservation_id: string | null
          seller_name: string | null
          status: string
          total_amount: number
          utm_campaign: string | null
        }
        Insert: {
          car_category?: string | null
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          rental_days?: number
          reservation_id?: string | null
          seller_name?: string | null
          status?: string
          total_amount?: number
          utm_campaign?: string | null
        }
        Update: {
          car_category?: string | null
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          rental_days?: number
          reservation_id?: string | null
          seller_name?: string | null
          status?: string
          total_amount?: number
          utm_campaign?: string | null
        }
        Relationships: []
      }
      sales_goals: {
        Row: {
          id: string
          month: string
          revenue_goal: number
          seller_name: string
          ticket_goal: number
          updated_at: string
        }
        Insert: {
          id?: string
          month: string
          revenue_goal?: number
          seller_name: string
          ticket_goal?: number
          updated_at?: string
        }
        Update: {
          id?: string
          month?: string
          revenue_goal?: number
          seller_name?: string
          ticket_goal?: number
          updated_at?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          authorized: boolean
          error_message: string | null
          event_type: string | null
          id: string
          payload: Json | null
          processed_at: string | null
          processing_status: string
          received_at: string
          source: string
        }
        Insert: {
          authorized?: boolean
          error_message?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          source: string
        }
        Update: {
          authorized?: boolean
          error_message?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          source?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      seller_key: { Args: { _name: string }; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
