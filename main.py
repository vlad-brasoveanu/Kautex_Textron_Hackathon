import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from database import engine, Base, get_db
from routers.auth import hash_password
from dependencies import create_access_token, query_local_ollama
import routers.auth as auth
import routers.scenarios as scenarios
import routers.matrix as matrix
import routers.reports as reports
import routers.ai as ai

# Create DB Tables
Base.metadata.create_all(bind=engine)

# Lightweight migration: create_all only creates missing tables, it does not add
# columns to tables that already existed before these fields were introduced.
def migrate_add_missing_columns():
    from sqlalchemy import inspect
    inspector = inspect(engine)
    
    # 1. Migrate "users" table
    user_columns = {col["name"] for col in inspector.get_columns("users")}
    with engine.begin() as conn:
        for col in ("email", "department", "position", "supervisor"):
            if col not in user_columns:
                col_type = "VARCHAR(255)" if engine.dialect.name == "postgresql" else "VARCHAR"
                conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN {col} {col_type}")

        # 2. Migrate "employees" & "topics" tables
        for table in ("employees", "topics"):
            columns = {col["name"] for col in inspector.get_columns(table)}
            if "is_deleted" not in columns:
                bool_type = "BOOLEAN" if engine.dialect.name in ("postgresql", "mysql") else "INTEGER"
                conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN is_deleted {bool_type} DEFAULT 0")
            if "deleted_at" not in columns:
                dt_type = "TIMESTAMP" if engine.dialect.name == "postgresql" else "DATETIME"
                conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN deleted_at {dt_type}")

        # 3. Migrate "upload_history" table
        upload_columns = {col["name"] for col in inspector.get_columns("upload_history")}
        if "file_content" not in upload_columns:
            bin_type = "BYTEA" if engine.dialect.name == "postgresql" else "BLOB"
            conn.exec_driver_sql(f"ALTER TABLE upload_history ADD COLUMN file_content {bin_type}")

migrate_add_missing_columns()

app = FastAPI(title="Digital Engineering Planning Dashboard API")

# Setup CORS for development convenience
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prevent API caching globally to avoid client-side race conditions on scenario switches
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Include all subrouters
app.include_router(auth.router)
app.include_router(scenarios.router)
app.include_router(matrix.router)
app.include_router(reports.router)
app.include_router(ai.router)

# Serve static files for frontend SPA
app.mount("/", StaticFiles(directory="static", html=True), name="static")
