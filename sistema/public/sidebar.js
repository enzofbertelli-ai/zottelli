/**
 * sidebar.js — shared sidebar builder + online bar + heartbeat + auto-logout.
 * Call: buildSidebar('current-page.html')
 */
function buildSidebar(activePage) {
    const usuarioLogado = JSON.parse(sessionStorage.getItem('usuarioLogado') || 'null');
    const isAdmin = usuarioLogado?.cargo === 'admin';
    const token = sessionStorage.getItem('sessionToken') || '';
    const nav = document.getElementById('sidebarNav');

    injectOnlineBar();
    startHeartbeat(token);
    if (!isDeviceMobile()) startDesktopIdleLogout();

    // ── Inject utils.js globalmente ──────────────────────────
    if (!document.querySelector('script[src="utils.js"]')) {
        const script = document.createElement('script');
        script.src = 'utils.js';
        document.body.appendChild(script);
    }

    if (!nav) return;

    const links = [
        { href: 'index.html',          icon: 'bi-grid-1x2',           label: 'Dashboard' },
        { href: 'frota.html',          icon: 'bi-car-front',           label: 'Custos e Frota' },
        { href: 'kanban.html',         icon: 'bi-kanban',              label: 'Pipeline' },
        { href: 'despachante.html',    icon: 'bi-file-earmark-check',  label: 'Despachante' },
        { href: 'contratos.html',      icon: 'bi-file-earmark-text',   label: 'Contratos' },
        { href: 'contas.html',         icon: 'bi-currency-exchange',   label: 'Contas' },
        { href: 'showroom.html',       icon: 'bi-shop',                label: 'Showroom' },
        { href: 'tarefas.html',        icon: 'bi-check2-square',       label: 'Tarefas' },
        { href: 'custos_rapidos.html', icon: 'bi-lightning-charge',    label: 'Custos Rápidos' },
        ...(isAdmin ? [{ href: 'compras.html',    icon: 'bi-cart-plus', label: 'Compras',   adminOnly: true }] : []),
        ...(isAdmin ? [{ href: 'transporte.html', icon: 'bi-truck',     label: 'Logística', adminOnly: true }] : []),
        ...(isAdmin ? [{ href: 'usuarios.html',   icon: 'bi-people',    label: 'Usuários',  adminOnly: true }] : []),
    ];

    nav.innerHTML = links.map(l => {
        const active = activePage === l.href ? 'active' : '';
        return `<li class="nav-item"><a class="nav-link ${active}" href="${l.href}"><i class="bi ${l.icon}"></i>${l.label}${l.adminOnly ? ' <span class="badge bg-warning text-dark ms-auto" style="font-size:.6rem;padding:2px 5px">ADM</span>' : ''}</a></li>`;
    }).join('');

    nav.innerHTML += `<li class="nav-item" style="margin-top:auto"><a class="nav-link text-danger" href="#" onclick="sair()"><i class="bi bi-box-arrow-right"></i>Sair</a></li>`;
}

// ─── Detect mobile ────────────────────────────────────────────
function isDeviceMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ─── Logout com token ─────────────────────────────────────────
function sair() {
    const token = sessionStorage.getItem('sessionToken');
    if (token) fetch('/api/sessao/logout', { method: 'POST', headers: { 'x-token': token } }).catch(() => {});
    sessionStorage.removeItem('usuarioLogado');
    sessionStorage.removeItem('sessionToken');
    window.location.href = '/login.html';
}

// ─── Heartbeat (ping a cada 2 min) ────────────────────────────
let _heartbeatInterval = null;
function startHeartbeat(token) {
    if (!token) return;
    const ping = () => fetch('/api/sessao/ping', { method: 'POST', headers: { 'x-token': token } })
        .then(r => {
            if (r.status === 401) showSessionExpired('sua sessão foi encerrada em outro dispositivo');
        }).catch(() => {});
    ping();
    _heartbeatInterval = setInterval(ping, 2 * 60 * 1000);
}

// ─── Auto-logout DESKTOP (10 min sem interação) ───────────────
let _idleTimer = null;
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutos

function startDesktopIdleLogout() {
    const resetTimer = () => {
        clearTimeout(_idleTimer);
        _idleTimer = setTimeout(() => showSessionExpired('inatividade de 10 minutos'), IDLE_TIMEOUT);
    };
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(ev =>
        window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer(); // inicia o timer
}

// ─── Overlay de sessão expirada ───────────────────────────────
function showSessionExpired(motivo) {
    clearInterval(_heartbeatInterval);
    clearTimeout(_idleTimer);

    // Remove se já existir
    const existing = document.getElementById('session-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'session-overlay';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif`;
    overlay.innerHTML = `
        <div style="background:#161616;border:1px solid #d4af37;border-radius:14px;padding:36px;max-width:380px;text-align:center">
            <div style="font-size:40px;margin-bottom:16px">🔒</div>
            <h3 style="color:#f0f0f0;margin-bottom:10px;font-size:18px">Sessão Encerrada</h3>
            <p style="color:#888;font-size:13px;margin-bottom:24px">Sua sessão foi encerrada por ${motivo}.</p>
            <button onclick="sair()" style="background:#d4af37;color:#000;border:none;padding:12px 28px;font-size:14px;font-weight:700;border-radius:8px;cursor:pointer">
                Fazer Login Novamente
            </button>
        </div>`;
    document.body.appendChild(overlay);

    // Auto-redirecionar após 8s
    setTimeout(() => sair(), 8000);
}

// ─── Barra de usuários online ─────────────────────────────────
function injectOnlineBar() {
    const style = document.createElement('style');
    style.textContent = `
        #online-bar {
            position:fixed;top:0;left:0;right:0;height:36px;z-index:2000;
            background:rgba(13,13,13,.96);border-bottom:1px solid #1e1e1e;
            display:flex;align-items:center;padding:0 16px;gap:14px;
            font-family:'Inter',sans-serif;font-size:11px;color:#666;
            backdrop-filter:blur(8px);
        }
        #online-bar .ob-label{color:#444;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;white-space:nowrap}
        #online-bar .ob-users{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
        #online-bar .ob-user{display:flex;align-items:center;gap:5px;padding:3px 9px;background:rgba(255,255,255,.04);border:1px solid #2a2a2a;border-radius:20px;color:#ccc;font-size:11px}
        #online-bar .ob-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 5px #22c55e}
        #online-bar .ob-me .ob-dot{background:#d4af37;box-shadow:0 0 5px #d4af37}
        #online-bar .ob-me{border-color:rgba(212,175,55,.3)}
        body.has-online-bar{padding-top:36px}
        .sidebar{top:36px!important;height:calc(100vh - 36px)!important}
    `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'online-bar';
    bar.innerHTML = `<span class="ob-label">Online</span><span class="ob-users" id="ob-users"><span style="color:#333">Carregando...</span></span>`;
    document.body.prepend(bar);
    document.body.classList.add('has-online-bar');

    const meUsername = JSON.parse(sessionStorage.getItem('usuarioLogado') || '{}')?.username || '';

    function atualizar() {
        fetch('/api/sessao/online').then(r => r.json()).then(lista => {
            const cont = document.getElementById('ob-users');
            if (!lista || !lista.length) { cont.innerHTML = '<span style="color:#333">Ninguém online</span>'; return; }
            cont.innerHTML = lista.map(u => {
                const isMe = u.username === meUsername;
                return `<div class="ob-user${isMe ? ' ob-me' : ''}"><div class="ob-dot"></div>${u.username}${isMe ? ' <span style="color:#666;font-size:10px">(você)</span>' : ''}</div>`;
            }).join('');
        }).catch(() => {});
    }

    atualizar();
    setInterval(atualizar, 30000);
}
