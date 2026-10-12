import unittest
from collections import Counter, defaultdict

from college_scheduler import (
    ScheduleValidationError,
    WEEKDAYS,
    generate_college_timetable,
    validate_weekly_schedule,
)


def college_data():
    classes = [
        {
            "class_name": "CSE-1-A",
            "department": "CSE",
            "academic_year": "2026-27",
            "semester": "1",
            "section": "A",
            "capacity": 40,
        },
        {
            "class_name": "CSE-1-B",
            "department": "CSE",
            "academic_year": "2026-27",
            "semester": "1",
            "section": "B",
            "capacity": 30,
        },
    ]
    subjects = {
        "Mathematics": {"subject_name": "Mathematics", "subject_code": "MA101"},
        "Programming Lab": {"subject_name": "Programming Lab", "subject_code": "CS101"},
    }
    teachers = ["Teacher A", "Teacher B"]
    expertise = {
        "Teacher A": ["Mathematics", "Programming Lab"],
        "Teacher B": ["Mathematics", "Programming Lab"],
    }
    rooms = [
        {"room_name": "Room 1", "room_type": "classroom", "capacity": 45},
        {"room_name": "Room 2", "room_type": "classroom", "capacity": 35},
        {"room_name": "Lab 1", "room_type": "laboratory", "capacity": 45},
    ]
    requirements = [
        {
            "class_name": class_info["class_name"],
            "subject_name": "Mathematics",
            "teacher_name": "",
            "lecture_count": 2,
            "practical_count": 0,
            "practical_block_size": 2,
            "requires_lab": 0,
        }
        for class_info in classes
    ] + [
        {
            "class_name": class_info["class_name"],
            "subject_name": "Programming Lab",
            "teacher_name": "",
            "lecture_count": 0,
            "practical_count": 1,
            "practical_block_size": 2,
            "requires_lab": 1,
        }
        for class_info in classes
    ]
    return {
        "classes": classes,
        "subjects": subjects,
        "teachers": teachers,
        "expertise": expertise,
        "rooms": rooms,
        "requirements": requirements,
        "unavailable": {"Teacher A": {("Monday", 1)}},
        "availability_configured": set(teachers),
        "periods_per_day": 4,
        "start_time": "09:00",
        "period_minutes": 50,
    }


class CollegeScheduleTests(unittest.TestCase):
    def test_generates_complete_six_day_schedule_with_required_fields(self):
        result = generate_college_timetable(**college_data())
        schedule = result["schedule"]
        entries = result["entries"]
        self.assertEqual(tuple(schedule), WEEKDAYS)
        self.assertNotIn("Sunday", schedule)
        self.assertTrue(result["validation"]["ok"])
        self.assertEqual(result["validation"]["classes"], 2)
        self.assertEqual(len(entries), 8)

        required_fields = {
            "day", "department", "academic_year", "semester", "class_name",
            "section", "subject", "subject_code", "teacher", "start_time",
            "end_time", "entry_type", "room", "period",
        }
        self.assertTrue(all(required_fields <= entry.keys() for entry in entries))

        classes_by_slot = Counter((entry["day"], entry["period"], entry["class_name"]) for entry in entries)
        teachers_by_slot = Counter((entry["day"], entry["period"], entry["teacher"]) for entry in entries)
        rooms_by_slot = Counter((entry["day"], entry["period"], entry["room"]) for entry in entries)
        self.assertTrue(all(count == 1 for count in classes_by_slot.values()))
        self.assertTrue(all(count == 1 for count in teachers_by_slot.values()))
        self.assertTrue(all(count == 1 for count in rooms_by_slot.values()))

        practical_sessions = defaultdict(list)
        for entry in entries:
            if entry["entry_type"] == "practical":
                practical_sessions[entry["practical_session"]].append(entry)
        self.assertEqual(len(practical_sessions), 2)
        for session in practical_sessions.values():
            self.assertEqual(len({entry["day"] for entry in session}), 1)
            self.assertEqual(len({entry["teacher"] for entry in session}), 1)
            self.assertEqual(len({entry["room"] for entry in session}), 1)
            self.assertEqual(
                sorted(entry["period"] for entry in session),
                list(range(min(entry["period"] for entry in session), max(entry["period"] for entry in session) + 1)),
            )
            self.assertTrue(all(entry["room"] == "Lab 1" for entry in session))

    def test_uses_all_six_days_and_changes_consecutive_collegewide_patterns(self):
        entries = generate_college_timetable(**college_data())["entries"]
        signatures = {
            day: sorted(
                (
                    entry["class_name"],
                    entry["period"],
                    entry["subject"],
                    entry["teacher"],
                    entry["room"],
                    entry["entry_type"],
                )
                for entry in entries
                if entry["day"] == day
            )
            for day in WEEKDAYS
        }
        self.assertTrue(all(signatures[day] for day in WEEKDAYS))
        for previous, current in zip(WEEKDAYS, WEEKDAYS[1:]):
            self.assertNotEqual(signatures[previous], signatures[current])

    def test_spreads_repeat_lectures_across_distinct_slots_when_possible(self):
        entries = generate_college_timetable(**college_data())["entries"]
        slots = [
            (entry["day"], entry["period"])
            for entry in entries
            if entry["class_name"] == "CSE-1-A"
            and entry["subject"] == "Mathematics"
        ]
        self.assertEqual(len(slots), 2)
        self.assertEqual(len(set(slots)), 2)

    def test_missing_academic_metadata_blocks_generation_with_diagnostics(self):
        data = college_data()
        data["classes"][0]["department"] = ""
        data["subjects"]["Mathematics"]["subject_code"] = ""
        with self.assertRaises(ScheduleValidationError) as caught:
            generate_college_timetable(**data)
        self.assertTrue(any("department" in item for item in caught.exception.diagnostics["missing_records"]))
        self.assertTrue(any("subject code" in item for item in caught.exception.diagnostics["missing_records"]))

    def test_warns_when_an_active_subject_has_no_class_requirements(self):
        data = college_data()
        data["subjects"]["Chemistry"] = {
            "subject_name": "Chemistry",
            "subject_code": "CH101",
        }
        result = generate_college_timetable(**data)
        self.assertTrue(any(
            "Chemistry" in warning and "will not appear" in warning
            for warning in result["validation"]["warnings"]
        ))

    def test_unconfirmed_teacher_availability_blocks_generation(self):
        data = college_data()
        data["availability_configured"].remove("Teacher B")
        with self.assertRaises(ScheduleValidationError) as caught:
            generate_college_timetable(**data)
        self.assertTrue(any("Teacher B" in item for item in caught.exception.diagnostics["missing_records"]))

    def test_room_capacity_is_a_hard_constraint(self):
        data = college_data()
        data["rooms"][0]["capacity"] = 10
        data["rooms"][1]["capacity"] = 10
        with self.assertRaises(ScheduleValidationError) as caught:
            generate_college_timetable(**data)
        self.assertTrue(caught.exception.diagnostics["unscheduled"])

    def test_teacher_unavailability_is_respected(self):
        data = college_data()
        data["unavailable"] = {
            teacher: {(day, period) for day in WEEKDAYS for period in range(1, 5)}
            for teacher in data["teachers"]
        }
        with self.assertRaises(ScheduleValidationError) as caught:
            generate_college_timetable(**data)
        self.assertTrue(caught.exception.diagnostics["unscheduled"])

    def test_practical_sessions_must_be_consecutive(self):
        data = college_data()
        data["requirements"][2]["practical_block_size"] = 1
        with self.assertRaises(ScheduleValidationError) as caught:
            generate_college_timetable(**data)
        self.assertTrue(caught.exception.diagnostics["errors"])

    def test_reports_when_daily_requirements_force_identical_consecutive_days(self):
        data = college_data()
        data["classes"] = [data["classes"][0]]
        data["subjects"] = {
            "Mathematics": {"subject_name": "Mathematics", "subject_code": "MA101"}
        }
        data["teachers"] = ["Teacher A"]
        data["expertise"] = {"Teacher A": ["Mathematics"]}
        data["rooms"] = [
            {"room_name": "Room 1", "room_type": "classroom", "capacity": 40}
        ]
        data["requirements"] = [
            {
                "class_name": "CSE-1-A",
                "subject_name": "Mathematics",
                "teacher_name": "Teacher A",
                "lecture_count": 6,
                "practical_count": 0,
                "practical_block_size": 2,
                "requires_lab": 0,
            }
        ]
        data["unavailable"] = {}
        data["availability_configured"] = {"Teacher A"}
        data["periods_per_day"] = 1

        with self.assertRaises(ScheduleValidationError) as caught:
            generate_college_timetable(**data)
        conflicts = " ".join(
            str(item) for item in caught.exception.diagnostics["conflicts"]
        )
        self.assertIn("consecutive college-wide timetables would be identical", conflicts)
        self.assertTrue(caught.exception.diagnostics["unscheduled"])

    def test_reports_when_total_weekly_load_cannot_fill_all_six_days(self):
        data = college_data()
        data["classes"] = [data["classes"][0]]
        data["subjects"] = {
            "Mathematics": {"subject_name": "Mathematics", "subject_code": "MA101"}
        }
        data["teachers"] = ["Teacher A"]
        data["expertise"] = {"Teacher A": ["Mathematics"]}
        data["rooms"] = [
            {"room_name": "Room 1", "room_type": "classroom", "capacity": 40}
        ]
        data["requirements"] = [
            {
                "class_name": "CSE-1-A",
                "subject_name": "Mathematics",
                "teacher_name": "Teacher A",
                "lecture_count": 5,
                "practical_count": 0,
                "practical_block_size": 2,
                "requires_lab": 0,
            }
        ]
        data["unavailable"] = {}
        data["availability_configured"] = {"Teacher A"}

        with self.assertRaises(ScheduleValidationError) as caught:
            generate_college_timetable(**data)
        self.assertTrue(any(
            "fewer periods than the six days" in error
            for error in caught.exception.diagnostics["errors"]
        ))

    def test_validator_reports_duplicate_entries_and_resource_clashes(self):
        classes = [{"class_name": "CSE-1-A", "department": "CSE"}]
        requirements = [{
            "class_name": "CSE-1-A",
            "subject_name": "Mathematics",
            "lecture_count": 1,
            "practical_count": 0,
            "practical_block_size": 2,
        }]
        entry = {
            "day": "Monday",
            "period": 1,
            "class_name": "CSE-1-A",
            "department": "CSE",
            "subject": "Mathematics",
            "teacher": "Teacher A",
            "room": "Room 1",
            "entry_type": "lecture",
        }

        errors = validate_weekly_schedule(
            [entry, dict(entry)], classes, requirements, periods_per_day=1
        )
        self.assertTrue(any("duplicate entry" in error for error in errors))
        self.assertTrue(any("class overlaps" in error for error in errors))
        self.assertTrue(any("teacher Teacher A is double-booked" in error for error in errors))
        self.assertTrue(any("room Room 1 is double-booked" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
