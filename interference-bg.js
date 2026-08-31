/* ==============================================================
   Interference Field — 히어로 배경
   class="hero-canvas" 를 가진 <canvas> 에 자동으로 적용됩니다.

   세 개의 음원에서 나온 파동을 중첩해 밀도장을 계산합니다.
   선을 긋지 않고, 낮은 해상도로 계산한 뒤 확대해서 그립니다.
   확대할 때 브라우저 보간이 부드럽게 뭉개주므로 도표가 아니라
   질감으로 읽힙니다.
   ============================================================== */
(function () {
    'use strict';

    /* ----------------------------------------------------------
       [튜닝] 값을 바꾸려면 여기만 고치면 됩니다.
       density     진하기        (0.3 ~ 2.2)
       wavelength  무늬 크기      (0.5 ~ 2.4, 클수록 무늬가 큼)
       softness    계산 해상도    (3 ~ 12, 클수록 흐릿함)
       grain       입자 양        (0 ~ 2.5)
       grainPixel  입자 크기(px)  (1 ~ 8)
       ---------------------------------------------------------- */
    const CONFIG = {
        density: 1.0,
        wavelength: 1.0,
        softness: 6,
        grain: 1.0,
        grainPixel: 3
    };

    /* ----------------------------------------------------------
       외부 구동값. 3D 지도에서 소리가 재생되면 그쪽이 채웁니다.
       아무도 채우지 않으면 0 이므로 이 파일 단독으로도 예전과 똑같이 돕니다.
       level    전체 크기        0~1
       lowBand  저역(무늬 크기)   0~1
       highBand 고역(입자감)      0~1
       ---------------------------------------------------------- */
    const DRIVE = (window.__interferenceDrive =
        window.__interferenceDrive || { level: 0, lowBand: 0, highBand: 0 });

    // ---------- 그레인 타일 ----------
    // 매 프레임 픽셀을 만들면 무거우므로 타일 하나를 만들어 위치만 흔들어 재사용
    const GRAIN = { block: CONFIG.grainPixel, tile: null, size: 0 };
    (function buildGrain(block) {
        const size = block * 42;                 // 타일은 블록의 배수여야 이음새가 없습니다
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        for (let y = 0; y < size; y += block) {
            for (let x = 0; x < size; x += block) {
                const v = (Math.random() * 255) | 0;
                g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
                g.fillRect(x, y, block, block);
            }
        }
        GRAIN.block = block; GRAIN.tile = c; GRAIN.size = size;
    })(CONFIG.grainPixel);

    function paintGrain(ctx, w, h, alpha) {
        if (alpha <= 0.003 || !GRAIN.tile) return;
        const b = GRAIN.block, size = GRAIN.size;
        // 오프셋을 블록 단위로 스냅해야 픽셀 격자가 어긋나지 않습니다
        const ox = -Math.floor(Math.random() * (size / b)) * b;
        const oy = -Math.floor(Math.random() * (size / b)) * b;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = 'multiply';
        ctx.imageSmoothingEnabled = false;
        for (let gx = ox; gx < w; gx += size) {
            for (let gy = oy; gy < h; gy += size) ctx.drawImage(GRAIN.tile, gx, gy);
        }
        ctx.restore();
    }

    // ---------- sin 룩업 테이블 ----------
    // 픽셀마다 Math.sin 을 부르면 부담이 커집니다
    const LUT_N = 2048;
    const SIN = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) SIN[i] = Math.sin((i / LUT_N) * Math.PI * 2);
    const LUT_K = LUT_N / (Math.PI * 2);
    function fsin(a) {
        let i = (a * LUT_K) | 0;
        i %= LUT_N; if (i < 0) i += LUT_N;
        return SIN[i];
    }

    // 0 도 유효한 값이므로 falsy 검사로는 안 됩니다
    function num(v, fallback) {
        const n = parseFloat(v);
        return isFinite(n) ? n : fallback;
    }

    function init(canvas) {
        const host = canvas.parentElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        /* 캔버스마다 data- 속성으로 덮어쓸 수 있습니다.
           상세 페이지 헤더처럼 영역이 얕은 곳은 무늬를 작게, 옅게 잡아야 읽힙니다.
           예: <canvas class="hero-canvas" data-density="0.75" data-wavelength="0.6"> */
        const cfg = {
            density:    num(canvas.dataset.density,    CONFIG.density),
            wavelength: num(canvas.dataset.wavelength, CONFIG.wavelength),
            softness:   num(canvas.dataset.softness,   CONFIG.softness)
        };

        const low = document.createElement('canvas');
        const lowCtx = low.getContext('2d');
        let lw = 1, lh = 1, lowImg = null;
        let W = 0, H = 0, dpr = 1, t = 0;
        // 구동값은 캔버스마다 따로 따라갑니다 (급변 방지용 1차 저역통과)
        let dLevel = 0, dLow = 0, dHigh = 0;

        /* 세 음원. 파장을 어긋난 비율로 두어야 무늬가 규칙적으로
           반복되지 않고 계속 새로 태어납니다. */
        const SRC = [
            { hx: 0.24, hy: 0.30, wl: 172, sp: 0.0130, amp: 1.00, dx:  0.00031, dy:  0.00021, ph: 0   },
            { hx: 0.72, hy: 0.58, wl: 231, sp: 0.0094, amp: 0.92, dx: -0.00024, dy:  0.00029, ph: 2.1 },
            { hx: 0.52, hy: 0.86, wl: 297, sp: 0.0071, amp: 0.78, dx:  0.00018, dy: -0.00026, ph: 4.4 }
        ];

        let pointerX = null, pointerY = null;

        function rebuildLow() {
            lw = Math.max(48, Math.min(300, Math.round(W / cfg.softness)));
            lh = Math.max(32, Math.round(lw * H / Math.max(1, W)));
            low.width = lw; low.height = lh;
            lowImg = lowCtx.createImageData(lw, lh);
        }

        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = host.offsetWidth;
            H = host.offsetHeight;
            if (W < 2 || H < 2) return;
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            canvas.style.width = W + 'px';
            canvas.style.height = H + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            rebuildLow();
        }
        window.addEventListener('resize', resize);

        host.addEventListener('mousemove', function (e) {
            const r = host.getBoundingClientRect();
            pointerX = (e.clientX - r.left) / r.width;
            pointerY = (e.clientY - r.top) / r.height;
        });
        host.addEventListener('mouseleave', function () { pointerX = pointerY = null; });
        host.addEventListener('touchmove', function (e) {
            const p = e.touches[0]; if (!p) return;
            const r = host.getBoundingClientRect();
            pointerX = (p.clientX - r.left) / r.width;
            pointerY = (p.clientY - r.top) / r.height;
        }, { passive: true });
        host.addEventListener('touchend', function () { pointerX = pointerY = null; });

        function computeField() {
            if (!lowImg) return;
            const data = lowImg.data;
            const stepX = W / lw, stepY = H / lh;

            /* 소리에 반응하는 폭은 아주 좁아야 합니다.
               듣지 않는 사람은 차이를 알아채지 못해야 하고,
               크게 움직이는 순간 음악 비주얼라이저가 됩니다. */
            const densNow = cfg.density    * (1 + dLevel * 0.28);
            const wlNow   = cfg.wavelength * (1 + dLow   * 0.10);

            const s = SRC.map(function (o) {
                return {
                    x: o.hx * W,
                    y: o.hy * H,
                    k: (Math.PI * 2) / (o.wl * wlNow),
                    w: o.sp, a: o.amp, ph: o.ph
                };
            });
            const invSum = 1 / (s[0].a + s[1].a + s[2].a);

            let p = 0;
            for (let yi = 0; yi < lh; yi++) {
                const py = (yi + 0.5) * stepY;
                // 위아래 가장자리는 서서히 사라지게 — 화면에 갇힌 느낌을 없앱니다
                const ey = Math.min(1, Math.min(yi, lh - 1 - yi) / (lh * 0.30));
                for (let xi = 0; xi < lw; xi++) {
                    const px = (xi + 0.5) * stepX;

                    let v = 0;
                    for (let i = 0; i < 3; i++) {
                        const si = s[i];
                        const dx = px - si.x, dy = py - si.y;
                        const d = Math.sqrt(dx * dx + dy * dy);
                        v += si.a * fsin(d * si.k - t * si.w + si.ph);
                    }
                    v *= invSum;                 // -1 ~ 1
                    v = v * 0.5 + 0.5;           // 0 ~ 1
                    v = v * v * (3 - 2 * v);     // smoothstep — 마루를 살짝 강조

                    const fx = xi / Math.max(1, lw - 1);
                    const ex = Math.min(1, Math.min(xi, lw - 1 - xi) / (lw * 0.22));
                    const bias = 0.55 + 0.45 * fx;   // 글자가 놓이는 왼쪽은 조금 더 옅게

                    const a = v * ey * ex * bias * densNow * 0.30;

                    data[p] = 26; data[p + 1] = 26; data[p + 2] = 30;
                    data[p + 3] = (a * 255) | 0;
                    p += 4;
                }
            }
            lowCtx.putImageData(lowImg, 0, 0);
        }

        /* 화면 밖으로 나가면 루프를 멈춥니다.
           이게 없으면 히어로를 지나 한참 스크롤한 뒤에도 매 프레임 밀도장을
           계산하느라 CPU 를 계속 쓰게 되고, 페이지가 무거워집니다. */
        let visible = true;
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                const wasVisible = visible;
                visible = entries[0].isIntersecting;
                if (visible && !wasVisible) requestAnimationFrame(frame);   // 다시 보이면 재개
            }, { rootMargin: '120px' }).observe(host);
        }

        let odd = false;
        function frame() {
            if (!visible) return;          // 멈춤 (다시 보일 때 재개)
            t += 1;

            /* 스무딩을 걸지 않으면 배경이 깜빡여 즉시 조잡해집니다.
               0.045 는 대략 0.4초에 걸쳐 따라붙는 속도입니다. */
            dLevel += (DRIVE.level    - dLevel) * 0.045;
            dLow   += (DRIVE.lowBand  - dLow)   * 0.045;
            dHigh  += (DRIVE.highBand - dHigh)  * 0.045;

            SRC.forEach(function (o, i) {
                o.hx += o.dx; o.hy += o.dy;
                if (o.hx < 0.08 || o.hx > 0.92) o.dx *= -1;
                if (o.hy < 0.10 || o.hy > 0.90) o.dy *= -1;
                if (i === 0 && pointerX !== null) {
                    o.hx += (pointerX - o.hx) * 0.010;
                    o.hy += (pointerY - o.hy) * 0.010;
                }
            });

            // 움직임이 느리므로 두 프레임에 한 번만 다시 계산합니다
            odd = !odd;
            if (!odd) computeField();

            ctx.clearRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(low, 0, 0, W, H);

            paintGrain(ctx, W, H, 0.030 * CONFIG.grain * (1 + dHigh * 0.30));

            if (!reduceMotion) requestAnimationFrame(frame);
        }

        resize();
        computeField();
        frame();
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('canvas.hero-canvas').forEach(init);
    });
})();
