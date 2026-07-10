// Component: matrix
import { state } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initMatrix() {
window.renderAllocationMatrix = function() {
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

window.renderFiltersPanel = function() {
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

window.renderCRUDTables = function() {
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

window.fetchTrash = async function(requestId) {
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

window.openBulkEditModal = function() {
        if (selectedEmployeeIds.size === 0) return;
        document.getElementById("form-bulk-edit").reset();
        document.querySelectorAll("#form-bulk-edit input, #form-bulk-edit select").forEach(el => {
            if (el.type !== "checkbox") el.disabled = true;
        });
        document.getElementById("bulk-edit-target-desc").textContent =
            `Applying to ${selectedEmployeeIds.size} employee${selectedEmployeeIds.size === 1 ? "" : "s"}. Leave a field blank/unchecked to leave it unchanged.`;
        document.getElementById("modal-bulk-edit").classList.add("active");
    }

    window.updateBulkEditToolbar = function() {
        const toolbar = document.getElementById("bulk-edit-toolbar");
        const countEl = document.getElementById("bulk-edit-count");
        if (!toolbar || !countEl) return;
        const count = selectedEmployeeIds.size;
        countEl.textContent = `${count} selected`;
        toolbar.style.display = (count > 0 && activeRole !== "user") ? "flex" : "none";
    }

    window.renderTrash = function() {
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

    window.editEmployeePrompt = function(id) {
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

    window.deleteEmployeePrompt = async function(id) {
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

    window.editTopicPrompt = function(id) {
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

    window.deleteTopicPrompt = async function(id) {
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

    window.fetchAndRenderAdminLogs = async function() {
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

    window.populateAuditLogFilterDropdowns = function() {
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

    window.renderAuditLogsTable = function() {
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

    window.fetchAndRenderUsers = async function() {
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

    window.populateUserRoleFilterDropdown = function() {
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

    window.renderUsersTable = function() {
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

    window.updateSidebarFiltersVisibility = function() {
        // Sidebar filters moved to Allocation Grid tab; no operations needed here.
    }

}