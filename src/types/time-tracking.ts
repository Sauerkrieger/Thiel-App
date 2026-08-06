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
  created_at: string;
  updated_at: string;
  client_updated_at: string | null;
  synced_at: string | null;
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
