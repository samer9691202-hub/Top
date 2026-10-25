
(function(){
  const $ = s => document.querySelector(s);
  const STATUS = ['جديد','قيد التنفيذ','مكتمل'];
  const PRIO = ['عادية','مهمة','عاجلة'];
  const KEY = 'plan-state-v2', OLD_KEY = 'plan-state-v1';
  const uid = () => Math.random().toString(36).slice(2,9);
  const pad = n => String(n).padStart(2,'0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dkey = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const dparse = k => new Date(k+'T00:00:00');
  const todayKey = () => dkey(new Date());

  /* ---------- التخزين: يعمل داخل Claude وخارجه ---------- */
  const store = {
    async get(k){
      try{ if(window.storage){ const r = await window.storage.get(k); if(r && r.value != null) return r.value; } }catch(e){}
      try{ return localStorage.getItem(k); }catch(e){ return null; }
    },
    async set(k,v){
      try{ if(window.storage){ await window.storage.set(k,v); return true; } }catch(e){}
      try{ localStorage.setItem(k,v); return true; }catch(e){ return false; }
    }
  };

  let state = {tasks:[], notes:[], base:[], mainTasks:[]};
  const DEFAULTS = {clockFmt:'12', theme:'auto', weekStart:'0', showSec:true, showHijri:true};
  let settings = Object.assign({}, DEFAULTS);
  let ui = {sel: todayKey(), calY:0, calM:0, calExpanded:false, filter:'all', noteView:'day', noteQ:'', editing:null, view:'table', q:'', st:'all'};
  { const t = new Date(); ui.calY = t.getFullYear(); ui.calM = t.getMonth(); }
  let saveTimer;

  async function load(){
    let raw = await store.get(KEY);
    if(raw){
      try{ const s = JSON.parse(raw); if(s && Array.isArray(s.tasks)){ state = {tasks:s.tasks, notes:s.notes||[], base:s.base||[], mainTasks:s.mainTasks||[]}; return; } }catch(e){}
    }
    // ترحيل بيانات النسخة الأولى
    raw = await store.get(OLD_KEY);
    if(raw){
      try{
        const s = JSON.parse(raw), t = todayKey();
        state.tasks = (s.tasks||[]).map(x=>Object.assign({date:t}, x));
        state.base = s.base || []; state.mainTasks = s.mainTasks || [];
        if(s.note && String(s.note).trim()) state.notes.push({id:uid(), title:'', text:String(s.note), date:t, created:Date.now()});
        save();
      }catch(e){}
    }
  }
  function renderStats(){
    const total = state.tasks.length, done = state.tasks.filter(t=>t.done).length;
    const dayTasks = state.tasks.filter(t=>t.date===ui.sel), dayDone = dayTasks.filter(t=>t.done).length;
    $('#statTasks').textContent = dayTasks.length;
    $('#statDone').textContent = (dayTasks.length ? Math.round(dayDone/dayTasks.length*100) : 0) + '%';
    $('#statNotes').textContent = state.notes.filter(n=>n.date===ui.sel).length;
    $('#statBase').textContent = state.base.length;
  }
  function save(){
    renderStats();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{ store.set(KEY, JSON.stringify(state)); }, 250);
  }

  /* ---------- الإعدادات ---------- */
  async function loadSettings(){
    try{
      const raw = await store.get('plan-settings-v1');
      if(raw){ settings = Object.assign({}, DEFAULTS, JSON.parse(raw)); return; }
      const old = await store.get('plan-h24');
      if(old !== null) settings.clockFmt = old==='1' ? '24' : '12';
    }catch(e){}
  }
  function saveSettings(){ store.set('plan-settings-v1', JSON.stringify(settings)); }
  function applySettings(){
    const r = document.documentElement;
    if(settings.theme==='auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', settings.theme);
    document.querySelectorAll('#settings [data-setting]').forEach(g=>{
      const k = g.dataset.setting;
      if(g.classList.contains('sw')) g.setAttribute('aria-checked', String(!!settings[k]));
      else g.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed', String(String(settings[k])===b.dataset.val)));
    });
    tick(); renderCal();
  }
  let opener = null;
  function openSettings(){
    const panel=$('#settings'); if(!panel.hidden) return;
    opener = document.activeElement;
    panel.hidden = false; document.body.style.overflow = 'hidden';
    const closeButton = $('#setClose');
    if(closeButton) closeButton.focus({preventScroll:true});
  }
  function closeSettings(){
    $('#settings').hidden = true; document.body.style.overflow = '';
    if(opener && opener.focus) opener.focus();
  }
  // الإعدادات تستخدم نفس آلية استجابة أزرار الواجهة: نقرة واحدة واضحة ومتوافقة مع اللمس والماوس ولوحة المفاتيح.
  const settingsButton = $('#openSettings');
  settingsButton.addEventListener('click', openSettings);
  $('#setClose').addEventListener('click', closeSettings);
  document.querySelector('.side-nav').addEventListener('click',e=>{const b=e.target.closest('[data-jump]');if(!b)return;const target=document.getElementById(b.dataset.jump);if(target)target.scrollIntoView({behavior:'smooth',block:'start'});});
  document.getElementById('homeBrand')?.addEventListener('click',()=>{const home=document.querySelector('.hero')||document.querySelector('.wrap');if(home){home.scrollIntoView({behavior:'smooth',block:'start'});window.scrollTo({top:0,behavior:'smooth'});}});
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !$('#settings').hidden) closeSettings(); });
  $('#settings').addEventListener('click', e=>{
    if(e.target.id==='settings'){ closeSettings(); return; }
    const sw = e.target.closest('.sw');
    if(sw){ const k = sw.dataset.setting; settings[k] = !settings[k]; saveSettings(); applySettings(); return; }
    const b = e.target.closest('.seg button'); if(!b) return;
    const g = b.closest('[data-setting]'); if(!g) return;
    settings[g.dataset.setting] = b.dataset.val; saveSettings(); applySettings();
  });

  /* ---------- الساعة والتاريخ ---------- */
  const fWk = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{weekday:'long'});
  const fGr = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{day:'numeric',month:'long',year:'numeric'});
  let fH; try{ fH = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'long',year:'numeric'}); }catch(e){}
  let lastDay = -1;
  function tick(){
    const d = new Date(), h = d.getHours(), m = d.getMinutes(), sc = d.getSeconds();
    const h24 = settings.clockFmt==='24';
    $('#hh').textContent = h24 ? pad(h) : String(h%12||12);
    $('#mm').textContent = pad(m);
    $('#sec').textContent = pad(sc);
    $('#sec').hidden = !settings.showSec;
    $('#ap').textContent = h24 ? '' : (h<12 ? 'ص' : 'م');
    $('#hij').hidden = !settings.showHijri || !fH;
    const secs = h*3600+m*60+sc;
    $('#dayFill').style.width = (secs/864)+'%';
    $('#dayPct').textContent = Math.round(secs/864)+'%';
    const rem = 86400-secs;
    $('#left').textContent = Math.floor(rem/3600)+' س '+pad(Math.floor(rem%3600/60))+' د';
    if(lastDay !== d.getDate()){
      lastDay = d.getDate();
      $('#greetText').textContent = h<5 ? 'ليلة هادئة' : h<12 ? 'صباح الخير' : h<17 ? 'نهارك سعيد' : h<21 ? 'مساء الخير' : 'ليلة سعيدة';
      $('#wk').textContent = fWk.format(d);
      $('#gr').textContent = fGr.format(d);
      $('#hij').textContent = fH ? fH.format(d) : '';
      renderCal();
    }
  }

  /* ---------- التقويم ---------- */
  const WD = ['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
  const fMonth = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{month:'long',year:'numeric'});
  const fDay = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{weekday:'long',day:'numeric',month:'long'});
  function dayInfo(){
    const m = {};
    state.tasks.forEach(t=>{ const o = m[t.date] || (m[t.date]={open:0,done:0,notes:0}); t.done ? o.done++ : o.open++; });
    state.notes.forEach(n=>{ const o = m[n.date] || (m[n.date]={open:0,done:0,notes:0}); o.notes++; });
    return m;
  }
  function renderCal(){
    const y = ui.calY, mo = ui.calM, info = dayInfo(), tk = todayKey();
    $('#calTitle').textContent = fMonth.format(new Date(y,mo,1));
    const ws = Number(settings.weekStart)||0;
    let dates = [], h = '';
    if(ui.calExpanded){
      const first = (new Date(y,mo,1).getDay()-ws+7)%7, days = new Date(y,mo+1,0).getDate();
      h = [0,1,2,3,4,5,6].map(i=>'<div class="wd" role="columnheader">'+WD[(ws+i)%7]+'</div>').join('');
      for(let i=0;i<first;i++) h += '<div class="cell blank" aria-hidden="true"></div>';
      for(let d=1;d<=days;d++) dates.push(dkey(new Date(y,mo,d)));
    }else{
      const selected = dparse(ui.sel), offset = (selected.getDay()-ws+7)%7;
      for(let i=0;i<7;i++){ const d=new Date(selected); d.setDate(selected.getDate()-offset+i); dates.push(dkey(d)); }
      h = dates.map(k=>'<div class="wd" role="columnheader">'+WD[dparse(k).getDay()]+'</div>').join('');
    }
    dates.forEach(k=>{
      const o=info[k], d=dparse(k).getDate();
      const cls='cell'+(k===tk?' today':'')+(k===ui.sel?' sel':''); let dots='';
      if(o){if(o.open)dots+='<i></i>';else if(o.done)dots+='<i class="ok"></i>';if(o.notes)dots+='<i class="n"></i>';}
      h+='<button class="'+cls+'" data-d="'+k+'" role="gridcell" aria-selected="'+(k===ui.sel)+'" aria-label="'+fDay.format(dparse(k))+'"><span>'+d+'</span><span class="dots">'+dots+'</span></button>';
    });
    $('#calGrid').classList.toggle('compact',!ui.calExpanded);
    $('#calGrid').innerHTML=h;
    $('#toggleCal').textContent=ui.calExpanded?'إخفاء الشهر':'عرض الشهر';
    $('#toggleCal').setAttribute('aria-expanded',String(ui.calExpanded));
  }
  $('#calGrid').addEventListener('click', e=>{
    const c = e.target.closest('[data-d]'); if(!c) return;
    ui.sel = c.dataset.d; const picked=dparse(ui.sel); ui.calY=picked.getFullYear(); ui.calM=picked.getMonth(); renderAll();
  });
  $('#prevM').onclick = ()=>{ ui.calExpanded=true; ui.calM--; if(ui.calM<0){ui.calM=11;ui.calY--;} renderCal(); };
  $('#nextM').onclick = ()=>{ ui.calExpanded=true; ui.calM++; if(ui.calM>11){ui.calM=0;ui.calY++;} renderCal(); };
  $('#goToday').onclick = ()=>{ const t=new Date(); ui.sel=dkey(t); ui.calY=t.getFullYear(); ui.calM=t.getMonth(); renderAll(); };
  $('#toggleCal').onclick = ()=>{ ui.calExpanded=!ui.calExpanded; renderCal(); };
  const selLabel = () => (ui.sel===todayKey() ? 'اليوم، ' : '') + fDay.format(dparse(ui.sel));

  /* ---------- المهام ---------- */
  function renderTasks(){
    const day = state.tasks.filter(t=>t.date===ui.sel);
    const total = day.length, done = day.filter(t=>t.done).length;
    $('#tasksTitle').textContent = ui.sel===todayKey() ? 'مهام اليوم' : 'مهام اليوم المحدد';
    $('#tasksSub').textContent = selLabel() + (total ? ' • متبقي '+(total-done) : '');
    $('#progFill').style.width = (total ? Math.round(done/total*100) : 0)+'%';
    $('#progTxt').textContent = done+' من '+total;
    let items = day.filter(t => ui.filter==='all' || (ui.filter==='done'?t.done:!t.done));
    items = items.slice().sort((a,b)=> a.done-b.done || (Number(b.prio)||0)-(Number(a.prio)||0));
    if(!items.length){
      $('#taskList').innerHTML = '<li class="empty">'+(total?'لا توجد مهام في هذا العرض.':'لا توجد مهام لهذا اليوم. اكتب أول مهمة في الحقل أعلاه.')+'</li>';
      return;
    }
    $('#taskList').innerHTML = items.map(t=>`
      <li class="task ${t.done?'done':''}" data-id="${t.id}">
        <button class="check" role="checkbox" aria-checked="${t.done}" aria-label="إنجاز: ${esc(t.text)}" data-a="toggle">✓</button>
        <span class="t-text">${esc(t.text)}</span>
        <button class="icon-btn" data-a="edit" aria-label="تعديل المهمة">✎</button>
        <button class="chip ${t.prio?'p'+t.prio:''}" data-a="prio" title="غيّر الأولوية">${PRIO[Number.isInteger(t.prio)&&t.prio>=0&&t.prio<=2?t.prio:0]}</button>
        <button class="icon-btn" data-a="del" aria-label="حذف المهمة">✕</button>
      </li>`).join('');
  }
  function addTask(){
    const el = $('#taskInput'), text = el.value.trim();
    if(!text){ el.focus(); return; }
    state.tasks.push({id:uid(), text, done:false, prio:0, date:ui.sel});
    el.value=''; el.focus(); renderTasks(); renderCal(); renderBase(); save();
  }
  $('#taskAdd').onclick = addTask;
  $('#taskInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addTask(); });
  $('#taskFilter').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    ui.filter = b.dataset.f;
    document.querySelectorAll('#taskFilter button').forEach(x=>x.setAttribute('aria-pressed', x===b));
    renderTasks();
  });
  $('#taskList').addEventListener('click', e=>{
    const btn = e.target.closest('[data-a]'); if(!btn) return;
    const li = btn.closest('[data-id]'); const t = state.tasks.find(x=>x.id===li.dataset.id); if(!t) return;
    if(btn.dataset.a==='toggle') t.done = !t.done;
    if(btn.dataset.a==='edit'){ const next = window.prompt('تعديل نص المهمة', t.text); if(next===null) return; if(!next.trim()){ window.alert('لا يمكن أن تكون المهمة فارغة.'); return; } t.text=next.trim(); }
    if(btn.dataset.a==='prio') t.prio = (t.prio+1)%3;
    if(btn.dataset.a==='del'){
      // المهام المضافة من الإعدادات مرتبطة بمعرّف رئيسي؛ حذف أي نسخة يحذفها من كل الأيام.
      state.tasks = t.mainId ? state.tasks.filter(x=>x.mainId!==t.mainId) : state.tasks.filter(x=>x!==t);
    }
    renderTasks(); renderCal(); renderBase(); save();
  });

  /* ---------- الملاحظات ---------- */
  const fTime = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{hour:'numeric',minute:'2-digit'});
  const fShort = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{day:'numeric',month:'short',year:'numeric'});
  let msgTimer;
  function flash(msg){
    $('#noteMsg').textContent = msg; $('#setMsg').textContent = msg; clearTimeout(msgTimer);
    msgTimer = setTimeout(()=>{ $('#noteMsg').textContent=''; $('#setMsg').textContent=''; }, 2500);
  }
  function renderNotes(){
    const all = ui.noteView==='all';
    $('#noteSearchWrap').hidden = !all;
    let items;
    if(all){
      const q = ui.noteQ.trim().toLowerCase();
      items = state.notes.filter(n=>!q || n.text.toLowerCase().includes(q) || (n.title||'').toLowerCase().includes(q));
      items.sort((a,b)=> b.date.localeCompare(a.date) || b.created-a.created);
      $('#notesSub').textContent = state.notes.length ? state.notes.length+' ملاحظة محفوظة' : '';
    }else{
      items = state.notes.filter(n=>n.date===ui.sel).sort((a,b)=>b.created-a.created);
      $('#notesSub').textContent = selLabel();
    }
    $('#noteWhere').textContent = ui.editing ? 'أنت تعدّل ملاحظة محفوظة' : 'ستُحفظ في: ' + selLabel();
    $('#noteSave').textContent = ui.editing ? 'حفظ التعديل' : 'حفظ الملاحظة';
    $('#noteCancel').hidden = !ui.editing;
    if(!items.length){
      $('#noteList').innerHTML = '<li class="empty">'+(all ? (state.notes.length?'لا توجد نتائج مطابقة.':'لا توجد ملاحظات محفوظة بعد.') : 'لا توجد ملاحظات محفوظة لهذا اليوم.')+'</li>';
      return;
    }
    $('#noteList').innerHTML = items.map(n=>`
      <li class="ncard ${ui.editing===n.id?'editing':''}" data-id="${n.id}">
        <div class="nhead">
          <span class="ntitle">${esc(n.title || 'بدون عنوان')}</span>
          ${all ? '<button class="chip" data-a="goto" title="افتح هذا اليوم">'+fShort.format(dparse(n.date))+'</button>' : ''}
        </div>
        <p class="nbody">${esc(n.text)}</p>
        <div class="nfoot">
          <span>${fTime.format(new Date(n.created))}</span>
          <span><button class="link" data-a="nedit">تعديل</button><button class="link danger" data-a="ndel">حذف</button></span>
        </div>
      </li>`).join('');
  }
  function clearEditor(){ $('#noteTitle').value=''; $('#noteText').value=''; ui.editing=null; }
  $('#noteSave').onclick = ()=>{
    const text = $('#noteText').value.trim(), title = $('#noteTitle').value.trim();
    if(!text){ $('#noteText').focus(); flash('اكتب نص الملاحظة أولًا'); return; }
    if(ui.editing){
      const n = state.notes.find(x=>x.id===ui.editing);
      if(n){ n.text = text; n.title = title; }
    }else{
      state.notes.push({id:uid(), title, text, date:ui.sel, created:Date.now()});
    }
    const wasEditing = !!ui.editing;
    clearEditor(); renderNotes(); renderCal(); renderBase(); save();
    flash(wasEditing ? 'تم حفظ التعديل ✓' : 'تم حفظ الملاحظة ✓');
  };
  $('#noteCancel').onclick = ()=>{ clearEditor(); renderNotes(); };
  $('#noteView').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    ui.noteView = b.dataset.n;
    document.querySelectorAll('#noteView button').forEach(x=>x.setAttribute('aria-pressed', x===b));
    renderNotes();
  });
  $('#noteSearch').addEventListener('input', e=>{ ui.noteQ = e.target.value; renderNotes(); });
  const armed = new Map();
  $('#noteList').addEventListener('click', e=>{
    const btn = e.target.closest('[data-a]'); if(!btn) return;
    const li = btn.closest('[data-id]'); const n = state.notes.find(x=>x.id===li.dataset.id); if(!n) return;
    const a = btn.dataset.a;
    if(a==='goto'){
      const d = dparse(n.date); ui.sel = n.date; ui.calY = d.getFullYear(); ui.calM = d.getMonth();
      renderAll(); window.scrollTo({top:0,behavior:'smooth'}); return;
    }
    if(a==='nedit'){
      ui.editing = n.id; $('#noteTitle').value = n.title||''; $('#noteText').value = n.text;
      renderNotes(); $('#noteText').focus(); return;
    }
    if(a==='ndel'){
      if(!armed.get(n.id)){
        armed.set(n.id,true); btn.textContent = 'تأكيد الحذف؟';
        setTimeout(()=>{ armed.delete(n.id); if(btn.isConnected) btn.textContent='حذف'; }, 3000);
        return;
      }
      state.notes = state.notes.filter(x=>x!==n);
      if(ui.editing===n.id) clearEditor();
      renderNotes(); renderCal(); renderBase(); save();
    }
  });

  /* ---------- القاعدة الرئيسية ---------- */
  const fD = v => v ? new Intl.DateTimeFormat('ar-EG-u-nu-latn',{day:'numeric',month:'short'}).format(dparse(v)) : '—';
  function renderBase(){
    const q = ui.q.trim().toLowerCase();
    const items = state.base.filter(b =>
      (ui.st==='all' || String(b.status)===ui.st) &&
      (!q || String(b.name||'').toLowerCase().includes(q) || String(b.cat||'').toLowerCase().includes(q)));
    $('#baseSub').textContent = (new Set([...state.tasks.map(t=>t.date),...state.notes.map(n=>n.date)]).size)+' يوم • '+state.tasks.length+' مهمة • '+state.notes.length+' ملاحظة';
    $('#cats').innerHTML = [...new Set(state.base.map(b=>b.cat).filter(Boolean))].map(c=>'<option value="'+esc(c)+'">').join('');
    // القاعدة الرئيسية تعرض البيانات الأصلية نفسها، ولا تنشئ نسخًا منفصلة منها.
    const days = [...new Set([...state.tasks.map(t=>t.date), ...state.notes.map(n=>n.date)])].filter(Boolean).sort((a,b)=>b.localeCompare(a));
    const matchedDays = days.map(date=>({date,tasks:state.tasks.filter(t=>t.date===date),notes:state.notes.filter(n=>n.date===date)})).filter(d=>{
      if(!q) return true;
      return d.date.includes(q) || fShortBase(d.date).toLowerCase().includes(q) || d.tasks.some(t=>String(t.text||'').toLowerCase().includes(q)) || d.notes.some(n=>String(n.title||'').toLowerCase().includes(q)||String(n.text||'').toLowerCase().includes(q));
    });
    let html = '<h3 style="margin:14px 0 8px">الأيام والمهام والملاحظات المرتبطة</h3>';
    if(!matchedDays.length) html += '<div class="empty">'+(days.length?'لا توجد أيام أو مهام أو ملاحظات مطابقة للبحث.':'لا توجد بيانات يومية بعد.')+'</div>';
    else html += '<div class="base-table-wrap"><table class="base-day-table"><thead><tr><th scope="col">التاريخ</th><th scope="col">المهام</th><th scope="col">الملاحظات</th><th scope="col">التفاصيل</th></tr></thead><tbody>'+matchedDays.map(d=>'<tr><td class="date-cell">'+esc(fShortBase(d.date))+'<br><span class="muted-cell">'+esc(d.date)+'</span></td><td class="content-cell">'+(d.tasks.length?d.tasks.map(t=>'<span class="task-line">'+(t.done?'☑ ':'◻ ')+esc(t.text)+'</span>').join(''):'<span class="muted-cell">لا توجد مهام</span>')+'</td><td class="content-cell">'+(d.notes.length?d.notes.map(n=>'<span class="note-line">'+esc(n.title||n.text).slice(0,240)+'</span>').join(''):'<span class="muted-cell">لا توجد ملاحظات</span>')+'</td><td class="open-cell"><button class="chip" data-central-date="'+esc(d.date)+'">فتح اليوم</button></td></tr>').join('')+'</tbody></table></div>';
    html += '<h3 style="margin:18px 0 8px">عناصر القاعدة الإضافية</h3>';
    if(!items.length) html += '<div class="empty">'+(state.base.length?'لا توجد عناصر مطابقة.':'لا توجد عناصر إضافية في القاعدة.')+'</div>';
    else if(ui.view==='table') html += '<div class="rows-head"><span>الاسم</span><span>التصنيف</span><span>التاريخ</span><span>الحالة</span><span></span></div><div class="rows">'+items.map(b=>'<div class="row" data-id="'+esc(b.id)+'"><span class="r-name">'+esc(b.name)+'</span><span class="r-meta">'+esc(b.cat||'بدون تصنيف')+'</span><span class="r-meta">'+fD(b.date)+'</span><button class="chip s'+b.status+'" data-a="status">'+STATUS[b.status]+'</button><button class="icon-btn" data-a="bdel" aria-label="حذف العنصر">✕</button></div>').join('')+'</div>';
    else html += '<div class="board">'+STATUS.map((st,i)=>'<div class="col"><h3>'+st+'<span>'+items.filter(b=>b.status===i).length+'</span></h3>'+items.filter(b=>b.status===i).map(b=>'<div class="kcard" data-id="'+esc(b.id)+'"><b>'+esc(b.name)+'</b><span class="r-meta">'+esc(b.cat||'بدون تصنيف')+' • '+fD(b.date)+'</span><div class="kfoot"><button class="chip" data-a="status">نقل للحالة التالية</button><button class="icon-btn" data-a="bdel">✕</button></div></div>').join('')+'</div>').join('')+'</div>';
    $('#baseView').innerHTML = html;
  }
  function fShortBase(v){ return v ? new Intl.DateTimeFormat('ar-EG-u-nu-latn',{day:'numeric',month:'short',year:'numeric'}).format(dparse(v)) : ''; }
  function addBase(){
    const n = $('#bName'), name = n.value.trim();
    if(!name){ n.focus(); return; }
    state.base.push({id:uid(), name, cat:$('#bCat').value.trim(), status:0, date:$('#bDate').value});
    n.value=''; $('#bCat').value=''; $('#bDate').value=''; n.focus();
    renderBase(); save();
  }
  $('#bAdd').onclick = addBase;
  $('#bName').addEventListener('keydown', e=>{ if(e.key==='Enter') addBase(); });
  $('#search').addEventListener('input', e=>{ ui.q = e.target.value; renderBase(); });
  $('#statusFilter').addEventListener('change', e=>{ ui.st = e.target.value; renderBase(); });
  $('#viewSwitch').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    ui.view = b.dataset.v;
    document.querySelectorAll('#viewSwitch button').forEach(x=>x.setAttribute('aria-pressed', x===b));
    renderBase();
  });
  $('#baseView').addEventListener('click', e=>{
    const dayBtn = e.target.closest('[data-central-date]');
    if(dayBtn){ const date=dayBtn.dataset.centralDate; const d=dparse(date); ui.sel=date; ui.calY=d.getFullYear(); ui.calM=d.getMonth(); renderAll(); const dailyPanels=document.querySelector('#tasks')?.parentElement || document.querySelector('#tasks'); if(dailyPanels){ dailyPanels.scrollIntoView({behavior:'smooth',block:'start'}); dailyPanels.classList.add('central-day-open'); setTimeout(()=>dailyPanels.classList.remove('central-day-open'),1600); } const taskInput=document.querySelector('#taskInput'); if(taskInput) taskInput.setAttribute('aria-label','مهمة جديدة ليوم '+date); return; }
    const btn = e.target.closest('[data-a]'); if(!btn) return;
    const el = btn.closest('[data-id]'); const b = state.base.find(x=>x.id===el.dataset.id); if(!b) return;
    if(btn.dataset.a==='status') b.status = (b.status+1)%3;
    if(btn.dataset.a==='bdel') state.base = state.base.filter(x=>x!==b);
    renderBase(); save();
  });

  /* ---------- المهام الرئيسية ---------- */
  function renderMainTasks(){
    const list=$('#mainTaskList'); if(!state.mainTasks.length){list.innerHTML='<div class="sub">لا توجد مهام رئيسية بعد.</div>';return;}
    list.innerHTML=state.mainTasks.map(t=>'<div class="main-task" data-main-id="'+t.id+'"><span>'+esc(t.name)+'</span><span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><select class="select main-scope" aria-label="نطاق إضافة '+esc(t.name)+'" style="min-height:34px;padding:4px 6px;width:auto;max-width:125px;font-size:.8rem"><option value="day">هذا اليوم</option><option value="month">الشهر المعروض</option></select><button class="chip" data-main-action="add">إضافة</button><button class="link danger" data-main-action="delete">حذف</button></span></div>').join('');
  }
  $('#mainTaskAdd').onclick=()=>{const input=$('#mainTaskInput'),name=input.value.trim();if(!name){input.focus();return;}state.mainTasks=state.mainTasks||[];state.mainTasks.push({id:uid(),name});input.value='';renderMainTasks();save();};
  $('#mainTaskInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#mainTaskAdd').click();});
  $('#mainTaskList').addEventListener('click',e=>{
    const b=e.target.closest('[data-main-action]');if(!b)return;const el=b.closest('[data-main-id]'),t=(state.mainTasks||[]).find(x=>x.id===el.dataset.mainId);if(!t)return;
    if(b.dataset.mainAction==='delete'){
      // حذف المهمة الرئيسية يحذف كل النسخ اليومية المرتبطة بها كذلك.
      state.mainTasks=state.mainTasks.filter(x=>x.id!==t.id);
      state.tasks=state.tasks.filter(x=>x.mainId!==t.id);
      renderAll();save();return;
    }
    const scope=el.querySelector('.main-scope')?.value||'day';
    const dates=[];
    if(scope==='month'){
      const yy=ui.calY, mm=ui.calM, days=new Date(yy,mm+1,0).getDate();
      for(let d=1;d<=days;d++) dates.push(dkey(new Date(yy,mm,d)));
    }else dates.push(ui.sel);
    let added=0;
    dates.forEach(date=>{if(!state.tasks.some(x=>x.date===date&&x.mainId===t.id)){state.tasks.push({id:uid(),mainId:t.id,text:t.name,date,done:false,prio:1});added++;}});
    renderAll();save();flash(added ? (scope==='month'?'أُضيفت المهمة إلى '+added+' يومًا في الشهر المعروض':'أُضيفت المهمة إلى '+selLabel()) : 'المهمة موجودة بالفعل في النطاق المحدد');
  });

  /* ---------- نسخ احتياطي ومسح ---------- */
  $('#export').onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'plan-backup.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  };
  $('#importBtn').onclick = ()=> $('#importFile').click();
  $('#importFile').addEventListener('change', async e=>{
    const f = e.target.files[0]; if(!f) return;
    try{
      const s = JSON.parse(await f.text());
      if(!s || !Array.isArray(s.tasks)) throw new Error('bad');
      const t = todayKey();
      state = {
        tasks: s.tasks.map(x=>Object.assign({date:t}, x)),
        notes: Array.isArray(s.notes) ? s.notes : [],
        base: Array.isArray(s.base) ? s.base : [],
        mainTasks: Array.isArray(s.mainTasks) ? s.mainTasks : []
      };
      clearEditor(); renderAll(); save(); flash('تمت استعادة النسخة ✓');
    }catch(err){ flash('الملف غير صالح'); }
    e.target.value = '';
  });
  let rArmed = false;
  $('#reset').onclick = function(){
    if(!rArmed){ rArmed = true; this.textContent = 'تأكيد المسح'; setTimeout(()=>{ rArmed=false; this.textContent='مسح'; },4000); return; }
    state = {tasks:[],notes:[],base:[],mainTasks:[]}; clearEditor();
    rArmed=false; this.textContent='مسح'; renderAll(); save(); flash('تم مسح البيانات');
  };

  function renderAll(){ renderCal(); renderTasks(); renderNotes(); renderBase(); renderStats(); renderMainTasks(); }

  /* ---------- بدء التشغيل ---------- */
  (async function init(){
    tick(); setInterval(tick, 1000);
    await load(); await loadSettings();
    applySettings(); renderAll();
  })();
})();
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }

/* أدوات PWA: حالة الاتصال والتثبيت */
(function(){
  const badge=document.getElementById('netStatus');
  const label=document.getElementById('netStatusText');
  const install=document.getElementById('installApp');
  function updateConnection(){
    const online=navigator.onLine;
    badge.classList.toggle('offline',!online);
    label.textContent=online?'متصل بالإنترنت':'وضع عدم الاتصال';
    badge.setAttribute('aria-label',label.textContent);
  }
  window.addEventListener('online',updateConnection);
  window.addEventListener('offline',updateConnection);
  updateConnection();
  let installPrompt=null;
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault(); installPrompt=event; install.hidden=false;
  });
  install.addEventListener('click',async()=>{
    if(!installPrompt)return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt=null; install.hidden=true;
  });
  window.addEventListener('appinstalled',()=>{
    install.hidden=true; installPrompt=null;
    if(typeof flash==='function') flash('تم تثبيت نكسورا بنجاح ✓');
  });
})();
