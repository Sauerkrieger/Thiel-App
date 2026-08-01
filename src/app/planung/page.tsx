import type { Metadata } from "next";
import { PlanningPage } from "@/components/planning/planning-page";

export const metadata: Metadata = {
  title: "Tourenplanung",
};

export default function PlanningRoute() {
  return <PlanningPage />;
}
