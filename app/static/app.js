import { RATE_CATALOG, PRICE_SCOPE, emptyRate, catalogSelect, renderEditor, collectEditor,
  offerFields, collectOfferPrices, updateOfferTotal, comparisonTable, offlineExampleDraft } from './estimate.js';
const staticPreview = document.documentElement.dataset.staticPreview === 'true';
const previewBase = staticPreview ? location.pathname.replace(/(?:index\.html)?$/, '') : '';
const demoExamples = [
  {
    id: 101, title: 'Укладка плитки в ванной', category: 'Ванная и плитка',
    description: 'Демонстрационный пример. Требуется облицевать стены и пол плиткой, подготовить основание и выполнить затирку швов.',
    city: 'Казань', budget: 90000, start_when: 'В течение месяца', status: 'open',
    photo_ids: [], items: [
      { label: 'Облицовка стен плиткой', quantity: 18, unit: 'м²', note: 'Стены ванной' },
      { label: 'Укладка напольной плитки', quantity: 6, unit: 'м²', note: 'Пол' }
    ], offers: [
      { id: 501, amount: 77800, rate_prices:{11:1800,12:1800},material_prices:{111:100,112:5700}, days: 9, status: 'submitted', contractor_name: 'Пример предложения А', note: 'Включены подготовка поверхности и укладка.' },
      { id: 502, amount: 88400, rate_prices:{11:2000,12:2200},material_prices:{111:500,112:6200}, days: 7, status: 'submitted', contractor_name: 'Пример предложения Б', note: 'Включены облицовка и затирка, материалы отдельно.' }
    ]
  },
  {
    id: 102, title: 'Замена электропроводки', category: 'Электрика',
    description: 'Демонстрационный пример. Требуется заменить проводку в двухкомнатной квартире, сделать новые линии для кухни и установить розетки.',
    city: 'Краснодар', budget: 75000, start_when: 'В течение недели', status: 'open',
    photo_ids: [], items: [
      { label: 'Монтаж кабельных линий', quantity: 140, unit: 'м', note: 'Черновой монтаж' },
      { label: 'Установка розеток', quantity: 22, unit: 'шт.', note: '' }
    ], offers: [
      { id: 503, amount: 67990, rate_prices:{21:350,22:400},material_prices:{211:50,212:145},days: 5, status: 'submitted', contractor_name: 'Пример предложения В', note: 'Без стоимости кабеля и механизмов.' }
    ]
  },
  {
    id: 103, title: 'Штукатурка и покраска стен', category: 'Ремонт квартиры',
    description: 'Демонстрационный пример. Требуется подготовить стены в квартире, выровнять, загрунтовать и покрасить.',
    city: 'Москва', budget: 160000, start_when: 'По договорённости', status: 'open',
    photo_ids: [], items: [
      { label: 'Штукатурка стен', quantity: 95, unit: 'м²', note: 'Под покраску' },
      { label: 'Окраска стен', quantity: 95, unit: 'м²', note: 'Два слоя' }
    ], offers: []
  }
];
const previewRoute = () => new URLSearchParams(location.search).get('view') || '/';
const previewQuery = () => {
  const query = new URLSearchParams(location.search);
  query.delete('view');
  return query;
};
const previewUrl = route => {
  const [page, query] = route.split('?');
  return `${previewBase}?view=${encodeURIComponent(page)}${query ? '&' + query : ''}`;
};
const rewritePreviewLinks = () => {
  if (!staticPreview) return;
  document.querySelectorAll('a[data-link]').forEach(link => {
    const href = link.getAttribute('href');
    if (href?.startsWith('/')) link.setAttribute('href', previewUrl(href));
  });
};
const demonstrationRequest = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  if (url === '/api/me' && method === 'GET') return { user: null, csrf: null };
  if (url.startsWith('/api/jobs?') && method === 'GET') {
    const filter = new URL(url, location.origin).searchParams;
    const q = (filter.get('q') || '').toLocaleLowerCase('ru');
    const city = (filter.get('city') || '').toLocaleLowerCase('ru');
    const category = filter.get('category') || '';
    return { jobs: demoExamples.filter(job =>
      job.status === 'open' &&
      (!q || `${job.title} ${job.description}`.toLocaleLowerCase('ru').includes(q)) &&
      (!city || job.city.toLocaleLowerCase('ru').includes(city)) &&
      (!category || job.category === category)
    ) };
  }
  const selected = url.match(/^\/api\/jobs\/(\d+)\/select\/(\d+)$/);
  if (selected && method === 'POST') {
    const job = demoExamples.find(item => item.id === Number(selected[1]));
    if (!job) throw Error('Пример задания не найден');
    if (job.status !== 'open') throw Error('Исполнитель уже выбран');
    const offer = job.offers.find(item => item.id === Number(selected[2]));
    if (!offer) throw Error('Пример предложения не найден');
    job.status = 'selected';
    job.offers.forEach(item => { item.status = item === offer ? 'selected' : 'rejected'; });
    return { ok: true, demonstration: true };
  }
  const reopened = url.match(/^\/api\/jobs\/(\d+)\/reopen$/);
  if (reopened && method === 'POST') {
    const job = demoExamples.find(item => item.id === Number(reopened[1]));
    if (!job) throw Error('Пример задания не найден');
    job.status = 'open';
    job.offers.forEach(item => { item.status = 'submitted'; });
    return { ok: true, demonstration: true };
  }
  const jobMatch = url.match(/^\/api\/jobs\/(\d+)$/);
  if (jobMatch && method === 'GET') {
    const job = demoExamples.find(item => item.id === Number(jobMatch[1]));
    if (!job) throw Error('Пример задания не найден');
    return { ...job, is_owner: true };
  }
  throw Error('Это демонстрация интерфейса. Реальные заявки, регистрация и платежи здесь отключены.');
};
const root = document.getElementById('app');
const header = document.getElementById('header-actions');
const nav = document.getElementById('mobile-nav');
const categories = ['Ремонт квартиры','Ванная и плитка','Электрика','Сантехника','Отопление','Кровля','Фасад','Другое'];
const symbols = ['▤','◈','ϟ','◉','♨','⌂','▥','✦'];
const state = { user: null, csrf: null, photoUploads: [], estimateItems: [], pendingQuestions: [] };
const currency = value => value == null ? 'По договорённости' : new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const escapeHtml = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const text = escapeHtml;
const params = () => staticPreview ? previewQuery() : new URLSearchParams(location.search);
const path = () => staticPreview ? previewRoute() : location.pathname;
const isCustomer = () => state.user?.role === 'customer';
const isContractor = () => state.user?.role === 'contractor';
const fee = amount => amount <= 5000 ? 100 : amount <= 50000 ? 100 + .015 * (amount - 5000) : amount <= 500000 ? 775 + .01 * (amount - 50000) : 5275 + .005 * (amount - 500000);
const formatFee = amount => currency(Math.round(fee(amount)));

async function api(url, options={}) {
  if (staticPreview) return demonstrationRequest(url, options);
  const init = { credentials:'same-origin', ...options, headers:{ ...options.headers } };
  if(options.body && !(options.body instanceof FormData)) init.headers['Content-Type']='application/json';
  if(options.method && !['GET','HEAD'].includes(options.method.toUpperCase())) init.headers['X-CSRF-Token']=state.csrf || '';
  let response;
  try { response = await fetch(url, init); }
  catch { throw Error('Не удалось связаться с сервером. Проверьте подключение.'); }
  let body = {};
  try { body = await response.json(); } catch { /* non-json failure */ }
  if(!response.ok) {
    const detail = body.error || body.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(x=>x.msg).join('; ') : `Ошибка ${response.status}`;
    throw Error(message);
  }
  return body;
}
const toast = (msg) => { const node=document.getElementById('toast');node.textContent=msg;node.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>node.classList.remove('show'),4000); };
const navTo = url => {
  if (staticPreview && url.includes('view=')) {
    const query = new URL(url, location.href).searchParams;
    const page = query.get('view') || '/';
    query.delete('view');
    url = page + (query.toString() ? '?' + query.toString() : '');
  }
  history.pushState({}, '', staticPreview ? previewUrl(url) : url);
  window.scrollTo(0, 0);
  render();
};
const intro = (label,title,description='') => `<div class="page-head"><div class="eyebrow">${text(label)}</div><h1 style="margin-top:12px">${text(title)}</h1>${description?`<p>${text(description)}</p>`:''}</div>`;
const empty = (title,description,button='',url='/post') => `<div class="empty"><div style="font-size:30px;color:#36795e">✧</div><h3>${text(title)}</h3><p>${text(description)}</p>${button?`<a class="btn" href="${url}" data-link>${text(button)}</a>`:''}</div>`;
const statusText = v => ({ open:'Приём предложений',selected:'Исполнитель выбран',completed:'Завершён',cancelled:'Отменён',submitted:'Предложение отправлено',rejected:'Не выбрано',withdrawn:'Отозвано' })[v] || v;
const card = item => `<a class="card job-card" href="/jobs/${item.id}" data-link>${staticPreview ? '<div class="smallprint" style="margin-bottom:8px">ДЕМОНСТРАЦИОННЫЙ ПРИМЕР · НЕ РЕАЛЬНЫЙ ЗАКАЗ</div>' : ''}<div class="job-card-head"><span class="pill">${text(item.category)}</span><span class="smallprint">${text(item.city)}</span></div><h3>${text(item.title)}</h3><p>${text(item.description).slice(0,190)}${item.description.length>190?'…':''}</p><div class="job-card-bottom"><span class="price">${currency(item.budget)}</span><span class="smallprint">${text(item.start_when)} &nbsp; ↗</span></div></a>`;

function updateNav() {
  const account = state.user ? `<a class="btn ghost small" href="${isCustomer()?'/my-jobs':'/my-offers'}" data-link>Личный кабинет</a><button class="btn small primary" data-action="logout">Выйти</button>` : `<a class="btn ghost small" href="/auth" data-link>Войти</a><a class="btn small primary" href="/auth?mode=register" data-link>Регистрация</a>`;
  header.innerHTML=account;
  nav.innerHTML=[['/','⌂','Главная'],['/jobs','▦','Заявки'],['/post','＋','Создать'],[state.user?(isCustomer()?'/my-jobs':'/my-offers'):'/auth','◯','Профиль']].map(([url,icon,label])=>`<a href="${url}" data-link class="${path()===url?'current':''}"><span>${icon}</span>${label}</a>`).join('');
}
function main(content){ root.innerHTML=`<div class="shell">${content}</div>`; }
function home(){
root.innerHTML=`<section class="hero"><div class="shell hero-wrap"><div><div class="eyebrow">Новый способ найти исполнителя</div><h1>Ваш ремонт.<br><em>Ваши условия.</em><br>Ваш выбор.</h1><p class="hero-copy">Опишите работу один раз. Мастера и строительные компании сами предложат цену, сроки и условия. Сравните и выберите подходящего.</p><div class="hero-actions"><a href="/post" data-link class="btn">Разместить заказ <span>↗</span></a><a href="/jobs" data-link class="btn ghost">Посмотреть заявки</a></div><div class="hero-note">✓ Заказчикам бесплатно &nbsp;&nbsp; ✓ Никаких обязательств выбрать</div></div><div class="hero-graphic" aria-hidden="true"><div class="graphic-back"></div><div class="graphic-card gc-main"><div class="gc-top">Пример задания</div><div class="gc-title">Ремонт ванной комнаты</div><div class="gc-box"><span>Облицовка стен плиткой</span><strong>18 м²</strong></div><div class="gc-box"><span>Монтаж сантехники</span><strong>3 шт.</strong></div><div class="gc-box"><span>Устройство стяжки</span><strong>5 м²</strong></div><div style="margin-top:16px;font-size:11px;color:#73847b">Пример интерфейса, не реальная заявка</div></div><div class="graphic-card gc-float"><div style="display:flex;align-items:center"><span class="gc-avatar">₽</span><div><strong>Сравнивайте цены</strong><span class="muted">Выбор за вами</span></div></div></div></div></div></section>
<section class="shell content-section"><div class="section-heading"><div><div class="eyebrow">Что нужно сделать?</div><h2 style="margin-top:12px">От малого ремонта до стройки</h2></div><p>Одна площадка для разных видов работ. Сроки и цену предлагают сами исполнители.</p></div><div class="category-grid">${categories.map((c,i)=>`<a href="/jobs?category=${encodeURIComponent(c)}" data-link class="category-card"><div class="category-icon">${symbols[i]}</div><div><strong>${text(c)}</strong><div><small>Посмотреть заявки ↗</small></div></div></a>`).join('')}</div></section>
<section class="shell content-section" style="padding-top:15px"><div class="section-heading"><div><div class="eyebrow">Всё просто</div><h2 style="margin-top:12px">Три шага до выбора мастера</h2></div></div><div class="steps"><div class="step"><div class="step-no">ШАГ 01</div><h3>Опишите задачу</h3><p>Добавьте фото, город, сроки и при необходимости объёмы работ.</p></div><div class="step"><div class="step-no">ШАГ 02</div><h3>Получите предложения</h3><p>Заинтересованные исполнители бесплатно указывают свои цены и сроки.</p></div><div class="step"><div class="step-no">ШАГ 03</div><h3>Выберите сами</h3><p>Сравните предложения. Контакты получает только выбранный исполнитель после оплаты доступа.</p></div></div></section>
<section class="shell content-section" style="padding-top:5px"><div class="contrast"><div><div class="eyebrow" style="color:#9cd2b6">Для мастеров и компаний</div><h2 style="margin:12px 0">Ваш следующий заказ уже может ждать.</h2><p>Откликайтесь бесплатно. За контакт платит только тот, кого выбрал заказчик.</p></div><a class="btn" href="/jobs" data-link>Найти работу ↗</a></div></section>`;
}
async function jobsPage(){
  const p=params(); const city=p.get('city')||''; const cat=p.get('category')||''; const q=p.get('q')||'';
  main(intro('Для исполнителей','Найдите подходящую работу',staticPreview ? 'Примеры интерфейса, не реальные заказы. Поиск и фильтры можно попробовать.' : 'Реальные опубликованные заявки, без открытых телефонов и адресов.')+`<form id="filter" class="filters"><input name="q" aria-label="Поиск" placeholder="Название или вид работ" value="${text(q)}"><input name="city" aria-label="Город" placeholder="Город" value="${text(city)}"><select name="category" aria-label="Категория"><option value="">Все категории</option>${categories.map(c=>`<option ${cat===c?'selected':''} value="${text(c)}">${text(c)}</option>`).join('')}</select><button class="btn" type="submit">Найти</button></form><div id="job-feed">${empty('Загрузка','Получаем актуальные заявки')}</div>`);
  try {const v=await api('/api/jobs?'+new URLSearchParams({city,category:cat,q}));document.getElementById('job-feed').innerHTML=v.jobs.length?v.jobs.map(card).join(''):empty('Пока нет заявок','В этом городе или категории ещё нет открытых заданий.','Разместить заказ');}
  catch(e){ document.getElementById('job-feed').innerHTML=empty('Не удалось загрузить задания',e.message); }
}
function postPage() {
  const demo = staticPreview;
  if (!demo && !state.user) {
    main(intro('Размещение заказа','Создайте бесплатную заявку') + empty('Нужен аккаунт','Войдите как заказчик, чтобы опубликовать задание.','Войти или зарегистрироваться','/auth?mode=register'));
    return;
  }
  if (!demo && !isCustomer()) {
    main(intro('Размещение заказа','Заявки размещают заказчики')+empty('Это аккаунт исполнителя','Используйте аккаунт заказчика.'));
    return;
  }
  const userCity = state.user?.city || '';
  const aiLabel = demo ? 'Собрать пример без ИИ' : 'Составить смету с ИИ';
  main(intro(demo ? 'Демо' : 'Заказ','Что нужно сделать?')+
    `<div class="form-shell wide"><form id="${demo ? 'demo-post' : 'create-job'}">
      <div class="card form-section"><div class="eyebrow">01 · Описание</div>
        <div class="field" style="margin-top:15px"><label>Что нужно сделать? *</label>
          <textarea id="free-description" name="description" required minlength="20" maxlength="2500" placeholder="Например: нужно облицевать стены ванной плиткой, 18 м². Квартира на 5 этаже, лифта нет. Материалы должен предоставить мастер."></textarea>
</div>
        <div class="hero-actions"><button type="button" class="btn" data-action="generate-draft">${aiLabel} ↗</button>
</div>
        <div id="draft-questions" class="smallprint"></div>
      </div>
      <div class="card form-section estimate-section"><div class="eyebrow">02 · Работы и материалы</div>
        <div class="catalog-bar">${catalogSelect()}<button type="button" class="btn ghost small catalog-add" data-action="add-catalog-rate" aria-label="Добавить из каталога" title="Добавить из каталога">+</button>
          <button type="button" class="btn ghost small" data-action="add-rate">+ Своя</button></div>
        <div id="estimate-editor">${renderEditor(state.estimateItems)}</div>
      </div>
      <div class="card form-section"><div class="eyebrow">03 · Условия</div>
        <div class="form-grid" style="margin-top:16px">
        <div class="field"><label>Название заявки *</label><input required name="title" minlength="6" maxlength="140" placeholder="Например, ремонт ванной"></div>
        <div class="field"><label>Город *</label><input required name="city" minlength="2" maxlength="70" value="${text(userCity)}" placeholder="Город"></div>
        <div class="field"><label>Вид работ</label><select name="category">${categories.map(c=>`<option>${text(c)}</option>`).join('')}</select></div>
        <div class="field"><label>Этаж *</label><input name="floor" required type="number" min="0" max="200" step="1" placeholder="0 — участок или первый уровень"></div>
        <div class="field"><label>Грузовой / пассажирский лифт</label><select name="elevator"><option value="unknown">Не знаю / неприменимо</option><option value="yes">Есть</option><option value="no">Нет</option></select></div>
        <div class="field"><label>Материалы предоставляет</label><select name="materials_policy"><option value="contractor">Исполнитель</option><option value="customer">Заказчик</option><option value="discuss">Обсудим</option></select></div>
        <div class="field"><label>Бюджет (необязательно), ₽</label><input name="budget" min="1" step="1" type="number"></div>
        <div class="field"><label>Когда нужно начать</label><select name="start_when"><option>По договорённости</option><option>Как можно скорее</option><option>В течение недели</option><option>В течение месяца</option><option>Позже</option></select></div></div>
        <div class="field"><label>Другие условия, влияющие на стоимость</label>
          <textarea name="access_details" maxlength="1000" placeholder="Возможность разгрузки, парковка, расстояние переноски, работа по часам, наличие воды и электричества, демонтаж, вывоз мусора, потребность в лесах/подмостях..."></textarea></div>

      </div>
      ${demo ? '<div class="notice warn">Публичное демо: здесь можно посмотреть подготовленный черновик. Данные не сохраняются, контакты не собираются.</div>' :
        `<div class="card form-section"><div class="eyebrow">04 · Контакт и фото</div>
           <div class="field" style="margin-top:14px"><label>Телефон *</label><input name="phone" type="tel" minlength="10" maxlength="25" required placeholder="+7 900 000-00-00"><small class="smallprint">Скрыт от исполнителей до подтверждённой оплаты доступа.</small></div>
           <div class="field"><label>До 5 фотографий (5 МБ каждая)</label><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></div>
           <label class="smallprint"><input type="checkbox" required name="consent"> Согласен на обработку данных и раскрытие контакта выбранному исполнителю после оплаты.</label>
         </div>`}
      <div class="form-actions"><button class="btn" type="submit">${demo ? 'Посмотреть черновик' : 'Опубликовать бесплатно'} ↗</button></div>
    </form></div>`);
}

function snapshotRates() {
  const editor = document.getElementById('estimate-editor');
  if (editor) state.estimateItems = collectEditor(editor,{strict:false});
}
function refreshRates() {
  const editor = document.getElementById('estimate-editor');
  if (editor) editor.innerHTML = renderEditor(state.estimateItems);
}

async function detailPage(id) {
  main(intro('Заявка','Загрузка задания...'));
  try {
    const j=await api(`/api/jobs/${id}`);
    const picked=j.offers.find(o=>o.status==='selected');
    const photos=j.photo_ids.length && !staticPreview ? `<div class="gallery">${j.photo_ids.map(x=>`<img loading="lazy" class="preview-img" src="/api/photos/${x}" alt="Фото объекта">`).join('')}</div>` : '';
    const materialText = {contractor:'Исполнитель',customer:'Заказчик',discuss:'По согласованию'};
    const conditions=`<div class="card"><h3>Условия объекта</h3>
      <div class="info-row"><span>Город</span><strong>${text(j.city)}</strong></div>
      <div class="info-row"><span>Этаж</span><strong>${j.floor ?? 'Не указан'}</strong></div>
      <div class="info-row"><span>Лифт</span><strong>${({yes:'Есть',no:'Нет',unknown:'Не уточнено'})[j.elevator] || 'Не уточнено'}</strong></div>
      <div class="info-row"><span>Материалы</span><strong>${materialText[j.materials_policy] || 'По согласованию'}</strong></div>
      <div class="info-row"><span>Бюджет</span><strong>${currency(j.budget)}</strong></div>
      <div class="info-row"><span>Начало</span><strong>${text(j.start_when)}</strong></div>
      ${j.access_details ? `<p class="smallprint" style="margin-top:12px;white-space:pre-wrap">${text(j.access_details)}</p>` : ''}</div>`;
    const rows=j.items.map(r=>`<div class="rate-preview"><div class="rate-preview-main"><strong>${text(r.label)}</strong><span>${r.quantity} ${text(r.unit)}</span></div>
      ${r.materials.map(m=>`<div class="rate-preview-material"><span>↳ ${text(m.label)}</span><span>${m.quantity} ${text(m.unit)}</span></div>`).join('')}</div>`).join('');
    const owner=j.is_owner ? `<div class="card" style="margin-top:18px"><h3>Сравнение · ${j.offers.length}</h3>
      ${comparisonTable(j.items,j.offers,j.id,j.status==='open')}
      ${j.status==='selected'?`<div class="hero-actions" style="margin-top:20px"><button class="btn ghost small" data-action="reopen" data-job="${j.id}">Вернуть в поиск</button>${!staticPreview?`<button class="btn small" data-action="complete" data-job="${j.id}">Работы завершены</button>`:''}</div>`:''}
      ${!staticPreview && ['open','selected'].includes(j.status)?`<button class="btn ghost danger small" data-action="cancel" data-job="${j.id}" style="margin-top:12px">Отменить заказ</button>`:''}
      </div>`:'';
    const ownOffer=(!j.is_owner && j.offers.length) ? `<div class="notice">Ваш отклик: ${currency(j.offers[0].amount)} · ${statusText(j.offers[0].status)}</div>`:'';
    const quote=isContractor()&&j.status==='open'&&!j.offers.length ? `<div class="card offer-card"><h3>Подайте предложение</h3><details class="scope-details"><summary>Что входит в цену</summary><p>${text(PRICE_SCOPE)}</p></details>${j.materials_policy==='customer'?'<div class="notice">Материалы предоставляет заказчик: стоимость материалов в вашем предложении должна быть 0 ₽.</div>':''}
      <form id="offer-form" data-job="${j.id}"><div class="field quote-field">${offerFields(j.items,j.materials_policy)}</div>
        <div class="quote-grand">Итого <strong id="offer-sum">—</strong></div>
        <div class="form-grid"><div class="field"><label>Срок, дней</label><input name="days" type="number" min="1" max="365" value="7" required></div></div>
        <div class="field"><label>Примечание / исключения (если есть)</label><textarea name="note" maxlength="1500"></textarea></div>
        <div id="fee-preview" class="smallprint"></div><label class="smallprint"><input type="checkbox" required name="accept_scope"> Я включил все обязательные расходы в расценки и указал исключения.</label><button class="btn block" type="submit">Отправить бесплатно</button></form></div>` : '';
    const lock=isContractor()&&picked&&j.offers.some(o=>o.id===picked.id)?`<div class="card"><h3>Заказчик выбрал вас</h3><p class="smallprint">Стоимость открытия контакта: ${formatFee(picked.amount)}</p><button class="btn block" disabled>Оплатить и открыть контакт</button><p class="smallprint">Оплата ещё не подключена, данные закрыты.</p></div>`:'';
    main(intro('Описание заказа',j.title,`${j.city} · ${j.category}${staticPreview?' · ДЕМОНСТРАЦИЯ':''}`)+
       `<div class="page-grid"><div><div class="card" style="margin-bottom:18px"><div class="status-row"><span class="pill">${statusText(j.status)}</span><span class="smallprint">№ ${j.id}</span></div>
       <p style="white-space:pre-wrap;margin:18px 0">${text(j.description)}</p>${photos}<h3>Работы и материалы</h3>${rows || '<p class="muted">Позиции не указаны.</p>'}</div>${owner}</div>
       <aside class="aside">${conditions}${ownOffer}${quote}${lock}${!state.user&&!staticPreview?'<a class="btn block" href="/auth" data-link>Войти, чтобы откликнуться</a>':''}</aside></div>`);
    rewritePreviewLinks();
  } catch(e) { main(intro('Заявка','Ошибка загрузки')+empty('Не удалось открыть',e.message,'К заданиям','/jobs')); }
}

async function myJobs(){if(staticPreview){main(intro('Пример кабинета','Мои заказы','Пример заявок для демонстрации сравнения предложений.')+`<div class="notice warn" style="margin-bottom:20px">Вымышленные данные · изменения действуют только до обновления страницы</div>`+demoExamples.map(card).join(''));return;}if(!isCustomer())return guardPage('Мои заказы');main(intro('Личный кабинет','Мои заказы')+'<div id="myfeed">Загрузка...</div>');try{const d=await api('/api/my-jobs');document.getElementById('myfeed').innerHTML=d.jobs.length?d.jobs.map(j=>`<a href="/jobs/${j.id}" data-link class="card job-card"><div class="job-card-head"><span class="pill">${text(statusText(j.status))}</span><span class="smallprint">#${j.id}</span></div><h3>${text(j.title)}</h3><div class="job-card-bottom"><span class="price">${currency(j.budget)}</span><span>${text(j.city)} ↗</span></div></a>`).join(''):empty('Пока нет заказов','Создайте первую заявку и получите предложения мастеров.','Разместить заказ');}catch(e){toast(e.message)}}
async function myOffers(){if(staticPreview){main(intro('Пример кабинета','Мои предложения','Когда мастер отправит предложение, оно появится в его личном кабинете.')+empty('Отклики пока демонстрационные','Реальные отклики будут доступны после подключения сервера.','Посмотреть примеры заданий','/jobs'));return;}if(!isContractor())return guardPage('Мои предложения');main(intro('Личный кабинет','Мои предложения')+'<div id="myfeed">Загрузка...</div>');try{const d=await api('/api/my-offers');document.getElementById('myfeed').innerHTML=d.offers.length?d.offers.map(o=>`<a href="/jobs/${o.job_id}" data-link class="card job-card"><div class="job-card-head"><span class="pill ${o.status==='selected'?'':'neutral'}">${text(statusText(o.status))}</span><span class="smallprint">${text(o.city)}</span></div><h3>${text(o.title)}</h3><div class="job-card-bottom"><span class="price">${currency(o.amount)}</span><span>Срок ${o.days} дн. ↗</span></div></a>`).join(''):empty('Пока нет предложений','Найдите подходящую заявку и предложите свою цену бесплатно.','Найти работу','/jobs');}catch(e){toast(e.message)}}
function guardPage(title){main(intro('Личный кабинет',title)+empty('Недоступно для этого аккаунта','Войдите с соответствующей ролью.','Перейти ко входу','/auth'));}
function authPage(){
 if (staticPreview) {
   main(intro('Демо-режим','Личный кабинет', 'В этой опубликованной версии можно оценить интерфейс без регистрации.') +
     `<div class="card" style="max-width:660px"><h3>Регистрация пока отключена</h3>
      <p class="muted" style="margin:14px 0 20px">GitHub Pages не запускает сервер регистрации и не хранит заказы. Здесь нельзя оставлять телефон или пароль. Просмотрите демонстрационные заявки и калькулятор.</p>
      <div class="hero-actions"><a class="btn" href="/jobs" data-link>Посмотреть заявки ↗</a><a class="btn ghost" href="/pricing" data-link>Рассчитать тариф</a></div>
     </div>`);
   return;
 }
 const register=params().get('mode')==='register';
 main(`<div class="auth-page"><div class="eyebrow">Личный кабинет</div><h1 style="margin-top:12px">${register?'Создать аккаунт':'С возвращением'}</h1><p class="muted">${register?'Зарегистрируйтесь как заказчик или исполнитель.':'Войдите, чтобы управлять заявками.'}</p><form id="auth-form" class="card"><input type="hidden" name="mode" value="${register?'register':'login'}">${register?`<div class="field"><label>Я хочу</label><div class="role-picker"><label><input name="role" type="radio" value="customer" checked>Заказывать работы</label><label><input name="role" type="radio" value="contractor">Находить работу</label></div></div><div class="field"><label>Как к вам обращаться</label><input name="name" minlength="2" maxlength="80" required placeholder="Имя или название компании"></div><div class="field"><label>Город</label><input name="city" minlength="2" maxlength="70" required placeholder="Например, Казань"></div>`:''}<div class="field"><label>Email</label><input name="email" type="email" maxlength="160" required autocomplete="email" placeholder="you@example.ru"></div><div class="field"><label>Пароль</label><input name="password" type="password" minlength="10" maxlength="128" required autocomplete="${register?'new-password':'current-password'}" placeholder="Не менее 10 символов"></div><button class="btn block">${register?'Зарегистрироваться':'Войти'}</button><p class="smallprint" style="margin-top:17px;text-align:center">${register?'Уже есть аккаунт?':'Впервые здесь?'} <a style="color:var(--green);font-weight:800" href="${register?'/auth':'/auth?mode=register'}" data-link>${register?'Войти':'Создать аккаунт'}</a></p></form></div>`);
}
function profilePage(){if(staticPreview){authPage();return;}if(!state.user)return guardPage('Профиль');main(intro('Личный кабинет','Мой профиль')+`<div class="form-shell"><form id="profile-form" class="card"><div class="field"><label>Отображаемое имя</label><input name="name" required minlength="2" maxlength="80" value="${text(state.user.display_name)}"></div><div class="field"><label>Город</label><input name="city" required minlength="2" maxlength="70" value="${text(state.user.city)}"></div>${isContractor()?`<div class="field"><label>Специализации</label><input name="specialties" maxlength="220" value="${text(state.user.specialties)}" placeholder="Плитка, сантехника, отделка"></div><div class="field"><label>О себе и опыте</label><textarea name="about" maxlength="900">${text(state.user.about)}</textarea></div>`:''}<div class="notice" style="margin-bottom:18px">${isContractor()?'Профиль исполнителя':'Профиль заказчика'}. Подтверждённые рейтинги появятся после запуска заказов и реальной истории выполнения.</div><button class="btn">Сохранить изменения</button></form></div>`)}
function pricing(){main(intro('Открытые условия','Прозрачные тарифы','Заказчикам бесплатно. Мастера не платят за отклики. Плата возникает лишь когда заказчик выбрал именно вас.')+`<div class="notice warn" style="margin-bottom:24px">Тестовый режим: оплата контактов ещё не подключена, поэтому списания сейчас невозможны.</div><div class="fee-grid"><div class="fee-card"><div class="smallprint">Заказ до 5 000 ₽</div><strong class="price">100 ₽</strong><div class="smallprint">Фиксированная плата</div></div><div class="fee-card"><div class="smallprint">До 50 000 ₽</div><strong class="price">+ 1,5%</strong><div class="smallprint">С суммы сверх 5 000 ₽</div></div><div class="fee-card"><div class="smallprint">До 500 000 ₽</div><strong class="price">+ 1%</strong><div class="smallprint">С суммы сверх 50 000 ₽</div></div><div class="fee-card"><div class="smallprint">Свыше 500 000 ₽</div><strong class="price">+ 0,5%</strong><div class="smallprint">С суммы сверх 500 000 ₽</div></div></div><div class="card" style="margin-top:24px;max-width:670px"><h3>Рассчитайте цену контакта</h3><div class="field" style="margin-top:20px"><label>Сумма предложения, ₽</label><input type="number" id="calc-amount" value="100000" min="1"></div><div class="notice" id="calc-fee">За контакт: ${formatFee(100000)}</div><p class="smallprint">Прогрессивная шкала без резкого снижения цены при переходе между диапазонами.</p></div>`);}
function how(){main(intro('О сервисе','Как работает «Подряди»','Мы соединяем заказчиков с мастерами, а решение всегда остаётся за вами.')+`<div class="steps"><div class="step"><div class="step-no">01 / ЗАКАЗЧИК</div><h3>Опишите работы</h3><p>Фотографии, город, объёмы, срок и ориентировочная цена. Публикация бесплатна.</p></div><div class="step"><div class="step-no">02 / ИСПОЛНИТЕЛЬ</div><h3>Предложите цены</h3><p>Отдельно на работы и материалы. Все расходы включены в расценки. Отклик бесплатен.</p></div><div class="step"><div class="step-no">03 / ВЫБОР</div><h3>Сравните предложения</h3><p>Заказчик выбирает одного мастера. Он оплачивает доступ к контакту после подключения эквайринга.</p></div></div><div class="page-content" style="padding-top:30px"><h2>Кто оплачивает строительные работы?</h2><p>Заказчик и подрядчик договариваются напрямую. Платформа не принимает предоплаты за ремонт, не управляет строительными платежами и не выступает подрядчиком.</p><h2>Реальные ли здесь рейтинги?</h2><p>В MVP нет вымышленных оценок. В будущем отзывы будут доступны после подтверждения фактически выполненного заказа.</p></div>`)}
function roadmap(){main(intro('О запуске','План развития','Это предзапусковой прототип, а не действующая платёжная площадка.')+`<div class="page-content card"><h2>Что доступно в прототипе</h2><ul><li>Аккаунты заказчиков и исполнителей</li><li>Заявки с ведомостью работ, фотографиями и статусами</li><li>Отклики, сравнение цен и выбор исполнителя</li><li>Защита контактов до подтверждённой оплаты</li></ul><h2>Перед публичным запуском</h2><ul><li>Разместить данные российских пользователей в инфраструктуре, соответствующей требованиям 152-ФЗ</li><li>Подключить настоящий эквайринг с проверяемым серверным webhook, чеки, возвраты</li><li>Верифицировать телефоны, документы исполнителей и модерировать объявления и фотографии</li><li>Подготовить договоры, политику обработки данных и поддержку обращений</li><li>Провести пилот в одном городе без вымышленных отзывов и статистики</li></ul></div>`)}
async function render(){updateNav();const p=path();if(p==='/')home();else if(p==='/jobs')await jobsPage();else if(/^\/jobs\/\d+$/.test(p))await detailPage(Number(p.split('/').pop()));else if(p==='/post')postPage();else if(p==='/my-jobs')await myJobs();else if(p==='/my-offers')await myOffers();else if(p==='/profile')profilePage();else if(p==='/auth')authPage();else if(p==='/pricing')pricing();else if(p==='/how')how();else if(p==='/roadmap')roadmap();else main(intro('Ошибка 404','Такой страницы нет')+empty('Страница не найдена','Возможно, её адрес изменился.','На главную','/'));rewritePreviewLinks();}
function formPayload(form){const f=new FormData(form);return Object.fromEntries(f.entries());}
async function submitForm(form){
 const fields=formPayload(form);
 try{
  const button=form.querySelector('button[type=submit],button:not([type])');if(button){button.disabled=true;button.dataset.original=button.textContent;button.textContent='Подождите...'}
  if(form.id==='demo-post' && staticPreview) {
    const items = collectEditor(document.getElementById('estimate-editor'));
    const title=text(fields.title.trim());
    const description=text(fields.description.trim());
    const city=text(fields.city.trim());
    const materialRows=items.reduce((n,r)=>n+r.materials.length,0);
    main(intro('Предпросмотр','Ваш черновик','Демо: ничего не опубликовано и не сохранено.')+
      `<div class="card" style="max-width:950px"><span class="pill">ДЕМОНСТРАЦИЯ</span><h2 style="margin:16px 0">${title}</h2>
      <p class="muted">${city} · этаж ${text(fields.floor)} · ${text(fields.category)}</p>
      <p style="white-space:pre-wrap;margin:20px 0">${description}</p>
      <h3>Расценки: ${items.length}, материалы: ${materialRows}</h3>
      ${items.map(r=>`<div class="rate-preview"><div class="rate-preview-main"><strong>${text(r.label)}</strong><span>${r.quantity} ${text(r.unit)}</span></div>${r.materials.map(m=>`<div class="rate-preview-material"><span>↳ ${text(m.label)}</span><span>${m.quantity} ${text(m.unit)}</span></div>`).join('')}</div>`).join('')}
      <p class="smallprint">Реальные заявки и ИИ появятся после подключения защищённого backend и API.</p><a href="/post" data-link class="btn ghost">Вернуться к созданию</a></div>`);
    rewritePreviewLinks();return;
  }
  if(form.id==='auth-form'){
   const url=fields.mode==='register'?'/api/register':'/api/login';const data={email:fields.email,password:fields.password};if(fields.mode==='register')Object.assign(data,{role:fields.role,name:fields.name,city:fields.city});
   await api(url,{method:'POST',body:JSON.stringify(data)});await loadSession();toast('Вы вошли в аккаунт');navTo(isCustomer()?'/my-jobs':'/my-offers');return;
  }
  if(form.id==='profile-form'){
   await api('/api/profile',{method:'PATCH',body:JSON.stringify({name:fields.name,city:fields.city,specialties:fields.specialties||'',about:fields.about||''})});await loadSession();toast('Профиль сохранён');render();return;
  }
  if(form.id==='create-job'){
   const items=collectEditor(document.getElementById('estimate-editor'));
   const raw={title:fields.title,description:fields.description,city:fields.city,category:fields.category,
     budget:fields.budget?Number(fields.budget):null,start_when:fields.start_when,phone:fields.phone,items,
     floor:Number(fields.floor),elevator:fields.elevator,materials_policy:fields.materials_policy,access_details:fields.access_details};
   const files=[...form.querySelector('[name=photos]').files];if(files.length>5)throw Error('Не более 5 фото');if(files.some(x=>x.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(x.type)))throw Error('Фото: только JPEG/PNG/WEBP до 5 МБ');
   const r=await api('/api/jobs',{method:'POST',body:JSON.stringify(raw)});
   let failed=0;for(const file of files){const fd=new FormData();fd.append('upload',file);try{await api(`/api/jobs/${r.id}/photos`,{method:'POST',body:fd})}catch{failed++}}
   toast(failed?`Заказ опубликован. ${failed} фото не загрузились.`:'Заказ опубликован');navTo(`/jobs/${r.id}`);return;
  }
  if(form.id==='offer-form'){
   const id=Number(form.dataset.job);const job=await api(`/api/jobs/${id}`);const prices=collectOfferPrices(form,job.items);await api(`/api/jobs/${id}/offers`,{method:'POST',body:JSON.stringify({...prices,days:Number(fields.days),note:fields.note,accept_scope:Boolean(form.elements.accept_scope?.checked)})});toast('Предложение отправлено');render();return;
  }
  if(form.id==='filter'){navTo('/jobs?'+new URLSearchParams({city:fields.city,category:fields.category,q:fields.q}));return;}
 }catch(e){toast(e.message)}finally{const button=form.querySelector('button[disabled][data-original]');if(button){button.disabled=false;button.textContent=button.dataset.original;delete button.dataset.original}}
}
async function loadSession(){try{const d=await api('/api/me');state.user=d.user;state.csrf=d.csrf;}catch{state.user=null;state.csrf=null}}
document.addEventListener('click',async e=>{
 const link=e.target.closest('[data-link]');if(link&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();navTo(link.getAttribute('href'));return;}
 const btn=e.target.closest('[data-action]');if(!btn)return;
 if(['add-rate','add-catalog-rate','delete-rate','add-material','delete-material'].includes(btn.dataset.action)){
   snapshotRates();
   const index=Number(btn.dataset.index);
   if(btn.dataset.action==='add-rate')state.estimateItems.push(emptyRate());
   if(btn.dataset.action==='add-catalog-rate'){
     const idx=document.getElementById('quick-rate').value;
     if(idx==='')return toast('Выберите расценку из каталога');
     const r=RATE_CATALOG[Number(idx)];state.estimateItems.push(emptyRate(r[0],r[1],r[2]));
   }
   if(btn.dataset.action==='delete-rate')state.estimateItems.splice(index,1);
   if(btn.dataset.action==='add-material')state.estimateItems[index].materials.push({label:'',unit:'шт.',quantity:null});
   if(btn.dataset.action==='delete-material')state.estimateItems[index].materials.splice(Number(btn.dataset.material),1);
   if(state.estimateItems.length>40){state.estimateItems.length=40;return toast('Не больше 40 расценок')}
   refreshRates();return;
 }
 if(btn.dataset.action==='generate-draft'){
   const input=document.getElementById('free-description');
   const prompt=input?.value.trim()||'';
   if(prompt.length<20)return toast('Опишите работу подробнее: не менее 20 символов');
   btn.disabled=true;const old=btn.textContent;btn.textContent='Составляем...';
   try{
     const draft=staticPreview?offlineExampleDraft(prompt):await api('/api/estimate/draft',{method:'POST',body:JSON.stringify({text:prompt})});
     state.estimateItems=draft.items;
     refreshRates();
     const field=document.querySelector('[name=title]');if(field)field.value=draft.title;
     const category=document.querySelector('[name=category]');if(category && categories.includes(draft.category))category.value=draft.category;
     const floor=document.querySelector('[name=floor]');if(floor&&draft.floor!=null)floor.value=draft.floor;
     const elevator=document.querySelector('[name=elevator]');if(elevator&&draft.elevator)elevator.value=draft.elevator;
     const questions=document.getElementById('draft-questions');
     questions.textContent=[draft.disclaimer, ...(draft.questions||[])].filter(Boolean).join(' · ');
     toast('Черновик готов. Проверьте объёмы и материалы');
   }catch(err){toast(err.message)}finally{btn.disabled=false;btn.textContent=old}
   return;
 }
 if(btn.dataset.action==='logout'){try{await api('/api/logout',{method:'POST'});await loadSession();navTo('/')}catch(err){toast(err.message)}}
 if(btn.dataset.action==='select-offer'){
  if(!confirm('Выбрать этого исполнителя? После выбора новые предложения приниматься не будут.'))return;
  try{await api(`/api/jobs/${btn.dataset.job}/select/${btn.dataset.offer}`,{method:'POST'});toast('Исполнитель выбран');render()}catch(err){toast(err.message)}
 }
 if(['cancel','complete'].includes(btn.dataset.action)){
  const action=btn.dataset.action;
  if(!confirm(action==='cancel'?'Отменить заказ?':'Отметить заказ выполненным? Подтвердите только после завершения работы.'))return;
  try{await api(`/api/jobs/${btn.dataset.job}/${action}`,{method:'POST'});toast(action==='cancel'?'Заказ отменён':'Заказ завершён');render()}catch(err){toast(err.message)}
 }
 if(btn.dataset.action==='reopen'){
  if(!confirm('Вернуть заказ в поиск? Выбранный исполнитель потеряет статус выбранного.'))return;
  try{await api(`/api/jobs/${btn.dataset.job}/reopen`,{method:'POST'});toast('Поиск возобновлён');render()}catch(err){toast(err.message)}
 }
});
document.addEventListener('input', e=>{
 if(e.target.id==='calc-amount'){const n=Number(e.target.value);document.getElementById('calc-fee').textContent=n>0?'За контакт: '+formatFee(n):'Укажите стоимость заказа';}
 if(e.target.classList.contains('quote-input')){
   const form=e.target.closest('#offer-form');if(form){const amount=updateOfferTotal(form);
   form.querySelector('#fee-preview').textContent=amount>0?'При выборе вас цена открытия контакта: '+formatFee(amount):'';}
 }
});
document.addEventListener('submit',e=>{e.preventDefault();submitForm(e.target)});
window.addEventListener('popstate',render);
await loadSession();render();
