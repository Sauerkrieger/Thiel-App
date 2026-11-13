import { offlineFetch } from "./fetch";
import { formatMinutes, toMinutes } from "@/lib/routing/time";

/** Stopp, dessen Ankunftszeit beim Start an den tatsächlichen Start angepasst wird. */
export type StartTourStop = {
  id: string;
  arrival_time: string | null;
};

/**
 * Startet eine Tour: setzt den Status auf `in_transit`, aktualisiert die
 * Startzeit und verschiebt alle Ankunftszeiten um die Differenz zwischen
 * geplanter und tatsächlicher Abfahrt (damit das Auslieferungsfenster dem
 * echten Start entspricht – wie früher beim Anlegen der Tour).
 *
 * Offline wird nur der Status-/Startzeit-PATCH gequeued (Stopp-Verschiebung
 * braucht die Stopp-IDs aus dem Online-Anlegen und entfällt dann).
 */
export async function startTour(params: {
  tourId: string;
  actualStart: string;
  plannedStart: string;
  stops: StartTourStop[];
}): Promise<{ ok: boolean; error?: string }> {
  const { tourId, actualStart, plannedStart, stops } = params;
  const delta = toMinutes(actualStart) - toMinutes(plannedStart);

  const res = await offlineFetch(`/api/tours/${tourId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "in_transit", start_time: actualStart }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body.error ?? "Tour konnte nicht gestartet werden." };
  }

  // Ankunftszeiten nur verschieben, wenn der tatsächliche Start abweicht.
  if (delta !== 0) {
    await Promise.all(
      stops.map((stop) => {
        if (!stop.arrival_time) return Promise.resolve();
        return offlineFetch(`/api/tours/${tourId}/stops/${stop.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arrival_time: formatMinutes(toMinutes(stop.arrival_time) + delta),
          }),
        });
      }),
    );
  }
  return { ok: true };
}
