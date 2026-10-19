/** Compact work rates: one work component and optional material components per rate. */
export const RATE_CATALOG = [
  ['Облицовка стен плиткой', 'м²', ['Плитка керамическая', 'Клей плиточный', 'Затирка']],
  ['Укладка напольной плитки', 'м²', ['Плитка напольная', 'Клей плиточный', 'Затирка']],
  ['Штукатурка стен', 'м²', ['Штукатурная смесь', 'Грунтовка']],
  ['Шпаклёвка стен', 'м²', ['Шпаклёвка', 'Грунтовка']],
  ['Окраска стен', 'м²', ['Краска', 'Грунтовка']],
  ['Укладка ламината', 'м²', ['Ламинат', 'Подложка']],
  ['Монтаж розеток', 'шт.', ['Розетка', 'Подрозетник']],
  ['Прокладка электрокабеля', 'м', ['Кабель силовой', 'Гофра']],
  ['Монтаж водопровода', 'м', ['Труба', 'Фитинги']],
  ['Установка сантехники', 'шт.', ['Сантехнический прибор', 'Комплект крепления']],
  ['Устройство стяжки', 'м²', ['Стяжка (смесь)', 'Грунтовка']],
  ['Монтаж гипсокартона', 'м²', ['Лист ГКЛ', 'Профиль', 'Саморезы']],
  ['Демонтаж покрытия', 'м²', []],
  ['Монтаж перегородки', 'м²', ['Блок / лист', 'Крепёж']],
  ['Монтаж строительных лесов', 'м²', []]
];

export const PRICE_SCOPE = 'В расценки необходимо включить все расходы на мобилизацию и демобилизацию, подготовку рабочего места, инструменты и механизмы, строительные леса и подмости при необходимости, подъём материалов на этаж и перемещение по объекту, уборку рабочего места. Дополнительные расходы отдельно после выбора исполнителя не допускаются, если не согласованы заказчиком заранее.';

export const emptyRate = (name = '', unit = 'м²', materials = []) => ({
  label: name, unit, quantity: null, note: '',
  materials: materials.map(label => ({ label, unit: 'шт.', quantity: null }))
});

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const money = n => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽';

export function catalogSelect() {
  return `<select id="quick-rate" aria-label="Типовая расценка"><option value="">Выбрать из короткого каталога</option>${RATE_CATALOG.map((r, i) => `<option value="${i}">${escape(r[0])} · ${escape(r[1])}</option>`).join('')}</select>`;
}

export function renderEditor(items) {
  if (!items.length) return '<p class="muted">Добавьте работу из каталога или опишите её самостоятельно.</p>';
  return items.map((rate, index) => `<section class="estimate-rate" data-index="${index}">
    <div class="estimate-heading"><strong>Расценка ${index + 1}</strong><button type="button" class="btn text small" data-action="delete-rate" data-index="${index}">Удалить</button></div>
    <div class="estimate-input-grid">
      <label>Работа<input class="rate-label" maxlength="160" required value="${escape(rate.label)}" placeholder="Название работы"></label>
      <label>Количество<input class="rate-qty" min="0.001" step="any" type="number" required value="${rate.quantity ?? ''}" placeholder="Уточнить"></label>
      <label>Ед.<input class="rate-unit" maxlength="12" required value="${escape(rate.unit)}"></label>
    </div>
    <div class="materials-heading"><strong>Материалы</strong><button type="button" class="btn text small" data-action="add-material" data-index="${index}">+ Материал</button></div>
    <div class="materials-editor">${(rate.materials || []).map((m, j) => `<div class="material-edit" data-index="${j}">
      <input class="material-name" maxlength="120" required value="${escape(m.label)}" placeholder="Материал">
      <input class="material-qty" type="number" step="any" min="0.001" required value="${m.quantity ?? ''}" placeholder="Кол-во">
      <input class="material-unit" maxlength="12" required value="${escape(m.unit)}" placeholder="Ед.">
      <button type="button" data-action="delete-material" data-index="${index}" data-material="${j}" aria-label="Удалить материал">×</button>
    </div>`).join('')}</div>
  </section>`).join('');
}

export function collectEditor(root, { strict = true } = {}) {
  const rates = [...root.querySelectorAll('.estimate-rate')].map(box => ({
    label: box.querySelector('.rate-label').value.trim(),
    unit: box.querySelector('.rate-unit').value.trim(),
    quantity: box.querySelector('.rate-qty').value ? Number(box.querySelector('.rate-qty').value) : null,
    note: '',
    materials: [...box.querySelectorAll('.material-edit')].map(node => ({
      label: node.querySelector('.material-name').value.trim(),
      unit: node.querySelector('.material-unit').value.trim(),
      quantity: node.querySelector('.material-qty').value ? Number(node.querySelector('.material-qty').value) : null
    }))
  }));
  if (strict && (!rates.length || rates.some(r => !r.label || !(r.quantity > 0) || !r.unit || r.materials.some(m => !m.label || !m.unit || !(m.quantity > 0))))) {
    throw Error('Проверьте количество и наименование каждой работы и материала. Неизвестные объёмы нельзя публиковать как подтверждённые.');
  }
  return rates;
}

export function offerFields(items, materialsPolicy = 'contractor') {
  return `<div class="quote-scroll"><table class="quote-table"><thead><tr><th>Расценка</th><th>Кол-во</th><th>Цена за ед., ₽</th><th>Сумма</th></tr></thead><tbody>${items.map(r => `
    <tr class="quote-work"><th>${escape(r.label)} <small>Работа</small></th><td>${r.quantity} ${escape(r.unit)}</td>
    <td><input type="number" class="quote-input" min="0" max="100000000" step="1" required name="rate_${r.id}" data-qty="${r.quantity}" placeholder="0"></td><td class="quote-line">—</td></tr>
    ${r.materials.map(m => `<tr class="quote-material"><th>↳ ${escape(m.label)} <small>Материал</small></th><td>${m.quantity} ${escape(m.unit)}</td>
    <td><input type="number" class="quote-input" min="0" max="100000000" step="1" required name="material_${m.id}" data-qty="${m.quantity}" ${materialsPolicy === 'customer' ? 'value="0" readonly title="Материалы предоставляет заказчик"' : 'placeholder="0"'}></td><td class="quote-line">—</td></tr>`).join('')}`).join('')}</tbody></table></div>`;
}

export function collectOfferPrices(form, items) {
  const rate_prices = items.map(r => ({ rate_id: r.id, unit_price: Number(form.elements[`rate_${r.id}`].value) }));
  const material_prices = items.flatMap(r => r.materials.map(m => ({ material_id: m.id, unit_price: Number(form.elements[`material_${m.id}`].value) })));
  if ([...rate_prices, ...material_prices].some(p => !Number.isInteger(p.unit_price) || p.unit_price < 0)) {
    throw Error('Укажите цены за единицу по всем позициям');
  }
  return { rate_prices, material_prices };
}

export function updateOfferTotal(form) {
  let total = 0;
  let filled = true;
  form.querySelectorAll('.quote-input').forEach(input => {
    const valid = input.value.trim() !== '' && Number.isInteger(Number(input.value)) && Number(input.value) >= 0;
    if (!valid) filled = false;
    const amount = valid ? Number(input.value) * Number(input.dataset.qty) : 0;
    input.closest('tr').querySelector('.quote-line').textContent = valid ? money(amount) : '—';
    total += amount;
  });
  const holder = form.querySelector('#offer-sum');
  if (holder) holder.textContent = filled && total > 0 ? money(total) : 'Заполните все цены';
  return filled ? Math.round(total) : null;
}

export function comparisonTable(items, offers, jobId, canSelect = true) {
  if (!offers.length) return '<p class="muted">Пока нет предложений. Здесь появится сравнение по одинаковым позициям.</p>';
  const price = (offer, id, kind, q) => {
    const x = (kind === 'work' ? offer.rate_prices : offer.material_prices)?.[id];
    return x == null ? '—' : money(Number(x) * q);
  };
  return `<div class="comparison-scroll" role="region" aria-label="Сравнение предложений по работам и материалам" tabindex="0">
    <table class="comparison"><thead><tr><th>Расценка / объём</th>${offers.map(o => `<th>${escape(o.contractor_name || 'Исполнитель')}<small>${o.days} дн.</small></th>`).join('')}</tr></thead><tbody>
    ${items.map(r => `<tr class="comparison-work"><th>${escape(r.label)}<small>Работа · ${r.quantity} ${escape(r.unit)}</small></th>${offers.map(o => `<td>${price(o,r.id,'work',r.quantity)}</td>`).join('')}</tr>
    ${r.materials.map(m => `<tr class="comparison-material"><th>↳ ${escape(m.label)}<small>Материал · ${m.quantity} ${escape(m.unit)}</small></th>${offers.map(o => `<td>${price(o,m.id,'material',m.quantity)}</td>`).join('')}</tr>`).join('')}`).join('')}
    <tr class="comparison-total"><th>ИТОГО</th>${offers.map(o => `<td>${money(o.amount)}</td>`).join('')}</tr>
    <tr><th>Выбор</th>${offers.map(o => `<td>${canSelect && o.status === 'submitted' ? `<button class="btn small" data-action="select-offer" data-job="${jobId}" data-offer="${o.id}">Выбрать</button>` : `<span class="pill">${o.status === 'selected' ? 'Выбран' : 'Не выбран'}</span>`}</td>`).join('')}</tr>
    </tbody></table></div>`;
}

export function offlineExampleDraft(input) {
  const t = input.toLocaleLowerCase('ru');
  const rules = [
    [/плитк|кафел/, 0], [/розетк/, 6], [/провод|кабел|электр/, 7],
    [/штукатур/, 2], [/шпакл/, 3], [/окрас|покрас/, 4], [/ламинат/, 5],
    [/водопровод|труб/, 8], [/сантехник|унитаз|раковин/, 9], [/стяжк/, 10],
    [/гипсокартон|гкл/, 11], [/демонтаж/, 12], [/перегородк/, 13]
  ];
  const matches = [...new Set(rules.filter(([rx]) => rx.test(t)).map(([, i]) => i))];
  const used = matches.length ? matches.slice(0, 4).map(i => RATE_CATALOG[i]) : [['Уточните вид работы', 'шт.', []]];
  return { items: used.map(r => emptyRate(r[0],r[1],r[2])),
    title: input.slice(0,100).replace(/[<>]/g,'').trim(), source: 'offline-example', questions: ['Укажите объёмы каждой работы и материалов', 'Проверьте выбранные типы работ'],
    disclaimer: 'Демо без ИИ: позиции подобраны по ключевым словам. Проверяйте и исправляйте всё вручную.' };
}
