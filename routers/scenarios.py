from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from dependencies import (
    get_current_user,
    require_admin,
    require_master,
    write_system_log,
    get_active_scenario_db,
)

router = APIRouter(prefix="/api", tags=["scenarios"])

@router.post("/admin/reset-demo")
def reset_demo_data(db: Session = Depends(get_db), current_user: models.User = Depends(require_master)):
    try:
        import seed_data
        seed_data.seed()
        write_system_log(db, username=current_user.username, action="Reset Demo", details="Completely reset demo database to pristine seeded state")
        return {"status": "success", "message": "Demo data reset successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset demo: {str(e)}")

@router.get("/scenarios", response_model=List[schemas.ScenarioResponse])
def get_scenarios(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Scenario).all()

@router.get("/scenarios/active", response_model=schemas.ScenarioResponse)
def get_active_scenario(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return get_active_scenario_db(db)

@router.post("/scenarios/active/{scenario_id}")
def set_active_scenario(scenario_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    previous = db.query(models.Scenario).filter(models.Scenario.is_active == True).first()
    db.query(models.Scenario).update({models.Scenario.is_active: False})
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        db.rollback()
        raise HTTPException(status_code=404, detail="Scenario not found")
    scenario.is_active = True
    db.commit()
    write_system_log(
        db, username=current_user.username, action="Switch Active Scenario",
        details=f"Switched active planning version from '{previous.name if previous else 'none'}' to '{scenario.name}'"
    )
    return {"message": f"Active scenario switched to: {scenario.name}", "scenario": scenario}

@router.post("/scenarios", response_model=schemas.ScenarioResponse)
def create_scenario(scenario: schemas.ScenarioCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db.query(models.Scenario).update({models.Scenario.is_active: False})

    db_scenario = models.Scenario(
        name=scenario.name,
        description=scenario.description,
        is_active=True
    )
    db.add(db_scenario)
    db.commit()
    db.refresh(db_scenario)
    write_system_log(db, username=admin.username, action="Create Scenario", details=f"Created new planning version '{db_scenario.name}'")
    return db_scenario

def clone_scenario_data(db: Session, source_scenario: models.Scenario, new_name: str, new_description: Optional[str], activate: bool) -> models.Scenario:
    if activate:
        db.query(models.Scenario).update({models.Scenario.is_active: False})

    new_scenario = models.Scenario(
        name=new_name,
        description=new_description or f"Clone of {source_scenario.name}",
        is_active=activate
    )
    db.add(new_scenario)
    db.commit()
    db.refresh(new_scenario)

    db_employees = db.query(models.Employee).filter(models.Employee.scenario_id == source_scenario.id, models.Employee.is_deleted == False).all()
    emp_id_mapping = {}
    for emp in db_employees:
        new_emp = models.Employee(
            scenario_id=new_scenario.id,
            name=emp.name,
            team=emp.team,
            department=emp.department,
            location=emp.location,
            available_hours=emp.available_hours,
            hourly_rate=emp.hourly_rate,
            status=emp.status,
            manager=emp.manager,
            notes=emp.notes
        )
        db.add(new_emp)
        db.commit()
        db.refresh(new_emp)
        emp_id_mapping[emp.id] = new_emp.id

    db_topics = db.query(models.Topic).filter(models.Topic.scenario_id == source_scenario.id, models.Topic.is_deleted == False).all()
    topic_id_mapping = {}
    for topic in db_topics:
        new_topic = models.Topic(
            scenario_id=new_scenario.id,
            name=topic.name,
            category=topic.category,
            area=topic.area,
            description=topic.description,
            objective=topic.objective,
            deliverables=topic.deliverables,
            justification=topic.justification,
            status=topic.status,
            comments=topic.comments,
            notes=topic.notes,
            recovery=topic.recovery
        )
        db.add(new_topic)
        db.commit()
        db.refresh(new_topic)
        topic_id_mapping[topic.id] = new_topic.id

        for cost in topic.additional_costs:
            new_cost = models.AdditionalCost(
                topic_id=new_topic.id,
                cost_type=cost.cost_type,
                category=cost.category,
                amount=cost.amount,
                notes=cost.notes
            )
            db.add(new_cost)
        db.commit()

    for old_emp_id, new_emp_id in emp_id_mapping.items():
        old_allocations = db.query(models.Allocation).filter(models.Allocation.employee_id == old_emp_id).all()
        for alloc in old_allocations:
            if alloc.topic_id in topic_id_mapping:
                new_alloc = models.Allocation(
                    employee_id=new_emp_id,
                    topic_id=topic_id_mapping[alloc.topic_id],
                    percentage=alloc.percentage,
                    comment=alloc.comment
                )
                db.add(new_alloc)
        db.commit()

    return new_scenario

@router.post("/scenarios/{scenario_id}/clone", response_model=schemas.ScenarioResponse)
def clone_scenario(scenario_id: int, clone_data: schemas.ScenarioClone, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    source_scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not source_scenario:
        raise HTTPException(status_code=404, detail="Source scenario not found")

    new_scenario = clone_scenario_data(db, source_scenario, clone_data.new_name, clone_data.new_description, clone_data.activate)

    write_system_log(
        db, username=admin.username, action="Clone Scenario",
        details=f"Cloned '{source_scenario.name}' into new planning version '{new_scenario.name}'" + (" (sandbox, not activated)" if not clone_data.activate else "")
    )
    return new_scenario

@router.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    was_active = scenario.is_active
    deleted_name = scenario.name
    db.delete(scenario)
    db.commit()

    if was_active:
        next_scenario = db.query(models.Scenario).first()
        if next_scenario:
            next_scenario.is_active = True
            db.commit()

    write_system_log(db, username=admin.username, action="Delete Scenario", details=f"Deleted planning version '{deleted_name}'")
    return {"message": "Scenario deleted successfully"}

@router.get("/scenarios/{scenario_id}/backup")
def backup_scenario(scenario_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
        
    employees = db.query(models.Employee).filter(models.Employee.scenario_id == scenario_id, models.Employee.is_deleted == False).all()
    topics = db.query(models.Topic).filter(models.Topic.scenario_id == scenario_id, models.Topic.is_deleted == False).all()

    emp_ids = [e.id for e in employees]
    topic_ids = [t.id for t in topics]

    allocations = db.query(models.Allocation).filter(
        models.Allocation.employee_id.in_(emp_ids) if emp_ids else False
    ).all()
    
    additional_costs = db.query(models.AdditionalCost).filter(
        models.AdditionalCost.topic_id.in_(topic_ids) if topic_ids else False
    ).all()
    
    data = {
        "version": "1.0",
        "name": scenario.name,
        "description": scenario.description or "",
        "employees": [
            {
                "name": e.name,
                "team": e.team,
                "department": e.department,
                "location": e.location,
                "available_hours": e.available_hours,
                "hourly_rate": e.hourly_rate,
                "manager": e.manager,
                "status": e.status,
                "notes": e.notes
            } for e in employees
        ],
        "topics": [
            {
                "name": t.name,
                "category": t.category,
                "area": t.area,
                "description": t.description,
                "objective": t.objective,
                "deliverables": t.deliverables,
                "justification": t.justification,
                "status": t.status,
                "comments": t.comments,
                "notes": t.notes,
                "recovery": t.recovery
            } for t in topics
        ],
        "allocations": [
            {
                "employee_name": next((e.name for e in employees if e.id == a.employee_id), None),
                "topic_name": next((t.name for t in topics if t.id == a.topic_id), None),
                "percentage": a.percentage,
                "comment": a.comment
            } for a in allocations
        ],
        "additional_costs": [
            {
                "topic_name": next((t.name for t in topics if t.id == c.topic_id), None),
                "cost_type": c.cost_type,
                "category": c.category,
                "amount": c.amount,
                "notes": c.notes
            } for c in additional_costs
        ]
    }
    
    write_system_log(
        db,
        username=current_user.username,
        action="Export Report",
        details=f"Exported JSON backup for scenario '{scenario.name}'"
    )
    return data

@router.post("/scenarios/{scenario_id}/restore")
def restore_scenario(scenario_id: int, payload: schemas.RestorePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
        
    db_employees = db.query(models.Employee).filter(models.Employee.scenario_id == scenario_id).all()
    db_topics = db.query(models.Topic).filter(models.Topic.scenario_id == scenario_id).all()
    
    emp_ids = [e.id for e in db_employees]
    topic_ids = [t.id for t in db_topics]
    
    if emp_ids:
        db.query(models.Allocation).filter(models.Allocation.employee_id.in_(emp_ids)).delete(synchronize_session=False)
    if topic_ids:
        db.query(models.AdditionalCost).filter(models.AdditionalCost.topic_id.in_(topic_ids)).delete(synchronize_session=False)
        
    db.query(models.Employee).filter(models.Employee.scenario_id == scenario_id).delete(synchronize_session=False)
    db.query(models.Topic).filter(models.Topic.scenario_id == scenario_id).delete(synchronize_session=False)
    db.commit()
    
    scenario.name = payload.name
    scenario.description = payload.description
    db.commit()
    
    emp_name_map = {}
    for emp_data in payload.employees:
        emp = models.Employee(
            name=emp_data["name"],
            team=emp_data.get("team", "General"),
            department=emp_data.get("department", "General"),
            location=emp_data.get("location", "US"),
            available_hours=emp_data.get("available_hours", 1800.0),
            hourly_rate=emp_data.get("hourly_rate", 50.0),
            manager=emp_data.get("manager"),
            status=emp_data.get("status", "Active"),
            notes=emp_data.get("notes"),
            scenario_id=scenario_id
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        emp_name_map[emp.name] = emp.id
        
    topic_name_map = {}
    for topic_data in payload.topics:
        topic = models.Topic(
            name=topic_data["name"],
            category=topic_data.get("category", "General"),
            area=topic_data.get("area"),
            description=topic_data.get("description"),
            objective=topic_data.get("objective"),
            deliverables=topic_data.get("deliverables"),
            justification=topic_data.get("justification"),
            status=topic_data.get("status", "Active"),
            comments=topic_data.get("comments"),
            notes=topic_data.get("notes"),
            recovery=topic_data.get("recovery", 0.0),
            scenario_id=scenario_id
        )
        db.add(topic)
        db.commit()
        db.refresh(topic)
        topic_name_map[topic.name] = topic.id

    for alloc_data in payload.allocations:
        emp_id = emp_name_map.get(alloc_data["employee_name"])
        topic_id = topic_name_map.get(alloc_data["topic_name"])
        if emp_id and topic_id:
            alloc = models.Allocation(
                employee_id=emp_id,
                topic_id=topic_id,
                percentage=alloc_data["percentage"],
                comment=alloc_data.get("comment", "")
            )
            db.add(alloc)

    for cost_data in payload.additional_costs:
        topic_id = topic_name_map.get(cost_data["topic_name"])
        if topic_id:
            ac = models.AdditionalCost(
                topic_id=topic_id,
                cost_type=cost_data["cost_type"],
                category=cost_data.get("category", "Other"),
                amount=cost_data.get("amount", 0.0),
                notes=cost_data.get("notes")
            )
            db.add(ac)
            
    db.commit()
    write_system_log(
        db,
        username=current_user.username,
        action="Import CSV",
        details=f"Restored scenario '{scenario.name}' from JSON backup"
    )
    return {"status": "success", "message": f"Successfully restored scenario '{scenario.name}'"}
