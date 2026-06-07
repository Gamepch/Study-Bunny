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
let lastScreenSize = window.innerWidth <= 400 ? 'mobile' : 'desktop';
let focusBadgeData = null;              // { sessions, totalSec } | null
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(() => console.log('Service Worker registered.'))
            .catch((error) => console.warn('Service Worker registration failed:', error));
    }
}

function createOfflineBanner() {
    const existing = document.getElementById('offline-banner');
    if (existing) return existing;

    const banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.className = 'offline-banner hidden';
    banner.innerText = '인터넷 연결이 없어 사이트 이용이 어렵습니다. 연결 상태를 확인한 후 다시 시도해주세요.';
    document.body.appendChild(banner);
    return banner;
}

function updateOfflineBanner() {
    const banner = createOfflineBanner();
    if (navigator.onLine) {
        banner.classList.add('hidden');
    } else {
        banner.classList.remove('hidden');
    }
}

let deferredInstallPrompt = null;
const INSTALL_PROMPT_STORAGE_KEY = 'installPromptHideUntil';
const INSTALL_PROMPT_HIDE_MS = 24 * 60 * 60 * 1000;

function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || navigator.userAgent.includes('StandAlone');
}

function shouldShowInstallPrompt() {
    if (isAppInstalled()) return false;
    const hideUntil = localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY);
    if (!hideUntil) return true;
    return Date.now() > Number(hideUntil);
}

function hideInstallPrompt() {
    const prompt = document.getElementById('install-prompt');
    if (prompt) {
        prompt.style.display = 'none';
    }
}

function setInstallPromptHideUntilTomorrow() {
    localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, String(Date.now() + INSTALL_PROMPT_HIDE_MS));
    hideInstallPrompt();
}

function handleInstallButtonClick() {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent) {
        hideInstallPrompt();
        return;
    }

    promptEvent.prompt();
    promptEvent.userChoice.then(choiceResult => {
        deferredInstallPrompt = null;
        hideInstallPrompt();
    }).catch(() => {
        hideInstallPrompt();
    });
}

function createInstallPrompt() {
    if (document.getElementById('install-prompt') || !shouldShowInstallPrompt()) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'install-prompt';
    wrapper.className = 'install-prompt';
    wrapper.innerHTML = `
        <div class="install-prompt-card">
            <button type="button" class="close-btn" aria-label="닫기">&times;</button>
            <div class="install-prompt-text">
                <strong>클로버 스터디를 앱으로 설치해보세요</strong>
                <p>앱으로 들어오면 더 빠르게 이용할 수 있어요. 오늘 하루 보지 않기를 누르면 다시 보지 않습니다.</p>
            </div>
            <div class="install-prompt-actions">
                <button type="button" class="install-btn">앱 설치</button>
                <button type="button" class="dismiss-btn">오늘 하루 보지 않기</button>
            </div>
        </div>`;

    document.body.appendChild(wrapper);

    wrapper.querySelector('.install-btn').addEventListener('click', handleInstallButtonClick);
    wrapper.querySelector('.dismiss-btn').addEventListener('click', setInstallPromptHideUntilTomorrow);
    wrapper.querySelector('.close-btn').addEventListener('click', hideInstallPrompt);
}

window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (shouldShowInstallPrompt()) {
        createInstallPrompt();
    }
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallPrompt();
});

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);

// ─── DOMContentLoaded ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    updateOfflineBanner();
    checkLoginStatus();
    if (typeof initNotifications === 'function') initNotifications();

    if (window.__INITIAL_FEEDS__ && Array.isArray(window.__INITIAL_FEEDS__)) {
        allFeeds = window.__INITIAL_FEEDS__;
        // 초기 탭(공부 인증) 렌더링은 서버사이드 HTML이 이미 담당
        // JS 렌더링은 검색/필터 시에만 동작
    } else {
        fetchFeeds();
    }

    // 뒤로가기 후 탭 상태 복원 (페인트는 인라인 CSS가 무플래시로 처리, 여기서 JS 상태·피드 동기화)
    const savedTab = sessionStorage.getItem('lastMainTab');
    if (savedTab === 'community') {
        switchMainTab('community');
        document.documentElement.removeAttribute('data-tab');
    }

    loadFormComponent();

    if (deferredInstallPrompt && shouldShowInstallPrompt()) {
        createInstallPrompt();
    }

    // 창 크기 변경 시 auth-zone 리렌더링 (400px 기준)
    // 실제 경계(400px)를 넘을 때만 리렌더링 (불필요한 API 요청 줄임)
    window.addEventListener('resize', async () => {
        if (!currentUser) return;
        const currentSize = window.innerWidth <= 400 ? 'mobile' : 'desktop';
        if (currentSize !== lastScreenSize) {
            lastScreenSize = currentSize;
            await renderAuthZone(true);
        }
    });
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
    sessionStorage.setItem('lastMainTab', tab);

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
    if (!feeds || feeds.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <span class="emoji">📸</span>
                검색 결과가 없어요.<br>다른 키워드로 찾아보세요!
            </div>`;
        return;
    }

    container.innerHTML = feeds.map(feed => {
        const imageBlock = feed.image_url
            ? `<img src="${feed.image_url}" alt="공부 인증 이미지" loading="lazy">`
            : `<div class="cert-card-no-image"><span>📚</span></div>`;

        return `
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
                    <p class="cert-card-preview">${escapeHtml((feed.content || '').replace(/\[focus:\d+:\d+\]\n?/g, ''))}</p>
                </div>
            </div>`;
    }).join('');
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
    if (!feeds || feeds.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="emoji">💬</span>
                ${currentCommunityFilter === '전체' ? '아직 커뮤니티 글이 없어요.<br>첫 번째 글을 남겨보세요!' : '이 카테고리에 글이 없어요.'}
            </div>`;
        return;
    }

    container.innerHTML = feeds.map(feed => {
        const dateStr = (feed.date || '').slice(0, 5);
        const tagClass = `community-tag community-tag--${feed.category}`;

        return `
            <div class="community-row" onclick="location.href='/post/${feed.id}'" data-category="${feed.category}">
                <span class="${tagClass}">${escapeHtml(feed.category || '기타')}</span>
                <span class="community-title">${escapeHtml(feed.title || '')}</span>
                <span class="community-comment-cnt">[${feed.comment_count || 0}]</span>
                <span class="community-meta">${escapeHtml(feed.nickname || '')} · ${dateStr}</span>
            </div>`;
    }).join('');
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
        location.href = '/login';
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

/**\
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
//  FOCUS BADGE
// ═══════════════════════════════════════════════════════════

function insertFocusBadge() {
    const username   = currentUser?.username || 'guest';
    const pfx        = `pomodoro_${username}_`;
    const today      = new Date().toLocaleDateString('ko-KR');
    const savedDate  = localStorage.getItem(pfx + 'date');
    const sessions   = parseInt(localStorage.getItem(pfx + 'sessions') || '0');
    const totalSec   = parseInt(localStorage.getItem(pfx + 'total')    || '0');

    if (savedDate !== today || sessions === 0) {
        alert('오늘의 포모도로 기록이 없어요!\n타이머를 먼저 사용해보세요. ⏱');
        return;
    }

    focusBadgeData = { sessions, totalSec };

    const h   = Math.floor(totalSec / 3600);
    const m   = Math.floor((totalSec % 3600) / 60);
    const timeStr = (h > 0 && m > 0) ? `${h}시간 ${m}분`
                  : h > 0             ? `${h}시간`
                                      : `${m}분`;

    const preview   = document.getElementById('focus-badge-preview');
    const valueSpan = document.getElementById('focus-badge-preview-value');
    if (preview && valueSpan) {
        valueSpan.textContent = `${timeStr} · ${sessions}세션`;
        preview.classList.remove('hidden');
    }

    // 버튼 활성 표시
    const btn = document.getElementById('focus-badge-btn');
    if (btn) {
        btn.style.background   = '#d1fae5';
        btn.style.borderColor  = '#34d399';
        btn.style.color        = '#065f46';
    }
}

function removeFocusBadge() {
    focusBadgeData = null;
    const preview = document.getElementById('focus-badge-preview');
    if (preview) preview.classList.add('hidden');
    const btn = document.getElementById('focus-badge-btn');
    if (btn) {
        btn.style.background  = '';
        btn.style.borderColor = '';
        btn.style.color       = '';
    }
}

// ═══════════════════════════════════════════════════════════
//  SUBMIT POST
// ═══════════════════════════════════════════════════════════

function submitPost() {
    if (!currentUser) {
        location.href = '/login';
        return;
    }

    const category  = document.getElementById('modal-category')?.value;
    const title     = document.getElementById('modal-title-input')?.value;
    let   content   = document.getElementById('modal-content-input')?.value;
    const imageFile = document.getElementById('modal-image-input')?.files[0];

    // 포모도로 배지 마커 삽입
    if (focusBadgeData) {
        content = `[focus:${focusBadgeData.sessions}:${focusBadgeData.totalSec}]\n${content}`;
    }

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
                focusBadgeData = null;
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

async function checkLoginStatus() {
    try {
        if (!window._sharedAuthPromise) {
            window._sharedAuthPromise = fetch('/api/auth/check')
                .then(r => r.json())
                .then(d => d.authenticated ? d.user : null)
                .catch(() => null);
        }
        const user = await window._sharedAuthPromise;
        if (user) {
            currentUser = user;
            await renderAuthZone(true);
        } else {
            currentUser = null;
            await renderAuthZone(false);
        }
    } catch (err) {
        console.error('Auth check error:', err);
        currentUser = null;
        await renderAuthZone(false);
    }
}

async function renderAuthZone(isLoggedIn) {
    const authZone = document.getElementById('auth-zone');
    if (!authZone) return;

    if (isLoggedIn && currentUser) {
        const isMobile = window.innerWidth <= 400;
        const notificationBellBtn = `
            <button type="button" class="notification-bell-btn relative p-2 rounded-xl text-emerald-500 hover:bg-emerald-50 transition-colors" onclick="openNotificationsModal()" title="알림" aria-label="알림">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <span class="notification-badge hidden" style="position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; background-color: #ef4444; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold; line-height: 1;">0</span>
            </button>
        `;
        authZone.innerHTML = `
            <div class="flex items-center space-x-2">
                ${notificationBellBtn}
                ${isMobile ? `
                    <button onclick="location.href='/mypage?user=${encodeURIComponent(currentUser.username)}'" class="p-2 rounded-xl text-emerald-500 hover:bg-emerald-50 transition-colors" title="마이페이지">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                    </button>
                    <button onclick="handleLogout()" class="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors" title="로그아웃">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>
                ` : `
                    <button onclick="location.href='/mypage?user=${encodeURIComponent(currentUser.username)}'" class="text-xs bg-emerald-100 text-emerald-500 px-3 py-1.5 rounded-xl font-bold hover:bg-emerald-200 transition-all">
                        마이페이지
                    </button>
                    <button onclick="handleLogout()" class="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-xl font-bold hover:bg-gray-200 transition-all">
                        로그아웃
                    </button>
                `}
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
        fetch('/api/logout', { method: 'POST' })
            .then(() => {
                currentUser = null;
                alert('로그아웃 되었습니다!');
                location.reload();
            })
            .catch(err => {
                console.error('Logout error:', err);
                alert('로그아웃 중 오류가 발생했습니다.');
            });
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
                    // 세션이 자동으로 저장됨 (HttpOnly 쿠키)
                    alert(`${res.body.user.nickname}님, 반가워요! 오늘도 열공해봐요! 🐾`);
                    closeAuthModal();
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