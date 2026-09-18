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
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "business_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      operations: {
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
      organization_units: {
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
            referencedRelation: "vehicles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      vehicle_types: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          fleet_code: string | null
          id: string
          license_plate: string | null
          manufacture_year: number | null
          model_year: number | null
          organization_id: string
          organization_unit_id: string | null
          ownership_type: string | null
          renavam: string | null
          status: string
          updated_at: string
          updated_by: string | null
          vehicle_model_id: string | null
          vehicle_type_id: string
          vin: string | null
        }
        Insert: {
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          fleet_code?: string | null
          id?: string
          license_plate?: string | null
          manufacture_year?: number | null
          model_year?: number | null
          organization_id: string
          organization_unit_id?: string | null
          ownership_type?: string | null
          renavam?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_model_id?: string | null
          vehicle_type_id: string
          vin?: string | null
        }
        Update: {
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          fleet_code?: string | null
          id?: string
          license_plate?: string | null
          manufacture_year?: number | null
          model_year?: number | null
          organization_id?: string
          organization_unit_id?: string | null
          ownership_type?: string | null
          renavam?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_model_id?: string | null
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
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
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
            referencedRelation: "organization_units"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Views: {
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
    }
    Functions: {
      archive_employee: {
        Args: { p_employee_id: string; p_suspend_access?: boolean }
        Returns: undefined
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
      grant_employee_access: {
        Args: {
          p_employee_id: string
          p_operation_ids?: string[]
          p_role_ids?: string[]
          p_user_id: string
        }
        Returns: string
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
      purge_expired_import_batches: { Args: never; Returns: number }
      restore_employee: { Args: { p_employee_id: string }; Returns: undefined }
      save_employee: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      set_employee_access_status: {
        Args: { p_employee_id: string; p_status: string }
        Returns: undefined
      }
      set_membership_operation_scopes: {
        Args: { p_membership_id: string; p_operation_ids: string[] }
        Returns: undefined
      }
      set_membership_roles: {
        Args: { p_membership_id: string; p_role_ids: string[] }
        Returns: undefined
      }
      set_vehicle_status: {
        Args: { p_reason?: string; p_status: string; p_vehicle_id: string }
        Returns: undefined
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
