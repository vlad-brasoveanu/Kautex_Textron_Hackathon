// Component: auth
import { state } from "../state.js";
import { showToast, applyTranslations, t } from "../utils.js";

export function initAuth() {
window.logout = async function() {
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

}