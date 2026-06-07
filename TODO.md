# TODO

## 개선사항
- [ ] 입력값 길이 제한 — title/content/nickname max length 서버 검증 없음
- [ ] 비밀번호 변경 API/UI 없음 (로컬 로그인 유저 대상)
- [ ] Rate limiting — 글/댓글/좋아요 API 스팸 방어 없음
- [ ] 서버사이드 검색 — 현재 클라이언트 JS만으로 동작, 200개 초과 글 검색 불가
- [ ] 무한 스크롤 — `/api/feeds?page=&per_page=` API는 완성, 프론트 미구현
- [x] 미사용 import 제거 — `requests`, `json` (app.py 상단)
- [x] `pytz` → `zoneinfo` (Python 3.9+ 표준, 외부 의존성 제거)

## 추가 기능
- [ ] 공부 타이머/스톱워치 (핵심 기능 부재)
- [ ] 게시글 정렬 — 최신순/인기순/조회수순
- [ ] 댓글 좋아요
- [ ] 게시글 북마크 (마이페이지 탭 추가)
- [ ] 공유 버튼 — URL 복사 또는 카카오 공유
- [ ] 사용자 팔로우/팔로워
- [ ] 다크 모드

## 완료
- [x] 보안: 모든 데이터 변경 API를 클라이언트 username → 서버 세션으로 전환
- [x] 보안: 이미지 업로드 5MB 크기 제한 추가
- [x] 코드: BLOG_ARTICLES 모듈 상수화 (blog_list/blog_detail 중복 제거)
- [x] 코드: is_admin DB 쿼리 제거 → `username == 'admin'` 비교
- [x] 코드: delete_account 불필요한 루프 제거 (ON DELETE CASCADE 활용)
- [x] 성능: fetch_all_feeds limit/offset 페이지네이션
- [x] 성능: check_auth DB 쿼리 제거 → 세션에서 직접 읽기
- [x] 성능: update_profile 후 세션 동기화
- [x] UI: 마이페이지/관리자 페이지 헤더 제목 중앙 정렬
