/* Generates m365.html from index.html by swapping ONLY the data + auth layer.
 * Everything else (UI, CSS, all render logic, invoices, AI assistant) is reused
 * verbatim, so the two stay in lockstep — re-run this after editing index.html.
 *
 *   node build-m365.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

let h = readFileSync('index.html', 'utf8');
const must = (label, before) => {
  if (!h.includes(before)) { console.error('BUILD FAIL — anchor not found:', label); process.exit(1); }
};

// 1) Load MSAL (classic script, runs before the deferred module) right before
//    the app's module script.
must('module tag', '\n<script type="module">\nimport{createClient}');
h = h.replace('\n<script type="module">\nimport{createClient}',
  '\n<script src="https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/lib/msal-browser.min.js"></script>\n<script type="module">\nimport{createClient}');

// 2) Swap the Supabase import + createClient block for the M365 adapter.
const initBefore =
`import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const SU='https://ewdloawwudqkdrstqfet.supabase.co';
const SK='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3ZGxvYXd3dWRxa2Ryc3RxZmV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODc5NDYsImV4cCI6MjA5MTc2Mzk0Nn0.xMOdn6c9sQwrUoEpBk9MZUFHFSV0CLFTUrlyzkgRqUM';
const sb=createClient(SU,SK);`;
must('init block', initBefore);
h = h.replace(initBefore,
`import{createM365Client}from'./m365-adapter.js';
const M365={clientId:'33cc1f12-5385-4ddb-8832-6122e3beed83',tenant:'resgrocapital.com',cc:'aphile@resgrocapital.com'};
let sb=null;
async function ensureClient(){ if(!sb) sb=await createM365Client(M365); return sb; }`);

// 2b) Make bootstrap failures VISIBLE: create the client inside init()'s try
//     (so MSAL/tenant/consent errors surface on screen instead of hanging the
//     loading dots), and expose sb to iframes via a live getter.
must('init try', `  try{
    const{data:{session}}=await sb.auth.getSession();`);
h = h.replace(`  try{
    const{data:{session}}=await sb.auth.getSession();`,
`  try{
    await ensureClient();
    const{data:{session}}=await sb.auth.getSession();`);

must('__resgro', 'window.__resgro = { sb,');
h = h.replace('window.__resgro = { sb,', 'window.__resgro = { get sb(){return sb;},');

// 3) Swap the email/password auth form for a "Sign in with Microsoft" button
//    plus a one-time data-migration link.
const authBefore =
`    <div class="fg"><label class="fl">Email</label><input class="fi" type="email" id="lem" placeholder="you@example.com"></div>
    <div class="fg"><label class="fl">Password</label><input class="fi" type="password" id="lpw" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" onkeydown="if(event.key==='Enter')doLogin()"></div>
    <button class="btnp" onclick="doLogin()" id="lbtn">Sign in</button>`;
must('auth form', authBefore);
h = h.replace(authBefore,
`    <div style="font-size:.82rem;color:var(--ink3);margin:.2rem 0 1rem;line-height:1.5">Sign in with your Microsoft 365 account (the same one as your Resgro email). Your data lives in your own SharePoint.</div>
    <button class="btnp" onclick="doLogin()" id="lbtn">&#61452; Sign in with Microsoft</button>
    <input type="file" id="migfile" accept="application/json,.json" style="display:none" onchange="doMigrate(this.files[0])">
    <div style="margin-top:1rem;text-align:center"><a href="#" onclick="document.getElementById('migfile').click();return false" style="font-size:.74rem;color:var(--ink4)">One-time: import my existing data (resgro-export.json)</a></div>`);

// 4) Swap the sign-in handler (signInWithPassword → MSAL) and add migration.
const loginBefore =
`window.doLogin=async()=>{
  const btn=document.getElementById('lbtn');btn.disabled=true;btn.textContent='Signing in...';
  const em=document.getElementById('lem').value.trim(),pw=document.getElementById('lpw').value;
  if(!em||!pw){authErr('Please enter your email and password.');btn.disabled=false;btn.textContent='Sign in';return;}
  const{data,error}=await sb.auth.signInWithPassword({email:em,password:pw});
  if(error){authErr('Invalid email or password.');btn.disabled=false;btn.textContent='Sign in';return;}
  me=data.user;await loadP();await loadAll();showApp();
};`;
must('doLogin', loginBefore);
h = h.replace(loginBefore,
`window.doLogin=async()=>{
  const btn=document.getElementById('lbtn');btn.disabled=true;btn.textContent='Signing in…';
  try{
    await ensureClient();
    const{error}=await sb.auth.signIn();
    if(error)throw new Error(error.message);
    btn.textContent='Setting up your workspace…';
    await sb._ensureAllLists();
    me=(await sb.auth.getSession()).data.session.user;
    await loadP();await loadAll();showApp();
  }catch(e){authErr((e.message||'Sign-in failed')+'');btn.disabled=false;btn.innerHTML='&#61452; Sign in with Microsoft';}
};
/* One-time import: read an exported JSON file ({table:[rows...]}) and write it
   into SharePoint. Idempotent — skips rows whose id already exists, so it is
   safe to re-run. Confidential data flows file → browser → your SharePoint;
   nothing is stored in the repo. */
window.doMigrate=async(file)=>{
  if(!file)return;
  const el=document.getElementById('aerr');el.style.display='block';el.style.color='var(--ink2)';
  const say=m=>{el.textContent=m;};
  try{
    say('Reading export…');
    const dump=JSON.parse(await file.text());
    say('Signing in to Microsoft…');
    await ensureClient();
    await sb.auth.signIn();await sb._ensureAllLists();
    const tables=['profiles','decisions','comments','verifications','attachments','opportunities','documents','meeting_minutes','investor_targets','invoices','p1_versions','proposals'];
    let total=0;
    for(const t of tables){
      const rows=dump[t]||[];if(!rows.length)continue;
      say('Importing '+t+' ('+rows.length+')…');
      const{data:existing}=await sb.from(t).select('*');
      const have=new Set((existing||[]).map(x=>x.id));
      for(const row of rows){
        if(have.has(row.id))continue;
        const{error:ie}=await sb.from(t).insert(row);
        if(ie)console.warn('insert',t,ie.message);else total++;
      }
    }
    say('Done — imported '+total+' records. Now click "Sign in with Microsoft" to open the app.');el.style.color='var(--green)';
  }catch(e){el.style.color='var(--red)';say('Import error: '+(e.message||e));}
};`);

writeFileSync('m365.html', h);
console.log('m365.html written (' + Math.round(h.length / 1024) + ' KB)');
