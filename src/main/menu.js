const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');

const uid = () => crypto.randomUUID();
const nm = (s) => { s = String(s ?? '').trim(); if (!s) throw new Error('الاسم مطلوب'); if (s.length > 80) throw new Error('الاسم طويل'); return s; };
const cents = (p) => { const n = Number(p); if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error('سعر غير صالح'); return Math.round(n * 100); };
const D = () => db.get();

function get() {
  const d = D();
  return { categories: [...d.categories].sort((a, b) => a.sort - b.sort), items: d.items, modGroups: d.modGroups, stations: d.stations.map(({ id, name }) => ({ id, name })) };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
function saveCategory({ id, name, sort, color, active, stationId }) {
  const d = D(); name = nm(name);
  let c = id && d.categories.find((x) => x.id === id);
  if (id && !c) throw new Error('التصنيف غير موجود');
  if (color !== undefined && color !== '' && !COLOR.test(color)) throw new Error('لون غير صالح');
  if (stationId && !d.stations.some((x) => x.id === stationId)) throw new Error('محطة غير صالحة');
  if (!c) { c = { id: uid(), sort: d.categories.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1 }; d.categories.push(c); }
  c.name = name;
  if (Number.isFinite(+sort) && sort !== undefined && sort !== null && sort !== '') c.sort = +sort;
  if (color !== undefined) c.color = color || '';
  if (active !== undefined) c.active = !!active;
  if (stationId !== undefined) c.stationId = stationId || '';
  db.save(); auth.audit(id ? 'category_update' : 'category_create', name);
}
function reorderCategories(ids) {
  const d = D();
  if (!Array.isArray(ids) || ids.length !== d.categories.length || new Set(ids).size !== ids.length || ids.some((i) => !d.categories.some((c) => c.id === i))) throw new Error('ترتيب غير صالح');
  ids.forEach((i, n) => { d.categories.find((c) => c.id === i).sort = n + 1; });
  db.save(); auth.audit('category_reorder', `${ids.length}`);
}
function deleteCategory(id) {
  const d = D(); const c = d.categories.find((x) => x.id === id);
  if (!c) throw new Error('التصنيف غير موجود');
  if (d.items.some((i) => i.categoryId === id)) throw new Error('لا يمكن حذف تصنيف فيه أصناف');
  d.categories = d.categories.filter((x) => x.id !== id);
  db.save(); auth.audit('category_delete', c.name);
}

const KINDS = ['normal', 'combo', 'weight', 'service'];
function cleanVariants(list, old = []) {
  if (!Array.isArray(list) || list.length > 20) throw new Error('أحجام غير صالحة');
  const seen = new Set(), skus = new Set();
  const vs = list.map((v) => {
    const name = nm(v.name); if (seen.has(name)) throw new Error(`النوع «${name}» مكرر`); seen.add(name);
    const sku = String(v.sku ?? '').trim().slice(0, 40);
    if (sku) { if (skus.has(sku)) throw new Error(`الرمز «${sku}» مكرر`); skus.add(sku); }
    const prev = v.id && old.find((x) => x.id === v.id);
    return { id: prev ? prev.id : uid(), name, priceCents: cents(v.price ?? (v.priceCents / 100)), costCents: cents(v.cost ?? ((v.costCents || 0) / 100)), sku, soldOut: !!v.soldOut, isDefault: !!v.isDefault };
  });
  if (vs.length) { const i = Math.max(0, vs.findIndex((v) => v.isDefault)); vs.forEach((v, n) => { v.isDefault = n === i; }); }
  return vs;
}
function saveItem({ id, categoryId, name, price, image, modifierGroupIds = [], active = true, stationId = '', kind, barcode, stockMode, variants }) {
  const d = D(); name = nm(name);
  if (kind !== undefined && !KINDS.includes(kind)) throw new Error('نوع الصنف غير صالح');
  if (stockMode !== undefined && !['auto', 'manual'].includes(stockMode)) throw new Error('وضع الخصم غير صالح');
  if (!d.categories.some((c) => c.id === categoryId)) throw new Error('اختر تصنيفاً');
  if (image && !(typeof image === 'string' && image.length < 400000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image))) throw new Error('الصورة غير صالحة أو كبيرة');
  if (stationId && !d.stations.some((x) => x.id === stationId)) throw new Error('محطة غير صالحة');
  let it = id && d.items.find((x) => x.id === id);
  if (id && !it) throw new Error('الصنف غير موجود');
  if (!it) { it = { id: uid(), soldOut: false }; d.items.push(it); }
  const vs = variants !== undefined ? cleanVariants(variants, it.variants || []) : (it.variants || []);
  Object.assign(it, {
    name, categoryId, priceCents: cents(price), image: image || '', active: !!active, stationId: stationId || '',
    modifierGroupIds: modifierGroupIds.filter((g) => d.modGroups.some((m) => m.id === g)),
    variants: vs, kind: kind ?? it.kind ?? 'normal', barcode: barcode !== undefined ? String(barcode).trim().slice(0, 40) : (it.barcode || ''),
    stockMode: stockMode ?? it.stockMode ?? 'auto',
  });
  if (vs.length) it.priceCents = vs.find((v) => v.isDefault).priceCents; // السعر الظاهر = النوع الافتراضي
  db.save(); auth.audit(id ? 'item_update' : 'item_create', name);
}
function deleteItem(id) {
  const d = D(); const it = d.items.find((x) => x.id === id);
  if (!it) throw new Error('الصنف غير موجود');
  d.items = d.items.filter((x) => x.id !== id);
  db.save(); auth.audit('item_delete', it.name);
}
function setSoldOut(id, v) {
  const it = D().items.find((x) => x.id === id);
  if (!it) throw new Error('الصنف غير موجود');
  it.soldOut = !!v; db.save(); auth.audit(v ? 'item_soldout' : 'item_available', it.name);
}

function setVariantSoldOut(itemId, variantId, v) {
  const it = D().items.find((x) => x.id === itemId);
  const vr = it && (it.variants || []).find((x) => x.id === variantId);
  if (!vr) throw new Error('النوع غير موجود');
  vr.soldOut = !!v; db.save(); auth.audit(v ? 'variant_soldout' : 'variant_available', `${it.name} · ${vr.name}`);
}

function saveGroup({ id, name, required = false, multi = false, options = [] }) {
  const d = D(); name = nm(name);
  const opts = options.map((o) => ({ name: nm(o.name), priceCents: cents(o.price ?? 0) }));
  if (!opts.length) throw new Error('أضف خياراً واحداً على الأقل');
  let g = id && d.modGroups.find((x) => x.id === id);
  if (id && !g) throw new Error('المجموعة غير موجودة');
  if (!g) { g = { id: uid() }; d.modGroups.push(g); }
  Object.assign(g, { name, required: !!required, multi: !!multi, options: opts });
  db.save(); auth.audit(id ? 'modgroup_update' : 'modgroup_create', name);
}
function deleteGroup(id) {
  const d = D(); const g = d.modGroups.find((x) => x.id === id);
  if (!g) throw new Error('المجموعة غير موجودة');
  d.modGroups = d.modGroups.filter((x) => x.id !== id);
  d.items.forEach((i) => { i.modifierGroupIds = (i.modifierGroupIds || []).filter((m) => m !== id); });
  db.save(); auth.audit('modgroup_delete', g.name);
}

module.exports = { get, saveCategory, reorderCategories, setVariantSoldOut, deleteCategory, saveItem, deleteItem, setSoldOut, saveGroup, deleteGroup };
