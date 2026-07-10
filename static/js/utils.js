// Utility functions and translation support for the Planning Dashboard

// UI translation lookup (using translations.js data structure)
export function t(key) {
    const lang = localStorage.getItem("app-lang") || "en";
    const table = (typeof TRANSLATIONS !== "undefined" && TRANSLATIONS[lang]) || {};
    return table[key] || (typeof TRANSLATIONS !== "undefined" && TRANSLATIONS.en[key]) || key;
}

// Scans document and translates elements with data-i18n attributes
export function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
        el.title = t(el.getAttribute("data-i18n-title"));
    });
}

// Notification Toast Alert System
export function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `toast toast-${type} show`;
    
    let iconClass = "fa-circle-check";
    if (type === "error") iconClass = "fa-circle-xmark";
    else if (type === "warning") iconClass = "fa-triangle-exclamation";
    else if (type === "info") iconClass = "fa-circle-info";
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    container.appendChild(toast);
    
    // Auto-remove toast after 4.5 seconds
    setTimeout(() => {
        toast.classList.remove("show");
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 500);
    }, 4500);
}

// Cold-start api pending request tracker (especially for slow wakeups on Render hosts)
let pendingApiRequests = 0;
let coldStartTimer = null;

export function markApiRequestStart(url) {
    if (typeof url !== "string" || !url.startsWith("/api/")) return;
    pendingApiRequests++;
    if (!coldStartTimer) {
        coldStartTimer = setTimeout(() => {
            if (pendingApiRequests > 0) {
                const overlay = document.getElementById("cold-start-overlay");
                if (overlay) overlay.style.display = "flex";
            }
        }, 4000);
    }
}

export function markApiRequestEnd(url) {
    if (typeof url !== "string" || !url.startsWith("/api/")) return;
    pendingApiRequests = Math.max(0, pendingApiRequests - 1);
    if (pendingApiRequests === 0) {
        clearTimeout(coldStartTimer);
        coldStartTimer = null;
        const overlay = document.getElementById("cold-start-overlay");
        if (overlay) overlay.style.display = "none";
    }
}
