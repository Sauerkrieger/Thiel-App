import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { HistoryPage } from "@/components/history/history-page";

export const metadata: Metadata = {
  title: "Tourenhistorie",
};

export default async function HistoryRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <HistoryPage isAdmin={user.role === "admin"} />;
}
