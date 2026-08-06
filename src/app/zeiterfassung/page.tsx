import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { TimeTrackingPage } from "@/components/time-tracking/time-tracking-page";

export const metadata: Metadata = { title: "Zeiterfassung" };

export default async function ZeiterfassungPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <TimeTrackingPage />;
}
