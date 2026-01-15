// Vercel Serverless Function
// POST /api/postcall
module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = req.body || {};
    const nowIso = new Date().toISOString();

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

    // ---------- Transcript + summary ----------
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

    // ---------- Supabase helpers ----------
    async function supabaseGET(path) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      return {
        ok: r.ok,
        status: r.status,
        json: r.ok ? await r.json() : null,
        text: r.ok ? null : await r.text(),
      };
    }

    async function supabasePOST(path, payload, prefer) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: prefer || "return=representation",
        },
        body: JSON.stringify(payload),
      });
      return {
        ok: r.ok,
        status: r.status,
        json: r.ok ? await r.json() : null,
        text: r.ok ? null : await r.text(),
      };
    }

    // ---------- 1) Find or create learner ----------
    let learner = null;

    if (caller_id) {
      const found = await supabaseGET(
        `learners?caller_id=eq.${encodeURIComponent(caller_id)}&select=id`
      );
      if (found.ok && found.json?.length) learner = found.json[0];
    }

    if (!learner && user_id) {
      const found = await supabaseGET(
        `learners?user_id=eq.${encodeURIComponent(user_id)}&select=id`
      );
      if (found.ok && found.json?.length) learner = found.json[0];
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
        return res.status(500).json({
          error: "Failed to create learner",
          detail: created.text,
        });
      }

      learner = created.json[0];
    }

    // ---------- 2) Upsert learner_progress ----------
    const progress = await supabasePOST(
      "learner_progress",
      {
        learner_id: learner.id,
        last_call_at: nowIso,
        progress_summary: summary,
      },
      "resolution=merge-duplicates,return=representation"
    );

    if (!progress.ok) {
      return res.status(500).json({
        error: "Failed to upsert learner_progress",
        detail: progress.text,
      });
    }

    // ---------- 3) Upsert session_transcripts ----------
    if (conversation_id) {
      const transcriptUpsert = await supabasePOST(
        "session_transcripts",
        {
          conversation_id,
          learner_id: learner.id,
          channel: caller_id ? "phone" : "web",
          ended_at: nowIso,
          transcript: transcript,
          summary: summary,
        },
        "resolution=merge-duplicates,return=representation"
      );

      if (!transcriptUpsert.ok) {
        return res.status(500).json({
          error: "Failed to upsert session_transcripts",
          detail: transcriptUpsert.text,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      learner_id: learner.id,
      conversation_id: conversation_id || null,
      transcript_saved: Boolean(transcript),
    });
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: String(e),
    });
  }
};
