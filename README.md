# Textron Digital Engineering Resource Planning Dashboard

A state-of-the-art, secure, and confidential resource planning platform built for Textron engineering leaders to manage employee project allocations, forecast costs, and run local AI simulations.

---

## 🚀 Key Features

* 📊 **Resource Allocation Matrix**: Fully editable grid (add/remove employees and topics, double-click-to-edit any cell) with a dynamic filter panel docked beside the grid - filter options are generated from whatever data is actually loaded (Location, Team, Department, Topic Category, Manager, Status, Active Project Allocation, Hourly Rate range), not a fixed list.
* 📈 **KPI Dashboard**: An Executive Summary tab with a risk/alert strip, Top 5 Cost Drivers, cost-by-department and cost-composition charts, and a staff utilization distribution, plus per-topic/team/employee breakdown tabs with sortable overview tables and an Admin Insights (AI) tab.
* 🖥️ **Customizable Presentation Deck**: Build a report from 7 template slides (Title, Executive Summary, Key Initiatives Budget, Resource Allocations & Risks, AI Portfolio Predictions, Team Breakdown, Employee Breakdown) - include/exclude and reorder them from a panel next to the deck. Long tables auto-paginate across multiple slides instead of scrolling, so nothing is cut off when printed. Export as PDF (browser print) or as a CSV that mirrors exactly the slides you selected - e.g. include Team Breakdown but leave Employee Breakdown out to keep individual names out of a report.
* 🛠️ **Management Panel**: Advanced search, sort, and filters to manage employees, topics, users, and audit logs at scale.
* ☁️ **Excel/CSV Smart Importer & Upload History**: Drag-and-drop importer accepts both CSV and Excel (`.xlsx`/`.xls`) sheets, tolerating missing/reordered columns and picking up brand-new columns as new topics automatically. Every upload is kept in an **Upload History** tab (filename, uploader, timestamp, row counts) - select "Apply" on any past upload to re-import it onto the active planning version without needing the original file again.
* 📤 **Styled Excel Export**: `/api/export/excel` produces a branded workbook (title banner, formatted currency/percentage columns, frozen header, zebra striping) that reflects whichever matrix filters are currently active, not a bare data dump.
* 🎨 **Theme System**: Four selectable themes - Glass (default), Midnight Dark (a distinct near-opaque, cyan/teal palette rather than just "darker"), Light Mode, and a High Contrast accessibility mode - persisted per browser.
* 🤖 **Confidential Local AI assistant**: Natural language planning chatbot running locally (with an optional Ollama LLM fallback), using fuzzy entity matching plus intent detection so it understands varied phrasings, asks a clarifying question when a query is too vague, and keeps conversation memory for as long as the chat drawer stays open. It can also *act*: phrasings like "set X's allocation on Y to 30%" or "move 20% of X's Y time to Z" are executed directly (admin/master_admin only), and its Admin Insights predictions are enriched by feeding the same real computed utilization/cost data to the local LLM for additional, less templated suggestions.
* 🗑️ **Soft Delete & Trash**: Deleting an employee or topic moves it to a recoverable Trash instead of destroying it - a "Trash" panel in the Management Panel lists everything soft-deleted with one-click Restore.
* ✏️ **Bulk Edit**: Select any number of employees in the Management Panel and apply a Team/Department/Location/Manager/Status change or a set/percentage-adjust Hourly Rate change to all of them in a single action.
* 🧭 **AI-Assisted Column Mapping**: Uploading a sheet with a mistyped/abbreviated column (e.g. "Hrly Rate") surfaces a confirmation step suggesting the likely intended field before import, instead of silently treating it as a brand-new topic.
* 🔒 **Hierarchical Role-Based Security & Audit Logs**: `master_admin` (protected, cannot be deleted) → `admin` → `user` role hierarchy, searchable/filterable Audit Log and User Settings tables, and full scenario Backup/Restore as portable JSON.

---

## 🛠️ Tech Stack

* **Backend**: FastAPI (Python), SQLAlchemy (ORM), SQLite (Confidential Local Storage), openpyxl (Excel import/export), Pytest (Automated Tests).
* **Frontend**: HTML5, Vanilla CSS3 (Custom Responsive layout, CSS-variable-driven theming), ES6 Javascript, Chart.js.
* **Security**: Token Bearer Session Headers (stateless session authentication).

---

## 📦 Local Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <your-github-repo-url>
   cd "Hackathon Textron Dashboard"
   ```

2. **Install package dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Initialize the local database**
   Run the seeding script to create database tables and seed baseline scenario data:
   ```bash
   python seed_data.py
   ```

4. **Launch the development server**
   ```bash
   uvicorn main:app --reload
   ```
   Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your web browser.

---

## 🔑 Default Authentication Accounts

Use the following credentials to access the platform:

| Role | Username | Password | Access Privileges |
| :--- | :--- | :--- | :--- |
| **Master Admin** | `master` | `master123` | Everything Admin can do, plus create/delete Admin and User accounts. The account itself is protected and cannot be deleted. |
| **Admin** | `admin` | `admin123` | Can edit the matrix, view AI insights, import/export CSV & Excel, view audit logs, create/delete User accounts |
| **User** | `user` | `user123` | Read-only matrix, no import/export, no audit logs, no account management |

---

## 🧪 Testing Suite
Execute automated unit tests to verify API endpoints, authentication guards, cost calculation engine, and AI assistant behavior:
```bash
pytest tests.py
```
