"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { offlineFetch, offlineReadCached } from "@/lib/offline/fetch";
import { SetupHint } from "@/components/setup-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { VertretungCalendar } from "./vertretung-calendar";
import type { SubstituteAssignment } from "@/types/time-tracking";
import type { ApiError } from "@/types/api";

/**
 * Vertretungskalender des Springers: alle genehmigten Vertretungen mit
 * Farbkennung (orange = Fahrer, lila = Reinigungskraft), Monat & Woche.
 * Stale-while-revalidate: gecachte Daten sofort anzeigen, frische Daten
 * parallel vom Server nachladen.
 */
export function VertretungPage() {
  const [assignments, setAssignments] = useState<SubstituteAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [absences, setAbsences] = useState<Array<{ id: string; name: string; start_date: string; end_date: string; role: string }>>([]);
  const [kind, setKind] = useState<"driver" | "facility_manager">("driver");
  const [absenceId, setAbsenceId] = useState("none");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [objectId, setObjectId] = useState("");
  const [objects, setObjects] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setError(null);
    const url = "/api/time-tracking/substitutes";
    const cached = fresh ? null : await offlineReadCached(url);
    if (cached) {
      setAssignments((cached.substitutes as SubstituteAssignment[]) ?? []);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await offlineFetch(url, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        // Bereits sichtbare Cache-Daten nicht durch eine Fehlermeldung ersetzen.
        if (!cached) {
          setError({ code: body.code, message: body.error ?? "Unknown error" });
        }
        return;
      }
      setAssignments(body.substitutes ?? []);
      setAbsences(body.absences ?? []);
      setObjects(body.objects ?? []);
    } catch {
      if (!cached) {
        setError({ message: "Network error while loading substitutions." });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function chooseAbsence(value: string) {
    setAbsenceId(value);
    const absence = absences.find((item) => item.id === value);
    if (absence) {
      setStart(absence.start_date);
      setEnd(absence.end_date);
      setKind(absence.role === "facility_manager" ? "facility_manager" : "driver");
    }
  }

  async function submit() {
    if (!start || !end || end < start || (kind === "facility_manager" && !objectId)) {
      toast.error("Please select the period and all required details.");
      return;
    }
    setSaving(true);
    try {
      const res = await offlineFetch("/api/time-tracking/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ substitute_request: true, substitute_kind: kind, substitute_object_id: kind === "facility_manager" ? objectId : null, start_date: start, end_date: end, type: "compensatory" }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not submit the substitution.");
      toast.success("Substitution submitted – waiting for approval.");
      setStart(""); setEnd(""); setAbsenceId("none"); setObjectId("");
      await load(true);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit the substitution."); }
    finally { setSaving(false); }
  }

  return (
    <div className="container pb-28 pt-6 sm:pb-28 sm:pt-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Substitution</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Your assignments at a glance: whom you cover and when. For cleaning substitutions, tap a field to see the objects to clean; for driver substitutions, you see your notes.
        </p>
      </div>

      {error?.code === "SUPABASE_NOT_CONFIGURED" ? (
        <SetupHint message={error.message} />
      ) : error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          {error.message}
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <>
          <VertretungCalendar assignments={assignments} />
          <Card className="mt-6">
            <CardHeader><CardTitle>Add substitution</CardTitle><CardDescription>The entry only becomes active after admin approval.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Affected employee (optional)</Label><Select value={absenceId} onValueChange={chooseAbsence}><SelectTrigger><SelectValue placeholder="No employee – choose the period yourself" /></SelectTrigger><SelectContent><SelectItem value="none">No employee – enter it myself</SelectItem>{absences.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.start_date} – {item.end_date}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Von</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div><div className="space-y-2"><Label>Bis</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
              <div className="space-y-2"><Label>Type of substitution</Label><Select value={kind} onValueChange={(v) => setKind(v as "driver" | "facility_manager")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="driver">Driver</SelectItem><SelectItem value="facility_manager">Reinigung</SelectItem></SelectContent></Select></div>
              {kind === "facility_manager" && <div className="space-y-2"><Label>Object</Label><Select value={objectId} onValueChange={setObjectId}><SelectTrigger><SelectValue placeholder="Select object" /></SelectTrigger><SelectContent>{objects.map((object) => <SelectItem key={object.id} value={object.id}>{object.name}</SelectItem>)}</SelectContent></Select></div>}
              <div className="sm:col-span-2"><Button onClick={() => void submit()} disabled={saving}>{saving ? "Submitting…" : "Submit substitution for approval"}</Button></div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
