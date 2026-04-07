/* ── 테마 ── */
// 기본값: 라이트모드. localStorage에 'dark'가 저장된 경우에만 다크 적용
let _isDark = false;
(function(){
  try{ const s=localStorage.getItem('ajs_theme'); if(s==='dark') _isDark=true; }catch(e){}
  if(_isDark) document.body.classList.add('dark');
  updateThemeLabel();
})();
function toggleTheme(){
  _isDark=!_isDark;
  document.body.classList.toggle('dark',_isDark);
  try{ localStorage.setItem('ajs_theme',_isDark?'dark':'light'); }catch(e){}
  updateThemeLabel();
}
function updateThemeLabel(){
  const el=document.getElementById('themeToggleLabel');
  if(el) el.textContent=_isDark?'다크 모드':'라이트 모드';
}

/* ── localStorage 헬퍼 (키워드·설정용 유지) ── */
const SK={KWS:'ajs_kws',SEL_KW:'ajs_sel_kw',MATCH_MODE:'ajs_match_mode',API_KEYS:'ajs_api_keys',DYN_APIS:'ajs_dyn_apis',JK_ENABLED:'ajs_jk_enabled',JK_PARAMS:'ajs_jk_params'};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}};
const load=(k,fb)=>{try{const r=localStorage.getItem(k);return r===null?fb:JSON.parse(r);}catch(e){return fb;}};

const CONFIG={adminPassword:'gkdlxpzj!',superPassword:'dlalswl',apiKeys:{saramin:'',worknet:''}};
const DEFAULT_KWS=['데이터 사이언티스트','데이터 분석','데이터 엔지니어','AI 엔지니어','머신러닝','딥러닝','LLM','헬스케어','의료데이터','EMR','임상데이터','Python','SQL','Spark','MLOps','백엔드 개발','추천시스템','자연어처리'];
let KWS=load(SK.KWS,DEFAULT_KWS);

const KW_PAT={'데이터 사이언티스트':['데이터 사이언티스트','data scientist','ml/ai'],'데이터 분석':['데이터 분석','데이터분석','분석가','analytics'],'데이터 엔지니어':['데이터 엔지니어','data engineer','kafka'],'AI 엔지니어':['ai 엔지니어','ai연구원','ai 연구원','ai 개발','인공지능'],'머신러닝':['머신러닝','machine learning','ml'],'딥러닝':['딥러닝','deep learning'],'LLM':['llm','대규모 언어모델'],'헬스케어':['헬스케어','디지털 헬스','healthcare'],'의료데이터':['의료데이터','의료 데이터','medical data'],'EMR':['emr'],'임상데이터':['임상데이터','임상 데이터','rwe'],'Python':['python','fastapi'],'SQL':['sql'],'Spark':['spark'],'MLOps':['mlops'],'백엔드 개발':['백엔드 개발','백엔드 개발자','backend','fastapi','server'],'추천시스템':['추천시스템','추천 시스템','recommender'],'자연어처리':['자연어처리','자연어 처리','nlp']};

const TODAY=new Date(); TODAY.setHours(0,0,0,0);
const dday=s=>{if(!s||s==='9999-12-31'||s==='9999-12-30')return 999;const d=new Date(s);d.setHours(0,0,0,0);return Math.ceil((d-TODAY)/86400000);};

let CUSTOM_JOBS=[];
let JOBS=[];
let ALL_JOBS=[];
let JK_JOBS=[];           // 잡코리아 API 공고
let jkEnabled=load(SK.JK_ENABLED, true);
let isSuperMode=false; // 제작자 전용 슈퍼 모드
let jkSyncStatus='idle';  // 'idle'|'loading'|'live'|'error'
let jkLastSync=null;
let selKw=new Set(load(SK.SEL_KW,[]));
let apiKeys=load(SK.API_KEYS,{...CONFIG.apiKeys});
let matchMode=load(SK.MATCH_MODE,'any');
let globalSearchQ='';
let salaryMinFilter=0;
let jmTabFilter='all';
let urgentFilter=false;
let closedFilter=false;
let currentPage=1;  // 메인화면 페이지
const PAGE_SIZE=30; // 한 페이지에 보여줄 공고 수
let jmPage=1;       // 공고 관리 페이지

function rebuildJobs(){
  // 잡코리아 공고와 직접등록 공고 합산 (중복 방지)
  const jkActive = jkEnabled ? JK_JOBS : [];
  const customIds = new Set(CUSTOM_JOBS.map(j=>j.id));
  const merged = [...CUSTOM_JOBS, ...jkActive.filter(j=>!customIds.has(j.id))];
  ALL_JOBS=[...merged];
  JOBS=[...merged.filter(j=>!j.closed)];
}

/* ── Firestore 연동 ── */
function initFirebase(){
  if(window._fb && window._fbReady){
    // Firebase 이미 준비됨 — 바로 구독
    startFirebaseSubscription();
  } else {
    // 아직 준비 안 됨 — 100ms마다 폴링
    const poll = setInterval(()=>{
      if(window._fb && window._fbReady){
        clearInterval(poll);
        startFirebaseSubscription();
      }
    }, 100);
    // 10초 후에도 안 되면 경고
    setTimeout(()=>{ clearInterval(poll); }, 10000);
  }
}

function startFirebaseSubscription(){
  window._fb.subscribe((jobs)=>{
    CUSTOM_JOBS = jobs.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    ALL_JOBS = [...CUSTOM_JOBS];
    JOBS = [...CUSTOM_JOBS.filter(j=>!j.closed)];
    initDropdowns();
    render();
    if(document.getElementById('jobManagerOverlay')?.classList.contains('open')){
      renderCustomJobList();
    }
  });
  initNoticeSubscription();
  // 잡코리아 API 초기화 (Firebase 준비 후 실행)
  if(jkEnabled) initJobkorea();
}

/* ── 잡코리아 API 연동 ── */
async function initJobkorea(){
  updateJKSyncUI('loading','잡코리아 공고 불러오는 중…');
  try {
    // window._jk 는 jobkorea.js 가 <script type="module">로 로드된 후 설정됨
    // 최대 5초 대기
    let jk = window._jk;
    if (!jk) {
      await new Promise((resolve, reject) => {
        let tries = 0;
        const poll = setInterval(() => {
          if (window._jk) { clearInterval(poll); resolve(); }
          if (++tries > 50) { clearInterval(poll); reject(new Error('jobkorea.js 로드 타임아웃')); }
        }, 100);
      });
      jk = window._jk;
    }

    jk.injectJKStyles();
    const savedParams = load(SK.JK_PARAMS, {});
    await jk.loadJobkoreaJobs((jobs, status) => {
      JK_JOBS = jobs;
      rebuildJobs();
      initDropdowns();
      render();
      jkLastSync = new Date();
      if (status === 'error') {
        updateJKSyncUI('error', '잡코리아 연동 오류 (캐시 데이터 사용 중)');
      } else {
        updateJKSyncUI('live', `잡코리아 ${jobs.length}건 연동 완료 (${jkLastSync.toLocaleTimeString()})`);
      }
    }, savedParams);
  } catch(err) {
    console.error('[JK]', err);
    updateJKSyncUI('error', '잡코리아 연동 실패: ' + err.message);
  }
}

function updateJKSyncUI(status, msg) {
  jkSyncStatus = status;
  const dot = document.getElementById('jkSyncDot');
  const txt = document.getElementById('jkSyncText');
  if (dot) { dot.className = 'jk-sync-dot ' + status; }
  if (txt) { txt.textContent = msg; }
}

function toggleJKEnabled() {
  jkEnabled = !jkEnabled;
  save(SK.JK_ENABLED, jkEnabled);
  const btn = document.getElementById('jkToggleBtn');
  if (btn) btn.textContent = jkEnabled ? '연동 끄기' : '연동 켜기';
  if (jkEnabled) {
    initJobkorea();
  } else {
    JK_JOBS = [];
    rebuildJobs();
    initDropdowns();
    render();
    updateJKSyncUI('idle', '잡코리아 연동이 꺼져 있습니다.');
  }
}

function saveJKParams() {
  const area   = document.getElementById('jkArea')?.value.trim() || '';
  const rbcd   = document.getElementById('jkRbcd')?.value.trim() || '';
  const params = {};
  if (area) params.area = area;
  if (rbcd) params.rbcd = rbcd;
  save(SK.JK_PARAMS, params);
  // 캐시 초기화 후 재로드
  if (window._jk) window._jk.clearJKCache();
  initJobkorea();
}

function renderJKAdminPanel() {
  const savedParams = load(SK.JK_PARAMS, {});
  const panel = document.getElementById('adminPanelJk');
  if (!panel) return;
  panel.innerHTML = `
    <div class="jk-sync-status">
      <span class="jk-sync-dot ${jkSyncStatus}" id="jkSyncDot"></span>
      <span id="jkSyncText">${jkSyncStatus==='idle'?'대기중':jkSyncStatus==='loading'?'불러오는 중…':jkSyncStatus==='live'?`${JK_JOBS.length}건 연동됨`:'연동 오류'}</span>
      <button class="btn-sm" id="jkToggleBtn" onclick="toggleJKEnabled()" style="margin-left:auto">
        ${jkEnabled?'연동 끄기':'연동 켜기'}
      </button>
    </div>
    <div style="font-size:12px;color:var(--text-hint);margin-bottom:14px;">
      API Key: <code>1403</code> &nbsp;|&nbsp; 캐시: 6시간 유효<br>
      <strong>출처 표기 필수</strong> — 공고 리스트/상세 하단에 잡코리아 링크가 자동으로 표시됩니다.
    </div>
    <div class="fg" style="margin-bottom:10px;">
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">근무 지역 코드 (쉼표 구분, 최대 6개)</label>
      <input type="text" id="jkArea" value="${savedParams.area||'I000,B000,Q000'}" placeholder="예: I000,B000,Q000" style="width:100%;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary)">
      <div style="font-size:11px;color:var(--text-hint);margin-top:3px;">I000=서울, B000=경기, Q000=전국</div>
    </div>
    <div class="fg" style="margin-bottom:14px;">
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">업·직종 대분류 (선택)</label>
      <select id="jkRbcd" style="width:100%;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary)">
        <option value="" ${!savedParams.rbcd?'selected':''}>전체 업종</option>
        <option value="10007" ${savedParams.rbcd==='10007'?'selected':''}>IT·정보통신업</option>
        <option value="10031" ${savedParams.rbcd==='10031'?'selected':''}>개발·데이터</option>
        <option value="10004" ${savedParams.rbcd==='10004'?'selected':''}>의료·제약업</option>
        <option value="10030" ${savedParams.rbcd==='10030'?'selected':''}>마케팅·광고·MD</option>
        <option value="10028" ${savedParams.rbcd==='10028'?'selected':''}>인사·HR</option>
        <option value="10001" ${savedParams.rbcd==='10001'?'selected':''}>서비스업</option>
        <option value="10009" ${savedParams.rbcd==='10009'?'selected':''}>제조·생산·화학업</option>
      </select>
    </div>
    <button class="btn-primary" onclick="saveJKParams()" style="width:100%;margin-bottom:0">
      저장 후 재동기화
    </button>
  `;
}

/* ── 유틸 ── */
const norm=s=>s.toLowerCase().replace(/[·/()_\-]/g,' ').replace(/\s+/g,' ').trim();
const getPat=k=>(KW_PAT[k]||[k]).map(norm);

/* ── 키워드 매칭 ── */
function getHits(j){
  const txt=norm(`${j.title} ${j.role||''} ${j.industry||''} ${j.desc||''}`);
  return KWS.filter(k=>getPat(k).some(p=>txt.includes(p)));
}
function matchesKw(j){
  if(selKw.size===0)return true;
  const hits=new Set(getHits(j));
  return matchMode==='all'?[...selKw].every(k=>hits.has(k)):[...selKw].some(k=>hits.has(k));
}

/* ── 연봉 슬라이더 ── */
function onSalarySlider(){
  salaryMinFilter=parseInt(document.getElementById('salarySlider').value,10);
  const el=document.getElementById('salarySliderVal');
  el.textContent=salaryMinFilter===0?'제한 없음':`${salaryMinFilter.toLocaleString()}만원 이상`;
  currentPage=1;
  render();
}
function resetSalarySlider(){
  document.getElementById('salarySlider').value=0;
  salaryMinFilter=0;
  document.getElementById('salarySliderVal').textContent='제한 없음';
  currentPage=1;
  render();
}
function matchesSalary(j){
  if(salaryMinFilter===0)return true;
  const max=j.salaryMax||0;
  const min=j.salaryMin||0;
  if(max>0)return max>=salaryMinFilter;
  if(min>0)return min>=salaryMinFilter;
  return true; // 협의 등은 통과
}

/* ── 통합 검색 ── */
function onGlobalSearch(){
  globalSearchQ=document.getElementById('globalSearch').value.trim().toLowerCase();
  document.getElementById('searchClear').classList.toggle('on',globalSearchQ.length>0);
  currentPage=1;
  render();
}
function clearGlobalSearch(){
  document.getElementById('globalSearch').value='';
  globalSearchQ='';
  document.getElementById('searchClear').classList.remove('on');
  currentPage=1;
  render();
}
function matchesGlobal(j){
  if(!globalSearchQ)return true;
  const txt=norm(`${j.title} ${j.company} ${j.role||''} ${j.industry||''} ${j.location||''} ${j.desc||''}`);
  return globalSearchQ.split(/\s+/).every(q=>txt.includes(q));
}

/* ── KW 태그 ── */
function updateModeButtons(){
  document.getElementById('modeAnyBtn').classList.toggle('active',matchMode==='any');
  document.getElementById('modeAllBtn').classList.toggle('active',matchMode==='all');
}
function initKwTags(){
  document.getElementById('kwTags').innerHTML=KWS.map(k=>
    `<button type="button" class="ktag ${selKw.has(k)?'on':''}" data-kw="${k}" onclick="toggleKw(this.dataset.kw)">${k}</button>`
  ).join('');
  updateModeButtons();
}
function toggleKw(k){selKw.has(k)?selKw.delete(k):selKw.add(k);save(SK.SEL_KW,[...selKw]);currentPage=1;initKwTags();render();}
function selectAll(){KWS.forEach(k=>selKw.add(k));save(SK.SEL_KW,[...selKw]);currentPage=1;initKwTags();render();}
function clearAll(){selKw.clear();save(SK.SEL_KW,[]);currentPage=1;initKwTags();render();}
function setMatchMode(m){matchMode=m;save(SK.MATCH_MODE,m);currentPage=1;initKwTags();render();}

/* ── 드롭다운 초기화 ── */
function initDropdowns(){
  const fill=(id,vals)=>{
    const el=document.getElementById(id);
    const cur=el.value;
    const unique=[...new Set(vals)].sort();
    el.innerHTML='<option value="">전체</option>'+unique.map(v=>`<option value="${v}">${v}</option>`).join('');
    el.value=unique.includes(cur)?cur:'';
  };
  fill('fj',JOBS.map(j=>j.role));
  fill('fi',JOBS.map(j=>j.industry));
  fill('floc',JOBS.map(j=>j.location));
}

/* ── 필터링 ── */
function getFiltered(){
  const fj=document.getElementById('fj').value;
  const fi=document.getElementById('fi').value;
  const fs=document.getElementById('fs').value;
  const floc=document.getElementById('floc').value;
  const ft=document.getElementById('ft').value;
  const fexp=document.getElementById('fexp').value;

  return JOBS.filter(j=>{
    if(!matchesGlobal(j))return false;
    if(!matchesKw(j))return false;
    if(!matchesSalary(j))return false;
    if(fj&&j.role!==fj)return false;
    if(fi&&j.industry!==fi)return false;
    if(fs&&j.scale!==fs)return false;
    if(floc&&j.location!==floc)return false;
    if(ft&&j.jobType!==ft)return false;
    if(fexp){
      const b=expBadge(j.experience);
      if(fexp==='경력'){if(b!=='경력')return false;}
      else{if(b!==fexp)return false;}
    }
    return true;
  });
}

/* ── 기업 스타일 ── */
function compStyle(scale){
  if(scale==='large')return{icon:'🏢',bg:'#E8EDF5',color:'#0E2140'};
  if(scale==='startup')return{icon:'🚀',bg:'#FDF0E3',color:'#7A4E1A'};
  if(scale==='mid')return{icon:'🧩',bg:'#F0F5EE',color:'#2E5028'};
  if(scale==='public')return{icon:'🏛️',bg:'#EAF5EE',color:'#1A4A2E'};
  return{icon:'💼',bg:'#eee',color:'#333'};
}
function scaleClass(s){return{large:'large',mid:'mid',startup:'startup',public:'public'}[s]||'';}
function srcClass(s){return{saramin:'saramin',worknet:'worknet',custom:'custom',jobkorea:'jobkorea',jk_starter:'jk_starter',wanted:'wanted',work24:'work24',etc:'etc'}[s]||'';}
function srcName(s){return{saramin:'사람인',worknet:'워크넷',custom:'직접등록',jobkorea:'잡코리아',jk_starter:'잡코리아 신입공채',wanted:'원티드',work24:'고용24',etc:'기타'}[s]||s;}

/* ── 카드 HTML ── */
function cardHtml(j,idx,expired=false){
  const isAlways=j.deadlineType==='always';
  const isUntilFilled=j.deadlineType==='untilFilled';
  const d=(isAlways||isUntilFilled)?999:dday(j.deadline);
  const urg=!isAlways&&!isUntilFilled&&d<=7&&!expired;
  let ddayHtml;
  if(isAlways)ddayHtml=`<span class="dday-txt">상시채용</span>`;
  else if(isUntilFilled)ddayHtml=`<span class="dday-txt">채용시 마감</span>`;
  else if(expired)ddayHtml=`<span class="dday-txt">마감 ${j.deadline}</span>`;
  else ddayHtml=`<span class="dday-txt ${urg?'red':''}">${urg?'⚡ 마감임박 · ':''}마감 ${j.deadline} (D-${d})</span>`;
  const hits=getHits(j).filter(k=>selKw.size===0||selKw.has(k));
  const kwHtml=hits.slice(0,5).map(k=>`<span class="kh">${k}</span>`).join('')+(hits.length>5?`<span class="kh">+${hits.length-5}</span>`:'');
  const cs=compStyle(j.scale);
  return `<div class="jcard ${urg?'urgent':''} ${expired?'expired':''}" style="animation-delay:${idx*0.04}s">
    <div class="jcard-title-row">
      <span class="jcard-main-title">${j.title}</span>
      <div class="badges">
        <span class="b ${scaleClass(j.scale)}">${j.scaleName}</span>
        ${(()=>{const b=expBadge(j.experience);return b?`<span class="b exp-${b==='신입'?'new':b==='경력'?'exp':'both'}">${b}</span>`:''})()}
        ${j.education?`<span class="b edu">${eduBadge(j.education)}</span>`:''}
        <span class="b ${srcClass(j.src)}">${srcName(j.src)}</span>
      </div>
    </div>
    <div class="jcard-divider"></div>
    <div class="jcard-top">
      <div class="logo" style="background:${cs.bg};color:${cs.color}">${cs.icon}</div>
      <div class="jcard-head">
        <div class="jtitle">${j.company}</div>
        <div class="jcompany">${[j.role!=='미정'?j.role:'',j.location!=='미정'?j.location:'',j.jobType].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
    <div class="kw-hits">${kwHtml||'<span class="kh">전체 보기</span>'}</div>
    <div class="meta-row">
      <span>업종 <strong>${j.industry}</strong></span>
    </div>
    <div class="jcard-foot">
      <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${ddayHtml}
        ${j.salary&&j.salary!=='협의'&&j.salary!==''?`<span style="font-size:12px;color:var(--green);font-weight:600">💰 ${j.salary}</span>`:''}
      </span>
      <button class="detail-btn" onclick="openDetail('${j.id}')">상세보기 →</button>
    </div>
  </div>`;
}

/* ── 상세 패널 ── */
function openDetail(id){
  const j=JOBS.find(x=>String(x.id)===String(id))||ALL_JOBS.find(x=>String(x.id)===String(id));
  if(!j)return;
  const cs=compStyle(j.scale);
  const isAlways=j.deadlineType==='always';
  const isUntilFilled=j.deadlineType==='untilFilled';
  const d=(isAlways||isUntilFilled)?999:dday(j.deadline);
  const urg=!isAlways&&!isUntilFilled&&d<=7;

  let ddayStr;
  if(isAlways)ddayStr='상시채용';
  else if(isUntilFilled)ddayStr='채용시 마감';
  else ddayStr=`${j.deadline} (D-${d})`;

  document.getElementById('detailLogo').innerHTML=`<span style="font-size:22px">${cs.icon}</span>`;
  document.getElementById('detailLogo').style.cssText=`background:${cs.bg};color:${cs.color};width:52px;height:52px;border-radius:var(--radius-md);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0`;
  document.getElementById('detailTitle').textContent=j.title;
  document.getElementById('detailCompany').textContent=j.company;
  // 잡코리아 공고면 jkUrl로 연결, 일반 공고면 j.url
  const applyUrl = (j.src==='jobkorea'||j.src==='jk_starter') ? j.jkUrl : j.url;
  document.getElementById('detailApplyBtn').href = applyUrl || '#';

  // 잡코리아 공고 안내문구 표시 (가이드 필수)
  const disclaimerEl = document.getElementById('detailJkDisclaimer');
  if (disclaimerEl) {
    const disclaimerSrcs = {
      jobkorea:  { name: '잡코리아',  url: 'https://www.jobkorea.co.kr' },
      jk_starter:{ name: '잡코리아',  url: 'https://www.jobkorea.co.kr' },
      saramin:   { name: '사람인',    url: 'https://www.saramin.co.kr' },
      wanted:    { name: '원티드',    url: 'https://www.wanted.co.kr' },
    };
    const dInfo = disclaimerSrcs[j.src];
    if (dInfo) {
      disclaimerEl.style.display = '';
      disclaimerEl.innerHTML = `<div class="jk-disclaimer">자세한 채용정보는 반드시 상세정보를 통해 확인하시기 바랍니다.<br>본 정보는 채용기업과 <a href="${dInfo.url}" target="_blank" rel="noopener">${dInfo.name}</a>의 동의 없이 무단전재 또는 재배포, 재가공할 수 없습니다.</div>`;
    } else {
      disclaimerEl.style.display = 'none';
      disclaimerEl.innerHTML = '';
    }
  }

  const hits=getHits(j);
  const kwHtml=hits.length
    ?hits.map(k=>`<span class="detail-kw-tag">${k}</span>`).join('')
    :'<span style="font-size:13px;color:var(--text-hint)">매칭 키워드 없음</span>';

  document.getElementById('detailBody').innerHTML=`
    <div class="detail-section">
      <div class="detail-section-title">공고 정보</div>
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">회사명</div><div class="di-val">${j.company}</div></div>
        <div class="detail-item"><div class="di-label">기업 규모</div><div class="di-val">${j.scaleName}</div></div>
        <div class="detail-item"><div class="di-label">직무</div><div class="di-val">${j.role||'미정'}</div></div>
        <div class="detail-item"><div class="di-label">근무 형태</div><div class="di-val">${j.jobType}</div></div>
        <div class="detail-item"><div class="di-label">경력 구분</div><div class="di-val">${j.experience||'미정'}</div></div>
        <div class="detail-item"><div class="di-label">학력</div><div class="di-val">${j.education||'미정'}</div></div>
        <div class="detail-item"><div class="di-label">업종</div><div class="di-val">${j.industry||'미정'}</div></div>
        <div class="detail-item"><div class="di-label">근무 지역</div><div class="di-val">${j.location||'미정'}</div></div>
        <div class="detail-item"><div class="di-label">연봉</div><div class="di-val ${j.salary&&j.salary!=='협의'&&j.salary!=='면접 후 결정'?'salary':''}">${j.salary||'협의'}</div></div>
        <div class="detail-item"><div class="di-label">마감일</div><div class="di-val">
          ${urg?`<span style="color:var(--red);font-weight:600">⚡ ${ddayStr}</span>`:ddayStr}
        </div></div>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">매칭 키워드</div>
      <div class="detail-kw-tags">${kwHtml}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">출처</div>
      <div class="detail-badges">
        <span class="b ${srcClass(j.src)}">${srcName(j.src)}</span>
        <span class="b ${scaleClass(j.scale)}">${j.scaleName}</span>
      </div>
    </div>
    ${(j.requirements||j.desc)&&(j.requirements||j.desc).trim()&&(j.requirements||j.desc).trim()!=='#NAME?'?`
    <div class="detail-section">
      <div class="detail-section-title">우대사항 · 필요기술</div>
      <div style="font-size:13px;color:var(--text-primary);line-height:1.85;background:var(--bg-surface);border-radius:var(--radius-md);padding:12px 14px;white-space:pre-wrap">${(j.requirements||j.desc).replace(/</g,'&lt;')}</div>
    </div>`:''}    ${(j.src==='jobkorea'||j.src==='jk_starter')&&j.companyUrl?`
    <div class="detail-section">
      <div class="detail-section-title">기업 정보</div>
      <a href="${j.companyUrl}" target="_blank" rel="noopener" style="font-size:13px;color:var(--accent);text-decoration:none;border-bottom:1px solid currentColor;">잡코리아에서 기업정보 보기 →</a>
    </div>`:''}
  `;

  document.getElementById('detailOverlay').classList.add('open');
  document.getElementById('detailPanel').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeDetail(){
  document.getElementById('detailOverlay').classList.remove('open');
  document.getElementById('detailPanel').classList.remove('open');
  document.body.style.overflow='';
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetail();});

/* ── 페이지네이션 ── */
function renderPagination(page, total, fnName){
  if(total<=1)return'';
  const maxBtn=5;
  let start=Math.max(1,page-Math.floor(maxBtn/2));
  let end=Math.min(total,start+maxBtn-1);
  if(end-start<maxBtn-1)start=Math.max(1,end-maxBtn+1);
  let btns='';
  if(page>1)btns+=`<button class="pg-btn pg-arrow" onclick="${fnName}(${page-1})">‹</button>`;
  for(let i=start;i<=end;i++){
    btns+=`<button class="pg-btn${i===page?' pg-active':''}" onclick="${fnName}(${i})">${i}</button>`;
  }
  if(page<total)btns+=`<button class="pg-btn pg-arrow" onclick="${fnName}(${page+1})">›</button>`;
  return`<div class="pagination">${btns}<span class="pg-info">${page} / ${total} 페이지</span></div>`;
}
function goMainPage(p){
  currentPage=p;
  render();
  try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(e){ window.scrollTo(0,0); }
}
function goJmPage(p){
  jmPage=p;
  renderCustomJobList();
  const el=document.getElementById('jobManagerPage');
  if(el) try{ el.scrollTo({top:0,behavior:'smooth'}); }catch(e){ el.scrollTop=0; }
}

/* ── 메인 렌더 ── */
function render(){
  // 렌더 전 현재 높이 고정 → 스크롤 튀는 현상 방지
  const mainListEl = document.getElementById('mainList');
  if(mainListEl && mainListEl.offsetHeight > 0){
    mainListEl.style.minHeight = mainListEl.offsetHeight + 'px';
  }

  const all=getFiltered();
  const sortBy=document.getElementById('sortSel').value;

  // 진행중 / 마감임박 / 만료 분류
  const isExpired=j=>{
    if(j.deadlineType==='always'||j.deadlineType==='untilFilled')return false;
    return dday(j.deadline)<0;
  };
  const isUrgent=j=>!isExpired(j)&&j.deadlineType!=='always'&&j.deadlineType!=='untilFilled'&&dday(j.deadline)<=7;
  const isActive=j=>!isExpired(j)&&!isUrgent(j);

  let activeList=all.filter(isActive);
  let urgentList=all.filter(isUrgent);
  let expiredList=all.filter(isExpired);

  // 마감공고 포함 시 ALL_JOBS 기준으로 필터
  const allWithClosed=closedFilter?getFilteredAll():[];
  const expiredAll=closedFilter?allWithClosed.filter(isExpired):[];

  // 정렬
  const sortByDday=(a,b)=>dday(a.deadline)-dday(b.deadline);
  const sortByRecent=(a,b)=>String(b.id).localeCompare(String(a.id));
  const sortFn=sortBy==='recent'?sortByRecent:sortByDday;
  activeList.sort(sortFn);
  urgentList.sort(sortByDday);
  expiredAll.sort((a,b)=>dday(b.deadline)-dday(a.deadline)); // 최근 마감순

  // 통계 박스 — 전체공고는 마감 포함 ALL_JOBS 기준
  const expiredCount=ALL_JOBS.filter(j=>{
    if(j.deadlineType==='always'||j.deadlineType==='untilFilled')return false;
    return dday(j.deadline)<0;
  }).length;
  const stats=[
    {lbl:'전체 공고',val:ALL_JOBS.length,cls:'',click:''},
    {lbl:'매칭 공고',val:all.length,cls:'accent',click:''},
    {lbl:'마감임박 (D-7)',val:urgentList.length,cls:'red',click:'toggleUrgentFilter()'},
    {lbl:'마감 공고',val:expiredCount,cls:'',click:'toggleClosedFilter()'},
  ];
  document.getElementById('statsRow').innerHTML=stats.map(s=>{
    const isActive=(s.click==='toggleUrgentFilter()'&&urgentFilter)||(s.click==='toggleClosedFilter()'&&closedFilter);
    return `<div class="stat-box${s.click?' stat-box-clickable':''}${isActive?' stat-box-active':''}" ${s.click?`onclick="${s.click}"`:''}>
      <div class="lbl">${s.lbl}${isActive?' ✓':''}</div><div class="val ${s.cls}">${s.val}</div>
    </div>`;
  }).join('');

  // 마감공고 탭 버튼 상태
  const closedBtn=document.getElementById('closedTabBtn');
  if(closedBtn)closedBtn.classList.toggle('active',closedFilter);

  const visibleCount=urgentFilter?urgentList.length:activeList.length+urgentList.length;
  document.getElementById('rCount').textContent=visibleCount;
  const up=document.getElementById('urgentPill');
  if(urgentList.length){up.textContent=`마감임박 ${urgentList.length}건`;up.style.display='';}
  else up.style.display='none';

  if(!all.length && !closedFilter){
    document.getElementById('mainList').innerHTML='<div class="empty"><strong>매칭 공고 없음</strong><p>키워드를 다시 선택하거나 검색어를 변경해보세요.</p></div>';
    return;
  }

  let html='';

  // 마감공고 모드일 때는 진행중 공고 숨김
  if(!closedFilter){
    const allSorted=urgentFilter
      ? [...urgentList]
      : [...activeList, ...urgentList];
    if(!urgentFilter && sortBy==='dday') allSorted.sort(sortByDday);

    if(allSorted.length){
      const totalPages=Math.ceil(allSorted.length/PAGE_SIZE);
      if(currentPage>totalPages)currentPage=1;
      const paged=allSorted.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);
      const sectionLabel=urgentFilter?'마감임박 — D-7 이내':'진행중 공고';
      const sectionDot=urgentFilter?'dot-red':'dot-gray';
      html+=`<div class="section-head"><span class="section-dot ${sectionDot}"></span><span class="section-lbl">${sectionLabel}</span><span class="section-line"></span></div>`;
      html+=`<div class="job-grid">${paged.map((j,i)=>cardHtml(j,i,false)).join('')}</div>`;
      html+=renderPagination(currentPage, totalPages, 'goMainPage');
    } else {
      html='<div class="empty"><strong>매칭 공고 없음</strong><p>키워드를 다시 선택하거나 검색어를 변경해보세요.</p></div>';
    }
  }

  // 마감공고
  if(closedFilter){
    if(expiredAll.length){
      const totalPages=Math.ceil(expiredAll.length/PAGE_SIZE);
      if(currentPage>totalPages)currentPage=1;
      const paged=expiredAll.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);
      html+=`<div class="section-head"><span class="section-dot dot-gray"></span><span class="section-lbl">마감 공고 — ${expiredAll.length}건</span><span class="section-line"></span></div>`;
      html+=`<div class="job-grid">${paged.map((j,i)=>cardHtml(j,i,true)).join('')}</div>`;
      html+=renderPagination(currentPage, totalPages, 'goMainPage');
    } else {
      html='<div class="empty"><strong>마감 공고 없음</strong></div>';
    }
  }

  document.getElementById('mainList').innerHTML=html;
  // min-height 해제 (다음 프레임에서 자연스럽게 높이 변경)
  requestAnimationFrame(()=>{ if(mainListEl) mainListEl.style.minHeight=''; });

  // 잡코리아 출처 배지 표시 (가이드 필수)
  const jkBadge = document.getElementById('jkSourceBadge');
  if (jkBadge) {
    const hasJkJobs = jkEnabled && JK_JOBS.length > 0;
    if (hasJkJobs) {
      jkBadge.style.display = '';
      jkBadge.innerHTML = '<div class="jk-source-badge"><a href="https://www.jobkorea.co.kr" target="_blank" rel="noopener">잡코리아 채용정보 더보기</a></div>';
    } else {
      jkBadge.style.display = 'none';
    }
  }
}

function toggleClosedFilter(){
  closedFilter=!closedFilter;
  if(closedFilter) urgentFilter=false;
  currentPage=1;
  render();
}

function toggleUrgentFilter(){
  urgentFilter=!urgentFilter;
  if(urgentFilter) closedFilter=false;
  currentPage=1;
  render();
}

// 마감 포함 필터링 (ALL_JOBS 기준)
function getFilteredAll(){
  const fj=document.getElementById('fj').value;
  const fi=document.getElementById('fi').value;
  const fs=document.getElementById('fs').value;
  const floc=document.getElementById('floc').value;
  const ft=document.getElementById('ft').value;
  const fexp=document.getElementById('fexp').value;
  return ALL_JOBS.filter(j=>{
    if(!matchesGlobal(j))return false;
    if(!matchesKw(j))return false;
    if(fj&&j.role!==fj)return false;
    if(fi&&j.industry!==fi)return false;
    if(fs&&j.scale!==fs)return false;
    if(floc&&j.location!==floc)return false;
    if(ft&&j.jobType!==ft)return false;
    if(fexp){const b=expBadge(j.experience);if(fexp==='경력'){if(b!=='경력')return false;}else{if(b!==fexp)return false;}}
    return true;
  });
}

/* ── 공고 관리 탭 + 검색 ── */
function setJmTab(tab){
  jmTabFilter=tab;
  jmPage=1;
  document.querySelectorAll('.jm-tab').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.tab===tab);
  });
  renderCustomJobList();
}

/* ── 필터 접기/펼치기 ── */
function toggleFilter(){
  const inlineBtn=document.getElementById('filterInlineBtn');
  const col=document.getElementById('filterCollapsible');
  const isOpen=!col.classList.contains('collapsed');
  col.classList.toggle('collapsed',isOpen);
  if(inlineBtn)inlineBtn.classList.toggle('open',!isOpen);
}

/* ── 관리자 ── */
let dynamicApis=load(SK.DYN_APIS,[
  {key:'saramin',name:'사람인 API',value:apiKeys.saramin||''},
  {key:'worknet',name:'워크넷 API',value:apiKeys.worknet||''},
]);
let tempKws=[];

function openLogin(){
  document.getElementById('pwIn').value='';
  document.getElementById('pwErr').style.display='none';
  document.getElementById('loginModal').classList.add('open');
  setTimeout(()=>document.getElementById('pwIn').focus(),100);
}
function closeLogin(){document.getElementById('loginModal').classList.remove('open');}
function tryLogin(){
  const pw=document.getElementById('pwIn').value;
  if(pw===CONFIG.superPassword){
    closeLogin();
    isSuperMode=true;
    openAdmin();
  } else if(pw===CONFIG.adminPassword){
    closeLogin();
    isSuperMode=false;
    openAdmin();
  } else {
    document.getElementById('pwErr').style.display='block';
    document.getElementById('pwIn').select();
  }
}
function openAdmin(){
  const tabApi  = document.getElementById('tabApi');
  const tabKw   = document.getElementById('tabKw');
  const tabJobs = document.getElementById('tabJobs');
  const tabFb   = document.getElementById('tabFb');
  if(isSuperMode){
    // 슈퍼모드: API 탭만
    if(tabApi)  tabApi.style.display  = '';
    if(tabKw)   tabKw.style.display   = 'none';
    if(tabJobs) tabJobs.style.display = 'none';
    if(tabFb)   tabFb.style.display   = 'none';
    switchAdminTab('api');
  } else {
    // 일반 관리자: 키워드/공고/피드백만
    if(tabApi)  tabApi.style.display  = 'none';
    if(tabKw)   tabKw.style.display   = '';
    if(tabJobs) tabJobs.style.display = '';
    if(tabFb)   tabFb.style.display   = '';
    switchAdminTab('kw');
  }
  document.getElementById('adminModal').classList.add('open');
}
function closeAdmin(){document.getElementById('adminModal').classList.remove('open');isSuperMode=false;}

function switchAdminTab(tab){
  // jk 패널은 이제 adminPanelApi 안에 내장되어 있으므로 독립 패널 없이 처리
  ['api','kw','jobs','fb'].forEach(t=>{
    const tabEl  = document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1));
    const panelEl = document.getElementById('adminPanel'+t.charAt(0).toUpperCase()+t.slice(1));
    if(tabEl)  tabEl.classList.toggle('active', t===tab);
    if(panelEl) panelEl.style.display = t===tab ? '' : 'none';
  });
  // 더미 tabJk active 해제
  const jkTabEl = document.getElementById('tabJk');
  if(jkTabEl) jkTabEl.classList.remove('active');
  if(tab==='api'){ renderApiList(); }
  if(tab==='kw') renderKwAdmin();
  if(tab==='fb') loadFeedbackList();
}

function renderApiList(){
  document.getElementById('apiList').innerHTML=dynamicApis.map((api,i)=>`
    <div class="api-item">
      <div class="api-item-head">
        <span class="sdot ${api.value?'live':''}"></span>
        <span class="sname">${api.name}</span>
        <span class="sstatus">${api.value?'연동됨':'미연동'}</span>
        <button class="api-item-del" onclick="removeApiEntry(${i})">×</button>
      </div>
      <div class="krow"><input type="text" id="apiVal_${i}" value="${api.value}" placeholder="API Key 입력"></div>
    </div>`).join('');
  document.getElementById('newApiName').value='';
  document.getElementById('newApiKey').value='';
  document.getElementById('apiAddErr').style.display='none';
}
function addApiEntry(){
  const name=document.getElementById('newApiName').value.trim();
  const key=document.getElementById('newApiKey').value.trim();
  if(!name||!key){document.getElementById('apiAddErr').style.display='block';return;}
  document.getElementById('apiAddErr').style.display='none';
  dynamicApis.push({key:name.replace(/\s+/g,'_').toLowerCase()+'_'+Date.now(),name,value:key});
  renderApiList();
}
function removeApiEntry(i){dynamicApis.splice(i,1);renderApiList();}
function saveKeys(){
  dynamicApis.forEach((api,i)=>{const el=document.getElementById('apiVal_'+i);if(el)api.value=el.value.trim();});
  apiKeys={};
  dynamicApis.forEach(api=>{apiKeys[api.key]=api.value;});
  save(SK.API_KEYS,apiKeys);save(SK.DYN_APIS,dynamicApis);
  closeAdmin();render();
}

function renderKwAdmin(){
  tempKws=[...KWS];refreshKwAdminTags();
  document.getElementById('newKwInput').value='';
  document.getElementById('kwAddErr').style.display='none';
}
function refreshKwAdminTags(){
  document.getElementById('kwAdminTags').innerHTML=tempKws.map((k,i)=>
    `<span class="kw-admin-tag">${k}<button onclick="removeTempKw(${i})">×</button></span>`
  ).join('')||'<span style="font-size:13px;color:var(--text-hint)">키워드가 없습니다.</span>';
}
function addKeyword(){
  const val=document.getElementById('newKwInput').value.trim();
  if(!val){document.getElementById('kwAddErr').style.display='block';return;}
  document.getElementById('kwAddErr').style.display='none';
  if(!tempKws.includes(val))tempKws.push(val);
  document.getElementById('newKwInput').value='';
  refreshKwAdminTags();
}
function removeTempKw(i){tempKws.splice(i,1);refreshKwAdminTags();}
function saveKeywords(){
  KWS=[...tempKws];save(SK.KWS,KWS);
  selKw.forEach(k=>{if(!KWS.includes(k))selKw.delete(k);});
  save(SK.SEL_KW,[...selKw]);
  closeAdmin();initKwTags();render();
}

/* 공고 등록 */
let editingJobIdx=null;
function formatSalaryInput(el){
  const raw=el.value.replace(/[^0-9]/g,'');
  el.value=raw?Number(raw).toLocaleString('ko-KR'):'';
  updateSalaryPreview();
}
function getSalaryRaw(id){return parseInt((document.getElementById(id).value||'').replace(/,/g,''),10)||0;}
function onSalaryTypeChange(){
  const type=document.querySelector('input[name="salaryType"]:checked').value;
  const tilde=document.getElementById('salaryTilde');
  const toWrap=document.getElementById('salaryToWrap');
  const fields=document.getElementById('salaryFields');
  const fromInput=document.getElementById('jSalaryFrom');
  if(type==='negotiable'){fields.style.display='none';}
  else{
    fields.style.display='flex';
    toWrap.style.display=(type==='range')?'flex':'none';
    tilde.style.display=(type==='range')?'':'none';
    fromInput.placeholder=type==='above'?'금액':type==='below'?'금액':'금액';
  }
  updateSalaryPreview();
}
function updateSalaryPreview(){
  const type=document.querySelector('input[name="salaryType"]:checked')?.value;
  const preview=document.getElementById('salaryPreview');
  if(!preview)return;
  if(type==='negotiable'){preview.textContent='💬 연봉 협의';return;}
  const from=getSalaryRaw('jSalaryFrom'),to=getSalaryRaw('jSalaryTo');
  const fmt=n=>n.toLocaleString('ko-KR');
  let text='';
  if(type==='range'&&from&&to)text=`${fmt(from)}~${fmt(to)}만원`;
  else if(type==='above'&&from)text=`${fmt(from)}만원 이상`;
  else if(type==='below'&&from)text=`${fmt(from)}만원 이하`;
  else if(type==='fixed'&&from)text=`${fmt(from)}만원`;
  preview.textContent=text?`💰 ${text}`:'';
}
function buildSalaryString(){
  const type=document.querySelector('input[name="salaryType"]:checked').value;
  if(type==='negotiable')return'협의';
  const from=getSalaryRaw('jSalaryFrom'),to=getSalaryRaw('jSalaryTo');
  const fmt=n=>n.toLocaleString('ko-KR');
  if(type==='range'&&from&&to)return`${fmt(from)}~${fmt(to)}만원`;
  if(type==='above'&&from)return`${fmt(from)}만원 이상`;
  if(type==='below'&&from)return`${fmt(from)}만원 이하`;
  if(type==='fixed'&&from)return`${fmt(from)}만원`;
  return'협의';
}
function buildSalaryMinMax(){
  const type=document.querySelector('input[name="salaryType"]:checked').value;
  if(type==='negotiable')return{min:0,max:0};
  const from=getSalaryRaw('jSalaryFrom'),to=getSalaryRaw('jSalaryTo');
  if(type==='range')return{min:from,max:to};
  if(type==='above')return{min:from,max:9999};
  if(type==='below')return{min:0,max:from};
  if(type==='fixed')return{min:from,max:from};
  return{min:0,max:0};
}
function onDeadlineTypeChange(){
  const type=document.getElementById('jDeadlineType').value;
  const di=document.getElementById('jDeadline');
  if(type==='always'||type==='untilFilled'){di.disabled=true;di.style.opacity='0.35';di.value='';}
  else{di.disabled=false;di.style.opacity='';if(!di.value){const d=new Date();d.setDate(d.getDate()+30);di.value=d.toISOString().slice(0,10);}}
}
function toggleJobClosed(i){
  const job={...CUSTOM_JOBS[i],closed:!CUSTOM_JOBS[i].closed};
  window._fb?.save(job);
  // 낙관적 업데이트 (Firestore 구독이 곧 반영)
  CUSTOM_JOBS[i].closed=job.closed;
  rebuildJobs();renderCustomJobList();render();
}
function validateUrlInput(el){const v=el.value.trim();el.style.borderColor=(v&&!isValidUrl(v))?'var(--red)':'';}
function isValidUrl(s){try{const u=new URL(s);return u.protocol==='http:'||u.protocol==='https:';}catch{return false;}}
function resetJobForm(){
  ['jTitle','jCompany','jLocation','jIndustry','jRole','jUrl','jDesc','jSalaryFrom','jSalaryTo','jRequirements'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const salType=document.querySelector('input[name="salaryType"][value="range"]');
  if(salType){salType.checked=true;onSalaryTypeChange();}
  const d=new Date();d.setDate(d.getDate()+30);
  const dlEl=document.getElementById('jDeadline');if(dlEl)dlEl.value=d.toISOString().slice(0,10);
  const dlType=document.getElementById('jDeadlineType');if(dlType){dlType.value='date';onDeadlineTypeChange();}
  const jt=document.getElementById('jJobType');if(jt)jt.value='정규직';
  const jexp=document.getElementById('jExperience');if(jexp)jexp.value='';
  const jedu=document.getElementById('jEducation');if(jedu)jedu.value='';
  const jSrcEl=document.getElementById('jSrc');if(jSrcEl)jSrcEl.value='custom';
  const js=document.getElementById('jScale');if(js)js.value='large';
  const ju=document.getElementById('jUrl');if(ju)ju.style.borderColor='';
  const je=document.getElementById('jobAddErr');if(je)je.style.display='none';
  editingJobIdx=null;
}
function renderCustomJobList(){
  const grid=document.getElementById('jobCardList');
  const empty=document.getElementById('jobCardEmpty');
  const countRow=document.getElementById('jmCountRow');
  const countLabel=document.getElementById('jmCountLabel');
  if(!grid)return;

  // 검색어 + 탭 필터 적용
  const q=(document.getElementById('jmSearch')?.value||'').trim().toLowerCase();
  const tab=jmTabFilter||'all';

  const filtered=CUSTOM_JOBS.map((j,i)=>({j,i})).filter(({j})=>{
    // 탭 필터
    const isSpecial=j.deadlineType==='always'||j.deadlineType==='untilFilled';
    const expired=!isSpecial&&dday(j.deadline)<0;
    const isClosed=j.closed||expired;
    if(tab==='active'&&isClosed)return false;
    if(tab==='closed'&&!isClosed)return false;
    // 검색 필터
    if(q){
      const txt=`${j.title} ${j.company} ${j.role||''} ${j.industry||''} ${j.location||''}`.toLowerCase();
      if(!txt.includes(q))return false;
    }
    return true;
  });

  if(!CUSTOM_JOBS.length){
    grid.innerHTML='';
    if(empty)empty.style.display='';
    if(countRow)countRow.style.display='none';
    return;
  }
  if(empty)empty.style.display='none';
  if(countRow)countRow.style.display='';
  const totalLabel=tab==='all'?`직접 등록 공고 <strong>${CUSTOM_JOBS.length}개</strong>`:
    tab==='active'?`진행중 공고 <strong>${filtered.length}개</strong>`:
    `마감 공고 <strong>${filtered.length}개</strong>`;
  if(countLabel)countLabel.innerHTML=totalLabel;
  updateBulkBar();

  if(!filtered.length){
    grid.innerHTML=`<div class="jm-empty" style="padding:3rem 1rem"><strong style="color:var(--text-secondary)">${q?'검색 결과가 없습니다':'해당 공고가 없습니다'}</strong></div>`;
    return;
  }

  // 페이지네이션
  const totalPages=Math.ceil(filtered.length/PAGE_SIZE);
  if(jmPage>totalPages)jmPage=1;
  const paged=filtered.slice((jmPage-1)*PAGE_SIZE, jmPage*PAGE_SIZE);

  grid.innerHTML=paged.map(({j,i})=>{
    const cs=compStyle(j.scale);
    const isAlways=j.deadlineType==='always';
    const isUntil=j.deadlineType==='untilFilled';
    const d=(isAlways||isUntil)?999:dday(j.deadline);
    const urg=!isAlways&&!isUntil&&d<=7;
    const expired=!isAlways&&!isUntil&&d<0;
    let ddayBadge='';
    if(isAlways)ddayBadge=`<span class="jm-badge navy">상시채용</span>`;
    else if(isUntil)ddayBadge=`<span class="jm-badge navy">채용시 마감</span>`;
    else if(expired)ddayBadge=`<span class="jm-badge closed">만료 (${j.deadline})</span>`;
    else ddayBadge=`<span class="jm-badge ${urg?'urgent':''}">D-${d} (${j.deadline})</span>`;
    return `<div class="jm-jcard ${j.closed||expired?'closed-job':''} select-mode" data-idx="${i}" style="animation-delay:${paged.indexOf(paged.find(f=>f.i===i))*0.03}s">
      <div class="jm-jcard-top">
        <div class="jm-jcard-left">
          <div class="jm-jcard-icon" style="background:${cs.bg};color:${cs.color}">${cs.icon}</div>
          <div class="jm-jcard-info">
            <div class="jm-jcard-title">${j.title}</div>
            <div class="jm-jcard-company">${j.company}${j.location!=='미정'?' · '+j.location:''}${j.role!=='미정'?' · '+j.role:''}</div>
          </div>
        </div>
        <div class="jm-jcard-actions">
          ${j.deadlineType==='untilFilled'?`<button class="btn-jm-close ${j.closed?'closed':''}" onclick="toggleJobClosed(${i})">${j.closed?'✓ 마감됨':'마감처리'}</button>`:''}
          <button class="btn-jm-edit" onclick="openJobForm(${i})">✏ 수정</button>
          <input type="checkbox" class="jm-card-check" data-idx="${i}" onchange="onCardCheck(this)" title="선택">
        </div>
      </div>
      <div class="jm-jcard-meta">
        <span class="jm-badge">${j.scaleName}</span>
        <span class="jm-badge">${j.jobType}</span>
        ${j.experience?`<span class="jm-badge">${j.experience}</span>`:''}
        ${j.education?`<span class="jm-badge">${eduBadge(j.education)||j.education}</span>`:''}
        ${j.salary&&j.salary!=='협의'?`<span class="jm-badge">💰 ${j.salary}</span>`:''}
        <span class="jm-badge">${j.industry!=='미정'?j.industry:'업종 미정'}</span>
        ${ddayBadge}
        ${j.closed?'<span class="jm-badge closed">수동 마감</span>':''}
      </div>
    </div>`;
  }).join('')+renderPagination(jmPage, totalPages, 'goJmPage');
}

/* ── 일괄 선택/삭제 ── */
function getCheckedIdxs(){
  return [...document.querySelectorAll('.jm-card-check:checked')].map(el=>parseInt(el.dataset.idx));
}
function updateBulkBar(){
  const checked=getCheckedIdxs();
  const total=CUSTOM_JOBS.length;
  const allChecked=checked.length===total&&total>0;
  const allCheckEl=document.getElementById('jmCheckAll');
  const numEl=document.getElementById('jmSelectedNum');
  const delBtn=document.getElementById('jmBulkDelBtn');
  if(allCheckEl){allCheckEl.checked=allChecked;allCheckEl.indeterminate=checked.length>0&&!allChecked;}
  if(numEl)numEl.textContent=checked.length;
  if(delBtn)delBtn.disabled=checked.length===0;
}
function onCardCheck(cb){
  const card=cb.closest('.jm-jcard');
  if(card)card.classList.toggle('selected',cb.checked);
  updateBulkBar();
}
function toggleSelectAll(checked){
  document.querySelectorAll('.jm-card-check').forEach(cb=>{
    cb.checked=checked;
    const card=cb.closest('.jm-jcard');
    if(card)card.classList.toggle('selected',checked);
  });
  updateBulkBar();
}
async function deleteSelected(){
  const idxs=getCheckedIdxs();
  if(!idxs.length)return;
  if(!confirm(`선택한 공고 ${idxs.length}개를 삭제하시겠습니까?`))return;
  const jobIds=idxs.map(i=>CUSTOM_JOBS[i].id);
  await Promise.all(jobIds.map(id=>window._fb?.delete(id)));
  // onSnapshot이 자동 갱신
}

function openJobManager(){
  closeAdmin();
  document.getElementById('jobManagerOverlay').classList.add('open');
  document.body.style.overflow='hidden';
  renderCustomJobList();
}
function closeJobManager(){
  document.getElementById('jobManagerOverlay').classList.remove('open');
  document.body.style.overflow='';
  closeJobForm();
}
function openJobForm(idx){
  const form=document.getElementById('jobInlineForm');
  editingJobIdx=idx;
  if(idx===null){
    resetJobForm();
    document.getElementById('jobFormLabel').textContent='새 공고 등록';
    document.getElementById('jobSubmitBtn').textContent='공고 등록';
  } else {
    startEditJob(idx);
    document.getElementById('jobFormLabel').textContent='공고 수정';
    document.getElementById('jobSubmitBtn').textContent='수정 저장';
  }
  form.classList.remove('collapsed');
  setTimeout(()=>form.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
function closeJobForm(){
  const form=document.getElementById('jobInlineForm');
  if(form)form.classList.add('collapsed');
  resetJobForm();
}
function startEditJob(i){
  const j=CUSTOM_JOBS[i];
  document.getElementById('jTitle').value=j.title;
  document.getElementById('jCompany').value=j.company;
  document.getElementById('jLocation').value=j.location!=='미정'?j.location:'';
  document.getElementById('jIndustry').value=j.industry!=='미정'?j.industry:'';
  document.getElementById('jRole').value=j.role!=='미정'?j.role:'';
  document.getElementById('jUrl').value=j.url;
  const jSrcEl=document.getElementById('jSrc');if(jSrcEl)jSrcEl.value=j.src||'custom';
  document.getElementById('jDesc').value=j.desc||'';
  const jreq=document.getElementById('jRequirements');if(jreq)jreq.value=j.requirements||'';
  document.getElementById('jDeadlineType').value=j.deadlineType||'date';
  document.getElementById('jDeadline').value=j.deadline;
  onDeadlineTypeChange();
  document.getElementById('jJobType').value=j.jobType;
  document.getElementById('jExperience').value=j.experience||'';
  document.getElementById('jEducation').value=j.education||'';
  document.getElementById('jScale').value=j.scale;
  const sal=j.salary||'협의';
  if(sal==='협의'||sal==='회사내규'){document.querySelector('input[name="salaryType"][value="negotiable"]').checked=true;}
  else if(sal.includes('~')){
    const[a,b]=sal.replace(/만원.*/g,'').split('~').map(s=>s.replace(/,/g,'').trim());
    document.querySelector('input[name="salaryType"][value="range"]').checked=true;
    document.getElementById('jSalaryFrom').value=Number(a).toLocaleString('ko-KR');
    document.getElementById('jSalaryTo').value=Number(b).toLocaleString('ko-KR');
  }else if(sal.includes('이상')){
    document.querySelector('input[name="salaryType"][value="above"]').checked=true;
    document.getElementById('jSalaryFrom').value=Number(sal.replace(/[^0-9]/g,'')).toLocaleString('ko-KR');
  }else if(sal.includes('이하')){
    document.querySelector('input[name="salaryType"][value="below"]').checked=true;
    document.getElementById('jSalaryFrom').value=Number(sal.replace(/[^0-9]/g,'')).toLocaleString('ko-KR');
  }else{
    document.querySelector('input[name="salaryType"][value="fixed"]').checked=true;
    document.getElementById('jSalaryFrom').value=Number(sal.replace(/[^0-9]/g,'')).toLocaleString('ko-KR');
  }
  onSalaryTypeChange();
}
function cancelEditJob(){closeJobForm();}
async function submitCustomJob(){
  const title=document.getElementById('jTitle').value.trim();
  const company=document.getElementById('jCompany').value.trim();
  const url=document.getElementById('jUrl').value.trim();
  const errEl=document.getElementById('jobAddErr');
  if(!title||!company){errEl.textContent='제목과 회사명은 필수입니다.';errEl.style.display='block';return;}
  if(!url){errEl.textContent='지원 URL은 필수입니다.';errEl.style.display='block';return;}
  if(!isValidUrl(url)){errEl.textContent='URL은 https:// 또는 http://로 시작해야 합니다.';errEl.style.display='block';return;}
  errEl.style.display='none';
  const deadlineType=document.getElementById('jDeadlineType').value;
  const scale=document.getElementById('jScale').value;
  const scaleNames={large:'대기업',mid:'중소기업',startup:'스타트업',public:'공공기관'};
  let deadline;
  if(deadlineType==='always')deadline='9999-12-31';
  else if(deadlineType==='untilFilled')deadline='9999-12-30';
  else deadline=document.getElementById('jDeadline').value||(()=>{const d=new Date();d.setDate(d.getDate()+30);return d.toISOString().slice(0,10);})();
  const mm=buildSalaryMinMax();
  const jobData={
    id:editingJobIdx!==null?CUSTOM_JOBS[editingJobIdx].id:'custom_'+Date.now(),
    createdAt:editingJobIdx!==null?(CUSTOM_JOBS[editingJobIdx].createdAt||new Date().toISOString()):new Date().toISOString(),
    title,company,logo:company.slice(0,2),scale,scaleName:scaleNames[scale],
    location:document.getElementById('jLocation').value.trim()||'미정',
    industry:document.getElementById('jIndustry').value.trim()||'미정',
    role:document.getElementById('jRole').value.trim()||'미정',
    jobType:document.getElementById('jJobType').value,
    experience:document.getElementById('jExperience').value,
    education:document.getElementById('jEducation').value,
    salary:buildSalaryString(),salaryMin:mm.min,salaryMax:mm.max,
    deadlineType,deadline,url,
    closed:editingJobIdx!==null?(CUSTOM_JOBS[editingJobIdx].closed||false):false,
    src:document.getElementById('jSrc')?.value||'custom',
    desc:document.getElementById('jDesc').value.trim(),
    requirements:document.getElementById('jRequirements').value.trim()
  };
  const btn=document.getElementById('jobSubmitBtn');
  btn.disabled=true;btn.textContent='저장 중…';
  try{
    await window._fb.save(jobData);
    closeJobForm();
  } catch(e){
    errEl.textContent='저장 중 오류가 발생했습니다. 다시 시도해주세요.';
    errEl.style.display='block';
  } finally{
    btn.disabled=false;
    btn.textContent=editingJobIdx!==null?'수정 저장':'공고 등록';
  }
}
async function removeCustomJob(i){
  if(!confirm('이 공고를 삭제하시겠습니까?'))return;
  if(editingJobIdx===i)resetJobForm();
  const job=CUSTOM_JOBS[i];
  await window._fb?.delete(job.id);
  // onSnapshot이 자동으로 목록 갱신
}

/* ── CSV / Excel 일괄 등록 ── */
const CSV_REQUIRED=['기업명','URL'];
const CSV_COL_MAP={
  '기업명':'company','회사명':'company','company':'company',
  'url':'url','URL':'url','지원링크':'url','링크':'url',
  '공고제목':'title','공고 제목':'title','채용직군':'title','직군':'title','포지션':'title','title':'title',
  '소재지':'location','근무지역':'location','근무 지역':'location','location':'location','지역':'location',
  '서비스 분야':'industry','업종':'industry','industry':'industry','분야':'industry','서비스분야':'industry',
  '채용직군':'role','직무':'role','role':'role','직군':'role',
  '규모':'scale','기업규모':'scale','회사규모':'scale','scale':'scale',
  '채용 마감일':'deadline','마감일':'deadline','deadline':'deadline','마감':'deadline','채용마감일':'deadline',
  '마감여부':'closed','진행여부':'closed','상태':'closed','closed':'closed',
  '필요 기술/우대사항':'desc','필요기술':'desc','우대사항':'desc','desc':'desc','설명':'desc','description':'desc','키워드':'desc',
  '근무형태':'jobType','고용형태':'jobType','jobtype':'jobType','고용 형태':'jobType','근무 형태':'jobType','근무형태':'jobType',
  '경력구분':'experience','경력':'experience','신입경력':'experience','experience':'experience','경력 구분':'experience',
  '신입/경력':'experience','신입경력구분':'experience',
  '학력':'education','학력요건':'education','education':'education','최종학력':'education','학력 조건':'education',
  '연봉':'salary','급여':'salary','salary':'salary','연봉정보':'salary','임금':'salary',
  '출처':'src','source':'src','플랫폼':'src','채용플랫폼':'src',
};

function parseScale(raw){
  if(!raw||raw==='-')return{scale:'startup',scaleName:'스타트업'};
  const n=raw.replace(/[^0-9~]/g,'');
  const nums=n.split('~').map(s=>parseInt(s.replace(/\D/g,''))||0).filter(x=>x>0);
  const max=nums.length?Math.max(...nums):0;
  if(raw.includes('공공')||raw.includes('기관'))return{scale:'public',scaleName:'공공기관'};
  if(max>=1000||raw.includes('대기업'))return{scale:'large',scaleName:'대기업'};
  if(max>=300)return{scale:'large',scaleName:'대기업'};
  if(max>=51)return{scale:'mid',scaleName:'중소기업'};
  if(max>0)return{scale:'startup',scaleName:'스타트업'};
  return{scale:'startup',scaleName:'스타트업'};
}
function parseDeadline(raw){
  if(!raw||raw==='-')return{deadlineType:'date',deadline:(()=>{const d=new Date();d.setDate(d.getDate()+30);return d.toISOString().slice(0,10);})()};
  if(/상시|always/i.test(raw))return{deadlineType:'always',deadline:'9999-12-31'};
  if(/채용시|untilFilled/i.test(raw))return{deadlineType:'untilFilled',deadline:'9999-12-30'};
  const m=raw.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if(m){const dl=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return{deadlineType:'date',deadline:dl};}
  return{deadlineType:'date',deadline:(()=>{const d=new Date();d.setDate(d.getDate()+30);return d.toISOString().slice(0,10);})()};
}
function parseJobType(raw){
  if(!raw)return'정규직';
  if(/인턴|intern/i.test(raw))return'인턴';
  if(/계약|contract/i.test(raw))return'계약직';
  if(/정규|regular/i.test(raw))return'정규직';
  return raw.trim()||'정규직';
}
function parseExperience(raw){
  if(!raw||raw==='-'||raw.trim()==='')return'';
  return raw.trim(); // 원문 그대로 저장
}
// 카드 뱃지용: 신입 계열 → '신입', 경력 계열 → '경력', 무관/혼합 → '신입·경력', 없으면 ''
function expBadge(exp){
  if(!exp)return'';
  if(/신입.*경력|경력.*신입|무관|신입 \/ 경력/i.test(exp))return'신입·경력';
  if(/신입 지원|신입지원|^신입$/i.test(exp))return'신입';
  if(/^신입$/i.test(exp.trim()))return'신입';
  if(/신입/i.test(exp)&&!/경력 [0-9]/i.test(exp))return'신입';
  if(/경력/i.test(exp)&&!/신입/i.test(exp))return'경력';
  return'';
}
// 연봉 파싱: 원문 그대로 저장, 표시용 정규화
function parseSalaryRaw(raw){
  if(!raw||raw==='-'||raw.trim()==='')return'협의';
  const r=raw.trim();
  if(/협의|면접|내규|결정/i.test(r))return'면접 후 결정';
  // 숫자+만원 패턴 정규화 (예: "3,000 만원" → "3,000만원")
  const numMatch=r.replace(/\s+/g,'').match(/^[\d,]+만원$/);
  if(numMatch)return r.replace(/\s+/g,'');
  return r;
}
function eduBadge(edu){
  if(!edu||edu.trim()==='')return'';
  if(/박사/i.test(edu))return'박사 이상';
  if(/석사/i.test(edu))return'석사 이상';
  if(/4년|대학교 졸업|대졸/i.test(edu))return'대졸 이상';
  if(/2년|초대졸/i.test(edu))return'초대졸 이상';
  if(/고등|고졸/i.test(edu))return'고졸 이상';
  if(/무관/i.test(edu))return'학력무관';
  return edu.trim(); // 그 외 원문 그대로
}
function parseSrc(raw){
  if(!raw||raw.trim()==='')return'custom';
  const r=raw.trim().toLowerCase();
  if(/사람인|saramin/i.test(r))return'saramin';
  if(/잡코리아|jobkorea/i.test(r))return'jobkorea';
  if(/원티드|wanted/i.test(r))return'wanted';
  if(/고용24|work24|워크넷|worknet/i.test(r)){
    if(/고용24|work24/i.test(r))return'work24';
    return'worknet';
  }
  if(/기타|etc/i.test(r))return'etc';
  if(/직접등록|custom/i.test(r))return'custom';
  return'custom';
}
function csvRowToJob(row,headerMap){
  const get=key=>{ const col=headerMap[key]; return col!=null?(row[col]||'').trim():''; };
  const company=get('company');
  const url=get('url');
  const rawTitle=get('title');
  const role=get('role')||rawTitle||'미정';
  const title=rawTitle||(role!=='미정'?`${company} ${role} 채용`:`${company} 채용 공고`);
  const {scale,scaleName}=parseScale(get('scale'));
  const {deadlineType,deadline}=parseDeadline(get('deadline'));
  const closedRaw=get('closed');
  const closed=/마감|closed|종료|완료/i.test(closedRaw);
  const desc=get('desc');
  return{
    id:'csv_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    createdAt:new Date().toISOString(),
    title,company,logo:company.slice(0,2),
    scale,scaleName,
    location:get('location')||'미정',
    industry:get('industry')||'미정',
    role,
    jobType:parseJobType(get('jobType')),
    experience:parseExperience(get('experience')),
    education:get('education')||'',
    salary:parseSalaryRaw(get('salary'))||'협의',
    salaryRaw:get('salary')||'',
    salaryMin:0,salaryMax:0,
    deadlineType,deadline,
    closed,
    url,src:parseSrc(get('src')),
    desc,
    requirements:'',
  };
}

function parseCSVText(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length)return null;
  // BOM 제거
  if(lines[0].charCodeAt(0)===0xFEFF)lines[0]=lines[0].slice(1);
  function splitCSVLine(line){
    const result=[];let cur='';let inQ=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
      else if(c===','&&!inQ){result.push(cur.trim());cur='';}
      else cur+=c;
    }
    result.push(cur.trim());
    return result;
  }
  const headers=splitCSVLine(lines[0]);
  return{headers,rows:lines.slice(1).filter(l=>l.trim()).map(l=>splitCSVLine(l))};
}

async function handleJobFileUpload(input){
  const file=input.files[0];
  if(!file){return;}
  input.value=''; // 같은 파일 재업로드 허용
  const ext=file.name.split('.').pop().toLowerCase();
  const resultEl=document.getElementById('jmUploadResult');
  resultEl.style.display='';

  let headers=[], dataRows=[];

  if(ext==='csv'){
    const text=await file.text();
    const parsed=parseCSVText(text);
    if(!parsed){showUploadResult('error','파일을 읽을 수 없습니다.');return;}
    headers=parsed.headers;
    dataRows=parsed.rows;
  } else {
    showUploadResult('error','현재 CSV 파일만 지원합니다. (.csv)');return;
  }

  // 헤더 정규화 및 매핑
  const headerMap={};
  headers.forEach((h,i)=>{
    const normalized=h.trim();
    const key=CSV_COL_MAP[normalized]||CSV_COL_MAP[normalized.toLowerCase()]||CSV_COL_MAP[normalized.replace(/\s+/g,'')]||CSV_COL_MAP[normalized.toLowerCase().replace(/\s+/g,'')];
    if(key&&headerMap[key]==null)headerMap[key]=i;
  });

  // 필수 항목 체크
  const missing=CSV_REQUIRED.map(r=>CSV_COL_MAP[r]||r).filter(r=>headerMap[r]==null);
  if(missing.length){
    const missingLabels={'company':'기업명','url':'URL'};
    showUploadResult('error',`<strong>업로드 불가</strong> — 필수 열이 없습니다: <b>${missing.map(m=>missingLabels[m]||m).join(', ')}</b><br>파일의 첫 번째 행에 <b>기업명</b>과 <b>URL</b> 열이 있어야 합니다.`);
    return;
  }

  // 행 파싱
  let added=0, skipped=0, skippedReasons=[];
  const newJobs=[];
  dataRows.forEach((row,i)=>{
    if(row.every(c=>!c.trim()))return;
    const company=(row[headerMap['company']]||'').trim();
    const url=(row[headerMap['url']]||'').trim();
    if(!company){skipped++;skippedReasons.push(`${i+2}행: 기업명 없음`);return;}
    if(!url||!/^https?:\/\//i.test(url)){skipped++;skippedReasons.push(`${i+2}행 (${company}): URL 형식 오류`);return;}
    newJobs.push(csvRowToJob(row,headerMap));
    added++;
  });

  if(added===0&&skipped===0){showUploadResult('warn','데이터 행이 없습니다.');return;}

  showUploadResult('warn','<strong>⏳ Firestore에 저장 중…</strong>');
  try{
    await window._fb.saveAll(newJobs);
    let msg=`<strong>✅ ${added}개 공고 등록 완료</strong>`;
    if(skipped){
      msg+=`&nbsp;&nbsp;·&nbsp;&nbsp;<span style="opacity:0.8">${skipped}개 건너뜀</span>`;
      if(skippedReasons.length){msg+=`<ul>${skippedReasons.slice(0,5).map(r=>`<li>${r}</li>`).join('')}${skippedReasons.length>5?`<li>... 외 ${skippedReasons.length-5}건</li>`:''}</ul>`;}
    }
    showUploadResult(skipped?'warn':'success',msg);
  } catch(e){
    showUploadResult('error','<strong>저장 중 오류가 발생했습니다.</strong> 네트워크를 확인해주세요.');
  }
}

function showUploadResult(type,html){
  const el=document.getElementById('jmUploadResult');
  el.className='jm-upload-result '+type;
  el.innerHTML=html;
  el.style.display='';
  setTimeout(()=>{el.style.transition='opacity 0.5s';el.style.opacity='0';setTimeout(()=>{el.style.display='none';el.style.opacity='';el.style.transition='';},500);},6000);
}


let _md=false;
['loginModal','adminModal','feedbackModal','noticeViewerModal'].forEach(id=>{
  const el=document.getElementById(id);
  el.addEventListener('mousedown',function(e){_md=(e.target===this);});
  el.addEventListener('click',function(e){
    if(e.target===this&&_md){
      if(id==='loginModal')closeLogin();
      else if(id==='adminModal')closeAdmin();
      else if(id==='feedbackModal')closeFeedback();
      else if(id==='noticeViewerModal')closeNoticeViewer();
    }
    _md=false;
  });
});

async function resetAllData(){
  if(!confirm('저장된 키워드, API 키를 초기화하시겠습니까?\n(Firestore 공고 데이터는 유지됩니다)'))return;
  Object.values(SK).forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
  KWS=[...DEFAULT_KWS];selKw.clear();matchMode='any';
  apiKeys={...CONFIG.apiKeys};
  dynamicApis=[{key:'saramin',name:'사람인 API',value:''},{key:'worknet',name:'워크넷 API',value:''}];
  closeAdmin();initKwTags();initDropdowns();render();
  alert('초기화 완료되었습니다.');
}

/* ── 피드백 ── */
function openFeedback(){
  document.getElementById('feedbackText').value='';
  document.getElementById('feedbackErr').style.display='none';
  document.getElementById('feedbackSubmitBtn').disabled=false;
  document.getElementById('feedbackSubmitBtn').textContent='전송하기';
  document.getElementById('feedbackModal').classList.add('open');
  setTimeout(()=>document.getElementById('feedbackText').focus(),100);
}
function closeFeedback(){
  document.getElementById('feedbackModal').classList.remove('open');
}
async function submitFeedback(){
  const text=document.getElementById('feedbackText').value.trim();
  const errEl=document.getElementById('feedbackErr');
  if(!text){errEl.style.display='block';return;}
  errEl.style.display='none';
  const btn=document.getElementById('feedbackSubmitBtn');
  btn.disabled=true;btn.textContent='전송 중…';
  try{
    await window._fb.saveFeedback(text);
    btn.textContent='✅ 전송 완료!';
    setTimeout(()=>closeFeedback(),1200);
  }catch(e){
    errEl.textContent='전송 중 오류가 발생했습니다. 다시 시도해주세요.';
    errEl.style.display='block';
    btn.disabled=false;btn.textContent='전송하기';
  }
}
async function loadFeedbackList(){
  const listEl=document.getElementById('fbList');
  listEl.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-hint);font-size:13px">불러오는 중…</div>';
  try{
    const fbs=await window._fb.getFeedbacks();
    if(!fbs.length){
      listEl.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-hint);font-size:13px">아직 피드백이 없습니다.</div>';
      return;
    }
    listEl.innerHTML=fbs.map(f=>{
      const dt=new Date(f.createdAt);
      const dateStr=`${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
      return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px">
        <div style="font-size:13px;color:var(--text-primary);line-height:1.7;white-space:pre-wrap">${f.text.replace(/</g,'&lt;')}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
          <span style="font-size:11px;color:var(--text-hint)">${dateStr}</span>
          <button onclick="deleteFeedbackItem('${f.id}')" style="font-size:11px;background:none;border:none;cursor:pointer;color:var(--text-hint);padding:2px 6px;border-radius:4px;transition:color 0.15s" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-hint)'">삭제</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    listEl.innerHTML='<div style="text-align:center;padding:2rem;color:var(--red);font-size:13px">불러오기 실패. 다시 시도해주세요.</div>';
  }
}
async function deleteFeedbackItem(id){
  if(!confirm('이 피드백을 삭제하시겠습니까?'))return;
  try{
    await window._fb.deleteFeedback(id);
    loadFeedbackList();
  }catch(e){alert('삭제 중 오류가 발생했습니다.');}
}

/* ── 공지사항 ── */
let _editingNoticeId=null;
let _noticeFiles=[]; // {name, dataUrl, type}
const NOTICE_SEEN_KEY='ajs_notice_seen';

function onNoticeTypeChange(){
  const isUrg=document.getElementById('nTypeUrg').checked;
  document.getElementById('nTypeAnLabel').style.borderColor=isUrg?'var(--border)':'var(--navy-light)';
  document.getElementById('nTypeAnLabel').style.background=isUrg?'':'var(--navy-muted)';
  document.getElementById('nTypeUrgLabel').style.borderColor=isUrg?'var(--red)':'var(--border)';
  document.getElementById('nTypeUrgLabel').style.background=isUrg?'rgba(184,64,64,0.08)':'';
}
function updateNoticeCharCount(){
  const len=document.getElementById('nContent').value.length;
  const el=document.getElementById('nCharCount');
  el.textContent=`${len} / 1000`;
  el.style.color=len>900?'var(--red)':'var(--text-hint)';
}
function onNoticeFileSelect(input){
  const files=Array.from(input.files);
  files.forEach(file=>{
    if(_noticeFiles.length>=5){alert('파일은 최대 5개까지 첨부할 수 있습니다.');return;}
    const reader=new FileReader();
    reader.onload=e=>{
      _noticeFiles.push({name:file.name,dataUrl:e.target.result,type:file.type});
      renderNoticeFileList();
    };
    reader.readAsDataURL(file);
  });
  input.value='';
}
function renderNoticeFileList(){
  const el=document.getElementById('nFileList');
  el.innerHTML=_noticeFiles.map((f,i)=>`
    <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px">
      <span>${f.type.startsWith('image/')?'🖼️':'📄'}</span>
      <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)">${f.name}</span>
      <button onclick="_noticeFiles.splice(${i},1);renderNoticeFileList()" style="background:none;border:none;cursor:pointer;color:var(--text-hint);font-size:14px;line-height:1;padding:0 2px">×</button>
    </div>`).join('');
}

function initNoticeSubscription(){
  if(!window._fb)return;
  window._fb.subscribeNotices((notices)=>{
    const published=notices.filter(n=>n.published);
    if(!published.length){document.getElementById('noticeDot').style.display='none';return;}
    const latestId=published[0].id;
    const seen=load(NOTICE_SEEN_KEY,'');
    document.getElementById('noticeDot').style.display=(seen!==latestId)?'':'none';
  });
}

function openNoticeViewer(){
  document.getElementById('noticeViewerModal').classList.add('open');
  loadNoticeViewerList();
}
function closeNoticeViewer(){
  document.getElementById('noticeViewerModal').classList.remove('open');
}

async function loadNoticeViewerList(){
  const el=document.getElementById('noticeViewerList');
  el.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-hint);font-size:13px">불러오는 중…</div>';
  try{
    const notices=await window._fb.getNotices();
    const published=notices.filter(n=>n.published);
    if(!published.length){el.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-hint);font-size:13px">등록된 공지사항이 없습니다.</div>';return;}
    save(NOTICE_SEEN_KEY,published[0].id);
    document.getElementById('noticeDot').style.display='none';
    el.innerHTML=published.map(n=>{
      const isUrg=n.noticeType==='긴급';
      const dt=new Date(n.createdAt);
      const dateStr=`${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`;
      const preview=n.content.replace(/\n/g,' ').trim();
      const short=preview.length>55?preview.slice(0,55)+'…':preview;
      return `<div onclick="openNoticeDetail('${n.id}')" style="cursor:pointer;border-radius:var(--radius-md);padding:14px 16px;background:var(--bg-surface);transition:background 0.15s,box-shadow 0.15s;border:1px solid ${isUrg?'rgba(184,64,64,0.25)':'var(--border)'}" onmouseover="this.style.background='var(--bg-card)';this.style.boxShadow='var(--shadow-hover)'" onmouseout="this.style.background='var(--bg-surface)';this.style.boxShadow='none'">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;letter-spacing:0.3px;${isUrg?'background:rgba(184,64,64,0.12);color:var(--red)':'background:var(--navy-muted);color:var(--navy-text)'}">${isUrg?'긴급':'안내'}</span>
          <span style="font-size:14px;font-weight:600;color:${isUrg?'var(--red)':'var(--text-primary)'};flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.title.replace(/</g,'&lt;')}</span>
          <span style="font-size:11px;color:var(--text-hint);flex-shrink:0">${dateStr}</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);padding-left:2px">${short.replace(/</g,'&lt;')}</div>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="text-align:center;padding:2rem;color:var(--red);font-size:13px">불러오기 실패.</div>';}
}

let _noticeDetailCache=[];
async function openNoticeDetail(id){
  if(!_noticeDetailCache.length){
    const notices=await window._fb.getNotices();
    _noticeDetailCache=notices.filter(n=>n.published);
  }
  const n=_noticeDetailCache.find(x=>x.id===id);
  if(!n)return;
  const isUrg=n.noticeType==='긴급';
  const dt=new Date(n.createdAt);
  const dateStr=`${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`;
  document.getElementById('noticeDetailContent').innerHTML=`
    <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${isUrg?'<span style="font-size:12px;padding:3px 10px;border-radius:20px;background:rgba(184,64,64,0.12);color:var(--red);font-weight:600">🚨 긴급</span>':'<span style="font-size:12px;padding:3px 10px;border-radius:20px;background:var(--navy-muted);color:var(--navy-text)">📢 안내</span>'}
      </div>
      <h2 style="font-size:20px;font-weight:700;color:${isUrg?'var(--red)':'var(--text-primary)'};line-height:1.4;margin-bottom:8px">${n.title.replace(/</g,'&lt;')}</h2>
      <div style="font-size:12px;color:var(--text-hint)">${dateStr}</div>
    </div>
    <div style="font-size:14px;color:var(--text-primary);line-height:1.9;white-space:pre-wrap;margin-bottom:24px">${n.content.replace(/</g,'&lt;')}</div>
    ${n.files&&n.files.length?`
    <div style="border-top:1px solid var(--border);padding-top:16px">
      <div style="font-size:12px;font-weight:500;color:var(--text-hint);margin-bottom:10px">첨부 파일</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${n.files.map(f=>f.type&&f.type.startsWith('image/')?
          `<img src="${f.dataUrl}" alt="${f.name}" style="max-width:100%;border-radius:var(--radius-md);border:1px solid var(--border)">`:
          `<a href="${f.dataUrl}" download="${f.name}" style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--border);border-radius:var(--radius-md);font-size:13px;color:var(--text-primary);text-decoration:none;background:var(--bg-surface)">📄 ${f.name}</a>`
        ).join('')}
      </div>
    </div>`:''}
  `;
  document.getElementById('noticeDetailOverlay').style.display='flex';
  document.getElementById('noticeDetailOverlay').style.flexDirection='column';
}
function closeNoticeDetail(){
  document.getElementById('noticeDetailOverlay').style.display='none';
  _noticeDetailCache=[];
}

function openNoticeManager(){
  closeAdmin();
  document.getElementById('noticeManagerOverlay').classList.add('open');
  document.body.style.overflow='hidden';
  loadNoticeAdminList();
}
function closeNoticeManager(){
  document.getElementById('noticeManagerOverlay').classList.remove('open');
  document.body.style.overflow='';
  closeNoticeForm();
}
function openNoticeForm(id){
  _editingNoticeId=id;
  _noticeFiles=[];
  renderNoticeFileList();
  const form=document.getElementById('noticeInlineForm');
  if(id===null){
    document.getElementById('nTitle').value='';
    document.getElementById('nContent').value='';
    document.getElementById('nPublish').checked=true;
    document.getElementById('nTypeAn').checked=true;
    updateNoticeCharCount();
    onNoticeTypeChange();
    document.getElementById('noticeFormLabel').textContent='새 공지 작성';
    document.getElementById('noticeSubmitBtn').textContent='등록';
  }
  form.classList.remove('collapsed');
  setTimeout(()=>form.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
function closeNoticeForm(){
  document.getElementById('noticeInlineForm')?.classList.add('collapsed');
  _editingNoticeId=null;
  _noticeFiles=[];
}
async function submitNotice(){
  const title=document.getElementById('nTitle').value.trim();
  const content=document.getElementById('nContent').value.trim();
  const published=document.getElementById('nPublish').checked;
  const noticeType=document.querySelector('input[name="nType"]:checked').value;
  const errEl=document.getElementById('noticeAddErr');
  if(!title||!content){errEl.textContent='제목과 내용을 입력해주세요.';errEl.style.display='block';return;}
  if(content.length>1000){errEl.textContent='내용은 1000자 이내로 입력해주세요.';errEl.style.display='block';return;}
  errEl.style.display='none';
  const btn=document.getElementById('noticeSubmitBtn');
  btn.disabled=true;btn.textContent='저장 중…';
  try{
    const id=_editingNoticeId||('notice_'+Date.now());
    const existing=_editingNoticeId?(await window._fb.getNotices()).find(x=>x.id===id):null;
    await window._fb.saveNotice({
      id,title,content,published,noticeType,
      files:[..._noticeFiles],
      createdAt:existing?.createdAt||new Date().toISOString()
    });
    closeNoticeForm();
    loadNoticeAdminList();
  }catch(e){errEl.textContent='저장 중 오류가 발생했습니다.';errEl.style.display='block';}
  finally{btn.disabled=false;btn.textContent=_editingNoticeId?'수정 저장':'등록';}
}
async function loadNoticeAdminList(){
  const el=document.getElementById('noticeAdminList');
  el.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-hint);font-size:13px">불러오는 중…</div>';
  try{
    const notices=await window._fb.getNotices();
    if(!notices.length){el.innerHTML='<div style="text-align:center;padding:3rem;color:var(--text-hint);font-size:14px">등록된 공지가 없습니다.</div>';return;}
    el.innerHTML=notices.map(n=>{
      const isUrg=n.noticeType==='긴급';
      const dt=new Date(n.createdAt);
      const dateStr=`${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
      return `<div style="background:var(--bg-card);border:1px solid ${isUrg?'rgba(184,64,64,0.3)':'var(--border)'};border-left:3px solid ${isUrg?'var(--red)':'var(--navy)'};border-radius:var(--radius-md);padding:14px 16px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:11px;padding:2px 8px;border-radius:20px;${isUrg?'background:rgba(184,64,64,0.12);color:var(--red)':'background:var(--navy-muted);color:var(--navy-text)'}">${isUrg?'🚨 긴급':'📢 안내'}</span>
            <span style="font-size:14px;font-weight:600;color:${isUrg?'var(--red)':'var(--text-primary)'}">${n.title.replace(/</g,'&lt;')}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:20px;${n.published?'background:#EAF5EE;color:#1A4A2E':'background:var(--bg-surface);color:var(--text-hint)'}">${n.published?'게시중':'미게시'}</span>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button onclick="editNotice('${n.id}')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:none;cursor:pointer;color:var(--text-secondary);font-family:inherit">✏ 수정</button>
            <button onclick="toggleNoticePublish('${n.id}',${!n.published})" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:none;cursor:pointer;color:var(--text-secondary);font-family:inherit">${n.published?'내리기':'게시'}</button>
            <button onclick="deleteNoticeItem('${n.id}')" style="font-size:12px;padding:4px 10px;border:1px solid rgba(184,64,64,0.3);border-radius:var(--radius-sm);background:none;cursor:pointer;color:var(--red);font-family:inherit">삭제</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;max-height:40px;overflow:hidden">${n.content.replace(/</g,'&lt;')}</div>
        <div style="font-size:11px;color:var(--text-hint);margin-top:6px">${dateStr}${n.files&&n.files.length?` · 📎 ${n.files.length}개`:''}</div>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="text-align:center;padding:2rem;color:var(--red);font-size:13px">불러오기 실패.</div>';}
}
async function editNotice(id){
  const notices=await window._fb.getNotices();
  const n=notices.find(x=>x.id===id);
  if(!n)return;
  _editingNoticeId=id;
  _noticeFiles=n.files?[...n.files]:[];
  renderNoticeFileList();
  document.getElementById('nTitle').value=n.title;
  document.getElementById('nContent').value=n.content;
  updateNoticeCharCount();
  document.getElementById('nPublish').checked=n.published;
  if(n.noticeType==='긴급')document.getElementById('nTypeUrg').checked=true;
  else document.getElementById('nTypeAn').checked=true;
  onNoticeTypeChange();
  document.getElementById('noticeFormLabel').textContent='공지 수정';
  document.getElementById('noticeSubmitBtn').textContent='수정 저장';
  document.getElementById('noticeInlineForm').classList.remove('collapsed');
  setTimeout(()=>document.getElementById('noticeInlineForm').scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
async function toggleNoticePublish(id,publish){
  const notices=await window._fb.getNotices();
  const n=notices.find(x=>x.id===id);
  if(!n)return;
  await window._fb.saveNotice({...n,published:publish});
  loadNoticeAdminList();
}
async function deleteNoticeItem(id){
  if(!confirm('이 공지를 삭제하시겠습니까?'))return;
  await window._fb.deleteNotice(id);
  loadNoticeAdminList();
}

/* ── 초기화 ── */
initKwTags();
initDropdowns();
render();
initFirebase(); // Firestore 실시간 구독 시작

(function(){
  const btnTop = document.getElementById('fabScrollTop');
  const btnBot = document.getElementById('fabScrollBot');
  function showFab(el){ el.style.display='flex'; requestAnimationFrame(()=>{el.style.opacity='1';el.style.transform='translateY(0) scale(1)';}); }
  function hideFab(el){ el.style.opacity='0'; el.style.transform='translateY(10px) scale(0.92)'; setTimeout(()=>{ el.style.display='none'; },300); }
  window.addEventListener('scroll', function(){
    const scrolled = window.scrollY;
    const maxScroll = document.body.scrollHeight - window.innerHeight;
    if(scrolled > 300) showFab(btnTop); else hideFab(btnTop);
    if(scrolled < maxScroll - 300) showFab(btnBot); else hideFab(btnBot);
  }, {passive:true});
})();

(function(){
  const jmEl  = document.getElementById('jobManagerPage');
  const btnTop = document.getElementById('jmFabScrollTop');
  const btnBot = document.getElementById('jmFabScrollBot');
  if(!jmEl||!btnTop||!btnBot) return;
  function showFab(el){ el.style.display='flex'; requestAnimationFrame(()=>{el.style.opacity='1';el.style.transform='translateY(0) scale(1)';}); }
  function hideFab(el){ el.style.opacity='0'; el.style.transform='translateY(10px) scale(0.92)'; setTimeout(()=>{ el.style.display='none'; },300); }
  jmEl.addEventListener('scroll', function(){
    const scrolled = jmEl.scrollTop;
    const maxScroll = jmEl.scrollHeight - jmEl.clientHeight;
    if(scrolled > 300) showFab(btnTop); else hideFab(btnTop);
    if(scrolled < maxScroll - 300) showFab(btnBot); else hideFab(btnBot);
  }, {passive:true});
})();

