from pydantic import BaseModel, Field
from typing import List, Optional
import datetime

# Scenario Schemas
class ScenarioBase(BaseModel):
    name: str
    description: Optional[str] = None

class ScenarioCreate(ScenarioBase):
    pass

class ScenarioClone(BaseModel):
    new_name: str
    new_description: Optional[str] = None

class ScenarioResponse(ScenarioBase):
    id: int
    is_active: bool
    created_at: datetime.datetime

    class Config:
        from_attributes = True

# Employee Schemas
class EmployeeBase(BaseModel):
    name: str
    team: str
    department: str
    location: str
    available_hours: float = 1800.0
    hourly_rate: float = 50.0
    status: str = "Active"
    manager: Optional[str] = None
    notes: Optional[str] = None

class EmployeeCreate(EmployeeBase):
    pass

class EmployeeResponse(EmployeeBase):
    id: int
    scenario_id: int

    class Config:
        from_attributes = True

# Topic Schemas
class TopicBase(BaseModel):
    name: str
    category: str
    area: Optional[str] = None
    description: Optional[str] = None
    objective: Optional[str] = None
    deliverables: Optional[str] = None
    justification: Optional[str] = None
    status: str = "Active"
    comments: Optional[str] = None
    notes: Optional[str] = None
    recovery: float = 0.0

class TopicCreate(TopicBase):
    pass

class TopicResponse(TopicBase):
    id: int
    scenario_id: int

    class Config:
        from_attributes = True

# Allocation Schemas
class AllocationUpdate(BaseModel):
    employee_id: int
    topic_id: int
    percentage: float
    comment: Optional[str] = None

class AllocationResponse(BaseModel):
    employee_id: int
    topic_id: int
    percentage: float
    comment: Optional[str] = None

    class Config:
        from_attributes = True

# Additional Cost Schemas
class AdditionalCostBase(BaseModel):
    cost_type: str  # "internal" or "external"
    category: str  # CAD, Sampling, Tooling, Prototypes, etc.
    amount: float = 0.0
    notes: Optional[str] = None

class AdditionalCostCreate(AdditionalCostBase):
    pass

class AdditionalCostResponse(AdditionalCostBase):
    id: int
    topic_id: int

    class Config:
        from_attributes = True


# User Authentication Schemas
class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    username: str
    role: str
    access_token: str


class UserRegister(BaseModel):
    username: str
    password: str
    role: Optional[str] = "user"  # "admin" or "user"


class AuditLogResponse(BaseModel):
    id: int
    timestamp: datetime.datetime
    username: str
    action: str
    details: Optional[str] = None

    class Config:
        from_attributes = True

