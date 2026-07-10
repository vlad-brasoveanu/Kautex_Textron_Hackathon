// Component: dashboards
import { state } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initDashboards() {
    const EXEC_CONFIG_STORAGE_KEY = "execSummaryWidgetConfig_v1";

    window.renderDashboards = function() {
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

    window.loadExecWidgetConfig = function() {
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

    window.saveExecWidgetConfig = function() {
        try {
            localStorage.setItem(EXEC_CONFIG_STORAGE_KEY, JSON.stringify(execWidgetConfig));
        } catch (e) {
            console.warn("Failed to save exec widget config to localStorage:", e);
        }
    }

    window.applyExecWidgetVisibility = function() {
        if (!execWidgetConfig) loadExecWidgetConfig();
        document.querySelectorAll("#tab-executive [data-widget-id]").forEach(el => {
            const id = el.getAttribute("data-widget-id");
            const visible = execWidgetConfig[id] !== false;
            el.classList.toggle("exec-widget-hidden", !visible);
        });
    }

    window.renderExecCustomizeList = function() {
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

    window.renderLocationChart = function() {
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

    window.renderCategoryChart = function() {
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

    window.renderCompositionChart = function() {
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

    window.renderDepartmentChart = function() {
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

    window.computeUtilizationBuckets = function() {
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

    window.renderUtilizationChart = function() {
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

    window.renderTopCostDriversList = function() {
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

    window.renderUtilizationByGroupList = function(containerId, utilByGroup) {
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

    window.renderExecAlertStrip = function() {
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

    window.renderTeamOverviewTable = function() {
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

    window.renderEmployeeOverviewTable = function() {
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

    window.populateDashboardSelects = function() {
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

    window.renderTopicDashboard = function() {
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

    window.renderTeamDashboard = function() {
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

    window.renderEmployeeDashboard = function() {
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

    window.fetchAIPredictions = async function(requestId) {
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

    window.renderAIInsightsStats = function(data) {
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

    window.renderAIPredictions = function(data) {
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

}
