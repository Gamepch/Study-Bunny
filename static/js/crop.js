/**
 * crop.js — 1:1 이미지 크롭 (Cropper.js 기반)
 * queueCropFiles(files, callback) 를 호출하면
 * 파일을 순서대로 크롭 모달에 띄우고,
 * 완료된 File[] 을 callback 으로 반환한다.
 */
(function () {
    var _cropper = null;
    var _queue = [];
    var _results = [];
    var _done = null;

    /* ── 공개 API ─────────────────────────────── */

    window.queueCropFiles = function (files, callback) {
        _queue = Array.from(files);
        _results = [];
        _done = callback;
        _next();
    };

    window.confirmCrop = function () {
        if (!_cropper) return;
        var btn = document.getElementById('crop-confirm-btn');
        if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

        _cropper.getCroppedCanvas({
            width: 800,
            height: 800,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        }).toBlob(function (blob) {
            _resetBtn();
            if (blob) {
                _results.push(new File([blob], 'crop_' + Date.now() + '.webp', { type: 'image/webp' }));
            }
            _close();
            _next();
        }, 'image/webp', 0.85);
    };

    window.cancelCrop = function () {
        _queue = [];
        _close();
        var cb = _done;
        _done = null;
        if (cb) cb(_results.slice());
        _results = [];
    };

    /* ── 내부 함수 ────────────────────────────── */

    function _next() {
        if (_queue.length === 0) {
            var cb = _done;
            _done = null;
            if (cb) cb(_results);
            return;
        }
        _openFile(_queue.shift());
    }

    function _openFile(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var modal = document.getElementById('crop-modal');
            var img = document.getElementById('crop-image');
            if (!modal || !img) return;

            document.body.appendChild(modal); // 항상 body 맨 끝으로 이동 (stacking 보장)
            modal.style.zIndex = '9999';
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            if (_cropper) { _cropper.destroy(); _cropper = null; }

            img.addEventListener('load', function onLoad() {
                img.removeEventListener('load', onLoad);
                _cropper = new Cropper(img, {
                    aspectRatio: 1,
                    viewMode: 3,
                    autoCropArea: 1,
                    dragMode: 'move',
                    responsive: true,
                    background: false,
                    guides: false,
                    center: false,
                    highlight: false,
                    cropBoxMovable: false,
                    cropBoxResizable: false,
                    toggleDragModeOnDblclick: false,
                });
            });

            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function _close() {
        var modal = document.getElementById('crop-modal');
        if (modal) modal.classList.add('hidden');
        document.body.style.overflow = '';
        if (_cropper) { _cropper.destroy(); _cropper = null; }
        _resetBtn();
    }

    function _resetBtn() {
        var btn = document.getElementById('crop-confirm-btn');
        if (btn) { btn.disabled = false; btn.textContent = '완료'; }
    }
})();
