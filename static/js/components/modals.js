// Component: modals
import { state } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initModals() {
        window.openAddEmployeeModal = function() {
            formEmployee.reset();
            document.getElementById("emp-id").value = "";
            document.getElementById("employee-modal-title").innerText = "Add New Employee";
            document.getElementById("modal-employee").classList.add("active");
        }

        window.openAddTopicModal = function() {
            formTopic.reset();
            document.getElementById("topic-id").value = "";
            document.getElementById("topic-modal-title").innerText = "Add New Topic";
            document.getElementById("modal-topic").classList.add("active");
        }

    window.openAllocationModal = function(empId, empName, topicId, topicName, currentPct, currentComment) {
        document.getElementById("alloc-emp-id").value = empId;
        document.getElementById("alloc-topic-id").value = topicId;
        document.getElementById("alloc-info-label").innerHTML = `<strong>${empName}</strong> allocated to <strong>${topicName}</strong>`;
        document.getElementById("alloc-pct").value = currentPct;
        document.getElementById("alloc-comment").value = currentComment || "";
        
        document.getElementById("modal-allocation").classList.add("active");
        setTimeout(() => document.getElementById("alloc-pct").focus(), 150);
    }

    window.openEditUserModal = function(user) {
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

}
