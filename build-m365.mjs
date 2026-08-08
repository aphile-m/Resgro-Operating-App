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
  '\n<script src="https://alcdn.msauth.net/browser/3.28.1/js/msal-browser.min.js"></script>\n<script type="module">\nimport{createClient}');

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
const sb=await createM365Client(M365);`);

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
    <div style="margin-top:1rem;text-align:center"><a href="#" onclick="doMigrate();return false" style="font-size:.74rem;color:var(--ink4)">One-time: migrate my existing data from Supabase</a></div>`);

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
    const{error}=await sb.auth.signIn();
    if(error)throw new Error(error.message);
    btn.textContent='Setting up your workspace…';
    await sb._ensureAllLists();
    me=(await sb.auth.getSession()).data.session.user;
    await loadP();await loadAll();showApp();
  }catch(e){authErr((e.message||'Sign-in failed')+'');btn.disabled=false;btn.innerHTML='&#61452; Sign in with Microsoft';}
};
/* One-time migration: pull every table from the old Supabase project (using
   the user's Supabase login) and write it into SharePoint. Confidential data
   flows browser → SharePoint directly; nothing is stored in the repo. */
window.doMigrate=async()=>{
  if(!confirm('Migrate your existing data from Supabase into Microsoft 365?\\n\\nYou will sign in to BOTH accounts. Run this once.'))return;
  const em=prompt('Supabase login — email (your current app login):');if(!em)return;
  const pw=prompt('Supabase login — password:');if(!pw)return;
  const el=document.getElementById('aerr');el.style.display='block';el.style.color='var(--ink2)';
  const say=m=>{el.textContent=m;};
  try{
    say('Signing in to Microsoft…');
    await sb.auth.signIn();await sb._ensureAllLists();
    say('Signing in to Supabase…');
    const{createClient}=await import('https://esm.sh/@supabase/supabase-js@2');
    const old=createClient('https://ewdloawwudqkdrstqfet.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3ZGxvYXd3dWRxa2Ryc3RxZmV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODc5NDYsImV4cCI6MjA5MTc2Mzk0Nn0.xMOdn6c9sQwrUoEpBk9MZUFHFSV0CLFTUrlyzkgRqUM');
    const{error:aerr}=await old.auth.signInWithPassword({email:em,password:pw});
    if(aerr)throw new Error('Supabase sign-in failed: '+aerr.message);
    const tables=['profiles','decisions','comments','verifications','attachments','opportunities','documents','meeting_minutes','investor_targets','invoices','p1_versions','proposals'];
    let total=0;
    for(const t of tables){
      say('Migrating '+t+'…');
      const{data,error}=await old.from(t).select('*');
      if(error){console.warn(t,error.message);continue;}
      for(const row of (data||[])){
        const{error:ie}=await sb.from(t).insert(row);
        if(ie)console.warn('insert',t,ie.message);else total++;
      }
    }
    say('Done — migrated '+total+' records. Sign in with Microsoft to continue.');
  }catch(e){el.style.color='var(--red)';say('Migration error: '+(e.message||e));}
};`);

writeFileSync('m365.html', h);
console.log('m365.html written (' + Math.round(h.length / 1024) + ' KB)');
