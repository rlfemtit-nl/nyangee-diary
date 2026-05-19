// Shared schedule state — one JSON document in Vercel Blob storage.
// GET  /api/state   → return current state
// POST /api/state   → replace state (last-write-wins, fine for a small shared calendar)
//
// Every user sees the same data. Auth-free for now since this is a private
// shared planner — anyone who knows the URL is trusted.
import { put, head } from '@vercel/blob';

const PATH = 'nyangee/state.json';
const DEFAULT_STATE = { events: [], nextId: 1, selectedTaskId: 'work', updatedAt: 0 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    try {
      const meta = await head(PATH);
      const r = await fetch(meta.url, { cache: 'no-store' });
      if (!r.ok) {
        return res.status(200).json(DEFAULT_STATE);
      }
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      // 404 (no blob yet) or any other error → return defaults
      return res.status(200).json(DEFAULT_STATE);
    }
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== 'object' || !Array.isArray(body.events)) {
      return res.status(400).json({ error: 'invalid body' });
    }
    // Sanity-bound array size so a runaway client can't blow up the blob.
    if (body.events.length > 1000) {
      return res.status(413).json({ error: 'too many events' });
    }
    body.updatedAt = Date.now();
    try {
      await put(PATH, JSON.stringify(body), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true, updatedAt: body.updatedAt });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).end();
}
