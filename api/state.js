// Shared schedule state — stored in Vercel Blob.
//
// CDN caching was making same-URL overwrites appear stale for up to hours.
// To get past that we write a NEW file per save (timestamp-stamped path),
// then read the newest one via list(). Each write's URL is unique so the
// CDN never has stale content to serve. Old versions are pruned to KEEP_N.
import { put, list, del } from '@vercel/blob';

const PREFIX = 'nyangee/state-';
const KEEP_N = 3;
const DEFAULT_STATE = { events: [], nextId: 1, selectedTaskId: 'work', updatedAt: 0 };

function pickLatest(blobs) {
  // pathname looks like nyangee/state-1779200000000.json. Sort by the
  // embedded timestamp because uploadedAt clock can drift between regions.
  return blobs
    .map(b => ({ b, ts: Number((b.pathname.match(/state-(\d+)\.json$/) || [])[1] || 0) }))
    .sort((a, z) => z.ts - a.ts)[0]?.b;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: PREFIX });
      if (!blobs || !blobs.length) return res.status(200).json(DEFAULT_STATE);
      const latest = pickLatest(blobs);
      if (!latest) return res.status(200).json(DEFAULT_STATE);
      const r = await fetch(latest.url, { cache: 'no-store' });
      if (!r.ok) return res.status(200).json(DEFAULT_STATE);
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
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
    if (body.events.length > 1000) {
      return res.status(413).json({ error: 'too many events' });
    }
    body.updatedAt = Date.now();
    const path = `${PREFIX}${body.updatedAt}.json`;
    try {
      await put(path, JSON.stringify(body), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
      // Prune older versions, best-effort — failures here don't affect the write.
      try {
        const { blobs } = await list({ prefix: PREFIX });
        const sorted = blobs
          .map(b => ({ b, ts: Number((b.pathname.match(/state-(\d+)\.json$/) || [])[1] || 0) }))
          .sort((a, z) => z.ts - a.ts);
        const oldUrls = sorted.slice(KEEP_N).map(x => x.b.url);
        if (oldUrls.length) await del(oldUrls);
      } catch {}
      return res.status(200).json({ ok: true, updatedAt: body.updatedAt });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).end();
}
