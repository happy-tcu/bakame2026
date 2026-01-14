export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const data = req.body?.data || req.body || {};

  // Phone identity (Twilio)
  const caller_id =
    data?.conversation_initiation_client_data?.dynamic_variables?.caller_id ||
    data?.caller_id ||
    null;

  // Web identity (ElevenLabs)
  const user_id =
    data?.user_id ||
    data?.user?.id ||
    data?.conversation?.user_id ||
    data?.conversation?.user?.id ||
    null;

  // Progress text (best-effort)
  const progress_summary =
    data?.analysis?.transcript_summary ||
    data?.analysis?.summary ||
    data?.transcript_summary ||
    "";

  // Must have at least one identifier
  if (!caller_id && !user_id) {
    return res.status(200).json({ status: "no identity" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  await fetch(`${SUPABASE_URL}/rest/v1/calls`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      caller_id,
      user_id,
      last_call_at: new Date().toISOString(),
      progress_summary,
    }),
  });

  return res.status(200).json({ status: "saved" });
}
