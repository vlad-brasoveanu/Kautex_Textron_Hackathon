import re
import json
import datetime
from typing import Optional, List, Tuple
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from dependencies import (
    get_current_user,
    require_admin,
    write_system_log,
    get_active_scenario_db,
    build_dashboard_report,
    query_local_ollama,
)
from routers.scenarios import clone_scenario_data

router = APIRouter(prefix="/api", tags=["ai"])

def get_planning_rag_context(db: Session, scenario_id: int) -> str:
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        return "No active planning scenario data."
        
    employees = db.query(models.Employee).filter(models.Employee.scenario_id == scenario_id, models.Employee.is_deleted == False).all()
    topics = db.query(models.Topic).filter(models.Topic.scenario_id == scenario_id, models.Topic.is_deleted == False).all()
    allocations = db.query(models.Allocation).join(models.Employee).filter(models.Employee.scenario_id == scenario_id, models.Employee.is_deleted == False).all()
    additional_costs = db.query(models.AdditionalCost).join(models.Topic).filter(models.Topic.scenario_id == scenario_id, models.Topic.is_deleted == False).all()

    lines = []
    lines.append(f"Scenario Name: {scenario.name}")
    lines.append(f"Scenario Description: {scenario.description or ''}")
    
    lines.append("\n## Employees")
    for e in employees:
        lines.append(f"- Name: {e.name}, Team: {e.team}, Location: {e.location}, Rate: ${e.hourly_rate}/hr, Hours: {e.available_hours}h/yr, Status: {e.status}")
        
    lines.append("\n## Projects / Topics")
    for t in topics:
        lines.append(f"- Topic Name: {t.name}, Category: {t.category}, Area: {t.area or 'N/A'}, Recovery Savings: ${t.recovery}")
        
    lines.append("\n## Allocations (%)")
    alloc_map = {(a.employee_id, a.topic_id): a for a in allocations}
    emp_names = {e.id: e.name for e in employees}
    top_names = {t.id: t.name for t in topics}
    for (eid, tid), a in alloc_map.items():
        if eid in emp_names and tid in top_names:
            lines.append(f"- Employee '{emp_names[eid]}' is allocated to Topic '{top_names[tid]}' at {a.percentage}%" + (f" (Reason/Comment: {a.comment})" if a.comment else ""))
            
    lines.append("\n## Additional Cost Items")
    for ac in additional_costs:
        if ac.topic_id in top_names:
            lines.append(f"- Topic '{top_names[ac.topic_id]}': Category '{ac.category}', Type: '{ac.cost_type}', Amount: ${ac.amount}")
            
    return "\n".join(lines)

def fuzzy_match_ambiguous(query: str, choices: list, key_extractor, threshold: float = 0.25) -> Tuple[Optional[any], list[any]]:
    if not query:
        return None, []
    query_clean = query.lower().strip()
    query_tokens = set(query_clean.split())
    if not query_tokens:
        return None, []
        
    scored_items = []
    
    for item in choices:
        val = key_extractor(item).lower()
        val_tokens = set(val.split())
        
        jaccard = 0.0
        intersection = query_tokens.intersection(val_tokens)
        union = query_tokens.union(val_tokens)
        if union:
            jaccard = len(intersection) / len(union)
        
        containment = sum(1.0 for q_t in query_tokens if q_t in val) / len(query_tokens)
        
        score = jaccard * 0.6 + containment * 0.4
        
        if query_clean in val:
            score += 0.5
            
        if query_clean == val:
            score += 1.0
            
        if score >= threshold:
            scored_items.append((score, item))
            
    if not scored_items:
        return None, []
        
    scored_items.sort(key=lambda x: x[0], reverse=True)
    
    if scored_items[0][0] >= 1.4:
        return scored_items[0][1], []
        
    if len(scored_items) == 1:
        return scored_items[0][1], []
        
    if scored_items[0][0] - scored_items[1][0] > 0.35:
        return scored_items[0][1], []
        
    top_score = scored_items[0][0]
    candidates = [item for score, item in scored_items if top_score - score <= 0.3]
    
    if len(candidates) == 1:
        return candidates[0], []
        
    return None, candidates

def _apply_ai_allocation(db: Session, employee_id: int, topic_id: int, percentage: float):
    db_alloc = db.query(models.Allocation).filter(
        models.Allocation.employee_id == employee_id,
        models.Allocation.topic_id == topic_id
    ).first()
    if db_alloc:
        db_alloc.percentage = percentage
    else:
        db_alloc = models.Allocation(employee_id=employee_id, topic_id=topic_id, percentage=percentage)
        db.add(db_alloc)
    db.commit()

AI_ACTION_PREFIX = ""

def try_execute_ai_action(q_lower: str, employees: list, topics: list, alloc_map: dict, db: Session, current_user: models.User) -> Optional[dict]:
    emp_part = topic_part = pct_part = None

    set_match = re.search(r"set\s+(.+?)'s\s+allocation\s+(?:on|for)\s+(.+?)\s+to\s+(\d+(?:\.\d+)?)\s*%?", q_lower)
    if set_match:
        emp_part, topic_part, pct_part = set_match.groups()
    else:
        set_match2 = re.search(r"set\s+(.+?)'s\s+(.+?)\s+allocation\s+to\s+(\d+(?:\.\d+)?)\s*%?", q_lower)
        if set_match2:
            emp_part, topic_part, pct_part = set_match2.groups()

    move_match = None
    if emp_part is None:
        move_match = re.search(r"move\s+(\d+(?:\.\d+)?)\s*%?\s+of\s+(.+?)'s\s+(.+?)\s+(?:time\s+)?to\s+(.+)", q_lower)

    if emp_part is None and not move_match:
        return None

    if current_user.role not in ("admin", "master_admin"):
        return {"answer": AI_ACTION_PREFIX + "I recognized an allocation-change request, but only Admins can execute changes via chat. Please ask an Admin, or apply it manually in the Allocation Matrix."}

    if move_match:
        pct_str, emp_part, topic_from_part, topic_to_part = move_match.groups()
        pct_delta = float(pct_str)

        emp_match, _ = fuzzy_match_ambiguous(emp_part.strip(), employees, lambda e: e.name)
        if not emp_match:
            return {"answer": AI_ACTION_PREFIX + f"I couldn't uniquely identify the employee '{emp_part.strip()}' to move allocation for."}
        topic_from_match, _ = fuzzy_match_ambiguous(topic_from_part.strip(), topics, lambda t: t.name)
        topic_to_match, _ = fuzzy_match_ambiguous(topic_to_part.strip(), topics, lambda t: t.name)
        if not topic_from_match or not topic_to_match:
            return {"answer": AI_ACTION_PREFIX + f"I couldn't identify both topics ('{topic_from_part.strip()}' -> '{topic_to_part.strip()}') to move allocation between."}

        current_from = alloc_map.get((emp_match.id, topic_from_match.id), 0.0)
        if pct_delta > current_from:
            return {"answer": AI_ACTION_PREFIX + f"{emp_match.name} is only allocated {current_from:.1f}% to {topic_from_match.name}, so I can't move {pct_delta:.1f}%."}

        new_from = round(current_from - pct_delta, 2)
        current_to = alloc_map.get((emp_match.id, topic_to_match.id), 0.0)
        new_to = round(current_to + pct_delta, 2)

        _apply_ai_allocation(db, emp_match.id, topic_from_match.id, new_from)
        _apply_ai_allocation(db, emp_match.id, topic_to_match.id, new_to)
        write_system_log(
            db, username=current_user.username, action="AI Chat Allocation Change",
            details=f"Moved {pct_delta:.1f}% of {emp_match.name}'s allocation from '{topic_from_match.name}' to '{topic_to_match.name}' via AI chat"
        )
        return {
            "answer": AI_ACTION_PREFIX + f"Done. Moved **{pct_delta:.1f}%** of **{emp_match.name}**'s time from **{topic_from_match.name}** ({current_from:.1f}% → {new_from:.1f}%) to **{topic_to_match.name}** ({current_to:.1f}% → {new_to:.1f}%). The Allocation Matrix has been updated.",
            "action_executed": True
        }

    pct = float(pct_part)
    if pct < 0 or pct > 100:
        return {"answer": AI_ACTION_PREFIX + "Allocation percentage must be between 0 and 100."}

    emp_match, _ = fuzzy_match_ambiguous(emp_part.strip(), employees, lambda e: e.name)
    if not emp_match:
        return {"answer": AI_ACTION_PREFIX + f"I couldn't uniquely identify the employee '{emp_part.strip()}'."}
    topic_match, _ = fuzzy_match_ambiguous(topic_part.strip(), topics, lambda t: t.name)
    if not topic_match:
        return {"answer": AI_ACTION_PREFIX + f"I couldn't uniquely identify the topic/project '{topic_part.strip()}'."}

    current_pct = alloc_map.get((emp_match.id, topic_match.id), 0.0)
    _apply_ai_allocation(db, emp_match.id, topic_match.id, pct)
    write_system_log(
        db, username=current_user.username, action="AI Chat Allocation Change",
        details=f"Set {emp_match.name}'s allocation on '{topic_match.name}' to {pct:.1f}% via AI chat (was {current_pct:.1f}%)"
    )
    return {
        "answer": AI_ACTION_PREFIX + f"Done. Set **{emp_match.name}**'s allocation on **{topic_match.name}** to **{pct:.1f}%** (was {current_pct:.1f}%). The Allocation Matrix has been updated.",
        "action_executed": True
    }

AI_SIMULATION_PREFIX = "[AI What-If Copilot] "

def try_execute_ai_simulation(q_lower: str, original_query: str, employees: list, topics: list, alloc_map: dict, db: Session, current_user: models.User, active_scenario: models.Scenario) -> Optional[dict]:
    if not re.search(r"\bwhat\s+if\b|\bsimulate\b|\bsimulation\b", q_lower):
        return None

    if current_user.role not in ("admin", "master_admin"):
        return {"answer": AI_SIMULATION_PREFIX + "I recognized a what-if / simulation request, but only Admins can run these from chat. Please ask an Admin, or use the Simulation page directly."}

    set_match = re.search(r"set\s+(.+?)'s\s+allocation\s+(?:on|for)\s+(.+?)\s+to\s+(\d+(?:\.\d+)?)\s*%?", q_lower)
    if not set_match:
        set_match = re.search(r"set\s+(.+?)'s\s+(.+?)\s+allocation\s+to\s+(\d+(?:\.\d+)?)\s*%?", q_lower)
    move_match = re.search(r"move\s+(\d+(?:\.\d+)?)\s*%?\s+of\s+(.+?)'s\s+(.+?)\s+(?:time\s+)?to\s+(.+)", q_lower)
    add_emp_match = re.search(r"add\s+(?:a\s+new\s+)?employee\s+(?:named\s+)?(.+?)\s+to\s+(?:team\s+)?(.+)", q_lower)
    rate_match = re.search(r"change\s+(.+?)'s\s+hourly\s+rate\s+to\s+\$?(\d+(?:\.\d+)?)", q_lower)
    effort_match = re.search(r"(increase|decrease)\s+(.+?)'s\s+effort\s+on\s+(.+?)\s+by\s+(\d+(?:\.\d+)?)\s*%?", q_lower)

    if not any([set_match, move_match, add_emp_match, rate_match, effort_match]):
        return {"answer": AI_SIMULATION_PREFIX + "I can simulate changes like: \"what if we set X's allocation on Y to 30%\", \"what if we move 10% of X's Y time to Z\", \"what if we add employee X to team Y\", \"what if we change X's hourly rate to 90\", or \"what if we increase X's effort on Y by 10%\" - try rephrasing using one of these."}

    emp_match = topic_match = topic_from_match = topic_to_match = None
    pct = pct_delta = new_rate = new_from = new_to = current_from = current_to = None
    direction = new_emp_name = new_emp_team = None

    if set_match:
        emp_part, topic_part, pct_part = set_match.groups()
        emp_match, _ = fuzzy_match_ambiguous(emp_part.strip(), employees, lambda e: e.name)
        if not emp_match:
            return {"answer": AI_SIMULATION_PREFIX + f"I couldn't uniquely identify the employee '{emp_part.strip()}'."}
        topic_match, _ = fuzzy_match_ambiguous(topic_part.strip(), topics, lambda t: t.name)
        if not topic_match:
            return {"answer": AI_SIMULATION_PREFIX + f"I couldn't uniquely identify the topic/project '{topic_part.strip()}'."}
        pct = float(pct_part)
        if pct < 0 or pct > 100:
            return {"answer": AI_SIMULATION_PREFIX + "Allocation percentage must be between 0 and 100."}
        current_pct = alloc_map.get((emp_match.id, topic_match.id), 0.0)
        change_summary = f"set **{emp_match.name}**'s allocation on **{topic_match.name}** to **{pct:.1f}%** (was {current_pct:.1f}%)"

    elif move_match:
        pct_str, emp_part, topic_from_part, topic_to_part = move_match.groups()
        pct_delta = float(pct_str)
        emp_match, _ = fuzzy_match_ambiguous(emp_part.strip(), employees, lambda e: e.name)
        if not emp_match:
            return {"answer": AI_SIMULATION_PREFIX + f"I couldn't uniquely identify the employee '{emp_part.strip()}'."}
        topic_from_match, _ = fuzzy_match_ambiguous(topic_from_part.strip(), topics, lambda t: t.name)
        topic_to_match, _ = fuzzy_match_ambiguous(topic_to_part.strip(), topics, lambda t: t.name)
        if not topic_from_match or not topic_to_match:
            return {"answer": AI_SIMULATION_PREFIX + f"I couldn't identify both topics ('{topic_from_part.strip()}' -> '{topic_to_part.strip()}')."}
        current_from = alloc_map.get((emp_match.id, topic_from_match.id), 0.0)
        if pct_delta > current_from:
            return {"answer": AI_SIMULATION_PREFIX + f"{emp_match.name} is only allocated {current_from:.1f}% to {topic_from_match.name}, so I can't move {pct_delta:.1f}%."}
        new_from = round(current_from - pct_delta, 2)
        current_to = alloc_map.get((emp_match.id, topic_to_match.id), 0.0)
        new_to = round(current_to + pct_delta, 2)
        change_summary = f"move **{pct_delta:.1f}%** of **{emp_match.name}**'s time from **{topic_from_match.name}** to **{topic_to_match.name}**"

    elif add_emp_match:
        new_emp_name, new_emp_team = add_emp_match.groups()
        new_emp_name = new_emp_name.strip().title()
        new_emp_team = new_emp_team.strip()
        change_summary = f"add a new employee **{new_emp_name}** to team **{new_emp_team}**"

    elif rate_match:
        emp_part, rate_part = rate_match.groups()
        emp_match, _ = fuzzy_match_ambiguous(emp_part.strip(), employees, lambda e: e.name)
        if not emp_match:
            return {"answer": AI_SIMULATION_PREFIX + f"I couldn't uniquely identify the employee '{emp_part.strip()}'."}
        new_rate = float(rate_part)
        change_summary = f"change **{emp_match.name}**'s hourly rate from ${emp_match.hourly_rate:.2f} to **${new_rate:.2f}**"

    else:
        direction, emp_part, topic_part, delta_part = effort_match.groups()
        emp_match, _ = fuzzy_match_ambiguous(emp_part.strip(), employees, lambda e: e.name)
        if not emp_match:
            return {"answer": AI_SIMULATION_PREFIX + f"I couldn't uniquely identify the employee '{emp_part.strip()}'."}
        topic_match, _ = fuzzy_match_ambiguous(topic_part.strip(), topics, lambda t: t.name)
        if not topic_match:
            return {"answer": AI_SIMULATION_PREFIX + f"I couldn't uniquely identify the topic/project '{topic_part.strip()}'."}
        pct_delta = float(delta_part)
        current_pct = alloc_map.get((emp_match.id, topic_match.id), 0.0)
        pct = current_pct + pct_delta if direction == "increase" else current_pct - pct_delta
        pct = max(0.0, min(100.0, pct))
        change_summary = f"{direction} **{emp_match.name}**'s effort on **{topic_match.name}** by **{pct_delta:.1f}%** ({current_pct:.1f}% → {pct:.1f}%)"

    sandbox_name = f"{active_scenario.name} - AI What-If {datetime.datetime.utcnow().strftime('%H:%M:%S')}"
    sandbox = clone_scenario_data(
        db, active_scenario, sandbox_name,
        f"[Simulation Sandbox] Created by AI Copilot: {original_query.strip()[:200]}",
        activate=False
    )

    def sandbox_employee(name):
        return db.query(models.Employee).filter(models.Employee.scenario_id == sandbox.id, models.Employee.name == name, models.Employee.is_deleted == False).first()

    def sandbox_topic(name):
        return db.query(models.Topic).filter(models.Topic.scenario_id == sandbox.id, models.Topic.name == name, models.Topic.is_deleted == False).first()

    if set_match or effort_match:
        sb_emp, sb_topic = sandbox_employee(emp_match.name), sandbox_topic(topic_match.name)
        _apply_ai_allocation(db, sb_emp.id, sb_topic.id, pct)
    elif move_match:
        sb_emp = sandbox_employee(emp_match.name)
        sb_topic_from, sb_topic_to = sandbox_topic(topic_from_match.name), sandbox_topic(topic_to_match.name)
        _apply_ai_allocation(db, sb_emp.id, sb_topic_from.id, new_from)
        _apply_ai_allocation(db, sb_emp.id, sb_topic_to.id, new_to)
    elif add_emp_match:
        template_emp = next((e for e in employees if e.team.strip().lower() == new_emp_team.lower()), None)
        db.add(models.Employee(
            scenario_id=sandbox.id, name=new_emp_name, team=new_emp_team,
            department=template_emp.department if template_emp else "General",
            location=template_emp.location if template_emp else "Remote",
            available_hours=template_emp.available_hours if template_emp else 1800.0,
            hourly_rate=template_emp.hourly_rate if template_emp else 50.0,
            status="New Position"
        ))
        db.commit()
    elif rate_match:
        sb_emp = sandbox_employee(emp_match.name)
        sb_emp.hourly_rate = new_rate
        db.commit()

    write_system_log(
        db, username=current_user.username, action="AI What-If Simulation",
        details=f"Created sandbox '{sandbox.name}' via AI Copilot to {change_summary}"
    )

    active_report = build_dashboard_report(db, active_scenario)
    sandbox_report = build_dashboard_report(db, sandbox)
    cost_delta = sandbox_report["total_annual_planning_cost"] - active_report["total_annual_planning_cost"]
    overload_delta = len(sandbox_report["overloaded_employees"]) - len(active_report["overloaded_employees"])

    cost_line = f"cost {'increases' if cost_delta > 0 else 'decreases' if cost_delta < 0 else 'stays the same'} by ${abs(cost_delta):,.0f}"
    overload_line = (
        "no change in overloaded headcount" if overload_delta == 0
        else f"{abs(overload_delta)} {'more' if overload_delta > 0 else 'fewer'} employee(s) end up over 100% allocated"
    )

    return {
        "answer": AI_SIMULATION_PREFIX + f"I set up a private sandbox and simulated: {change_summary}. Result: {cost_line}, {overload_line}. Nothing has changed in the real plan yet.",
        "simulation": {"scenario_id": sandbox.id, "scenario_name": sandbox.name}
    }

@router.post("/ai/query")
def local_ai_query(payload: dict, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    query = payload.get("query", "").strip()
    history = payload.get("history", [])
    if not query:
        raise HTTPException(status_code=400, detail="Query is empty")
        
    out_of_scope_keywords = ["recipe", "capital of", "weather", "translate", "how to build a", "write a code", "python script", "javascript script", "history of", "who is the president", "poem", "joke"]
    planning_words = ["cost", "employee", "topic", "project", "allocat", "team", "recovery", "utiliz", "hour", "rate", "overload", "justif", "area", "cae", "test", "where", "who", "what", "budget"]
    
    q_lower = query.lower()
    is_out_of_scope = any(keyword in q_lower for keyword in out_of_scope_keywords)
    
    has_no_planning_terms = False
    if not history:
        has_no_planning_terms = not any(word in q_lower for word in planning_words)
    
    if is_out_of_scope or has_no_planning_terms:
        return {
            "answer": "I am a confidential resource planning assistant for Textron. "
                      "Under strict local guardrails, I am only authorized to answer planning, staffing, cost calculations, "
                      "and allocations questions based on the active scenario."
        }
        
    active_scenario = get_active_scenario_db(db)
    
    employees = db.query(models.Employee).filter(models.Employee.scenario_id == active_scenario.id, models.Employee.is_deleted == False).all()
    topics = db.query(models.Topic).filter(models.Topic.scenario_id == active_scenario.id, models.Topic.is_deleted == False).all()
    allocations = db.query(models.Allocation).join(models.Employee).join(models.Topic).filter(
        models.Employee.scenario_id == active_scenario.id,
        models.Employee.is_deleted == False,
        models.Topic.is_deleted == False
    ).all()

    alloc_map = {}
    emp_alloc_sums = {}
    for a in allocations:
        alloc_map[(a.employee_id, a.topic_id)] = a.percentage
        emp_alloc_sums[a.employee_id] = emp_alloc_sums.get(a.employee_id, 0.0) + a.percentage
        
    prefix = ""

    simulation_result = try_execute_ai_simulation(q_lower, query, employees, topics, alloc_map, db, current_user, active_scenario)
    if simulation_result:
        return simulation_result

    action_result = try_execute_ai_action(q_lower, employees, topics, alloc_map, db, current_user)
    if action_result:
        return action_result

    q_clean = q_lower.replace("rate higher than", "rate >").replace("rate lower than", "rate <").replace("hourly rate >", "rate >").replace("hourly rate <", "rate <").replace("rate above", "rate >").replace("rate below", "rate <").replace("rate more than", "rate >").replace("rate less than", "rate <")
    
    if "group by" in q_clean or "grouped by" in q_clean or "group rows by" in q_clean:
        group_target = "none"
        group_label = "default"
        if "team" in q_clean:
            group_target = "team"
            group_label = "Team"
        elif "location" in q_clean or "country" in q_clean or "region" in q_clean:
            group_target = "location"
            group_label = "Country (Location)"
        elif "topic" in q_clean or "project" in q_clean or "initiative" in q_clean:
            group_target = "topic"
            group_label = "Primary Topic"
            
        if group_target != "none":
            return {
                "answer": prefix + f"I have updated the allocation matrix to group rows by <strong>{group_label}</strong>.",
                "grouping": group_target
            }
            
    if "ungroup" in q_clean or "no grouping" in q_clean or "remove grouping" in q_clean:
        return {
            "answer": prefix + "I have removed all row grouping from the allocation matrix.",
            "grouping": "none"
        }

    if "clear filter" in q_clean or "reset filter" in q_clean or "show all" in q_clean:
        return {
            "answer": prefix + "I have reset all matrix filters to display the full dataset.",
            "filters": {
                "location": "",
                "team": "",
                "department": "",
                "category": "",
                "minRate": 0,
                "maxRate": 999999
            }
        }

    filter_loc = None
    unique_locs = list(set(e.location for e in employees))
    for loc in unique_locs:
        if loc.lower() in q_clean:
            filter_loc = loc
            break
            
    filter_team = None
    unique_teams = list(set(e.team for e in employees))
    for team in unique_teams:
        if team.lower() in q_clean:
            filter_team = team
            break
            
    filter_dept = None
    unique_depts = list(set(e.department for e in employees))
    for dept in unique_depts:
        if dept.lower() in q_clean:
            filter_dept = dept
            break
            
    filter_cat = None
    unique_cats = list(set(t.category for t in topics))
    for cat in unique_cats:
        if cat.lower() in q_clean:
            filter_cat = cat
            break
            
    filter_emp_search = None
    for e in employees:
        if e.name.lower() in q_clean:
            filter_emp_search = e.name
            break

    filter_min_util = None
    filter_max_util = None
    if "overloaded" in q_clean or re.search(r"(?:above|over|more than|higher than)\s*100\s*%?\s*(?:util|allocat)", q_clean):
        filter_min_util = 100.0
    util_gt = re.search(r"utili[sz]ation\s*(?:above|over|more than|higher than|>)\s*(\d+)", q_clean)
    if util_gt:
        filter_min_util = float(util_gt.group(1))
    util_lt = re.search(r"utili[sz]ation\s*(?:below|under|less than|<)\s*(\d+)", q_clean)
    if util_lt:
        filter_max_util = float(util_lt.group(1))

    filter_min_rate = None
    filter_max_rate = None

    rate_gt = re.search(r"rate\s*>\s*(\d+)", q_clean)
    if rate_gt:
        filter_min_rate = float(rate_gt.group(1))
    else:
        rate_gt_text = re.search(r"(?:higher than|above|greater than|more than|over)\s*(\d+)", q_clean)
        if rate_gt_text:
            filter_min_rate = float(rate_gt_text.group(1))
            
    rate_lt = re.search(r"rate\s*<\s*(\d+)", q_clean)
    if rate_lt:
        filter_max_rate = float(rate_lt.group(1))
    else:
        rate_lt_text = re.search(r"(?:lower than|below|less than|under)\s*(\d+)", q_clean)
        if rate_lt_text:
            filter_max_rate = float(rate_lt_text.group(1))

    if (filter_loc or filter_team or filter_dept or filter_cat or filter_emp_search
            or filter_min_rate is not None or filter_max_rate is not None
            or filter_min_util is not None or filter_max_util is not None):
        filters_to_apply = {}
        msg_parts = []

        matching_emps = []
        for e in employees:
            if filter_loc and e.location.lower() != filter_loc.lower(): continue
            if filter_team and e.team.lower() != filter_team.lower(): continue
            if filter_dept and e.department.lower() != filter_dept.lower(): continue
            if filter_emp_search and filter_emp_search.lower() not in e.name.lower(): continue
            if filter_min_rate is not None and e.hourly_rate < filter_min_rate: continue
            if filter_max_rate is not None and e.hourly_rate > filter_max_rate: continue
            emp_util = emp_alloc_sums.get(e.id, 0.0)
            if filter_min_util is not None and emp_util < filter_min_util: continue
            if filter_max_util is not None and emp_util > filter_max_util: continue
            matching_emps.append(e)

        if filter_emp_search:
            filters_to_apply["employeeSearch"] = filter_emp_search
            msg_parts.append(f"Employee: **{filter_emp_search}**")
        if filter_min_util is not None:
            filters_to_apply["minUtil"] = filter_min_util
            msg_parts.append(f"Utilization: **> {filter_min_util:.0f}%**")
        if filter_max_util is not None:
            filters_to_apply["maxUtil"] = filter_max_util
            msg_parts.append(f"Utilization: **< {filter_max_util:.0f}%**")
        if filter_loc:
            filters_to_apply["location"] = filter_loc
            msg_parts.append(f"Location: **{filter_loc}**")
        if filter_team:
            filters_to_apply["team"] = filter_team
            msg_parts.append(f"Team: **{filter_team}**")
        if filter_dept:
            filters_to_apply["department"] = filter_dept
            msg_parts.append(f"Department: **{filter_dept}**")
        if filter_cat:
            filters_to_apply["category"] = filter_cat
            msg_parts.append(f"Topic Category: **{filter_cat}**")
        if filter_min_rate is not None:
            filters_to_apply["minRate"] = filter_min_rate
            msg_parts.append(f"Hourly Rate: **> {filter_min_rate} USD**")
        if filter_max_rate is not None:
            filters_to_apply["maxRate"] = filter_max_rate
            msg_parts.append(f"Hourly Rate: **< {filter_max_rate} USD**")
            
        filters_list_str = ", ".join(msg_parts)
        
        if matching_emps:
            staff_details = []
            for e in matching_emps:
                staff_details.append(f"* **{e.name}** ({e.team}, {e.location}) - Hourly Rate: ${e.hourly_rate}/hr, Utilization: {emp_alloc_sums.get(e.id, 0.0):.1f}%")
            nl = "\n"
            answer_text = (
                f"{prefix}Applied filters to Allocation Matrix: {filters_list_str}.\n\n"
                f"Here are the **{len(matching_emps)}** matching employees currently visualised in the matrix:\n"
                f"{nl.join(staff_details)}\n\n"
                f"Would you like to update the Resource Allocation Matrix in the background with these filters?"
            )
        else:
            answer_text = (
                f"{prefix}Applied filters to Allocation Matrix: {filters_list_str}.\n\n"
                f"No employees matched these criteria.\n\n"
                f"Would you like to update the Resource Allocation Matrix in the background (showing 0 matches)?"
            )
            
        return {
            "answer": answer_text,
            "filters": filters_to_apply
        }

    if history:
        last_assistant_msg = ""
        for msg in reversed(history):
            if msg.get("role") == "assistant":
                last_assistant_msg = msg.get("content", "")
                break
                
        if last_assistant_msg and "Did you mean:" in last_assistant_msg:
            lines = last_assistant_msg.split("\n")
            candidates = []
            for line in lines:
                if line.strip().startswith("*"):
                    cand = line.replace("*", "").replace("[Local Heuristic Engine Fallback]", "").strip()
                    if cand:
                        candidates.append(cand)
            
            if candidates:
                user_sel = q_lower.strip()
                matched_candidate_strs = []
                
                if any(x in user_sel for x in ["all", "both", "every", "each"]):
                    matched_candidate_strs = candidates
                else:
                    num_map = {
                        "first": 0, "1": 0, "one": 0,
                        "second": 1, "2": 1, "two": 1,
                        "third": 2, "3": 2, "three": 2,
                        "fourth": 3, "4": 3, "four": 3,
                    }
                    for word, idx in num_map.items():
                        if word == user_sel or f"the {word}" in user_sel:
                            if idx < len(candidates):
                                matched_candidate_strs = [candidates[idx]]
                                break
                                
                    if not matched_candidate_strs:
                        cand_match, _ = fuzzy_match_ambiguous(user_sel, candidates, lambda x: x)
                        if cand_match:
                            matched_candidate_strs = [cand_match]
                            
                if matched_candidate_strs:
                    results = []
                    for cand_str in matched_candidate_strs:
                        if ":" in cand_str:
                            c_type, c_val = cand_str.split(":", 1)
                            c_type = c_type.strip().lower()
                            c_val = c_val.strip()
                        else:
                            c_type = "unknown"
                            c_val = cand_str.strip()
                            
                        if "location" in c_type:
                            matched_emps = [e for e in employees if e.location.lower() == c_val.lower()]
                            staff_list = [f"**{e.name}** ({e.team}) - {emp_alloc_sums.get(e.id, 0.0):.1f}% utilization" for e in matched_emps]
                            nl = "\n"
                            res = f"**Location: {c_val}** staff:\n" + (nl.join(staff_list) if staff_list else "No planned staff.")
                            results.append(res)
                        elif "team" in c_type:
                            matched_emps = [e for e in employees if e.team.lower() == c_val.lower()]
                            staff_list = [f"**{e.name}** - {emp_alloc_sums.get(e.id, 0.0):.1f}% utilization" for e in matched_emps]
                            nl = "\n"
                            res = f"**Team: {c_val}** members:\n" + (nl.join(staff_list) if staff_list else "No planned staff.")
                            results.append(res)
                        elif "topic" in c_type or "project" in c_type:
                            topic = next((t for t in topics if t.name.lower() == c_val.lower()), None)
                            if topic:
                                allocated_staff = []
                                for emp in employees:
                                    pct = alloc_map.get((emp.id, topic.id), 0.0)
                                    if pct > 0.0:
                                        allocated_staff.append(f"**{emp.name}** ({emp.team}) - {pct}% allocation")
                                nl = "\n"
                                res = f"**Topic: {topic.name}** staff:\n" + (nl.join(allocated_staff) if allocated_staff else "No allocated staff.")
                                results.append(res)
                            else:
                                results.append(f"Could not resolve project '{c_val}'.")
                                
                    nl_double = "\n\n"
                    return {"answer": prefix + f"Here are the details for your selection:\n\n{nl_double.join(results)}"}

    rag_context = get_planning_rag_context(db, active_scenario.id)
    
    history_context = ""
    if history:
        history_context = "Conversation History:\n"
        for h in history:
            role_name = "User" if h.get("role") == "user" else "Assistant"
            history_context += f"{role_name}: {h.get('content')}\n"
        history_context += "\n"
        
    system_prompt = (
        "You are the Textron engineering planning AI assistant. You run locally and confidentially on Textron's server.\n"
        "Here are your STRICT rules and guardrails:\n"
        "1. CONFIDENTIALITY: Do not try to access external APIs or search engines. Never reveal user passwords.\n"
        "2. SCOPE: Answer ONLY questions related to resource planning, employees, cost calculation, allocations, and topics/projects "
        "found in the context data. Decline answering unrelated general questions by stating: 'I am a confidential resource planning assistant for Textron. That query is outside my planning scope.'\n"
        "3. FACTUALITY: Base all statistics, costs, and allocations strictly on the provided context. If the data does not contain the answer, "
        "say: 'I cannot find that in the active planning dataset.' Do not make up or assume any values.\n"
        "4. FORMATTING: Return answers in a clear, concise bulleted or tabular format.\n"
        "5. HUMAN-LIKE UNDERSTANDING & CLARIFICATION: Be flexible with spelling, typos, abbreviations, or partial names. If a name, project, or location matches multiple potential entries, do not guess: list the matching candidates and ask the user to clarify between them. Otherwise, if there is a unique best match, present the answer.\n\n"
        f"Context:\n{rag_context}\n\n"
        f"{history_context}"
        f"User Question: {query}\n"
        "Answer:"
    )
    
    ollama_answer = query_local_ollama(system_prompt)
    if ollama_answer:
        return {"answer": ollama_answer}

    q = query.lower().rstrip("?.! ")
    
    match_who = re.search(r"(?:who is working on|who works on|who is allocated to|who is working in|who works in|who is located in|who is on|who works for|employees in|staff in|employees on|staff on)\s+(.+)", q)
    if match_who:
        target = match_who.group(1).strip().replace("project", "").replace("team", "").strip()
        
        unique_locs = list(set(e.location for e in employees))
        loc_match, loc_cands = fuzzy_match_ambiguous(target, unique_locs, lambda l: l)
        
        unique_teams = list(set(e.team for e in employees))
        team_match, team_cands = fuzzy_match_ambiguous(target, unique_teams, lambda t: t)
        
        topic_match, topic_cands = fuzzy_match_ambiguous(target, topics, lambda t: t.name + " " + t.category)
        
        matches = []
        if loc_match: matches.append(("location", loc_match))
        if team_match: matches.append(("team", team_match))
        if topic_match: matches.append(("topic", topic_match))
        
        cands = []
        if loc_cands: cands.extend(("location", c) for c in loc_cands)
        if team_cands: cands.extend(("team", c) for c in team_cands)
        if topic_cands: cands.extend(("topic", c) for c in topic_cands)
        
        if len(matches) == 0 and len(cands) == 0:
            return {"answer": prefix + f"I couldn't find any location, team, or project matching '{target}'."}
            
        if len(cands) > 0 or len(matches) > 1:
            all_options = []
            for m_type, item in matches:
                name = item if m_type == "location" else (item.team if m_type == "team" else item.name)
                all_options.append(f"{m_type.capitalize()}: **{name}**")
            for c_type, item in cands:
                name = item if c_type == "location" else (item if isinstance(item, str) else item.name)
                all_options.append(f"{c_type.capitalize()}: **{name}**")
            c_str = "\n".join(f"* {opt}" for opt in set(all_options))
            return {"answer": prefix + f"I found multiple matches for '{target}'. Did you mean:\n{c_str}\nPlease clarify your query."}
            
        m_type, item = matches[0]
        if m_type == "location":
            matched_emps = [e for e in employees if e.location == item]
            staff_list = [f"**{e.name}** ({e.team}) - {emp_alloc_sums.get(e.id, 0.0):.1f}% utilization" for e in matched_emps]
            nl = "\n"
            return {"answer": prefix + f"Here are the employees working in location **{item}**:\n\n{nl.join(staff_list)}" if staff_list else prefix + f"No employees are currently planned in location **{item}**."}
            
        elif m_type == "team":
            matched_emps = [e for e in employees if e.team == item]
            staff_list = [f"**{e.name}** - {emp_alloc_sums.get(e.id, 0.0):.1f}% utilization" for e in matched_emps]
            nl = "\n"
            return {"answer": prefix + f"Here are the employees working on team **{item}**:\n\n{nl.join(staff_list)}" if staff_list else prefix + f"No employees are currently planned on team **{item}**."}
            
        elif m_type == "topic":
            allocated_staff = []
            for emp in employees:
                pct = alloc_map.get((emp.id, item.id), 0.0)
                if pct > 0.0:
                    allocated_staff.append(f"**{emp.name}** ({emp.team}) - {pct}% allocation")
            nl = "\n"
            return {"answer": prefix + f"Here are the employees working on topic **{item.name}**:\n\n{nl.join(allocated_staff)}" if allocated_staff else prefix + f"Currently, no employees are allocated to **{item.name}**."}

    match_what_topics = re.search(r"(?:what projects|what topics|list projects|list topics|projects in|topics in|projects of|topics of|projects on|topics on)\s+(.+)", q)
    if match_what_topics:
        target = match_what_topics.group(1).strip().replace("location", "").replace("category", "").strip()
        
        unique_locs = list(set(e.location for e in employees))
        loc_match, loc_cands = fuzzy_match_ambiguous(target, unique_locs, lambda l: l)
        
        unique_cats = list(set(t.category for t in topics))
        cat_match, cat_cands = fuzzy_match_ambiguous(target, unique_cats, lambda c: c)
        
        matches = []
        if loc_match: matches.append(("location", loc_match))
        if cat_match: matches.append(("category", cat_match))
        
        cands = []
        if loc_cands: cands.extend(("location", c) for c in loc_cands)
        if cat_cands: cands.extend(("category", c) for c in cat_cands)
        
        if len(matches) == 0 and len(cands) == 0:
            return {"answer": prefix + f"I couldn't find any location or topic category matching '{target}'."}
            
        if len(cands) > 0 or len(matches) > 1:
            all_options = []
            for m_type, item in matches:
                all_options.append(f"{m_type.capitalize()}: **{item}**")
            for c_type, item in cands:
                all_options.append(f"{c_type.capitalize()}: **{item}**")
            c_str = "\n".join(f"* {opt}" for opt in set(all_options))
            return {"answer": prefix + f"I found multiple matches for '{target}'. Did you mean:\n{c_str}\nPlease clarify your query."}
            
        m_type, item = matches[0]
        if m_type == "location":
            loc_emps = [e for e in employees if e.location == item]
            loc_emp_ids = set(e.id for e in loc_emps)
            loc_topics = []
            for t in topics:
                allocated = any(alloc_map.get((emp_id, t.id), 0.0) > 0 for emp_id in loc_emp_ids)
                if allocated:
                    loc_topics.append(t)
                    
            if not loc_topics:
                return {"answer": prefix + f"No topics have allocations from the **{item}** location."}
            t_list = [f"* **{t.name}** ({t.category}) - recovery: ${t.recovery:,.0f}" for t in loc_topics]
            nl = "\n"
            return {"answer": prefix + f"Here are the active topics/projects planned in location **{item}**:\n\n{nl.join(t_list)}"}
            
        elif m_type == "category":
            cat_topics = [t for t in topics if t.category == item]
            if not cat_topics:
                return {"answer": prefix + f"No topics found in category **{item}**."}
            t_list = [f"* **{t.name}** ({t.area}) - recovery: ${t.recovery:,.0f}" for t in cat_topics]
            nl = "\n"
            return {"answer": prefix + f"Here are the topics/projects belonging to category **{item}**:\n\n{nl.join(t_list)}"}

    match_cost = re.search(r"(?:total cost of|cost of topic|cost of project|what does)\s+(.+?)(?:\s+cost)?$", q)
    if match_cost:
        target = match_cost.group(1).strip().replace("project", "").strip()
        topic, candidates = fuzzy_match_ambiguous(target, topics, lambda t: t.name)
        if candidates:
            c_str = "\n".join(f"* **{c.name}**" for c in candidates)
            return {"answer": prefix + f"I found multiple topics matching '{target}'. Did you mean:\n{c_str}\nPlease clarify your query."}
        if topic:
            emp_cost = sum(emp.available_hours * emp.hourly_rate * (alloc_map.get((emp.id, topic.id), 0.0) / 100.0) for emp in employees)
            add_int = sum(cost.amount for cost in topic.additional_costs if cost.cost_type == "internal")
            ext_cost = sum(cost.amount for cost in topic.additional_costs if cost.cost_type == "external")
            total = emp_cost + add_int + ext_cost - topic.recovery
            
            return {
                "answer": prefix + f"The total planning cost for **{topic.name}** is **${total:,.2f} USD**.\n\n"
                                   f"* *Internal Staff Cost*: ${emp_cost:,.2f} USD\n"
                                   f"* *Additional Internal Cost*: ${add_int:,.2f} USD\n"
                                   f"* *External Cost*: ${ext_cost:,.2f} USD\n"
                                   f"* *Cost Recovery*: +${topic.recovery:,.2f} USD"
            }

    if any(x in q for x in ["overloaded", "over-allocated", "above 100%", "overutilised", "overutilized"]):
        overloaded = []
        for emp in employees:
            tot = emp_alloc_sums.get(emp.id, 0.0)
            if tot > 100.0:
                overloaded.append(f"**{emp.name}** ({emp.team}) - **{tot:.1f}%** total utilization")
        if overloaded:
            nl = "\n"
            return {"answer": prefix + f"The following employees are overloaded (utilization > 100%):\n\n{nl.join(overloaded)}"}
        else:
            return {"answer": prefix + "Excellent! No employees are overloaded in the current active scenario."}

    match_loc = re.search(r"cost of location\s+(.+)", q) or re.search(r"location\s+(.+)\s+cost", q)
    if match_loc:
        loc = match_loc.group(1).strip()
        unique_locs = list(set(e.location for e in employees))
        loc_match, candidates = fuzzy_match_ambiguous(loc, unique_locs, lambda l: l)
        if candidates:
            c_str = "\n".join(f"* **{c}**" for c in candidates)
            return {"answer": prefix + f"I found multiple locations matching '{loc}'. Did you mean:\n{c_str}\nPlease clarify your query."}
        if not loc_match:
            return {"answer": prefix + f"I couldn't find any data for location '{loc}'."}
        
        matched_emps = [e for e in employees if e.location == loc_match]
        loc_cost = 0.0
        for emp in matched_emps:
            for topic in topics:
                pct = alloc_map.get((emp.id, topic.id), 0.0)
                loc_cost += emp.available_hours * emp.hourly_rate * (pct / 100.0)
        return {"answer": prefix + f"The total internal employee cost generated by the **{loc_match}** hub is **${loc_cost:,.2f} USD**."}

    match_team = re.search(r"cost of team\s+(.+)", q) or re.search(r"team\s+(.+)\s+cost", q)
    if match_team:
        team_search = match_team.group(1).strip()
        unique_teams = list(set(e.team for e in employees))
        team_match, candidates = fuzzy_match_ambiguous(team_search, unique_teams, lambda t: t)
        if candidates:
            c_str = "\n".join(f"* **{c}**" for c in candidates)
            return {"answer": prefix + f"I found multiple teams matching '{team_search}'. Did you mean:\n{c_str}\nPlease clarify your query."}
        if not team_match:
            return {"answer": prefix + f"I couldn't find any team matching '{team_search}'."}
            
        team_cost = 0.0
        team_members = [e for e in employees if e.team == team_match]
        for emp in team_members:
            for topic in topics:
                pct = alloc_map.get((emp.id, topic.id), 0.0)
                team_cost += emp.available_hours * emp.hourly_rate * (pct / 100.0)
        return {"answer": prefix + f"The total cost generated by team **{team_match}** is **${team_cost:,.2f} USD** across {len(team_members)} planned members."}

    if "cae cost" in q or "cost of cae" in q or "cae topic" in q:
        cae_cost = 0.0
        for emp in employees:
            for topic in topics:
                if "cae" in topic.name.lower() or "cae" in topic.category.lower() or "cae" in emp.department.lower():
                    pct = alloc_map.get((emp.id, topic.id), 0.0)
                    cae_cost += emp.available_hours * emp.hourly_rate * (pct / 100.0)
        return {"answer": prefix + f"The total estimated cost for all **CAE-related** planning activities is **${cae_cost:,.2f} USD**."}

    if "test cost" in q or "cost of test" in q or "test topic" in q:
        test_cost = 0.0
        for emp in employees:
            for topic in topics:
                if "test" in topic.name.lower() or "test" in topic.category.lower() or "test" in emp.department.lower():
                    pct = alloc_map.get((emp.id, topic.id), 0.0)
                    test_cost += emp.available_hours * emp.hourly_rate * (pct / 100.0)
        return {"answer": prefix + f"The total estimated cost for all **Test-related** planning activities is **${test_cost:,.2f} USD**."}

    unique_locs = list(set(e.location for e in employees))
    unique_teams = list(set(e.team for e in employees))

    def find_entity_in_query(text, choices):
        best, best_len = None, 0
        for choice in choices:
            c_lower = choice.lower()
            if c_lower and c_lower in text and len(c_lower) > best_len:
                best, best_len = choice, len(c_lower)
        return best

    loc_hit = find_entity_in_query(q, unique_locs)
    team_hit = None if loc_hit else find_entity_in_query(q, unique_teams)
    topic_hit, topic_hit_candidates = (None, [])
    if not loc_hit and not team_hit:
        topic_hit, topic_hit_candidates = fuzzy_match_ambiguous(q, topics, lambda t: t.name, threshold=0.35)

    if topic_hit_candidates:
        c_str = "\n".join(f"* Topic/Project: **{c.name}**" for c in topic_hit_candidates)
        return {"answer": prefix + f"I found multiple projects matching your question. Did you mean:\n{c_str}\nPlease clarify your query."}

    if loc_hit or team_hit or topic_hit:
        if loc_hit:
            matched_emps = [e for e in employees if e.location == loc_hit]
            entity_label = f"location **{loc_hit}**"
        elif team_hit:
            matched_emps = [e for e in employees if e.team == team_hit]
            entity_label = f"team **{team_hit}**"
        else:
            matched_emps = [e for e in employees if alloc_map.get((e.id, topic_hit.id), 0.0) > 0]
            entity_label = f"topic **{topic_hit.name}**"

        cost_intent = any(w in q for w in ["cost", "budget", "spend", "expense"])
        count_intent = any(w in q for w in ["how many", "count", "number of"])
        people_intent = any(w in q for w in ["name", "names", "who", "people", "employee", "staff", "member"])

        if cost_intent and not people_intent:
            cost_total = sum(
                emp.available_hours * emp.hourly_rate * (alloc_map.get((emp.id, t.id), 0.0) / 100.0)
                for emp in matched_emps for t in topics
            )
            return {"answer": prefix + f"The total cost associated with {entity_label} is **${cost_total:,.2f} USD**."}

        if count_intent and not people_intent:
            return {"answer": prefix + f"There are **{len(matched_emps)}** employees associated with {entity_label}."}

        if matched_emps:
            names_list = "\n".join(f"* **{e.name}** ({e.team}) - {emp_alloc_sums.get(e.id, 0.0):.1f}% utilization" for e in matched_emps)
            return {"answer": prefix + f"Here are the people working on {entity_label}:\n\n{names_list}"}
        return {"answer": prefix + f"No employees are currently planned for {entity_label}."}

    emp, emp_candidates = fuzzy_match_ambiguous(q, employees, lambda e: e.name)
    topic, topic_candidates = fuzzy_match_ambiguous(q, topics, lambda t: t.name)
    
    if emp_candidates or topic_candidates:
        all_candidates = []
        if emp_candidates:
            all_candidates.extend(f"Employee: **{c.name}**" for c in emp_candidates)
        if topic_candidates:
            all_candidates.extend(f"Topic/Project: **{c.name}**" for c in topic_candidates)
        c_str = "\n".join(all_candidates)
        return {"answer": prefix + f"I found multiple matches for '{query}'. Did you mean:\n{c_str}\nPlease clarify your query."}
        
    if emp:
        tot = emp_alloc_sums.get(emp.id, 0.0)
        cost_contrib = sum(emp.available_hours * emp.hourly_rate * (alloc_map.get((emp.id, t.id), 0.0) / 100.0) for t in topics)
        return {
            "answer": prefix + f"Here is the summary for employee **{emp.name}**:\n"
                               f"* *Team/Location*: {emp.team} / {emp.location}\n"
                               f"* *Hourly Rate*: ${emp.hourly_rate:.2f} USD/hr\n"
                               f"* *Annual Available Hours*: {emp.available_hours:.1f} hrs\n"
                               f"* *Total Utilization*: **{tot:.1f}%**\n"
                               f"* *Total Allocated Cost*: **${cost_contrib:,.2f} USD**"
        }
        
    if topic:
        emp_cost = sum(emp.available_hours * emp.hourly_rate * (alloc_map.get((emp.id, topic.id), 0.0) / 100.0) for emp in employees)
        return {
            "answer": prefix + f"Here is the summary for topic **{topic.name}**:\n"
                               f"* *Category/Area*: {topic.category} / {topic.area}\n"
                               f"* *Internal Staff Cost*: ${emp_cost:,.2f} USD\n"
                               f"* *Recovery/Savings*: +${topic.recovery:,.2f} USD\n"
                               f"* *Description*: {topic.description or 'No description'}"
        }

    return {
        "answer": prefix + "I want to help, but I'm not sure exactly what you're asking. Could you clarify?\n\n"
                           "* Are you asking about **people/staff**, **costs**, or **projects/topics**?\n"
                           "* Could you mention a specific **team**, **location**, or **project name**?\n\n"
                           "For example: *'Who is working in Romania?'*, *'What is the cost of the Fuel project?'*, or *'List overloaded employees'*."
    }
