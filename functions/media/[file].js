export async function onRequestGet(context) {
  const { params, env, request } = context;
  const file = params.file;

  if (!env.MEDIA) return new Response('R2 binding manquant', { status: 500 });

  const obj = await env.MEDIA.get(`media/${file}`);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);

  // Fallback content-type basé sur l'extension
  const ct = headers.get('content-type') || '';
  if (!ct || ct === 'application/octet-stream') {
    const ext = file.split('.').pop().toLowerCase();
    const mime = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
    }[ext] || 'application/octet-stream';
    headers.set('content-type', mime);
  }

  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', obj.httpEtag);

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
