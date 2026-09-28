export function viewerPage(clientId, nonce) {
  const safeClientId = JSON.stringify(clientId).slice(1, -1).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="shopify-api-key" content="${safeClientId}">
<title>Firgelli inventory sync</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#17202d;background:#f5f7f8}
*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 28px 80px}
.eyebrow{color:#6b7280;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:30px;letter-spacing:-.04em;margin:6px 0 8px}h2{font-size:17px;letter-spacing:-.02em;margin:0}p{margin:0;color:#5b6472;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:28px}
.refresh{border:1px solid #c8d0d6;background:#fff;border-radius:9px;padding:9px 15px;font:inherit;font-size:13px;font-weight:650;color:#1c2a37;cursor:pointer}
.refresh:hover{background:#edf4f5}.refresh:disabled{opacity:.5;cursor:wait}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:22px}
.usagepanel{padding:18px 20px;margin-bottom:22px}.usagehead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.usagevalue{font-size:14px;font-weight:750;color:#263442}.usagebar{height:11px;background:#e8edef;border-radius:999px;overflow:hidden;margin:13px 0 9px}.usagefill{height:100%;width:0;background:#15946c;border-radius:inherit;transition:width .3s ease}.usagefill.warn{background:#d38b19}.usagefill.bad{background:#c0362c}.usagefacts{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:#6d7882}
.card,.panel{background:#fff;border:1px solid #e1e6e8;border-radius:14px;box-shadow:0 2px 8px #15223408}
.card{padding:19px 20px}.card .label{font-size:12px;color:#65717d;font-weight:650}.card .value{font-size:28px;letter-spacing:-.045em;font-weight:750;margin-top:6px}.card .hint{font-size:12px;color:#75808a;margin-top:4px}
.value.good{color:#0d7658}.value.off{color:#9b5a11}.value.bad{color:#b42318}
.banner{border-radius:11px;padding:13px 16px;margin-bottom:22px;font-size:13px;line-height:1.5;background:#fff5e7;border:1px solid #f0d5ad;color:#734911}
.banner.good{background:#eaf8f2;border-color:#b7e4cf;color:#126044}
.controlpanel{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:22px;padding:20px 22px}
.controlcopy{min-width:0}.controltitle{display:flex;align-items:center;gap:11px;margin-bottom:7px}.controlpanel p{font-size:13px}
.controlpanel small{display:block;color:#71808a;font-size:11px;line-height:1.45;margin-top:7px}
.mode{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:800;letter-spacing:.05em}
.mode::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}.mode.on{color:#087450;background:#e6f6ef}.mode.off{color:#a32e26;background:#fdecea}
.controlbutton{border:0;border-radius:9px;padding:11px 16px;min-width:155px;font:inherit;font-size:13px;font-weight:750;color:#fff;cursor:pointer;white-space:nowrap}
.controlbutton.enable{background:#087f5b}.controlbutton.enable:hover{background:#0a9e70}.controlbutton.pause{background:#b42318}.controlbutton.pause:hover{background:#971c13}
.controlbutton:disabled{background:#d7dde0;color:#68747c;cursor:not-allowed}.controlbutton[hidden]{display:none}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}.panel{padding:22px}.panelhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.muted{font-size:12px;color:#71808a}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fact{border-top:1px solid #eff1f2;padding-top:10px}.fact b{display:block;font-size:13px;margin-top:3px}.fact span{font-size:11px;color:#6b7580}
.toolbar{display:flex;gap:10px;align-items:center;margin:14px 0}.search{width:220px;max-width:100%;border:1px solid #cdd5d9;border-radius:8px;padding:9px 11px;font:inherit;font-size:13px}.tabs{display:flex;gap:5px}.tab{border:0;border-radius:7px;padding:9px 11px;background:transparent;color:#65717b;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.tab.active{background:#e7f2ef;color:#08634a}
.list{border-top:1px solid #edf0f2}.entry{display:grid;grid-template-columns:115px minmax(0,1fr) auto;gap:14px;align-items:start;padding:14px 0;border-bottom:1px solid #edf0f2}.entry:last-child{border-bottom:0}
.badge{display:inline-block;padding:5px 8px;border-radius:6px;background:#eff5f3;color:#14735b;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.04em}.badge.warning{background:#fff2dc;color:#8b5a0b}.badge.error{background:#fdecea;color:#b42318}
.entry strong{display:block;font-size:13px;line-height:1.4}.entry small{display:block;color:#65717b;font-size:12px;margin-top:4px;line-height:1.45}.time{font-size:11px;color:#7d8790;white-space:nowrap}
.entryactions{display:flex;flex-direction:column;align-items:flex-end;gap:7px}.dismiss{border:1px solid #cdd5d9;border-radius:7px;background:#fff;color:#52616d;padding:5px 9px;font:inherit;font-size:11px;font-weight:700;cursor:pointer}.dismiss:hover{background:#edf4f5}.dismiss:disabled{opacity:.5;cursor:wait}
.empty{padding:28px 0;text-align:center;color:#687681;font-size:13px}.errorbox{background:#fdecea;color:#a42920;border:1px solid #f1c5bf;border-radius:9px;padding:13px 15px;font-size:13px}
.previewpanel{margin-bottom:18px}.previewhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.previewlist{max-height:340px;overflow:auto;scrollbar-gutter:stable;padding-right:18px}.previewrow{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,2fr);gap:12px;padding:10px 0;border-bottom:1px solid #edf0f2;font-size:12px}.previewrow strong{overflow-wrap:anywhere}.previewrow span{text-align:right;color:#52616d;overflow-wrap:anywhere}.previewactions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.previewactions .search{width:160px}.previewnote{font-size:12px;margin:10px 0;color:#65717d}
@media(max-width:860px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}}
@media(max-width:550px){main{padding:22px 16px 60px}.grid{gap:8px}.card{padding:14px}.card .value{font-size:23px}.header{align-items:center}.entry{grid-template-columns:1fr auto}.entry .badge{grid-column:1/-1;width:max-content}.toolbar{flex-wrap:wrap}.controlpanel{align-items:stretch;flex-direction:column;gap:15px}.controlbutton{width:100%}}
</style></head><body><main>
<div class="header"><div><div class="eyebrow">Firgelli • inventory operations</div><h1>Inventory sync</h1><p>Status and activity for the two-store stock connection.</p></div><button class="refresh" id="refresh">Refresh</button></div>
<div id="banner" class="banner">Loading current status…</div>
<div class="grid">
<div class="card"><div class="label">Live syncing</div><div class="value" id="live">—</div><div class="hint">Both stores</div></div>
<div class="card"><div class="label">Tracked SKUs</div><div class="value" id="tracked">—</div><div class="hint">Initialized for syncing</div></div>
<div class="card"><div class="label">Pending work</div><div class="value" id="pending">—</div><div class="hint">Changes and retries</div></div>
<div class="card"><div class="label">New SKU candidates</div><div class="value" id="new">—</div><div class="hint">Found in daily discovery</div></div>
</div>
<section class="panel usagepanel" aria-labelledby="usageHeading"><div class="usagehead"><div><h2 id="usageHeading">Cloudflare usage today</h2><p class="muted">Worker requests against the daily Cloudflare allowance.</p></div><div class="usagevalue" id="usageValue">Loading…</div></div><div class="usagebar" role="progressbar" aria-label="Cloudflare request usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="usageBar"><div class="usagefill" id="usageFill"></div></div><div class="usagefacts"><span id="usageRemaining">Checking requests remaining…</span><span id="usageReset">Resets daily at midnight UTC</span></div></section>
<section class="panel controlpanel" aria-labelledby="controlHeading"><div class="controlcopy"><div class="controltitle"><h2 id="controlHeading">Sync control</h2><span class="mode off" id="controlState">OFF</span></div><p id="controlMessage">Checking control status…</p><small id="controlHint"></small></div><button id="controlButton" class="controlbutton enable" type="button" disabled hidden>Enable syncing</button></section>
<section class="panel previewpanel" id="initialPreview" aria-labelledby="initialHeading"><div class="previewhead"><div><h2 id="initialHeading">Initial copy preview</h2><p class="previewnote" id="planDescription">Read-only snapshot: these child-store quantities would be set to the main store quantities during full rollout. Stock may change before then.</p></div><div class="previewactions"><input id="planSearch" class="search" type="search" placeholder="Find SKU" aria-label="Find SKU in initial copy plan"><button class="refresh" id="refreshPlan" type="button" hidden>Refresh stock plan</button></div></div><p class="previewnote" id="planSummary">Loading plan…</p><div id="planRows" class="previewlist"></div></section>
<section class="panel previewpanel" aria-labelledby="queueHeading"><div class="previewhead"><div><h2 id="queueHeading">Pending work preview</h2><p class="previewnote">Queued Shopify changes and updates awaiting processing. Estimates use current stock and will be checked again before any update.</p></div><button class="refresh" id="refreshPreview" type="button">Check current stock</button></div><p class="previewnote" id="queueSummary">Loading queue…</p><div id="queueRows" class="previewlist"></div></section>
<div class="two"><section class="panel"><div class="panelhead"><h2>Connection details</h2></div><div class="facts">
<div class="fact"><span>Main store</span><b>Firgelli Automation · 1350 Slater Road</b></div>
<div class="fact"><span>Child store</span><b>Firgelli · Warehouse</b></div>
<div class="fact"><span>Last daily discovery</span><b id="discovery">—</b></div>
<div class="fact"><span>Last completed stock scan</span><b id="scan">—</b></div>
<div class="fact"><span>Initial copy completed</span><b id="initialComplete">—</b></div>
</div></section><section class="panel"><div class="panelhead"><h2>Needs attention</h2><span class="muted" id="problemCount"></span></div><div id="problems" class="list"></div></section></div>
<section class="panel"><div class="panelhead"><div><h2>Activity history</h2><p class="muted">Recent events recorded by this app. Times shown in your local time zone.</p></div><span class="muted" id="updated"></span></div>
<div class="toolbar"><input id="search" class="search" type="search" placeholder="Filter by SKU" aria-label="Filter by SKU"><div class="tabs"><button class="tab active" data-filter="all">All</button><button class="tab" data-filter="problems">Warnings & errors</button><button class="tab" data-filter="changes">Stock changes</button></div></div><div id="activity" class="list"></div></section>
</main><script nonce="${nonce}">
const el=id=>document.getElementById(id);let data=null,plan=null,preview=null,filter='all',loading=false,previewLoading=false,retryTimer=null,sessionFailures=0;
const date=value=>value?new Date(value).toLocaleString(): 'Not yet recorded';
const number=value=>Number(value).toLocaleString();
const names={webhook:'Order or stock change received',change:'Stock change detected',write:'Quantity updated',sync:'Inventory change copied',
  bootstrap:'SKU initialized',auto_enroll:'New SKU enrolled',discovery:'Daily SKU check',
  scan_complete:'Backup scan completed',scan_error:'SKU check failed',retry:'Update will retry',
  stale:'Stock changed during update',negative_blocked:'Negative stock prevented',
  cloud_error:'App operation failed',worker_error:'Sync worker failed',auto_enroll_error:'New SKU enrollment failed',
  sync_paused:'Sync paused',sync_resumed:'Sync enabled',catalog_staged:'Catalog staged',
  ambiguous_change:'Both stores changed; SKU blocked',conflict_approved:'Separate orders confirmed',
  mirror_rebaselined:'Mirrored main-store order recorded once',shadow_baseline:'Read-only baseline refreshed',
  alert_dismissed:'Alert dismissed'};
function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=String(text);return e}
const store=side=>side==='main'?'Main store':side==='child'?'Child store':'';
const deltaText=value=>value<0?'decreased by '+Math.abs(value):'increased by '+value;
function changeDetails(e){const match=/Main ([+-][0-9]+), child ([+-][0-9]+); shared target (-?[0-9]+)/i.exec(e.message||'');
  return match?{mainDelta:Number(match[1]),childDelta:Number(match[2]),target:Number(match[3])}:null;}
function combinedActivity(rows){const hidden=new Set(),combined=[];
  for(const sync of rows){if(!sync.type.startsWith('sync_'))continue;const syncTime=Date.parse(sync.at)||0;for(const event of rows){if(['change','webhook'].includes(event.type)&&event.sku===sync.sku&&Math.abs((Date.parse(event.at)||0)-syncTime)<=120000)hidden.add(event.id)}}
  for(const change of rows){if(change.type!=='change'||hidden.has(change.id))continue;const details=changeDetails(change);if(!details)continue;
    const changeTime=Date.parse(change.at)||0;const writes=rows.filter(e=>e.type==='write'&&e.sku===change.sku&&!hidden.has(e.id)&&Math.abs((Date.parse(e.at)||0)-changeTime)<=120000&&e.to_qty===details.target);
    if(!writes.length)continue;const origins=[details.mainDelta&&'main',details.childDelta&&'child'].filter(Boolean);const destinations=[...new Set(writes.map(e=>e.side))];
    const direction=origins.length===1&&destinations.length===1?store(origins[0])+' → '+store(destinations[0]):'Both stores → shared quantity';
    const parts=[];for(const side of ['main','child']){const delta=details[side+'Delta'];if(delta){const before=details.target-delta;parts.push(store(side)+' '+deltaText(delta)+' ('+before+' → '+details.target+')')}}
    for(const write of writes)parts.push(store(write.side)+' copied '+write.from_qty+' → '+write.to_qty);
    const latest=writes.reduce((a,b)=>(Date.parse(a.at)||0)>(Date.parse(b.at)||0)?a:b);combined.push({...latest,type:'sync',message:parts.join(' · '),direction});
    hidden.add(change.id);for(const write of writes)hidden.add(write.id);for(const event of rows){if(event.type==='webhook'&&event.sku===change.sku&&Math.abs((Date.parse(event.at)||0)-changeTime)<=120000)hidden.add(event.id)}}
  return [...rows.filter(e=>!hidden.has(e.id)),...combined].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));}
function line(e){const sku=e.sku?' · '+e.sku:'';if(e.type==='sync')return{title:'Inventory copied: '+e.direction+sku,detail:e.message};
  if(e.type==='sync_main_to_child')return{title:'Inventory copied: Main store → Child store'+sku,detail:e.message};
  if(e.type==='sync_child_to_main')return{title:'Inventory copied: Child store → Main store'+sku,detail:e.message};
  if(e.type==='webhook')return{title:'Order or stock change received on '+store(e.side)+sku,detail:e.message.includes('paused')?'Sync is paused; the change was logged only.':'Waiting for the app to compare both stores.'};
  const title=names[e.type]||e.type;const side=store(e.side);const quantity=e.from_qty!==null&&e.to_qty!==null?' · '+e.from_qty+' → '+e.to_qty:'';
  return {title:title+sku,detail:[side+quantity,e.message].filter(Boolean).join(' · ')};}
function renderRows(target,rows,empty){const box=el(target);box.replaceChildren();if(!rows.length){box.append(node('div','empty',empty));return}
  for(const e of rows){const row=node('div','entry');row.append(node('span','badge '+(e.level==='error'?'error':e.level==='warning'?'warning':''),e.level));
    const body=node('div');const info=line(e);body.append(node('strong','',info.title));if(info.detail)body.append(node('small','',info.detail));const actions=node('div','entryactions');actions.append(node('span','time',date(e.at)));
    if(target==='problems'&&e.dismissable){const button=node('button','dismiss','Dismiss');button.type='button';button.title='Hide this resolved alert from Needs attention. It remains in Activity history.';button.addEventListener('click',()=>dismissProblem(e.id,button));actions.append(button)}
    row.append(body,actions);box.append(row)}}
function previewRow(target,sku,detail){const row=node('div','previewrow');row.append(node('strong','',sku),node('span','',detail));target.append(row)}
function renderPlan(){if(data?.status?.initialCopyCompletedAt)return;const box=el('planRows');box.replaceChildren();if(!plan?.planId){el('planSummary').textContent='No stock plan has been generated yet. Refresh the stock plan to preview it.';return}
  const staged=Boolean(plan.stagedAt);el('planDescription').textContent=staged?'Staged baseline, with no Shopify inventory changes yet. When you enable syncing, queued differences and newer stock changes will be reconciled using current quantities.':'Read-only snapshot: these child-store quantities would be set to the main store quantities during full rollout. Stock may change before then.';
  const changes=plan.changes||[];const eligible=plan.eligible??plan.candidates?.length??0;el('planSummary').textContent=eligible+' matching SKUs · '+changes.length+' initial child differences · '+(eligible-changes.length)+' matched at staging · '+(staged?'staged ':'snapshot ')+date(staged?plan.stagedAt:plan.planId);
  const query=el('planSearch').value.trim().toLowerCase();const filtered=changes.filter(r=>r.sku.toLowerCase().includes(query));
  if(!filtered.length){box.append(node('div','empty',query?'No changed SKUs match this search.':'No child quantities need changing in this snapshot.'));return}
  for(const row of filtered)previewRow(box,row.sku,'Child '+row.childQuantity+' → '+row.mainQuantity+' (main)');}
function renderQueue(){if(!data)return;const box=el('queueRows');box.replaceChildren();const jobs=data.pendingJobs||[],writes=data.pendingWrites||[];
  const summary=preview?.summary;
  el('refreshPreview').disabled=previewLoading||(!jobs.length&&!writes.length);
  el('queueSummary').textContent=!jobs.length&&!writes.length?'No pending stock changes or updates.':data.status.pendingJobs+' queued events · '+data.status.pendingWrites+' planned updates'+(summary?' · '+summary.childUpdates+' child only · '+summary.mainUpdates+' main only · '+summary.bothUpdates+' both stores · '+summary.ambiguous+' ambiguous · '+summary.noChange+' no change · checked '+date(preview.checkedAt):' · click Check current stock for estimated quantities');
  const bySku=new Map((preview?.rows||[]).map(r=>[r.sku,r]));
  const queued=[...writes.map(write=>({kind:'write',at:Date.parse(write.created_at)||Number(write.next_at)||0,value:write})),
    ...jobs.map(job=>({kind:'job',at:Date.parse(job.last_at||job.created_at)||0,value:job}))].sort((a,b)=>b.at-a.at);
  for(const item of queued){if(item.kind==='write'){const write=item.value;previewRow(box,write.sku,(write.side==='main'?'Main':'Child')+' '+write.from_qty+' → '+write.to_qty+(write.attempts?' · retry '+write.attempts:'')+' · '+date(write.created_at||write.next_at||null));continue}
    const job=item.value,row=bySku.get(job.sku);let detail=job.event_count+' queued event'+(job.event_count===1?'':'s')+' · latest '+date(job.last_at||job.created_at);
    if(row)detail+=' · '+(row.error||row.note||('Main '+row.main+' → '+row.target+'; child '+row.child+' → '+row.target+(row.approved?' · separate orders confirmed':'')));
    previewRow(box,job.sku,detail)}
  if(data.status.pendingJobs>jobs.reduce((sum,row)=>sum+row.event_count,0))box.append(node('p','previewnote','More queued events exist. The first 1,000 SKUs are shown.'));}
function render(){if(!data)return;const s=data.status,c=data.control;el('live').textContent=s.active?'On':'Off';el('live').className='value '+(s.active?'good':'bad');
  el('initialPreview').hidden=Boolean(s.initialCopyCompletedAt);
  el('refreshPlan').hidden=!c.canManage||Boolean(s.initialStagedAt);
  el('tracked').textContent=s.initializedSkus;el('pending').textContent=s.pendingJobs+s.pendingWrites;el('pending').className='value '+(s.pendingJobs+s.pendingWrites?'bad':'good');
  el('new').textContent=s.discovery.candidateCount;el('discovery').textContent=date(s.discovery.lastScanAt);el('scan').textContent=date(data.lastCompletedScan);el('initialComplete').textContent=date(s.initialCopyCompletedAt);
  el('updated').textContent='Updated '+new Date().toLocaleTimeString();const banner=el('banner');banner.className='banner '+(s.active?'good':'');
  banner.textContent=s.active?'Live syncing is on. Inventory changes can update the other store.':!s.syncEnabled&&!s.inventoryWritesEnabled?'Observation mode: inventory writes are locked. Shopify changes are logged and previews are read-only.':'Sync is off. Shopify inventory changes are being logged but are not copied between stores.';
  el('controlState').textContent=s.active?'ON':'OFF';el('controlState').className='mode '+(s.active?'on':'off');
  el('controlMessage').textContent=s.active?'Both stores are syncing. Pause stops new inventory updates.':!s.syncEnabled&&!s.inventoryWritesEnabled?'Observation mode. Inventory changes are being previewed without writes.':c.blockedSkus?'Sync is paused. '+c.blockedSkus+' SKU(s) need review before enabling.':c.rolloutReady?'Sync is paused. Enable to check current stock and process pending changes.':'Sync is off while the full rollout is being prepared.';
  el('controlHint').textContent=!c.canManage?'Only the approved main-store account can change this setting.':c.blockedSkus?'Both stores changed for one or more SKUs; the app will not guess whether these are separate sales.':!c.rolloutReady?'Enable stays locked until full rollout is approved and the safety switches are on.':'Webhook activity continues while syncing is paused.';
  const controlButton=el('controlButton');controlButton.hidden=!c.canManage;controlButton.textContent=s.active?'Pause syncing':'Enable syncing';controlButton.className='controlbutton '+(s.active?'pause':'enable');controlButton.disabled=!c.rolloutReady||Boolean(c.blockedSkus);
  const activeRetries=data.pendingWrites.filter(w=>w.attempts>0);
  const blocks=(data.blockedSkus||[]).map(b=>({at:b.blocked_at,level:'error',type:'ambiguous_change',sku:b.sku,message:b.reason}));
  const problems=[...blocks,...activeRetries.map(w=>({at:new Date(w.next_at).toISOString(),level:'error',type:'retry',sku:w.sku,side:w.side,from_qty:w.from_qty,to_qty:w.to_qty,message:w.last_error||'Pending retry'})),...data.problems.map(e=>({...e,dismissable:c.canManage}))]
    .sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
  el('problemCount').textContent=blocks.length+' blocked · '+activeRetries.length+' active retries · '+data.problems.length+' alerts';renderRows('problems',problems.slice(0,5),'No recent warnings or failed updates.');
  const q=el('search').value.trim().toLowerCase();let rows=combinedActivity(data.activity).filter(e=>!q||e.sku?.toLowerCase().includes(q));
  if(filter==='problems')rows=rows.filter(e=>e.level!=='info');if(filter==='changes')rows=rows.filter(e=>['sync','sync_main_to_child','sync_child_to_main','change','write','bootstrap','auto_enroll'].includes(e.type));
  renderRows('activity',rows,'No events match this view.');renderQueue();renderPlan();}
async function viewerRequest(path,method='GET'){const request=async()=>fetch(path,{method,headers:{Authorization:'Bearer '+await window.shopify.idToken()},cache:'no-store'});
  let res=await request();if(res.status===401)res=await request();if(!res.ok){const body=await res.json().catch(()=>({}));throw Error(body.error||'Preview unavailable ('+res.status+').')}return res.json()}
async function loadUsage(){try{const usage=await viewerRequest('/viewer/usage');const percent=Math.max(0,Math.min(100,usage.percentUsed));
  el('usageValue').textContent=number(usage.requests)+' / '+number(usage.limit)+' requests ('+percent.toFixed(percent<10?2:1)+'%)';
  el('usageRemaining').textContent=number(usage.remaining)+' requests remaining · '+number(usage.errors)+' errors today';
  el('usageReset').textContent='Resets '+date(usage.resetAt);el('usageFill').style.width=Math.max(percent,.15)+'%';el('usageFill').className='usagefill '+(percent>=90?'bad':percent>=70?'warn':'');el('usageBar').setAttribute('aria-valuenow',percent.toFixed(2));
  }catch(error){el('usageValue').textContent='Unavailable';el('usageRemaining').textContent=error.message;}}
async function dismissProblem(id,button){button.disabled=true;button.textContent='Dismissing…';try{const request=async()=>fetch('/viewer/attention',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await window.shopify.idToken()},body:JSON.stringify({id}),cache:'no-store'});
  let res=await request();if(res.status===401)res=await request();if(!res.ok){const body=await res.json().catch(()=>({}));throw Error(body.error||'Could not dismiss alert')}
  await load()}catch(error){button.disabled=false;button.textContent='Dismiss';el('problemCount').textContent=error.message}}
async function loadPlan(refresh=false){const button=el('refreshPlan');button.disabled=true;try{plan=await viewerRequest('/viewer/plan',refresh?'POST':'GET');renderPlan()}catch(error){el('planSummary').textContent=error.message}finally{button.disabled=false}}
async function loadPreview(){if(previewLoading||!data)return;if(!data.status.pendingJobs&&!data.status.pendingWrites){preview=null;renderQueue();return}previewLoading=true;const button=el('refreshPreview');button.disabled=true;el('queueSummary').textContent='Checking current stock…';try{preview=await viewerRequest('/viewer/preview');renderQueue()}catch(error){el('queueSummary').textContent=error.message}finally{previewLoading=false;button.disabled=!data.status.pendingJobs&&!data.status.pendingWrites}}
async function load(){if(loading)return;loading=true;const btn=el('refresh');btn.disabled=true;try{if(!window.shopify?.idToken)throw Error('Open this page from the installed app in Shopify admin.');
  const request=async()=>fetch('/viewer/overview',{headers:{Authorization:'Bearer '+await window.shopify.idToken()},cache:'no-store'});
  let res=await request();if(res.status===401)res=await request();
  if(!res.ok){const err=Error(res.status===401?'Shopify session could not be refreshed. Reopen the app from Shopify admin.':'Status is temporarily unavailable ('+res.status+').');err.session=res.status===401;throw err}
  data=await res.json();if(!data.status.pendingJobs&&!data.status.pendingWrites)preview=null;sessionFailures=0;if(retryTimer){clearTimeout(retryTimer);retryTimer=null}render()
  }catch(err){if(err.session&&++sessionFailures<6){if(data)el('updated').textContent='Refreshing Shopify session…';else{el('banner').className='banner';el('banner').textContent='Refreshing Shopify session…'}
      if(!retryTimer)retryTimer=setTimeout(()=>{retryTimer=null;load()},10000)
    }else{el('banner').className='errorbox';el('banner').textContent=err.message}}
  finally{loading=false;btn.disabled=false}}
el('refresh').addEventListener('click',async()=>{await Promise.all([load(),loadUsage()]);if(!data?.status?.initialCopyCompletedAt)loadPlan();loadPreview()});el('search').addEventListener('input',render);el('planSearch').addEventListener('input',renderPlan);
el('refreshPlan').addEventListener('click',()=>loadPlan(true));el('refreshPreview').addEventListener('click',loadPreview);
el('controlButton').addEventListener('click',async()=>{if(!data?.control?.canManage||!data.control.rolloutReady)return;
  const action=data.control.active?'pause':'resume',button=el('controlButton');button.disabled=true;button.textContent=action==='pause'?'Pausing…':'Enabling…';
  try{const request=async()=>fetch('/viewer/control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await window.shopify.idToken()},body:JSON.stringify({action}),cache:'no-store'});
    let res=await request();if(res.status===401)res=await request();if(!res.ok){const body=await res.json().catch(()=>({}));throw Error(body.error||'Could not change sync state')}
    const result=await res.json();data.control=result.control;data.status.active=result.control.active;render();await load()
  }catch(err){el('controlMessage').textContent=err.message;button.disabled=false;button.textContent=action==='pause'?'Pause syncing':'Enable syncing'}});
for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>{filter=tab.dataset.filter;for(const t of document.querySelectorAll('.tab'))t.classList.toggle('active',t===tab);render()});
Promise.all([load(),loadUsage()]).then(()=>{if(data){if(!data.status.initialCopyCompletedAt)loadPlan();loadPreview()}});setInterval(load,45000);setInterval(loadUsage,300000);
</script></body></html>`;
}
