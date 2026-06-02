/* ===========================================
   VAÏKO — Cloudflare Worker
   Synchronise Telegram → R2 → site
   Déclenché toutes les 5 min par cron, ou manuellement via /sync
   =========================================== */

const TG_API = 'https://api.telegram.org';

export default {
  // Endpoint HTTP (sync manuel + ping santé)
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/sync') {
      const token = url.searchParams.get('token');
      if (token !== env.SYNC_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }
      const result = await syncTelegram(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url.pathname === '/health') {
      return new Response('Vaïko worker OK');
    }

    return new Response(
      `Vaïko sync worker.\n\nEndpoints:\n  GET /sync?token=...  → force la synchro\n  GET /health          → ping\n\nSinon, le cron tourne tout seul toutes les 5 min.`,
      { headers: { 'content-type': 'text/plain' } }
    );
  },

  // Cron trigger
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncTelegram(env));
  }
};

// ====== SYNCHRO PRINCIPALE ======
async function syncTelegram(env) {
  // 1. Charger l'état précédent depuis R2
  const stateObj = await env.MEDIA.get('state.json');
  const state = stateObj
    ? JSON.parse(await stateObj.text())
    : { last_update_id: 0, posts: [], gallery: [] };

  // 2. Récupérer les nouveaux messages du canal Telegram
  const updatesRes = await fetch(
    `${TG_API}/bot${env.BOT_TOKEN}/getUpdates?offset=${state.last_update_id + 1}&allowed_updates=["channel_post"]&timeout=10`
  );
  const updates = await updatesRes.json();

  if (!updates.ok) {
    return { error: 'Telegram API error', details: updates };
  }
  if (!updates.result.length) {
    return { status: 'idle', last_id: state.last_update_id };
  }

  let processed = 0;
  let mediaGroups = new Map(); // pour gérer les albums multi-photos

  for (const upd of updates.result) {
    state.last_update_id = upd.update_id;
    const msg = upd.channel_post;
    if (!msg) continue;
    if (String(msg.chat.id) !== String(env.CHANNEL_ID)) continue;

    // Album (plusieurs photos d'un coup) → groupé
    if (msg.media_group_id) {
      if (!mediaGroups.has(msg.media_group_id)) {
        mediaGroups.set(msg.media_group_id, []);
      }
      mediaGroups.get(msg.media_group_id).push(msg);
      continue;
    }

    await processMessage(msg, state, env);
    processed++;
  }

  // Traiter les albums regroupés
  for (const groupMsgs of mediaGroups.values()) {
    await processAlbum(groupMsgs, state, env);
    processed++;
  }

  // 3. Sauvegarder dans R2 (état + JSON publics)
  await env.MEDIA.put('state.json', JSON.stringify(state));
  await env.MEDIA.put('content/posts.json', JSON.stringify(state.posts), {
    httpMetadata: { contentType: 'application/json' }
  });
  await env.MEDIA.put('content/gallery.json', JSON.stringify(state.gallery), {
    httpMetadata: { contentType: 'application/json' }
  });

  return {
    status: 'ok',
    processed,
    total_posts: state.posts.length,
    total_gallery: state.gallery.length,
    last_id: state.last_update_id
  };
}


// ====== TRAITEMENT D'UN MESSAGE SIMPLE ======
async function processMessage(msg, state, env) {
  const date = new Date(msg.date * 1000).toISOString().slice(0, 10);
  const caption = (msg.caption || msg.text || '').trim();
  const [titleLine, ...bodyLines] = caption.split('\n');
  const title = (titleLine || '').trim();
  const body = bodyLines.join('\n').trim();

  // Télécharger le média principal s'il y en a un
  const mediaPath = await downloadMedia(msg, env);

  // Convention : un post avec titre + texte = post du Journal
  //              une photo/vidéo sans texte ou très court = entrée Galerie
  const hasSubstantialText = body.length > 0 || title.length > 0;

  if (hasSubstantialText && (title || body)) {
    state.posts.push({
      date,
      dateLabel: '', // formaté côté client
      title: title || sansTitre(),
      body,
      image: mediaPath || '',
      tag: extractTag(caption),
      message_id: msg.message_id
    });
  } else if (mediaPath) {
    state.gallery.unshift({
      image: mediaPath,
      caption: title || '',
      date,
      message_id: msg.message_id
    });
  } else if (caption) {
    // Post texte pur
    state.posts.push({
      date,
      dateLabel: '',
      title: title || sansTitre(),
      body,
      image: '',
      tag: extractTag(caption),
      message_id: msg.message_id
    });
  }
}


// ====== TRAITEMENT D'UN ALBUM (plusieurs photos d'un coup) ======
async function processAlbum(msgs, state, env) {
  msgs.sort((a, b) => a.message_id - b.message_id);
  const first = msgs[0];
  const date = new Date(first.date * 1000).toISOString().slice(0, 10);
  const caption = (first.caption || '').trim();
  const [titleLine, ...bodyLines] = caption.split('\n');
  const title = (titleLine || '').trim();
  const body = bodyLines.join('\n').trim();

  const mediaPaths = [];
  for (const m of msgs) {
    const path = await downloadMedia(m, env);
    if (path) mediaPaths.push(path);
  }

  if (mediaPaths.length === 0) return;

  // Premier média = image du post Journal
  // Autres médias = ajoutés à la galerie
  state.posts.push({
    date,
    dateLabel: '',
    title: title || sansTitre(),
    body,
    image: mediaPaths[0],
    tag: extractTag(caption),
    message_id: first.message_id
  });

  for (let i = 1; i < mediaPaths.length; i++) {
    state.gallery.unshift({
      image: mediaPaths[i],
      caption: title || '',
      date,
      message_id: msgs[i].message_id
    });
  }
}


// ====== TÉLÉCHARGEMENT D'UN MÉDIA TELEGRAM → R2 ======
async function downloadMedia(msg, env) {
  let fileId = null;
  let ext = 'bin';

  if (msg.photo && msg.photo.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id; // plus grande taille
    ext = 'jpg';
  } else if (msg.video) {
    fileId = msg.video.file_id;
    ext = 'mp4';
  } else if (msg.document) {
    fileId = msg.document.file_id;
    const mime = msg.document.mime_type || '';
    if (mime.startsWith('image/')) ext = mime.split('/')[1];
    else if (mime.startsWith('video/')) ext = mime.split('/')[1];
  } else if (msg.animation) {
    fileId = msg.animation.file_id;
    ext = 'mp4';
  }

  if (!fileId) return null;

  // Telegram getFile → URL réelle
  const fileRes = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  if (!fileData.ok) return null;

  const path = fileData.result.file_path;
  const url = `${TG_API}/file/bot${env.BOT_TOKEN}/${path}`;
  const inferredExt = path.split('.').pop();
  if (inferredExt && inferredExt.length <= 4) ext = inferredExt;

  const dl = await fetch(url);
  if (!dl.ok) return null;

  const buf = await dl.arrayBuffer();
  const filename = `media/${msg.message_id}.${ext}`;
  await env.MEDIA.put(filename, buf, {
    httpMetadata: { contentType: dl.headers.get('content-type') || `image/${ext}` }
  });

  return '/' + filename;
}


// ====== UTILS ======
function extractTag(text) {
  // #tag dans le texte → utilisé comme tag
  const m = text.match(/#(\w+)/);
  return m ? m[1] : '';
}

function sansTitre() {
  return 'Sans titre';
}
