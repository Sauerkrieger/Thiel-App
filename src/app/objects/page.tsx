import type { Metadata } from "next";
import { ObjectsPage } from "@/components/objects/objects-page";

export const metadata: Metadata = {
  title: "Objekte",
};

export default function ObjectsRoute() {
  return <ObjectsPage />;
}
