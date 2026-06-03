export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Sert les médias depuis R2
    if (path.startsWith('/media/')) {
      const file = path.slice(7); // enlève '/media/'
      if (!env.MEDIA) return new Response('R2 binding manquant', { status: 500 });
      const obj = await env.MEDIA.get(`media/${file}`);
      if (!obj) return new Response('Not found', { status: 404 });

      const ext = file.split('.').pop().toLowerCase();
      const mime = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
        mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
      }[ext] || 'application/octet-stream';

      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      if (!headers.get('content-type') || headers.get('content-type') === 'application/octet-stream') {
        headers.set('content-type', mime);
      }
      headers.set('cache-control', 'public, max-age=31536000, immutable');

      // Range requests pour vidéos
      const range = request.headers.get('range');
      if (range && obj.size) {
        const match = range.match(/bytes=(\d+)-(\d+)?/);
        if (match) {
          const start = parseInt(match[1]);
          const end = match[2] ? parseInt(match[2]) : obj.size - 1;
          const ranged = await env.MEDIA.get(`media/${file}`, { range: { offset: start, length: end - start + 1 } });
          headers.set('content-range', `bytes ${start}-${end}/${obj.size}`);
          headers.set('accept-ranges', 'bytes');
          return new Response(ranged.body, { status: 206, headers });
        }
      }
      headers.set('accept-ranges', 'bytes');
      return new Response(obj.body, { headers });
    }

    // Sert les JSON dynamiques depuis R2
    if (path.startsWith('/content/')) {
      const file = path.slice(9);
      if (file === 'walks.json') {
        return env.ASSETS.fetch(request);
      }
      if (!env.MEDIA) return new Response('[]', { headers: { 'content-type': 'application/json' } });
      const obj = await env.MEDIA.get(`content/${file}`);
      if (!obj) return new Response('[]', { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
      return new Response(obj.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
    }

    // Tout le reste : assets statiques (HTML, CSS, JS, images du repo)
    return env.ASSETS.fetch(request);
  }
}
