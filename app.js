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
      </article>
    `;
  }).join('');
}


// ====== GALERIE ======
async function renderGallery() {
  const items = await loadJSON('content/gallery.json');
  const grid = document.getElementById('gallery-grid');
  if (!items.length) {
    grid.innerHTML = '<p style="text-align:center;color:var(--ink-soft);font-style:italic;grid-column:1/-1;">Pas encore de photos.</p>';
    return;
  }

  grid.innerHTML = items.map(it => {
    let content;
    if (it.image) {
      content = mediaHTML(it.image, it.caption);
    } else {
      content = `<div class="gallery-placeholder">${escapeHtml(it.emoji || '·')}</div>`;
    }
    return `
      <div class="gallery-item" data-caption="${escapeHtml(it.caption || '')}" data-media="${escapeHtml(it.image || '')}">
        ${content}
      </div>
    `;
  }).join('');

  attachLightbox();
}


// ====== CARTE ======
async function renderMap() {
  const walks = await loadJSON('content/walks.json');
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


// ====== NAV FLUIDE ======
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});


// ====== INIT ======
renderJournal();
renderGallery();
renderMap();
