// API communication layer and fetch interceptor

import { markApiRequestStart, markApiRequestEnd } from "./utils.js";

// Global Fetch Interceptor
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
    if (!options.headers) {
        options.headers = {};
    }
    if (options.body && typeof options.body === "string" && !options.headers["Content-Type"]) {
        options.headers["Content-Type"] = "application/json";
    }

    markApiRequestStart(url);
    try {
        const response = await originalFetch(url, options);
        if (response.status === 401 && !url.includes("/api/auth/login") && !url.includes("/api/auth/me")) {
            // Session expired or invalid, clear localStorage and reload
            localStorage.removeItem("role");
            localStorage.removeItem("username");
            localStorage.removeItem("name");
            document.body.classList.remove("authenticated");
            window.location.reload();
            throw new Error("Session expired or invalid. Redirecting to sign in.");
        }
        return response;
    } finally {
        markApiRequestEnd(url);
    }
};

// API calls wrapper
export const api = {
    async get(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
        return res.json();
    },

    async post(url, body) {
        const res = await fetch(url, {
            method: "POST",
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `POST ${url} failed with status ${res.status}`);
        }
        return res.json();
    },

    async put(url, body) {
        const res = await fetch(url, {
            method: "PUT",
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `PUT ${url} failed with status ${res.status}`);
        }
        return res.json();
    },

    async delete(url) {
        const res = await fetch(url, { method: "DELETE" });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `DELETE ${url} failed with status ${res.status}`);
        }
        return res.json();
    }
};
