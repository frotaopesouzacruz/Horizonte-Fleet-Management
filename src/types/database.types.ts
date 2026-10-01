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
      import_layouts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          mapping: Json
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          mapping?: Json
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          mapping?: Json
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_layouts_organization_id_fkey"
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
          change_reason: string | null
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
          change_reason?: string | null
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
          change_reason?: string | null
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
      maintenance_checklist_service_links: {
        Row: {
          action_key: string | null
          app_id: string
          auto_resolve: boolean
          created_at: string
          created_by: string | null
          field_key: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          question_key: string
          service_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action_key?: string | null
          app_id: string
          auto_resolve?: boolean
          created_at?: string
          created_by?: string | null
          field_key?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          question_key: string
          service_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action_key?: string | null
          app_id?: string
          auto_resolve?: boolean
          created_at?: string
          created_by?: string | null
          field_key?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          question_key?: string
          service_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_checklist_links_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_services"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_checklist_service_links_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "operational_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_checklist_service_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_clusters: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          default_criticality: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          default_criticality?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          default_criticality?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_clusters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_events: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          event_type: string
          from_status: string | null
          id: string
          maintenance_id: string
          occurred_at: string
          organization_id: string
          payload: Json
          reason: string | null
          source: string
          to_status: string | null
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          event_type: string
          from_status?: string | null
          id?: string
          maintenance_id: string
          occurred_at?: string
          organization_id: string
          payload?: Json
          reason?: string | null
          source?: string
          to_status?: string | null
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          event_type?: string
          from_status?: string | null
          id?: string
          maintenance_id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
          reason?: string | null
          source?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_events_maintenance_fkey"
            columns: ["organization_id", "maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_finding_links: {
        Row: {
          checklist_answer_id: string
          checklist_execution_id: string
          created_at: string
          created_by: string | null
          field_key: string | null
          id: string
          link_origin: string
          maintenance_id: string
          notes: string | null
          organization_id: string
          question_key: string
          resolution_status: string
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_item_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          checklist_answer_id: string
          checklist_execution_id: string
          created_at?: string
          created_by?: string | null
          field_key?: string | null
          id?: string
          link_origin?: string
          maintenance_id: string
          notes?: string | null
          organization_id: string
          question_key: string
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_item_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          checklist_answer_id?: string
          checklist_execution_id?: string
          created_at?: string
          created_by?: string | null
          field_key?: string | null
          id?: string
          link_origin?: string
          maintenance_id?: string
          notes?: string | null
          organization_id?: string
          question_key?: string
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_item_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_finding_links_checklist_answer_id_fkey"
            columns: ["checklist_answer_id"]
            isOneToOne: false
            referencedRelation: "checklist_execution_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_finding_links_checklist_execution_id_fkey"
            columns: ["checklist_execution_id"]
            isOneToOne: false
            referencedRelation: "checklist_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_finding_links_item_fkey"
            columns: ["organization_id", "resolved_by_item_id"]
            isOneToOne: false
            referencedRelation: "maintenance_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_finding_links_maintenance_fkey"
            columns: ["organization_id", "maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_finding_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_items: {
        Row: {
          cluster_id: string
          cluster_name_snapshot: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          criticality: string
          id: string
          maintenance_id: string
          notes: string | null
          organization_id: string
          result: string | null
          service_id: string
          service_name_snapshot: string
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cluster_id: string
          cluster_name_snapshot: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          criticality?: string
          id?: string
          maintenance_id: string
          notes?: string | null
          organization_id: string
          result?: string | null
          service_id: string
          service_name_snapshot: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cluster_id?: string
          cluster_name_snapshot?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          criticality?: string
          id?: string
          maintenance_id?: string
          notes?: string | null
          organization_id?: string
          result?: string | null
          service_id?: string
          service_name_snapshot?: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_items_cluster_fkey"
            columns: ["organization_id", "cluster_id"]
            isOneToOne: false
            referencedRelation: "maintenance_clusters"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_items_maintenance_fkey"
            columns: ["organization_id", "maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_items_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_services"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      maintenance_origins: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          manual_selectable: boolean
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
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          manual_selectable?: boolean
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
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          manual_selectable?: boolean
          name?: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_origins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_predictive_coverage: {
        Row: {
          coverage: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          plan_item_id: string
          service_id: string
        }
        Insert: {
          coverage?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          plan_item_id: string
          service_id: string
        }
        Update: {
          coverage?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          plan_item_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_predictive_coverage_item_fkey"
            columns: ["organization_id", "plan_item_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_plan_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_coverage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_predictive_coverage_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_services"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      maintenance_predictive_cycles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_result: string | null
          last_verification_id: string | null
          monitoring_active: boolean
          monitoring_days: number | null
          monitoring_km: number | null
          organization_id: string
          plan_id: string
          plan_item_id: string
          plan_version: number
          reference_date: string | null
          reference_km: number | null
          reference_maintenance_id: string | null
          reference_type: string
          reference_verification_id: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_result?: string | null
          last_verification_id?: string | null
          monitoring_active?: boolean
          monitoring_days?: number | null
          monitoring_km?: number | null
          organization_id: string
          plan_id: string
          plan_item_id: string
          plan_version: number
          reference_date?: string | null
          reference_km?: number | null
          reference_maintenance_id?: string | null
          reference_type?: string
          reference_verification_id?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_result?: string | null
          last_verification_id?: string | null
          monitoring_active?: boolean
          monitoring_days?: number | null
          monitoring_km?: number | null
          organization_id?: string
          plan_id?: string
          plan_item_id?: string
          plan_version?: number
          reference_date?: string | null
          reference_km?: number | null
          reference_maintenance_id?: string | null
          reference_type?: string
          reference_verification_id?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_predictive_cycles_item_fkey"
            columns: ["organization_id", "plan_item_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_plan_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_cycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_predictive_cycles_plan_fkey"
            columns: ["organization_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_plans"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_cycles_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_cycles_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      maintenance_predictive_plan_items: {
        Row: {
          alert_pct: number
          checklist: Json
          cluster_id: string
          created_at: string
          created_by: string | null
          criticality: string
          id: string
          interval_days: number | null
          interval_engine_hours: number | null
          interval_km: number | null
          is_active: boolean
          name: string
          organization_id: string
          plan_id: string
          schedule_pct: number
          service_id: string | null
          sort_order: number
          technical_description: string | null
          tolerance_pct: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alert_pct?: number
          checklist?: Json
          cluster_id: string
          created_at?: string
          created_by?: string | null
          criticality?: string
          id?: string
          interval_days?: number | null
          interval_engine_hours?: number | null
          interval_km?: number | null
          is_active?: boolean
          name: string
          organization_id: string
          plan_id: string
          schedule_pct?: number
          service_id?: string | null
          sort_order?: number
          technical_description?: string | null
          tolerance_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alert_pct?: number
          checklist?: Json
          cluster_id?: string
          created_at?: string
          created_by?: string | null
          criticality?: string
          id?: string
          interval_days?: number | null
          interval_engine_hours?: number | null
          interval_km?: number | null
          is_active?: boolean
          name?: string
          organization_id?: string
          plan_id?: string
          schedule_pct?: number
          service_id?: string | null
          sort_order?: number
          technical_description?: string | null
          tolerance_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_predictive_items_cluster_fkey"
            columns: ["organization_id", "cluster_id"]
            isOneToOne: false
            referencedRelation: "maintenance_clusters"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_items_plan_fkey"
            columns: ["organization_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_plans"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_items_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_services"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_plan_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_predictive_plan_versions: {
        Row: {
          approval_status: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          plan_id: string
          reason: string | null
          snapshot: Json
          version: number
        }
        Insert: {
          approval_status: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          plan_id: string
          reason?: string | null
          snapshot: Json
          version: number
        }
        Update: {
          approval_status?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          plan_id?: string
          reason?: string | null
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_predictive_plan_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_predictive_versions_plan_fkey"
            columns: ["organization_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_plans"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      maintenance_predictive_plans: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          oem_reference: string | null
          organization_id: string
          reference_document: string | null
          source: string
          updated_at: string
          updated_by: string | null
          vehicle_make_id: string | null
          vehicle_model_id: string | null
          vehicle_subcategory_id: string | null
          vehicle_type_id: string
          version: number
          year_from: number | null
          year_to: number | null
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          oem_reference?: string | null
          organization_id: string
          reference_document?: string | null
          source?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_make_id?: string | null
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id: string
          version?: number
          year_from?: number | null
          year_to?: number | null
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          oem_reference?: string | null
          organization_id?: string
          reference_document?: string | null
          source?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_make_id?: string | null
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id?: string
          version?: number
          year_from?: number | null
          year_to?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_predictive_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_predictive_plans_subcategory_fkey"
            columns: ["vehicle_subcategory_id", "vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_subcategories"
            referencedColumns: ["id", "vehicle_type_id"]
          },
          {
            foreignKeyName: "maintenance_predictive_plans_vehicle_make_id_fkey"
            columns: ["vehicle_make_id"]
            isOneToOne: false
            referencedRelation: "vehicle_makes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_predictive_plans_vehicle_model_id_fkey"
            columns: ["vehicle_model_id"]
            isOneToOne: false
            referencedRelation: "vehicle_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_predictive_plans_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_predictive_verifications: {
        Row: {
          checklist: Json
          created_at: string
          created_by: string | null
          cycle_id: string
          decision: string
          id: string
          km: number | null
          km_source: string | null
          maintenance_id: string | null
          monitor_days: number | null
          monitor_km: number | null
          notes: string | null
          organization_id: string
          plan_item_id: string
          responsible_employee_id: string | null
          responsible_name: string
          result: string
          vehicle_id: string
          verified_on: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          created_by?: string | null
          cycle_id: string
          decision: string
          id?: string
          km?: number | null
          km_source?: string | null
          maintenance_id?: string | null
          monitor_days?: number | null
          monitor_km?: number | null
          notes?: string | null
          organization_id: string
          plan_item_id: string
          responsible_employee_id?: string | null
          responsible_name: string
          result: string
          vehicle_id: string
          verified_on: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          created_by?: string | null
          cycle_id?: string
          decision?: string
          id?: string
          km?: number | null
          km_source?: string | null
          maintenance_id?: string | null
          monitor_days?: number | null
          monitor_km?: number | null
          notes?: string | null
          organization_id?: string
          plan_item_id?: string
          responsible_employee_id?: string | null
          responsible_name?: string
          result?: string
          vehicle_id?: string
          verified_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_predictive_verifications_cycle_fkey"
            columns: ["organization_id", "cycle_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_cycles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_verifications_employee_fkey"
            columns: ["organization_id", "responsible_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_verifications_employee_fkey"
            columns: ["organization_id", "responsible_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_verifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_predictive_verifications_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_predictive_verifications_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      maintenance_preventive_cycles: {
        Row: {
          alert_before_pct: number
          completed_km: number | null
          completed_maintenance_id: string | null
          completed_on: string | null
          completion_source: string | null
          created_at: string
          cycle_number: number
          id: string
          interval_km: number
          milestone_km: number
          organization_id: string
          rule_id: string
          tolerance_after_pct: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          alert_before_pct: number
          completed_km?: number | null
          completed_maintenance_id?: string | null
          completed_on?: string | null
          completion_source?: string | null
          created_at?: string
          cycle_number: number
          id?: string
          interval_km: number
          milestone_km: number
          organization_id: string
          rule_id: string
          tolerance_after_pct: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          alert_before_pct?: number
          completed_km?: number | null
          completed_maintenance_id?: string | null
          completed_on?: string | null
          completion_source?: string | null
          created_at?: string
          cycle_number?: number
          id?: string
          interval_km?: number
          milestone_km?: number
          organization_id?: string
          rule_id?: string
          tolerance_after_pct?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_preventive_cycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_preventive_cycles_rule_fkey"
            columns: ["organization_id", "rule_id"]
            isOneToOne: false
            referencedRelation: "maintenance_preventive_rules"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_preventive_cycles_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_preventive_cycles_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      maintenance_preventive_rules: {
        Row: {
          alert_before_pct: number
          created_at: string
          created_by: string | null
          criticality: string
          cycle_count: number
          deleted_at: string | null
          deleted_by: string | null
          id: string
          initial_km: number
          interval_km: number
          notes: string | null
          organization_id: string
          service_id: string | null
          status: string
          tolerance_after_pct: number
          updated_at: string
          updated_by: string | null
          vehicle_model_id: string | null
          vehicle_subcategory_id: string | null
          vehicle_type_id: string
        }
        Insert: {
          alert_before_pct?: number
          created_at?: string
          created_by?: string | null
          criticality?: string
          cycle_count?: number
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          initial_km?: number
          interval_km: number
          notes?: string | null
          organization_id: string
          service_id?: string | null
          status?: string
          tolerance_after_pct?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id: string
        }
        Update: {
          alert_before_pct?: number
          created_at?: string
          created_by?: string | null
          criticality?: string
          cycle_count?: number
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          initial_km?: number
          interval_km?: number
          notes?: string | null
          organization_id?: string
          service_id?: string | null
          status?: string
          tolerance_after_pct?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_preventive_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_preventive_rules_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_services"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_preventive_rules_subcategory_fkey"
            columns: ["vehicle_subcategory_id", "vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_subcategories"
            referencedColumns: ["id", "vehicle_type_id"]
          },
          {
            foreignKeyName: "maintenance_preventive_rules_vehicle_model_id_fkey"
            columns: ["vehicle_model_id"]
            isOneToOne: false
            referencedRelation: "vehicle_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_preventive_rules_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_services: {
        Row: {
          cluster_id: string
          created_at: string
          created_by: string | null
          criticality: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          expected_hours: number | null
          id: string
          is_predictive: boolean
          maintenance_type_codes: string[]
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
          vehicle_type_ids: string[]
        }
        Insert: {
          cluster_id: string
          created_at?: string
          created_by?: string | null
          criticality?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          expected_hours?: number | null
          id?: string
          is_predictive?: boolean
          maintenance_type_codes?: string[]
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_type_ids?: string[]
        }
        Update: {
          cluster_id?: string
          created_at?: string
          created_by?: string | null
          criticality?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          expected_hours?: number | null
          id?: string
          is_predictive?: boolean
          maintenance_type_codes?: string[]
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_type_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_services_cluster_fkey"
            columns: ["organization_id", "cluster_id"]
            isOneToOne: false
            referencedRelation: "maintenance_clusters"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_settings: {
        Row: {
          aging_buckets: number[]
          default_sla_hours: number
          km_compatible_days: number
          km_estimated_max_days: number
          organization_id: string
          predictive_forecast_days: number
          predictive_forecast_km: number
          recurrence_window_days: number
          schedule_overdue_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          aging_buckets?: number[]
          default_sla_hours?: number
          km_compatible_days?: number
          km_estimated_max_days?: number
          organization_id: string
          predictive_forecast_days?: number
          predictive_forecast_km?: number
          recurrence_window_days?: number
          schedule_overdue_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          aging_buckets?: number[]
          default_sla_hours?: number
          km_compatible_days?: number
          km_estimated_max_days?: number
          organization_id?: string
          predictive_forecast_days?: number
          predictive_forecast_km?: number
          recurrence_window_days?: number
          schedule_overdue_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_suppliers: {
        Row: {
          address: string | null
          city_id: number | null
          cluster_ids: string[]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          document_number: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          served_city_ids: number[]
          service_ids: string[]
          state_id: number | null
          status: string
          trade_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city_id?: number | null
          cluster_ids?: string[]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_number?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          served_city_ids?: number[]
          service_ids?: string[]
          state_id?: number | null
          status?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city_id?: number | null
          cluster_ids?: string[]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_number?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          served_city_ids?: number[]
          service_ids?: string[]
          state_id?: number | null
          status?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_suppliers_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_suppliers_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "state_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_suppliers_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_types: {
        Row: {
          code: string
          description: string | null
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          description?: string | null
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          description?: string | null
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      maintenances: {
        Row: {
          br_code_snapshot: string | null
          checklist_execution_id: string | null
          city_id: number | null
          city_name_snapshot: string | null
          code: string
          completion_notes: string | null
          context_date: string
          context_source: string
          created_at: string
          created_by: string | null
          current_km_date: string | null
          current_km_snapshot: number | null
          description: string | null
          duplicate_justification: string | null
          duration_hours: number | null
          duration_precision: string | null
          entry_date: string | null
          entry_km: number | null
          entry_km_difference: number | null
          entry_km_informed_at: string | null
          entry_km_informed_by: string | null
          entry_km_justification: string | null
          entry_km_official: number | null
          entry_km_reading_id: string | null
          entry_km_reference_date: string | null
          entry_km_source: string | null
          entry_km_status: string | null
          entry_time: string | null
          exit_date: string | null
          exit_time: string | null
          expected_exit_date: string | null
          expected_exit_time: string | null
          fidelization_assignment_id: string | null
          fleet_code_snapshot: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          leader_employee_id: string | null
          leader_name_snapshot: string | null
          leadership_assignment_id: string | null
          license_plate_snapshot: string
          maintenance_type_code: string
          notes: string | null
          operation_br_id: string | null
          operation_city_id: string | null
          operation_id: string | null
          operation_name_snapshot: string | null
          organization_id: string
          organization_unit_id: string | null
          origin_id: string
          predictive_cycle_id: string | null
          predictive_plan_item_id: string | null
          predictive_verification_id: string | null
          preventive_cycle_id: string | null
          priority: string
          reopen_count: number
          requested_at: string
          requested_on: string
          scheduled_date: string | null
          scheduled_time: string | null
          scheduling_notes: string | null
          service_order_number: string | null
          state_id: number | null
          state_uf_snapshot: string | null
          status: string
          supplier_id: string | null
          unit_name_snapshot: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
          vehicle_model_id: string | null
          vehicle_subcategory_id: string | null
          vehicle_type_id: string
        }
        Insert: {
          br_code_snapshot?: string | null
          checklist_execution_id?: string | null
          city_id?: number | null
          city_name_snapshot?: string | null
          code: string
          completion_notes?: string | null
          context_date: string
          context_source?: string
          created_at?: string
          created_by?: string | null
          current_km_date?: string | null
          current_km_snapshot?: number | null
          description?: string | null
          duplicate_justification?: string | null
          duration_hours?: number | null
          duration_precision?: string | null
          entry_date?: string | null
          entry_km?: number | null
          entry_km_difference?: number | null
          entry_km_informed_at?: string | null
          entry_km_informed_by?: string | null
          entry_km_justification?: string | null
          entry_km_official?: number | null
          entry_km_reading_id?: string | null
          entry_km_reference_date?: string | null
          entry_km_source?: string | null
          entry_km_status?: string | null
          entry_time?: string | null
          exit_date?: string | null
          exit_time?: string | null
          expected_exit_date?: string | null
          expected_exit_time?: string | null
          fidelization_assignment_id?: string | null
          fleet_code_snapshot?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          leader_employee_id?: string | null
          leader_name_snapshot?: string | null
          leadership_assignment_id?: string | null
          license_plate_snapshot: string
          maintenance_type_code: string
          notes?: string | null
          operation_br_id?: string | null
          operation_city_id?: string | null
          operation_id?: string | null
          operation_name_snapshot?: string | null
          organization_id: string
          organization_unit_id?: string | null
          origin_id: string
          predictive_cycle_id?: string | null
          predictive_plan_item_id?: string | null
          predictive_verification_id?: string | null
          preventive_cycle_id?: string | null
          priority?: string
          reopen_count?: number
          requested_at?: string
          requested_on: string
          scheduled_date?: string | null
          scheduled_time?: string | null
          scheduling_notes?: string | null
          service_order_number?: string | null
          state_id?: number | null
          state_uf_snapshot?: string | null
          status?: string
          supplier_id?: string | null
          unit_name_snapshot?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id: string
        }
        Update: {
          br_code_snapshot?: string | null
          checklist_execution_id?: string | null
          city_id?: number | null
          city_name_snapshot?: string | null
          code?: string
          completion_notes?: string | null
          context_date?: string
          context_source?: string
          created_at?: string
          created_by?: string | null
          current_km_date?: string | null
          current_km_snapshot?: number | null
          description?: string | null
          duplicate_justification?: string | null
          duration_hours?: number | null
          duration_precision?: string | null
          entry_date?: string | null
          entry_km?: number | null
          entry_km_difference?: number | null
          entry_km_informed_at?: string | null
          entry_km_informed_by?: string | null
          entry_km_justification?: string | null
          entry_km_official?: number | null
          entry_km_reading_id?: string | null
          entry_km_reference_date?: string | null
          entry_km_source?: string | null
          entry_km_status?: string | null
          entry_time?: string | null
          exit_date?: string | null
          exit_time?: string | null
          expected_exit_date?: string | null
          expected_exit_time?: string | null
          fidelization_assignment_id?: string | null
          fleet_code_snapshot?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          leader_employee_id?: string | null
          leader_name_snapshot?: string | null
          leadership_assignment_id?: string | null
          license_plate_snapshot?: string
          maintenance_type_code?: string
          notes?: string | null
          operation_br_id?: string | null
          operation_city_id?: string | null
          operation_id?: string | null
          operation_name_snapshot?: string | null
          organization_id?: string
          organization_unit_id?: string | null
          origin_id?: string
          predictive_cycle_id?: string | null
          predictive_plan_item_id?: string | null
          predictive_verification_id?: string | null
          preventive_cycle_id?: string | null
          priority?: string
          reopen_count?: number
          requested_at?: string
          requested_on?: string
          scheduled_date?: string | null
          scheduled_time?: string | null
          scheduling_notes?: string | null
          service_order_number?: string | null
          state_id?: number | null
          state_uf_snapshot?: string | null
          status?: string
          supplier_id?: string | null
          unit_name_snapshot?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
          vehicle_model_id?: string | null
          vehicle_subcategory_id?: string | null
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenances_br_fkey"
            columns: ["organization_id", "operation_br_id"]
            isOneToOne: false
            referencedRelation: "operation_br_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_br_fkey"
            columns: ["organization_id", "operation_br_id"]
            isOneToOne: false
            referencedRelation: "operation_brs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_checklist_execution_id_fkey"
            columns: ["checklist_execution_id"]
            isOneToOne: false
            referencedRelation: "checklist_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_entry_km_reading_id_fkey"
            columns: ["entry_km_reading_id"]
            isOneToOne: false
            referencedRelation: "vehicle_odometer_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_fidelization_fkey"
            columns: ["organization_id", "fidelization_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_assignments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_fidelization_fkey"
            columns: ["organization_id", "fidelization_assignment_id"]
            isOneToOne: false
            referencedRelation: "fidelization_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_import_batch_fkey"
            columns: ["organization_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_leader_fkey"
            columns: ["organization_id", "leader_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_leader_fkey"
            columns: ["organization_id", "leader_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_maintenance_type_code_fkey"
            columns: ["maintenance_type_code"]
            isOneToOne: false
            referencedRelation: "maintenance_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "maintenances_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operation_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_operation_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_origin_id_fkey"
            columns: ["origin_id"]
            isOneToOne: false
            referencedRelation: "maintenance_origins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_predictive_cycle_fkey"
            columns: ["organization_id", "predictive_cycle_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_cycles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_predictive_item_fkey"
            columns: ["organization_id", "predictive_plan_item_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_plan_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_predictive_verification_fkey"
            columns: ["organization_id", "predictive_verification_id"]
            isOneToOne: false
            referencedRelation: "maintenance_predictive_verifications"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_preventive_cycle_fkey"
            columns: ["organization_id", "preventive_cycle_id"]
            isOneToOne: false
            referencedRelation: "maintenance_preventive_cycles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "state_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_supplier_fkey"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "maintenance_suppliers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "branch_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_unit_fkey"
            columns: ["organization_id", "organization_unit_id"]
            isOneToOne: false
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_vehicle_fkey"
            columns: ["organization_id", "vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenances_vehicle_model_id_fkey"
            columns: ["vehicle_model_id"]
            isOneToOne: false
            referencedRelation: "vehicle_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_vehicle_subcategory_id_fkey"
            columns: ["vehicle_subcategory_id"]
            isOneToOne: false
            referencedRelation: "vehicle_subcategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenances_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
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
      adherence_obligation_status: {
        Row: {
          approved_reason_id: string | null
          approved_request_id: string | null
          checklist_context: string
          city_id: number | null
          created_at: string
          deadline_at: string
          decision_effect: string | null
          detected_condition: string | null
          eligibility_rule_id: string | null
          eligibility_rule_version: number | null
          execution_id: string | null
          expected_at: string
          fidelization_assignment_id: string | null
          fleet_code_snapshot: string | null
          generation_run_id: string | null
          has_pending_request: boolean
          id: string
          is_done: boolean
          is_due: boolean
          is_excluded: boolean
          is_provisional: boolean
          journey_seq: number
          leader_employee_id: string | null
          leadership_assignment_id: string | null
          license_plate_snapshot: string | null
          match_id: string | null
          operation_br_id: string | null
          operation_city_id: string | null
          operation_id: string
          operational_date: string
          organization_id: string
          organization_unit_id: string | null
          pending_request_id: string | null
          source: string
          state_id: number | null
          status_code: string
          status_code_applied: string | null
          today: string
          updated_at: string
          vehicle_id: string
          vehicle_status_snapshot: string | null
          vehicle_subcategory_id: string | null
          vehicle_type_id: string | null
        }
        Relationships: []
      }
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
      branch_cost_center_directory: {
        Row: {
          branch_code: string | null
          branch_name: string | null
          code: string | null
          id: string | null
          name: string | null
          organization_id: string | null
          organization_unit_id: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: []
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
      maintenance_status_history: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          from_status: string | null
          id: string | null
          maintenance_id: string | null
          occurred_at: string | null
          organization_id: string | null
          reason: string | null
          source: string | null
          to_status: string | null
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          from_status?: string | null
          id?: string | null
          maintenance_id?: string | null
          occurred_at?: string | null
          organization_id?: string | null
          reason?: string | null
          source?: string | null
          to_status?: string | null
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          from_status?: string | null
          id?: string | null
          maintenance_id?: string | null
          occurred_at?: string | null
          organization_id?: string | null
          reason?: string | null
          source?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_events_maintenance_fkey"
            columns: ["organization_id", "maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "maintenance_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
      apply_fidelization_period: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      archive_employee: {
        Args: { p_employee_id: string; p_suspend_access?: boolean }
        Returns: undefined
      }
      archive_vehicle: {
        Args: { p_reason?: string; p_vehicle_id: string }
        Returns: undefined
      }
      cancel_maintenance_import: {
        Args: { p_batch_id: string; p_organization_id: string }
        Returns: undefined
      }
      checklist_execution_detail: {
        Args: { p_execution_id: string }
        Returns: Json
      }
      checklist_execution_correction_form: {
        Args: { p_execution_id: string; p_organization_id: string }
        Returns: Json
      }
      correct_checklist_execution: {
        Args: { p_organization_id: string; p_payload: Json }
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
          p_vehicle_type_id: string
        }
        Returns: Json
      }
      fidelization_import_history: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      fidelization_movements_list: {
        Args: {
          p_filters?: Json
          p_organization_id: string
          p_page?: number
          p_page_size?: number
        }
        Returns: Json
      }
      fidelization_planner_matrix: {
        Args: {
          p_filters?: Json
          p_month: number
          p_organization_id: string
          p_year: number
        }
        Returns: Json
      }
      fidelization_competence_summary: {
        Args: { p_month: number; p_organization_id: string; p_year: number }
        Returns: Json
      }
      fidelization_history_evolution: {
        Args: { p_organization_id: string; p_year: number }
        Returns: Json
      }
      fidelization_history_rows: {
        Args: {
          p_filters?: Json
          p_month: number
          p_organization_id: string
          p_year: number
        }
        Returns: Json
      }
      import_fidelization_history: {
        Args: {
          p_batch?: string
          p_dry_run?: boolean
          p_organization_id: string
          p_rows: Json
        }
        Returns: Json
      }
      log_maintenance_export: {
        Args: {
          p_filters?: Json
          p_format: string
          p_organization_id: string
          p_row_count: number
        }
        Returns: undefined
      }
      maintenance_add_items: {
        Args: {
          p_maintenance_id: string
          p_reason?: string
          p_service_ids: string[]
        }
        Returns: Json
      }
      maintenance_archive_cluster: {
        Args: { p_cluster_id: string }
        Returns: undefined
      }
      maintenance_archive_preventive_rule: {
        Args: { p_rule_id: string }
        Returns: undefined
      }
      maintenance_archive_service: {
        Args: { p_service_id: string }
        Returns: undefined
      }
      maintenance_archive_supplier: {
        Args: { p_supplier_id: string }
        Returns: undefined
      }
      maintenance_cancel: {
        Args: { p_maintenance_id: string; p_reason: string }
        Returns: undefined
      }
      maintenance_catalog: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      maintenance_checklist_questions: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      maintenance_complete: {
        Args: { p_maintenance_id: string; p_payload: Json }
        Returns: Json
      }
      maintenance_create: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      maintenance_dashboard: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      maintenance_detail: { Args: { p_maintenance_id: string }; Returns: Json }
      maintenance_duplicate_predictive_plan: {
        Args: { p_name?: string; p_plan_id: string }
        Returns: string
      }
      maintenance_find_open: {
        Args: { p_service_ids?: string[]; p_vehicle_id: string }
        Returns: Json
      }
      maintenance_generate_predictive: {
        Args: { p_cycle_id: string; p_payload?: Json }
        Returns: Json
      }
      maintenance_hierarchy: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      maintenance_import_history: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      maintenance_link_findings: {
        Args: {
          p_answer_ids: string[]
          p_maintenance_id: string
          p_reason?: string
        }
        Returns: number
      }
      maintenance_list: {
        Args: {
          p_dir?: string
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_sort?: string
        }
        Returns: Json
      }
      maintenance_mark_not_performed: {
        Args: { p_maintenance_id: string; p_reason: string }
        Returns: undefined
      }
      maintenance_parameters: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      maintenance_predictive_cycle_history: {
        Args: { p_cycle_id: string }
        Returns: Json
      }
      maintenance_predictive_overview: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      maintenance_predictive_reset: {
        Args: {
          p_cycle_id: string
          p_date: string
          p_km: number
          p_reason: string
        }
        Returns: undefined
      }
      maintenance_preventive_matrix: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      maintenance_register_predictive_verification: {
        Args: { p_cycle_id: string; p_payload: Json }
        Returns: Json
      }
      maintenance_remove_item: {
        Args: { p_item_id: string; p_reason: string }
        Returns: undefined
      }
      maintenance_reopen: {
        Args: { p_maintenance_id: string; p_reason: string }
        Returns: undefined
      }
      maintenance_reprocess_km: {
        Args: { p_maintenance_id: string }
        Returns: Json
      }
      maintenance_reschedule: {
        Args: { p_maintenance_id: string; p_payload: Json; p_reason: string }
        Returns: undefined
      }
      maintenance_save_cluster: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      maintenance_save_origin: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      maintenance_save_predictive_coverage: {
        Args: { p_item_id: string; p_services: Json }
        Returns: number
      }
      maintenance_save_predictive_item: {
        Args: { p_payload: Json; p_plan_id: string; p_reason?: string }
        Returns: Json
      }
      maintenance_save_predictive_plan: {
        Args: { p_organization_id: string; p_payload: Json; p_reason?: string }
        Returns: string
      }
      maintenance_save_preventive_rule: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      maintenance_save_service: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      maintenance_save_service_links: {
        Args: { p_links: Json; p_service_id: string }
        Returns: number
      }
      maintenance_save_settings: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: undefined
      }
      maintenance_save_supplier: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      maintenance_schedule: {
        Args: { p_maintenance_id: string; p_payload: Json }
        Returns: undefined
      }
      maintenance_schedule_kpis: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      maintenance_schedule_preventive: {
        Args: { p_cycle_id: string; p_payload?: Json }
        Returns: Json
      }
      maintenance_set_entry_km: {
        Args: {
          p_justification: string
          p_km: number
          p_maintenance_id: string
        }
        Returns: Json
      }
      maintenance_set_predictive_plan_status: {
        Args: { p_plan_id: string; p_reason?: string; p_status: string }
        Returns: Json
      }
      maintenance_start: {
        Args: { p_maintenance_id: string; p_payload: Json }
        Returns: Json
      }
      maintenance_sync_predictive: {
        Args: { p_organization_id: string; p_vehicle_id?: string }
        Returns: Json
      }
      maintenance_sync_preventive: {
        Args: { p_organization_id: string; p_vehicle_id?: string }
        Returns: Json
      }
      maintenance_unlink_finding: {
        Args: { p_link_id: string; p_reason: string }
        Returns: undefined
      }
      maintenance_unschedule: {
        Args: { p_maintenance_id: string; p_reason: string }
        Returns: undefined
      }
      maintenance_update_details: {
        Args: { p_maintenance_id: string; p_payload: Json; p_reason?: string }
        Returns: undefined
      }
      maintenance_vehicle_context: {
        Args: { p_date?: string; p_vehicle_id: string }
        Returns: Json
      }
      maintenance_vehicle_findings: {
        Args: { p_days?: number; p_vehicle_id: string }
        Returns: Json
      }
      maintenance_vehicles_in_scope: {
        Args: { p_organization_id: string }
        Returns: {
          vehicle_id: string
        }[]
      }
      process_maintenance_import: {
        Args: {
          p_batch_id: string
          p_limit?: number
          p_organization_id: string
        }
        Returns: Json
      }
      stage_maintenance_import: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      submit_checklist_execution: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      application_links_overview: {
        Args: { p_app_id?: string; p_operation_id?: string; p_organization_id: string; p_vehicle_type_id?: string }
        Returns: Json
      }
      application_link_history: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      set_application_operation_link: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      set_application_vehicle_type_link: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      checklist_equipment_options: {
        Args: { p_date?: string; p_operation_id: string; p_organization_id: string }
        Returns: Json
      }
      checklist_scope_executions: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      checklist_admin_overview: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      checklist_version_tree: {
        Args: { p_organization_id: string; p_version_id: string }
        Returns: Json
      }
      checklist_version_preview: {
        Args: { p_operation_id?: string; p_organization_id: string; p_vehicle_subcategory_id?: string; p_vehicle_type_id?: string; p_version_id: string }
        Returns: Json
      }
      create_checklist_version: {
        Args: { p_organization_id: string; p_payload?: Json }
        Returns: Json
      }
      update_checklist_version: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      discard_checklist_version: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_checklist_cluster: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      delete_checklist_cluster: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      reorder_checklist_clusters: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_checklist_question: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      delete_checklist_question: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      reorder_checklist_questions: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_checklist_conditional: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      delete_checklist_conditional: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_checklist_rule: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      delete_checklist_rule: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      validate_checklist_version: {
        Args: { p_organization_id: string; p_version_id: string }
        Returns: Json
      }
      publish_checklist_version: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      adherence_heatmap: {
        Args: {
          p_context?: string
          p_filters?: Json
          p_month: number
          p_organization_id: string
          p_year: number
        }
        Returns: Json
      }
      adherence_journey: {
        Args: { p_date: string; p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      adherence_day_detail: {
        Args: {
          p_context?: string
          p_date: string
          p_filters?: Json
          p_organization_id: string
        }
        Returns: Json
      }
      adherence_import_history: {
        Args: {
          p_limit?: number
          p_organization_id: string
        }
        Returns: Json
      }
      adherence_insights: {
        Args: {
          p_context?: string
          p_filters?: Json
          p_month: number
          p_organization_id: string
          p_year: number
        }
        Returns: Json
      }
      adherence_matrix: {
        Args: {
          p_context?: string
          p_filters?: Json
          p_month: number
          p_organization_id: string
          p_page?: number
          p_page_size?: number
          p_year: number
        }
        Returns: Json
      }
      adherence_monthly: {
        Args: {
          p_context?: string
          p_filters?: Json
          p_organization_id: string
          p_year: number
        }
        Returns: Json
      }
      adherence_my_situation: {
        Args: { p_month: number; p_organization_id: string; p_year: number }
        Returns: Json
      }
      adherence_obligation_detail: {
        Args: { p_obligation_id: string; p_organization_id: string }
        Returns: Json
      }
      adherence_obligations_filtered: {
        Args: {
          p_context?: string
          p_filters?: Json
          p_from: string
          p_organization_id: string
          p_to: string
        }
        Returns: Database["public"]["Views"]["adherence_obligation_status"]["Row"][]
      }
      adherence_options: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      adherence_pending_list: {
        Args: {
          p_context?: string
          p_filters?: Json
          p_from: string
          p_limit?: number
          p_organization_id: string
          p_to: string
        }
        Returns: Json
      }
      adherence_requests_list: {
        Args: {
          p_filters?: Json
          p_organization_id: string
          p_page?: number
          p_page_size?: number
        }
        Returns: Json
      }
      adherence_return_tracking: {
        Args: {
          p_filters?: Json
          p_from: string
          p_limit?: number
          p_organization_id: string
          p_to: string
        }
        Returns: Json
      }
      adherence_select_obligations: {
        Args: {
          p_context?: string
          p_dates: Json
          p_filters?: Json
          p_limit?: number
          p_organization_id: string
        }
        Returns: Json
      }
      adherence_summary: {
        Args: {
          p_context?: string
          p_filters?: Json
          p_from: string
          p_group_by?: string
          p_organization_id: string
          p_to: string
        }
        Returns: Json
      }
      bulk_adherence_override: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      cancel_adherence_request: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      decide_adherence_request: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      decide_adherence_requests_bulk: {
        Args: {
          p_organization_id: string
          p_payload: Json
        }
        Returns: Json
      }
      override_adherence_status: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      reconcile_adherence_period: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      request_adherence_exclusion: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      resolve_adherence_inconsistency: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_adherence_reason: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      save_adherence_rule: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      set_adherence_target: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      process_adherence_import: {
        Args: { p_batch_id: string; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      stage_adherence_import: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      stage_br_import: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      process_br_import: {
        Args: { p_batch_id: string; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      stage_branch_import: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      process_branch_import: {
        Args: { p_batch_id: string; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      log_branch_export: {
        Args: {
          p_details?: Json
          p_format: string
          p_kind: string
          p_organization_id: string
          p_row_count: number
        }
        Returns: string
      }
      set_branch_cost_center: {
        Args: {
          p_cost_center_id: string
          p_linked: boolean
          p_organization_unit_id: string
        }
        Returns: Json
      }
      stage_fidelization_import: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      process_fidelization_import: {
        Args: { p_batch_id: string; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      set_fidelization_assignment_status: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      log_adherence_export: {
        Args: {
          p_format: string
          p_kind?: string
          p_organization_id: string
          p_row_count: number
        }
        Returns: undefined
      }
      log_fidelization_export: {
        Args: {
          p_format: string
          p_kind?: string
          p_organization_id: string
          p_row_count: number
        }
        Returns: undefined
      }
      log_leadership_export: {
        Args: {
          p_filters?: Json
          p_format: string
          p_organization_id: string
          p_row_count: number
        }
        Returns: undefined
      }
      br_detail: {
        Args: {
          p_month?: number
          p_operation_br_id: string
          p_organization_id: string
          p_year?: number
        }
        Returns: Json
      }
      br_directory: {
        Args: {
          p_dir?: string
          p_filters?: Json
          p_limit?: number
          p_month?: number
          p_offset?: number
          p_organization_id: string
          p_sort?: string
          p_year?: number
        }
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
      fidelization_stability: {
        Args: {
          p_filters?: Json
          p_month: number
          p_organization_id: string
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
      leadership_change_impact: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: Json
      }
      leadership_city_planner: {
        Args: { p_month: number; p_organization_id: string; p_year: number }
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
      leadership_scope_summary: {
        Args: {
          p_employee_id: string
          p_month: number
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
        Args: { p_batch_id: string; p_limit?: number }
        Returns: {
          created_rows: number
          remaining_rows: number
          skipped_rows: number
          updated_rows: number
        }[]
      }
      process_vehicle_import: {
        Args: { p_batch_id: string; p_limit?: number }
        Returns: {
          created_rows: number
          remaining_rows: number
          skipped_rows: number
          updated_rows: number
        }[]
      }
      purge_expired_import_batches: { Args: never; Returns: number }
      replicate_fidelization_competence: {
        Args: {
          p_dry_run?: boolean
          p_from_month: number
          p_from_year: number
          p_include_drivers?: boolean
          p_operation_id?: string
          p_organization_id: string
          p_to_month: number
          p_to_year: number
        }
        Returns: Json
      }
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
      resolve_operational_context: {
        Args: {
          p_date?: string
          p_operation_br_id: string
          p_organization_id: string
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
      save_import_layout: {
        Args: {
          p_kind: string
          p_mapping: Json
          p_name: string
          p_organization_id: string
        }
        Returns: string
      }
      delete_import_layout: {
        Args: { p_layout_id: string; p_organization_id: string }
        Returns: undefined
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
      set_city_leadership: {
        Args: {
          p_dry_run?: boolean
          p_employee_id: string | null
          p_from?: string
          p_month: number
          p_operation_city_id: string
          p_organization_id: string
          p_reason?: string | null
          p_year: number
        }
        Returns: Json
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
      substitute_fidelization_driver: {
        Args: {
          p_organization_id: string
          p_payload: Json
        }
        Returns: Json
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
        Args: { p_batch_id: string; p_limit?: number }
        Returns: {
          create_rows: number
          error_rows: number
          pending_rows: number
          total_rows: number
          update_rows: number
          valid_rows: number
          warning_rows: number
        }[]
      }
      validate_vehicle_import: {
        Args: { p_batch_id: string; p_limit?: number }
        Returns: {
          create_rows: number
          error_rows: number
          pending_rows: number
          total_rows: number
          update_rows: number
          valid_rows: number
          warning_rows: number
        }[]
      }
      vehicle_br_history: {
        Args: {
          p_organization_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      vehicle_maintenance_history: {
        Args: { p_vehicle_id: string }
        Returns: Json
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
