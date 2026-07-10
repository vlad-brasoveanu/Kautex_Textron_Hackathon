// Global App State for Digital Engineering Planning Dashboard

export const state = {
    activeScenario: null,
    scenarios: [],
    employees: [],
    topics: [],
    allocations: [],
    dashboardData: null,
    trashData: { employees: [], topics: [], allocations: [] },
    selectedEmployeeIds: new Set(),
    refreshRequestId: 0,
    activeRole: "admin",
    activeSection: "matrix-section",
    activeDashTab: "tab-executive",
    
    // Filters state
    filters: {
        location: "",
        team: "",
        department: "",
        category: "",
        minRate: 0,
        maxRate: 999999,
        manager: "",
        status: "",
        topicId: "",
        employeeSearch: "",
        minUtil: 0,
        maxUtil: 999,
        minCost: 0,
        maxCost: 999999999
    },

    // Sort, grouping and presentation states
    matrixSortField: null,
    matrixSortOrder: 1,
    matrixGrouping: "none",
    slideTableOverrides: {},
    matrixMobileView: "cards",

    // CRUD Panel Search & Sort states
    empSearch: "",
    empLocFilter: "",
    empSortField: "name",
    empSortOrder: 1,

    topicSearch: "",
    topicCatFilter: "",
    topicSortField: "name",
    topicSortOrder: 1,

    // Audit logs & User Cache
    auditLogsCache: [],
    auditLogSearch: "",
    auditLogActionFilter: "",
    auditLogUserFilter: "",

    usersCache: [],
    userSearch: "",
    userRoleFilter: "",

    // Dashboard Overview Sorting
    teamOvSortField: "total_cost",
    teamOvSortOrder: -1,
    empOvSortField: "utilization",
    empOvSortOrder: -1,

    // Chart.js instances
    charts: {
        locationChart: null,
        categoryChart: null,
        compositionChart: null,
        departmentChart: null,
        utilizationChart: null,
        presLocationChart: null,
        presDeptChart: null,
        presLocBreakdownChart: null
    },

    // Presentation Deck settings
    excludedFilters: {
        locations: new Set(),
        teams: new Set(),
        departments: new Set()
    },
    aiPredictionsData: null,
    deckConfig: null,

    // Executive Summary customizable widget visibility (dashboards.js), shared
    // with the "reset customize" handler that lives in main.js's setupEventListeners.
    execWidgetConfig: null,

    // Simulation Sandbox state (scenarios.js), also read/written from
    // ai.js (handleAISubmit's "View in Simulation" action) and from the
    // sim quick-action button wiring in main.js's setupEventListeners.
    simScenario: null,
    simEmployees: [],
    simTopics: [],
    simAllocations: [],

    // Presentation fullscreen overlay state (presentation.js), also read from
    // main.js's setupEventListeners (slide reorder/remove handlers).
    activePhysicalSlides: [],
    currentPresSlideIndex: 0
};

// Storage Key Constants
export const DECK_CONFIG_STORAGE_KEY = "presentationDeckConfig_v1";

// Bind state variables to window getters/setters so that all functions can read/write them seamlessly
const stateKeys = [
    "activeScenario", "scenarios", "employees", "topics", "allocations",
    "dashboardData", "trashData", "selectedEmployeeIds", "refreshRequestId",
    "activeRole", "activeSection", "activeDashTab", "filters",
    "matrixSortField", "matrixSortOrder", "matrixGrouping", "slideTableOverrides", "matrixMobileView",
    "empSearch", "empLocFilter", "empSortField", "empSortOrder",
    "topicSearch", "topicCatFilter", "topicSortField", "topicSortOrder",
    "auditLogsCache", "auditLogSearch", "auditLogActionFilter", "auditLogUserFilter",
    "usersCache", "userSearch", "userRoleFilter",
    "teamOvSortField", "teamOvSortOrder", "empOvSortField", "empOvSortOrder",
    "excludedFilters", "aiPredictionsData", "deckConfig",
    "execWidgetConfig", "simScenario", "simEmployees", "simTopics", "simAllocations",
    "activePhysicalSlides", "currentPresSlideIndex"
];

stateKeys.forEach(key => {
    Object.defineProperty(window, key, {
        get() { return state[key]; },
        set(value) { state[key] = value; },
        configurable: true
    });
});

// Also map charts directly on window
const chartKeys = [
    "locationChart", "categoryChart", "compositionChart", "departmentChart", "utilizationChart",
    "presLocationChart", "presDeptChart", "presLocBreakdownChart"
];
chartKeys.forEach(key => {
    Object.defineProperty(window, key, {
        get() { return state.charts[key]; },
        set(value) { state.charts[key] = value; },
        configurable: true
    });
});
