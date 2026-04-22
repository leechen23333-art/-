(function () {
    'use strict';

    // ==================== 配置项 ====================
    const CONFIG = {
        TICK_INTERVAL: 1500,        // 主循环间隔(ms)
        VIDEO_SPEED: 2.00,          // 视频倍速（平台最大 2.00x）
        NEXT_PAGE_DELAY: 500,       // 提交答案后跳下一页的延迟(ms)
        API_BASE: 'https://api.ulearning.cn',
    };

    // ==================== 工具函数 ====================
    const utils = {
        safeClick($el) {
            if ($el && $el.length > 0) { $el[0].click(); return true; }
            return false;
        },
        isVideoFinished(index) {
            return !!$("[data-bind='text: $root.i18nMessageText().finished']").get(index);
        },
        getVideos() {
            return $(".file-media");
        },
    };

    // ==================== 日志管理器 ====================
    const log = {
        logs: [],
        $modal: null,

        init() {
            this.$modal = $(`
<div id="yx-log-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:999999;">
    <div style="width:700px;max-height:80vh;margin:60px auto;background:#fff;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:16px 20px;background:#f5f5f5;font-weight:bold;font-size:15px;display:flex;justify-content:space-between;align-items:center;">
            <span>📋 刷课日志</span>
            <span id="yx-log-close" style="cursor:pointer;font-size:20px;">×</span>
        </div>
        <div id="yx-log-body" style="padding:16px;overflow-y:auto;flex:1;font-size:13px;line-height:1.8;font-family:monospace;"></div>
        <div style="padding:12px 20px;text-align:right;background:#f5f5f5;">
            <button id="yx-log-copy" style="margin-right:8px;padding:6px 14px;cursor:pointer;">复制日志</button>
            <button id="yx-log-confirm" style="padding:6px 14px;cursor:pointer;">关闭</button>
        </div>
    </div>
</div>`);
            $('body').append(this.$modal);
            $('#yx-log-close, #yx-log-confirm').click(() => this.$modal.hide());
            $('#yx-log-copy').click(() => {
                const text = this.logs.map(l => `[${l.time}] ${l.info}`).join('\n');
                navigator.clipboard.writeText(text).then(() => alert('已复制'));
            });
        },

        add(info, level = 'info') {
            const time = new Date().toLocaleTimeString();
            this.logs.push({ time, info, level });
            console.log(`[刷课][${level}] ${info}`);
            if (this.$modal && this.$modal.is(':visible')) this._render();
        },

        _render() {
            const colors = { info: '#333', warn: '#e67e22', error: '#e74c3c', success: '#27ae60' };
            const html = this.logs.map(l =>
                `<div style="color:${colors[l.level]||'#333'}">[${l.time}] ${l.info}</div>`
            ).join('');
            $('#yx-log-body').html(html || '<div style="color:#999">暂无日志</div>');
            $('#yx-log-body').scrollTop(99999);
        },

        show() { this._render(); this.$modal.show(); },
    };

    // ==================== 视频处理器（全部用原生 video API）====================
    const videoHandler = {

        // 同步倍速 UI（点击对应 radio，让界面标签也更新）
        _syncSpeedUI(index) {
            const $container = $('.mejs__button.mejs__playpause-button button')
                .eq(index).closest('.mejs__container');
            if (!$container.length) return;

            const target = CONFIG.VIDEO_SPEED.toFixed(2); // e.g. "2.00"
            const $inputs = $container.find('.mejs__speed-selector-input');
            const $speedBtn = $container.find('.mejs__button.mejs__speed-button button');

            let matched = false;
            $inputs.each(function () {
                if (this.value === target) {
                    this.click();
                    if ($speedBtn.length) $speedBtn[0].innerText = target + 'x';
                    matched = true;
                    return false;
                }
            });

            if (!matched) {
                // 平台不支持该倍速，取最大可用值
                $inputs.first().click();
                const maxVal = $inputs.first().val();
                if ($speedBtn.length) $speedBtn[0].innerText = maxVal + 'x';
                log.add(`平台不支持 ${target}x，已设为最大值 ${maxVal}x`, 'warn');
            }
        },

        tryPlay(index) {
            const videoEl = $("video").get(index);
            if (!videoEl) {
                log.add(`找不到 video[${index}]`, 'warn');
                return;
            }

            // 1. 原生设置倍速（实际生效）
            videoEl.playbackRate = CONFIG.VIDEO_SPEED;
            // 2. 同步 UI 标签（界面显示正确倍速）
            this._syncSpeedUI(index);

            if (!videoEl.paused) return; // 已在播放

            videoEl.play().then(() => {
                log.add(`▶ 视频${index + 1} 开始播放 (${CONFIG.VIDEO_SPEED}x)`, 'success');
            }).catch(e => {
                log.add(`play() 被拦截，fallback 点击按钮: ${e.message}`, 'warn');
                const $btn = $('.mejs__button.mejs__playpause-button button').eq(index);
                if ($btn.length) $btn[0].click();
            });
        },

        pauseAll() {
            $("video").each(function () { if (!this.paused) this.pause(); });
        },

        handle() {
            const $videos = utils.getVideos();
            if ($videos.length === 0) return false;

            for (let i = 0; i < $videos.length; i++) {
                if (!utils.isVideoFinished(i)) {
                    const videoEl = $("video").get(i);
                    if (videoEl) {
                        // 每次 tick 都保持倍速（防止页面重置）
                        if (videoEl.playbackRate !== CONFIG.VIDEO_SPEED) {
                            videoEl.playbackRate = CONFIG.VIDEO_SPEED;
                        }
                        if (videoEl.paused) {
                            this.tryPlay(i);
                        }
                    }
                    return true;
                }
            }

            // 所有视频完成，翻下一页
            log.add('✅ 当前页视频全部完成，翻下一页', 'success');
            utils.safeClick($('.next-page-btn.cursor'));
            return true;
        }
    };

    // ==================== 答题器 ====================
    const respondent = {
        answer(parentId, $questionNode) {
            const questionId = ($questionNode.find('.question-wrapper').attr('id') || '').substring(8);
            if (!questionId) { log.add('找不到题目ID', 'warn'); return; }

            const type = $questionNode.find('.question-type-tag').text().trim();
            const data = this._getAnswer(questionId, parentId);
            if (!data || !data.correctAnswerList) {
                log.add(`获取答案失败 qid=${questionId}`, 'error'); return;
            }
            const ans = data.correctAnswerList;

            const map = {
                '多选题': () => {
                    $questionNode.find('.checkbox.selected').each(function () { this.click(); });
                    ans.forEach(a => $questionNode.find('.checkbox').eq(a.charCodeAt(0) - 65).each(function(){ this.click(); }));
                },
                '单选题': () => {
                    ans.forEach(a => $questionNode.find('.checkbox').eq(a.charCodeAt(0) - 65).each(function(){ this.click(); }));
                },
                '判断题': () => {
                    const v = ans[0];
                    const isTrue = v === true || v === 'true' || v === '正确';
                    utils.safeClick($questionNode.find(isTrue ? '.choice-btn.right-btn' : '.choice-btn.wrong-btn'));
                },
                '填空题': () => {
                    ans.forEach((a, i) => $questionNode.find('.blank-input').eq(i).val(a).trigger('input').trigger('change'));
                },
                '简答题': () => {
                    ans.forEach((a, i) => {
                        const clean = a.replace(/【答案要点】/g, '').trim();
                        $questionNode.find('.form-control').eq(i).val(clean).trigger('input').trigger('change');
                    });
                },
                '综合题': () => {},
            };

            if (map[type]) map[type]();
            else log.add(`未知题型: ${type}`, 'warn');
        },

        _getAnswer(questionId, parentId) {
            try {
                return $.ajax({
                    url: `${CONFIG.API_BASE}/questionAnswer/${questionId}?parentId=${parentId}`,
                    async: false, timeout: 5000,
                }).responseJSON;
            } catch (e) {
                log.add('请求答案出错: ' + e.message, 'error');
                return null;
            }
        }
    };

    // ==================== 弹窗处理器 ====================
    const modalHandler = {
        handle() {
            const $modal = $('.modal.fade.in');
            if ($modal.length === 0) return false;
            const id = $modal.attr('id');
            if (id === 'statModal') {
                utils.safeClick($("#statModal .btn-hollow").eq(-1));
            } else if (id === 'alertModal') {
                const $hollow = $("#alertModal .btn-hollow");
                utils.safeClick($hollow.length ? $hollow.eq(-1) : $("#alertModal .btn-submit"));
            } else {
                log.add(`未知对话框: #${id}`, 'warn');
            }
            return true;
        }
    };

    // ==================== 页面变化监听（轮询重试）====================
    const pageObserver = {
        observer: null,
        lastPageName: '',
        debounceTimer: null,
        retryTimer: null,

        init(onPageChange) {
            this.observer = new MutationObserver(() => {
                const current = $('.page-name.active').text().trim();
                if (!current || current === this.lastPageName) return;

                // 防抖：100ms 内只处理最后一次
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.lastPageName = current;
                    log.add(`📄 页面变化: ${current}`);
                    clearTimeout(this.retryTimer);
                    this._waitAndPlay(onPageChange, 0);
                }, 100);
            });

            const target = document.querySelector('.page-content-area') || document.body;
            this.observer.observe(target, { childList: true, subtree: true });
        },

        // 轮询等待 video 元素就绪，最多重试 10 次（每次 600ms）
        _waitAndPlay(onPageChange, attempt) {
            const MAX = 10, INTERVAL = 600;
            const $videos = utils.getVideos();
            const videoCount = $("video").length;

            if ($videos.length > 0 && videoCount >= $videos.length) {
                log.add(`🎬 视频就绪（第${attempt + 1}次检测）`, 'success');
                onPageChange();
                return;
            }

            // 无视频页，等 2 轮后放行
            if ($videos.length === 0 && attempt >= 2) {
                onPageChange();
                return;
            }

            if (attempt >= MAX) {
                log.add('⚠️ 等待视频超时，强制触发', 'warn');
                onPageChange();
                return;
            }

            this.retryTimer = setTimeout(() => this._waitAndPlay(onPageChange, attempt + 1), INTERVAL);
        },

        destroy() {
            clearTimeout(this.debounceTimer);
            clearTimeout(this.retryTimer);
            if (this.observer) { this.observer.disconnect(); this.observer = null; }
            this.lastPageName = '';
        }
    };

    // ==================== 主控制器 ====================
    const youxueyuan = {
        timer: null,
        isRunning: false,

        init() {
            this._injectUI();
            log.init();
            log.add('🚀 脚本已加载', 'success');
        },

        _injectUI() {
            $('body').append($(`
<div id="yx-panel" style="position:fixed;bottom:30px;right:30px;z-index:999998;display:flex;flex-direction:column;gap:8px;">
    <button id="yx-start" style="padding:10px 18px;background:#4CAF50;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.2);">▶ 开始刷课</button>
    <button id="yx-stop"  style="padding:10px 18px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.2);display:none;">⏸ 暂停刷课</button>
    <button id="yx-log"   style="padding:8px 18px;background:#3498db;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.2);">📋 查看日志</button>
</div>`));
            $('#yx-start').click(() => this.start());
            $('#yx-stop').click(() => this.stop());
            $('#yx-log').click(() => log.show());
        },

        start() {
            if (this.isRunning) return;
            this.isRunning = true;
            log.add('▶ 刷课开始', 'success');
            $('#yx-start').hide(); $('#yx-stop').show();

            this.tick();
            this.timer = setInterval(() => this.tick(), CONFIG.TICK_INTERVAL);

            pageObserver.init(() => {
                if (this.isRunning) {
                    log.add('🔄 页面跳转，触发播放');
                    videoHandler.handle();
                }
            });
        },

        stop() {
            if (!this.isRunning) return;
            this.isRunning = false;
            clearInterval(this.timer);
            pageObserver.destroy();
            videoHandler.pauseAll();
            $('#yx-stop').hide(); $('#yx-start').show();
            log.add('⏸ 已暂停', 'warn');
            log.show();
        },

        tick() {
            try {
                if (modalHandler.handle()) return;
                if (videoHandler.handle()) return;
                if (this._handleQuestions()) return;
                utils.safeClick($('.next-page-btn.cursor'));
            } catch (e) {
                log.add('主循环出错: ' + e.message, 'error');
            }
        },

        _handleQuestions() {
            if ($('.question-setting-panel').length === 0) return false;

            const $submitBtn = $('.question-operation-area button').eq(0);
            if ($submitBtn.text().trim() === '重做') { $submitBtn[0].click(); return true; }

            const pageIdAttr = ($('.page-name.active').parent().attr('id') || '');
            const parentId = pageIdAttr.substring(4);
            if (!parentId) { log.add('获取页面ID失败', 'warn'); return true; }

            const $questions = $('.question-element-node');
            log.add(`📝 答题中，共 ${$questions.length} 题`);
            $questions.each((i, el) => respondent.answer(parentId, $(el)));

            utils.safeClick($submitBtn);
            setTimeout(() => utils.safeClick($('.next-page-btn.cursor')), CONFIG.NEXT_PAGE_DELAY);
            return true;
        }
    };

    youxueyuan.init();

})();
