// Vercel Serverless Function (plain /api, CommonJS)
// POST /api/postcall
module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });
    }

    const body = req.body || {};

    // ---------- Identify user ----------
    const caller_id =
      body.caller_id ||
      body.callerId ||
      body?.twilio?.caller_id ||
      body?.twilio?.from ||
      body?.call?.from ||
      null;

    const user_id =
      body.user_id ||
      body.userId ||
      body?.client_data?.user_id ||
      body?.clientData?.user_id ||
      body?.user?.id ||
      null;

    const conversation_id =
      body.conversation_id ||
      body.conversationId ||
      body?.conversation?.id ||
      body?.conversation?.conversation_id ||
      null;

    // ---------- Pull transcript + summary (support multiple shapes) ----------
    const transcript =
      body.transcript ||
      body?.transcription?.text ||
      body?.transcription?.transcript ||
      body?.conversation?.transcript ||
      body?.conversation?.transcription ||
      body?.data?.transcript ||
      null;

    const summary =
      body.summary ||
      body.progress_summary ||
      body.progressSummary ||
      body?.conversation?.summary ||
      body?.data?.summary ||
      "Conversation completed.";

    const nowIso = new Date().toISOString();

    // ---------- 1) Find (or create) learner ----------
    async function supabaseGET(path) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null, text: r.ok ? null : await r.text() };
    }

    async function supabasePOST(path, payload, prefer) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: prefer || "return=representation",
        },
        body: JSON.stringify(payload),
      });
      return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null, text: r.ok ? null : await r.text() };
    }

    let learner = null;

    if (caller_id) {
      const q = `learners?caller_id=eq.${encodeURIComponent(caller_id)}&select=id`;
      const found = await supabaseGET(q);
      if (found.ok && found.json && found.json.length) learner = found.json[0];
    }

    if (!learner && user_id) {
      const q = `learners?user_id=eq.${encodeURIComponent(user_id)}&select=id`;
      const found = await supabaseGET(q);
      if (found.ok && found.json && found.json.length) learner = found.json[0];
    }

    if (!learner) {
      const created = await supabasePOST(
        "learners",
        {
          caller_id: caller_id || null,
          user_id: user_id || null,
          channel_first: caller_id ? "phone" : "web",
        },
        "return=representation"
      );

      if (!created.ok) {
        return res.status(500).json({ error: "Failed to create learner", detail: created.text, status: created.status });
      }
      learner = created.json[0];
    }

    // ---------- 2) Upsert learner_progress (PK = learner_id) ----------
    const upsertProgress = await supabasePOST(
      "learner_progress",
      {
        learner_id: learner.id,
        last_call_at: nowIso,
        progress_summary: summary,
      },
      "resolution=merge-duplicates,return=representation"
    );

    if (!upsertProgress.ok) {
      return res.status(500).json({
        error: "Failed to upsert learner_progress",
        detail: upsertProgress.text,
        status: upsertProgress.status,
      });
    }

    // ---------- 3) Upsert transcript row (PK = conversation_id) ----------
    // Only do this if we have a conversation_id (recommended)
    if (conversation_id) {
      const upsertTranscript = await supabasePOST(
        "session_transcripts",
        {
          conversation_id,
          learner_id: learner.id,
          channel: caller_id ? "phone" : "web",
          ended_at: nowIso,
          transcript: transcript || null,
          summary: summary || null,
        },
        "resolution=merge-duplicates,return=representation"
      );

      if (!upsertTranscript.ok) {
        return res.status(500).json({
          error: "Failed to upsert session_transcripts",
          detail: upsertTranscript.text,
          status: upsertTranscript.status,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      stored: {
        learner_id: learner.id,
        conversation_id: conversation_id || null,
        has_transcript: Boolean(transcript),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
};
