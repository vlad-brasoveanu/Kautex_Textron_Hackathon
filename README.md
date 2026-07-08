# Textron Digital Engineering Resource Planning Dashboard

A state-of-the-art, secure, and confidential resource planning platform built for Textron engineering leaders to manage employee project allocations, forecast costs, and run local AI simulations.

---

## 🚀 Key Features

* 📊 **Resource Allocation Matrix**: Live-editable grid detailing percentage allocations of employees across initiatives.
* 📈 **KPI Dashboard**: Multi-dimensional charts visualizing regional costs, category breakdowns, and recovery offsets (powered by Chart.js).
* 🖥️ **Visual Presentation Deck**: Executive-ready slide layouts designed for direct reports to upper leadership.
* 🛠️ **Management Panel**: Advanced search, sort, and filters to manage employees, topics, and scenario configurations on a large scale.
* ☁️ **Excel/CSV Smart Importer**: Drag-and-drop CSV parser that populates scenarios, employee hours, hourly rates, and initiative metrics on the fly.
* 🤖 **Confidential Local AI assistant**: Natural language planning chatbot running locally with Jaccard-overlap fuzzy matching, ambiguity prompts, and full conversational memory.
* 🔒 **Role-Based Security & Audit Logs**: Secure endpoints requiring token authorization with a real-time Audit Log tracking logins, registrations, imports, and exports.

---

## 🛠️ Tech Stack

* **Backend**: FastAPI (Python), SQLAlchemy (ORM), SQLite (Confidential Local Storage), Pytest (Automated Tests).
* **Frontend**: HTML5, Vanilla CSS3 (Custom Responsive layout), ES6 Javascript, Chart.js.
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
| **Admin** | `admin` | `admin123` | Can edit matrix, view AI insights, import CSV, view audit logs |
| **User** | `user` | `user123` | Read-only matrix, cannot import, view logs, or edit profiles |

---

## 🧪 Testing Suite
Execute automated unit tests to verify API endpoints, authentication guards, cost calculation engine, and AI assistant behavior:
```bash
pytest tests.py
```
