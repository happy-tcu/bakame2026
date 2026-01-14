export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Missing SUPABASE env vars" });
    }

    // ElevenLabs may send different shapes; we support a few.
    const body = req.body || {};
    const caller_id =
      body.caller_id ||
      body.callerId ||
      body?.twilio?.caller_id ||
      body?.twilio?.from ||
      null;

    const user_id =
      body.user_id ||
      body.userId ||
      body?.client_data?.user_id ||
      body?.clientData?.user_id ||
      null;

    const conversation_id =
      body.conversation_id ||
      body.conversationId ||
      body?.conversation?.id ||
      null;

    // Minimal progress_summary for now (you can upgrade later)
    const progress_summary =
      body.progress_summary ||
      body.progressSummary ||
      body.summary ||
      "Conversation completed.";

    const last_call_at = new Date().toISOString();

    // IMPORTANT:
    // You created BOTH a table `public.calls` earlier AND later a VIEW named `public.calls`.
    // If `public.calls` is now a VIEW, writes to /rest/v1/calls will fail.
    // So write to the REAL table: `learner_progress` + `learners`.
    //
    // We will:
    // 1) upsert learner into `learners` (by caller_id or user_id)
    // 2) upsert progress into `learner_progress`

    // 1) Find existing learner
    let learner = null;

    if (caller_id) {
      const find = await fetch(
        `${SUPABASE_URL}/rest/v1/learners?caller_id=eq.${encodeURIComponent(
          caller_id
        )}&select=id`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      const rows = find.ok ? await find.json() : [];
      learner = rows?.[0] || null;
    }

    if (!learner && user_id) {
      const find = await fetch(
        `${SUPABASE_URL}/rest/v1/learners?user_id=eq.${encodeURIComponent(
          user_id
        )}&select=id`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      const rows = find.ok ? await find.json() : [];
      learner = rows?.[0] || null;
    }

    // 2) Create learner if missing
    if (!learner) {
      const create = await fetch(`${SUPABASE_URL}/rest/v1/learners`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          caller_id: caller_id || null,
          user_id: user_id || null,
          channel_first: caller_id ? "phone" : "web",
        }),
      });

      if (!create.ok) {
        const t = await create.text();
        return res.status(500).json({ error: "Failed to create learner", detail: t });
      }

      const created = await create.json();
      learner = created?.[0] || null;
    }

    // 3) Upsert learner_progress
    // We need "Prefer: resolution=merge-duplicates" so it upserts on PK (learner_id).
    const upsert = await fetch(`${SUPABASE_URL}/rest/v1/learner_progress`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        learner_id: learner.id,
        last_call_at,
        progress_summary,
      }),
    });

    if (!upsert.ok) {
      const t = await upsert.text();
      return res.status(500).json({ error: "Failed to upsert learner_progress", detail: t });
    }

    // Optional: store a session row (minimal)
    if (conversation_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          learner_id: learner.id,
          conversation_id,
          channel: caller_id ? "phone" : "web",
          ended_at: last_call_at,
          ended_by: "client",
        }),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
