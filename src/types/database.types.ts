export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  graphql: {
    queries: {
      __boolean: never
    }
    mutations: {
      __boolean: never
    }
  }
  __exists: {
    graphql: 'graphql'
  }
  __legacy: {
    graphql: 'graphql'
  }
  __recent: {
    graphql: 'graphql'
  }
  auth: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string | null
          created_at: string
          updated_at: string
          user_metadata: Json | null
          app_metadata: Json | null
          aud: string
          confirmation_token: string | null
          confirmed_at: string | null
          email_change_token: string | null
          email_change_email: string | null
          email_change_sent_at: string | null
          email_change_confirm_at: string | null
          invited_at: string | null
          last_sign_in_at: string | null
          phone: string | null
          phone_change: string | null
          phone_change_token: string | null
          phone_change_sent_at: string | null
          phone_change_confirm_at: string | null
          recovery_token: string | null
          revalidated_at: string | null
          reconfirmation_token: string | null
          reconfirmation_sent_at: string | null
          role: string | null
         sign_in_anonymous: boolean | null
  }
      }
    }
  }
  public: {
    Tables: {
      sites: {
        Row: {
          id: string
          name: string
          latitude: number
          longitude: number
          radius_in_meters: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          latitude: number
          longitude: number
          radius_in_meters?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          latitude?: number
          longitude?: number
          radius_in_meters?: number
          created_at?: string
          updated_at?: string
        }
      }
      location_logs: {
        Row: {
          id: number
          user_id: string
          site_id: string | null
          latitude: number
          longitude: number
          accuracy: number
          distance_to_site: number
          timestamp: number
          is_inside: boolean
          is_synced: boolean
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          site_id?: string | null
          latitude: number
          longitude: number
          accuracy: number
          distance_to_site: number
          timestamp: number
          is_inside: boolean
          is_synced?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          site_id?: string | null
          latitude?: number
          longitude?: number
          accuracy?: number
          distance_to_site?: number
          timestamp?: number
          is_inside?: boolean
          is_synced?: boolean
          created_at?: string
        }
      }
      presence_sessions: {
        Row: {
          id: number
          user_id: string
          site_id: string
          entry_timestamp: number
          exit_timestamp: number | null
          total_hours: number | null
          is_synced: boolean
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          site_id: string
          entry_timestamp: number
          exit_timestamp?: number | null
          total_hours?: number | null
          is_synced?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          site_id?: string
          entry_timestamp?: number
          exit_timestamp?: number | null
          total_hours?: number | null
          is_synced?: boolean
          created_at?: string
        }
      }
      departments: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      designations: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      shifts: {
        Row: {
          id: string
          name: string
          start_time: string
          end_time: string
          department_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          start_time: string
          end_time: string
          department_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          start_time?: string
          end_time?: string
          department_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      employees: {
        Row: {
          id: string
          user_id: string | null
          first_name: string
          last_name: string
          email: string
          phone: string | null
          department_id: string | null
          designation_id: string | null
          shift_id: string | null
          is_active: boolean
          hire_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          first_name: string
          last_name: string
          email: string
          phone?: string | null
          department_id?: string | null
          designation_id?: string | null
          shift_id?: string | null
          is_active?: boolean
          hire_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string | null
          department_id?: string | null
          designation_id?: string | null
          shift_id?: string | null
          is_active?: boolean
          hire_date?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      employee_sites: {
        Row: {
          employee_id: string
          site_id: string
          assigned_at: string
        }
        Insert: {
          employee_id: string
          site_id: string
          assigned_at?: string
        }
        Update: {
          employee_id?: string
          site_id?: string
          assigned_at?: string
        }
      }
      audit_logs: {
        Row: {
          id: number
          user_id: string | null
          action: string
          table_name: string
          record_id: string | null
          old_values: Json | null
          new_values: Json | null
          created_at: string
        }
        Insert: {
          id?: number
          user_id?: string | null
          action: string
          table_name: string
          record_id?: string | null
          old_values?: Json | null
          new_values?: Json | null
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string | null
          action?: string
          table_name?: string
          record_id?: string | null
          old_values?: Json | null
          new_values?: Json | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience types
export type Site = Database['public']['Tables']['sites']['Row']
export type SiteInsert = Database['public']['Tables']['sites']['Insert']
export type SiteUpdate = Database['public']['Tables']['sites']['Update']

export type LocationLog = Database['public']['Tables']['location_logs']['Row']
export type LocationLogInsert = Database['public']['Tables']['location_logs']['Insert']

export type PresenceSession = Database['public']['Tables']['presence_sessions']['Row']
export type PresenceSessionInsert = Database['public']['Tables']['presence_sessions']['Insert']

export type Department = Database['public']['Tables']['departments']['Row']
export type DepartmentInsert = Database['public']['Tables']['departments']['Insert']
export type DepartmentUpdate = Database['public']['Tables']['departments']['Update']

export type Designation = Database['public']['Tables']['designations']['Row']
export type DesignationInsert = Database['public']['Tables']['designations']['Insert']
export type DesignationUpdate = Database['public']['Tables']['designations']['Update']

export type Shift = Database['public']['Tables']['shifts']['Row']
export type ShiftInsert = Database['public']['Tables']['shifts']['Insert']
export type ShiftUpdate = Database['public']['Tables']['shifts']['Update']

export type Employee = Database['public']['Tables']['employees']['Row']
export type EmployeeInsert = Database['public']['Tables']['employees']['Insert']
export type EmployeeUpdate = Database['public']['Tables']['employees']['Update']

export type EmployeeSite = Database['public']['Tables']['employee_sites']['Row']
export type EmployeeSiteInsert = Database['public']['Tables']['employee_sites']['Insert']

export type AuditLog = Database['public']['Tables']['audit_logs']['Row']
