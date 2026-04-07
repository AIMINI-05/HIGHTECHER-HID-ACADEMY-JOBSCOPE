/**
 * jobkorea.js — 잡코리아 채용정보 XML API 연동 모듈
 *
 * ※ 잡코리아 API 이용 가이드 필수 준수 사항:
 *   - 채용정보 리스트/공고문 하단에 출처 링크 필수 노출
 *   - 공고문 하단 안내문구 필수 노출
 *   - 잡코리아 사이트 연결 링크 필수
 *
 * ※ EUC-KR 인코딩 이슈:
 *   잡코리아 API는 EUC-KR로 응답하므로 브라우저 직접 fetch 시
 *   한글이 깨집니다. 이 모듈은 CORS 프록시를 통해 처리합니다.
 *   프로덕션 환경에서는 서버사이드 프록시(Node.js/Python 등)로
 *   교체하는 것을 권장합니다.
 */

/* ─────────────────────────────────────────
   설정
───────────────────────────────────────── */
const JK_CONFIG = {
  // 잡코리아에서 발급받은 API 키
  get API_KEY(){ return window.APP_CONFIG?.jkApiKey || ''; }, // saveKeys에서 동적 업데이트

  // 전체 채용정보 엔드포인트
  BASE_URL: 'http://www.jobkorea.co.kr/Service_JK/Data/JK_GI_XML_List.asp',

  // 신입공채 엔드포인트
  STARTER_URL: 'http://www.jobkorea.co.kr/Service_JK/Data/JK_Starter_XML_List.asp',

  // EUC-KR → UTF-8 변환을 위한 CORS 프록시
  // 운영 시 자체 서버 프록시로 교체 권장
  // Firebase Functions 프록시 URL (배포 후 확인된 실제 URL)
  PROXY_MAIN:    'https://jkproxy-4bujm5mfta-du.a.run.app',
  PROXY_STARTER: 'https://jkproxystarter-4bujm5mfta-du.a.run.app',

  // 기본 요청 파라미터
  DEFAULTS: {
    size: 100,   // 1회 최대 건수
    ob: 1,       // 1=등록일순 (가이드 권장)
    area: 'I000,B000,Q000', // 서울+경기+전국
  },

  // localStorage 저장 키
  STORAGE_KEY: 'jk_jobs_cache',
  STORAGE_TS_KEY: 'jk_jobs_cache_ts',

  // 캐시 유효 시간 (ms) — 6시간
  CACHE_TTL: 6 * 60 * 60 * 1000,
};

/* ─────────────────────────────────────────
   출처 표기 (가이드 필수 사항)
───────────────────────────────────────── */
/** 채용 리스트 하단에 삽입할 출처 HTML */
function jkSourceBadgeHtml() {
  return `<div class="jk-source-badge">
    <a href="https://www.jobkorea.co.kr" target="_blank" rel="noopener">잡코리아 채용정보 더보기</a>
  </div>`;
}

/** 공고 상세(모달) 하단에 삽입할 안내문구 HTML */
function jkDisclaimerHtml() {
  return `<div class="jk-disclaimer">
    자세한 채용정보는 반드시 상세정보를 통해 확인하시기 바랍니다.<br>
    본 정보는 채용기업과 <a href="https://www.jobkorea.co.kr" target="_blank" rel="noopener">잡코리아</a>의 동의 없이 무단전재 또는 재배포, 재가공할 수 없습니다.
  </div>`;
}

/* ─────────────────────────────────────────
   코드 → 한글 변환 맵
───────────────────────────────────────── */
const CAREER_MAP  = { 1:'신입', 2:'경력', 3:'신입·경력', 4:'무관' };
const EDU_MAP     = { 0:'학력무관', 1:'초졸', 2:'중졸', 3:'고졸', 4:'대졸(2,3년)', 5:'대졸(4년)', 6:'석사', 7:'박사' };
const JOBTYPE_MAP = { 1:'정규직', 2:'계약직', 3:'인턴', 4:'파견직', 5:'도급', 6:'프리랜서', 7:'아르바이트', 8:'연수생', 9:'병역특례', 10:'위촉직' };
const PAY_MAP     = { 0:'회사내규', 1:'연봉', 2:'월급', 3:'주급', 4:'일급', 5:'시급', 6:'건별' };

/** AreaCode 첫 번째 지역 코드를 시/도 이름으로 변환 */
function areaCodeToName(code) {
  if (!code || code === '0') return '지역미정';
  const map = {
    I:'서울', B:'경기', H:'부산', F:'대구', K:'인천', E:'광주',
    G:'대전', J:'울산', A:'강원', C:'경남', D:'경북', L:'전남',
    M:'전북', O:'충남', P:'충북', N:'제주', '1':'세종',
    Q:'전국', X:'중국·홍콩', Y:'미국', Z:'일본',
  };
  const first = code.split(',')[0];
  const letter = first.charAt(0).toUpperCase();
  return map[letter] || first;
}

/** 기업 규모 코드 → 앱 내부 scale 값으로 변환 */
function coCtgrToScale(co_ctgr) {
  // 신입공채 XML: Co_Ctgr_Code
  // 13=대기업, 11=30대그룹, 12=매출1000대, 14=공기업, 15=외국계, 16=중견기업
  if (!co_ctgr) return 'mid';
  const codes = String(co_ctgr).split(',').map(Number);
  if (codes.some(c => c === 13 || c === 11 || c === 12)) return 'large';
  if (codes.some(c => c === 14)) return 'public';
  if (codes.some(c => c === 15)) return 'mid';   // 외국계 → mid로 분류
  if (codes.some(c => c === 16)) return 'mid';
  return 'mid';
}

function scaleToName(scale) {
  return { large:'대기업', mid:'중소기업', startup:'스타트업', public:'공기업·공공기관' }[scale] || '기타';
}

/** GI_Job_Type (쉼표 구분) → 대표 한글명 */
function parseJobType(raw) {
  if (!raw) return '정규직';
  const codes = String(raw).split(',').map(s => parseInt(s.trim(), 10));
  return codes.map(c => JOBTYPE_MAP[c] || '기타').join('/');
}

/** GI_End_Date (YYYYMMDD) → YYYY-MM-DD */
function parseDate(raw) {
  if (!raw || raw.length < 8) return '9999-12-31';
  // 99991231 = 상시채용
  if (raw === '99991231' || raw === '99991230') return '9999-12-31';
  return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
}

/** GI_Pay + GI_Pay_Term → 급여 표시 문자열 */
function parseSalary(payCode, payTerm, payFlag) {
  if (payFlag == 1) return '면접 후 결정';
  if (!payCode || payCode == 0) return '회사 내규에 따름';
  const typeStr = PAY_MAP[payCode] || '';
  if (!payTerm || payTerm === '0,0') return typeStr ? typeStr + ' 협의' : '협의';
  const [minV, maxV] = payTerm.split(',').map(Number);
  if (!minV && !maxV) return typeStr + ' 협의';
  const unit = (payCode == 1 || payCode == 2) ? '만원' : '원';
  if (minV && maxV && minV !== maxV) return `${typeStr} ${minV.toLocaleString()}~${maxV.toLocaleString()}${unit}`;
  if (minV) return `${typeStr} ${minV.toLocaleString()}${unit}`;
  return typeStr + ' 협의';
}

/* ─────────────────────────────────────────
   XML 파싱 — EUC-KR 디코딩 처리 포함
───────────────────────────────────────── */
/**
 * EUC-KR로 인코딩된 XML 텍스트를 파싱합니다.
 * Functions 프록시가 EUC-KR → UTF-8 변환 후 반환합니다.
 */
function parseXML(text) {
  const parser = new DOMParser();
  // XML 선언 앞의 BOM이나 불필요한 공백 제거
  let clean = text.trim();
  // EUC-KR 선언을 UTF-8로 변환
  clean = clean.replace(/encoding=["']euc-kr["']/gi, 'encoding="UTF-8"');
  // XML 선언 이후 두 번째 XML 선언이 있으면 제거 (중복 방지)
  clean = clean.replace(/(<\?xml[^>]*\?>)([\s\S]*?)(<\?xml[^>]*\?>)/i, '$1$2');
  // XML 파싱
  const doc = parser.parseFromString(clean, 'text/xml');
  // 파싱 오류 시 text/html로 재시도
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    // DataList만 추출 시도
    const match = clean.match(/<DataList[\s\S]*<\/DataList>/i);
    if (match) {
      return parser.parseFromString(match[0], 'text/xml');
    }
  }
  return doc;
}

function getText(el, tag) {
  const node = el.querySelector(tag);
  return node ? (node.textContent || '').trim() : '';
}

/** XML <Items> 하나를 앱 내부 job 객체로 변환 */
function itemToJob(item, source = 'jobkorea') {
  const get = tag => getText(item, tag);

  const endDateRaw = get('GI_End_Date');
  const deadline   = parseDate(endDateRaw);
  const isAlways   = deadline === '9999-12-31';

  const payCode  = parseInt(get('GI_Pay'), 10) || 0;
  const payTerm  = get('GI_Pay_Term');
  const payFlag  = parseInt(get('GI_Pay_Flag'), 10) || 0;

  const careerCode = parseInt(get('GI_Career'), 10) || 0;
  const eduCode    = parseInt(get('GI_EDU_CutLine') || get('GI_Edu_CutLine'), 10) || 0;
  const jobTypeRaw = get('GI_Job_Type');

  // 신입공채 전용 필드
  const coCtgr = get('Co_Ctgr_Code');
  const scale  = coCtgr ? coCtgrToScale(coCtgr) : 'mid';

  // 지역
  const areaCode = get('AreaCode');
  const location = areaCodeToName(areaCode);

  // 키워드 (GI_Keyword) → desc 필드로 활용
  const keywords = get('GI_Keyword');

  const id = 'jk_' + get('GI_No');

  return {
    id,
    title:        get('GI_Subject') || '(제목 없음)',
    company:      get('C_Name') || '기업명 비공개',
    role:         '', // 잡코리아 XML에 직접 직무명 없음 — 키워드로 보완
    industry:     '', // GI_Part_No 코드 → 향후 매핑 가능
    jobType:      parseJobType(jobTypeRaw),
    experience:   CAREER_MAP[careerCode] || '무관',
    education:    EDU_MAP[eduCode] || '',
    location,
    salary:       parseSalary(payCode, payTerm, payFlag),
    salaryMin:    0,
    salaryMax:    0,
    deadline,
    deadlineType: isAlways ? 'always' : 'date',
    desc:         keywords, // 키워드를 설명란에 활용
    requirements: '',
    scale,
    scaleName:    scaleToName(scale),
    src:          source,        // 'jobkorea' | 'jk_starter'
    jkUrl:        get('JK_URL'), // 잡코리아 공고 원본 URL
    companyUrl:   get('C_URL'),  // 기업정보 URL
    closed:       false,
    createdAt:    get('GI_W_Date') || '',
  };
}

/* ─────────────────────────────────────────
   API 호출
───────────────────────────────────────── */
/**
 * 잡코리아 채용정보 XML을 가져와 job 객체 배열로 반환합니다.
 * @param {object} params - 추가 요청 파라미터 (가이드 참조)
 * @param {'all'|'starter'} type - 전체 or 신입공채
 */
async function fetchJobkoreaJobs(params = {}, type = 'all') {
  const merged = {
    api:  JK_CONFIG.API_KEY,
    size: JK_CONFIG.DEFAULTS.size,
    ob:   JK_CONFIG.DEFAULTS.ob,
    area: JK_CONFIG.DEFAULTS.area,
    ...params,
  };

  const qs = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  // Firebase Functions 프록시로 쿼리스트링 그대로 전달
  const proxyUrl = type === 'starter'
    ? `${JK_CONFIG.PROXY_STARTER}?${qs}`
    : `${JK_CONFIG.PROXY_MAIN}?${qs}`;

  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Functions 프록시 오류: ${res.status}`);

  const text = await res.text();
  const xml  = parseXML(text);

  // 파싱 오류 체크
  const parseError = xml.querySelector('parsererror');
  if (parseError) throw new Error('XML 파싱 오류: ' + parseError.textContent.slice(0, 100));

  const items = xml.querySelectorAll('Items');
  const source = type === 'starter' ? 'jk_starter' : 'jobkorea';
  return Array.from(items).map(item => itemToJob(item, source));
}

/* ─────────────────────────────────────────
   캐시 처리
───────────────────────────────────────── */
function saveCache(jobs) {
  try {
    localStorage.setItem(JK_CONFIG.STORAGE_KEY, JSON.stringify(jobs));
    localStorage.setItem(JK_CONFIG.STORAGE_TS_KEY, Date.now().toString());
  } catch (e) { /* 용량 초과 시 무시 */ }
}

function loadCache() {
  try {
    const ts = parseInt(localStorage.getItem(JK_CONFIG.STORAGE_TS_KEY) || '0', 10);
    if (Date.now() - ts > JK_CONFIG.CACHE_TTL) return null; // 만료
    const raw = localStorage.getItem(JK_CONFIG.STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearJKCache() {
  localStorage.removeItem(JK_CONFIG.STORAGE_KEY);
  localStorage.removeItem(JK_CONFIG.STORAGE_TS_KEY);
}

/* ─────────────────────────────────────────
   메인 진입점 — app.js에서 호출
───────────────────────────────────────── */
/**
 * 잡코리아 공고를 불러와 콜백으로 전달합니다.
 * 캐시가 유효하면 캐시를 반환하고 백그라운드에서 갱신합니다.
 *
 * @param {function(jobs: Array, status: 'cache'|'fresh'|'error')} onData
 * @param {object} filterParams - 잡코리아 필터 파라미터
 */
async function loadJobkoreaJobs(onData, filterParams = {}) {
  // 1) 캐시 즉시 반환
  const cached = loadCache();
  if (cached) {
    onData(cached, 'cache');
  }

  // 2) 신선 데이터 fetch
  try {
    const [allJobs, starterJobs] = await Promise.all([
      fetchJobkoreaJobs(filterParams, 'all'),
      fetchJobkoreaJobs(filterParams, 'starter'),
    ]);

    // 중복 제거 (신입공채가 전체에도 포함될 수 있음)
    const seen = new Set(allJobs.map(j => j.id));
    const merged = [
      ...allJobs,
      ...starterJobs.filter(j => !seen.has(j.id)),
    ];

    saveCache(merged);
    onData(merged, 'fresh');
  } catch (err) {
    console.error('[JK] 잡코리아 데이터 로드 실패:', err);
    if (!cached) {
      onData([], 'error');
    }
    // 캐시가 있으면 에러를 조용히 처리 (이미 cache로 반환했으므로)
  }
}

/* ─────────────────────────────────────────
   CSS 주입 (출처 표기 스타일)
───────────────────────────────────────── */
function injectJKStyles() {
  if (document.getElementById('jk-styles')) return;
  const style = document.createElement('style');
  style.id = 'jk-styles';
  style.textContent = `
    /* 출처 배지 — 채용 리스트 하단 */
    .jk-source-badge {
      text-align: center;
      padding: 18px 0 8px;
      font-size: 12px;
    }
    .jk-source-badge a {
      color: var(--accent, #0057b7);
      text-decoration: none;
      font-weight: 500;
      border-bottom: 1px solid currentColor;
      padding-bottom: 1px;
      transition: opacity .15s;
    }
    .jk-source-badge a:hover { opacity: .7; }

    /* 안내문구 — 공고 상세 하단 */
    .jk-disclaimer {
      margin-top: 16px;
      padding: 12px 14px;
      background: var(--bg-surface, #f7f7f7);
      border-radius: 8px;
      font-size: 11.5px;
      color: var(--text-hint, #888);
      line-height: 1.8;
      border: 1px solid var(--border, #e5e5e5);
    }
    .jk-disclaimer a {
      color: var(--accent, #0057b7);
      text-decoration: none;
    }
    .jk-disclaimer a:hover { text-decoration: underline; }

    /* 카드 & 배지 — 잡코리아 출처 */
    .b.jobkorea   { background: #fff0e6; color: #c04800; border: 1px solid #f5c49a; }
    .b.jk_starter { background: #e8f4fd; color: #0057b7; border: 1px solid #90c4f0; }

    /* 관리자 패널 — JK 동기화 상태 */
    .jk-sync-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-secondary, #555);
      margin-bottom: 12px;
      padding: 10px 12px;
      background: var(--bg-surface, #f7f7f7);
      border-radius: 8px;
    }
    .jk-sync-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #ccc; flex-shrink: 0;
      transition: background .3s;
    }
    .jk-sync-dot.live   { background: #22c55e; }
    .jk-sync-dot.error  { background: #ef4444; }
    .jk-sync-dot.loading {
      background: #facc15;
      animation: jk-pulse 1s infinite;
    }
    @keyframes jk-pulse {
      0%,100% { opacity: 1; } 50% { opacity: .4; }
    }
  `;
  document.head.appendChild(style);
}

/* ── 전역 노출 (app.js에서 window._jk 로 접근) ── */
window._jk = {
  jkSourceBadgeHtml,
  jkDisclaimerHtml,
  fetchJobkoreaJobs,
  clearJKCache,
  loadJobkoreaJobs,
  injectJKStyles,
};
