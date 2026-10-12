import sqlite3
import tempfile
import unittest
from contextlib import closing
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

import server
from ai_service import AIService, generate_clash_free_timetable
from college_scheduler import ScheduleValidationError, WEEKDAYS


class OfflineAssistantTests(unittest.TestCase):
    def setUp(self):
        self.ai = AIService("offline", "", "", "")
        self.context = {
            "teachers": ["Asha Demo", "Kavita Rao"],
            "subjects": ["Mathematics", "Computer Science", "Science"],
            "classes": ["Class 9-A"],
            "classrooms": ["Room 101"],
            "labs": ["Science Lab"],
            "teacher_expertise": {
                "Asha Demo": ["Mathematics"],
                "Kavita Rao": ["Computer Science", "Science"],
            },
            "generated_timetable": {
                "Monday": {
                    "Class 9-A": {
                        "1": {
                            "subject": "Mathematics",
                            "teacher": "Asha Demo",
                            "room": "Room 101",
                        },
                        "2": {
                            "subject": "Science",
                            "teacher": "Kavita Rao",
                            "room": "Room 101",
                        },
                    },
                },
            },
        }

    def ask(self, prompt, language="en"):
        return self.ai.ask(prompt, self.context, language=language)

    def test_answers_teacher_expertise_and_subject_assignments(self):
        self.assertIn("Computer Science, Science", self.ask("what subjects does Kavita Rao teach?"))
        self.assertIn("Asha Demo", self.ask("who teaches Mathematics?"))

    def test_lists_and_counts_rooms_and_labs(self):
        self.assertIn("There are 2 rooms", self.ask("how many rooms?"))
        self.assertIn("Science Lab", self.ask("show all rooms"))

    def test_filters_timetable_by_period_and_room(self):
        answer = self.ask("show Class 9-A Monday period 2")
        self.assertIn("Science", answer)
        self.assertNotIn("Mathematics", answer)
        room_answer = self.ask("which classes use Room 101?")
        self.assertEqual(room_answer, "Classes using Room 101: Class 9-A.")

    def test_filters_timetable_by_subject(self):
        answer = self.ask("show Science timetable")
        self.assertIn("Science", answer)
        self.assertNotIn("Mathematics", answer)

    def test_reports_current_timetable_workload(self):
        answer = self.ask("teacher workload")
        self.assertIn("Asha Demo: 1", answer)
        self.assertIn("Kavita Rao: 1", answer)

    def test_returns_hindi_for_hindi_language_selection(self):
        self.assertIn("शिक्षक", self.ask("कितने शिक्षक हैं?", language="hi"))


class DemoDataTests(unittest.TestCase):
    def test_local_existing_database_migrates_without_adding_demo_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "existing.sqlite3"
            with sqlite3.connect(database) as connection:
                connection.executescript(
                    """
                    CREATE TABLE teachers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        email TEXT DEFAULT '',
                        phone TEXT DEFAULT '',
                        is_deleted INTEGER DEFAULT 0
                    );
                    CREATE TABLE subjects (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        is_deleted INTEGER DEFAULT 0
                    );
                    CREATE TABLE classes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        is_deleted INTEGER DEFAULT 0
                    );
                    CREATE TABLE classrooms (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        is_deleted INTEGER DEFAULT 0
                    );
                    CREATE TABLE lab_rooms (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        is_deleted INTEGER DEFAULT 0
                    );
                    CREATE TABLE teacher_expertise (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        teacher TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        UNIQUE (teacher, subject)
                    );
                    CREATE TABLE timetable_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        class_name TEXT,
                        day TEXT,
                        period INTEGER,
                        subject TEXT,
                        teacher TEXT,
                        room TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                    INSERT INTO teachers (name) VALUES ('Existing Faculty');
                    INSERT INTO subjects (name) VALUES ('Existing Subject');
                    INSERT INTO classes (name) VALUES ('Existing Class');
                    INSERT INTO classrooms (name) VALUES ('Existing Room');
                    INSERT INTO lab_rooms (name) VALUES ('Existing Lab');
                    INSERT INTO teacher_expertise (teacher, subject)
                    VALUES ('Existing Faculty', 'Existing Subject');
                    INSERT INTO timetable_entries
                        (class_name, day, period, subject, teacher, room)
                    VALUES
                        ('Existing Class', 'Monday', 1, 'Existing Subject',
                         'Existing Faculty', 'Existing Room');
                    """
                )
            connection.close()

            with patch.object(server, "DATABASE", database), patch.object(
                server, "SEED_DEMO_DATA", False
            ):
                server.initialize_database()
                with closing(server.open_database()) as connection:
                    self.assertEqual(
                        [row["name"] for row in connection.execute("SELECT name FROM teachers")],
                        ["Existing Faculty"],
                    )
                    self.assertEqual(
                        [row["name"] for row in connection.execute("SELECT name FROM subjects")],
                        ["Existing Subject"],
                    )
                    self.assertEqual(
                        [row["name"] for row in connection.execute("SELECT name FROM classes")],
                        ["Existing Class"],
                    )
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM timetable_entries").fetchone()[0],
                        1,
                    )
                    columns = {
                        row["name"]
                        for row in connection.execute("PRAGMA table_info(timetable_entries)")
                    }
                    self.assertIn("subject_code", columns)
                    self.assertIn("practical_session", columns)
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM college_requirements").fetchone()[0],
                        0,
                    )

    def test_college_generation_uses_configured_database_and_saves_validated_week(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "college.sqlite3"
            with patch.object(server, "DATABASE", database):
                server.initialize_database()
                with closing(server.open_database()) as connection:
                    with connection:
                        connection.execute("DELETE FROM timetable_entries")
                        connection.execute("DELETE FROM teacher_expertise")
                        connection.execute("DELETE FROM college_class_details")
                        connection.execute("DELETE FROM college_subject_details")
                        connection.execute("DELETE FROM college_requirements")
                        connection.execute("DELETE FROM college_room_details")
                        connection.execute("DELETE FROM teacher_unavailability")
                        connection.execute("DELETE FROM teacher_availability_settings")
                        connection.execute("DELETE FROM classes")
                        connection.execute("DELETE FROM subjects")
                        connection.execute("DELETE FROM teachers")
                        connection.execute("DELETE FROM classrooms")
                        connection.execute("DELETE FROM lab_rooms")
                        connection.execute("INSERT INTO classes (name) VALUES ('CSE-1-A')")
                        connection.execute("INSERT INTO subjects (name) VALUES ('Data Structures')")
                        connection.execute(
                            "INSERT INTO teachers (name) VALUES ('Faculty A')"
                        )
                        connection.execute(
                            "INSERT INTO teacher_expertise (teacher, subject) "
                            "VALUES ('Faculty A', 'Data Structures')"
                        )
                        connection.execute(
                            "INSERT INTO classrooms (name) VALUES ('Room C1')"
                        )
                        connection.execute(
                            "INSERT INTO classrooms (name) VALUES ('Room C2')"
                        )
                        connection.execute(
                            "INSERT INTO lab_rooms (name) VALUES ('Lab C1')"
                        )
                        handler = object.__new__(server.PreviewHandler)

                        def setup(kind, **data):
                            return server.PreviewHandler.handle_post(
                                handler,
                                connection,
                                "/api/college-setup",
                                {"kind": kind, **data},
                            )

                        setup(
                            "class",
                            class_name="CSE-1-A",
                            department="CSE",
                            academic_year="2026-27",
                            semester="1",
                            section="A",
                            capacity=30,
                        )
                        setup(
                            "subject",
                            subject_name="Data Structures",
                            subject_code="CSE101",
                        )
                        setup(
                            "room",
                            room_name="Room C1",
                            room_type="classroom",
                            capacity=35,
                        )
                        setup(
                            "room",
                            room_name="Room C2",
                            room_type="classroom",
                            capacity=35,
                        )
                        setup(
                            "room",
                            room_name="Lab C1",
                            room_type="laboratory",
                            capacity=35,
                        )
                        setup(
                            "requirement",
                            class_name="CSE-1-A",
                            subject_name="Data Structures",
                            teacher_name="",
                            lecture_count=5,
                            practical_count=1,
                            practical_block_size=2,
                            requires_lab=True,
                        )
                        setup(
                            "availability",
                            teacher_name="Faculty A",
                            periods_per_day=4,
                            unavailable=[{"day": "Monday", "period": 1}],
                        )
                        result = server.PreviewHandler.handle_post(
                            handler,
                            connection,
                            "/api/timetable/generate",
                            {
                                "periods_per_day": 4,
                                "start_time": "09:00",
                                "period_minutes": 50,
                                "days": ["Sunday", "Friday"],
                            },
                        )
                    state = server.fetch_state(connection)
                    self.assertTrue(result["ok"])
                    self.assertEqual(result["days"], list(WEEKDAYS))
                    self.assertEqual(state["days"], list(WEEKDAYS))
                    self.assertTrue(state["college_schedule_validated"])
                    self.assertEqual(result["classes"], 1)
                    self.assertEqual(result["entries"], 7)
                    self.assertEqual(len(state["weekly_entries"]), 7)
                    self.assertEqual(
                        {entry["day"] for entry in state["weekly_entries"]},
                        set(WEEKDAYS),
                    )
                    self.assertTrue(
                        all(entry["subject_code"] == "CSE101" for entry in state["weekly_entries"])
                    )
                    self.assertNotIn(
                        ("Monday", 1),
                        {
                            (entry["day"], entry["period"])
                            for entry in state["weekly_entries"]
                            if entry["teacher"] == "Faculty A"
                        },
                    )
                    self.assertFalse(
                        any(entry["day"] == "Sunday" for entry in state["weekly_entries"])
                    )
                    lecture = next(
                        entry for entry in state["weekly_entries"]
                        if entry["entry_type"] == "lecture"
                    )
                    with connection:
                        server.PreviewHandler.handle_post(
                            handler,
                            connection,
                            "/api/timetable/edit",
                            {
                                "day": lecture["day"],
                                "period": lecture["period"],
                                "class_name": lecture["class_name"],
                                "teacher": lecture["teacher"],
                                "room": "Room C2",
                            },
                        )
                    edited = server.fetch_state(connection)
                    self.assertTrue(edited["college_schedule_validated"])
                    self.assertTrue(any(
                        entry["room"] == "Room C2"
                        and entry["class_name"] == lecture["class_name"]
                        and entry["day"] == lecture["day"]
                        and entry["period"] == lecture["period"]
                        for entry in edited["weekly_entries"]
                    ))
                    workbook = server.excel_workbook(edited)
                    with ZipFile(BytesIO(workbook)) as archive:
                        sheet = archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
                    self.assertIn("CSE101", sheet)
                    self.assertIn("09:00", sheet)
                    pdf = server.timetable_pdf(edited["generated_timetable"])
                    self.assertIn(b"CSE101", pdf)
                    with self.assertRaisesRegex(ValueError, "requires a configured classroom"):
                        with connection:
                            server.PreviewHandler.handle_post(
                                handler,
                                connection,
                                "/api/timetable/edit",
                                {
                                    "day": lecture["day"],
                                    "period": lecture["period"],
                                    "class_name": lecture["class_name"],
                                    "teacher": lecture["teacher"],
                                    "room": "Lab C1",
                                },
                            )

    def test_incomplete_college_setup_does_not_overwrite_existing_schedule(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "college.sqlite3"
            with patch.object(server, "DATABASE", database):
                server.initialize_database()
                with closing(server.open_database()) as connection:
                    before = connection.execute(
                        "SELECT COUNT(*) FROM timetable_entries"
                    ).fetchone()[0]
                    with self.assertRaises(ScheduleValidationError) as caught:
                        server.generate_configured_week(connection, 8, "09:00", 60)
                    after = connection.execute(
                        "SELECT COUNT(*) FROM timetable_entries"
                    ).fetchone()[0]
                    self.assertEqual(after, before)
                    self.assertTrue(caught.exception.diagnostics["missing_records"])

    def test_expanded_demo_data_migrates_once_and_asset_add_works(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "demo.sqlite3"
            with patch.object(server, "DATABASE", database):
                server.initialize_database()
                with closing(server.open_database()) as connection:
                    state = server.fetch_state(connection)
                    self.assertEqual(len(state["teachers"]), 6)
                    self.assertIn("Class 10-A", state["classes"])
                    self.assertIn("Computer Lab", state["labs"])

                    result = server.PreviewHandler.handle_post(
                        object.__new__(server.PreviewHandler),
                        connection,
                        "/api/assets",
                        {"category": "teachers", "name": "Test Teacher"},
                    )
                    self.assertTrue(result["ok"])
                    self.assertIn(
                        "Test Teacher",
                        [teacher["name"] for teacher in server.fetch_state(connection)["teachers"]],
                    )

                    connection.execute(
                        "UPDATE teachers SET is_deleted = 1 WHERE name = ?",
                        ("Kavita Rao",),
                    )
                    connection.commit()

                server.initialize_database()
                with closing(server.open_database()) as connection:
                    self.assertEqual(
                        connection.execute(
                            "SELECT is_deleted FROM teachers WHERE name = ?",
                            ("Kavita Rao",),
                        ).fetchone()[0],
                        1,
                    )
                    self.assertEqual(
                        connection.execute(
                            "SELECT COUNT(*) FROM teachers WHERE name = ?",
                            ("Kavita Rao",),
                        ).fetchone()[0],
                        1,
                    )

    def test_asset_add_rejects_missing_category(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "demo.sqlite3"
            with patch.object(server, "DATABASE", database):
                server.initialize_database()
                with closing(server.open_database()) as connection:
                    with self.assertRaisesRegex(ValueError, "asset type"):
                        server.PreviewHandler.handle_post(
                            object.__new__(server.PreviewHandler),
                            connection,
                            "/api/assets",
                            {"name": "Missing Type"},
                        )

    def test_expanded_assets_can_generate_a_clash_free_timetable(self):
        schedule = generate_clash_free_timetable(
            teachers=[
                "Asha Demo", "Rohan Demo", "Meera Demo",
                "Kavita Rao", "Arjun Mehta", "Nisha Kapoor",
            ],
            subjects=[
                "Mathematics", "Science", "English",
                "Computer Science", "Hindi", "Social Studies",
            ],
            classes=["Class 8-A", "Class 9-A", "Class 9-B", "Class 10-A"],
            expertise={
                "Asha Demo": ["Mathematics", "Science"],
                "Rohan Demo": ["Mathematics", "English"],
                "Meera Demo": ["Science", "English"],
                "Kavita Rao": ["Mathematics", "Computer Science", "Hindi"],
                "Arjun Mehta": ["Science", "Social Studies", "Computer Science"],
                "Nisha Kapoor": ["English", "Hindi", "Social Studies"],
            },
            classrooms=["Room 101", "Room 102", "Room 103", "Room 104"],
            days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            periods_per_day=6,
        )
        entries = [
            (day, period, entry)
            for day, day_data in schedule.items()
            for periods in day_data.values()
            for period, entry in periods.items()
        ]
        self.assertEqual(len(entries), 120)
        for day in schedule:
            for period in range(1, 7):
                period_entries = [
                    periods[period]
                    for periods in schedule[day].values()
                ]
                self.assertEqual(
                    len({entry["teacher"] for entry in period_entries}),
                    len(period_entries),
                )
                self.assertEqual(
                    len({entry["room"] for entry in period_entries}),
                    len(period_entries),
                )


if __name__ == "__main__":
    unittest.main()
