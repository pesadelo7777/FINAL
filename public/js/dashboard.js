(function() {
    const supabaseUrl = 'https://hrldelnvaukkroupanvg.supabase.co';
    const supabaseKey = 'sb_publishable_s4MEjHRwsFnDfUKBLheacg_wjuDzguc';
    const lifeVuSupabase = window.supabase.createClient(supabaseUrl, supabaseKey);

    const balanceDisplay = document.getElementById('user-balance-display');
    const userPlanText = document.getElementById('user-plan-text');

    let selectedMode = "";
    // Previne crash caso a engine ainda n�o esteja carregada no HTML
    let engine = window.LifeVUEngine ? new window.LifeVUEngine() : null;
    let currentImvuAccount = "";

    // ==========================================
    // VARI�VEIS GLOBAIS DE PAGAMENTO E RADAR
    // ==========================================
    let userIdAtual = null;
    let saldoDeReferencia = 0;
    let planoDeReferencia = "Free";
    let vencimentoDeReferencia = null;
    let canalPagamento = null;
    let contadorTimeout = null;
    let tempoRestante = 120;

    // ==========================================
    // CARREGAMENTO INICIAL DA SESS�O
    // ==========================================
    async function carregarSessao() {
        try {
            const { data: { user }, error: authError } = await lifeVuSupabase.auth.getUser();
            if (authError || !user) {
                console.error("Usuário não logado ou sessão expirada.");
                window.location.href = '/';
                return;
            }

userIdAtual = user.id;
            
            // CHAMA O MOTOR DE RESET DI�RIO ANTES DE LER O SALDO
            const { error: resetError } = await lifeVuSupabase.rpc('resetar_moedas_diarias', { usuario_id: user.id });
            if (resetError) console.warn('Não foi possível renovar as moedas gratuitas nesta sessão.');

            const { data: profile, error: dbError } = await lifeVuSupabase.from('profiles').select('*').eq('id', user.id).single();

            if (dbError) throw dbError;

            
            if (profile.role === 'admin') {
                const btnAdmin = document.getElementById('btnGoAdmin');
                if (btnAdmin) {
                    btnAdmin.style.display = 'block';
                    btnAdmin.addEventListener('click', () => window.location.href = 'admin.html');
                }
            }
            
            if (profile) {
                const saldoTotal = (profile.moedas_free || 0) + (profile.moedas_avulsas || 0) + (profile.moedas_vip || 0);
                
                let textoPlano = profile.plano || "Free";
                let isVipAtivo = false;
                if (textoPlano.includes('VIP') && profile.vip_vencimento) {
                    const dataVenc = new Date(profile.vip_vencimento);
                    const hoje = new Date();
                    const diasRestantes = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 3600 * 24));
                    if (diasRestantes > 0) {
                        textoPlano = `${profile.plano} (${diasRestantes} dias rest.)`;
                        isVipAtivo = true;
                    }
                    else { textoPlano = "VIP Expirado"; }
                }

                if (balanceDisplay) {
                    balanceDisplay.innerText = isVipAtivo ? " Ilimitado" : `${saldoTotal} Moedas`;
                }

                if (userPlanText) userPlanText.innerText = textoPlano;
                if (document.getElementById('modal-email-display')) document.getElementById('modal-email-display').innerText = user.email;
                if (document.getElementById('modal-plan-display')) document.getElementById('modal-plan-display').innerText = "Plano: " + textoPlano;
                
                if(profile.imvu_account) {
                    currentImvuAccount = profile.imvu_account;
                    const inputImvu = document.getElementById('imvu-username');
                    if (inputImvu) {
                        inputImvu.value = profile.imvu_account;
                        inputImvu.disabled = true;
                    }
                    const btnVerify = document.getElementById('btnVerifyIMVU');
                    if (btnVerify) btnVerify.style.display = 'none';
                }
            }
        } catch (err) {
            console.error("Erro fatal ao carregar sessão:", err);
        }
    }
    
    carregarSessao();

    // ==========================================
    // NAVEGA��O E UPLOADS DA ENGINE
    // ==========================================
    const modeRenderBtn = document.getElementById('modeRenderBtn');
    const modeRefBtn = document.getElementById('modeRefBtn');
    const modeCoupleBtn = document.getElementById('modeCoupleBtn');
    const cardUpload = document.getElementById('card-upload');
    const cardConfig = document.getElementById('card-config');
    const cardOutput = document.getElementById('card-output');
    const uploadDynamicArea = document.getElementById('upload-dynamic-area');
    const btnProceedToConfig = document.getElementById('btnProceedToConfig');

    const resetUI = () => { 
        if(cardConfig) cardConfig.style.display = 'none'; 
        if(cardOutput) cardOutput.style.display = 'none'; 
        if(cardUpload) cardUpload.style.display = 'block'; 
        if(btnProceedToConfig) btnProceedToConfig.style.display = 'flex'; 
    };

    modeRenderBtn?.addEventListener('click', () => {
        selectedMode = 'render'; if(engine) engine.setMode('render');
        modeRenderBtn.classList.add('active'); modeRefBtn?.classList.remove('active'); modeCoupleBtn?.classList.remove('active');
        resetUI(); document.getElementById('upload-card-title').innerText = "Upload da Imagem";
        uploadDynamicArea.innerHTML = `<div class="upload-dropzone" id="drop-single" onclick="document.getElementById('fileSingle').click()"><p id="text-single"><i class="ph ph-folder-open"></i> Clique para carregar a imagem base a ser aprimorada</p><input type="file" id="fileSingle" accept="image/*" style="display:none"></div>`;
        document.getElementById('fileSingle').addEventListener('change', function() { if(this.files[0]) { document.getElementById('drop-single').classList.add('loaded'); document.getElementById('text-single').innerHTML = `<i class="ph-fill ph-check-circle"></i> Imagem carregada`; } });
    });

    modeRefBtn?.addEventListener('click', () => {
        selectedMode = 'reference'; if(engine) engine.setMode('reference');
        modeRefBtn.classList.add('active'); modeRenderBtn?.classList.remove('active'); modeCoupleBtn?.classList.remove('active');
        resetUI(); document.getElementById('upload-card-title').innerText = "Avatar + referência";
        uploadDynamicArea.innerHTML = `<div class="upload-dropzone" id="drop-avatar" onclick="document.getElementById('fileAvatar').click()"><p id="text-avatar">1. <i class="ph ph-user-circle"></i> Carregar o avatar (identidade)</p><input type="file" id="fileAvatar" accept="image/*" style="display:none"></div><div class="upload-dropzone" id="drop-ref" onclick="document.getElementById('fileReference').click()"><p id="text-ref">2. <i class="ph ph-camera"></i> Carregar a referência (pose)</p><input type="file" id="fileReference" accept="image/*" style="display:none"></div>`;
        document.getElementById('fileAvatar').addEventListener('change', function() { if(this.files[0]) { document.getElementById('drop-avatar').classList.add('loaded'); document.getElementById('text-avatar').innerHTML = `<i class="ph-fill ph-check-circle"></i> Imagem avatar carregada`; } });
        document.getElementById('fileReference').addEventListener('change', function() { if(this.files[0]) { document.getElementById('drop-ref').classList.add('loaded'); document.getElementById('text-ref').innerHTML = `<i class="ph-fill ph-check-circle"></i> Imagem pose carregada`; } });
    });

    modeCoupleBtn?.addEventListener('click', () => {
        selectedMode = 'couple'; if(engine) engine.setMode('couple');
        modeCoupleBtn.classList.add('active'); modeRenderBtn?.classList.remove('active'); modeRefBtn?.classList.remove('active');
        resetUI(); document.getElementById('upload-card-title').innerText = "Duas identidades + referência";
        uploadDynamicArea.innerHTML = `<div class="upload-dropzone" id="drop-avatar1" onclick="document.getElementById('fileAvatar1').click()"><p id="text-avatar1">1. <i class="ph ph-users"></i> Avatar 1</p><input type="file" id="fileAvatar1" accept="image/*" style="display:none"></div><div class="upload-dropzone" id="drop-avatar2" onclick="document.getElementById('fileAvatar2').click()"><p id="text-avatar2">2. <i class="ph ph-users"></i> Avatar 2</p><input type="file" id="fileAvatar2" accept="image/*" style="display:none"></div><div class="upload-dropzone" id="drop-ref" onclick="document.getElementById('fileReference').click()"><p id="text-ref">3. <i class="ph ph-camera"></i> Referência do casal</p><input type="file" id="fileReference" accept="image/*" style="display:none"></div>`;
        document.getElementById('fileAvatar1').addEventListener('change', function() { if(this.files[0]) { document.getElementById('drop-avatar1').classList.add('loaded'); document.getElementById('text-avatar1').innerHTML = `<i class="ph-fill ph-check-circle"></i> Imagem avatar 1 carregada`; } });
        document.getElementById('fileAvatar2').addEventListener('change', function() { if(this.files[0]) { document.getElementById('drop-avatar2').classList.add('loaded'); document.getElementById('text-avatar2').innerHTML = `<i class="ph-fill ph-check-circle"></i> Imagem avatar 2 carregada`; } });
        document.getElementById('fileReference').addEventListener('change', function() { if(this.files[0]) { document.getElementById('drop-ref').classList.add('loaded'); document.getElementById('text-ref').innerHTML = `<i class="ph-fill ph-check-circle"></i> Imagem pose carregada`; } });
    });

    btnProceedToConfig?.addEventListener('click', () => {
        let isValid = false; let errorMessage = "Carregue todas as imagens antes de avançar.";
        if (selectedMode === 'render') { if (document.getElementById('fileSingle')?.files[0]) isValid = true; } 
        else if (selectedMode === 'reference') { if (document.getElementById('fileAvatar')?.files[0] && document.getElementById('fileReference')?.files[0]) isValid = true; } 
        else if (selectedMode === 'couple') { if (document.getElementById('fileAvatar1')?.files[0] && document.getElementById('fileAvatar2')?.files[0] && document.getElementById('fileReference')?.files[0]) isValid = true; }
        if (isValid) {
            cardConfig.style.display = 'block';
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            cardConfig.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        } else alert(errorMessage);
    });

    document.getElementById('slider-rosto')?.addEventListener('input', (e) => document.getElementById('val-rosto').innerText = 'L' + e.target.value);

    // ==========================================
    // GERADOR DE PROMPT COM CONSUMO SEGURO
    // ==========================================
    document.getElementById('btnGeneratePrompt')?.addEventListener('click', async () => {
        const btn = document.getElementById('btnGeneratePrompt');
        const originalText = btn.innerText;
        btn.innerText = "PROCESSANDO..."; btn.disabled = true; btn.classList.add('is-generating'); cardOutput.style.display = 'none';

        const [{ data: { user } }, { data: { session } }] = await Promise.all([
            lifeVuSupabase.auth.getUser(),
            lifeVuSupabase.auth.getSession()
        ]);

        if (!user || !session?.access_token) {
            window.location.href = '/';
            return;
        }
        
        try {
            const params = {
                iaAlvo: document.getElementById('select-ia-alvo').value, estilo: document.getElementById('select-estilo').value,
                pele: document.getElementById('select-pele').value, cabelo: document.getElementById('select-cabelo').value,
                roupa: document.getElementById('select-roupa').value, rosto: document.getElementById('slider-rosto').value,
                iluminacao: document.getElementById('select-iluminacao').value, expressao: document.getElementById('select-expressao').value,
                fundo: document.getElementById('select-fundo').value, customPrompt: document.getElementById('custom-prompt')?.value || ''
            };
            let avatarBase64 = null; let refBase64 = null; let avatar2Base64 = null;

            if (selectedMode === 'render') { avatarBase64 = await engine.convertFileToBase64(document.getElementById('fileSingle').files[0]); } 
            else if (selectedMode === 'reference') { avatarBase64 = await engine.convertFileToBase64(document.getElementById('fileAvatar').files[0]); refBase64 = await engine.convertFileToBase64(document.getElementById('fileReference').files[0]); } 
            else if (selectedMode === 'couple') { avatarBase64 = await engine.convertFileToBase64(document.getElementById('fileAvatar1').files[0]); avatar2Base64 = await engine.convertFileToBase64(document.getElementById('fileAvatar2').files[0]); refBase64 = await engine.convertFileToBase64(document.getElementById('fileReference').files[0]); }

            // O backend autentica, limita e consome a moeda atomicamente.
            btn.innerText = "GEMINI ANALISANDO...";
            const resultPrompt = await engine.generateFinalCopyPaste(avatarBase64, refBase64, params, session.access_token, avatar2Base64);
            document.getElementById('output-copypaste').value = resultPrompt;

            const { data: updatedProfile } = await lifeVuSupabase
                .from('profiles')
                .select('moedas_free, moedas_avulsas, moedas_vip, plano, vip_vencimento')
                .eq('id', user.id)
                .single();
            if (updatedProfile && balanceDisplay) {
                const vipAtivo = updatedProfile.plano?.includes('VIP')
                    && updatedProfile.vip_vencimento
                    && new Date(updatedProfile.vip_vencimento) > new Date();
                const saldoAtual = (updatedProfile.moedas_free || 0)
                    + (updatedProfile.moedas_avulsas || 0)
                    + (updatedProfile.moedas_vip || 0);
                balanceDisplay.innerText = vipAtivo ? "Ilimitado" : `${saldoAtual} Moedas`;
            }

            cardOutput.style.display = 'block'; 
            cardOutput.scrollIntoView({ behavior: 'smooth' }); 
        } catch (error) { 
            alert("Erro: " + error.message); 
        } 
        finally { btn.innerText = originalText; btn.disabled = false; btn.classList.remove('is-generating'); }
    });

    document.getElementById('btnCopyPrompt')?.addEventListener('click', () => {
        const outputField = document.getElementById('output-copypaste'); const btn = document.getElementById('btnCopyPrompt');
        outputField.style.left = "0"; outputField.select(); document.execCommand('copy'); outputField.style.left = "-9999px"; 
        const originalHTML = btn.innerHTML; btn.innerHTML = `<i class="ph-fill ph-check-circle"></i> PROMPT COPIADO!`; btn.style.backgroundColor = "#008542"; btn.style.borderColor = "#008542";
        setTimeout(() => { btn.innerHTML = originalHTML; btn.style.backgroundColor = ""; btn.style.borderColor = ""; }, 3000);
    });

    // ==========================================
    // MODAL PERFIL E VINCULA��O IMVU
    // ==========================================
    const accountModal = document.getElementById('accountModal');
    
    const abrirModalConta = async () => {
        try {
            if (currentImvuAccount) {
                 const bioDisp = document.getElementById('bio-token-display');
                 if(bioDisp) { bioDisp.innerText = "CONTA VINCULADA"; bioDisp.style.color = "#00ffcc"; }
            } else {
                 const bioDisp = document.getElementById('bio-token-display');
                 if(bioDisp) { bioDisp.innerText = "GERANDO..."; }
                 const { data: { user } } = await lifeVuSupabase.auth.getUser();
                 if(user && bioDisp) {
                     const tokenGerado = 'LIFEVU-' + user.id.split('-')[0].substring(0, 4).toUpperCase() + Math.floor(Math.random() * 999);
                     bioDisp.innerText = tokenGerado;
                     bioDisp.style.color = "#fff";
                 }
            }
            if(accountModal) accountModal.classList.add('active');
        } catch(e) { console.error("Erro ao abrir modal de conta:", e); }
    };

    document.getElementById('btnOpenAccount')?.addEventListener('click', abrirModalConta);
    document.getElementById('btnCloseAccount')?.addEventListener('click', () => accountModal?.classList.remove('active'));
    
    document.getElementById('btnLogout')?.addEventListener('click', async () => { 
        await lifeVuSupabase.auth.signOut(); 
        window.location.href = '/'; 
    });

    document.getElementById('btnVerifyIMVU')?.addEventListener('click', async () => {
        const btn = document.getElementById('btnVerifyIMVU'); 
        const msg = document.getElementById('imvu-save-msg');
        const inputField = document.getElementById('imvu-username');
        
        if(!inputField) return;
        const imvuNick = inputField.value.replace('@', '');
        const tokenEsperado = document.getElementById('bio-token-display').innerText;

        if (!imvuNick) return;
        btn.innerText = "LENDO..."; btn.disabled = true;

        try {
            const response = await fetch(`https://api.efeitoweb.site/verificar-bio?username=${imvuNick}`);
            const data = await response.json();

            if (data.tagline && data.tagline.includes(tokenEsperado)) {
                const { data: { user } } = await lifeVuSupabase.auth.getUser();
                const { error: updateError } = await lifeVuSupabase.from('profiles').update({ imvu_account: imvuNick }).eq('id', user.id);
                
                if (updateError) {
                    msg.innerHTML = `Validado! Mas o Supabase bloqueou o salvamento. (Destrave o RLS)`; 
                    msg.style.color = "#ff5555"; 
                    msg.style.display = 'block';
                } else {
                    msg.innerHTML = `<i class="ph-fill ph-check-circle"></i> Conta vinculada e salva!`; 
                    msg.style.color = "#00ffcc"; 
                    msg.style.display = 'block';
                    currentImvuAccount = imvuNick; 
                    
                    const fundLinked = document.getElementById('fund-linked-account');
                    if (fundLinked) { fundLinked.innerHTML = `@${imvuNick}`; fundLinked.style.color = "#3b82f6"; }
                    btn.style.display = 'none';
                }
            } else {
                msg.innerHTML = `Token não encontrado na bio de @${imvuNick}.`; msg.style.color = "#ff5555"; msg.style.display = 'block';
            }
        } catch {
            msg.innerHTML = `Bot offline. Tente depois.`; msg.style.color = "#ff5555"; msg.style.display = 'block';
        } finally { btn.innerText = "VERIFICAR"; btn.disabled = false; }
    });

    // ==========================================
    // MODAL DE CARTEIRA E C�LCULO DE VIP
    // ==========================================
    const fundingModal = document.getElementById('fundingModal');
    const btnCloseFunding = document.getElementById('btnCloseFunding');
    let fundingScrollY = 0;
    let bodyStylesBeforeFunding = null;

    const setFundingModalOpen = (shouldOpen) => {
        if (!fundingModal || fundingModal.classList.contains('active') === shouldOpen) return;

        if (shouldOpen) {
            fundingScrollY = window.scrollY;
            bodyStylesBeforeFunding = {
                position: document.body.style.position,
                top: document.body.style.top,
                width: document.body.style.width,
                overflow: document.body.style.overflow
            };
            document.body.classList.add('funding-modal-open');
            document.body.style.position = 'fixed';
            document.body.style.top = `-${fundingScrollY}px`;
            document.body.style.width = '100%';
            fundingModal.classList.add('active');
            requestAnimationFrame(() => btnCloseFunding?.focus());
            return;
        }

        fundingModal.classList.remove('active');
        document.body.classList.remove('funding-modal-open');
        if (bodyStylesBeforeFunding) {
            Object.assign(document.body.style, bodyStylesBeforeFunding);
            bodyStylesBeforeFunding = null;
        }
        window.scrollTo(0, fundingScrollY);
    };

    const openFunding = async () => {
        try {
            const { data: { user }, error: authErr } = await lifeVuSupabase.auth.getUser();
            if (authErr || !user) {
                alert("Sua sessão expirou. Faça login novamente.");
                window.location.href = "/";
                return;
            }
            
            userIdAtual = user.id; 
            const { data: profile } = await lifeVuSupabase.from('profiles').select('*').eq('id', user.id).single();
            
            if (profile) {
                // TIRA A FOTO DO SALDO EXATAMENTE NA HORA QUE ABRE A CARTEIRA!
                saldoDeReferencia = profile.moedas_avulsas || 0;
                planoDeReferencia = profile.plano || "Free";
                vencimentoDeReferencia = profile.vip_vencimento || null;
                currentImvuAccount = profile.imvu_account || "";

                const saldoTotal = (profile.moedas_free || 0) + (profile.moedas_avulsas || 0) + (profile.moedas_vip || 0);
                
                // C�LCULO DE VENCIMENTO DO VIP E ILIMITADO
                let textoPlano = profile.plano || "Free";
                let isVipAtivo = false;
                if (textoPlano.includes('VIP') && profile.vip_vencimento) {
                    const dataVenc = new Date(profile.vip_vencimento);
                    const hoje = new Date();
                    const diasRestantes = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 3600 * 24));
                    if (diasRestantes > 0) { 
                        textoPlano = `${profile.plano} (${diasRestantes} dias rest.)`; 
                        isVipAtivo = true;
                    } 
                    else { textoPlano = "VIP Expirado"; }
                }
                
                const carteiraSaldo = document.getElementById('carteira-saldo');
                if (carteiraSaldo) {
                    carteiraSaldo.innerText = isVipAtivo ? " Ilimitado" : saldoTotal + " Moedas";
                }
                
                const carteiraPlano = document.getElementById('carteira-plano');
                if (carteiraPlano) carteiraPlano.innerText = textoPlano;
                
                const userPlanTextEl = document.getElementById('user-plan-text');
                if (userPlanTextEl) userPlanTextEl.innerText = textoPlano;
            }

            const fundLinkedAcc = document.getElementById('fund-linked-account');
            const txtAviso = document.getElementById('txt-aviso-pagamento');
            
            if (!currentImvuAccount) {
                if (fundLinkedAcc) { fundLinkedAcc.innerHTML = "Não vinculada"; fundLinkedAcc.style.color = "#ff5555"; }
                if (txtAviso) txtAviso.style.display = "block";
                document.querySelectorAll('.btn-comprar-plano').forEach(b => b.disabled = true);
            } else {
                if (fundLinkedAcc) { fundLinkedAcc.innerHTML = `@${currentImvuAccount}`; fundLinkedAcc.style.color = "#00ffcc"; }
                if (txtAviso) txtAviso.style.display = "none";
                document.querySelectorAll('.btn-comprar-plano').forEach(b => b.disabled = false);
            }
            
            setFundingModalOpen(true);
        } catch(e) { 
            console.error("Erro fatal ao abrir carteira:", e);
        }
    };

    // Associa os bot�es da interface � fun��o de abrir carteira
    document.getElementById('btnOpenFunding')?.addEventListener('click', openFunding);
    document.getElementById('btnPlanosVIP')?.addEventListener('click', openFunding);
    btnCloseFunding?.addEventListener('click', () => setFundingModalOpen(false));
    fundingModal?.addEventListener('click', (event) => {
        if (event.target === fundingModal) setFundingModalOpen(false);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && fundingModal?.classList.contains('active')) setFundingModalOpen(false);
    });

    // ==========================================
    // L�GICA DO SLIDER (MOEDA AVULSA)
    // ==========================================
    const sliderDash = document.getElementById('dash-credit-slider');
    const valoresAvulsosDash = [1000, 2000, 3000, 4000, 6000, 7000, 8000, 10000];
    if (sliderDash) {
        sliderDash.addEventListener('input', (e) => {
            const creditos = valoresAvulsosDash[parseInt(e.target.value)];
            const { CREDITS_PER_PACKAGE, COINS_PER_1000_CREDITS } = window.LifeVUEconomy;
            const moedas = Math.floor(creditos / CREDITS_PER_PACKAGE) * COINS_PER_1000_CREDITS;
            const valEl = document.getElementById('dash-credit-val');
            if(valEl) valEl.innerText = `${creditos.toLocaleString('pt-BR')} Créditos`;
            const moedaEl = document.getElementById('dash-moeda-val');
            if(moedaEl) moedaEl.innerText = `${moedas} Moeda${moedas > 1 ? 's' : ''}`;
        });
    }

    document.getElementById('btnContinueAvulso')?.addEventListener('click', () => {
        try {
            if (sliderDash) {
                const creditos = valoresAvulsosDash[parseInt(sliderDash.value)];
                const modalAvulso = document.getElementById('modalSliderAvulso');
                if (modalAvulso) modalAvulso.classList.remove('active');
                
                const payAmountDisplay = document.getElementById('pay-amount-display');
                if (payAmountDisplay) payAmountDisplay.innerText = `${creditos.toLocaleString('pt-BR')} Créditos`;
            }
            abrirTelaDeTransferencia();
        } catch(e) { console.error(e); }
    });

    // ==========================================
    // SELETOR DE MODO DE PAGAMENTO
    // ==========================================
    window.prepararPagamento = function(tipo) {
        try {
            if (!currentImvuAccount) {
                alert("Vincule sua conta IMVU primeiro no menu Minha Conta!");
                return;
            }
            
            setFundingModalOpen(false);
            
            const payLinked = document.getElementById('pay-linked-account');
            if (payLinked) payLinked.innerText = '@' + currentImvuAccount; 
            
            if (tipo === 'avulso') {
                const nickAvulso = document.getElementById('display-nick-avulso');
                if(nickAvulso) nickAvulso.innerText = '@' + currentImvuAccount;
                
                const modalAvulso = document.getElementById('modalSliderAvulso');
                if(modalAvulso) modalAvulso.classList.add('active');
                
                if (sliderDash) {
                    sliderDash.value = 0;
                    const dashCreditVal = document.getElementById('dash-credit-val');
                    if (dashCreditVal) dashCreditVal.innerText = `1.000 Créditos`;
                    const dashMoedaVal = document.getElementById('dash-moeda-val');
                    if (dashMoedaVal) dashMoedaVal.innerText = `8 Moedas`;
                }
            } else {
                const amountDisplay = document.getElementById('pay-amount-display');
                if (tipo === 'vip15' && amountDisplay) amountDisplay.innerText = "5.000 Créditos";
                if (tipo === 'vip30' && amountDisplay) amountDisplay.innerText = "9.000 Créditos";
                
                abrirTelaDeTransferencia();
            }
        } catch(e) { console.error("Erro na navegação de pagamento:", e); }
    };

    // ==========================================
    // RADAR DE PAGAMENTO (VIA WEBSOCKET)
    // ==========================================
    window.abrirTelaDeTransferencia = async function() {
        const step1 = document.getElementById('payment-step-1');
        const step2 = document.getElementById('payment-step-2');
        const payModal = document.getElementById('paymentModal');
        
        if (step1) step1.style.display = 'block';
        if (step2) step2.style.display = 'none';
        if (payModal) payModal.classList.add('active');

        const btn = document.getElementById('btnIrParaImvu');
        if(btn) {
            btn.innerHTML = 'IR PARA O IMVU E PAGAR';
            btn.style.opacity = '1';
            btn.disabled = false;
        }

        encerrarProcessoPagamento(); // Limpa radares anteriores

        // Failsafe para garantir o ID
        if (!userIdAtual) {
            const { data: { user } } = await lifeVuSupabase.auth.getUser();
            if (user) userIdAtual = user.id;
        }
        if (!userIdAtual) return;

        // Tira a foto exata do saldo direto do banco ANTES de escutar
        const { data: profile } = await lifeVuSupabase.from('profiles').select('moedas_avulsas, plano, vip_vencimento').eq('id', userIdAtual).single();
        saldoDeReferencia = profile?.moedas_avulsas || 0;
        planoDeReferencia = profile?.plano || "Free";
        vencimentoDeReferencia = profile?.vip_vencimento || null;

        // LIGA O RADAR REALTIME
        canalPagamento = lifeVuSupabase
            .channel('radar-pagamento-dash')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userIdAtual}` },
                (payload) => {
                    const moedasNovas = payload.new.moedas_avulsas || 0;
                    const planoNovo = payload.new.plano || "Free";
                    const vencimentoNovo = payload.new.vip_vencimento || null;

                    // Se qualquer coisa aumentou ou mudou
                    if (moedasNovas > saldoDeReferencia || planoNovo !== planoDeReferencia || vencimentoNovo !== vencimentoDeReferencia) {
                        encerrarProcessoPagamento(); 
                        
                        if(step1) step1.style.display = 'none';
                        if(step2) step2.style.display = 'block';
                        
                        // Atualiza a Navbar automaticamente
                        const saldoTotal = (payload.new.moedas_free || 0) + moedasNovas + (payload.new.moedas_vip || 0);
                        const bal = document.getElementById('user-balance-display');
                        if(bal) bal.innerText = saldoTotal + ' Moedas';
                        
                        // Atualiza saldo na modal de carteira caso ela seja reaberta na mesma sess�o
                        const carteiraSaldo = document.getElementById('carteira-saldo');
                        if(carteiraSaldo) carteiraSaldo.innerText = saldoTotal + ' Moedas';

                        saldoDeReferencia = moedasNovas;
                        planoDeReferencia = planoNovo;
                        vencimentoDeReferencia = vencimentoNovo;
                    }
                }
            )
            .subscribe();
    };

    window.iniciarEscutaPagamento = async function() {
        const btn = document.getElementById('btnIrParaImvu');
        if(!btn) return;
        btn.disabled = true;
        tempoRestante = 120; 

        // Abre o IMVU numa nova aba
        window.open('https://pt.secure.imvu.com/next/av/IIaisis/', '_blank');

        if(contadorTimeout) clearInterval(contadorTimeout);

        // Apenas efeito visual na tela (O radar j� est� ligado nos WebSockets)
        contadorTimeout = setInterval(() => {
            tempoRestante--;
            btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> AGUARDANDO... (${tempoRestante}s)`;
            
            if (tempoRestante <= 0) {
                clearInterval(contadorTimeout);
                btn.innerHTML = 'IR PARA O IMVU E PAGAR';
                btn.style.opacity = '1';
                btn.disabled = false;
            }
        }, 1000);
    };

    window.cancelarEscutaPagamento = function() {
        encerrarProcessoPagamento();
        document.getElementById('paymentModal')?.classList.remove('active');
        
        const btn = document.getElementById('btnIrParaImvu');
        if(btn) {
            btn.innerHTML = 'IR PARA O IMVU E PAGAR';
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    };

    function encerrarProcessoPagamento() {
        if (contadorTimeout) clearInterval(contadorTimeout);
        if (canalPagamento) {
            lifeVuSupabase.removeChannel(canalPagamento);
            canalPagamento = null;
        }
    }
})();
