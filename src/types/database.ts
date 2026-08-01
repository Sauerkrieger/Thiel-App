/**
 * Thiel Dienstleistungen – Supabase Datenbank-Typen (Schritt 1)
 * =============================================================
 * Handgeschriebene Typen, die 1:1 zu den Migrationen unter
 * `supabase/migrations/20260731*.sql` passen:
 *
 *   - 20260731000000_roles_and_profiles.sql
 *   - 20260731000001_objects_and_object_items.sql
 *   - 20260731000002_weekly_default_routes.sql
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

export type UserRole = 'driver' | 'admin' | 'facility_manager';

export type ObjectCategory = 'objekt' | 'treppenhaus';

/** 0 = Sonntag, 1 = Montag, ..., 6 = Samstag (Postgres/JS-Konvention) */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TourStatus = 'packing' | 'in_transit' | 'completed';

export const USER_ROLES: readonly UserRole[] = [
  'driver',
  'admin',
  'facility_manager',
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
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
          created_at: string;
          updated_at: string;
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
          created_at?: string;
          updated_at?: string;
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
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
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
          created_at: string;
        };
        Insert: {
          id?: string;
          object_id: string;
          item_name: string;
          quantity?: number;
          note?: string | null;
          photo_path?: string | null;
          is_always_required?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          object_id?: string;
          item_name?: string;
          quantity?: number;
          note?: string | null;
          photo_path?: string | null;
          is_always_required?: boolean;
          created_at?: string;
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
      active_tours: {
        Row: {
          id: string;
          driver_id: string | null;
          date: string;
          status: TourStatus;
          start_time: string | null;
          total_duration_minutes: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id?: string | null;
          date?: string;
          status?: TourStatus;
          start_time?: string | null;
          total_duration_minutes?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string | null;
          date?: string;
          status?: TourStatus;
          start_time?: string | null;
          total_duration_minutes?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tour_stops: {
        Row: {
          id: string;
          tour_id: string;
          object_id: string;
          stop_order: number;
          arrival_time: string | null;
          is_delivered: boolean;
          /** JSON-Liste der wählbaren Items für die nächste Belieferung. */
          next_delivery_items: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          object_id: string;
          stop_order: number;
          arrival_time?: string | null;
          is_delivered?: boolean;
          next_delivery_items?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          object_id?: string;
          stop_order?: number;
          arrival_time?: string | null;
          is_delivered?: boolean;
          next_delivery_items?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      weekly_default_routes: {
        Row: {
          id: string;
          /** 0 = Sonntag, 1 = Montag, ..., 6 = Samstag. */
          day_of_week: DayOfWeek;
          object_id: string;
          /** Reihenfolge der Objekte in der Standard-Route des Wochentags. */
          selection_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          day_of_week: DayOfWeek;
          object_id: string;
          selection_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          day_of_week?: DayOfWeek;
          object_id?: string;
          selection_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'weekly_default_routes_object_id_fkey';
            columns: ['object_id'];
            isOneToOne: false;
            referencedRelation: 'objects';
            referencedColumns: ['id'];
            referencedSchema: 'public';
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
       * Ersetzt die Objektauswahl eines Wochentags transaktional
       * (selection_order folgt der Reihenfolge der übergebenen IDs).
       */
      save_weekly_defaults: {
        Args: { p_day_of_week: number; p_object_ids: string[] };
        Returns: undefined;
      };
    };
    Enums: {
      user_role: UserRole;
      object_category: ObjectCategory;
      tour_status: TourStatus;
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
export type ObjectRecord = Tables<'objects'>;
export type ObjectItem = Tables<'object_items'>;
export type WeeklyDefaultRoute = Tables<'weekly_default_routes'>;

export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
export type ObjectInsert = Database['public']['Tables']['objects']['Insert'];
export type ObjectUpdate = Database['public']['Tables']['objects']['Update'];
export type ObjectItemInsert =
  Database['public']['Tables']['object_items']['Insert'];
export type ObjectItemUpdate =
  Database['public']['Tables']['object_items']['Update'];
export type WeeklyDefaultRouteInsert =
  Database['public']['Tables']['weekly_default_routes']['Insert'];
export type WeeklyDefaultRouteUpdate =
  Database['public']['Tables']['weekly_default_routes']['Update'];
