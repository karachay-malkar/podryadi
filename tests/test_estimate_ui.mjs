import assert from 'node:assert/strict';
import {
  RATE_CATALOG, RATE_GROUPS, PRICE_SCOPE, emptyRate, renderEditor, catalogSelect, offerFields, comparisonTable,
  offlineExampleDraft
} from '../app/static/estimate.js';
assert.equal(RATE_CATALOG.length, 15);
assert.ok(RATE_GROUPS.length >= 5);
const groupedIndexes = RATE_GROUPS.flatMap(group => group.indexes);
assert.deepEqual([...groupedIndexes].sort((a,b)=>a-b), Array.from({length:RATE_CATALOG.length},(_,i)=>i));
assert.match(catalogSelect(), /catalog-panel/);
assert.match(catalogSelect(), /catalog-search/);
assert.match(catalogSelect(), /data-action=\"pick-catalog-rate\"/);

assert.match(PRICE_SCOPE, /мобилизац/);
assert.match(PRICE_SCOPE, /лес/);
assert.match(PRICE_SCOPE, /подъём/);
const auto = offlineExampleDraft('Нужно поменять проводку и установить розетки в квартире');
assert.ok(auto.items.some(r => r.label.includes('электрокабеля')));
assert.ok(auto.items.some(r => r.label.includes('розеток')));
assert.ok(auto.items.every(r => r.quantity === null));
const blank = emptyRate('Облицовка плиткой','м²',['Клей']);
assert.equal(blank.materials.length,1);
assert.match(renderEditor([blank]), /rate-qty/);
assert.match(renderEditor([blank]), /material-qty/);
const rates = [{ id: 1, label: 'Облицовка плиткой', unit: 'м²', quantity: 18,
  materials: [{ id: 2, label: 'Клей', unit: 'меш.', quantity: 4 }] }];
assert.match(offerFields(rates,'customer'), /readonly/);
assert.match(offerFields(rates,'contractor'), /material_2/);
const comparison = comparisonTable(rates, [{id: 7, days: 3, amount: 50000,
 contractor_name: 'Подрядчик А', status: 'submitted', rate_prices:{1:2500},material_prices:{2:1250}}],123);
assert.match(comparison, /50 000|50 000/);
assert.match(comparison, /data-job="123"/);
assert.match(comparison, /45 000|45 000/);
console.log('Estimate frontend component checks passed.');
