export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const { caller_id, user_id } = req.body || {};

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  let progress = "";
  let user_name = "friend";

  // Pick the identifier we have
  const idField = caller_id ? "caller_id" : (user_id ? "user_id" : null);
  const idValue = caller_id || user_id;

  if (idField && idValue) {
    const url =
      `${SUPABASE_URL}/rest/v1/calls_view?` +
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
