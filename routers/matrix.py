import datetime
from typing import List
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

router = APIRouter(prefix="/api", tags=["matrix"])

# EMPLOYEES API
@router.get("/employees", response_model=List[schemas.EmployeeResponse])
def get_employees(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    active_scenario = get_active_scenario_db(db)
    return db.query(models.Employee).filter(
        models.Employee.scenario_id == active_scenario.id,
        models.Employee.is_deleted == False
    ).all()

@router.post("/employees", response_model=schemas.EmployeeResponse)
def create_employee(employee: schemas.EmployeeCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    active_scenario = get_active_scenario_db(db)
    db_employee = models.Employee(
        scenario_id=active_scenario.id,
        name=employee.name,
        team=employee.team,
        department=employee.department,
        location=employee.location,
        available_hours=employee.available_hours,
        hourly_rate=employee.hourly_rate,
        status=employee.status,
        manager=employee.manager,
        notes=employee.notes
    )
    db.add(db_employee)
    db.commit()
    db.refresh(db_employee)
    return db_employee

@router.get("/scenarios/{scenario_id}/employees", response_model=List[schemas.EmployeeResponse])
def get_scenario_employees(scenario_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return db.query(models.Employee).filter(
        models.Employee.scenario_id == scenario_id,
        models.Employee.is_deleted == False
    ).all()

@router.post("/scenarios/{scenario_id}/employees", response_model=schemas.EmployeeResponse)
def create_scenario_employee(scenario_id: int, employee: schemas.EmployeeCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    db_employee = models.Employee(
        scenario_id=scenario_id,
        name=employee.name,
        team=employee.team,
        department=employee.department,
        location=employee.location,
        available_hours=employee.available_hours,
        hourly_rate=employee.hourly_rate,
        status=employee.status,
        manager=employee.manager,
        notes=employee.notes
    )
    db.add(db_employee)
    db.commit()
    db.refresh(db_employee)
    return db_employee

@router.put("/employees/{employee_id}", response_model=schemas.EmployeeResponse)
def update_employee(employee_id: int, employee: schemas.EmployeeCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_employee = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    db_employee.name = employee.name
    db_employee.team = employee.team
    db_employee.department = employee.department
    db_employee.location = employee.location
    db_employee.available_hours = employee.available_hours
    db_employee.hourly_rate = employee.hourly_rate
    db_employee.status = employee.status
    db_employee.manager = employee.manager
    db_employee.notes = employee.notes
    
    db.commit()
    db.refresh(db_employee)
    return db_employee

@router.patch("/employees/bulk", response_model=List[schemas.EmployeeResponse])
def bulk_edit_employees(payload: schemas.BulkEmployeeEdit, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    active_scenario = get_active_scenario_db(db)
    db_employees = db.query(models.Employee).filter(
        models.Employee.id.in_(payload.employee_ids),
        models.Employee.scenario_id == active_scenario.id,
        models.Employee.is_deleted == False
    ).all()
    if not db_employees:
        raise HTTPException(status_code=404, detail="No matching employees found")

    fields_changed = []
    if payload.team is not None:
        fields_changed.append("team")
    if payload.department is not None:
        fields_changed.append("department")
    if payload.location is not None:
        fields_changed.append("location")
    if payload.manager is not None:
        fields_changed.append("manager")
    if payload.status is not None:
        fields_changed.append("status")
    if payload.hourly_rate_set is not None:
        fields_changed.append("hourly_rate (set)")
    if payload.hourly_rate_adjust_pct is not None:
        fields_changed.append("hourly_rate (adjust %)")

    for emp in db_employees:
        if payload.team is not None:
            emp.team = payload.team
        if payload.department is not None:
            emp.department = payload.department
        if payload.location is not None:
            emp.location = payload.location
        if payload.manager is not None:
            emp.manager = payload.manager
        if payload.status is not None:
            emp.status = payload.status
        if payload.hourly_rate_set is not None:
            emp.hourly_rate = payload.hourly_rate_set
        elif payload.hourly_rate_adjust_pct is not None:
            emp.hourly_rate = round(emp.hourly_rate * (1 + payload.hourly_rate_adjust_pct / 100.0), 2)

    db.commit()
    for emp in db_employees:
        db.refresh(emp)

    write_system_log(
        db, username=admin.username, action="Bulk Edit Employees",
        details=f"Applied {', '.join(fields_changed) or 'no changes'} to {len(db_employees)} employees: {', '.join(e.name for e in db_employees)}"
    )
    return db_employees

@router.delete("/employees/{employee_id}")
def delete_employee(employee_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_employee = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    db_employee.is_deleted = True
    db_employee.deleted_at = datetime.datetime.utcnow()
    db.commit()
    write_system_log(db, username=admin.username, action="Delete Employee", details=f"Moved employee '{db_employee.name}' to Trash")
    return {"message": "Employee moved to Trash"}

@router.post("/employees/{employee_id}/restore", response_model=schemas.EmployeeResponse)
def restore_employee(employee_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_employee = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    db_employee.is_deleted = False
    db_employee.deleted_at = None
    db.commit()
    db.refresh(db_employee)
    write_system_log(db, username=admin.username, action="Restore Employee", details=f"Restored employee '{db_employee.name}' from Trash")
    return db_employee

# TOPICS API
@router.get("/topics")
def get_topics(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    active_scenario = get_active_scenario_db(db)
    topics = db.query(models.Topic).filter(
        models.Topic.scenario_id == active_scenario.id,
        models.Topic.is_deleted == False
    ).all()
    
    result = []
    for topic in topics:
        additional_costs_list = []
        for cost in topic.additional_costs:
            additional_costs_list.append({
                "id": cost.id,
                "cost_type": cost.cost_type,
                "category": cost.category,
                "amount": cost.amount,
                "notes": cost.notes
            })
            
        result.append({
            "id": topic.id,
            "name": topic.name,
            "category": topic.category,
            "area": topic.area,
            "description": topic.description,
            "objective": topic.objective,
            "deliverables": topic.deliverables,
            "justification": topic.justification,
            "status": topic.status,
            "comments": topic.comments,
            "notes": topic.notes,
            "recovery": topic.recovery,
            "additional_costs": additional_costs_list
        })
    return result

@router.post("/topics", response_model=schemas.TopicResponse)
def create_topic(topic: schemas.TopicCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    active_scenario = get_active_scenario_db(db)
    db_topic = models.Topic(
        scenario_id=active_scenario.id,
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
    db.add(db_topic)
    db.commit()
    db.refresh(db_topic)
    return db_topic

@router.get("/scenarios/{scenario_id}/topics", response_model=List[schemas.TopicResponse])
def get_scenario_topics(scenario_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return db.query(models.Topic).filter(
        models.Topic.scenario_id == scenario_id,
        models.Topic.is_deleted == False
    ).all()

@router.post("/scenarios/{scenario_id}/topics", response_model=schemas.TopicResponse)
def create_scenario_topic(scenario_id: int, topic: schemas.TopicCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    db_topic = models.Topic(
        scenario_id=scenario_id,
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
    db.add(db_topic)
    db.commit()
    db.refresh(db_topic)
    return db_topic

@router.put("/topics/{topic_id}", response_model=schemas.TopicResponse)
def update_topic(topic_id: int, topic: schemas.TopicCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not db_topic:
        raise HTTPException(status_code=404, detail="Topic not found")
        
    db_topic.name = topic.name
    db_topic.category = topic.category
    db_topic.area = topic.area
    db_topic.description = topic.description
    db_topic.objective = topic.objective
    db_topic.deliverables = topic.deliverables
    db_topic.justification = topic.justification
    db_topic.status = topic.status
    db_topic.comments = topic.comments
    db_topic.notes = topic.notes
    db_topic.recovery = topic.recovery
    
    db.commit()
    db.refresh(db_topic)
    return db_topic

@router.delete("/topics/{topic_id}")
def delete_topic(topic_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not db_topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    db_topic.is_deleted = True
    db_topic.deleted_at = datetime.datetime.utcnow()
    db.commit()
    write_system_log(db, username=admin.username, action="Delete Topic", details=f"Moved topic '{db_topic.name}' to Trash")
    return {"message": "Topic moved to Trash"}

@router.post("/topics/{topic_id}/restore", response_model=schemas.TopicResponse)
def restore_topic(topic_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not db_topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    db_topic.is_deleted = False
    db_topic.deleted_at = None
    db.commit()
    db.refresh(db_topic)
    write_system_log(db, username=admin.username, action="Restore Topic", details=f"Restored topic '{db_topic.name}' from Trash")
    return db_topic

# TRASH API
@router.get("/trash", response_model=schemas.TrashResponse)
def get_trash(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    active_scenario = get_active_scenario_db(db)
    deleted_employees = db.query(models.Employee).filter(
        models.Employee.scenario_id == active_scenario.id,
        models.Employee.is_deleted == True
    ).order_by(models.Employee.deleted_at.desc()).all()
    deleted_topics = db.query(models.Topic).filter(
        models.Topic.scenario_id == active_scenario.id,
        models.Topic.is_deleted == True
    ).order_by(models.Topic.deleted_at.desc()).all()
    return {"employees": deleted_employees, "topics": deleted_topics}

@router.delete("/employees/{employee_id}/permanent")
def permanently_delete_employee(employee_id: int, db: Session = Depends(get_db), master: models.User = Depends(require_master)):
    db_employee = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not db_employee.is_deleted:
        raise HTTPException(status_code=400, detail="Employee must be in Trash before it can be permanently deleted")
    name = db_employee.name
    db.delete(db_employee)
    db.commit()
    write_system_log(db, username=master.username, action="Permanently Delete Employee", details=f"Permanently deleted employee '{name}' from Trash")
    return {"message": "Employee permanently deleted"}

@router.delete("/topics/{topic_id}/permanent")
def permanently_delete_topic(topic_id: int, db: Session = Depends(get_db), master: models.User = Depends(require_master)):
    db_topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not db_topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if not db_topic.is_deleted:
        raise HTTPException(status_code=400, detail="Topic must be in Trash before it can be permanently deleted")
    name = db_topic.name
    db.delete(db_topic)
    db.commit()
    write_system_log(db, username=master.username, action="Permanently Delete Topic", details=f"Permanently deleted topic '{name}' from Trash")
    return {"message": "Topic permanently deleted"}

@router.delete("/trash")
def empty_trash(db: Session = Depends(get_db), master: models.User = Depends(require_master)):
    active_scenario = get_active_scenario_db(db)
    deleted_employees = db.query(models.Employee).filter(
        models.Employee.scenario_id == active_scenario.id, models.Employee.is_deleted == True
    ).all()
    deleted_topics = db.query(models.Topic).filter(
        models.Topic.scenario_id == active_scenario.id, models.Topic.is_deleted == True
    ).all()
    emp_count = len(deleted_employees)
    top_count = len(deleted_topics)
    for e in deleted_employees:
        db.delete(e)
    for t in deleted_topics:
        db.delete(t)
    db.commit()
    write_system_log(db, username=master.username, action="Empty Trash", details=f"Permanently deleted {emp_count} employee(s) and {top_count} topic(s) from Trash")
    return {"message": f"Trash emptied: {emp_count} employee(s) and {top_count} topic(s) permanently deleted"}

# ADDITIONAL COSTS API
@router.post("/topics/{topic_id}/costs", response_model=schemas.AdditionalCostResponse)
def add_topic_cost(topic_id: int, cost: schemas.AdditionalCostCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
        
    db_cost = models.AdditionalCost(
        topic_id=topic_id,
        cost_type=cost.cost_type,
        category=cost.category,
        amount=cost.amount,
        notes=cost.notes
    )
    db.add(db_cost)
    db.commit()
    db.refresh(db_cost)
    return db_cost

@router.delete("/topics/costs/{cost_id}")
def delete_topic_cost(cost_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_cost = db.query(models.AdditionalCost).filter(models.AdditionalCost.id == cost_id).first()
    if not db_cost:
        raise HTTPException(status_code=404, detail="Additional cost not found")
    db.delete(db_cost)
    db.commit()
    return {"message": "Additional cost deleted successfully"}

# ALLOCATIONS API
@router.get("/allocations", response_model=List[schemas.AllocationResponse])
def get_allocations(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    active_scenario = get_active_scenario_db(db)
    return db.query(models.Allocation).join(models.Employee).join(models.Topic).filter(
        models.Employee.scenario_id == active_scenario.id,
        models.Employee.is_deleted == False,
        models.Topic.is_deleted == False
    ).all()

@router.get("/scenarios/{scenario_id}/allocations", response_model=List[schemas.AllocationResponse])
def get_scenario_allocations(scenario_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    scenario = db.query(models.Scenario).filter(models.Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return db.query(models.Allocation).join(models.Employee).join(models.Topic).filter(
        models.Employee.scenario_id == scenario_id,
        models.Employee.is_deleted == False,
        models.Topic.is_deleted == False
    ).all()

@router.post("/allocations", response_model=schemas.AllocationResponse)
def save_allocation(alloc: schemas.AllocationUpdate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    db_alloc = db.query(models.Allocation).filter(
        models.Allocation.employee_id == alloc.employee_id,
        models.Allocation.topic_id == alloc.topic_id
    ).first()
    
    if db_alloc:
        db_alloc.percentage = alloc.percentage
        if alloc.comment is not None:
            db_alloc.comment = alloc.comment
    else:
        db_alloc = models.Allocation(
            employee_id=alloc.employee_id,
            topic_id=alloc.topic_id,
            percentage=alloc.percentage,
            comment=alloc.comment
        )
        db.add(db_alloc)
        
    db.commit()
    db.refresh(db_alloc)
    return db_alloc
