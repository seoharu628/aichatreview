# 익명 평점 - Cloudflare Pages

## 파일 구조
- index.html
- functions/api/reviews.js

## Cloudflare 설정
Pages/Workers 프로젝트에서 다음을 설정하세요.

1. KV Namespace 바인딩
   - Binding name: REVIEWS

2. 환경변수/Secret
   - ADMIN_PW: 관리자 비밀번호

## 배포
GitHub에 이 폴더 구조 그대로 올린 뒤 Cloudflare Pages에 Git 저장소를 연결하세요.

API 주소는 코드에서 `/api/reviews`로 사용하며,
`functions/api/reviews.js`가 해당 경로를 처리합니다.

Cloudflare Pages deployment
