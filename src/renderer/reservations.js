// صفحة الحجوزات (تعتمد على $ و esc و errMsg و can من renderer.js، و dlgOpen/dlgClose/flash من pos.js)
const RES_L = { booked: 'محجوز', seated: 'جلس', completed: 'منتهي', cancelled: 'ملغي', no_show: 'لم يحضر' };
const rsYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rsShift = (date, n) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return rsYmd(d); };
let RS = { date: rsYmd(new Date()) };
const rsFail = (e) => { const x = $('rsErr'); if (x) x.textContent = errMsg(e); };

async function rsFloor() { try { return await api.tablesFloor(); } catch { return []; } } // الكاشير يملك صلاحية الطاولات؛ وإلا نكتفي بلا اختيار طاولة
const tblOpts = (floor, sel) => `<option value="">— بلا طاولة —</option>${floor.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)} (${t.seats})${t.orders?.length ? ' — مشغولة' : ''}</option>`).join('')}`;

async function viewReservations() {
  $('content').classList.remove('wide');
  let rows; try { rows = await api.resList({ date: RS.date }); } catch (e) { $('content').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; return; }
  const live = rows.filter((r) => r.status === 'booked' || r.status === 'seated');
  $('content').innerHTML = `<h2>الحجوزات</h2>
   <div class="drow"><button class="sm sec" id="rsPrev">◀</button><input type="date" id="rsDate" value="${RS.date}"><button class="sm sec" id="rsNext">▶</button><button class="sm sec" id="rsToday">اليوم</button><button class="sm" id="rsNew">+ حجز جديد</button></div>
   <div class="muted">${live.length} حجز نشط — ${live.reduce((s, r) => s + r.party, 0)} شخصاً</div>
   ${rows.map((r) => `<div class="card rcard ${r.status}"><div class="orow"><b dir="ltr">${esc(r.time)}</b><b>${esc(r.name)}</b><span dir="ltr">${esc(r.phone)}</span><span>${r.party} أشخاص</span>
     <span>${r.table ? esc(r.table) : '<small class="so">بلا طاولة</small>'}</span><span class="badge ${r.status}">${RES_L[r.status]}</span></div>
     ${r.note ? `<small>${esc(r.note)}</small>` : ''}
     <div class="acts">${r.status === 'booked' ? `<button class="sm ok" data-s="${r.id}|seated">وصل — إجلاس</button><button class="sm sec" data-ed="${r.id}">تعديل</button><button class="sm sec" data-s="${r.id}|no_show">لم يحضر</button><button class="sm danger" data-s="${r.id}|cancelled">إلغاء</button>` : ''}
      ${r.status === 'seated' ? `<button class="sm" data-s="${r.id}|completed">انتهى</button>` : ''}${r.status === 'cancelled' || r.status === 'no_show' ? `<button class="sm sec" data-s="${r.id}|booked">استعادة</button>` : ''}</div></div>`).join('')}
   ${rows.length ? '' : '<div class="card">لا توجد حجوزات في هذا اليوم.</div>'}<div id="rsErr" class="err"></div>`;
  const go = (d) => { if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { RS.date = d; viewReservations(); } };
  $('rsPrev').onclick = () => go(rsShift(RS.date, -1)); $('rsNext').onclick = () => go(rsShift(RS.date, 1));
  $('rsToday').onclick = () => go(rsYmd(new Date())); $('rsDate').onchange = () => go($('rsDate').value);
  $('rsNew').onclick = () => resForm(null);
  document.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => resForm(rows.find((r) => r.id === +b.dataset.ed))));
  document.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { const [id, to] = b.dataset.s.split('|'); resStep(rows.find((r) => r.id === +id), to); }));
}

async function resStep(r, to) {
  try {
    if (to === 'seated') {
      if (!r.tableId) return seatDialog(r, await rsFloor()); // لا طاولة: نختارها أولاً
      const t = await api.resStatus(r.id, 'seated');
      return seatToPos(t);
    } else {
      if (to === 'cancelled' && !confirm('إلغاء هذا الحجز؟')) return;
      await api.resStatus(r.id, to);
    }
    viewReservations();
  } catch (e) { rsFail(e); }
}

// بعد الإجلاس: يفتح الكاشير بالطاولة والعميل معبّأين (إن كان للمستخدم صلاحية الكاشير)
async function seatToPos(r) {
  if (!can('pos')) { flash(`أُجلس ${r.name} على ${r.table}`); return viewReservations(); }
  const f = await api.resPrefill(r.id);
  resetPos();
  Object.assign(P, { type: 'dine_in', tableId: f.tableId || '', table: f.table || '' });
  if (f.customer && can('customers')) P.crm = f.customer;
  flash(`أُجلس ${f.name} على ${f.table} — أضف الأصناف للطلب`);
  open('pos');
}

function seatDialog(r, floor) {
  const d = dlgOpen(`<h3>إجلاس ${esc(r.name)} (${r.party})</h3><label>الطاولة</label><select id="stT">${tblOpts(floor.filter((t) => !t.orders.length && t.seats >= r.party), '')}</select>
   <div id="stE" class="err"></div><button id="stOk">إجلاس</button><button class="sec" id="stNo">إلغاء</button>`);
  d.querySelector('#stNo').onclick = dlgClose;
  d.querySelector('#stOk').onclick = async () => {
    try { const t = await api.resStatus(r.id, 'seated', d.querySelector('#stT').value || undefined); dlgClose(); await seatToPos(t); }
    catch (e) { d.querySelector('#stE').textContent = errMsg(e); }
  };
}

async function resForm(r) {
  const floor = await rsFloor();
  const d = dlgOpen(`<h3>${r ? 'تعديل حجز' : 'حجز جديد'}</h3>
   <label>الجوال</label><input id="rfP" dir="ltr" inputmode="tel" value="${esc(r?.phone)}"><div id="rfC" class="muted"></div>
   <label>الاسم</label><input id="rfN" value="${esc(r?.name)}">
   <div class="drow"><label>الأشخاص</label><input id="rfG" type="number" min="1" max="50" value="${r?.party ?? 2}"><label>المدة (د)</label><input id="rfD" type="number" min="15" max="480" step="15" value="${r?.durationMin ?? 90}"></div>
   <div class="drow"><input id="rfDate" type="date" value="${r?.date || RS.date}"><input id="rfT" type="time" value="${r?.time || '19:00'}"></div>
   ${floor.length ? `<label>الطاولة</label><select id="rfTb">${tblOpts(floor, r?.tableId)}</select>` : ''}
   <label>ملاحظة</label><input id="rfNote" value="${esc(r?.note)}"><div id="rfE" class="err"></div><button id="rfOk">حفظ</button><button class="sec" id="rfNo">إلغاء</button>`);
  d.querySelector('#rfNo').onclick = dlgClose;
  // إكمال الاسم تلقائياً من العميل المسجّل
  d.querySelector('#rfP').onchange = async () => {
    if (!can('customers')) return;
    try { const c = await api.custFind(d.querySelector('#rfP').value); d.querySelector('#rfC').textContent = c ? `عميل مسجّل: ${c.name} (${c.visits} زيارة)` : ''; if (c && !d.querySelector('#rfN').value) d.querySelector('#rfN').value = c.name; } catch {}
  };
  d.querySelector('#rfOk').onclick = async () => {
    try {
      await api.resSave({ id: r?.id, name: d.querySelector('#rfN').value, phone: d.querySelector('#rfP').value, party: +d.querySelector('#rfG').value, durationMin: +d.querySelector('#rfD').value,
        date: d.querySelector('#rfDate').value, time: d.querySelector('#rfT').value, tableId: d.querySelector('#rfTb')?.value || null, note: d.querySelector('#rfNote').value });
      RS.date = d.querySelector('#rfDate').value; dlgClose(); flash('تم حفظ الحجز'); viewReservations();
    } catch (e) { d.querySelector('#rfE').textContent = errMsg(e); }
  };
}
