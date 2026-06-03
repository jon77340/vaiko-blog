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
  const posts = await loadJSON('content/posts.json');
  const grid = document.getElementById('journal-grid');
  if (!posts.length) {
    grid.innerHTML = '<p style="text-align:center;color:var(--ink-soft);font-style:italic;">Le carnet est encore vierge. Revenez bientôt.</p>';
    return;
  }

  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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

  document.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => {
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
renderJournal().then(() => {
  document.querySelectorAll('.post-interactions').forEach(el => {
    loadComments(Number(el.dataset.id));
  });
});
renderGallery();
renderMap();
