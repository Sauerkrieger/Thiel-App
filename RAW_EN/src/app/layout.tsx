import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";
import { COMPANY_NAME } from "@/lib/company";

export const metadata: Metadata = {
  title: {
    default: COMPANY_NAME,
    template: `%s · ${COMPANY_NAME}`,
  },
  description: `Delivery & tour planning app for ${COMPANY_NAME} – objects, routes and tours.`,
  applicationName: COMPANY_NAME,
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
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <AppShell userRole={user?.role ?? null} userId={user?.id ?? null}>
          {children}
        </AppShell>
        <Toaster />
      </body>
    </html>
  );
}
