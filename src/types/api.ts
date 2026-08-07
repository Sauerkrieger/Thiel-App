import type {
  DayOfWeek,
  ObjectCategory,
  ObjectItem,
  ObjectRecord,
  UserRole,
} from "./database";

/** Snapshot eines tatsächlich gelieferten Items. */
export type DeliveredItem = {
  item_name: string;
  quantity: number;
  note: string | null;
};

/** Objekt inkl. zugehöriger Items (für die Objektübersicht). */
export type ObjectWithItems = ObjectRecord & {
  object_items: ObjectItem[];
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
  | "remark"
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
  /** Bemerkung zum Objekt (für alle sichtbar). */
  remark: string | null;
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
  /** Dauer der Vorbereitung am Lager (3 Min/Stopp + 5 Min Schlüssel). */
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
  key_number: number | null;
  next_delivery_items: DeliveryItem[];
  delivered_items: DeliveredItem[];
  object: {
    id: string;
    name: string;
    address: string;
    category: ObjectCategory;
    latitude: number | null;
    longitude: number | null;
    /** Bemerkung zum Objekt (für alle sichtbar). */
    remark: string | null;
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
  /** Zugewiesene Objekte (nur bei Reinigungskräften gefüllt). */
  object_ids: string[];
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
};

/**
 * Items-Gruppe, die immer als neues Objekt angelegt wird. Ein ähnlicher
 * bestehender Datensatz wird nur als Warnung zurückgegeben und nie geändert.
 */
export type ItemGroupImportUnmatched = {
  name: string | null;
  /** Beste bekannte Adresse (Geocoding-Treffer oder vom Zettel); null = keine. */
  address: string | null;
  city: string | null;
  /** Optionaler ähnlicher Bestandstreffer – nur Hinweis, keine Zuordnung. */
  similar_object: {
    name: string;
    address: string;
    matched_by: "adresse" | "name";
  } | null;
  /** Kategorie des neuen Objekts (Treppenhaus bei nur-Adresse-Objekt-Zelle). */
  category: ObjectCategory;
  customer: string | null;
  customer_number: string | null;
  cleaning_interval: string | null;
  items: {
    item_name: string;
    quantity: number;
    note: string | null;
    /** true = Standard-Item (bei jeder Belieferung fest vorgesehen). */
    is_always_required: boolean;
  }[];
  /** Koordinaten des Geocoding-Treffers (null = nicht auflösbar). */
  latitude: number | null;
  longitude: number | null;
  /** Ob eine exakte Adresse mit Hausnummer vorliegt. */
  geocoding_status: "ok" | "not_found";
};

/** Antwort von POST /api/objects/import/items/analyze. */
export type ItemGroupImportPreview = {
  /** Kept for response compatibility; item import never populates this. */
  matches: never[];
  unmatched: ItemGroupImportUnmatched[];
};

/** Neu anzulegendes Objekt mit Items. Bestehende Objekte werden nie editiert. */
export type ItemGroupImportNewObject = {
  name: string;
  /** Exakte Adresse mit Hausnummer (Pflicht). */
  address: string;
  latitude: number | null;
  longitude: number | null;
  category: ObjectCategory;
  customer: string | null;
  customer_number: string | null;
  cleaning_interval: string | null;
  /** Nur zur Anzeige in der Vorschau; niemals eine bestehende Zuordnung. */
  similar_object?: {
    name: string;
    address: string;
    matched_by: "adresse" | "name";
  } | null;
  items: {
    item_name: string;
    quantity: number;
    note: string | null;
    /** true = Standard-Item (bei jeder Belieferung fest vorgesehen). */
    is_always_required: boolean;
  }[];
};

/** Ergebnis nach dem Bestätigen von POST /api/objects/import/items. */
export type ItemGroupImportResult = {
  /** Anzahl der neu angelegten Objekte mit erfolgreich eingefügten Items. */
  assigned: number;
  items_added: number;
  /** Legacy-Feld; beim Neuanlagen-Import immer 0. */
  not_found: number;
  /** Anzahl neu angelegter Objekte. */
  new_objects_created: number;
  /** Neue Objekte, die wegen fehlender Pflichtdaten übersprungen wurden. */
  new_objects_skipped: number;
  /** Objekte, bei denen ein ähnlicher Bestandstreffer erkannt wurde. */
  duplicate_warnings: number;
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
  /** Adressen der belieferten Objekte (parallel zu delivered_objects). */
  delivered_addresses: string[];
  /** Kunden/Ansprechpartner der belieferten Objekte (parallel zu delivered_objects). */
  delivered_customers: string[];
  /** Anzahl der belieferten Stopps. */
  delivered_count: number;
  /** Gesamtzahl der Stopps. */
  total_stops: number;
  /** Schlüsselnummern, die für diese Tour eingeplant waren. */
  key_numbers: number[];
};

/** Antwort von GET /api/tours (Historie). */
export type TourHistoryResponse = {
  tours: TourHistoryItem[];
};
