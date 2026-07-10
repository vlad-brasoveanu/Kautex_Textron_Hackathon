import os
import datetime
import jwt
from fastapi import Request, Response, Depends, HTTPException
from sqlalchemy.orm import Session
import json
import urllib.request
from typing import Optional
import models
from database import get_db

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-not-for-production")
SESSION_COOKIE_NAME = "session_token"
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60  # 7 days
IS_PRODUCTION = bool(os.environ.get("RENDER"))

def create_access_token(username: str, role: str) -> str:
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=SESSION_MAX_AGE_SECONDS)
    return jwt.encode({"sub": username, "role": role, "exp": expires_at}, SECRET_KEY, algorithm="HS256")

def set_session_cookie(response: Response, username: str, role: str):
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=create_access_token(username, role),
        httponly=True,
        secure=IS_PRODUCTION,
        samesite="lax",
        max_age=SESSION_MAX_AGE_SECONDS,
    )

def get_current_user(request: Request, db: Session = Depends(get_db)):
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
    if not token:
        token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or missing session token")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    username = payload.get("sub")
    role = payload.get("role")

    user = db.query(models.User).filter(models.User.username == username).first()
    if not user or user.role != role:
        raise HTTPException(status_code=401, detail="User session context invalid")

    return user

def require_admin(user: models.User = Depends(get_current_user)):
    if user.role not in ["admin", "master_admin"]:
        raise HTTPException(status_code=403, detail="Admin privileges required for this action")
    return user

def require_master(user: models.User = Depends(get_current_user)):
    if user.role != "master_admin":
        raise HTTPException(status_code=403, detail="Master Admin privileges required for this action")
    return user

def write_system_log(db: Session, username: str, action: str, details: str):
    try:
        log = models.SystemLog(username=username, action=action, details=details)
        db.add(log)
        db.commit()
    except Exception as e:
        print("Failed to write system audit log:", e)

def get_active_scenario_db(db: Session):
    scenario = db.query(models.Scenario).filter(models.Scenario.is_active == True).first()
    if not scenario:
        scenario = models.Scenario(name="Default Scenario", description="Auto-created default scenario", is_active=True)
        db.add(scenario)
        db.commit()
        db.refresh(scenario)
    return scenario

def build_dashboard_report(db: Session, scenario: models.Scenario) -> dict:
    employees = db.query(models.Employee).filter(models.Employee.scenario_id == scenario.id, models.Employee.is_deleted == False).all()
    topics = db.query(models.Topic).filter(models.Topic.scenario_id == scenario.id, models.Topic.is_deleted == False).all()

    allocations = db.query(models.Allocation).join(models.Employee).join(models.Topic).filter(
        models.Employee.scenario_id == scenario.id,
        models.Employee.is_deleted == False,
        models.Topic.is_deleted == False
    ).all()
    alloc_map = {}
    emp_alloc_sums = {}
    
    for a in allocations:
        alloc_map[(a.employee_id, a.topic_id)] = a.percentage
        emp_alloc_sums[a.employee_id] = emp_alloc_sums.get(a.employee_id, 0.0) + a.percentage

    total_headcount = len(employees)
    
    total_internal_employee_cost = 0.0
    employee_costs_by_topic = {}
    employee_costs_by_team = {}
    employee_costs_by_location = {}
    employee_costs_by_dept = {}
    
    overloaded_employees = []
    
    for emp in employees:
        utilization = emp_alloc_sums.get(emp.id, 0.0)
        if utilization > 100.0:
            overloaded_employees.append({
                "id": emp.id,
                "name": emp.name,
                "team": emp.team,
                "location": emp.location,
                "utilization": utilization
            })
            
        for topic in topics:
            pct = alloc_map.get((emp.id, topic.id), 0.0)
            if pct > 0.0:
                cost = emp.available_hours * emp.hourly_rate * (pct / 100.0)
                total_internal_employee_cost += cost
                
                employee_costs_by_topic[topic.id] = employee_costs_by_topic.get(topic.id, 0.0) + cost
                employee_costs_by_team[emp.team] = employee_costs_by_team.get(emp.team, 0.0) + cost
                employee_costs_by_location[emp.location] = employee_costs_by_location.get(emp.location, 0.0) + cost
                employee_costs_by_dept[emp.department] = employee_costs_by_dept.get(emp.department, 0.0) + cost

    total_additional_internal = 0.0
    total_external_cost = 0.0
    total_recovery = 0.0
    
    topic_additional_costs = {}
    
    for topic in topics:
        total_recovery += topic.recovery
        topic_additional_costs[topic.id] = {"internal": 0.0, "external": 0.0}
        
        for cost in topic.additional_costs:
            if cost.cost_type == "internal":
                total_additional_internal += cost.amount
                topic_additional_costs[topic.id]["internal"] += cost.amount
            elif cost.cost_type == "external":
                total_external_cost += cost.amount
                topic_additional_costs[topic.id]["external"] += cost.amount
                
    total_annual_planning_cost = total_internal_employee_cost + total_additional_internal + total_external_cost - total_recovery

    topic_summaries = []
    cost_by_category = {}
    
    for topic in topics:
        emp_cost = employee_costs_by_topic.get(topic.id, 0.0)
        add_int = topic_additional_costs.get(topic.id, {}).get("internal", 0.0)
        ext_cost = topic_additional_costs.get(topic.id, {}).get("external", 0.0)
        total_topic_cost = emp_cost + add_int + ext_cost - topic.recovery
        
        involved_staff = []
        for emp in employees:
            pct = alloc_map.get((emp.id, topic.id), 0.0)
            if pct > 0.0:
                involved_staff.append({
                    "employee_name": emp.name,
                    "team": emp.team,
                    "location": emp.location,
                    "percentage": pct,
                    "cost": emp.available_hours * emp.hourly_rate * (pct / 100.0)
                })
                
        topic_summaries.append({
            "id": topic.id,
            "name": topic.name,
            "category": topic.category,
            "area": topic.area,
            "status": topic.status,
            "employee_cost": emp_cost,
            "additional_internal_cost": add_int,
            "external_cost": ext_cost,
            "recovery": topic.recovery,
            "total_cost": total_topic_cost,
            "staff": involved_staff,
            "justification": topic.justification,
            "objective": topic.objective,
            "deliverables": topic.deliverables
        })
        
        cost_by_category[topic.category] = cost_by_category.get(topic.category, 0.0) + total_topic_cost

    highest_cost_topics = sorted(topic_summaries, key=lambda x: x["total_cost"], reverse=True)[:5]
    
    team_summaries = []
    unique_teams = set(emp.team for emp in employees)
    for team in unique_teams:
        team_members = [e for e in employees if e.team == team]
        team_emp_ids = [e.id for e in team_members]
        
        team_cost = employee_costs_by_team.get(team, 0.0)
        utils = [emp_alloc_sums.get(eid, 0.0) for eid in team_emp_ids]
        avg_util = sum(utils) / len(utils) if utils else 0.0
        over_limit = len([u for u in utils if u > 100.0])
        
        contributing_topics = []
        for t in topics:
            team_pct = sum(alloc_map.get((eid, t.id), 0.0) for eid in team_emp_ids)
            if team_pct > 0.0:
                contributing_topics.append({
                    "topic_name": t.name,
                    "total_percentage": team_pct,
                    "generated_cost": sum(emp.available_hours * emp.hourly_rate * (alloc_map.get((emp.id, t.id), 0.0) / 100.0) for emp in team_members)
                })
                
        team_summaries.append({
            "team_name": team,
            "member_count": len(team_members),
            "total_cost": team_cost,
            "average_utilization": avg_util,
            "overloaded_count": over_limit,
            "topics": contributing_topics
        })

    def avg_utilization_by(group_key_fn):
        groups = {}
        for emp in employees:
            groups.setdefault(group_key_fn(emp), []).append(emp_alloc_sums.get(emp.id, 0.0))
        return {k: (sum(v) / len(v) if v else 0.0) for k, v in groups.items()}

    utilization_by_department = avg_utilization_by(lambda e: e.department)
    utilization_by_location = avg_utilization_by(lambda e: e.location)

    return {
        "scenario_name": scenario.name,
        "total_headcount": total_headcount,
        "total_internal_employee_cost": total_internal_employee_cost,
        "total_additional_internal_cost": total_additional_internal,
        "total_external_cost": total_external_cost,
        "total_recovery_cost": total_recovery,
        "total_annual_planning_cost": total_annual_planning_cost,
        "cost_by_location": employee_costs_by_location,
        "cost_by_team": employee_costs_by_team,
        "cost_by_department": employee_costs_by_dept,
        "cost_by_category": cost_by_category,
        "utilization_by_department": utilization_by_department,
        "utilization_by_location": utilization_by_location,
        "highest_cost_topics": highest_cost_topics,
        "overloaded_employees": overloaded_employees,
        "topic_summaries": topic_summaries,
        "team_summaries": team_summaries
    }

def query_local_ollama(prompt: str) -> Optional[str]:
    import sys
    if "main" in sys.modules and hasattr(sys.modules["main"], "query_local_ollama"):
        main_mod = sys.modules["main"]
        # Check if main_mod.query_local_ollama is a different function/lambda (i.e. monkeypatched)
        # Note: since main imports query_local_ollama from dependencies, they normally point
        # to the exact same function object. If monkeypatched, they point to different objects.
        if main_mod.query_local_ollama is not query_local_ollama:
            return main_mod.query_local_ollama(prompt)

    # Both overridable via env var since the actually-pulled model name
    # (`ollama list`) varies per machine - hardcoding "llama3" here meant
    # this silently never fired on any machine that only had llama3.1
    # pulled (a plain "llama3 not found" error from Ollama, swallowed by
    # the except below), permanently falling back to the heuristic engine
    # even when Ollama was installed and running.
    url = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
    model = os.environ.get("OLLAMA_MODEL", "llama3.1")
    data = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        # Local CPU inference on a full RAG-context prompt (all employees/
        # topics/allocations/costs) routinely takes well past 8s - that
        # timeout was short enough to make Ollama fail silently on most
        # real queries, not just unreachable-server cases.
        with urllib.request.urlopen(req, timeout=30.0) as response:
            resp_data = json.loads(response.read().decode("utf-8"))
            if "error" in resp_data:
                print(f"Ollama error for model '{model}': {resp_data['error']}")
                return None
            return resp_data.get("response")
    except Exception as e:
        print(f"Ollama local connection fallback active: {e}")
    return None
