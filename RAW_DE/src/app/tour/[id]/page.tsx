import type { Metadata } from "next";
import { TourPage } from "@/components/tour/tour-page";

export const metadata: Metadata = {
  title: "Tour",
};

export default async function TourRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TourPage tourId={id} />;
}
