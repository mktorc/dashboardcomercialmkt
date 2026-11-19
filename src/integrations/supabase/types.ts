export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
      crm_leads: {
        Row: {
          created_at: string;
          email: string | null;
          email_lc: string | null;
          first_connection_name: string | null;
          first_response_at: string | null;
          id: string;
          lead_id: string | null;
          lead_origin: string | null;
          name: string | null;
          phone: string | null;
          phone8: string | null;
          seller_name: string | null;
          stage_name: string | null;
          updated_at: string;
          utm_campaign: string | null;
          utm_medium: string | null;
          utm_source: string | null;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          email_lc?: string | null;
          first_connection_name?: string | null;
          first_response_at?: string | null;
          id?: string;
          lead_id?: string | null;
          lead_origin?: string | null;
          name?: string | null;
          phone?: string | null;
          phone8?: string | null;
          seller_name?: string | null;
          stage_name?: string | null;
          updated_at?: string;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          email_lc?: string | null;
          first_connection_name?: string | null;
          first_response_at?: string | null;
          id?: string;
          lead_id?: string | null;
          lead_origin?: string | null;
          name?: string | null;
          phone?: string | null;
          phone8?: string | null;
          seller_name?: string | null;
          stage_name?: string | null;
          updated_at?: string;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Relationships: [];
      };
      push_state: {
        Row: { id: number; last_history_id: number };
        Insert: { id: number; last_history_id?: number };
        Update: { id?: number; last_history_id?: number };
        Relationships: [];
      };
      push_subscriptions: {
        Row: { auth: string; created_at: string; endpoint: string; id: number; p256dh: string };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: number;
          p256dh: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: number;
          p256dh?: string;
        };
        Relationships: [];
      };
      crm_opportunities: {
        Row: {
          created_at: string;
          id: string;
          lead_id: string | null;
          name: string | null;
          opportunity_id: string;
          pending_tasks: number;
          delayed_tasks: number | null;
          total_tasks: number | null;
          pipeline_name: string | null;
          pipeline_step_id: number | null;
          seller_name: string | null;
          stage_name: string | null;
          status: string | null;
          updated_at: string;
          value: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lead_id?: string | null;
          name?: string | null;
          opportunity_id: string;
          pending_tasks?: number;
          delayed_tasks?: number | null;
          total_tasks?: number | null;
          pipeline_name?: string | null;
          pipeline_step_id?: number | null;
          seller_name?: string | null;
          stage_name?: string | null;
          status?: string | null;
          updated_at?: string;
          value?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          lead_id?: string | null;
          name?: string | null;
          opportunity_id?: string;
          pending_tasks?: number;
          delayed_tasks?: number | null;
          total_tasks?: number | null;
          pipeline_name?: string | null;
          pipeline_step_id?: number | null;
          seller_name?: string | null;
          stage_name?: string | null;
          status?: string | null;
          updated_at?: string;
          value?: number;
        };
        Relationships: [];
      };
      crm_tasks: {
        Row: {
          completed: boolean;
          completed_at: string | null;
          created_at: string;
          due_date: string | null;
          id: string;
          lead_id: string | null;
          task_id: string;
          user_name: string | null;
        };
        Insert: {
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          due_date?: string | null;
          id?: string;
          lead_id?: string | null;
          task_id: string;
          user_name?: string | null;
        };
        Update: {
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          due_date?: string | null;
          id?: string;
          lead_id?: string | null;
          task_id?: string;
          user_name?: string | null;
        };
        Relationships: [];
      };
      fleet_stats: {
        Row: {
          id: number;
          updated_at: string;
          vehicles: number;
        };
        Insert: {
          id?: number;
          updated_at?: string;
          vehicles?: number;
        };
        Update: {
          id?: number;
          updated_at?: string;
          vehicles?: number;
        };
        Relationships: [];
      };
      fleet_vehicles: {
        Row: {
          entry_date: string;
          exit_date: string | null;
          id: number;
          updated_at: string;
        };
        Insert: {
          entry_date: string;
          exit_date?: string | null;
          id: number;
          updated_at?: string;
        };
        Update: {
          entry_date?: string;
          exit_date?: string | null;
          id?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      google_ads_metrics: {
        Row: {
          campaign_id: string | null;
          campaign_name: string;
          clicks: number;
          conversions: number;
          created_at: string;
          date: string;
          id: string;
          impressions: number;
          spend: number;
          utm_campaign: string | null;
        };
        Insert: {
          campaign_id?: string | null;
          campaign_name: string;
          clicks?: number;
          conversions?: number;
          created_at?: string;
          date: string;
          id?: string;
          impressions?: number;
          spend?: number;
          utm_campaign?: string | null;
        };
        Update: {
          campaign_id?: string | null;
          campaign_name?: string;
          clicks?: number;
          conversions?: number;
          created_at?: string;
          date?: string;
          id?: string;
          impressions?: number;
          spend?: number;
          utm_campaign?: string | null;
        };
        Relationships: [];
      };
      meta_ads_daily: {
        Row: {
          campaign_id: string;
          campaign_name: string | null;
          clicks: number | null;
          conversations_started: number | null;
          date: string;
          impressions: number | null;
          spend: number | null;
        };
        Insert: {
          campaign_id: string;
          campaign_name?: string | null;
          clicks?: number | null;
          conversations_started?: number | null;
          date: string;
          impressions?: number | null;
          spend?: number | null;
        };
        Update: {
          campaign_id?: string;
          campaign_name?: string | null;
          clicks?: number | null;
          conversations_started?: number | null;
          date?: string;
          impressions?: number | null;
          spend?: number | null;
        };
        Relationships: [];
      };
      meta_ads_metrics: {
        Row: {
          campaign_id: string | null;
          campaign_name: string;
          clicks: number;
          conversations: number;
          created_at: string;
          date: string;
          id: string;
          impressions: number;
          leads: number | null;
          spend: number;
          utm_campaign: string | null;
        };
        Insert: {
          campaign_id?: string | null;
          campaign_name: string;
          clicks?: number;
          conversations?: number;
          created_at?: string;
          date: string;
          id?: string;
          impressions?: number;
          leads?: number | null;
          spend?: number;
          utm_campaign?: string | null;
        };
        Update: {
          campaign_id?: string | null;
          campaign_name?: string;
          clicks?: number;
          conversations?: number;
          created_at?: string;
          date?: string;
          id?: string;
          impressions?: number;
          leads?: number | null;
          spend?: number;
          utm_campaign?: string | null;
        };
        Relationships: [];
      };
      reservations: {
        Row: {
          additional_charges_price: number | null;
          car_category: string | null;
          commission_partner: string | null;
          created_at: string;
          customer_email: string | null;
          customer_phone: string | null;
          discount_amount: number;
          email_lc: string | null;
          id: string;
          miscellaneous_price: number | null;
          phone8: string | null;
          pick_up_at: string | null;
          rack_rate: number | null;
          rental_days: number;
          reservation_id: string | null;
          return_at: string | null;
          seller_name: string | null;
          status: string;
          total_amount: number;
          utm_campaign: string | null;
        };
        Insert: {
          additional_charges_price?: number | null;
          car_category?: string | null;
          commission_partner?: string | null;
          created_at?: string;
          customer_email?: string | null;
          customer_phone?: string | null;
          discount_amount?: number;
          email_lc?: string | null;
          id?: string;
          miscellaneous_price?: number | null;
          phone8?: string | null;
          pick_up_at?: string | null;
          rack_rate?: number | null;
          rental_days?: number;
          reservation_id?: string | null;
          return_at?: string | null;
          seller_name?: string | null;
          status?: string;
          total_amount?: number;
          utm_campaign?: string | null;
        };
        Update: {
          additional_charges_price?: number | null;
          car_category?: string | null;
          commission_partner?: string | null;
          created_at?: string;
          customer_email?: string | null;
          customer_phone?: string | null;
          discount_amount?: number;
          email_lc?: string | null;
          id?: string;
          miscellaneous_price?: number | null;
          phone8?: string | null;
          pick_up_at?: string | null;
          rack_rate?: number | null;
          rental_days?: number;
          reservation_id?: string | null;
          return_at?: string | null;
          seller_name?: string | null;
          status?: string;
          total_amount?: number;
          utm_campaign?: string | null;
        };
        Relationships: [];
      };
      marketing_team_costs: {
        Row: {
          amount: number;
          month: string;
          updated_at: string;
        };
        Insert: {
          amount?: number;
          month: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          month?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reservation_segments: {
        Row: {
          pick_up_at: string;
          reservation_id: string;
          return_at: string;
          seq: number;
          status: string;
        };
        Insert: {
          pick_up_at: string;
          reservation_id: string;
          return_at: string;
          seq: number;
          status: string;
        };
        Update: {
          pick_up_at?: string;
          reservation_id?: string;
          return_at?: string;
          seq?: number;
          status?: string;
        };
        Relationships: [];
      };
      reservation_status_history: {
        Row: {
          changed_at: string;
          from_status: string | null;
          id: number;
          reservation_id: string;
          to_status: string;
        };
        Insert: {
          changed_at?: string;
          from_status?: string | null;
          id?: never;
          reservation_id: string;
          to_status: string;
        };
        Update: {
          changed_at?: string;
          from_status?: string | null;
          id?: never;
          reservation_id?: string;
          to_status?: string;
        };
        Relationships: [];
      };
      sales_goals: {
        Row: {
          conversion_goal: number | null;
          discount_goal: number | null;
          id: string;
          month: string;
          revenue_goal: number;
          seller_name: string;
          ticket_goal: number;
          updated_at: string;
        };
        Insert: {
          conversion_goal?: number | null;
          discount_goal?: number | null;
          id?: string;
          month: string;
          revenue_goal?: number;
          seller_name: string;
          ticket_goal?: number;
          updated_at?: string;
        };
        Update: {
          conversion_goal?: number | null;
          discount_goal?: number | null;
          id?: string;
          month?: string;
          revenue_goal?: number;
          seller_name?: string;
          ticket_goal?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      sync_runs: {
        Row: {
          last_success_at: string;
          service: string;
        };
        Insert: {
          last_success_at?: string;
          service: string;
        };
        Update: {
          last_success_at?: string;
          service?: string;
        };
        Relationships: [];
      };
      user_access: {
        Row: {
          can_pay: boolean;
          is_admin: boolean;
          modules: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          can_pay?: boolean;
          is_admin?: boolean;
          modules?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          can_pay?: boolean;
          is_admin?: boolean;
          modules?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      webhook_logs: {
        Row: {
          authorized: boolean;
          error_message: string | null;
          event_type: string | null;
          id: string;
          payload: Json | null;
          processed_at: string | null;
          processing_status: string;
          received_at: string;
          source: string;
        };
        Insert: {
          authorized?: boolean;
          error_message?: string | null;
          event_type?: string | null;
          id?: string;
          payload?: Json | null;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string;
          source: string;
        };
        Update: {
          authorized?: boolean;
          error_message?: string | null;
          event_type?: string | null;
          id?: string;
          payload?: Json | null;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string;
          source?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cohort_reservations: {
        Args: { _from: string; _to: string };
        Returns: {
          car_category: string;
          commission_partner: string;
          created_at: string;
          lead_created_at: string;
          lead_id: string;
          lead_origin: string;
          rental_days: number;
          reservation_id: string;
          status: string;
          total_amount: number;
          utm_campaign: string;
        }[];
      };
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      reservation_lead_matches: {
        Args: { _from: string; _to: string };
        Returns: {
          lead_id: string;
          lead_origin: string;
          reservation_id: string;
        }[];
      };
      seller_key: { Args: { _name: string }; Returns: string };
    };
    Enums: {
      app_role: "superadmin" | "comercial" | "marketing" | "comercial_gerencial" | "financeiro";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["superadmin", "comercial", "marketing", "comercial_gerencial", "financeiro"],
    },
  },
} as const;
