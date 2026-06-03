# 🍀 Clover Study - 하이브리드 로그인 시스템 설정 가이드

## 📋 개요

이 애플리케이션은 **일반 로그인(ID/PW)** 과 **구글 소셜 로그인**을 모두 지원하는 하이브리드 로그인 시스템을 구현합니다.

### 비즈니스 로직

#### 1️⃣ 회원가입 프로세스 (구글 인증 필수)
1. 사용자가 구글로 가입 시작
2. 구글 인증 성공 → 서버에서 `google_id`와 `email` 임시 저장 (세션)
3. 사용자가 `username` 과 `password` 입력 후 가입 완료
4. DB에 모든 정보(google_id, email, username, password 등) 저장

#### 2️⃣ 로그인 프로세스 (두 가지 경로)

**경로 A: 일반 로그인 (ID/PW)**
- username + password 입력 → DB에서 검증 → 세션 생성

**경로 B: 구글 로그인 (비밀번호 불필요)**
- 구글 인증 → DB에서 google_id 확인
  - ✓ 있으면: 바로 로그인
  - ✗ 없으면: 회원가입 프로세스로 유도

#### 3️⃣ 세션 통일
어떤 경로로 로그인하든 동일한 세션 구조:
```json
{
  "username": "user_id",
  "nickname": "닉네임",
  "profile_url": "/static/uploads/...",
  "is_admin": false,
  "login_method": "local" // 또는 "google"
}
```

---

## 🔧 설정 방법

### Step 1: Google Cloud Console에서 OAuth 2.0 설정

1. **Google Cloud Console 접속**
   - https://console.cloud.google.com/

2. **새 프로젝트 생성**
   - 프로젝트 이름: "Clover Study" (또는 원하는 이름)

3. **OAuth 2.0 클라이언트 ID 생성**
   - 좌측 메뉴: "APIs & Services" → "Credentials"
   - "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: **Web application**
   - Name: "Clover Study Web"

4. **승인된 리디렉션 URI 추가**
   - **개발 환경:**
     ```
     http://localhost:5000/auth/google/callback
     ```
   - **프로덕션 환경:**
     ```
     https://yourdomain.com/auth/google/callback
     ```

5. **클라이언트 ID와 Secret 복사**
   - Client ID: `YOUR_CLIENT_ID`
   - Client Secret: `YOUR_CLIENT_SECRET`

---

### Step 2: 환경 변수 설정

1. **`.env` 파일 생성** (`.env.example` 참고)
   ```bash
   cp .env.example .env
   ```

2. **`.env` 파일 수정**
   ```env
   SECRET_KEY=your-random-secret-key-here
   GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE
   GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET_HERE
   GOOGLE_REDIRECT_URI=http://localhost:5000/auth/google/callback
   ```

   > ⚠️ `SECRET_KEY`는 보안을 위해 강력한 랜덤 문자열로 설정하세요!

---

### Step 3: Python 의존성 설치

```bash
pip install -r requirements.txt
```

---

### Step 4: 데이터베이스 마이그레이션

앱 실행 시 자동으로 마이그레이션됩니다. 수동으로 하려면:

```python
python
>>> from app import app, init_db
>>> with app.app_context():
...     init_db()
```

---

### Step 5: 애플리케이션 실행

```bash
python app.py
```

**로그인 페이지:** http://localhost:5000/login

---

## 📊 데이터베이스 스키마

### users 테이블
```sql
CREATE TABLE users (
    username TEXT PRIMARY KEY,              -- 사용자 아이디
    password TEXT NOT NULL,                 -- 해싱된 비밀번호
    email TEXT UNIQUE,                      -- 구글에서 받은 이메일
    google_id TEXT UNIQUE,                  -- 구글 고유 ID
    nickname TEXT,                          -- 커뮤니티에서 보이는 닉네임
    profile_url TEXT,                       -- 프로필 이미지 URL
    login_method TEXT DEFAULT 'local',      -- 'local' 또는 'google'
    created_at TEXT                         -- 가입 일시
);
```

---

## 🔐 보안 체크리스트

- ✅ 비밀번호는 항상 해싱 저장 (werkzeug.security)
- ✅ Google OAuth2 토큰 검증 필수
- ✅ 세션 관리: `session.permanent = False` (브라우저 닫으면 만료)
- ✅ 환경 변수로 민감한 정보 관리
- ✅ HTTPS 사용 권장 (프로덕션)

---

## 🧪 테스트 시나리오

### 시나리오 1: 구글 로그인으로 회원가입
```
1. /login → "구글로 회원가입"
2. 구글 인증 완료
3. /signup → username, password 입력
4. 회원가입 완료 → /
```

### 시나리오 2: 일반 로그인
```
1. /login → username, password 입력
2. 로그인 성공 → /
```

### 시나리오 3: 기존 구글 사용자 로그인
```
1. /login → "구글로 로그인"
2. 구글 인증 완료
3. 바로 로그인 → /
```

---

## 🐛 문제 해결

### "Invalid client_id" 에러
- → Google Cloud Console에서 Client ID 확인
- → `.env` 파일에 정확히 복사했는지 확인

### "Redirect URI mismatch" 에러
- → Google Cloud Console의 "Authorized redirect URIs"에 정확히 등록되어 있는지 확인
- → 프로토콜 (http/https), 도메인, 포트 모두 일치해야 함

### 구글 로그인 버튼이 보이지 않음
- → 브라우저 콘솔에서 에러 확인
- → Google Sign-In 라이브러리 로드 확인: `<script src="https://accounts.google.com/gsi/client" async defer></script>`

---

## 📚 관련 문서

- [Google OAuth 2.0 문서](https://developers.google.com/identity/protocols/oauth2)
- [Flask 세션 관리](https://flask.palletsprojects.com/en/latest/api/#sessions)
- [werkzeug 보안](https://werkzeug.palletsprojects.com/en/latest/security/)

---

## 🚀 프로덕션 배포

1. `.env` 파일에서 모든 설정 업데이트
2. `SECRET_KEY` 강력한 랜덤 문자열로 변경
3. `GOOGLE_REDIRECT_URI` 프로덕션 도메인으로 변경
4. Google Cloud Console에서 프로덕션 URI 추가
5. HTTPS 설정
6. 데이터베이스 백업

---

Made with 🍀 by Clover Study Team
