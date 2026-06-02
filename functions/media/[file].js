// Cloudflare Pages Function
// Sert les médias (photos/vidéos) depuis R2
// Route : /media/12345.jpg, /media/67890.mp4, etc.

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const file = params.file;

  if (!env.MEDIA) {
    return new Response('R2 binding manquant', { status: 500 });
  }

  const obj = await env.MEDIA.get(`media/${file}`);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);

  // Cache long côté CDN (les médias ne bougent jamais une fois publiés)
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', obj.httpEtag);

  // Support du range (lecture vidéo en streaming progressif)
  const range = request.headers.get('range');
  if (range && obj.size) {
    const match = range.match(/bytes=(\d+)-(\d+)?/);
    if (match) {
      const start = parseInt(match[1]);
      const end = match[2] ? parseInt(match[2]) : obj.size - 1;
      const ranged = await env.MEDIA.get(`media/${file}`, {
        range: { offset: start, length: end - start + 1 }
      });
      headers.set('content-range', `bytes ${start}-${end}/${obj.size}`);
      headers.set('accept-ranges', 'bytes');
      return new Response(ranged.body, { status: 206, headers });
    }
  }

  headers.set('accept-ranges', 'bytes');
  return new Response(obj.body, { headers });
}
