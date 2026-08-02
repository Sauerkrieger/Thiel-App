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
  /** Koordinaten des Stopps, wie sie für die Route verwendet wurden (null im Demo-Modus). */
  latitude: number | null;
  longitude: number | null;
};

/** Antwort von POST /api/planning/optimize. */
export type RouteOptimizationResult = {
  mode: "ors-optimization" | "ors-matrix" | "google-matrix" | "haversine";
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
  /** Live-Verkehrsanbieter, dessen Fahrzeitmatrix in die Optimierung eingeflossen ist (null = ohne). */
  traffic_matrix_provider: "tomtom" | null;
  /** Lager (Start/Ziel der Rundtour) mit verifizierten Koordinaten (null im Demo-Modus). */
  warehouse: {
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
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
    latitude: number | null;
    longitude: number | null;
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
  /** Lager (Start/Ziel) mit verifizierten Koordinaten für die Kartenanzeige (null, wenn nicht auflösbar). */
  warehouse: {
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
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
/* Foto-Import: Objekte (Schritt 8)                                    */
/* ------------------------------------------------------------------ */

/** Vom OCR erkanntes Objekt für die Vorauswahl (noch nicht angelegt). */
export type ObjectImportPreviewEntry = {
  name: string;
  address: string;
  category: ObjectCategory;
  is_pedestrian_zone_until_11: boolean;
  opens_at: string | null;
  /** true, wenn die Adresse bereits in der DB existiert (Duplikat). */
  is_duplicate: boolean;
  /** Koordinaten des ORS-Treffers (wenn die Adresse verifiziert wurde). */
  latitude: number | null;
  longitude: number | null;
  /** Ob ORS die Adresse auflösen konnte. */
  geocoding_status: "ok" | "not_found";
};

/** Antwort von POST /api/objects/import/objects/analyze. */
export type ObjectImportPreview = {
  objects: ObjectImportPreviewEntry[];
};

/** Bestätigtes Objekt für POST /api/objects/import/objects. */
export type ObjectImportInput = {
  name: string;
  address: string;
  category: ObjectCategory;
  is_pedestrian_zone_until_11: boolean;
  opens_at: string | null;
  /** Koordinaten (falls vorhanden; sonst geocodiert der Server nach). */
  latitude: number | null;
  longitude: number | null;
};

/* ------------------------------------------------------------------ */
/* Foto-Import: Schlüssel & Items (Schritt 8)                          */
/* ------------------------------------------------------------------ */

/** Vom OCR erkannte Schlüssel-Zuordnung (noch nicht bestätigt). */
export type KeyImportEntry = {
  /** Name wie auf dem Zettel (kann abgekürzt sein). */
  name: string | null;
  key_number: number;
};

/** Schlüssel-Zuordnung zu einem bestehenden Objekt (Vorauswahl). */
export type KeyImportMatch = {
  object_id: string;
  object_name: string;
  address: string;
  key_number: number;
  /** true, wenn das Objekt bereits eine Schlüsselnummer hat. */
  already_has_key: boolean;
};

/** Schlüssel-Eintrag, dessen Objekt nicht existiert. */
export type KeyImportUnmatched = KeyImportEntry;

/** Objektoption für die Zuordnung (Dropdown in der Vorauswahl). */
export type KeyImportObject = {
  id: string;
  name: string;
  address: string;
  key_number: number | null;
};

/** Antwort von POST /api/objects/import/keys/analyze. */
export type KeyImportPreview = {
  matches: KeyImportMatch[];
  unmatched: KeyImportUnmatched[];
  /** Alle Objekte, damit die Zuordnung in der Vorauswahl änderbar ist. */
  objects: KeyImportObject[];
};

/** Ergebnis nach dem Bestätigen von POST /api/objects/import/keys. */
export type KeyImportResult = {
  assigned: number;
  already_had_key: number;
  not_found: number;
  /** Anzahl neu angelegter Objekte (aus „Objekt nicht gefunden“-Einträgen). */
  new_objects_created: number;
};

/** Vom OCR erkannte Items-Gruppe (Objekt-Hinweis + Items). */
export type ItemGroupImportEntry = {
  name: string | null;
  address: string | null;
  items: {
    item_name: string;
    quantity: number;
    note: string | null;
  }[];
};

/** Items-Gruppe zugeordnet zu einem bestehenden Objekt (Vorauswahl). */
export type ItemGroupImportMatch = {
  object_id: string;
  object_name: string;
  address: string | null;
  matched_by: "adresse" | "name";
  items: {
    item_name: string;
    quantity: number;
    note: string | null;
  }[];
};

/** Items-Gruppe, deren Objekt nicht existiert. */
export type ItemGroupImportUnmatched = ItemGroupImportEntry;

/** Antwort von POST /api/objects/import/items/analyze. */
export type ItemGroupImportPreview = {
  matches: ItemGroupImportMatch[];
  unmatched: ItemGroupImportUnmatched[];
};

/** Ergebnis nach dem Bestätigen von POST /api/objects/import/items. */
export type ItemGroupImportResult = {
  assigned: number;
  items_added: number;
  not_found: number;
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
