/**
 * config.sample.js — 설정 템플릿
 *
 * 사용법:
 *   cp js/config.sample.js js/config.js
 *   → js/config.js 에 실제 값을 채워 넣으세요.
 *
 * config.js 는 .gitignore 로 Git에서 제외됩니다.
 */

window.APP_CONFIG = {

  /* ── 잡코리아 API ── */
  jkApiKey: '',   // 잡코리아에서 발급받은 API 키

  /* ── Firebase ── */
  firebase: {
    apiKey:            '',
    authDomain:        '',
    projectId:         '',
    storageBucket:     '',
    messagingSenderId: '',
    appId:             '',
  },

};
