export type TimeOffType =
  | "vacation"
  | "sick_leave"
  | "unpaid"
  | "compensatory";

export type TimeOffStatus = "pending" | "approved" | "rejected";

export interface TimeEntry {
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
  source: "clock" | "submitted";
  created_at: string;
  updated_at: string;
  client_updated_at: string | null;
  synced_at: string | null;
}

export interface TimeEntryAuditLog {
  id: string;
  time_entry_id: string | null;
  changed_by_user_id: string | null;
  changed_at: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  change_reason: string | null;
  /** UI-Anreicherung: Name des Bearbeiters (aus profiles gejoint). */
  changed_by_name?: string | null;
}

export interface TimeOffRequest {
  id: string;
  user_id: string;
  type: TimeOffType;
  start_date: string;
  end_date: string;
  status: TimeOffStatus;
  reviewer_note: string | null;
  employee_note: string | null;
  created_at: string;
  updated_at: string;
  client_updated_at: string | null;
  synced_at: string | null;
}

export type ClockAction = "clock_in" | "clock_out";

export type ClockRequest = {
  action: ClockAction;
  client_updated_at?: string | null;
  break_duration_minutes?: number;
  note?: string | null;
};

export type ClockResponse = {
  entry: TimeEntry | null;
};
