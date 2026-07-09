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
    deleted_at: Optional[datetime.datetime] = None

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
    deleted_at: Optional[datetime.datetime] = None

    class Config:
        from_attributes = True


class TrashResponse(BaseModel):
    employees: List[EmployeeResponse]
    topics: List[TopicResponse]


class BulkEmployeeEdit(BaseModel):
    employee_ids: List[int]
    team: Optional[str] = None
    department: Optional[str] = None
    location: Optional[str] = None
    manager: Optional[str] = None
    status: Optional[str] = None
    hourly_rate_set: Optional[float] = None
    hourly_rate_adjust_pct: Optional[float] = None

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
    name: str


class UserRegister(BaseModel):
    username: str
    password: str
    name: str
    role: Optional[str] = "user"  # "master_admin", "admin", or "user"
    email: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    supervisor: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    supervisor: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None


class UserManageResponse(BaseModel):
    id: int
    username: str
    name: str
    role: str
    email: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    supervisor: Optional[str] = None

    class Config:
        from_attributes = True


class AuditLogResponse(BaseModel):
    id: int
    timestamp: datetime.datetime
    username: str
    action: str
    details: Optional[str] = None

    class Config:
        from_attributes = True


class UploadHistoryResponse(BaseModel):
    id: int
    original_filename: str
    file_type: str
    size_bytes: int
    uploaded_by: str
    uploaded_at: datetime.datetime
    imported_employees: int
    imported_topics: int
    imported_allocations: int
    imported_additional_costs: int

    class Config:
        from_attributes = True


class RestorePayload(BaseModel):
    name: str
    description: Optional[str] = ""
    employees: List[dict]
    topics: List[dict]
    allocations: List[dict]
    additional_costs: List[dict]

