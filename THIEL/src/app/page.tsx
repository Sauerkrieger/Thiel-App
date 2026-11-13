import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();

  // Fahrer & Springer arbeiten primär mit der Tourenplanung (inkl. „Laufende
  // Tour“-Banner) – sie landen dort direkt. Admins und Reinigungskräfte
  // starten wie bisher in der Objektverwaltung.
  if (user && (user.role === "driver" || user.role === "substitute")) {
    redirect("/planung");
  }
  redirect("/objects");
}
