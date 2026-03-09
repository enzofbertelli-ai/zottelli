/**
 * utils.js — Shared utilities for Zottelli System
 * 1. Auto-logout after 10 minutes of inactivity (Desktop only)
 * 2. Export to Excel (CSV)
 */

// ==========================================
// 1. AUTO-LOGOUT (Desktop Only)
// ==========================================
function setupAutoLogout() {
    // Only run if not on a mobile device (rough check via userAgent and screen width)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    
    if (isMobile) return; // Feature specifically requested: "se for via mobile não precisa desconectar automaticamente"

    let inactivityTimeout;
    const INACTIVITY_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

    function resetTimer() {
        clearTimeout(inactivityTimeout);
        // Only start timer if user is logged in
        if (sessionStorage.getItem('sessionToken')) {
            inactivityTimeout = setTimeout(forceLogout, INACTIVITY_LIMIT_MS);
        }
    }

    function forceLogout() {
        alert('Sessão expirada por inatividade (10 minutos). Por favor, faça login novamente.');
        if (typeof sair === 'function') {
            sair();
        } else {
            sessionStorage.removeItem('usuarioLogado');
            sessionStorage.removeItem('sessionToken');
            window.location.href = '/login.html';
        }
    }

    // Attach listeners to reset timer on user interaction
    ['mousemove', 'mousedown', 'keypress', 'touchmove', 'scroll'].forEach(evt => {
        window.addEventListener(evt, resetTimer, { passive: true });
    });

    // Initial start
    resetTimer();
}

// Initialize auto-logout script globally when this file loads
setupAutoLogout();


// ==========================================
// 2. EXPORT TO EXCEL (CSV Export)
// ==========================================
function exportToExcel(filename, headers, dataRows) {
    // CSV Header row
    let csvContent = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(';') + '\n';
    
    // CSV Data rows
    dataRows.forEach(row => {
        let textRow = row.map(cell => {
            let val = cell !== null && cell !== undefined ? String(cell) : '';
            // Escape quotes and wrap in quotes for robust CSV parsing
            return `"${val.replace(/"/g, '""')}"`;
        }).join(';');
        csvContent += textRow + '\n';
    });

    // Add identifier for Excel to recognize the separator
    csvContent = 'sep=;\n' + csvContent;

    // Add BOM for Excel UTF-8 recognition
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // Create download link and trigger it
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
