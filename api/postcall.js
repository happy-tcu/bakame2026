// /pages/api/postcall.js  (or /api/postcall route you are using)

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const body = req.body || {};

  // ElevenLabs / Twilio may send different shapes; be defensive.
  const caller_id = body.caller_id || body.callerId || body.from || null; // phone
  const user_id = body.user_id || body.userId || body.user?.id || body.user?.user_id || null; // web
  const conversation_id =
    body.conversation_id ||
    body.conversationId ||
    body.conversation?.id ||
    body.conversation?.conversation_id ||
    null;

  const agent_id = body.agent_id || body.agentId || body.agent?.id || null;

  // Try to capture a usable summary (fallback to empty string).
  const progress_summary =
    body.progress_summary ||
    body.summary ||
    body.conversation_summary ||
    body.conversation?.summary ||
    body.call_summary ||
    "";

  // If neither id exists, nothing to link.
  if (!caller_id && !user_id) {
    return res.status(200).json({ ok: true, skipped: "no caller_id or user_id" });
  }

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  // 1) Find existing learner by caller_id OR user_id
  const idField = caller_id ? "caller_id" : "user_id";
  const idValue = caller_id || user_id;

  const findLearnerUrl =
    `${SUPABASE_URL}/rest/v1/learners?` +
    `${idField}=eq.${encodeURIComponent(idValue)}` +
    `&select=id&limit=1`;

  let learner_id = null;

  const findR = await fetch(findLearnerUrl, { headers });
  if (findR.ok) {
    const rows = await findR.json();
    if (rows?.length) learner_id = rows[0].id;
  }

  // 2) If not found, create learner
  if (!learner_id) {
    const createLearnerUrl = `${SUPABASE_URL}/rest/v1/learners?select=id`;
    const createPayload = {
      caller_id: caller_id || null,
      user_id: user_id || null,
      channel_first: caller_id ? "phone" : "web",
    };

    const createR = await fetch(createLearnerUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(createPayload),
    });

    if (!createR.ok) {
      const t = await createR.text();
      return res.status(500).json({ ok: false, step: "create_learner", error: t });
    }

    const created = await createR.json();
    learner_id = created?.[0]?.id;
  }

  // 3) Insert a session row (minimal)
  if (learner_id) {
    const insertSessionUrl = `${SUPABASE_URL}/rest/v1/sessions`;
    const sessionPayload = {
      learner_id,
      conversation_id,
      agent_id,
      channel: caller_id ? "phone" : "web",
      started_at: body.started_at || body.startedAt || null,
      ended_at: body.ended_at || body.endedAt || null,
      duration_seconds: body.duration_seconds || body.durationSeconds || null,
      ended_by: body.ended_by || body.endedBy || null,
      primary_module: body.primary_module || null,
      primary_topic: body.primary_topic || null,
      topic_tags: body.topic_tags || null,
    };

    await fetch(insertSessionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(sessionPayload),
    });

    // 4) Upsert learner_progress (rolling summary used by /api/init)
    // learner_progress has PK = learner_id, so we can upsert with on_conflict=learner_id
    const upsertProgressUrl =
      `${SUPABASE_URL}/rest/v1/learner_progress?on_conflict=learner_id`;

    const progressPayload = {
      learner_id,
      last_call_at: new Date().toISOString(),
      progress_summary: progress_summary || "",
    };

    const progR = await fetch(upsertProgressUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(progressPayload),
    });

    if (!progR.ok) {
      const t = await progR.text();
      return res.status(500).json({ ok: false, step: "upsert_progress", error: t });
    }
  }

  return res.status(200).json({ ok: true });
}
