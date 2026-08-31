"use client";

import { useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Filter, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { TimeOffRequest, TimeOffType } from "@/types/time-tracking";

type Employee = { id: string; name: string; role: string };
type RequestWithProfile = TimeOffRequest & { profiles?: { name?: string; role?: string } | null };
type CalendarProps = {
  employees: Employee[];
  requests: RequestWithProfile[];
  /** Wird beim Klick auf ein Ereignis mit der zugehörigen Antrags-Id aufgerufen. */
  onEditRequest?: (requestId: string) => void;
};
type EventType = TimeOffType | "substitute";
type CalendarEvent = {
  id: string;
  /** Antrags-Id des zugrunde liegenden Abwesenheitsantrags (auch für Vertretungs-Ereignisse). */
  requestId: string;
  employeeId: string;
  type: EventType;
  title: string;
  start: string;
  end: string;
  status: "pending" | "approved";
};

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const TYPE_LABELS: Record<EventType, string> = {
  vacation: "Urlaub",
  sick_leave: "Krankmeldung",
  compensatory: "Freizeitausgleich",
  unpaid: "Unbezahlte Abwesenheit",
  substitute: "Vertretung",
};
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  driver: "Fahrer",
  facility_manager: "Reinigungskraft",
  substitute: "Springer",
};
const EVENT_STYLES: Record<EventType, { color: string; border: string; dot: string }> = {
  vacation: { color: "bg-emerald-500", border: "border-emerald-700", dot: "bg-emerald-500" },
  sick_leave: { color: "bg-orange-500", border: "border-orange-700", dot: "bg-orange-500" },
  compensatory: { color: "bg-blue-500", border: "border-blue-700", dot: "bg-blue-500" },
  unpaid: { color: "bg-stone-700", border: "border-stone-900", dot: "bg-stone-700" },
  substitute: { color: "bg-violet-600", border: "border-violet-800", dot: "bg-violet-600" },
};

function dateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}
function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}
function formatDay(date: Date): string {
  return date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}
function formatMonth(date: Date): string {
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
function shortRange(event: CalendarEvent): string {
  return event.start === event.end ? event.start.slice(8, 10) + "." : `${event.start.slice(8, 10)}.–${event.end.slice(8, 10)}.`;
}

function toggleValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function MultiFilter({
  label,
  options,
  selected,
  onToggle,
  onSelectAll,
  searchPlaceholder,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const allSelected = options.length > 0 && selected.size === options.length;
  const visibleOptions = searchPlaceholder
    ? options.filter((option) => option.label.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")))
    : options;
  return (
    <details className="relative min-w-[180px]">
      <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm shadow-sm">
        <span className="flex items-center gap-2"><Filter className="h-3.5 w-3.5 text-muted-foreground" />{label}</span>
        <span className="text-xs text-muted-foreground">{selected.size}/{options.length}</span>
      </summary>
      <div className="absolute left-0 top-10 z-40 max-h-72 min-w-full overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
        {searchPlaceholder ? <div className="relative mb-1.5"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="h-8 rounded border bg-background pl-7 pr-2 text-xs" /></div> : null}
        <button type="button" className="mb-1 w-full rounded px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-accent" onClick={onSelectAll}>
          {allSelected ? "Alle abwählen" : "Alle auswählen"}
        </button>
        {visibleOptions.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
            <Checkbox checked={selected.has(option.value)} onCheckedChange={() => onToggle(option.value)} />
            <span className="whitespace-nowrap">{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function EventPill({ event, employeeName, compact = false, onClick }: { event: CalendarEvent; employeeName?: string; compact?: boolean; onClick?: () => void }) {
  const style = EVENT_STYLES[event.type];
  const pending = event.status === "pending";
  const title = `${employeeName ? `${employeeName} · ` : ""}${event.title} · ${pending ? "Beantragt" : "Genehmigt"}${onClick ? " · Klick zum Bearbeiten" : ""}`;
  const className = `flex min-w-0 items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] leading-tight text-white ${style.color} ${style.border} ${pending ? "border-dashed opacity-60 grayscale-[15%]" : ""}${onClick ? " w-full cursor-pointer text-left transition-opacity hover:opacity-90" : ""}`;
  const content = <>
    <span className="min-w-0 truncate font-medium">{compact ? event.title : employeeName ? `${employeeName} · ${event.title}` : event.title}</span>
    {!compact ? <span className="shrink-0 opacity-80">{shortRange(event)}</span> : null}
  </>;
  if (onClick) {
    return <button type="button" title={title} className={className} onClick={onClick}>{content}</button>;
  }
  return <div title={title} className={className}>{content}</div>;
}

export function AbsenceCalendar({ employees, requests, onEditRequest }: CalendarProps) {
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [types, setTypes] = useState<Set<string>>(() => new Set(Object.keys(TYPE_LABELS)));
  const [roles, setRoles] = useState<Set<string>>(() => new Set(employees.map((employee) => employee.role)));
  const [employeeIds, setEmployeeIds] = useState<Set<string>>(() => new Set(employees.map((employee) => employee.id)));

  const roleOptions = useMemo(() => [...new Set(employees.map((employee) => employee.role))].sort().map((role) => ({ value: role, label: ROLE_LABELS[role] ?? role })), [employees]);
  const employeeOptions = useMemo(() => [...employees].sort((a, b) => a.name.localeCompare(b.name, "de")).map((employee) => ({ value: employee.id, label: employee.name })), [employees]);
  const typeOptions = useMemo(() => Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })), []);

  const events = useMemo<CalendarEvent[]>(() => {
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    const result: CalendarEvent[] = [];
    for (const request of requests) {
      if (request.status === "rejected") continue;
      const owner = byId.get(request.user_id);
      if (owner) result.push({ id: request.id, requestId: request.id, employeeId: owner.id, type: request.type, title: TYPE_LABELS[request.type], start: request.start_date, end: request.end_date, status: request.status });
      if (request.substitute_id) {
        const substitute = byId.get(request.substitute_id);
        if (substitute) result.push({ id: `${request.id}-substitute`, requestId: request.id, employeeId: substitute.id, type: "substitute", title: `Vertretung: ${owner?.name ?? "Mitarbeiter"}`, start: request.start_date, end: request.end_date, status: request.status });
      }
    }
    return result;
  }, [employees, requests]);

  const filteredEmployees = useMemo(() => employees.filter((employee) => roles.has(employee.role) && employeeIds.has(employee.id)), [employees, roles, employeeIds]);
  const filteredEvents = useMemo(() => events.filter((event) => {
    const employee = employees.find((item) => item.id === event.employeeId);
    return Boolean(employee && types.has(event.type) && roles.has(employee.role) && employeeIds.has(employee.id));
  }), [events, employees, types, roles, employeeIds]);

  const days = useMemo(() => {
    if (view === "week") return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const mondayOffset = (first.getDay() || 7) - 1;
    const gridStart = addDays(first, -mondayOffset);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [cursor, view]);

  function shiftCursor(direction: number) {
    setCursor((current) => view === "month" ? new Date(current.getFullYear(), current.getMonth() + direction, 1) : addDays(current, direction * 7));
  }
  function resetToToday() {
    const today = new Date();
    setCursor(view === "month" ? new Date(today.getFullYear(), today.getMonth(), 1) : today);
  }
  function eventsForDay(day: Date, employeeId?: string) {
    const value = dateValue(day);
    return filteredEvents.filter((event) => (!employeeId || event.employeeId === employeeId) && event.start <= value && event.end >= value);
  }

  const heading = view === "month" ? formatMonth(cursor) : `${formatDay(days[0])} – ${formatDay(days[6])}`;
  const selectedCount = filteredEvents.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => shiftCursor(-1)} title="Vorheriger Zeitraum" aria-label="Vorheriger Zeitraum"><ChevronLeft /></Button>
          <Button type="button" variant="outline" size="sm" onClick={resetToToday}>Heute</Button>
          <Button type="button" variant="outline" size="icon" onClick={() => shiftCursor(1)} title="Nächster Zeitraum" aria-label="Nächster Zeitraum"><ChevronRight /></Button>
          <h3 className="ml-1 min-w-48 text-lg font-semibold capitalize">{heading}</h3>
        </div>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Kalenderansicht">
          <Button type="button" size="sm" variant={view === "month" ? "secondary" : "ghost"} onClick={() => setView("month")}><CalendarRange /> Monat</Button>
          <Button type="button" size="sm" variant={view === "week" ? "secondary" : "ghost"} onClick={() => setView("week")}><List /> Woche</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <MultiFilter label="Abwesenheitstypen" options={typeOptions} selected={types} onToggle={(value) => setTypes((current) => toggleValue(current, value))} onSelectAll={() => setTypes((current) => current.size === typeOptions.length ? new Set() : new Set(typeOptions.map((option) => option.value)))} />
        <MultiFilter label="Rollen" options={roleOptions} selected={roles} onToggle={(value) => setRoles((current) => toggleValue(current, value))} onSelectAll={() => setRoles((current) => current.size === roleOptions.length ? new Set() : new Set(roleOptions.map((option) => option.value)))} />
        <MultiFilter label="Mitarbeiter" options={employeeOptions} selected={employeeIds} onToggle={(value) => setEmployeeIds((current) => toggleValue(current, value))} onSelectAll={() => setEmployeeIds((current) => current.size === employeeOptions.length ? new Set() : new Set(employeeOptions.map((option) => option.value)))} searchPlaceholder="Mitarbeiter suchen" />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {Object.entries(TYPE_LABELS).map(([type, label]) => <span key={type} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${EVENT_STYLES[type as EventType].dot}`} />{label}</span>)}
        <span className="border-l pl-4">Gestrichelt = beantragt</span>
        <span>Vollfarbig = genehmigt</span>
      </div>

      {filteredEmployees.length === 0 ? <p className="rounded-md border p-6 text-sm text-muted-foreground">Keine Mitarbeiter für die gewählten Filter.</p> : view === "month" ? (
        <div className="overflow-x-auto rounded-md border bg-background">
          <div className="min-w-[760px]">
            <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
              {WEEKDAYS.map((day) => <div key={day} className="border-r px-2 py-2 text-center text-xs font-semibold text-muted-foreground last:border-r-0">{day}</div>)}
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
              {days.map((day) => {
                const dayEvents = eventsForDay(day);
                return <div key={dateValue(day)} className={`min-h-32 border-b border-r p-1.5 last:border-r-0 ${day.getMonth() !== cursor.getMonth() ? "bg-muted/10" : ""}`}><div className={`mb-1 text-right text-xs font-semibold ${day.getMonth() !== cursor.getMonth() ? "text-muted-foreground/50" : "text-foreground"}`}>{day.getDate()}</div><div className="space-y-1">{dayEvents.map((event) => <EventPill key={event.id} event={event} employeeName={employees.find((employee) => employee.id === event.employeeId)?.name} onClick={onEditRequest ? () => onEditRequest(event.requestId) : undefined} />)}</div></div>;
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-background">
          <div className="min-w-[760px]">
            <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: "minmax(150px, 1.25fr) repeat(7, minmax(0, 1fr))" }}>
              <div className="border-r px-2 py-2 text-xs font-semibold text-muted-foreground">Mitarbeiter</div>
              {days.map((day) => <div key={dateValue(day)} className="border-r px-2 py-2 text-center text-xs font-semibold text-muted-foreground last:border-r-0">{formatDay(day)}</div>)}
            </div>
            {filteredEmployees.map((employee) => <div key={employee.id} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: "minmax(150px, 1.25fr) repeat(7, minmax(0, 1fr))" }}><div className="min-w-0 border-r px-2 py-2"><p className="truncate text-sm font-medium">{employee.name}</p><p className="truncate text-xs text-muted-foreground">{ROLE_LABELS[employee.role] ?? employee.role}</p></div>{days.map((day) => <div key={dateValue(day)} className="min-h-24 border-r p-1 last:border-r-0"><div className="space-y-1">{eventsForDay(day, employee.id).map((event) => <EventPill key={event.id} event={event} compact onClick={onEditRequest ? () => onEditRequest(event.requestId) : undefined} />)}</div></div>)}</div>)}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{selectedCount} Ereignisse · {filteredEmployees.length} Mitarbeiter</p>
    </div>
  );
}
