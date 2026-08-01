import type {
  DayOfWeek,
  ObjectCategory,
  ObjectItem,
  ObjectRecord,
  UserRole,
} from "./database";

/** Objekt inkl. zugehöriger Items (für die Objektübersicht). */
export type ObjectWithItems = ObjectRecord & {
  object_items: ObjectItem[];
};

export type ImportDuplicate = {
  /** Vom OCR erkannte Adresse */
  address: string;
  /** Bereits vorhandenes Objekt, das gematcht wurde */
  matched: string;
};

export type ImportResult = {
  total: number;
  created: ObjectRecord[];
  duplicates: ImportDuplicate[];
  errors: string[];
};

/** Einheitliches Fehlerformat der API-Routen. */
export type ApiError = {
  code?: string;
  message: string;
};

/* ------------------------------------------------------------------ */
/* Tourenplanung (Schritt 3)                                            */
/* ------------------------------------------------------------------ */

/** Für die Tourenplanung relevante Objektfelder. */
export type PlanningObject = Pick<
  ObjectRecord,
  | "id"
  | "name"
  | "address"
  | "category"
  | "is_pedestrian_zone_until_11"
  | "opens_at"
>;

/** Antwort von GET /api/planning. */
export type PlanningData = {
  day_of_week: DayOfWeek;
  objects: PlanningObject[];
  selected_ids: string[];
  /** Zeitpunkt der letzten Speicherung der Vorauswahl (oder null). */
  defaults_updated_at: string | null;
};

/** Per Foto-Erkennung zugeordnetes Objekt. */
export type PhotoMatch = {
  object_id: string;
  name: string;
  address: string;
  matched_by: "adresse" | "name";
};

/** Erkannter Eintrag, der keinem Objekt zugeordnet werden konnte. */
export type PhotoUnmatched = {
  name: string | null;
  address: string | null;
};

/** Antwort von POST /api/planning/photo. */
export type PhotoSelectResult = {
  matches: PhotoMatch[];
  unmatched: PhotoUnmatched[];
};

/* ------------------------------------------------------------------ */
/* Routen-Optimierung & Pack-Modus (Schritt 4)                         */
/* ------------------------------------------------------------------ */

/** Sortierter Stopp der optimierten Rundtour. */
export type OptimizedStop = {
  object_id: string;
  name: string;
  address: string;
  arrival: string;
  departure: string;
  is_pedestrian_zone_until_11: boolean;
  key_number: number | null;
  opens_at: string | null;
  /** true, wenn der Stopp über einen befahrbaren Punkt außerhalb der Fußgängerzone angefahren wird. */
  approach_by_foot: boolean;
  /** Fußweg vom befahrbaren Punkt zum Objekt in Metern (nur bei approach_by_foot). */
  walking_distance_m: number | null;
};

/** Antwort von POST /api/planning/optimize. */
export type RouteOptimizationResult = {
  mode: "openrouteservice" | "google" | "haversine";
  /** Vom Nutzer gewählte Startzeit = Abfahrtszeit (Beginn der Tour). */
  start_time: string;
  /** Dauer der Vorbereitung am Lager (5 Min/Stopp + 5 Min Schlüssel). */
  prep_duration_minutes: number;
  /** Beginn der Vorbereitung am Lager (start_time − Vorbereitungszeit). */
  prep_begin: string;
  /** Tatsächlicher Abfahrtszeitpunkt (= start_time). */
  departure_time: string;
  stops: OptimizedStop[];
  total_duration_minutes: number;
  warehouse_arrival: string;
  warnings: string[];
};

/** Für die nächste Belieferung vorgemerktes Item (Name + optionale Bemerkung). */
export type DeliveryItem = {
  item_name: string;
  /** Optionale Bemerkung, die nur in der nächsten Tour angezeigt wird. */
  note: string | null;
};

/** Pack-Info eines Objekts (Standard-Items + Extra-Items der letzten Tour). */
export type PackInfo = {
  items: ObjectItem[];
  previous_extras: DeliveryItem[];
};

/** Tour-Stopp inkl. Objekt-Details (GET /api/tours/[id]). */
export type TourStopWithObject = {
  id: string;
  stop_order: number;
  arrival_time: string | null;
  is_delivered: boolean;
  next_delivery_items: DeliveryItem[];
  object: {
    id: string;
    name: string;
    address: string;
    category: ObjectCategory;
  };
};

/** Antwort von GET /api/tours/[id]. */
export type TourWithStops = {
  id: string;
  driver_id: string | null;
  date: string;
  status: "packing" | "in_transit" | "completed";
  start_time: string | null;
  total_duration_minutes: number | null;
  created_at: string;
  tour_stops: TourStopWithObject[];
};

/* ------------------------------------------------------------------ */
/* Auth & Benutzerverwaltung (Schritt 6)                               */
/* ------------------------------------------------------------------ */

/** Angemeldeter Nutzer (Login-Kennung + Profil). */
export type AuthUser = {
  id: string;
  /** Login-E-Mail (Benutzername wird auf <name>@thiel.local gemappt). */
  email: string | null;
  /** Anzeigename (z. B. "Leon"). */
  name: string;
  role: UserRole;
  /** Fürs UI abgeleiteter Benutzername (Local-Part der E-Mail). */
  username: string;
};

/** Antwort von POST /api/auth/login, GET /api/auth/me. */
export type AuthResponse = {
  user: AuthUser;
};

/** Passkey-Datensatz für die Einstellungen. */
export type PasskeyInfo = {
  id: string;
  created_at: string;
  last_used_at: string | null;
};

/** Nutzerzeile in der Benutzerverwaltung (Admin). */
export type UserListItem = AuthUser & {
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* Tourenhistorie (Schritt 7)                                          */
/* ------------------------------------------------------------------ */

/** Ein Eintrag der Tourenhistorie (abgeschlossene/alle Touren). */
export type TourHistoryItem = {
  id: string;
  date: string;
  status: "packing" | "in_transit" | "completed";
  start_time: string | null;
  /** Name der Person, die die Tour geplant/gefahren hat. */
  driver_name: string | null;
  /** Namen der belieferten Objekte. */
  delivered_objects: string[];
  /** Anzahl der belieferten Stopps. */
  delivered_count: number;
  /** Gesamtzahl der Stopps. */
  total_stops: number;
};

/** Antwort von GET /api/tours (Historie). */
export type TourHistoryResponse = {
  tours: TourHistoryItem[];
};
