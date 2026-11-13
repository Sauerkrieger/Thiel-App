export function SetupHint({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8">
      <h2 className="text-base font-semibold">
        Supabase is not connected yet
      </h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{message}</p>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Create a copy of{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            .env.local.example
          </code>{" "}
          als{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            .env.local
          </code>
        </li>
        <li>
          Enter the Supabase URL, anon key and service role key (dashboard →
          Project Settings → API)
        </li>
        <li>Run the migrations with `supabase db push`</li>
        <li>
          Restart the dev server – the page works after that
        </li>
      </ol>
    </div>
  );
}
