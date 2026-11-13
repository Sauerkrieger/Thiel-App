import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { VertretungPage } from "@/components/substitute/vertretung-page";

export const metadata: Metadata = { title: "Vertretung" };

export default async function VertretungPageRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Der Reiter ist explizit nur für Springer gedacht.
  if (user.role !== "substitute") redirect("/");
  return <VertretungPage />;
}
