document.addEventListener('DOMContentLoaded', () => {
    // 1. Controle dos Sliders (Atualiza os valores visuais L1-L5)
    const sliders = [
        { input: 'slider-rosto', display: 'val-rosto' },
        { input: 'slider-textura', display: 'val-textura' }
    ];

    sliders.forEach(s => {
        const inputEl = document.getElementById(s.input);
        const displayEl = document.getElementById(s.display);
        
        inputEl.addEventListener('input', (e) => {
            displayEl.textContent = `L${e.target.value}`;
        });
    });

    // 2. Evento de Geração do JSON
    const btnGenerate = document.getElementById('btn-generate');
    const outputArea = document.getElementById('output-json');

    btnGenerate.addEventListener('click', () => {
        // Captura os valores atuais da interface
        const params = {
            rosto: parseInt(document.getElementById('slider-rosto').value),
            textura: parseInt(document.getElementById('slider-textura').value)
        };

        // Chama o motor da Camada 4
        const resultJSON = compiler.generateAutoIgnitionJSON(params);
        
        // Exibe na tela formatado bonitinho
        outputArea.value = JSON.stringify(resultJSON, null, 2);
    });

    // 3. Sistema de Copiar para Área de Transferência
    const btnCopy = document.getElementById('btn-copy');
    btnCopy.addEventListener('click', () => {
        if (!outputArea.value) {
            alert("Gere o payload primeiro!");
            return;
        }

        outputArea.select();
        document.execCommand('copy');
        
        // Feedback visual no botão
        const textoOriginal = btnCopy.textContent;
        btnCopy.textContent = "JSON Copiado! ✓";
        btnCopy.style.backgroundColor = "#28a745"; // Fica verde rapidamente

        setTimeout(() => {
            btnCopy.textContent = textoOriginal;
            btnCopy.style.backgroundColor = ""; // Volta pro estilo original do CSS
        }, 2000);
    });
});