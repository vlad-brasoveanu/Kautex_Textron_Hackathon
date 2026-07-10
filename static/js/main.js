// Component: main (application entrypoint)
// Versioned like the script tags in index.html (bump both together) - ES
// module imports are fetched via the browser's normal HTTP cache same as
// any other resource, so without a cache-busting query param here, editing
// a component file can silently keep executing a stale cached copy even
// after main.js itself has been freshly reloaded.
import { state, DECK_CONFIG_STORAGE_KEY } from "./state.js?v=mobile15";
import { api } from "./api.js?v=mobile15";
import { showToast, applyTranslations, t, markApiRequestStart, markApiRequestEnd } from "./utils.js?v=mobile15";
import { initAuth } from "./components/auth.js?v=mobile15";
import { initAi } from "./components/ai.js?v=mobile15";
import { initScenarios } from "./components/scenarios.js?v=mobile15";
import { initMatrix } from "./components/matrix.js?v=mobile15";
import { initReports } from "./components/reports.js?v=mobile15";
import { initDashboards } from "./components/dashboards.js?v=mobile15";
import { initPresentation } from "./components/presentation.js?v=mobile15";
import { initModals } from "./components/modals.js?v=mobile15";

document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements - bound onto `window` (not local consts) so every component
    // module's bare references to them (formLogin, aiChatBody, scenarioSelect, ...)
    // resolve correctly, the same way state.js exposes app-data globals.
    window.scenarioSelect = document.getElementById("scenario-select");
    window.formLogin = document.getElementById("form-login");
    window.btnLogout = document.getElementById("btn-logout");
    window.btnResetDemo = document.getElementById("btn-reset-demo");
    window.userDisplayName = document.getElementById("user-display-name");
    window.loginOverlay = document.getElementById("login-overlay");
    window.loginErrorAlert = document.getElementById("login-error-alert");
    
    window.navItems = document.querySelectorAll(".nav-item");
    window.mainSections = document.querySelectorAll(".main-section");
    
    window.btnResetFilters = document.getElementById("btn-reset-filters");

    // Modal forms
    window.formEmployee = document.getElementById("form-employee");
    window.formTopic = document.getElementById("form-topic");
    window.formAllocation = document.getElementById("form-allocation");
    window.formCreateScenario = document.getElementById("form-create-scenario");
    window.formCloneScenario = document.getElementById("form-clone-scenario");

    // AI chat drawer elements
    window.btnToggleAI = document.getElementById("btn-toggle-ai");
    window.btnCloseAI = document.getElementById("btn-close-ai");
    window.aiDrawer = document.getElementById("ai-drawer");
    window.aiChatBody = document.getElementById("ai-chat-body");
    window.aiChatInput = document.getElementById("ai-chat-input");
    window.btnSendAI = document.getElementById("btn-send-ai");
    window.aiChatWelcomeHTML = aiChatBody.innerHTML;

    // Wire up every extracted component module. Must run before
    // setupEventListeners()/init() below, since those reference functions
    // (renderAllocationMatrix, renderDashboards, fetchScenarios, ...) that the
    // components attach to `window`.
    initAuth();
    initAi();
    initScenarios();
    initMatrix();
    initReports();
    initDashboards();
    initPresentation();
    initModals();

    // ==========================================
    // 1. INITIALIZATION & DATA SYNC
    // ==========================================

    window.sectionIdToSlug = function(sectionId) {
        return sectionId.replace(/-section$/, "");
    }

    window.slugToSectionId = function(slug) {
        return slug ? `${slug}-section` : null;
    }

    window.isSectionAccessible = function(sectionId) {
        const navItem = document.querySelector(`[data-target="${sectionId}"]`);
        return !!(navItem && document.getElementById(sectionId) && navItem.style.display !== "none");
    }

    window.navigateToSection = function(sectionId) {
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

    window.restoreSectionFromHash = function(fallbackSectionId = "matrix-section") {
        const requestedSectionId = slugToSectionId(window.location.hash.replace(/^#/, ""));
        const targetSectionId = (requestedSectionId && isSectionAccessible(requestedSectionId))
            ? requestedSectionId
            : fallbackSectionId;
        navigateToSection(targetSectionId);
        history.replaceState({ section: targetSectionId }, "", `#${sectionIdToSlug(targetSectionId)}`);
    }

    window.init = async function() {
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

    window.refreshAllData = async function() {
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

    window.showLoader = function() {
        // Simple opacity fade
        document.querySelector(".app-main").style.opacity = "0.7";
    }

    window.hideLoader = function() {
        document.querySelector(".app-main").style.opacity = "1";
    }

    // Click-to-view comment popover: a single shared element repositioned next
    // to whichever comment badge was clicked (see toggleCommentPopover/closeCommentPopover).
    let commentPopoverOpenIcon = null;


    window.toggleCommentPopover = function(iconEl, commentText) {
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

    window.closeCommentPopover = function() {
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

    window.toggleRoleUIVisibility = function() {
        if (activeRole === "user") {
            document.body.classList.add("role-user-active");
            document.body.classList.remove("role-admin-active");
            
            // Hide CRUD Action Buttons
            document.getElementById("btn-add-employee").style.display = "none";
            document.getElementById("btn-add-topic").style.display = "none";
            document.querySelectorAll(".btn-delete-emp, .btn-edit-emp, .btn-delete-topic, .btn-edit-topic").forEach(b => {
                b.style.display = "none";
            });
        } else {
            document.body.classList.add("role-admin-active");
            document.body.classList.remove("role-user-active");
            
            // Show CRUD Action Buttons
            document.getElementById("btn-add-employee").style.display = "inline-flex";
            document.getElementById("btn-add-topic").style.display = "inline-flex";
            document.querySelectorAll(".btn-delete-emp, .btn-edit-emp, .btn-delete-topic, .btn-edit-topic").forEach(b => {
                b.style.display = "inline-flex";
            });
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

    window.populateCRUDLocDropdown = function() {
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

    window.populateCRUDCatDropdown = function() {
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

    window.setupEventListeners = function() {
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

        // Clicking the header logo/title always jumps back to the Allocation
        // Grid, matching the conventional "logo = home" pattern.
        const headerLogoLink = document.getElementById("header-logo-link");
        if (headerLogoLink) {
            headerLogoLink.addEventListener("click", () => {
                if (!isSectionAccessible("matrix-section")) return;
                navigateToSection("matrix-section");
                history.pushState({ section: "matrix-section" }, "", `#${sectionIdToSlug("matrix-section")}`);
                closeMobileMenu();
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
                closeMobileMenu();
            });
        });

        // Mobile hamburger toggle: shows/hides the Planning Version/Language/
        // Theme/user controls + nav list, which are collapsed by default on
        // narrow screens so the header doesn't dominate the viewport.
        const btnMobileMenuToggle = document.getElementById("btn-mobile-menu-toggle");
        function closeMobileMenu() {
            document.body.classList.remove("mobile-nav-open");
            if (btnMobileMenuToggle) {
                btnMobileMenuToggle.setAttribute("aria-expanded", "false");
                btnMobileMenuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
            }
        }
        if (btnMobileMenuToggle) {
            btnMobileMenuToggle.addEventListener("click", () => {
                const isOpen = document.body.classList.toggle("mobile-nav-open");
                btnMobileMenuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
                btnMobileMenuToggle.innerHTML = isOpen
                    ? '<i class="fa-solid fa-xmark"></i>'
                    : '<i class="fa-solid fa-bars"></i>';
            });
        }

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

        // openAddEmployeeModal / openAddTopicModal moved to modals.js (initModals()).

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

        // Scenario Creation launches - the header's Clone/New/Delete/Backup/
        // Restore buttons were removed (duplicated the per-row actions on
        // the Planning Version Management page); "New Version" now lives
        // only there (#btn-pv-create), reusing this same modal/form. Clone
        // and Delete are handled entirely by the pv-clone/pv-delete row
        // actions in renderPvScenarioTable (scenarios.js), so those two
        // button-click-to-open handlers and the clone modal's submit
        // handler were removed rather than left as dead code.
        const btnPvCreate = document.getElementById("btn-pv-create");
        if (btnPvCreate) {
            btnPvCreate.addEventListener("click", () => {
                formCreateScenario.reset();
                document.getElementById("modal-scenario").classList.add("active");
            });
        }

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
                    renderPvScenarioTable();
                }
            } catch (err) {
                console.error("Error creating scenario:", err);
            }
        });

        // Bulk sandbox cleanup: sandbox scenarios are identified the same
        // way isSandboxScenario() does elsewhere (description mentions
        // "simulation sandbox"), so this reuses the same single-scenario
        // DELETE endpoint the per-row pv-delete action already uses,
        // just looped over every sandbox instead of adding a new
        // bulk-delete backend endpoint for one button.
        const btnPvCleanupSandboxes = document.getElementById("btn-pv-cleanup-sandboxes");
        if (btnPvCleanupSandboxes) {
            btnPvCleanupSandboxes.addEventListener("click", async () => {
                const sandboxes = scenarios.filter(s => isSandboxScenario(s) && !s.is_active);
                if (sandboxes.length === 0) {
                    alert("No leftover simulation sandboxes to clean up.");
                    return;
                }
                if (!confirm(`Delete ${sandboxes.length} leftover simulation sandbox${sandboxes.length === 1 ? "" : "es"}? This cannot be undone.`)) {
                    return;
                }
                try {
                    await Promise.all(sandboxes.map(s => fetch(`/api/scenarios/${s.id}`, { method: "DELETE" })));
                    await fetchScenarios();
                    await fetchActiveScenario();
                    renderPvScenarioTable();
                    alert(`Removed ${sandboxes.length} sandbox scenario${sandboxes.length === 1 ? "" : "s"}.`);
                } catch (err) {
                    console.error("Error cleaning up sandboxes:", err);
                    alert("Connection error while cleaning up sandboxes.");
                }
            });
        }

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

    window.setAppTheme = function(themeName) {
        document.body.classList.remove("theme-glass", "theme-light", "theme-dark", "theme-high-contrast");
        if (themeName !== "theme-glass") {
            document.body.classList.add(themeName);
        }
    }

    window.setPdfPrintTheme = function(themeClass) {
        document.body.classList.remove("print-theme-light", "print-theme-dark");
        document.body.classList.add(themeClass);
    }

    // Launch Application Init
    init();
});
