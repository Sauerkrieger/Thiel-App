import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Thiel Dienstleistungen",
    template: "%s · Thiel Dienstleistungen",
  },
  description:
    "Liefer- & Tourenplanungs-App für Thiel Dienstleistungen – Objekte, Routen und Touren.",
  applicationName: "Thiel Dienstleistungen",
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Defensiv: Fehler beim Auth-Check dürfen die Login-Seite nicht blockieren.
  const user = await getCurrentUser().catch(() => null);

  return (
    <html lang="de" suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <AppShell userRole={user?.role ?? null}>{children}</AppShell>
        <Toaster />
      </body>
    </html>
  );
}
