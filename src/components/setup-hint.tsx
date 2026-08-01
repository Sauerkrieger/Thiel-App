export function SetupHint({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8">
      <h2 className="text-base font-semibold">
        Supabase ist noch nicht verbunden
      </h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{message}</p>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Erstelle eine Kopie von{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            .env.local.example
          </code>{" "}
          als{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            .env.local
          </code>
        </li>
        <li>
          Trage Supabase-URL, Anon-Key und Service-Role-Key ein (Dashboard →
          Project Settings → API)
        </li>
        <li>Führe die Migrationen mit `supabase db push` aus</li>
        <li>
          Starte den Dev-Server neu – danach funktioniert die Seite
        </li>
      </ol>
    </div>
  );
}
