import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { AdminTimeTrackingPage } from "@/components/time-tracking/admin-time-tracking-page";

export const metadata: Metadata = { title: "Zeitadmin" };

export default async function AdminZeiterfassungPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isAdmin(user)) redirect("/zeiterfassung");
  return <AdminTimeTrackingPage />;
}
