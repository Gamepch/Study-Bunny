/**
 * Global State
 */
let currentPostData = null;
let editExistingImages = [];
let editNewImages = [];

document.addEventListener('DOMContentLoaded', async () => {
    loadEditFormComponent();
    checkLoginStatus();
    const currentUser = await getCurrentUser();
    if (window.__POST_DATA__) {
        currentPostData = window.__POST_DATA__;
        applyPostMetadata(currentPostData);
        if (currentUser && currentUser.username) {
            fetchPostDetail(POST_ID, currentUser.username, true);
        }
    } else {
        if (currentUser && currentUser.username) {
            fetchPostDetail(POST_ID, currentUser.username);
        } else {
            fetchPostDetail(POST_ID);
        }
    }
});

/**
 * Retrieve current logged-in user from server session.
 * @returns {Promise<Object|null>} User object or null if not logged in.
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
 * Check login status and render the auth zone in the header.
 * Post 페이지에서는 auth-zone을 완전히 비운다.
 */
function checkLoginStatus() {
    const authZone = document.getElementById('auth-zone');
    if (!authZone) return;
    // post 페이지에서는 auth-zone을 비움 (어떤 로그인 버튼도 표시 안 함)
    authZone.innerHTML = '';
    authZone.style.display = 'none';
}

/**
 * Handle user logout logic.
 */
function handleLogout() {
    if (confirm("로그아웃 하시겠어요? 🍀")) {
        fetch('/api/logout', { method: 'POST' })
            .then(() => location.reload())
            .catch(err => {
                console.error('Logout error:', err);
                alert('로그아웃 중 오류가 발생했습니다.');
            });
    }
}

/**
 * Global state for tracking liked posts from backend.
 */
let likedPostsState = {};
let editingCommentId = null;

/**
 * Update the liked posts state for current user.
 * @param {number} postId 
 * @param {boolean} isLiked 
 */
function setLikedPost(postId, isLiked = true) {
    likedPostsState[postId] = isLiked;
}

/**
 * Check if a specific post ID has been liked.
 * @param {number} postId 
 * @returns {boolean}
 */
function hasLikedPost(postId) {
    return likedPostsState[postId] === true;
}

/**
 * Update the UI state of the like button.
 * @param {number} postId 
 */
function updateLikeButtonState(postId) {
    const likeBtn = document.getElementById('like-btn');
    if (!likeBtn) return;

    if (hasLikedPost(postId)) {
        likeBtn.disabled = true;
        likeBtn.classList.add('opacity-50', 'cursor-not-allowed');
        likeBtn.title = '이미 좋아요를 눌렀습니다.';
    } else {
        likeBtn.disabled = false;
        likeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        likeBtn.title = '좋아요';
    }
}

/**
 * Load the shared form component for editing posts.
 */
function loadEditFormComponent() {
    fetch('/component/form')
        .then(res => res.text())
        .then(html => {
            const container = document.getElementById('edit-form-container');
            if (container) {
                container.innerHTML = html;
                const imgInput = document.getElementById('modal-image-input');
                if (imgInput) imgInput.onchange = previewEditImages;
            }
        });
}

function previewEditImages(event) {
    const files = Array.from(event.target.files);
    const remaining = 5 - editExistingImages.length - editNewImages.length;
    const toProcess = files.slice(0, remaining);
    event.target.value = '';
    if (toProcess.length === 0) return;

    queueCropFiles(toProcess, function(croppedFiles) {
        croppedFiles.forEach(f => editNewImages.push(f));
        renderEditPreview();
    });
}

function renderEditPreview() {
    const grid = document.getElementById('modal-preview-grid');
    const container = document.getElementById('modal-preview-container');
    if (!grid) return;
    const total = editExistingImages.length + editNewImages.length;
    if (total === 0) {
        if (container) container.classList.add('hidden');
        grid.innerHTML = '';
        return;
    }
    if (container) container.classList.remove('hidden');
    grid.innerHTML = '';

    editExistingImages.forEach(function(url, idx) {
        const thumb = document.createElement('div');
        thumb.className = 'img-preview-thumb';
        thumb.innerHTML = `<img src="${url}" alt="기존 이미지">
            <button type="button" class="remove-btn" onclick="removeExistingEditImage(${idx})">✕</button>`;
        grid.appendChild(thumb);
    });

    editNewImages.forEach(function(file, idx) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const thumb = document.createElement('div');
            thumb.className = 'img-preview-thumb';
            thumb.innerHTML = `<img src="${e.target.result}" alt="새 이미지">
                <button type="button" class="remove-btn" onclick="removeNewEditImage(${idx})">✕</button>`;
            grid.appendChild(thumb);
        };
        reader.readAsDataURL(file);
    });
}

function removeExistingEditImage(idx) {
    editExistingImages.splice(idx, 1);
    renderEditPreview();
}

function removeNewEditImage(idx) {
    editNewImages.splice(idx, 1);
    renderEditPreview();
}

/**
 * Fetch detailed information for a specific post.
 * @param {number} postId 
 */
function fetchPostDetail(postId, username = null, noCount = false) {
    setLikedPost(postId, false);
    const params = new URLSearchParams();
    if (username) {
        params.set('username', username);
    }
    if (noCount) {
        params.set('nocount', '1');
    }

    const query = params.toString();
    const url = query ? `/api/feeds/${postId}?${query}` : `/api/feeds/${postId}`;

    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error('Post not found.');
            return response.json();
        })
        .then(data => {
            syncPostFromApi(data);
        })
        .catch(error => {
            console.error(error);
            document.getElementById('post-container').innerHTML = `
                <div class="text-center text-red-400 py-10">
                    글을 불러오는데 실패했어요. 😢<br>삭제되거나 없는 글일 수 있습니다.
                </div>
            `;
        });
}

/**
 * Sync API data without replacing server-rendered post body when possible.
 * @param {Object} post
 */
async function syncPostFromApi(post) {
    const listEl = document.getElementById('comments-list');
    if (listEl) {
        currentPostData = post;
        await applyPostMetadata(post);
        updatePostStatsInDom(post);
        await refreshCommentsSection(post);
        return;
    }
    await renderPostDetail(post);
}

/**
 * @param {HTMLElement} listEl
 * @param {Array|undefined} comments
 * @returns {boolean}
 */
function commentsNeedUpdate(listEl, comments) {
    const nextIds = (comments || []).map(comment => comment.id).join(',');
    return listEl.dataset.commentIds !== nextIds;
}

/**
 * Update like count and comment count labels in the existing DOM.
 * @param {Object} post
 */
function updatePostStatsInDom(post) {
    const likeCount = document.getElementById('like-count');
    if (likeCount) likeCount.textContent = post.likes;

    const inlineCount = document.getElementById('inline-comment-count');
    if (inlineCount) inlineCount.textContent = post.comment_count;

    updateCommentCountDisplay(post.comment_count);
}

/**
 * Update comment count badges.
 * @param {number} count
 */
function updateCommentCountDisplay(count) {
    document.querySelectorAll('[data-comment-count]').forEach(el => {
        el.textContent = count;
    });
}

/**
 * Re-render only the comments list (not the full post).
 * @param {Object} post
 */
async function refreshCommentsSection(post) {
    const listEl = document.getElementById('comments-list');
    if (!listEl) return;

    const currentUser = await getCurrentUser();
    listEl.innerHTML = renderCommentsList(post.comments, currentUser);
    listEl.dataset.commentIds = (post.comments || []).map(comment => comment.id).join(',');
    updateCommentCountDisplay(post.comment_count);
}

/**
 * Apply author buttons and like state without re-rendering content.
 * @param {Object} post
 */
async function applyPostMetadata(post) {
    const editBtn = document.getElementById('edit-button');
    const deleteBtn = document.getElementById('delete-button');
    const currentUser = await getCurrentUser();
    const isAuthor = post.is_author || (currentUser && post.username && (currentUser.username === post.username || currentUser.is_admin));

    if (editBtn) {
        editBtn.style.display = isAuthor ? 'inline-flex' : 'none';
        if (isAuthor) {
            editBtn.onclick = function () {
                openEditModal(currentPostData);
            };
        }
    }
    if (deleteBtn) {
        deleteBtn.style.display = isAuthor ? 'inline-flex' : 'none';
    }

    setLikedPost(post.id, post.liked_by_current_user === true);
    updateLikeButtonState(post.id);
}

/**
 * Render the post details including title, content, image, and metadata.
 * @param {Object} post 
 */
async function renderPostDetail(post) {
    const container = document.getElementById('post-container');

    const imgs = post.images && post.images.length ? post.images : (post.image_url ? [post.image_url] : []);
    let imageHTML = '';
    if (imgs.length === 1) {
        imageHTML = `<div class="mt-6 w-full rounded-2xl overflow-hidden bg-emerald-50">
            <img src="${imgs[0]}" alt="첨부 이미지" class="w-full h-auto object-cover">
        </div>`;
    } else if (imgs.length > 1) {
        const slides = imgs.map((u, i) => `<div class="img-slider-slide"><img src="${u}" alt="첨부 이미지 ${i + 1}" class="w-full h-auto object-cover"></div>`).join('');
        const dots = imgs.map((_, i) => `<span class="img-slider-dot${i === 0 ? ' active' : ''}"></span>`).join('');
        imageHTML = `<div class="mt-6 w-full rounded-2xl overflow-hidden bg-emerald-50">
            <div class="img-slider" data-slider>
                <div class="img-slider-track">${slides}</div>
                <button class="img-slider-prev">‹</button>
                <button class="img-slider-next">›</button>
                <div class="img-slider-dots">${dots}</div>
            </div>
        </div>`;
    }
    const formattedContent = post.content.replace(/\n/g, '<br>');
    const currentUser = await getCurrentUser();

    container.innerHTML = `
        <h1 class="text-2xl font-bold text-gray-800 mb-4 leading-snug">${post.title}</h1>
        
        <div class="flex justify-between items-center border-b border-emerald-50 pb-4 mb-6">
            <div class="flex items-center">
                <img src="${post.profile_url}" alt="프로필" class="w-10 h-10 rounded-full object-cover border border-emerald-100">
                <div class="ml-3">
                    <a href="/mypage?user=${post.username}" class="font-bold text-gray-700 text-sm hover:text-emerald-500 hover:underline">${post.nickname}</a>
                    <div class="text-xs text-gray-400 mt-0.5">${post.date} · 조회 ${post.views}</div>
                </div>
            </div>
        </div>
        
        <div class="text-gray-700 leading-relaxed text-base min-h-[150px] break-all">
            ${formattedContent}
            ${imageHTML}
        </div>
        
        <div class="mt-8 pt-4 flex space-x-4 border-t border-emerald-50">
            <button id="like-btn" onclick="likePost(${post.id})" class="flex items-center text-emerald-400 hover:text-emerald-600 font-medium transition-all duration-200">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                좋아요 <span id="like-count" class="ml-1">${post.likes}</span>
            </button>
            <div class="flex items-center text-gray-400 font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                댓글 <span id="inline-comment-count">${post.comment_count}</span>
            </div>
        </div>

        <div id="comments-section" class="mt-8 bg-emerald-50/30 -mx-6 px-6 py-6 border-t border-emerald-50">
            <h3 class="text-sm font-bold text-gray-700 mb-4">댓글 <span class="text-emerald-500" data-comment-count>${post.comment_count}</span></h3>
            
            <div class="flex space-x-2 mb-6">
                <input type="text" id="comment-input" placeholder="댓글을 남겨보세요..." class="flex-1 p-3 text-sm border border-emerald-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-300" onkeypress="if(event.key === 'Enter') submitComment(${post.id})">
                <button onclick="submitComment(${post.id})" class="px-4 py-2 bg-emerald-400 text-white rounded-xl text-sm font-bold hover:bg-emerald-500 transition-colors whitespace-nowrap">등록</button>
            </div>

            <div id="comments-list" class="space-y-4" data-comment-ids="${(post.comments || []).map(c => c.id).join(',')}">
                ${renderCommentsList(post.comments, currentUser)}
            </div>
        </div>
    `;

    currentPostData = post;
    await applyPostMetadata(post);
    if (typeof initSliders === 'function') initSliders();
}

/**
 * Render the comments list HTML.
 * @param {Array} comments 
 * @returns {string} HTML string
 */
function renderCommentsList(comments, currentUser) {
    if (!comments || comments.length === 0) {
        return `<div class="text-center text-xs text-gray-400 py-4">아직 댓글이 없어요. 첫 댓글을 남겨보세요! 🍀</div>`;
    }

    return comments.map(comment => {
        const isOwner = currentUser && (currentUser.username === comment.username || currentUser.is_admin);
        const isEditing = editingCommentId === comment.id;
        return `
        <div class="flex items-start space-x-3">
            <img src="${comment.profile_url}" alt="프로필" class="w-8 h-8 rounded-full object-cover border border-emerald-100 bg-white">
            <div class="flex-1 bg-white rounded-2xl rounded-tl-none p-3 shadow-sm border border-emerald-50">
                <div class="flex justify-between items-start gap-2 mb-3">
                    <div>
                        <a href="/mypage?user=${comment.username}" class="font-bold text-gray-700 text-xs hover:text-emerald-500 hover:underline">${comment.nickname}</a>
                    </div>
                    <div class="flex items-center gap-2">
                        ${isOwner ? `
                            <button onclick="editComment(${comment.id})" class="text-[10px] text-emerald-500 hover:text-emerald-700">수정</button>
                            <button onclick="deleteComment(${comment.id})" class="text-[10px] text-red-500 hover:text-red-700">삭제</button>
                        ` : ''}
                        <button onclick="reportComment(${comment.id})" class="text-[10px] text-orange-500 hover:text-orange-700">신고</button>
                        <span class="text-[10px] text-gray-400">${comment.date}</span>
                    </div>
                </div>
                ${isEditing ? `
                    <textarea id="edit-comment-input-${comment.id}" class="w-full min-h-[88px] p-3 text-sm border border-emerald-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-300" rows="3">${escapeHtml(comment.content)}</textarea>
                    <div class="mt-3 flex justify-end gap-2">
                        <button onclick="cancelCommentEdit()" class="px-3 py-2 text-xs text-gray-500 bg-gray-100 rounded-full hover:bg-gray-200 transition">취소</button>
                        <button onclick="saveCommentEdit(${comment.id})" class="px-3 py-2 text-xs text-white bg-emerald-500 rounded-full hover:bg-emerald-600 transition">저장</button>
                    </div>
                ` : `
                    <p class="text-sm text-gray-600 break-all">${escapeHtml(comment.content)}</p>
                `}
            </div>
        </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Submit a comment to the server.
 * @param {number} postId 
 */
async function submitComment(postId) {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
        alert('댓글을 작성하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    const input = document.getElementById('comment-input');
    const content = input.value.trim();

    if (!content) {
        alert('댓글 내용을 입력해 주세요! 🍀');
        return;
    }

    fetch(`/api/feeds/${postId}/comments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: currentUser.username, content: content })
    })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(res => {
            if (res.status === 201) {
                input.value = '';
                fetchPostDetail(postId, currentUser.username);
                return;
            }
            alert(res.body.reason || '댓글 등록에 실패했어요.');
        })
        .catch(error => console.error('Comment Submission Error:', error));
}

/**
 * Handle liking a post.
 * @param {number} postId 
 */
async function likePost(postId) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('좋아요를 누르려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    if (hasLikedPost(postId)) {
        alert('이미 좋아요를 누르셨습니다!');
        return;
    }

    fetch(`/api/feeds/${postId}/like`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: currentUser.username })
    })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(res => {
            if (res.status !== 200) {
                alert(res.body.reason || '좋아요 처리에 실패했습니다.');
                throw new Error(res.body.reason || 'Like Error');
            }
            document.getElementById('like-count').innerText = res.body.likes;
            setLikedPost(postId, true);
            updateLikeButtonState(postId);

            const likeBtn = document.getElementById('like-btn');
            likeBtn.classList.add('scale-125');
            setTimeout(() => {
                likeBtn.classList.remove('scale-125');
            }, 150);
        })
        .catch(error => console.error('Like Submission Error:', error));
}

/**
 * Delete a post from the server.
 * @param {number} postId 
 */
async function deletePost(postId) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('삭제하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    if (!confirm('정말 이 글을 삭제하시겠어요? 🍀💦\n삭제된 글과 댓글은 복구할 수 없습니다.')) {
        return;
    }

    fetch(`/api/feeds/${postId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: currentUser.username })
    })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(res => {
            if (res.status !== 200) {
                alert(res.body.reason || '삭제 처리에 실패했습니다.');
                throw new Error(res.body.reason || 'Delete Error');
            }
            alert('글이 깔끔하게 삭제되었습니다! 🧹');
            window.location.href = '/';
        })
        .catch(error => {
            console.error('Delete Error:', error);
        });
}

/**
 * Report a post.
 * @param {number} postId
 */
async function reportPost(postId) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('신고하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    window.__reportTarget = {
        type: 'post',
        id: postId,
        postId: postId,
        username: currentPostData?.username
    };

    openReportModal();
}

/**
 * Report a comment.
 * @param {number} commentId
 */
async function reportComment(commentId) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('신고하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    const comment = currentPostData?.comments?.find(c => c.id === commentId);

    window.__reportTarget = {
        type: 'comment',
        id: commentId,
        postId: currentPostData?.id,
        username: comment?.username
    };

    openReportModal();
}

/**
 * Open report modal
 */
function openReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) {
        modal.classList.remove('hidden');
        // Reset form
        document.querySelectorAll('input[name="report-reason"]').forEach(el => el.checked = false);
        document.getElementById('report-description').value = '';

        // Set up submit handler
        document.getElementById('report-submit-btn').onclick = submitReport;
    }
}

/**
 * Close report modal
 */
function closeReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    window.__reportTarget = null;
}

/**
 * Submit report
 */
async function submitReport() {
    const currentUser = await getCurrentUser();
    const target = window.__reportTarget;

    if (!target) {
        alert('신고 대상을 찾을 수 없습니다.');
        return;
    }

    const selectedReason = document.querySelector('input[name="report-reason"]:checked');
    if (!selectedReason) {
        alert('신고 사유를 선택해주세요!');
        return;
    }

    const reason = selectedReason.value;
    const description = document.getElementById('report-description').value;

    fetch('/api/reports', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            reporter_username: currentUser.username,
            target_type: target.type,
            target_id: target.id,
            post_id: target.postId,
            target_username: target.username,
            reason: reason,
            description: description
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.message === 'success') {
                alert('신고가 접수되었습니다. 감사합니다! 🙏');
                closeReportModal();
            } else {
                alert(data.reason || '신고 처리에 실패했습니다.');
            }
        })
        .catch(error => {
            console.error('Report Error:', error);
            alert('신고 중 문제가 발생했습니다.');
        });
}

/**
 * Close report modal on ESC key
 */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('report-modal');
        if (modal && !modal.classList.contains('hidden')) {
            closeReportModal();
        }
    }
});

/**
 * Close report modal when clicking outside
 */
document.addEventListener('click', (e) => {
    const modal = document.getElementById('report-modal');
    if (modal && !modal.classList.contains('hidden')) {
        if (e.target === modal) {
            closeReportModal();
        }
    }
});

/**
 * Edit an existing comment.
 * @param {number} commentId
 */
async function editComment(commentId) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('댓글을 수정하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    const existingComment = currentPostData?.comments?.find(comment => comment.id === commentId);
    if (!existingComment) {
        alert('댓글을 찾을 수 없습니다.');
        return;
    }
    if (existingComment.username !== currentUser.username && !currentUser.is_admin) {
        alert('작성자만 댓글을 수정할 수 있습니다.');
        return;
    }

    editingCommentId = commentId;
    refreshCommentsSection(currentPostData);
}

async function saveCommentEdit(commentId) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('댓글을 수정하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    const textarea = document.getElementById(`edit-comment-input-${commentId}`);
    if (!textarea) {
        alert('댓글 수정 입력란을 찾을 수 없습니다.');
        return;
    }

    const updatedContent = textarea.value.trim();
    if (!updatedContent) {
        alert('댓글 내용을 입력해주세요!');
        return;
    }

    fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: currentUser.username, content: updatedContent })
    })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(res => {
            if (res.status === 200) {
                editingCommentId = null;
                fetchPostDetail(POST_ID, currentUser.username);
                return;
            }
            alert(res.body.reason || '댓글 수정에 실패했습니다.');
        })
        .catch(error => {
            console.error('Comment Edit Error:', error);
        });
}

function cancelCommentEdit() {
    editingCommentId = null;
    refreshCommentsSection(currentPostData);
}

/**
 * Delete an existing comment.
 * @param {number} commentId
 */
async function deleteComment(commentId) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('댓글을 삭제하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    if (!confirm('정말 이 댓글을 삭제하시겠어요?')) {
        return;
    }

    fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: currentUser.username })
    })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(res => {
            if (res.status === 200) {
                fetchPostDetail(POST_ID, currentUser.username);
                return;
            }
            alert(res.body.reason || '댓글 삭제에 실패했습니다.');
        })
        .catch(error => {
            console.error('Comment Delete Error:', error);
        });
}

/**
 * Toggle the edit post modal.
 */
function toggleEditModal() {
    const modal = document.getElementById('edit-modal');
    modal.classList.toggle('hidden');
}

/**
 * Open the edit modal and populate it with existing post data.
 * @param {Object} postData 
 */
function openEditModal(postData) {
    if (!postData) return;

    document.getElementById('modal-category').value = postData.category || "공부기록";
    document.getElementById('modal-title-input').value = postData.title;
    document.getElementById('modal-content-input').value = postData.content;

    editExistingImages = postData.images
        ? [...postData.images]
        : (postData.image_url ? [postData.image_url] : []);
    editNewImages = [];
    renderEditPreview();

    toggleEditModal();
}

/**
 * Submit edited post data to the server.
 */
async function submitEdit() {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        alert('수정하려면 먼저 로그인해주세요! 🍀');
        window.location.href = '/';
        return;
    }

    const category = document.getElementById('modal-category').value;
    const title = document.getElementById('modal-title-input').value;
    const content = document.getElementById('modal-content-input').value;

    if (!title.trim() || !content.trim()) {
        alert("제목과 내용을 입력해주세요!");
        return;
    }

    const formData = new FormData();
    formData.append('category', category);
    formData.append('title', title);
    formData.append('content', content);
    formData.append('username', currentUser.username);
    editExistingImages.forEach(url => formData.append('kept_images', url));
    editNewImages.forEach(f => formData.append('images', f));

    fetch(`/api/feeds/${POST_ID}`, { method: 'PUT', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.message === "success") {
                alert("공부 기록이 완벽하게 수정되었습니다! ✨");
                location.reload();
            } else {
                alert(data.reason || '수정 중 오류가 발생했습니다.');
            }
        })
        .catch(error => {
            console.error('Edit Error:', error);
            alert('수정 중 문제가 발생했습니다.');
        });
}
