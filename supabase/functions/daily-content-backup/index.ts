import { createClient } from "npm:@supabase/supabase-js@2";

const SITE_SCOPED_TABLES = [
  "corner_letters",
  "corner_memories",
  "corner_flower_gifts",
  "corner_messages",
  "corner_dates",
  "corner_date_availability",
  "corner_movies",
  "corner_ratings",
  "corner_rituals",
  "game_sessions",
  "game_scores"
] as const;

const SESSION_SCOPED_TABLES = ["game_players", "game_moves"] as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  const expectedSecret = Deno.env.get("BACKUP_CRON_SECRET") || "";
  const suppliedSecret = request.headers.get("x-backup-secret") || "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return jsonResponse({ error: "Backup authorization failed" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const generatedAt = new Date();
  const day = generatedAt.toISOString().slice(0, 10);
  const { data: profiles, error: profileError } = await admin
    .from("couple_profiles")
    .select("site_id");
  if (profileError) return jsonResponse({ error: profileError.message }, 500);

  const siteIds = [...new Set((profiles || []).map((profile) => profile.site_id).filter(Boolean))];
  const results: Array<Record<string, unknown>> = [];

  for (const siteId of siteIds) {
    const objectPath = `${siteId}/daily/${day}.json`;
    const { data: run, error: runError } = await admin
      .from("corner_backup_runs")
      .insert({ site_id: siteId, object_path: objectPath, status: "running" })
      .select("id")
      .single();
    if (runError || !run) {
      results.push({ siteId, status: "failed", error: runError?.message || "Could not start backup" });
      continue;
    }

    try {
      const tables: Record<string, unknown[]> = {};
      const rowCounts: Record<string, number> = {};
      for (const table of SITE_SCOPED_TABLES) {
        const { data, error } = await admin.from(table).select("*").eq("site_id", siteId);
        if (error) throw new Error(`${table}: ${error.message}`);
        tables[table] = data || [];
        rowCounts[table] = data?.length || 0;
      }

      const sessionIds = (tables.game_sessions || [])
        .map((session) => (session as { id?: string }).id)
        .filter((id): id is string => Boolean(id));
      for (const table of SESSION_SCOPED_TABLES) {
        if (!sessionIds.length) {
          tables[table] = [];
          rowCounts[table] = 0;
          continue;
        }
        const { data, error } = await admin.from(table).select("*").in("session_id", sessionIds);
        if (error) throw new Error(`${table}: ${error.message}`);
        tables[table] = data || [];
        rowCounts[table] = data?.length || 0;
      }

      const payload = JSON.stringify({
        schemaVersion: 2,
        siteId,
        generatedAt: generatedAt.toISOString(),
        includesSoftDeletedRows: true,
        tables
      }, null, 2);
      const { error: uploadError } = await admin.storage
        .from("corner-backups")
        .upload(objectPath, new Blob([payload], { type: "application/json" }), {
          contentType: "application/json",
          cacheControl: "3600",
          upsert: true
        });
      if (uploadError) throw uploadError;

      await admin.from("corner_backup_runs").update({
        status: "complete",
        row_counts: rowCounts,
        completed_at: new Date().toISOString()
      }).eq("id", run.id);

      const { data: oldFiles } = await admin.storage
        .from("corner-backups")
        .list(`${siteId}/daily`, { limit: 1000, sortBy: { column: "name", order: "desc" } });
      const expired = (oldFiles || []).slice(120).map((file) => `${siteId}/daily/${file.name}`);
      if (expired.length) await admin.storage.from("corner-backups").remove(expired);
      results.push({ siteId, status: "complete", objectPath, rowCounts });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("corner_backup_runs").update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString()
      }).eq("id", run.id);
      results.push({ siteId, status: "failed", error: message });
    }
  }

  return jsonResponse({ generatedAt: generatedAt.toISOString(), results });
});
