// /pages/api/init.js  (or /api/init route you are using)

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const body = req.body || {};

  const caller_id = body.caller_id || body.callerId || body.from || null; // phone
  const user_id = body.user_id || body.userId || body.user?.id || null;   // web

  let progress = "";
  let user_name = "friend";

  // pick whichever identifier we have
  const idField = caller_id ? "caller_id" : user_id ? "user_id" : null;
  const idValue = caller_id || user_id;

  if (idField && idValue) {
    const url =
      `${SUPABASE_URL}/rest/v1/calls?` +
      `${idField}=eq.${encodeURIComponent(idValue)}` +
      `&select=progress_summary&limit=1`;

    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (r.ok) {
      const rows = await r.json();
      if (rows?.length) progress = rows[0].progress_summary || "";
    }
  }

  return res.status(200).json({
    type: "conversation_initiation_client_data",
    dynamic_variables: { user_name, progress },
  });
}
