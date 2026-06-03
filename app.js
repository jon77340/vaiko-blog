/* ===========================================
   VAÏKO — Logique du site
   Data-driven, optimisé faible bande passante
   =========================================== */

// ====== UTILS ======
async function loadJSON(path) {
  try {
    const r = await fetch(path + '?t=' + Date.now());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.error('Erreur chargement', path, e);
    return [];
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function formatDateLong(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(d);
  } catch { return iso; }
}

function isVideo(url) {
  if (!url) return false;
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

// ====== MÉDIA (image ou vidéo, lazy + responsive) ======
function mediaHTML(url, alt = '', { full = false } = {}) {
  if (!url) return '';
  const safeAlt = escapeHtml(alt);
  if (isVideo(url)) {
    return `<video src="${escapeHtml(url)}" preload="metadata" playsinline controls ${full ? 'autoplay loop muted' : ''}></video>`;
  }
  // Image avec lazy loading natif
  return `<img src="${escapeHtml(url)}" alt="${safeAlt}" loading="lazy" decoding="async">`;
}


// ====== JOURNAL ======
async function renderJournal() {
  const grid = document.getElementById('journal-grid');

  // Skeleton pendant le chargement
  grid.innerHTML = Array(2).fill(`
    <article class="post skeleton-post">
      <div class="skeleton skeleton-img"></div>
      <div class="skeleton skeleton-date"></div>
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
    </article>`).join('');

  const posts = await loadJSON('content/posts.json');
  if (!posts.length) {
    grid.innerHTML = '<p style="text-align:center;color:var(--ink-soft);font-style:italic;">Le carnet est encore vierge. Revenez bientôt.</p>';
    return;
  }

  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Dernière mise à jour
  const lastDate = posts[0]?.date;
  if (lastDate) {
    const el = document.getElementById('last-updated');
    if (el) {
      const d = new Date(lastDate);
      const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
      el.textContent = diff === 0 ? 'mis à jour aujourd\'hui' : diff === 1 ? 'mis à jour hier' : `mis à jour il y a ${diff} jours`;
      el.style.display = 'inline';
    }
  }

  grid.innerHTML = posts.map(p => {
    const dateLabel = p.dateLabel || formatDateLong(p.date) || '';
    let mediaContent = '';

    if (p.image) {
      mediaContent = mediaHTML(p.image, p.title);
    } else if (p.emoji) {
      mediaContent = `<span class="post-emoji">${escapeHtml(p.emoji)}</span>`;
    }

    return `
      <article class="post">
        ${mediaContent ? `<div class="post-image">${mediaContent}</div>` : ''}
        <div class="post-body">
          <time class="post-date">${escapeHtml(dateLabel)}</time>
          <h3>${escapeHtml(p.title || '')}</h3>
          ${(p.body || '').split('\n\n').map(para =>
            `<p>${escapeHtml(para)}</p>`
          ).join('')}
          ${p.tag ? `<span class="post-tag">— ${escapeHtml(p.tag)}</span>` : ''}
        </div>
        <div class="post-interactions" data-id="${p.message_id}">
          <div class="reactions">
            ${['🐾','❤️','😍','😂','🐶','👏'].map(e =>
              `<button class="reaction-btn" data-emoji="${e}" onclick="addReaction(${p.message_id},'${e}',this)">${e} <span class="reaction-count"></span></button>`
            ).join('')}
          </div>
          <div class="comments-section">
            <div class="comments-list" id="comments-${p.message_id}"></div>
            <form class="comment-form" onsubmit="submitComment(event,${p.message_id})">
              <input type="text" placeholder="Votre prénom" class="comment-name" maxlength="50" autocomplete="given-name" autocapitalize="words">
              <textarea placeholder="Laissez un message à Vaïko 🐾" class="comment-text" maxlength="500" rows="3" autocapitalize="sentences"></textarea>
              <button type="submit" class="comment-submit">Envoyer ✉️</button>
            </form>
          </div>
        </div>
      </article>
    `;
  }).join('');
}


// ====== GALERIE ======
async function renderGallery() {
  // Combine gallery.json + toutes les images des posts
  const [galleryItems, posts] = await Promise.all([
    loadJSON('content/gallery.json'),
    loadJSON('content/posts.json')
  ]);

  const fromPosts = posts
    .filter(p => p.image && !isVideo(p.image))
    .map(p => ({ image: p.image, caption: p.title, date: p.date }));

  const fromVideos = posts
    .filter(p => p.image && isVideo(p.image))
    .map(p => ({ image: p.image, caption: p.title, date: p.date }));

  // Toutes les photos : posts en premier (chronologique desc), puis gallery.json, puis vidéos
  const all = [...fromPosts, ...galleryItems, ...fromVideos]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const grid = document.getElementById('gallery-grid');
  if (!all.length) {
    grid.innerHTML = '<p style="text-align:center;color:var(--ink-soft);font-style:italic;grid-column:1/-1;">Pas encore de photos.</p>';
    return;
  }

  grid.innerHTML = all.map(it => {
    const content = mediaHTML(it.image, it.caption);
    const isVid = isVideo(it.image);
    return `
      <div class="gallery-item${isVid ? ' gallery-item--video' : ''}" data-caption="${escapeHtml(it.caption || '')}" data-media="${escapeHtml(it.image || '')}">
        ${content}
        ${isVid ? '<span class="gallery-play">▶</span>' : ''}
      </div>
    `;
  }).join('');

  attachLightbox();
}


// ====== CARTE ======
async function renderMap() {
  // Combine walks.json (manuel) + coords des posts Telegram
  const [walksManual, posts] = await Promise.all([
    loadJSON('content/walks.json'),
    loadJSON('content/posts.json')
  ]);
  const postsWithCoords = posts
    .filter(p => p.coords?.lat && p.coords?.lng)
    .map(p => ({ lat: p.coords.lat, lng: p.coords.lng, title: p.title, date: p.date }));
  const walks = [...walksManual, ...postsWithCoords];
  const mapDiv = document.getElementById('map');

  if (typeof L === 'undefined') {
    setTimeout(renderMap, 200);
    return;
  }

  let center = [48.8156, 2.2363];
  if (walks.length) {
    center = [
      walks.reduce((s,w) => s+w.lat, 0) / walks.length,
      walks.reduce((s,w) => s+w.lng, 0) / walks.length
    ];
  }

  const map = L.map(mapDiv, { scrollWheelZoom: false }).setView(center, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(map);

  // Marqueur sobre : cercle plein
  const dotIcon = L.divIcon({
    html: `<div style="background:#8b3a1e;border:2px solid #faf8f4;border-radius:50%;
           width:14px;height:14px;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>`,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  walks.forEach((w, i) => {
    L.marker([w.lat, w.lng], { icon: dotIcon })
      .addTo(map)
      .bindPopup(`<strong>${i + 1}. ${escapeHtml(w.title)}</strong><br><small>${escapeHtml(w.date)} · ${escapeHtml(w.info || '')}</small>`);
  });

  if (walks.length > 1) {
    L.polyline(walks.map(w => [w.lat, w.lng]), {
      color: '#8b3a1e', weight: 2, opacity: 0.5, dashArray: '5, 5'
    }).addTo(map);
  }

  const list = document.getElementById('walks-list');
  list.innerHTML = walks.map((w, i) => `
    <div class="walk-card">
      <span class="walk-num">${String(i + 1).padStart(2, '0')}</span>
      <div>
        <h4>${escapeHtml(w.title)}</h4>
        <p>${escapeHtml(w.date)} · ${escapeHtml(w.info || '')}</p>
      </div>
    </div>
  `).join('');
}


// ====== LIGHTBOX ======
function attachLightbox() {
  const lightbox = document.getElementById('lightbox');
  const lightboxContent = lightbox.querySelector('.lightbox-content');
  const lightboxCaption = lightbox.querySelector('.lightbox-caption');
  const lightboxClose = lightbox.querySelector('.lightbox-close');
  let items = [], currentIdx = 0, touchStartX = 0;

  function openAt(idx) {
    currentIdx = idx;
    const item = items[idx];
    const mediaUrl = item.dataset.media;
    lightboxContent.innerHTML = '';
    if (mediaUrl) {
      lightboxContent.innerHTML = mediaHTML(mediaUrl, item.dataset.caption || '', { full: true });
    } else {
      const placeholder = item.querySelector('.gallery-placeholder');
      if (placeholder) {
        const clone = placeholder.cloneNode(true);
        clone.style.fontSize = '6rem';
        lightboxContent.appendChild(clone);
      }
    }
    lightboxCaption.textContent = item.dataset.caption || '';
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Swipe touch
  lightbox.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) < 50) return;
    const next = dx < 0 ? currentIdx + 1 : currentIdx - 1;
    if (next >= 0 && next < items.length) openAt(next);
  }, { passive: true });

  document.querySelectorAll('.gallery-item').forEach((item, idx) => {
    item.addEventListener('click', () => {
      items = Array.from(document.querySelectorAll('.gallery-item'));
      openAt(items.indexOf(item));
    });
  });

  const close = () => {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    // Pause toute vidéo en cours
    lightboxContent.querySelectorAll('video').forEach(v => v.pause());
  };
  lightboxClose.onclick = close;
  lightbox.onclick = e => { if (e.target === lightbox) close(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}



const WORKER_URL = 'https://vaiko-sync.jonathan-34c.workers.dev';

async function loadComments(postId) {
  try {
    const r = await fetch(`${WORKER_URL}/comments?post_id=${postId}`);
    const data = await r.json();
    // Réactions
    const section = document.querySelector(`.post-interactions[data-id="${postId}"]`);
    if (!section) return;
    Object.entries(data.reactions || {}).forEach(([emoji, count]) => {
      const btn = section.querySelector(`.reaction-btn[data-emoji="${emoji}"]`);
      if (btn && count > 0) {
        btn.querySelector('.reaction-count').textContent = count;
        btn.classList.add('has-reactions');
      }
    });
    // Commentaires
    const list = document.getElementById(`comments-${postId}`);
    if (!list) return;
    if (!data.comments?.length) { list.innerHTML = ''; return; }
    list.innerHTML = data.comments.map(c => `
      <div class="comment">
        <span class="comment-author">${escapeHtml(c.name)}</span>
        <span class="comment-date">${c.date}</span>
        <p class="comment-text">${escapeHtml(c.text)}</p>
      </div>`).join('');
  } catch(e) {}
}

async function addReaction(postId, emoji, btn) {
  btn.disabled = true;
  try {
    const r = await fetch(`${WORKER_URL}/react`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ post_id: postId, emoji })
    });
    const data = await r.json();
    const count = data.reactions?.[emoji] || 0;
    btn.querySelector('.reaction-count').textContent = count > 0 ? count : '';
    btn.classList.add('has-reactions');
    btn.classList.add('reacted');
    setTimeout(() => btn.disabled = false, 2000);
  } catch(e) { btn.disabled = false; }
}

async function submitComment(e, postId) {
  e.preventDefault();
  const form = e.target;
  const name = form.querySelector('.comment-name').value.trim() || 'Anonyme';
  const text = form.querySelector('.comment-text').value.trim();
  if (!text) return;
  const btn = form.querySelector('.comment-submit');
  btn.disabled = true;
  try {
    await fetch(`${WORKER_URL}/comments`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ post_id: postId, name, text })
    });
    form.querySelector('.comment-text').value = '';
    await loadComments(postId);
  } catch(e) {}
  btn.disabled = false;
}

// ====== NAV FLUIDE ======
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});


// ====== INIT ======
// Auto-refresh toutes les 5 min
let lastPostCount = 0;
async function checkForUpdates() {
  try {
    const posts = await loadJSON('content/posts.json');
    if (lastPostCount > 0 && posts.length > lastPostCount) {
      const banner = document.getElementById('new-posts-banner');
      if (banner) { banner.style.display = 'flex'; }
    }
    lastPostCount = posts.length;
  } catch(e) {}
}
setInterval(checkForUpdates, 5 * 60 * 1000);

renderJournal().then(() => {
  document.querySelectorAll('.post-interactions').forEach(el => {
    loadComments(Number(el.dataset.id));
  });
});
renderGallery();
renderMap();
