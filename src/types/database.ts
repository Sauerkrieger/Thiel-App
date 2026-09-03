/**
 * Thiel Dienstleistungen – Supabase Datenbank-Typen (Schritt 1)
 * =============================================================
 * Handgeschriebene Typen, die 1:1 zu den Migrationen unter
 * `supabase/migrations/20260731*.sql` passen:
 *
 *   - 20260731000000_roles_and_profiles.sql
 *   - 20260731000001_objects_and_object_items.sql
 *
 * Sobald die Supabase-CLI verfügbar ist, kann dieser Datei-Inhalt
 * durch `supabase gen types typescript --local` ersetzt werden –
 * das Shape (Database / Tables / Enums / Functions) bleibt gleich.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export type UserRole =
  | 'driver'
  | 'admin'
  | 'facility_manager'
  | 'substitute';

/**
 * Vertragsart: bestimmt die Soll-Wochenarbeitszeit (40/20/10 h);
 * `custom` = benutzerdefinierter Vertrag mit eigenen Sollstunden,
 * Arbeitstagen und Jahresurlaubstagen (weekly_target_hours & Co.).
 */
export type ContractType = 'full_time' | 'part_time' | 'mini_job' | 'custom';

/** Herkunft eines Zeiterfassungs-Eintrags (Stempeluhr vs. nachgereicht). */
export type TimeEntrySource = 'clock' | 'submitted';
export type ChatMessageKind = 'text' | 'image' | 'audio';
export type ChatMessageStatus = 'sent' | 'delivered' | 'read';

export const CONTRACT_TYPES: readonly ContractType[] = [
  'full_time',
  'part_time',
  'mini_job',
  'custom',
];

export type ObjectCategory = 'objekt' | 'treppenhaus';

/** 0 = Sonntag, 1 = Montag, ..., 6 = Samstag (Postgres/JS-Konvention) */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TourStatus = 'packing' | 'in_transit' | 'completed';

export const USER_ROLES: readonly UserRole[] = [
  'driver',
  'admin',
  'facility_manager',
  'substitute',
];

export const OBJECT_CATEGORIES: readonly ObjectCategory[] = [
  'objekt',
  'treppenhaus',
];

/* ------------------------------------------------------------------ */
/* Database (supabase-js kompatibles Shape)                            */
/* ------------------------------------------------------------------ */

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          role: UserRole;
          /** Login-E-Mail (Benutzername wird auf <name>@thiel.local gemappt). */
          email: string | null;
          created_at: string;
          updated_at: string;
          /** Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). */
          client_updated_at: string | null;
          /** Serverzeit des letzten Syncs. */
          synced_at: string | null;
          vacation_days_total: number;
          vacation_days_used: number;
          overtime_hours: number;
          /** Vertragsart (Vollzeit/Teilzeit/Minijob/Individuell) – Soll-Wochenarbeitszeit. */
          contract_type: ContractType;
          /** Wochen-Sollstunden fürs Überstundenkonto (Vertrag, z. B. 40). */
          weekly_target_hours: number;
          /** Geplante Arbeitstage pro Woche (z. B. 5). */
          working_days_per_week: number;
          /** Individuelle Jahresurlaubstage. Resturlaub = per_year - used. */
          vacation_days_per_year: number;
          chat_preferred_language: string | null;
          phone: string | null;
        };
        Insert: {
          id: string;
          name: string;
          role?: UserRole;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
          vacation_days_total?: number;
          vacation_days_used?: number;
          overtime_hours?: number;
          contract_type?: ContractType;
          weekly_target_hours?: number;
          working_days_per_week?: number;
          vacation_days_per_year?: number;
          chat_preferred_language?: string | null;
          phone?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          role?: UserRole;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
          vacation_days_total?: number;
          vacation_days_used?: number;
          overtime_hours?: number;
          contract_type?: ContractType;
          weekly_target_hours?: number;
          working_days_per_week?: number;
          vacation_days_per_year?: number;
          chat_preferred_language?: string | null;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
            referencedSchema: 'auth';
          },
        ];
      };
      company_settings: {
        Row: {
          id: boolean;
          support_phone_number: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          support_phone_number?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          support_phone_number?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_threads: {
        Row: {
          id: string;
          employee_id: string;
          admin_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          admin_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          admin_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          thread_id: string;
          sender_id: string;
          kind: ChatMessageKind;
          body: string | null;
          media_path: string | null;
          media_mime_type: string | null;
          transcript: string | null;
          is_urgent: boolean;
          status: ChatMessageStatus;
          delivered_at: string | null;
          read_at: string | null;
          understood_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          sender_id: string;
          kind?: ChatMessageKind;
          body?: string | null;
          media_path?: string | null;
          media_mime_type?: string | null;
          transcript?: string | null;
          is_urgent?: boolean;
          status?: ChatMessageStatus;
          delivered_at?: string | null;
          read_at?: string | null;
          understood_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          sender_id?: string;
          kind?: ChatMessageKind;
          body?: string | null;
          media_path?: string | null;
          media_mime_type?: string | null;
          transcript?: string | null;
          is_urgent?: boolean;
          status?: ChatMessageStatus;
          delivered_at?: string | null;
          read_at?: string | null;
          understood_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_translations: {
        Row: {
          id: string;
          message_id: string;
          language: string;
          translated_body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          language: string;
          translated_body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          language?: string;
          translated_body?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      time_entries: {
        Row: {
          id: string;
          user_id: string;
          clock_in: string;
          clock_out: string | null;
          break_duration_minutes: number;
          note: string | null;
          is_approved: boolean;
          /** true = prüfbedürftig (vergessene Ausstempelung / wartet auf Prüfung). */
          requires_review: boolean;
          /** Herkunft: clock = Stempeluhr, submitted = nachgereichte Arbeitszeit. */
          source: TimeEntrySource;
          created_at: string;
          updated_at: string;
          client_updated_at: string | null;
          synced_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          clock_in: string;
          clock_out?: string | null;
          break_duration_minutes?: number;
          note?: string | null;
          is_approved?: boolean;
          requires_review?: boolean;
          source?: TimeEntrySource;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          clock_in?: string;
          clock_out?: string | null;
          break_duration_minutes?: number;
          note?: string | null;
          is_approved?: boolean;
          requires_review?: boolean;
          source?: TimeEntrySource;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Relationships: [];
      };
      time_entry_audit_logs: {
        Row: {
          id: string;
          time_entry_id: string | null;
          changed_by_user_id: string | null;
          changed_at: string;
          old_values: Json | null;
          new_values: Json | null;
          change_reason: string | null;
        };
        Insert: {
          id?: string;
          time_entry_id?: string | null;
          changed_by_user_id?: string | null;
          changed_at?: string;
          old_values?: Json | null;
          new_values?: Json | null;
          change_reason?: string | null;
        };
        Update: {
          id?: string;
          time_entry_id?: string | null;
          changed_by_user_id?: string | null;
          changed_at?: string;
          old_values?: Json | null;
          new_values?: Json | null;
          change_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'time_entry_audit_logs_time_entry_id_fkey';
            columns: ['time_entry_id'];
            isOneToOne: false;
            referencedRelation: 'time_entries';
            referencedColumns: ['id'];
            referencedSchema: 'public';
          },
        ];
      };
      time_off_requests: {
        Row: {
          id: string;
          user_id: string;
          type: 'vacation' | 'sick_leave' | 'unpaid' | 'compensatory';
          start_date: string;
          end_date: string;
          status: 'pending' | 'approved' | 'rejected';
          reviewer_note: string | null;
          employee_note: string | null;
          substitute_id: string | null;
          substitute_request: boolean;
          substitute_kind: 'driver' | 'facility_manager' | null;
          substitute_object_id: string | null;
          created_at: string;
          updated_at: string;
          client_updated_at: string | null;
          synced_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'vacation' | 'sick_leave' | 'unpaid' | 'compensatory';
          start_date: string;
          end_date: string;
          status?: 'pending' | 'approved' | 'rejected';
          reviewer_note?: string | null;
          employee_note?: string | null;
          substitute_id?: string | null;
          substitute_request?: boolean;
          substitute_kind?: 'driver' | 'facility_manager' | null;
          substitute_object_id?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: 'vacation' | 'sick_leave' | 'unpaid' | 'compensatory';
          start_date?: string;
          end_date?: string;
          status?: 'pending' | 'approved' | 'rejected';
          reviewer_note?: string | null;
          employee_note?: string | null;
          substitute_id?: string | null;
          substitute_request?: boolean;
          substitute_kind?: 'driver' | 'facility_manager' | null;
          substitute_object_id?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'time_off_requests_substitute_id_fkey';
            columns: ['substitute_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
            referencedSchema: 'auth';
          },
          {
            foreignKeyName: 'time_off_requests_substitute_object_id_fkey';
            columns: ['substitute_object_id'];
            isOneToOne: false;
            referencedRelation: 'objects';
            referencedColumns: ['id'];
            referencedSchema: 'public';
          },
        ];
      };
      objects: {
        Row: {
          id: string;
          name: string;
          address: string;
          /** Breitengrad der per Geocoding verifizierten Adresse (oder null). */
          latitude: number | null;
          /** Längengrad der per Geocoding verifizierten Adresse (oder null). */
          longitude: number | null;
          category: ObjectCategory;
          /** Fußgängerzone: MUSS vor 11:00 Uhr angefahren werden. */
          is_pedestrian_zone_until_11: boolean;
          /** Schlüssel-Nummer des Objekts (z. B. 5). NULL = keine. */
          key_number: number | null;
          /** Öffnungszeit: DARF erst ab dieser Uhrzeit angefahren werden (z.B. 11:00). */
          opens_at: string | null;
          /** Kunde (Firma/Ansprechpartner) – nur für Admins sichtbar. */
          customer: string | null;
          /** Kundennummer – nur für Admins sichtbar. */
          customer_number: string | null;
          /** Reinigungsturnus (z. B. wöchentlich) – nur für Admins sichtbar. */
          cleaning_interval: string | null;
          /** Bemerkung zum Objekt – für alle sichtbar; nur Admins bearbeiten. */
          remark: string | null;
          /** Zeitpunkt der letzten erfolgreichen Belieferung (Tour-Abschluss). */
          last_delivery_at: string | null;
          /** Name des Fahrers, der zuletzt beliefert hat. */
          last_delivery_driver_name: string | null;
          /** JSON-Array der tatsächlich gelieferten Items inklusive Menge und Bemerkung. */
          last_delivery_items: Json | null;
          created_at: string;
          updated_at: string;
          /** Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). */
          client_updated_at: string | null;
          /** Serverzeit des letzten Syncs. */
          synced_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          address: string;
          latitude?: number | null;
          longitude?: number | null;
          category?: ObjectCategory;
          is_pedestrian_zone_until_11?: boolean;
          key_number?: number | null;
          opens_at?: string | null;
          customer?: string | null;
          customer_number?: string | null;
          cleaning_interval?: string | null;
          remark?: string | null;
          last_delivery_at?: string | null;
          last_delivery_driver_name?: string | null;
          last_delivery_items?: Json | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          address?: string;
          latitude?: number | null;
          longitude?: number | null;
          category?: ObjectCategory;
          is_pedestrian_zone_until_11?: boolean;
          key_number?: number | null;
          opens_at?: string | null;
          customer?: string | null;
          customer_number?: string | null;
          cleaning_interval?: string | null;
          remark?: string | null;
          last_delivery_at?: string | null;
          last_delivery_driver_name?: string | null;
          last_delivery_items?: Json | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Relationships: [];
      };
      object_assignments: {
        Row: {
          user_id: string;
          object_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          object_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          object_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'object_assignments_object_id_fkey';
            columns: ['object_id'];
            isOneToOne: false;
            referencedRelation: 'objects';
            referencedColumns: ['id'];
            referencedSchema: 'public';
          },
        ];
      };
      object_items: {
        Row: {
          id: string;
          object_id: string;
          item_name: string;
          /** Menge des Items, z. B. 60. */
          quantity: number;
          /** Bemerkung zum Item, z. B. "rot, gelb - kein blau". */
          note: string | null;
          /** Pfad des Item-Fotos im Storage-Bucket "item-photos" (oder null). */
          photo_path: string | null;
          /** true = Standard-Item, im Pack-/Tour-Modus fest angehakt & ausgegraut. */
          is_always_required: boolean;
          /** Einmalig für die nächste Belieferung vormerken (wird nach Belieferung zurückgesetzt). */
          is_reserved: boolean;
          created_at: string;
          updated_at: string;
          /** Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). */
          client_updated_at: string | null;
          /** Serverzeit des letzten Syncs. */
          synced_at: string | null;
        };
        Insert: {
          id?: string;
          object_id: string;
          item_name: string;
          quantity?: number;
          note?: string | null;
          photo_path?: string | null;
          is_always_required?: boolean;
          is_reserved?: boolean;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Update: {
          id?: string;
          object_id?: string;
          item_name?: string;
          quantity?: number;
          note?: string | null;
          photo_path?: string | null;
          is_always_required?: boolean;
          is_reserved?: boolean;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'object_items_object_id_fkey';
            columns: ['object_id'];
            isOneToOne: false;
            referencedRelation: 'objects';
            referencedColumns: ['id'];
            referencedSchema: 'public';
          },
        ];
      };
      inventory_items: {
        Row: {
          id: string;
          /** Bezeichnung des Items, z. B. "Micromops". */
          name: string;
          /** Anmerkung zum Item (z. B. "grün, blau, gelb, rot") oder null. */
          note: string | null;
          created_at: string;
          updated_at: string;
          /** Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). */
          client_updated_at: string | null;
          /** Serverzeit des letzten Syncs. */
          synced_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Relationships: [];
      };
      active_tours: {
        Row: {
          id: string;
          driver_id: string | null;
          date: string;
          status: TourStatus;
          start_time: string | null;
          /** Geplante Ankunft zurück im Lager (HH:MM) – beim Tourstart gesetzt. */
          warehouse_arrival: string | null;
          total_duration_minutes: number | null;
          created_at: string;
          updated_at: string;
          /** Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). */
          client_updated_at: string | null;
          /** Serverzeit des letzten Syncs. */
          synced_at: string | null;
        };
        Insert: {
          id?: string;
          driver_id?: string | null;
          date?: string;
          status?: TourStatus;
          start_time?: string | null;
          warehouse_arrival?: string | null;
          total_duration_minutes?: number | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Update: {
          id?: string;
          driver_id?: string | null;
          date?: string;
          status?: TourStatus;
          start_time?: string | null;
          warehouse_arrival?: string | null;
          total_duration_minutes?: number | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Relationships: [];
      };
      tour_stops: {
        Row: {
          id: string;
          tour_id: string;
          object_id: string | null;
          stop_order: number;
          arrival_time: string | null;
          is_delivered: boolean;
          /** Schlüsselnummer, die beim Start der Tour für diesen Stopp eingeplant war. */
          key_number: number | null;
          /** JSON-Liste der wählbaren Items für die nächste Belieferung. */
          next_delivery_items: Json;
          /** Temporäres Ziel: kein Objekt-/Item-Datensatz. */
          is_unknown: boolean;
          unknown_target_id: string | null;
          unknown_name: string | null;
          unknown_address: string | null;
          unknown_latitude: number | null;
          unknown_longitude: number | null;
          /** Snapshot der tatsächlich gelieferten Items dieses Stopps. */
          delivered_items: Json;
          /** true = Stopp konnte nicht beliefert werden (schließt is_delivered aus). */
          is_undeliverable: boolean;
          /** Optionaler Grund, warum der Stopp nicht beliefert werden konnte. */
          undeliverable_reason: string | null;
          created_at: string;
          updated_at: string;
          /** Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). */
          client_updated_at: string | null;
          /** Serverzeit des letzten Syncs. */
          synced_at: string | null;
        };
        Insert: {
          id?: string;
          tour_id: string;
          object_id?: string | null;
          stop_order: number;
          arrival_time?: string | null;
          is_delivered?: boolean;
          is_unknown?: boolean;
          unknown_target_id?: string | null;
          unknown_name?: string | null;
          unknown_address?: string | null;
          unknown_latitude?: number | null;
          unknown_longitude?: number | null;
          key_number?: number | null;
          next_delivery_items?: Json;
          delivered_items?: Json;
          is_undeliverable?: boolean;
          undeliverable_reason?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Update: {
          id?: string;
          tour_id?: string;
          object_id?: string | null;
          stop_order?: number;
          arrival_time?: string | null;
          is_delivered?: boolean;
          is_unknown?: boolean;
          unknown_target_id?: string | null;
          unknown_name?: string | null;
          unknown_address?: string | null;
          unknown_latitude?: number | null;
          unknown_longitude?: number | null;
          key_number?: number | null;
          next_delivery_items?: Json;
          delivered_items?: Json;
          is_undeliverable?: boolean;
          undeliverable_reason?: string | null;
          created_at?: string;
          updated_at?: string;
          client_updated_at?: string | null;
          synced_at?: string | null;
        };
        Relationships: [];
      };
      passkeys: {
        Row: {
          id: string;
          user_id: string;
          /** Base64URL-Credential-ID aus dem Authenticator. */
          credential_id: string;
          /** Base64URL-Public-Key (für die Assertion-Verifikation). */
          public_key: string;
          /** Zähler des Authenticators (Replay-Schutz). */
          counter: number;
          /** Vom Browser gemeldete Transports (usb, nfc, internal, ...). */
          transports: Json;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter?: number;
          transports?: Json;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          transports?: Json;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'passkeys_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
            referencedSchema: 'auth';
          },
        ];
      };
      webauthn_challenges: {
        Row: {
          id: string;
          /** Base64URL-Challenge aus den WebAuthn-Optionen. */
          challenge: string;
          /** NULL bei Login (purpose = 'authentication'). */
          user_id: string | null;
          purpose: 'registration' | 'authentication';
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          challenge: string;
          user_id?: string | null;
          purpose: 'registration' | 'authentication';
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          challenge?: string;
          user_id?: string | null;
          purpose?: 'registration' | 'authentication';
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webauthn_challenges_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
            referencedSchema: 'auth';
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * Aktuelle Rolle des angemeldeten Nutzers (RLS-Helfer).
       * Gibt NULL zurück, wenn kein Nutzer angemeldet ist.
       */
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: UserRole | null;
      };
      /**
       * Markiert überfällige offene Stempelungen (12 h überschritten ODER
       * Mitternacht erreicht) als prüfbedürftig (requires_review = true,
       * is_approved = false). Gibt die Anzahl markierter Einträge zurück.
       */
      flag_overdue_time_entries: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
    };
    Enums: {
      user_role: UserRole;
      contract_type: ContractType;
      time_entry_source: TimeEntrySource;
      time_off_type: 'vacation' | 'sick_leave' | 'unpaid' | 'compensatory';
      time_off_status: 'pending' | 'approved' | 'rejected';
      object_category: ObjectCategory;
      tour_status: TourStatus;
      chat_message_kind: ChatMessageKind;
      chat_message_status: ChatMessageStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

/* ------------------------------------------------------------------ */
/* Bequeme Row/Insert/Update-Typen                                    */
/* ------------------------------------------------------------------ */

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type Profile = Tables<'profiles'>;
export type TimeEntryRecord = Tables<'time_entries'>;
export type TimeOffRequestRecord = Tables<'time_off_requests'>;
export type ObjectRecord = Tables<'objects'>;
export type ObjectAssignment = Tables<'object_assignments'>;
export type ObjectItem = Tables<'object_items'>;
export type InventoryItem = Tables<'inventory_items'>;
export type Passkey = Tables<'passkeys'>;
export type WebauthnChallenge = Tables<'webauthn_challenges'>;

export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
export type ObjectInsert = Database['public']['Tables']['objects']['Insert'];
export type ObjectUpdate = Database['public']['Tables']['objects']['Update'];
export type ObjectItemInsert =
  Database['public']['Tables']['object_items']['Insert'];
export type ObjectItemUpdate =
  Database['public']['Tables']['object_items']['Update'];
export type InventoryItemInsert =
  Database['public']['Tables']['inventory_items']['Insert'];
export type InventoryItemUpdate =
  Database['public']['Tables']['inventory_items']['Update'];
