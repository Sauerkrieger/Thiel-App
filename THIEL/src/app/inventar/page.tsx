import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata: Metadata = {
  title: "Inventar",
};

export default async function InventarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Der Inventar-Reiter ist nur für Admins gedacht.
  if (user.role !== "admin") redirect("/objects");

  return <InventoryPage />;
}
