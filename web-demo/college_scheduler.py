"""Local, deterministic college timetable generation and validation."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta


WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
MAX_SEARCH_NODES = 100_000


class ScheduleValidationError(ValueError):
    def __init__(self, diagnostics: dict) -> None:
        self.diagnostics = diagnostics
        super().__init__("The weekly timetable could not be generated. Review the validation report.")


def _positive_integer(value: object, label: str, minimum: int = 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{label} must be an integer of at least {minimum}.")
    return value


def validate_weekly_schedule(
    entries: list[dict],
    classes: list[dict],
    requirements: list[dict],
    periods_per_day: int,
) -> list[str]:
    """Return every detectable completeness, requirement, or resource conflict."""
    errors: list[str] = []
    class_by_name = {item["class_name"]: item for item in classes}
    requirement_counts: Counter[tuple[str, str, str]] = Counter()
    occupied_classes: dict[tuple[str, int, str], str] = {}
    occupied_teachers: dict[tuple[str, int, str], str] = {}
    occupied_rooms: dict[tuple[str, int, str], str] = {}
    seen_entries: set[tuple[str, int, str]] = set()
    practical_sessions: dict[str, list[dict]] = defaultdict(list)
    day_signatures: dict[str, list[tuple]] = {day: [] for day in WEEKDAYS}

    for entry in entries:
        day = entry.get("day")
        period = entry.get("period")
        class_name = entry.get("class_name")
        teacher = entry.get("teacher")
        room = entry.get("room")
        subject = entry.get("subject")
        if day not in WEEKDAYS:
            errors.append(f"Entry uses an invalid day: {day!r}.")
            continue
        if not isinstance(period, int) or not 1 <= period <= periods_per_day:
            errors.append(f"{day}: invalid period {period!r}.")
            continue
        key = (day, period, class_name)
        if key in seen_entries:
            errors.append(f"{day} period {period}: duplicate entry for {class_name}.")
        seen_entries.add(key)

        label = f"{day} period {period} ({class_name})"
        if class_name not in class_by_name:
            errors.append(f"{label}: class is not configured.")
        elif entry.get("department") != class_by_name[class_name].get("department"):
            errors.append(f"{label}: department metadata does not match the configured class.")

        class_key = (day, period, class_name)
        teacher_key = (day, period, teacher)
        room_key = (day, period, room)
        if class_key in occupied_classes:
            errors.append(f"{label}: class overlaps {occupied_classes[class_key]}.")
        if teacher_key in occupied_teachers:
            errors.append(
                f"{day} period {period}: teacher {teacher} is double-booked for "
                f"{occupied_teachers[teacher_key]} and {class_name}."
            )
        if room_key in occupied_rooms:
            errors.append(
                f"{day} period {period}: room {room} is double-booked for "
                f"{occupied_rooms[room_key]} and {class_name}."
            )
        occupied_classes[class_key] = subject
        occupied_teachers[teacher_key] = class_name
        occupied_rooms[room_key] = class_name
        day_signatures[day].append(
            (
                class_name,
                period,
                subject,
                teacher,
                room,
                entry["entry_type"],
            )
        )
        requirement_counts[(class_name, subject, entry["entry_type"])] += 1
        if entry["entry_type"] == "practical":
            practical_sessions[entry.get("practical_session", "")].append(entry)

    for session_id, session_entries in practical_sessions.items():
        session_days = {entry["day"] for entry in session_entries}
        session_teachers = {entry["teacher"] for entry in session_entries}
        session_rooms = {entry["room"] for entry in session_entries}
        periods = sorted(entry["period"] for entry in session_entries)
        if (
            not session_id
            or len(session_days) != 1
            or len(session_teachers) != 1
            or len(session_rooms) != 1
            or periods != list(range(periods[0], periods[-1] + 1))
        ):
            errors.append(
                f"Practical session {session_id or '(missing id)'} must use consecutive "
                "periods on one day with the same teacher and laboratory."
            )

    for day in WEEKDAYS:
        if not day_signatures[day]:
            errors.append(f"{day}: no required timetable entries were scheduled.")
    for previous, current in zip(WEEKDAYS, WEEKDAYS[1:]):
        if (
            sorted(day_signatures[previous]) == sorted(day_signatures[current])
        ):
            errors.append(
                f"{previous} and {current}: consecutive college-wide timetables "
                "must not be identical."
            )

    for requirement in requirements:
        class_name = requirement["class_name"]
        subject = requirement["subject_name"]
        lecture_count = requirement["lecture_count"]
        practical_count = requirement["practical_count"]
        expected = {
            "lecture": lecture_count,
            "practical": practical_count * requirement["practical_block_size"],
        }
        for entry_type, expected_periods in expected.items():
            actual_periods = requirement_counts[(class_name, subject, entry_type)]
            if actual_periods != expected_periods:
                errors.append(
                    f"{class_name} / {subject}: expected {expected_periods} {entry_type} "
                    f"periods, found {actual_periods}."
                )

    return errors


def generate_college_timetable(
    *,
    classes: list[dict],
    subjects: dict[str, dict],
    teachers: list[str],
    expertise: dict[str, list[str]],
    rooms: list[dict],
    requirements: list[dict],
    unavailable: dict[str, set[tuple[str, int]]],
    availability_configured: set[str],
    periods_per_day: int,
    start_time: str,
    period_minutes: int,
) -> dict:
    """Create and validate the complete Monday-to-Saturday schedule from configured data."""
    diagnostics: dict[str, list] = {
        "errors": [],
        "warnings": [],
        "conflicts": [],
        "missing_records": [],
        "unscheduled": [],
        "search_nodes": 0,
    }
    try:
        periods = _positive_integer(periods_per_day, "Periods per day")
        minutes = _positive_integer(period_minutes, "Minutes per period")
        if periods > 12:
            raise ValueError("Periods per day cannot exceed 12.")
        if minutes > 240:
            raise ValueError("Minutes per period cannot exceed 240.")
        starts_at = datetime.strptime(start_time, "%H:%M")
        if starts_at + timedelta(minutes=periods * minutes) > starts_at.replace(
            hour=23, minute=59, second=59, microsecond=0
        ) + timedelta(seconds=1):
            raise ValueError("The configured periods extend past midnight; adjust the start time or period duration.")
    except (TypeError, ValueError) as exc:
        diagnostics["errors"].append(str(exc))
        raise ScheduleValidationError(diagnostics) from exc

    class_names = {item["class_name"] for item in classes}
    teacher_names = set(teachers)
    subject_names = set(subjects)
    for item in classes:
        for field, label in (
            ("department", "department"),
            ("academic_year", "academic year"),
            ("semester", "semester"),
            ("section", "section"),
        ):
            if not str(item.get(field, "")).strip():
                diagnostics["missing_records"].append(
                    f"Class {item['class_name']}: {label} is not configured."
                )
        if not isinstance(item.get("capacity"), int) or item["capacity"] < 1:
            diagnostics["missing_records"].append(
                f"Class {item['class_name']}: student capacity is not configured."
            )

    for subject_name in subject_names:
        if not str(subjects[subject_name].get("subject_code", "")).strip():
            diagnostics["missing_records"].append(
                f"Subject {subject_name}: subject code is not configured."
            )

    for room in rooms:
        if not isinstance(room.get("capacity"), int) or room["capacity"] < 1:
            diagnostics["missing_records"].append(
                f"Room {room['room_name']}: room capacity is not configured."
            )
        if room.get("room_type") not in {"classroom", "laboratory"}:
            diagnostics["missing_records"].append(
                f"Room {room['room_name']}: room type is invalid."
            )
    for teacher_name, blocked_slots in unavailable.items():
        for day, period in blocked_slots:
            if day not in WEEKDAYS or not 1 <= period <= periods:
                diagnostics["errors"].append(
                    f"Teacher {teacher_name}: unavailable slot {day} period {period} "
                    f"is outside the configured Monday–Saturday, 1–{periods} week."
                )
    for teacher_name in teachers:
        if teacher_name not in availability_configured:
            diagnostics["missing_records"].append(
                f"Teacher {teacher_name}: confirm weekly availability, including explicit confirmation "
                "that all configured slots are available if there are no restrictions."
            )

    if not classes:
        diagnostics["missing_records"].append("No active classes or sections are configured.")
    if not teachers:
        diagnostics["missing_records"].append("No active teachers are configured.")
    if not subject_names:
        diagnostics["missing_records"].append("No active subjects are configured.")
    if not rooms:
        diagnostics["missing_records"].append("No active classrooms or laboratories are configured.")
    if not requirements:
        diagnostics["missing_records"].append("No weekly class-subject requirements are configured.")

    required_classes = {item["class_name"] for item in requirements}
    for class_name in sorted(class_names - required_classes):
        diagnostics["missing_records"].append(
            f"Class {class_name}: no weekly subject requirements are configured."
        )
    configured_subjects = {item["subject_name"] for item in requirements}
    for subject_name in sorted(subject_names - configured_subjects):
        diagnostics["warnings"].append(
            f"Active subject {subject_name} has no class weekly requirement and will not appear "
            "in the generated timetable."
        )
    for requirement in requirements:
        class_name = requirement["class_name"]
        subject_name = requirement["subject_name"]
        if class_name not in class_names:
            diagnostics["errors"].append(
                f"Requirement references inactive or unknown class {class_name}."
            )
        if subject_name not in subject_names:
            diagnostics["errors"].append(
                f"{class_name}: requirement references inactive or unknown subject {subject_name}."
            )
        if requirement.get("teacher_name") and requirement["teacher_name"] not in teacher_names:
            diagnostics["errors"].append(
                f"{class_name} / {subject_name}: assigned teacher is not active."
            )

    if diagnostics["missing_records"] or diagnostics["errors"]:
        raise ScheduleValidationError(diagnostics)

    for requirement in requirements:
        lecture_count = requirement.get("lecture_count")
        practical_count = requirement.get("practical_count")
        block_size = requirement.get("practical_block_size")
        for field, value in (
            ("lecture count", lecture_count),
            ("practical session count", practical_count),
            ("practical block size", block_size),
        ):
            if isinstance(value, bool) or not isinstance(value, int):
                diagnostics["errors"].append(
                    f"{requirement['class_name']} / {requirement['subject_name']}: "
                    f"{field} must be an integer."
                )
        if (
            isinstance(lecture_count, int)
            and isinstance(practical_count, int)
            and isinstance(block_size, int)
            and (
                lecture_count < 0
                or practical_count < 0
                or (practical_count and block_size < 2)
                or not lecture_count + practical_count
            )
        ):
            diagnostics["errors"].append(
                f"{requirement['class_name']} / {requirement['subject_name']}: "
                "provide positive weekly lectures/practicals; practical blocks need at least 2 periods."
            )
        if all(isinstance(value, int) and value >= 0 for value in (lecture_count, practical_count, block_size)):
            weekly_periods = lecture_count + practical_count * block_size
            if weekly_periods > len(WEEKDAYS) * periods:
                diagnostics["errors"].append(
                    f"{requirement['class_name']} / {requirement['subject_name']}: "
                    f"{weekly_periods} required periods exceed the {len(WEEKDAYS) * periods}-period week."
                )
    if diagnostics["errors"]:
        raise ScheduleValidationError(diagnostics)

    normalized_requirements: list[dict] = []
    class_loads: Counter[str] = Counter()
    for requirement in requirements:
        item = dict(requirement)
        item["requires_lab"] = bool(item.get("requires_lab"))
        subject_info = subjects[item["subject_name"]]
        item["subject_code"] = subject_info["subject_code"]
        item["eligible_teachers"] = [
            item["teacher_name"]
        ] if item.get("teacher_name") else [
            name for name in teachers
            if item["subject_name"] in expertise.get(name, [])
        ]
        item["eligible_teachers"] = [
            name for name in item["eligible_teachers"]
            if name in teacher_names and item["subject_name"] in expertise.get(name, [])
        ]
        if not item["eligible_teachers"]:
            diagnostics["missing_records"].append(
                f"{item['class_name']} / {item['subject_name']}: no active teacher is assigned "
                "or marked as qualified in teacher expertise."
            )
        weekly_periods = item["lecture_count"] + (
            item["practical_count"] * item["practical_block_size"]
        )
        class_loads[item["class_name"]] += weekly_periods
        normalized_requirements.append(item)

    for class_name, load in class_loads.items():
        if load > len(WEEKDAYS) * periods:
            diagnostics["errors"].append(
                f"{class_name}: {load} weekly periods exceed the "
                f"{len(WEEKDAYS) * periods} available slots."
            )
    if diagnostics["missing_records"] or diagnostics["errors"]:
        raise ScheduleValidationError(diagnostics)

    if sum(class_loads.values()) < len(WEEKDAYS):
        diagnostics["errors"].append(
            "The configured weekly requirements contain fewer periods than the six "
            "days that must each have at least one scheduled entry."
        )
        raise ScheduleValidationError(diagnostics)

    tasks: list[dict] = []
    task_id = 0
    for requirement in normalized_requirements:
        for _ in range(requirement["lecture_count"]):
            tasks.append({**requirement, "duration": 1, "entry_type": "lecture", "task_id": task_id})
            task_id += 1
        for _ in range(requirement["practical_count"]):
            tasks.append({
                **requirement,
                "duration": requirement["practical_block_size"],
                "entry_type": "practical",
                "task_id": task_id,
            })
            task_id += 1

    valid_rooms = [
        room for room in rooms
        if isinstance(room.get("capacity"), int) and room["capacity"] > 0
    ]
    class_capacity = {item["class_name"]: item["capacity"] for item in classes}
    options_by_task: dict[int, list[tuple[str, int, str, dict]]] = {}
    for task in tasks:
        needed_room_type = (
            "laboratory"
            if task["entry_type"] == "practical" and task["requires_lab"]
            else "classroom"
        )
        possible_rooms = [
            room for room in valid_rooms
            if room["room_type"] == needed_room_type
            and room["capacity"] >= class_capacity[task["class_name"]]
        ]
        options = [
            (day, first_period, teacher, room)
            for day in WEEKDAYS
            for first_period in range(1, periods - task["duration"] + 2)
            for teacher in task["eligible_teachers"]
            for room in possible_rooms
            if all(
                (day, period) not in unavailable.get(teacher, set())
                for period in range(first_period, first_period + task["duration"])
            )
        ]
        options_by_task[task["task_id"]] = options
        if not options:
            if not possible_rooms:
                reason = (
                    f"No configured {needed_room_type} has at least "
                    f"{class_capacity[task['class_name']]} seats."
                )
            elif task["duration"] > periods:
                reason = (
                    f"The {task['duration']}-period activity cannot fit into "
                    f"a {periods}-period day."
                )
            elif not any(
                all(
                    (day, period) not in unavailable.get(teacher, set())
                    for period in range(start, start + task["duration"])
                )
                for teacher in task["eligible_teachers"]
                for day in WEEKDAYS
                for start in range(1, periods - task["duration"] + 2)
            ):
                reason = "All qualified teachers are unavailable for every possible placement."
            else:
                reason = (
                    f"No qualified-teacher, room, and consecutive-period combination "
                    "satisfies this activity."
                )
            conflict = {
                "class_name": task["class_name"],
                "subject_name": task["subject_name"],
                "entry_type": task["entry_type"],
                "periods_required": task["duration"],
                "reason": reason,
            }
            diagnostics["unscheduled"].append(conflict)
            diagnostics["conflicts"].append(conflict)

    if diagnostics["unscheduled"]:
        raise ScheduleValidationError(diagnostics)

    tasks.sort(
        key=lambda task: (
            len(options_by_task[task["task_id"]]),
            -task["duration"],
            task["class_name"],
            task["subject_name"],
            task["task_id"],
        )
    )
    remaining_periods = [0] * (len(tasks) + 1)
    for task_index in range(len(tasks) - 1, -1, -1):
        remaining_periods[task_index] = (
            remaining_periods[task_index + 1] + tasks[task_index]["duration"]
        )
    class_occupancy: set[tuple[str, int, str]] = set()
    teacher_occupancy: set[tuple[str, int, str]] = set()
    room_occupancy: set[tuple[str, int, str]] = set()
    class_day_load: Counter[tuple[str, str]] = Counter()
    teacher_day_load: Counter[tuple[str, str]] = Counter()
    college_day_load: Counter[str] = Counter()
    class_subject_period_days: Counter[tuple[str, str, int]] = Counter()
    class_subject_teacher_period_days: Counter[tuple[str, str, str, int]] = Counter()
    partial_day_signatures: dict[str, set[tuple]] = {
        day: set() for day in WEEKDAYS
    }
    placements: dict[int, tuple[str, int, str, dict]] = {}
    placed_tasks: dict[int, dict] = {}
    nodes = 0
    limit_reached = False
    failed_day_patterns: set[str] = set()

    def day_patterns_are_valid() -> bool:
        signatures: dict[str, tuple] = {}
        violations: set[str] = set()
        for day in WEEKDAYS:
            day_entries = []
            for task_id, placement in placements.items():
                placed_day, first_period, teacher, room, _ = placement
                if placed_day != day:
                    continue
                task = placed_tasks[task_id]
                for offset in range(task["duration"]):
                    day_entries.append(
                        (
                            task["class_name"],
                            first_period + offset,
                            task["subject_name"],
                            teacher,
                            room["room_name"],
                            task["entry_type"],
                        )
                    )
            if not day_entries:
                violations.add(f"{day}: no required timetable entries were scheduled.")
            signatures[day] = tuple(sorted(day_entries))

        for previous, current in zip(WEEKDAYS, WEEKDAYS[1:]):
            if signatures[previous] == signatures[current]:
                violations.add(
                    f"{previous} and {current}: consecutive college-wide timetables "
                    "would be identical."
                )
        failed_day_patterns.update(violations)
        return not violations

    def visit(index: int) -> bool:
        nonlocal nodes, limit_reached
        if index == len(tasks):
            return day_patterns_are_valid()
        empty_days = sum(not college_day_load[day] for day in WEEKDAYS)
        if remaining_periods[index] < empty_days:
            return False
        if nodes >= MAX_SEARCH_NODES:
            limit_reached = True
            return False

        task = tasks[index]
        class_name = task["class_name"]
        candidates = []
        for option in options_by_task[task["task_id"]]:
            day, first_period, teacher, room = option
            slots = [
                (day, period)
                for period in range(first_period, first_period + task["duration"])
            ]
            if any(
                (day_name, period, class_name) in class_occupancy
                or (day_name, period, teacher) in teacher_occupancy
                or (day_name, period, room["room_name"]) in room_occupancy
                for day_name, period in slots
            ):
                continue

            repeat_cost = 0
            period_cost = 0
            for _, period in slots:
                repeat_cost += 30 * class_subject_teacher_period_days[
                    (class_name, task["subject_name"], teacher, period)
                ]
                period_cost += 8 * class_subject_period_days[
                    (class_name, task["subject_name"], period)
                ]
            subject_today = sum(
                1
                for task_id in placements
                if placed_tasks[task_id]["class_name"] == class_name
                and placed_tasks[task_id]["subject_name"] == task["subject_name"]
                for placement in [placements[task_id]]
                if placement[0] == day
            )
            score = (
                repeat_cost
                + period_cost
                + subject_today * 12
                + class_day_load[(class_name, day)] * 4
                + teacher_day_load[(teacher, day)] * 2
                + college_day_load[day] * 40
            )
            candidate_signature = {
                (
                    class_name,
                    period,
                    task["subject_name"],
                    teacher,
                    room["room_name"],
                    task["entry_type"],
                )
                for _, period in slots
            }
            for adjacent_index in (
                WEEKDAYS.index(day) - 1,
                WEEKDAYS.index(day) + 1,
            ):
                if not 0 <= adjacent_index < len(WEEKDAYS):
                    continue
                adjacent_day = WEEKDAYS[adjacent_index]
                score += 1000 * len(
                    candidate_signature & partial_day_signatures[adjacent_day]
                )
            candidates.append((score, option, slots))

        candidates.sort(key=lambda candidate: (
            candidate[0],
            WEEKDAYS.index(candidate[1][0]),
            candidate[1][1],
            candidate[1][2],
            candidate[1][3]["room_name"],
        ))
        for _, option, slots in candidates:
            nodes += 1
            day, first_period, teacher, room = option
            for day_name, period in slots:
                class_occupancy.add((day_name, period, class_name))
                teacher_occupancy.add((day_name, period, teacher))
                room_occupancy.add((day_name, period, room["room_name"]))
                class_subject_period_days[(class_name, task["subject_name"], period)] += 1
                class_subject_teacher_period_days[
                    (class_name, task["subject_name"], teacher, period)
                ] += 1
            class_day_load[(class_name, day)] += task["duration"]
            teacher_day_load[(teacher, day)] += task["duration"]
            college_day_load[day] += task["duration"]
            placements[task["task_id"]] = (*option[:3], room, task["task_id"])
            placed_tasks[task["task_id"]] = task
            partial_day_signatures[day].update(candidate_signature)

            if visit(index + 1):
                return True

            partial_day_signatures[day].difference_update(candidate_signature)
            del placements[task["task_id"]]
            del placed_tasks[task["task_id"]]
            class_day_load[(class_name, day)] -= task["duration"]
            teacher_day_load[(teacher, day)] -= task["duration"]
            college_day_load[day] -= task["duration"]
            for day_name, period in slots:
                class_occupancy.remove((day_name, period, class_name))
                teacher_occupancy.remove((day_name, period, teacher))
                room_occupancy.remove((day_name, period, room["room_name"]))
                class_subject_period_days[(class_name, task["subject_name"], period)] -= 1
                class_subject_teacher_period_days[
                    (class_name, task["subject_name"], teacher, period)
                ] -= 1
            if limit_reached:
                return False
        return False

    solved = visit(0)
    diagnostics["search_nodes"] = nodes
    if not solved:
        unscheduled_task_ids = {task["task_id"] for task in tasks}
        diagnostics["unscheduled"] = [
            {
                "class_name": task["class_name"],
                "subject_name": task["subject_name"],
                "entry_type": task["entry_type"],
                "periods_required": task["duration"],
                "reason": "Search limit reached before a complete schedule was found."
                if limit_reached else "No clash-free placement exists for this activity.",
            }
            for task in tasks
            if task["task_id"] in unscheduled_task_ids
        ]
        diagnostics["conflicts"] = list(diagnostics["unscheduled"])
        diagnostics["conflicts"].extend(sorted(failed_day_patterns))
        diagnostics["errors"].append(
            "Search limit reached; no schedule was saved."
            if limit_reached
            else "Scheduling constraints are mutually incompatible; no schedule was saved."
        )
        raise ScheduleValidationError(diagnostics)

    class_details = {item["class_name"]: item for item in classes}
    schedule: dict[str, dict[str, dict[int, dict]]] = {
        day: {item["class_name"]: {} for item in classes}
        for day in WEEKDAYS
    }
    entries: list[dict] = []
    for task in tasks:
        day, first_period, teacher, room, _ = placements[task["task_id"]]
        class_info = class_details[task["class_name"]]
        for offset in range(task["duration"]):
            period = first_period + offset
            start = starts_at + timedelta(minutes=(period - 1) * minutes)
            end = start + timedelta(minutes=minutes)
            entry = {
                "day": day,
                "department": class_info["department"],
                "academic_year": class_info["academic_year"],
                "semester": class_info["semester"],
                "class_name": task["class_name"],
                "section": class_info["section"],
                "subject": task["subject_name"],
                "subject_code": task["subject_code"],
                "teacher": teacher,
                "start_time": start.strftime("%H:%M"),
                "end_time": end.strftime("%H:%M"),
                "entry_type": task["entry_type"],
                "room": room["room_name"],
                "period": period,
                "practical_session": (
                    f"{task['task_id']}" if task["entry_type"] == "practical" else ""
                ),
            }
            schedule[day][task["class_name"]][period] = entry
            entries.append(entry)

    entries.sort(
        key=lambda entry: (
            WEEKDAYS.index(entry["day"]),
            entry["period"],
            entry["department"].casefold(),
            entry["class_name"].casefold(),
        )
    )
    validation_errors = validate_weekly_schedule(
        entries, classes, normalized_requirements, periods
    )
    if validation_errors:
        diagnostics["errors"].extend(validation_errors)
        raise ScheduleValidationError(diagnostics)
    scheduled_teachers = {entry["teacher"] for entry in entries}
    for teacher_name in sorted(teacher_names - scheduled_teachers):
        diagnostics["warnings"].append(
            f"Active teacher {teacher_name} has no scheduled assignment; verify expertise "
            "and course mappings."
        )

    return {
        "schedule": schedule,
        "entries": entries,
        "validation": {
            "ok": True,
            "days": list(WEEKDAYS),
            "classes": len(classes),
            "entries": len(entries),
            "requirements": len(requirements),
            "search_nodes": nodes,
            "warnings": diagnostics["warnings"],
            "errors": [],
        },
    }
