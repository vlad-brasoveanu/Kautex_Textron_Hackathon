// Component: presentation
import { state, DECK_CONFIG_STORAGE_KEY } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initPresentation() {
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
                return pages.map((rows, i) => {
                    const costKey = t => `team-cost-${t.team_name}`;
                    const utilKey = t => `team-util-${t.team_name}`;
                    return {
                        wrapperClass: "",
                        bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text-${i}">${getSlideText(slideId, `title-text-${i}`, `Team Resourcing & Cost Breakdown${pageSuffix(i + 1, pages.length)}`)}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-left" style="flex: 1.15;">
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
                                                    <td style="text-align: right; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-slide-id="${slideId}" data-edit-key="${utilKey(t)}" data-chart-page="${i}">${getSlideText(slideId, utilKey(t), `${(t.average_utilization || 0).toFixed(1)}%`)}</td>
                                                    <td style="text-align: right;">${t.overloaded_count || 0} overloaded</td>
                                                    <td style="text-align: right; font-weight: bold; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-slide-id="${slideId}" data-edit-key="${costKey(t)}" data-chart-page="${i}">${getSlideText(slideId, costKey(t), `$${(t.total_cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</td>
                                                </tr>
                                            `).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="slide-col-right" style="flex: 0.85;">
                                <div class="pres-chart-box" style="padding: 12px; height: 100%; flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 240px; box-sizing: border-box;">
                                    <h4 style="margin-top: 0; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Total Cost by Team</h4>
                                    <div class="canvas-wrap" style="position: relative; flex: 1; width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center;"><canvas id="pres-chart-teams-canvas-${i}" data-slide-id="${slideId}" data-page="${i}"></canvas></div>
                                </div>
                            </div>
                        </div>
                    `
                    };
                });
            },
            postRender: (ctx, parentEl) => {
                const root = parentEl || document;
                root.querySelectorAll('canvas[id^="pres-chart-teams-canvas-"]').forEach(canvas => {
                    const slideId = canvas.getAttribute("data-slide-id");
                    const page = canvas.getAttribute("data-page");
                    const rows = [...(ctx.dashboardData ? (ctx.dashboardData.team_summaries || []) : [])]
                        .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));
                    const pageRows = chunkRows(rows, ROWS_PER_SLIDE)[parseInt(page, 10)] || [];
                    const labels = pageRows.map(t => t.team_name || "");
                    const data = pageRows.map(t => parseMoneyOrPercent(getSlideText(slideId, `team-cost-${t.team_name}`, `${t.total_cost || 0}`)));
                    renderEditableBarChart(canvas, labels, data, "#3b82f6");
                });
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
                return pages.map((rows, i) => {
                    const costKey = r => `emp-cost-${r.name}`;
                    const utilKey = r => `emp-util-${r.name}`;
                    return {
                        wrapperClass: "",
                        bodyHTML: `
                        <div class="slide-title-bar">
                            <h3 contenteditable="true" data-slide-id="${slideId}" data-edit-key="title-text-${i}">${getSlideText(slideId, `title-text-${i}`, `Individual Employee Breakdown${pageSuffix(i + 1, pages.length)}`)}</h3>
                            <span class="confidential-small">CONFIDENTIAL</span>
                        </div>
                        <div class="slide-content-split">
                            <div class="slide-col-left" style="flex: 1.15;">
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
                                                    <td style="text-align: right; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-slide-id="${slideId}" data-edit-key="${utilKey(r)}">${getSlideText(slideId, utilKey(r), `${(r.util || 0).toFixed(1)}%`)}</td>
                                                    <td style="text-align: right; font-weight: bold; outline: none; border-bottom: 1px dashed var(--accent-color); cursor: pointer;" contenteditable="true" class="pres-editable-cell" data-slide-id="${slideId}" data-edit-key="${costKey(r)}">${getSlideText(slideId, costKey(r), `$${(r.cost || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`)}</td>
                                                </tr>
                                            `).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="slide-col-right" style="flex: 0.85;">
                                <div class="pres-chart-box" style="padding: 12px; height: 100%; flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 240px; box-sizing: border-box;">
                                    <h4 style="margin-top: 0; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Total Cost by Employee</h4>
                                    <div class="canvas-wrap" style="position: relative; flex: 1; width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center;"><canvas id="pres-chart-employees-canvas-${i}" data-slide-id="${slideId}" data-page="${i}"></canvas></div>
                                </div>
                            </div>
                        </div>
                    `
                    };
                });
            },
            postRender: (ctx, parentEl) => {
                const root = parentEl || document;
                root.querySelectorAll('canvas[id^="pres-chart-employees-canvas-"]').forEach(canvas => {
                    const slideId = canvas.getAttribute("data-slide-id");
                    const page = canvas.getAttribute("data-page");
                    const sorted = (ctx.employees || []).map(emp => {
                        const util = (ctx.allocations || []).filter(a => a.employee_id === emp.id).reduce((acc, a) => acc + a.percentage, 0.0);
                        const cost = emp.available_hours * emp.hourly_rate * (util / 100.0);
                        return { name: emp.name, cost };
                    }).sort((a, b) => b.cost - a.cost);
                    const pageRows = chunkRows(sorted, ROWS_PER_SLIDE)[parseInt(page, 10)] || [];
                    const labels = pageRows.map(r => r.name || "");
                    const data = pageRows.map(r => parseMoneyOrPercent(getSlideText(slideId, `emp-cost-${r.name}`, `${r.cost || 0}`)));
                    renderEditableBarChart(canvas, labels, data, "#f59e0b");
                });
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


    window.slideFooterHTML = function(idx, total) {
        return `<div class="slide-footer"><span>Textron Inc. Planning Platform</span><span class="slide-number">Slide ${idx} of ${total}</span></div>`;
    }

    window.csvCell = function(value) {
        const str = String(value ?? "");
        return `"${str.replace(/"/g, '""')}"`;
    }

    window.chunkRows = function(rows, size) {
        if (rows.length === 0) return [[]];
        const chunks = [];
        for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
        return chunks;
    }

    window.pageSuffix = function(pageNum, pageCount) {
        return pageCount > 1 ? ` (Page ${pageNum} of ${pageCount})` : "";
    }

    // Strips $ , % from an editable table cell's current text (which may be
    // the original computed value or a user-typed override saved via
    // handleSlideEdit) so table-driving charts can plot whatever the cell
    // actually displays right now.
    window.parseMoneyOrPercent = function(str) {
        const cleaned = String(str ?? "").replace(/[$,%]/g, "").trim();
        const n = parseFloat(cleaned);
        return isNaN(n) ? 0 : n;
    }

    // Shared bar-chart renderer for the editable-table slides (teams,
    // employees): destroys any prior Chart.js instance bound to this
    // canvas first, since re-render replaces the deck's HTML wholesale.
    window.renderEditableBarChart = function(canvas, labels, data, color) {
        if (!canvas || typeof Chart === "undefined") return;
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        const isLight = canvas.closest("#presentation-overlay")
            ? canvas.closest("#presentation-overlay").classList.contains("theme-light-presentation")
            : document.body.classList.contains("theme-light");
        const textColor = isLight ? "#0f172a" : "#e2e8f0";
        new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: { labels, datasets: [{ label: "Value", data, backgroundColor: color, borderWidth: 1 }] },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: textColor, font: { family: "Outfit", size: 9 } }, grid: { color: "rgba(255, 255, 255, 0.08)" } },
                    y: { ticks: { color: textColor, font: { family: "Outfit", size: 9 } }, grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    window.getDefaultDeckConfig = function() {
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

    window.getSlideText = function(slideId, key, defaultValue) {
        const configItem = deckConfig ? deckConfig.find(item => item.id === slideId) : null;
        if (configItem && configItem.overrides && configItem.overrides[key] !== undefined) {
            return configItem.overrides[key];
        }
        return defaultValue;
    }

    window.loadDeckConfig = function() {
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

    window.saveDeckConfig = function() {
        try {
            localStorage.setItem(DECK_CONFIG_STORAGE_KEY, JSON.stringify(deckConfig));
        } catch (e) {
            console.warn("Failed to save deck config to localStorage:", e);
        }
    }

    window.computeInteractiveDashboardData = function(filteredEmps, filteredAllocs) {
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

    window.renderExclusionBadges = function() {
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

    window.saveExclusions = function() {
        try {
            localStorage.setItem("pres-excluded-locations", JSON.stringify(Array.from(excludedFilters.locations)));
            localStorage.setItem("pres-excluded-depts", JSON.stringify(Array.from(excludedFilters.departments)));
        } catch (e) {}
    }

    window.loadExclusions = function() {
        try {
            const locs = localStorage.getItem("pres-excluded-locations");
            const depts = localStorage.getItem("pres-excluded-depts");
            if (locs) excludedFilters.locations = new Set(JSON.parse(locs));
            if (depts) excludedFilters.departments = new Set(JSON.parse(depts));
        } catch (e) {}
    }

    window.recomputeAndRefreshPresentation = function() {
        renderPresentationDeck();
        const overlay = document.getElementById("presentation-overlay");
        if (overlay && overlay.classList.contains("active")) {
            rebuildPhysicalSlides();
            renderPresentationOverlaySlide();
        }
    }

    window.buildDeckContext = function() {
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

    window.getCustomSlideHTML = function(cfg, ctx) {
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

    window.rebuildPhysicalSlides = function() {
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

    window.enterPresentationMode = function() {
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

    window.exitPresentationMode = function() {
        const overlay = document.getElementById("presentation-overlay");
        overlay.classList.remove("active");
        document.body.style.overflow = ""; // restore background scrolling
    }

    window.renderPresentationOverlaySlide = function() {
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

    window.prevPresSlide = function() {
        if (currentPresSlideIndex > 0) {
            currentPresSlideIndex--;
            renderPresentationOverlaySlide();
        }
    }

    window.nextPresSlide = function() {
        if (currentPresSlideIndex < activePhysicalSlides.length - 1) {
            currentPresSlideIndex++;
            renderPresentationOverlaySlide();
        }
    }

    window.renderPresentationDeck = function() {
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

    window.renderDeckCustomizeList = function() {
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

                // If presentation overlay is open, synchronize slide changes, else update dashboard presentation tab view.
                // rebuildPhysicalSlides() must run first here: activePhysicalSlides caches each
                // slide's bodyHTML as a plain string from the last time presentation mode was
                // entered, so re-rendering from that stale cache without rebuilding it first
                // would silently revert this exact edit (and any chart driven by it) back to
                // its pre-edit value.
                const overlay = document.getElementById("presentation-overlay");
                if (overlay && overlay.classList.contains("active")) {
                    rebuildPhysicalSlides();
                    renderPresentationOverlaySlide();
                } else {
                    renderPresentationDeck();
                }
            }
        }
    };

    document.getElementById("presentation-deck-container").addEventListener("focusout", handleSlideEdit);
    document.getElementById("presentation-slide-viewport").addEventListener("focusout", handleSlideEdit);

    window.exportPresentationReportToCSV = async function() {
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

}
