from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
import datetime
from database import Base

class Scenario(Base):
    __tablename__ = "scenarios"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    is_active = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    employees = relationship("Employee", back_populates="scenario", cascade="all, delete-orphan")
    topics = relationship("Topic", back_populates="scenario", cascade="all, delete-orphan")


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    team = Column(String, nullable=False, index=True)
    department = Column(String, nullable=False, index=True)
    location = Column(String, nullable=False, index=True)
    available_hours = Column(Float, default=1800.0)
    hourly_rate = Column(Float, default=50.0)
    status = Column(String, default="Active")  # Active, New Position, Replacement, Temporary, Inactive
    manager = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)

    scenario = relationship("Scenario", back_populates="employees")
    allocations = relationship("Allocation", back_populates="employee", cascade="all, delete-orphan")


class Topic(Base):
    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    category = Column(String, nullable=False, index=True)  # Internal Efforts, Customer Requests, etc.
    area = Column(String, nullable=True)
    description = Column(String, nullable=True)
    objective = Column(String, nullable=True)
    deliverables = Column(String, nullable=True)
    justification = Column(String, nullable=True)
    status = Column(String, default="Active")
    comments = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    recovery = Column(Float, default=0.0)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)

    scenario = relationship("Scenario", back_populates="topics")
    allocations = relationship("Allocation", back_populates="topic", cascade="all, delete-orphan")
    additional_costs = relationship("AdditionalCost", back_populates="topic", cascade="all, delete-orphan")


class Allocation(Base):
    __tablename__ = "allocations"

    employee_id = Column(Integer, ForeignKey("employees.id"), primary_key=True)
    topic_id = Column(Integer, ForeignKey("topics.id"), primary_key=True)
    percentage = Column(Float, default=0.0)  # Percentage (e.g., 20.0 for 20%)
    comment = Column(String, nullable=True)

    employee = relationship("Employee", back_populates="allocations")
    topic = relationship("Topic", back_populates="allocations")


class AdditionalCost(Base):
    __tablename__ = "additional_costs"

    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=False, index=True)
    cost_type = Column(String, nullable=False, index=True)  # "internal" or "external"
    category = Column(String, nullable=False)  # CAD, Sampling, Tooling, Prototypes, etc.
    amount = Column(Float, default=0.0)
    notes = Column(String, nullable=True)

    topic = relationship("Topic", back_populates="additional_costs")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")  # "master_admin", "admin", or "user"
    name = Column(String, nullable=False, default="Unnamed User")
    email = Column(String, nullable=True)
    department = Column(String, nullable=True)
    position = Column(String, nullable=True)
    supervisor = Column(String, nullable=True)


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    username = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False, index=True)  # Login, Failed Login, Import CSV, Export Report, Registration
    details = Column(String, nullable=True)


class UploadHistory(Base):
    __tablename__ = "upload_history"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False, index=True)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)  # unique name on disk under UPLOAD_STORAGE_DIR
    file_type = Column(String, nullable=False)  # "csv" or "excel"
    size_bytes = Column(Integer, default=0)
    uploaded_by = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    imported_employees = Column(Integer, default=0)
    imported_topics = Column(Integer, default=0)
    imported_allocations = Column(Integer, default=0)
    imported_additional_costs = Column(Integer, default=0)

    scenario = relationship("Scenario")
