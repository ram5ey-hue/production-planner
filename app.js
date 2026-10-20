/* Production Planner — shared multi-stakeholder demo (Supabase backend). All demo data is invented. */
'use strict';
const TRADES=['Mech','B1','B2'];
const MAT_ST=['Requested','In stock','On order','Kitted','Issued','Not available'];
const stdParts=t=>(t.materials||[]).map(m=>({pn:m.pn,exp:m.qty,qty:m.qty,stock:'Requested',eta:null,src:'standard'}));
const TOOL_ST=['Not checked','Available','Booked','In calibration','U/S'];
const PROG=['Not started','In progress','Complete','Passed back'];
const DECISIONS=['Pending','Accepted','Rejected','G703'];
const FLAGS=[['hangar','Hangar'],['stand','Stand'],['crane','Crane'],['defuel','Defuel'],['paint','Paint'],['dup','Dup insp']];
const ROLES={
  planner:{name:'Planner',tabs:[['register','Register'],['new','New work pack'],['pack','Work pack'],['capacity','Capacity'],['tasks','Task database'],['escapes','Escapes'],['handover','Handover']]},
  materials:{name:'Materials',tabs:[['mat','Parts queue'],['register','Register'],['handover','Handover']]},
  tooling:{name:'Tooling & GSE',tabs:[['tool','Tools queue'],['register','Register'],['handover','Handover']]},
  shiftlead:{name:'Shift lead',tabs:[['floor','Shift board'],['escapes','Escapes'],['handover','Handover']]},
  management:{name:'Management',tabs:[['trends','Trends'],['register','Register'],['capacity','Capacity']]}
};
const CHECKS=[['received','Work pack summary received','planner'],['pace','PACE loaded','planner'],['reviewed','Work orders reviewed','auto'],
  ['spares','All spares ready','auto'],['demand','Demand cell check done','materials'],['stores','Stores collection requested','materials'],
  ['tools','All tools ready','auto'],['tooling','Tooling / GSE booked','tooling'],['hangar','Hangar / stand slot','planner'],['g703','G703 holders notified','planner']];
const TABLES={tasks:'ref',packs:'id',work_orders:'no',escapes:'id',handover:'id',history:'id',roster:'id',activity:'id'};

/* ---------- utils ---------- */
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>(Math.round((Number(n)||0)*10)/10).toString();
const sgn=v=>(v>0?'+':'')+fmt(v);
const T0=(()=>{const d=new Date();d.setHours(0,0,0,0);return d})();
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const isoOf=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10)};
const dOf=iso=>new Date(iso+'T00:00');
const dShort=iso=>iso?dOf(iso).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}):'';
const mon=iso=>dOf(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
const dayNum=iso=>Math.round((dOf(iso)-T0)/864e5);
const ago=t=>{const s=(Date.now()-new Date(t))/1000;return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':Math.floor(s/86400)+' d ago'};
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
function toast(m){const t=$('toast');t.textContent=m;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2200)}
const rid=(p,n)=>p+Math.floor(10**(n-1)+Math.random()*9*10**(n-1));

/* ---------- state ---------- */
const S={tasks:[],packs:[],work_orders:[],escapes:[],handover:[],history:[],roster:[],activity:[]};
let sb=null, ready=false, role=ls.get('pp.role')||'planner', view=null, curPack=null, curVer=null, taskFilter='', escPrefill=null, newSel=new Set(), newDraft={}, newFilter={q:'',ata:'',selOnly:false}, newWoNos={}, newManual=[];
const hashRole=location.hash.slice(1); if(ROLES[hashRole]) role=hashRole;
view=ROLES[role].tabs[0][0];

/* ---------- data layer ---------- */
async function loadAll(){
  const res=await Promise.all(Object.keys(TABLES).map(t=>{let q=sb.from(t).select('*');if(t==='activity')q=q.order('t',{ascending:false}).limit(60);return q}));
  let err=null;
  Object.keys(TABLES).forEach((t,i)=>{if(res[i].error)err=res[i].error;else S[t]=res[i].data||[]});
  if(err)throw err;
}
function subscribe(){
  const ch=sb.channel('planner-live');
  Object.keys(TABLES).forEach(t=>ch.on('postgres_changes',{event:'*',schema:'public',table:t},p=>applyChange(t,p)));
  ch.subscribe(st=>setLive(st==='SUBSCRIBED'?'on':st==='CHANNEL_ERROR'||st==='TIMED_OUT'||st==='CLOSED'?'off':''));
}
function applyChange(t,p){
  const pk=TABLES[t];
  if(p.eventType==='DELETE'){S[t]=S[t].filter(r=>r[pk]!==p.old[pk])}
  else{const i=S[t].findIndex(r=>r[pk]===p.new[pk]);if(i>=0)S[t][i]=p.new;else{if(t==='activity')S[t].unshift(p.new);else S[t].push(p.new)}}
  if(t==='activity'){S.activity.sort((a,b)=>new Date(b.t)-new Date(a.t));S.activity.length=Math.min(S.activity.length,60)}
  schedule();
}
async function upd(t,key,patch,logText,packId){
  const pk=TABLES[t];const row=S[t].find(r=>r[pk]===key);if(row)Object.assign(row,patch);schedule();
  const {error}=await sb.from(t).update(patch).eq(pk,key);
  if(error){toast('Couldn\'t save: '+error.message);return false}
  if(logText)log(logText,packId);return true;
}
async function ins(t,rows,logText,packId){
  const {data,error}=await sb.from(t).insert(rows).select();
  if(error){toast('Couldn\'t save: '+error.message);return null}
  data.forEach(r=>{const pk=TABLES[t];if(!S[t].some(x=>x[pk]===r[pk]))S[t].push(r)});schedule();
  if(logText)log(logText,packId);return data;
}
function log(text,packId){sb.from('activity').insert({role,actor:actor()||null,pack_id:packId||null,text}).then(({error})=>{if(error)console.warn(error)})}
const actor=()=>($('actor').value||'').trim();

/* ---------- derived ---------- */
const packById=id=>S.packs.find(p=>p.id===id);
const taskByRef=r=>S.tasks.find(t=>t.ref===r);
const roster=()=>S.roster[0]||{weekday:{Mech:10,B1:5,B2:3},weekend:{Mech:6,B1:3,B2:2},prod:6.5};
const wosOf=p=>S.work_orders.filter(w=>w.pack_id===p.id);
const live=(p,v=p.version)=>wosOf(p).filter(w=>w.added_v<=v&&!(w.removed_v&&w.removed_v<=v));
const counted=p=>live(p).filter(w=>w.decision!=='Rejected');
const toWork=p=>live(p).filter(w=>w.decision==='Accepted'||w.decision==='G703');
function packHrs(p){const h={Mech:0,B1:0,B2:0};counted(p).forEach(w=>TRADES.forEach(t=>h[t]+=Number(w.hrs?.[t])||0));return h}
function spareSt(w){const L=w.parts||[];if(!L.length)return 'none';
  if(L.some(l=>l.stock==='Not available'||(l.exp!=null&&Number(l.qty)<Number(l.exp))))return 'bad';
  if(L.some(l=>!['In stock','Kitted','Issued'].includes(l.stock)))return 'warn';return 'ok'}
const openRequests=()=>S.work_orders.filter(w=>{const p=packById(w.pack_id);return p&&p.status!=='Closed'&&w.decision!=='Rejected'&&!(w.removed_v&&w.removed_v<=p.version)}).flatMap(w=>(w.parts||[]).map((l,i)=>({w,l,i}))).filter(x=>x.l.src==='extra'&&x.l.stock==='Requested');
let xspPrefill=null;
function extraForm(W,packId){
  return `<section class="card" id="extraCard"><h3>Request extra spares</h3><p class="sub">Raise extras against a work order in this work pack. If the defect isn't on a work order yet, enter its new work order number and it's added to the pack as an ADF for the planner to accept.</p>
  <form class="form" id="extraForm" data-pack="${esc(packId)}" style="margin-top:0">
    <label><span class="label">Work order</span><select name="wo">${W.map(w=>`<option value="${esc(w.no)}"${xspPrefill===w.no?' selected':''}>${esc(w.no)} — ${esc(w.title)}</option>`).join('')}<option value="__new"${!W.length?' selected':''}>+ New work order (not in the pack yet)</option></select></label>
    <div class="wide form" id="newWoFields" style="margin:0;padding:10px;border:1px dashed var(--line);border-radius:6px" ${W.length?'hidden':''}>
      <label><span class="label">New work order number</span><input type="text" name="woNew" placeholder="e.g. WO-480200" autocomplete="off"></label>
      <label style="grid-column:span 2"><span class="label">Defect / task description</span><input type="text" name="woDesc" placeholder="e.g. Hydraulic seep at LH flap actuator"></label>
    </div>
    <label><span class="label">Part number</span><input type="text" name="pn" required placeholder="e.g. DEMO-SEAL-0000"></label>
    <label><span class="label">Qty</span><input type="number" name="qty" value="1" min="1" required></label>
    <label class="wide"><span class="label">Reason</span><input type="text" name="reason" required placeholder="e.g. seal damaged on removal"></label>
    <div><button class="primary" type="submit">Request spares</button></div></form></section>`;
}
function toolSt(w){const L=w.tools||[];if(!L.length)return 'none';
  if(L.some(l=>l.status==='U/S'||l.status==='In calibration'))return 'bad';
  if(L.some(l=>l.status==='Not checked'))return 'warn';return 'ok'}
function readiness(p){
  const L=live(p),C=counted(p);
  const auto={reviewed:L.length>0&&L.every(w=>w.decision!=='Pending'),spares:C.every(w=>['ok','none'].includes(spareSt(w))),tools:C.every(w=>['ok','none'].includes(toolSt(w)))};
  const items=CHECKS.map(([k,l,owner])=>({k,l,owner,v:owner==='auto'?auto[k]:!!(p.checks||{})[k]}));
  return {items,pct:Math.round(items.filter(i=>i.v).length/items.length*100)};
}
function progress(p){const W=toWork(p);const done=W.filter(w=>w.progress==='Complete').length;return {done,total:W.length,pct:W.length?Math.round(done/W.length*100):0}}
function capacity(days=21){
  const r=roster(),out=[];
  for(let d=0;d<days;d++){const date=addDays(T0,d),we=[0,6].includes(date.getDay()),heads=we?r.weekend:r.weekday;
    const avail={},need={Mech:0,B1:0,B2:0},inputs=[];
    TRADES.forEach(t=>avail[t]=(Number(heads[t])||0)*Number(r.prod));
    S.packs.filter(p=>p.status!=='Closed').forEach(p=>{const s=dayNum(p.start_date);if(d>=s&&d<s+p.days){inputs.push(p);const h=packHrs(p);TRADES.forEach(t=>need[t]+=h[t]/p.days)}});
    out.push({d,date,avail,need,inputs,heads})}
  return out;
}
const openPacks=()=>S.packs.filter(p=>p.status!=='Closed').sort((a,b)=>a.start_date.localeCompare(b.start_date));
const pctClass=p=>p===0?'c0':p<85?'c1':p<=100?'c2':'c3';

/* ---------- shell ---------- */
function setLive(s){const el=$('live');el.className='live '+s;el.querySelector('span').textContent=s==='on'?'Live':s==='off'?'Offline — reconnecting':'Connecting'}
function tabsHtml(){
  const openEsc=S.escapes.filter(e=>!e.done).length,openHo=S.handover.filter(h=>!h.done).length;
  return ROLES[role].tabs.map(([k,l])=>`<button role="tab" data-view="${k}" aria-selected="${k===view}">${esc(l)}${k==='escapes'&&openEsc?`<span class="n">${openEsc}</span>`:''}${k==='handover'&&openHo?`<span class="n">${openHo}</span>`:''}${k==='mat'&&openRequests().length?`<span class="n">${openRequests().length}</span>`:''}</button>`).join('');
}
let pending=false,ptr=false;
document.addEventListener('pointerdown',()=>{ptr=true},true);
document.addEventListener('pointerup',()=>setTimeout(()=>{ptr=false;if(pending){const a=document.activeElement;if(!(a&&$('view').contains(a)&&/^(INPUT|TEXTAREA)$/.test(a.tagName)&&a.type!=='checkbox')){pending=false;render()}}},80),true);
function schedule(){if(ptr){pending=true;return}const a=document.activeElement;if(a&&$('view').contains(a)&&/^(INPUT|TEXTAREA)$/.test(a.tagName)&&a.type!=='checkbox'){pending=true;return}render()}
document.addEventListener('focusout',()=>{if(pending)setTimeout(()=>{if(ptr)return;const a=document.activeElement;if(!(a&&$('view').contains(a)&&/^(INPUT|TEXTAREA)$/.test(a.tagName)&&a.type!=='checkbox')){pending=false;render()}},60)});
function render(){
  document.body.className='role-'+role;
  $('roleSel').value=role;
  $('tabs').innerHTML=tabsHtml();
  if(!ready)return;
  const V={register:vRegister,new:vNew,pack:vPack,capacity:vCapacity,tasks:vTasks,escapes:vEscapes,handover:vHandover,mat:vMat,tool:vTool,floor:vFloor,trends:vTrends};
  const sy=scrollY;$('view').innerHTML=V[view]();scrollTo(0,sy);
}
function go(v){view=v;render();scrollTo(0,0)}
function setRole(r){role=r;ls.set('pp.role',r);try{history.replaceState(null,'','#'+r)}catch(e){}view=ROLES[r].tabs[0][0];render();scrollTo(0,0)}

/* ---------- shared bits ---------- */
const hrsBlock=h=>`<div class="hrs">${TRADES.map(t=>`<div><span class="label">${t}</span><b>${fmt(h[t])} h</b></div>`).join('')}</div>`;
function meter(p,goodHigh=true){const c=p>=85?'var(--ok)':p>=50?'var(--warn)':'var(--bad)';return `<div class="meter"><div class="bar"><i style="width:${p}%;background:${goodHigh?c:'var(--accent)'}"></i></div><b>${p}%</b></div>`}
const stTag=(s,lbl)=>s==='none'?'<span class="tag">None</span>':`<span class="tag ${s}">${lbl||({ok:'Ready',warn:'Pending',bad:'Issue'}[s])}</span>`;
const lvl=s=>['In stock','Kitted','Issued','Available','Booked'].includes(s)?'ok':['Not available','U/S','In calibration'].includes(s)?'bad':'warn';
const packSelect=(list,cur,id='packSel')=>`<label class="label">Work pack <select id="${id}">${list.map(x=>`<option value="${x.id}"${x.id===cur?' selected':''}>${esc(x.ac)} · ${esc(x.check_type)} · ${esc(x.id)}</option>`).join('')}</select></label>`;
function feed(packId){
  const A=S.activity.filter(a=>!packId||a.pack_id===packId).slice(0,25);
  return `<section class="card"><h3>Activity</h3>${A.length?`<div class="feed">${A.map(a=>`<div><span class="when">${ago(a.t)}</span><span>${esc(a.text)}</span><span class="by">${esc(ROLES[a.role]?.name||a.role||'')}${a.actor?' · '+esc(a.actor):''}</span></div>`).join('')}</div>`:'<div class="empty">Nothing yet. Changes from every stakeholder appear here as they happen.</div>'}</section>`;
}
function emptyAll(){return `<div class="setup card"><h2>No data yet</h2><p class="sub">The database is connected but empty. Run <code>supabase/seed.sql</code> in the Supabase SQL editor to load the demo data, or start by creating a work pack.</p></div>`}

/* ---------- views ---------- */
function vRegister(){
  const P=openPacks();if(!P.length&&!S.tasks.length)return emptyAll();
  const cap=capacity(21),peak=Math.max(0,...cap.flatMap(c=>TRADES.map(t=>c.avail[t]?c.need[t]/c.avail[t]*100:0)));
  const pending=P.reduce((a,p)=>a+live(p).filter(w=>w.decision==='Pending').length,0);
  const spIss=P.reduce((a,p)=>a+counted(p).filter(w=>spareSt(w)==='bad').length,0);
  const tlIss=P.reduce((a,p)=>a+counted(p).filter(w=>toolSt(w)==='bad').length,0);
  const openBtn={planner:['pack','Open work pack'],materials:['mat','Open parts'],tooling:['tool','Open tools'],shiftlead:['floor','Open shift board'],management:['pack','']}[role];
  return `<div class="strip">
    <div class="tile"><span class="label">Open work packs</span><span class="big">${P.length}</span><span class="meta">${P.filter(p=>p.status==='In work').length} in work</span></div>
    <div class="tile ${pending?'warn':''}"><span class="label">WOs awaiting decision</span><span class="big">${pending}</span></div>
    <div class="tile ${spIss?'bad':''}"><span class="label">Spares issues</span><span class="big">${spIss}</span><span class="meta">short or not available</span></div>
    <div class="tile ${tlIss?'bad':''}"><span class="label">Tooling issues</span><span class="big">${tlIss}</span><span class="meta">U/S or in calibration</span></div>
    <div class="tile ${peak>100?'bad':peak>=85?'warn':''}"><span class="label">Peak trade loading</span><span class="big">${Math.round(peak)}%</span><span class="meta">next 21 days</span></div>
  </div>
  <div class="grid2"><div style="display:grid;gap:16px">
  <section class="card" style="padding-bottom:4px"><h2>Work pack register</h2><p class="sub">Each stakeholder ticks off their own items; the grey ones fill in automatically from the work orders.</p></section>
  <div class="packs">${P.map(p=>{const r=readiness(p),g=progress(p),dn=dayNum(p.start_date),L=live(p);
    return `<article class="pack">
      <div class="ttl"><b>${esc(p.ac)} · ${esc(p.check_type)}</b><span class="status ${p.status.replace(' ','-')}">${esc(p.status)}</span></div>
      <div class="row spread"><span class="mono" style="font-size:13px">${esc(p.id)} · v${p.version}</span><span class="countdown${dn<=3&&dn>0?' soon':''}">${dn<=0?'Started '+dShort(p.start_date):dShort(p.start_date)+' · in '+dn+'d'}</span></div>
      ${p.status==='In work'?`<span class="label">Work orders complete ${g.done}/${g.total}</span>${meter(g.pct,false)}`:`<span class="label">Readiness</span>${meter(r.pct)}`}
      <div class="checks">${r.items.map(i=>{const can=i.owner===role;return `<label class="${can?'':'auto'}" title="${i.owner==='auto'?'Fills in automatically':'Set by '+ROLES[i.owner].name}"><input type="checkbox" ${i.v?'checked':''} ${can?'':'disabled'} data-chk="${p.id}|${i.k}">${esc(i.l)}</label>`}).join('')}</div>
      ${hrsBlock(packHrs(p))}
      <div class="row spread"><span class="label">${L.filter(w=>w.decision==='Accepted').length}/${L.length} accepted · ${L.filter(w=>w.type==='ADF').length} ADF</span>${openBtn[1]?`<button class="link" data-open="${p.id}" data-to="${openBtn[0]}">${openBtn[1]} →</button>`:''}</div>
    </article>`}).join('')||'<div class="empty">No open work packs. The planner can create one.</div>'}</div></div>
  ${feed()}</div>`;
}

const ataOf=ref=>(String(ref||'').split('-')[1]||'');
const parseSpares=txt=>String(txt||'').split('\n').map(x=>x.trim()).filter(Boolean).map(x=>{const [pn,q]=x.split(/[,×x*]\s*(?=\d+\s*$)/);return {pn:(pn||x).replace(/,\s*$/,'').trim().toUpperCase(),qty:Number(q)||1}});
const parseTools=txt=>String(txt||'').split('\n').map(x=>x.trim()).filter(Boolean);
function manualFields(){
  return `<label><span class="label">Work order number</span><input type="text" name="mNo" placeholder="e.g. WO-480300 (blank = auto)" autocomplete="off"></label>
    <label><span class="label">Type</span><select name="mType"><option value="ADF">ADF / defect</option><option value="OMP">Task not in database</option></select></label>
    <label style="grid-column:span 2"><span class="label">Description</span><input type="text" name="mTitle" placeholder="e.g. Hydraulic seep at LH flap actuator"></label>
    ${TRADES.map(t=>`<label><span class="label">${t} hours</span><input type="number" step="0.5" min="0" name="m${t}" value="0"></label>`).join('')}
    <div class="wide"><span class="label">Needs</span><div class="authpick row" style="gap:10px;margin-top:4px">${FLAGS.map(([k,l])=>`<label class="row" style="gap:4px;font-size:13px"><input type="checkbox" name="mf_${k}">${l}</label>`).join('')}</div></div>
    <label style="grid-column:span 2"><span class="label">Tools / GSE required (one per line)</span><textarea name="mTools" rows="3" placeholder="Torque wrench 200-800 Nm&#10;Access platform"></textarea></label>
    <label style="grid-column:span 2"><span class="label">Spares required (one per line: part number, qty)</span><textarea name="mSpares" rows="3" placeholder="DEMO-SEAL-1234, 2&#10;DEMO-FST-0001, 6"></textarea></label>`;
}
function manualFromForm(f){
  const title=(f.get('mTitle')||'').trim();if(!title)return {err:'Add a description for the work order'};
  let no=(f.get('mNo')||'').trim().toUpperCase().replace(/\s+/g,'');
  if(no&&(S.work_orders.some(w=>w.no===no)||newManual.some(m=>m.no===no)||Object.values(newWoNos).includes(no)))return {err:`${no} is already in use`};
  const hrs={};TRADES.forEach(t=>hrs[t]=Number(f.get('m'+t))||0);
  const flags={};FLAGS.forEach(([k])=>{if(f.get('mf_'+k))flags[k]=1});
  const type=f.get('mType')==='OMP'?'OMP':'ADF';
  return {row:{no:no||null,ref:null,type,title:type==='ADF'&&!/^ADF/i.test(title)?'ADF: '+title:title,hrs,flags,
    parts:parseSpares(f.get('mSpares')).map(m=>({pn:m.pn,exp:m.qty,qty:m.qty,stock:'Requested',eta:null,src:'standard'})),
    tools:parseTools(f.get('mTools')).map(n=>({name:n,status:'Not checked',note:''}))}};
}
function taskMatches(t,F){
  if(F.ata&&ataOf(t.ref)!==F.ata)return false;
  if(F.selOnly&&!newSel.has(t.ref))return false;
  if(!F.q)return true;
  const hay=(t.ref+' '+t.title+' '+(t.materials||[]).map(m=>m.pn).join(' ')+' '+(t.tooling||[]).join(' ')).toLowerCase();
  return F.q.toLowerCase().split(/\s+/).filter(Boolean).every(w=>hay.includes(w));
}
function rankTasks(list,q){q=(q||'').trim().toLowerCase();if(!q)return list;
  const score=t=>{const ti=t.title.toLowerCase(),r=t.ref.toLowerCase();return r===q?0:ti.includes(q)?1:r.startsWith(q)?2:3};
  return list.map(t=>[score(t),t]).sort((a,b)=>a[0]-b[0]||a[1].ref.localeCompare(b[1].ref)).map(x=>x[1])}
function vNew(){
  const today=newDraft.start||isoOf(addDays(T0,7)),D=newDraft,F=newFilter;
  const list=S.tasks.slice().sort((a,b)=>a.ref.localeCompare(b.ref));
  const atas=[...new Set(list.map(t=>ataOf(t.ref)))].sort();
  const shown=rankTasks(list.filter(t=>taskMatches(t,F)),F.q),LIM=150;
  const sel=list.filter(t=>newSel.has(t.ref));const h={Mech:0,B1:0,B2:0};
  sel.forEach(t=>TRADES.forEach(x=>h[x]+=Number(t.hrs[x])||0));newManual.forEach(m=>TRADES.forEach(x=>h[x]+=Number(m.hrs[x])||0));
  const total=sel.length+newManual.length;
  return `<section class="card"><h2>New work pack</h2><p class="sub">Load the work pack summary from short-term planning. Search the task database for OMP tasks, give each its work order number, and add any manual work orders.</p>
  <form class="form" id="newForm" style="margin-top:0">
    <label><span class="label">Aircraft</span><input type="text" name="ac" required placeholder="e.g. A05" maxlength="12" value="${esc(D.ac||'')}"></label>
    <label><span class="label">Check type</span><input type="text" name="check" required placeholder="e.g. Base check (6M)" list="checkTypes" value="${esc(D.check||'')}"><datalist id="checkTypes"><option>Weekly check</option><option>Base check (6M)</option><option>Base check (12M)</option><option>Out-of-phase tasks</option></datalist></label>
    <label><span class="label">Input starts</span><input type="date" name="start" value="${today}" required></label>
    <label><span class="label">Days</span><input type="number" name="days" value="${esc(D.days||3)}" min="1" max="60" required></label>
  </form></section>
  <section class="card"><div class="row spread"><h3 style="margin:0">OMP tasks <span class="label">${list.length} in database</span></h3><span class="row"><button type="button" id="selShown">Select all shown</button><button type="button" id="selNone">Clear selection</button></span></div>
    <div class="row" style="margin:10px 0">
      <input type="search" id="newSearch" placeholder="Search ref, title, part number or tool — e.g. MLG brake" value="${esc(F.q)}" style="flex:1 1 260px" aria-label="Search tasks">
      <select id="newAta" aria-label="ATA chapter"><option value="">All ATA chapters</option>${atas.map(a=>`<option value="${a}"${F.ata===a?' selected':''}>ATA ${a}</option>`).join('')}</select>
      <label class="row" style="gap:4px;font-size:13px"><input type="checkbox" id="newSelOnly" ${F.selOnly?'checked':''}> Selected only</label>
    </div>
    <p class="label" id="newCount" style="margin:0 0 6px">${shown.length} match${shown.length===1?'':'es'}${shown.length>LIM?` · showing first ${LIM}, refine the search`:''}</p>
    <div class="tasklist">${shown.slice(0,LIM).map(t=>`<label><input type="checkbox" data-newtask="${esc(t.ref)}" ${newSel.has(t.ref)?'checked':''}><span><b class="mono" style="font-size:12px">${esc(t.ref)}</b>${t.ind?'':' <span class="tag warn">review</span>'}<br>${esc(t.title)}<br><span class="label">${TRADES.filter(x=>t.hrs[x]).map(x=>x+' '+fmt(t.hrs[x])+'h').join(' · ')}${(t.materials||[]).length?' · '+t.materials.length+' spare'+(t.materials.length>1?'s':''):''}</span></span></label>`).join('')||'<div class="empty">No tasks match. Try fewer words or another ATA chapter.</div>'}</div>
  </section>
  <section class="card"><h3>Manual work order</h3><p class="sub">For defects (ADFs) and anything not in the task database. Tools and spares entered here go straight to Tooling and Materials when the pack is created.</p>
    <form class="form" id="manualNew" style="margin-top:0">${manualFields()}<div><button type="submit">Add to this work pack</button></div></form></section>
  <section class="card"><h3>Work orders in this pack (${total})</h3>
    ${total?`<div class="tablewrap"><table><thead><tr><th>Work order number</th><th>Task</th>${TRADES.map(t=>`<th class="num">${t}</th>`).join('')}<th>Tools</th><th>Spares</th><th></th></tr></thead><tbody>
      ${sel.map(t=>`<tr><td><input type="text" data-newwo="${esc(t.ref)}" value="${esc(newWoNos[t.ref]||'')}" placeholder="auto" size="12" aria-label="Work order number for ${esc(t.ref)}"></td><td>${esc(t.title)}<div class="mono" style="font-size:11px;color:var(--muted)">${esc(t.ref)}</div></td>${TRADES.map(x=>`<td class="num">${t.hrs[x]?fmt(t.hrs[x]):'–'}</td>`).join('')}<td style="font-size:12px">${(t.tooling||[]).map(esc).join('<br>')||'–'}</td><td class="mono" style="font-size:12px">${(t.materials||[]).map(m=>esc(m.pn)+' ×'+m.qty).join('<br>')||'–'}</td><td><button class="link" data-unsel="${esc(t.ref)}">Remove</button></td></tr>`).join('')}
      ${newManual.map((m,i)=>`<tr><td class="mono">${esc(m.no||'auto')}</td><td>${esc(m.title)} <span class="tag acc">${m.type==='ADF'?'ADF':'Manual'}</span></td>${TRADES.map(x=>`<td class="num">${m.hrs[x]?fmt(m.hrs[x]):'–'}</td>`).join('')}<td style="font-size:12px">${m.tools.map(x=>esc(x.name)).join('<br>')||'–'}</td><td class="mono" style="font-size:12px">${m.parts.map(x=>esc(x.pn)+' ×'+x.qty).join('<br>')||'–'}</td><td><button class="link" data-unman="${i}">Remove</button></td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">Tick tasks above or add a manual work order.</div>'}
    <div style="margin-top:12px">${hrsBlock(h)}</div>
    <div class="row" style="margin-top:12px"><button class="primary" id="createPack">Create work pack with ${total} work order${total===1?'':'s'}</button></div>
  </section>`;
}
function applyNewFilter(){
  // filter in place so typing in the search box never loses focus
  const list=S.tasks.slice().sort((a,b)=>a.ref.localeCompare(b.ref)),shown=rankTasks(list.filter(t=>taskMatches(t,newFilter)),newFilter.q),LIM=150;
  const box=document.querySelector('.tasklist');if(!box)return;
  box.innerHTML=shown.slice(0,LIM).map(t=>`<label><input type="checkbox" data-newtask="${esc(t.ref)}" ${newSel.has(t.ref)?'checked':''}><span><b class="mono" style="font-size:12px">${esc(t.ref)}</b>${t.ind?'':' <span class="tag warn">review</span>'}<br>${esc(t.title)}<br><span class="label">${TRADES.filter(x=>t.hrs[x]).map(x=>x+' '+fmt(t.hrs[x])+'h').join(' · ')}${(t.materials||[]).length?' · '+t.materials.length+' spare'+(t.materials.length>1?'s':''):''}</span></span></label>`).join('')||'<div class="empty">No tasks match. Try fewer words or another ATA chapter.</div>';
  $('newCount').textContent=`${shown.length} match${shown.length===1?'':'es'}${shown.length>LIM?` · showing first ${LIM}, refine the search`:''}`;
}
const floorFields=()=>role==='shiftlead'?{decision:'Accepted',comment:`Added on the floor by Shift lead${actor()?' ('+actor()+')':''}`}:{};
function addWoSection(p){
  const floor=role==='shiftlead';
  return `<section class="card"><h3>Add work order${floor?'':' to v'+p.version}</h3>${floor?'<p class="sub">For work found on the floor. It goes straight onto this board as accepted, marked as added by the shift lead so the planner can see it.</p>':''}
    <form class="form" id="addWoTask" style="margin-top:0">
      <label style="grid-column:span 2"><span class="label">From the task database (type to search ${S.tasks.length} tasks)</span><input type="text" name="task" list="taskOpts" placeholder="e.g. MLG brake, OMP-32, DEMO-32A" autocomplete="off"><datalist id="taskOpts">${S.tasks.map(t=>`<option value="${esc(t.ref)} — ${esc(t.title)}"></option>`).join('')}</datalist></label>
      <label><span class="label">Work order number</span><input type="text" name="woNo" placeholder="blank = auto" autocomplete="off"></label>
      <div><button class="primary" type="submit">Add task</button></div></form>
    <h3 style="margin-top:18px">Or add a manual work order</h3><p class="sub">Tools and spares entered here go straight to Tooling and Materials.</p>
    <form class="form" id="addWoManual" style="margin-top:0">${manualFields()}<div><button class="primary" type="submit">Add manual work order</button></div></form></section>`;
}
function vPack(){
  const P=S.packs.slice().sort((a,b)=>(a.status==='Closed')-(b.status==='Closed')||a.start_date.localeCompare(b.start_date));
  if(!P.length)return `<div class="empty">No work packs yet. <button class="link" data-goto="new">Create one →</button></div>`;
  const p=packById(curPack)||P[0];curPack=p.id;
  const v=curVer&&curVer<=p.version?curVer:p.version, isCur=v===p.version, editable=role==='planner'&&p.status!=='Closed';
  const all=wosOf(p).filter(w=>w.added_v<=v), L=live(p,v);
  const added=all.filter(w=>w.added_v===v&&v>1).length, removed=all.filter(w=>w.removed_v===v).length;
  const flagCount=FLAGS.map(([k,l])=>[l,L.filter(w=>w.decision!=='Rejected'&&w.flags?.[k]).length]).filter(x=>x[1]);
  const r=readiness(p),g=progress(p);
  const rows=all.sort((a,b)=>(a.type>b.type)-(a.type<b.type)||a.no.localeCompare(b.no)).map(w=>{const rem=w.removed_v&&w.removed_v<=v;const t=w.ref&&taskByRef(w.ref);const ed=editable&&isCur&&!rem;
    return `<tr class="${rem?'removed':''} ${w.decision==='Rejected'&&!rem?'rejected':''}">
      <td class="mono">${esc(w.no)}${w.added_v===v&&v>1?' <span class="tag acc">NEW v'+v+'</span>':''}${rem?' <span class="tag keep">REMOVED v'+w.removed_v+'</span>':''}</td>
      <td>${esc(w.title)}<div class="mono" style="font-size:11px;color:var(--muted)">${w.ref?esc(w.ref):'Non-routine'}</div></td>
      <td>${w.type==='OMP'?(t&&t.ind?'<span class="tag ok">OMP ✓</span>':'<span class="tag warn">OMP · review</span>'):'<span class="tag acc">ADF</span>'}</td>
      ${TRADES.map(tr=>`<td class="num">${w.hrs?.[tr]?fmt(w.hrs[tr]):'–'}</td>`).join('')}
      <td>${stTag(spareSt(w))}</td><td>${stTag(toolSt(w))}</td>
      <td><div class="tags">${FLAGS.filter(([k])=>w.flags?.[k]).map(([,l])=>`<span class="tag">${l}</span>`).join('')}</div></td>
      <td class="keep">${ed?`<select class="s-${w.decision}" data-dec="${esc(w.no)}" aria-label="Decision">${DECISIONS.map(s=>`<option${s===w.decision?' selected':''}>${s}</option>`).join('')}</select>`:`<span class="tag">${esc(w.decision)}</span>`}</td>
      <td class="keep">${ed?`<input type="text" value="${esc(w.comment)}" data-woc="${esc(w.no)}" placeholder="Note for shift lead" aria-label="Note for shift lead" style="width:100%;min-width:170px">`:esc(w.comment)}</td>
      <td class="keep">${p.status==='In work'||p.status==='Closed'?`<span class="tag ${isPaused(w)?'bad':w.progress==='Complete'?'ok':w.progress==='Passed back'?'bad':w.progress==='In progress'?'warn':''}">${isPaused(w)?'Paused — '+esc(w.pause_reason||''):esc(w.progress)}</span>`:''}${ed&&!rem&&w.decision!=='Rejected'?` <button class="link" data-xsp="${esc(w.no)}">+ Spares</button>`:''}${ed&&!rem?` <button class="link" data-rmwo="${esc(w.no)}" title="Remove in this version">Remove</button>`:''}</td></tr>`}).join('');
  const taskOpts=S.tasks.map(t=>`<option value="${esc(t.ref)}">${esc(t.ref)} — ${esc(t.title)}</option>`).join('');
  return `<section class="card"><div class="row spread"><div><h2>${esc(p.ac)} · ${esc(p.check_type)} <span class="status ${p.status.replace(' ','-')}">${esc(p.status)}</span></h2><p class="sub" style="margin:0">${esc(p.id)} · input ${dShort(p.start_date)} for ${p.days} days</p></div>
    <div class="row">${packSelect(P,p.id)}
    <label class="label">Version <select id="verSel">${Array.from({length:p.version},(_,i)=>i+1).map(n=>`<option value="${n}"${n===v?' selected':''}>v${n}${n===p.version?' (current)':''}</option>`).join('')}</select></label></div></div>
    <div class="row" style="margin-top:12px;gap:16px"><div style="flex:1;min-width:200px">${p.status==='In work'?`<span class="label">Work orders complete ${g.done}/${g.total}</span>${meter(g.pct,false)}`:`<span class="label">Readiness</span>${meter(r.pct)}`}</div>
    ${editable?`<div class="row">${p.status==='Planning'?`<button id="newVer">Start version ${p.version+1}</button><button class="primary" id="release">Release to production</button>`:''}
      ${p.status==='In work'?`<label class="label">Days over <input type="number" id="lateDays" value="0" min="0" style="width:56px"></label><button class="primary" id="closePack">Close work pack</button>`:''}</div>`:''}</div>
    ${editable&&p.status==='Planning'&&r.pct<100?`<p class="warnbar" style="margin:10px 0 0">Readiness is ${r.pct}%. You can still release; open items stay visible to every stakeholder.</p>`:''}</section>
  <div class="strip">
    <div class="tile"><span class="label">Work orders (v${v})</span><span class="big">${L.length}</span><span class="meta">${added?'+'+added+' added ':''}${removed?'−'+removed+' removed':''}${!added&&!removed?'no change from previous':''}</span></div>
    <div class="tile"><span class="label">Decisions</span><span class="big">${L.filter(w=>w.decision!=='Pending').length}/${L.length}</span><span class="meta">${L.filter(w=>w.decision==='Rejected').length} rejected · ${L.filter(w=>w.decision==='G703').length} G703</span></div>
    <div class="tile">${hrsBlock(packHrs(p))}</div>
    <div class="tile"><span class="label">Resources flagged</span><div class="tags">${flagCount.map(([l,n])=>`<span class="tag ${['Crane','Defuel','Paint'].includes(l)?'warn':''}">${l} ×${n}</span>`).join('')||'<span class="tag">None</span>'}</div></div>
  </div>
  <section class="card"><h3>Work orders</h3><p class="sub">Spares and tools status come live from Materials and Tooling. Decisions and notes go straight to the shift lead.</p>
  <div class="tablewrap"><table><thead><tr><th>WO</th><th>Task</th><th>Type</th>${TRADES.map(t=>`<th class="num">${t}</th>`).join('')}<th>Spares</th><th>Tools</th><th>Needs</th><th>Decision</th><th>Note for shift lead</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
</section>
  ${editable&&isCur?addWoSection(p):''}
  ${editable?extraForm(counted(p),p.id):''}
  ${feed(p.id)}`;
}

function vCapacity(){
  const cap=capacity(21),P=openPacks(),r=roster();
  const head=cap.map(c=>`<th class="${[0,6].includes(c.date.getDay())?'':'wk'}">${c.date.toLocaleDateString('en-GB',{weekday:'narrow'})}<br>${c.date.getDate()}</th>`).join('');
  const rows=TRADES.map(t=>`<tr><td class="tr">${t}</td>${cap.map(c=>{const p=c.avail[t]?Math.round(c.need[t]/c.avail[t]*100):0;
    return `<td><div class="cell ${pctClass(p)}" title="${dShort(isoOf(c.date))} ${t}: ${fmt(c.need[t])} h needed / ${fmt(c.avail[t])} h available (${c.heads[t]} on roster)">${p?p+'%':'–'}</div></td>`}).join('')}</tr>`).join('');
  const inRow=P.map(p=>`<tr class="inrow"><td class="tr" style="font-size:13px">${esc(p.ac)}</td>${cap.map(c=>`<td>${c.inputs.includes(p)?`<div class="inbar" title="${esc(p.id)}">${dayNum(p.start_date)===c.d||c.d===0?esc(p.ac):''}</div>`:''}</td>`).join('')}</tr>`).join('');
  const over=[];cap.forEach(c=>TRADES.forEach(t=>{if(c.avail[t]&&c.need[t]>c.avail[t])over.push(`${dShort(isoOf(c.date))} — ${t} ${Math.round(c.need[t]/c.avail[t]*100)}% (${fmt(c.need[t]-c.avail[t])} h short)`)}));
  const ed=role==='planner';
  return `<section class="card"><h2>Capacity by trade</h2><p class="sub">Work order hours from each open input, spread across its days, against productive hours from the roster. Rejected work orders are left out.</p>
  <div class="tablewrap"><table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}<tr><td colspan="${cap.length+1}" style="height:8px"></td></tr>${inRow}</tbody></table></div>
  <div class="legend" style="margin-top:12px"><span><i class="c1"></i>Under 85%</span><span><i class="c2"></i>85–100%</span><span><i class="c3"></i>Over 100%</span><span><i class="c0" style="border:1px solid var(--line)"></i>No work planned</span></div></section>
  <section class="card"><h3>Over capacity</h3>${over.length?`<div class="tags">${over.map(o=>`<span class="tag bad">${esc(o)}</span>`).join('')}</div>`:'<div class="empty">No trade is over 100% in the next 21 days.</div>'}</section>
  <section class="card"><h3>Roster</h3><p class="sub">Heads on shift per day (both shifts). In the full build this comes from the shift roster feed.</p>
  <div class="tablewrap"><table><thead><tr><th></th>${TRADES.map(t=>`<th class="num">${t}</th>`).join('')}</tr></thead><tbody>
  ${['weekday','weekend'].map(k=>`<tr><td>${k==='weekday'?'Mon–Fri':'Sat–Sun'}</td>${TRADES.map(t=>`<td class="num">${ed?`<input type="number" min="0" value="${r[k][t]}" data-roster="${k}|${t}" aria-label="${k} ${t}">`:r[k][t]}</td>`).join('')}</tr>`).join('')}
  <tr><td>Productive h per person</td><td class="num" colspan="3">${ed?`<input type="number" step="0.25" min="0" value="${r.prod}" data-roster="prod" aria-label="Productive hours">`:r.prod}</td></tr></tbody></table></div></section>`;
}

function vTasks(){
  const all=S.tasks.filter(t=>taskMatches(t,{q:taskFilter,ata:'',selOnly:false})).sort((a,b)=>a.ref.localeCompare(b.ref)),list=all.slice(0,100);
  const escN=r=>S.escapes.filter(e=>e.ref===r&&!e.done).length;
  return `<section class="card"><div class="row spread"><div><h2>Task database</h2><p class="sub" style="margin:0">Industrialised OMP tasks. Edit hours and standard spares here and every new work pack uses them. ${S.tasks.filter(t=>t.ind).length} of ${S.tasks.length} industrialised.</p></div>
  <input type="search" id="taskFilter" placeholder="Search ref, title, part number or tool" value="${esc(taskFilter)}" aria-label="Search tasks" style="min-width:260px"></div>
  <p class="label" style="margin:8px 0 0">${all.length} task${all.length===1?'':'s'}${all.length>100?' · showing first 100, refine the search':''}</p>
  <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Task ref</th><th>Title</th>${TRADES.map(t=>`<th class="num">${t} h</th>`).join('')}<th>Tooling / GSE</th><th>Standard spares <span style="text-transform:none">(one per line: part, qty)</span></th><th>Needs</th><th>Status</th></tr></thead><tbody>
  ${list.map(t=>`<tr><td class="mono">${esc(t.ref)}</td><td>${esc(t.title)}</td>${TRADES.map(tr=>`<td class="num"><input type="number" step="0.5" min="0" value="${t.hrs[tr]||0}" data-thrs="${esc(t.ref)}|${tr}" aria-label="${tr} hours"></td>`).join('')}
    <td style="font-size:13px">${(t.tooling||[]).map(esc).join('<br>')||'–'}</td>
    <td><textarea rows="${Math.max(2,(t.materials||[]).length+1)}" data-tmat="${esc(t.ref)}" placeholder="PART-NUMBER, qty" aria-label="Standard spares" style="min-width:180px">${esc((t.materials||[]).map(m=>m.pn+', '+m.qty).join('\n'))}</textarea></td>
    <td><div class="tags">${FLAGS.filter(([k])=>t.flags?.[k]).map(([,l])=>`<span class="tag">${l}</span>`).join('')}</div></td>
    <td><label class="row" style="font-size:13px;gap:4px"><input type="checkbox" data-tind="${esc(t.ref)}" ${t.ind?'checked':''}>Industrialised</label>${escN(t.ref)?`<span class="tag bad">${escN(t.ref)} open escape</span>`:''}</td></tr>`).join('')}
  </tbody></table></div></section>`;
}

function vEscapes(){
  const open=S.escapes.filter(e=>!e.done),pre=escPrefill||{};
  const packOpts=openPacks().map(p=>`<option value="${p.id}"${pre.pack===p.id?' selected':''}>${esc(p.ac)} · ${esc(p.id)}</option>`).join('');
  const refs=S.tasks.map(t=>`<option value="${esc(t.ref)}"${pre.ref===t.ref?' selected':''}>${esc(t.ref)} — ${esc(t.title)}</option>`).join('');
  return `<div class="strip"><div class="tile ${open.length?'warn':''}"><span class="label">Open escapes</span><span class="big">${open.length}</span><span class="meta">task database not yet updated</span></div><div class="tile"><span class="label">Closed</span><span class="big">${S.escapes.length-open.length}</span></div></div>
  <section class="card"><h2>Escapes</h2><p class="sub">Anything found on the floor that the plan didn't expect. The planner updates the task database and ticks it closed, so the next input gets the corrected data.</p>
  <div class="tablewrap"><table><thead><tr><th>Date</th><th>Task</th><th>Raised by</th><th>Type</th><th>What happened</th><th>Action</th><th>DB updated</th></tr></thead><tbody>
  ${S.escapes.slice().sort((a,b)=>a.done-b.done||b.date.localeCompare(a.date)).map(e=>`<tr class="${e.done?'done':''}"><td class="mono">${dShort(e.date)}</td><td class="mono">${esc(e.ref||'')}<div style="font-size:11px;color:var(--muted)">${esc(e.pack_id||'')}</div></td><td>${esc(e.raised_by)}</td><td><span class="tag">${esc(e.type)}</span></td><td>${esc(e.detail)}</td><td>${esc(e.action)}</td><td><input type="checkbox" data-esc="${e.id}" ${e.done?'checked':''} ${role==='planner'?'':'disabled'} aria-label="Database updated"></td></tr>`).join('')}
  </tbody></table></div>
  <form class="form" id="escForm"><label><span class="label">Work pack</span><select name="pack">${packOpts}</select></label>
    <label><span class="label">Task</span><select name="ref"><option value="">Non-routine / ADF</option>${refs}</select></label>
    <label><span class="label">Raised by</span><select name="by"><option>Mech</option><option>B1 certifier</option><option>B2 certifier</option><option${role==='shiftlead'?' selected':''}>Shift lead</option><option${role==='planner'?' selected':''}>Planner</option></select></label>
    <label><span class="label">Type</span><select name="type"><option>More time</option><option>Less time</option><option>Spares change</option><option>Tooling / GSE</option><option>Damage found</option><option>Task card unclear</option></select></label>
    <label class="wide"><span class="label">What happened</span><input type="text" name="detail" required value="${esc(pre.detail||'')}"></label>
    <label class="wide"><span class="label">Action for the task database</span><input type="text" name="action"></label>
    <div><button class="primary" type="submit">Log escape</button></div></form></section>`;
}

function vHandover(){
  const L={wp:'Work order / work pack',145:'Affects the 145',mp:'Affects the maintenance plan'};
  const col=k=>{const items=S.handover.filter(h=>h.level===k).sort((a,b)=>a.done-b.done||b.date.localeCompare(a.date));
    return `<section class="card"><h3>${L[k]}</h3><div style="display:grid;gap:8px">${items.map(h=>`<div class="ho${h.done?' done':''}"><b>${esc(h.ref)}</b><span><span class="label">Issue</span> ${esc(h.issue)}</span><span><span class="label">Plan</span> ${esc(h.plan)}</span>
      <div class="row spread"><span class="meta">${esc(ROLES[h.role]?.name||h.role||'')} · ${dShort(h.date)}</span><label class="row meta"><input type="checkbox" data-ho="${h.id}" ${h.done?'checked':''}> Closed</label></div></div>`).join('')||'<div class="empty">Nothing open.</div>'}</div></section>`};
  return `<div class="cols">${col('wp')}${col('145')}${col('mp')}</div>
  <section class="card"><h3>Add to handover</h3><form class="form" id="hoForm">
    <label><span class="label">Level</span><select name="level"><option value="wp">Work order / work pack</option><option value="145">Affects the 145</option><option value="mp">Affects the maintenance plan</option></select></label>
    <label><span class="label">Reference</span><input type="text" name="ref" placeholder="e.g. WP-26-0412 · A01" required></label>
    <label class="wide"><span class="label">What's going to cause problems</span><input type="text" name="issue" required></label>
    <label class="wide"><span class="label">Plan to correct it</span><input type="text" name="plan"></label>
    <div><button class="primary" type="submit">Add</button></div></form></section>`;
}

function deptQueue(kind){
  const isMat=kind==='parts',P=openPacks(),ST=isMat?MAT_ST:TOOL_ST;
  if(!P.length)return '<div class="empty">No open work packs.</div>';
  const p=packById(curPack)&&packById(curPack).status!=='Closed'?packById(curPack):P[0];curPack=p.id;
  const W=counted(p).filter(w=>(w[kind]||[]).length||isMat);
  const lines=W.flatMap(w=>w[kind]||[]);const c={ok:0,warn:0,bad:0};lines.forEach(l=>c[lvl(isMat?l.stock:l.status)]++);
  const short=isMat?lines.filter(l=>l.exp!=null&&Number(l.qty)<Number(l.exp)).length:0;
  const rows=W.filter(w=>(w[kind]||[]).length).map(w=>`<tr style="background:var(--bg)"><td colspan="${isMat?6:4}"><b class="mono">${esc(w.no)}</b> · ${esc(w.title)} ${stTag(isMat?spareSt(w):toolSt(w))}</td></tr>`+
    w[kind].map((l,i)=>isMat?`<tr><td class="mono">${esc(l.pn)}</td><td class="num">${l.exp??'–'}</td>
      <td class="num"><input type="number" min="0" value="${l.qty}" data-pq="${esc(w.no)}|${i}" aria-label="Ordered quantity"></td>
      <td>${l.exp!=null&&Number(l.qty)<Number(l.exp)?`<span class="tag bad">${Number(l.qty)?'Short '+(l.exp-l.qty):'Not ordered'}</span>`:l.exp==null?'<span class="tag acc">Extra</span>':'<span class="tag ok">Matches</span>'}</td>
      <td><select class="st-${lvl(l.stock)==='bad'?'miss':lvl(l.stock)==='warn'?'thin':'ok'}" data-ps="${esc(w.no)}|${i}" aria-label="Stock">${ST.map(s=>`<option${s===l.stock?' selected':''}>${s}</option>`).join('')}</select></td>
      <td><input type="date" value="${l.eta||''}" data-pe="${esc(w.no)}|${i}" aria-label="ETA"></td></tr>`
    :`<tr><td>${esc(l.name)}</td><td><select data-ts="${esc(w.no)}|${i}" aria-label="Status">${ST.map(s=>`<option${s===l.status?' selected':''}>${s}</option>`).join('')}</select></td>
      <td><input type="text" value="${esc(l.note||'')}" data-tn="${esc(w.no)}|${i}" placeholder="Note" aria-label="Note" style="width:100%"></td><td>${stTag(lvl(l.status),l.status)}</td></tr>`).join('')).join('');
  const myChecks=CHECKS.filter(c=>c[2]===role);
  return `<section class="card"><div class="row spread"><div><h2>${isMat?'Parts queue':'Tools & GSE queue'}</h2><p class="sub" style="margin:0">${isMat?'Expected quantities come from the task database. Set what\'s been ordered and its stock status; the planner and shift lead see it straight away.':'Set each tool or piece of GSE as available, booked, in calibration or U/S; the planner and shift lead see it straight away.'}</p></div>${packSelect(P,p.id)}</div></section>
  <div class="strip">
    <div class="tile"><span class="label">${isMat?'Part lines':'Tools'}</span><span class="big">${lines.length}</span><span class="meta">${esc(p.ac)} · ${dShort(p.start_date)}</span></div>
    <div class="tile"><span class="label">Ready</span><span class="big" style="color:var(--ok)">${c.ok}</span></div>
    <div class="tile ${c.warn?'warn':''}"><span class="label">${isMat?'On order / unchecked':'Not checked'}</span><span class="big" style="color:var(--warn)">${c.warn}</span></div>
    <div class="tile ${c.bad||short?'bad':''}"><span class="label">${isMat?'Not available / short':'U/S or in cal'}</span><span class="big" style="color:var(--bad)">${c.bad+short}</span></div>
    <div class="tile"><span class="label">Sign-off</span>${myChecks.map(([k,l])=>`<label class="row" style="font-size:14px"><input type="checkbox" data-chk="${p.id}|${k}" ${(p.checks||{})[k]?'checked':''}> ${esc(l)}</label>`).join('')}</div>
  </div>
  <section class="card">${rows?`<div class="tablewrap"><table><thead><tr>${isMat?'<th>Part number</th><th class="num">Expected</th><th class="num">Ordered</th><th>Check</th><th>Stock</th><th>ETA</th>':'<th>Tool / GSE</th><th>Status</th><th>Note</th><th></th>'}</tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty">No ${isMat?'parts':'tools'} on this work pack.</div>`}
  ${isMat?`<form class="form" id="addPart"><label><span class="label">Add part to work order</span><select name="wo">${counted(p).map(w=>`<option value="${esc(w.no)}">${esc(w.no)} — ${esc(w.title)}</option>`).join('')}</select></label>
    <label><span class="label">Part number</span><input type="text" name="pn" required placeholder="DEMO-XXX-0000"></label><label><span class="label">Qty</span><input type="number" name="qty" value="1" min="1"></label><div><button class="primary" type="submit">Add line</button></div></form>`:''}</section>
  ${feed(p.id)}`;
}
function vMat(){
  const P=openPacks();if(!P.length)return '<div class="empty">No open work packs.</div>';
  const p=packById(curPack)&&packById(curPack).status!=='Closed'?packById(curPack):P[0];curPack=p.id;
  const R=openRequests().sort((a,b)=>String(b.l.at||'').localeCompare(String(a.l.at||'')));
  const W=counted(p).filter(w=>(w.parts||[]).length);
  const lines=W.flatMap(w=>w.parts.map((l,i)=>({w,l,i})));
  // collection list grouped by part number
  const G={};lines.forEach(x=>{const k=x.l.pn;(G[k]=G[k]||{pn:k,qty:0,jobs:[],st:new Set(),extra:false}).qty+=Number(x.l.qty)||0;G[k].jobs.push(x);G[k].st.add(x.l.stock);if(x.l.src==='extra')G[k].extra=true});
  const groups=Object.values(G).sort((a,b)=>(lvl([...a.st][0])==='ok')-(lvl([...b.st][0])==='ok')||a.pn.localeCompare(b.pn));
  const c={ok:0,warn:0,bad:0};lines.forEach(x=>c[lvl(x.l.stock)]++);
  const myChecks=CHECKS.filter(k=>k[2]==='materials');
  const stSel=(attr,cur,mixed)=>`<select class="st-${mixed?'thin':lvl(cur)==='bad'?'miss':lvl(cur)==='warn'?'thin':'ok'}" ${attr} aria-label="Stock status">${mixed?'<option selected disabled>Mixed</option>':''}${MAT_ST.map(x=>`<option${!mixed&&x===cur?' selected':''}>${x}</option>`).join('')}</select>`;
  const srcTag=l=>l.src==='extra'?`<span class="tag acc" title="${esc(l.reason||'')}">Extra</span>`:'<span class="tag">Standard</span>';
  return `<section class="card"><div class="row spread"><div><h2>Parts queue</h2><p class="sub" style="margin:0">Standard spares come from the task database when a job is added. Extras are requested by the planner or shift lead against a job.</p></div>${packSelect(P,p.id)}</div></section>
  <section class="card" style="${R.length?'border-color:var(--accent)':''}"><h3>Extra spares requests ${R.length?`<span class="status Planning">${R.length} new</span>`:''}</h3>
  ${R.length?`<div class="tablewrap"><table><thead><tr><th>Work order</th><th>Part number</th><th class="num">Qty</th><th>Reason</th><th>Requested</th><th>Status</th></tr></thead><tbody>
    ${R.map(({w,l,i})=>{const pk=packById(w.pack_id);return `<tr><td><b class="mono">${esc(w.no)}</b>${w.decision==='Pending'?' <span class="tag warn">awaiting planner</span>':''}<div style="font-size:12px;color:var(--muted)">${esc(w.title)}<br>${esc(pk.ac)} · ${esc(pk.id)}</div></td><td class="mono">${esc(l.pn)}</td><td class="num">${l.qty}</td>
      <td>${esc(l.reason||'')}</td><td class="mono" style="font-size:12px">${l.at?ago(l.at):''}<div style="color:var(--muted)">${esc(ROLES[l.by]?.name||l.by||'')}${l.actor?' · '+esc(l.actor):''}</div></td><td>${stSel(`data-ps="${esc(w.no)}|${i}"`,l.stock)}</td></tr>`}).join('')}
  </tbody></table></div>`:'<div class="empty">No outstanding extra requests.</div>'}</section>
  <div class="strip">
    <div class="tile"><span class="label">Part lines · ${esc(p.ac)}</span><span class="big">${lines.length}</span><span class="meta">${groups.length} part numbers · ${dShort(p.start_date)}</span></div>
    <div class="tile"><span class="label">Ready</span><span class="big" style="color:var(--ok)">${c.ok}</span><span class="meta">in stock, kitted or issued</span></div>
    <div class="tile ${c.warn?'warn':''}"><span class="label">To action</span><span class="big" style="color:var(--warn)">${c.warn}</span><span class="meta">requested or on order</span></div>
    <div class="tile ${c.bad?'bad':''}"><span class="label">Not available</span><span class="big" style="color:var(--bad)">${c.bad}</span></div>
    <div class="tile"><span class="label">Sign-off</span>${myChecks.map(([k,l])=>`<label class="row" style="font-size:14px"><input type="checkbox" data-chk="${p.id}|${k}" ${(p.checks||{})[k]?'checked':''}> ${esc(l)}</label>`).join('')}</div>
  </div>
  <section class="card"><h3>Collection list — ${esc(p.ac)} · ${esc(p.check_type)}</h3><p class="sub">Every part needed for this work pack, totalled by part number. Setting a status here updates every job that uses that part.</p>
  ${groups.length?`<div class="tablewrap"><table><thead><tr><th>Part number</th><th class="num">Total qty</th><th>Work orders</th><th>Status</th></tr></thead><tbody>
    ${groups.map(g=>{const mixed=g.st.size>1,cur=[...g.st][0];return `<tr><td class="mono">${esc(g.pn)} ${g.extra?'<span class="tag acc">incl. extra</span>':''}</td><td class="num"><b>${g.qty}</b></td>
      <td style="font-size:13px">${g.jobs.map(x=>`<b class="mono">${esc(x.w.no)}</b> ×${x.l.qty}${x.l.src==='extra'?' <span class="tag acc">extra</span>':''} <span style="color:var(--muted)">${esc(x.w.title)}</span>`).join('<br>')}</td>
      <td>${stSel(`data-pnst="${esc(p.id)}|${esc(g.pn)}"`,cur,mixed)}</td></tr>`}).join('')}
  </tbody></table></div>`:'<div class="empty">No spares on this work pack.</div>'}</section>
  <section class="card"><h3>By work order</h3>
  ${W.length?`<div class="tablewrap"><table><thead><tr><th>Part number</th><th>Source</th><th class="num">Standard</th><th class="num">Qty</th><th>Status</th><th>ETA</th></tr></thead><tbody>
    ${W.map(w=>`<tr style="background:var(--bg)"><td colspan="6"><b class="mono">${esc(w.no)}</b> · ${esc(w.title)} ${stTag(spareSt(w))}</td></tr>`+w.parts.map((l,i)=>`<tr><td class="mono">${esc(l.pn)}</td><td>${srcTag(l)}${l.src==='extra'&&l.reason?`<div style="font-size:12px;color:var(--muted)">${esc(l.reason)}</div>`:''}</td><td class="num">${l.exp??'–'}</td>
      <td class="num"><input type="number" min="0" value="${l.qty}" data-pq="${esc(w.no)}|${i}" aria-label="Quantity">${l.exp!=null&&Number(l.qty)<Number(l.exp)?` <span class="tag bad">Short ${l.exp-l.qty}</span>`:''}</td>
      <td>${stSel(`data-ps="${esc(w.no)}|${i}"`,l.stock)}</td><td><input type="date" value="${l.eta||''}" data-pe="${esc(w.no)}|${i}" aria-label="ETA"></td></tr>`).join('')).join('')}
  </tbody></table></div>`:'<div class="empty">No spares on this work pack.</div>'}
  <form class="form" id="addPart"><label><span class="label">Add part to work order</span><select name="wo">${counted(p).map(w=>`<option value="${esc(w.no)}">${esc(w.no)} — ${esc(w.title)}</option>`).join('')}</select></label>
    <label><span class="label">Part number</span><input type="text" name="pn" required placeholder="DEMO-XXX-0000"></label><label><span class="label">Qty</span><input type="number" name="qty" value="1" min="1"></label><div><button class="primary" type="submit">Add line</button></div></form></section>
  ${feed(p.id)}`;
}
const vTool=()=>deptQueue('tools');

function hm(t){return t?new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):''}
function dur(a,b){if(!a)return '';const m=Math.max(0,Math.round(((b?new Date(b):new Date())-new Date(a))/60000));return m<60?m+' min':Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'}
const PAUSE_REASONS=['Awaiting spares','Awaiting tooling / GSE','Awaiting inspection','Manpower moved','Shift change / break','Aircraft access','Other'];
const runFrom=w=>w.run_from||(w.progress==='In progress'&&!w.paused_at&&Number(w.worked_min||0)===0?w.started_at:null);
function workedMin(w){const base=Number(w.worked_min)||0,rf=runFrom(w);return base+(w.progress==='In progress'&&!w.paused_at&&rf?Math.max(0,(Date.now()-new Date(rf))/60000):0)}
function pausedMin(w){return (w.pause_log||[]).reduce((a,p)=>a+Math.max(0,((p.to?new Date(p.to):new Date())-new Date(p.from))/60000),0)}
const fmtMin=m=>{m=Math.round(m);return m<60?m+' min':Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'};
const isPaused=w=>w.progress==='In progress'&&!!w.paused_at;
function vFloor(){
  const P=openPacks();if(!P.length)return '<div class="empty">No open work packs.</div>';
  const inWork=P.filter(p=>p.status==='In work');
  const p=packById(curPack)&&packById(curPack).status!=='Closed'?packById(curPack):(inWork[0]||P[0]);curPack=p.id;
  const ed=p.status==='In work';
  const order={'In progress':0,'Not started':1,'Passed back':2,'Complete':3};
  const W=toWork(p).sort((a,b)=>order[a.progress]-order[b.progress]||a.no.localeCompare(b.no));
  const n=k=>W.filter(w=>w.progress===k).length, g=progress(p), pausedN=W.filter(isPaused).length, running=n('In progress')-pausedN;
  const remain={Mech:0,B1:0,B2:0};W.filter(w=>w.progress==='Not started'||w.progress==='In progress').forEach(w=>TRADES.forEach(t=>remain[t]+=Number(w.hrs?.[t])||0));
  const r=roster(),we=[0,6].includes(new Date().getDay()),heads=we?r.weekend:r.weekday;
  const people=new Set(W.filter(w=>w.progress==='In progress'&&!w.paused_at&&w.assignee).flatMap(w=>w.assignee.split(/[,/&]+/).map(x=>x.trim().toUpperCase()).filter(Boolean)));
  const act={Mech:0,B1:0,B2:0},pl={Mech:0,B1:0,B2:0};W.filter(w=>w.progress==='Complete').forEach(w=>TRADES.forEach(t=>{pl[t]+=Number(w.hrs?.[t])||0;act[t]+=Number(w.actual?.[t]??w.hrs?.[t])||0}));
  const btn=w=>{if(!ed)return '';
    if(w.progress==='Not started')return `<button class="primary" data-start="${esc(w.no)}">Start</button>`;
    if(isPaused(w))return `<button class="primary" data-resume="${esc(w.no)}">Resume</button>`;
    if(w.progress==='In progress')return `<button class="primary" data-done="${esc(w.no)}" style="background:var(--ok);border-color:var(--ok)">Complete</button>
      <span class="row" style="gap:4px"><select data-preason="${esc(w.no)}" aria-label="Pause reason" style="max-width:150px">${PAUSE_REASONS.map(r=>`<option>${r}</option>`).join('')}</select><button data-pause="${esc(w.no)}">Pause</button></span>
      <button class="link" data-pb="${esc(w.no)}">Pass back</button>`;
    return `<button class="link" data-reopen="${esc(w.no)}">Reopen</button>`};
  const when=w=>{const pm=pausedMin(w);
    if(isPaused(w))return `Paused ${hm(w.paused_at)} · ${esc(w.pause_reason||'')}<br>Worked ${fmtMin(workedMin(w))} · paused ${fmtMin((Date.now()-new Date(w.paused_at))/60000)}`;
    if(w.progress==='In progress')return `Started ${hm(w.started_at)} · working ${fmtMin(workedMin(w))}${pm?'<br>paused '+fmtMin(pm)+' so far':''}`;
    if(w.progress==='Complete')return `Done ${hm(w.completed_at)} · ${fmtMin(workedMin(w))} working${pm?'<br>paused '+fmtMin(pm):''}`;
    return w.progress==='Passed back'?'Passed back to the line':''};
  return `<section class="card"><div class="row spread"><div><h2>Shift board — ${esc(p.ac)} · ${esc(p.check_type)} <span class="status ${p.status.replace(' ','-')}">${esc(p.status)}</span></h2><p class="sub" style="margin:0">Allocate people, press Start when a job begins and Complete when it's finished. The planner and management see it straight away.</p></div>${packSelect(P,p.id)}</div>
  ${!ed?'<p class="warnbar" style="margin:10px 0 0">This work pack hasn\'t been released to production yet. Jobs can be started once the planner releases it.</p>':''}
  <div style="margin-top:12px"><span class="label">Complete ${g.done}/${g.total}</span>${meter(g.pct,false)}</div></section>
  <div class="strip">
    <div class="tile"><span class="label">Not started</span><span class="big">${n('Not started')}</span></div>
    <div class="tile ${running?'warn':''}"><span class="label">In progress</span><span class="big" style="color:var(--warn)">${running}</span><span class="meta">${people.size} ${people.size===1?'person':'people'} allocated</span></div>
    <div class="tile ${pausedN?'bad':''}"><span class="label">Paused</span><span class="big" style="color:var(--bad)">${pausedN}</span><span class="meta">${pausedN?esc([...new Set(W.filter(isPaused).map(w=>w.pause_reason))].join(', ')):'none'}</span></div>
    <div class="tile"><span class="label">Complete</span><span class="big" style="color:var(--ok)">${n('Complete')}</span><span class="meta">${n('Passed back')} passed back</span></div>
    <div class="tile"><span class="label">Hours left vs manpower today</span><div class="hrs">${TRADES.map(t=>{const av=(Number(heads[t])||0)*Number(r.prod);const over=remain[t]>av;return `<div><span class="label">${t}</span><b style="color:${over?'var(--bad)':'var(--fg)'}">${fmt(remain[t])}</b><span class="label">of ${fmt(av)} h</span></div>`}).join('')}</div></div>
  </div>
  <section class="card"><div class="tablewrap"><table><thead><tr><th>Job</th><th>Planner note</th><th>Ready</th><th>Allocated to</th><th>Status</th>${TRADES.map(t=>`<th class="num">${t} actual</th>`).join('')}<th></th></tr></thead><tbody>
  ${W.map(w=>`<tr class="${w.progress==='Complete'?'done':''}">
    <td><b>${esc(w.title)}</b><div class="mono" style="font-size:11px;color:var(--muted)">${esc(w.no)} · ${TRADES.filter(t=>w.hrs?.[t]).map(t=>t+' '+fmt(w.hrs[t])+'h').join(' · ')}</div>
      <div class="tags" style="margin-top:3px">${w.decision==='G703'?'<span class="tag warn">G703</span>':''}${FLAGS.filter(([k])=>w.flags?.[k]).map(([,l])=>`<span class="tag ${l==='Dup insp'?'warn':''}">${l}</span>`).join('')}</div></td>
    <td style="font-size:13px;max-width:220px">${esc(w.comment)}</td>
    <td><div class="tags">${(w.parts||[]).length?`<span class="chk ${({ok:'ok',warn:'thin',bad:'miss'})[spareSt(w)]}">Parts</span>`:''}${(w.tools||[]).length?`<span class="chk ${({ok:'ok',warn:'thin',bad:'miss'})[toolSt(w)]}">Tools</span>`:''}</div></td>
    <td><input type="text" value="${esc(w.assignee)}" data-asg="${esc(w.no)}" placeholder="e.g. M-02, B1-01" size="12" ${ed?'':'disabled'} aria-label="Allocated to"></td>
    <td><span class="tag ${isPaused(w)?'bad':w.progress==='Complete'?'ok':w.progress==='In progress'?'warn':w.progress==='Passed back'?'bad':''}">${isPaused(w)?'Paused':esc(w.progress)}</span><div class="mono" style="font-size:11px;color:var(--muted);margin-top:3px">${when(w)}</div><div class="row" style="margin-top:6px;gap:6px">${btn(w)}</div></td>
    ${TRADES.map(t=>`<td class="num">${w.hrs?.[t]?`<input type="number" step="0.25" min="0" value="${w.actual?.[t]??''}" placeholder="${fmt(w.hrs[t])}" data-act="${esc(w.no)}|${t}" ${ed&&w.progress!=='Not started'?'':'disabled'} aria-label="${t} actual hours">`:'–'}</td>`).join('')}
    <td style="white-space:nowrap">${ed&&w.progress!=='Complete'?`<button class="link" data-xsp="${esc(w.no)}">+ Spares</button><br>`:''}<button class="link" data-escfor="${esc(w.no)}">Escape</button></td></tr>`).join('')||`<tr><td colspan="${6+TRADES.length}"><div class="empty">No accepted work orders yet.</div></td></tr>`}
  </tbody></table></div></section>
  ${p.status!=='Closed'?addWoSection(p):''}
  ${p.status!=='Closed'?extraForm(W.filter(w=>w.progress!=='Complete'),p.id):''}
  <div class="strip">${TRADES.map(t=>{const v=pl[t]?Math.round((act[t]-pl[t])/pl[t]*100):0;return `<div class="tile"><span class="label">${t} hours on completed jobs</span><span class="big">${fmt(act[t])} h</span><span class="meta">planned ${fmt(pl[t])} h ${pl[t]?`· <span class="tag ${Math.abs(v)<=5?'ok':v>0?'bad':'acc'}">${v>0?'+':''}${v}%</span>`:''}</span></div>`}).join('')}</div>
  ${feed(p.id)}`;
}

/* ---------- trends ---------- */
const sumH=h=>TRADES.reduce((s,t)=>s+(Number(h?.[t])||0),0);
const varPct=(a,p)=>p?Math.round((a-p)/p*1000)/10:0;
function axisLabels(r,x,H,B){return `<text x="${x}" y="${H-B+16}" text-anchor="middle" font-size="11" fill="var(--fg)" font-family="var(--mono)">${esc(r.ac)}</text><text x="${x}" y="${H-B+30}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="var(--mono)">${mon(r.end_date)}</text>`}
function svgVariance(rows){
  const W=Math.max(560,rows.length*56+60),H=250,L=44,R=12,Tp=16,B=44,pw=W-L-R,ph=H-Tp-B;
  const vals=rows.map(r=>varPct(sumH(r.actual),sumH(r.planned))),m=Math.max(20,Math.ceil(Math.max(...vals.map(Math.abs))/5)*5);
  const y=v=>Tp+ph/2-(v/m)*(ph/2),slot=pw/rows.length,bw=Math.min(28,slot*.55);let g='';
  for(let t=-m;t<=m;t+=m/2)g+=`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="${t===0?'var(--muted)':'var(--line)'}"/><text x="${L-6}" y="${y(t)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)">${t>0?'+':''}${t}%</text>`;
  rows.forEach((r,i)=>{const v=vals[i],x=L+slot*i+slot/2,top=Math.min(y(v),y(0)),h=Math.max(1.5,Math.abs(y(v)-y(0)));
    g+=`<rect x="${x-slot/2}" y="${Tp}" width="${slot}" height="${ph}" fill="transparent" data-tip="${esc(r.ac+' · '+r.check_type+' ('+mon(r.end_date)+')')}&#10;Planned ${fmt(sumH(r.planned))} h · Actual ${fmt(sumH(r.actual))} h · ${sgn(v)}%"/><rect x="${x-bw/2}" y="${top}" width="${bw}" height="${h}" rx="3" fill="${v>0?'var(--warn)':'var(--accent)'}" pointer-events="none"/>${axisLabels(r,x,H,B)}`;
    if(i===0||i===rows.length-1)g+=`<text x="${x}" y="${v>0?top-5:top+h+13}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--fg)" font-family="var(--mono)">${sgn(v)}%</text>`});
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:540px;display:block" role="img" aria-label="Hours variance by completed work pack">${g}</svg>`;
}
function svgCompletion(rows){
  const W=Math.max(560,rows.length*56+60),H=230,L=44,R=12,Tp=14,B=44,pw=W-L-R,ph=H-Tp-B;
  const vals=rows.map(r=>r.wos?Math.round(r.done/r.wos*1000)/10:0),lo=Math.min(75,Math.floor(Math.min(...vals)/5)*5),hi=100,target=95;
  const y=v=>Tp+(hi-v)/(hi-lo)*ph,slot=pw/rows.length,x=i=>L+slot*i+slot/2;let g='';
  for(let t=lo;t<=hi;t+=5)g+=`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L-6}" y="${y(t)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)">${t}%</text>`;
  g+=`<line x1="${L}" x2="${W-R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--ok)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W-R}" y="${y(target)-6}" text-anchor="end" font-size="11" fill="var(--ok)" font-family="var(--mono)">Target ${target}%</text>`;
  g+=`<polyline points="${vals.map((v,i)=>x(i)+','+y(v)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  rows.forEach((r,i)=>{g+=`<rect x="${x(i)-slot/2}" y="${Tp}" width="${slot}" height="${ph}" fill="transparent" data-tip="${esc(r.ac+' · '+r.check_type+' ('+mon(r.end_date)+')')}&#10;${r.done}/${r.wos} WOs completed (${vals[i]}%) · ${r.wos-r.done} passed back"/><circle cx="${x(i)}" cy="${y(vals[i])}" r="4.5" fill="var(--accent)" stroke="var(--panel)" stroke-width="2" pointer-events="none"/>${axisLabels(r,x(i),H,B)}`;
    if(i===0||i===rows.length-1)g+=`<text x="${x(i)}" y="${y(vals[i])-10}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--fg)" font-family="var(--mono)">${vals[i]}%</text>`});
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:540px;display:block" role="img" aria-label="Work order completion rate">${g}</svg>`;
}
function svgEscapes(rows){
  const W=Math.max(560,rows.length*56+60),H=180,L=44,R=12,Tp=14,B=44,pw=W-L-R,ph=H-Tp-B,m=Math.max(4,...rows.map(r=>r.esc));
  const y=v=>Tp+ph-(v/m)*ph,slot=pw/rows.length,bw=Math.min(24,slot*.5);let g='';
  for(let t=0;t<=m;t+=Math.ceil(m/4))g+=`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L-6}" y="${y(t)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)">${t}</text>`;
  rows.forEach((r,i)=>{const x=L+slot*i+slot/2,h=r.esc?Math.max(2,(r.esc/m)*ph):0;
    g+=`<rect x="${x-slot/2}" y="${Tp}" width="${slot}" height="${ph}" fill="transparent" data-tip="${esc(r.ac+' · '+r.check_type+' ('+mon(r.end_date)+')')}&#10;${r.esc} escape${r.esc===1?'':'s'} · ${r.adf} ADFs"/><rect x="${x-bw/2}" y="${y(r.esc)}" width="${bw}" height="${h}" rx="3" fill="var(--accent)" pointer-events="none"/>${axisLabels(r,x,H,B)}`});
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:540px;display:block" role="img" aria-label="Escapes per completed work pack">${g}</svg>`;
}
function vTrends(){
  const R=S.history.slice().sort((a,b)=>a.end_date.localeCompare(b.end_date));
  if(R.length<2)return '<div class="empty">Trends appear once at least two work packs have been closed.</div>';
  const half=Math.max(1,Math.floor(R.length/2)),first=R.slice(0,half),last=R.slice(-half);
  const avg=(a,f)=>a.reduce((s,r)=>s+f(r),0)/a.length,comp=r=>r.wos?r.done/r.wos*100:0,vr=r=>varPct(sumH(r.actual),sumH(r.planned));
  const cF=avg(first,comp),cL=avg(last,comp),vF=avg(first,vr),vL=avg(last,vr),eF=avg(first,r=>r.esc),eL=avg(last,r=>r.esc),onTime=R.filter(r=>!r.late).length;
  const arrow=(d,goodUp,unit='')=>{const good=goodUp?d>0:d<0;return `<span class="tag ${Math.abs(d)<.05?'':good?'ok':'bad'}">${d>0?'▲':'▼'} ${fmt(Math.abs(d))}${unit}</span>`};
  const tradeRow=t=>{const a=r=>varPct(Number(r.actual[t])||0,Number(r.planned[t])||0),f=avg(first,a),l=avg(last,a);
    return `<tr><td><b>${t}</b></td><td class="num">${fmt(R.reduce((s,r)=>s+(Number(r.planned[t])||0),0))}</td><td class="num">${fmt(R.reduce((s,r)=>s+(Number(r.actual[t])||0),0))}</td><td class="num">${sgn(f)}%</td><td class="num">${sgn(l)}%</td><td>${arrow(Math.abs(l)-Math.abs(f),false,' pts')}</td></tr>`};
  return `<section class="card" style="padding-bottom:6px"><h2>Trends — completed work packs</h2><p class="sub">${R.length} inputs from ${mon(R[0].end_date)} to ${mon(R.at(-1).end_date)}. Comparing the oldest ${half} with the latest ${half}. Work packs the planner closes are added automatically. Hover a bar or point for figures.</p></section>
  <div class="strip">
    <div class="tile"><span class="label">WO completion in input</span><span class="big">${fmt(cL)}%</span><span class="meta">latest ${half} · was ${fmt(cF)}%</span>${arrow(cL-cF,true,' pts')}</div>
    <div class="tile"><span class="label">Hours vs planned</span><span class="big">${sgn(vL)}%</span><span class="meta">latest ${half} · was ${sgn(vF)}%</span>${arrow(Math.abs(vL)-Math.abs(vF),false,' pts')}</div>
    <div class="tile"><span class="label">Escapes per input</span><span class="big">${fmt(eL)}</span><span class="meta">latest ${half} · was ${fmt(eF)}</span>${arrow(eL-eF,false)}</div>
    <div class="tile"><span class="label">Finished on time</span><span class="big">${onTime}/${R.length}</span><span class="meta">${R.reduce((s,r)=>s+r.late,0)} days over in total</span></div>
  </div>
  <section class="card"><h3>Actual hours vs planned</h3><div class="legend" style="margin-bottom:6px"><span><i style="background:var(--warn)"></i>Over planned hours</span><span><i style="background:var(--accent)"></i>Under planned hours</span></div><div class="tablewrap">${svgVariance(R)}</div></section>
  <section class="card"><h3>Work orders completed within the input</h3><p class="sub">Work orders not finished are passed back to the line.</p><div class="tablewrap">${svgCompletion(R)}</div></section>
  <section class="card"><h3>Escapes per input</h3><div class="tablewrap">${svgEscapes(R)}</div></section>
  <section class="card"><h3>Variance by trade</h3><div class="tablewrap"><table><thead><tr><th>Trade</th><th class="num">Planned h</th><th class="num">Actual h</th><th class="num">Oldest ${half}</th><th class="num">Latest ${half}</th><th>Change</th></tr></thead><tbody>${TRADES.map(tradeRow).join('')}</tbody></table></div></section>
  <section class="card"><h3>All completed work packs</h3><div class="tablewrap"><table><thead><tr><th>Work pack</th><th>Aircraft</th><th>Finished</th><th class="num">WOs</th><th class="num">Completed</th><th class="num">Passed back</th><th class="num">Planned h</th><th class="num">Actual h</th><th class="num">Variance</th><th class="num">ADFs</th><th class="num">Escapes</th><th class="num">Days late</th></tr></thead><tbody>
  ${R.slice().reverse().map(r=>{const v=vr(r),c=comp(r);return `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.ac)} · ${esc(r.check_type)}</td><td class="mono">${mon(r.end_date)}</td><td class="num">${r.wos}</td><td class="num"><span class="tag ${c>=95?'ok':c>=90?'warn':'bad'}">${fmt(c)}%</span></td><td class="num">${r.wos-r.done}</td><td class="num">${fmt(sumH(r.planned))}</td><td class="num">${fmt(sumH(r.actual))}</td><td class="num"><span class="tag ${Math.abs(v)<=5?'ok':Math.abs(v)<=10?'warn':'bad'}">${sgn(v)}%</span></td><td class="num">${r.adf}</td><td class="num">${r.esc}</td><td class="num">${r.late||'–'}</td></tr>`}).join('')}
  </tbody></table></div></section>`;
}

/* ---------- actions ---------- */
const woBy=no=>S.work_orders.find(w=>w.no===no);
function setLine(no,kind,i,patch,logText){const w=woBy(no);const arr=(w[kind]||[]).map(x=>({...x}));Object.assign(arr[i],patch);return upd('work_orders',no,{[kind]:arr},logText,w.pack_id)}
async function createPack(f){
  const ac=(f.get('ac')||'').trim(),check=(f.get('check')||'').trim(),start=f.get('start'),days=Number(f.get('days'))||1;
  if(!ac||!check||!start){toast('Fill in aircraft, check type and start date first');return}
  if(!newSel.size&&!newManual.length){toast('Add at least one work order');return}
  const nos=[...Object.values(newWoNos).filter(Boolean),...newManual.map(m=>m.no).filter(Boolean)];
  const dup=nos.find((n,i)=>nos.indexOf(n)!==i||S.work_orders.some(w=>w.no===n));if(dup){toast(`${dup} is already in use`);return}
  const id=rid('WP-'+String(new Date().getFullYear()).slice(2)+'-',4);
  const p=await ins('packs',[{id,ac,check_type:check,start_date:start,days,version:1,status:'Planning',checks:{received:true}}],`Created ${id} for ${ac} (${check}) with ${newSel.size+newManual.length} work orders`,id);
  if(!p)return;
  const rows=[...newSel].map(ref=>{const t=taskByRef(ref);return {no:newWoNos[ref]||rid('WO-',6),pack_id:id,ref,type:'OMP',title:t.title,hrs:t.hrs,flags:t.flags||{},added_v:1,
    parts:stdParts(t),tools:(t.tooling||[]).map(n=>({name:n,status:'Not checked',note:''}))}});
  newManual.forEach(m=>rows.push({...m,no:m.no||rid('WO-',6),pack_id:id,added_v:1}));
  await ins('work_orders',rows);
  newSel.clear();newDraft={};newWoNos={};newManual=[];newFilter={q:'',ata:'',selOnly:false};curPack=id;curVer=null;go('pack');toast('Work pack created — Materials and Tooling can see it now');
}
async function closePack(p){
  const W=toWork(p),planned={Mech:0,B1:0,B2:0},actual={Mech:0,B1:0,B2:0};
  W.forEach(w=>TRADES.forEach(t=>{const h=Number(w.hrs?.[t])||0;planned[t]+=h;actual[t]+=w.actual?.[t]!=null&&w.actual[t]!==''?Number(w.actual[t]):h}));
  TRADES.forEach(t=>{planned[t]=Math.round(planned[t]*10)/10;actual[t]=Math.round(actual[t]*10)/10});
  const late=Number(($('lateDays')||{}).value)||0;
  const h={id:p.id,ac:p.ac,check_type:p.check_type,end_date:isoOf(T0),planned,actual,wos:W.length,done:W.filter(w=>w.progress==='Complete').length,adf:W.filter(w=>w.type==='ADF').length,esc:S.escapes.filter(e=>e.pack_id===p.id).length,late};
  const {error}=await sb.from('history').upsert(h);if(error){toast('Couldn\'t close: '+error.message);return}
  if(!S.history.some(x=>x.id===h.id))S.history.push(h);
  await upd('packs',p.id,{status:'Closed',closed_at:new Date().toISOString()},`Closed ${p.id}: ${h.done}/${h.wos} complete, ${sgn(varPct(sumH(actual),sumH(planned)))}% hours vs plan`,p.id);
  toast('Work pack closed — added to Trends');
}

/* ---------- events ---------- */
function wire(){
  $('roleSel').addEventListener('change',e=>setRole(e.target.value));
  $('actor').value=ls.get('pp.actor')||'';$('actor').addEventListener('change',e=>ls.set('pp.actor',e.target.value.trim()));
  $('tabs').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)go(b.dataset.view)});
  addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(ROLES[h]&&h!==role)setRole(h)});
  const V=$('view');
  V.addEventListener('click',async e=>{
    const t=e.target.closest('button,[data-open],[data-goto]');if(!t)return;const d=t.dataset;
    if(d.open){curPack=d.open;curVer=null;go(d.to)}
    else if(d.goto)go(d.goto);
    else if(t.id==='selShown'){S.tasks.filter(x=>taskMatches(x,newFilter)).forEach(x=>newSel.add(x.ref));render()}
    else if(t.id==='createPack'){await createPack(new FormData($('newForm')))}
    else if(d.unsel){newSel.delete(d.unsel);delete newWoNos[d.unsel];render()}
    else if(d.unman!==undefined){newManual.splice(+d.unman,1);render()}
    else if(t.id==='selNone'){newSel.clear();render()}
    else if(t.id==='newVer'){const p=packById(curPack);curVer=null;await upd('packs',p.id,{version:p.version+1},`Started version ${p.version+1} of ${p.id}`,p.id)}
    else if(t.id==='release'){const p=packById(curPack);await upd('packs',p.id,{status:'In work'},`Released ${p.id} to production`,p.id);toast('Released — the shift lead can now book progress')}
    else if(t.id==='closePack'){const p=packById(curPack);if(t.dataset.armed){await closePack(p)}else{t.dataset.armed=1;t.textContent='Click again to confirm';setTimeout(()=>{if(t.isConnected){delete t.dataset.armed;t.textContent='Close work pack'}},3000)}}
    else if(d.rmwo){const w=woBy(d.rmwo),p=packById(w.pack_id);await upd('work_orders',w.no,{removed_v:p.version},`Removed ${w.no} (${w.title}) in v${p.version}`,p.id)}
    else if(d.start){const w=woBy(d.start);if(!w.assignee){const el=document.querySelector(`[data-asg="${w.no}"]`);if(el&&el.value.trim()){await upd('work_orders',w.no,{assignee:el.value.trim()})}else{toast('Allocate someone first');el&&el.focus();return}}
      const now=new Date().toISOString();await upd('work_orders',w.no,{progress:'In progress',started_at:w.started_at||now,run_from:now,worked_min:Number(w.worked_min)||0,paused_at:null,pause_reason:null,completed_at:null},`Started: ${w.title}${w.assignee?' ('+w.assignee+')':''}`,w.pack_id)}
    else if(d.pause){const w=woBy(d.pause),sel=document.querySelector(`[data-preason="${w.no}"]`),reason=sel?sel.value:'Other',now=new Date().toISOString();
      await upd('work_orders',w.no,{paused_at:now,pause_reason:reason,worked_min:Math.round(workedMin(w)*10)/10,run_from:null,pause_log:[...(w.pause_log||[]),{reason,from:now,to:null}]},`Paused: ${w.title} — ${reason}`,w.pack_id)}
    else if(d.resume){const w=woBy(d.resume),now=new Date().toISOString(),log=(w.pause_log||[]).map(x=>({...x}));if(log.length&&!log[log.length-1].to)log[log.length-1].to=now;
      await upd('work_orders',w.no,{paused_at:null,pause_reason:null,run_from:now,pause_log:log},`Resumed: ${w.title} (paused ${fmtMin((Date.now()-new Date(w.paused_at))/60000)} — ${w.pause_reason||''})`,w.pack_id)}
    else if(d.done||d.pb){const w=woBy(d.done||d.pb),now=new Date().toISOString(),log=(w.pause_log||[]).map(x=>({...x}));if(log.length&&!log[log.length-1].to)log[log.length-1].to=now;
      const mins=Math.round(workedMin(w)*10)/10,done=!!d.done;
      await upd('work_orders',w.no,{progress:done?'Complete':'Passed back',completed_at:done?now:null,worked_min:mins,run_from:null,paused_at:null,pause_reason:null,pause_log:log},done?`Completed: ${w.title} in ${fmtMin(mins)} working`:`Passed back to the line: ${w.title}`,w.pack_id);
      if(done)toast('Complete — add actual hours if different from plan')}
    else if(d.reopen){const w=woBy(d.reopen);await upd('work_orders',w.no,{progress:'In progress',completed_at:null,run_from:new Date().toISOString(),paused_at:null},`Reopened: ${w.title}`,w.pack_id)}
    else if(d.xsp){xspPrefill=d.xsp;render();const c=$('extraCard');if(c){c.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{const i=c.querySelector('[name=pn]');i&&i.focus()},300)}}
    else if(d.escfor){const w=woBy(d.escfor);escPrefill={pack:w.pack_id,ref:w.ref,detail:w.no+': '};go('escapes')}
  });
  V.addEventListener('change',async e=>{
    const t=e.target,d=t.dataset;
    if(t.name==='wo'&&t.form&&t.form.id==='extraForm'){$('newWoFields').hidden=t.value!=='__new';if(t.value==='__new')t.form.querySelector('[name=woNew]').focus();return}
    if(t.id==='packSel'){curPack=t.value;curVer=null;render();return}
    if(t.id==='verSel'){curVer=+t.value;render();return}
    if(d.newtask){t.checked?newSel.add(d.newtask):(newSel.delete(d.newtask),delete newWoNos[d.newtask]);render();return}
    if(d.newwo){const v=t.value.trim().toUpperCase().replace(/\s+/g,'');t.value=v;if(v)newWoNos[d.newwo]=v;else delete newWoNos[d.newwo];return}
    if(t.id==='newAta'){newFilter.ata=t.value;applyNewFilter();return}
    if(t.id==='newSelOnly'){newFilter.selOnly=t.checked;applyNewFilter();return}
    if(d.chk){const [id,k]=d.chk.split('|'),p=packById(id),c={...(p.checks||{}),[k]:t.checked};const lbl=CHECKS.find(x=>x[0]===k)[1];
      await upd('packs',id,{checks:c},`${t.checked?'Ticked':'Unticked'} "${lbl}" on ${id}`,id);return}
    if(d.dec){const w=woBy(d.dec);await upd('work_orders',w.no,{decision:t.value},`${w.no} (${w.title}) set to ${t.value}`,w.pack_id);return}
    if(d.woc){const w=woBy(d.woc);await upd('work_orders',w.no,{comment:t.value},`Note added to ${w.no}`,w.pack_id);return}
    if(d.ps){const [no,i]=d.ps.split('|');const l=woBy(no).parts[i];await setLine(no,'parts',+i,{stock:t.value},`${l.pn} set to ${t.value}`);return}
    if(d.pnst){const [pid,pn]=d.pnst.split('|');const ws=counted(packById(pid)).filter(w=>(w.parts||[]).some(l=>l.pn===pn));
      for(const w of ws){const arr=w.parts.map(l=>l.pn===pn?{...l,stock:t.value}:l);await upd('work_orders',w.no,{parts:arr})}
      log(`${pn} set to ${t.value} for ${ws.length} job${ws.length===1?'':'s'}`,pid);return}
    if(d.pq){const [no,i]=d.pq.split('|');const l=woBy(no).parts[i];await setLine(no,'parts',+i,{qty:Number(t.value)||0},`${l.pn} ordered qty ${Number(t.value)||0}`);return}
    if(d.pe){const [no,i]=d.pe.split('|');const l=woBy(no).parts[i];await setLine(no,'parts',+i,{eta:t.value||null},t.value?`${l.pn} ETA ${dShort(t.value)}`:null);return}
    if(d.ts){const [no,i]=d.ts.split('|');const l=woBy(no).tools[i];await setLine(no,'tools',+i,{status:t.value},`${l.name} set to ${t.value}`);return}
    if(d.tn){const [no,i]=d.tn.split('|');await setLine(no,'tools',+i,{note:t.value});return}
    if(d.asg){const w=woBy(d.asg);await upd('work_orders',w.no,{assignee:t.value.trim()},t.value.trim()?`${w.title} assigned to ${t.value.trim()}`:null,w.pack_id);return}
    if(d.prog){const w=woBy(d.prog);await upd('work_orders',w.no,{progress:t.value},`${w.title} marked ${t.value}`,w.pack_id);return}
    if(d.act){const [no,tr]=d.act.split('|');const w=woBy(no);const a={...(w.actual||{})};if(t.value==='')delete a[tr];else a[tr]=Number(t.value);await upd('work_orders',no,{actual:a},t.value?`${w.title}: ${tr} actual ${t.value} h`:null,w.pack_id);return}
    if(d.esc){await upd('escapes',+d.esc,{done:t.checked},t.checked?'Escape closed — task database updated':'Escape reopened');return}
    if(d.ho){await upd('handover',+d.ho,{done:t.checked},t.checked?'Handover item closed':'Handover item reopened');return}
    if(d.thrs){const [ref,tr]=d.thrs.split('|');const x=taskByRef(ref);await upd('tasks',ref,{hrs:{...x.hrs,[tr]:Number(t.value)||0}},`${ref} ${tr} hours set to ${Number(t.value)||0}`);return}
    if(d.tmat){const mats=t.value.split('\n').map(x=>x.trim()).filter(Boolean).map(x=>{const [pn,q]=x.split(/[,×x*]\s*(?=\d+\s*$)/);return {pn:(pn||x).replace(/,\s*$/,'').trim().toUpperCase(),qty:Number(q)||1}});
      await upd('tasks',d.tmat,{materials:mats},`${d.tmat} standard spares updated (${mats.length} line${mats.length===1?'':'s'})`);toast('Saved — new work packs will use these spares');return}
    if(d.tind){await upd('tasks',d.tind,{ind:t.checked},`${d.tind} marked ${t.checked?'industrialised':'needs review'}`);return}
    if(d.roster){const r=roster();let patch;if(d.roster==='prod')patch={prod:Number(t.value)||0};else{const [k,tr]=d.roster.split('|');patch={[k]:{...r[k],[tr]:Number(t.value)||0}}}
      if(S.roster.length)await upd('roster',1,patch,'Roster updated');else await ins('roster',[{id:1,...r,...patch}],'Roster updated');return}
  });
  V.addEventListener('input',e=>{if(e.target.id==='newSearch'){newFilter.q=e.target.value;applyNewFilter();return}if(e.target.form&&e.target.form.id==='newForm'&&e.target.name)newDraft[e.target.name]=e.target.value;if(e.target.id==='taskFilter'){taskFilter=e.target.value;const pos=e.target.selectionStart;render();const f=$('taskFilter');f.focus();f.setSelectionRange(pos,pos)}});
  V.addEventListener('submit',async e=>{
    e.preventDefault();const f=new FormData(e.target),btn=e.target.querySelector('[type=submit]');btn.disabled=true;
    try{
      if(e.target.id==='newForm')await createPack(f);
      else if(e.target.id==='manualNew'){const r=manualFromForm(f);if(r.err){toast(r.err);return}newManual.push(r.row);e.target.reset();render();toast('Added — it will be created with the pack')}
      else if(e.target.id==='addWoTask'){const p=packById(curPack),raw=(f.get('task')||'').trim(),ref=raw.split(' — ')[0].trim().toUpperCase(),t=taskByRef(ref);
        if(!t){toast('Pick a task from the list');return}
        const no=(f.get('woNo')||'').trim().toUpperCase().replace(/\s+/g,'')||rid('WO-',6);if(S.work_orders.some(w=>w.no===no)){toast(`${no} is already in use`);return}
        await ins('work_orders',[{no,pack_id:p.id,ref,type:'OMP',title:t.title,hrs:t.hrs,flags:t.flags||{},added_v:p.version,parts:stdParts(t),tools:(t.tooling||[]).map(n=>({name:n,status:'Not checked',note:''})),...floorFields()}],`Added ${no} (${t.title}) to ${p.id}${role==='shiftlead'?' on the floor':' v'+p.version}`,p.id);e.target.reset();toast(`${no} added`)}
      else if(e.target.id==='addWoManual'){const p=packById(curPack),r=manualFromForm(f);if(r.err){toast(r.err);return}
        const row={...r.row,no:r.row.no||rid('WO-',6),pack_id:p.id,added_v:p.version,...floorFields()};
        await ins('work_orders',[row],`Added ${row.no} (${row.title}) to ${p.id}${role==='shiftlead'?' on the floor':' v'+p.version}${row.parts.length?' with '+row.parts.length+' spares line'+(row.parts.length>1?'s':''):''}${row.tools.length?', '+row.tools.length+' tool'+(row.tools.length>1?'s':''):''}`,p.id);e.target.reset();toast(`${row.no} added — tools and spares sent to Tooling and Materials`)}
      else if(e.target.id==='addWo'){const p=packById(curPack),ref=f.get('ref');let row;
        if(ref){const t=taskByRef(ref);row={no:rid('WO-',6),pack_id:p.id,ref,type:'OMP',title:t.title,hrs:t.hrs,flags:t.flags||{},added_v:p.version,parts:stdParts(t),tools:(t.tooling||[]).map(n=>({name:n,status:'Not checked',note:''}))}}
        else{const title=(f.get('title')||'').trim();if(!title){toast('Describe the ADF first');return}
          const hrs={};TRADES.forEach(t=>hrs[t]=Number(f.get('h'+t))||0);row={no:rid('WO-',6),pack_id:p.id,ref:null,type:'ADF',title:/^ADF/i.test(title)?title:'ADF: '+title,hrs,flags:{},added_v:p.version}}
        await ins('work_orders',[row],`Added ${row.no} (${row.title}) to v${p.version}`,p.id)}
      else if(e.target.id==='extraForm'){const pk=packById(e.target.dataset.pack),pn=f.get('pn').trim().toUpperCase(),qty=Number(f.get('qty'))||1,reason=f.get('reason').trim();
        const line={pn,exp:null,qty,stock:'Requested',eta:null,src:'extra',reason,by:role,actor:actor()||null,at:new Date().toISOString()};
        let no=f.get('wo');
        if(no==='__new'){no=(f.get('woNew')||'').trim().toUpperCase().replace(/\s+/g,'');const desc=(f.get('woDesc')||'').trim();
          if(!no||!desc){toast('Enter the new work order number and a description');return}
          const ex=woBy(no);
          if(ex&&ex.pack_id!==pk.id){toast(`${no} already belongs to ${ex.pack_id}`);return}
          if(!ex){const row={no,pack_id:pk.id,ref:null,type:'ADF',title:/^ADF/i.test(desc)?desc:'ADF: '+desc,hrs:{Mech:0,B1:0,B2:0},flags:{},added_v:pk.version,decision:'Pending',comment:`Raised by ${ROLES[role].name}${actor()?' ('+actor()+')':''} with extra spares`,parts:[line]};
            if(await ins('work_orders',[row],`New work order ${no} raised (${row.title}) with ${qty} × ${pn} — awaiting planner decision`,pk.id)){xspPrefill=no;e.target.reset();if($('newWoFields'))$('newWoFields').hidden=true;toast(`${no} added to ${pk.id} and spares sent to Materials`)}
            return}}
        const w=woBy(no);
        if(await upd('work_orders',no,{parts:[...(w.parts||[]),line]},`Extra spares on ${no}: ${qty} × ${pn} — ${reason}`,w.pack_id)){xspPrefill=no;e.target.reset();if($('newWoFields'))$('newWoFields').hidden=true;toast(`Request sent to Materials against ${no}`)}}
      else if(e.target.id==='addPart'){const no=f.get('wo'),w=woBy(no);const arr=[...(w.parts||[]),{pn:f.get('pn').trim().toUpperCase(),exp:null,qty:Number(f.get('qty'))||1,stock:'Requested',eta:null,src:'extra',reason:'Added by Materials',by:role,at:new Date().toISOString()}];
        await upd('work_orders',no,{parts:arr},`Added part ${f.get('pn').trim()} to ${no}`,w.pack_id)}
      else if(e.target.id==='escForm'){await ins('escapes',[{pack_id:f.get('pack')||null,ref:f.get('ref')||null,raised_by:f.get('by'),type:f.get('type'),detail:f.get('detail'),action:f.get('action')||''}],`Escape logged: ${f.get('type')}`,f.get('pack')||null);escPrefill=null;toast('Escape logged')}
      else if(e.target.id==='hoForm'){await ins('handover',[{level:f.get('level'),ref:f.get('ref'),issue:f.get('issue'),plan:f.get('plan')||'',role}],'Added to handover');toast('Added to handover')}
    }finally{if(btn.isConnected)btn.disabled=false}
  });
  const tip=document.createElement('div');tip.className='tip';tip.hidden=true;document.body.appendChild(tip);
  document.addEventListener('pointermove',e=>{const t=e.target.closest&&e.target.closest('[data-tip]');if(!t){tip.hidden=true;return}
    tip.textContent=t.getAttribute('data-tip');tip.hidden=false;const x=Math.min(e.clientX+14,innerWidth-tip.offsetWidth-8),y=e.clientY+16+tip.offsetHeight>innerHeight?e.clientY-tip.offsetHeight-10:e.clientY+16;tip.style.left=x+'px';tip.style.top=y+'px'});
  setInterval(()=>{if(view==='register'||document.querySelector('.feed'))schedule()},60000);
}

/* ---------- boot ---------- */
(async function boot(){
  wire();render();
  const cfg=window.PLANNER_CONFIG||{};
  if(!cfg.supabaseUrl||!cfg.supabaseKey||!window.supabase){
    $('view').innerHTML=`<div class="setup card"><h2>Connect the database</h2><p class="sub">Add your Supabase project URL and publishable key to <code>config.js</code>, then reload. See README.md for the full setup.</p></div>`;setLive('off');return}
  sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{realtime:{params:{eventsPerSecond:10}}});
  try{await loadAll()}catch(err){$('view').innerHTML=`<div class="setup card"><h2>Couldn't load data</h2><p class="sub">${esc(err.message)}. Check that <code>supabase/schema.sql</code> has been run in the SQL editor.</p></div>`;setLive('off');return}
  ready=true;curPack=(openPacks()[0]||{}).id;render();subscribe();
})();
