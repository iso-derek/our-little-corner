import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!vapidPublicKey || !vapidPrivateKey) throw new Error("VAPID secrets are not configured");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Invalid user session");

    const { notificationId } = await request.json();
    if (!notificationId) throw new Error("Missing notification ID");

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await admin
      .from("couple_profiles")
      .select("site_id,role")
      .eq("user_id", userData.user.id)
      .single();
    if (!profile) throw new Error("Account is not linked to this corner");

    const { data: notification } = await admin
      .from("corner_notifications")
      .select("id,site_id,actor_id,recipient_role,title,body,url,kind")
      .eq("id", notificationId)
      .eq("site_id", profile.site_id)
      .eq("actor_id", userData.user.id)
      .single();
    if (!notification) throw new Error("Notification not found");

    const { data: recipientProfiles } = await admin
      .from("couple_profiles")
      .select("user_id")
      .eq("site_id", profile.site_id)
      .neq("user_id", userData.user.id);
    const recipientIds = (recipientProfiles || []).map((item) => item.user_id);
    if (!recipientIds.length) return Response.json({ sent: 0 }, { headers: corsHeaders });

    const { data: subscriptions } = await admin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("site_id", profile.site_id)
      .in("user_id", recipientIds);

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: notification.url,
      tag: `pf-${notification.kind}-${notification.id}`
    });

    let sent = 0;
    await Promise.all((subscriptions || []).map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        }, payload);
        sent += 1;
      } catch (error) {
        const statusCode = error instanceof Error && "statusCode" in error
          ? Number(error.statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        } else {
          console.error("Push delivery failed", error);
        }
      }
    }));

    return Response.json({ sent }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification delivery failed";
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});
