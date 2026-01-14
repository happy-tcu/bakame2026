export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const data = req.body?.data || {};
  const caller_id =
    data?.conversation_initiation_client_data?.dynamic_variables?.caller_id ||
    null;

  const progress =
    data?.analysis?.transcript_summary ||
    "No summary available";

  if (!caller_id) {
    return res.status(200).json({ status: "no caller_id" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  await fetch(`${SUPABASE_URL}/rest/v1/calls`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      caller_id,
      last_call_at: new Date().toISOString(),
      progress_summary: progress,
    }),
  });

  return res.status(200).json({ status: "saved" });
}
