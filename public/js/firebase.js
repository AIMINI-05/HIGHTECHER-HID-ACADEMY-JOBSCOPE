
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, setDoc, doc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const cfg = window.APP_CONFIG?.firebase;
if (!cfg?.apiKey) {
  console.error(
    '[Firebase] ❌ js/config.js 파일이 없거나 firebase 설정이 비어 있습니다.\n' +
    '   js/config.sample.js 를 복사해서 js/config.js 를 만들고 값을 채워주세요.'
  );
}

const firebaseConfig = {
  apiKey:            cfg?.apiKey            ?? '',
  authDomain:        cfg?.authDomain        ?? '',
  projectId:         cfg?.projectId         ?? '',
  storageBucket:     cfg?.storageBucket     ?? '',
  messagingSenderId: cfg?.messagingSenderId ?? '',
  appId:             cfg?.appId             ?? '',
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);
const JOBS_COL = collection(db, "custom_jobs");

// ── 역할 정의 (UID 기반) ──
const ROLE_MAP = {
  'GyV6ab0C1WNzisupvgJtrNSlXht2': 'admin',  // hi-d@learners-hi.com
  'JEgfNRxfkKYhZcGuqF2eajPeQrf2': 'super',  // sallyminji@gmail.com
};

// Firestore + Auth → 전역 노출
window._fb = {
  // ── Auth ──
  signIn: async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;
    const role = ROLE_MAP[uid] || null;
    if (!role) {
      await signOut(auth);
      throw new Error('접근 권한이 없는 계정입니다.');
    }
    return role; // 'admin' | 'super'
  },
  signOut: async () => {
    await signOut(auth);
  },
  currentRole: () => {
    const uid = auth.currentUser?.uid;
    return uid ? (ROLE_MAP[uid] || null) : null;
  },
  subscribe: (cb) => {
    return onSnapshot(JOBS_COL, (snap) => {
      const jobs = snap.docs.map(d => ({...d.data(), _docId: d.id}));
      cb(jobs);
    });
  },
  // 공고 저장 (upsert)
  save: async (job) => {
    const {_docId, ...clean} = job;
    await setDoc(doc(db, "custom_jobs", String(clean.id)), clean);
  },
  // 공고 삭제
  delete: async (jobId) => {
    await deleteDoc(doc(db, "custom_jobs", String(jobId)));
  },
  // 여러 공고 일괄 저장 (20개씩 배치)
  saveAll: async (jobs) => {
    const chunk = 20;
    for(let i = 0; i < jobs.length; i += chunk){
      const batch = jobs.slice(i, i + chunk);
      await Promise.all(batch.map(j => {
        // _docId 등 내부 필드 제거
        const {_docId, ...clean} = j;
        return setDoc(doc(db, "custom_jobs", String(clean.id)), clean);
      }));
    }
  },
  // 피드백 저장
  saveFeedback: async (text) => {
    const id = 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    await setDoc(doc(db, "feedbacks", id), {
      id, text,
      createdAt: new Date().toISOString()
    });
  },
  // 피드백 전체 조회
  getFeedbacks: async () => {
    const snap = await getDocs(collection(db, "feedbacks"));
    return snap.docs.map(d => d.data()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  },
  // 피드백 삭제
  deleteFeedback: async (id) => {
    await deleteDoc(doc(db, "feedbacks", id));
  },
  // 공지사항 저장/수정
  saveNotice: async (notice) => {
    const {_docId,...clean}=notice;
    await setDoc(doc(db,"notices",String(clean.id)),clean);
  },
  // 공지사항 전체 조회
  getNotices: async () => {
    const snap=await getDocs(collection(db,"notices"));
    return snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  },
  // 공지사항 삭제
  deleteNotice: async (id) => {
    await deleteDoc(doc(db,"notices",String(id)));
  },
  // 최신 공지 구독 (빨간 점용)
  subscribeNotices: (cb) => {
    return onSnapshot(collection(db,"notices"),(snap)=>{
      const notices=snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      cb(notices);
    });
  },
  // ── 전역 키워드 (app_settings/keywords) ──
  saveKeywords: async (kws) => {
    await setDoc(doc(db,"app_settings","keywords"),{list:kws,updatedAt:new Date().toISOString()});
  },
  getKeywords: async () => {
    try{ const snap=await getDoc(doc(db,"app_settings","keywords")); return snap.exists()?snap.data().list:null; }
    catch{ return null; }
  },
  subscribeKeywords: (cb) => {
    return onSnapshot(doc(db,"app_settings","keywords"),(snap)=>{
      if(snap.exists()) cb(snap.data().list);
    });
  },
  // 전체 삭제 후 새로 저장 (20개씩 배치)
  replaceAll: async (jobs) => {
    const snap = await getDocs(JOBS_COL);
    const chunk = 20;
    const dels = snap.docs.map(d => deleteDoc(d.ref));
    for(let i = 0; i < dels.length; i += chunk){
      await Promise.all(dels.slice(i, i + chunk));
    }
    for(let i = 0; i < jobs.length; i += chunk){
      const batch = jobs.slice(i, i + chunk);
      await Promise.all(batch.map(j => {
        const {_docId, ...clean} = j;
        return setDoc(doc(db, "custom_jobs", String(clean.id)), clean);
      }));
    }
  }
};

// Firebase 준비 완료 신호 (폴링 방식으로 안전하게)
window._fbReady = true;
window.dispatchEvent(new Event('firebase-ready'));

// 세션 유지: 새로고침 후 로그인 상태 자동 복원
onAuthStateChanged(auth, (user) => {
  const role = user ? (ROLE_MAP[user.uid] || null) : null;
  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user, role } }));
});

