/*
 * 사운드 아티스트 컨셉의 옅은 오실로스코프 파형 배경 애니메이션.
 * class="hero-canvas" 를 가진 모든 <canvas> 요소에 자동으로 적용됨.
 * (히어로 섹션, 프로젝트 상세페이지 헤더 등 여러 곳에서 재사용)
 */
(function () {
    function initWave(canvas) {
        const host = canvas.parentElement;
        const ctx = canvas.getContext('2d');
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        let width, height, dpr;
        let mouseX = 0.5;
        let targetMouseX = 0.5;
        let t = Math.random() * 1000; // 캔버스마다 위상을 다르게 시작해 서로 겹쳐 보이지 않게 함

        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = host.offsetWidth;
            height = host.offsetHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        window.addEventListener('resize', resize);
        resize();

        host.addEventListener('mousemove', function (e) {
            const rect = host.getBoundingClientRect();
            targetMouseX = (e.clientX - rect.left) / rect.width;
        });
        host.addEventListener('mouseleave', function () {
            targetMouseX = 0.5;
        });

        // data-density 속성으로 섹션 크기에 맞춰 진폭 조절 (예: 상세페이지 헤더는 더 작게)
        const density = parseFloat(canvas.dataset.density || '1');

        const lines = [
            { baseAmp: 16 * density, freq: 1.4, speed: 0.015, phase: 0, color: 'rgba(26,26,26,0.09)' },
            { baseAmp: 24 * density, freq: 0.9, speed: 0.010, phase: 2, color: 'rgba(26,26,26,0.06)' },
            { baseAmp: 32 * density, freq: 0.6, speed: 0.007, phase: 4, color: 'rgba(26,26,26,0.045)' }
        ];

        function frame() {
            t += 1;
            mouseX += (targetMouseX - mouseX) * 0.03;
            ctx.clearRect(0, 0, width, height);

            lines.forEach(function (line, i) {
                const ampBoost = 1 + (mouseX - 0.5) * 1.2 * (i % 2 === 0 ? 1 : -1);
                const amp = line.baseAmp * Math.max(0.3, ampBoost);
                const yCenter = height * (0.35 + i * 0.16);

                ctx.beginPath();
                for (let x = 0; x <= width; x += 4) {
                    const y = yCenter + Math.sin((x * line.freq * 0.01) + t * line.speed + line.phase) * amp;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = line.color;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            });

            if (!prefersReducedMotion) requestAnimationFrame(frame);
        }

        frame();
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('canvas.hero-canvas').forEach(initWave);
    });
})();
