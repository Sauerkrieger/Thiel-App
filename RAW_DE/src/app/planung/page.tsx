import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isPlanner } from "@/lib/auth";
import { PlanningPage } from "@/components/planning/planning-page";

export const metadata: Metadata = {
  title: "Tourenplanung",
};

export default async function PlanningRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Nur Fahrer und Admins dürfen Touren planen.
  if (!isPlanner(user)) {
    redirect("/objects");
  }

  return <PlanningPage />;
}
