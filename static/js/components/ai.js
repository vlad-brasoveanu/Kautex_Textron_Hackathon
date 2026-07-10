// Component: ai
import { state } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initAi() {
window.loadChatHistory = function() {
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

    window.handleAISubmit = async function() {
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

                        // Shared by both the "Apply Filters" action and the
                        // post-apply "Remove These Filters" undo button, so
                        // both agree on exactly what "no filters" means.
                        const resetFiltersToDefault = () => {
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
                        };

                        const goToMatrixAndRerender = () => {
                            renderFiltersPanel();
                            navigateToSection("matrix-section");
                            // Use window.history explicitly - the local
                            // `history` chat-message array (above) shadows
                            // the global History API within this closure.
                            window.history.pushState({ section: "matrix-section" }, "", "#matrix");
                            renderAllocationMatrix();
                        };

                        applyBtn.addEventListener("click", () => {
                            resetFiltersToDefault();

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

                            goToMatrixAndRerender();

                            // Show success text plus an undo option that
                            // reverts exactly this action - previously the
                            // buttons just disappeared, leaving "Reset
                            // Filters" on the Matrix Filters panel as the
                            // only way back, which clears everything rather
                            // than specifically undoing what the chat added.
                            actionDiv.innerHTML = `
                                <span style="color: #10b981; font-size: 11px; font-weight: 500;"><i class="fa-solid fa-circle-check"></i> Filters applied successfully</span>
                                <button class="btn btn-secondary btn-sm remove-applied-filters-btn" style="padding: 4px 10px; font-size: 11px; margin-left: 8px;"><i class="fa-solid fa-filter-circle-xmark"></i> Remove These Filters</button>
                            `;
                            actionDiv.querySelector(".remove-applied-filters-btn").addEventListener("click", () => {
                                resetFiltersToDefault();
                                goToMatrixAndRerender();
                                actionDiv.innerHTML = `<span style="color: #64748b; font-size: 11px; font-weight: 500;"><i class="fa-solid fa-circle-check"></i> Filters removed</span>`;
                                saveChatHistory();
                            });
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

    window.appendChatBubble = function(sender, content, id = null) {
        const div = document.createElement("div");
        div.className = `ai-message ${sender}`;
        if (id) div.id = id;
        div.innerHTML = content;
        aiChatBody.appendChild(div);
        aiChatBody.scrollTop = aiChatBody.scrollHeight;
    }

    window.saveChatHistory = function() {
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

}