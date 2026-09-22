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
      access_profile_changes: {
        Row: {
          actor_user_id: string | null
          created_at: string
          id: string
          membership_id: string | null
          new_codes: string[]
          organization_id: string
          previous_codes: string[]
          reason: string
          role_id: string | null
          target_user_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          membership_id?: string | null
          new_codes?: string[]
          organization_id: string
          previous_codes?: string[]
          reason: string
          role_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          membership_id?: string | null
          new_codes?: string[]
          organization_id?: string
          previous_codes?: string[]
          reason?: string
          role_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_profile_changes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      access_profile_defaults: {
        Row: {
          permission_code: string
          profile_code: string
        }
        Insert: {
          permission_code: string
          profile_code: string
        }
        Update: {
          permission_code?: string
          profile_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_profile_defaults_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "access_profile_defaults_profile_code_fkey"
            columns: ["profile_code"]
            isOneToOne: false
            referencedRelation: "access_profile_overview"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "access_profile_defaults_profile_code_fkey"
            columns: ["profile_code"]
            isOneToOne: false
            referencedRelation: "access_profiles"
            referencedColumns: ["code"]
          },
        ]
      }
      access_profile_mappings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_profile_id: string
          created_at: string
          created_by: string | null
          id: string
          is_enabled: boolean
          organization_id: string
          role_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_profile_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          organization_id: string
          role_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_profile_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          organization_id?: string
          role_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_profile_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_profile_mappings_profile_fk"
            columns: ["organization_id", "business_profile_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "access_profile_mappings_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "access_profile_overview"
            referencedColumns: ["role_id"]
          },
          {
            foreignKeyName: "access_profile_mappings_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      access_profile_reviews: {
        Row: {
          created_at: string
          details: Json
          employee_id: string | null
          id: string
          membership_id: string | null
          organization_id: string
          reason_code: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          employee_id?: string | null
          id?: string
          membership_id?: string | null
          organization_id: string
          reason_code: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          employee_id?: string | null
          id?: string
          membership_id?: string | null
          organization_id?: string
          reason_code?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_profile_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      access_profiles: {
        Row: {
          code: string
          created_at: string
          description: string
          is_administrator: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          is_administrator?: boolean
          name: string
          sort_order: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          is_administrator?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          changed_fields: string[] | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_data: Json | null
          old_data: Json | null
          organization_id: string | null
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changed_fields?: string[] | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_fields?: string[] | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      business_profiles: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          login_method: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          login_method?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          login_method?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          ddd: number | null
          id: number
          is_capital: boolean
          is_municipality: boolean
          latitude: number | null
          longitude: number | null
          name: string
          state_id: number
          time_zone: string | null
        }
        Insert: {
          ddd?: number | null
          id: number
          is_capital?: boolean
          is_municipality?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          state_id: number
          time_zone?: string | null
        }
        Update: {
          ddd?: number | null
          id?: number
          is_capital?: boolean
          is_municipality?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          state_id?: number
          time_zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cities_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "state_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cities_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          organization_id: string
          organization_unit_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          organization_id: string
          organization_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          organization_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "cost_centers_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      driver_licenses: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          employee_id: string
          expiration_date: string | null
          first_license_date: string | null
          id: string
          license_number: string | null
          organization_id: string
          points: number | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          employee_id: string
          expiration_date?: string | null
          first_license_date?: string | null
          id?: string
          license_number?: string | null
          organization_id: string
          points?: number | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          employee_id?: string
          expiration_date?: string | null
          first_license_date?: string | null
          id?: string
          license_number?: string | null
          organization_id?: string
          points?: number | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_licenses_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "driver_licenses_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "driver_licenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          employee_code: string | null
          employee_id: string | null
          full_name: string
          id: string
          organization_id: string
          organization_unit_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          employee_code?: string | null
          employee_id?: string | null
          full_name: string
          id?: string
          organization_id: string
          organization_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          employee_code?: string | null
          employee_id?: string | null
          full_name?: string
          id?: string
          organization_id?: string
          organization_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "drivers_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "drivers_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_assignments: {
        Row: {
          business_profile_id: string | null
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string
          employment_area_id: string | null
          id: string
          is_current: boolean
          job_position_id: string | null
          manager_employee_id: string | null
          operation_id: string | null
          organization_id: string
          organization_unit_id: string | null
          updated_at: string
          updated_by: string | null
          work_location_id: string | null
        }
        Insert: {
          business_profile_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          employment_area_id?: string | null
          id?: string
          is_current?: boolean
          job_position_id?: string | null
          manager_employee_id?: string | null
          operation_id?: string | null
          organization_id: string
          organization_unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          work_location_id?: string | null
        }
        Update: {
          business_profile_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          employment_area_id?: string | null
          id?: string
          is_current?: boolean
          job_position_id?: string | null
          manager_employee_id?: string | null
          operation_id?: string | null
          organization_id?: string
          organization_unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          work_location_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_assignments_area_fk"
            columns: ["organization_id", "employment_area_id"]
            isOneToOne: false
            referencedRelation: "employment_areas"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_location_fk"
            columns: ["organization_id", "work_location_id"]
            isOneToOne: false
            referencedRelation: "work_locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_manager_fk"
            columns: ["organization_id", "manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_manager_fk"
            columns: ["organization_id", "manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_position_fk"
            columns: ["organization_id", "job_position_id"]
            isOneToOne: false
            referencedRelation: "job_positions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_profile_fk"
            columns: ["organization_id", "business_profile_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_unit_fk"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_assignments_unit_fk"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_private_data: {
        Row: {
          birth_date: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_private_data_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_private_data_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_private_data_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employee_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_private_data_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_private_data_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          admission_date: string | null
          corporate_email: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          employee_code: string
          employment_status: string
          full_name: string
          id: string
          notes: string | null
          organization_id: string
          termination_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admission_date?: string | null
          corporate_email?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          employee_code: string
          employment_status?: string
          full_name: string
          id?: string
          notes?: string | null
          organization_id: string
          termination_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admission_date?: string | null
          corporate_email?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          employee_code?: string
          employment_status?: string
          full_name?: string
          id?: string
          notes?: string | null
          organization_id?: string
          termination_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_areas: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employment_areas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fidelization_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string | null
          end_reason: string | null
          id: string
          operation_br_id: string
          organization_id: string
          reason: string | null
          replaces_assignment_id: string | null
          source: string
          start_date: string
          status: string
          updated_at: string
          updated_by: string | null
          vehicle_id: string
          vehicle_role: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          end_reason?: string | null
          id?: string
          operation_br_id: string
          organization_id: string
          reason?: string | null
          replaces_assignment_id?: string | null
          source?: string
          start_date: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
          vehicle_role?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          end_reason?: string | null
          id?: string
          operation_br_id?: string
          organization_id?: string
          reason?: string | null
          replaces_assignment_id?: string | null
          source?: string
          start_date?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
          vehicle_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "fidelization_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fidelization_br_fkey"
            columns: ["organization_id", "operation_br_id"]
            isOneToOne: false
            referencedRelation: "operation_br_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_br_fkey"
            columns: ["organization_id", "operation_br_id"]
            isOneToOne: false
            referencedRelation: "operation_brs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_replaces_fkey"
            columns: ["organization_id", "replaces_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_assignments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_replaces_fkey"
            columns: ["organization_id", "replaces_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      fidelization_drivers: {
        Row: {
          created_at: string
          created_by: string | null
          driver_role: string
          employee_id: string
          end_date: string | null
          end_reason: string | null
          fidelization_assignment_id: string
          id: string
          organization_id: string
          reason: string | null
          start_date: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          driver_role?: string
          employee_id: string
          end_date?: string | null
          end_reason?: string | null
          fidelization_assignment_id: string
          id?: string
          organization_id: string
          reason?: string | null
          start_date: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          driver_role?: string
          employee_id?: string
          end_date?: string | null
          end_reason?: string | null
          fidelization_assignment_id?: string
          id?: string
          organization_id?: string
          reason?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fidelization_drivers_assignment_fkey"
            columns: ["organization_id", "fidelization_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_assignments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_drivers_assignment_fkey"
            columns: ["organization_id", "fidelization_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_drivers_employee_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_drivers_employee_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          column_mapping: Json
          created_at: string
          created_by: string | null
          created_rows: number
          error_message: string | null
          error_rows: number
          expires_at: string
          file_hash: string | null
          file_name: string
          file_size: number | null
          id: string
          mode: string
          organization_id: string
          processed_at: string | null
          skipped_rows: number
          status: string
          storage_path: string | null
          summary: Json
          total_rows: number
          type: string
          updated_at: string
          updated_by: string | null
          updated_rows: number
          valid_rows: number
          warning_rows: number
        }
        Insert: {
          column_mapping?: Json
          created_at?: string
          created_by?: string | null
          created_rows?: number
          error_message?: string | null
          error_rows?: number
          expires_at?: string
          file_hash?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          mode?: string
          organization_id: string
          processed_at?: string | null
          skipped_rows?: number
          status?: string
          storage_path?: string | null
          summary?: Json
          total_rows?: number
          type?: string
          updated_at?: string
          updated_by?: string | null
          updated_rows?: number
          valid_rows?: number
          warning_rows?: number
        }
        Update: {
          column_mapping?: Json
          created_at?: string
          created_by?: string | null
          created_rows?: number
          error_message?: string | null
          error_rows?: number
          expires_at?: string
          file_hash?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          mode?: string
          organization_id?: string
          processed_at?: string | null
          skipped_rows?: number
          status?: string
          storage_path?: string | null
          summary?: Json
          total_rows?: number
          type?: string
          updated_at?: string
          updated_by?: string | null
          updated_rows?: number
          valid_rows?: number
          warning_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_errors: {
        Row: {
          batch_id: string
          code: string
          created_at: string
          field: string | null
          id: string
          level: string
          message: string
          organization_id: string
          row_number: number | null
        }
        Insert: {
          batch_id: string
          code: string
          created_at?: string
          field?: string | null
          id?: string
          level?: string
          message: string
          organization_id: string
          row_number?: number | null
        }
        Update: {
          batch_id?: string
          code?: string
          created_at?: string
          field?: string | null
          id?: string
          level?: string
          message?: string
          organization_id?: string
          row_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_errors_batch_fk"
            columns: ["organization_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_errors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          action: string
          batch_id: string
          created_at: string
          employee_id: string | null
          id: string
          normalized_data: Json
          organization_id: string
          raw_data: Json
          row_number: number
          status: string
          vehicle_id: string | null
        }
        Insert: {
          action?: string
          batch_id: string
          created_at?: string
          employee_id?: string | null
          id?: string
          normalized_data?: Json
          organization_id: string
          raw_data?: Json
          row_number: number
          status?: string
          vehicle_id?: string | null
        }
        Update: {
          action?: string
          batch_id?: string
          created_at?: string
          employee_id?: string | null
          id?: string
          normalized_data?: Json
          organization_id?: string
          raw_data?: Json
          row_number?: number
          status?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_fk"
            columns: ["organization_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_rows_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_rows_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_positions: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_positions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leadership_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string
          end_reason: string | null
          id: string
          is_primary: boolean | null
          notes: string | null
          operation_br_id: string | null
          operation_city_id: string | null
          operation_id: string
          organization_id: string
          responsibility_type: string
          scope_key: string | null
          scope_level: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          end_reason?: string | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          operation_br_id?: string | null
          operation_city_id?: string | null
          operation_id: string
          organization_id: string
          responsibility_type?: string
          scope_key?: string | null
          scope_level: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          end_reason?: string | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          operation_br_id?: string | null
          operation_city_id?: string | null
          operation_id?: string
          organization_id?: string
          responsibility_type?: string
          scope_key?: string | null
          scope_level?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leadership_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leadership_br_fkey"
            columns: ["operation_br_id", "organization_id", "operation_city_id"]
            isOneToOne: false
            referencedRelation: "operation_br_directory"
            referencedColumns: ["id", "organization_id", "operation_city_id"]
          },
          {
            foreignKeyName: "leadership_br_fkey"
            columns: ["operation_br_id", "organization_id", "operation_city_id"]
            isOneToOne: false
            referencedRelation: "operation_brs"
            referencedColumns: ["id", "organization_id", "operation_city_id"]
          },
          {
            foreignKeyName: "leadership_city_fkey"
            columns: ["operation_city_id", "organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_cities"
            referencedColumns: ["id", "organization_id", "operation_id"]
          },
          {
            foreignKeyName: "leadership_city_fkey"
            columns: ["operation_city_id", "organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_geography"
            referencedColumns: ["id", "organization_id", "operation_id"]
          },
          {
            foreignKeyName: "leadership_employee_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leadership_employee_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leadership_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leadership_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      membership_operation_scopes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          operation_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          operation_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          operation_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_operation_scopes_membership_fk"
            columns: ["organization_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "membership_operation_scopes_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "membership_operation_scopes_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "membership_operation_scopes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_roles: {
        Row: {
          created_at: string
          created_by: string | null
          membership_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          membership_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          membership_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_roles_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "membership_roles_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "access_profile_overview"
            referencedColumns: ["role_id"]
          },
          {
            foreignKeyName: "membership_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_brs: {
        Row: {
          city_id: number
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          notes: string | null
          operation_city_id: string
          operation_id: string
          organization_id: string
          state_id: number
          status: string
          status_reason: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city_id: number
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          operation_city_id: string
          operation_id: string
          organization_id: string
          state_id: number
          status?: string
          status_reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city_id?: number
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          operation_city_id?: string
          operation_id?: string
          organization_id?: string
          state_id?: number
          status?: string
          status_reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_brs_coverage_fkey"
            columns: [
              "operation_city_id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
            isOneToOne: false
            referencedRelation: "operation_cities"
            referencedColumns: [
              "id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
          },
          {
            foreignKeyName: "operation_brs_coverage_fkey"
            columns: [
              "operation_city_id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
            isOneToOne: false
            referencedRelation: "operation_geography"
            referencedColumns: [
              "id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
          },
          {
            foreignKeyName: "operation_brs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_cities: {
        Row: {
          city_id: number
          created_at: string
          created_by: string | null
          id: string
          operation_id: string
          organization_id: string
          state_id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city_id: number
          created_at?: string
          created_by?: string | null
          id?: string
          operation_id: string
          organization_id: string
          state_id: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city_id?: number
          created_at?: string
          created_by?: string | null
          id?: string
          operation_id?: string
          organization_id?: string
          state_id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_cities_city_fk"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "operation_cities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_cities_state_fk"
            columns: ["organization_id", "operation_id", "state_id"]
            isOneToOne: false
            referencedRelation: "operation_state_summary"
            referencedColumns: ["organization_id", "operation_id", "state_id"]
          },
          {
            foreignKeyName: "operation_cities_state_fk"
            columns: ["organization_id", "operation_id", "state_id"]
            isOneToOne: false
            referencedRelation: "operation_states"
            referencedColumns: ["organization_id", "operation_id", "state_id"]
          },
        ]
      }
      operation_states: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          operation_id: string
          organization_id: string
          state_id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          operation_id: string
          organization_id: string
          state_id: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          operation_id?: string
          organization_id?: string
          state_id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_states_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "operation_states_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "operation_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_states_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "state_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_states_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_apps: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operational_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_modules: {
        Row: {
          code: string
          description: string
          is_available: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          description: string
          is_available?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          description?: string
          is_available?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      operations: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string | null
          id: string
          joined_at: string | null
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          joined_at?: string | null
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          joined_at?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_memberships_employee_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          created_at: string
          currency_code: string
          distance_unit: string
          fiscal_year_start_month: number
          fuel_volume_unit: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          currency_code?: string
          distance_unit?: string
          fiscal_year_start_month?: number
          fuel_volume_unit?: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          currency_code?: string
          distance_unit?: string
          fiscal_year_start_month?: number
          fuel_volume_unit?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_unit_operations: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          operation_id: string
          organization_id: string
          organization_unit_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          operation_id: string
          organization_id: string
          organization_unit_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          operation_id?: string
          organization_id?: string
          organization_unit_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_unit_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_operations_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "unit_operations_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "unit_operations_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "unit_operations_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organization_units: {
        Row: {
          city_id: number | null
          code: string | null
          complement: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          district: string | null
          document_number: string | null
          id: string
          legal_name: string | null
          name: string
          notes: string | null
          organization_id: string
          postal_code: string | null
          state_id: number | null
          status: string
          status_reason: string | null
          street: string | null
          street_number: string | null
          unit_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city_id?: number | null
          code?: string | null
          complement?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          district?: string | null
          document_number?: string | null
          id?: string
          legal_name?: string | null
          name: string
          notes?: string | null
          organization_id: string
          postal_code?: string | null
          state_id?: number | null
          status?: string
          status_reason?: string | null
          street?: string | null
          street_number?: string | null
          unit_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city_id?: number | null
          code?: string | null
          complement?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          district?: string | null
          document_number?: string | null
          id?: string
          legal_name?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          postal_code?: string | null
          state_id?: number | null
          status?: string
          status_reason?: string | null
          street?: string | null
          street_number?: string | null
          unit_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_units_city_fkey"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "organization_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          document_number: string | null
          id: string
          legal_name: string | null
          locale: string
          name: string
          slug: string
          status: string
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_number?: string | null
          id?: string
          legal_name?: string | null
          locale?: string
          name: string
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_number?: string | null
          id?: string
          legal_name?: string | null
          locale?: string
          name?: string
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      outbox_events: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string
          attempts: number
          created_at: string
          event_type: string
          id: string
          last_error: string | null
          organization_id: string | null
          payload: Json
          processed_at: string | null
          status: string
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type: string
          attempts?: number
          created_at?: string
          event_type: string
          id?: string
          last_error?: string | null
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string
          attempts?: number
          created_at?: string
          event_type?: string
          id?: string
          last_error?: string | null
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          module: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          module: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          module?: string
          name?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          note: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          full_name: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "access_profile_overview"
            referencedColumns: ["role_id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_editable: boolean
          is_system: boolean
          name: string
          organization_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_editable?: boolean
          is_system?: boolean
          name: string
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_editable?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      states: {
        Row: {
          id: number
          latitude: number | null
          longitude: number | null
          name: string
          region: string
          uf: string
        }
        Insert: {
          id: number
          latitude?: number | null
          longitude?: number | null
          name: string
          region: string
          uf: string
        }
        Update: {
          id?: number
          latitude?: number | null
          longitude?: number | null
          name?: string
          region?: string
          uf?: string
        }
        Relationships: []
      }
      vehicle_makes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_makes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_models: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          updated_at: string
          updated_by: string | null
          vehicle_make_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_make_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_make_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_models_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_models_vehicle_make_id_fkey"
            columns: ["vehicle_make_id"]
            isOneToOne: false
            referencedRelation: "vehicle_makes"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_odometer_readings: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          odometer_km: number
          organization_id: string
          reading_date: string
          source: string
          superseded_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          odometer_km: number
          organization_id: string
          reading_date?: string
          source: string
          superseded_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          odometer_km?: number
          organization_id?: string
          reading_date?: string
          source?: string
          superseded_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_odometer_readings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_readings_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "vehicle_odometer_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_odometer_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      vehicle_operation_assignments: {
        Row: {
          city_id: number
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          operation_id: string
          organization_id: string
          reason: string | null
          state_id: number
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          city_id: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          operation_id: string
          organization_id: string
          reason?: string | null
          state_id: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          city_id?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          operation_id?: string
          organization_id?: string
          reason?: string | null
          state_id?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_assignments_city_state_fkey"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_coverage_fkey"
            columns: ["organization_id", "operation_id", "city_id"]
            isOneToOne: false
            referencedRelation: "operation_cities"
            referencedColumns: ["organization_id", "operation_id", "city_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_coverage_fkey"
            columns: ["organization_id", "operation_id", "city_id"]
            isOneToOne: false
            referencedRelation: "operation_geography"
            referencedColumns: ["organization_id", "operation_id", "city_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_assignments_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_operation_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_status: string
          organization_id: string
          previous_status: string | null
          reason: string | null
          vehicle_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_status: string
          organization_id: string
          previous_status?: string | null
          reason?: string | null
          vehicle_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_status?: string
          organization_id?: string
          previous_status?: string | null
          reason?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_status_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_status_history_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_status_history_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      vehicle_subcategories: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          vehicle_type_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_subcategories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_subcategories_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_type_apps: {
        Row: {
          app_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          vehicle_type_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          vehicle_type_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_type_apps_app_fkey"
            columns: ["app_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "operational_apps"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "vehicle_type_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_type_apps_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_type_module_rules: {
        Row: {
          capability: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_eligible: boolean
          module_code: string
          organization_id: string
          reason: string | null
          vehicle_type_id: string
        }
        Insert: {
          capability: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_eligible: boolean
          module_code: string
          organization_id: string
          reason?: string | null
          vehicle_type_id: string
        }
        Update: {
          capability?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_eligible?: boolean
          module_code?: string
          organization_id?: string
          reason?: string | null
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_type_module_rules_module_code_fkey"
            columns: ["module_code"]
            isOneToOne: false
            referencedRelation: "operational_modules"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "vehicle_type_module_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_type_module_rules_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_type_operations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          operation_id: string
          organization_id: string
          vehicle_type_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          operation_id: string
          organization_id: string
          vehicle_type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          operation_id?: string
          organization_id?: string
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_type_operations_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_type_operations_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_type_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_type_operations_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_type_settings: {
        Row: {
          created_at: string
          created_by: string | null
          is_enabled: boolean
          notes: string | null
          operation_restriction_enabled: boolean
          organization_id: string
          requires_subcategory: boolean
          updated_at: string
          updated_by: string | null
          vehicle_type_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          is_enabled?: boolean
          notes?: string | null
          operation_restriction_enabled?: boolean
          organization_id: string
          requires_subcategory?: boolean
          updated_at?: string
          updated_by?: string | null
          vehicle_type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          is_enabled?: boolean
          notes?: string | null
          operation_restriction_enabled?: boolean
          organization_id?: string
          requires_subcategory?: boolean
          updated_at?: string
          updated_by?: string | null
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_type_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_type_settings_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_types: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_unit_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          organization_id: string
          organization_unit_id: string
          reason: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          organization_id: string
          organization_unit_id: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          organization_id?: string
          organization_unit_id?: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_unit_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_unit_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_unit_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_unit_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_unit_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      vehicles: {
        Row: {
          antt_code: string | null
          asset_value: number | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          fleet_code: string | null
          has_tachograph: boolean
          id: string
          license_plate: string | null
          manufacture_year: number | null
          model_year: number | null
          notes: string | null
          organization_id: string
          organization_unit_id: string | null
          ownership_type: string | null
          renavam: string | null
          status: string
          tachograph_number: string | null
          updated_at: string
          updated_by: string | null
          vehicle_model_id: string | null
          vehicle_subcategory_id: string | null
          vehicle_type_id: string
          vin: string | null
        }
        Insert: {
          antt_code?: string | null
          asset_value?: number | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          fleet_code?: string | null
          has_tachograph?: boolean
          id?: string
          license_plate?: string | null
          manufacture_year?: number | null
          model_year?: number | null
          notes?: string | null
          organization_id: string
          organization_unit_id?: string | null
          ownership_type?: string | null
          renavam?: string | null
          status?: string
          tachograph_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id: string
          vin?: string | null
        }
        Update: {
          antt_code?: string | null
          asset_value?: number | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          fleet_code?: string | null
          has_tachograph?: boolean
          id?: string
          license_plate?: string | null
          manufacture_year?: number | null
          model_year?: number | null
          notes?: string | null
          organization_id?: string
          organization_unit_id?: string | null
          ownership_type?: string | null
          renavam?: string | null
          status?: string
          tachograph_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id?: string
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_cost_center_fkey"
            columns: ["organization_id", "cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicles_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicles_subcategory_fkey"
            columns: ["vehicle_subcategory_id", "vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_subcategories"
            referencedColumns: ["id", "vehicle_type_id"]
          },
          {
            foreignKeyName: "vehicles_vehicle_model_id_fkey"
            columns: ["vehicle_model_id"]
            isOneToOne: false
            referencedRelation: "vehicle_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      work_locations: {
        Row: {
          city_id: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          organization_id: string
          organization_unit_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city_id?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          organization_id: string
          organization_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city_id?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          organization_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_locations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_locations_unit_fk"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_locations_unit_fk"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Views: {
      access_profile_overview: {
        Row: {
          added_permissions: string[] | null
          catalog_name: string | null
          code: string | null
          description: string | null
          is_administrator: boolean | null
          last_changed_at: string | null
          member_count: number | null
          organization_id: string | null
          permission_count: number | null
          removed_permissions: string[] | null
          role_id: string | null
          role_name: string | null
          sort_order: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_directory: {
        Row: {
          city_id: number | null
          city_name: string | null
          code: string | null
          complement: string | null
          cost_center_count: number | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          district: string | null
          document_number: string | null
          employee_count: number | null
          id: string | null
          legal_name: string | null
          name: string | null
          notes: string | null
          operation_count: number | null
          organization_id: string | null
          postal_code: string | null
          state_id: number | null
          state_uf: string | null
          status: string | null
          status_reason: string | null
          street: string | null
          street_number: string | null
          unit_type: string | null
          updated_at: string | null
          updated_by: string | null
          vehicle_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_units_city_fkey"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "organization_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_operation_directory: {
        Row: {
          branch_code: string | null
          branch_name: string | null
          created_at: string | null
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          id: string | null
          is_current: boolean | null
          notes: string | null
          operation_code: string | null
          operation_id: string | null
          operation_name: string | null
          operation_status: string | null
          organization_id: string | null
          organization_unit_id: string | null
          updated_at: string | null
          updated_by: string | null
          vehicle_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_unit_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_operations_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "unit_operations_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "unit_operations_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "unit_operations_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_directory: {
        Row: {
          access_all_operations: boolean | null
          access_operation_count: number | null
          access_role_codes: string[] | null
          access_role_names: string[] | null
          access_since: string | null
          access_status: string | null
          access_updated_at: string | null
          account_user_id: string | null
          admission_date: string | null
          assignment_id: string | null
          business_profile_id: string | null
          business_profile_name: string | null
          corporate_email: string | null
          created_at: string | null
          deleted_at: string | null
          driver_license_id: string | null
          employee_code: string | null
          employment_area_id: string | null
          employment_area_name: string | null
          employment_status: string | null
          full_name: string | null
          id: string | null
          job_position_code: string | null
          job_position_id: string | null
          job_position_name: string | null
          license_category: string | null
          license_expiration_date: string | null
          license_points: number | null
          license_state: string | null
          manager_employee_id: string | null
          manager_name: string | null
          membership_id: string | null
          operation_id: string | null
          operation_name: string | null
          organization_id: string | null
          organization_unit_code: string | null
          organization_unit_id: string | null
          organization_unit_name: string | null
          search_name: string | null
          termination_date: string | null
          updated_at: string | null
          work_location_id: string | null
          work_location_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fidelization_directory: {
        Row: {
          br_code: string | null
          city_id: number | null
          city_name: string | null
          created_at: string | null
          created_by: string | null
          end_date: string | null
          end_reason: string | null
          fleet_code: string | null
          id: string | null
          is_current: boolean | null
          license_plate: string | null
          operation_br_id: string | null
          operation_id: string | null
          operation_name: string | null
          organization_id: string | null
          reason: string | null
          replaces_assignment_id: string | null
          source: string | null
          start_date: string | null
          state_id: number | null
          state_uf: string | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
          vehicle_id: string | null
          vehicle_make_name: string | null
          vehicle_model_name: string | null
          vehicle_role: string | null
          vehicle_type_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fidelization_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fidelization_br_fkey"
            columns: ["organization_id", "operation_br_id"]
            isOneToOne: false
            referencedRelation: "operation_br_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_br_fkey"
            columns: ["organization_id", "operation_br_id"]
            isOneToOne: false
            referencedRelation: "operation_brs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_replaces_fkey"
            columns: ["organization_id", "replaces_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_assignments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_replaces_fkey"
            columns: ["organization_id", "replaces_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fidelization_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      leadership_directory: {
        Row: {
          br_code: string | null
          city_id: number | null
          city_name: string | null
          created_at: string | null
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          employee_code: string | null
          employee_email: string | null
          employee_id: string | null
          employee_name: string | null
          employee_status: string | null
          end_reason: string | null
          id: string | null
          is_current: boolean | null
          is_primary: boolean | null
          notes: string | null
          operation_br_id: string | null
          operation_city_id: string | null
          operation_id: string | null
          operation_name: string | null
          operation_status: string | null
          organization_id: string | null
          responsibility_type: string | null
          scope_level: string | null
          state_id: number | null
          state_uf: string | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leadership_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leadership_br_fkey"
            columns: ["operation_br_id", "organization_id", "operation_city_id"]
            isOneToOne: false
            referencedRelation: "operation_br_directory"
            referencedColumns: ["id", "organization_id", "operation_city_id"]
          },
          {
            foreignKeyName: "leadership_br_fkey"
            columns: ["operation_br_id", "organization_id", "operation_city_id"]
            isOneToOne: false
            referencedRelation: "operation_brs"
            referencedColumns: ["id", "organization_id", "operation_city_id"]
          },
          {
            foreignKeyName: "leadership_city_fkey"
            columns: ["operation_city_id", "organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_cities"
            referencedColumns: ["id", "organization_id", "operation_id"]
          },
          {
            foreignKeyName: "leadership_city_fkey"
            columns: ["operation_city_id", "organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_geography"
            referencedColumns: ["id", "organization_id", "operation_id"]
          },
          {
            foreignKeyName: "leadership_employee_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leadership_employee_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leadership_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leadership_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "operation_cities_city_fk"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
        ]
      }
      operation_br_directory: {
        Row: {
          city_id: number | null
          city_name: string | null
          code: string | null
          created_at: string | null
          current_fleet_code: string | null
          current_leader_employee_id: string | null
          current_leader_name: string | null
          current_license_plate: string | null
          current_vehicle_id: string | null
          description: string | null
          id: string | null
          notes: string | null
          operation_city_id: string | null
          operation_id: string | null
          operation_name: string | null
          operation_status: string | null
          organization_id: string | null
          state_id: number | null
          state_uf: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_brs_coverage_fkey"
            columns: [
              "operation_city_id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
            isOneToOne: false
            referencedRelation: "operation_cities"
            referencedColumns: [
              "id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
          },
          {
            foreignKeyName: "operation_brs_coverage_fkey"
            columns: [
              "operation_city_id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
            isOneToOne: false
            referencedRelation: "operation_geography"
            referencedColumns: [
              "id",
              "organization_id",
              "operation_id",
              "state_id",
              "city_id",
            ]
          },
          {
            foreignKeyName: "operation_brs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_geography: {
        Row: {
          city_id: number | null
          city_name: string | null
          ddd: number | null
          employee_count: number | null
          id: string | null
          is_capital: boolean | null
          latitude: number | null
          longitude: number | null
          operation_id: string | null
          organization_id: string | null
          region: string | null
          state_id: number | null
          state_name: string | null
          uf: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_cities_city_fk"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "operation_cities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_cities_state_fk"
            columns: ["organization_id", "operation_id", "state_id"]
            isOneToOne: false
            referencedRelation: "operation_state_summary"
            referencedColumns: ["organization_id", "operation_id", "state_id"]
          },
          {
            foreignKeyName: "operation_cities_state_fk"
            columns: ["organization_id", "operation_id", "state_id"]
            isOneToOne: false
            referencedRelation: "operation_states"
            referencedColumns: ["organization_id", "operation_id", "state_id"]
          },
        ]
      }
      operation_state_summary: {
        Row: {
          city_count: number | null
          id: string | null
          operation_id: string | null
          organization_id: string | null
          region: string | null
          state_id: number | null
          state_name: string | null
          uf: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_states_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "operation_states_operation_fk"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "operation_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_states_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "state_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_states_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_summary: {
        Row: {
          access_count: number | null
          city_count: number | null
          code: string | null
          description: string | null
          employee_count: number | null
          id: string | null
          location_count: number | null
          name: string | null
          organization_id: string | null
          state_count: number | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      state_summary: {
        Row: {
          capital_id: number | null
          capital_name: string | null
          city_count: number | null
          id: number | null
          latitude: number | null
          longitude: number | null
          name: string | null
          region: string | null
          uf: string | null
        }
        Relationships: []
      }
      vehicle_assignment_history: {
        Row: {
          city_id: number | null
          city_name: string | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          effective_from: string | null
          effective_to: string | null
          id: string | null
          is_current: boolean | null
          is_scheduled: boolean | null
          operation_id: string | null
          operation_name: string | null
          organization_id: string | null
          reason: string | null
          state_id: number | null
          state_uf: string | null
          vehicle_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_assignments_city_state_fkey"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_coverage_fkey"
            columns: ["organization_id", "operation_id", "city_id"]
            isOneToOne: false
            referencedRelation: "operation_cities"
            referencedColumns: ["organization_id", "operation_id", "city_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_coverage_fkey"
            columns: ["organization_id", "operation_id", "city_id"]
            isOneToOne: false
            referencedRelation: "operation_geography"
            referencedColumns: ["organization_id", "operation_id", "city_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_assignments_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicle_operation_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_directory: {
        Row: {
          antt_code: string | null
          asset_value: number | null
          assigned_since: string | null
          assigned_until: string | null
          assignment_id: string | null
          city_id: number | null
          city_name: string | null
          cost_center_id: string | null
          cost_center_name: string | null
          created_at: string | null
          current_odometer_km: number | null
          deleted_at: string | null
          fleet_code: string | null
          has_tachograph: boolean | null
          id: string | null
          license_plate: string | null
          manufacture_year: number | null
          model_year: number | null
          notes: string | null
          odometer_reading_date: string | null
          odometer_source: string | null
          operation_id: string | null
          operation_name: string | null
          organization_id: string | null
          organization_unit_id: string | null
          organization_unit_name: string | null
          ownership_type: string | null
          renavam: string | null
          scheduled_assignment_id: string | null
          scheduled_city_id: number | null
          scheduled_city_name: string | null
          scheduled_from: string | null
          scheduled_operation_id: string | null
          scheduled_operation_name: string | null
          scheduled_state_uf: string | null
          search_text: string | null
          state_id: number | null
          state_name: string | null
          state_uf: string | null
          status: string | null
          tachograph_number: string | null
          updated_at: string | null
          vehicle_make_id: string | null
          vehicle_make_name: string | null
          vehicle_model_id: string | null
          vehicle_model_name: string | null
          vehicle_subcategory_id: string | null
          vehicle_subcategory_name: string | null
          vehicle_type_code: string | null
          vehicle_type_id: string | null
          vehicle_type_name: string | null
          vin: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_assignments_city_state_fkey"
            columns: ["scheduled_city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_city_state_fkey"
            columns: ["city_id", "state_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id", "state_id"]
          },
          {
            foreignKeyName: "vehicle_models_vehicle_make_id_fkey"
            columns: ["vehicle_make_id"]
            isOneToOne: false
            referencedRelation: "vehicle_makes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_cost_center_fkey"
            columns: ["organization_id", "cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicles_organization_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vehicles_subcategory_fkey"
            columns: ["vehicle_subcategory_id", "vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_subcategories"
            referencedColumns: ["id", "vehicle_type_id"]
          },
          {
            foreignKeyName: "vehicles_vehicle_model_id_fkey"
            columns: ["vehicle_model_id"]
            isOneToOne: false
            referencedRelation: "vehicle_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_timeline: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          event_type: string | null
          fields: string[] | null
          id: string | null
          new_value: Json | null
          occurred_at: string | null
          organization_id: string | null
          previous_value: Json | null
          reason: string | null
          vehicle_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      access_inconsistencies: {
        Args: { p_organization_id: string }
        Returns: {
          detail: string
          kind: string
          severity: string
          subject: string
          subject_id: string
        }[]
      }
      access_profile_matrix: {
        Args: { p_organization_id: string }
        Returns: {
          default_codes: string[]
          description: string
          granted_codes: string[]
          module: string
          permission_code: string
          permission_name: string
          reserved: boolean
        }[]
      }
      archive_employee: {
        Args: { p_employee_id: string; p_suspend_access?: boolean }
        Returns: undefined
      }
      archive_vehicle: {
        Args: { p_reason?: string; p_vehicle_id: string }
        Returns: undefined
      }
      checklist_execution_detail: {
        Args: { p_execution_id: string }
        Returns: Json
      }
      checklist_fleet_context: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      checklist_fleet_form: {
        Args: {
          p_operation_id: string
          p_organization_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      checklist_my_executions: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      checklist_vehicle_options: {
        Args: {
          p_date?: string
          p_operation_id: string
          p_organization_id: string
          p_search?: string
        }
        Returns: Json
      }
      submit_checklist_execution: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      br_planner_indicators: {
        Args: {
          p_filters?: Json
          p_month?: number
          p_organization_id: string
          p_year?: number
        }
        Returns: Json
      }
      br_planner_rows: {
        Args: {
          p_filters?: Json
          p_month?: number
          p_organization_id: string
          p_year?: number
        }
        Returns: {
          anchor_date: string
          assignment_end: string
          assignment_id: string
          assignment_start: string
          city_id: number
          city_name: string
          code: string
          description: string
          driver_employee_id: string
          driver_name: string
          fleet_code: string
          id: string
          leader_employee_id: string
          leader_name: string
          leader_scope: string
          license_plate: string
          operation_city_id: string
          operation_id: string
          operation_name: string
          state_id: number
          state_uf: string
          status: string
          vehicle_id: string
        }[]
      }
      br_vehicle_history: {
        Args: { p_operation_br_id: string }
        Returns: {
          assignment_id: string
          created_at: string
          end_date: string
          end_reason: string
          fleet_code: string
          license_plate: string
          reason: string
          replaces_assignment_id: string
          source: string
          start_date: string
          status: string
          vehicle_id: string
          vehicle_role: string
        }[]
      }
      branch_audit_trail: {
        Args: { p_limit?: number; p_organization_unit_id: string }
        Returns: {
          action: string
          actor_name: string
          changed_fields: string[]
          created_at: string
          entity_type: string
          id: string
          new_data: Json
          old_data: Json
        }[]
      }
      branch_employees: {
        Args: { p_limit?: number; p_organization_unit_id: string }
        Returns: {
          city_name: string
          employee_code: string
          employee_id: string
          full_name: string
          job_position: string
          leader_name: string
          operation_name: string
          status: string
        }[]
      }
      branch_impact: { Args: { p_organization_unit_id: string }; Returns: Json }
      branch_operation_impact: {
        Args: { p_operation_id: string; p_organization_unit_id: string }
        Returns: Json
      }
      branch_summary: { Args: { p_organization_id: string }; Returns: Json }
      branch_vehicles: {
        Args: { p_limit?: number; p_organization_unit_id: string }
        Returns: {
          city_name: string
          fleet_code: string
          license_plate: string
          operation_name: string
          status: string
          vehicle_id: string
          vehicle_type: string
        }[]
      }
      correct_vehicle_odometer: {
        Args: {
          p_odometer_km: number
          p_reading_date: string
          p_reason: string
          p_vehicle_id: string
        }
        Returns: string
      }
      create_operation_brs_batch: {
        Args: {
          p_codes: string[]
          p_description?: string
          p_dry_run?: boolean
          p_operation_city_id: string
          p_operation_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      create_organization: {
        Args: {
          p_document_number?: string
          p_legal_name?: string
          p_locale?: string
          p_name: string
          p_owner_user_id?: string
          p_slug: string
          p_timezone?: string
        }
        Returns: string
      }
      current_user_permissions: {
        Args: { p_organization_id: string }
        Returns: string[]
      }
      eligible_fidelization_vehicles: {
        Args: {
          p_end_date?: string
          p_exclude_id?: string
          p_limit?: number
          p_operation_br_id: string
          p_search?: string
          p_start_date: string
        }
        Returns: {
          conflict_br: string
          fleet_code: string
          has_conflict: boolean
          license_plate: string
          make_name: string
          model_name: string
          vehicle_id: string
          vehicle_type: string
        }[]
      }
      employee_directory_stats: {
        Args: { p_organization_id: string }
        Returns: {
          pending_invites: number
          suspended_access: number
          total_employees: number
          with_access: number
          without_access: number
        }[]
      }
      employee_masked_identifiers: {
        Args: { p_employee_id: string }
        Returns: {
          birth_year: number
          cpf_masked: string
          has_birth_date: boolean
          has_cpf: boolean
        }[]
      }
      employee_summary: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      end_fidelization_assignment: {
        Args: { p_end_date: string; p_id: string; p_reason: string }
        Returns: undefined
      }
      end_fidelization_driver: {
        Args: { p_end_date: string; p_id: string; p_reason: string }
        Returns: undefined
      }
      end_leadership_assignment: {
        Args: { p_effective_to: string; p_id: string; p_reason?: string }
        Returns: undefined
      }
      end_vehicle_assignment: {
        Args: {
          p_effective_to?: string
          p_reason?: string
          p_vehicle_id: string
        }
        Returns: undefined
      }
      equipment_subcategory_impact: {
        Args: { p_organization_id: string; p_subcategory_id: string }
        Returns: Json
      }
      equipment_type_history: {
        Args: { p_organization_id: string; p_vehicle_type_id: string }
        Returns: {
          action: string
          actor_name: string
          entity: string
          fields: string[]
          id: string
          new_value: Json
          occurred_at: string
          previous_value: Json
        }[]
      }
      equipment_type_impact: {
        Args: { p_organization_id: string; p_vehicle_type_id: string }
        Returns: Json
      }
      equipment_type_operation_impact: {
        Args: {
          p_operation_ids: string[]
          p_organization_id: string
          p_vehicle_type_id: string
        }
        Returns: {
          operation_id: string
          operation_name: string
          vehicle_count: number
        }[]
      }
      equipment_type_summary: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      fidelization_calendar: {
        Args: {
          p_br_id?: string
          p_city_id?: number
          p_month: number
          p_operation_id?: string
          p_organization_id: string
          p_state_id?: number
          p_year: number
        }
        Returns: {
          br_code: string
          br_status: string
          city_name: string
          days: Json
          days_with_vehicle: number
          days_without_vehicle: number
          leader_name: string
          operation_br_id: string
          operation_id: string
          operation_name: string
          state_uf: string
          substitutions: number
        }[]
      }
      fidelization_conflicts: {
        Args: {
          p_end_date?: string
          p_exclude_id?: string
          p_organization_id: string
          p_start_date: string
          p_vehicle_id: string
        }
        Returns: {
          assignment_id: string
          br_code: string
          city_name: string
          end_date: string
          operation_br_id: string
          operation_name: string
          start_date: string
          status: string
        }[]
      }
      fidelization_indicators: {
        Args: {
          p_city_id?: number
          p_month: number
          p_operation_id?: string
          p_organization_id: string
          p_state_id?: number
          p_year: number
        }
        Returns: Json
      }
      flag_import_profile_divergences: {
        Args: { p_batch_id: string }
        Returns: number
      }
      get_equipment_type: {
        Args: { p_organization_id: string; p_vehicle_type_id: string }
        Returns: Json
      }
      governance_audit_trail: {
        Args: { p_entity_id: string; p_entity_type: string; p_limit?: number }
        Returns: {
          action: string
          actor_name: string
          changed_fields: string[]
          created_at: string
          id: string
          new_data: Json
          old_data: Json
        }[]
      }
      grant_employee_access: {
        Args: {
          p_employee_id: string
          p_operation_ids?: string[]
          p_role_ids?: string[]
          p_user_id: string
        }
        Returns: string
      }
      invert_fidelization_vehicles: {
        Args: {
          p_assignment_a: string
          p_assignment_b: string
          p_effective_from: string
          p_reason: string
        }
        Returns: Json
      }
      leadership_indicators: {
        Args: {
          p_month: number
          p_operation_id?: string
          p_organization_id: string
          p_year: number
        }
        Returns: Json
      }
      list_equipment_types: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: {
          app_count: number
          code: string
          description: string
          effective_status: string
          id: string
          is_active: boolean
          is_enabled: boolean
          module_rule_count: number
          name: string
          operation_count: number
          operation_restriction_enabled: boolean
          requires_subcategory: boolean
          scope: string
          subcategory_count: number
          updated_at: string
          vehicle_count: number
        }[]
      }
      log_user_export: {
        Args: {
          p_format: string
          p_organization_id: string
          p_row_count: number
          p_with_sensitive?: boolean
        }
        Returns: undefined
      }
      log_vehicle_export: {
        Args: {
          p_format: string
          p_organization_id: string
          p_row_count: number
        }
        Returns: undefined
      }
      membership_effective_access: {
        Args: { p_membership_id: string }
        Returns: Json
      }
      operation_br_impact: {
        Args: { p_operation_br_id: string }
        Returns: Json
      }
      operational_hierarchy: {
        Args: { p_operation_id?: string; p_organization_id: string }
        Returns: Json
      }
      prepare_employee_access: {
        Args: {
          p_employee_id: string
          p_operation_ids?: string[]
          p_role_ids?: string[]
        }
        Returns: {
          account_user_id: string
          email: string
          membership_id: string
          organization_id: string
        }[]
      }
      process_employee_import: {
        Args: { p_batch_id: string }
        Returns: {
          created_rows: number
          skipped_rows: number
          updated_rows: number
        }[]
      }
      process_vehicle_import: {
        Args: { p_batch_id: string }
        Returns: {
          created_rows: number
          skipped_rows: number
          updated_rows: number
        }[]
      }
      purge_expired_import_batches: { Args: never; Returns: number }
      replicate_leadership_competence: {
        Args: {
          p_dry_run?: boolean
          p_from_month: number
          p_from_year: number
          p_operation_id?: string
          p_organization_id: string
          p_overwrite?: boolean
          p_to_month: number
          p_to_year: number
        }
        Returns: Json
      }
      restore_employee: { Args: { p_employee_id: string }; Returns: undefined }
      restore_role_defaults: {
        Args: { p_reason: string; p_role_id: string }
        Returns: undefined
      }
      restore_vehicle: { Args: { p_vehicle_id: string }; Returns: undefined }
      save_branch: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      save_employee: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      save_equipment_type: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      save_fidelization_assignment: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_fidelization_driver: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      save_leadership_assignment: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_operation: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      save_operation_br: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      save_vehicle: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      search_cities: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_state_id?: number
        }
        Returns: {
          ddd: number
          id: number
          is_capital: boolean
          is_municipality: boolean
          latitude: number
          longitude: number
          name: string
          state_id: number
          state_name: string
          time_zone: string
          total: number
          uf: string
        }[]
      }
      set_branch_status: {
        Args: {
          p_organization_unit_id: string
          p_reason?: string
          p_status: string
        }
        Returns: undefined
      }
      set_employee_access_status: {
        Args: { p_employee_id: string; p_status: string }
        Returns: undefined
      }
      set_equipment_subcategory_status: {
        Args: {
          p_is_active: boolean
          p_organization_id: string
          p_reason?: string
          p_subcategory_id: string
        }
        Returns: undefined
      }
      set_equipment_type_status: {
        Args: {
          p_is_active: boolean
          p_organization_id: string
          p_reason?: string
          p_vehicle_type_id: string
        }
        Returns: undefined
      }
      set_membership_operation_scopes: {
        Args: { p_membership_id: string; p_operation_ids: string[] }
        Returns: undefined
      }
      set_membership_roles: {
        Args: {
          p_membership_id: string
          p_reason: string
          p_role_ids: string[]
        }
        Returns: undefined
      }
      set_operation_br_status: {
        Args: { p_operation_br_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      set_operation_status: {
        Args: { p_operation_id: string; p_status: string }
        Returns: undefined
      }
      set_role_permissions: {
        Args: {
          p_permission_codes: string[]
          p_reason: string
          p_role_id: string
        }
        Returns: undefined
      }
      set_vehicle_assignment: {
        Args: {
          p_city_id: number
          p_effective_from?: string
          p_operation_id: string
          p_reason?: string
          p_state_id: number
          p_vehicle_id: string
        }
        Returns: string
      }
      set_vehicle_registration_status: {
        Args: { p_reason?: string; p_status: string; p_vehicle_id: string }
        Returns: undefined
      }
      set_vehicle_status: {
        Args: { p_reason?: string; p_status: string; p_vehicle_id: string }
        Returns: undefined
      }
      simulatable_memberships: {
        Args: { p_organization_id: string }
        Returns: {
          email: string
          employee_name: string
          membership_id: string
          profile_codes: string[]
          status: string
        }[]
      }
      substitute_fidelization_vehicle: {
        Args: {
          p_assignment_id: string
          p_effective_from: string
          p_new_vehicle_id: string
          p_reason: string
        }
        Returns: Json
      }
      transfer_vehicle_branch: {
        Args: {
          p_effective_from: string
          p_organization_unit_id: string
          p_reason: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      validate_employee_import: {
        Args: { p_batch_id: string }
        Returns: {
          create_rows: number
          error_rows: number
          total_rows: number
          update_rows: number
          valid_rows: number
          warning_rows: number
        }[]
      }
      validate_vehicle_import: {
        Args: { p_batch_id: string }
        Returns: {
          create_rows: number
          error_rows: number
          total_rows: number
          update_rows: number
          valid_rows: number
          warning_rows: number
        }[]
      }
      vehicle_summary: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      vehicle_type_allows_operation: {
        Args: {
          p_operation_id: string
          p_organization_id: string
          p_vehicle_type_id: string
        }
        Returns: boolean
      }
      vehicle_type_module_eligibility: {
        Args: {
          p_capability: string
          p_module_code: string
          p_on_date?: string
          p_organization_id: string
          p_vehicle_type_id: string
        }
        Returns: boolean
      }
      vehicles_blocking_coverage_removal: {
        Args: { p_city_ids: number[]; p_operation_id: string }
        Returns: {
          city_id: number
          city_name: string
          vehicle_count: number
        }[]
      }
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
