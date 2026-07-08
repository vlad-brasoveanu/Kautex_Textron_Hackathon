from database import engine, SessionLocal, Base
import models
import hashlib

def hash_password(password: str) -> str:
    salt = "textron_hackathon_salt_2026"
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()

def seed():
    # Create tables
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Clear existing data to avoid duplication if rerun
    db.query(models.Allocation).delete()
    db.query(models.AdditionalCost).delete()
    db.query(models.Employee).delete()
    db.query(models.Topic).delete()
    db.query(models.Scenario).delete()
    db.query(models.User).delete()
    db.commit()

    # Create Scenario
    scenario = models.Scenario(
        name="Baseline Scenario (2027 Planning)",
        description="Initial baseline planning for fiscal year 2027 including CAE and Test teams.",
        is_active=True
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)

    # Create default users
    master_user = models.User(
        username="master",
        password_hash=hash_password("master123"),
        name="Master Manager",
        role="master_admin"
    )
    admin_user = models.User(
        username="admin",
        password_hash=hash_password("admin123"),
        name="Admin Director",
        role="admin"
    )
    regular_user = models.User(
        username="user",
        password_hash=hash_password("user123"),
        name="Staff Analyst",
        role="user"
    )
    db.add(master_user)
    db.add(admin_user)
    db.add(regular_user)
    db.commit()

    # Add Employees
    employees = [
        models.Employee(
            scenario_id=scenario.id,
            name="Markus Weber",
            team="CAE Germany",
            department="CAE",
            location="Germany",
            available_hours=1600.0,
            hourly_rate=150.0,
            status="Active",
            manager="Dr. Müller",
            notes="Lead CAE expert in crash simulations."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Lukas Fischer",
            team="Test Bonn",
            department="Test",
            location="Germany",
            available_hours=1600.0,
            hourly_rate=120.0,
            status="Active",
            manager="Dr. Müller",
            notes="Senior validation engineer."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Priya Sharma",
            team="CAE India",
            department="CAE",
            location="India",
            available_hours=1800.0,
            hourly_rate=49.55,
            status="Active",
            manager="Rajesh Kumar",
            notes="Mesh generation specialist."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Arjun Mehta",
            team="Test India",
            department="Test",
            location="India",
            available_hours=1800.0,
            hourly_rate=45.0,
            status="Active",
            manager="Rajesh Kumar",
            notes="Test rig operator."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Carlos Hernández",
            team="CAE Mexico",
            department="CAE",
            location="Mexico",
            available_hours=1800.0,
            hourly_rate=40.0,
            status="Active",
            manager="Sofia Gomez",
            notes="FEA analyst."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Ana Martínez",
            team="Test Mexico",
            department="Test",
            location="Mexico",
            available_hours=1800.0,
            hourly_rate=38.0,
            status="Active",
            manager="Sofia Gomez",
            notes="Physical durability testing."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Andreea Ionescu",
            team="CAE Romania",
            department="CAE",
            location="Romania",
            available_hours=1768.0,
            hourly_rate=71.77,
            status="Active",
            manager="Andrei Popescu",
            notes="Thermal simulation expert."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Mihai Dumitrescu",
            team="Test Romania",
            department="Test",
            location="Romania",
            available_hours=1768.0,
            hourly_rate=65.0,
            status="Active",
            manager="Andrei Popescu",
            notes="Electronics validation lead."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Michael Johnson",
            team="Test Troy",
            department="Test",
            location="USA",
            available_hours=1800.0,
            hourly_rate=130.0,
            status="Active",
            manager="John Smith",
            notes="Customer liaison validation lead."
        ),
        models.Employee(
            scenario_id=scenario.id,
            name="Wei Zhang",
            team="Test Pinghu",
            department="Test",
            location="China",
            available_hours=1800.0,
            hourly_rate=52.0,
            status="Active",
            manager="Li Wei",
            notes="Environmental chamber validator."
        ),
    ]

    for emp in employees:
        db.add(emp)
    db.commit()

    # Refresh employees to get IDs
    emp_map = {e.name: e.id for e in employees}

    # Add Topics (Projects)
    topics = [
        models.Topic(
            scenario_id=scenario.id,
            name="Non bookable - Other",
            category="Internal Efforts",
            area="Management",
            description="Non-bookable hours covering administration, overhead, training, and team meetings.",
            objective="Maintain administrative compliance and team upskilling.",
            deliverables="Administrative timesheets and training certifications.",
            justification="Necessary organizational and governance overhead.",
            status="Active",
            comments="Baseline allocation of 10% expected for all active staff.",
            notes="Requires monthly review.",
            recovery=0.0
        ),
        models.Topic(
            scenario_id=scenario.id,
            name="bookable 1 - Consulting Global",
            category="Internal Efforts",
            area="Customer Engineering",
            description="Cross-site technical consulting and engineering advisory support.",
            objective="Provide expert engineering services across global Textron sites.",
            deliverables="Engineering design advisory reports and reviews.",
            justification="Maximizes utilization of senior engineering specialists globally.",
            status="Active",
            comments="Planned demand from India and Germany hubs.",
            notes="Ad-hoc request based.",
            recovery=0.0
        ),
        models.Topic(
            scenario_id=scenario.id,
            name="Agentic AI and LLM - Enterprise Solutions",
            category="AI Initiatives",
            area="Internal Development",
            description="Development of an agentic resource planning and reporting system using LLMs.",
            objective="Build a state-of-the-art dashboard and automated local AI report generator.",
            deliverables="Web dashboard with embedded natural language SQL assistant.",
            justification="Saves reporting overhead and replaces manual spreadsheets.",
            status="Active",
            comments="Key hackathon initiative and prototype development.",
            notes="High management visibility.",
            recovery=8000.0 # Cost recovery (savings/external subsidy)
        ),
        models.Topic(
            scenario_id=scenario.id,
            name="Fuel Project",
            category="Customer Requests",
            area="Customer Engineering",
            description="Engineering validation and analysis for new customer fuel system platform.",
            objective="Design and validate fuel cells meeting strict customer emission requirements.",
            deliverables="Physical validation reports and FEA crash compliance files.",
            justification="Core revenue project supporting customer vehicle release.",
            status="Active",
            comments="Urgent priority, milestone deadline in Q4.",
            notes="No delays permitted.",
            recovery=12000.0
        ),
        models.Topic(
            scenario_id=scenario.id,
            name="Creation of Test Standards",
            category="Testing Activities",
            area="Test",
            description="Standardization of test procedures, fixtures, and documentation across all labs.",
            objective="Create uniform, high-quality testing baselines globally.",
            deliverables="Standard Operating Procedures (SOPs) and certification checklist.",
            justification="Reduces testing variation and duplicate validation efforts.",
            status="Active",
            comments="Joint collaboration between Bonn, Romania and Pinghu testing teams.",
            notes="Standardize on ISO 9001 guidelines.",
            recovery=0.0
        ),
        models.Topic(
            scenario_id=scenario.id,
            name="Method Development Pentatonic",
            category="Pentatonic Projects",
            area="CAE",
            description="Development of custom CAE methods for the new Pentatonic structural architecture.",
            objective="Perform crash and thermal validations on the Pentatonic vehicle frame.",
            deliverables="CAE simulation script libraries and validated simulation models.",
            justification="Required before physical prototypes are built, saving $2M in tooling.",
            status="Active",
            comments="High workload expected for CAE specialists.",
            notes="Requires high performance compute access.",
            recovery=0.0
        ),
    ]

    for top in topics:
        db.add(top)
    db.commit()

    # Refresh topics to get IDs
    top_map = {t.name: t.id for t in topics}

    # Add Resource Allocations
    allocations = [
        # Markus Weber - CAE Germany (Total 100%)
        models.Allocation(employee_id=emp_map["Markus Weber"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Standard admin time."),
        models.Allocation(employee_id=emp_map["Markus Weber"], topic_id=top_map["bookable 1 - Consulting Global"], percentage=10.0, comment="Advisory for US engineering team."),
        models.Allocation(employee_id=emp_map["Markus Weber"], topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], percentage=50.0, comment="Lead dashboard backend developer."),
        models.Allocation(employee_id=emp_map["Markus Weber"], topic_id=top_map["Fuel Project"], percentage=10.0, comment="Review fuel cell structural simulations."),
        models.Allocation(employee_id=emp_map["Markus Weber"], topic_id=top_map["Method Development Pentatonic"], percentage=20.0, comment="Pentatonic crash simulation setup."),

        # Lukas Fischer - Test Bonn (Total 120% - Overloaded!)
        models.Allocation(employee_id=emp_map["Lukas Fischer"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Required lab compliance training."),
        models.Allocation(employee_id=emp_map["Lukas Fischer"], topic_id=top_map["bookable 1 - Consulting Global"], percentage=10.0, comment="Bonn lab consulting requests."),
        models.Allocation(employee_id=emp_map["Lukas Fischer"], topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], percentage=40.0, comment="Front-end UI tester and advisor."),
        models.Allocation(employee_id=emp_map["Lukas Fischer"], topic_id=top_map["Fuel Project"], percentage=20.0, comment="Physical test rig supervisor."),
        models.Allocation(employee_id=emp_map["Lukas Fischer"], topic_id=top_map["Creation of Test Standards"], percentage=40.0, comment="Drafting new global validation guidelines."),

        # Priya Sharma - CAE India (Total 80%)
        models.Allocation(employee_id=emp_map["Priya Sharma"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Regular admin tasks."),
        models.Allocation(employee_id=emp_map["Priya Sharma"], topic_id=top_map["bookable 1 - Consulting Global"], percentage=10.0, comment="Mesh automation support."),
        models.Allocation(employee_id=emp_map["Priya Sharma"], topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], percentage=50.0, comment="Data ingestion and parsing development."),
        models.Allocation(employee_id=emp_map["Priya Sharma"], topic_id=top_map["Fuel Project"], percentage=10.0, comment="Basic structural meshing for Fuel Project."),

        # Arjun Mehta - Test India (Total 110% - Overloaded!)
        models.Allocation(employee_id=emp_map["Arjun Mehta"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Standard admin time."),
        models.Allocation(employee_id=emp_map["Arjun Mehta"], topic_id=top_map["bookable 1 - Consulting Global"], percentage=10.0, comment="Local test support."),
        models.Allocation(employee_id=emp_map["Arjun Mehta"], topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], percentage=50.0, comment="Testing visual charts and exporting."),
        models.Allocation(employee_id=emp_map["Arjun Mehta"], topic_id=top_map["Fuel Project"], percentage=10.0, comment="Test run operations."),
        models.Allocation(employee_id=emp_map["Arjun Mehta"], topic_id=top_map["Creation of Test Standards"], percentage=30.0, comment="Helping standardise India lab procedures."),

        # Carlos Hernández - CAE Mexico (Total 90%)
        models.Allocation(employee_id=emp_map["Carlos Hernández"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Admin and locale support."),
        models.Allocation(employee_id=emp_map["Carlos Hernández"], topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], percentage=50.0, comment="Model testing and scenarios design."),
        models.Allocation(employee_id=emp_map["Carlos Hernández"], topic_id=top_map["Method Development Pentatonic"], percentage=30.0, comment="Pentatonic crash simulations assistance."),

        # Ana Martínez - Test Mexico (Total 90%)
        models.Allocation(employee_id=emp_map["Ana Martínez"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Local compliance check."),
        models.Allocation(employee_id=emp_map["Ana Martínez"], topic_id=top_map["Fuel Project"], percentage=50.0, comment="Primary test rig support."),
        models.Allocation(employee_id=emp_map["Ana Martínez"], topic_id=top_map["Creation of Test Standards"], percentage=30.0, comment="Aligning Mexico lab specs."),

        # Andreea Ionescu - CAE Romania (Total 100%)
        models.Allocation(employee_id=emp_map["Andreea Ionescu"], topic_id=top_map["Non bookable - Other"], percentage=20.0, comment="Extended training and administrative duties."),
        models.Allocation(employee_id=emp_map["Andreea Ionescu"], topic_id=top_map["bookable 1 - Consulting Global"], percentage=10.0, comment="Consulting for German hub."),
        models.Allocation(employee_id=emp_map["Andreea Ionescu"], topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], percentage=20.0, comment="SQL engine testing."),
        models.Allocation(employee_id=emp_map["Andreea Ionescu"], topic_id=top_map["Fuel Project"], percentage=30.0, comment="Thermal modeling for Fuel Project."),
        models.Allocation(employee_id=emp_map["Andreea Ionescu"], topic_id=top_map["Method Development Pentatonic"], percentage=20.0, comment="Pentatonic thermal validation."),

        # Mihai Dumitrescu - Test Romania (Total 95%)
        models.Allocation(employee_id=emp_map["Mihai Dumitrescu"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Required safety checks."),
        models.Allocation(employee_id=emp_map["Mihai Dumitrescu"], topic_id=top_map["bookable 1 - Consulting Global"], percentage=10.0, comment="Test consulting."),
        models.Allocation(employee_id=emp_map["Mihai Dumitrescu"], topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], percentage=40.0, comment="QA verification."),
        models.Allocation(employee_id=emp_map["Mihai Dumitrescu"], topic_id=top_map["Fuel Project"], percentage=20.0, comment="Validation lead for Fuel Project Romania."),
        models.Allocation(employee_id=emp_map["Mihai Dumitrescu"], topic_id=top_map["Creation of Test Standards"], percentage=15.0, comment="Reviewing Romanian translation of ISO guidelines."),

        # Michael Johnson - Test Troy (Total 80%)
        models.Allocation(employee_id=emp_map["Michael Johnson"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Standard administrative tasks."),
        models.Allocation(employee_id=emp_map["Michael Johnson"], topic_id=top_map["Fuel Project"], percentage=70.0, comment="Primary customer liaison validator in the US."),

        # Wei Zhang - Test Pinghu (Total 90%)
        models.Allocation(employee_id=emp_map["Wei Zhang"], topic_id=top_map["Non bookable - Other"], percentage=10.0, comment="Compliance safety meeting."),
        models.Allocation(employee_id=emp_map["Wei Zhang"], topic_id=top_map["Creation of Test Standards"], percentage=80.0, comment="Harmonising China lab testing metrics."),
    ]

    for alloc in allocations:
        db.add(alloc)
    db.commit()

    # Add Additional Costs for Agentic AI
    add_costs = [
        # Agentic AI project
        models.AdditionalCost(topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], cost_type="internal", category="CAD", amount=5000.0, notes="CAD modeling licenses for UI prototyping."),
        models.AdditionalCost(topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], cost_type="internal", category="Internal Equipment", amount=3000.0, notes="Local testing servers rent."),
        models.AdditionalCost(topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], cost_type="external", category="Tooling", amount=10000.0, notes="UI design tools premium licensing."),
        models.AdditionalCost(topic_id=top_map["Agentic AI and LLM - Enterprise Solutions"], cost_type="external", category="Prototypes", amount=15000.0, notes="Testing prototype deployment host."),

        # Fuel Project
        models.AdditionalCost(topic_id=top_map["Fuel Project"], cost_type="external", category="Supplier Support", amount=25000.0, notes="Dedicated validation consulting from supplier."),
        models.AdditionalCost(topic_id=top_map["Fuel Project"], cost_type="external", category="External Testing", amount=15000.0, notes="High pressure chamber certification test lab."),
    ]

    for cost in add_costs:
        db.add(cost)
    db.commit()

    print("Database seeded successfully with active Scenario: Baseline Scenario (2027 Planning)")
    db.close()

if __name__ == "__main__":
    seed()
