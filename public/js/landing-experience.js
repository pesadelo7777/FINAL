(function () {
    'use strict';

    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const smoothstep = (value) => value * value * (3 - 2 * value);
    const svgOrigins = new WeakMap();

    function addMediaListener(query, handler) {
        if (typeof query.addEventListener === 'function') query.addEventListener('change', handler);
        else if (typeof query.addListener === 'function') query.addListener(handler);
    }

    function removeMediaListener(query, handler) {
        if (typeof query.removeEventListener === 'function') query.removeEventListener('change', handler);
        else if (typeof query.removeListener === 'function') query.removeListener(handler);
    }

    function getSvgOrigin(fragment) {
        if (svgOrigins.has(fragment)) return svgOrigins.get(fragment);

        let origin = { x: 160, y: 160 };
        try {
            const box = fragment.getBBox();
            if (Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0) {
                origin = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
            }
        } catch (error) {
            void error;
            // Some mobile SVG engines delay geometry until the first paint.
        }

        svgOrigins.set(fragment, origin);
        return origin;
    }

    function setNativeSvgTransform(fragment, x, y, rotation, scale) {
        const origin = getSvgOrigin(fragment);
        const negativeOriginX = (-origin.x).toFixed(3);
        const negativeOriginY = (-origin.y).toFixed(3);
        fragment.style.removeProperty('transform');
        fragment.setAttribute(
            'transform',
            `translate(${x.toFixed(3)} ${y.toFixed(3)}) translate(${origin.x.toFixed(3)} ${origin.y.toFixed(3)}) rotate(${rotation.toFixed(3)}) scale(${scale.toFixed(4)}) translate(${negativeOriginX} ${negativeOriginY})`
        );
    }

    function clearNativeSvgTransform(fragment) {
        fragment.style.removeProperty('transform');
        fragment.removeAttribute('transform');
    }

    function createVectorMark(index) {
        const metal = `lifevu-metal-${index}`;
        const energy = `lifevu-energy-${index}`;
        const lens = `lifevu-lens-${index}`;
        const glow = `lifevu-glow-${index}`;

        return `
            <svg class="lifevu-mark-svg" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
                <defs>
                    <linearGradient id="${metal}" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stop-color="#fff"/><stop offset=".46" stop-color="#a7a9af"/>
                        <stop offset=".7" stop-color="#f7f7f4"/><stop offset="1" stop-color="#777b83"/>
                    </linearGradient>
                    <radialGradient id="${energy}" cx="50%" cy="50%" r="62%">
                        <stop offset="0" stop-color="#ff4d6a"/><stop offset=".28" stop-color="#d51d3b"/>
                        <stop offset=".68" stop-color="#780f25"/><stop offset="1" stop-color="#25040c"/>
                    </radialGradient>
                    <clipPath id="${lens}"><path d="M31 160 83 106l77-43 77 43 52 54-52 54-77 43-77-43Z"/></clipPath>
                    <filter id="${glow}" x="-60%" y="-60%" width="220%" height="220%">
                        <feGaussianBlur stdDeviation="9" result="blur"/>
                        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>

                <g class="mark-fragment" data-fragment data-x="0" data-y="-74" data-r="-16" style="--fragment-delay:.12s;--loader-x:0px;--loader-y:-86px;--loader-r:-18deg" fill="#101116" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="miter">
                    <path d="M160 17 260 76l-25 38-75-48-75 48-25-38Z"/>
                </g>
                <g class="mark-fragment" data-fragment data-x="74" data-y="0" data-r="18" style="--fragment-delay:.23s;--loader-x:88px;--loader-y:0px;--loader-r:22deg" fill="#101116" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="miter">
                    <path d="m260 76 43 84-43 84-42-31 41-53-41-53Z"/>
                </g>
                <g class="mark-fragment" data-fragment data-x="0" data-y="74" data-r="16" style="--fragment-delay:.34s;--loader-x:0px;--loader-y:86px;--loader-r:18deg" fill="#101116" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="miter">
                    <path d="m260 244-100 59-100-59 25-38 75 48 75-48Z"/>
                </g>
                <g class="mark-fragment" data-fragment data-x="-74" data-y="0" data-r="-18" style="--fragment-delay:.45s;--loader-x:-88px;--loader-y:0px;--loader-r:-22deg" fill="#101116" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="miter">
                    <path d="M60 244 17 160 60 76l42 31-41 53 41 53Z"/>
                </g>

                <g class="mark-fragment mark-lattice" data-fragment data-x="0" data-y="0" data-r="-28" style="--fragment-delay:.58s;--loader-x:0px;--loader-y:0px;--loader-r:-44deg">
                    <g class="mark-lattice-lines" clip-path="url(#${lens})" fill="none" stroke="#d9dbe0" stroke-width="1.5" opacity=".76">
                        <path d="M-40 44 247 331M-18 22l287 287M4 0l287 287M26-22l287 287M48-44l287 287M70-66l287 287M92-88l287 287"/>
                        <path d="M360 44 73 331M338 22 51 309M316 0 29 287M294-22 7 265M272-44-15 243M250-66-37 221M228-88-59 199"/>
                    </g>
                    <path d="M31 160 83 106l77-43 77 43 52 54-52 54-77 43-77-43Z" fill="none" stroke="url(#${metal})" stroke-width="6"/>
                </g>

                <g class="mark-fragment" data-fragment data-x="0" data-y="-42" data-r="-34" style="--fragment-delay:.68s;--loader-x:0px;--loader-y:-56px;--loader-r:-36deg" fill="#17181d" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="round"><path d="m160 75 44 18-29 66-34-27Z"/></g>
                <g class="mark-fragment" data-fragment data-x="38" data-y="-20" data-r="34" style="--fragment-delay:.76s;--loader-x:50px;--loader-y:-28px;--loader-r:38deg" fill="#17181d" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="round"><path d="m233 118 6 47-71 8-4-43Z"/></g>
                <g class="mark-fragment" data-fragment data-x="38" data-y="22" data-r="-34" style="--fragment-delay:.84s;--loader-x:50px;--loader-y:30px;--loader-r:-38deg" fill="#17181d" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="round"><path d="m233 202-38 29-43-57 36-24Z"/></g>
                <g class="mark-fragment" data-fragment data-x="0" data-y="42" data-r="34" style="--fragment-delay:.92s;--loader-x:0px;--loader-y:56px;--loader-r:36deg" fill="#17181d" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="round"><path d="m160 245-44-18 29-66 34 27Z"/></g>
                <g class="mark-fragment" data-fragment data-x="-38" data-y="22" data-r="-34" style="--fragment-delay:1s;--loader-x:-50px;--loader-y:30px;--loader-r:-38deg" fill="#17181d" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="round"><path d="m87 202-6-47 71-8 4 43Z"/></g>
                <g class="mark-fragment" data-fragment data-x="-38" data-y="-20" data-r="34" style="--fragment-delay:1.08s;--loader-x:-50px;--loader-y:-28px;--loader-r:38deg" fill="#17181d" stroke="url(#${metal})" stroke-width="5" stroke-linejoin="round"><path d="m87 118 38-29 43 57-36 24Z"/></g>

                <g class="mark-fragment" data-fragment data-x="0" data-y="0" data-r="60" style="--fragment-delay:1.18s;--loader-x:0px;--loader-y:0px;--loader-r:72deg">
                    <polygon points="160,116 198,138 198,182 160,204 122,182 122,138" fill="url(#${energy})" stroke="url(#${metal})" stroke-width="5"/>
                </g>
                <g class="mark-core-energy">
                    <circle cx="160" cy="160" r="61" fill="url(#${energy})" opacity=".32" filter="url(#${glow})"/>
                    <circle cx="160" cy="160" r="22" fill="#d51d3b" opacity=".34" filter="url(#${glow})"/>
                    <circle cx="160" cy="160" r="5" fill="#fff" opacity=".94"/>
                </g>
            </svg>`;
    }

    Array.from(document.querySelectorAll('[data-lifevu-mark]')).forEach((host, index) => {
        host.insertAdjacentHTML('beforeend', createVectorMark(index));
        host.classList.add('is-vectorized');
    });

    const loader = document.querySelector('.brand-loader');
    const loaderStartedAt = performance.now();
    const mobileMotion = window.matchMedia('(max-width: 820px), (pointer: coarse)');
    const loaderFragments = Array.from(document.querySelectorAll('.loader-mark [data-fragment]'));
    const loaderLatticeLines = document.querySelector('.loader-mark .mark-lattice-lines');
    const loaderCoreEnergy = document.querySelector('.loader-mark .mark-core-energy');
    let loaderEnded = false;
    let loaderReleaseTimer = 0;
    let loaderSafetyTimer = 0;
    let loaderVectorFrame = 0;

    function cssNumber(element, property, multiplier = 1) {
        const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
        return Number.isFinite(value) ? value * multiplier : 0;
    }

    function renderNativeLoader(now) {
        loaderVectorFrame = 0;
        if (!loader || loaderEnded || !mobileMotion.matches) return;

        const elapsed = now - loaderStartedAt;
        let lastFragmentEnd = 0;

        loaderFragments.forEach((fragment) => {
            const delay = cssNumber(fragment, '--fragment-delay', 1000);
            const duration = 920;
            const progress = smoothstep(clamp((elapsed - delay) / duration, 0, 1));
            const gap = 1 - progress;
            const x = cssNumber(fragment, '--loader-x') * gap;
            const y = cssNumber(fragment, '--loader-y') * gap;
            const rotation = cssNumber(fragment, '--loader-r') * gap;

            fragment.style.opacity = String(progress);
            setNativeSvgTransform(fragment, x, y, rotation, 0.62 + (0.38 * progress));
            lastFragmentEnd = Math.max(lastFragmentEnd, delay + duration);
        });

        if (loaderLatticeLines) {
            const lattice = smoothstep(clamp((elapsed - 980) / 1280, 0, 1));
            loaderLatticeLines.style.strokeDasharray = '320';
            loaderLatticeLines.style.strokeDashoffset = String(320 * (1 - lattice));
        }

        if (loaderCoreEnergy) {
            const ignition = smoothstep(clamp((elapsed - 1760) / 780, 0, 1));
            loaderCoreEnergy.style.opacity = String(ignition);
            setNativeSvgTransform(loaderCoreEnergy, 0, 0, 0, 0.2 + (0.8 * ignition));
        }

        if (elapsed < Math.max(2750, lastFragmentEnd + 420)) {
            loaderVectorFrame = requestAnimationFrame(renderNativeLoader);
        }
    }

    function startNativeLoader() {
        if (!loader || !mobileMotion.matches) return;
        loader.classList.add('uses-native-vector-motion');
        loaderVectorFrame = requestAnimationFrame(renderNativeLoader);
    }

    function endLoader() {
        if (!loader || loaderEnded) return;
        loaderEnded = true;
        cancelAnimationFrame(loaderVectorFrame);
        loaderVectorFrame = 0;
        window.clearTimeout(loaderReleaseTimer);
        window.clearTimeout(loaderSafetyTimer);
        window.clearTimeout(window.__lifevuLoaderFallback);
        loader.classList.add('is-leaving');
        loader.setAttribute('aria-hidden', 'true');
        root.classList.add('loader-complete');
        window.setTimeout(() => {
            if (loader.parentNode) loader.parentNode.removeChild(loader);
        }, reducedMotion.matches ? 280 : 560);
        try { sessionStorage.setItem('lifevu-booted', '1'); } catch (error) {
            void error;
            // Private browsing can disable sessionStorage without affecting motion.
        }
    }

    let alreadyBooted = false;
    try { alreadyBooted = sessionStorage.getItem('lifevu-booted') === '1'; } catch (error) {
        void error;
        alreadyBooted = false;
    }
    const minimumLoaderTime = mobileMotion.matches
        ? 3400
        : reducedMotion.matches
            ? 1100
            : (alreadyBooted ? 2850 : 3150);

    function releaseLoaderWhenReady() {
        const remaining = Math.max(0, minimumLoaderTime - (performance.now() - loaderStartedAt));
        loaderReleaseTimer = window.setTimeout(endLoader, remaining);
    }

    if (document.readyState === 'complete') releaseLoaderWhenReady();
    else window.addEventListener('load', releaseLoaderWhenReady, { once: true });
    loaderSafetyTimer = window.setTimeout(endLoader, minimumLoaderTime + 1800);
    startNativeLoader();

    const revealItems = Array.from(document.querySelectorAll('[data-reveal]'));
    let revealObserver = null;

    function configureReveals() {
        if (revealObserver) revealObserver.disconnect();
        revealObserver = null;

        if ('IntersectionObserver' in window && !reducedMotion.matches) {
            revealObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-visible');
                    revealObserver.unobserve(entry.target);
                });
            }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

            revealItems.forEach((item) => revealObserver.observe(item));
            root.classList.add('reveal-ready');
        } else {
            root.classList.remove('reveal-ready');
            revealItems.forEach((item) => item.classList.add('is-visible'));
        }
    }

    const header = document.querySelector('.top-navbar');
    const navToggle = document.getElementById('navToggle');
    const nav = document.getElementById('primaryNav');

    function closeMenu() {
        if (!navToggle || !nav) return;
        navToggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
    }

    if (navToggle) navToggle.addEventListener('click', () => {
        const open = navToggle.getAttribute('aria-expanded') === 'true';
        navToggle.setAttribute('aria-expanded', String(!open));
        if (nav) nav.classList.toggle('is-open', !open);
        if (header) header.classList.remove('is-hidden');
    });

    if (nav) Array.from(nav.querySelectorAll('a, button')).forEach((item) => item.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenu();
    });

    Array.from(document.querySelectorAll('[data-open-login]')).forEach((button) => {
        button.addEventListener('click', () => {
            const loginButton = document.getElementById('openLoginBtn');
            if (loginButton) loginButton.click();
        });
    });

    const tabs = Array.from(document.querySelectorAll('[data-case]'));
    const panels = Array.from(document.querySelectorAll('[data-case-panel]'));

    function selectCase(name) {
        tabs.forEach((tab) => {
            const selected = tab.dataset.case === name;
            tab.classList.toggle('is-active', selected);
            tab.setAttribute('aria-selected', String(selected));
        });
        panels.forEach((panel) => {
            const selected = panel.dataset.casePanel === name;
            panel.classList.toggle('is-active', selected);
            panel.setAttribute('aria-hidden', String(!selected));
        });
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => selectCase(tab.dataset.case)));

    const hero = document.querySelector('.assembly-hero');
    const heroStage = document.querySelector('.hero-stage');
    const heroFragments = Array.from(document.querySelectorAll('.assembly-core [data-fragment]'));
    const heroLatticeLines = document.querySelector('.assembly-core .mark-lattice-lines');
    const viewport = window.visualViewport;
    let frame = 0;
    let settleFrames = 0;
    let lastHeaderScrollY = window.scrollY;
    let downwardTravel = 0;
    let upwardTravel = 0;
    let motionDestroyed = false;
    let fontsReadyCancelled = false;
    const resizeObserver = 'ResizeObserver' in window
        ? new ResizeObserver(() => handleResize())
        : null;

    if (hero && heroStage && heroFragments.length) {
        root.classList.add('motion-ready');
    }

    function getHeroMetrics() {
        if (!hero) return { progress: 1, visible: false };
        const viewportHeight = viewport && viewport.height ? viewport.height : window.innerHeight;
        const rect = hero.getBoundingClientRect();
        const travel = Math.max(1, rect.height - viewportHeight);
        return {
            progress: clamp(-rect.top / travel, 0, 1),
            visible: rect.bottom > 0 && rect.top < viewportHeight
        };
    }

    function updateHeader(scrollY) {
        if (!header) return;
        const delta = scrollY - lastHeaderScrollY;
        const menuIsOpen = navToggle && navToggle.getAttribute('aria-expanded') === 'true';

        header.classList.toggle('is-scrolled', scrollY > 24);

        if (delta > 0.5) {
            downwardTravel += delta;
            upwardTravel = 0;
        } else if (delta < -0.5) {
            upwardTravel += Math.abs(delta);
            downwardTravel = 0;
        }

        if (!menuIsOpen && scrollY > 120 && downwardTravel >= 20) {
            header.classList.add('is-hidden');
            downwardTravel = 0;
        }

        if (menuIsOpen || scrollY < 80 || upwardTravel >= 12) {
            header.classList.remove('is-hidden');
            upwardTravel = 0;
        }

        lastHeaderScrollY = scrollY;
    }

    function renderHero(progress) {
        if (!hero || !heroStage) return;
        const isMobile = mobileMotion.matches;
        const simplifiedMotion = reducedMotion.matches;
        const assemblyTimeline = clamp(progress / 0.7, 0, 1);
        const assembly = smoothstep(assemblyTimeline);
        const activation = smoothstep(clamp((progress - 0.74) / 0.16, 0, 1));
        const exit = smoothstep(clamp((progress - 0.97) / 0.03, 0, 1));
        const assemblyBlur = simplifiedMotion ? 0 : (isMobile ? 7 : 10);
        const activationBlur = simplifiedMotion ? 0 : (isMobile ? 9 : 12);
        const mediaBlur = simplifiedMotion ? 0 : (isMobile ? 11 : 18);
        const mediaShift = isMobile ? 46 : 70;

        root.style.setProperty('--assembly-rotate', `${-38 + (38 * assembly)}deg`);
        root.style.setProperty('--assembly-scale', String(0.54 + (0.46 * assembly)));
        root.style.setProperty('--assembly-opacity', String(0.5 + (0.5 * assembly)));
        root.style.setProperty('--assembly-blur', `${assemblyBlur * (1 - assembly)}px`);
        root.style.setProperty('--activation-opacity', String(activation));
        root.style.setProperty('--activation-blur', `${activationBlur * (1 - activation)}px`);
        root.style.setProperty('--activation-shift', `${12 * (1 - activation)}px`);
        root.style.setProperty('--copy-shift', `${-52 * exit}px`);
        root.style.setProperty('--media-opacity', String(activation * (1 - (exit * 0.34))));
        root.style.setProperty('--media-shift', `${mediaShift * (1 - activation)}px`);
        root.style.setProperty('--media-blur', `${mediaBlur * (1 - activation)}px`);
        root.style.setProperty('--media-scale', String(0.88 + (0.12 * activation)));
        root.style.setProperty('--scroll-cue-opacity', String(1 - smoothstep(clamp(progress / 0.11, 0, 1))));
        heroStage.classList.toggle('is-activated', progress >= 0.74 && activation > 0.01);

        const staggerWindow = 0.18;
        const fragmentDivisor = Math.max(1, heroFragments.length - 1);
        heroFragments.forEach((fragment, index) => {
            const stagger = (index / fragmentDivisor) * staggerWindow;
            const fragmentProgress = smoothstep(clamp((assemblyTimeline - stagger) / (1 - staggerWindow), 0, 1));
            const gap = 1 - fragmentProgress;
            const x = Number(fragment.dataset.x || 0) * gap;
            const y = Number(fragment.dataset.y || 0) * gap;
            const rotation = Number(fragment.dataset.r || 0) * gap;
            fragment.style.opacity = String(0.46 + (0.54 * fragmentProgress));
            setNativeSvgTransform(fragment, x, y, rotation, 0.62 + (0.38 * fragmentProgress));
        });

        if (heroLatticeLines) {
            heroLatticeLines.style.strokeDasharray = '320';
            heroLatticeLines.style.strokeDashoffset = String(320 * (1 - assembly));
        }
    }

    function renderScrollState() {
        frame = 0;
        if (motionDestroyed || document.hidden) return;
        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        updateHeader(scrollY);

        const metrics = getHeroMetrics();
        if (hero) hero.classList.toggle('is-motion-active', metrics.visible);

        if (hero && (!reducedMotion.matches || mobileMotion.matches)) {
            // Same model used by Pesadelo: paint the real geometry immediately.
            renderHero(metrics.progress);
        }

        if (settleFrames > 0 && document.visibilityState === 'visible') {
            settleFrames -= 1;
            frame = requestAnimationFrame(renderScrollState);
        }
    }

    function scheduleScrollState() {
        settleFrames = Math.max(settleFrames, 2);
        if (!motionDestroyed && !frame && document.visibilityState === 'visible') {
            frame = requestAnimationFrame(renderScrollState);
        }
    }

    function handleResize() {
        settleFrames = Math.max(settleFrames, 4);
        scheduleScrollState();
    }

    function handleMobileMotionChange() {
        if (mobileMotion.matches && !loaderEnded && !loaderVectorFrame) startNativeLoader();
        setReducedState();
    }

    function setReducedState() {
        if (reducedMotion.matches && !mobileMotion.matches) {
            cancelAnimationFrame(frame);
            frame = 0;
            root.style.setProperty('--assembly-rotate', '0deg');
            root.style.setProperty('--assembly-scale', '1');
            root.style.setProperty('--assembly-opacity', '1');
            root.style.setProperty('--assembly-blur', '0px');
            root.style.setProperty('--activation-opacity', '1');
            root.style.setProperty('--activation-blur', '0px');
            root.style.setProperty('--activation-shift', '0px');
            root.style.setProperty('--copy-shift', '0px');
            root.style.setProperty('--media-opacity', '.76');
            root.style.setProperty('--media-shift', '0px');
            root.style.setProperty('--media-blur', '0px');
            root.style.setProperty('--media-scale', '1');
            if (heroStage) heroStage.classList.add('is-activated');
            heroFragments.forEach((fragment) => {
                fragment.style.opacity = '1';
                clearNativeSvgTransform(fragment);
            });
            if (heroLatticeLines) heroLatticeLines.style.strokeDashoffset = '0';
            if (hero) hero.classList.remove('is-motion-active');
        } else {
            const metrics = getHeroMetrics();
            renderHero(metrics.progress);
        }
        configureReveals();
        handleResize();
    }

    function handlePageShow(event) {
        if (event.persisted) {
            const metrics = getHeroMetrics();
            if (!reducedMotion.matches || mobileMotion.matches) renderHero(metrics.progress);
        }
        handleResize();
    }

    function handleVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            cancelAnimationFrame(frame);
            frame = 0;
        } else {
            scheduleScrollState();
        }
    }

    function destroyMotion() {
        if (motionDestroyed) return;
        motionDestroyed = true;
        fontsReadyCancelled = true;
        cancelAnimationFrame(frame);
        frame = 0;
        cancelAnimationFrame(loaderVectorFrame);
        loaderVectorFrame = 0;
        if (revealObserver) revealObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        window.removeEventListener('scroll', scheduleScrollState);
        window.removeEventListener('touchmove', scheduleScrollState);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        window.removeEventListener('pageshow', handlePageShow);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (viewport) {
            viewport.removeEventListener('resize', handleResize);
            viewport.removeEventListener('scroll', scheduleScrollState);
        }
        removeMediaListener(reducedMotion, setReducedState);
        removeMediaListener(mobileMotion, handleMobileMotionChange);
    }

    setReducedState();
    window.addEventListener('scroll', scheduleScrollState, { passive: true });
    window.addEventListener('touchmove', scheduleScrollState, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (viewport) {
        viewport.addEventListener('resize', handleResize, { passive: true });
        viewport.addEventListener('scroll', scheduleScrollState, { passive: true });
    }
    addMediaListener(reducedMotion, setReducedState);
    addMediaListener(mobileMotion, handleMobileMotionChange);
    if (resizeObserver) {
        if (hero) resizeObserver.observe(hero);
        if (heroStage) resizeObserver.observe(heroStage);
    }
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            if (!fontsReadyCancelled) handleResize();
        });
    }

    window.addEventListener('pagehide', (event) => {
        cancelAnimationFrame(frame);
        frame = 0;
        if (!event.persisted) destroyMotion();
    });
})();
