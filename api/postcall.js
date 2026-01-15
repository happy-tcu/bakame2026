module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" })
      );
    }

    const body = req.body || {};
    console.log("RAW WEBHOOK BODY:", JSON.stringify(body, null, 2));

    // Accept multiple payload shapes
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

    const progress_summary =
      body.progress_summary ||
      body.progressSummary ||
      body.summary ||
      "Conversation completed.";

    const last_call_at = new Date().toISOString();

    // ---------- 1) find or create learner ----------
    let learnerId = null;

    async function findLearnerBy(field, value) {
      const url =
        `${SUPABASE_URL}/rest/v1/learners?` +
        `${field}=eq.${encodeURIComponent(value)}` +
        `&select=id&limit=1`;

      const r = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });

      if (!r.ok) return null;
      const rows = await r.json();
      return rows?.[0]?.id || null;
    }

    if (caller_id) learnerId = await findLearnerBy("caller_id", caller_id);
    if (!learnerId && user_id) learnerId = await findLearnerBy("user_id", user_id);

    if (!learnerId) {
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
        const detail = await create.text();
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Failed to create learner", detail }));
      }

      const created = await create.json();
      learnerId = created?.[0]?.id || null;
    }

    if (!learnerId) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Could not resolve learnerId" }));
    }

    // ---------- 2) upsert learner_progress ----------
    const upsert = await fetch(`${SUPABASE_URL}/rest/v1/learner_progress`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        learner_id: learnerId,
        last_call_at,
        progress_summary,
      }),
    });

    if (!upsert.ok) {
      const detail = await upsert.text();
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Failed to upsert learner_progress", detail }));
    }

    // ---------- 3) optional: store session ----------
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
          learner_id: learnerId,
          conversation_id,
          channel: caller_id ? "phone" : "web",
          ended_at: last_call_at,
          ended_by: "client",
        }),
      });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Server error", detail: String(e) }));
  }
};
