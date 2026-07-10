// Component: scenarios
import { state } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initScenarios() {
window.fetchScenarios = async function() {
        try {
            const ts = Date.now();
            const response = await fetch(`/api/scenarios?_ts=${ts}`);
            scenarios = await response.json();
            populateScenarioDropdown();
        } catch (error) {
            console.error("Error fetching scenarios:", error);
        }
    }

window.fetchActiveScenario = async function() {
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

window.fetchAndRenderPvLog = async function() {
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

window.isSandboxScenario = function(scenario) {
        return !!(scenario.description && scenario.description.toLowerCase().includes("simulation sandbox"));
    }

window.renderPlanningVersionTab = async function() {
        renderPvScenarioTable();
        await fetchAndRenderPvLog();
    }

    window.populateScenarioDropdown = function() {
        scenarioSelect.innerHTML = "";
        scenarios.forEach(scen => {
            const opt = document.createElement("option");
            opt.value = scen.id;
            opt.innerText = scen.name + (scen.is_active ? " (Active)" : "");
            scenarioSelect.appendChild(opt);
        });
    }

    const PV_LOG_ACTIONS = ["Switch Active Scenario", "Clone Scenario", "Create Scenario", "Delete Scenario"];

    window.renderPvScenarioTable = function() {
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

    window.fetchSimData = async function() {
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

    window.renderSimulationTab = function() {
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
            ? '<i class="fa-solid fa-rotate"></i> Create a New Simulation'
            : '<i class="fa-solid fa-play"></i> Create Simulation';
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

    window.simUpsertAllocation = async function(employeeId, topicId, percentage) {
        const clamped = Math.max(0, Math.min(100, percentage));
        await fetch("/api/allocations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_id: parseInt(employeeId), topic_id: parseInt(topicId), percentage: clamped })
        });
    }

    window.simApplyAsActive = async function(scenarioId, scenarioName) {
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

    // Compare Scenarios trigger - pre-existing HTML/CSS for this whole section
    // (the "Compare Scenarios" card, #sim-compare-a/#sim-compare-b selects,
    // renderScenarioComparison, buildSimVerdict) was already built, but the
    // button itself had no click listener anywhere, so clicking it silently
    // did nothing. Fetches both scenarios' dashboard reports and per-employee
    // data, computes the deltas, and renders the comparison.
    const btnSimCompare = document.getElementById("btn-sim-compare");
    if (btnSimCompare) {
        btnSimCompare.addEventListener("click", async () => {
            const idA = parseInt(document.getElementById("sim-compare-a").value, 10);
            const idB = parseInt(document.getElementById("sim-compare-b").value, 10);
            if (!idA || !idB) return;
            if (idA === idB) {
                alert("Choose two different planning versions to compare.");
                return;
            }
            const originalHTML = btnSimCompare.innerHTML;
            btnSimCompare.disabled = true;
            btnSimCompare.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Comparing...';
            try {
                const [reportA, reportB, empsA, allocsA, empsB, allocsB] = await Promise.all([
                    fetch(`/api/reports/dashboard/${idA}`).then(r => r.json()),
                    fetch(`/api/reports/dashboard/${idB}`).then(r => r.json()),
                    fetch(`/api/scenarios/${idA}/employees`).then(r => r.json()),
                    fetch(`/api/scenarios/${idA}/allocations`).then(r => r.json()),
                    fetch(`/api/scenarios/${idB}/employees`).then(r => r.json()),
                    fetch(`/api/scenarios/${idB}/allocations`).then(r => r.json())
                ]);
                const employeeDeltas = computeEmployeeDeltas(empsA, allocsA, empsB, allocsB);
                renderScenarioComparison(reportA, reportB, idA, idB, employeeDeltas);
            } catch (err) {
                console.error("Error comparing scenarios:", err);
                document.getElementById("sim-compare-results").innerHTML =
                    '<p style="color: var(--danger-color);">Error loading comparison data.</p>';
            } finally {
                btnSimCompare.disabled = false;
                btnSimCompare.innerHTML = originalHTML;
            }
        });
    }

    window.simAvgUtilization = function(report) {
        if (!report.team_summaries.length) return 0;
        const totalWeighted = report.team_summaries.reduce((sum, t) => sum + (t.average_utilization * t.member_count), 0);
        const totalMembers = report.team_summaries.reduce((sum, t) => sum + t.member_count, 0);
        return totalMembers ? totalWeighted / totalMembers : 0;
    }

    window.computeEmployeeDeltas = function(empsA, allocsA, empsB, allocsB) {
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

    window.buildSimVerdict = function(reference, other) {
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

    window.renderScenarioComparison = function(reportA, reportB, scenarioAId, scenarioBId, employeeDeltas) {
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

    // Split into two purpose-built slides instead of one cramped
    // headline+KPIs+table slide that needed an internal scrollbar: an
    // overview slide (big-number KPI cards, no table) and a dedicated
    // team-detail slide (just the comparison table, given room to breathe).
    window.buildSimComparisonOverviewHTML = function(reportA, reportB) {
        const money = (val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        const utilA = simAvgUtilization(reportA);
        const utilB = simAvgUtilization(reportB);
        const costDelta = reportB.total_annual_planning_cost - reportA.total_annual_planning_cost;
        const overloadedDelta = reportB.overloaded_employees.length - reportA.overloaded_employees.length;
        const costDeltaClass = costDelta > 0 ? "text-danger-delta" : costDelta < 0 ? "text-success-delta" : "";
        const overloadedDeltaClass = overloadedDelta > 0 ? "text-danger-delta" : overloadedDelta < 0 ? "text-success-delta" : "";
        // Reuses the existing pros/cons verdict banner (buildSimVerdict, used
        // by the in-app comparison modal) rather than a new one-line summary -
        // it's already a richer, better-designed component than anything
        // written from scratch here would be.
        const verdictHtml = buildSimVerdict(reportA, reportB);

        return `
            <div class="sim-compare-scenarios-row">
                <span class="sim-compare-scenario-pill sim-compare-baseline">${reportA.scenario_name}</span>
                <i class="fa-solid fa-arrow-right-long"></i>
                <span class="sim-compare-scenario-pill sim-compare-target">${reportB.scenario_name}</span>
            </div>
            ${verdictHtml}
            <div class="sim-compare-kpi-grid">
                <div class="sim-compare-kpi-card">
                    <span class="sim-compare-kpi-label"><i class="fa-solid fa-users"></i> Headcount</span>
                    <span class="sim-compare-kpi-value">${reportA.total_headcount} <i class="fa-solid fa-arrow-right"></i> ${reportB.total_headcount}</span>
                </div>
                <div class="sim-compare-kpi-card">
                    <span class="sim-compare-kpi-label"><i class="fa-solid fa-sack-dollar"></i> Cost Shift</span>
                    <span class="sim-compare-kpi-value ${costDeltaClass}">${costDelta === 0 ? "$0" : `${costDelta > 0 ? "+" : ""}${money(costDelta)}`}</span>
                </div>
                <div class="sim-compare-kpi-card">
                    <span class="sim-compare-kpi-label"><i class="fa-solid fa-gauge-high"></i> Avg Utilization</span>
                    <span class="sim-compare-kpi-value">${utilA.toFixed(1)}% <i class="fa-solid fa-arrow-right"></i> ${utilB.toFixed(1)}%</span>
                </div>
                <div class="sim-compare-kpi-card">
                    <span class="sim-compare-kpi-label"><i class="fa-solid fa-triangle-exclamation"></i> Overloads Shift</span>
                    <span class="sim-compare-kpi-value ${overloadedDeltaClass}">${reportA.overloaded_employees.length} <i class="fa-solid fa-arrow-right"></i> ${reportB.overloaded_employees.length} (${overloadedDelta > 0 ? "+" : ""}${overloadedDelta})</span>
                </div>
            </div>
        `;
    }

    window.buildSimComparisonTableHTML = function(reportA, reportB) {
        const money = (val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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

        return `
            <div class="pres-table-wrapper">
                <table class="pres-table">
                    <thead>
                        <tr><th>Team</th><th>${reportA.scenario_name}</th><th>${reportB.scenario_name}</th><th>Cost Delta (%)</th><th>Avg Util Shift</th></tr>
                    </thead>
                    <tbody>${teamRows || "<tr><td colspan='5'>No teams to compare.</td></tr>"}</tbody>
                </table>
            </div>
        `;
    }

    window.addSimComparisonToDeck = function(reportA, reportB) {
        if (!deckConfig) loadDeckConfig();
        const ts = Date.now();
        deckConfig.push({
            id: `custom_sim_overview_${ts}`,
            included: true,
            isCustom: true,
            overrides: {
                "title-text": `Simulation Comparison: ${reportA.scenario_name} vs ${reportB.scenario_name}`,
                "body-text": buildSimComparisonOverviewHTML(reportA, reportB)
            }
        });
        deckConfig.push({
            id: `custom_sim_table_${ts}`,
            included: true,
            isCustom: true,
            overrides: {
                "title-text": `Simulation Comparison — Team Detail`,
                "body-text": buildSimComparisonTableHTML(reportA, reportB)
            }
        });
        saveDeckConfig();
        renderDeckCustomizeList();
        renderPresentationDeck();
        alert("Comparison added as 2 slides to the Presentation Deck (Overview + Team Detail). Open the Presentation Deck tab to view, reorder, or remove them.");
    }

    window.exportComparisonToCSV = async function(reportA, reportB) {
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

}