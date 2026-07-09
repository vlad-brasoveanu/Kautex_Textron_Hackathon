import datetime
from database import engine, SessionLocal, Base
import models
import hashlib

def hash_password(password: str) -> str:
    salt = "textron_hackathon_salt_2026"
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()

# ==========================================================
# Data tables - kept separate from the seeding logic below so
# the roster/topic list can be scanned and edited without
# touching the ORM plumbing.
# ==========================================================

USERS = [
    ("master", "master123", "master_admin", "Master Manager", None, None, None, None),
    ("admin", "admin123", "admin", "Admin Director", None, None, None, None),
    ("user", "user123", "user", "Staff Analyst", None, None, None, None),
    ("sarah.chen", "demo1234", "admin", "Sarah Chen", "sarah.chen@kautex.com", "Program Management", "Program Director", "Master Manager"),
    ("diego.alvarez", "demo1234", "admin", "Diego Alvarez", "diego.alvarez@kautex.com", "Manufacturing Engineering", "Engineering Manager", "Admin Director"),
    ("jennifer.brooks", "demo1234", "user", "Jennifer Brooks", "jennifer.brooks@kautex.com", "Quality", "Quality Systems Manager", "Sarah Chen"),
    ("ravi.patel", "demo1234", "user", "Ravi Patel", "ravi.patel@kautex.com", "CAE", "CAE Engineer", "Diego Alvarez"),
]

# (name, team, department, location, hours, rate, manager, notes, status)
EMPLOYEES = [
    # CAE
    ("Markus Weber", "GV CAE Germany", "CAE", "Germany", 1600.0, 150.0, "Dr. Müller", "Lead CAE expert in crash simulations.", "Active"),
    ("Sofia Rossi", "GV CAE Germany", "CAE", "Germany", 1600.0, 140.0, "Dr. Müller", "Structural durability specialist.", "Active"),
    ("Hans Becker", "GV CAE Germany", "CAE", "Germany", 1600.0, 135.0, "Dr. Müller", "NVH simulation engineer.", "Active"),
    ("Priya Sharma", "GV CAE India", "CAE", "India", 1800.0, 49.55, "Rajesh Kumar", "Mesh generation specialist.", "Active"),
    ("Ravi Patel", "GV CAE India", "CAE", "India", 1800.0, 47.0, "Rajesh Kumar", "Junior CAE analyst, onboarded this quarter.", "New Position"),
    ("Carlos Hernández", "GV CAE Mexico", "CAE", "Mexico", 1800.0, 40.0, "Sofia Gomez", "FEA analyst.", "Active"),
    ("Diego Alvarez", "GV CAE Mexico", "CAE", "Mexico", 1800.0, 44.0, "Sofia Gomez", "Crash safety lead.", "Active"),
    ("Andreea Ionescu", "GV CAE Romania", "CAE", "Romania", 1768.0, 71.77, "Andrei Popescu", "Thermal simulation expert.", "Active"),
    ("Elena Popa", "GV CAE Romania", "CAE", "Romania", 1768.0, 68.0, "Andrei Popescu", "Composite materials analyst.", "Active"),
    ("Katarzyna Nowak", "GV CAE Poland", "CAE", "Poland", 1720.0, 60.0, "Andrei Popescu", "Fatigue and durability CAE lead.", "Active"),
    # Test
    ("Lukas Fischer", "GV Test Bonn", "Test", "Germany", 1600.0, 120.0, "Dr. Müller", "Senior validation engineer.", "Active"),
    ("Julia Schmidt", "GV Test Bonn", "Test", "Germany", 1600.0, 115.0, "Dr. Müller", "Environmental test lab lead.", "Active"),
    ("Arjun Mehta", "GV Test India", "Test", "India", 1800.0, 45.0, "Rajesh Kumar", "Test rig operator.", "Active"),
    ("Neha Verma", "GV Test India", "Test", "India", 1800.0, 43.0, "Rajesh Kumar", "Durability test technician.", "Active"),
    ("Ana Martínez", "GV Test Mexico", "Test", "Mexico", 1800.0, 38.0, "Sofia Gomez", "Physical durability testing.", "Active"),
    ("Roberto Silva", "GV Test Mexico", "Test", "Mexico", 1800.0, 39.0, "Sofia Gomez", "Test fixture designer.", "Active"),
    ("Mihai Dumitrescu", "GV Test Romania", "Test", "Romania", 1768.0, 65.0, "Andrei Popescu", "Electronics validation lead.", "Active"),
    ("Michael Johnson", "GV Test Troy", "Test", "USA", 1800.0, 130.0, "John Smith", "Customer liaison validation lead.", "Active"),
    ("Tom Anderson", "GV Test Troy", "Test", "USA", 1800.0, 125.0, "John Smith", "Powertrain test engineer.", "Active"),
    ("Wei Zhang", "GV Test Pinghu", "Test", "China", 1800.0, 52.0, "Li Wei", "Environmental chamber validator.", "Active"),
    # Program Management
    ("Sarah Chen", "Program Management", "Program Management", "USA", 1800.0, 145.0, "John Smith", "Global program director.", "Active"),
    ("Thomas Wagner", "Program Management", "Program Management", "Germany", 1600.0, 138.0, "Dr. Müller", "European program manager.", "Active"),
    ("Fatima Al-Rashid", "Program Management", "Program Management", "USA", 1800.0, 132.0, "John Smith", "Customer program manager - Fuel Project.", "Active"),
    ("Bogdan Constantin", "Program Management", "Program Management", "Romania", 1768.0, 70.0, "Andrei Popescu", "Regional program coordinator.", "Active"),
    ("Chen Li", "Program Management", "Program Management", "China", 1800.0, 58.0, "Li Wei", "APAC program liaison.", "Active"),
    # Manufacturing Engineering
    ("Miguel Torres", "Manufacturing Engineering", "Manufacturing Engineering", "Mexico", 1800.0, 42.0, "Sofia Gomez", "Production line integration engineer.", "Active"),
    ("Ionut Marin", "Manufacturing Engineering", "Manufacturing Engineering", "Romania", 1768.0, 62.0, "Andrei Popescu", "Tooling and fixtures lead.", "Active"),
    ("Laura Fernandez", "Manufacturing Engineering", "Manufacturing Engineering", "Mexico", 1800.0, 41.0, "Sofia Gomez", "Process automation engineer.", "Active"),
    ("Klaus Richter", "Manufacturing Engineering", "Manufacturing Engineering", "Germany", 1600.0, 128.0, "Dr. Müller", "Digital twin manufacturing lead.", "Active"),
    # Quality
    ("Anjali Nair", "Quality", "Quality", "India", 1800.0, 46.0, "Rajesh Kumar", "Supplier quality engineer.", "Active"),
    ("Jennifer Brooks", "Quality", "Quality", "USA", 1800.0, 118.0, "John Smith", "Quality systems manager.", "Active"),
    ("Sunita Rao", "Quality", "Quality", "India", 1800.0, 44.0, "Rajesh Kumar", "Quality audit specialist, recently transferred.", "New Position"),
    ("Robert Klein", "Quality", "Quality", "USA", 1800.0, 122.0, "John Smith", "Customer quality liaison.", "Active"),
]

# (name, category, area, description, objective, deliverables, justification, comments, notes, recovery)
TOPICS = [
    ("Non bookable - Other", "Internal Efforts CI Non-bookable", "Management",
     "Non-bookable hours covering administration, overhead, training, and team meetings.",
     "Maintain administrative compliance and team upskilling.",
     "Administrative timesheets and training certifications.",
     "Necessary organizational and governance overhead.",
     "Baseline allocation of 10% expected for all active staff.", "Requires monthly review.", 0.0),
    ("bookable 1 - Consulting Global", "Internal Efforts CI bookable", "Customer Engineering",
     "Cross-site technical consulting and engineering advisory support.",
     "Provide expert engineering services across global Textron sites.",
     "Engineering design advisory reports and reviews.",
     "Maximizes utilization of senior engineering specialists globally.",
     "Planned demand from India and Germany hubs.", "Ad-hoc request based.", 0.0),
    ("Agentic AI and LLM - Enterprise Solutions", "AI Initiatives", "Internal Development",
     "Development of an agentic resource planning and reporting system using LLMs.",
     "Build a state-of-the-art dashboard and automated local AI report generator.",
     "Web dashboard with embedded natural language SQL assistant.",
     "Saves reporting overhead and replaces manual spreadsheets.",
     "Key hackathon initiative and prototype development.", "High management visibility.", 8000.0),
    ("Fuel Project", "Customer Request", "Customer Engineering",
     "Engineering validation and analysis for new customer fuel system platform.",
     "Design and validate fuel cells meeting strict customer emission requirements.",
     "Physical validation reports and FEA crash compliance files.",
     "Core revenue project supporting customer vehicle release.",
     "Urgent priority, milestone deadline in Q4.", "No delays permitted.", 12000.0),
    ("Creation of Test Standards", "Testing Activities", "Test",
     "Standardization of test procedures, fixtures, and documentation across all labs.",
     "Create uniform, high-quality testing baselines globally.",
     "Standard Operating Procedures (SOPs) and certification checklist.",
     "Reduces testing variation and duplicate validation efforts.",
     "Joint collaboration between Bonn, Romania and Pinghu testing teams.", "Standardize on ISO 9001 guidelines.", 0.0),
    ("Method Development Pentatonic", "Pentatonic D-Project", "CAE",
     "Development of custom CAE methods for the new Pentatonic structural architecture.",
     "Perform crash and thermal validations on the Pentatonic vehicle frame.",
     "CAE simulation script libraries and validated simulation models.",
     "Required before physical prototypes are built, saving $2M in tooling.",
     "High workload expected for CAE specialists.", "Requires high performance compute access.", 0.0),
    ("Electric Powertrain Integration", "Customer Request", "Customer Engineering",
     "Integration engineering for the next-generation electric powertrain platform.",
     "Validate thermal and structural performance of the e-powertrain housing.",
     "Integration test reports and structural sign-off packages.",
     "Direct customer commitment tied to 2028 platform launch.",
     "Cross-functional effort spanning CAE, Test and Program Management.", "Tight coupling with supplier milestones.", 9000.0),
    ("Predictive Maintenance Analytics", "AI Initiatives", "Internal Development",
     "ML-based predictive maintenance models for manufacturing line equipment.",
     "Reduce unplanned downtime using sensor-driven failure prediction.",
     "Trained model artifacts and a monitoring dashboard.",
     "Projected to cut unplanned downtime by 15%.",
     "Pilot running on two production lines.", "Requires historical sensor data access.", 4000.0),
    ("Manufacturing Line Digitalization", "Allegro D-Project", "Manufacturing Engineering",
     "Digitalization of production line telemetry and process control systems.",
     "Bring real-time visibility to line throughput and quality metrics.",
     "Digitized line dashboards and process control documentation.",
     "Foundational for predictive maintenance and quality initiatives.",
     "Phase 1 covers Mexico and Romania plants.", "Coordinated with IT infrastructure team.", 0.0),
    ("Supplier Quality Audit Program", "Quality Initiatives", "Quality",
     "Structured audit program for tier-1 supplier quality systems.",
     "Ensure supplier compliance with Textron quality standards.",
     "Audit reports and supplier corrective action plans.",
     "Reduces field defects traced to supplier-sourced components.",
     "Annual audit cycle, India and USA suppliers prioritized this quarter.", "Findings reviewed with Program Management.", 0.0),
    ("Program Governance & Reporting", "Program Management", "Program Management",
     "Portfolio-level governance, milestone tracking, and executive reporting.",
     "Keep all active initiatives aligned to budget and schedule commitments.",
     "Monthly program status decks and risk registers.",
     "Required for executive visibility across all active initiatives.",
     "Consolidates status from CAE, Test, Manufacturing, and Quality.", "Reviewed in monthly steering committee.", 0.0),
    ("Lightweight Materials Research", "Internal D-Projects", "Research",
     "Exploratory research into lightweight composite and alloy materials.",
     "Identify weight-reduction opportunities for next-gen platforms.",
     "Materials feasibility reports and lab test data.",
     "Early-stage investment supporting future platform efficiency targets.",
     "Collaboration with Romania and Germany CAE teams.", "Long-horizon research, no fixed deadline.", 0.0),
    ("Customer Field Support - APAC", "Customer Request", "Customer Engineering",
     "On-site and remote engineering support for APAC customer accounts.",
     "Resolve field issues and support customer engineering reviews.",
     "Field support tickets log and root-cause analysis reports.",
     "Maintains customer satisfaction and contract SLAs in the APAC region.",
     "Coordinated out of the Pinghu and China program management hub.", "24h SLA on critical field issues.", 3000.0),
]

# employee_name -> [(topic_name, percentage, comment), ...]
ALLOCATION_PLAN = {
    "Markus Weber": [("Non bookable - Other", 10, "Standard admin time."),
                      ("bookable 1 - Consulting Global", 10, "Advisory for US engineering team."),
                      ("Agentic AI and LLM - Enterprise Solutions", 50, "Lead dashboard backend developer."),
                      ("Fuel Project", 10, "Review fuel cell structural simulations."),
                      ("Method Development Pentatonic", 20, "Pentatonic crash simulation setup.")],
    "Sofia Rossi": [("Non bookable - Other", 10, "Standard admin time."),
                     ("Method Development Pentatonic", 40, "Structural durability validation."),
                     ("Lightweight Materials Research", 30, "Composite panel feasibility testing."),
                     ("Fuel Project", 20, "Durability review for fuel cell housing.")],
    "Hans Becker": [("Non bookable - Other", 10, "Standard admin time."),
                     ("Electric Powertrain Integration", 50, "NVH validation for e-powertrain housing."),
                     ("Method Development Pentatonic", 30, "NVH simulation support."),
                     ("bookable 1 - Consulting Global", 10, "NVH advisory to Test Bonn.")],
    "Priya Sharma": [("Non bookable - Other", 10, "Regular admin tasks."),
                       ("bookable 1 - Consulting Global", 10, "Mesh automation support."),
                       ("Agentic AI and LLM - Enterprise Solutions", 50, "Data ingestion and parsing development."),
                       ("Fuel Project", 10, "Basic structural meshing for Fuel Project.")],
    "Ravi Patel": [("Non bookable - Other", 20, "Onboarding and ramp-up training."),
                    ("Agentic AI and LLM - Enterprise Solutions", 30, "Junior support on data pipeline."),
                    ("Lightweight Materials Research", 30, "Assisting materials feasibility testing.")],
    "Carlos Hernández": [("Non bookable - Other", 10, "Admin and locale support."),
                           ("Agentic AI and LLM - Enterprise Solutions", 50, "Model testing and scenarios design."),
                           ("Method Development Pentatonic", 30, "Pentatonic crash simulations assistance.")],
    "Diego Alvarez": [("Non bookable - Other", 10, "Admin and locale support."),
                        ("Electric Powertrain Integration", 60, "Crash safety lead for e-powertrain housing."),
                        ("Fuel Project", 20, "Crash compliance review.")],
    "Andreea Ionescu": [("Non bookable - Other", 20, "Extended training and administrative duties."),
                          ("bookable 1 - Consulting Global", 10, "Consulting for German hub."),
                          ("Agentic AI and LLM - Enterprise Solutions", 20, "SQL engine testing."),
                          ("Fuel Project", 30, "Thermal modeling for Fuel Project."),
                          ("Method Development Pentatonic", 20, "Pentatonic thermal validation.")],
    "Elena Popa": [("Non bookable - Other", 10, "Standard admin time."),
                    ("Lightweight Materials Research", 50, "Composite materials analysis lead."),
                    ("Method Development Pentatonic", 40, "Composite panel crash validation.")],
    "Katarzyna Nowak": [("Non bookable - Other", 10, "Standard admin time."),
                          ("Method Development Pentatonic", 50, "Fatigue and durability CAE lead."),
                          ("Electric Powertrain Integration", 40, "Durability validation for housing.")],
    "Lukas Fischer": [("Non bookable - Other", 10, "Required lab compliance training."),
                        ("bookable 1 - Consulting Global", 10, "Bonn lab consulting requests."),
                        ("Agentic AI and LLM - Enterprise Solutions", 40, "Front-end UI tester and advisor."),
                        ("Fuel Project", 20, "Physical test rig supervisor."),
                        ("Creation of Test Standards", 40, "Drafting new global validation guidelines.")],
    "Julia Schmidt": [("Non bookable - Other", 10, "Standard admin time."),
                        ("Creation of Test Standards", 50, "Environmental test lab standardization."),
                        ("Electric Powertrain Integration", 30, "Environmental validation for housing.")],
    "Arjun Mehta": [("Non bookable - Other", 10, "Standard admin time."),
                      ("bookable 1 - Consulting Global", 10, "Local test support."),
                      ("Agentic AI and LLM - Enterprise Solutions", 50, "Testing visual charts and exporting."),
                      ("Fuel Project", 10, "Test run operations."),
                      ("Creation of Test Standards", 30, "Helping standardise India lab procedures.")],
    "Neha Verma": [("Non bookable - Other", 10, "Standard admin time."),
                     ("Predictive Maintenance Analytics", 40, "Sensor data labeling for durability tests."),
                     ("Creation of Test Standards", 40, "Durability test protocol documentation.")],
    "Ana Martínez": [("Non bookable - Other", 10, "Local compliance check."),
                       ("Fuel Project", 50, "Primary test rig support."),
                       ("Creation of Test Standards", 30, "Aligning Mexico lab specs.")],
    "Roberto Silva": [("Non bookable - Other", 10, "Standard admin time."),
                        ("Electric Powertrain Integration", 50, "Fixture design for e-powertrain testing."),
                        ("Creation of Test Standards", 30, "Fixture standardization documentation.")],
    "Mihai Dumitrescu": [("Non bookable - Other", 10, "Required safety checks."),
                           ("bookable 1 - Consulting Global", 10, "Test consulting."),
                           ("Agentic AI and LLM - Enterprise Solutions", 40, "QA verification."),
                           ("Fuel Project", 20, "Validation lead for Fuel Project Romania."),
                           ("Creation of Test Standards", 15, "Reviewing Romanian translation of ISO guidelines.")],
    "Michael Johnson": [("Non bookable - Other", 10, "Standard administrative tasks."),
                          ("Fuel Project", 70, "Primary customer liaison validator in the US.")],
    "Tom Anderson": [("Non bookable - Other", 10, "Standard admin time."),
                       ("Electric Powertrain Integration", 60, "Powertrain test lead for e-powertrain platform."),
                       ("Customer Field Support - APAC", 20, "Remote support for APAC field issues.")],
    "Wei Zhang": [("Non bookable - Other", 10, "Compliance safety meeting."),
                   ("Creation of Test Standards", 80, "Harmonising China lab testing metrics.")],
    "Sarah Chen": [("Non bookable - Other", 10, "Executive administrative duties."),
                    ("Program Governance & Reporting", 60, "Global program director oversight."),
                    ("Fuel Project", 20, "Executive sponsor check-ins.")],
    "Thomas Wagner": [("Non bookable - Other", 10, "Standard admin time."),
                        ("Program Governance & Reporting", 50, "European program tracking."),
                        ("Electric Powertrain Integration", 30, "Program oversight for e-powertrain milestones.")],
    "Fatima Al-Rashid": [("Non bookable - Other", 10, "Standard admin time."),
                           ("Program Governance & Reporting", 30, "Portfolio reporting support."),
                           ("Fuel Project", 60, "Dedicated customer program manager.")],
    "Bogdan Constantin": [("Non bookable - Other", 10, "Standard admin time."),
                            ("Program Governance & Reporting", 60, "Regional coordination and reporting."),
                            ("Method Development Pentatonic", 20, "Program tracking for Pentatonic milestones.")],
    "Chen Li": [("Non bookable - Other", 10, "Standard admin time."),
                 ("Program Governance & Reporting", 40, "APAC portfolio reporting."),
                 ("Customer Field Support - APAC", 50, "APAC program liaison lead.")],
    "Miguel Torres": [("Non bookable - Other", 10, "Standard admin time."),
                        ("Manufacturing Line Digitalization", 70, "Production line integration lead."),
                        ("Method Development Pentatonic", 20, "Manufacturability review for Pentatonic frame.")],
    "Ionut Marin": [("Non bookable - Other", 10, "Standard admin time."),
                      ("Manufacturing Line Digitalization", 60, "Tooling and fixtures digitalization."),
                      ("Program Governance & Reporting", 20, "Manufacturing status reporting.")],
    "Laura Fernandez": [("Non bookable - Other", 10, "Standard admin time."),
                          ("Manufacturing Line Digitalization", 60, "Process automation rollout."),
                          ("Predictive Maintenance Analytics", 20, "Line sensor integration support.")],
    "Klaus Richter": [("Non bookable - Other", 10, "Standard admin time."),
                        ("Manufacturing Line Digitalization", 50, "Digital twin manufacturing lead."),
                        ("Predictive Maintenance Analytics", 40, "Digital twin sensor model integration.")],
    "Anjali Nair": [("Non bookable - Other", 10, "Standard admin time."),
                      ("Supplier Quality Audit Program", 60, "Supplier audit execution - India region."),
                      ("Creation of Test Standards", 20, "Quality input on test standardization.")],
    "Jennifer Brooks": [("Non bookable - Other", 10, "Standard admin time."),
                          ("Supplier Quality Audit Program", 50, "Quality systems program ownership."),
                          ("Program Governance & Reporting", 20, "Quality status reporting.")],
    "Sunita Rao": [("Non bookable - Other", 20, "Transfer onboarding and training."),
                     ("Supplier Quality Audit Program", 40, "Supplier audit execution - India region."),
                     ("Creation of Test Standards", 30, "Quality input on test standardization.")],
    "Robert Klein": [("Non bookable - Other", 10, "Standard admin time."),
                       ("Supplier Quality Audit Program", 50, "Customer-facing quality liaison."),
                       ("Fuel Project", 50, "Quality sign-off for Fuel Project milestones.")],
}

ADDITIONAL_COSTS = [
    ("Agentic AI and LLM - Enterprise Solutions", "internal", "CAD", 5000.0, "CAD modeling licenses for UI prototyping."),
    ("Agentic AI and LLM - Enterprise Solutions", "internal", "Internal Equipment", 3000.0, "Local testing servers rent."),
    ("Agentic AI and LLM - Enterprise Solutions", "external", "Tooling", 10000.0, "UI design tools premium licensing."),
    ("Agentic AI and LLM - Enterprise Solutions", "external", "Prototypes", 15000.0, "Testing prototype deployment host."),
    ("Fuel Project", "external", "Supplier Support", 25000.0, "Dedicated validation consulting from supplier."),
    ("Fuel Project", "external", "External Testing", 15000.0, "High pressure chamber certification test lab."),
    ("Electric Powertrain Integration", "internal", "Engineering Support", 8000.0, "Dedicated thermal simulation compute cluster."),
    ("Electric Powertrain Integration", "external", "Prototypes", 22000.0, "Powertrain housing prototype tooling."),
    ("Manufacturing Line Digitalization", "internal", "Internal Equipment", 12000.0, "Line sensor hardware for Mexico plant pilot."),
    ("Manufacturing Line Digitalization", "external", "Tooling", 18000.0, "Third-party line control software licensing."),
    ("Predictive Maintenance Analytics", "internal", "Internal Equipment", 4000.0, "GPU compute for model training."),
    ("Supplier Quality Audit Program", "external", "Supplier Support", 6000.0, "Third-party audit firm engagement - APAC suppliers."),
]

# ==========================================================
# Seeding logic
# ==========================================================

def _populate_scenario(db, scenario, employees_data, allocation_plan, topic_id_map):
    emp_id_map = {}
    for name, team, department, location, hours, rate, manager, notes, status in employees_data:
        emp = models.Employee(
            scenario_id=scenario.id, name=name, team=team, department=department,
            location=location, available_hours=hours, hourly_rate=rate,
            status=status, manager=manager, notes=notes
        )
        db.add(emp)
        db.flush()
        emp_id_map[name] = emp.id

    for emp_name, allocations in allocation_plan.items():
        if emp_name not in emp_id_map:
            continue
        for topic_name, pct, comment in allocations:
            db.add(models.Allocation(
                employee_id=emp_id_map[emp_name], topic_id=topic_id_map[topic_name],
                percentage=float(pct), comment=comment
            ))
    return emp_id_map


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    db.query(models.Allocation).delete()
    db.query(models.AdditionalCost).delete()
    db.query(models.Employee).delete()
    db.query(models.Topic).delete()
    db.query(models.SystemLog).delete()
    db.query(models.UploadHistory).delete()
    db.query(models.Scenario).delete()
    db.query(models.User).delete()
    db.commit()

    # --- Users ---
    users_by_name = {}
    for username, password, role, name, email, department, position, supervisor in USERS:
        u = models.User(
            username=username, password_hash=hash_password(password), role=role, name=name,
            email=email, department=department, position=position, supervisor=supervisor
        )
        db.add(u)
        users_by_name[username] = u
    db.commit()

    # --- Baseline scenario (active) ---
    baseline = models.Scenario(
        name="Baseline Scenario (2027 Planning)",
        description="Initial baseline planning for fiscal year 2027 covering CAE, Test, Program Management, Manufacturing Engineering, and Quality.",
        is_active=True
    )
    db.add(baseline)
    db.commit()
    db.refresh(baseline)

    topics_by_scenario = {}
    topic_id_map = {}
    for name, category, area, description, objective, deliverables, justification, comments, notes, recovery in TOPICS:
        t = models.Topic(
            scenario_id=baseline.id, name=name, category=category, area=area, description=description,
            objective=objective, deliverables=deliverables, justification=justification,
            status="Active", comments=comments, notes=notes, recovery=recovery
        )
        db.add(t)
        db.flush()
        topic_id_map[name] = t.id
    db.commit()

    emp_id_map = _populate_scenario(db, baseline, EMPLOYEES, ALLOCATION_PLAN, topic_id_map)
    db.commit()

    for topic_name, cost_type, category, amount, notes in ADDITIONAL_COSTS:
        db.add(models.AdditionalCost(
            topic_id=topic_id_map[topic_name], cost_type=cost_type, category=category,
            amount=amount, notes=notes
        ))
    db.commit()

    # --- Second scenario: an alternate "stretch" draft, inactive ---
    # Reuses the same roster/topics as a starting point so Compare Scenarios
    # and the Planning Version page have a second real (non-sandbox) version
    # to show, rather than being empty on first look.
    stretch = models.Scenario(
        name="Q1 2028 Stretch Plan (Draft)",
        description="Draft stretch scenario exploring headcount growth and planned raises ahead of the 2028 platform launch.",
        is_active=False
    )
    db.add(stretch)
    db.commit()
    db.refresh(stretch)

    stretch_topic_id_map = {}
    for name, category, area, description, objective, deliverables, justification, comments, notes, recovery in TOPICS:
        t = models.Topic(
            scenario_id=stretch.id, name=name, category=category, area=area, description=description,
            objective=objective, deliverables=deliverables, justification=justification,
            status="Active", comments=comments, notes=notes, recovery=recovery
        )
        db.add(t)
        db.flush()
        stretch_topic_id_map[name] = t.id
    db.commit()

    # Modest deltas vs. baseline: three raises, two new hires, and Fuel
    # Project easing off as it nears completion.
    stretch_employees = []
    raised = {"Markus Weber", "Priya Sharma", "Andreea Ionescu"}
    for row in EMPLOYEES:
        name, team, department, location, hours, rate, manager, notes, status = row
        if name in raised:
            rate = round(rate * 1.05, 2)
        stretch_employees.append((name, team, department, location, hours, rate, manager, notes, status))
    stretch_employees += [
        ("Yuki Tanaka", "GV Test Pinghu", "Test", "China", 1800.0, 50.0, "Li Wei", "New hire supporting APAC test capacity growth.", "New Position"),
        ("Isabella Costa", "Manufacturing Engineering", "Manufacturing Engineering", "Mexico", 1800.0, 43.0, "Sofia Gomez", "New hire supporting line digitalization rollout.", "New Position"),
    ]

    stretch_allocation_plan = {k: list(v) for k, v in ALLOCATION_PLAN.items()}
    stretch_allocation_plan["Michael Johnson"] = [("Non bookable - Other", 10, "Standard administrative tasks."),
                                                    ("Fuel Project", 50, "Fuel Project winding down toward completion.")]
    stretch_allocation_plan["Fatima Al-Rashid"] = [("Non bookable - Other", 10, "Standard admin time."),
                                                     ("Program Governance & Reporting", 40, "Portfolio reporting support."),
                                                     ("Fuel Project", 40, "Fuel Project winding down toward completion.")]
    stretch_allocation_plan["Yuki Tanaka"] = [("Non bookable - Other", 10, "Onboarding and ramp-up training."),
                                                ("Creation of Test Standards", 40, "APAC test capacity expansion."),
                                                ("Customer Field Support - APAC", 30, "Supporting APAC field escalations.")]
    stretch_allocation_plan["Isabella Costa"] = [("Non bookable - Other", 20, "Onboarding and ramp-up training."),
                                                   ("Manufacturing Line Digitalization", 60, "Supporting Mexico plant rollout.")]

    _populate_scenario(db, stretch, stretch_employees, stretch_allocation_plan, stretch_topic_id_map)
    db.commit()

    for topic_name, cost_type, category, amount, notes in ADDITIONAL_COSTS:
        db.add(models.AdditionalCost(
            topic_id=stretch_topic_id_map[topic_name], cost_type=cost_type, category=category,
            amount=amount, notes=notes
        ))
    db.commit()

    # --- Audit log history, so Audit Logs isn't empty on first look ---
    now = datetime.datetime.utcnow()
    log_entries = [
        (18, 9, "master", "Login", "Successful login. Role: master_admin"),
        (17, 14, "admin", "Login", "Successful login. Role: admin"),
        (17, 15, "admin", "Import CSV", "Imported allocation matrix from Q4_2027_Planning.csv (33 employees, 13 topics)."),
        (16, 10, "sarah.chen", "Login", "Successful login. Role: admin"),
        (16, 11, "sarah.chen", "Create Scenario", "Created new planning version 'Q1 2028 Stretch Plan (Draft)'"),
        (15, 16, "user", "Login", "Successful login. Role: user"),
        (14, 9, "jennifer.brooks", "Login", "Successful login. Role: user"),
        (13, 13, "admin", "Export Report", "Exported Allocation Matrix (Baseline Scenario (2027 Planning)) as Excel"),
        (11, 8, "diego.alvarez", "Login", "Successful login. Role: admin"),
        (9, 17, "ravi.patel", "Login", "Successful login. Role: user"),
        (7, 12, "admin", "Failed Login", "Invalid username or password"),
        (7, 12, "admin", "Login", "Successful login. Role: admin"),
        (6, 10, "master", "Switch Active Scenario", "Switched active planning version from 'Q1 2028 Stretch Plan (Draft)' to 'Baseline Scenario (2027 Planning)'"),
        (5, 14, "sarah.chen", "Export Report", "Exported Scenario Comparison (Baseline Scenario (2027 Planning) vs Q1 2028 Stretch Plan (Draft)) as CSV"),
        (4, 9, "admin", "Login", "Successful login. Role: admin"),
        (3, 15, "jennifer.brooks", "Export Report", "Exported Allocation Matrix (Baseline Scenario (2027 Planning)) as CSV"),
        (2, 10, "user", "Login", "Successful login. Role: user"),
        (1, 9, "master", "Login", "Successful login. Role: master_admin"),
        (0, 8, "admin", "Login", "Successful login. Role: admin"),
    ]
    for days_ago, hour, username, action, details in log_entries:
        db.add(models.SystemLog(
            timestamp=(now - datetime.timedelta(days=days_ago)).replace(hour=hour, minute=0, second=0, microsecond=0),
            username=username, action=action, details=details
        ))
    db.commit()

    print(f"Database seeded: {len(EMPLOYEES) + 2} employees, {len(TOPICS)} topics, 2 scenarios, {len(USERS)} users, {len(log_entries)} audit log entries.")
    print("Active scenario: Baseline Scenario (2027 Planning)")
    db.close()

if __name__ == "__main__":
    seed()
