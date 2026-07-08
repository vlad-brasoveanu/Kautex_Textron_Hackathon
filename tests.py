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
    admin_user = models.User(
        username="admin",
        password_hash=hash_password("admin123"),
        role="admin"
    )
    regular_user = models.User(
        username="user",
        password_hash=hash_password("user123"),
        role="user"
    )
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
    
    response = client.post("/api/ai/query", json={"query": "Invalid question that contains topic cost"}, headers=user_headers)
    assert response.status_code == 200
    assert "could not understand that question locally" in response.json()["answer"]

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
    reg_payload = {"username": "newaudituser", "password": "securepass123", "role": "user"}
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
