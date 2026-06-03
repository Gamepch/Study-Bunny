/**
 * ============================================================
 * Clover Study — main.js
 * 메인 탭: 공부 인증(certification) / 커뮤니티(community)
 * ============================================================
 */

// ─── Global State ───────────────────────────────────────────
let allFeeds = [];
let currentTab = 'certification';       // 'certification' | 'community'
let currentCommunityFilter = '전체';    // 커뮤니티 필터 칩 상태
let currentUser = null;
let currentAuthMode = 'login';          // 'login' | 'signup'
let fabOpen = false;

// ─── DOMContentLoaded ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
    if (typeof initNotifications === 'function') initNotifications();

    if (window.__INITIAL_FEEDS__ && Array.isArray(window.__INITIAL_FEEDS__)) {
        allFeeds = window.__INITIAL_FEEDS__;
        // 초기 탭(공부 인증) 렌더링은 서버사이드 HTML이 이미 담당
        // JS 렌더링은 검색/필터 시에만 동작
    } else {
        fetchFeeds();
    }

    loadFormComponent();
});

// ═══════════════════════════════════════════════════════════
//  TAB SWITCHING
// ═══════════════════════════════════════════════════════════

/**
 * 메인 탭 전환
 * @param {'certification'|'community'} tab
 */
function switchMainTab(tab) {
    currentTab = tab;

    const certBtn  = document.getElementById('main-tab-cert');
    const commBtn  = document.getElementById('main-tab-comm');
    const certPanel = document.getElementById('panel-certification');
    const commPanel = document.getElementById('panel-community');

    if (tab === 'certification') {
        certBtn.classList.add('active');
        commBtn.classList.remove('active');
        certPanel.style.display = '';
        commPanel.style.display = 'none';
    } else {
        commBtn.classList.add('active');
        certBtn.classList.remove('active');
        certPanel.style.display = 'none';
        commPanel.style.display = '';
    }

    // 검색어 초기화
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';

    // 검색 상태에서 탭 전환 시 재렌더링
    handleSearch();
}

// ═══════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════

/**
 * 검색 입력 핸들러 — 현재 활성 탭에 맞게 필터링
 */
function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (currentTab === 'certification') {
        let filtered = allFeeds.filter(f => f.category === '공부기록' || !f.category);
        if (keyword) {
            filtered = filtered.filter(f =>
                (f.title || '').toLowerCase().includes(keyword) ||
                (f.content || '').toLowerCase().includes(keyword)
            );
        }
        renderCertFeeds(filtered);
    } else {
        let filtered = getCommunityFeeds();
        if (keyword) {
            filtered = filtered.filter(f =>
                (f.title || '').toLowerCase().includes(keyword) ||
                (f.content || '').toLowerCase().includes(keyword)
            );
        }
        renderCommunityFeeds(filtered);
    }
}

// ═══════════════════════════════════════════════════════════
//  CERTIFICATION FEED
// ═══════════════════════════════════════════════════════════

/**
 * 공부 인증 그리드 렌더링
 * @param {Array} feeds
 */
function renderCertFeeds(feeds) {
    const container = document.getElementById('cert-feed-container');
    if (!container) return;
    container.innerHTML = '';

    if (!feeds || feeds.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <span class="emoji">📸</span>
                검색 결과가 없어요.<br>다른 키워드로 찾아보세요!
            </div>`;
        return;
    }

    feeds.forEach(feed => {
        const imageBlock = feed.image_url
            ? `<img src="${feed.image_url}" alt="공부 인증 이미지" loading="lazy">`
            : `<div class="cert-card-no-image"><span>📚</span></div>`;

        container.innerHTML += `
            <div class="cert-card" onclick="location.href='/post/${feed.id}'">
                <div class="cert-card-header">
                    <img src="${feed.profile_url || 'https://placehold.co/100x100/6ee7b7/ffffff?text=🍀'}"
                        alt="프로필" class="cert-card-avatar">
                    <span class="cert-card-nickname">${escapeHtml(feed.nickname || '클로버')}</span>
                </div>
                <div class="cert-card-image-wrap">${imageBlock}</div>
                <div class="cert-card-footer">
                    <div class="cert-card-stats">
                        <span>❤️ ${feed.likes || 0}</span>
                        <span>💬 ${feed.comment_count || 0}</span>
                    </div>
                    <p class="cert-card-preview">${escapeHtml(feed.content || '')}</p>
                </div>
            </div>`;
    });
}

// ═══════════════════════════════════════════════════════════
//  COMMUNITY FEED
// ═══════════════════════════════════════════════════════════

const COMMUNITY_CATEGORIES = ['질문', '꿀팁', '잡담'];

/**
 * 커뮤니티 게시물 필터 (allFeeds 기준)
 * @returns {Array}
 */
function getCommunityFeeds() {
    let feeds = allFeeds.filter(f => COMMUNITY_CATEGORIES.includes(f.category));
    if (currentCommunityFilter !== '전체') {
        feeds = feeds.filter(f => f.category === currentCommunityFilter);
    }
    return feeds;
}

/**
 * 커뮤니티 필터 칩 선택
 * @param {string} category
 */
function filterCommunity(category) {
    currentCommunityFilter = category;

    // 칩 활성화 업데이트
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.remove('active');
    });
    const activeChip = document.getElementById(`chip-${category}`);
    if (activeChip) activeChip.classList.add('active');

    // 검색어 포함해서 재렌더링
    handleSearch();
}

/**
 * 커뮤니티 리스트 렌더링
 * @param {Array} feeds
 */
function renderCommunityFeeds(feeds) {
    const container = document.getElementById('community-feed-container');
    if (!container) return;
    container.innerHTML = '';

    if (!feeds || feeds.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="emoji">💬</span>
                ${currentCommunityFilter === '전체' ? '아직 커뮤니티 글이 없어요.<br>첫 번째 글을 남겨보세요!' : '이 카테고리에 글이 없어요.'}
            </div>`;
        return;
    }

    feeds.forEach(feed => {
        const dateStr = (feed.date || '').slice(0, 5);
        const tagClass = `community-tag community-tag--${feed.category}`;

        container.innerHTML += `
            <div class="community-row" onclick="location.href='/post/${feed.id}'" data-category="${feed.category}">
                <span class="${tagClass}">${escapeHtml(feed.category || '기타')}</span>
                <span class="community-title">${escapeHtml(feed.title || '')}</span>
                <span class="community-comment-cnt">[${feed.comment_count || 0}]</span>
                <span class="community-meta">${escapeHtml(feed.nickname || '')} · ${dateStr}</span>
            </div>`;
    });
}

// ═══════════════════════════════════════════════════════════
//  FAB MENU
// ═══════════════════════════════════════════════════════════

function toggleFabMenu() {
    fabOpen ? closeFabMenu() : openFabMenu();
}

function openFabMenu() {
    fabOpen = true;
    document.getElementById('fab-main-btn').classList.add('open');
    document.getElementById('fab-menu-popup').classList.add('open');
    document.getElementById('fab-overlay').classList.add('open');
}

function closeFabMenu() {
    fabOpen = false;
    document.getElementById('fab-main-btn').classList.remove('open');
    document.getElementById('fab-menu-popup').classList.remove('open');
    document.getElementById('fab-overlay').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════
//  WRITE MODAL
// ═══════════════════════════════════════════════════════════

/**
 * 글쓰기 모달 열기
 * @param {'certification'|'community'} type
 */
function openWriteModal(type) {
    closeFabMenu();

    if (!currentUser) {
        alert('글을 작성하려면 먼저 로그인해주세요! 🍀');
        openAuthModal('login');
        return;
    }

    const modal = document.getElementById('write-modal');
    const titleEl = document.getElementById('write-modal-title');
    if (!modal) return;

    // 폼이 로드된 경우에만 카테고리 설정
    const setCategoryAfterLoad = () => {
        const categoryEl = document.getElementById('modal-category');
        if (!categoryEl) return;

        if (type === 'certification') {
            categoryEl.innerHTML = '<option value="공부기록">📚 공부기록</option>';
            categoryEl.value = '공부기록';
            categoryEl.classList.add('hidden');
            if (titleEl) titleEl.innerHTML = '새 공부 인증 <span class="ml-2 text-2xl">📸</span>';
        } else {
            categoryEl.innerHTML = `
                <option value="잡담">🧡 잡담</option>
                <option value="질문">🙋‍♀️ 질문</option>
                <option value="꿀팁">💡 꿀팁</option>
            `;
            // 현재 커뮤니티 필터 값 적용 (전체면 잡담으로)
            const commCat = currentCommunityFilter !== '전체' ? currentCommunityFilter : '잡담';
            categoryEl.value = commCat;
            categoryEl.classList.remove('hidden');
            if (titleEl) titleEl.innerHTML = '커뮤니티 글쓰기 <span class="ml-2 text-2xl">✏️</span>';
        }

        // 임시저장 불러오기 (사용자 확인 후)
        const hasDraft = localStorage.getItem('clover_draft');
        if (hasDraft) {
            const restore = confirm('작성 중이던 임시저장 글이 있어요. 이어서 쓸까요?\n(취소하면 임시저장이 삭제됩니다)');
            if (restore) {
                loadDraft();
            } else {
                clearDraft();
                document.getElementById('modal-title-input').value = '';
                document.getElementById('modal-content-input').value = '';
                removeImage();
            }
        } else {
            document.getElementById('modal-title-input').value = '';
            document.getElementById('modal-content-input').value = '';
            removeImage();
        }
    };

    if (!document.getElementById('modal-category')) {
        loadFormComponent().then(setCategoryAfterLoad);
    } else {
        setCategoryAfterLoad();
    }

    modal.classList.remove('hidden');
}

/**
 * 글쓰기 모달 닫기
 */
function closeWriteModal() {
    const modal = document.getElementById('write-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * 하위 호환: 기존 toggleWriteModal() 참조를 유지
 */
function toggleWriteModal() {
    const modal = document.getElementById('write-modal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        openWriteModal(currentTab === 'certification' ? 'certification' : 'community');
    } else {
        closeWriteModal();
    }
}

// ═══════════════════════════════════════════════════════════
//  FORM COMPONENT
// ═══════════════════════════════════════════════════════════

/**
 * 공유 폼 컴포넌트 로드
 * @returns {Promise}
 */
function loadFormComponent() {
    return fetch('/component/form')
        .then(res => res.text())
        .then(html => {
            const container = document.getElementById('form-container');
            if (container) {
                container.innerHTML = html;
                const imgInput = document.getElementById('modal-image-input');
                const removeBtn = document.getElementById('modal-preview-remove-btn');
                if (imgInput) imgInput.onchange = previewImage;
                if (removeBtn) removeBtn.onclick = removeImage;
            }
        });
}

function previewImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('modal-preview-img').src = e.target.result;
            document.getElementById('modal-preview-container').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

function removeImage() {
    const imgInput = document.getElementById('modal-image-input');
    const previewImg = document.getElementById('modal-preview-img');
    const previewContainer = document.getElementById('modal-preview-container');
    if (imgInput) imgInput.value = '';
    if (previewImg) previewImg.src = '';
    if (previewContainer) previewContainer.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════
//  DRAFT
// ═══════════════════════════════════════════════════════════

function saveDraft() {
    const category = document.getElementById('modal-category')?.value;
    const title    = document.getElementById('modal-title-input')?.value;
    const content  = document.getElementById('modal-content-input')?.value;
    const imageInput = document.getElementById('modal-image-input');

    const draft = { category, title, content, imageData: null };

    if (imageInput?.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            draft.imageData = e.target.result;
            localStorage.setItem('clover_draft', JSON.stringify(draft));
            alert('임시저장되었습니다! 💾');
        };
        reader.readAsDataURL(imageInput.files[0]);
    } else {
        localStorage.setItem('clover_draft', JSON.stringify(draft));
        alert('임시저장되었습니다! 💾');
    }
}

function loadDraft() {
    const draftData = localStorage.getItem('clover_draft');
    if (!draftData) return;
    try {
        const draft = JSON.parse(draftData);
        const categoryEl = document.getElementById('modal-category');
        const titleEl    = document.getElementById('modal-title-input');
        const contentEl  = document.getElementById('modal-content-input');
        const previewImg = document.getElementById('modal-preview-img');
        const previewContainer = document.getElementById('modal-preview-container');

        if (categoryEl) categoryEl.value = draft.category || '공부기록';
        if (titleEl)    titleEl.value    = draft.title    || '';
        if (contentEl)  contentEl.value  = draft.content  || '';
        if (draft.imageData && previewImg && previewContainer) {
            previewImg.src = draft.imageData;
            previewContainer.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Draft load error:', e);
    }
}

function clearDraft() {
    localStorage.removeItem('clover_draft');
}

// ═══════════════════════════════════════════════════════════
//  SUBMIT POST
// ═══════════════════════════════════════════════════════════

function submitPost() {
    if (!currentUser) {
        alert('글을 작성하려면 먼저 로그인해주세요! 🍀');
        openAuthModal('login');
        return;
    }

    const category  = document.getElementById('modal-category')?.value;
    const title     = document.getElementById('modal-title-input')?.value;
    const content   = document.getElementById('modal-content-input')?.value;
    const imageFile = document.getElementById('modal-image-input')?.files[0];

    if (!title?.trim() || !content?.trim()) {
        alert('제목과 내용을 모두 입력해주세요! 🍀');
        return;
    }

    const formData = new FormData();
    formData.append('category', category);
    formData.append('title', title);
    formData.append('content', content);
    formData.append('nickname', currentUser.nickname);
    formData.append('profile_url', currentUser.profile_url);
    formData.append('username', currentUser.username);
    if (imageFile) formData.append('image', imageFile);

    fetch('/api/feeds', { method: 'POST', body: formData })
        .then(res => {
            if (!res.ok) throw new Error('Server Error');
            return res.json();
        })
        .then(data => {
            if (data.message === 'success') {
                alert('새 글이 등록되었습니다! 🎉');
                clearDraft();
                closeWriteModal();
                fetchFeeds();
            }
        })
        .catch(err => {
            console.error('Post Submission Error:', err);
            alert('글 작성 중 문제가 발생했어요. F12를 눌러 콘솔창을 확인해주세요!');
        });
}

// ═══════════════════════════════════════════════════════════
//  DATA FETCHING
// ═══════════════════════════════════════════════════════════

function fetchFeeds() {
    fetch('/api/feeds')
        .then(res => res.json())
        .then(data => {
            allFeeds = data;
            // 현재 탭 기준으로 재렌더링
            if (currentTab === 'certification') {
                renderCertFeeds(allFeeds.filter(f => f.category === '공부기록' || !f.category));
            } else {
                renderCommunityFeeds(getCommunityFeeds());
            }
        })
        .catch(err => console.error('Data loading error:', err));
}

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════

function checkLoginStatus() {
    const savedUser = localStorage.getItem('clover_study_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            renderAuthZone(true);
        } catch (e) {
            currentUser = null;
            localStorage.removeItem('clover_study_user');
            renderAuthZone(false);
        }
    } else {
        currentUser = null;
        renderAuthZone(false);
    }
}

function renderAuthZone(isLoggedIn) {
    const authZone = document.getElementById('auth-zone');
    if (!authZone) return;

    if (isLoggedIn && currentUser) {
        authZone.innerHTML = `
            <div class="flex items-center space-x-2">
                ${typeof notificationBellButtonHtml === 'function' ? notificationBellButtonHtml() : ''}
                <button onclick="location.href='/mypage?user=${encodeURIComponent(currentUser.username)}'" class="text-xs bg-emerald-100 text-emerald-500 px-3 py-1.5 rounded-xl font-bold hover:bg-emerald-200 transition-all">
                    마이페이지 🍀
                </button>
                <button onclick="handleLogout()" class="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-xl font-bold hover:bg-gray-200 transition-all">
                    로그아웃
                </button>
            </div>`;
        if (typeof refreshNotificationBadge === 'function') refreshNotificationBadge();
    } else {
        authZone.innerHTML = `
            <button onclick="location.href='/login'" class="text-sm bg-emerald-400 text-white px-4 py-2 rounded-xl font-bold hover:bg-emerald-500 transition-all shadow-md shadow-emerald-100">
                로그인 / 회원가입
            </button>`;
    }
}

function handleLogout() {
    if (confirm('로그아웃 하시겠어요? 🍀')) {
        localStorage.removeItem('clover_study_user');
        currentUser = null;
        alert('로그아웃 되었습니다!');
        location.reload();
    }
}

function openAuthModal(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    switchAuthTab(mode);
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.add('hidden');

    ['auth-username', 'auth-password', 'auth-nickname'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const profileImage   = document.getElementById('auth-profile-image');
    const profilePreview = document.getElementById('auth-profile-preview');
    if (profileImage)  profileImage.value = '';
    if (profilePreview) profilePreview.classList.add('hidden');
}

function previewAuthProfileImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('auth-profile-preview-img').src = e.target.result;
            document.getElementById('auth-profile-preview').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

function switchAuthTab(mode) {
    currentAuthMode = mode;
    const loginTab   = document.getElementById('tab-login');
    const signupTab  = document.getElementById('tab-signup');
    const nicknameInput = document.getElementById('auth-nickname');
    const profileUploadContainer = document.getElementById('profile-upload-container');
    const submitBtn  = document.getElementById('auth-submit-btn');

    if (loginTab)  loginTab.className  = mode === 'login'  ? 'text-emerald-400 border-b-2 border-emerald-400 pb-2 px-2' : 'text-gray-400 pb-2 px-2';
    if (signupTab) signupTab.className = mode === 'signup' ? 'text-emerald-400 border-b-2 border-emerald-400 pb-2 px-2' : 'text-gray-400 pb-2 px-2';
    if (nicknameInput) nicknameInput.classList.toggle('hidden', mode === 'login');
    if (profileUploadContainer) profileUploadContainer.classList.toggle('hidden', mode === 'login');
    if (submitBtn) submitBtn.innerText = mode === 'login' ? '로그인하기' : '가입 완료하기 ✨';
}

function handleAuthSubmit() {
    const username = document.getElementById('auth-username')?.value.trim();
    const password = document.getElementById('auth-password')?.value.trim();
    const nickname = document.getElementById('auth-nickname')?.value.trim();

    if (!username || !password) {
        alert('아이디와 비밀번호를 모두 입력해주세요!');
        return;
    }

    if (currentAuthMode === 'signup') {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);
        if (nickname) formData.append('nickname', nickname);

        const profileImageInput = document.getElementById('auth-profile-image');
        if (profileImageInput?.files[0]) {
            formData.append('profile_image', profileImageInput.files[0]);
        }

        fetch('/api/signup', { method: 'POST', body: formData })
            .then(res => res.json().then(data => ({ status: res.status, body: data })))
            .then(res => {
                if (res.status === 200) {
                    alert('Clover Study 회원이 되신 것을 축하합니다! 🍀🎉 로그인 해주세요.');
                    switchAuthTab('login');
                } else {
                    alert(res.body.reason || '회원가입에 실패했습니다.');
                }
            })
            .catch(err => console.error('Signup Error:', err));
    } else {
        fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
            .then(res => res.json().then(data => ({ status: res.status, body: data })))
            .then(res => {
                if (res.status === 200) {
                    localStorage.setItem('clover_study_user', JSON.stringify(res.body.user));
                    currentUser = res.body.user;
                    alert(`${currentUser.nickname}님, 반가워요! 오늘도 열공해봐요! 🐾`);
                    closeAuthModal();
                    renderAuthZone(true);
                    location.reload();
                } else {
                    alert(res.body.reason || '아이디 또는 비밀번호를 다시 확인해주세요.');
                }
            })
            .catch(err => console.error('Login Error:', err));
    }
}

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** 하위 호환: post.js 등에서 참조하는 기존 함수 유지 */
function openWriteModalForCreate() {
    openWriteModal(currentTab === 'certification' ? 'certification' : 'community');
}

/** 하위 호환: 기존 filterCategory 참조 유지 */
function filterCategory(category) {
    if (category === '공부기록' || category === '전체') {
        switchMainTab('certification');
    } else {
        switchMainTab('community');
        filterCommunity(category);
    }
}