"use client";

import { useMemo, useState } from "react";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  List,
  MapPin,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cleanAddressLabel } from "@/lib/address";
import type {
  SubstituteAssignment,
  SubstituteObject,
} from "@/types/time-tracking";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  driver: "Fahrer",
  facility_manager: "Reinigungskraft",
  substitute: "Springer",
};

/** Orange = vertretener Fahrer, Lila = vertretene Reinigungskraft. */
const STYLE_BY_ROLE: Record<string, { color: string; border: string; dot: string }> = {
  driver: { color: "bg-orange-500", border: "border-orange-700", dot: "bg-orange-500" },
  facility_manager: { color: "bg-violet-600", border: "border-violet-800", dot: "bg-violet-600" },
  admin: { color: "bg-stone-700", border: "border-stone-900", dot: "bg-stone-700" },
  substitute: { color: "bg-stone-700", border: "border-stone-900", dot: "bg-stone-700" },
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
function formatRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("de-DE", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

type Props = {
  assignments: SubstituteAssignment[];
};

export function VertretungCalendar({ assignments }: Props) {
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selected, setSelected] = useState<SubstituteAssignment | null>(null);

  const days = useMemo(() => {
    if (view === "week") {
      return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const mondayOffset = (first.getDay() || 7) - 1;
    const gridStart = addDays(first, -mondayOffset);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [cursor, view]);

  function shiftCursor(direction: number) {
    setCursor((current) =>
      view === "month"
        ? new Date(current.getFullYear(), current.getMonth() + direction, 1)
        : addDays(current, direction * 7),
    );
  }
  function resetToToday() {
    const today = new Date();
    setCursor(
      view === "month"
        ? new Date(today.getFullYear(), today.getMonth(), 1)
        : today,
    );
  }

  function assignmentsForDay(day: Date): SubstituteAssignment[] {
    const value = dateValue(day);
    return assignments.filter(
      (assignment) =>
        assignment.start_date <= value && assignment.end_date >= value,
    );
  }

  const heading =
    view === "month"
      ? formatMonth(cursor)
      : `${formatDay(days[0])} – ${formatDay(days[6])}`;

  function openDetails(assignment: SubstituteAssignment) {
    setSelected(assignment);
  }

  return (
    <div className="space-y-4">
      {/* Kopf: Navigation + Ansichtsumschaltung */}
      <div className="flex flex-col gap-3 border-b pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => shiftCursor(-1)}
            title="Vorheriger Zeitraum"
            aria-label="Vorheriger Zeitraum"
          >
            <ChevronLeft />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetToToday}>
            Heute
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => shiftCursor(1)}
            title="Nächster Zeitraum"
            aria-label="Nächster Zeitraum"
          >
            <ChevronRight />
          </Button>
          <h3 className="ml-1 min-w-48 text-lg font-semibold capitalize">{heading}</h3>
        </div>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Kalenderansicht">
          <Button
            type="button"
            size="sm"
            variant={view === "month" ? "secondary" : "ghost"}
            onClick={() => setView("month")}
          >
            <CalendarRange /> Monat
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "week" ? "secondary" : "ghost"}
            onClick={() => setView("week")}
          >
            <List /> Woche
          </Button>
        </div>
      </div>

      {/* Legende */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${STYLE_BY_ROLE.driver.dot}`} />
          Vertretung für Fahrer
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${STYLE_BY_ROLE.facility_manager.dot}`} />
          Vertretung für Reinigungskraft
        </span>
        <span className="border-l pl-4">Feld antippen für Details</span>
      </div>

      {assignments.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aktuell keine Vertretungen eingetragen.
        </p>
      ) : view === "month" ? (
        <div className="overflow-x-auto rounded-md border bg-background">
          <div className="min-w-[640px]">
            <div
              className="grid border-b bg-muted/30"
              style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
            >
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="border-r px-2 py-2 text-center text-xs font-semibold text-muted-foreground last:border-r-0"
                >
                  {day}
                </div>
              ))}
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
            >
              {days.map((day) => {
                const dayAssignments = assignmentsForDay(day);
                const isToday = dateValue(day) === dateValue(new Date());
                return (
                  <div
                    key={dateValue(day)}
                    className={`min-h-28 border-b border-r p-1.5 last:border-r-0 ${
                      day.getMonth() !== cursor.getMonth() ? "bg-muted/10" : ""
                    }`}
                  >
                    <div
                      className={`mb-1 text-right text-xs font-semibold ${
                        day.getMonth() !== cursor.getMonth()
                          ? "text-muted-foreground/50"
                          : isToday
                            ? "text-primary"
                            : "text-foreground"
                      }`}
                    >
                      {day.getDate()}
                    </div>
                    <div className="space-y-1">
                      {dayAssignments.map((assignment) => {
                        const style = STYLE_BY_ROLE[assignment.absent.role] ?? STYLE_BY_ROLE.driver;
                        return (
                          <button
                            key={assignment.id}
                            type="button"
                            onClick={() => openDetails(assignment)}
                            title={`${assignment.absent.name} vertreten · Klick für Details`}
                            className={`flex w-full cursor-pointer items-center gap-1 rounded border px-1.5 py-1 text-left text-[11px] leading-tight text-white transition-opacity hover:opacity-90 ${style.color} ${style.border} ${assignment.status === "pending" ? "opacity-40 grayscale" : ""}`}
                          >
                            <span className="min-w-0 truncate font-medium">
                              {assignment.absent.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-background">
          <div className="min-w-[640px]">
            <div
              className="grid border-b bg-muted/30"
              style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
            >
              {days.map((day) => (
                <div
                  key={dateValue(day)}
                  className={`border-r px-2 py-2 text-center text-xs font-semibold last:border-r-0 ${
                    dateValue(day) === dateValue(new Date())
                      ? "text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {formatDay(day)}
                </div>
              ))}
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
            >
              {days.map((day) => (
                <div
                  key={dateValue(day)}
                  className="min-h-40 border-r p-1.5 last:border-r-0"
                >
                  <div className="space-y-1">
                    {assignmentsForDay(day).map((assignment) => {
                      const style = STYLE_BY_ROLE[assignment.absent.role] ?? STYLE_BY_ROLE.driver;
                      return (
                        <button
                          key={assignment.id}
                          type="button"
                          onClick={() => openDetails(assignment)}
                          title={`${assignment.absent.name} vertreten · Klick für Details`}
                          className={`flex w-full cursor-pointer flex-col gap-0.5 rounded border px-1.5 py-1.5 text-left text-[11px] leading-tight text-white transition-opacity hover:opacity-90 ${style.color} ${style.border} ${assignment.status === "pending" ? "opacity-40 grayscale" : ""}`}
                        >
                          <span className="font-semibold">{assignment.absent.name}{assignment.status === "pending" ? " · Ausstehend" : ""}</span>
                          <span className="text-[10px] opacity-90">
                            {ROLE_LABELS[assignment.absent.role] ?? assignment.absent.role}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {assignments.length} Vertretung{assignments.length === 1 ? "" : "en"}
      </p>

      {/* Details-Dialog: wer vertreten wird, ggf. Objekte + Hinweis */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <Sparkles
                    className={`h-5 w-5 ${
                      selected.absent.role === "facility_manager"
                        ? "text-violet-600"
                        : "text-orange-500"
                    }`}
                  />
                  Vertretung für {selected.absent.name}
                  <Badge variant="outline">
                    {ROLE_LABELS[selected.absent.role] ?? selected.absent.role}
                  </Badge>
                </DialogTitle>
                <DialogDescription>{formatRange(selected.start_date, selected.end_date)}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {selected.absent.role === "facility_manager" && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">
                      Zu reinigende Objekte ({selected.objects.length})
                    </p>
                    {selected.objects.length === 0 ? (
                      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                        Keine Objekte zugewiesen.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {selected.objects.map((object: SubstituteObject) => (
                          <li
                            key={object.id}
                            className="rounded-md border bg-muted/20 px-3 py-2 text-sm"
                          >
                            <p className="font-medium">{object.name}</p>
                            {object.address && (
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3 shrink-0" />
                                {cleanAddressLabel(object.address)}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                    Hinweis
                  </p>
                  {selected.reviewer_note ? (
                    <p className="whitespace-pre-wrap rounded-md border bg-muted/20 px-3 py-2 text-sm">
                      {selected.reviewer_note}
                    </p>
                  ) : (
                    <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                      Kein Hinweis hinterlegt.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
