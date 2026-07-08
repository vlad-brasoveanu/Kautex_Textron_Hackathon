import pytest
import io
import csv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base
import models
from main import app, get_db, hash_password
from fastapi.testclient import TestClient

# Create sqlite in-memory database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_planning.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override database dependency in FastAPI app
def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

# Helper headers
master_headers = {"Authorization": "Bearer token_master_master_admin"}
admin_headers = {"Authorization": "Bearer token_admin_admin"}
user_headers = {"Authorization": "Bearer token_user_user"}
invalid_headers = {"Authorization": "Bearer token_invalid_user"}

@pytest.fixture(autouse=True)
def setup_database():
    # Setup database schema before each test run
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # Clean previous records
    db.query(models.Allocation).delete()
    db.query(models.AdditionalCost).delete()
    db.query(models.Employee).delete()
    db.query(models.Topic).delete()
    db.query(models.Scenario).delete()
    db.query(models.User).delete()
    db.commit()
    
    # Seed default users
    master_user = models.User(
        username="master",
        password_hash=hash_password("master123"),
        name="Master Manager",
        role="master_admin"
    )
    admin_user = models.User(
        username="admin",
        password_hash=hash_password("admin123"),
        name="Admin Director",
        role="admin"
    )
    regular_user = models.User(
        username="user",
        password_hash=hash_password("user123"),
        name="Staff Analyst",
        role="user"
    )
    db.add(master_user)
    db.add(admin_user)
    db.add(regular_user)
    
    # Insert Test scenario
    scenario = models.Scenario(name="Test Scenario", description="Automation validation", is_active=True)
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    
    yield db
    
    # Tear down database
    Base.metadata.drop_all(bind=engine)

def test_login_auth_endpoint():
    # Test valid admin login
    response = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    assert response.json()["access_token"] == "token_admin_admin"

    # Test valid user login
    response = client.post("/api/auth/login", json={"username": "user", "password": "user123"})
    assert response.status_code == 200
    assert response.json()["role"] == "user"
    
    # Test invalid login
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrongpassword"})
    assert response.status_code == 401

def test_security_auth_guards(setup_database):
    # Test unauthorized access (no headers)
    response = client.get("/api/scenarios")
    assert response.status_code in (401, 403)

    # Test invalid token access
    response = client.get("/api/scenarios", headers=invalid_headers)
    assert response.status_code == 401

    # Test authorized read access
    response = client.get("/api/scenarios", headers=user_headers)
    assert response.status_code == 200

    # Test user (read-only) trying to create a scenario
    response = client.post("/api/scenarios", json={"name": "New Scen"}, headers=user_headers)
    assert response.status_code == 403  # Forbidden write for normal user

    # Test admin (read-write) creating a scenario
    response = client.post("/api/scenarios", json={"name": "Admin Scen"}, headers=admin_headers)
    assert response.status_code == 200

def test_scenario_crud(setup_database):
    response = client.get("/api/scenarios", headers=user_headers)
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["name"] == "Test Scenario"

def test_cost_calculation_engine(setup_database):
    db = setup_database
    scenario = db.query(models.Scenario).filter(models.Scenario.is_active == True).first()
    
    emp = models.Employee(
        scenario_id=scenario.id,
        name="Tester A",
        team="CAE Germany",
        department="CAE",
        location="Germany",
        available_hours=1000.0,
        hourly_rate=100.0,
        status="Active"
    )
    db.add(emp)
    
    topic = models.Topic(
        scenario_id=scenario.id,
        name="AI Testing Initiative",
        category="Internal Efforts",
        area="CAE",
        recovery=1000.0
    )
    db.add(topic)
    db.commit()
    db.refresh(emp)
    db.refresh(topic)
    
    alloc = models.Allocation(
        employee_id=emp.id,
        topic_id=topic.id,
        percentage=50.0,
        comment="Planned half-time on AI testing."
    )
    db.add(alloc)
    
    add_cost_int = models.AdditionalCost(
        topic_id=topic.id,
        cost_type="internal",
        category="CAD",
        amount=2000.0
    )
    add_cost_ext = models.AdditionalCost(
        topic_id=topic.id,
        cost_type="external",
        category="Tooling",
        amount=5000.0
    )
    db.add(add_cost_int)
    db.add(add_cost_ext)
    db.commit()
    
    response = client.get("/api/reports/dashboard", headers=user_headers)
    assert response.status_code == 200
    data = response.json()
    
    assert data["total_internal_employee_cost"] == 50000.0
    assert data["total_additional_internal_cost"] == 2000.0
    assert data["total_external_cost"] == 5000.0
    assert data["total_recovery_cost"] == 1000.0
    assert data["total_annual_planning_cost"] == 56000.0

def test_local_ai_query_assistant(setup_database):
    db = setup_database
    scenario = db.query(models.Scenario).filter(models.Scenario.is_active == True).first()
    
    emp = models.Employee(
        scenario_id=scenario.id,
        name="Jane Doe",
        team="Test Bonn",
        department="Test",
        location="Germany",
        available_hours=1600.0,
        hourly_rate=120.0,
        status="Active"
    )
    db.add(emp)
    topic = models.Topic(
        scenario_id=scenario.id,
        name="Validation Protocol Fuel",
        category="Customer Requests",
        recovery=0.0
    )
    db.add(topic)
    db.commit()
    db.refresh(emp)
    db.refresh(topic)
    
    alloc = models.Allocation(employee_id=emp.id, topic_id=topic.id, percentage=120.0)
    db.add(alloc)
    db.commit()
    
    response = client.post("/api/ai/query", json={"query": "List overloaded employees"}, headers=user_headers)
    assert response.status_code == 200
    assert "Jane Doe" in response.json()["answer"]
    assert "120.0%" in response.json()["answer"]
    
    response = client.post("/api/ai/query", json={"query": "Who is working on Fuel?"}, headers=user_headers)
    assert response.status_code == 200
    assert "Jane Doe" in response.json()["answer"]
    assert "120.0%" in response.json()["answer"]

    response = client.post("/api/ai/query", json={"query": "who is working in Germany?"}, headers=user_headers)
    assert response.status_code == 200
    assert "Jane Doe" in response.json()["answer"]

    # Natural-language phrasing that doesn't match any of the fixed regex patterns
    response = client.post("/api/ai/query", json={"query": "tell me what are the names of the people working in Germany"}, headers=user_headers)
    assert response.status_code == 200
    assert "Jane Doe" in response.json()["answer"]

    response = client.post("/api/ai/query", json={"query": "how many people are on team Test Bonn"}, headers=user_headers)
    assert response.status_code == 200
    assert "1" in response.json()["answer"]

    response = client.post("/api/ai/query", json={"query": "Invalid question that contains topic cost"}, headers=user_headers)
    assert response.status_code == 200
    assert "not sure exactly what you're asking" in response.json()["answer"]

    # Test out-of-scope guardrail block
    response = client.post("/api/ai/query", json={"query": "What is the capital of France?"}, headers=user_headers)
    assert response.status_code == 200
    assert "guardrails" in response.json()["answer"] or "outside my planning scope" in response.json()["answer"]

def test_ai_predictions_endpoint(setup_database):
    response = client.get("/api/reports/ai-predictions", headers=user_headers)
    assert response.status_code == 200
    data = response.json()
    assert "bottlenecks" in data
    assert "cost_optimizations" in data
    assert "reallocations" in data

def test_local_ai_conversation_memory(setup_database):
    history = [
        {"role": "user", "content": "who is working in romania?"},
        {"role": "assistant", "content": "[Local Heuristic Engine Fallback] I found multiple matches for 'romania'. Did you mean:\n* Location: Romania\n* Team: Test Romania\n* Team: CAE Romania\nPlease clarify your query."}
    ]
    response = client.post("/api/ai/query", json={"query": "all of them", "history": history}, headers=user_headers)
    assert response.status_code == 200
    assert "Location: Romania" in response.json()["answer"]
    assert "Team: Test Romania" in response.json()["answer"]

def test_audit_logging_scenarios(setup_database):
    # 1. Test Registration
    reg_payload = {"username": "newaudituser", "password": "securepass123", "name": "Audit User", "role": "user"}
    response = client.post("/api/auth/register", json=reg_payload)
    assert response.status_code == 200
    assert response.json()["username"] == "newaudituser"

    # 2. Test Report Export Logging
    export_payload = {"report_name": "Test Excel Export", "format": "CSV"}
    response = client.post("/api/reports/log-export", json=export_payload, headers=user_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # 3. Test Admin Logs Retrieval
    response = client.get("/api/admin/logs", headers=admin_headers)
    assert response.status_code == 200
    logs = response.json()
    assert len(logs) > 0
    # The registration and export log events should be present in the audit log list
    actions = [l["action"] for l in logs]
    assert "Registration" in actions
    assert "Export Report" in actions

    # 4. General user cannot read logs
    response = client.get("/api/admin/logs", headers=user_headers)
    assert response.status_code == 403

def test_hierarchical_role_management(setup_database):
    # 1. Master admin can create an admin
    payload = {"username": "new_admin", "password": "password123", "name": "New Admin Name", "role": "admin"}
    response = client.post("/api/users", json=payload, headers=master_headers)
    assert response.status_code == 200
    assert response.json()["username"] == "new_admin"
    assert response.json()["role"] == "admin"

    # 2. Admin cannot create another admin
    payload_bad = {"username": "bad_admin", "password": "password123", "name": "Bad Admin Name", "role": "admin"}
    response = client.post("/api/users", json=payload_bad, headers=admin_headers)
    assert response.status_code == 403

    # 3. Admin can create a standard user
    payload_ok = {"username": "new_user_by_admin", "password": "password123", "name": "User Name", "role": "user"}
    response = client.post("/api/users", json=payload_ok, headers=admin_headers)
    assert response.status_code == 200

    # 4. Standard user cannot create anyone
    response = client.post("/api/users", json=payload_ok, headers=user_headers)
    assert response.status_code == 403

    # 5. Cannot delete master admin (id 1)
    response = client.delete("/api/users/1", headers=master_headers)
    assert response.status_code == 400
    assert "protected" in response.json()["detail"]

def test_create_user_optional_profile_fields(setup_database):
    # Optional fields (email, department, position, supervisor) can be supplied...
    payload = {
        "username": "full_profile_user", "password": "password123", "name": "Full Profile",
        "role": "user", "email": "full.profile@textron.com", "department": "CAE Engineering",
        "position": "Senior Engineer", "supervisor": "Jane Boss"
    }
    response = client.post("/api/users", json=payload, headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "full.profile@textron.com"
    assert data["department"] == "CAE Engineering"
    assert data["position"] == "Senior Engineer"
    assert data["supervisor"] == "Jane Boss"

    # ...and are optional, defaulting to null when omitted
    payload_minimal = {"username": "minimal_profile_user", "password": "password123", "name": "Minimal Profile", "role": "user"}
    response = client.post("/api/users", json=payload_minimal, headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["email"] is None
    assert data["department"] is None
    assert data["position"] is None
    assert data["supervisor"] is None

    # 6. Admin cannot delete another admin (id 2)
    response = client.delete("/api/users/2", headers=admin_headers)
    assert response.status_code == 400  # Self-deletion check triggers first because admin_headers is user 2

def test_csv_importer(setup_database):
    csv_data = [
        ["Employee", "Team", "Location", "Hours/Year", "Hourly Rate", "Initiative A"],
        ["GV Test User", "Test Team", "Romania", "1800", "60.0", "50%"],
        ["", "", "", "", "", ""],
        ["Tooling", "", "", "", "", "12000.0"]
    ]
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerows(csv_data)
    csv_content = output.getvalue()
    
    file_payload = {"file": ("planning_grid.csv", csv_content, "text/csv")}
    response = client.post("/api/import/csv", files=file_payload, headers=admin_headers)
    
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "success"
    assert res_data["imported_employees"] == 1
    assert res_data["imported_topics"] == 1
    assert res_data["imported_allocations"] == 1
    assert res_data["imported_additional_costs"] == 1

def test_csv_importer_missing_columns_keeps_existing_values(setup_database):
    # First upload establishes full employee data (team, location, hours, rate)
    full_csv = [
        ["Employee", "Team", "Location", "Hours/Year", "Hourly Rate", "Initiative A"],
        ["Partial Col User", "CAE Team", "Germany", "1800", "75.0", "40%"],
    ]
    output = io.StringIO()
    csv.writer(output).writerows(full_csv)
    client.post("/api/import/csv", files={"file": ("full.csv", output.getvalue(), "text/csv")}, headers=admin_headers)

    # Second upload only carries Employee + a new topic column - Team/Location/Hours/Rate
    # are missing entirely and must NOT be wiped out on the existing employee.
    partial_csv = [
        ["Employee", "Initiative B"],
        ["Partial Col User", "20%"],
    ]
    output2 = io.StringIO()
    csv.writer(output2).writerows(partial_csv)
    response = client.post("/api/import/csv", files={"file": ("partial.csv", output2.getvalue(), "text/csv")}, headers=admin_headers)

    assert response.status_code == 200
    res_data = response.json()
    assert res_data["imported_employees"] == 0  # updated existing, not created
    assert res_data["imported_topics"] == 1  # "Initiative B" is a brand-new column/topic

    emp_resp = client.get("/api/employees", headers=admin_headers)
    employee = next(e for e in emp_resp.json() if e["name"] == "Partial Col User")
    assert employee["team"] == "CAE Team"
    assert employee["location"] == "Germany"
    assert employee["available_hours"] == 1800.0
    assert employee["hourly_rate"] == 75.0

def test_csv_importer_new_manager_column(setup_database):
    csv_data = [
        ["Employee", "Team", "Location", "Manager", "Initiative A"],
        ["Managed User", "Test Team", "Romania", "Jane Boss", "30%"],
    ]
    output = io.StringIO()
    csv.writer(output).writerows(csv_data)
    response = client.post("/api/import/csv", files={"file": ("managers.csv", output.getvalue(), "text/csv")}, headers=admin_headers)

    assert response.status_code == 200
    emp_resp = client.get("/api/employees", headers=admin_headers)
    employee = next(e for e in emp_resp.json() if e["name"] == "Managed User")
    assert employee["manager"] == "Jane Boss"


def test_scenario_backup_restore(setup_database):
    # 1. Add some mock data to scenario 1
    emp_payload = {"name": "Backup Employee", "team": "QA", "department": "Engineering", "location": "Romania", "available_hours": 1600, "hourly_rate": 45.0}
    response = client.post("/api/employees", json=emp_payload, headers=admin_headers)
    assert response.status_code == 200
    
    topic_payload = {"name": "Backup Topic", "category": "Testing"}
    response = client.post("/api/topics", json=topic_payload, headers=admin_headers)
    assert response.status_code == 200
    
    # Get backup of scenario 1
    response = client.get("/api/scenarios/1/backup", headers=admin_headers)
    assert response.status_code == 200
    backup_data = response.json()
    assert backup_data["name"] == "Test Scenario"
    assert len(backup_data["employees"]) > 0
    assert len(backup_data["topics"]) > 0
    
    # 2. Restore scenario 1 from backup_data
    restore_payload = {
        "name": "Restored Scenario",
        "description": "Successfully restored scenario",
        "employees": backup_data["employees"],
        "topics": backup_data["topics"],
        "allocations": backup_data["allocations"],
        "additional_costs": backup_data["additional_costs"]
    }
    
    response = client.post("/api/scenarios/1/restore", json=restore_payload, headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    
    # Verify scenario was updated
    response = client.get("/api/scenarios", headers=admin_headers)
    assert response.status_code == 200
    active_scenario = next(s for s in response.json() if s["is_active"])
    assert active_scenario["name"] == "Restored Scenario"
    assert active_scenario["description"] == "Successfully restored scenario"
