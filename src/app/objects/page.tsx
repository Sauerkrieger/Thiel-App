import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ObjectsPage } from "@/components/objects/objects-page";

export const metadata: Metadata = {
  title: "Objekte",
};

export default async function ObjectsRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Nur Admins dürfen Objekte anlegen/bearbeiten/löschen. Objektbetreuer
  // (facility_manager) sehen nur ihre zugewiesenen Objekte mit reduzierter
  // Spaltenansicht und dürfen Items nicht ändern.
  return <ObjectsPage userRole={user.role} />;
}
