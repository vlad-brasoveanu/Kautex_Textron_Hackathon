import hashlib
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from dependencies import (
    SESSION_COOKIE_NAME,
    create_access_token,
    set_session_cookie,
    get_current_user,
    require_admin,
    write_system_log,
)

router = APIRouter(prefix="/api", tags=["auth"])

def hash_password(password: str) -> str:
    salt = "textron_hackathon_salt_2026"
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()

@router.post("/auth/login", response_model=schemas.UserResponse)
def login(payload: schemas.UserLogin, response: Response, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user or user.password_hash != hash_password(payload.password):
        write_system_log(db, username=payload.username, action="Failed Login", details="Invalid username or password")
        raise HTTPException(status_code=401, detail="Invalid username or password")

    write_system_log(db, username=user.username, action="Login", details=f"Successful login. Role: {user.role}")
    token = create_access_token(user.username, user.role)
    set_session_cookie(response, user.username, user.role)
    return {
        "username": user.username,
        "role": user.role,
        "access_token": token,
        "name": user.name
    }

@router.post("/auth/register", response_model=schemas.UserResponse)
def register(payload: schemas.UserRegister, response: Response, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    new_user = models.User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        name=payload.name,
        role=payload.role or "user"
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    write_system_log(db, username=new_user.username, action="Registration", details=f"New user registered with role: {new_user.role}")
    token = create_access_token(new_user.username, new_user.role)
    set_session_cookie(response, new_user.username, new_user.role)
    return {
        "username": new_user.username,
        "role": new_user.role,
        "access_token": token,
        "name": new_user.name
    }

@router.get("/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return {
        "username": current_user.username,
        "role": current_user.role,
        "access_token": "",
        "name": current_user.name
    }

@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"message": "Logged out"}

@router.get("/users", response_model=List[schemas.UserManageResponse])
def list_users(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    return db.query(models.User).all()

@router.post("/users", response_model=schemas.UserManageResponse)
def create_user(payload: schemas.UserRegister, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    existing = db.query(models.User).filter(models.User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    target_role = payload.role or "user"
    
    if current_user.role == "admin":
        if target_role != "user":
            raise HTTPException(status_code=403, detail="Admins are only authorized to create standard users")
    elif current_user.role == "master_admin":
        if target_role not in ["admin", "user"]:
            raise HTTPException(status_code=403, detail="Cannot create master admin accounts")
    else:
        raise HTTPException(status_code=403, detail="Unauthorized role creation")
        
    new_user = models.User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        name=payload.name,
        role=target_role,
        email=payload.email or None,
        department=payload.department or None,
        position=payload.position or None,
        supervisor=payload.supervisor or None
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    write_system_log(
        db,
        username=current_user.username,
        action="Registration",
        details=f"Created user '{new_user.username}' with role '{new_user.role}' and name '{new_user.name}'"
    )
    return new_user

@router.put("/users/{user_id}", response_model=schemas.UserManageResponse)
def update_user(user_id: int, payload: schemas.UserUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User account not found")

    if target_user.role == "master_admin" and current_user.role != "master_admin":
        raise HTTPException(status_code=403, detail="Only Master Admin can edit Master Admin accounts")

    if payload.role is not None:
        if current_user.role != "master_admin":
            raise HTTPException(status_code=403, detail="Only Master Admin can change user roles")
        if target_user.role == "master_admin":
            raise HTTPException(status_code=400, detail="Cannot change the Master Admin's own role")
        if payload.role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
        target_user.role = payload.role

    if payload.name is not None:
        target_user.name = payload.name
    if payload.email is not None:
        target_user.email = payload.email or None
    if payload.department is not None:
        target_user.department = payload.department or None
    if payload.position is not None:
        target_user.position = payload.position or None
    if payload.supervisor is not None:
        target_user.supervisor = payload.supervisor or None
    if payload.password:
        target_user.password_hash = hash_password(payload.password)

    db.commit()
    db.refresh(target_user)

    write_system_log(
        db,
        username=current_user.username,
        action="Edit User",
        details=f"Updated user account '{target_user.username}' (Name: '{target_user.name}', Role: '{target_user.role}')"
    )
    return target_user

@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User account not found")
        
    if target_user.role == "master_admin":
        raise HTTPException(status_code=400, detail="Master admin accounts are protected and cannot be deleted")
        
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own active session account")
        
    if current_user.role == "admin":
        if target_user.role != "user":
            raise HTTPException(status_code=403, detail="Admins can only delete regular user accounts")
            
    db.delete(target_user)
    db.commit()
    
    write_system_log(
        db,
        username=current_user.username,
        action="User Deletion",
        details=f"Deleted user '{target_user.username}' (Name: '{target_user.name}', Role: '{target_user.role}')"
    )
    return {"status": "success", "message": f"Successfully deleted user '{target_user.username}'"}
