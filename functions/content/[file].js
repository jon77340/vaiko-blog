// Cloudflare Pages Function
// Sert les JSON depuis le bucket R2 "vaiko"
// Route : /content/posts.json, /content/gallery.json, /content/walks.json

export async function onRequestGet(context) {
  const { params, env } = context;
  const file = params.file;

  // Fichiers statiques locaux (walks.json reste dans le repo car édition rare et manuelle)
  if (file === 'walks.json') {
    return env.ASSETS.fetch(new Request(new URL('/content/walks.json', context.request.url)));
  }

  // Le reste vient du bucket R2 (rempli par le worker Telegram)
  if (!env.MEDIA) {
    return new Response('R2 binding "MEDIA" non configuré sur ce projet Pages.', { status: 500 });
  }

  const obj = await env.MEDIA.get(`content/${file}`);
  if (!obj) {
    return new Response('[]', {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60'
      }
    });
  }

  return new Response(obj.body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60' // 1 min de cache CDN, frais pour la Norvège
    }
  });
}
