import "server-only";
import { sendPushToUser } from "@/app/api/chat/push/send";

/** Zeitraum kompakt formatieren (z. B. „12. Okt" oder „12. Okt – 15. Okt"). */
function formatRange(startDate: string, endDate: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("de-DE", {
      day: "numeric",
      month: "short",
    });
  return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`;
}

/**
 * Schickt dem Vertreter eine Push-Benachrichtigung über seine Vertretung.
 * Wird beim Eintragen/Ändern einer Vertretung durch einen Admin aufgerufen.
 * Tut nichts, wenn Push nicht konfiguriert ist (siehe sendPushToUser).
 */
export async function notifySubstitutePush(params: {
  substituteId: string;
  absentName: string;
  startDate: string;
  endDate: string;
  /** true = bestehende Vertretung wurde geändert (Hinweis/Zeitraum). */
  updated?: boolean;
}): Promise<void> {
  const { substituteId, absentName, startDate, endDate, updated } = params;
  await sendPushToUser(substituteId, {
    title: updated ? "Vertretung aktualisiert" : "Neue Vertretung",
    body: `${updated ? "Aktualisiert: Du vertretst" : "Du vertretst"} ${absentName} am ${formatRange(startDate, endDate)}.`,
    url: "/vertretung",
    tag: "substitute",
  });
}
