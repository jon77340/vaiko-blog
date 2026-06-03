/* ===========================================
   VAÏKO — Cloudflare Worker
   Synchronise Telegram → R2 → site
   Déclenché toutes les 5 min par cron, ou manuellement via /sync
   Admin API : POST /admin
   =========================================== */

const TG_API = 'https://api.telegram.org';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Sync manuel
    if (url.pathname === '/sync') {
      if (url.searchParams.get('token') !== env.SYNC_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }
      const result = await syncTelegram(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'content-type': 'application/json', ...CORS }
      });
    }

    // Admin API
    if (url.pathname === '/admin') {
      return handleAdmin(request, env);
    }

    // Commentaires & réactions
    if (url.pathname === '/comments' || url.pathname === '/react') {
      return handleComments(request, env);
    }

    if (url.pathname === '/health') {
      return new Response('Vaïko worker OK', { headers: CORS });
    }

    return new Response('Vaïko sync worker.\n\nGET /sync?token=...\nPOST /admin\nGET /health', {
      headers: { 'content-type': 'text/plain', ...CORS }
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncTelegram(env));
  }
};

// ====== ADMIN API ======
async function handleAdmin(request, env) {
  const json = await request.json().catch(() => null);
  if (!json || json.token !== env.SYNC_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'content-type': 'application/json', ...CORS }
    });
  }

  const stateObj = await env.MEDIA.get('state.json');
  const state = stateObj ? JSON.parse(await stateObj.text()) : { last_update_id: 0, posts: [], gallery: [] };

  // LIST
  if (json.action === 'list') {
    return new Response(JSON.stringify({ posts: state.posts, gallery: state.gallery }), {
      headers: { 'content-type': 'application/json', ...CORS }
    });
  }

  // DELETE
  if (json.action === 'delete') {
    const id = Number(json.message_id);
    state.posts = state.posts.filter(p => p.message_id !== id);
    state.gallery = state.gallery.filter(g => g.message_id !== id);
    await saveState(env, state);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json', ...CORS }
    });
  }

  // UPDATE
  if (json.action === 'update') {
    const id = Number(json.message_id);
    const post = state.posts.find(p => p.message_id === id);
    if (post) {
      if (json.title !== undefined) post.title = json.title;
      if (json.body !== undefined) post.body = json.body;
      await saveState(env, state);
    }
    return new Response(JSON.stringify({ ok: !!post }), {
      headers: { 'content-type': 'application/json', ...CORS }
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'content-type': 'application/json', ...CORS }
  });
}

// ====== SYNCHRO PRINCIPALE ======
async function syncTelegram(env) {
  const stateObj = await env.MEDIA.get('state.json');
  const state = stateObj
    ? JSON.parse(await stateObj.text())
    : { last_update_id: 0, posts: [], gallery: [] };

  const updatesRes = await fetch(
    `${TG_API}/bot${env.BOT_TOKEN}/getUpdates?offset=${state.last_update_id + 1}&allowed_updates=["channel_post","edited_channel_post"]&timeout=10`
  );
  const updates = await updatesRes.json();

  if (!updates.ok) return { error: 'Telegram API error', details: updates };
  if (!updates.result.length) return { status: 'idle', last_id: state.last_update_id };

  let processed = 0;
  let mediaGroups = new Map();

  for (const upd of updates.result) {
    state.last_update_id = upd.update_id;

    // Message édité → met à jour le post existant
    if (upd.edited_channel_post) {
      const msg = upd.edited_channel_post;
      if (String(msg.chat.id) !== String(env.CHANNEL_ID)) continue;
      const post = state.posts.find(p => p.message_id === msg.message_id);
      if (post) {
        const caption = (msg.caption || msg.text || '').trim();
        const [titleLine, ...bodyLines] = caption.split('\n');
        post.title = titleLine.trim() || post.title;
        post.body = bodyLines.join('\n').trim();
        post.tag = extractTag(caption);
        processed++;
      }
      continue;
    }

    const msg = upd.channel_post;
    if (!msg) continue;
    if (String(msg.chat.id) !== String(env.CHANNEL_ID)) continue;

    if (msg.media_group_id) {
      if (!mediaGroups.has(msg.media_group_id)) mediaGroups.set(msg.media_group_id, []);
      mediaGroups.get(msg.media_group_id).push(msg);
      continue;
    }

    await processMessage(msg, state, env);
    processed++;
  }

  for (const groupMsgs of mediaGroups.values()) {
    await processAlbum(groupMsgs, state, env);
    processed++;
  }

  await saveState(env, state);
  return { status: 'ok', processed, total_posts: state.posts.length, total_gallery: state.gallery.length, last_id: state.last_update_id };
}

async function saveState(env, state) {
  await env.MEDIA.put('state.json', JSON.stringify(state));
  await env.MEDIA.put('content/posts.json', JSON.stringify(state.posts), { httpMetadata: { contentType: 'application/json' } });
  await env.MEDIA.put('content/gallery.json', JSON.stringify(state.gallery), { httpMetadata: { contentType: 'application/json' } });
}

// ====== TRAITEMENT MESSAGES ======
async function processMessage(msg, state, env) {
  const date = new Date(msg.date * 1000).toISOString().slice(0, 10);
  const caption = (msg.caption || msg.text || '').trim();
  const [titleLine, ...bodyLines] = caption.split('\n');
  const title = titleLine.replace(/📍[\d.,\s-]+/g, '').trim();
  const body = bodyLines.filter(l => !l.match(/^📍/)).join('\n').trim();
  const coords = extractCoords(caption);
  const mediaPath = await downloadMedia(msg, env);
  const hasText = title.length > 0 || body.length > 0;

  // Message de localisation pure → met à jour le dernier post sans coords
  if (msg.location && !mediaPath && !hasText) {
    const last = state.posts[state.posts.length - 1];
    if (last && !last.coords) {
      last.coords = { lat: msg.location.latitude, lng: msg.location.longitude };
    } else {
      state.posts.push({
        date, dateLabel: '', title: 'Position', body: '',
        image: '', tag: '', coords: { lat: msg.location.latitude, lng: msg.location.longitude },
        message_id: msg.message_id
      });
    }
    return;
  }

  if (hasText || mediaPath || msg.location) {
    const coords = msg.location ? { lat: msg.location.latitude, lng: msg.location.longitude } : (extractCoords(caption) || null);
    state.posts.push({
      date, dateLabel: '',
      title: title || 'Sans titre',
      body, image: mediaPath || '',
      tag: extractTag(caption),
      coords: coords,
      message_id: msg.message_id
    });
  }
}

async function processAlbum(msgs, state, env) {
  msgs.sort((a, b) => a.message_id - b.message_id);
  const first = msgs[0];
  const date = new Date(first.date * 1000).toISOString().slice(0, 10);
  const caption = (first.caption || '').trim();
  const [titleLine, ...bodyLines] = caption.split('\n');
  const title = titleLine.replace(/📍[\d.,\s-]+/g, '').trim();
  const body = bodyLines.filter(l => !l.match(/^📍/)).join('\n').trim();
  const coords = extractCoords(caption);
  const mediaPaths = [];
  for (const m of msgs) {
    const path = await downloadMedia(m, env);
    if (path) mediaPaths.push(path);
  }
  if (!mediaPaths.length) return;
  state.posts.push({ date, dateLabel: '', title: title || 'Sans titre', body, image: mediaPaths[0], tag: extractTag(caption), coords: coords || null, message_id: first.message_id });
  for (let i = 1; i < mediaPaths.length; i++) {
    state.gallery.unshift({ image: mediaPaths[i], caption: title || '', date, message_id: msgs[i].message_id });
  }
}

// ====== DOWNLOAD MÉDIA ======
async function downloadMedia(msg, env) {
  let fileId = null, ext = 'bin';
  if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; ext = 'jpg'; }
  else if (msg.video) { fileId = msg.video.file_id; ext = 'mp4'; }
  else if (msg.document) {
    fileId = msg.document.file_id;
    const mime = msg.document.mime_type || '';
    if (mime.startsWith('image/')) ext = mime.split('/')[1];
    else if (mime.startsWith('video/')) ext = mime.split('/')[1];
  }
  else if (msg.animation) { fileId = msg.animation.file_id; ext = 'mp4'; }
  if (!fileId) return null;

  const fileRes = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  if (!fileData.ok) return null;
  const path = fileData.result.file_path;
  const inferredExt = path.split('.').pop();
  if (inferredExt?.length <= 5) ext = inferredExt.toLowerCase();

  // Convertit HEIC en JPG via un proxy gratuit
  let url = `${TG_API}/file/bot${env.BOT_TOKEN}/${path}`;
  const dl = await fetch(url);
  if (!dl.ok) return null;

  // Si HEIC → on stocke quand même, le frontend gère
  const buf = await dl.arrayBuffer();
  const filename = `media/${msg.message_id}.${ext}`;
  await env.MEDIA.put(filename, buf, { httpMetadata: { contentType: dl.headers.get('content-type') || `image/${ext}` } });
  return '/' + filename;
}


// ====== COMMENTAIRES & RÉACTIONS ======
async function handleComments(request, env) {
  const url = new URL(request.url);
  const CORS_H = { ...CORS, 'content-type': 'application/json' };

  if (request.method === 'GET') {
    const postId = url.searchParams.get('post_id');
    if (!postId) return new Response('[]', { headers: CORS_H });
    const obj = await env.MEDIA.get(`comments/${postId}.json`);
    const data = obj ? await obj.text() : '{"comments":[],"reactions":{}}';
    return new Response(data, { headers: CORS_H });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body?.post_id) return new Response('{"error":"missing post_id"}', { status: 400, headers: CORS_H });

    const key = `comments/${body.post_id}.json`;
    const obj = await env.MEDIA.get(key);
    const data = obj ? JSON.parse(await obj.text()) : { comments: [], reactions: {} };

    if (url.pathname === '/react') {
      const emoji = body.emoji;
      if (!emoji) return new Response('{"error":"missing emoji"}', { status: 400, headers: CORS_H });
      data.reactions[emoji] = (data.reactions[emoji] || 0) + 1;
    } else {
      const name = (body.name || 'Anonyme').slice(0, 50).trim();
      const text = (body.text || '').slice(0, 500).trim();
      if (!text) return new Response('{"error":"empty text"}', { status: 400, headers: CORS_H });
      data.comments.push({ name, text, date: new Date().toISOString().slice(0, 10), ts: Date.now() });
    }

    await env.MEDIA.put(key, JSON.stringify(data));
    return new Response(JSON.stringify(data), { headers: CORS_H });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}

// ====== UTILS ======
function extractTag(text) {
  const m = text.match(/#(\w+)/);
  return m ? m[1] : '';
}

function extractCoords(text) {
  const m = text.match(/📍\s*([-\d.]+)\s*,\s*([-\d.]+)/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}
