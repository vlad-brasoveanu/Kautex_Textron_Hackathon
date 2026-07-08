/* ==========================================================
   DIGITAL ENGINEERING PLANNING DASHBOARD - LOGIC ENGINE
   FastAPI integration, Matrix Grid Renderer, and Local AI Chat
   ========================================================== */

// Global Fetch Interceptor for Authentication Headers
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
    if (!options.headers) {
        options.headers = {};
    }
    const token = localStorage.getItem("token");
    if (token && !url.includes("/api/auth/login")) {
        options.headers["Authorization"] = `Bearer ${token}`;
    }
    if (options.body && typeof options.body === "string" && !options.headers["Content-Type"]) {
        options.headers["Content-Type"] = "application/json";
    }
    
    const response = await originalFetch(url, options);
    if (response.status === 401 && !url.includes("/api/auth/login")) {
        // Unauthorized or expired session, force logout
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        localStorage.removeItem("username");
        document.body.classList.remove("authenticated");
        window.location.reload();
        throw new Error("Session expired or invalid. Redirecting to sign in.");
    }
    return response;
};

document.addEventListener("DOMContentLoaded", () => {
    // State management variables
    let activeScenario = null;
    let scenarios = [];
    let employees = [];
    let topics = [];
    let allocations = [];
    let dashboardData = null;
    
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
        maxRate: 999999
    };

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
    const userDisplayName = document.getElementById("user-display-name");
    const loginOverlay = document.getElementById("login-overlay");
    const loginErrorAlert = document.getElementById("login-error-alert");
    
    const navItems = document.querySelectorAll(".nav-item");
    const mainSections = document.querySelectorAll(".main-section");
    
    const filterLocation = document.getElementById("filter-location");
    const filterTeam = document.getElementById("filter-team");
    const filterDept = document.getElementById("filter-dept");
    const filterCategory = document.getElementById("filter-category");
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
    
    async function init() {
        setupEventListeners();

        // Check session
        const token = localStorage.getItem("token");
        const role = localStorage.getItem("role");
        const username = localStorage.getItem("username");
        const name = localStorage.getItem("name") || username;

        if (token && role && username) {
            activeRole = role;
            document.body.classList.add("authenticated");
            userDisplayName.innerHTML = `<i class="fa-solid fa-user-circle" style="color: var(--primary-color);"></i> ${name}`;
            await fetchScenarios();
            await fetchActiveScenario();
            await refreshAllData();
        } else {
            document.body.classList.remove("authenticated");
        }
        updateSidebarFiltersVisibility();
    }

    function logout() {
        localStorage.removeItem("token");
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
            const response = await fetch("/api/scenarios");
            scenarios = await response.json();
            populateScenarioDropdown();
        } catch (error) {
            console.error("Error fetching scenarios:", error);
        }
    }

    async function fetchActiveScenario() {
        try {
            const response = await fetch("/api/scenarios/active");
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
        try {
            // Parallel fetches
            const [empRes, topRes, allocRes, reportRes] = await Promise.all([
                fetch("/api/employees"),
                fetch("/api/topics"),
                fetch("/api/allocations"),
                fetch("/api/reports/dashboard")
            ]);
            
            employees = await empRes.json();
            topics = await topRes.json();
            allocations = await allocRes.json();
            dashboardData = await reportRes.json();
            
            updateFilterDropdowns();
            renderAllocationMatrix();
            renderDashboards();
            renderPresentationDeck();
            renderCRUDTables();
            await fetchAIPredictions();
        } catch (error) {
            console.error("Error refreshing planning data:", error);
        } finally {
            hideLoader();
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
    
    function renderAllocationMatrix() {
        const container = document.getElementById("allocation-matrix-container");
        container.innerHTML = "";
        
        // 1. Apply Filters to local variables
        const filteredEmployees = employees.filter(emp => {
            if (filters.location && emp.location !== filters.location) return false;
            if (filters.team && emp.team !== filters.team) return false;
            if (filters.department && emp.department !== filters.department) return false;
            if (filters.minRate !== undefined && emp.hourly_rate < filters.minRate) return false;
            if (filters.maxRate !== undefined && emp.hourly_rate > filters.maxRate) return false;
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
        filteredTopics.forEach(t => {
            topicStaffCosts[t.id] = 0.0;
            filteredEmployees.forEach(emp => {
                const key = `${emp.id}_${t.id}`;
                const pct = allocMap[key] ? allocMap[key].percentage : 0.0;
                if (pct > 0.0) {
                    topicStaffCosts[t.id] += emp.available_hours * emp.hourly_rate * (pct / 100.0);
                }
            });
        });

        // Master admin and admin have full control over the matrix: every cell is
        // editable, and rows/columns can be added or removed directly from the grid.
        const canEditGrid = activeRole === "admin" || activeRole === "master_admin";

        // Create table elements
        const table = document.createElement("table");
        table.className = "matrix-table";

        // --- HEADERS ---
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");

        // Metadata headers
        const thEmp = document.createElement("th");
        thEmp.className = "sticky-col";
        thEmp.innerText = "Employee";
        headerRow.appendChild(thEmp);

        const thTeam = document.createElement("th");
        thTeam.innerText = "Team";
        headerRow.appendChild(thTeam);

        const thLoc = document.createElement("th");
        thLoc.innerText = "Location";
        headerRow.appendChild(thLoc);

        const thHours = document.createElement("th");
        thHours.innerText = "Hours/Yr";
        headerRow.appendChild(thHours);

        const thRate = document.createElement("th");
        thRate.innerText = "Rate ($)";
        headerRow.appendChild(thRate);

        // Topic column headers - double-click to edit the topic, or remove the
        // column entirely with the small close icon (admin/master admin only).
        filteredTopics.forEach(topic => {
            const thTopic = document.createElement("th");
            thTopic.innerHTML = `${topic.name}<br><small style='font-weight:normal;color:#9ca3af;'>${topic.category}</small>`;
            if (canEditGrid) {
                thTopic.title = "Double-click to edit this column";
                thTopic.style.cursor = "pointer";
                thTopic.addEventListener("dblclick", () => editTopicPrompt(topic.id));

                const removeBtn = document.createElement("i");
                removeBtn.className = "fa-solid fa-circle-xmark matrix-col-remove";
                removeBtn.title = "Remove this column (topic)";
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    deleteTopicPrompt(topic.id);
                });
                thTopic.appendChild(removeBtn);
            }
            headerRow.appendChild(thTopic);
        });

        // Total Column Header
        const thTotal = document.createElement("th");
        thTotal.innerText = "Total Util %";
        headerRow.appendChild(thTotal);

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // --- BODY ROWS (EMPLOYEES) ---
        const tbody = document.createElement("tbody");
        
        filteredEmployees.forEach(emp => {
            const tr = document.createElement("tr");

            // Meta cells
            const tdName = document.createElement("td");
            tdName.className = "sticky-col";
            
            const nameText = document.createElement("span");
            nameText.innerText = emp.name;
            tdName.appendChild(nameText);
            
            const totalAlloc = empAllocSums[emp.id] || 0.0;
            if (totalAlloc > 100.0) {
                tdName.classList.add("matrix-overloaded-name");
                
                const warningIcon = document.createElement("i");
                warningIcon.className = "fa-solid fa-triangle-exclamation matrix-warning-icon";
                warningIcon.title = `Overloaded! Total allocation is ${totalAlloc.toFixed(1)}%`;
                warningIcon.style.color = "var(--danger-color)";
                warningIcon.style.marginLeft = "6px";
                tdName.appendChild(warningIcon);
                
                tr.classList.add("tr-overloaded");
            }
            
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
                    icon.title = comment;
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
        
        // 1. Employee Internal Cost Row
        const trEmpCost = document.createElement("tr");
        trEmpCost.className = "matrix-cost-row";
        
        const tdECLabel = document.createElement("td");
        tdECLabel.className = "sticky-col matrix-cost-title";
        tdECLabel.innerText = "Employee Cost";
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
        tdICLabel.innerText = "Additional Internal Cost";
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
        tdEXCLabel.innerText = "External Cost";
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
        tdRecLabel.innerText = "Recovery";
        trRecovery.appendChild(tdRecLabel);
        for(let i=0; i<4; i++) trRecovery.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            tdVal.innerText = t.recovery > 0 ? `-$${t.recovery.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "-";
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
        tdTTL.innerText = "Total Topic Cost";
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
        document.getElementById("kpi-recovery").innerText = `-$${dashboardData.total_recovery_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
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

        // Populate breakdowns selectors
        populateDashboardSelects();
        renderTopicDashboard();
        renderTeamDashboard();
        renderEmployeeDashboard();
        renderTeamOverviewTable();
        renderEmployeeOverviewTable();
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
                    <h4>About Project</h4>
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
                    <p><strong>Cost Recovery:</strong> -$${summary.recovery.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
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
                    <h4>Team Overview</h4>
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
                    <h4>Profile Information</h4>
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
            buildPages: (ctx) => [{
                wrapperClass: "slide-title",
                bodyHTML: `
                    <div class="slide-header-brand"><i class="fa-solid fa-layer-group"></i> Textron Digital Engineering</div>
                    <div class="slide-body-center">
                        <h2>Engineering Planning & Budget Report</h2>
                        <p>${ctx.activeScenario ? ctx.activeScenario.name : "Planning Version"}</p>
                        <div class="slide-subtitle-divider"></div>
                        <span class="confidential-stamp">STRICTLY CONFIDENTIAL</span>
                    </div>
                `
            }],
            csv: null
        },
        executive: {
            label: "Executive Summary",
            desc: "Headcount, cost KPIs, and cost-by-location chart.",
            buildPages: (ctx) => {
                const d = ctx.dashboardData;
                return [{
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar"><h3>Executive Planning Overview</h3><span class="confidential-small">CONFIDENTIAL</span></div>
                        <div class="slide-content-split">
                            <div class="slide-col-left">
                                <div class="pres-kpi-grid">
                                    <div class="pres-kpi-item"><span class="pres-kpi-label">Headcount</span><span class="pres-kpi-number">${d.total_headcount}</span></div>
                                    <div class="pres-kpi-item"><span class="pres-kpi-label">Internal Effort Cost</span><span class="pres-kpi-number">$${d.total_internal_employee_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                                    <div class="pres-kpi-item"><span class="pres-kpi-label">Additional & Vendor Cost</span><span class="pres-kpi-number">$${(d.total_additional_internal_cost + d.total_external_cost).toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                                    <div class="pres-kpi-item"><span class="pres-kpi-label">Net Fiscal Budget</span><span class="pres-kpi-number text-blue">$${d.total_annual_planning_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                                </div>
                            </div>
                            <div class="slide-col-right">
                                <div class="pres-chart-box">
                                    <h4>Annual Planning Cost by Location</h4>
                                    <div class="canvas-wrap"><canvas id="pres-chart-location-canvas"></canvas></div>
                                </div>
                            </div>
                        </div>
                    `
                }];
            },
            postRender: (ctx) => {
                const canvas = document.getElementById("pres-chart-location-canvas");
                if (!canvas) return;
                if (presLocationChart) presLocationChart.destroy();
                const labels = Object.keys(ctx.dashboardData.cost_by_location);
                const data = Object.values(ctx.dashboardData.cost_by_location);
                presLocationChart = new Chart(canvas.getContext("2d"), {
                    type: "doughnut",
                    data: {
                        labels: labels,
                        datasets: [{ data: data, backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"], borderWidth: 1 }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: "right", labels: { color: document.body.classList.contains("theme-light") ? "#0f172a" : "#e2e8f0", font: { family: "Outfit", size: 10 } } } }
                    }
                });
            },
            csv: (ctx) => {
                const d = ctx.dashboardData;
                const lines = [
                    "=== Executive Summary ===",
                    "Metric,Value",
                    `${csvCell("Headcount")},${d.total_headcount}`,
                    `${csvCell("Internal Effort Cost")},${d.total_internal_employee_cost}`,
                    `${csvCell("Additional & Vendor Cost")},${d.total_additional_internal_cost + d.total_external_cost}`,
                    `${csvCell("Cost Recovery")},${-d.total_recovery_cost}`,
                    `${csvCell("Net Fiscal Budget")},${d.total_annual_planning_cost}`
                ];
                return lines.join("\n");
            }
        },
        topics: {
            label: "Key Initiatives Budget",
            desc: "Per-topic cost breakdown table.",
            buildPages: (ctx) => {
                const pages = chunkRows(ctx.dashboardData.topic_summaries, ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar"><h3>Key Strategic Initiatives Budget${pageSuffix(i + 1, pages.length)}</h3><span class="confidential-small">CONFIDENTIAL</span></div>
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead><tr><th>Initiative / Topic</th><th>Category</th><th>Category Cost</th><th>Involved Staff</th><th>Total Cost</th></tr></thead>
                                        <tbody>
                                            ${rows.map(t => `
                                                <tr>
                                                    <td><strong>${t.name}</strong></td>
                                                    <td>${t.category}</td>
                                                    <td>$${(t.additional_internal_cost + t.external_cost).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                    <td>${t.staff.length} Planned</td>
                                                    <td><strong>$${t.total_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</strong></td>
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
                ctx.dashboardData.topic_summaries.forEach(t => {
                    lines.push(`${csvCell(t.name)},${csvCell(t.category)},${t.additional_internal_cost + t.external_cost},${t.staff.length},${t.total_cost}`);
                });
                return lines.join("\n");
            }
        },
        risks: {
            label: "Resource Allocations & Risks",
            desc: "Overloaded employees and strategic notes.",
            buildPages: (ctx) => {
                const pages = chunkRows(ctx.dashboardData.overloaded_employees, ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar"><h3>Resource Allocations & Overload Alerts${pageSuffix(i + 1, pages.length)}</h3><span class="confidential-small">CONFIDENTIAL</span></div>
                        <div class="slide-content-split">
                            <div class="slide-col-left">
                                <h4 class="risk-title"><i class="fa-solid fa-triangle-exclamation"></i> Overloaded Resources (>100% Allocation)</h4>
                                <ul class="risk-list">
                                    ${rows.map(emp => `
                                        <li><i class="fa-solid fa-triangle-exclamation"></i> <strong>${emp.name}</strong> (${emp.team}) planned utilization is at <strong>${emp.utilization.toFixed(1)}%</strong>. Immediate risk of burnout/project delay.</li>
                                    `).join("") || "<li><i class='fa-solid fa-circle-check text-green'></i> No overloaded planning risks detected in this scenario.</li>"}
                                </ul>
                            </div>
                            <div class="slide-col-right">
                                <h4 class="risk-title"><i class="fa-solid fa-list-check"></i> Management Comments & Strategic Notes</h4>
                                <div class="pres-notes-box">
                                    <p><strong>Planning Version Summary:</strong> Initial draft of resources for engineering hubs. High effort is currently allocated on the Agentic AI prototype development which has an external funding recovery mapped. Key project delivery for Customer Requests (Fuel) requires resource reallocations to cover India testing overload risk.</p>
                                </div>
                            </div>
                        </div>
                    `
                }));
            },
            csv: (ctx) => {
                const lines = ["=== Resource Allocations & Overload Alerts ===", "Employee,Team,Utilization %"];
                ctx.dashboardData.overloaded_employees.forEach(emp => {
                    lines.push(`${csvCell(emp.name)},${csvCell(emp.team)},${emp.utilization.toFixed(1)}`);
                });
                if (ctx.dashboardData.overloaded_employees.length === 0) lines.push("No overloaded planning risks detected in this scenario.");
                return lines.join("\n");
            }
        },
        ai: {
            label: "AI Portfolio Predictions",
            desc: "AI-driven bottleneck predictions and optimization suggestions.",
            buildPages: (ctx) => {
                const data = ctx.aiPredictionsData || { bottlenecks: [], cost_optimizations: [], reallocations: [] };
                const suggestions = [...data.cost_optimizations, ...data.reallocations].slice(0, 3);
                const pages = chunkRows(data.bottlenecks, ROWS_PER_SLIDE);

                return pages.map((rows, i) => {
                    const isFirst = i === 0;
                    const bottleneckList = `
                        <ul class="risk-list">
                            ${rows.map(b => `
                                <li style="padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.04); border-left: 3px solid ${b.severity === 'High' ? 'var(--danger-color)' : 'var(--warning-color)'}; margin-bottom: 6px; font-size: 11px;">
                                    <strong>[${b.type}]</strong> ${b.description}
                                </li>
                            `).join("")}
                        </ul>
                    `;
                    // Suggestions only appear once, alongside the first page of bottlenecks;
                    // continuation pages are a full-width bottleneck list.
                    const body = isFirst ? `
                        <div class="slide-content-split">
                            <div class="slide-col-left">
                                <h4 class="risk-title" style="color: var(--accent-color); font-size: 13px;"><i class="fa-solid fa-brain"></i> Predicted Resource Bottlenecks</h4>
                                ${bottleneckList}
                            </div>
                            <div class="slide-col-right">
                                <h4 class="risk-title" style="color: var(--warning-color); font-size: 13px;"><i class="fa-solid fa-chart-line"></i> Strategic Optimization Suggestions</h4>
                                <ul class="risk-list" style="gap: 6px;">
                                    ${suggestions.map(s => `
                                        <li style="padding: 8px 12px; border-radius: 6px; background: rgba(59, 130, 246, 0.04); border-left: 3px solid var(--primary-color); margin-bottom: 6px; font-size: 11px;">
                                            <strong>[${s.category || s.action}]</strong> ${s.description}
                                        </li>
                                    `).join("")}
                                </ul>
                            </div>
                        </div>
                    ` : `
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <h4 class="risk-title" style="color: var(--accent-color); font-size: 13px;"><i class="fa-solid fa-brain"></i> Predicted Resource Bottlenecks (continued)</h4>
                                ${bottleneckList}
                            </div>
                        </div>
                    `;
                    return {
                        wrapperClass: "",
                        bodyHTML: `
                            <div class="slide-title-bar"><h3>AI-Driven Portfolio Predictions & Suggestions${pageSuffix(i + 1, pages.length)}</h3><span class="confidential-small">CONFIDENTIAL</span></div>
                            ${body}
                        `
                    };
                });
            },
            csv: (ctx) => {
                const data = ctx.aiPredictionsData || { bottlenecks: [], cost_optimizations: [], reallocations: [] };
                const lines = ["=== AI Portfolio Predictions & Suggestions ===", "Type,Category/Type,Description"];
                data.bottlenecks.forEach(b => lines.push(`Bottleneck,${csvCell(b.type)},${csvCell(b.description)}`));
                [...data.cost_optimizations, ...data.reallocations].slice(0, 3).forEach(s => lines.push(`Suggestion,${csvCell(s.category || s.action)},${csvCell(s.description)}`));
                return lines.join("\n");
            }
        },
        teams: {
            label: "Team Breakdown",
            desc: "Aggregate team-level staffing and cost - no individual employee names.",
            buildPages: (ctx) => {
                const sorted = [...ctx.dashboardData.team_summaries].sort((a, b) => b.total_cost - a.total_cost);
                const pages = chunkRows(sorted, ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar"><h3>Team Resourcing & Cost Breakdown${pageSuffix(i + 1, pages.length)}</h3><span class="confidential-small">CONFIDENTIAL</span></div>
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead><tr><th>Team</th><th>Members</th><th>Avg Utilization</th><th>Overloaded</th><th>Total Cost</th></tr></thead>
                                        <tbody>
                                            ${rows.map(t => `
                                                <tr>
                                                    <td><strong>${t.team_name}</strong></td>
                                                    <td>${t.member_count}</td>
                                                    <td>${t.average_utilization.toFixed(1)}%</td>
                                                    <td>${t.overloaded_count}</td>
                                                    <td><strong>$${t.total_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</strong></td>
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
                [...ctx.dashboardData.team_summaries].sort((a, b) => b.total_cost - a.total_cost).forEach(t => {
                    lines.push(`${csvCell(t.team_name)},${t.member_count},${t.average_utilization.toFixed(1)},${t.overloaded_count},${t.total_cost}`);
                });
                return lines.join("\n");
            }
        },
        employees: {
            label: "Employee Breakdown",
            desc: "Individual employee names, utilization, and cost. Omit this slide to keep the report team-level only.",
            buildPages: (ctx) => {
                const sorted = ctx.employees.map(emp => {
                    const util = ctx.allocations.filter(a => a.employee_id === emp.id).reduce((acc, a) => acc + a.percentage, 0.0);
                    const cost = emp.available_hours * emp.hourly_rate * (util / 100.0);
                    return { name: emp.name, team: emp.team, location: emp.location, util, cost };
                }).sort((a, b) => b.cost - a.cost);
                const pages = chunkRows(sorted, ROWS_PER_SLIDE);
                return pages.map((rows, i) => ({
                    wrapperClass: "",
                    bodyHTML: `
                        <div class="slide-title-bar"><h3>Individual Employee Breakdown${pageSuffix(i + 1, pages.length)}</h3><span class="confidential-small">CONFIDENTIAL</span></div>
                        <div class="slide-content-split">
                            <div class="slide-col-full">
                                <div class="pres-table-wrapper">
                                    <table class="pres-table">
                                        <thead><tr><th>Employee</th><th>Team</th><th>Location</th><th>Utilization</th><th>Total Cost</th></tr></thead>
                                        <tbody>
                                            ${rows.map(r => `
                                                <tr>
                                                    <td><strong>${r.name}</strong></td>
                                                    <td>${r.team}</td>
                                                    <td>${r.location}</td>
                                                    <td>${r.util.toFixed(1)}%</td>
                                                    <td><strong>$${r.cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</strong></td>
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
                ctx.employees.map(emp => {
                    const util = ctx.allocations.filter(a => a.employee_id === emp.id).reduce((acc, a) => acc + a.percentage, 0.0);
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
            { id: "topics", included: true },
            { id: "risks", included: true },
            { id: "ai", included: true },
            { id: "teams", included: false },
            { id: "employees", included: false }
        ];
    }

    function loadDeckConfig() {
        try {
            const raw = localStorage.getItem(DECK_CONFIG_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const knownIds = Object.keys(SLIDE_TEMPLATES);
                const parsedIds = parsed.map(p => p.id);
                // Only trust the saved config if it exactly matches the current set of
                // known templates - guards against a stale config from a previous
                // version of the app that added/removed template slides.
                if (Array.isArray(parsed) && knownIds.length === parsedIds.length && knownIds.every(id => parsedIds.includes(id))) {
                    deckConfig = parsed;
                    return;
                }
            }
        } catch (e) {
            console.error("Failed to load deck config, resetting to default:", e);
        }
        deckConfig = getDefaultDeckConfig();
    }

    function saveDeckConfig() {
        localStorage.setItem(DECK_CONFIG_STORAGE_KEY, JSON.stringify(deckConfig));
    }

    function buildDeckContext() {
        return { dashboardData, employees, topics, allocations, activeScenario, aiPredictionsData };
    }

    function renderPresentationDeck() {
        if (!dashboardData) return;
        if (!deckConfig) loadDeckConfig();

        const container = document.getElementById("presentation-deck-container");
        if (!container) return;

        const ctx = buildDeckContext();
        const included = deckConfig.filter(c => c.included && SLIDE_TEMPLATES[c.id]);

        // Each template can expand into multiple physical slides (pagination), so
        // flatten everything first - the "Slide X of Y" footer numbers the whole
        // deck, not just one template's own pages.
        const allPages = [];
        included.forEach(cfg => {
            const template = SLIDE_TEMPLATES[cfg.id];
            template.buildPages(ctx).forEach(page => allPages.push(page));
        });

        const total = allPages.length;
        container.innerHTML = allPages.map((page, i) => `
            <div class="presentation-slide ${page.wrapperClass || ""}">
                ${page.bodyHTML}
                ${slideFooterHTML(i + 1, total)}
            </div>
        `).join("");

        included.forEach(cfg => {
            const template = SLIDE_TEMPLATES[cfg.id];
            if (template.postRender) template.postRender(ctx);
        });

        renderDeckCustomizeList();
    }

    function renderDeckCustomizeList() {
        const list = document.getElementById("deck-customize-list");
        if (!list || !deckConfig) return;

        list.innerHTML = deckConfig.map((cfg, i) => {
            const template = SLIDE_TEMPLATES[cfg.id];
            return `
                <li class="deck-customize-item ${cfg.included ? "" : "excluded"}" data-index="${i}">
                    <input type="checkbox" class="deck-customize-checkbox" data-index="${i}" ${cfg.included ? "checked" : ""}>
                    <div class="deck-customize-info">
                        <div class="deck-customize-title">${template.label}</div>
                        <div class="deck-customize-desc">${template.desc}</div>
                    </div>
                    <div class="deck-customize-order-controls">
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
            const token = localStorage.getItem("token");
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
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

    async function fetchAIPredictions() {
        try {
            const response = await fetch("/api/reports/ai-predictions");
            if (response.ok) {
                const predictions = await response.json();
                renderAIPredictions(predictions);
            }
        } catch (err) {
            console.error("Error fetching AI predictions:", err);
        }
    }

    function renderAIPredictions(data) {
        aiPredictionsData = data;

        const bList = document.getElementById("ai-insight-bottlenecks-list");
        const cList = document.getElementById("ai-insight-costs-list");
        const rList = document.getElementById("ai-insight-reallocations-list");
        
        if (bList) {
            bList.innerHTML = data.bottlenecks.map(b => `
                <div class="ai-insight-item">
                    <div class="ai-insight-header">
                        <strong class="ai-insight-label">${b.type}</strong>
                        <span class="badge ${b.severity === 'High' ? 'badge-danger' : b.severity === 'Medium' ? 'badge-warning' : 'badge-success'}" style="font-size:10px; padding:2px 7px;">${b.severity}</span>
                    </div>
                    <p class="ai-insight-desc">${b.description}</p>
                </div>
            `).join("") || "<p class='ai-insight-desc' style='opacity:0.6;'>No bottlenecks predicted.</p>";
        }

        if (cList) {
            cList.innerHTML = data.cost_optimizations.map(c => `
                <div class="ai-insight-item">
                    <div class="ai-insight-header">
                        <strong class="ai-insight-label">${c.category}</strong>
                        <span class="ai-insight-impact">${c.impact}</span>
                    </div>
                    <p class="ai-insight-desc">${c.description}</p>
                </div>
            `).join("") || "<p class='ai-insight-desc' style='opacity:0.6;'>No cost optimizations found.</p>";
        }

        if (rList) {
            rList.innerHTML = data.reallocations.map(r => `
                <div class="ai-insight-item">
                    <div class="ai-insight-header">
                        <strong class="ai-insight-label">${r.action}</strong>
                        <span class="badge ${r.priority === 'High' ? 'badge-danger' : r.priority === 'Medium' ? 'badge-warning' : 'badge-success'}" style="font-size:10px; padding:2px 7px;">${r.priority}</span>
                    </div>
                    <p class="ai-insight-desc">${r.description}</p>
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

        filteredEmps.forEach(emp => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
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

        // Hide/Show action buttons based on Active Role
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
    }

    // ==========================================
    // 6. DETAILED EVENT HANDLERS (CRUD & MODALS)
    // ==========================================
    
    function setupEventListeners() {
        // Logout handler
        if (btnLogout) {
            btnLogout.addEventListener("click", logout);
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
                        localStorage.setItem("token", data.access_token);
                        localStorage.setItem("role", data.role);
                        localStorage.setItem("username", data.username);
                        localStorage.setItem("name", data.name);

                        activeRole = data.role;

                        document.body.classList.add("authenticated");
                        userDisplayName.innerHTML = `<i class="fa-solid fa-user-circle" style="color: var(--primary-color);"></i> ${data.name}`;
                        
                        activeSection = "matrix-section";
                        navItems.forEach(n => n.classList.remove("active"));
                        const defaultNavItem = document.querySelector('[data-target="matrix-section"]');
                        if (defaultNavItem) defaultNavItem.classList.add("active");
                        mainSections.forEach(s => s.classList.remove("active"));
                        const defaultSec = document.getElementById("matrix-section");
                        if (defaultSec) defaultSec.classList.add("active");
                        updateSidebarFiltersVisibility();

                        await fetchScenarios();
                        await fetchActiveScenario();
                        await refreshAllData();
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

        // Sidebar Navigation click swaps
        navItems.forEach(item => {
            item.addEventListener("click", () => {
                navItems.forEach(n => n.classList.remove("active"));
                item.classList.add("active");
                
                activeSection = item.getAttribute("data-target");
                mainSections.forEach(s => s.classList.remove("active"));
                document.getElementById(activeSection).classList.add("active");

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
                }
            });
        });

        // Matrix Filtering event drops
        const triggerFilter = () => {
            filters.location = filterLocation.value;
            filters.team = filterTeam.value;
            filters.department = filterDept.value;
            filters.category = filterCategory.value;
            renderAllocationMatrix();
        };

        filterLocation.addEventListener("change", triggerFilter);
        filterTeam.addEventListener("change", triggerFilter);
        filterDept.addEventListener("change", triggerFilter);
        filterCategory.addEventListener("change", triggerFilter);

        btnResetFilters.addEventListener("click", () => {
            filterLocation.value = "";
            filterTeam.value = "";
            filterDept.value = "";
            filterCategory.value = "";
            filters.minRate = 0;
            filters.maxRate = 999999;
            triggerFilter();
        });

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

        // Presentation Print Deck trigger
        document.getElementById("btn-print-deck").addEventListener("click", async () => {
            try {
                const token = localStorage.getItem("token");
                await fetch("/api/reports/log-export", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
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

        // Refresh Audit Logs trigger
        const btnRefreshLogs = document.getElementById("btn-refresh-logs");
        if (btnRefreshLogs) {
            btnRefreshLogs.addEventListener("click", fetchAndRenderAdminLogs);
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
                    const token = localStorage.getItem("token");
                    const response = await fetch(`/api/scenarios/${activeScenario.id}/backup`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
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
                        
                        const token = localStorage.getItem("token");
                        const response = await fetch(`/api/scenarios/${activeScenario.id}/restore`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${token}`
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
                    const token = localStorage.getItem("token");
                    const response = await fetch("/api/users", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`
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

        // AI Chat Drawer Toggle Actions
        btnToggleAI.addEventListener("click", () => {
            aiDrawer.classList.add("active");
            aiChatInput.focus();
        });

        btnCloseAI.addEventListener("click", () => {
            // Conversation memory only lives as long as the drawer stays open -
            // closing it resets the chat, so warn before discarding an active one.
            const hasConversation = aiChatBody.querySelectorAll(".ai-message.user").length > 0;
            if (hasConversation && !confirm("Are you sure you want to close the conversation? The chat history will be cleared.")) {
                return;
            }
            if (hasConversation) {
                aiChatBody.innerHTML = aiChatWelcomeHTML;
            }
            aiDrawer.classList.remove("active");
        });

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
        statusBox.innerHTML = `<h4><i class="fa-solid fa-spinner fa-spin"></i> Processing file: ${file.name}...</h4>`;
        
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch("/api/import/csv", {
                method: "POST",
                body: formData
            });

            const resData = await response.json();
            if (response.ok && resData.status === "success") {
                statusBox.innerHTML = `
                    <h4 class="text-green"><i class="fa-solid fa-circle-check"></i> Import Successful!</h4>
                    <p>${resData.message}</p>
                    <ul>
                        <li><i class="fa-solid fa-user-plus text-blue"></i> Employees imported: <strong>${resData.imported_employees}</strong></li>
                        <li><i class="fa-solid fa-file-invoice text-blue"></i> Topics imported: <strong>${resData.imported_topics}</strong></li>
                        <li><i class="fa-solid fa-link text-blue"></i> Allocation cells loaded: <strong>${resData.imported_allocations}</strong></li>
                        <li><i class="fa-solid fa-dollar-sign text-blue"></i> Additional costs rows loaded: <strong>${resData.imported_additional_costs}</strong></li>
                    </ul>
                `;
                // Reload matrix planning data
                await refreshAllData();
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
        if (confirm(`Are you sure you want to delete employee '${emp.name}'? This removes all allocation history in active scenario.`)) {
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
        if (confirm(`Are you sure you want to delete topic '${topic.name}'? This deletes all allocation percentages and additional costs associated.`)) {
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
            const token = localStorage.getItem("token");
            const response = await fetch("/api/admin/logs", {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
            if (response.ok) {
                auditLogsCache = await response.json();
                populateAuditLogFilterDropdowns();
                renderAuditLogsTable();
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
            const token = localStorage.getItem("token");
            const response = await fetch("/api/users", {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
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

        const token = localStorage.getItem("token");
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
                deleteBtn = `<button class="btn btn-secondary btn-sm btn-delete-user" data-id="${u.id}" style="color: var(--danger-color); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2);"><i class="fa-solid fa-trash-can"></i> Delete</button>`;
            } else {
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
                <td>${deleteBtn}</td>
            `;
            tbody.appendChild(tr);
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
                            method: "DELETE",
                            headers: {
                                "Authorization": `Bearer ${token}`
                            }
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
        
        const filteredEmployees = employees.filter(emp => {
            if (filters.location && emp.location !== filters.location) return false;
            if (filters.team && emp.team !== filters.team) return false;
            if (filters.department && emp.department !== filters.department) return false;
            if (filters.minRate !== undefined && emp.hourly_rate < filters.minRate) return false;
            if (filters.maxRate !== undefined && emp.hourly_rate > filters.maxRate) return false;
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
            const token = localStorage.getItem("token");
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
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
        
        // Append user bubble
        appendChatBubble("user", text);
        
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
                    
                bubble.innerHTML = formatted;
            }

            if (resData.filters) {
                // Apply the filters to the global filters object
                if (resData.filters.location !== undefined) filters.location = resData.filters.location;
                if (resData.filters.team !== undefined) filters.team = resData.filters.team;
                if (resData.filters.department !== undefined) filters.department = resData.filters.department;
                if (resData.filters.category !== undefined) filters.category = resData.filters.category;
                if (resData.filters.minRate !== undefined) filters.minRate = resData.filters.minRate;
                if (resData.filters.maxRate !== undefined) filters.maxRate = resData.filters.maxRate;
                
                // Update the sidebar dropdown inputs
                if (filterLocation) filterLocation.value = filters.location;
                if (filterTeam) filterTeam.value = filters.team;
                if (filterDept) filterDept.value = filters.department;
                if (filterCategory) filterCategory.value = filters.category;
                
                // Navigate to matrix grid
                activeSection = "matrix-section";
                navItems.forEach(n => n.classList.remove("active"));
                const defaultNavItem = document.querySelector('[data-target="matrix-section"]');
                if (defaultNavItem) defaultNavItem.classList.add("active");
                mainSections.forEach(s => s.classList.remove("active"));
                const defaultSec = document.getElementById("matrix-section");
                if (defaultSec) defaultSec.classList.add("active");
                updateSidebarFiltersVisibility();
                
                // Rerender matrix with the new filters
                renderAllocationMatrix();
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

    // Populate Filters Options based on Seeding Details
    function updateFilterDropdowns() {
        const prevLoc = filterLocation.value;
        const prevTeam = filterTeam.value;
        const prevDept = filterDept.value;
        const prevCat = filterCategory.value;

        // Locations
        const locations = [...new Set(employees.map(e => e.location))];
        filterLocation.innerHTML = "<option value=''>All Locations</option>";
        locations.forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc;
            opt.innerText = loc;
            filterLocation.appendChild(opt);
        });
        filterLocation.value = locations.includes(prevLoc) ? prevLoc : "";

        // Teams
        const teams = [...new Set(employees.map(e => e.team))];
        filterTeam.innerHTML = "<option value=''>All Teams</option>";
        teams.forEach(team => {
            const opt = document.createElement("option");
            opt.value = team;
            opt.innerText = team;
            filterTeam.appendChild(opt);
        });
        filterTeam.value = teams.includes(prevTeam) ? prevTeam : "";

        // Departments
        const depts = [...new Set(employees.map(e => e.department))];
        filterDept.innerHTML = "<option value=''>All Departments</option>";
        depts.forEach(dept => {
            const opt = document.createElement("option");
            opt.value = dept;
            opt.innerText = dept;
            filterDept.appendChild(opt);
        });
        filterDept.value = depts.includes(prevDept) ? prevDept : "";

        // Categories
        const categories = [...new Set(topics.map(t => t.category))];
        filterCategory.innerHTML = "<option value=''>All Categories</option>";
        categories.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.innerText = cat;
            filterCategory.appendChild(opt);
        });
        filterCategory.value = categories.includes(prevCat) ? prevCat : "";
    }

    function updateSidebarFiltersVisibility() {
        const sidebarFilters = document.querySelector(".sidebar-filters");
        if (sidebarFilters) {
            sidebarFilters.style.display = (activeSection === "matrix-section") ? "block" : "none";
        }
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

    // Launch Application Init
    init();
});
