// Component: reports
import { state } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initReports() {
    window.uploadCSV = async function(file) {
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

    window.renderColumnMappingConfirmation = function(file, suggestions) {
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

    window.performCSVImport = async function(file, columnMapping) {
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

    window.formatFileSize = function(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    window.fetchAndRenderUploadHistory = async function() {
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

    window.exportMatrixToCSV = async function() {
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

    window.exportMatrixToExcel = async function() {
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

}
