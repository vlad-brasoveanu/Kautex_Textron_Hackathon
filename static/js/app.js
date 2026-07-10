/* ==========================================================
   DIGITAL ENGINEERING PLANNING DASHBOARD - LOGIC ENGINE
   FastAPI integration, Matrix Grid Renderer, and Local AI Chat
   ========================================================== */

// UI chrome translation (see translations.js, loaded before this file).
// Scope: static nav/labels/headers/buttons only - AI chat answers, the
// AI-generated memo, Admin Insights text, audit log details, and actual
// planning data (employee names/notes/topic descriptions) are dynamic/user
// content and stay in English regardless of the selected language.
function t(key) {
    const lang = localStorage.getItem("app-lang") || "en";
    const table = (typeof TRANSLATIONS !== "undefined" && TRANSLATIONS[lang]) || {};
    return table[key] || (typeof TRANSLATIONS !== "undefined" && TRANSLATIONS.en[key]) || key;
}

function applyTranslations() {
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

// Cold-start overlay: free-tier hosts (Render) spin the backend down after
// idle and take 30-60s to wake on the next request. If an /api/ request is
// still pending after a few seconds, show a "waking up" overlay instead of
// leaving the page looking stalled/broken.
let pendingApiRequests = 0;
let coldStartTimer = null;
function markApiRequestStart(url) {
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
function markApiRequestEnd(url) {
    if (typeof url !== "string" || !url.startsWith("/api/")) return;
    pendingApiRequests = Math.max(0, pendingApiRequests - 1);
    if (pendingApiRequests === 0) {
        clearTimeout(coldStartTimer);
        coldStartTimer = null;
        const overlay = document.getElementById("cold-start-overlay");
        if (overlay) overlay.style.display = "none";
    }
}

// Global Fetch Interceptor - the session is an HttpOnly cookie, which the
// browser attaches to same-origin requests automatically, so this no longer
// needs to manage an Authorization header itself. It still auto-detects
// JSON bodies and force-logs-out on a 401 (expired/invalid session).
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
            // Unauthorized or expired session, force logout
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

document.addEventListener("DOMContentLoaded", () => {
    // State management variables
    let activeScenario = null;
    let scenarios = [];
    let employees = [];
    let topics = [];
    let allocations = [];
    let dashboardData = null;
    let trashData = { employees: [], topics: [] };
    let selectedEmployeeIds = new Set();
    let refreshRequestId = 0;
    
    let activeRole = "admin"; // admin or user
    let activeSection = "matrix-section";
    let activeDashTab = "tab-executive";
    
    // Filters state
    const filters = {
        location: "",
        team: "",
        department: "",
        category: "",
        minRate: 0,
        maxRate: 999999,
        manager: "",
        status: "",
        topicId: "",
        employeeSearch: "",
        minUtil: 0,
        maxUtil: 999,
        minCost: 0,
        maxCost: 999999999
    };

    // Allocation Matrix column sort state (null = insertion order)
    let matrixSortField = null;
    let matrixSortOrder = 1;
    let matrixGrouping = "none";
    let slideTableOverrides = {};
    let matrixMobileView = "cards";

    // Management Panel CRUD states
    let empSearch = "";
    let empLocFilter = "";
    let empSortField = "name";
    let empSortOrder = 1;

    let topicSearch = "";
    let topicCatFilter = "";
    let topicSortField = "name";
    let topicSortOrder = 1;

    // Audit Logs search/filter state - logs are fetched once and re-filtered
    // client-side so search/filter changes don't need a network round trip.
    let auditLogsCache = [];
    let auditLogSearch = "";
    let auditLogActionFilter = "";
    let auditLogUserFilter = "";

    // User Settings search/filter state - same client-side re-filter pattern.
    let usersCache = [];
    let userSearch = "";
    let userRoleFilter = "";

    // Executive dashboard overview table sort states
    let teamOvSortField = "total_cost";
    let teamOvSortOrder = -1;
    let empOvSortField = "utilization";
    let empOvSortOrder = -1;

    // Chart.js instances
    let locationChart = null;
    let categoryChart = null;
    let compositionChart = null;
    let departmentChart = null;
    let utilizationChart = null;
    let presLocationChart = null;
    let presDeptChart = null;
    let presLocBreakdownChart = null;

    // Excluded interactive presentation filters
    const excludedFilters = {
        locations: new Set(),
        teams: new Set(),
        departments: new Set()
    };

    // Presentation Deck: last fetched AI predictions, kept around so the deck
    // can be re-rendered (e.g. after reordering slides) without a re-fetch.
    let aiPredictionsData = null;

    // Presentation Deck: which template slides are included and in what order.
    // Persisted to localStorage so a customized deck survives a page reload.
    const DECK_CONFIG_STORAGE_KEY = "presentationDeckConfig_v1";
    let deckConfig = null;

    // DOM Elements
    const scenarioSelect = document.getElementById("scenario-select");
    const formLogin = document.getElementById("form-login");
    const btnLogout = document.getElementById("btn-logout");
    const btnResetDemo = document.getElementById("btn-reset-demo");
    const userDisplayName = document.getElementById("user-display-name");
    const loginOverlay = document.getElementById("login-overlay");
    const loginErrorAlert = document.getElementById("login-error-alert");
    
    const navItems = document.querySelectorAll(".nav-item");
    const mainSections = document.querySelectorAll(".main-section");
    
    const btnResetFilters = document.getElementById("btn-reset-filters");

    // Modal forms
    const formEmployee = document.getElementById("form-employee");
    const formTopic = document.getElementById("form-topic");
    const formAllocation = document.getElementById("form-allocation");
    const formCreateScenario = document.getElementById("form-create-scenario");
    const formCloneScenario = document.getElementById("form-clone-scenario");

    // AI chat drawer elements
    const btnToggleAI = document.getElementById("btn-toggle-ai");
    const btnCloseAI = document.getElementById("btn-close-ai");
    const aiDrawer = document.getElementById("ai-drawer");
    const aiChatBody = document.getElementById("ai-chat-body");
    const aiChatInput = document.getElementById("ai-chat-input");
    const btnSendAI = document.getElementById("btn-send-ai");
    const aiChatWelcomeHTML = aiChatBody.innerHTML;

    // ==========================================
    // 1. INITIALIZATION & DATA SYNC
    // ==========================================

    // URL hash routing (#matrix, #simulation, ...) - lets a tab survive a
    // refresh or the browser back/forward buttons instead of always
    // resetting to the Allocation Grid.
    function sectionIdToSlug(sectionId) {
        return sectionId.replace(/-section$/, "");
    }

    function slugToSectionId(slug) {
        return slug ? `${slug}-section` : null;
    }

    function isSectionAccessible(sectionId) {
        const navItem = document.querySelector(`[data-target="${sectionId}"]`);
        return !!(navItem && document.getElementById(sectionId) && navItem.style.display !== "none");
    }

    function navigateToSection(sectionId) {
        const navItem = document.querySelector(`[data-target="${sectionId}"]`);
        const sectionEl = document.getElementById(sectionId);
        if (!navItem || !sectionEl) return false;

        navItems.forEach(n => n.classList.remove("active"));
        navItem.classList.add("active");

        activeSection = sectionId;
        mainSections.forEach(s => s.classList.remove("active"));
        sectionEl.classList.add("active");

        updateSidebarFiltersVisibility();

        // Workaround chart redraws
        if (activeSection === "dashboards-section") {
            renderDashboards();
        } else if (activeSection === "presentation-section") {
            renderPresentationDeck();
        } else if (activeSection === "logs-section") {
            fetchAndRenderAdminLogs();
        } else if (activeSection === "users-section") {
            fetchAndRenderUsers();
        } else if (activeSection === "simulation-section") {
            renderSimulationTab();
        } else if (activeSection === "planning-version-section") {
            renderPlanningVersionTab();
        }
        return true;
    }

    // Reads the current URL hash and shows that tab (falling back to the
    // Allocation Grid if the hash is empty, unknown, or not accessible for
    // this user's role) - call once after login/session data is loaded.
    function restoreSectionFromHash(fallbackSectionId = "matrix-section") {
        const requestedSectionId = slugToSectionId(window.location.hash.replace(/^#/, ""));
        const targetSectionId = (requestedSectionId && isSectionAccessible(requestedSectionId))
            ? requestedSectionId
            : fallbackSectionId;
        navigateToSection(targetSectionId);
        history.replaceState({ section: targetSectionId }, "", `#${sectionIdToSlug(targetSectionId)}`);
    }

    async function init() {
        setupEventListeners();
        applyTranslations();

        // Check session - the token itself lives in an HttpOnly cookie we
        // can't read from JS, so ask the backend who (if anyone) it belongs to.
        try {
            const meResponse = await fetch("/api/auth/me");
            if (meResponse.ok) {
                const me = await meResponse.json();
                activeRole = me.role;
                localStorage.setItem("role", me.role);
                localStorage.setItem("username", me.username);
                localStorage.setItem("name", me.name);

                document.body.classList.add("authenticated");
                userDisplayName.innerHTML = `<i class="fa-solid fa-user-circle" style="color: var(--primary-color);"></i> ${me.name}`;
                await fetchScenarios();
                await fetchActiveScenario();
                await refreshAllData();
                restoreSectionFromHash();
            } else {
                document.body.classList.remove("authenticated");
            }
        } catch (error) {
            console.error("Error checking session:", error);
            document.body.classList.remove("authenticated");
        }
        // Load persistent chat history if available
        loadChatHistory();

        updateSidebarFiltersVisibility();
    }

    async function logout() {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch (error) {
            console.error("Error logging out:", error);
        }
        localStorage.removeItem("role");
        localStorage.removeItem("username");
        localStorage.removeItem("name");
        document.body.classList.remove("authenticated");

        // Reset local variables
        scenarios = [];
        employees = [];
        topics = [];
        allocations = [];
        dashboardData = null;

        // Clear login form fields
        if (formLogin) {
            formLogin.reset();
        }
        window.location.reload();
    }

    async function fetchScenarios() {
        try {
            const ts = Date.now();
            const response = await fetch(`/api/scenarios?_ts=${ts}`);
            scenarios = await response.json();
            populateScenarioDropdown();
        } catch (error) {
            console.error("Error fetching scenarios:", error);
        }
    }

    async function fetchActiveScenario() {
        try {
            const ts = Date.now();
            const response = await fetch(`/api/scenarios/active?_ts=${ts}`);
            activeScenario = await response.json();
            scenarioSelect.value = activeScenario.id;
            // The presentation deck's title slide reads activeScenario.name directly
            // at render time (see SLIDE_TEMPLATES.title), so no DOM update is needed here.
        } catch (error) {
            console.error("Error fetching active scenario:", error);
        }
    }

    async function refreshAllData() {
        showLoader();
        const requestId = ++refreshRequestId;
        try {
            const ts = Date.now();
            // Parallel fetches
            const [empRes, topRes, allocRes, reportRes] = await Promise.all([
                fetch(`/api/employees?_ts=${ts}`),
                fetch(`/api/topics?_ts=${ts}`),
                fetch(`/api/allocations?_ts=${ts}`),
                fetch(`/api/reports/dashboard?_ts=${ts}`)
            ]);
            
            if (requestId !== refreshRequestId) return;
            
            const empData = await empRes.json();
            const topData = await topRes.json();
            const allocData = await allocRes.json();
            const repData = await reportRes.json();
            
            if (requestId !== refreshRequestId) return;
            
            employees = empData;
            topics = topData;
            allocations = allocData;
            dashboardData = repData;
            
            renderFiltersPanel();
            renderAllocationMatrix();
            renderDashboards();
            renderPresentationDeck();
            renderCRUDTables();
            
            await fetchAIPredictions(requestId);
            if (activeRole !== "user") {
                await fetchTrash(requestId);
            }
        } catch (error) {
            console.error("Error refreshing planning data:", error);
        } finally {
            if (requestId === refreshRequestId) {
                hideLoader();
            }
        }
    }

    // Loader helper (for UI status updates)
    function showLoader() {
        // Simple opacity fade
        document.querySelector(".app-main").style.opacity = "0.7";
    }

    function hideLoader() {
        document.querySelector(".app-main").style.opacity = "1";
    }

    // ==========================================
    // 2. INTERACTIVE RESOURCE MATRIX RENDER
    // ==========================================

    // Click-to-view comment popover: a single shared element repositioned next
    // to whichever comment badge was clicked, instead of a per-cell tooltip
    // (which would get clipped by the matrix's scroll container) or a
    // hover-only title (easy to miss / can't be read on touch devices).
    let commentPopoverOpenIcon = null;

    function toggleCommentPopover(iconEl, commentText) {
        const popover = document.getElementById("comment-popover");
        if (!popover) return;

        if (commentPopoverOpenIcon === iconEl) {
            popover.style.display = "none";
            commentPopoverOpenIcon = null;
            return;
        }

        document.getElementById("comment-popover-text").innerText = commentText;
        popover.style.display = "block";
        commentPopoverOpenIcon = iconEl;

        const rect = iconEl.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - popRect.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
        popover.style.left = `${left}px`;
        popover.style.top = `${rect.bottom + 8}px`;
    }

    function closeCommentPopover() {
        const popover = document.getElementById("comment-popover");
        if (popover) popover.style.display = "none";
        commentPopoverOpenIcon = null;
    }

    document.addEventListener("click", (e) => {
        const popover = document.getElementById("comment-popover");
        if (popover && popover.style.display !== "none" && !popover.contains(e.target)) {
            closeCommentPopover();
        }
    });
    window.addEventListener("scroll", closeCommentPopover, true);

    function renderAllocationMatrix() {
        closeCommentPopover();
        const container = document.getElementById("allocation-matrix-container");
        container.innerHTML = "";

        const isMobile = window.innerWidth <= 768;
        const toggleContainer = document.getElementById("matrix-view-toggle-container");
        if (toggleContainer) {
            toggleContainer.style.display = isMobile ? "inline-flex" : "none";
        }

        // True utilization/cost per employee across ALL their allocations
        // (not just the currently topic-filtered set), so filtering by
        // utilization/cost range means the same thing regardless of which
        // topic columns happen to be visible.
        const trueEmpStats = {};
        employees.forEach(emp => {
            let util = 0.0;
            allocations.forEach(a => {
                if (a.employee_id === emp.id) util += a.percentage;
            });
            trueEmpStats[emp.id] = { util, cost: emp.available_hours * emp.hourly_rate * (util / 100.0) };
        });

        // 1. Apply Filters to local variables
        const filteredEmployees = employees.filter(emp => {
            if (filters.location && emp.location !== filters.location) return false;
            if (filters.team && emp.team !== filters.team) return false;
            if (filters.department && emp.department !== filters.department) return false;
            if (filters.manager && emp.manager !== filters.manager) return false;
            if (filters.status && emp.status !== filters.status) return false;
            if (filters.minRate !== undefined && emp.hourly_rate < filters.minRate) return false;
            if (filters.maxRate !== undefined && emp.hourly_rate > filters.maxRate) return false;
            if (filters.employeeSearch && !emp.name.toLowerCase().includes(filters.employeeSearch.toLowerCase())) return false;
            const trueStats = trueEmpStats[emp.id] || { util: 0, cost: 0 };
            if (filters.minUtil !== undefined && trueStats.util < filters.minUtil) return false;
            if (filters.maxUtil !== undefined && trueStats.util > filters.maxUtil) return false;
            if (filters.minCost !== undefined && trueStats.cost < filters.minCost) return false;
            if (filters.maxCost !== undefined && trueStats.cost > filters.maxCost) return false;
            if (filters.topicId) {
                const hasAlloc = allocations.some(a => a.employee_id === emp.id && a.topic_id === parseInt(filters.topicId) && a.percentage > 0.0);
                if (!hasAlloc) return false;
            }
            return true;
        });

        const filteredTopics = topics.filter(topic => {
            if (filters.category && topic.category !== filters.category) return false;
            return true;
        });

        if (filteredEmployees.length === 0 && filteredTopics.length === 0) {
            container.innerHTML = "<div class='empty-state-message'>No matches found for active filters. Add employees or topics.</div>";
            return;
        }

        // Map allocation list to map for quick O(1) checks
        const allocMap = {};
        allocations.forEach(a => {
            allocMap[`${a.employee_id}_${a.topic_id}`] = a;
        });

        // Compute employee total allocations in advance
        const empAllocSums = {};
        filteredEmployees.forEach(emp => {
            empAllocSums[emp.id] = 0.0;
            filteredTopics.forEach(topic => {
                const key = `${emp.id}_${topic.id}`;
                if (allocMap[key]) {
                    empAllocSums[emp.id] += allocMap[key].percentage;
                }
            });
        });

        // Compute topic totals: staff cost, internal additional, external cost, recovery, and net totals
        const topicStaffCosts = {};
        const topicAllocPctTotals = {};
        filteredTopics.forEach(t => {
            topicStaffCosts[t.id] = 0.0;
            topicAllocPctTotals[t.id] = 0.0;
            filteredEmployees.forEach(emp => {
                const key = `${emp.id}_${t.id}`;
                const pct = allocMap[key] ? allocMap[key].percentage : 0.0;
                if (pct > 0.0) {
                    topicStaffCosts[t.id] += emp.available_hours * emp.hourly_rate * (pct / 100.0);
                    topicAllocPctTotals[t.id] += pct;
                }
            });
        });

        // Master admin and admin have full control over the matrix: every cell is
        // editable, and rows/columns can be added or removed directly from the grid.
        const canEditGrid = activeRole === "admin" || activeRole === "master_admin";

        // --- Column sorting: click a header to sort employees by that column.
        // Sort value getters, keyed the same as the `data-sort`-ish key passed
        // to makeSortIcon/attachSort below.
        function matrixSortValue(emp, key) {
            if (key === "name") return emp.name;
            if (key === "team") return emp.team;
            if (key === "location") return emp.location;
            if (key === "hours") return emp.available_hours;
            if (key === "rate") return emp.hourly_rate;
            if (key === "total") return empAllocSums[emp.id] || 0;
            if (key.startsWith("topic:")) {
                const topicId = parseInt(key.slice(6), 10);
                const alloc = allocMap[`${emp.id}_${topicId}`];
                return alloc ? alloc.percentage : 0;
            }
            return null;
        }

        function makeSortIcon(key) {
            const icon = document.createElement("i");
            const isActive = matrixSortField === key;
            icon.className = "matrix-sort-icon " + (isActive
                ? (matrixSortOrder === 1 ? "fa-solid fa-sort-up active" : "fa-solid fa-sort-down active")
                : "fa-solid fa-sort");
            return icon;
        }

        function attachSort(th, key) {
            th.classList.add("matrix-sortable-th");
            th.appendChild(makeSortIcon(key));
            th.addEventListener("click", () => {
                if (matrixSortField === key) {
                    matrixSortOrder = -matrixSortOrder;
                } else {
                    matrixSortField = key;
                    matrixSortOrder = 1;
                }
                renderAllocationMatrix();
            });
        }

        // Create table elements
        const table = document.createElement("table");
        table.className = "matrix-table";

        // --- HEADERS ---
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");

        // Metadata headers - each one is click-to-sort.
        const thEmp = document.createElement("th");
        thEmp.className = "sticky-col";
        thEmp.innerHTML = `<span>${t("matrix.colEmployee")}</span>`;
        attachSort(thEmp, "name");
        headerRow.appendChild(thEmp);

        const thTeam = document.createElement("th");
        thTeam.innerHTML = `<span>${t("matrix.colTeam")}</span>`;
        attachSort(thTeam, "team");
        headerRow.appendChild(thTeam);

        const thLoc = document.createElement("th");
        thLoc.innerHTML = `<span>${t("matrix.colLocation")}</span>`;
        attachSort(thLoc, "location");
        headerRow.appendChild(thLoc);

        const thHours = document.createElement("th");
        thHours.innerHTML = `<span>${t("matrix.colHours")}</span>`;
        attachSort(thHours, "hours");
        headerRow.appendChild(thHours);

        const thRate = document.createElement("th");
        thRate.innerHTML = `<span>${t("matrix.colRate")}</span>`;
        attachSort(thRate, "rate");
        headerRow.appendChild(thRate);

        // Topic column headers - click to sort by that topic's allocation %,
        // double-click to edit the topic, or remove the column entirely with
        // the small close icon (admin/master admin only).
        filteredTopics.forEach(topic => {
            const thTopic = document.createElement("th");
            thTopic.className = "matrix-topic-th";

            const topRow = document.createElement("div");
            topRow.className = "matrix-th-row";

            const label = document.createElement("span");
            label.className = "matrix-th-label";
            label.innerText = topic.name;
            topRow.appendChild(label);
            topRow.appendChild(makeSortIcon(`topic:${topic.id}`));

            if (canEditGrid) {
                const removeBtn = document.createElement("i");
                removeBtn.className = "fa-solid fa-circle-xmark matrix-col-remove";
                removeBtn.title = "Remove this column (topic)";
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    deleteTopicPrompt(topic.id);
                });
                topRow.appendChild(removeBtn);
            }

            thTopic.appendChild(topRow);

            const subtitle = document.createElement("small");
            subtitle.className = "matrix-th-subtitle";
            subtitle.innerText = topic.category;
            thTopic.appendChild(subtitle);

            thTopic.addEventListener("click", () => {
                const key = `topic:${topic.id}`;
                if (matrixSortField === key) {
                    matrixSortOrder = -matrixSortOrder;
                } else {
                    matrixSortField = key;
                    matrixSortOrder = 1;
                }
                renderAllocationMatrix();
            });

            if (canEditGrid) {
                thTopic.title = "Click to sort, double-click to edit this column";
                thTopic.addEventListener("dblclick", (e) => {
                    e.stopPropagation();
                    editTopicPrompt(topic.id);
                });
            } else {
                thTopic.title = "Click to sort";
            }

            headerRow.appendChild(thTopic);
        });

        // Total Column Header
        const thTotal = document.createElement("th");
        thTotal.innerHTML = `<span>${t("matrix.colTotalUtil")}</span>`;
        attachSort(thTotal, "total");
        headerRow.appendChild(thTotal);

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Helper to get group value for an employee
        function getEmployeePrimaryTopic(emp) {
            let maxPct = -1;
            let primaryTopicName = "Unassigned / No Allocations";
            filteredTopics.forEach(t => {
                const key = `${emp.id}_${t.id}`;
                const pct = allocMap[key] ? allocMap[key].percentage : 0.0;
                if (pct > maxPct && pct > 0.0) {
                    maxPct = pct;
                    primaryTopicName = t.name;
                }
            });
            return primaryTopicName;
        }

        function getGroupValue(emp) {
            if (matrixGrouping === "team") return emp.team;
            if (matrixGrouping === "location") return emp.location;
            if (matrixGrouping === "topic") return getEmployeePrimaryTopic(emp);
            return "";
        }

        // Apply sorting (incorporates hierarchical grouping sorting)
        const sortedEmployees = [...filteredEmployees];
        sortedEmployees.sort((a, b) => {
            if (matrixGrouping !== "none") {
                const gA = getGroupValue(a);
                const gB = getGroupValue(b);
                const comp = gA.localeCompare(gB);
                if (comp !== 0) return comp;
            }
            if (matrixSortField) {
                const va = matrixSortValue(a, matrixSortField);
                const vb = matrixSortValue(b, matrixSortField);
                if (typeof va === "string") {
                    return va.localeCompare(vb) * matrixSortOrder;
                }
                return (va - vb) * matrixSortOrder;
            }
            return 0;
        });

        if (isMobile && matrixMobileView === "cards") {
            const cardListContainer = document.createElement("div");
            cardListContainer.className = "matrix-mobile-card-list";
            
            let lastGroup = null;
            sortedEmployees.forEach(emp => {
                const totalAlloc = empAllocSums[emp.id] || 0.0;
                const stats = trueEmpStats[emp.id] || { util: 0, cost: 0 };
                
                if (matrixGrouping !== "none") {
                    const currentGroup = getGroupValue(emp);
                    if (currentGroup !== lastGroup) {
                        lastGroup = currentGroup;
                        const groupEmps = filteredEmployees.filter(e => getGroupValue(e) === currentGroup);
                        const headcount = groupEmps.length;
                        
                        let totalCost = 0;
                        let totalUtil = 0;
                        groupEmps.forEach(e => {
                            const st = trueEmpStats[e.id] || { util: 0, cost: 0 };
                            totalCost += st.cost;
                            totalUtil += st.util;
                        });
                        const avgUtil = headcount > 0 ? (totalUtil / headcount) : 0;
                        
                        const groupHeader = document.createElement("div");
                        groupHeader.style.cssText = "padding: 10px 14px; background: rgba(59,130,246,0.15); border-left: 4px solid var(--primary-color); border-radius: 8px; font-weight: bold; font-size: 13px; color: var(--text-primary); margin-top: 10px;";
                        groupHeader.innerHTML = `
                            <i class="fa-solid fa-folder-open" style="margin-right: 4px; color: var(--accent-color);"></i> ${currentGroup}
                            <span style="font-size: 10px; color: var(--text-secondary); font-weight: normal; margin-left: 8px;">
                                (${headcount} Staff | Avg Util: ${avgUtil.toFixed(0)}%)
                            </span>
                        `;
                        cardListContainer.appendChild(groupHeader);
                    }
                }
                
                const card = document.createElement("div");
                card.className = "matrix-mobile-card";
                
                let utilColor = "var(--success-color)";
                if (totalAlloc > 100.0) utilColor = "var(--danger-color)";
                else if (totalAlloc > 90.0) utilColor = "var(--warning-color)";
                
                const employeeAllocs = [];
                filteredTopics.forEach(t => {
                    const key = `${emp.id}_${t.id}`;
                    const val = allocMap[key] ? allocMap[key].percentage : 0;
                    if (val > 0) {
                        employeeAllocs.push({ topicId: t.id, name: t.name, pct: val });
                    }
                });
                
                const allocRowsHTML = employeeAllocs.map(a => `
                    <div class="matrix-mobile-alloc-row">
                        <div class="matrix-mobile-alloc-info">
                            <span style="font-size: 11.5px; font-weight: 500; color: var(--text-primary);">${a.name}</span>
                            <span style="font-weight: 600; font-size: 11.5px; color: var(--text-primary);">${a.pct}%</span>
                        </div>
                        <div class="matrix-mobile-alloc-bar">
                            <div class="matrix-mobile-alloc-bar-fill" style="width: ${a.pct}%; background: var(--primary-color);"></div>
                        </div>
                    </div>
                `).join("");
                
                card.innerHTML = `
                    <div class="matrix-mobile-card-header">
                        <div class="matrix-mobile-card-title">
                            <span class="matrix-mobile-card-name">${emp.name}</span>
                            <span class="matrix-mobile-card-meta">
                                <span style="color: var(--text-secondary);"><i class="fa-solid fa-people-group" style="margin-right: 4px; color: var(--text-secondary);"></i> ${emp.team}</span>
                                <span style="color: var(--text-secondary);"><i class="fa-solid fa-location-dot" style="margin-right: 4px; color: var(--text-secondary);"></i> ${emp.location}</span>
                            </span>
                        </div>
                        <span class="matrix-mobile-card-util" style="background: color-mix(in srgb, ${utilColor} 12%, transparent); color: ${utilColor}; border: 1px solid color-mix(in srgb, ${utilColor} 30%, transparent);">
                            ${totalAlloc.toFixed(0)}% Util
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-secondary); border-bottom: 1px dashed var(--glass-border); padding-bottom: 8px; margin-top: 4px;">
                        <span>Rate: <strong>$${emp.hourly_rate}/hr</strong></span>
                        <span>Annual Cost: <strong>$${stats.cost.toLocaleString(undefined, {maximumFractionDigits:0})}</strong></span>
                    </div>
                    <div class="matrix-mobile-card-allocations" style="margin-top: 8px;">
                        <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">Project Allocations</span>
                        ${allocRowsHTML || '<span style="font-size: 11px; color: var(--text-secondary); font-style: italic;">No current allocations.</span>'}
                    </div>
                    ${canEditGrid ? `
                        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; border-top: 1px solid var(--glass-border); padding-top: 10px;">
                            <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.editEmployeePrompt(${emp.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                            <button class="btn btn-danger btn-sm" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.deleteEmployeePrompt(${emp.id})"><i class="fa-solid fa-trash"></i> Delete</button>
                        </div>
                    ` : ""}
                `;
                cardListContainer.appendChild(card);
            });
            
            container.appendChild(cardListContainer);
            return;
        }

        // --- BODY ROWS (EMPLOYEES) ---
        const tbody = document.createElement("tbody");
        
        let lastGroup = null;
        sortedEmployees.forEach(emp => {
            if (matrixGrouping !== "none") {
                const currentGroup = getGroupValue(emp);
                if (currentGroup !== lastGroup) {
                    lastGroup = currentGroup;
                    
                    const groupTr = document.createElement("tr");
                    groupTr.className = "matrix-group-header-row";
                    
                    const groupEmps = filteredEmployees.filter(e => getGroupValue(e) === currentGroup);
                    const headcount = groupEmps.length;
                    
                    let totalCost = 0;
                    let totalUtil = 0;
                    groupEmps.forEach(e => {
                        const stats = trueEmpStats[e.id] || { util: 0, cost: 0 };
                        totalCost += stats.cost;
                        totalUtil += stats.util;
                    });
                    const avgUtil = headcount > 0 ? (totalUtil / headcount) : 0;
                    
                    const groupTd = document.createElement("td");
                    groupTd.colSpan = 6 + filteredTopics.length;
                    
                    groupTd.innerHTML = `
                        <i class="fa-solid fa-folder-open" style="color: var(--accent-color); margin-right: 4px;"></i> <span style="font-weight:700; color: var(--text-primary);">${currentGroup}</span> 
                        <span style="font-size: 11px; color: var(--text-secondary); font-weight: normal; margin-left: 12px;">
                            (Headcount: <strong>${headcount}</strong> | Avg Util: <strong>${avgUtil.toFixed(1)}%</strong> | Group Annual Cost: <strong>$${totalCost.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</strong>)
                        </span>
                    `;
                    groupTr.appendChild(groupTd);
                    tbody.appendChild(groupTr);
                }
            }

            const tr = document.createElement("tr");

            // Meta cells
            const tdName = document.createElement("td");
            tdName.className = "sticky-col";

            const nameGroup = document.createElement("span");
            nameGroup.className = "matrix-row-name-group";

            const nameText = document.createElement("span");
            nameText.innerText = emp.name;
            nameGroup.appendChild(nameText);

            const totalAlloc = empAllocSums[emp.id] || 0.0;
            if (totalAlloc > 100.0) {
                tdName.classList.add("matrix-overloaded-name");

                const warningIcon = document.createElement("i");
                warningIcon.className = "fa-solid fa-triangle-exclamation matrix-warning-icon";
                warningIcon.title = `Overloaded! Total allocation is ${totalAlloc.toFixed(1)}%`;
                warningIcon.style.color = "var(--danger-color)";
                warningIcon.style.marginLeft = "6px";
                nameGroup.appendChild(warningIcon);

                tr.classList.add("tr-overloaded");
            }

            tdName.appendChild(nameGroup);

            if (canEditGrid) {
                const removeBtn = document.createElement("i");
                removeBtn.className = "fa-solid fa-circle-xmark matrix-row-remove";
                removeBtn.title = "Remove this row (employee)";
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    deleteEmployeePrompt(emp.id);
                });
                tdName.appendChild(removeBtn);
            }
            tr.appendChild(tdName);

            const tdTeam = document.createElement("td");
            tdTeam.innerText = emp.team;
            tr.appendChild(tdTeam);

            const tdLoc = document.createElement("td");
            tdLoc.innerText = emp.location;
            tr.appendChild(tdLoc);

            const tdHours = document.createElement("td");
            tdHours.innerText = emp.available_hours.toLocaleString();
            tr.appendChild(tdHours);

            const tdRate = document.createElement("td");
            tdRate.innerText = `$${emp.hourly_rate.toFixed(2)}`;
            tr.appendChild(tdRate);

            // Master admin and admin can edit every cell directly from the grid -
            // double-clicking a metadata cell opens the employee profile focused
            // on that field, saving through the same endpoint as the Management Panel.
            if (canEditGrid) {
                [
                    [tdName, "emp-name"], [tdTeam, "emp-team"], [tdLoc, "emp-location"],
                    [tdHours, "emp-hours"], [tdRate, "emp-rate"]
                ].forEach(([td, focusFieldId]) => {
                    td.title = "Double-click to edit";
                    td.style.cursor = "pointer";
                    td.addEventListener("dblclick", () => {
                        editEmployeePrompt(emp.id);
                        setTimeout(() => document.getElementById(focusFieldId)?.focus(), 150);
                    });
                });
            }

            // Topic cells (Matrix percentage cells)
            filteredTopics.forEach(topic => {
                const tdCell = document.createElement("td");
                const key = `${emp.id}_${topic.id}`;
                const allocVal = allocMap[key] ? allocMap[key].percentage : 0.0;
                const comment = allocMap[key] ? allocMap[key].comment : "";

                const span = document.createElement("span");
                span.className = "matrix-cell-pct";
                span.innerText = allocVal > 0 ? `${allocVal}%` : "-";

                if (allocVal > 0) {
                    const cellHours = emp.available_hours * (allocVal / 100.0);
                    const cellCost = emp.available_hours * emp.hourly_rate * (allocVal / 100.0);
                    tdCell.title = `${allocVal}% • ${cellHours.toLocaleString(undefined, {maximumFractionDigits: 0})} hrs/yr • $${cellCost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
                }

                // Event cell edit handlers
                if (activeRole === "admin" || activeRole === "master_admin") {
                    tdCell.addEventListener("dblclick", () => {
                        openAllocationModal(emp.id, emp.name, topic.id, topic.name, allocVal, comment);
                    });
                }
                tdCell.appendChild(span);

                if (comment) {
                    const icon = document.createElement("i");
                    icon.className = "fa-solid fa-comment-dots matrix-comment-indicator";
                    icon.addEventListener("click", (e) => {
                        e.stopPropagation();
                        toggleCommentPopover(icon, comment);
                    });
                    tdCell.appendChild(icon);
                }

                tr.appendChild(tdCell);
            });

            // Employee total cell
            const tdTotalVal = document.createElement("td");
            const utilVal = empAllocSums[emp.id];
            tdTotalVal.innerText = `${utilVal.toFixed(1)}%`;
            
            // Highlight overloaded employees
            if (utilVal > 100.0) {
                tdTotalVal.className = "cell-danger";
            } else if (utilVal > 0.0) {
                tdTotalVal.className = "cell-normal";
            } else {
                tdTotalVal.className = "cell-warning";
            }
            tr.appendChild(tdTotalVal);

            tbody.appendChild(tr);
        });

        // --- BOTTOM COSTS ROWS (Aggregated Topic Costs) ---

        // 0. Total Allocation % Row - mirrors the AOP planning sheet's "TOTAL"
        // row: sum of every visible employee's allocation % per topic column,
        // expressed both as a % sum and its FTE-equivalent.
        const trAllocTotal = document.createElement("tr");
        trAllocTotal.className = "matrix-cost-row";

        const tdATLabel = document.createElement("td");
        tdATLabel.className = "sticky-col matrix-cost-title";
        tdATLabel.innerText = t("matrix.rowTotalAllocation");
        trAllocTotal.appendChild(tdATLabel);

        for (let i = 0; i < 4; i++) trAllocTotal.appendChild(document.createElement("td"));

        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            const pctTotal = topicAllocPctTotals[t.id];
            tdVal.innerText = `${pctTotal.toFixed(1)}%`;
            tdVal.title = `${(pctTotal / 100).toFixed(2)} FTE-equivalent`;
            trAllocTotal.appendChild(tdVal);
        });
        trAllocTotal.appendChild(document.createElement("td"));
        tbody.appendChild(trAllocTotal);

        // 1. Employee Internal Cost Row
        const trEmpCost = document.createElement("tr");
        trEmpCost.className = "matrix-cost-row";
        
        const tdECLabel = document.createElement("td");
        tdECLabel.className = "sticky-col matrix-cost-title";
        tdECLabel.innerText = t("matrix.rowEmployeeCost");
        trEmpCost.appendChild(tdECLabel);
        
        // Empty cells for other meta columns
        for(let i=0; i<4; i++) trEmpCost.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            tdVal.innerText = `$${topicStaffCosts[t.id].toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            trEmpCost.appendChild(tdVal);
        });
        trEmpCost.appendChild(document.createElement("td")); // Total cell empty
        tbody.appendChild(trEmpCost);

        // 2. Additional Internal Costs Row
        const trIntCost = document.createElement("tr");
        trIntCost.className = "matrix-cost-row";
        
        const tdICLabel = document.createElement("td");
        tdICLabel.className = "sticky-col matrix-cost-title";
        tdICLabel.innerText = t("matrix.rowAdditionalInternal");
        trIntCost.appendChild(tdICLabel);
        for(let i=0; i<4; i++) trIntCost.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            const addIntCost = t.additional_costs.filter(c => c.cost_type === "internal").reduce((acc, curr) => acc + curr.amount, 0);
            tdVal.innerText = addIntCost > 0 ? `$${addIntCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "-";
            trIntCost.appendChild(tdVal);
        });
        trIntCost.appendChild(document.createElement("td"));
        tbody.appendChild(trIntCost);

        // 3. External Costs Row
        const trExtCost = document.createElement("tr");
        trExtCost.className = "matrix-cost-row";
        
        const tdEXCLabel = document.createElement("td");
        tdEXCLabel.className = "sticky-col matrix-cost-title";
        tdEXCLabel.innerText = t("matrix.rowExternalCost");
        trExtCost.appendChild(tdEXCLabel);
        for(let i=0; i<4; i++) trExtCost.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            const extCost = t.additional_costs.filter(c => c.cost_type === "external").reduce((acc, curr) => acc + curr.amount, 0);
            tdVal.innerText = extCost > 0 ? `$${extCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "-";
            trExtCost.appendChild(tdVal);
        });
        trExtCost.appendChild(document.createElement("td"));
        tbody.appendChild(trExtCost);

        // 4. Cost Recovery Row
        const trRecovery = document.createElement("tr");
        trRecovery.className = "matrix-cost-row";
        
        const tdRecLabel = document.createElement("td");
        tdRecLabel.className = "sticky-col matrix-cost-title text-green";
        tdRecLabel.innerText = t("matrix.rowRecovery");
        trRecovery.appendChild(tdRecLabel);
        for(let i=0; i<4; i++) trRecovery.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            tdVal.innerText = t.recovery > 0 ? `+$${t.recovery.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "-";
            tdVal.className = "text-green";
            trRecovery.appendChild(tdVal);
        });
        trRecovery.appendChild(document.createElement("td"));
        tbody.appendChild(trRecovery);

        // 5. Total Topic Costs Row
        const trTopicTotal = document.createElement("tr");
        trTopicTotal.className = "matrix-cost-row";
        trTopicTotal.style.fontWeight = "bold";
        
        const tdTTL = document.createElement("td");
        tdTTL.className = "sticky-col matrix-cost-title text-blue";
        tdTTL.innerText = t("matrix.rowTotalTopicCost");
        trTopicTotal.appendChild(tdTTL);
        for(let i=0; i<4; i++) trTopicTotal.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            const empCost = topicStaffCosts[t.id];
            const addInt = t.additional_costs.filter(c => c.cost_type === "internal").reduce((acc, curr) => acc + curr.amount, 0);
            const ext = t.additional_costs.filter(c => c.cost_type === "external").reduce((acc, curr) => acc + curr.amount, 0);
            const total = empCost + addInt + ext - t.recovery;
            
            tdVal.innerText = `$${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            tdVal.className = "text-blue";
            trTopicTotal.appendChild(tdVal);
        });
        trTopicTotal.appendChild(document.createElement("td"));
        tbody.appendChild(trTopicTotal);

        table.appendChild(tbody);
        container.appendChild(table);
    }

    // ==========================================
    // 3. KPI DASHBOARD RENDER & CHARTS
    // ==========================================
    
    function renderDashboards() {
        if (!dashboardData) return;

        // EXECUTIVE SUMMARY KPIs
        document.getElementById("kpi-headcount").innerText = dashboardData.total_headcount;
        document.getElementById("kpi-internal-cost").innerText = `$${dashboardData.total_internal_employee_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-add-cost").innerText = `$${dashboardData.total_additional_internal_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-external-cost").innerText = `$${dashboardData.total_external_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-recovery").innerText = `+$${dashboardData.total_recovery_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-net-cost").innerText = `$${dashboardData.total_annual_planning_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

        // Render charts
        renderLocationChart();
        renderCategoryChart();
        renderCompositionChart();
        renderDepartmentChart();
        renderUtilizationChart();

        // Executive risk strip + top cost drivers
        renderExecAlertStrip();
        renderTopCostDriversList();
        renderUtilizationByGroupList("exec-util-by-department-list", dashboardData.utilization_by_department);
        renderUtilizationByGroupList("exec-util-by-location-list", dashboardData.utilization_by_location);

        // Populate breakdowns selectors
        populateDashboardSelects();
        renderTopicDashboard();
        renderTeamDashboard();
        renderEmployeeDashboard();
        renderTeamOverviewTable();
        renderEmployeeOverviewTable();

        applyExecWidgetVisibility();
        renderExecCustomizeList();
    }

    // ==========================================
    // 2B. EXECUTIVE SUMMARY - CUSTOMIZABLE WIDGETS
    // ==========================================
    // Lets an admin/master show or hide individual KPI cards / charts on the
    // Executive Summary tab (e.g. drop "Cost by Department" if it's not
    // relevant to this planning version). Persisted per-browser, mirroring
    // the Presentation Deck's "Customize Slides" pattern.
    const EXEC_CONFIG_STORAGE_KEY = "execSummaryWidgetConfig_v1";
    let execWidgetConfig = null;

    function loadExecWidgetConfig() {
        try {
            const raw = localStorage.getItem(EXEC_CONFIG_STORAGE_KEY);
            if (raw) {
                execWidgetConfig = JSON.parse(raw);
                return;
            }
        } catch (e) {
            console.error("Failed to load exec summary widget config, resetting to default:", e);
        }
        execWidgetConfig = {};
    }

    function saveExecWidgetConfig() {
        try {
            localStorage.setItem(EXEC_CONFIG_STORAGE_KEY, JSON.stringify(execWidgetConfig));
        } catch (e) {
            console.warn("Failed to save exec widget config to localStorage:", e);
        }
    }

    function applyExecWidgetVisibility() {
        if (!execWidgetConfig) loadExecWidgetConfig();
        document.querySelectorAll("#tab-executive [data-widget-id]").forEach(el => {
            const id = el.getAttribute("data-widget-id");
            const visible = execWidgetConfig[id] !== false;
            el.classList.toggle("exec-widget-hidden", !visible);
        });
    }

    function renderExecCustomizeList() {
        const list = document.getElementById("exec-customize-list");
        if (!list) return;
        if (!execWidgetConfig) loadExecWidgetConfig();

        const widgets = [...document.querySelectorAll("#tab-executive [data-widget-id]")];
        list.innerHTML = widgets.map(el => {
            const id = el.getAttribute("data-widget-id");
            const label = el.getAttribute("data-widget-label") || id;
            const visible = execWidgetConfig[id] !== false;
            return `
                <li>
                    <input type="checkbox" class="exec-widget-toggle" data-id="${id}" ${visible ? "checked" : ""}>
                    <span>${label}</span>
                </li>
            `;
        }).join("");

        list.querySelectorAll(".exec-widget-toggle").forEach(cb => {
            cb.addEventListener("change", () => {
                execWidgetConfig[cb.getAttribute("data-id")] = cb.checked;
                saveExecWidgetConfig();
                applyExecWidgetVisibility();
            });
        });
    }

    function renderLocationChart() {
        const ctx = document.getElementById("chart-location").getContext("2d");
        
        if (locationChart) locationChart.destroy();
        
        const labels = Object.keys(dashboardData.cost_by_location);
        const data = Object.values(dashboardData.cost_by_location);
        
        if (labels.length === 0) return;

        locationChart = new Chart(ctx, {
            type: "pie",
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"],
                    borderWidth: 1,
                    borderColor: "rgba(255, 255, 255, 0.1)"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: document.body.classList.contains("theme-light") ? "#0f172a" : "#f3f4f6", font: { family: "Outfit" } }
                    }
                }
            }
        });
    }

    function renderCategoryChart() {
        const ctx = document.getElementById("chart-category").getContext("2d");
        
        if (categoryChart) categoryChart.destroy();
        
        const labels = Object.keys(dashboardData.cost_by_category);
        const data = Object.values(dashboardData.cost_by_category);

        if (labels.length === 0) return;

        categoryChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Budget ($)",
                    data: data,
                    backgroundColor: "rgba(59, 130, 246, 0.75)",
                    borderColor: "#3b82f6",
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: document.body.classList.contains("theme-light") ? "#475569" : "#9ca3af", font: { family: "Outfit" } }, grid: { display: false } },
                    y: { ticks: { color: document.body.classList.contains("theme-light") ? "#475569" : "#9ca3af", font: { family: "Outfit" } }, grid: { color: document.body.classList.contains("theme-light") ? "rgba(15, 23, 42, 0.08)" : "rgba(255,255,255,0.05)" } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    function renderCompositionChart() {
        const ctx = document.getElementById("chart-composition").getContext("2d");

        if (compositionChart) compositionChart.destroy();

        const values = [
            dashboardData.total_internal_employee_cost,
            dashboardData.total_additional_internal_cost,
            dashboardData.total_external_cost
        ];
        if (values.every(v => v === 0)) return;

        compositionChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["Internal Staff Cost", "Additional Internal Cost", "External Vendor Cost"],
                datasets: [{
                    data: values,
                    backgroundColor: ["#3b82f6", "#f59e0b", "#ef4444"],
                    borderWidth: 1,
                    borderColor: "rgba(255, 255, 255, 0.1)"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "62%",
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: document.body.classList.contains("theme-light") ? "#0f172a" : "#f3f4f6", font: { family: "Outfit", size: 11 }, boxWidth: 12 }
                    }
                }
            }
        });
    }

    function renderDepartmentChart() {
        const ctx = document.getElementById("chart-department").getContext("2d");

        if (departmentChart) departmentChart.destroy();

        const entries = Object.entries(dashboardData.cost_by_department).sort((a, b) => b[1] - a[1]);
        const labels = entries.map(e => e[0]);
        const data = entries.map(e => e[1]);

        if (labels.length === 0) return;

        departmentChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Budget ($)",
                    data: data,
                    backgroundColor: "rgba(139, 92, 246, 0.75)",
                    borderColor: "#8b5cf6",
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: "y",
                scales: {
                    x: { ticks: { color: document.body.classList.contains("theme-light") ? "#475569" : "#9ca3af", font: { family: "Outfit" } }, grid: { color: document.body.classList.contains("theme-light") ? "rgba(15, 23, 42, 0.08)" : "rgba(255,255,255,0.05)" } },
                    y: { ticks: { color: document.body.classList.contains("theme-light") ? "#475569" : "#9ca3af", font: { family: "Outfit" } }, grid: { display: false } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    // Buckets every currently-loaded employee's total allocation % into ranges,
    // matching the same overload threshold (>100%) used across the rest of the app.
    function computeUtilizationBuckets() {
        const buckets = { "Idle (0%)": 0, "Under-utilized (1-49%)": 0, "Normal (50-99%)": 0, "Full (100%)": 0, "Overloaded (>100%)": 0 };
        employees.forEach(emp => {
            const util = allocations.filter(a => a.employee_id === emp.id).reduce((acc, a) => acc + a.percentage, 0.0);
            if (util <= 0) buckets["Idle (0%)"]++;
            else if (util < 50) buckets["Under-utilized (1-49%)"]++;
            else if (util < 100) buckets["Normal (50-99%)"]++;
            else if (util === 100) buckets["Full (100%)"]++;
            else buckets["Overloaded (>100%)"]++;
        });
        return buckets;
    }

    function renderUtilizationChart() {
        const ctx = document.getElementById("chart-utilization").getContext("2d");

        if (utilizationChart) utilizationChart.destroy();

        const buckets = computeUtilizationBuckets();
        const labels = Object.keys(buckets);
        const data = Object.values(buckets);

        if (employees.length === 0) return;

        utilizationChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Employees",
                    data: data,
                    backgroundColor: ["#6b7280", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: document.body.classList.contains("theme-light") ? "#475569" : "#9ca3af", font: { family: "Outfit", size: 10 } }, grid: { display: false } },
                    y: { ticks: { color: document.body.classList.contains("theme-light") ? "#475569" : "#9ca3af", font: { family: "Outfit" }, precision: 0 }, grid: { color: document.body.classList.contains("theme-light") ? "rgba(15, 23, 42, 0.08)" : "rgba(255,255,255,0.05)" } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    function renderTopCostDriversList() {
        const container = document.getElementById("exec-top-drivers-list");
        if (!container) return;

        const topTopics = dashboardData.highest_cost_topics || [];
        if (topTopics.length === 0) {
            container.innerHTML = "<div class='empty-state-message'>No topic costs to rank yet.</div>";
            return;
        }

        container.innerHTML = topTopics.map((t, idx) => `
            <div class="ranked-list-item">
                <div class="ranked-list-rank">${idx + 1}</div>
                <div class="ranked-list-info">
                    <div class="ranked-list-name">${t.name}</div>
                    <div class="ranked-list-meta">${t.category} &middot; ${t.staff.length} staff planned</div>
                </div>
                <div class="ranked-list-value">$${t.total_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
            </div>
        `).join("");
    }

    function renderUtilizationByGroupList(containerId, utilByGroup) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const entries = Object.entries(utilByGroup || {}).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            container.innerHTML = "<div class='empty-state-message'>No data yet.</div>";
            return;
        }

        container.innerHTML = entries.map(([name, avgUtil], idx) => `
            <div class="ranked-list-item">
                <div class="ranked-list-rank">${idx + 1}</div>
                <div class="ranked-list-info">
                    <div class="ranked-list-name">${name}</div>
                </div>
                <div class="ranked-list-value" style="${avgUtil > 100 ? 'color: var(--danger-color);' : ''}">${avgUtil.toFixed(1)}%</div>
            </div>
        `).join("");
    }

    function renderExecAlertStrip() {
        const container = document.getElementById("exec-alert-strip");
        if (!container) return;

        const overloaded = dashboardData.overloaded_employees || [];

        // Under-resourced: topics with some allocation but under 50% total staffing,
        // mirroring the threshold the AI predictions endpoint already uses.
        const underResourced = (dashboardData.topic_summaries || []).filter(t => {
            const totalPct = t.staff.reduce((acc, s) => acc + s.percentage, 0.0);
            return totalPct > 0 && totalPct < 50.0;
        });

        const chips = [];

        chips.push(overloaded.length > 0
            ? `<div class="exec-alert-chip danger" data-jump="tab-teams"><i class="fa-solid fa-triangle-exclamation"></i> ${overloaded.length} employee${overloaded.length === 1 ? "" : "s"} overloaded (&gt;100%)</div>`
            : `<div class="exec-alert-chip ok"><i class="fa-solid fa-circle-check"></i> No overloaded employees</div>`);

        chips.push(underResourced.length > 0
            ? `<div class="exec-alert-chip warn" data-jump="tab-topics"><i class="fa-solid fa-battery-quarter"></i> ${underResourced.length} topic${underResourced.length === 1 ? "" : "s"} under-resourced (&lt;50% staffed)</div>`
            : `<div class="exec-alert-chip ok"><i class="fa-solid fa-circle-check"></i> All active topics adequately staffed</div>`);

        container.innerHTML = chips.join("");

        container.querySelectorAll(".exec-alert-chip[data-jump]").forEach(chip => {
            chip.addEventListener("click", () => {
                const target = chip.getAttribute("data-jump");
                document.querySelectorAll(".dash-tab").forEach(t => t.classList.toggle("active", t.getAttribute("data-tab") === target));
                document.querySelectorAll(".dash-tab-content").forEach(c => c.classList.toggle("active", c.id === target));
                activeDashTab = target;
            });
        });
    }

    function renderTeamOverviewTable() {
        const tbody = document.querySelector("#team-overview-table tbody");
        if (!tbody || !dashboardData) return;

        const rows = [...dashboardData.team_summaries].sort((a, b) => {
            const valA = a[teamOvSortField];
            const valB = b[teamOvSortField];
            if (typeof valA === "string") return valA.localeCompare(valB) * teamOvSortOrder;
            return (valA - valB) * teamOvSortOrder;
        });

        if (rows.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>No teams planned yet.</td></tr>";
            return;
        }

        tbody.innerHTML = rows.map(t => `
            <tr class="overview-row" data-team="${t.team_name}">
                <td><strong>${t.team_name}</strong></td>
                <td>${t.member_count}</td>
                <td>${t.average_utilization.toFixed(1)}%</td>
                <td><span class="${t.overloaded_count > 0 ? "text-danger" : "text-green"}" style="font-weight:600;">${t.overloaded_count}</span></td>
                <td>$${t.total_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
            </tr>
        `).join("");

        tbody.querySelectorAll("tr.overview-row").forEach(tr => {
            tr.addEventListener("click", () => {
                document.getElementById("select-dash-team").value = tr.getAttribute("data-team");
                renderTeamDashboard();
                document.getElementById("team-dash-details").scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
        });
    }

    function renderEmployeeOverviewTable() {
        const tbody = document.querySelector("#employee-overview-table tbody");
        if (!tbody) return;

        const enriched = employees.map(emp => {
            const util = allocations.filter(a => a.employee_id === emp.id).reduce((acc, a) => acc + a.percentage, 0.0);
            const cost = emp.available_hours * emp.hourly_rate * (util / 100.0);
            return { id: emp.id, name: emp.name, team: emp.team, location: emp.location, utilization: util, cost: cost };
        });

        enriched.sort((a, b) => {
            const valA = a[empOvSortField];
            const valB = b[empOvSortField];
            if (typeof valA === "string") return valA.localeCompare(valB) * empOvSortOrder;
            return (valA - valB) * empOvSortOrder;
        });

        if (enriched.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>No employees planned yet.</td></tr>";
            return;
        }

        tbody.innerHTML = enriched.map(e => `
            <tr class="overview-row" data-emp="${e.id}">
                <td><strong>${e.name}</strong></td>
                <td>${e.team}</td>
                <td>${e.location}</td>
                <td><span class="${e.utilization > 100.0 ? "text-danger" : "text-green"}" style="font-weight:600;">${e.utilization.toFixed(1)}%</span></td>
                <td>$${e.cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
            </tr>
        `).join("");

        tbody.querySelectorAll("tr.overview-row").forEach(tr => {
            tr.addEventListener("click", () => {
                document.getElementById("select-dash-employee").value = tr.getAttribute("data-emp");
                renderEmployeeDashboard();
                document.getElementById("employee-dash-details").scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
        });
    }

    function populateDashboardSelects() {
        // Topics Dropdown
        const topicSelect = document.getElementById("select-dash-topic");
        const prevTopic = topicSelect.value;
        topicSelect.innerHTML = "";
        topics.forEach(t => {
            const opt = document.createElement("option");
            opt.value = t.id;
            opt.innerText = t.name;
            topicSelect.appendChild(opt);
        });
        if (prevTopic && topics.some(t => t.id == prevTopic)) {
            topicSelect.value = prevTopic;
        }

        // Teams Dropdown
        const teamSelect = document.getElementById("select-dash-team");
        const prevTeam = teamSelect.value;
        teamSelect.innerHTML = "";
        const teamsSet = new Set(employees.map(e => e.team));
        teamsSet.forEach(team => {
            const opt = document.createElement("option");
            opt.value = team;
            opt.innerText = team;
            teamSelect.appendChild(opt);
        });
        if (prevTeam && teamsSet.has(prevTeam)) {
            teamSelect.value = prevTeam;
        }

        // Employees Dropdown
        const empSelect = document.getElementById("select-dash-employee");
        const prevEmp = empSelect.value;
        empSelect.innerHTML = "";
        employees.forEach(e => {
            const opt = document.createElement("option");
            opt.value = e.id;
            opt.innerText = e.name;
            empSelect.appendChild(opt);
        });
        if (prevEmp && employees.some(e => e.id == prevEmp)) {
            empSelect.value = prevEmp;
        }
    }

    function renderTopicDashboard() {
        const topicId = document.getElementById("select-dash-topic").value;
        const detailsContainer = document.getElementById("topic-dash-details");
        detailsContainer.innerHTML = "";
        
        if (!topicId || !dashboardData) return;
        
        const summary = dashboardData.topic_summaries.find(t => t.id == topicId);
        if (!summary) return;

        detailsContainer.innerHTML = `
            <div class="detail-grid">
                <div class="detail-card">
                    <div class="detail-card-header">
                        <h4>About Project</h4>
                        <button type="button" class="btn btn-secondary btn-detail-edit admin-only" id="btn-edit-topic-dash" style="padding: 4px 10px; font-size: 12px;"><i class="fa-solid fa-pen"></i> Edit Topic</button>
                    </div>
                    <p><strong>Category:</strong> ${summary.category}</p>
                    <p><strong>Topic Area:</strong> ${summary.area || "General"}</p>
                    <p style="margin-top:8px;"><strong>Description:</strong> ${summary.description || "N/A"}</p>
                </div>
                <div class="detail-card">
                    <h4>Justification & Objective</h4>
                    <p><strong>Justification:</strong> ${summary.justification || "N/A"}</p>
                    <p style="margin-top:8px;"><strong>Objective:</strong> ${summary.objective || "N/A"}</p>
                    <p style="margin-top:8px;"><strong>Deliverables:</strong> ${summary.deliverables || "N/A"}</p>
                </div>
                <div class="detail-card">
                    <h4>Financial Summary</h4>
                    <p><strong>Internal Effort Cost:</strong> $${summary.employee_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p><strong>Additional Internal:</strong> $${summary.additional_internal_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p><strong>External Cost:</strong> $${summary.external_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p><strong>Cost Recovery:</strong> +$${summary.recovery.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p style="margin-top:8px; font-weight:bold; color:var(--primary-color);"><strong>Total Net Cost:</strong> $${summary.total_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
            </div>
            
            <div class="crud-card" style="margin-top:20px; max-height:280px;">
                <div class="crud-card-header">
                    <h3>Contributing Staff</h3>
                </div>
                <div class="crud-table-wrapper">
                    <table class="involved-table">
                        <thead>
                            <tr>
                                <th>Staff Name</th>
                                <th>Team</th>
                                <th>Location</th>
                                <th>Allocation %</th>
                                <th>Effort Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summary.staff.map(s => `
                                <tr>
                                    <td><strong>${s.employee_name}</strong></td>
                                    <td>${s.team}</td>
                                    <td>${s.location}</td>
                                    <td>${s.percentage}%</td>
                                    <td>$${s.cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                </tr>
                            `).join('')}
                            ${summary.staff.length === 0 ? "<tr><td colspan='5' style='text-align:center;'>No staff currently planned.</td></tr>" : ""}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const btnEditTopic = document.getElementById("btn-edit-topic-dash");
        if (btnEditTopic) {
            btnEditTopic.addEventListener("click", () => editTopicPrompt(summary.id));
        }
        toggleRoleUIVisibility();
    }

    function renderTeamDashboard() {
        const teamName = document.getElementById("select-dash-team").value;
        const detailsContainer = document.getElementById("team-dash-details");
        detailsContainer.innerHTML = "";
        
        if (!teamName || !dashboardData) return;
        
        const summary = dashboardData.team_summaries.find(t => t.team_name === teamName);
        if (!summary) return;

        detailsContainer.innerHTML = `
            <div class="detail-grid">
                <div class="detail-card">
                    <div class="detail-card-header">
                        <h4>Team Overview</h4>
                        <button type="button" class="btn btn-secondary btn-detail-edit admin-only" id="btn-edit-team-dash" style="padding: 4px 10px; font-size: 12px;"><i class="fa-solid fa-users-gear"></i> Bulk Edit Team</button>
                    </div>
                    <p><strong>Team Name:</strong> ${summary.team_name}</p>
                    <p><strong>Total Planned Resources:</strong> ${summary.member_count} headcount</p>
                    <p><strong>Total Annual Cost:</strong> $${summary.total_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
                <div class="detail-card">
                    <h4>Capacity Metrics</h4>
                    <p><strong>Average Utilization:</strong> ${summary.average_utilization.toFixed(1)}%</p>
                    <p><strong>Overloaded Headcount:</strong> <span class="${summary.overloaded_count > 0 ? "text-danger" : "text-green"}" style="font-weight:bold;">${summary.overloaded_count} overloaded</span></p>
                </div>
            </div>

            <div class="crud-card" style="margin-top:20px; max-height:280px;">
                <div class="crud-card-header">
                    <h3>Team Contributions by Topic</h3>
                </div>
                <div class="crud-table-wrapper">
                    <table class="involved-table">
                        <thead>
                            <tr>
                                <th>Topic / Project Name</th>
                                <th>Total Team Allocation %</th>
                                <th>Team Cost Contribution</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summary.topics.map(t => `
                                <tr>
                                    <td><strong>${t.topic_name}</strong></td>
                                    <td>${t.total_percentage.toFixed(1)}%</td>
                                    <td>$${t.generated_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                </tr>
                            `).join('')}
                            ${summary.topics.length === 0 ? "<tr><td colspan='3' style='text-align:center;'>No project allocations.</td></tr>" : ""}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const btnEditTeam = document.getElementById("btn-edit-team-dash");
        if (btnEditTeam) {
            btnEditTeam.addEventListener("click", () => {
                selectedEmployeeIds = new Set(employees.filter(e => e.team === teamName).map(e => e.id));
                openBulkEditModal();
            });
        }
        toggleRoleUIVisibility();
    }

    function renderEmployeeDashboard() {
        const empId = document.getElementById("select-dash-employee").value;
        const detailsContainer = document.getElementById("employee-dash-details");
        detailsContainer.innerHTML = "";
        
        if (!empId) return;
        
        const emp = employees.find(e => e.id == empId);
        if (!emp) return;
        
        // Find allocations
        const empAllocations = allocations.filter(a => a.employee_id == empId);
        const totalUtil = empAllocations.reduce((acc, curr) => acc + curr.percentage, 0.0);
        const totalCost = emp.available_hours * emp.hourly_rate * (totalUtil / 100.0);

        detailsContainer.innerHTML = `
            <div class="detail-grid">
                <div class="detail-card">
                    <div class="detail-card-header">
                        <h4>Profile Information</h4>
                        <button type="button" class="btn btn-secondary btn-detail-edit admin-only" id="btn-edit-employee-dash" style="padding: 4px 10px; font-size: 12px;"><i class="fa-solid fa-pen"></i> Edit Employee</button>
                    </div>
                    <p><strong>Name:</strong> ${emp.name}</p>
                    <p><strong>Team:</strong> ${emp.team}</p>
                    <p><strong>Department:</strong> ${emp.department}</p>
                    <p><strong>Location:</strong> ${emp.location}</p>
                    <p><strong>Status:</strong> ${emp.status}</p>
                    <p><strong>Manager:</strong> ${emp.manager || "N/A"}</p>
                </div>
                <div class="detail-card">
                    <h4>Rate & Hours</h4>
                    <p><strong>Hourly Planning Rate:</strong> $${emp.hourly_rate.toFixed(2)}/hr</p>
                    <p><strong>Available Hours/Yr:</strong> ${emp.available_hours.toLocaleString()} hrs</p>
                    <p style="margin-top:8px;"><strong>Total Utilization:</strong> <span class="${totalUtil > 100.0 ? "text-danger" : "text-green"}" style="font-weight:bold;">${totalUtil.toFixed(1)}%</span></p>
                    <p><strong>Total Annual Allocated Cost:</strong> $${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
                <div class="detail-card">
                    <h4>General Notes</h4>
                    <p>${emp.notes || "No notes registered."}</p>
                </div>
            </div>

            <div class="crud-card" style="margin-top:20px; max-height:280px;">
                <div class="crud-card-header">
                    <h3>Initiative Allocation Split</h3>
                </div>
                <div class="crud-table-wrapper">
                    <table class="involved-table">
                        <thead>
                            <tr>
                                <th>Topic / Project Name</th>
                                <th>Allocation %</th>
                                <th>Cost Value</th>
                                <th>Planning Comments</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${empAllocations.map(a => {
                                const topic = topics.find(t => t.id == a.topic_id);
                                if (!topic) return '';
                                const costVal = emp.available_hours * emp.hourly_rate * (a.percentage / 100.0);
                                return `
                                    <tr>
                                        <td><strong>${topic.name}</strong></td>
                                        <td>${a.percentage}%</td>
                                        <td>$${costVal.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                        <td><span style="font-style:italic;color:var(--text-secondary);">${a.comment || "-"}</span></td>
                                    </tr>
                                `;
                            }).join('')}
                            ${empAllocations.length === 0 ? "<tr><td colspan='4' style='text-align:center;'>No allocations registered for this employee.</td></tr>" : ""}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const btnEditEmployee = document.getElementById("btn-edit-employee-dash");
        if (btnEditEmployee) {
            btnEditEmployee.addEventListener("click", () => editEmployeePrompt(emp.id));
        }
        toggleRoleUIVisibility();
    }

    // ==========================================
    // 4. PRESENTATION DECK RENDER
    // ==========================================
    
    // ==========================================
    // 4B. PRESENTATION DECK - SLIDE TEMPLATE SYSTEM
    // ==========================================
    // Each template renders one slide from live data. The deck is a fixed set of
    // templates the user can include/exclude and reorder (see deckConfig) - this
    // is what lets someone build, say, a team-level report without ever exposing
    // individual employee names, just by leaving the "employees" slide unchecked.

    function slideFooterHTML(idx, total) {
        return `<div class="slide-footer"><span>Textron Inc. Planning Platform</span><span class="slide-number">Slide ${idx} of ${total}</span></div>`;
    }

    function csvCell(value) {
        const str = String(value ?? "");
        return `"${str.replace(/"/g, '""')}"`;
    }

    // Conservative row/item cap per slide. Instead of letting a long table or
    // list scroll inside a fixed 16:9 slide (which silently cuts off content
    // when printed or exported), templates split their data into multiple
    // slides so every row is always visible and printable.
    const ROWS_PER_SLIDE = 8;

    function chunkRows(rows, size) {
        if (rows.length === 0) return [[]];
        const chunks = [];
        for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
        return chunks;
    }

    function pageSuffix(pageNum, pageCount) {
        return pageCount > 1 ? ` (Page ${pageNum} of ${pageCount})` : "";
    }

    const SLIDE_TEMPLATES = {
        title: {
            label: "Title Slide",
            desc: "Cover slide with report title and planning version name.",
            buildPages: (ctx, slideId) => [{
                wrapperClass: "slide-title",
                bodyHTML: `
                    <div class="slide-header-brand" style="display: flex; align-items: center; gap: 8px;">
                        <img src="kautex_logo.png" alt="Kautex Logo" class="logo-image" style="height: 28px; width: auto; object-fit: contain; margin-right: 4px;">
                        <span contenteditable="true" data-slide-id="${slideId}" data-edit-key="brand-text">${getSlideText(slideId, "brand-text", "Kautex Textron")}</span>
                    </div>
                    <div class="slide-body-center">
                        <h2 contenteditable="true" data-slide-id="${slideId}" data-edit-key="main-title" style="font-size: 30px; font-weight: 700; margin-bottom: 6px;">${getSlideText(slideId, "main-title", "Engineering Planning & Budget Report")}</h2>
                        <p contenteditable="true" data-slide-id="${slideId}" data-edit-key="scenario-text" style="font-size: 16px; font-weight: 500; color: var(--accent-color); margin-top: 5px;">${getSlideText(slideId, "scenario-text", `Scenario: ${ctx.activeScenario ? ctx.activeScenario.name : "Planning Version"}`)}</p>
                        <div class="slide-subtitle-divider" style="margin: 16px 0;"></div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">
                            <strong>Date Generated:</strong> ${new Date().toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'})} &nbsp;|&nbsp;
                            <strong>Scenario ID:</strong> #${ctx.activeScenario ? ctx.activeScenario.id : "0"} &nbsp;|&nbsp;
                            <strong>Total Headcount:</strong> ${(ctx.employees || []).length} Staff
                        </div>
                        <span class="confidential-stamp">STRICTLY CONFIDENTIAL</span>
                    </div>
                `
            }],
            csv: null
        },
        executive: {
            label: "Executive Summary",
            desc: "Headcount, cost KPIs, and cost-by-location chart.",
            buildPages: (ctx, slideId) => {
                const d = ctx.dashboardData || {};
                return [{
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Executive Planning Overview")}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-left">
                                <div class="pres-kpi-grid">
                                    <div class="pres-kpi-item" style="border-left: 4px solid var(--accent-color); padding: 12px 16px;">
                                        <span class="pres-kpi-label" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi1-label">${getSlideText(slideId, "kpi1-label", "Headcount")}</span>
                                        <span class="pres-kpi-number" style="font-size: 20px; font-weight: 700;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi1-val">${getSlideText(slideId, "kpi1-val", `${d.total_headcount || 0} Staff`)}</span>
                                    </div>
                                    <div class="pres-kpi-item" style="border-left: 4px solid var(--primary-color); padding: 12px 16px;">
                                        <span class="pres-kpi-label" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi2-label">${getSlideText(slideId, "kpi2-label", "Internal Effort Cost")}</span>
                                        <span class="pres-kpi-number" style="font-size: 20px; font-weight: 700;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi2-val">${getSlideText(slideId, "kpi2-val", `$${(d.total_internal_employee_cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</span>
                                    </div>
                                    <div class="pres-kpi-item" style="border-left: 4px solid var(--warning-color); padding: 12px 16px;">
                                        <span class="pres-kpi-label" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi3-label">${getSlideText(slideId, "kpi3-label", "Additional & Vendor Cost")}</span>
                                        <span class="pres-kpi-number" style="font-size: 20px; font-weight: 700;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi3-val">${getSlideText(slideId, "kpi3-val", `$${((d.total_additional_internal_cost || 0) + (d.total_external_cost || 0)).toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</span>
                                    </div>
                                    <div class="pres-kpi-item" style="border-left: 4px solid var(--success-color); padding: 12px 16px;">
                                        <span class="pres-kpi-label" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi4-label">${getSlideText(slideId, "kpi4-label", "Net Fiscal Budget")}</span>
                                        <span class="pres-kpi-number text-blue" style="font-size: 20px; font-weight: 700;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi4-val">${getSlideText(slideId, "kpi4-val", `$${(d.total_annual_planning_cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="slide-col-right">
                                <div class="pres-chart-box" style="padding: 12px 16px; display: flex; flex-direction: column; justify-content: space-between; flex: 1; height: 100%; min-height: 200px; box-sizing: border-box;">
                                    <h4 contenteditable="true" data-slide-id="${slideId}" data-edit-key="chart-title">${getSlideText(slideId, "chart-title", "Annual Planning Cost by Location")}</h4>
                                    <div class="canvas-wrap" style="position: relative; flex: 1; width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center;"><canvas id="pres-chart-location-canvas"></canvas></div>
                                    ${renderExclusionBadges()}
                                </div>
                            </div>
                        </div>
                    `
                }];
            },
            postRender: (ctx, parentEl) => {
                const canvas = parentEl ? parentEl.querySelector("#pres-chart-location-canvas") : document.getElementById("pres-chart-location-canvas");
                if (!canvas || !ctx.dashboardData) return;
                if (presLocationChart) presLocationChart.destroy();
                const labels = Object.keys(ctx.dashboardData.cost_by_location || {});
                const data = Object.values(ctx.dashboardData.cost_by_location || {});
                
                const isLight = parentEl && parentEl.closest("#presentation-overlay") ? parentEl.closest("#presentation-overlay").classList.contains("theme-light-presentation") : document.body.classList.contains("theme-light");
                const textColor = isLight ? "#0f172a" : "#e2e8f0";
                
                presLocationChart = new Chart(canvas.getContext("2d"), {
                    type: "doughnut",
                    data: {
                        labels: labels,
                        datasets: [{ data: data, backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"], borderWidth: 1 }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        onClick: (e, activeEls) => {
                            if (activeEls && activeEls.length > 0) {
                                const index = activeEls[0].index;
                                const label = presLocationChart.data.labels[index];
                                window.toggleLocationExclusion(label);
                            }
                        },
                        plugins: { legend: { position: "right", labels: { color: textColor, font: { family: "Outfit", size: 10 } } } }
                    }
                });
            },
            csv: (ctx) => {
                const d = ctx.dashboardData || {};
                const lines = [
                    "=== Executive Summary ===",
                    "Metric,Value",
                    `${csvCell("Headcount")},${d.total_headcount || 0}`,
                    `${csvCell("Internal Effort Cost")},${d.total_internal_employee_cost || 0}`,
                    `${csvCell("Additional & Vendor Cost")},${(d.total_additional_internal_cost || 0) + (d.total_external_cost || 0)}`,
                    `${csvCell("Cost Recovery")},${-(d.total_recovery_cost || 0)}`,
                    `${csvCell("Net Fiscal Budget")},${d.total_annual_planning_cost || 0}`
                ];
                return lines.join("\n");
            }
        },
        financial_recovery: {
            label: "Fiscal Budget & Recovery",
            desc: "Budget breakdown detailing gross planning cost, recovery deductions, and net project costs.",
            buildPages: (ctx, slideId) => {
                const d = ctx.dashboardData || {};
                const grossCost = (d.total_internal_employee_cost || 0) + (d.total_additional_internal_cost || 0) + (d.total_external_cost || 0);
                const netCost = d.total_annual_planning_cost || 0;
                const recovery = d.total_recovery_cost || 0;
                const recoveryRate = grossCost > 0 ? (recovery / grossCost) * 100.0 : 0.0;
                
                return [{
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Gross Budget & Funding Recovery")}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-left">
                                <div class="pres-kpi-grid" style="grid-template-columns: 1fr; gap: 10px;">
                                    <div class="pres-kpi-item" style="border-left: 4px solid var(--text-secondary); padding: 10px 14px;">
                                        <span class="pres-kpi-label" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi1-label">${getSlideText(slideId, "kpi1-label", "Gross Portfolio Budget")}</span>
                                        <span class="pres-kpi-number" style="font-size: 18px; font-weight: 700;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi1-val">${getSlideText(slideId, "kpi1-val", `$${grossCost.toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</span>
                                    </div>
                                    <div class="pres-kpi-item" style="border-left: 4px solid var(--success-color); padding: 10px 14px;">
                                        <span class="pres-kpi-label" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi2-label">${getSlideText(slideId, "kpi2-label", "Total Cost Recovery / Co-Funding")}</span>
                                        <span class="pres-kpi-number text-green" style="font-size: 18px; font-weight: 700;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi2-val">${getSlideText(slideId, "kpi2-val", `$${recovery.toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</span>
                                    </div>
                                    <div class="pres-kpi-item" style="border-left: 4px solid var(--primary-color); padding: 10px 14px;">
                                        <span class="pres-kpi-label" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi3-label">${getSlideText(slideId, "kpi3-label", "Net Fiscal Target")}</span>
                                        <span class="pres-kpi-number text-blue" style="font-size: 18px; font-weight: 700;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="kpi3-val">${getSlideText(slideId, "kpi3-val", `$${netCost.toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="slide-col-right" style="justify-content: center; align-items: center;">
                                <div style="text-align: center; background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.2); padding: 20px 24px; border-radius: 12px; width: 85%;">
                                    <i class="fa-solid fa-hand-holding-dollar" style="font-size: 32px; color: #10b981; margin-bottom: 8px;"></i>
                                    <h4 style="margin: 0; font-size: 11px; color: var(--text-primary); text-transform: uppercase;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="eff-title">${getSlideText(slideId, "eff-title", "Recovery Efficiency")}</h4>
                                    <p style="font-size: 28px; font-weight: 700; color: #10b981; margin: 6px 0;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="eff-val">${getSlideText(slideId, "eff-val", `${recoveryRate.toFixed(1)}%`)}</p>
                                    <p style="font-size: 10px; color: var(--text-secondary); margin: 0; line-height: 1.4;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="eff-desc">${getSlideText(slideId, "eff-desc", "Ratio of co-funding and external recoveries relative to total gross operational cost allocations.")}</p>
                                </div>
                            </div>
                        </div>
                    `
                }];
            },
            csv: (ctx) => {
                const d = ctx.dashboardData || {};
                const grossCost = (d.total_internal_employee_cost || 0) + (d.total_additional_internal_cost || 0) + (d.total_external_cost || 0);
                const lines = [
                    "=== Fiscal Budget & Recovery ===",
                    "Metric,Value",
                    `Gross Portfolio Budget,${grossCost}`,
                    `Total Cost Recovery,${d.total_recovery_cost || 0}`,
                    `Net Fiscal Target,${d.total_annual_planning_cost || 0}`,
                    `Recovery Efficiency %,${(grossCost > 0 ? ((d.total_recovery_cost || 0) / grossCost) * 100.0 : 0.0).toFixed(2)}`
                ];
                return lines.join("\n");
            }
        },
        topics: {
            label: "Key Initiatives Budget",
            desc: "Per-topic cost breakdown table.",
            buildPages: (ctx, slideId) => {
                const pages = chunkRows(ctx.dashboardData ? (ctx.dashboardData.topic_summaries || []) : [], ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text-${i}">${getSlideText(slideId, `title-text-${i}`, `Key Strategic Initiatives Budget${pageSuffix(i + 1, pages.length)}`)}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead>
                                            <tr>
                                                <th>Initiative / Topic</th>
                                                <th>Category</th>
                                                <th style="text-align: right;">Category Cost</th>
                                                <th style="text-align: right;">Involved Staff</th>
                                                <th style="text-align: right;">Total Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${rows.map(t => `
                                                <tr>
                                                    <td><strong>${t.name || ""}</strong></td>
                                                    <td><span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2);">${t.category || ""}</span></td>
                                                    <td style="text-align: right;">$${((t.additional_internal_cost || 0) + (t.external_cost || 0)).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                    <td style="text-align: right;">${(t.staff || []).length} Planned</td>
                                                    <td style="text-align: right;"><strong>$${(t.total_cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</strong></td>
                                                </tr>
                                            `).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `
                }));
            },
            csv: (ctx) => {
                const lines = ["=== Key Strategic Initiatives Budget ===", "Topic,Category,Category Cost,Involved Staff,Total Cost"];
                (ctx.dashboardData ? (ctx.dashboardData.topic_summaries || []) : []).forEach(t => {
                    lines.push(`${csvCell(t.name)},${csvCell(t.category)},${(t.additional_internal_cost || 0) + (t.external_cost || 0)},${(t.staff || []).length},${t.total_cost || 0}`);
                });
                return lines.join("\n");
            }
        },
        top_projects: {
            label: "Top Initiatives Detailed",
            desc: "Detailed audit of the top 5 highest-cost projects, listing employee effort, additional costs, and recoveries.",
            buildPages: (ctx, slideId) => {
                const sorted = [...(ctx.dashboardData ? (ctx.dashboardData.topic_summaries || []) : [])]
                    .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0))
                    .slice(0, 5);
                
                return [{
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Top 5 High-Investment Strategic Initiatives")}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead>
                                            <tr>
                                                <th>Initiative / Topic Name</th>
                                                <th>Category</th>
                                                <th style="text-align: right;">Internal Hours</th>
                                                <th style="text-align: right;">Internal Cost</th>
                                                <th style="text-align: right;">Additional Cost</th>
                                                <th style="text-align: right;">Recovery</th>
                                                <th style="text-align: right;">Net Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${sorted.map(t => {
                                                const netVal = (t.total_cost || 0) - (t.recovery || 0);
                                                return `
                                                    <tr>
                                                        <td><strong>${t.name || ""}</strong></td>
                                                        <td><span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2);">${t.category || ""}</span></td>
                                                        <td style="text-align: right;">${(t.total_hours || 0).toLocaleString()} hrs</td>
                                                        <td style="text-align: right;">$${(t.internal_cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                        <td style="text-align: right;">$${((t.additional_internal_cost || 0) + (t.external_cost || 0)).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                        <td style="text-align: right;" class="text-green">${t.recovery > 0 ? `+$${t.recovery.toLocaleString(undefined, {maximumFractionDigits: 0})}` : '$0'}</td>
                                                        <td style="text-align: right;"><strong>$${netVal.toLocaleString(undefined, {maximumFractionDigits: 0})}</strong></td>
                                                    </tr>
                                                `;
                                            }).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `
                }];
            },
            csv: (ctx) => {
                const sorted = [...(ctx.dashboardData ? (ctx.dashboardData.topic_summaries || []) : [])]
                    .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0))
                    .slice(0, 5);
                const lines = ["=== Top 5 High-Investment Strategic Initiatives ===", "Initiative,Category,Hours,Internal Cost,Additional Cost,Recovery,Net Cost"];
                sorted.forEach(t => {
                    lines.push(`${csvCell(t.name)},${csvCell(t.category)},${t.total_hours || 0},${t.internal_cost || 0},${(t.additional_internal_cost || 0) + (t.external_cost || 0)},${t.recovery || 0},${(t.total_cost || 0) - (t.recovery || 0)}`);
                });
                return lines.join("\n");
            }
        },
        location_breakdown: {
            label: "Location Cost Breakdown",
            desc: "Regional breakdown of headcounts, internal effort, external costs, and net budgets.",
            buildPages: (ctx, slideId) => {
                const emps = ctx.employees || [];
                const allocs = ctx.allocations || [];
                
                // Group by location
                const locData = {};
                emps.forEach(emp => {
                    const loc = emp.location || "Unassigned";
                    if (!locData[loc]) {
                        locData[loc] = { name: loc, headcount: 0, internalCost: 0 };
                    }
                    locData[loc].headcount += 1;
                    
                    const util = allocs.filter(a => a.employee_id === emp.id).reduce((sum, a) => sum + a.percentage, 0.0);
                    const cost = emp.available_hours * emp.hourly_rate * (util / 100.0);
                    locData[loc].internalCost += cost;
                });
                
                const sortedLocs = Object.values(locData).sort((a, b) => b.internalCost - a.internalCost);
                const totalInternal = sortedLocs.reduce((sum, l) => sum + l.internalCost, 0);
                
                return [{
                    wrapperClass: "slide-location-breakdown",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Regional Cost & Resource Breakdown")}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-left" style="flex: 1.1;">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead>
                                            <tr>
                                                <th>Regional Hub (Location)</th>
                                                <th style="text-align: right;">Planned Headcount</th>
                                                <th style="text-align: right;">Internal Effort Cost</th>
                                                <th style="text-align: right;">% of Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${sortedLocs.map(l => {
                                                const pct = totalInternal > 0 ? (l.internalCost / totalInternal) * 100.0 : 0.0;
                                                return `
                                                    <tr>
                                                        <td><strong><i class="fa-solid fa-location-dot" style="color: var(--primary-color); margin-right: 6px;"></i>${l.name}</strong></td>
                                                        <td style="text-align: right;">${l.headcount} Staff</td>
                                                        <td style="text-align: right;">$${l.internalCost.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                        <td style="text-align: right;">${pct.toFixed(1)}%</td>
                                                    </tr>
                                                `;
                                            }).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="slide-col-right" style="flex: 0.9;">
                                <div class="pres-chart-box" style="padding: 12px; height: 100%; flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 240px; box-sizing: border-box;">
                                    <h4 style="margin-top: 0; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Regional Cost Distribution</h4>
                                    <div class="canvas-wrap" style="position: relative; flex: 1; width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center;"><canvas id="pres-chart-loc-breakdown-canvas"></canvas></div>
                                    ${renderExclusionBadges()}
                                </div>
                            </div>
                        </div>
                    `
                }];
            },
            postRender: (ctx, parentEl) => {
                const canvas = parentEl ? parentEl.querySelector("#pres-chart-loc-breakdown-canvas") : document.getElementById("pres-chart-loc-breakdown-canvas");
                if (!canvas || !ctx.dashboardData) return;
                if (presLocBreakdownChart) presLocBreakdownChart.destroy();
                const labels = Object.keys(ctx.dashboardData.cost_by_location || {});
                const data = Object.values(ctx.dashboardData.cost_by_location || {});
                const isLight = parentEl && parentEl.closest("#presentation-overlay") ? parentEl.closest("#presentation-overlay").classList.contains("theme-light-presentation") : document.body.classList.contains("theme-light");
                const textColor = isLight ? "#0f172a" : "#e2e8f0";
                
                presLocBreakdownChart = new Chart(canvas.getContext("2d"), {
                    type: "bar",
                    data: {
                        labels: labels,
                        datasets: [{ label: "Cost", data: data, backgroundColor: "#10b981", borderWidth: 1 }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        onClick: (e, activeEls) => {
                            if (activeEls && activeEls.length > 0) {
                                const index = activeEls[0].index;
                                const label = presLocBreakdownChart.data.labels[index];
                                window.toggleLocationExclusion(label);
                            }
                        },
                        scales: {
                            x: { ticks: { color: textColor, font: { family: "Outfit", size: 9 } }, grid: { display: false } },
                            y: { ticks: { color: textColor, font: { family: "Outfit", size: 9 } }, grid: { color: "rgba(255, 255, 255, 0.08)" } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            },
            csv: (ctx) => {
                const emps = ctx.employees || [];
                const locData = {};
                emps.forEach(emp => {
                    const loc = emp.location || "Unassigned";
                    if (!locData[loc]) locData[loc] = { name: loc, headcount: 0, cost: 0 };
                    locData[loc].headcount += 1;
                    const util = (ctx.allocations || []).filter(a => a.employee_id === emp.id).reduce((sum, a) => sum + a.percentage, 0.0);
                    locData[loc].cost += emp.available_hours * emp.hourly_rate * (util / 100.0);
                });
                const lines = ["=== Regional Cost & Resource Breakdown ===", "Location,Headcount,Internal Cost,Avg Hourly Rate"];
                Object.values(locData).forEach(l => {
                    const empsInLoc = emps.filter(e => e.location === l.name);
                    const avgRate = empsInLoc.length > 0 ? empsInLoc.reduce((sum, e) => sum + e.hourly_rate, 0) / empsInLoc.length : 0.0;
                    lines.push(`${csvCell(l.name)},${l.headcount},${l.cost.toFixed(0)},${avgRate.toFixed(2)}`);
                });
                return lines.join("\n");
            }
        },
        department_breakdown: {
            label: "Department Cost Breakdown",
            desc: "Departmental breakdown of headcounts, average utilization, and cost allocation.",
            buildPages: (ctx, slideId) => {
                const emps = ctx.employees || [];
                const allocs = ctx.allocations || [];
                
                const deptData = {};
                emps.forEach(emp => {
                    const dept = emp.department || "General";
                    if (!deptData[dept]) {
                        deptData[dept] = { name: dept, headcount: 0, totalHours: 0, internalCost: 0, sumUtil: 0 };
                    }
                    deptData[dept].headcount += 1;
                    
                    const util = allocs.filter(a => a.employee_id === emp.id).reduce((sum, a) => sum + a.percentage, 0.0);
                    deptData[dept].sumUtil += util;
                    deptData[dept].totalHours += emp.available_hours;
                    deptData[dept].internalCost += emp.available_hours * emp.hourly_rate * (util / 100.0);
                });
                
                const sortedDepts = Object.values(deptData).sort((a, b) => b.internalCost - a.internalCost);
                const grandTotal = sortedDepts.reduce((sum, d) => sum + d.internalCost, 0);
                
                return [{
                    wrapperClass: "slide-department-breakdown",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Departmental Cost & Staffing Summary")}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-left" style="flex: 1.1;">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead>
                                            <tr>
                                                <th>Department</th>
                                                <th style="text-align: right;">Planned Headcount</th>
                                                <th style="text-align: right;">Avg Util</th>
                                                <th style="text-align: right;">Internal Cost</th>
                                                <th style="text-align: right;">% of Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${sortedDepts.map(d => {
                                                const avgUtil = d.headcount > 0 ? d.sumUtil / d.headcount : 0.0;
                                                const pct = grandTotal > 0 ? (d.internalCost / grandTotal) * 100.0 : 0.0;
                                                return `
                                                    <tr>
                                                        <td><strong><i class="fa-solid fa-building" style="color: var(--primary-color); margin-right: 6px;"></i>${d.name}</strong></td>
                                                        <td style="text-align: right;">${d.headcount} Staff</td>
                                                        <td style="text-align: right;">${avgUtil.toFixed(1)}%</td>
                                                        <td style="text-align: right;">$${d.internalCost.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                        <td style="text-align: right;">${pct.toFixed(1)}%</td>
                                                    </tr>
                                                `;
                                            }).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="slide-col-right" style="flex: 0.9;">
                                <div class="pres-chart-box" style="padding: 12px; height: 100%; flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 240px; box-sizing: border-box;">
                                    <h4 style="margin-top: 0; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Department Cost Distribution</h4>
                                    <div class="canvas-wrap" style="position: relative; flex: 1; width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center;"><canvas id="pres-chart-dept-canvas"></canvas></div>
                                    ${renderExclusionBadges()}
                                </div>
                            </div>
                        </div>
                    `
                }];
            },
            postRender: (ctx, parentEl) => {
                const canvas = parentEl ? parentEl.querySelector("#pres-chart-dept-canvas") : document.getElementById("pres-chart-dept-canvas");
                if (!canvas || !ctx.dashboardData) return;
                if (presDeptChart) presDeptChart.destroy();
                const labels = Object.keys(ctx.dashboardData.cost_by_department || {});
                const data = Object.values(ctx.dashboardData.cost_by_department || {});
                const isLight = parentEl && parentEl.closest("#presentation-overlay") ? parentEl.closest("#presentation-overlay").classList.contains("theme-light-presentation") : document.body.classList.contains("theme-light");
                const textColor = isLight ? "#0f172a" : "#e2e8f0";
                
                presDeptChart = new Chart(canvas.getContext("2d"), {
                    type: "bar",
                    data: {
                        labels: labels,
                        datasets: [{ label: "Cost", data: data, backgroundColor: "#8b5cf6", borderWidth: 1 }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        onClick: (e, activeEls) => {
                            if (activeEls && activeEls.length > 0) {
                                const index = activeEls[0].index;
                                const label = presDeptChart.data.labels[index];
                                window.toggleDeptExclusion(label);
                            }
                        },
                        scales: {
                            x: { ticks: { color: textColor, font: { family: "Outfit", size: 9 } }, grid: { display: false } },
                            y: { ticks: { color: textColor, font: { family: "Outfit", size: 9 } }, grid: { color: "rgba(255, 255, 255, 0.08)" } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            },
            csv: (ctx) => {
                const emps = ctx.employees || [];
                const deptData = {};
                emps.forEach(emp => {
                    const dept = emp.department || "General";
                    if (!deptData[dept]) deptData[dept] = { name: dept, headcount: 0, internalCost: 0, sumUtil: 0, hours: 0 };
                    deptData[dept].headcount += 1;
                    const util = (ctx.allocations || []).filter(a => a.employee_id === emp.id).reduce((sum, a) => sum + a.percentage, 0.0);
                    deptData[dept].sumUtil += util;
                    deptData[dept].hours += emp.available_hours;
                    deptData[dept].internalCost += emp.available_hours * emp.hourly_rate * (util / 100.0);
                });
                const lines = ["=== Departmental Cost & Staffing Summary ===", "Department,Headcount,Avg Utilization %,Internal Cost,Total Hours"];
                Object.values(deptData).forEach(d => {
                    const avgUtil = d.headcount > 0 ? d.sumUtil / d.headcount : 0.0;
                    lines.push(`${csvCell(d.name)},${d.headcount},${avgUtil.toFixed(1)},${d.internalCost.toFixed(0)},${d.hours}`);
                });
                return lines.join("\n");
            }
        },
        risks: {
            label: "Resource Allocations & Risks",
            desc: "Overloaded employees and strategic notes.",
            buildPages: (ctx, slideId) => {
                const pages = chunkRows(ctx.dashboardData ? (ctx.dashboardData.overloaded_employees || []) : [], ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text-${i}">${getSlideText(slideId, `title-text-${i}`, `Resource Allocations & Overload Alerts${pageSuffix(i + 1, pages.length)}`)}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-left">
                                <h4 class="risk-title" contenteditable="true" data-slide-id="${slideId}" data-edit-key="risk-title-left"><i class="fa-solid fa-triangle-exclamation"></i> ${getSlideText(slideId, "risk-title-left", "Overloaded Resources (>100% Allocation)")}</h4>
                                <ul class="risk-list">
                                    ${rows.map(emp => `
                                        <li style="padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.08); border-left: 3px solid var(--danger-color); margin-bottom: 6px; font-size: 11px;">
                                            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger-color); margin-right: 6px;"></i>
                                            <strong>${emp.name || ""}</strong> (${emp.team || ""}) planned utilization is at <span style="color: var(--danger-color); font-weight: 700;">${(emp.utilization || 0).toFixed(1)}%</span>.
                                        </li>
                                    `).join("") || `<li style="padding: 8px 12px; border-radius: 6px; background: rgba(16, 185, 129, 0.08); border-left: 3px solid var(--success-color); font-size: 11px; color: var(--success-color);">
                                                        <i class="fa-solid fa-circle-check" style="margin-right: 6px;"></i> No overloaded planning risks detected in this scenario.
                                                    </li>`}
                                </ul>
                            </div>
                            <div class="slide-col-right">
                                <h4 class="risk-title" contenteditable="true" data-slide-id="${slideId}" data-edit-key="risk-title-right"><i class="fa-solid fa-list-check"></i> ${getSlideText(slideId, "risk-title-right", "Management Comments & Strategic Notes")}</h4>
                                <div class="pres-notes-box">
                                    <p contenteditable="true" data-slide-id="${slideId}" data-edit-key="notes-text">${getSlideText(slideId, "notes-text", "Planning Version Summary: Initial draft of resources for engineering hubs. High effort is currently allocated on the Agentic AI prototype development which has an external funding recovery mapped. Key project delivery for Customer Requests (Fuel) requires resource reallocations to cover India testing overload risk.")}</p>
                                </div>
                            </div>
                        </div>
                    `
                }));
            },
            csv: (ctx) => {
                const lines = ["=== Resource Allocations & Overload Alerts ===", "Employee,Team,Utilization %"];
                (ctx.dashboardData ? (ctx.dashboardData.overloaded_employees || []) : []).forEach(emp => {
                    lines.push(`${csvCell(emp.name)},${csvCell(emp.team)},${(emp.utilization || 0).toFixed(1)}`);
                });
                if (ctx.dashboardData && (ctx.dashboardData.overloaded_employees || []).length === 0) lines.push("No overloaded planning risks detected in this scenario.");
                return lines.join("\n");
            }
        },
        ai: {
            label: "AI Portfolio Predictions",
            desc: "AI-driven bottleneck predictions and optimization suggestions.",
            buildPages: (ctx, slideId) => {
                const data = ctx.aiPredictionsData || { bottlenecks: [], cost_optimizations: [], reallocations: [] };
                const suggestions = [...(data.cost_optimizations || []), ...(data.reallocations || [])].slice(0, 3);
                const pages = chunkRows(data.bottlenecks || [], ROWS_PER_SLIDE);

                return pages.map((rows, i) => {
                    const isFirst = i === 0;
                    const bottleneckList = `
                        <ul class="risk-list">
                            ${rows.map(b => `
                                <li style="padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.04); border-left: 3px solid ${b.severity === 'High' ? 'var(--danger-color)' : 'var(--warning-color)'}; margin-bottom: 6px; font-size: 11px;">
                                    <strong>[${b.type || ""}]</strong> ${b.description || ""}
                                </li>
                            `).join("")}
                        </ul>
                    `;
                    const body = isFirst ? `
                        <div class="slide-content-split">
                            <div class="slide-col-left">
                                <h4 class="risk-title" style="color: var(--accent-color); font-size: 13px;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="label-left"><i class="fa-solid fa-brain"></i> ${getSlideText(slideId, "label-left", "Predicted Resource Bottlenecks")}</h4>
                                ${bottleneckList}
                            </div>
                            <div class="slide-col-right">
                                <h4 class="risk-title" style="color: var(--warning-color); font-size: 13px;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="label-right"><i class="fa-solid fa-chart-line"></i> ${getSlideText(slideId, "label-right", "Strategic Optimization Suggestions")}</h4>
                                <ul class="risk-list" style="gap: 6px;">
                                    ${suggestions.map(s => `
                                        <li style="padding: 8px 12px; border-radius: 6px; background: rgba(59, 130, 246, 0.04); border-left: 3px solid var(--primary-color); margin-bottom: 6px; font-size: 11px;">
                                            <strong>[${s.category || s.action || ""}]</strong> ${s.description || ""}
                                        </li>
                                    `).join("")}
                                </ul>
                            </div>
                        </div>
                    ` : `
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <h4 class="risk-title" style="color: var(--accent-color); font-size: 13px;" contenteditable="true" data-slide-id="${slideId}" data-edit-key="label-left-cont"><i class="fa-solid fa-brain"></i> ${getSlideText(slideId, "label-left-cont", "Predicted Resource Bottlenecks (continued)")}</h4>
                                ${bottleneckList}
                            </div>
                        </div>
                    `;
                    return {
                        wrapperClass: "",
                        bodyHTML: `
                            <div class="slide-title-bar">
                                <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text-${i}">${getSlideText(slideId, `title-text-${i}`, `AI-Driven Portfolio Predictions & Suggestions${pageSuffix(i + 1, pages.length)}`)}</h3>
                                <span class="confidential-small">CONFIDENTIAL</span>
                            </div>
                            ${body}
                        `
                    };
                });
            },
            csv: (ctx) => {
                const data = ctx.aiPredictionsData || { bottlenecks: [], cost_optimizations: [], reallocations: [] };
                const lines = ["=== AI Portfolio Predictions & Suggestions ===", "Type,Category/Type,Description"];
                (data.bottlenecks || []).forEach(b => lines.push(`Bottleneck,${csvCell(b.type)},${csvCell(b.description)}`));
                [...(data.cost_optimizations || []), ...(data.reallocations || [])].slice(0, 3).forEach(s => lines.push(`Suggestion,${csvCell(s.category || s.action)},${csvCell(s.description)}`));
                return lines.join("\n");
            }
        },
        teams: {
            label: "Team Breakdown",
            desc: "Aggregate team-level staffing and cost - no individual employee names.",
            buildPages: (ctx, slideId) => {
                const sorted = [...(ctx.dashboardData ? (ctx.dashboardData.team_summaries || []) : [])].sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));
                const pages = chunkRows(sorted, ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text-${i}">${getSlideText(slideId, `title-text-${i}`, `Team Resourcing & Cost Breakdown${pageSuffix(i + 1, pages.length)}`)}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead>
                                            <tr>
                                                <th>Team</th>
                                                <th style="text-align: right;">Members</th>
                                                <th style="text-align: right;">Avg Utilization</th>
                                                <th style="text-align: right;">Overloaded</th>
                                                <th style="text-align: right;">Total Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${rows.map(t => `
                                                <tr>
                                                    <td><strong>${t.team_name || ""}</strong></td>
                                                    <td style="text-align: right;">${t.member_count || 0} Staff</td>
                                                    <td style="text-align: right; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-type="team-util" data-team-name="${t.team_name}">${(t.average_utilization || 0).toFixed(1)}%</td>
                                                    <td style="text-align: right;">${t.overloaded_count || 0} overloaded</td>
                                                    <td style="text-align: right; font-weight: bold; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-type="team-cost" data-team-name="${t.team_name}">$${(t.total_cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                </tr>
                                            `).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `
                }));
            },
            csv: (ctx) => {
                const lines = ["=== Team Resourcing & Cost Breakdown ===", "Team,Members,Avg Utilization %,Overloaded,Total Cost"];
                [...(ctx.dashboardData ? (ctx.dashboardData.team_summaries || []) : [])].sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0)).forEach(t => {
                    lines.push(`${csvCell(t.team_name)},${t.member_count || 0},${(t.average_utilization || 0).toFixed(1)},${t.overloaded_count || 0},${t.total_cost || 0}`);
                });
                return lines.join("\n");
            }
        },
        employees: {
            label: "Employee Breakdown",
            desc: "Individual employee names, utilization, and cost. Omit this slide to keep the report team-level only.",
            buildPages: (ctx, slideId) => {
                const sorted = (ctx.employees || []).map(emp => {
                    const util = (ctx.allocations || []).filter(a => a.employee_id === emp.id).reduce((acc, a) => acc + a.percentage, 0.0);
                    const cost = emp.available_hours * emp.hourly_rate * (util / 100.0);
                    return { name: emp.name, team: emp.team, location: emp.location, util, cost };
                }).sort((a, b) => b.cost - a.cost);
                const pages = chunkRows(sorted, ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text-${i}">${getSlideText(slideId, `title-text-${i}`, `Individual Employee Breakdown${pageSuffix(i + 1, pages.length)}`)}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead>
                                            <tr>
                                                <th>Employee</th>
                                                <th>Team</th>
                                                <th>Location</th>
                                                <th style="text-align: right;">Utilization</th>
                                                <th style="text-align: right;">Total Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${rows.map(r => `
                                                <tr>
                                                    <td><strong>${r.name || ""}</strong></td>
                                                    <td>${r.team || ""}</td>
                                                    <td>${r.location || ""}</td>
                                                    <td style="text-align: right; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-type="emp-util" data-emp-name="${r.name}">${(r.util || 0).toFixed(1)}%</td>
                                                    <td style="text-align: right; font-weight: bold; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-type="emp-cost" data-emp-name="${r.name}">$${(r.cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                </tr>
                                            `).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `
                }));
            },
            csv: (ctx) => {
                const lines = ["=== Individual Employee Breakdown ===", "Employee,Team,Location,Utilization %,Total Cost"];
                (ctx.employees || []).map(emp => {
                    const util = (ctx.allocations || []).filter(a => a.employee_id === emp.id).reduce((acc, a) => acc + a.percentage, 0.0);
                    const cost = emp.available_hours * emp.hourly_rate * (util / 100.0);
                    return { name: emp.name, team: emp.team, location: emp.location, util, cost };
                }).sort((a, b) => b.cost - a.cost).forEach(r => {
                    lines.push(`${csvCell(r.name)},${csvCell(r.team)},${csvCell(r.location)},${r.util.toFixed(1)},${r.cost}`);
                });
                return lines.join("\n");
            }
        }
    };

    function getDefaultDeckConfig() {
        return [
            { id: "title", included: true },
            { id: "executive", included: true },
            { id: "financial_recovery", included: true },
            { id: "topics", included: true },
            { id: "top_projects", included: true },
            { id: "location_breakdown", included: false },
            { id: "department_breakdown", included: false },
            { id: "risks", included: true },
            { id: "ai", included: true },
            { id: "teams", included: false },
            { id: "employees", included: false }
        ];
    }

    function getSlideText(slideId, key, defaultValue) {
        const configItem = deckConfig ? deckConfig.find(item => item.id === slideId) : null;
        if (configItem && configItem.overrides && configItem.overrides[key] !== undefined) {
            return configItem.overrides[key];
        }
        return defaultValue;
    }

    function loadDeckConfig() {
        try {
            loadExclusions();
            const raw = localStorage.getItem(DECK_CONFIG_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const knownIds = Object.keys(SLIDE_TEMPLATES);
                const isValid = Array.isArray(parsed) && parsed.every(p => {
                    return p && typeof p === "object" && p.id && (p.isCustom || knownIds.includes(p.id));
                });
                if (isValid) {
                    deckConfig = parsed;
                    return;
                }
            }
        } catch (e) {
            console.error("Failed to load deck config, resetting to default:", e);
        }
        deckConfig = getDefaultDeckConfig();
        saveDeckConfig();
    }

    function saveDeckConfig() {
        try {
            localStorage.setItem(DECK_CONFIG_STORAGE_KEY, JSON.stringify(deckConfig));
        } catch (e) {
            console.warn("Failed to save deck config to localStorage:", e);
        }
    }

    function computeInteractiveDashboardData(filteredEmps, filteredAllocs) {
        if (!dashboardData) return null;
        
        // Calculate employee utilization sums
        const empAllocSums = {};
        filteredAllocs.forEach(a => {
            empAllocSums[a.employee_id] = (empAllocSums[a.employee_id] || 0.0) + a.percentage;
        });

        // 1. Calculate employee costs
        let totalInternalCost = 0.0;
        const costByLocation = {};
        const costByTeam = {};
        const costByDept = {};
        const costByTopic = {};
        const hoursByTopic = {};

        const overloadedList = [];

        filteredEmps.forEach(emp => {
            const util = empAllocSums[emp.id] || 0.0;
            if (util > 100.0) {
                overloadedList.push({
                    id: emp.id,
                    name: emp.name,
                    team: emp.team,
                    location: emp.location,
                    utilization: util
                });
            }

            // Find allocations for this employee
            const empAllocs = filteredAllocs.filter(a => a.employee_id === emp.id);
            empAllocs.forEach(a => {
                const cost = emp.available_hours * emp.hourly_rate * (a.percentage / 100.0);
                totalInternalCost += cost;

                costByLocation[emp.location] = (costByLocation[emp.location] || 0.0) + cost;
                costByTeam[emp.team] = (costByTeam[emp.team] || 0.0) + cost;
                costByDept[emp.department] = (costByDept[emp.department] || 0.0) + cost;
                costByTopic[a.topic_id] = (costByTopic[a.topic_id] || 0.0) + cost;
                hoursByTopic[a.topic_id] = (hoursByTopic[a.topic_id] || 0.0) + (emp.available_hours * a.percentage / 100.0);
            });
        });

        // 2. Fetch constants from base data
        const totalAdditionalInternal = dashboardData.total_additional_internal_cost || 0.0;
        const totalExternal = dashboardData.total_external_cost || 0.0;
        const totalRecovery = dashboardData.total_recovery_cost || 0.0;

        const netAnnualPlanningCost = totalInternalCost + totalAdditionalInternal + totalExternal - totalRecovery;

        // 3. Rebuild topic summaries
        const topicSummaries = (topics || []).map(t => {
            const intCost = costByTopic[t.id] || 0.0;
            const hours = hoursByTopic[t.id] || 0.0;
            const baseTopic = (dashboardData.topic_summaries || []).find(bt => bt.id === t.id) || {};
            const addInternal = baseTopic.additional_internal_cost || 0.0;
            const extCost = baseTopic.external_cost || 0.0;
            const rec = t.recovery || 0.0;
            
            return {
                id: t.id,
                name: t.name,
                category: t.category,
                total_hours: hours,
                internal_cost: intCost,
                additional_internal_cost: addInternal,
                external_cost: extCost,
                recovery: rec,
                total_cost: intCost + addInternal + extCost,
                staff: (employees || []).filter(e => filteredAllocs.some(a => a.employee_id === e.id && a.topic_id === t.id))
            };
        });

        // 4. Rebuild team summaries
        const teamSummaries = [];
        const teamGroups = {};
        filteredEmps.forEach(e => {
            if (!teamGroups[e.team]) teamGroups[e.team] = [];
            teamGroups[e.team].push(e);
        });

        Object.keys(teamGroups).forEach(teamName => {
            const teamEmps = teamGroups[teamName];
            const sumUtil = teamEmps.reduce((sum, e) => sum + (empAllocSums[e.id] || 0.0), 0.0);
            const ovCount = teamEmps.filter(e => (empAllocSums[e.id] || 0.0) > 100.0).length;
            const cost = teamEmps.reduce((sum, e) => {
                const empAllocs = filteredAllocs.filter(a => a.employee_id === e.id);
                return sum + empAllocs.reduce((sub, a) => sub + (e.available_hours * e.hourly_rate * a.percentage / 100.0), 0.0);
            }, 0.0);

            teamSummaries.push({
                team_name: teamName,
                member_count: teamEmps.length,
                average_utilization: teamEmps.length > 0 ? sumUtil / teamEmps.length : 0.0,
                overloaded_count: ovCount,
                total_cost: cost
            });
        });

        return {
            total_headcount: filteredEmps.length,
            total_internal_employee_cost: totalInternalCost,
            total_additional_internal_cost: totalAdditionalInternal,
            total_external_cost: totalExternal,
            total_recovery_cost: totalRecovery,
            total_annual_planning_cost: netAnnualPlanningCost,
            cost_by_location: costByLocation,
            cost_by_department: costByDept,
            overloaded_employees: overloadedList,
            topic_summaries: topicSummaries,
            team_summaries: teamSummaries
        };
    }

    function renderExclusionBadges() {
        const badges = [];
        if (excludedFilters.locations.size > 0) {
            Array.from(excludedFilters.locations).forEach(loc => {
                badges.push(`<span class="badge badge-warning" style="cursor: pointer; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 6px; border-radius: 4px; font-size: 9px; color: var(--warning-color); display: inline-flex; align-items: center; gap: 4px;" onclick="window.toggleLocationExclusion('${loc}')"><i class="fa-solid fa-ban"></i> ${loc}</span>`);
            });
        }
        if (excludedFilters.departments.size > 0) {
            Array.from(excludedFilters.departments).forEach(dept => {
                badges.push(`<span class="badge badge-warning" style="cursor: pointer; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 6px; border-radius: 4px; font-size: 9px; color: var(--warning-color); display: inline-flex; align-items: center; gap: 4px;" onclick="window.toggleDeptExclusion('${dept}')"><i class="fa-solid fa-ban"></i> ${dept}</span>`);
            });
        }
        if (badges.length === 0) return "";
        return `
            <div class="exclusion-badges" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; align-items: center;">
                <span style="font-size: 9px; color: var(--text-secondary);">Exclusions (Click to restore):</span>
                ${badges.join("")}
            </div>
        `;
    }

    window.toggleLocationExclusion = (loc) => {
        if (excludedFilters.locations.has(loc)) {
            excludedFilters.locations.delete(loc);
        } else {
            excludedFilters.locations.add(loc);
        }
        saveExclusions();
        recomputeAndRefreshPresentation();
    };

    window.toggleDeptExclusion = (dept) => {
        if (excludedFilters.departments.has(dept)) {
            excludedFilters.departments.delete(dept);
        } else {
            excludedFilters.departments.add(dept);
        }
        saveExclusions();
        recomputeAndRefreshPresentation();
    };

    function saveExclusions() {
        try {
            localStorage.setItem("pres-excluded-locations", JSON.stringify(Array.from(excludedFilters.locations)));
            localStorage.setItem("pres-excluded-depts", JSON.stringify(Array.from(excludedFilters.departments)));
        } catch (e) {}
    }

    function loadExclusions() {
        try {
            const locs = localStorage.getItem("pres-excluded-locations");
            const depts = localStorage.getItem("pres-excluded-depts");
            if (locs) excludedFilters.locations = new Set(JSON.parse(locs));
            if (depts) excludedFilters.departments = new Set(JSON.parse(depts));
        } catch (e) {}
    }

    function recomputeAndRefreshPresentation() {
        renderPresentationDeck();
        const overlay = document.getElementById("presentation-overlay");
        if (overlay && overlay.classList.contains("active")) {
            rebuildPhysicalSlides();
            renderPresentationOverlaySlide();
        }
    }

    function buildDeckContext() {
        let filteredEmps = employees || [];
        let filteredAllocs = allocations || [];
        
        if (excludedFilters.locations.size > 0) {
            filteredEmps = filteredEmps.filter(e => !excludedFilters.locations.has(e.location));
            filteredAllocs = filteredAllocs.filter(a => {
                const emp = employees.find(e => e.id === a.employee_id);
                return emp && !excludedFilters.locations.has(emp.location);
            });
        }
        if (excludedFilters.teams.size > 0) {
            filteredEmps = filteredEmps.filter(e => !excludedFilters.teams.has(e.team));
            filteredAllocs = filteredAllocs.filter(a => {
                const emp = employees.find(e => e.id === a.employee_id);
                return emp && !excludedFilters.teams.has(emp.team);
            });
        }
        if (excludedFilters.departments.size > 0) {
            filteredEmps = filteredEmps.filter(e => !excludedFilters.departments.has(e.department));
            filteredAllocs = filteredAllocs.filter(a => {
                const emp = employees.find(e => e.id === a.employee_id);
                return emp && !excludedFilters.departments.has(emp.department);
            });
        }
        
        const interactiveData = computeInteractiveDashboardData(filteredEmps, filteredAllocs);
        const data = JSON.parse(JSON.stringify(interactiveData || dashboardData));
        
        // Apply slides table overrides dynamically
        if (data.topic_summaries) {
            data.topic_summaries.forEach(t => {
                if (slideTableOverrides[`topic_cost_${t.id}`] !== undefined) {
                    const newCost = slideTableOverrides[`topic_cost_${t.id}`];
                    t.total_cost = newCost;
                    if (data.highest_cost_topics) {
                        const h = data.highest_cost_topics.find(x => x.name === t.name);
                        if (h) h.total_cost = newCost;
                    }
                }
            });
        }
        
        if (data.team_summaries) {
            data.team_summaries.forEach(t => {
                if (slideTableOverrides[`team_cost_${t.team_name}`] !== undefined) {
                    const newCost = slideTableOverrides[`team_cost_${t.team_name}`];
                    t.total_cost = newCost;
                    if (data.cost_by_team) data.cost_by_team[t.team_name] = newCost;
                }
                if (slideTableOverrides[`team_util_${t.team_name}`] !== undefined) {
                    t.average_utilization = slideTableOverrides[`team_util_${t.team_name}`];
                }
            });
        }
        
        if (data.cost_by_team && data.team_summaries) {
            const locCosts = {};
            data.team_summaries.forEach(t => {
                const emp = employees.find(e => e.team === t.team_name);
                const loc = emp ? emp.location : "Other";
                locCosts[loc] = (locCosts[loc] || 0) + t.total_cost;
            });
            data.cost_by_location = locCosts;
            
            let totalAnnual = 0;
            data.team_summaries.forEach(t => totalAnnual += t.total_cost);
            data.total_annual_planning_cost = totalAnnual;
        }
        
        return { 
            dashboardData: data, 
            employees: filteredEmps, 
            topics, 
            allocations: filteredAllocs, 
            activeScenario, 
            aiPredictionsData 
        };
    }

    function getCustomSlideHTML(cfg, ctx) {
        const slideId = cfg.id;
        if (slideId.startsWith("custom_memo_")) {
            const data = ctx.dashboardData;
            const headcount = data ? (data.total_headcount || 0) : 0;
            const cost = data ? (data.total_annual_planning_cost || 0) : 0;
            const overloads = data ? (data.overloaded_employees ? data.overloaded_employees.length : 0) : 0;
            
            return {
                wrapperClass: "slide-memo",
                bodyHTML: `
                    <div class="slide-title-bar">
                        <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Executive Strategic Memo")}</h3>
                        <span class="confidential-small">CONFIDENTIAL</span>
                    </div>
                    <div class="slide-content-split" style="margin-top: 15px; max-height: calc(100% - 40px); align-items: stretch; gap: 20px;">
                        <div class="slide-col-left" style="width: 32%; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0;">
                            <div class="pres-kpi-item" style="padding: 10px 14px; border-left: 3px solid var(--accent-color); background: rgba(59, 130, 246, 0.04); border-radius: 6px;">
                                <span style="display: block; font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Scenario Headcount</span>
                                <span style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${headcount} Active Staff</span>
                            </div>
                            <div class="pres-kpi-item" style="padding: 10px 14px; border-left: 3px solid var(--success-color); background: rgba(16, 185, 129, 0.04); border-radius: 6px;">
                                <span style="display: block; font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Net Planning Cost</span>
                                <span style="font-size: 15px; font-weight: 700; color: var(--text-primary);">$${cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                            </div>
                            <div class="pres-kpi-item" style="padding: 10px 14px; border-left: 3px solid ${overloads > 0 ? "var(--danger-color)" : "var(--success-color)"}; background: rgba(239, 68, 68, 0.04); border-radius: 6px;">
                                <span style="display: block; font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Overloaded Alerts</span>
                                <span style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${overloads} Alert${overloads === 1 ? "" : "s"}</span>
                            </div>
                        </div>
                        <div class="slide-col-right" style="width: 65%; flex: 1; padding: 14px 18px; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(255, 255, 255, 0.02); text-align: left; overflow-y: auto;">
                            <div contenteditable="true" data-slide-id="${slideId}" data-edit-key="body-text" style="line-height: 1.6; font-size: 12.5px; outline: none; min-height: 160px; color: var(--text-primary);">
                                ${getSlideText(slideId, "body-text", "<p>Write strategic executive insights here...</p>")}
                            </div>
                        </div>
                    </div>
                `
            };
        } else if (slideId.startsWith("custom_sim_")) {
            return {
                wrapperClass: "slide-comparison",
                bodyHTML: `
                    <div class="slide-title-bar">
                        <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Simulation Comparison Analysis")}</h3>
                        <span class="confidential-small">CONFIDENTIAL</span>
                    </div>
                    <div class="slide-content-split" style="flex-direction: column; align-items: stretch; margin-top: 15px; max-height: calc(100% - 40px); overflow-y: auto;">
                        <div style="line-height: 1.4; font-size: 11.5px; outline: none; padding-right: 5px;">
                            ${getSlideText(slideId, "body-text", "Comparison content...")}
                        </div>
                    </div>
                `
            };
        } else {
            return {
                wrapperClass: "slide-custom",
                bodyHTML: `
                    <div class="slide-title-bar">
                        <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text">${getSlideText(slideId, "title-text", "Custom Slide Title")}</h3>
                        <span class="confidential-small">CONFIDENTIAL</span>
                    </div>
                    <div class="slide-content-split" style="flex-direction: column; align-items: stretch; margin-top: 15px;">
                        <div class="slide-col-full" style="flex: 1; min-height: 180px; padding: 16px; border: 1px dashed var(--glass-border); border-radius: 8px; background: rgba(255, 255, 255, 0.01); text-align: left;">
                            <div contenteditable="true" data-slide-id="${slideId}" data-edit-key="body-text" style="line-height: 1.6; font-size: 13px; outline: none; min-height: 160px;">
                                ${getSlideText(slideId, "body-text", "Click here to type custom content for this slide. You can write bullet points, lists, or text paragraphs.")}
                            </div>
                        </div>
                    </div>
                `
            };
        }
    }

    let activePhysicalSlides = [];
    let currentPresSlideIndex = 0;

    function rebuildPhysicalSlides() {
        const ctx = buildDeckContext();
        const included = deckConfig.filter(c => c.included && (SLIDE_TEMPLATES[c.id] || c.isCustom));
        activePhysicalSlides = [];

        included.forEach(cfg => {
            if (cfg.isCustom) {
                activePhysicalSlides.push({
                    slideId: cfg.id,
                    ...getCustomSlideHTML(cfg, ctx)
                });
            } else {
                const template = SLIDE_TEMPLATES[cfg.id];
                template.buildPages(ctx, cfg.id).forEach(page => {
                    activePhysicalSlides.push({
                        slideId: cfg.id,
                        wrapperClass: page.wrapperClass || "",
                        bodyHTML: page.bodyHTML,
                        postRender: template.postRender
                    });
                });
            }
        });
    }

    function enterPresentationMode() {
        if (!dashboardData) return;
        rebuildPhysicalSlides();
        if (activePhysicalSlides.length === 0) {
            alert("No slides are currently selected for the presentation. Please check at least one slide in the Customize Slides sidebar panel first.");
            return;
        }
        currentPresSlideIndex = 0;
        const overlay = document.getElementById("presentation-overlay");
        overlay.classList.add("active");
        overlay.classList.remove("theme-light-presentation");
        overlay.classList.add("theme-dark-presentation");
        document.body.style.overflow = "hidden"; // disable background scrolling
        
        // Wait for the opacity transition (300ms) to complete before rendering the slide
        // so that Chart.js has the correct visible container heights!
        setTimeout(() => {
            renderPresentationOverlaySlide();
        }, 320);
    }

    function exitPresentationMode() {
        const overlay = document.getElementById("presentation-overlay");
        overlay.classList.remove("active");
        document.body.style.overflow = ""; // restore background scrolling
    }

    function renderPresentationOverlaySlide() {
        const viewport = document.getElementById("presentation-slide-viewport");
        const counter = document.getElementById("pres-slide-counter");
        if (!viewport || activePhysicalSlides.length === 0) return;

        const slide = activePhysicalSlides[currentPresSlideIndex];
        const total = activePhysicalSlides.length;

        viewport.innerHTML = `
            <div class="presentation-slide ${slide.wrapperClass}">
                ${slide.bodyHTML}
                ${slideFooterHTML(currentPresSlideIndex + 1, total)}
            </div>
        `;
        counter.textContent = `Slide ${currentPresSlideIndex + 1} of ${total}`;

        // Trigger postRender for charts and visual components if postRender helper exists
        if (slide.postRender) {
            const ctx = buildDeckContext();
            slide.postRender(ctx, viewport);
        }
    }

    function prevPresSlide() {
        if (currentPresSlideIndex > 0) {
            currentPresSlideIndex--;
            renderPresentationOverlaySlide();
        }
    }

    function nextPresSlide() {
        if (currentPresSlideIndex < activePhysicalSlides.length - 1) {
            currentPresSlideIndex++;
            renderPresentationOverlaySlide();
        }
    }

    function renderPresentationDeck() {
        if (!dashboardData) return;
        if (!deckConfig) loadDeckConfig();

        const container = document.getElementById("presentation-deck-container");
        if (!container) return;

        const ctx = buildDeckContext();
        const included = deckConfig.filter(c => c.included && (SLIDE_TEMPLATES[c.id] || c.isCustom));

        // Flatten physical pages
        const allPages = [];
        included.forEach(cfg => {
            if (cfg.isCustom) {
                allPages.push({
                    slideId: cfg.id,
                    ...getCustomSlideHTML(cfg, ctx)
                });
            } else {
                const template = SLIDE_TEMPLATES[cfg.id];
                template.buildPages(ctx, cfg.id).forEach(page => allPages.push(page));
            }
        });

        const total = allPages.length;
        container.innerHTML = total > 0 ? allPages.map((page, i) => `
            <div class="presentation-slide ${page.wrapperClass || ""}">
                ${page.bodyHTML}
                ${slideFooterHTML(i + 1, total)}
            </div>
        `).join("") : `<div class="presentation-empty-state" style="padding: 40px; text-align: center; color: var(--text-secondary);">No slides included in the presentation. Enable slides in the customize panel.</div>`;

        const slideElements = container.querySelectorAll(".presentation-slide");
        let pageIdx = 0;
        included.forEach(cfg => {
            if (cfg.isCustom) {
                pageIdx++;
            } else {
                const template = SLIDE_TEMPLATES[cfg.id];
                const pages = template.buildPages(ctx, cfg.id);
                pages.forEach(p => {
                    const slideEl = slideElements[pageIdx];
                    if (template.postRender && slideEl) {
                        template.postRender(ctx, slideEl);
                    }
                    pageIdx++;
                });
            }
        });

        renderDeckCustomizeList();
    }

    function renderDeckCustomizeList() {
        const list = document.getElementById("deck-customize-list");
        if (!list || !deckConfig) return;

        list.innerHTML = deckConfig.map((cfg, i) => {
            const isCustom = cfg.isCustom === true;
            const title = isCustom ? getSlideText(cfg.id, "title-text", "Custom Slide") : SLIDE_TEMPLATES[cfg.id].label;
            const desc = isCustom ? "User created custom slide" : SLIDE_TEMPLATES[cfg.id].desc;
            return `
                <li class="deck-customize-item ${cfg.included ? "" : "excluded"}" data-index="${i}">
                    <input type="checkbox" class="deck-customize-checkbox" data-index="${i}" ${cfg.included ? "checked" : ""}>
                    <div class="deck-customize-info">
                        <div class="deck-customize-title">${title}</div>
                        <div class="deck-customize-desc">${desc}</div>
                    </div>
                    <div class="deck-customize-order-controls">
                        ${isCustom ? `<button type="button" class="deck-delete-custom text-red" data-id="${cfg.id}" title="Delete Slide" style="margin-right: 8px; background: none; border: none; cursor: pointer; color: var(--danger-color);"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                        <button type="button" class="deck-move-up" data-index="${i}" ${i === 0 ? "disabled" : ""} title="Move up"><i class="fa-solid fa-chevron-up"></i></button>
                        <button type="button" class="deck-move-down" data-index="${i}" ${i === deckConfig.length - 1 ? "disabled" : ""} title="Move down"><i class="fa-solid fa-chevron-down"></i></button>
                    </div>
                </li>
            `;
        }).join("");

        list.querySelectorAll(".deck-customize-checkbox").forEach(cb => {
            cb.addEventListener("change", (e) => {
                const i = parseInt(e.target.getAttribute("data-index"), 10);
                deckConfig[i].included = e.target.checked;
                saveDeckConfig();
                renderDeckCustomizeList();
                renderPresentationDeck();
            });
        });

        list.querySelectorAll(".deck-delete-custom").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                if (confirm("Are you sure you want to delete this custom slide?")) {
                    deckConfig = deckConfig.filter(cfg => cfg.id !== id);
                    saveDeckConfig();
                    renderDeckCustomizeList();
                    renderPresentationDeck();
                }
            });
        });

        list.querySelectorAll(".deck-move-up").forEach(btn => {
            btn.addEventListener("click", () => {
                const i = parseInt(btn.getAttribute("data-index"), 10);
                if (i > 0) {
                    [deckConfig[i - 1], deckConfig[i]] = [deckConfig[i], deckConfig[i - 1]];
                    saveDeckConfig();
                    renderDeckCustomizeList();
                    renderPresentationDeck();
                }
            });
        });

        list.querySelectorAll(".deck-move-down").forEach(btn => {
            btn.addEventListener("click", () => {
                const i = parseInt(btn.getAttribute("data-index"), 10);
                if (i < deckConfig.length - 1) {
                    [deckConfig[i + 1], deckConfig[i]] = [deckConfig[i], deckConfig[i + 1]];
                    saveDeckConfig();
                    renderDeckCustomizeList();
                    renderPresentationDeck();
                }
            });
        });
    }

    // Set up focusout delegation to automatically capture and persist inline slide content edits
    const handleSlideEdit = (e) => {
        const target = e.target;
        if (target.hasAttribute("contenteditable") && target.hasAttribute("data-slide-id")) {
            const slideId = target.getAttribute("data-slide-id");
            const editKey = target.getAttribute("data-edit-key");
            const htmlValue = target.innerHTML.trim();

            const configItem = deckConfig.find(item => item.id === slideId);
            if (configItem) {
                if (!configItem.overrides) {
                    configItem.overrides = {};
                }
                configItem.overrides[editKey] = htmlValue;
                saveDeckConfig();
                
                // If presentation overlay is open, synchronize slide changes, else update dashboard presentation tab view
                const overlay = document.getElementById("presentation-overlay");
                if (overlay && overlay.classList.contains("active")) {
                    renderPresentationOverlaySlide();
                } else {
                    renderPresentationDeck();
                }
            }
        }
    };

    document.getElementById("presentation-deck-container").addEventListener("focusout", handleSlideEdit);
    document.getElementById("presentation-slide-viewport").addEventListener("focusout", handleSlideEdit);

    async function exportPresentationReportToCSV() {
        if (!dashboardData) return;
        const ctx = buildDeckContext();
        const included = deckConfig.filter(c => c.included && SLIDE_TEMPLATES[c.id] && SLIDE_TEMPLATES[c.id].csv);

        const sections = included.map(cfg => SLIDE_TEMPLATES[cfg.id].csv(ctx));
        const csvContent = sections.join("\n\n");

        const scenarioName = activeScenario ? activeScenario.name : "Planning Version";
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Presentation_Report_${scenarioName.replace(/\s+/g, "_")}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        try {
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ report_name: `Presentation Report (${scenarioName})`, format: "CSV" })
            });
        } catch (err) {
            console.error("Failed to log presentation report export:", err);
        }
    }

    // ==========================================
    // 5. CRUD MANAGEMENT TABLES
    // ==========================================
    
    function populateCRUDLocDropdown() {
        const select = document.getElementById("filter-crud-employees-location");
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Locations</option>';
        const locs = [...new Set(employees.map(e => e.location))].sort();
        locs.forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc;
            opt.textContent = loc;
            select.appendChild(opt);
        });
        select.value = currentVal;
    }

    function populateCRUDCatDropdown() {
        const select = document.getElementById("filter-crud-topics-category");
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Categories</option>';
        const cats = [...new Set(topics.map(t => t.category))].sort();
        cats.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
        select.value = currentVal;
    }

    async function fetchAIPredictions(requestId) {
        try {
            const ts = Date.now();
            const response = await fetch(`/api/reports/ai-predictions?_ts=${ts}`);
            if (requestId !== undefined && requestId !== refreshRequestId) return;
            if (response.ok) {
                const predictions = await response.json();
                if (requestId !== undefined && requestId !== refreshRequestId) return;
                renderAIPredictions(predictions);
                renderPresentationDeck();
            }
        } catch (err) {
            console.error("Error fetching AI predictions:", err);
        }
    }

    function renderAIInsightsStats(data) {
        const container = document.getElementById("ai-insights-stats");
        if (!container) return;

        const highBottlenecks = data.bottlenecks.filter(b => b.severity === "High").length;
        const highReallocations = data.reallocations.filter(r => r.priority === "High").length;

        const totalSavings = data.cost_optimizations.reduce((sum, c) => {
            const match = String(c.impact || "").match(/\$([\d,]+(?:\.\d+)?)/);
            return match ? sum + parseFloat(match[1].replace(/,/g, "")) : sum;
        }, 0);

        const stats = [
            { icon: "fa-triangle-exclamation", label: "Bottleneck Risks", value: data.bottlenecks.length, tone: "danger", sub: `${highBottlenecks} high severity` },
            { icon: "fa-sack-dollar", label: "Cost Opportunities", value: data.cost_optimizations.length, tone: "warning", sub: totalSavings > 0 ? `~$${totalSavings.toLocaleString(undefined, {maximumFractionDigits: 0})} identified` : "portfolio scanned" },
            { icon: "fa-shuffle", label: "Reallocation Actions", value: data.reallocations.length, tone: "primary", sub: `${highReallocations} high priority` },
            { icon: "fa-shield-halved", label: "Overall Risk Level", value: highBottlenecks > 0 ? "High" : (data.bottlenecks.length > 0 ? "Medium" : "Low"), tone: highBottlenecks > 0 ? "danger" : (data.bottlenecks.length > 0 ? "warning" : "success"), sub: "based on current allocations" }
        ];

        container.innerHTML = stats.map(s => `
            <div class="ai-stat-tile ai-stat-tile-${s.tone}">
                <div class="ai-stat-icon"><i class="fa-solid ${s.icon}"></i></div>
                <div class="ai-stat-info">
                    <span class="ai-stat-value">${s.value}</span>
                    <span class="ai-stat-label">${s.label}</span>
                    <span class="ai-stat-sub">${s.sub}</span>
                </div>
            </div>
        `).join("");
    }

    function renderAIPredictions(data) {
        aiPredictionsData = data;
        renderAIInsightsStats(data);

        const bList = document.getElementById("ai-insight-bottlenecks-list");
        const cList = document.getElementById("ai-insight-costs-list");
        const rList = document.getElementById("ai-insight-reallocations-list");
        
        const severityAccentColor = (level) => level === "High" ? "var(--danger-color)" : level === "Medium" ? "var(--warning-color)" : "var(--success-color)";
        const mdBold = (text) => String(text ?? "").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        if (bList) {
            bList.innerHTML = data.bottlenecks.map(b => `
                <div class="ai-insight-item" style="--accent: ${severityAccentColor(b.severity)};">
                    <div class="ai-insight-header">
                        <strong class="ai-insight-label">${b.type}</strong>
                        <span class="badge ${b.severity === 'High' ? 'badge-danger' : b.severity === 'Medium' ? 'badge-warning' : 'badge-success'}" style="font-size:10px; padding:2px 7px;">${b.severity}</span>
                    </div>
                    <p class="ai-insight-desc">${mdBold(b.description)}</p>
                </div>
            `).join("") || "<p class='ai-insight-desc' style='opacity:0.6;'>No bottlenecks predicted.</p>";
        }

        if (cList) {
            cList.innerHTML = data.cost_optimizations.map(c => `
                <div class="ai-insight-item" style="--accent: var(--warning-color);">
                    <div class="ai-insight-header">
                        <strong class="ai-insight-label">${c.category}</strong>
                        <span class="ai-insight-impact">${c.impact}</span>
                    </div>
                    <p class="ai-insight-desc">${mdBold(c.description)}</p>
                </div>
            `).join("") || "<p class='ai-insight-desc' style='opacity:0.6;'>No cost optimizations found.</p>";
        }

        if (rList) {
            rList.innerHTML = data.reallocations.map(r => `
                <div class="ai-insight-item" style="--accent: ${severityAccentColor(r.priority)};">
                    <div class="ai-insight-header">
                        <strong class="ai-insight-label">${r.action}</strong>
                        <span class="badge ${r.priority === 'High' ? 'badge-danger' : r.priority === 'Medium' ? 'badge-warning' : 'badge-success'}" style="font-size:10px; padding:2px 7px;">${r.priority}</span>
                    </div>
                    <p class="ai-insight-desc">${mdBold(r.description)}</p>
                </div>
            `).join("") || "<p class='ai-insight-desc' style='opacity:0.6;'>No load balancing needed.</p>";
        }

        // The AI Portfolio Predictions slide template reads aiPredictionsData
        // directly, so re-render the deck now that fresh predictions are in.
        renderPresentationDeck();
    }

    function renderCRUDTables() {
        // Employees Table
        const empBody = document.querySelector("#crud-employee-table tbody");
        empBody.innerHTML = "";
        
        // Filtering
        let filteredEmps = [...employees];
        if (empSearch) {
            const q = empSearch.toLowerCase();
            filteredEmps = filteredEmps.filter(e => e.name.toLowerCase().includes(q) || e.team.toLowerCase().includes(q) || e.location.toLowerCase().includes(q));
        }
        if (empLocFilter) {
            filteredEmps = filteredEmps.filter(e => e.location === empLocFilter);
        }
        
        // Sorting
        filteredEmps.sort((a, b) => {
            let valA = a[empSortField];
            let valB = b[empSortField];
            if (typeof valA === "string") {
                return valA.localeCompare(valB) * empSortOrder;
            }
            return (valA - valB) * empSortOrder;
        });

        // Selections for employees no longer visible/present are dropped
        const visibleEmpIds = new Set(filteredEmps.map(e => e.id));
        selectedEmployeeIds.forEach(id => { if (!visibleEmpIds.has(id)) selectedEmployeeIds.delete(id); });

        filteredEmps.forEach(emp => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><input type="checkbox" class="bulk-select-emp admin-only" data-id="${emp.id}" ${selectedEmployeeIds.has(emp.id) ? "checked" : ""}></td>
                <td><strong>${emp.name}</strong></td>
                <td>${emp.team}</td>
                <td>${emp.location}</td>
                <td>$${emp.hourly_rate.toFixed(2)}</td>
                <td>
                    <button class="btn btn-secondary btn-icon-only btn-edit-emp" data-id="${emp.id}" title="Edit Profile"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-danger btn-icon-only btn-delete-emp" data-id="${emp.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            empBody.appendChild(tr);
        });

        // Topics Table
        const topBody = document.querySelector("#crud-topic-table tbody");
        topBody.innerHTML = "";

        // Filtering
        let filteredTopics = [...topics];
        if (topicSearch) {
            const q = topicSearch.toLowerCase();
            filteredTopics = filteredTopics.filter(t => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
        }
        if (topicCatFilter) {
            filteredTopics = filteredTopics.filter(t => t.category === topicCatFilter);
        }

        // Sorting
        filteredTopics.sort((a, b) => {
            let valA = a[topicSortField];
            let valB = b[topicSortField];
            if (typeof valA === "string") {
                return valA.localeCompare(valB) * topicSortOrder;
            }
            return (valA - valB) * topicSortOrder;
        });

        filteredTopics.forEach(topic => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${topic.name}</strong></td>
                <td>${topic.category}</td>
                <td>$${topic.recovery.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td>
                    <button class="btn btn-secondary btn-icon-only btn-edit-topic" data-id="${topic.id}" title="Edit Scope"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-danger btn-icon-only btn-delete-topic" data-id="${topic.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            topBody.appendChild(tr);
        });

        // Populate filter options dynamically
        populateCRUDLocDropdown();
        populateCRUDCatDropdown();

        // Add event listeners dynamically to CRUD actions
        document.querySelectorAll(".btn-edit-emp").forEach(btn => {
            btn.addEventListener("click", () => editEmployeePrompt(btn.getAttribute("data-id")));
        });
        document.querySelectorAll(".btn-delete-emp").forEach(btn => {
            btn.addEventListener("click", () => deleteEmployeePrompt(btn.getAttribute("data-id")));
        });
        document.querySelectorAll(".btn-edit-topic").forEach(btn => {
            btn.addEventListener("click", () => editTopicPrompt(btn.getAttribute("data-id")));
        });
        document.querySelectorAll(".btn-delete-topic").forEach(btn => {
            btn.addEventListener("click", () => deleteTopicPrompt(btn.getAttribute("data-id")));
        });

        // Bulk-select checkboxes
        document.querySelectorAll(".bulk-select-emp").forEach(cb => {
            cb.addEventListener("change", () => {
                const id = parseInt(cb.getAttribute("data-id"), 10);
                if (cb.checked) selectedEmployeeIds.add(id);
                else selectedEmployeeIds.delete(id);
                updateBulkEditToolbar();
            });
        });
        const selectAllEmp = document.getElementById("bulk-select-all-emp");
        if (selectAllEmp) {
            selectAllEmp.checked = filteredEmps.length > 0 && filteredEmps.every(e => selectedEmployeeIds.has(e.id));
            selectAllEmp.onchange = () => {
                if (selectAllEmp.checked) {
                    filteredEmps.forEach(e => selectedEmployeeIds.add(e.id));
                } else {
                    filteredEmps.forEach(e => selectedEmployeeIds.delete(e.id));
                }
                renderCRUDTables();
            };
        }
        updateBulkEditToolbar();

        // Hide/Show action buttons based on Active Role
        toggleRoleUIVisibility();
    }

    function openBulkEditModal() {
        if (selectedEmployeeIds.size === 0) return;
        document.getElementById("form-bulk-edit").reset();
        document.querySelectorAll("#form-bulk-edit input, #form-bulk-edit select").forEach(el => {
            if (el.type !== "checkbox") el.disabled = true;
        });
        document.getElementById("bulk-edit-target-desc").textContent =
            `Applying to ${selectedEmployeeIds.size} employee${selectedEmployeeIds.size === 1 ? "" : "s"}. Leave a field blank/unchecked to leave it unchanged.`;
        document.getElementById("modal-bulk-edit").classList.add("active");
    }

    function updateBulkEditToolbar() {
        const toolbar = document.getElementById("bulk-edit-toolbar");
        const countEl = document.getElementById("bulk-edit-count");
        if (!toolbar || !countEl) return;
        const count = selectedEmployeeIds.size;
        countEl.textContent = `${count} selected`;
        toolbar.style.display = (count > 0 && activeRole !== "user") ? "flex" : "none";
    }

    async function fetchTrash(requestId) {
        try {
            const ts = Date.now();
            const response = await fetch(`/api/trash?_ts=${ts}`);
            if (requestId !== undefined && requestId !== refreshRequestId) return;
            if (response.ok) {
                const data = await response.json();
                if (requestId !== undefined && requestId !== refreshRequestId) return;
                trashData = data;
                renderTrash();
            }
        } catch (err) {
            console.error("Error fetching trash:", err);
        }
    }

    function renderTrash() {
        const body = document.querySelector("#trash-table tbody");
        if (!body) return;
        body.innerHTML = "";

        const rows = [
            ...trashData.employees.map(e => ({ type: "Employee", id: e.id, name: e.name, details: `${e.team} / ${e.location}`, deleted_at: e.deleted_at })),
            ...trashData.topics.map(t => ({ type: "Topic", id: t.id, name: t.name, details: t.category, deleted_at: t.deleted_at }))
        ].sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

        if (rows.length === 0) {
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.6; padding: 16px;">Trash is empty.</td></tr>`;
            return;
        }

        rows.forEach(r => {
            const tr = document.createElement("tr");
            const when = r.deleted_at ? new Date(r.deleted_at).toLocaleString() : "-";
            tr.innerHTML = `
                <td><span class="badge">${r.type}</span></td>
                <td><strong>${r.name}</strong></td>
                <td>${r.details}</td>
                <td>${when}</td>
                <td>
                    <button class="btn btn-secondary btn-restore-trash" data-type="${r.type}" data-id="${r.id}" style="padding: 4px 10px; font-size: 12px;"><i class="fa-solid fa-trash-arrow-up"></i> Restore</button>
                    <button class="btn btn-danger btn-permanent-delete-trash master-only" data-type="${r.type}" data-id="${r.id}" data-name="${r.name}" style="padding: 4px 10px; font-size: 12px;"><i class="fa-solid fa-fire"></i> Delete Forever</button>
                </td>
            `;
            body.appendChild(tr);
        });

        document.querySelectorAll(".btn-restore-trash").forEach(btn => {
            btn.addEventListener("click", async () => {
                const type = btn.getAttribute("data-type");
                const id = btn.getAttribute("data-id");
                const endpoint = type === "Employee" ? `/api/employees/${id}/restore` : `/api/topics/${id}/restore`;
                try {
                    const response = await fetch(endpoint, { method: "POST" });
                    if (response.ok) {
                        await refreshAllData();
                    }
                } catch (err) {
                    console.error("Error restoring from trash:", err);
                }
            });
        });

        document.querySelectorAll(".btn-permanent-delete-trash").forEach(btn => {
            btn.addEventListener("click", async () => {
                const type = btn.getAttribute("data-type");
                const id = btn.getAttribute("data-id");
                const name = btn.getAttribute("data-name");
                if (!confirm(`Permanently delete ${type.toLowerCase()} '${name}'? This cannot be undone.`)) return;
                const endpoint = type === "Employee" ? `/api/employees/${id}/permanent` : `/api/topics/${id}/permanent`;
                try {
                    const response = await fetch(endpoint, { method: "DELETE" });
                    if (response.ok) {
                        await refreshAllData();
                    }
                } catch (err) {
                    console.error("Error permanently deleting from trash:", err);
                }
            });
        });

        toggleRoleUIVisibility();
    }

    function toggleRoleUIVisibility() {
        if (activeRole === "user") {
            document.body.classList.add("role-user-active");
            document.body.classList.remove("role-admin-active");
            
            // Hide CRUD Action Buttons
            document.getElementById("btn-add-employee").style.display = "none";
            document.getElementById("btn-add-topic").style.display = "none";
            document.querySelectorAll(".btn-delete-emp, .btn-edit-emp, .btn-delete-topic, .btn-edit-topic").forEach(b => {
                b.style.display = "none";
            });
            document.getElementById("btn-clone-scenario").style.display = "none";
            document.getElementById("btn-create-scenario").style.display = "none";
            document.getElementById("btn-delete-scenario").style.display = "none";
        } else {
            document.body.classList.add("role-admin-active");
            document.body.classList.remove("role-user-active");
            
            // Show CRUD Action Buttons
            document.getElementById("btn-add-employee").style.display = "inline-flex";
            document.getElementById("btn-add-topic").style.display = "inline-flex";
            document.querySelectorAll(".btn-delete-emp, .btn-edit-emp, .btn-delete-topic, .btn-edit-topic").forEach(b => {
                b.style.display = "inline-flex";
            });
            document.getElementById("btn-clone-scenario").style.display = "inline-flex";
            document.getElementById("btn-create-scenario").style.display = "inline-flex";
            document.getElementById("btn-delete-scenario").style.display = "inline-flex";
        }

        // Show or hide admin-only elements
        if (activeRole === "admin" || activeRole === "master_admin") {
            document.querySelectorAll(".admin-only").forEach(el => el.style.display = "");
        } else {
            document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
        }

        // Show or hide master-only elements (permanently destructive actions:
        // emptying Trash, clearing Audit Logs, deleting Upload History)
        if (activeRole === "master_admin") {
            document.querySelectorAll(".master-only").forEach(el => el.style.display = "");
            if (btnResetDemo) btnResetDemo.style.display = "inline-flex";
        } else {
            document.querySelectorAll(".master-only").forEach(el => el.style.display = "none");
            if (btnResetDemo) btnResetDemo.style.display = "none";
        }
    }

    // ==========================================
    // 6. DETAILED EVENT HANDLERS (CRUD & MODALS)
    // ==========================================
    
    function setupEventListeners() {
        // Logout handler
        if (btnLogout) {
            btnLogout.addEventListener("click", logout);
        }

        // Reset Demo handler
        if (btnResetDemo) {
            btnResetDemo.addEventListener("click", async () => {
                if (confirm("Are you sure you want to completely reset all demo data? This will restore all default scenarios, employees, topics, and upload history to their original pristine state.")) {
                    try {
                        const response = await fetch("/api/admin/reset-demo", {
                            method: "POST"
                        });
                        if (response.ok) {
                            alert("Demo data successfully reset to pristine state!");
                            window.location.reload();
                        } else {
                            const err = await response.json();
                            alert("Failed to reset demo database: " + (err.detail || response.statusText));
                        }
                    } catch (e) {
                        alert("Network error occurred: " + e.message);
                    }
                }
            });
        }

        // Login form submission handler
        if (formLogin) {
            formLogin.addEventListener("submit", async (e) => {
                e.preventDefault();
                const username = document.getElementById("login-username").value.trim();
                const password = document.getElementById("login-password").value;
                loginErrorAlert.style.display = "none";

                try {
                    const response = await fetch("/api/auth/login", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username, password })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        // The session cookie is already set by the response
                        // (HttpOnly); we only cache display info locally.
                        localStorage.setItem("role", data.role);
                        localStorage.setItem("username", data.username);
                        localStorage.setItem("name", data.name);

                        activeRole = data.role;

                        document.body.classList.add("authenticated");
                        userDisplayName.innerHTML = `<i class="fa-solid fa-user-circle" style="color: var(--primary-color);"></i> ${data.name}`;
                        
                        updateSidebarFiltersVisibility();

                        await fetchScenarios();
                        await fetchActiveScenario();
                        await refreshAllData();
                        restoreSectionFromHash();
                    } else {
                        loginErrorAlert.style.display = "block";
                        loginErrorAlert.classList.add("shake-animation");
                        setTimeout(() => loginErrorAlert.classList.remove("shake-animation"), 500);
                    }
                } catch (err) {
                    console.error("Login request failed:", err);
                    loginErrorAlert.innerText = "Network connection error.";
                    loginErrorAlert.style.display = "block";
                }
            });
        }

        // Sidebar Navigation click swaps - updates the URL hash (e.g. #simulation)
        // so the tab survives a refresh/back-button instead of always resetting
        // to the Allocation Grid. See navigateToSection/restoreSectionFromHash.
        navItems.forEach(item => {
            item.addEventListener("click", () => {
                const sectionId = item.getAttribute("data-target");
                navigateToSection(sectionId);
                history.pushState({ section: sectionId }, "", `#${sectionIdToSlug(sectionId)}`);
            });
        });

        window.addEventListener("popstate", (e) => {
            if (!document.body.classList.contains("authenticated")) return;
            const sectionId = (e.state && e.state.section) || slugToSectionId(window.location.hash.replace(/^#/, ""));
            if (sectionId && isSectionAccessible(sectionId)) {
                navigateToSection(sectionId);
            }
        });

        // Reset Filters binding
        if (btnResetFilters) {
            btnResetFilters.addEventListener("click", () => {
                filters.location = "";
                filters.team = "";
                filters.department = "";
                filters.category = "";
                filters.manager = "";
                filters.status = "";
                filters.topicId = "";
                filters.minRate = 0;
                filters.maxRate = 999999;
                filters.employeeSearch = "";
                filters.minUtil = 0;
                filters.maxUtil = 999;
                filters.minCost = 0;
                filters.maxCost = 999999999;
                matrixGrouping = "none";
                const groupingSelect = document.getElementById("matrix-grouping-select");
                if (groupingSelect) {
                    groupingSelect.value = "none";
                }
                renderFiltersPanel();
                renderAllocationMatrix();
            });
        }

        const groupingSelect = document.getElementById("matrix-grouping-select");
        if (groupingSelect) {
            groupingSelect.addEventListener("change", (e) => {
                matrixGrouping = e.target.value;
                renderAllocationMatrix();
            });
        }

        const btnViewCards = document.getElementById("btn-view-cards");
        const btnViewTable = document.getElementById("btn-view-table");
        if (btnViewCards && btnViewTable) {
            btnViewCards.addEventListener("click", () => {
                matrixMobileView = "cards";
                btnViewCards.classList.add("active");
                btnViewTable.classList.remove("active");
                btnViewCards.style.background = "var(--primary-color)";
                btnViewCards.style.color = "#fff";
                btnViewTable.style.background = "transparent";
                btnViewTable.style.color = "var(--text-secondary)";
                renderAllocationMatrix();
            });
            btnViewTable.addEventListener("click", () => {
                matrixMobileView = "table";
                btnViewTable.classList.add("active");
                btnViewCards.classList.remove("active");
                btnViewTable.style.background = "var(--primary-color)";
                btnViewTable.style.color = "#fff";
                btnViewCards.style.background = "transparent";
                btnViewCards.style.color = "var(--text-secondary)";
                renderAllocationMatrix();
            });
        }

        // Tab switches on Dashboard
        document.querySelectorAll(".dash-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".dash-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                activeDashTab = tab.getAttribute("data-tab");
                document.querySelectorAll(".dash-tab-content").forEach(tc => tc.classList.remove("active"));
                document.getElementById(activeDashTab).classList.add("active");
            });
        });

        // Dashboard specific dropdown filters
        document.getElementById("select-dash-topic").addEventListener("change", renderTopicDashboard);
        document.getElementById("select-dash-team").addEventListener("change", renderTeamDashboard);
        document.getElementById("select-dash-employee").addEventListener("change", renderEmployeeDashboard);

        // Modals close button hooks
        document.querySelectorAll(".modal-close").forEach(btn => {
            btn.addEventListener("click", () => {
                document.getElementById(btn.getAttribute("data-modal")).classList.remove("active");
            });
        });

        // CRUD Modal Add button launches - shared by the Management Panel and the
        // "Add Row" / "Add Column" controls on the Allocation Matrix itself.
        function openAddEmployeeModal() {
            formEmployee.reset();
            document.getElementById("emp-id").value = "";
            document.getElementById("employee-modal-title").innerText = "Add New Employee";
            document.getElementById("modal-employee").classList.add("active");
        }

        function openAddTopicModal() {
            formTopic.reset();
            document.getElementById("topic-id").value = "";
            document.getElementById("topic-modal-title").innerText = "Add New Topic";
            document.getElementById("modal-topic").classList.add("active");
        }

        document.getElementById("btn-add-employee").addEventListener("click", openAddEmployeeModal);
        document.getElementById("btn-add-topic").addEventListener("click", openAddTopicModal);

        // Bulk Edit Employees
        document.getElementById("btn-bulk-clear").addEventListener("click", () => {
            selectedEmployeeIds.clear();
            renderCRUDTables();
        });

        document.getElementById("btn-bulk-edit").addEventListener("click", openBulkEditModal);

        // Each bulk-set-* checkbox enables/disables its paired input(s)
        [
            ["bulk-set-team", ["bulk-team"]],
            ["bulk-set-dept", ["bulk-dept"]],
            ["bulk-set-location", ["bulk-location"]],
            ["bulk-set-manager", ["bulk-manager"]],
            ["bulk-set-status", ["bulk-status"]],
            ["bulk-set-rate", ["bulk-rate-mode", "bulk-rate"]]
        ].forEach(([checkboxId, fieldIds]) => {
            const cb = document.getElementById(checkboxId);
            cb.addEventListener("change", () => {
                fieldIds.forEach(fid => { document.getElementById(fid).disabled = !cb.checked; });
            });
        });

        document.getElementById("form-bulk-edit").addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = { employee_ids: [...selectedEmployeeIds] };

            if (document.getElementById("bulk-set-team").checked) {
                payload.team = document.getElementById("bulk-team").value;
            }
            if (document.getElementById("bulk-set-dept").checked) {
                payload.department = document.getElementById("bulk-dept").value;
            }
            if (document.getElementById("bulk-set-location").checked) {
                payload.location = document.getElementById("bulk-location").value;
            }
            if (document.getElementById("bulk-set-manager").checked) {
                payload.manager = document.getElementById("bulk-manager").value;
            }
            if (document.getElementById("bulk-set-status").checked) {
                payload.status = document.getElementById("bulk-status").value;
            }
            if (document.getElementById("bulk-set-rate").checked) {
                const rateVal = parseFloat(document.getElementById("bulk-rate").value);
                if (!isNaN(rateVal)) {
                    if (document.getElementById("bulk-rate-mode").value === "set") {
                        payload.hourly_rate_set = rateVal;
                    } else {
                        payload.hourly_rate_adjust_pct = rateVal;
                    }
                }
            }

            try {
                const response = await fetch("/api/employees/bulk", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                if (response.ok) {
                    document.getElementById("modal-bulk-edit").classList.remove("active");
                    selectedEmployeeIds.clear();
                    await refreshAllData();
                } else {
                    const err = await response.json();
                    alert(`Bulk edit failed: ${err.detail || "Unknown error"}`);
                }
            } catch (err) {
                console.error("Error applying bulk edit:", err);
            }
        });

        // Empty Trash (Master Admin only - permanently purges every soft-deleted
        // employee/topic in the active scenario)
        const btnEmptyTrash = document.getElementById("btn-empty-trash");
        if (btnEmptyTrash) {
            btnEmptyTrash.addEventListener("click", async () => {
                const total = trashData.employees.length + trashData.topics.length;
                if (total === 0) return;
                if (!confirm(`Permanently delete all ${total} item(s) in Trash? This cannot be undone.`)) return;
                try {
                    const response = await fetch("/api/trash", { method: "DELETE" });
                    if (response.ok) {
                        await refreshAllData();
                    }
                } catch (err) {
                    console.error("Error emptying trash:", err);
                }
            });
        }

        document.getElementById("btn-matrix-add-employee").addEventListener("click", openAddEmployeeModal);
        document.getElementById("btn-matrix-add-topic").addEventListener("click", openAddTopicModal);

        // Submit actions for Employee CRUD Form
        formEmployee.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = document.getElementById("emp-id").value;
            const empData = {
                name: document.getElementById("emp-name").value,
                team: document.getElementById("emp-team").value,
                department: document.getElementById("emp-dept").value,
                location: document.getElementById("emp-location").value,
                available_hours: parseFloat(document.getElementById("emp-hours").value),
                hourly_rate: parseFloat(document.getElementById("emp-rate").value),
                status: document.getElementById("emp-status").value,
                manager: document.getElementById("emp-manager").value || null,
                notes: document.getElementById("emp-notes").value || null
            };

            try {
                let response;
                if (id) {
                    // Update
                    response = await fetch(`/api/employees/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(empData)
                    });
                } else {
                    // Create
                    response = await fetch("/api/employees", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(empData)
                    });
                }
                
                if (response.ok) {
                    document.getElementById("modal-employee").classList.remove("active");
                    await refreshAllData();
                } else {
                    alert("Error saving employee.");
                }
            } catch (err) {
                console.error("Error submitting employee form:", err);
            }
        });

        // Submit actions for Topic CRUD Form
        formTopic.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = document.getElementById("topic-id").value;
            const topicData = {
                name: document.getElementById("topic-name").value,
                category: document.getElementById("topic-category").value,
                area: document.getElementById("topic-area").value || null,
                description: document.getElementById("topic-desc").value || null,
                objective: document.getElementById("topic-objective").value || null,
                deliverables: document.getElementById("topic-deliverables").value || null,
                justification: document.getElementById("topic-justification").value || null,
                status: "Active",
                recovery: parseFloat(document.getElementById("topic-recovery").value || 0.0)
            };

            try {
                let response;
                if (id) {
                    response = await fetch(`/api/topics/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(topicData)
                    });
                } else {
                    response = await fetch("/api/topics", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(topicData)
                    });
                }
                
                if (response.ok) {
                    document.getElementById("modal-topic").classList.remove("active");
                    await refreshAllData();
                } else {
                    alert("Error saving topic.");
                }
            } catch (err) {
                console.error("Error submitting topic form:", err);
            }
        });

        // Submit actions for Allocation Matrix Cell Save
        formAllocation.addEventListener("submit", async (e) => {
            e.preventDefault();
            const allocData = {
                employee_id: parseInt(document.getElementById("alloc-emp-id").value),
                topic_id: parseInt(document.getElementById("alloc-topic-id").value),
                percentage: parseFloat(document.getElementById("alloc-pct").value),
                comment: document.getElementById("alloc-comment").value || ""
            };

            try {
                const response = await fetch("/api/allocations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(allocData)
                });
                
                if (response.ok) {
                    document.getElementById("modal-allocation").classList.remove("active");
                    await refreshAllData();
                } else {
                    alert("Error updating allocation.");
                }
            } catch (err) {
                console.error("Error saving allocation:", err);
            }
        });

        // Scenario management switches
        scenarioSelect.addEventListener("change", async () => {
            const selectedId = scenarioSelect.value;
            if (selectedId) {
                try {
                    const response = await fetch(`/api/scenarios/active/${selectedId}`, { method: "POST" });
                    if (response.ok) {
                        await fetchActiveScenario();
                        await refreshAllData();
                    }
                } catch (err) {
                    console.error("Error switching scenario:", err);
                }
            }
        });

        // Scenario Creation launches
        document.getElementById("btn-create-scenario").addEventListener("click", () => {
            formCreateScenario.reset();
            document.getElementById("modal-scenario").classList.add("active");
        });

        formCreateScenario.addEventListener("submit", async (e) => {
            e.preventDefault();
            const scenData = {
                name: document.getElementById("new-scenario-name").value,
                description: document.getElementById("new-scenario-desc").value || ""
            };
            try {
                const response = await fetch("/api/scenarios", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(scenData)
                });
                if (response.ok) {
                    document.getElementById("modal-scenario").classList.remove("active");
                    await fetchScenarios();
                    await fetchActiveScenario();
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error creating scenario:", err);
            }
        });

        // Scenario Clone launches
        document.getElementById("btn-clone-scenario").addEventListener("click", () => {
            formCloneScenario.reset();
            document.getElementById("clone-scenario-name").value = `Clone of ${activeScenario.name}`;
            document.getElementById("modal-clone").classList.add("active");
        });

        formCloneScenario.addEventListener("submit", async (e) => {
            e.preventDefault();
            const cloneData = {
                new_name: document.getElementById("clone-scenario-name").value,
                new_description: document.getElementById("clone-scenario-desc").value || ""
            };
            try {
                const response = await fetch(`/api/scenarios/${activeScenario.id}/clone`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(cloneData)
                });
                if (response.ok) {
                    document.getElementById("modal-clone").classList.remove("active");
                    await fetchScenarios();
                    await fetchActiveScenario();
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error cloning scenario:", err);
            }
        });

        // Scenario Deletion launches
        document.getElementById("btn-delete-scenario").addEventListener("click", async () => {
            if (scenarios.length <= 1) {
                alert("Cannot delete the only scenario. Keep at least one scenario active.");
                return;
            }
            if (confirm(`Are you sure you want to delete scenario: '${activeScenario.name}'? This deletes all mapped employees, topics and allocations.`)) {
                try {
                    const response = await fetch(`/api/scenarios/${activeScenario.id}`, { method: "DELETE" });
                    if (response.ok) {
                        await fetchScenarios();
                        await fetchActiveScenario();
                        await refreshAllData();
                    }
                } catch (err) {
                    console.error("Error deleting scenario:", err);
                }
            }
        });

        // CSV File Drag Drop hooks
        const dropArea = document.getElementById("csv-drag-drop");
        const fileInput = document.getElementById("csv-file-input");

        dropArea.addEventListener("click", () => fileInput.click());

        dropArea.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropArea.classList.add("dragover");
        });
        
        dropArea.addEventListener("dragleave", () => {
            dropArea.classList.remove("dragover");
        });

        dropArea.addEventListener("drop", (e) => {
            e.preventDefault();
            dropArea.classList.remove("dragover");
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                uploadCSV(files[0]);
            }
        });

        fileInput.addEventListener("change", (e) => {
            if (fileInput.files.length > 0) {
                uploadCSV(fileInput.files[0]);
            }
        });

        // Upload section tabs: "Upload New File" / "Upload History"
        document.querySelectorAll(".upload-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".upload-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                const target = tab.getAttribute("data-upload-tab");
                document.querySelectorAll(".upload-tab-content").forEach(tc => tc.classList.remove("active"));
                document.getElementById(target).classList.add("active");

                if (target === "tab-upload-history") {
                    fetchAndRenderUploadHistory();
                }
            });
        });

        // Presentation Print Deck trigger
        document.getElementById("btn-print-deck").addEventListener("click", async () => {
            try {
                await fetch("/api/reports/log-export", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        report_name: `Visual Presentation Deck (${activeScenario ? activeScenario.name : "Scenario"})`,
                        format: "PDF/Print"
                    })
                });
            } catch (err) {
                console.error("Failed to log deck print:", err);
            }
            window.print();
        });

        // Presentation Deck customization panel (rendered inline next to the deck)
        const btnDeckReset = document.getElementById("btn-deck-reset-default");
        if (btnDeckReset) {
            btnDeckReset.addEventListener("click", () => {
                deckConfig = getDefaultDeckConfig();
                saveDeckConfig();
                renderDeckCustomizeList();
                renderPresentationDeck();
            });
        }

        // Add Custom Slide trigger
        const btnDeckAddCustom = document.getElementById("btn-deck-add-custom-slide");
        if (btnDeckAddCustom) {
            btnDeckAddCustom.addEventListener("click", () => {
                const newId = "custom_" + Date.now();
                deckConfig.push({
                    id: newId,
                    included: true,
                    isCustom: true,
                    overrides: {
                        "title-text": "Custom Slide Title",
                        "body-text": "Click here to type custom content for this slide. You can write bullet points, lists, or text paragraphs."
                    }
                });
                saveDeckConfig();
                renderDeckCustomizeList();
                renderPresentationDeck();
            });
        }

        // Generate AI Memo trigger - fetches a real-data-grounded executive
        // memo (LLM-enriched if Ollama is available, deterministic fallback
        // otherwise - see /api/reports/ai-memo) and drops it in as a custom
        // slide using the same push pattern as Add Slide / addSimComparisonToDeck.
        const btnDeckGenerateMemo = document.getElementById("btn-deck-generate-ai-memo");
        if (btnDeckGenerateMemo) {
            btnDeckGenerateMemo.addEventListener("click", async () => {
                const originalHTML = btnDeckGenerateMemo.innerHTML;
                btnDeckGenerateMemo.disabled = true;
                btnDeckGenerateMemo.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> Generating...";
                try {
                    const response = await fetch("/api/reports/ai-memo", { method: "POST" });
                    if (!response.ok) {
                        alert("Failed to generate the executive memo.");
                        return;
                    }
                    const data = await response.json();
                    const bodyHTML = data.memo.split(/\n{2,}/).map(p => `<p>${p.trim()}</p>`).join("");

                    if (!deckConfig) loadDeckConfig();
                    const newId = "custom_memo_" + Date.now();
                    deckConfig.push({
                        id: newId,
                        included: true,
                        isCustom: true,
                        overrides: {
                            "title-text": "Executive Memo",
                            "body-text": bodyHTML
                        }
                    });
                    saveDeckConfig();
                    renderDeckCustomizeList();
                    renderPresentationDeck();
                } catch (err) {
                    console.error("Error generating AI memo:", err);
                    alert("Error generating the executive memo.");
                } finally {
                    btnDeckGenerateMemo.disabled = false;
                    btnDeckGenerateMemo.innerHTML = originalHTML;
                }
            });
        }

        // Present Mode triggers
        const btnPresentDeck = document.getElementById("btn-present-deck");
        if (btnPresentDeck) {
            btnPresentDeck.addEventListener("click", enterPresentationMode);
        }

        // Focusout listener to capture editable presentation table cell edits
        document.addEventListener("focusout", (e) => {
            if (e.target.classList.contains("pres-editable-cell")) {
                const type = e.target.dataset.type;
                const valueText = e.target.innerText.replace(/[$,%\s]/g, "");
                const val = parseFloat(valueText);
                if (isNaN(val)) return;
                
                if (type === "topic-cost") {
                    const topicId = parseInt(e.target.dataset.topicId);
                    slideTableOverrides[`topic_cost_${topicId}`] = val;
                } else if (type === "team-cost") {
                    const teamName = e.target.dataset.teamName;
                    slideTableOverrides[`team_cost_${teamName}`] = val;
                } else if (type === "team-util") {
                    const teamName = e.target.dataset.teamName;
                    slideTableOverrides[`team_util_${teamName}`] = val;
                } else if (type === "emp-cost") {
                    const empName = e.target.dataset.empName;
                    slideTableOverrides[`emp_cost_${empName}`] = val;
                } else if (type === "emp-util") {
                    const empName = e.target.dataset.empName;
                    slideTableOverrides[`emp_util_${empName}`] = val;
                }
                
                // Re-render the deck slide previews and recompute charts
                renderPresentationDeck();
                
                // If currently presenting, update active physical slide
                const overlay = document.getElementById("presentation-overlay");
                if (overlay && overlay.classList.contains("active")) {
                    rebuildPhysicalSlides();
                    renderPresentationOverlaySlide();
                }
            }
        });

        const presBtnPrev = document.getElementById("pres-btn-prev");
        if (presBtnPrev) {
            presBtnPrev.addEventListener("click", prevPresSlide);
        }

        const presBtnNext = document.getElementById("pres-btn-next");
        if (presBtnNext) {
            presBtnNext.addEventListener("click", nextPresSlide);
        }

        const presBtnExit = document.getElementById("pres-btn-exit");
        if (presBtnExit) {
            presBtnExit.addEventListener("click", exitPresentationMode);
        }

        const presBtnTheme = document.getElementById("pres-btn-theme");
        if (presBtnTheme) {
            presBtnTheme.addEventListener("click", () => {
                const overlay = document.getElementById("presentation-overlay");
                if (overlay.classList.contains("theme-light-presentation")) {
                    overlay.classList.remove("theme-light-presentation");
                    overlay.classList.add("theme-dark-presentation");
                } else {
                    overlay.classList.remove("theme-dark-presentation");
                    overlay.classList.add("theme-light-presentation");
                }
                renderPresentationOverlaySlide();
            });
        }

        const presBtnExclude = document.getElementById("pres-btn-exclude");
        if (presBtnExclude) {
            presBtnExclude.addEventListener("click", () => {
                const activePhysicalSlide = activePhysicalSlides[currentPresSlideIndex];
                if (activePhysicalSlide) {
                    const slideId = activePhysicalSlide.slideId;
                    const configItem = deckConfig.find(item => item.id === slideId);
                    if (configItem) {
                        configItem.included = false;
                        saveDeckConfig();
                        rebuildPhysicalSlides();
                        if (activePhysicalSlides.length === 0) {
                            exitPresentationMode();
                        } else {
                            if (currentPresSlideIndex >= activePhysicalSlides.length) {
                                currentPresSlideIndex = activePhysicalSlides.length - 1;
                            }
                            renderPresentationOverlaySlide();
                        }
                        renderPresentationDeck();
                    }
                }
            });
        }

        // Keydown handler for presentation keyboard navigation
        document.addEventListener("keydown", (e) => {
            const overlay = document.getElementById("presentation-overlay");
            if (overlay && overlay.classList.contains("active")) {
                // Do not navigate if user is typing in a contenteditable field
                if (document.activeElement && document.activeElement.hasAttribute("contenteditable")) {
                    return;
                }
                if (e.key === "ArrowLeft" || e.key === "PageUp") {
                    prevPresSlide();
                } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
                    e.preventDefault();
                    nextPresSlide();
                } else if (e.key === "Escape") {
                    exitPresentationMode();
                }
            }
        });

        // Executive Summary "Customize View" panel
        const btnExecCustomize = document.getElementById("btn-exec-customize");
        const execCustomizePanel = document.getElementById("exec-customize-panel");
        if (btnExecCustomize && execCustomizePanel) {
            btnExecCustomize.addEventListener("click", (e) => {
                e.stopPropagation();
                const isOpen = execCustomizePanel.style.display !== "none";
                execCustomizePanel.style.display = isOpen ? "none" : "block";
            });
            document.addEventListener("click", (e) => {
                if (!execCustomizePanel.contains(e.target) && e.target !== btnExecCustomize) {
                    execCustomizePanel.style.display = "none";
                }
            });
        }
        const btnExecCustomizeReset = document.getElementById("btn-exec-customize-reset");
        if (btnExecCustomizeReset) {
            btnExecCustomizeReset.addEventListener("click", () => {
                execWidgetConfig = {};
                saveExecWidgetConfig();
                applyExecWidgetVisibility();
                renderExecCustomizeList();
            });
        }

        // Presentation report CSV export
        const btnExportDeckCsv = document.getElementById("btn-export-deck-csv");
        if (btnExportDeckCsv) {
            btnExportDeckCsv.addEventListener("click", exportPresentationReportToCSV);
        }

        // Export Matrix CSV trigger
        const btnExportCSV = document.getElementById("btn-export-matrix-csv");
        if (btnExportCSV) {
            btnExportCSV.addEventListener("click", exportMatrixToCSV);
        }

        // Export Matrix Excel trigger
        const btnExportExcel = document.getElementById("btn-export-matrix-excel");
        if (btnExportExcel) {
            btnExportExcel.addEventListener("click", exportMatrixToExcel);
        }

        // Refresh Audit Logs trigger
        const btnRefreshLogs = document.getElementById("btn-refresh-logs");
        if (btnRefreshLogs) {
            btnRefreshLogs.addEventListener("click", fetchAndRenderAdminLogs);
        }

        // Clear All Audit Logs (Master Admin only)
        const btnClearLogs = document.getElementById("btn-clear-logs");
        if (btnClearLogs) {
            btnClearLogs.addEventListener("click", async () => {
                if (!confirm("Permanently clear the entire audit log? This cannot be undone.")) return;
                try {
                    const response = await fetch("/api/admin/logs", { method: "DELETE" });
                    if (response.ok) {
                        await fetchAndRenderAdminLogs();
                    }
                } catch (err) {
                    console.error("Error clearing audit logs:", err);
                }
            });
        }

        // Language selector binding - a full reload (not live re-render) is
        // deliberate: many labels are baked into already-rendered dynamic
        // content (matrix footer, dashboards, filters panel), and correctly
        // live-patching every one of those render paths individually isn't
        // worth the risk for a chrome-only translation feature.
        const langSelect = document.getElementById("lang-select");
        if (langSelect) {
            langSelect.value = localStorage.getItem("app-lang") || "en";
            langSelect.addEventListener("change", (e) => {
                localStorage.setItem("app-lang", e.target.value);
                window.location.reload();
            });
        }

        // Theme selector binding
        const themeSelect = document.getElementById("theme-select");
        if (themeSelect) {
            const savedTheme = localStorage.getItem("app-theme") || "theme-glass";
            themeSelect.value = savedTheme;
            setAppTheme(savedTheme);
            
            themeSelect.addEventListener("change", (e) => {
                const selected = e.target.value;
                localStorage.setItem("app-theme", selected);
                setAppTheme(selected);
                if (activeSection === "dashboards-section") {
                    renderDashboards();
                } else if (activeSection === "presentation-section") {
                    renderPresentationDeck();
                }
            });
        }

        // PDF Export Theme binding
        const pdfThemeSelect = document.getElementById("pdf-print-theme");
        if (pdfThemeSelect) {
            const savedPrintTheme = localStorage.getItem("pdf-print-theme") || "print-theme-light";
            pdfThemeSelect.value = savedPrintTheme;
            setPdfPrintTheme(savedPrintTheme);
            
            pdfThemeSelect.addEventListener("change", (e) => {
                const selected = e.target.value;
                localStorage.setItem("pdf-print-theme", selected);
                setPdfPrintTheme(selected);
                if (activeSection === "presentation-section") {
                    renderPresentationDeck();
                }
            });
        }

        // Scenario Export JSON trigger
        const btnExportScenario = document.getElementById("btn-export-scenario");
        if (btnExportScenario) {
            btnExportScenario.addEventListener("click", async () => {
                if (!activeScenario) {
                    alert("No active scenario to backup.");
                    return;
                }
                try {
                    const response = await fetch(`/api/scenarios/${activeScenario.id}/backup`);
                    if (response.ok) {
                        const backupData = await response.json();
                        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        const filename = `${activeScenario.name.toLowerCase().replace(/\s+/g, "_")}_backup.json`;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        const err = await response.json();
                        alert(err.detail || "Failed to download scenario backup.");
                    }
                } catch (err) {
                    console.error("Backup scenario failed:", err);
                    alert("Connection error.");
                }
            });
        }

        // Scenario Import JSON triggers
        const btnImportScenario = document.getElementById("btn-import-scenario");
        const importScenarioFile = document.getElementById("import-scenario-file");
        if (btnImportScenario && importScenarioFile) {
            btnImportScenario.addEventListener("click", () => {
                importScenarioFile.click();
            });
            
            importScenarioFile.addEventListener("change", async (e) => {
                if (importScenarioFile.files.length === 0) return;
                const file = importScenarioFile.files[0];
                
                if (!confirm(`Are you sure you want to restore scenario '${activeScenario.name}' from backup file '${file.name}'? This will completely overwrite all employees, topics, allocations, and costs for this scenario!`)) {
                    importScenarioFile.value = "";
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = async (evt) => {
                    try {
                        const payload = JSON.parse(evt.target.result);
                        if (!payload.name || !Array.isArray(payload.employees) || !Array.isArray(payload.topics)) {
                            alert("Invalid backup file structure. Missing name, employees or topics properties.");
                            importScenarioFile.value = "";
                            return;
                        }
                        
                        const response = await fetch(`/api/scenarios/${activeScenario.id}/restore`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(payload)
                        });
                        
                        if (response.ok) {
                            alert("Scenario restored successfully!");
                            importScenarioFile.value = "";
                            await fetchScenarios();
                            await fetchActiveScenario();
                            await refreshAllData();
                        } else {
                            const err = await response.json();
                            alert(err.detail || "Failed to restore scenario backup.");
                            importScenarioFile.value = "";
                        }
                    } catch (err) {
                        console.error("Failed to parse or restore scenario:", err);
                        alert("Error parsing backup file or server communication issue.");
                        importScenarioFile.value = "";
                    }
                };
                reader.readAsText(file);
            });
        }

        // Audit Logs search + filters (client-side, re-filters the cached log list)
        const searchAuditLogs = document.getElementById("search-audit-logs");
        if (searchAuditLogs) {
            searchAuditLogs.addEventListener("input", (e) => {
                auditLogSearch = e.target.value.trim();
                renderAuditLogsTable();
            });
        }
        const filterAuditLogsAction = document.getElementById("filter-audit-logs-action");
        if (filterAuditLogsAction) {
            filterAuditLogsAction.addEventListener("change", (e) => {
                auditLogActionFilter = e.target.value;
                renderAuditLogsTable();
            });
        }
        const filterAuditLogsUser = document.getElementById("filter-audit-logs-user");
        if (filterAuditLogsUser) {
            filterAuditLogsUser.addEventListener("change", (e) => {
                auditLogUserFilter = e.target.value;
                renderAuditLogsTable();
            });
        }

        // User Settings search + role filter (client-side, re-filters the cached user list)
        const searchUsers = document.getElementById("search-users");
        if (searchUsers) {
            searchUsers.addEventListener("input", (e) => {
                userSearch = e.target.value.trim();
                renderUsersTable();
            });
        }
        const filterUsersRole = document.getElementById("filter-users-role");
        if (filterUsersRole) {
            filterUsersRole.addEventListener("change", (e) => {
                userRoleFilter = e.target.value;
                renderUsersTable();
            });
        }

        // Create user form submission handler
        const formManageUser = document.getElementById("form-manage-create-user");
        if (formManageUser) {
            formManageUser.addEventListener("submit", async (e) => {
                e.preventDefault();
                const name = document.getElementById("m-create-name").value.trim();
                const username = document.getElementById("m-create-username").value.trim();
                const password = document.getElementById("m-create-password").value;
                const role = document.getElementById("m-create-role").value;
                const email = document.getElementById("m-create-email").value.trim() || null;
                const department = document.getElementById("m-create-department").value.trim() || null;
                const position = document.getElementById("m-create-position").value.trim() || null;
                const supervisor = document.getElementById("m-create-supervisor").value.trim() || null;
                const errDiv = document.getElementById("m-create-error");
                errDiv.style.display = "none";

                try {
                    const response = await fetch("/api/users", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ name, username, password, role, email, department, position, supervisor })
                    });
                    if (response.ok) {
                        formManageUser.reset();
                        fetchAndRenderUsers();
                    } else {
                        const errData = await response.json();
                        errDiv.innerText = errData.detail || "Failed to create user account.";
                        errDiv.style.display = "block";
                    }
                } catch (err) {
                    console.error("Create user error:", err);
                    errDiv.innerText = "Network error creating user.";
                    errDiv.style.display = "block";
                }
            });
        }

        // Edit User Account (Master Admin can edit anyone; Admin can edit
        // Admin/User accounts but not Master Admin)
        const formEditUser = document.getElementById("form-edit-user");
        if (formEditUser) {
            formEditUser.addEventListener("submit", async (e) => {
                e.preventDefault();
                const id = document.getElementById("edit-user-id").value;
                const errDiv = document.getElementById("edit-user-error");
                errDiv.style.display = "none";

                const payload = {
                    name: document.getElementById("edit-user-name").value.trim(),
                    email: document.getElementById("edit-user-email").value.trim(),
                    department: document.getElementById("edit-user-department").value.trim(),
                    position: document.getElementById("edit-user-position").value.trim(),
                    supervisor: document.getElementById("edit-user-supervisor").value.trim()
                };
                const roleWrap = document.getElementById("edit-user-role-wrap");
                if (roleWrap.style.display !== "none") {
                    payload.role = document.getElementById("edit-user-role").value;
                }
                const newPassword = document.getElementById("edit-user-password").value;
                if (newPassword) {
                    payload.password = newPassword;
                }

                try {
                    const response = await fetch(`/api/users/${id}`, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(payload)
                    });
                    if (response.ok) {
                        document.getElementById("modal-edit-user").classList.remove("active");
                        fetchAndRenderUsers();
                    } else {
                        const errData = await response.json();
                        errDiv.innerText = errData.detail || "Failed to update user account.";
                        errDiv.style.display = "block";
                    }
                } catch (err) {
                    console.error("Edit user error:", err);
                    errDiv.innerText = "Network error updating user.";
                    errDiv.style.display = "block";
                }
            });
        }

        // AI Chat Drawer Toggle Actions
        btnToggleAI.addEventListener("click", () => {
            aiDrawer.classList.add("active");
            aiChatInput.focus();
        });

        btnCloseAI.addEventListener("click", () => {
            aiDrawer.classList.remove("active");
        });

        const btnClearChat = document.getElementById("btn-clear-chat");
        if (btnClearChat) {
            btnClearChat.addEventListener("click", () => {
                if (confirm("Are you sure you want to clear your chat history?")) {
                    localStorage.removeItem("ai-chat-history");
                    aiChatBody.innerHTML = aiChatWelcomeHTML;
                }
            });
        }

        btnSendAI.addEventListener("click", handleAISubmit);
        aiChatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") handleAISubmit();
        });

        // Setup hooks for AI pre-written questions
        document.addEventListener("click", (e) => {
            if (e.target.classList.contains("ai-sample-query")) {
                e.preventDefault();
                aiChatInput.value = e.target.innerText;
                handleAISubmit();
            }
        });

        // Management Search and Filters binding
        const inputEmpSearch = document.getElementById("search-crud-employees");
        if (inputEmpSearch) {
            inputEmpSearch.addEventListener("input", (e) => {
                empSearch = e.target.value.trim();
                renderCRUDTables();
            });
        }
        const selectEmpLoc = document.getElementById("filter-crud-employees-location");
        if (selectEmpLoc) {
            selectEmpLoc.addEventListener("change", (e) => {
                empLocFilter = e.target.value;
                renderCRUDTables();
            });
        }

        const inputTopicSearch = document.getElementById("search-crud-topics");
        if (inputTopicSearch) {
            inputTopicSearch.addEventListener("input", (e) => {
                topicSearch = e.target.value.trim();
                renderCRUDTables();
            });
        }
        const selectTopicCat = document.getElementById("filter-crud-topics-category");
        if (selectTopicCat) {
            selectTopicCat.addEventListener("change", (e) => {
                topicCatFilter = e.target.value;
                renderCRUDTables();
            });
        }

        // Click sorting employees headers
        document.querySelectorAll("th.sortable-emp").forEach(th => {
            th.addEventListener("click", () => {
                const field = th.getAttribute("data-sort");
                if (empSortField === field) {
                    empSortOrder = -empSortOrder;
                } else {
                    empSortField = field;
                    empSortOrder = 1;
                }
                document.querySelectorAll("th.sortable-emp i").forEach(icon => {
                    icon.className = "fa-solid fa-sort";
                    icon.style.opacity = "0.4";
                });
                const icon = th.querySelector("i");
                if (icon) {
                    icon.className = empSortOrder === 1 ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
                    icon.style.opacity = "1";
                }
                renderCRUDTables();
            });
        });

        // Click sorting topics headers
        document.querySelectorAll("th.sortable-topic").forEach(th => {
            th.addEventListener("click", () => {
                const field = th.getAttribute("data-sort");
                if (topicSortField === field) {
                    topicSortOrder = -topicSortOrder;
                } else {
                    topicSortField = field;
                    topicSortOrder = 1;
                }
                document.querySelectorAll("th.sortable-topic i").forEach(icon => {
                    icon.className = "fa-solid fa-sort";
                    icon.style.opacity = "0.4";
                });
                const icon = th.querySelector("i");
                if (icon) {
                    icon.className = topicSortOrder === 1 ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
                    icon.style.opacity = "1";
                }
                renderCRUDTables();
            });
        });

        // Click sorting Executive dashboard's Team Overview headers
        document.querySelectorAll("th.sortable-teamov").forEach(th => {
            th.addEventListener("click", () => {
                const field = th.getAttribute("data-sort");
                if (teamOvSortField === field) {
                    teamOvSortOrder = -teamOvSortOrder;
                } else {
                    teamOvSortField = field;
                    teamOvSortOrder = 1;
                }
                document.querySelectorAll("th.sortable-teamov i").forEach(icon => {
                    icon.className = "fa-solid fa-sort";
                    icon.style.opacity = "0.4";
                });
                const icon = th.querySelector("i");
                if (icon) {
                    icon.className = teamOvSortOrder === 1 ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
                    icon.style.opacity = "1";
                }
                renderTeamOverviewTable();
            });
        });

        // Click sorting Executive dashboard's Employee Overview headers
        document.querySelectorAll("th.sortable-empov").forEach(th => {
            th.addEventListener("click", () => {
                const field = th.getAttribute("data-sort");
                if (empOvSortField === field) {
                    empOvSortOrder = -empOvSortOrder;
                } else {
                    empOvSortField = field;
                    empOvSortOrder = 1;
                }
                document.querySelectorAll("th.sortable-empov i").forEach(icon => {
                    icon.className = "fa-solid fa-sort";
                    icon.style.opacity = "0.4";
                });
                const icon = th.querySelector("i");
                if (icon) {
                    icon.className = empOvSortOrder === 1 ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
                    icon.style.opacity = "1";
                }
                renderEmployeeOverviewTable();
            });
        });
    }

    // ==========================================
    // 7. CSV PARSING UPLOADER INTERACTION
    // ==========================================
    
    async function uploadCSV(file) {
        const statusBox = document.getElementById("upload-status");
        statusBox.style.display = "block";
        statusBox.innerHTML = `<h4><i class="fa-solid fa-spinner fa-spin"></i> Analyzing file: ${file.name}...</h4>`;

        // AI-assisted column mapping: preview the headers first. If any column
        // looks like a mistyped/abbreviated known field (e.g. "Hrly Rate"),
        // give the admin a chance to confirm the remap before committing the
        // import - otherwise it would silently become a bogus new topic column.
        try {
            const previewForm = new FormData();
            previewForm.append("file", file);
            const previewRes = await fetch("/api/import/preview", { method: "POST", body: previewForm });
            if (previewRes.ok) {
                const previewData = await previewRes.json();
                if (previewData.suggested_mappings && previewData.suggested_mappings.length > 0) {
                    renderColumnMappingConfirmation(file, previewData.suggested_mappings);
                    return;
                }
            }
        } catch (err) {
            console.error("Error previewing column mapping:", err);
            // Preview is a best-effort assist - fall through to a direct import.
        }

        await performCSVImport(file, {});
    }

    function renderColumnMappingConfirmation(file, suggestions) {
        const statusBox = document.getElementById("upload-status");
        statusBox.innerHTML = `
            <h4><i class="fa-solid fa-wand-magic-sparkles"></i> AI-Suggested Column Mapping</h4>
            <p>Some columns look like mistyped or abbreviated versions of known fields. Confirm the ones you want remapped - unchecked columns will import as brand-new topic/project columns instead.</p>
            <div id="mapping-suggestions-list" style="display:flex; flex-direction:column; gap:6px; margin: 10px 0;">
                ${suggestions.map(s => `
                    <label style="display:flex; align-items:center; gap:8px; font-size: 13px;">
                        <input type="checkbox" class="mapping-suggestion-cb" data-header="${s.header}" data-field="${s.suggested_field}" checked>
                        Map column "<strong>${s.header}</strong>" &rarr; <strong>${s.suggested_label}</strong> <span style="opacity:0.6;">(${Math.round(s.confidence * 100)}% match)</span>
                    </label>
                `).join("")}
            </div>
            <div style="display:flex; gap:8px; margin-top: 8px;">
                <button id="btn-confirm-mapping" class="btn btn-primary">Continue Import</button>
                <button id="btn-skip-mapping" class="btn btn-secondary">Import As-Is (Ignore Suggestions)</button>
            </div>
        `;

        document.getElementById("btn-confirm-mapping").addEventListener("click", async () => {
            const mapping = {};
            document.querySelectorAll(".mapping-suggestion-cb").forEach(cb => {
                if (cb.checked) mapping[cb.getAttribute("data-header")] = cb.getAttribute("data-field");
            });
            await performCSVImport(file, mapping);
        });
        document.getElementById("btn-skip-mapping").addEventListener("click", async () => {
            await performCSVImport(file, {});
        });
    }

    async function performCSVImport(file, columnMapping) {
        const statusBox = document.getElementById("upload-status");
        statusBox.innerHTML = `<h4><i class="fa-solid fa-spinner fa-spin"></i> Processing file: ${file.name}...</h4>`;

        const formData = new FormData();
        formData.append("file", file);
        if (columnMapping && Object.keys(columnMapping).length > 0) {
            formData.append("column_mapping", JSON.stringify(columnMapping));
        }

        try {
            const response = await fetch("/api/import/csv", {
                method: "POST",
                body: formData
            });

            const resData = await response.json();
            if (response.ok && resData.status === "success") {
                const hasArchived = (resData.archived_employees || 0) > 0 || (resData.archived_topics || 0) > 0;
                statusBox.innerHTML = `
                    <h4 class="text-green"><i class="fa-solid fa-circle-check"></i> Import Successful!</h4>
                    <p>${resData.message}</p>
                    <ul>
                        <li><i class="fa-solid fa-user-plus text-blue"></i> Employees imported: <strong>${resData.imported_employees}</strong></li>
                        <li><i class="fa-solid fa-file-invoice text-blue"></i> Topics imported: <strong>${resData.imported_topics}</strong></li>
                        <li><i class="fa-solid fa-link text-blue"></i> Allocation cells loaded: <strong>${resData.imported_allocations}</strong></li>
                        <li><i class="fa-solid fa-dollar-sign text-blue"></i> Additional costs rows loaded: <strong>${resData.imported_additional_costs}</strong></li>
                    </ul>
                    ${hasArchived ? `
                        <div class="upload-sync-note">
                            <i class="fa-solid fa-broom"></i>
                            Synced to this document: <strong>${resData.archived_employees || 0}</strong> employee(s) and
                            <strong>${resData.archived_topics || 0}</strong> topic(s) not present in this file were moved to
                            <a href="#" id="link-view-trash">Trash</a> (recoverable, not deleted).
                        </div>
                    ` : ""}
                `;
                const trashLink = document.getElementById("link-view-trash");
                if (trashLink) {
                    trashLink.addEventListener("click", (e) => {
                        e.preventDefault();
                        document.querySelector('[data-target="crud-section"]').click();
                        setTimeout(() => document.getElementById("trash-card")?.scrollIntoView({ behavior: "smooth" }), 150);
                    });
                }
                // Reload matrix planning data
                await refreshAllData();
                // Keep the history tab in sync in case the user switches to it next
                fetchAndRenderUploadHistory();
            } else {
                statusBox.innerHTML = `
                    <h4 class="text-danger"><i class="fa-solid fa-circle-exclamation"></i> Import Failed</h4>
                    <p>${resData.detail || "Invalid spreadsheet structure."}</p>
                `;
            }
        } catch (err) {
            console.error("Error uploading CSV:", err);
            statusBox.innerHTML = `
                <h4 class="text-danger"><i class="fa-solid fa-circle-exclamation"></i> Upload Error</h4>
                <p>An unexpected network error occurred while uploading. Ensure server is running.</p>
            `;
        }
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    async function fetchAndRenderUploadHistory() {
        const tbody = document.querySelector("#upload-history-table tbody");
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading upload history...</td></tr>';

        try {
            const response = await fetch("/api/uploads/history");
            if (!response.ok) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger-color);"><i class="fa-solid fa-triangle-exclamation"></i> Error loading upload history.</td></tr>';
                return;
            }
            const history = await response.json();
            if (history.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No files have been uploaded yet for this planning version.</td></tr>';
                return;
            }

            tbody.innerHTML = history.map(h => {
                const date = new Date(h.uploaded_at + "Z");
                const typeBadge = h.file_type === "excel"
                    ? `<span class="badge badge-success"><i class="fa-solid fa-file-excel"></i> Excel</span>`
                    : `<span class="badge badge-primary"><i class="fa-solid fa-file-csv"></i> CSV</span>`;
                return `
                    <tr>
                        <td><strong>${h.original_filename}</strong><br><small style="color: var(--text-secondary);">${formatFileSize(h.size_bytes)}</small></td>
                        <td>${typeBadge}</td>
                        <td style="font-size: 12px; color: var(--text-secondary);">${date.toLocaleString()}</td>
                        <td>${h.uploaded_by}</td>
                        <td style="font-size: 12px;">
                            ${h.imported_employees} emp &middot; ${h.imported_topics} topics &middot; ${h.imported_allocations} allocs &middot; ${h.imported_additional_costs} costs
                            ${(h.archived_employees || h.archived_topics) ? `<br><span style="color: var(--warning-color);"><i class="fa-solid fa-broom"></i> ${h.archived_employees || 0} emp / ${h.archived_topics || 0} topics moved to Trash</span>` : ""}
                        </td>
                        <td>
                            <button class="btn btn-secondary btn-sm btn-apply-upload" data-id="${h.id}" data-filename="${h.original_filename}"><i class="fa-solid fa-clock-rotate-left"></i> Apply</button>
                            <button class="btn btn-danger btn-sm btn-delete-upload master-only" data-id="${h.id}" data-filename="${h.original_filename}"><i class="fa-solid fa-trash-can"></i> Delete</button>
                        </td>
                    </tr>
                `;
            }).join("");

            document.querySelectorAll(".btn-apply-upload").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    const filename = btn.getAttribute("data-filename");
                    if (!confirm(`Re-apply '${filename}' onto the active planning version? This will overwrite the current employees, topics, allocations, and additional costs, and any employee/topic not present in this file will be moved to Trash (recoverable).`)) {
                        return;
                    }
                    try {
                        const response = await fetch(`/api/uploads/history/${id}/apply`, { method: "POST" });
                        const resData = await response.json();
                        if (response.ok && resData.status === "success") {
                            const archivedBits = [];
                            if (resData.archived_employees) archivedBits.push(`${resData.archived_employees} employee(s)`);
                            if (resData.archived_topics) archivedBits.push(`${resData.archived_topics} topic(s)`);
                            const archivedMsg = archivedBits.length ? `\n\nMoved to Trash (not in this file): ${archivedBits.join(" and ")}.` : "";
                            alert(resData.message + archivedMsg);
                            await refreshAllData();
                        } else {
                            alert(resData.detail || "Failed to apply this upload.");
                        }
                    } catch (err) {
                        console.error("Error applying historical upload:", err);
                        alert("Connection error while applying this upload.");
                    }
                });
            });

            document.querySelectorAll(".btn-delete-upload").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    const filename = btn.getAttribute("data-filename");
                    if (!confirm(`Permanently delete the upload history record for '${filename}'? This cannot be undone.`)) return;
                    try {
                        const response = await fetch(`/api/uploads/history/${id}`, { method: "DELETE" });
                        if (response.ok) {
                            await fetchAndRenderUploadHistory();
                        }
                    } catch (err) {
                        console.error("Error deleting upload history record:", err);
                    }
                });
            });

            toggleRoleUIVisibility();
        } catch (err) {
            console.error("Error fetching upload history:", err);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger-color);">Failed to connect to backend server.</td></tr>';
        }
    }

    // ==========================================
    // 8. MATRIX INLINE EDIT PROMPT POPULATORS
    // ==========================================
    
    function openAllocationModal(empId, empName, topicId, topicName, currentPct, currentComment) {
        document.getElementById("alloc-emp-id").value = empId;
        document.getElementById("alloc-topic-id").value = topicId;
        document.getElementById("alloc-info-label").innerHTML = `<strong>${empName}</strong> allocated to <strong>${topicName}</strong>`;
        document.getElementById("alloc-pct").value = currentPct;
        document.getElementById("alloc-comment").value = currentComment || "";
        
        document.getElementById("modal-allocation").classList.add("active");
        setTimeout(() => document.getElementById("alloc-pct").focus(), 150);
    }

    window.editEmployeePrompt = editEmployeePrompt;
    window.deleteEmployeePrompt = deleteEmployeePrompt;

    // CRUD edit launchers
    function editEmployeePrompt(id) {
        const emp = employees.find(e => e.id == id);
        if (!emp) return;
        
        document.getElementById("emp-id").value = emp.id;
        document.getElementById("emp-name").value = emp.name;
        document.getElementById("emp-team").value = emp.team;
        document.getElementById("emp-dept").value = emp.department;
        document.getElementById("emp-location").value = emp.location;
        document.getElementById("emp-hours").value = emp.available_hours;
        document.getElementById("emp-rate").value = emp.hourly_rate;
        document.getElementById("emp-status").value = emp.status;
        document.getElementById("emp-manager").value = emp.manager || "";
        document.getElementById("emp-notes").value = emp.notes || "";
        
        document.getElementById("employee-modal-title").innerText = "Edit Employee Profile";
        document.getElementById("modal-employee").classList.add("active");
    }

    async function deleteEmployeePrompt(id) {
        const emp = employees.find(e => e.id == id);
        if (!emp) return;
        if (confirm(`Move employee '${emp.name}' to Trash? Their allocations will be hidden until restored from the Trash panel.`)) {
            try {
                const response = await fetch(`/api/employees/${id}`, { method: "DELETE" });
                if (response.ok) {
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error deleting employee:", err);
            }
        }
    }

    function openEditUserModal(user) {
        document.getElementById("edit-user-id").value = user.id;
        document.getElementById("edit-user-username-label").innerText = `Editing account: ${user.username}`;
        document.getElementById("edit-user-name").value = user.name || "";
        document.getElementById("edit-user-email").value = user.email || "";
        document.getElementById("edit-user-department").value = user.department || "";
        document.getElementById("edit-user-position").value = user.position || "";
        document.getElementById("edit-user-supervisor").value = user.supervisor || "";
        document.getElementById("edit-user-password").value = "";

        const roleWrap = document.getElementById("edit-user-role-wrap");
        const roleSelect = document.getElementById("edit-user-role");
        // Only Master Admin can change roles, and never for a Master Admin
        // account (there must always be exactly one).
        if (activeRole === "master_admin" && user.role !== "master_admin") {
            roleWrap.style.display = "";
            roleSelect.value = user.role;
        } else {
            roleWrap.style.display = "none";
        }

        document.getElementById("edit-user-error").style.display = "none";
        document.getElementById("modal-edit-user").classList.add("active");
    }

    function editTopicPrompt(id) {
        const topic = topics.find(t => t.id == id);
        if (!topic) return;

        document.getElementById("topic-id").value = topic.id;
        document.getElementById("topic-name").value = topic.name;
        document.getElementById("topic-category").value = topic.category;
        document.getElementById("topic-area").value = topic.area || "";
        document.getElementById("topic-recovery").value = topic.recovery;
        document.getElementById("topic-desc").value = topic.description || "";
        document.getElementById("topic-objective").value = topic.objective || "";
        document.getElementById("topic-deliverables").value = topic.deliverables || "";
        document.getElementById("topic-justification").value = topic.justification || "";

        document.getElementById("topic-modal-title").innerText = "Edit Topic Scope";
        document.getElementById("modal-topic").classList.add("active");
    }

    async function deleteTopicPrompt(id) {
        const topic = topics.find(t => t.id == id);
        if (!topic) return;
        if (confirm(`Move topic '${topic.name}' to Trash? Its allocations and additional costs will be hidden until restored from the Trash panel.`)) {
            try {
                const response = await fetch(`/api/topics/${id}`, { method: "DELETE" });
                if (response.ok) {
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error deleting topic:", err);
            }
        }
    }

    async function fetchAndRenderAdminLogs() {
        const tbody = document.querySelector("#admin-logs-table tbody");
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading audit logs...</td></tr>';

        try {
            const response = await fetch("/api/admin/logs");
            if (response.ok) {
                auditLogsCache = await response.json();
                populateAuditLogFilterDropdowns();
                renderAuditLogsTable();
                toggleRoleUIVisibility();
            } else {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);"><i class="fa-solid fa-triangle-exclamation"></i> Error loading logs. Access denied.</td></tr>';
            }
        } catch (err) {
            console.error("Error fetching logs:", err);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);">Failed to connect to backend server.</td></tr>';
        }
    }

    function populateAuditLogFilterDropdowns() {
        const actionSelect = document.getElementById("filter-audit-logs-action");
        const userSelect = document.getElementById("filter-audit-logs-user");
        if (!actionSelect || !userSelect) return;

        const prevAction = actionSelect.value;
        const actions = [...new Set(auditLogsCache.map(l => l.action))].sort();
        actionSelect.innerHTML = '<option value="">All Actions</option>';
        actions.forEach(a => {
            const opt = document.createElement("option");
            opt.value = a;
            opt.textContent = a;
            actionSelect.appendChild(opt);
        });
        actionSelect.value = actions.includes(prevAction) ? prevAction : "";

        const prevUser = userSelect.value;
        const users = [...new Set(auditLogsCache.map(l => l.username))].sort();
        userSelect.innerHTML = '<option value="">All Users</option>';
        users.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u;
            opt.textContent = u;
            userSelect.appendChild(opt);
        });
        userSelect.value = users.includes(prevUser) ? prevUser : "";
    }

    function renderAuditLogsTable() {
        const tbody = document.querySelector("#admin-logs-table tbody");
        const countLabel = document.getElementById("audit-logs-result-count");
        if (!tbody) return;

        let filtered = [...auditLogsCache];

        if (auditLogActionFilter) {
            filtered = filtered.filter(l => l.action === auditLogActionFilter);
        }
        if (auditLogUserFilter) {
            filtered = filtered.filter(l => l.username === auditLogUserFilter);
        }
        if (auditLogSearch) {
            const q = auditLogSearch.toLowerCase();
            filtered = filtered.filter(l =>
                l.username.toLowerCase().includes(q) ||
                l.action.toLowerCase().includes(q) ||
                (l.details || "").toLowerCase().includes(q)
            );
        }

        if (countLabel) {
            countLabel.innerText = `Showing ${filtered.length} of ${auditLogsCache.length} log entries.`;
        }

        tbody.innerHTML = "";
        if (auditLogsCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No system audit logs found.</td></tr>';
            return;
        }
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No log entries match your search/filter.</td></tr>';
            return;
        }

        filtered.forEach(log => {
            const tr = document.createElement("tr");
            const date = new Date(log.timestamp + "Z");
            const localTime = date.toLocaleString();

            let badgeClass = "badge-secondary";
            if (log.action === "Login") badgeClass = "badge-success";
            else if (log.action === "Failed Login") badgeClass = "badge-danger";
            else if (log.action === "Import CSV") badgeClass = "badge-primary";
            else if (log.action === "Export Report") badgeClass = "badge-warning";
            else if (log.action === "Registration") badgeClass = "badge-info";

            tr.innerHTML = `
                <td style="font-size: 11px; color: var(--text-secondary);">${localTime}</td>
                <td><strong>${log.username}</strong></td>
                <td><span class="badge ${badgeClass}">${log.action}</span></td>
                <td style="font-size: 12px; color: var(--text-primary); max-width: 400px; word-wrap: break-word;">${log.details || ""}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    async function fetchAndRenderUsers() {
        const tbody = document.querySelector("#admin-users-table tbody");
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading users...</td></tr>';

        // Setup Create Role selector options based on user privilege
        const optAdmin = document.getElementById("opt-m-create-admin");
        if (optAdmin) {
            if (activeRole === "master_admin") {
                optAdmin.style.display = "";
            } else {
                optAdmin.style.display = "none";
                document.getElementById("m-create-role").value = "user";
            }
        }

        try {
            const response = await fetch("/api/users");
            if (response.ok) {
                usersCache = await response.json();
                populateUserRoleFilterDropdown();
                renderUsersTable();
            } else {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);"><i class="fa-solid fa-triangle-exclamation"></i> Error loading user accounts.</td></tr>';
            }
        } catch (err) {
            console.error("Error loading users:", err);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);">Connection error.</td></tr>';
        }
    }

    function populateUserRoleFilterDropdown() {
        const select = document.getElementById("filter-users-role");
        if (!select) return;
        const prevVal = select.value;
        const roles = [...new Set(usersCache.map(u => u.role))].sort();
        select.innerHTML = '<option value="">All Roles</option>';
        roles.forEach(r => {
            const opt = document.createElement("option");
            opt.value = r;
            opt.textContent = r;
            select.appendChild(opt);
        });
        select.value = roles.includes(prevVal) ? prevVal : "";
    }

    function renderUsersTable() {
        const tbody = document.querySelector("#admin-users-table tbody");
        const countLabel = document.getElementById("users-result-count");
        if (!tbody) return;

        let filtered = [...usersCache];

        if (userRoleFilter) {
            filtered = filtered.filter(u => u.role === userRoleFilter);
        }
        if (userSearch) {
            const q = userSearch.toLowerCase();
            filtered = filtered.filter(u =>
                u.name.toLowerCase().includes(q) ||
                u.username.toLowerCase().includes(q) ||
                (u.email || "").toLowerCase().includes(q) ||
                (u.department || "").toLowerCase().includes(q) ||
                (u.position || "").toLowerCase().includes(q) ||
                (u.supervisor || "").toLowerCase().includes(q)
            );
        }

        if (countLabel) {
            countLabel.innerText = `Showing ${filtered.length} of ${usersCache.length} accounts.`;
        }

        tbody.innerHTML = "";
        if (usersCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No user accounts found.</td></tr>';
            return;
        }
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No accounts match your search/filter.</td></tr>';
            return;
        }

        const currentUsername = localStorage.getItem("username");

        filtered.forEach(u => {
            const tr = document.createElement("tr");

            let roleBadgeClass = "badge-secondary";
            if (u.role === "master_admin") roleBadgeClass = "badge-danger";
            else if (u.role === "admin") roleBadgeClass = "badge-primary";

            // Only show delete option for accounts we are authorized to delete
            let deleteBtn = "";
            const canDeleteMaster = activeRole === "master_admin" && u.role !== "master_admin" && u.username !== currentUsername;
            const canDeleteAdmin = activeRole === "admin" && u.role === "user" && u.username !== currentUsername;

            if (canDeleteMaster || canDeleteAdmin) {
                deleteBtn = `<button class="btn btn-secondary btn-sm btn-delete-user" data-id="${u.id}" style="color: var(--danger-color); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2);"><i class="fa-solid fa-trash-can"></i></button>`;
            } else {
                deleteBtn = "";
            }

            // Master Admin can edit every account; Admin can edit Admin and User
            // accounts (but not Master Admin's own account).
            const canEdit = activeRole === "master_admin" || (activeRole === "admin" && u.role !== "master_admin");
            const editBtn = canEdit
                ? `<button class="btn btn-secondary btn-sm btn-edit-user" data-id="${u.id}" style="padding: 4px 8px; border-radius: 4px;"><i class="fa-solid fa-pen"></i></button>`
                : "";

            if (!editBtn && !deleteBtn) {
                deleteBtn = `<span style="font-size: 11px; color: var(--text-muted);">Protected</span>`;
            }

            // Optional profile details - shown as a subtitle under the name when present
            const subtitleParts = [u.position, u.department].filter(Boolean);
            const subtitle = subtitleParts.length
                ? `<br><small style="font-weight: normal; color: var(--text-secondary);">${subtitleParts.join(" &middot; ")}</small>`
                : "";
            const tooltipParts = [];
            if (u.email) tooltipParts.push(`Email: ${u.email}`);
            if (u.supervisor) tooltipParts.push(`Supervisor: ${u.supervisor}`);
            const tooltipAttr = tooltipParts.length ? ` title="${tooltipParts.join(" | ").replace(/"/g, "&quot;")}"` : "";

            tr.innerHTML = `
                <td${tooltipAttr}><strong>${u.name}</strong>${subtitle}</td>
                <td style="font-size: 12px; color: var(--text-secondary);">${u.username}</td>
                <td><span class="badge ${roleBadgeClass}">${u.role}</span></td>
                <td style="display: flex; gap: 6px;">${editBtn}${deleteBtn}</td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll(".btn-edit-user").forEach(b => {
            b.addEventListener("click", () => {
                const id = b.getAttribute("data-id");
                const userRow = usersCache.find(u => u.id == id);
                if (userRow) openEditUserModal(userRow);
            });
        });

        // Add event listeners to delete buttons
        document.querySelectorAll(".btn-delete-user").forEach(b => {
            b.addEventListener("click", async () => {
                const id = b.getAttribute("data-id");
                const userRow = usersCache.find(u => u.id == id);
                if (!userRow) return;
                if (confirm(`Are you sure you want to delete user account '${userRow.name}' (${userRow.username})?`)) {
                    try {
                        const response = await fetch(`/api/users/${id}`, {
                            method: "DELETE"
                        });
                        if (response.ok) {
                            fetchAndRenderUsers();
                        } else {
                            const err = await response.json();
                            alert(err.detail || "Failed to delete user account.");
                        }
                    } catch (err) {
                        console.error("Error deleting user:", err);
                        alert("Connection error.");
                    }
                }
            });
        });
    }

    async function exportMatrixToCSV() {
        const activeScenarioName = activeScenario ? activeScenario.name : "Scenario";

        const trueEmpStats = {};
        employees.forEach(emp => {
            let util = 0.0;
            allocations.forEach(a => {
                if (a.employee_id === emp.id) util += a.percentage;
            });
            trueEmpStats[emp.id] = { util, cost: emp.available_hours * emp.hourly_rate * (util / 100.0) };
        });

        const filteredEmployees = employees.filter(emp => {
            if (filters.location && emp.location !== filters.location) return false;
            if (filters.team && emp.team !== filters.team) return false;
            if (filters.department && emp.department !== filters.department) return false;
            if (filters.manager && emp.manager !== filters.manager) return false;
            if (filters.status && emp.status !== filters.status) return false;
            if (filters.minRate !== undefined && emp.hourly_rate < filters.minRate) return false;
            if (filters.maxRate !== undefined && emp.hourly_rate > filters.maxRate) return false;
            if (filters.employeeSearch && !emp.name.toLowerCase().includes(filters.employeeSearch.toLowerCase())) return false;
            const trueStats = trueEmpStats[emp.id] || { util: 0, cost: 0 };
            if (filters.minUtil !== undefined && trueStats.util < filters.minUtil) return false;
            if (filters.maxUtil !== undefined && trueStats.util > filters.maxUtil) return false;
            if (filters.minCost !== undefined && trueStats.cost < filters.minCost) return false;
            if (filters.maxCost !== undefined && trueStats.cost > filters.maxCost) return false;
            if (filters.topicId) {
                const hasAlloc = allocations.some(a => a.employee_id === emp.id && a.topic_id === parseInt(filters.topicId) && a.percentage > 0.0);
                if (!hasAlloc) return false;
            }
            return true;
        });

        const filteredTopics = topics.filter(topic => {
            if (filters.category && topic.category !== filters.category) return false;
            return true;
        });

        let csvContent = "Employee,Team,Location,Hours/Year,Hourly Rate";
        filteredTopics.forEach(t => {
            csvContent += `,"${t.name.replace(/"/g, '""')}"`;
        });
        csvContent += "\n";
        
        filteredEmployees.forEach(emp => {
            csvContent += `"${emp.name.replace(/"/g, '""')}","${emp.team.replace(/"/g, '""')}","${emp.location.replace(/"/g, '""')}",${emp.available_hours},${emp.hourly_rate}`;
            filteredTopics.forEach(t => {
                const pct = allocations.find(a => a.employee_id === emp.id && a.topic_id === t.id);
                const pctVal = pct ? pct.percentage : 0.0;
                csvContent += `,${pctVal}`;
            });
            csvContent += "\n";
        });

        // Append additional-cost and recovery rows in the same bottom-of-sheet
        // layout the importer expects, so an exported file can be re-uploaded
        // without losing internal/external costs or recovery amounts.
        const categoryRows = {};
        filteredTopics.forEach(t => {
            (t.additional_costs || []).forEach(ac => {
                if (!categoryRows[ac.category]) categoryRows[ac.category] = {};
                categoryRows[ac.category][t.id] = (categoryRows[ac.category][t.id] || 0) + ac.amount;
            });
        });
        const hasRecovery = filteredTopics.some(t => t.recovery && t.recovery !== 0);

        if (Object.keys(categoryRows).length > 0 || hasRecovery) {
            csvContent += Array(5 + filteredTopics.length).fill("").join(",") + "\n";
        }

        Object.keys(categoryRows).forEach(category => {
            csvContent += `"${category.replace(/"/g, '""')}",,,,`;
            filteredTopics.forEach(t => {
                const amt = categoryRows[category][t.id];
                csvContent += `,${amt !== undefined ? amt : ""}`;
            });
            csvContent += "\n";
        });

        if (hasRecovery) {
            csvContent += `"Recovery",,,,`;
            filteredTopics.forEach(t => {
                csvContent += `,${t.recovery ? t.recovery : ""}`;
            });
            csvContent += "\n";
        }

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Allocation_Matrix_${activeScenarioName.replace(/\s+/g, "_")}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        try {
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    report_name: `Allocation Matrix (${activeScenarioName})`,
                    format: "CSV"
                })
            });
        } catch (err) {
            console.error("Failed to log matrix export:", err);
        }
    }

    async function exportMatrixToExcel() {
        const queryParams = new URLSearchParams();
        if (filters.location) queryParams.append("location", filters.location);
        if (filters.team) queryParams.append("team", filters.team);
        if (filters.department) queryParams.append("department", filters.department);
        if (filters.category) queryParams.append("category", filters.category);
        if (filters.manager) queryParams.append("manager", filters.manager);
        if (filters.status) queryParams.append("status", filters.status);
        if (filters.topicId) queryParams.append("topicId", filters.topicId);
        if (filters.minRate !== undefined && filters.minRate !== 0) queryParams.append("minRate", filters.minRate);
        if (filters.maxRate !== undefined && filters.maxRate !== 999999) queryParams.append("maxRate", filters.maxRate);
        
        try {
            const response = await fetch(`/api/export/excel?${queryParams.toString()}`, {
                method: "GET"
            });
            if (!response.ok) {
                alert("Failed to export matrix to Excel");
                return;
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Allocation_Matrix_${activeScenario ? activeScenario.name.replace(/ /g, "_") : "export"}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    report_name: `Allocation Matrix (${activeScenario ? activeScenario.name : "Scenario"})`,
                    format: "Excel"
                })
            });
        } catch (err) {
            console.error("Failed to download Excel file or log export:", err);
            alert("Error downloading Excel file.");
        }
    }

    // ==========================================
    // 9. LOCAL AI CHAT LOGIC
    // ==========================================
    
    async function handleAISubmit() {
        const text = aiChatInput.value.trim();
        if (!text) return;
        
        // Collect history before appending
        const history = [];
        document.querySelectorAll(".ai-chat-body .ai-message").forEach(b => {
            const role = b.classList.contains("user") ? "user" : "assistant";
            const textContent = b.innerText.trim();
            if (textContent && !b.querySelector(".fa-spinner")) {
                history.push({ role: role, content: textContent });
            }
        });

        aiChatInput.value = "";
        
        // If welcome message is showing (no user messages yet), clear it
        const hasUserMsg = aiChatBody.querySelectorAll(".ai-message.user").length > 0;
        if (!hasUserMsg) {
            aiChatBody.innerHTML = "";
        }

        // Append user bubble
        appendChatBubble("user", text);
        saveChatHistory();
        
        // Append assistant loading bubble
        const loadingId = "bubble-" + Date.now();
        appendChatBubble("assistant", "<i class='fa-solid fa-spinner fa-spin'></i> AI is querying local planning database...", loadingId);

        try {
            const response = await fetch("/api/ai/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: text, history: history })
            });

            const resData = await response.json();
            
            // Swap loading bubble with result text
            const bubble = document.getElementById(loadingId);
            if (bubble) {
                let formatted = resData.answer
                    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                    .replace(/\*(.*?)\*/g, "<em>$1</em>")
                    .replace(/\n/g, "<br>");
                
                 if (resData.filters) {
                    const actionId = "ai-actions-" + Date.now();
                    const isReset = resData.filters.location === "" && resData.filters.team === "" && resData.filters.department === "" && resData.filters.category === "" && resData.filters.minRate === 0;
                    const btnLabel = isReset ? "Confirm Reset" : "Apply Filters";
                    const btnClass = isReset ? "btn-danger" : "btn-primary";
                    formatted += `
                        <div id="${actionId}" class="ai-chat-actions" style="margin-top: 12px; display: flex; gap: 8px;">
                            <button class="btn ${btnClass} btn-sm apply-btn" style="padding: 4px 10px; font-size: 11px;">${btnLabel}</button>
                            <button class="btn btn-secondary btn-sm cancel-btn" style="padding: 4px 10px; font-size: 11px;">Cancel</button>
                        </div>
                    `;
                    bubble.innerHTML = formatted;

                    // Add event listeners inside the bubble context
                    const actionDiv = document.getElementById(actionId);
                    if (actionDiv) {
                        const applyBtn = actionDiv.querySelector(".apply-btn");
                        const cancelBtn = actionDiv.querySelector(".cancel-btn");

                        applyBtn.addEventListener("click", () => {
                            // Reset all filters to default before applying the AI filters
                            filters.location = "";
                            filters.team = "";
                            filters.department = "";
                            filters.category = "";
                            filters.manager = "";
                            filters.status = "";
                            filters.topicId = "";
                            filters.minRate = 0;
                            filters.maxRate = 999999;
                            filters.employeeSearch = "";
                            filters.minUtil = 0;
                            filters.maxUtil = 999;
                            filters.minCost = 0;
                            filters.maxCost = 999999999;

                            // Apply the filters to the global filters object
                            if (resData.filters.location !== undefined) filters.location = resData.filters.location;
                            if (resData.filters.team !== undefined) filters.team = resData.filters.team;
                            if (resData.filters.department !== undefined) filters.department = resData.filters.department;
                            if (resData.filters.category !== undefined) filters.category = resData.filters.category;
                            if (resData.filters.minRate !== undefined) filters.minRate = resData.filters.minRate;
                            if (resData.filters.maxRate !== undefined) filters.maxRate = resData.filters.maxRate;
                            if (resData.filters.employeeSearch !== undefined) filters.employeeSearch = resData.filters.employeeSearch;
                            if (resData.filters.minUtil !== undefined) filters.minUtil = resData.filters.minUtil;
                            if (resData.filters.maxUtil !== undefined) filters.maxUtil = resData.filters.maxUtil;

                            // Re-render dynamic filters panel
                            renderFiltersPanel();

                            // Navigate to matrix grid
                            navigateToSection("matrix-section");
                            // Use window.history explicitly - the local
                            // `history` chat-message array (above) shadows
                            // the global History API within this closure.
                            window.history.pushState({ section: "matrix-section" }, "", "#matrix");

                            // Rerender matrix with the new filters
                            renderAllocationMatrix();

                            // Disable actions and show success text
                            actionDiv.innerHTML = `<span style="color: #10b981; font-size: 11px; font-weight: 500;"><i class="fa-solid fa-circle-check"></i> Filters applied successfully</span>`;
                            saveChatHistory();
                        });

                        cancelBtn.addEventListener("click", () => {
                            actionDiv.innerHTML = `<span style="color: #64748b; font-size: 11px; font-weight: 500;"><i class="fa-solid fa-circle-xmark"></i> Action cancelled</span>`;
                            saveChatHistory();
                        });
                    }
                } else if (resData.simulation) {
                    const actionId = "ai-actions-" + Date.now();
                    formatted += `
                        <div id="${actionId}" class="ai-chat-actions" style="margin-top: 12px;">
                            <button class="btn btn-primary btn-sm view-sim-btn" style="padding: 4px 10px; font-size: 11px;"><i class="fa-solid fa-flask"></i> View in Simulation</button>
                        </div>
                    `;
                    bubble.innerHTML = formatted;

                    const actionDiv = document.getElementById(actionId);
                    if (actionDiv) {
                        actionDiv.querySelector(".view-sim-btn").addEventListener("click", async () => {
                            simScenario = { id: resData.simulation.scenario_id, name: resData.simulation.scenario_name };
                            await fetchScenarios();
                            await fetchSimData();
                            navigateToSection("simulation-section");
                            // Use window.history explicitly - the local
                            // `history` chat-message array (above) shadows
                            // the global History API within this closure.
                            window.history.pushState({ section: "simulation-section" }, "", "#simulation");

                            const compareA = document.getElementById("sim-compare-a");
                            const compareB = document.getElementById("sim-compare-b");
                            if (compareA && activeScenario) compareA.value = activeScenario.id;
                            if (compareB) compareB.value = simScenario.id;
                            const btnCompare = document.getElementById("btn-sim-compare");
                            if (btnCompare) btnCompare.click();

                            actionDiv.innerHTML = `<span style="color: #64748b; font-size: 11px; font-weight: 500;"><i class="fa-solid fa-circle-check"></i> Opened in Simulation</span>`;
                            saveChatHistory();
                        });
                    }
                } else {
                    bubble.innerHTML = formatted;
                }
                
                if (resData.grouping !== undefined) {
                    matrixGrouping = resData.grouping;
                    const groupingSelect = document.getElementById("matrix-grouping-select");
                    if (groupingSelect) {
                        groupingSelect.value = resData.grouping;
                    }
                    renderAllocationMatrix();
                }
                saveChatHistory();
            }

            if (resData.action_executed) {
                // The AI directly changed allocation data - refresh everything
                // (matrix, dashboards, presentation deck) to reflect the new state.
                await refreshAllData();
            }
        } catch (err) {
            console.error("Error asking local AI query:", err);
            const bubble = document.getElementById(loadingId);
            if (bubble) {
                bubble.innerHTML = "An unexpected error occurred while processing query. Confirm server connection.";
            }
        }
        
        // Scroll body down
        aiChatBody.scrollTop = aiChatBody.scrollHeight;
    }

    function appendChatBubble(sender, content, id = null) {
        const div = document.createElement("div");
        div.className = `ai-message ${sender}`;
        if (id) div.id = id;
        div.innerHTML = content;
        aiChatBody.appendChild(div);
        aiChatBody.scrollTop = aiChatBody.scrollHeight;
    }

    function saveChatHistory() {
        const chatMessages = [];
        aiChatBody.querySelectorAll(".ai-message").forEach(msg => {
            // Skip the welcome message
            if (msg.classList.contains("assistant") && msg.querySelector("ul")) {
                return;
            }
            // Skip loaders
            if (msg.querySelector(".fa-spinner")) {
                return;
            }
            
            // Clone to avoid live mutations
            const clone = msg.cloneNode(true);
            
            // Handle unclicked action buttons by marking them expired when saving/reloading
            const actionsDiv = clone.querySelector(".ai-chat-actions");
            if (actionsDiv) {
                if (actionsDiv.querySelector("button")) {
                    actionsDiv.innerHTML = `<span style="color: #64748b; font-size: 11px; font-weight: 500;"><i class="fa-solid fa-circle-info"></i> Interactive filter option expired</span>`;
                }
            }
            
            chatMessages.push({
                role: clone.classList.contains("user") ? "user" : "assistant",
                content: clone.innerHTML
            });
        });
        try {
            localStorage.setItem("ai-chat-history", JSON.stringify(chatMessages));
        } catch (e) {
            console.error("Error saving chat history:", e);
        }
    }

    function loadChatHistory() {
        try {
            const stored = localStorage.getItem("ai-chat-history");
            if (stored) {
                const messages = JSON.parse(stored);
                if (messages.length > 0) {
                    aiChatBody.innerHTML = ""; // Clear welcome
                    messages.forEach(msg => {
                        appendChatBubble(msg.role, msg.content);
                    });
                }
            }
        } catch (e) {
            console.error("Error loading chat history:", e);
        }
    }

    // Populate scenario lists on select dropdown
    function populateScenarioDropdown() {
        scenarioSelect.innerHTML = "";
        scenarios.forEach(scen => {
            const opt = document.createElement("option");
            opt.value = scen.id;
            opt.innerText = scen.name + (scen.is_active ? " (Active)" : "");
            scenarioSelect.appendChild(opt);
        });
    }

    // Populate Dynamic Filters Options based on Loaded Scenario Data
    function renderFiltersPanel() {
        const container = document.getElementById("dynamic-filters-container");
        if (!container) return;

        // Get unique lists
        const locations = [...new Set(employees.map(e => e.location).filter(Boolean))].sort();
        const teams = [...new Set(employees.map(e => e.team).filter(Boolean))].sort();
        const depts = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
        const managers = [...new Set(employees.map(e => e.manager).filter(Boolean))].sort();
        const statuses = [...new Set(employees.map(e => e.status).filter(Boolean))].sort();
        const categories = [...new Set(topics.map(t => t.category).filter(Boolean))].sort();

        let html = `
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.location")}</label>
                <select id="filter-location" class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);">
                    <option value="">${t("filter.allLocations")}</option>
                    ${locations.map(loc => `<option value="${loc}" ${filters.location === loc ? 'selected' : ''}>${loc}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.team")}</label>
                <select id="filter-team" class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);">
                    <option value="">${t("filter.allTeams")}</option>
                    ${teams.map(t2 => `<option value="${t2}" ${filters.team === t2 ? 'selected' : ''}>${t2}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.department")}</label>
                <select id="filter-dept" class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);">
                    <option value="">${t("filter.allDepartments")}</option>
                    ${depts.map(d => `<option value="${d}" ${filters.department === d ? 'selected' : ''}>${d}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.category")}</label>
                <select id="filter-category" class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);">
                    <option value="">${t("filter.allCategories")}</option>
                    ${categories.map(c => `<option value="${c}" ${filters.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.manager")}</label>
                <select id="filter-manager" class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);">
                    <option value="">${t("filter.allManagers")}</option>
                    ${managers.map(m => `<option value="${m}" ${filters.manager === m ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.status")}</label>
                <select id="filter-status" class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);">
                    <option value="">${t("filter.allStatuses")}</option>
                    ${statuses.map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.activeProject")}</label>
                <select id="filter-active-topic" class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);">
                    <option value="">${t("filter.anyProject")}</option>
                    ${topics.map(t2 => `<option value="${t2.id}" ${filters.topicId === String(t2.id) ? 'selected' : ''}>${t2.name}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.hourlyRate")}</label>
                <div style="display: flex; gap: 10px;">
                    <input type="number" id="filter-min-rate" placeholder="Min" class="filter-dropdown" style="width: 50%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);" value="${filters.minRate || ''}">
                    <input type="number" id="filter-max-rate" placeholder="Max" class="filter-dropdown" style="width: 50%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);" value="${filters.maxRate === 999999 ? '' : filters.maxRate}">
                </div>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.employeeSearch")}</label>
                <input type="text" id="filter-employee-search" placeholder="Search by name..." class="filter-dropdown" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);" value="${filters.employeeSearch || ''}">
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.totalUtilization")}</label>
                <div style="display: flex; gap: 10px;">
                    <input type="number" id="filter-min-util" placeholder="Min" class="filter-dropdown" style="width: 50%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);" value="${filters.minUtil || ''}">
                    <input type="number" id="filter-max-util" placeholder="Max" class="filter-dropdown" style="width: 50%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);" value="${filters.maxUtil === 999 ? '' : filters.maxUtil}">
                </div>
            </div>
            <div class="filter-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 5px; color: var(--text-secondary);">${t("filter.totalCost")}</label>
                <div style="display: flex; gap: 10px;">
                    <input type="number" id="filter-min-cost" placeholder="Min" class="filter-dropdown" style="width: 50%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);" value="${filters.minCost || ''}">
                    <input type="number" id="filter-max-cost" placeholder="Max" class="filter-dropdown" style="width: 50%; padding: 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--bg-primary); color: var(--text-primary);" value="${filters.maxCost === 999999999 ? '' : filters.maxCost}">
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Numeric filter keys default to 0 when cleared if they're a "min"
        // bound, else to that field's effectively-unbounded max.
        const numericDefaults = { minRate: 0, maxRate: 999999, minUtil: 0, maxUtil: 999, minCost: 0, maxCost: 999999999 };

        // Bind event listeners
        const bindListener = (id, prop, isNumeric = false) => {
            const el = document.getElementById(id);
            if (el) {
                const apply = () => {
                    if (isNumeric) {
                        filters[prop] = el.value ? parseFloat(el.value) : numericDefaults[prop];
                    } else {
                        filters[prop] = el.value;
                    }
                    renderAllocationMatrix();
                };
                el.addEventListener("change", apply);
                if (el.tagName === 'INPUT') {
                    el.addEventListener("input", apply);
                }
            }
        };

        bindListener("filter-location", "location");
        bindListener("filter-team", "team");
        bindListener("filter-dept", "department");
        bindListener("filter-category", "category");
        bindListener("filter-manager", "manager");
        bindListener("filter-status", "status");
        bindListener("filter-active-topic", "topicId");
        bindListener("filter-min-rate", "minRate", true);
        bindListener("filter-max-rate", "maxRate", true);
        bindListener("filter-employee-search", "employeeSearch");
        bindListener("filter-min-util", "minUtil", true);
        bindListener("filter-max-util", "maxUtil", true);
        bindListener("filter-min-cost", "minCost", true);
        bindListener("filter-max-cost", "maxCost", true);
    }

    function updateSidebarFiltersVisibility() {
        // Sidebar filters moved to Allocation Grid tab; no operations needed here.
    }

    function setAppTheme(themeName) {
        document.body.classList.remove("theme-glass", "theme-light", "theme-dark", "theme-high-contrast");
        if (themeName !== "theme-glass") {
            document.body.classList.add(themeName);
        }
    }

    function setPdfPrintTheme(themeClass) {
        document.body.classList.remove("print-theme-light", "print-theme-dark");
        document.body.classList.add(themeClass);
    }

    // ==========================================
    // SIMULATION MODULE (WHAT-IF PLANNING)
    // ==========================================
    // A simulation sandbox is a scenario cloned with activate:false, so it
    // NEVER becomes the app-wide active scenario - every other page keeps
    // showing the real planning version the whole time. Quick Actions read
    // and write the sandbox exclusively through scenario-scoped endpoints
    // (GET/POST /api/scenarios/{id}/employees|topics, GET .../allocations,
    // plus the existing row-ID-based PUT/DELETE endpoints which were already
    // scenario-agnostic), using a dedicated set of sim* variables completely
    // separate from the app-wide employees/topics/allocations/activeScenario.
    // Nothing here is visible anywhere else in the app until "Apply as
    // Active Planning Version" explicitly switches the real active pointer.

    let simScenario = null;
    let simEmployees = [];
    let simTopics = [];
    let simAllocations = [];

    async function fetchSimData() {
        if (!simScenario) {
            simEmployees = [];
            simTopics = [];
            simAllocations = [];
            renderSimulationTab();
            return;
        }
        try {
            const [empRes, topRes, allocRes] = await Promise.all([
                fetch(`/api/scenarios/${simScenario.id}/employees`),
                fetch(`/api/scenarios/${simScenario.id}/topics`),
                fetch(`/api/scenarios/${simScenario.id}/allocations`)
            ]);
            simEmployees = await empRes.json();
            simTopics = await topRes.json();
            simAllocations = await allocRes.json();
        } catch (err) {
            console.error("Error fetching simulation sandbox data:", err);
        }
        renderSimulationTab();
    }

    function renderSimulationTab() {
        // Status banner
        const banner = document.getElementById("sim-status-banner");
        const bannerText = document.getElementById("sim-status-text");
        if (simScenario) {
            banner.className = "sim-status-banner sim-status-active";
            bannerText.innerText = `Currently simulating "${simScenario.name}" - ${simEmployees.length} employee(s), ${simTopics.length} topic(s). Only visible on this page until applied.`;
        } else {
            banner.className = "sim-status-banner sim-status-empty";
            bannerText.innerText = "No simulation in progress. Start one below to begin editing a private sandbox.";
        }

        // Start Simulation / Apply controls
        document.getElementById("btn-start-simulation").innerHTML = simScenario
            ? '<i class="fa-solid fa-rotate"></i> Start a New Simulation'
            : '<i class="fa-solid fa-play"></i> Start Simulation';
        const btnApplyTop = document.getElementById("btn-sim-apply-top");
        btnApplyTop.style.display = simScenario ? "inline-flex" : "none";
        const btnStopTop = document.getElementById("btn-sim-stop");
        btnStopTop.style.display = simScenario ? "inline-flex" : "none";

        const fillScenarioSelect = (select, selectValue) => {
            const prevValue = select.value;
            select.innerHTML = "";
            scenarios.forEach(scen => {
                const opt = document.createElement("option");
                opt.value = scen.id;
                opt.innerText = scen.name + (scen.is_active ? " (Active)" : "");
                select.appendChild(opt);
            });
            const target = selectValue !== undefined ? selectValue : prevValue;
            if (scenarios.some(s => s.id == target)) {
                select.value = target;
            }
        };

        fillScenarioSelect(document.getElementById("sim-base-scenario"), activeScenario ? activeScenario.id : undefined);
        fillScenarioSelect(document.getElementById("sim-compare-a"), activeScenario ? activeScenario.id : undefined);
        fillScenarioSelect(document.getElementById("sim-compare-b"), simScenario ? simScenario.id : undefined);

        if (!simScenario) {
            document.getElementById("sim-new-name").value = activeScenario ? `${activeScenario.name} - Simulation` : "";
        }

        // Quick Action controls only operate on the sandbox - disable them
        // entirely (rather than silently no-op) until one exists.
        const quickActionButtonIds = [
            "btn-sim-add-employee", "btn-sim-remove-employee", "btn-sim-add-topic",
            "btn-sim-move-work", "btn-sim-move-team", "btn-sim-adjust-effort",
            "btn-sim-apply-hours", "btn-sim-apply-rate"
        ];
        quickActionButtonIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = !simScenario;
        });
        const quickActionsHint = document.getElementById("sim-quick-actions-hint");
        if (quickActionsHint) {
            quickActionsHint.textContent = simScenario
                ? "Editing the sandbox only - nothing here affects the real planning version until you Apply."
                : "Start a simulation above to enable these.";
        }

        const fillEmployeeSelect = (select) => {
            const prevValue = select.value;
            select.innerHTML = "";
            simEmployees.forEach(emp => {
                const opt = document.createElement("option");
                opt.value = emp.id;
                opt.innerText = `${emp.name} (${emp.team})`;
                select.appendChild(opt);
            });
            if (simEmployees.some(e => e.id == prevValue)) {
                select.value = prevValue;
            }
        };
        [
            document.getElementById("sim-rate-emp"), document.getElementById("sim-move-from"),
            document.getElementById("sim-move-to"), document.getElementById("sim-effort-emp"),
            document.getElementById("sim-remove-emp"), document.getElementById("sim-hours-emp")
        ].forEach(fillEmployeeSelect);

        const fillTopicSelect = (select) => {
            const prevValue = select.value;
            select.innerHTML = "";
            simTopics.forEach(topic => {
                const opt = document.createElement("option");
                opt.value = topic.id;
                opt.innerText = topic.name;
                select.appendChild(opt);
            });
            if (simTopics.some(t => t.id == prevValue)) {
                select.value = prevValue;
            }
        };
        [document.getElementById("sim-move-topic"), document.getElementById("sim-effort-topic"), document.getElementById("sim-teammove-topic")].forEach(fillTopicSelect);

        const fillTeamSelect = (select) => {
            const prevValue = select.value;
            const teams = [...new Set(simEmployees.map(e => e.team))];
            select.innerHTML = "";
            teams.forEach(team => {
                const opt = document.createElement("option");
                opt.value = team;
                opt.innerText = team;
                select.appendChild(opt);
            });
            if (teams.includes(prevValue)) {
                select.value = prevValue;
            }
        };
        [document.getElementById("sim-teammove-from-team"), document.getElementById("sim-teammove-to-team")].forEach(fillTeamSelect);

        // Prefill hourly rate / available hours fields with the selected employee's current values
        const rateEmpSelect = document.getElementById("sim-rate-emp");
        const prefillRate = () => {
            const emp = simEmployees.find(e => e.id == rateEmpSelect.value);
            document.getElementById("sim-rate-value").value = emp ? emp.hourly_rate : "";
        };
        rateEmpSelect.onchange = prefillRate;
        prefillRate();

        const hoursEmpSelect = document.getElementById("sim-hours-emp");
        const prefillHours = () => {
            const emp = simEmployees.find(e => e.id == hoursEmpSelect.value);
            document.getElementById("sim-hours-value").value = emp ? emp.available_hours : "";
        };
        hoursEmpSelect.onchange = prefillHours;
        prefillHours();

        // Prefill effort field with the current allocation for the selected employee/topic pair
        const effortTopicSelect = document.getElementById("sim-effort-topic");
        const effortEmpSelect = document.getElementById("sim-effort-emp");
        const prefillEffort = () => {
            const alloc = simAllocations.find(a => a.employee_id == effortEmpSelect.value && a.topic_id == effortTopicSelect.value);
            document.getElementById("sim-effort-value").value = alloc ? alloc.percentage : 0;
        };
        effortTopicSelect.onchange = prefillEffort;
        effortEmpSelect.onchange = prefillEffort;
        prefillEffort();

        document.getElementById("sim-compare-results").innerHTML = "";
    }

    async function simUpsertAllocation(employeeId, topicId, percentage) {
        const clamped = Math.max(0, Math.min(100, percentage));
        await fetch("/api/allocations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_id: parseInt(employeeId), topic_id: parseInt(topicId), percentage: clamped })
        });
    }

    // Switches the real active scenario to `scenarioId`, refreshes the whole
    // app's data, and - if that scenario was the sandbox we were simulating -
    // clears simulation state back to "no simulation in progress".
    async function simApplyAsActive(scenarioId, scenarioName) {
        if (!confirm(`Make "${scenarioName}" the active planning version? Every page in the app will start reflecting its data immediately. Your other scenarios (including the one it's replacing) stay saved and can be switched back to anytime.`)) {
            return false;
        }
        try {
            const response = await fetch(`/api/scenarios/active/${scenarioId}`, { method: "POST" });
            if (response.ok) {
                if (simScenario && simScenario.id === scenarioId) {
                    simScenario = null;
                }
                await fetchScenarios();
                await fetchActiveScenario();
                await refreshAllData();
                await fetchSimData();
                alert(`"${scenarioName}" is now the active planning version.`);
                return true;
            }
            alert("Error applying simulation to the real planning version.");
        } catch (err) {
            console.error("Error applying simulation:", err);
        }
        return false;
    }

    const btnStartSimulation = document.getElementById("btn-start-simulation");
    if (btnStartSimulation) {
        btnStartSimulation.addEventListener("click", async () => {
            const baseId = document.getElementById("sim-base-scenario").value;
            const newName = document.getElementById("sim-new-name").value.trim();
            if (!baseId || !newName) {
                alert("Choose a base scenario and enter a name for the new simulation.");
                return;
            }
            try {
                const baseScenario = scenarios.find(s => s.id == baseId);
                const response = await fetch(`/api/scenarios/${baseId}/clone`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        new_name: newName,
                        new_description: `[Simulation Sandbox] Cloned from ${baseScenario ? baseScenario.name : "scenario"}`,
                        activate: false
                    })
                });
                if (response.ok) {
                    simScenario = await response.json();
                    await fetchScenarios();
                    await fetchSimData();
                } else {
                    alert("Error starting simulation.");
                }
            } catch (err) {
                console.error("Error starting simulation:", err);
            }
        });
    }

    const btnSimApplyTop = document.getElementById("btn-sim-apply-top");
    if (btnSimApplyTop) {
        btnSimApplyTop.addEventListener("click", () => {
            if (!simScenario) return;
            simApplyAsActive(simScenario.id, simScenario.name);
        });
    }

    const btnSimStop = document.getElementById("btn-sim-stop");
    if (btnSimStop) {
        btnSimStop.addEventListener("click", async () => {
            if (!simScenario) return;
            if (!confirm(`Discard the "${simScenario.name}" sandbox? All quick-action edits made in it will be permanently lost. The real active planning version is unaffected.`)) {
                return;
            }
            try {
                const response = await fetch(`/api/scenarios/${simScenario.id}`, { method: "DELETE" });
                if (response.ok) {
                    simScenario = null;
                    await fetchScenarios();
                    await fetchSimData();
                } else {
                    alert("Error stopping simulation.");
                }
            } catch (err) {
                console.error("Error stopping simulation:", err);
            }
        });
    }

    const btnSimAddEmployee = document.getElementById("btn-sim-add-employee");
    if (btnSimAddEmployee) {
        btnSimAddEmployee.addEventListener("click", async () => {
            if (!simScenario) return;
            const name = document.getElementById("sim-newemp-name").value.trim();
            const team = document.getElementById("sim-newemp-team").value.trim();
            const location = document.getElementById("sim-newemp-location").value.trim();
            if (!name || !team || !location) {
                alert("Name, Team, and Location are required.");
                return;
            }
            try {
                const response = await fetch(`/api/scenarios/${simScenario.id}/employees`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name, team, location,
                        department: document.getElementById("sim-newemp-dept").value,
                        available_hours: parseFloat(document.getElementById("sim-newemp-hours").value) || 1800,
                        hourly_rate: parseFloat(document.getElementById("sim-newemp-rate").value) || 50,
                        status: "New Position"
                    })
                });
                if (response.ok) {
                    document.getElementById("sim-newemp-name").value = "";
                    document.getElementById("sim-newemp-team").value = "";
                    document.getElementById("sim-newemp-location").value = "";
                    await fetchSimData();
                } else {
                    alert("Error adding employee to the sandbox.");
                }
            } catch (err) {
                console.error("Error adding sim employee:", err);
            }
        });
    }

    const btnSimRemoveEmployee = document.getElementById("btn-sim-remove-employee");
    if (btnSimRemoveEmployee) {
        btnSimRemoveEmployee.addEventListener("click", async () => {
            if (!simScenario) return;
            const empId = document.getElementById("sim-remove-emp").value;
            const emp = simEmployees.find(e => e.id == empId);
            if (!emp) return;
            if (!confirm(`Remove "${emp.name}" from this sandbox? This only affects the simulation, not the real planning version.`)) return;
            try {
                const response = await fetch(`/api/employees/${empId}`, { method: "DELETE" });
                if (response.ok) {
                    await fetchSimData();
                } else {
                    alert("Error removing employee from the sandbox.");
                }
            } catch (err) {
                console.error("Error removing sim employee:", err);
            }
        });
    }

    const btnSimAddTopic = document.getElementById("btn-sim-add-topic");
    if (btnSimAddTopic) {
        btnSimAddTopic.addEventListener("click", async () => {
            if (!simScenario) return;
            const name = document.getElementById("sim-newtopic-name").value.trim();
            if (!name) {
                alert("Topic name is required.");
                return;
            }
            try {
                const response = await fetch(`/api/scenarios/${simScenario.id}/topics`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name,
                        category: document.getElementById("sim-newtopic-category").value,
                        recovery: parseFloat(document.getElementById("sim-newtopic-recovery").value) || 0
                    })
                });
                if (response.ok) {
                    document.getElementById("sim-newtopic-name").value = "";
                    await fetchSimData();
                } else {
                    alert("Error adding topic to the sandbox.");
                }
            } catch (err) {
                console.error("Error adding sim topic:", err);
            }
        });
    }

    const btnSimApplyRate = document.getElementById("btn-sim-apply-rate");
    if (btnSimApplyRate) {
        btnSimApplyRate.addEventListener("click", async () => {
            if (!simScenario) return;
            const empId = document.getElementById("sim-rate-emp").value;
            const newRate = parseFloat(document.getElementById("sim-rate-value").value);
            const emp = simEmployees.find(e => e.id == empId);
            if (!emp || isNaN(newRate)) return;

            try {
                const response = await fetch(`/api/employees/${empId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: emp.name, team: emp.team, department: emp.department, location: emp.location,
                        available_hours: emp.available_hours, hourly_rate: newRate, status: emp.status,
                        manager: emp.manager, notes: emp.notes
                    })
                });
                if (response.ok) {
                    await fetchSimData();
                } else {
                    alert("Error applying rate change.");
                }
            } catch (err) {
                console.error("Error applying rate change:", err);
            }
        });
    }

    const btnSimApplyHours = document.getElementById("btn-sim-apply-hours");
    if (btnSimApplyHours) {
        btnSimApplyHours.addEventListener("click", async () => {
            if (!simScenario) return;
            const empId = document.getElementById("sim-hours-emp").value;
            const newHours = parseFloat(document.getElementById("sim-hours-value").value);
            const emp = simEmployees.find(e => e.id == empId);
            if (!emp || isNaN(newHours)) return;

            try {
                const response = await fetch(`/api/employees/${empId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: emp.name, team: emp.team, department: emp.department, location: emp.location,
                        available_hours: newHours, hourly_rate: emp.hourly_rate, status: emp.status,
                        manager: emp.manager, notes: emp.notes
                    })
                });
                if (response.ok) {
                    await fetchSimData();
                } else {
                    alert("Error applying hours change.");
                }
            } catch (err) {
                console.error("Error applying hours change:", err);
            }
        });
    }

    const btnSimMoveWork = document.getElementById("btn-sim-move-work");
    if (btnSimMoveWork) {
        btnSimMoveWork.addEventListener("click", async () => {
            if (!simScenario) return;
            const topicId = document.getElementById("sim-move-topic").value;
            const fromEmpId = document.getElementById("sim-move-from").value;
            const toEmpId = document.getElementById("sim-move-to").value;
            const amount = parseFloat(document.getElementById("sim-move-amount").value);

            if (!topicId || !fromEmpId || !toEmpId || isNaN(amount) || amount <= 0) return;
            if (fromEmpId === toEmpId) {
                alert("Choose two different employees to move work between.");
                return;
            }

            const fromAlloc = simAllocations.find(a => a.employee_id == fromEmpId && a.topic_id == topicId);
            const toAlloc = simAllocations.find(a => a.employee_id == toEmpId && a.topic_id == topicId);
            const fromPct = fromAlloc ? fromAlloc.percentage : 0;
            const toPct = toAlloc ? toAlloc.percentage : 0;
            const moved = Math.min(amount, fromPct);

            try {
                await simUpsertAllocation(fromEmpId, topicId, fromPct - moved);
                await simUpsertAllocation(toEmpId, topicId, toPct + moved);
                await fetchSimData();
            } catch (err) {
                console.error("Error moving work between employees:", err);
            }
        });
    }

    const btnSimMoveTeam = document.getElementById("btn-sim-move-team");
    if (btnSimMoveTeam) {
        btnSimMoveTeam.addEventListener("click", async () => {
            if (!simScenario) return;
            const topicId = document.getElementById("sim-teammove-topic").value;
            const sourceTeam = document.getElementById("sim-teammove-from-team").value;
            const targetTeam = document.getElementById("sim-teammove-to-team").value;
            const amount = parseFloat(document.getElementById("sim-teammove-amount").value);

            if (!topicId || !sourceTeam || !targetTeam || isNaN(amount) || amount <= 0) return;
            if (sourceTeam === targetTeam) {
                alert("Choose two different teams to move work between.");
                return;
            }

            const sourceMembers = simEmployees.filter(e => e.team === sourceTeam);
            const sourceAllocs = sourceMembers
                .map(emp => ({ emp, alloc: simAllocations.find(a => a.employee_id == emp.id && a.topic_id == topicId) }))
                .filter(entry => entry.alloc && entry.alloc.percentage > 0);

            if (sourceAllocs.length === 0) {
                alert("Selected source team has no effort on this topic to move.");
                return;
            }

            const targetMembers = simEmployees.filter(e => e.team === targetTeam);
            if (targetMembers.length === 0) {
                alert("Selected target team has no employees.");
                return;
            }

            const sourceTotal = sourceAllocs.reduce((sum, entry) => sum + entry.alloc.percentage, 0);
            const actualMove = Math.min(amount, sourceTotal);
            const perPersonIncrease = actualMove / targetMembers.length;

            try {
                for (const entry of sourceAllocs) {
                    const reduction = actualMove * (entry.alloc.percentage / sourceTotal);
                    await simUpsertAllocation(entry.emp.id, topicId, entry.alloc.percentage - reduction);
                }
                for (const emp of targetMembers) {
                    const existing = simAllocations.find(a => a.employee_id == emp.id && a.topic_id == topicId);
                    const currentPct = existing ? existing.percentage : 0;
                    await simUpsertAllocation(emp.id, topicId, currentPct + perPersonIncrease);
                }
                await fetchSimData();
            } catch (err) {
                console.error("Error moving team workload:", err);
            }
        });
    }

    const btnSimAdjustEffort = document.getElementById("btn-sim-adjust-effort");
    if (btnSimAdjustEffort) {
        btnSimAdjustEffort.addEventListener("click", async () => {
            if (!simScenario) return;
            const topicId = document.getElementById("sim-effort-topic").value;
            const empId = document.getElementById("sim-effort-emp").value;
            const newPct = parseFloat(document.getElementById("sim-effort-value").value);
            if (!topicId || !empId || isNaN(newPct)) return;

            try {
                await simUpsertAllocation(empId, topicId, newPct);
                await fetchSimData();
            } catch (err) {
                console.error("Error adjusting topic effort:", err);
            }
        });
    }

    function simAvgUtilization(report) {
        if (!report.team_summaries.length) return 0;
        const totalWeighted = report.team_summaries.reduce((sum, t) => sum + (t.average_utilization * t.member_count), 0);
        const totalMembers = report.team_summaries.reduce((sum, t) => sum + t.member_count, 0);
        return totalMembers ? totalWeighted / totalMembers : 0;
    }

    const btnSimCompare = document.getElementById("btn-sim-compare");
    if (btnSimCompare) {
        btnSimCompare.addEventListener("click", async () => {
            const scenarioAId = document.getElementById("sim-compare-a").value;
            const scenarioBId = document.getElementById("sim-compare-b").value;
            if (!scenarioAId || !scenarioBId) return;

            try {
                const [resA, resB, empResA, empResB, allocResA, allocResB] = await Promise.all([
                    fetch(`/api/reports/dashboard/${scenarioAId}`),
                    fetch(`/api/reports/dashboard/${scenarioBId}`),
                    fetch(`/api/scenarios/${scenarioAId}/employees`),
                    fetch(`/api/scenarios/${scenarioBId}/employees`),
                    fetch(`/api/scenarios/${scenarioAId}/allocations`),
                    fetch(`/api/scenarios/${scenarioBId}/allocations`)
                ]);
                const reportA = await resA.json();
                const reportB = await resB.json();
                const employeeDeltas = computeEmployeeDeltas(
                    await empResA.json(), await allocResA.json(),
                    await empResB.json(), await allocResB.json()
                );
                renderScenarioComparison(reportA, reportB, parseInt(scenarioAId), parseInt(scenarioBId), employeeDeltas);
            } catch (err) {
                console.error("Error comparing scenarios:", err);
            }
        });
    }

    // Matches employees across two scenarios by name (IDs differ once a
    // scenario has been cloned) and computes each one's total utilization
    // and annual cost on each side, so Compare can show exactly who is more
    // or less loaded - not just team/company aggregates.
    function computeEmployeeDeltas(empsA, allocsA, empsB, allocsB) {
        const summarize = (emps, allocs) => {
            const map = {};
            emps.forEach(emp => {
                const util = allocs.filter(a => a.employee_id === emp.id).reduce((sum, a) => sum + a.percentage, 0);
                map[emp.name] = { team: emp.team, util, cost: emp.available_hours * emp.hourly_rate * (util / 100.0) };
            });
            return map;
        };
        const sideA = summarize(empsA, allocsA);
        const sideB = summarize(empsB, allocsB);
        const names = [...new Set([...Object.keys(sideA), ...Object.keys(sideB)])];

        return names.map(name => {
            const a = sideA[name] || { team: (sideB[name] || {}).team || "-", util: 0, cost: 0 };
            const b = sideB[name] || { team: (sideA[name] || {}).team || "-", util: 0, cost: 0 };
            return {
                name, team: b.team || a.team,
                utilA: a.util, utilB: b.util,
                costA: a.cost, costB: b.cost,
                inA: !!sideA[name], inB: !!sideB[name]
            };
        }).sort((x, y) => Math.abs(y.costB - y.costA) - Math.abs(x.costB - x.costA));
    }

    // Builds the pros/cons verdict shown when one side of the comparison is
    // whatever scenario is currently active app-wide (i.e. "the real
    // planning version"). `other` is the non-active side being weighed;
    // `reference` is the active one it's being weighed against.
    function buildSimVerdict(reference, other) {
        const pros = [];
        const cons = [];

        const costDelta = other.total_annual_planning_cost - reference.total_annual_planning_cost;
        if (costDelta < -0.005) {
            pros.push(`Lowers total annual cost by $${Math.abs(costDelta).toLocaleString(undefined, { maximumFractionDigits: 0 })}.`);
        } else if (costDelta > 0.005) {
            cons.push(`Raises total annual cost by $${costDelta.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`);
        }

        const overloadDelta = other.overloaded_employees.length - reference.overloaded_employees.length;
        if (overloadDelta < 0) {
            pros.push(`Reduces overloaded employees by ${Math.abs(overloadDelta)} (${reference.overloaded_employees.length} → ${other.overloaded_employees.length}).`);
        } else if (overloadDelta > 0) {
            cons.push(`Increases overloaded employees by ${overloadDelta} (${reference.overloaded_employees.length} → ${other.overloaded_employees.length}).`);
        }

        const utilRef = simAvgUtilization(reference);
        const utilOther = simAvgUtilization(other);
        const headcountDelta = other.total_headcount - reference.total_headcount;

        let verdict, verdictClass, verdictIcon;
        if (pros.length === 0 && cons.length === 0) {
            verdict = "No material difference in cost or overload risk versus the current planning version.";
            verdictClass = "neutral"; verdictIcon = "fa-circle-minus";
        } else if (pros.length > cons.length) {
            verdict = "This simulation looks favorable compared to the current planning version.";
            verdictClass = "positive"; verdictIcon = "fa-thumbs-up";
        } else if (cons.length > pros.length) {
            verdict = "This simulation looks unfavorable compared to the current planning version.";
            verdictClass = "negative"; verdictIcon = "fa-triangle-exclamation";
        } else {
            verdict = "This simulation has trade-offs versus the current planning version.";
            verdictClass = "warning"; verdictIcon = "fa-scale-balanced";
        }

        const verdictColors = {
            positive: "var(--success-color)", negative: "var(--danger-color)",
            warning: "var(--warning-color)", neutral: "var(--text-secondary)"
        };

        return `
            <div class="sim-verdict-banner">
                <div class="sim-verdict-icon" style="background: ${verdictColors[verdictClass]};">
                    <i class="fa-solid ${verdictIcon}"></i>
                </div>
                <div>
                    <strong>${verdict}</strong>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                        Headcount ${reference.total_headcount} → ${other.total_headcount} &middot; Avg. Utilization ${utilRef.toFixed(1)}% → ${utilOther.toFixed(1)}%
                    </div>
                </div>
            </div>
            <div class="sim-pro-con-columns">
                <div class="sim-pro-con-card">
                    <h4 class="text-green"><i class="fa-solid fa-circle-check"></i> Pros</h4>
                    <ul>${pros.length ? pros.map(p => `<li><i class="fa-solid fa-plus text-green"></i> ${p}</li>`).join("") : "<li style='color:var(--text-secondary);'>None identified.</li>"}</ul>
                </div>
                <div class="sim-pro-con-card">
                    <h4 class="text-danger"><i class="fa-solid fa-circle-exclamation"></i> Cons</h4>
                    <ul>${cons.length ? cons.map(c => `<li><i class="fa-solid fa-minus text-danger"></i> ${c}</li>`).join("") : "<li style='color:var(--text-secondary);'>None identified.</li>"}</ul>
                </div>
            </div>
        `;
    }

    function renderScenarioComparison(reportA, reportB, scenarioAId, scenarioBId, employeeDeltas) {
        const container = document.getElementById("sim-compare-results");

        const money = (val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        const deltaClass = (delta) => delta > 0 ? "delta-positive" : (delta < 0 ? "delta-negative" : "delta-neutral");
        const deltaLabel = (delta, isPct) => `${delta > 0 ? "+" : ""}${isPct ? delta.toFixed(1) + "%" : money(delta)}`;

        const headcountDelta = reportB.total_headcount - reportA.total_headcount;
        const costDelta = reportB.total_annual_planning_cost - reportA.total_annual_planning_cost;
        const utilA = simAvgUtilization(reportA);
        const utilB = simAvgUtilization(reportB);
        const utilDelta = utilB - utilA;
        const overloadedDelta = reportB.overloaded_employees.length - reportA.overloaded_employees.length;

        // If one side of the comparison IS the scenario currently active
        // app-wide, show a pros/cons verdict plus an action to make the
        // other side the new active ("real") planning version.
        let verdictHtml = "";
        let applyTargetId = null;
        let applyTargetName = null;
        if (activeScenario) {
            if (scenarioAId === activeScenario.id && scenarioBId !== activeScenario.id) {
                verdictHtml = buildSimVerdict(reportA, reportB);
                applyTargetId = scenarioBId;
                applyTargetName = reportB.scenario_name;
            } else if (scenarioBId === activeScenario.id && scenarioAId !== activeScenario.id) {
                verdictHtml = buildSimVerdict(reportB, reportA);
                applyTargetId = scenarioAId;
                applyTargetName = reportA.scenario_name;
            }
        }

        let html = verdictHtml + `
            <div class="detail-grid">
                <div class="detail-card">
                    <h4>Headcount</h4>
                    <p>${reportA.scenario_name}: <strong>${reportA.total_headcount}</strong> &rarr; ${reportB.scenario_name}: <strong>${reportB.total_headcount}</strong></p>
                    <p class="${deltaClass(headcountDelta)}">${headcountDelta > 0 ? "+" : ""}${headcountDelta}</p>
                </div>
                <div class="detail-card">
                    <h4>Total Annual Cost</h4>
                    <p>${money(reportA.total_annual_planning_cost)} &rarr; ${money(reportB.total_annual_planning_cost)}</p>
                    <p class="${deltaClass(costDelta)}">${deltaLabel(costDelta, false)}</p>
                </div>
                <div class="detail-card">
                    <h4>Average Utilization</h4>
                    <p>${utilA.toFixed(1)}% &rarr; ${utilB.toFixed(1)}%</p>
                    <p class="${deltaClass(utilDelta)}">${deltaLabel(utilDelta, true)}</p>
                </div>
                <div class="detail-card">
                    <h4>Overloaded Employees</h4>
                    <p>${reportA.overloaded_employees.length} &rarr; ${reportB.overloaded_employees.length}</p>
                    <p class="${deltaClass(overloadedDelta)}">${overloadedDelta > 0 ? "+" : ""}${overloadedDelta}</p>
                </div>
            </div>
        `;

        const teamUtilA = {};
        reportA.team_summaries.forEach(t => { teamUtilA[t.team_name] = t.average_utilization; });
        const teamUtilB = {};
        reportB.team_summaries.forEach(t => { teamUtilB[t.team_name] = t.average_utilization; });
        const utilCell = (val) => `<span class="${val > 100 ? "text-danger" : ""}">${val.toFixed(1)}%</span>`;

        const teams = [...new Set([...Object.keys(reportA.cost_by_team), ...Object.keys(reportB.cost_by_team)])].sort();
        const teamRows = teams.map(team => {
            const costA = reportA.cost_by_team[team] || 0;
            const costB = reportB.cost_by_team[team] || 0;
            const delta = costB - costA;
            const deltaPct = costA !== 0 ? (delta / costA) * 100 : (costB !== 0 ? 100 : 0);
            const teamUtilAVal = teamUtilA[team] || 0;
            const teamUtilBVal = teamUtilB[team] || 0;
            return `
                <tr>
                    <td>${team}</td>
                    <td>${money(costA)}</td>
                    <td>${money(costB)}</td>
                    <td class="${deltaClass(delta)}">${deltaLabel(delta, false)}</td>
                    <td class="${deltaClass(delta)}">${deltaLabel(deltaPct, true)}</td>
                    <td>${utilCell(teamUtilAVal)} &rarr; ${utilCell(teamUtilBVal)}</td>
                </tr>
            `;
        }).join("");

        html += `
            <div class="crud-card" style="max-height: none; margin-top: 16px;">
                <div class="crud-card-header"><h3><i class="fa-solid fa-table"></i> Cost by Team</h3></div>
                <div class="crud-table-wrapper">
                    <table class="crud-table">
                        <thead>
                            <tr><th>Team</th><th>${reportA.scenario_name}</th><th>${reportB.scenario_name}</th><th>&Delta; Cost</th><th>&Delta; %</th><th>Utilization (&gt;100% = overloaded)</th></tr>
                        </thead>
                        <tbody>${teamRows || "<tr><td colspan='6'>No team cost data.</td></tr>"}</tbody>
                    </table>
                </div>
            </div>
        `;

        if (employeeDeltas && employeeDeltas.length) {
            const empRows = employeeDeltas.map(e => {
                const costDeltaEmp = e.costB - e.costA;
                const utilDeltaEmp = e.utilB - e.utilA;
                const presence = !e.inA ? `<span class="badge badge-success" style="font-size:10px;">only in B</span>` : (!e.inB ? `<span class="badge badge-danger" style="font-size:10px;">only in A</span>` : "");
                return `
                    <tr>
                        <td><strong>${e.name}</strong> ${presence}</td>
                        <td>${e.team}</td>
                        <td>${utilCell(e.utilA)} &rarr; ${utilCell(e.utilB)}</td>
                        <td class="${deltaClass(utilDeltaEmp)}">${deltaLabel(utilDeltaEmp, true)}</td>
                        <td>${money(e.costA)} &rarr; ${money(e.costB)}</td>
                        <td class="${deltaClass(costDeltaEmp)}">${deltaLabel(costDeltaEmp, false)}</td>
                    </tr>
                `;
            }).join("");

            html += `
                <div class="crud-card" style="max-height: 340px; margin-top: 16px;">
                    <div class="crud-card-header"><h3><i class="fa-solid fa-user-clock"></i> Per-Employee Impact</h3></div>
                    <div class="crud-table-wrapper">
                        <table class="crud-table">
                            <thead>
                                <tr><th>Employee</th><th>Team</th><th>Utilization</th><th>&Delta; Util</th><th>Annual Cost</th><th>&Delta; Cost</th></tr>
                            </thead>
                            <tbody>${empRows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        html += `
            <div class="modal-footer" style="justify-content: flex-start; padding-top: 16px; flex-wrap: wrap;">
                ${applyTargetId !== null ? `<button id="btn-sim-apply-to-real" class="btn btn-primary"><i class="fa-solid fa-check-double"></i> Apply "${applyTargetName}" as the New Active Planning Version</button>` : ""}
                <button id="btn-add-to-deck" class="btn btn-secondary"><i class="fa-solid fa-file-circle-plus"></i> Add to Presentation Deck</button>
                <button id="btn-export-comparison-csv" class="btn btn-secondary"><i class="fa-solid fa-file-csv"></i> Export to CSV</button>
            </div>
        `;

        container.innerHTML = html;

        if (applyTargetId !== null) {
            document.getElementById("btn-sim-apply-to-real").addEventListener("click", () => {
                simApplyAsActive(applyTargetId, applyTargetName);
            });
        }

        document.getElementById("btn-add-to-deck").addEventListener("click", () => {
            addSimComparisonToDeck(reportA, reportB);
        });

        document.getElementById("btn-export-comparison-csv").addEventListener("click", () => {
            exportComparisonToCSV(reportA, reportB);
        });
    }

    // Builds the inner body HTML for a Presentation Deck custom slide from a
    // scenario comparison, reusing the deck's existing contenteditable
    // custom-slide mechanism (see "Add Slide" in Customize Slides) so the
    // exported comparison is reorderable/removable/editable exactly like any
    // other slide, without needing separate rendering machinery.
    function buildSimComparisonSlideBody(reportA, reportB) {
        const money = (val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        const utilA = simAvgUtilization(reportA);
        const utilB = simAvgUtilization(reportB);
        const costDelta = reportB.total_annual_planning_cost - reportA.total_annual_planning_cost;
        const overloadedDelta = reportB.overloaded_employees.length - reportA.overloaded_employees.length;

        const teamUtilA = {};
        reportA.team_summaries.forEach(t => { teamUtilA[t.team_name] = t.average_utilization; });
        const teamUtilB = {};
        reportB.team_summaries.forEach(t => { teamUtilB[t.team_name] = t.average_utilization; });
        const utilText = (val) => `<span style="${val > 100 ? "color:#ef4444;font-weight:600;" : ""}">${val.toFixed(1)}%</span>`;

        const teams = [...new Set([...Object.keys(reportA.cost_by_team), ...Object.keys(reportB.cost_by_team)])].sort();
        const teamRows = teams.map(team => {
            const costA = reportA.cost_by_team[team] || 0;
            const costB = reportB.cost_by_team[team] || 0;
            const delta = costB - costA;
            const deltaPct = costA !== 0 ? (delta / costA) * 100 : (costB !== 0 ? 100 : 0);
            
            let deltaClass = "text-neutral-delta";
            if (delta > 0) deltaClass = "text-danger-delta";
            else if (delta < 0) deltaClass = "text-success-delta";
            
            const costDeltaStr = delta === 0 ? "$0" : `${delta > 0 ? "+" : ""}${money(delta)} (${delta > 0 ? "+" : ""}${deltaPct.toFixed(1)}%)`;
            
            return `
                <tr>
                    <td><strong>${team}</strong></td>
                    <td>${money(costA)}</td>
                    <td>${money(costB)}</td>
                    <td class="${deltaClass}" style="font-weight:600;">${costDeltaStr}</td>
                    <td>${utilText(teamUtilA[team] || 0)} &rarr; ${utilText(teamUtilB[team] || 0)}</td>
                </tr>
            `;
        }).join("");

        const costDeltaClass = costDelta > 0 ? "text-danger-delta" : costDelta < 0 ? "text-success-delta" : "";
        const overloadedDeltaClass = overloadedDelta > 0 ? "text-danger-delta" : overloadedDelta < 0 ? "text-success-delta" : "";

        return `
            <p style="font-weight: 600; margin-top: 0; margin-bottom: 12px; font-size: 13px; color: var(--accent-color);">Comparison: ${reportA.scenario_name} vs ${reportB.scenario_name}</p>
            <div class="pres-kpi-grid">
                <div class="pres-kpi-item" style="border-left-color: var(--accent-color);">
                    <span class="pres-kpi-label">Headcount</span>
                    <span class="pres-kpi-number">${reportA.total_headcount} &rarr; ${reportB.total_headcount}</span>
                </div>
                <div class="pres-kpi-item" style="border-left-color: ${costDelta > 0 ? "var(--danger-color)" : "var(--success-color)"};">
                    <span class="pres-kpi-label">Cost Shift</span>
                    <span class="pres-kpi-number ${costDeltaClass}">${costDelta === 0 ? "$0" : `${costDelta > 0 ? "+" : ""}${money(costDelta)}`}</span>
                </div>
                <div class="pres-kpi-item" style="border-left-color: var(--warning-color);">
                    <span class="pres-kpi-label">Avg Utilization</span>
                    <span class="pres-kpi-number">${utilA.toFixed(1)}% &rarr; ${utilB.toFixed(1)}%</span>
                </div>
                <div class="pres-kpi-item" style="border-left-color: ${overloadedDelta > 0 ? "var(--danger-color)" : "var(--success-color)"};">
                    <span class="pres-kpi-label">Overloads Shift</span>
                    <span class="pres-kpi-number ${overloadedDeltaClass}">${reportA.overloaded_employees.length} &rarr; ${reportB.overloaded_employees.length} (${overloadedDelta > 0 ? "+" : ""}${overloadedDelta})</span>
                </div>
            </div>
            <div class="pres-table-wrapper" style="margin-top: 14px;">
                <table class="pres-table">
                    <thead>
                        <tr><th>Team</th><th>${reportA.scenario_name}</th><th>${reportB.scenario_name}</th><th>Cost Delta (%)</th><th>Avg Util Shift</th></tr>
                    </thead>
                    <tbody>${teamRows || "<tr><td colspan='5'>No teams to compare.</td></tr>"}</tbody>
                </table>
            </div>
        `;
    }

    function addSimComparisonToDeck(reportA, reportB) {
        if (!deckConfig) loadDeckConfig();
        const newId = "custom_sim_" + Date.now();
        deckConfig.push({
            id: newId,
            included: true,
            isCustom: true,
            overrides: {
                "title-text": `Simulation Comparison: ${reportA.scenario_name} vs ${reportB.scenario_name}`,
                "body-text": buildSimComparisonSlideBody(reportA, reportB)
            }
        });
        saveDeckConfig();
        renderDeckCustomizeList();
        renderPresentationDeck();
        alert("Comparison slide added to the Presentation Deck. Open the Presentation Deck tab to view, reorder, or remove it.");
    }

    async function exportComparisonToCSV(reportA, reportB) {
        const esc = (val) => `"${String(val).replace(/"/g, '""')}"`;
        const utilA = simAvgUtilization(reportA);
        const utilB = simAvgUtilization(reportB);

        let csvContent = `Metric,${esc(reportA.scenario_name)},${esc(reportB.scenario_name)},Delta\n`;
        csvContent += `Headcount,${reportA.total_headcount},${reportB.total_headcount},${reportB.total_headcount - reportA.total_headcount}\n`;
        csvContent += `Total Annual Cost,${reportA.total_annual_planning_cost.toFixed(2)},${reportB.total_annual_planning_cost.toFixed(2)},${(reportB.total_annual_planning_cost - reportA.total_annual_planning_cost).toFixed(2)}\n`;
        csvContent += `Average Utilization %,${utilA.toFixed(1)},${utilB.toFixed(1)},${(utilB - utilA).toFixed(1)}\n`;
        csvContent += `Overloaded Employees,${reportA.overloaded_employees.length},${reportB.overloaded_employees.length},${reportB.overloaded_employees.length - reportA.overloaded_employees.length}\n`;
        csvContent += "\n";

        const teamUtilA = {};
        reportA.team_summaries.forEach(t => { teamUtilA[t.team_name] = t.average_utilization; });
        const teamUtilB = {};
        reportB.team_summaries.forEach(t => { teamUtilB[t.team_name] = t.average_utilization; });

        csvContent += `Team,${esc(reportA.scenario_name)},${esc(reportB.scenario_name)},Delta Cost,Delta %,${esc(reportA.scenario_name)} Utilization %,${esc(reportB.scenario_name)} Utilization %,Overloaded (>100%)\n`;
        const teams = [...new Set([...Object.keys(reportA.cost_by_team), ...Object.keys(reportB.cost_by_team)])].sort();
        teams.forEach(team => {
            const costA = reportA.cost_by_team[team] || 0;
            const costB = reportB.cost_by_team[team] || 0;
            const delta = costB - costA;
            const deltaPct = costA !== 0 ? (delta / costA) * 100 : (costB !== 0 ? 100 : 0);
            const teamUtilAVal = teamUtilA[team] || 0;
            const teamUtilBVal = teamUtilB[team] || 0;
            const overloadedFlag = (teamUtilAVal > 100 || teamUtilBVal > 100) ? "Yes" : "No";
            csvContent += `${esc(team)},${costA.toFixed(2)},${costB.toFixed(2)},${delta.toFixed(2)},${deltaPct.toFixed(1)},${teamUtilAVal.toFixed(1)},${teamUtilBVal.toFixed(1)},${overloadedFlag}\n`;
        });

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Scenario_Comparison_${reportA.scenario_name.replace(/\s+/g, "_")}_vs_${reportB.scenario_name.replace(/\s+/g, "_")}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        try {
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    report_name: `Scenario Comparison (${reportA.scenario_name} vs ${reportB.scenario_name})`,
                    format: "CSV"
                })
            });
        } catch (err) {
            console.error("Failed to log comparison export:", err);
        }
    }

    // ==========================================
    // PLANNING VERSION MANAGEMENT TAB
    // ==========================================
    // Full control center for scenarios: switch which one is active (always
    // reversible - just switch back), clone, backup/restore, delete, and a
    // filtered log of version-level lifecycle events. Complements the header
    // dropdown (kept as-is for quick day-to-day switching) with a deeper,
    // auditable view.

    const PV_LOG_ACTIONS = ["Switch Active Scenario", "Clone Scenario", "Create Scenario", "Delete Scenario"];

    function isSandboxScenario(scenario) {
        return !!(scenario.description && scenario.description.toLowerCase().includes("simulation sandbox"));
    }

    async function renderPlanningVersionTab() {
        renderPvScenarioTable();
        await fetchAndRenderPvLog();
    }

    function renderPvScenarioTable() {
        const tbody = document.querySelector("#pv-scenario-table tbody");
        if (!tbody) return;

        tbody.innerHTML = [...scenarios]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map(scen => {
                const sandboxBadge = isSandboxScenario(scen) ? `<span class="badge badge-secondary" style="font-size:10px; margin-left:6px;">Sandbox</span>` : "";
                const statusBadge = scen.is_active
                    ? `<span class="badge badge-success">Active</span>`
                    : `<span class="badge badge-secondary">Inactive</span>`;
                const created = new Date(scen.created_at).toLocaleString();
                return `
                    <tr>
                        <td><strong>${scen.name}</strong>${sandboxBadge}</td>
                        <td style="font-size: 12px; color: var(--text-secondary); max-width: 320px; white-space: normal;">${scen.description || "-"}</td>
                        <td>${statusBadge}</td>
                        <td style="font-size: 12px; color: var(--text-secondary);">${created}</td>
                        <td style="white-space: nowrap;">
                            ${!scen.is_active ? `<button class="btn btn-primary btn-sm pv-switch" data-id="${scen.id}" data-name="${scen.name}" title="Make Active"><i class="fa-solid fa-check"></i></button>` : ""}
                            <button class="btn btn-secondary btn-sm pv-clone" data-id="${scen.id}" data-name="${scen.name}" title="Clone"><i class="fa-solid fa-copy"></i></button>
                            <button class="btn btn-secondary btn-sm pv-backup" data-id="${scen.id}" data-name="${scen.name}" title="Backup (JSON)"><i class="fa-solid fa-file-export"></i></button>
                            <button class="btn btn-secondary btn-sm pv-restore" data-id="${scen.id}" data-name="${scen.name}" title="Restore from Backup"><i class="fa-solid fa-file-import"></i></button>
                            ${!scen.is_active ? `<button class="btn btn-danger btn-sm pv-delete" data-id="${scen.id}" data-name="${scen.name}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                        </td>
                    </tr>
                `;
            }).join("") || `<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">No planning versions found.</td></tr>`;

        tbody.querySelectorAll(".pv-switch").forEach(btn => {
            btn.addEventListener("click", async () => {
                await simApplyAsActive(parseInt(btn.getAttribute("data-id")), btn.getAttribute("data-name"));
                renderPlanningVersionTab();
            });
        });

        tbody.querySelectorAll(".pv-clone").forEach(btn => {
            btn.addEventListener("click", async () => {
                const sourceId = btn.getAttribute("data-id");
                const sourceName = btn.getAttribute("data-name");
                const newName = prompt(`New name for the clone of "${sourceName}":`, `Clone of ${sourceName}`);
                if (!newName || !newName.trim()) return;
                try {
                    const response = await fetch(`/api/scenarios/${sourceId}/clone`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ new_name: newName.trim(), new_description: `Clone of ${sourceName}`, activate: false })
                    });
                    if (response.ok) {
                        await fetchScenarios();
                        renderPlanningVersionTab();
                        alert(`Cloned "${sourceName}" into "${newName.trim()}". It was NOT made active - switch to it from this table when you're ready.`);
                    } else {
                        alert("Error cloning planning version.");
                    }
                } catch (err) {
                    console.error("Error cloning planning version:", err);
                }
            });
        });

        tbody.querySelectorAll(".pv-backup").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const name = btn.getAttribute("data-name");
                try {
                    const response = await fetch(`/api/scenarios/${id}/backup`);
                    if (response.ok) {
                        const backupData = await response.json();
                        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${name.toLowerCase().replace(/\s+/g, "_")}_backup.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        alert("Failed to download backup.");
                    }
                } catch (err) {
                    console.error("Backup failed:", err);
                }
            });
        });

        tbody.querySelectorAll(".pv-restore").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                const name = btn.getAttribute("data-name");
                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = ".json";
                fileInput.addEventListener("change", async () => {
                    if (fileInput.files.length === 0) return;
                    const file = fileInput.files[0];
                    if (!confirm(`Restore "${name}" from backup file '${file.name}'? This completely overwrites all employees, topics, allocations, and costs for this version.`)) return;

                    const reader = new FileReader();
                    reader.onload = async (evt) => {
                        try {
                            const payload = JSON.parse(evt.target.result);
                            if (!payload.name || !Array.isArray(payload.employees) || !Array.isArray(payload.topics)) {
                                alert("Invalid backup file structure.");
                                return;
                            }
                            const response = await fetch(`/api/scenarios/${id}/restore`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(payload)
                            });
                            if (response.ok) {
                                await fetchScenarios();
                                if (activeScenario && activeScenario.id == id) {
                                    await refreshAllData();
                                }
                                renderPlanningVersionTab();
                                alert(`"${name}" restored from backup.`);
                            } else {
                                const err = await response.json();
                                alert(err.detail || "Failed to restore backup.");
                            }
                        } catch (err) {
                            console.error("Restore failed:", err);
                            alert("Invalid or corrupted backup file.");
                        }
                    };
                    reader.readAsText(file);
                });
                fileInput.click();
            });
        });

        tbody.querySelectorAll(".pv-delete").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const name = btn.getAttribute("data-name");
                if (scenarios.length <= 1) {
                    alert("Cannot delete the only planning version.");
                    return;
                }
                if (!confirm(`Permanently delete planning version "${name}"? This deletes all of its employees, topics, and allocations and cannot be undone.`)) return;
                try {
                    const response = await fetch(`/api/scenarios/${id}`, { method: "DELETE" });
                    if (response.ok) {
                        if (simScenario && simScenario.id == id) simScenario = null;
                        await fetchScenarios();
                        renderPlanningVersionTab();
                    } else {
                        alert("Error deleting planning version.");
                    }
                } catch (err) {
                    console.error("Error deleting planning version:", err);
                }
            });
        });
    }

    async function fetchAndRenderPvLog() {
        const tbody = document.querySelector("#pv-log-table tbody");
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>';
        try {
            const response = await fetch("/api/admin/logs");
            if (!response.ok) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);">Error loading change log.</td></tr>';
                return;
            }
            const logs = (await response.json()).filter(l => PV_LOG_ACTIONS.includes(l.action));
            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No planning version changes logged yet.</td></tr>';
                return;
            }
            tbody.innerHTML = logs.map(l => `
                <tr>
                    <td style="font-size: 12px; color: var(--text-secondary);">${new Date(l.timestamp + "Z").toLocaleString()}</td>
                    <td>${l.username}</td>
                    <td><span class="badge badge-primary" style="font-size:10px;">${l.action}</span></td>
                    <td style="font-size: 13px;">${l.details || "-"}</td>
                </tr>
            `).join("");
        } catch (err) {
            console.error("Error fetching planning version log:", err);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);">Connection error.</td></tr>';
        }
    }

    const btnPvCreate = document.getElementById("btn-pv-create");
    if (btnPvCreate) {
        btnPvCreate.addEventListener("click", () => {
            document.getElementById("btn-create-scenario").click();
        });
    }

    const btnPvCleanupSandboxes = document.getElementById("btn-pv-cleanup-sandboxes");
    if (btnPvCleanupSandboxes) {
        btnPvCleanupSandboxes.addEventListener("click", async () => {
            const sandboxes = scenarios.filter(s => isSandboxScenario(s) && (!activeScenario || s.id !== activeScenario.id));

            if (sandboxes.length === 0) {
                alert("No simulation sandboxes to clean up.");
                return;
            }

            if (confirm(`Delete ${sandboxes.length} simulation sandbox scenario(s)? This cannot be undone:\n\n${sandboxes.map(s => `- ${s.name}`).join("\n")}`)) {
                try {
                    for (const scen of sandboxes) {
                        if (simScenario && simScenario.id === scen.id) simScenario = null;
                        await fetch(`/api/scenarios/${scen.id}`, { method: "DELETE" });
                    }
                    await fetchScenarios();
                    renderPlanningVersionTab();
                } catch (err) {
                    console.error("Error cleaning up sandboxes:", err);
                }
            }
        });
    }

    // Launch Application Init
    init();
});
