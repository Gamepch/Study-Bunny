/**
 * Global State
 */
let myPageData = null;
let currentMyPageTab = 'my-posts';
let isOwnProfile = true;
let targetUsername = null;
let myPostsServerRendered = false;
let likedPostsLoaded = false;
let likedPostsLoading = false;

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    let targetUser = urlParams.get('user');
    const user = await getCurrentUser();

    if (!targetUser) {
        if (!user) {
            alert('로그인이 필요합니다! 🍀');
            location.href = '/';
            return;
        }
        location.replace(`/mypage?user=${encodeURIComponent(user.username)}`);
        return;
    }

    targetUsername = targetUser;
    isOwnProfile = Boolean(user && targetUser === user.username);
    applyMyPageChrome(user);
    paintProfileFromCacheOrUrl(targetUser, user);
    loadStreak(targetUser);

    const feedContainer = document.getElementById('mypage-feed-container');
    myPostsServerRendered = feedContainer && feedContainer.dataset.serverRendered === 'true';

    if (window.__MYPAGE_DATA__) {
        myPageData = window.__MYPAGE_DATA__;
        myPageData.liked_posts = myPageData.liked_posts || null;
        updateProfileStats(
            myPageData.my_posts.length,
            myPageData.liked_posts ? myPageData.liked_posts.length : null
        );
        updateCategoryTabsOnly(currentMyPageTab);
        return;
    }

    fetchMyPageData(targetUser);
});

/**
 * Retrieve current logged-in user from server session.
 * @returns {Promise<Object|null>}
 */
async function getCurrentUser() {
    if (!window._sharedAuthPromise) {
        window._sharedAuthPromise = fetch('/api/auth/check')
            .then(r => r.json())
            .then(d => d.authenticated ? d.user : null)
            .catch(() => null);
    }
    return window._sharedAuthPromise;
}

/**
 * Paint nickname/username before API when possible.
 * @param {string} targetUser
 * @param {Object|null} loggedInUser
 */
function paintProfileFromCacheOrUrl(targetUser, loggedInUser) {
    const usernameEl = document.getElementById('profile-username');
    const nickname = document.getElementById('profile-nickname');

    if (usernameEl && targetUser && !usernameEl.textContent.trim()) {
        usernameEl.textContent = `@${targetUser}`;
    }
    if (nickname && targetUser) {
        const current = nickname.textContent.trim();
        if (!current || current === '\u00a0') {
            nickname.textContent = targetUser;
        }
    }

    if (loggedInUser && loggedInUser.username === targetUser) {
        if (nickname && loggedInUser.nickname) nickname.textContent = loggedInUser.nickname;
        if (usernameEl) usernameEl.textContent = `@${loggedInUser.username}`;
        if (loggedInUser.profile_url) setProfileAvatarSrc(loggedInUser.profile_url);
        const likesStat = document.getElementById('stat-likes');
        if (likesStat && likesStat.textContent === '0') likesStat.textContent = '—';
    }
}

/**
 * Set profile image with clover fallback on load failure.
 * @param {string} url
 */
function setProfileAvatarSrc(url) {
    const img = document.getElementById('profile-avatar');
    const fallback = document.getElementById('profile-avatar-fallback');
    if (!img) return;
    if (!url) {
        img.removeAttribute('src');
        img.classList.add('hidden');
        if (fallback) fallback.classList.remove('hidden');
        return;
    }
    img.onload = () => {
        img.classList.remove('hidden');
        if (fallback) fallback.classList.add('hidden');
    };
    img.onerror = () => {
        img.classList.add('hidden');
        if (fallback) fallback.classList.remove('hidden');
    };
    img.src = url;
}

/**
 * Update post/like counts without touching nickname fields.
 * @param {number} postCount
 * @param {number|null} likedCount
 */
function updateProfileStats(postCount, likedCount) {
    const postsStat = document.getElementById('stat-posts');
    if (postsStat) postsStat.textContent = postCount;
    const likesStat = document.getElementById('stat-likes');
    if (likesStat) likesStat.textContent = likedCount === null ? '—' : likedCount;
}

/**
 * Adjust header chrome for own vs other profiles.
 */
function applyMyPageChrome(currentUser) {
    if (!isOwnProfile) {
        const editBtn = document.getElementById('edit-profile-btn');
        if (editBtn) editBtn.style.display = 'none';
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn) adminBtn.style.display = 'none';
        const deleteFooter = document.querySelector('.px-4.py-4.border-t.border-emerald-50');
        if (deleteFooter) deleteFooter.style.display = 'none';
        const title = document.getElementById('mypage-title');
        if (title) title.textContent = '프로필';
        const myPostsTab = document.getElementById('tab-my-posts');
        if (myPostsTab) myPostsTab.textContent = '📝 작성한 글';
    } else {
        // Show admin button if user is admin
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn && currentUser && currentUser.is_admin) {
            adminBtn.style.display = 'block';
        }
        const deleteFooter = document.querySelector('.px-4.py-4.border-t.border-emerald-50');
        if (deleteFooter) deleteFooter.style.display = 'block';
    }
}

/**
 * Fetch My Page data from the server.
 * @param {string} username
 * @param {boolean} includeLiked
 */
function fetchMyPageData(username) {
    fetch(`/api/mypage/${encodeURIComponent(username)}`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to load profile');
            return res.json();
        })
        .then(data => {
            myPageData = data;
            likedPostsLoaded = Array.isArray(data.liked_posts);
            renderProfileCard(data.user);
            updateProfileStats(
                data.my_posts.length,
                likedPostsLoaded ? data.liked_posts.length : null
            );

            if (!myPostsServerRendered) {
                switchMyPageTab(currentMyPageTab);
            } else {
                updateCategoryTabsOnly(currentMyPageTab);
            }
        })
        .catch(error => {
            console.error('MyPage Load Error:', error);
            const container = document.getElementById('mypage-feed-container');
            if (container) {
                container.innerHTML = `
                    <div class="text-center text-red-400 py-10">프로필을 불러오는데 실패했어요. 😢</div>
                `;
            }
        });
}

/**
 * Load liked posts on demand when the tab is opened.
 * @returns {Promise<void>}
 */
function ensureLikedPostsLoaded() {
    if (likedPostsLoaded || likedPostsLoading) {
        return Promise.resolve();
    }

    likedPostsLoading = true;
    return fetch(`/api/mypage/${encodeURIComponent(targetUsername)}/liked`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to load liked posts');
            return res.json();
        })
        .then(data => {
            if (!myPageData) {
                myPageData = { user: {}, my_posts: [], liked_posts: [] };
            }
            myPageData.liked_posts = data.liked_posts || [];
            likedPostsLoaded = true;
            const likesStat = document.getElementById('stat-likes');
            if (likesStat) likesStat.textContent = myPageData.liked_posts.length;
        })
        .catch(error => {
            console.error('Liked Posts Load Error:', error);
        })
        .finally(() => {
            likedPostsLoading = false;
        });
}

/**
 * Render profile identity fields (avatar, nickname, username).
 * @param {Object} user
 */
function renderProfileCard(user) {
    if (user.profile_url) setProfileAvatarSrc(user.profile_url);
    const nickname = document.getElementById('profile-nickname');
    if (nickname && user.nickname) nickname.textContent = user.nickname;
    const usernameEl = document.getElementById('profile-username');
    if (usernameEl && user.username) usernameEl.textContent = `@${user.username}`;
}

/**
 * Update tab button styles without re-rendering the list.
 * @param {string} tab
 */
function updateCategoryTabsOnly(tab) {
    currentMyPageTab = tab;
    const myPostsTab = document.getElementById('tab-my-posts');
    const likedPostsTab = document.getElementById('tab-liked-posts');

    if (tab === 'my-posts') {
        myPostsTab.className = 'mypage-tab-active flex-1 py-3 text-sm font-bold rounded-2xl transition-all';
        likedPostsTab.className = 'mypage-tab-inactive flex-1 py-3 text-sm font-bold rounded-2xl transition-all';
    } else {
        myPostsTab.className = 'mypage-tab-inactive flex-1 py-3 text-sm font-bold rounded-2xl transition-all';
        likedPostsTab.className = 'mypage-tab-active flex-1 py-3 text-sm font-bold rounded-2xl transition-all';
    }
}

/**
 * Switch between "My Posts" and "Liked Posts" tabs.
 * @param {string} tab - 'my-posts' or 'liked-posts'
 */
function switchMyPageTab(tab) {
    updateCategoryTabsOnly(tab);

    if (tab === 'my-posts') {
        if (myPostsServerRendered) {
            return;
        }
        renderPostList(myPageData ? myPageData.my_posts : []);
        return;
    }

    myPostsServerRendered = false;

    if (!likedPostsLoaded) {
        const container = document.getElementById('mypage-feed-container');
        if (container) {
            container.innerHTML = `
                <div class="text-center text-emerald-300 py-10 text-xs font-medium">좋아요 한 글을 불러오는 중... 🍀</div>
            `;
        }
        ensureLikedPostsLoaded().then(() => {
            if (currentMyPageTab === 'liked-posts') {
                renderPostList(myPageData ? myPageData.liked_posts : []);
            }
        });
        return;
    }

    renderPostList(myPageData ? myPageData.liked_posts : []);
}

/**
 * Build HTML for one post row.
 * @param {Object} post
 * @param {number} index
 * @param {number} total
 * @returns {string}
 */
function buildPostItemHtml(post, index, total) {
    const thumbnailHTML = post.image_url
        ? `<div class="flex items-center justify-center self-center ml-3 shrink-0">
               <div class="w-16 h-16 rounded-xl overflow-hidden bg-emerald-50 border border-emerald-100 shadow-sm">
                   <img src="${post.image_url}" alt="썸네일" class="w-full h-full aspect-square object-cover" loading="lazy" decoding="async">
               </div>
           </div>`
        : '';
    const borderClass = index !== total - 1 ? 'border-b border-emerald-50' : '';

    return `
        <div onclick="location.href='/post/${post.id}'" class="${borderClass} p-4 flex justify-between items-start hover:bg-emerald-50/30 transition-colors cursor-pointer">
            <div class="flex-1 min-w-0">
                <span class="inline-block text-[10px] font-bold bg-emerald-50 text-emerald-500 px-2 py-0.5 rounded-md mb-1">
                    ${post.category || '공부기록'}
                </span>
                <h2 class="text-[15px] font-bold text-gray-800 mb-1 truncate">
                    ${post.title}
                    <span class="text-emerald-500 text-xs ml-1">[${post.comment_count || 0}]</span>
                </h2>
                <p class="text-xs text-gray-500 mb-2 truncate">${(post.content || '').replace(/\[focus:\d+:\d+\]\n?/g, '')}</p>
                <div class="flex items-center text-[11px] text-gray-400 space-x-2">
                    <div class="flex items-center">
                        <img src="${post.profile_url || '/static/default_profile.png'}" alt="프로필" class="w-4 h-4 rounded-full mr-1 object-cover" loading="lazy" decoding="async">
                        <a href="/mypage?user=${post.username}" class="font-medium text-gray-600 hover:text-emerald-500 hover:underline" onclick="event.stopPropagation()">${post.nickname}</a>
                    </div>
                    <span>|</span>
                    <span>${post.date}</span>
                    <span>|</span>
                    <span>조회 ${post.views || 0}</span>
                </div>
            </div>
            ${thumbnailHTML}
        </div>
    `;
}

/**
 * Render a list of posts into the feed container.
 * @param {Array} posts
 */
function renderPostList(posts) {
    const container = document.getElementById('mypage-feed-container');
    if (!container) return;

    if (!posts || posts.length === 0) {
        const emptyMsg = currentMyPageTab === 'my-posts'
            ? '아직 작성한 글이 없어요.<br>첫 번째 공부 기록을 남겨보세요!'
            : '아직 좋아요 한 글이 없어요.<br>마음에 드는 글에 ❤️를 눌러보세요!';
        container.innerHTML = `
            <div class="text-center py-12 text-gray-400 text-xs font-medium">
                <span class="text-2xl block mb-2">🍀</span>
                ${emptyMsg}
            </div>`;
        return;
    }

    container.innerHTML = posts
        .map((post, index) => buildPostItemHtml(post, index, posts.length))
        .join('');
}

/**
 * Open the profile edit modal and populate with current data.
 */
async function openProfileEditModal() {
    const user = await getCurrentUser();
    if (!user) return;

    document.getElementById('edit-nickname-input').value = user.nickname;
    document.getElementById('edit-profile-preview').src = user.profile_url;
    document.getElementById('profile-image-input').value = '';
    document.getElementById('profile-edit-modal').classList.remove('hidden');
}

/**
 * Close the profile edit modal.
 */
function closeProfileEditModal() {
    document.getElementById('profile-edit-modal').classList.add('hidden');
}

/**
 * Preview the selected profile image before uploading.
 */
function previewProfileImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('edit-profile-preview').src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

/**
 * Submit profile changes (nickname and/or profile image) to the server.
 */
async function submitProfileEdit() {
    const user = await getCurrentUser();
    if (!user) return;

    const nickname = document.getElementById('edit-nickname-input').value.trim();
    if (!nickname) {
        alert('닉네임을 입력해주세요! 🍀');
        return;
    }

    const formData = new FormData();
    formData.append('username', user.username);
    formData.append('nickname', nickname);

    const imageFile = document.getElementById('profile-image-input').files[0];
    if (imageFile) {
        formData.append('profile_image', imageFile);
    }

    fetch('/api/profile', { method: 'PUT', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.message === 'success') {
                alert('프로필이 수정되었습니다! ✨');
                closeProfileEditModal();
                myPostsServerRendered = false;
                likedPostsLoaded = false;
                location.href = `/mypage?user=${encodeURIComponent(data.user.username)}`;
            } else {
                alert(data.reason || '프로필 수정에 실패했습니다.');
            }
        })
        .catch(error => {
            console.error('Profile Update Error:', error);
            alert('프로필 수정 중 문제가 발생했습니다.');
        });
}

// ── Streak & Grass Calendar ───────────────────────────────────

let postActivityMap  = {};
let pomActivityMap   = {};
let currentStreakTab = 'all';

function toISODate(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function mergedActivityMap() {
    const m = {};
    Object.entries(postActivityMap).forEach(([d, n]) => { m[d] = (m[d] || 0) + n; });
    Object.entries(pomActivityMap).forEach(([d, n])  => { m[d] = (m[d] || 0) + n; });
    return m;
}

async function loadStreak(username) {
    const loadingEl = document.getElementById('streak-loading');

    // 포모도로 히스토리 (localStorage)
    const histKey = `pomodoro_${username}_history`;
    let pomHistory = {};
    try { pomHistory = JSON.parse(localStorage.getItem(histKey) || '{}'); } catch {}

    // 공부기록 포스트 날짜 (서버 API)
    let postDates = new Set();
    try {
        const res = await fetch(`/api/streak/${encodeURIComponent(username)}`);
        const data = await res.json();
        (data.study_dates || []).forEach(d => postDates.add(d));
    } catch {}

    // 소스별로 분리 저장
    postActivityMap = {};
    pomActivityMap  = {};
    postDates.forEach(d => { postActivityMap[d] = (postActivityMap[d] || 0) + 1; });
    Object.entries(pomHistory).forEach(([d, v]) => {
        pomActivityMap[d] = (pomActivityMap[d] || 0) + Math.floor((v.totalSec || 0) / 60);
    });

    if (loadingEl) loadingEl.textContent = '';

    switchStreakTab('post');
}

function switchStreakTab(tab) {
    currentStreakTab = tab;
    ['post', 'pom'].forEach(t => {
        const btn = document.getElementById(`streak-tab-${t}`);
        if (btn) btn.className = `streak-tab-btn ${t === tab ? 'streak-tab-active' : 'streak-tab-inactive'}`;
    });
    const map = tab === 'post' ? postActivityMap : pomActivityMap;
    renderStreakStats(calculateStreaks(map));
    renderStreakCalendar(map);
}

function calculateStreaks(activityMap) {
    const dayMs = 86400000;
    const today = toISODate(new Date());

    // 현재 스트릭: 오늘부터 거슬러 올라가며 연속 체크
    let current = 0;
    const d = new Date(today);
    while (activityMap[toISODate(d)]) {
        current++;
        d.setDate(d.getDate() - 1);
    }

    // 최장 스트릭 및 총 공부일
    const sortedDates = Object.keys(activityMap).sort();
    const total = sortedDates.length;
    let longest = 0;
    let run = 0;
    for (let i = 0; i < sortedDates.length; i++) {
        if (i === 0) {
            run = 1;
        } else {
            const prev = new Date(sortedDates[i - 1]);
            const curr = new Date(sortedDates[i]);
            run = (curr - prev) / dayMs === 1 ? run + 1 : 1;
        }
        longest = Math.max(longest, run);
    }

    return { current, longest, total };
}

function renderStreakStats({ current, longest, total }) {
    const el = id => document.getElementById(id);
    if (el('streak-current')) {
        el('streak-current').textContent = current;
        el('streak-current').style.color =
            current >= 7 ? '#f59e0b' : current >= 3 ? '#10b981' : '#34d399';
    }
    if (el('streak-longest')) el('streak-longest').textContent = longest;
    if (el('streak-total'))   el('streak-total').textContent   = total;
}

function renderStreakCalendar(activityMap) {
    const grid = document.getElementById('grass-grid');
    if (!grid) return;

    // 오늘 기준 이번주 토요일까지, 16주(112일) 표시
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + (6 - today.getDay())); // 이번주 토요일

    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 7 * 16 + 1); // 16주 전 일요일

    const todayISO = toISODate(today);
    const cells = [];
    const d = new Date(startDate);
    while (d <= endDate) {
        cells.push(toISODate(d));
        d.setDate(d.getDate() + 1);
    }

    function getColor(n) {
        if (!n) return '#f0fdf4';
        if (n < 10)  return '#a7f3d0';
        if (n < 30)  return '#34d399';
        if (n < 60)  return '#059669';
        return '#065f46';
    }

    grid.innerHTML = cells.map(dateStr => {
        const n = activityMap[dateStr] || 0;
        const isToday = dateStr === todayISO;
        const unit = currentStreakTab === 'post' ? '개' : '분';
        const tip = n > 0 ? `${dateStr}: ${n}${unit}` : dateStr;
        return `<div class="grass-cell${isToday ? ' grass-today' : ''}" style="background:${getColor(n)};" title="${tip}"></div>`;
    }).join('');
}

/**
 * 회원탈퇴 함수
 */
async function deleteAccount() {
    const confirmed = confirm('정말 탈퇴하시겠습니까?\n모든 데이터가 삭제되며 복구할 수 없습니다.');
    if (!confirmed) return;

    const doubleConfirmed = confirm('재확인: 정말 탈퇴하시겠습니까?\n(이 작업은 되돌릴 수 없습니다)');
    if (!doubleConfirmed) return;

    const user = await getCurrentUser();
    if (!user) {
        alert('로그인이 필요합니다.');
        location.href = '/login';
        return;
    }

    fetch('/api/user/delete', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: user.username
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.message === 'success') {
                alert('탈퇴되었습니다. 안녕히 가세요! 🍀');
                location.href = '/';
            } else {
                alert(data.reason || '탈퇴 처리 중 문제가 발생했습니다.');
            }
        })
        .catch(error => {
            console.error('Delete Account Error:', error);
            alert('탈퇴 중 오류가 발생했습니다.');
        });
}
