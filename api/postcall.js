// Vercel Serverless Function
// POST /api/postcall

// Fallback fetch for Node runtimes where global fetch isn't available
const fetchFn =
  typeof fetch === "function"
    ? fetch
    : (...args) => import("node-fetch").then(({ default: f }) => f(...args));

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // HubSpot (Private App) token
    const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

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

    // ---------- Conversation ID (with fallback so we ALWAYS write a row) ----------
    const conversation_id =
      body.conversation_id ||
      body.conversationId ||
      body?.conversation?.id ||
      body?.conversation?.conversation_id ||
      body?.call?.id ||
      body?.call_sid ||
      body?.twilio?.call_sid ||
      `${caller_id || user_id || "unknown"}-${nowIso}`;

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
      const r = await fetchFn(`${SUPABASE_URL}/rest/v1/${path}`, {
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
      const r = await fetchFn(`${SUPABASE_URL}/rest/v1/${path}`, {
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

    // ---------- HubSpot helpers ----------
    async function hubspotRequest(path, { method = "GET", body } = {}) {
      if (!HUBSPOT_PRIVATE_APP_TOKEN) {
        return { ok: false, status: 500, text: "Missing HUBSPOT_PRIVATE_APP_TOKEN" };
      }

      const r = await fetchFn(`https://api.hubapi.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      return {
        ok: r.ok,
        status: r.status,
        json: r.ok ? await r.json() : null,
        text: r.ok ? null : await r.text(),
      };
    }

    async function hubspotFindContactIdByPhone(phone) {
      if (!phone) return null;

      const search = await hubspotRequest("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "phone",
                  operator: "EQ",
                  value: phone,
                },
              ],
            },
          ],
          properties: ["phone"],
          limit: 1,
        },
      });

      if (search.ok && search.json?.results?.length) {
        return search.json.results[0].id;
      }
      return null;
    }

    async function hubspotCreateContact({ phone }) {
      const created = await hubspotRequest("/crm/v3/objects/contacts", {
        method: "POST",
        body: {
          properties: {
            phone: phone || "",
          },
        },
      });

      if (created.ok) return created.json?.id || null;
      return null;
    }

    async function hubspotUpdateContact(contactId, { phone }) {
      return hubspotRequest(`/crm/v3/objects/contacts/${contactId}`, {
        method: "PATCH",
        body: {
          properties: {
            phone: phone || "",
            // Optional later:
            // lifecyclestage: "lead",
          },
        },
      });
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
          status: created.status,
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
        status: progress.status,
      });
    }

    // ---------- 3) Upsert session_transcripts (ALWAYS) ----------
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
        status: transcriptUpsert.status,
      });
    }

    // ---------- 4) HubSpot: find-or-create contact ----------
    let hubspot_contact_id = null;

    // Only attempt HubSpot if we have a phone and a token
   if ((caller_id || user_id) && HUBSPOT_PRIVATE_APP_TOKEN) {
      hubspot_contact_id = await hubspotFindContactIdByPhone(caller_id);

      if (!hubspot_contact_id) {
        hubspot_contact_id = await hubspotCreateContact({ phone: caller_id });
      } else {
        await hubspotUpdateContact(hubspot_contact_id, { phone: caller_id });
      }
    }

    return res.status(200).json({
      ok: true,
      learner_id: learner.id,
      conversation_id,
      transcript_saved: Boolean(transcript),
      hubspot_contact_id,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: String(e),
    });
  }
};
