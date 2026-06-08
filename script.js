const firebaseConfig = { databaseURL: "https://zknss2-default-rtdb.firebaseio.com/" };
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let cart = JSON.parse(localStorage.getItem('zkn_cart') || '[]');
let loggedUser = null;
let pixChave = "gabrielrobin63@gmail.com";
let pixNomeRecebedor = "ZKN STORE";
let currentPixPayload = null;
let allProducts = {};
let allCoupons = {};
let allReviews = {};
let appliedCoupon = null;
let currentFilterCategory = '';
let currentFilterPromo = false;
let currentFilterAvail = false;
let currentFilterFav = false;
let currentSort = 'recentes';
let currentSearch = '';
let whatsappNumber = '5579981289854';

const ADMIN_USER = 'ZKN33';
const ADMIN_PASS = '19971980@';

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBRL(v) {
  return 'R$ ' + Number(v||0).toFixed(2).replace('.',',');
}

function normalizarProduto(id, p) {
  if(!p) return null;
  return {
    id, nome: String(p.nome||'Produto'), descricao: String(p.descricao||''),
    preco: Math.max(0, Number(p.preco)||0),
    estoque: Math.max(0, parseInt(p.estoque)||0),
    icone: String(p.icone||'💎'), imagem: p.imagem||null,
    desconto: Math.max(0, Math.min(100, Number(p.desconto)||0)),
    esgotado: !!p.esgotado, status: p.status||'ativo',
    categoria: String(p.categoria||'geral'), destaque: !!p.destaque,
    estoqueBaixoLimite: Math.max(0, parseInt(p.estoqueBaixoLimite)||3),
    createdAt: p.createdAt||0, updatedAt: p.updatedAt||0,
  };
}

function getPrecoFinal(p) {
  if(!p) return 0;
  const preco = Number(p.preco)||0, desc = Number(p.desconto)||0;
  return desc > 0 ? Math.max(0, preco - preco*desc/100) : preco;
}

function hasDiscount(p) { return (Number(p.desconto)||0) > 0; }

function isProductAvailable(p) {
  if(!p) return false;
  if(p.status==='oculto'||p.status==='esgotado'||p.esgotado) return false;
  return p.estoque > 0;
}

function isLowStock(p) {
  if(!isProductAvailable(p)) return false;
  return p.estoque > 0 && p.estoque <= (p.estoqueBaixoLimite||3);
}

function normalizarCupom(id, c) {
  if(!c) return null;
  return {
    id, codigo: String(c.codigo||'').toUpperCase(),
    tipo: c.tipo==='fixo'?'fixo':'percentual',
    valor: Math.max(0, Number(c.valor)||0),
    ativo: c.ativo !== false,
    minimoCarrinho: Math.max(0, Number(c.minimoCarrinho)||0),
    validade: c.validade||'',
    limiteUsos: Math.max(0, parseInt(c.limiteUsos)||0),
    usos: Math.max(0, parseInt(c.usos)||0),
    createdAt: c.createdAt||0,
  };
}

function validarCupom(cupom, subtotal) {
  if(!cupom) return { valido: false, msg: 'Cupom não encontrado.' };
  if(!cupom.ativo) return { valido: false, msg: 'Cupom inativo.' };
  if(cupom.validade) {
    if(new Date(cupom.validade+'T23:59:59') < new Date()) return { valido: false, msg: 'Cupom expirado.' };
  }
  if(cupom.limiteUsos > 0 && cupom.usos >= cupom.limiteUsos) return { valido: false, msg: 'Cupom atingiu o limite de usos.' };
  if(cupom.minimoCarrinho > 0 && subtotal < cupom.minimoCarrinho) {
    return { valido: false, msg: `Mínimo de ${formatBRL(cupom.minimoCarrinho)} para este cupom.` };
  }
  return { valido: true };
}

function calcularResumoCarrinho() {
  const subtotal = cart.reduce((s,i) => s + (Number(i.precoFinal)||Number(i.preco)||0), 0);
  let descontoCupom = 0;
  if(appliedCoupon) {
    descontoCupom = appliedCoupon.tipo==='percentual'
      ? subtotal * appliedCoupon.valor / 100
      : appliedCoupon.valor;
    descontoCupom = Math.min(Math.max(0, descontoCupom), subtotal);
  }
  return { subtotal, descontoCupom, total: Math.max(0, subtotal - descontoCupom) };
}

function getFavorites() { return JSON.parse(localStorage.getItem('zkn_favs')||'[]'); }
function saveFavorites(f) { localStorage.setItem('zkn_favs', JSON.stringify(f)); }

function toggleFavorite(id) {
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  if(idx===-1) { favs.push(id); showToast('Adicionado aos favoritos ❤️'); }
  else { favs.splice(idx,1); showToast('Removido dos favoritos'); }
  saveFavorites(favs);
  document.querySelectorAll(`.btn-fav[data-id="${id}"]`).forEach(btn => {
    btn.classList.toggle('active', idx===-1);
  });
  if(currentFilterFav) renderProducts();
}

function normalizarPixChave(c) {
  c = String(c||'').trim();
  if(c.includes('@')) return c.toLowerCase();
  let raw = c.replace(/[^\d+]/g,'');
  if(raw.startsWith('+')) return raw;
  if(raw.startsWith('55') && raw.length>=12) return '+'+raw;
  if(/^\d{10,11}$/.test(raw)) return '+55'+raw;
  return c;
}

function getProductRating(productId) {
  const reviews = Object.values(allReviews).filter(r => r.productId === productId && r.aprovado);
  if(reviews.length === 0) return { avg: 0, count: 0 };
  const avg = reviews.reduce((s,r) => s + (Number(r.nota)||0), 0) / reviews.length;
  return { avg: Math.round(avg * 10) / 10, count: reviews.length };
}

function renderStars(avg, size) {
  const full = Math.floor(avg);
  const half = avg - full >= 0.5;
  let stars = '';
  for(let i=1;i<=5;i++) {
    if(i<=full) stars += '★';
    else if(i===full+1 && half) stars += '★';
    else stars += '☆';
  }
  return stars;
}

function getFilteredProducts() {
  let list = Object.values(allProducts).filter(p => p.status !== 'oculto');
  if(currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(p => p.nome.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
  }
  if(currentFilterCategory) list = list.filter(p => p.categoria===currentFilterCategory);
  if(currentFilterPromo) list = list.filter(p => hasDiscount(p));
  if(currentFilterAvail) list = list.filter(p => isProductAvailable(p));
  if(currentFilterFav) { const f = getFavorites(); list = list.filter(p => f.includes(p.id)); }
  switch(currentSort) {
    case 'menor': list.sort((a,b)=>getPrecoFinal(a)-getPrecoFinal(b)); break;
    case 'maior': list.sort((a,b)=>getPrecoFinal(b)-getPrecoFinal(a)); break;
    case 'promo': list.sort((a,b)=>(Number(b.desconto)||0)-(Number(a.desconto)||0)); break;
    case 'destaque': list.sort((a,b)=>(b.destaque?1:0)-(a.destaque?1:0)); break;
    case 'avaliacao': list.sort((a,b)=>getProductRating(b.id).avg-getProductRating(a.id).avg); break;
    default: list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  }
  return list;
}

function renderSkeletons() {
  const grid = document.getElementById('productsGrid');
  if(!grid) return;
  grid.innerHTML = Array(6).fill('').map(()=>`
    <div class="skeleton-card">
      <div class="skeleton skeleton-img"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line med"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-price"></div>
      </div>
    </div>
  `).join('');
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if(!grid) return;
  const list = getFilteredProducts();
  const favs = getFavorites();

  if(list.length===0) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><p>Nenhum produto encontrado.</p></div>`;
    return;
  }

  grid.innerHTML = list.map((p,i) => {
    const avail = isProductAvailable(p);
    const precoFinal = getPrecoFinal(p);
    const isFav = favs.includes(p.id);
    const delay = Math.min(i * 60, 400);
    const rating = getProductRating(p.id);

    let imgHtml = p.imagem
      ? `<img src="${escHtml(p.imagem)}" alt="${escHtml(p.nome)}" loading="lazy" onerror="this.parentElement.innerHTML='${escHtml(p.icone)}'">`
      : escHtml(p.icone);

    let badges = '';
    if(p.destaque) badges += `<span class="badge badge-destaque">✦ Destaque</span>`;
    if(hasDiscount(p)) badges += `<span class="badge badge-promo">-${p.desconto}%</span>`;
    if(!avail && (p.status==='esgotado'||p.esgotado)) badges += `<span class="badge badge-esgotado">Esgotado</span>`;
    else if(isLowStock(p)) badges += `<span class="badge badge-estoque-baixo">Últimas unidades</span>`;

    let priceHtml = '';
    if(p.status==='esgotado'||p.esgotado) {
      priceHtml = `<span class="product-price esgotado">Esgotado</span>`;
    } else {
      priceHtml = hasDiscount(p)
        ? `<span class="product-price-original">${formatBRL(p.preco)}</span><span class="product-price">${formatBRL(precoFinal)}</span>`
        : `<span class="product-price">${formatBRL(p.preco)}</span>`;
    }

    let ratingHtml = '';
    if(rating.count > 0) {
      ratingHtml = `<div class="product-rating-mini"><span class="stars-mini">${renderStars(rating.avg)}</span><span>${rating.avg} (${rating.count})</span></div>`;
    }

    return `
    <div class="product-card" style="animation-delay:${delay}ms" onclick="openProductDetail('${escHtml(p.id)}')">
      <div class="product-img">
        ${imgHtml}
        <div class="product-badges">${badges}</div>
        <button class="btn-fav${isFav?' active':''}" data-id="${escHtml(p.id)}" onclick="event.stopPropagation();toggleFavorite('${escHtml(p.id)}')" title="Favorito">❤</button>
      </div>
      <div class="product-body">
        <div class="product-cat">${escHtml(p.categoria)}</div>
        <div class="product-name">${escHtml(p.nome)}</div>
        <div class="product-desc">${escHtml(p.descricao)}</div>
        ${ratingHtml}
        <div class="product-footer">
          <div class="product-price-wrap">${priceHtml}</div>
          <button class="btn-add-cart" onclick="event.stopPropagation();addToCart('${escHtml(p.id)}')" ${!avail?'disabled':''}>
            ${avail?'+ Comprar':'Indisponível'}
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function updateCategories() {
  const sel = document.getElementById('productCat');
  if(!sel) return;
  const cats = [...new Set(Object.values(allProducts).filter(p=>p.status!=='oculto').map(p=>p.categoria))].sort();
  const prev = sel.value;
  sel.innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c=>`<option value="${escHtml(c)}"${c===prev?' selected':''}>${escHtml(c)}</option>`).join('');
}

function updateHeroStats() {
  const total = Object.values(allProducts).filter(p=>p.status!=='oculto').length;
  const el = document.getElementById('statProdutos');
  if(el) el.textContent = total + '+';
}

window.toggleFilterChip = function(btn, type) {
  btn.classList.toggle('active');
  if(type==='promo') currentFilterPromo = !currentFilterPromo;
  else if(type==='avail') currentFilterAvail = !currentFilterAvail;
  else if(type==='fav') currentFilterFav = !currentFilterFav;
  renderProducts();
};

window.clearFilters = function() {
  currentFilterPromo = currentFilterAvail = currentFilterFav = false;
  currentFilterCategory = '';
  currentSearch = '';
  currentSort = 'recentes';
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  const ps = document.getElementById('productSearch');
  const pc = document.getElementById('productCat');
  const psort = document.getElementById('productSort');
  if(ps) ps.value = '';
  if(pc) pc.value = '';
  if(psort) psort.value = 'recentes';
  renderProducts();
};

function loadProducts() {
  renderSkeletons();
  db.ref('/products').on('value', snap => {
    allProducts = {};
    if(snap.exists()) {
      snap.forEach(child => {
        const p = normalizarProduto(child.key, child.val());
        if(p) allProducts[p.id] = p;
      });
    }
    updateCategories();
    updateHeroStats();
    renderProducts();
  });
}

function loadCoupons() {
  db.ref('/coupons').on('value', snap => {
    allCoupons = {};
    if(snap.exists()) {
      snap.forEach(child => {
        const c = normalizarCupom(child.key, child.val());
        if(c) allCoupons[c.id] = c;
      });
    }
  });
}

function loadReviews() {
  db.ref('/reviews').on('value', snap => {
    allReviews = {};
    if(snap.exists()) {
      snap.forEach(child => {
        const r = child.val();
        if(r) allReviews[child.key] = { ...r, id: child.key };
      });
    }
    renderProducts();
  });
}

function loadPixChave() {
  db.ref('/config/pixChave').on('value', snap => {
    if(snap.exists() && snap.val()) pixChave = normalizarPixChave(snap.val());
  });
  db.ref('/config/pixNome').on('value', snap => {
    if(snap.exists() && snap.val()) pixNomeRecebedor = String(snap.val()).toUpperCase().slice(0,25)||'ZKN STORE';
  });
}

function loadBanner() {
  db.ref('/config/banner').on('value', snap => {
    const banner = snap.val();
    const el = document.getElementById('promoBanner');
    if(!el) return;
    if(!banner || !banner.ativo) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const inner = document.getElementById('promoBannerInner');
    const content = `<span class="promo-banner-text"><strong>${escHtml(banner.titulo||'')}</strong>${banner.subtitulo?' — '+escHtml(banner.subtitulo):''}</span>${banner.link?`<a href="${escHtml(banner.link)}" class="promo-banner-link">Ver mais</a>`:''}`;
    if(inner) inner.innerHTML = content + content;
  });
}

function loadTheme() {
  db.ref('/config/theme').on('value', snap => {
    const t = snap.val();
    if(t && t.primary) {
      document.documentElement.style.setProperty('--primary', t.primary);
      document.documentElement.style.setProperty('--primary-light', t.primaryLight || lightenColor(t.primary, 20));
      document.documentElement.style.setProperty('--primary-dark', t.primaryDark || darkenColor(t.primary, 20));
      document.documentElement.style.setProperty('--primary-glow', hexToRgba(t.primary, 0.22));
    }
  });
}

function loadStoreConfig() {
  db.ref('/config/store').on('value', snap => {
    const cfg = snap.val();
    if(!cfg) return;
    if(cfg.nomeLoja) {
      const logo = document.getElementById('navLogo');
      if(logo) { logo.innerHTML = escHtml(cfg.nomeLoja) + '<span>.</span>'; }
      const footerLogo = document.querySelector('.footer-logo');
      if(footerLogo) footerLogo.innerHTML = escHtml(cfg.nomeLoja) + '<span>.</span>';
      document.title = (cfg.nomeLoja||'ZKN') + ' — ' + (cfg.tagline||'Ferramentas Digitais');
    }
    if(cfg.heroBadge) { const el = document.getElementById('heroBadge'); if(el) el.textContent = cfg.heroBadge; }
    if(cfg.heroTitle) { const el = document.getElementById('heroTitle'); if(el) el.innerHTML = cfg.heroTitle; }
    if(cfg.heroSubtitle) { const el = document.getElementById('heroSubtitle'); if(el) el.textContent = cfg.heroSubtitle; }
    if(cfg.footerText) { const el = document.getElementById('footerText'); if(el) el.textContent = cfg.footerText; }
    if(cfg.contactText) { const el = document.getElementById('contactText'); if(el) el.textContent = cfg.contactText; }
    if(cfg.whatsapp) {
      whatsappNumber = cfg.whatsapp.replace(/\D/g,'');
      const links = [document.getElementById('whatsappLink'), document.getElementById('whatsappFloat'), document.getElementById('whatsappSuccessLink')];
      links.forEach(l => { if(l) l.href = 'https://wa.me/' + whatsappNumber; });
    }
  });
}

function lightenColor(hex, pct) {
  const n = parseInt(hex.replace('#',''),16);
  const r = Math.min(255,(n>>16)+pct*2.55|0), g = Math.min(255,((n>>8)&0xff)+pct*2.55|0), b = Math.min(255,(n&0xff)+pct*2.55|0);
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function darkenColor(hex, pct) {
  const n = parseInt(hex.replace('#',''),16);
  const r = Math.max(0,(n>>16)-pct*2.55|0), g = Math.max(0,((n>>8)&0xff)-pct*2.55|0), b = Math.max(0,(n&0xff)-pct*2.55|0);
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function hexToRgba(hex, a) {
  const n = parseInt(hex.replace('#',''),16);
  return `rgba(${n>>16},${(n>>8)&0xff},${n&0xff},${a})`;
}

window.openProductDetail = function(id) {
  const p = allProducts[id];
  if(!p) return;
  const avail = isProductAvailable(p);
  const precoFinal = getPrecoFinal(p);
  const favs = getFavorites();
  const isFav = favs.includes(id);
  const rating = getProductRating(id);
  const productReviews = Object.values(allReviews).filter(r => r.productId === id && r.aprovado).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  let imgHtml = p.imagem ? `<img src="${escHtml(p.imagem)}" alt="${escHtml(p.nome)}" onerror="this.parentElement.innerHTML='${escHtml(p.icone)}'">` : escHtml(p.icone);

  let ratingBar = '';
  if(rating.count > 0) {
    const counts = [5,4,3,2,1].map(n => ({n, c: productReviews.filter(r=>Math.round(r.nota)===n).length}));
    ratingBar = `
    <div class="reviews-summary">
      <div class="reviews-avg">
        <span class="reviews-avg-num">${rating.avg}</span>
        <div class="reviews-avg-stars">${renderStars(rating.avg)}</div>
        <div class="reviews-avg-count">${rating.count} avaliação${rating.count!==1?'ões':''}</div>
      </div>
      <div class="reviews-bars">
        ${counts.map(({n,c})=>`
        <div class="review-bar-row">
          <span>${n}</span>
          <div class="review-bar-bg"><div class="review-bar-fill" style="width:${rating.count>0?Math.round(c/rating.count*100):0}%"></div></div>
          <span class="review-bar-count">${c}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  let reviewsList = '';
  if(productReviews.length > 0) {
    reviewsList = `<div class="reviews-list">${productReviews.map(r=>`
      <div class="review-item">
        <div class="review-item-header">
          <span class="review-user">👤 ${escHtml(r.username||'Anônimo')}</span>
          <span class="review-stars">${renderStars(r.nota)}</span>
          <span class="review-date">${r.createdAt ? new Date(r.createdAt).toLocaleDateString('pt-BR') : ''}</span>
        </div>
        ${r.texto ? `<div class="review-text">${escHtml(r.texto)}</div>` : ''}
      </div>`).join('')}
    </div>`;
  } else {
    reviewsList = `<p style="font-size:0.82rem;color:var(--muted);text-align:center;padding:12px 0">Nenhuma avaliação ainda. Seja o primeiro!</p>`;
  }

  let writeReviewHtml = '';
  if(loggedUser) {
    const userReview = Object.values(allReviews).find(r => r.productId===id && r.username===loggedUser.username);
    if(userReview) {
      writeReviewHtml = `<div class="write-review-area" style="text-align:center;padding:10px"><p style="font-size:0.8rem;color:var(--success)">✓ Você já avaliou este produto</p></div>`;
    } else {
      writeReviewHtml = `
      <div class="write-review-area">
        <h5>Deixar avaliação</h5>
        <div class="star-picker" id="starPicker_${escHtml(id)}">
          <button onclick="setReviewStar('${escHtml(id)}',1)" title="1 estrela">☆</button>
          <button onclick="setReviewStar('${escHtml(id)}',2)" title="2 estrelas">☆</button>
          <button onclick="setReviewStar('${escHtml(id)}',3)" title="3 estrelas">☆</button>
          <button onclick="setReviewStar('${escHtml(id)}',4)" title="4 estrelas">☆</button>
          <button onclick="setReviewStar('${escHtml(id)}',5)" title="5 estrelas">☆</button>
        </div>
        <textarea class="review-textarea" id="reviewText_${escHtml(id)}" placeholder="Conte sua experiência (opcional)..."></textarea>
        <button class="btn-review-submit" onclick="submitReview('${escHtml(id)}')">Enviar avaliação</button>
      </div>`;
    }
  } else {
    writeReviewHtml = `<div class="review-login-prompt">Para avaliar, <a onclick="closeModal('productDetailModal');openModal('loginModal')">faça login</a>.</div>`;
  }

  document.getElementById('productDetailContent').innerHTML = `
    <div class="product-detail-img">${imgHtml}</div>
    <div class="product-detail-cat">${escHtml(p.categoria)}</div>
    <div class="product-detail-title">${escHtml(p.nome)}</div>
    <div class="product-detail-desc">${escHtml(p.descricao)}</div>
    <div class="product-detail-price-area">
      <div>
        ${hasDiscount(p)?`<div class="product-detail-original">${formatBRL(p.preco)}</div>`:''}
        <div class="product-detail-price">${avail?formatBRL(precoFinal):'Esgotado'}</div>
      </div>
      ${hasDiscount(p)?`<div class="product-detail-discount">-${p.desconto}%</div>`:''}
    </div>
    <div class="product-detail-actions">
      <button class="btn-add-cart" onclick="addToCart('${escHtml(id)}');closeModal('productDetailModal')" ${!avail?'disabled':''} style="flex:1;padding:13px">
        ${avail?'+ Adicionar ao carrinho':'Indisponível'}
      </button>
      <button class="btn-detail${isFav?' active':''}" onclick="toggleFavorite('${escHtml(id)}')" style="padding:13px">❤</button>
    </div>
    <div class="product-detail-stock">${avail?`${p.estoque} unidade${p.estoque!==1?'s':''} disponível${p.estoque!==1?'eis':''}`:''}</div>
    <div class="reviews-section">
      <h4>⭐ Avaliações ${rating.count>0?`<span style="color:var(--muted);font-weight:400;font-size:0.8rem">(${rating.count})</span>`:''}</h4>
      ${ratingBar}
      ${reviewsList}
      ${writeReviewHtml}
    </div>
  `;

  if(window._reviewStars) delete window._reviewStars;
  openModal('productDetailModal');
};

window._reviewStars = {};

window.setReviewStar = function(productId, nota) {
  window._reviewStars[productId] = nota;
  const picker = document.getElementById('starPicker_' + productId);
  if(!picker) return;
  picker.querySelectorAll('button').forEach((btn, idx) => {
    btn.textContent = idx < nota ? '★' : '☆';
    btn.classList.toggle('active', idx < nota);
  });
};

window.submitReview = async function(productId) {
  if(!loggedUser) { openModal('loginModal'); return; }
  const nota = (window._reviewStars||{})[productId];
  if(!nota) { showToast('Selecione uma nota!', 'error'); return; }
  const textoEl = document.getElementById('reviewText_' + productId);
  const texto = textoEl ? textoEl.value.trim() : '';
  const review = {
    productId,
    username: loggedUser.username,
    uid: loggedUser.uid||'',
    nota,
    texto,
    aprovado: false,
    createdAt: Date.now(),
  };
  try {
    await db.ref('/reviews').push(review);
    showToast('Avaliação enviada! Aguarda aprovação.', 'success');
    openProductDetail(productId);
  } catch(e) {
    showToast('Erro ao enviar avaliação.', 'error');
  }
};

function addToCart(id) {
  if(!loggedUser) {
    openModal('loginGateModal');
    return;
  }
  const p = allProducts[id];
  if(!p || !isProductAvailable(p)) { showToast('Produto indisponível', 'error'); return; }
  cart.push({ id, nome: p.nome, preco: p.preco, precoFinal: getPrecoFinal(p), icone: p.icone, imagem: p.imagem });
  saveCart();
  updateCartBadge(true);
  showToast(`${p.nome} adicionado ao carrinho!`, 'success');
}

function saveCart() { localStorage.setItem('zkn_cart', JSON.stringify(cart)); }

function updateCartBadge(pop) {
  const badge = document.getElementById('cartBadge');
  if(!badge) return;
  badge.textContent = cart.length;
  badge.style.display = cart.length > 0 ? 'flex' : 'none';
  if(pop) { badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
}

function renderCart() {
  const body = document.getElementById('cartBody');
  if(!body) return;
  if(cart.length===0) {
    body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:0.9rem">Carrinho vazio</div>';
    document.getElementById('cartSummary').innerHTML = '';
    document.getElementById('cartTotal').textContent = 'R$ 0,00';
    document.getElementById('cartCouponArea').innerHTML = '';
    return;
  }
  body.innerHTML = cart.map((item,i) => {
    const imgHtml = item.imagem ? `<img src="${escHtml(item.imagem)}" alt="" onerror="this.parentElement.innerHTML='${escHtml(item.icone)}'">` : escHtml(item.icone);
    return `
    <div class="cart-item">
      <div class="cart-item-icon">${imgHtml}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(item.nome)}</div>
        <div class="cart-item-price">${formatBRL(item.precoFinal||item.preco)}</div>
      </div>
      <button class="cart-item-del" onclick="removeFromCart(${i})" title="Remover">✕</button>
    </div>`;
  }).join('');

  const { subtotal, descontoCupom, total } = calcularResumoCarrinho();

  let couponHtml = '';
  if(appliedCoupon) {
    couponHtml = `<div class="coupon-applied">✓ Cupom <strong>${escHtml(appliedCoupon.codigo)}</strong> aplicado — -${formatBRL(descontoCupom)}<button class="btn-remove-coupon" onclick="removeCoupon()">Remover</button></div>`;
  } else {
    couponHtml = `<div class="coupon-row"><input type="text" id="couponInput" placeholder="Código do cupom" style="text-transform:uppercase"/><button class="btn-apply-coupon" onclick="applyCoupon()">Aplicar</button></div>`;
  }
  document.getElementById('cartCouponArea').innerHTML = couponHtml;

  let summaryHtml = '';
  if(descontoCupom > 0) {
    summaryHtml = `<div class="cart-summary-row"><span>Subtotal</span><span>${formatBRL(subtotal)}</span></div><div class="cart-summary-row discount"><span>Desconto (cupom)</span><span>-${formatBRL(descontoCupom)}</span></div>`;
  }
  document.getElementById('cartSummary').innerHTML = summaryHtml;
  document.getElementById('cartTotal').textContent = formatBRL(total);
}

window.removeFromCart = function(i) {
  cart.splice(i, 1);
  saveCart();
  updateCartBadge();
  renderCart();
};

window.applyCoupon = function() {
  const input = document.getElementById('couponInput');
  if(!input) return;
  const code = input.value.trim().toUpperCase();
  if(!code) { showToast('Digite um código de cupom.', 'error'); return; }
  const { subtotal } = calcularResumoCarrinho();
  const found = Object.values(allCoupons).find(c => c.codigo === code);
  if(!found) { showToast('Cupom não encontrado.', 'error'); return; }
  const result = validarCupom(found, subtotal);
  if(result.valido) {
    appliedCoupon = found;
    showToast('Cupom aplicado com sucesso!', 'success');
    renderCart();
  } else {
    showToast(result.msg, 'error');
  }
};

window.removeCoupon = function() {
  appliedCoupon = null;
  showToast('Cupom removido');
  renderCart();
};

const btnOpenCart = document.getElementById('btnOpenCart');
if(btnOpenCart) btnOpenCart.addEventListener('click', () => {
  if(!loggedUser) { openModal('loginGateModal'); return; }
  renderCart();
  openModal('cartModal');
});

function gerarPix(valor) {
  const chave = normalizarPixChave(pixChave);
  const nome = pixNomeRecebedor.slice(0,25)||'ZKN STORE';
  const cidade = "BRASIL";
  const txid = "ZKN" + Date.now();
  function fmt(id, v) { return id + String(v).length.toString().padStart(2,'0') + v; }
  let p = "000201" + "010211";
  p += fmt("26", fmt("00","BR.GOV.BCB.PIX") + fmt("01", chave));
  p += "52040000" + "5303986";
  p += fmt("54", Number(valor).toFixed(2));
  p += "5802BR";
  p += fmt("59", nome);
  p += fmt("60", cidade);
  p += fmt("62", fmt("05", txid));
  function crc16(s) {
    let c = 0xFFFF;
    for(let i=0;i<s.length;i++) { c^=s.charCodeAt(i)<<8; for(let j=0;j<8;j++) c=(c&0x8000)?(c<<1)^0x1021:c<<1; }
    return (c&0xFFFF).toString(16).toUpperCase().padStart(4,'0');
  }
  const base = p + "6304";
  currentPixPayload = base + crc16(base);
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(currentPixPayload)}`;
}

window.openPayment = function() {
  if(cart.length===0) { showToast('Adicione produtos ao carrinho primeiro!','error'); return; }
  if(!loggedUser) { closeModal('cartModal'); openModal('loginGateModal'); return; }
  closeModal('cartModal');
  const { total, descontoCupom } = calcularResumoCarrinho();
  const qrUrl = gerarPix(total);
  const img = document.getElementById('qrImg');
  const ph = document.getElementById('qrPlaceholder');
  if(img && ph) { img.src=qrUrl; img.style.display='block'; ph.style.display='none'; }
  const info = document.getElementById('paymentInfo');
  if(info) {
    let txt = `Valor: <strong style="color:var(--primary-light)">${formatBRL(total)}</strong>`;
    if(descontoCupom>0) txt += ` <small style="color:var(--success)">(cupom: -${formatBRL(descontoCupom)})</small>`;
    txt += '<br>Escaneie o QR Code para pagar via PIX.';
    info.innerHTML = txt;
  }
  const btnCopy = document.getElementById('btnCopyPix');
  if(btnCopy) btnCopy.onclick = copyPixCode;
  document.getElementById('paymentBody').style.display = 'block';
  document.getElementById('paymentSuccess').style.display = 'none';
  openModal('paymentModal');
};

function copyPixCode() {
  if(!currentPixPayload) return;
  navigator.clipboard.writeText(currentPixPayload).then(() => showToast('Código PIX copiado!','success')).catch(()=>{
    const ta = document.createElement('textarea');
    ta.value = currentPixPayload;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Código PIX copiado!','success');
  });
}

const btnPaid = document.getElementById('btnPaid');
if(btnPaid) {
  btnPaid.addEventListener('click', async () => {
    btnPaid.disabled = true;
    btnPaid.textContent = 'Confirmando...';
    if(appliedCoupon) {
      try {
        const found = Object.entries(allCoupons).find(([,c]) => c.codigo===appliedCoupon.codigo);
        if(found) await db.ref(`/coupons/${found[0]}/usos`).transaction(v => (Number(v)||0)+1);
      } catch(e) {}
    }
    setTimeout(() => {
      cart = [];
      appliedCoupon = null;
      saveCart();
      updateCartBadge();
      document.getElementById('paymentBody').style.display = 'none';
      document.getElementById('paymentSuccess').style.display = 'block';
      btnPaid.disabled = false;
      btnPaid.textContent = '✓ Já paguei';
    }, 1800);
  });
}

async function verifyUserLogin(username, password) {
  const snap = await db.ref('users').once('value');
  const users = snap.val();
  if(users) for(let k in users) if(users[k].username===username&&users[k].password===password) return {...users[k],uid:k};
  return null;
}

function setLoggedIn(user) {
  loggedUser = user;
  sessionStorage.setItem('zkn_user', JSON.stringify({ username: user.username||user.user, uid: user.uid }));
  updateLoginUI(user.username||user.user);
}

function updateLoginUI(username) {
  const loginBtn = document.getElementById('btnLogin');
  const regBtn = document.getElementById('btnRegister');
  if(loginBtn) {
    loginBtn.textContent = `👤 ${username}`;
    loginBtn.onclick = logout;
    loginBtn.classList.add('logged-in');
  }
  if(regBtn) regBtn.style.display = 'none';
}

const loginForm = document.getElementById('loginForm');
if(loginForm) {
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value;
    const err = document.getElementById('loginError');
    const btn = loginForm.querySelector('.btn-submit');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    if(user===ADMIN_USER && pass===ADMIN_PASS) {
      sessionStorage.setItem('zkn_admin','1');
      showToast('Login admin! Redirecionando...');
      setTimeout(() => window.location.href='admin.html', 1000);
      return;
    }
    const userData = await verifyUserLogin(user, pass);
    btn.disabled = false;
    btn.textContent = 'Entrar →';
    if(userData) {
      setLoggedIn(userData);
      showToast(`Bem-vindo, ${user}! 👋`, 'success');
      closeModal('loginModal');
      closeModal('loginGateModal');
    } else {
      err.style.display = 'block';
      err.textContent = 'Usuário ou senha incorretos.';
      setTimeout(() => err.style.display='none', 3000);
    }
  });
}

window.logout = function() {
  sessionStorage.removeItem('zkn_user');
  sessionStorage.removeItem('zkn_admin');
  loggedUser = null;
  cart = [];
  appliedCoupon = null;
  saveCart();
  updateCartBadge();
  const loginBtn = document.getElementById('btnLogin');
  const regBtn = document.getElementById('btnRegister');
  if(loginBtn) { loginBtn.textContent='Entrar'; loginBtn.onclick=()=>openModal('loginModal'); loginBtn.classList.remove('logged-in'); }
  if(regBtn) regBtn.style.display = '';
  showToast('Logout realizado!');
};

async function userExists(username) {
  const snap = await db.ref('users').once('value');
  const users = snap.val();
  if(users) for(let k in users) if(users[k].username===username) return true;
  return false;
}

const registerForm = document.getElementById('registerForm');
if(registerForm) {
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('regUser').value.trim();
    const password = document.getElementById('regPass').value;
    const err = document.getElementById('registerError');
    const btn = registerForm.querySelector('.btn-submit');
    if(!username||!password) { err.style.display='block'; err.textContent='Preencha todos os campos.'; return; }
    if(username.length < 3) { err.style.display='block'; err.textContent='Usuário mínimo: 3 caracteres.'; return; }
    if(password.length<4) { err.style.display='block'; err.textContent='Senha mínima: 4 caracteres.'; return; }
    if(username===ADMIN_USER) { err.style.display='block'; err.textContent='Nome de usuário reservado.'; return; }
    btn.disabled=true; btn.textContent='Criando conta...';
    if(await userExists(username)) { err.style.display='block'; err.textContent='Usuário já existe.'; btn.disabled=false; btn.textContent='Criar conta →'; return; }
    try {
      await db.ref('users/'+Date.now()).set({ username, password, createdAt: new Date().toISOString() });
      showToast('Conta criada! Faça login.', 'success');
      closeModal('registerModal');
      document.getElementById('regUser').value = '';
      document.getElementById('regPass').value = '';
      setTimeout(() => openModal('loginModal'), 500);
    } catch(er) { err.style.display='block'; err.textContent='Erro ao registrar.'; }
    btn.disabled=false; btn.textContent='Criar conta →';
  });
}

function checkLoggedUser() {
  const saved = sessionStorage.getItem('zkn_user');
  if(saved) try { const d = JSON.parse(saved); loggedUser={username:d.username,uid:d.uid}; updateLoginUI(d.username); } catch(e) {}
}

let toastTimer;
function showToast(msg, type='') {
  const toast = document.getElementById('toast');
  if(!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast show' + (type?' '+type:'');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

const searchInput = document.getElementById('productSearch');
if(searchInput) searchInput.addEventListener('input', e => { currentSearch = e.target.value.trim(); renderProducts(); });
const catSelect = document.getElementById('productCat');
if(catSelect) catSelect.addEventListener('change', e => { currentFilterCategory = e.target.value; renderProducts(); });
const sortSelect = document.getElementById('productSort');
if(sortSelect) sortSelect.addEventListener('change', e => { currentSort = e.target.value; renderProducts(); });

new IntersectionObserver(entries => {
  entries.forEach(e => { if(e.isIntersecting) { e.target.style.animationPlayState='running'; } });
}, { threshold: 0.05 }).observe(document.querySelector('.hero-content') || document.createElement('div'));

updateCartBadge();
checkLoggedUser();
loadPixChave();
loadBanner();
loadTheme();
loadStoreConfig();
loadProducts();
loadCoupons();
loadReviews();