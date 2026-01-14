export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const { caller_id } = req.body || {};
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  let progress = "";
  let user_name = "friend";

  if (caller_id) {
    const url = `${SUPABASE_URL}/rest/v1/calls?caller_id=eq.${encodeURIComponent(caller_id)}&select=progress_summary`;

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
