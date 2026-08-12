(function () {
    'use strict';

    const body = document.body;
    const generateButton = document.getElementById('btnGeneratePrompt');
    const phaseLabel = document.getElementById('aiProcessPhase');
    const processVisual = document.getElementById('aiProcessVisual');
    const workflowItems = Array.from(document.querySelectorAll('[data-workflow-step]'));
    const cards = {
        mode: document.getElementById('card-mode'),
        upload: document.getElementById('card-upload'),
        config: document.getElementById('card-config'),
        output: document.getElementById('card-output')
    };

    const phases = [
        'Preparando contexto visual',
        'Mapeando identidade e referências',
        'Equalizando pose, luz e textura',
        'Compondo instruções de síntese',
        'Protegendo a saída final'
    ];

    let phaseTimer = 0;
    let phaseIndex = 0;

    function startProcessVisual() {
        body.classList.add('ai-busy');
        processVisual?.setAttribute('aria-hidden', 'false');
        phaseIndex = 0;
        if (phaseLabel) phaseLabel.textContent = phases[phaseIndex];
        window.clearInterval(phaseTimer);
        phaseTimer = window.setInterval(() => {
            phaseIndex = (phaseIndex + 1) % phases.length;
            if (phaseLabel) phaseLabel.textContent = phases[phaseIndex];
        }, 1450);
    }

    function stopProcessVisual() {
        body.classList.remove('ai-busy');
        processVisual?.setAttribute('aria-hidden', 'true');
        window.clearInterval(phaseTimer);
        phaseTimer = 0;
    }

    if (generateButton) {
        const generationObserver = new MutationObserver(() => {
            if (generateButton.classList.contains('is-generating')) startProcessVisual();
            else stopProcessVisual();
        });
        generationObserver.observe(generateButton, { attributes: true, attributeFilter: ['class'] });
    }

    function isVisible(element) {
        return Boolean(element && window.getComputedStyle(element).display !== 'none');
    }

    function updateWorkflow() {
        let current = 'mode';
        if (isVisible(cards.upload)) current = 'upload';
        if (isVisible(cards.config)) current = 'config';
        if (isVisible(cards.output)) current = 'output';

        const order = ['mode', 'upload', 'config', 'output'];
        const currentIndex = order.indexOf(current);
        workflowItems.forEach((item) => {
            const index = order.indexOf(item.dataset.workflowStep);
            item.classList.toggle('is-current', index === currentIndex);
            item.classList.toggle('is-complete', index < currentIndex);
        });
    }

    Object.values(cards).forEach((card) => {
        if (!card) return;
        const cardObserver = new MutationObserver(updateWorkflow);
        cardObserver.observe(card, { attributes: true, attributeFilter: ['style', 'class'] });
    });

    document.addEventListener('change', (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.[0]) return;

        const zone = input.closest('.upload-dropzone');
        if (!zone) return;

        const previousPreview = zone.querySelector('.upload-preview');
        if (previousPreview?.dataset.objectUrl) URL.revokeObjectURL(previousPreview.dataset.objectUrl);
        previousPreview?.remove();

        const objectUrl = URL.createObjectURL(input.files[0]);
        const preview = document.createElement('img');
        preview.className = 'upload-preview';
        preview.alt = '';
        preview.src = objectUrl;
        preview.dataset.objectUrl = objectUrl;
        zone.prepend(preview);
        zone.classList.add('loaded');
    });

    document.addEventListener('click', (event) => {
        if (event.target.closest('.mode-option-btn, #btnProceedToConfig')) {
            window.setTimeout(updateWorkflow, 30);
        }
    });

    window.addEventListener('pageshow', updateWorkflow);
    updateWorkflow();

    window.addEventListener('pagehide', () => {
        window.clearInterval(phaseTimer);
        document.querySelectorAll('.upload-preview[data-object-url]').forEach((image) => {
            URL.revokeObjectURL(image.dataset.objectUrl);
        });
    }, { once: true });
})();
