(() => {
  "use strict";

  const main = document.querySelector("#main");
  const $ = (selector) => main.querySelector(selector);
  const assetTypes = [
    ["teachers", "Teachers"],
    ["subjects", "Subjects"],
    ["classes", "Classes"],
    ["classrooms", "Classrooms"],
    ["labs", "Lab Rooms"],
  ];
  let state;
  let page = "dashboard";
  let category = "teachers";
  let expertiseTeacher = "";
  let activeWeekday = "Monday";
  let weeklyView = false;
  const timetableFilters = {
    department: "",
    semester: "",
    class: "",
    section: "",
    teacher: "",
    room: "",
  };
  const defaultDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const preferenceKey = "timetable-scheduler-preferences";
  let preferenceStorageError = false;
  let preferences = loadPreferences();
  let replyLanguage = preferences.replyLanguage;
  let lightMode = preferences.theme === "light";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const card = (html, className = "") => `<div class="card ${className}">${html}</div>`;
  const heading = (title) => `<div class="page-head">${esc(title)}</div>`;
  const allTimetable = () => Object.entries(state.generated_timetable).flatMap(
    ([day, classes]) => Object.entries(classes).flatMap(
      ([className, periods]) => Object.entries(periods).map(([period, item]) => ({
        day, className, period: Number(period), ...item,
      })),
    ),
  );

  function loadPreferences() {
    const defaults = {
      replyLanguage: "hi",
      theme: "dark",
      periodsPerDay: 8,
      weekdays: "",
    };
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      return {
        replyLanguage: ["hi", "en"].includes(saved.replyLanguage) ? saved.replyLanguage : defaults.replyLanguage,
        theme: ["dark", "light"].includes(saved.theme) ? saved.theme : defaults.theme,
        periodsPerDay: Number.isInteger(saved.periodsPerDay) && saved.periodsPerDay >= 1 && saved.periodsPerDay <= 12
          ? saved.periodsPerDay
          : defaults.periodsPerDay,
        weekdays: typeof saved.weekdays === "string" && saved.weekdays.length <= 200
          ? saved.weekdays
          : defaults.weekdays,
      };
    } catch {
      preferenceStorageError = true;
      return defaults;
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
      preferenceStorageError = false;
      return true;
    } catch {
      preferenceStorageError = true;
      return false;
    }
  }

  function syncThemeControls() {
    document.body.classList.toggle("light", lightMode);
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.innerHTML = `<span class="toggle-track" aria-hidden="true"><i></i></span> ${lightMode ? "Light Mode" : "Dark Mode"}`;
      button.setAttribute("aria-pressed", String(lightMode));
    });
  }

  function toggleTheme() {
    lightMode = !lightMode;
    preferences.theme = lightMode ? "light" : "dark";
    savePreferences();
    syncThemeControls();
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Server returned an invalid response (${response.status}).`);
    }
    if (!response.ok) {
      const error = new Error(result.error || `Request failed (${response.status}).`);
      error.status = response.status;
      error.validation = result.validation;
      throw error;
    }
    return result;
  }

  async function refresh(next = page) {
    state = await api("/api/state");
    document.querySelector(".app").classList.remove("signed-out");
    document.querySelector(".window").classList.remove("signed-out");
    document.querySelector("#logout-button").hidden = false;
    render(next);
  }

  function showLogin(message = "") {
    document.querySelector(".app").classList.add("signed-out");
    document.querySelector(".window").classList.add("signed-out");
    document.querySelector("#logout-button").hidden = true;
    main.innerHTML = `<section class="login-page">
      <div class="card login-card">
        <h1>SCHEDULER PRO</h1>
        <p class="subtle">Academic Timetable System</p>
        <form id="login-form">
          <label class="field-label" for="login-username">Username</label>
          <input class="input" id="login-username" name="username" maxlength="120" autocomplete="username" required>
          <label class="field-label" for="login-password">Password</label>
          <input class="input" id="login-password" name="password" type="password" maxlength="256" autocomplete="current-password" required>
          <button class="btn login-submit" type="submit">LOGIN</button>
          <button class="theme-toggle login-theme-toggle" id="login-theme-toggle" type="button">
            <span class="toggle-track" aria-hidden="true"><i></i></span> Dark Mode
          </button>
          <p class="tiny credentials-hint">Default: admin / admin123</p>
          <p class="tiny login-status" id="login-status" role="status">${esc(message)}</p>
        </form>
      </div>
    </section>`;
    syncThemeControls();
    document.querySelector("#login-theme-toggle").addEventListener("click", toggleTheme);
    document.querySelector("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const status = document.querySelector("#login-status");
      submit.disabled = true;
      status.textContent = "Signing in…";
      try {
        await api("/api/login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        await refresh("dashboard");
      } catch (error) {
        const issues = error.validation
          ? [
              ...(error.validation.errors || []),
              ...(error.validation.missing_records || []),
            ]
          : [];
        status.textContent = [error.message, ...issues].join(" ");
      } finally {
        if (submit.isConnected) submit.disabled = false;
      }
    });
    document.querySelector("#login-username").focus();
  }

  async function submitForm(form, path, onSuccess) {
    const status = form.querySelector("[data-status]");
    const submit = form.querySelector('[type="submit"]');
    status.textContent = "Saving…";
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      if (form.dataset.array === "subjects") {
        values.subjects = form.querySelectorAll('input[name="subjects"]:checked')
          ? [...form.querySelectorAll('input[name="subjects"]:checked')].map((input) => input.value)
          : [];
      }
      if (form.dataset.setupKind) {
        values.kind = form.dataset.setupKind;
        if (form.dataset.setupKind === "class" || form.dataset.setupKind === "room") {
          values.capacity = Number(values.capacity);
        } else if (form.dataset.setupKind === "requirement") {
          values.lecture_count = Number(values.lecture_count);
          values.practical_count = Number(values.practical_count);
          values.practical_block_size = values.practical_block_size
            ? Number(values.practical_block_size)
            : 2;
          values.requires_lab = form.querySelector('[name="requires_lab"]').checked;
        } else if (form.dataset.setupKind === "availability") {
          values.periods_per_day = Number(values.periods_per_day);
          const rawSlots = values.slots.trim();
          values.unavailable = rawSlots
            ? rawSlots.split(",").map((slot) => {
                const match = slot.trim().match(/^([A-Za-z]+)\s*:\s*(\d+)$/);
                if (!match) throw new Error(`Invalid unavailable slot: ${slot.trim()}. Use Day:period.`);
                return { day: match[1], period: Number(match[2]) };
              })
            : [];
          delete values.slots;
        }
      }
      if (path === "/api/assets") values.category = category;
      const result = await api(path, {
        method: "POST",
        body: JSON.stringify(values),
      });
      if (onSuccess) onSuccess(form, result);
      await refresh(page);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  }

  function dashboard() {
    const teachers = state.teachers.length;
    const links = Object.values(state.teacher_expertise).reduce((sum, subjects) => sum + subjects.length, 0);
    const days = state.days.length;
    const metrics = [
      ["Teachers", teachers, "#6366F1"],
      ["Subjects", state.subjects.length, "#06B6D4"],
      ["Classes", state.classes.length, "#22C55E"],
      ["Rooms", state.classrooms.length + state.labs.length, "#F59E0B"],
      ["TT Days", days, "#A78BFA"],
    ];
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
    const date = new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    }).format(new Date());
    return `<section class="page">
      <div class="dash-head"><h1>${greet}, ${esc(state.user)}</h1><span class="date">${date}</span></div>
      <div class="kpis">${metrics.map(([label, value, color]) => card(
        `<strong style="color:${color}">${value}</strong><span>${label}</span>`, "kpi",
      )).join("")}</div>
      <h2 class="section-title">Quick Actions</h2>
      <div class="actions">
        <button class="action purple" data-go="generate">Generate Timetable</button>
        <button class="action cyan" data-go="manage">Manage Assets</button>
        <button class="action green" data-go="analytics">View Analytics</button>
        <a class="action orange download-link" href="/api/backup">Download Backup</a>
      </div>
      ${card(`<h2>System Overview</h2>
        <div class="overview-line">Teacher-Subject links : ${links}</div>
        <div class="overview-line">Timetable days loaded  : ${days}</div>
        <div class="overview-line">Data source            : Private demo database</div>
        <div class="overview-line">AI assistant           : ${state.ai_configured ? `Configured (${esc(state.ai_provider)})` : "Offline helper"}</div>
        <div class="overview-line">Messaging              : Disabled in browser preview</div>`, "overview")}
    </section>`;
  }

  function expertiseForm() {
    const teacher = state.teachers[0];
    if (!teacher) return `<p class="subtle">Add a teacher before setting subject expertise.</p>`;
    const selectedTeacher = state.teachers.some((item) => item.name === expertiseTeacher)
      ? expertiseTeacher
      : teacher.name;
    const selected = state.teacher_expertise[selectedTeacher] || [];
    return `<form id="expertise-form" data-array="subjects">
      <h2>Set Teacher Expertise</h2>
      <label class="field-label" for="expert-teacher">Teacher</label>
      <select class="select" name="teacher" id="expert-teacher">
        ${state.teachers.map((item) => `<option value="${esc(item.name)}" ${item.name === selectedTeacher ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
      </select>
      <div class="expertise">${state.subjects.map((subject) => `<label class="field-label">
        <input type="checkbox" name="subjects" value="${esc(subject)}" ${selected.includes(subject) ? "checked" : ""}> ${esc(subject)}
      </label>`).join("")}</div>
      <button class="btn green" type="submit">Save Expertise</button>
      <p class="tiny" data-status role="status"></p>
    </form>`;
  }

  function manage() {
    const names = category === "teachers"
      ? state.teachers.map((teacher) => teacher.name)
      : state[category];
    const rows = names.map((name) => {
      const teacher = state.teachers.find((item) => item.name === name);
      const subjects = teacher ? (state.teacher_expertise[name] || []) : [];
      const details = teacher
        ? `<small>${subjects.length} subject${subjects.length === 1 ? "" : "s"}: ${esc(subjects.join(", ") || "not set")}</small>`
        : "";
      return `<div class="row-card"><strong>${esc(name)}${details}</strong>
        <button class="btn red" type="button" data-delete="${esc(name)}">Delete</button></div>`;
    }).join("") || `<p class="subtle">No ${esc(category.replace("_", " "))} yet.</p>`;
    const selectedType = assetTypes.find(([key]) => key === category);
    return `${heading("Manage Assets")}<div class="page-content">
      <div class="subtabs">${assetTypes.map(([key, label]) => `<button class="tab ${key === category ? "active" : ""}" data-cat="${key}">${label}</button>`).join("")}</div>
      <div class="split">
        ${card(`<h2>Add ${esc(selectedType[1])}</h2>
          <form id="asset-form"><input type="hidden" name="category" value="${esc(category)}">
          <input class="input" name="name" maxlength="120" required placeholder="Enter name..." aria-label="New ${esc(selectedType[1])} name">
          <button class="btn green" type="submit">Add Item</button><p class="tiny" data-status role="status"></p></form>
          <label class="field-label" for="asset-search">Search</label>
          <input class="input" id="asset-search" placeholder="Search this list..." aria-label="Search assets">
          ${category === "teachers" ? expertiseForm() : ""}`, "panel")}
        ${card(`<h2>All ${esc(selectedType[1])}</h2>
          <div id="asset-list">${rows}</div>`, "panel")}
      </div></div>`;
  }

  function scheduleRows(schedule = state.generated_timetable) {
    return Object.entries(schedule).flatMap(([day, classes]) => Object.entries(classes).flatMap(
      ([className, periods]) => Object.entries(periods).map(([period, item]) => ({
        day, className, period: Number(period), ...item,
      })),
    ));
  }

  function collegeSetupWarnings() {
    const warnings = [];
    for (const className of state.classes) {
      const details = state.class_details[className];
      if (!details) warnings.push(`Class ${className}: configure department, year, semester, section and capacity.`);
      if (!state.requirements.some((item) => item.class_name === className)) {
        warnings.push(`Class ${className}: add its weekly subject and practical requirements.`);
      }
    }
    for (const subject of state.subjects) {
      if (!state.subject_details[subject]?.subject_code) {
        warnings.push(`Subject ${subject}: configure its official subject code.`);
      }
    }
    for (const room of state.room_details) {
      if (!room.capacity) warnings.push(`Room ${room.room_name}: configure the room capacity.`);
    }
    for (const requirement of state.requirements) {
      const eligible = state.teachers.filter((teacher) =>
        (state.teacher_expertise[teacher.name] || []).includes(requirement.subject_name),
      );
      if (!eligible.length) {
        warnings.push(`${requirement.class_name} / ${requirement.subject_name}: assign a qualified teacher in Teacher Expertise.`);
      }
    }
    for (const teacher of state.teachers) {
      if (!(state.teacher_availability_configured || []).includes(teacher.name)) {
        warnings.push(`Teacher ${teacher.name}: confirm availability in College Setup. An empty unavailable-slots list confirms full availability.`);
      }
    }
    return warnings;
  }

  function collegeSetup() {
    const warnings = collegeSetupWarnings();
    const className = state.classes[0] || "";
    const subjectName = state.subjects[0] || "";
    const classroom = state.classrooms[0] || "";
    const lab = state.labs[0] || "";
    const selectedTeacher = state.teachers[0]?.name || "";
    const requirements = state.requirements.map((item) => `<div class="row-card">
      <strong>${esc(item.class_name)} · ${esc(item.subject_name)}
        <small>${item.lecture_count} lectures, ${item.practical_count} practical sessions × ${item.practical_block_size} periods${item.teacher_name ? ` · ${esc(item.teacher_name)}` : " · auto-assign qualified teacher"}</small></strong>
      <button class="btn red" type="button" data-delete-requirement="${esc(item.class_name)}" data-subject="${esc(item.subject_name)}">Remove</button>
    </div>`).join("") || `<p class="subtle">No weekly course requirements configured yet.</p>`;
    const savedClass = state.class_details[className] || {};
    const savedSubject = state.subject_details[subjectName] || {};
    const savedRoom = state.room_details.find((room) => room.room_name === (lab || classroom)) || {};
    const roomDefaultType = lab ? "laboratory" : "classroom";
    const savedUnavailability = selectedTeacher
      ? (state.teacher_unavailability[selectedTeacher] || []).map((slot) => `${slot.day}:${slot.period}`).join(", ")
      : "";
    return `${heading("College Setup")}<div class="page-content">
      <p class="notice">Generation is blocked until every active class, subject code, course load, eligible teacher, and room capacity is configured. No sample records are created.</p>
      ${warnings.length ? card(`<h2>Setup warnings (${warnings.length})</h2><ul class="validation-list">${warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>`, "panel") : card(`<p class="success-text">All required college data is configured.</p>`, "panel")}
      <div class="setup-grid">
        ${card(`<h2>Class / Section Details</h2>
          <form id="class-details-form">
            <label class="field-label">Class / Section</label><select class="select" name="class_name" required>${state.classes.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}</select>
            <label class="field-label">Department</label><input class="input" name="department" maxlength="120" required value="${esc(savedClass.department || "")}">
            <label class="field-label">Academic year</label><input class="input" name="academic_year" maxlength="120" required value="${esc(savedClass.academic_year || "")}" placeholder="e.g. 2026-27">
            <label class="field-label">Semester / Year</label><input class="input" name="semester" maxlength="120" required value="${esc(savedClass.semester || "")}">
            <label class="field-label">Section / Group</label><input class="input" name="section" maxlength="120" required value="${esc(savedClass.section || "")}">
            <label class="field-label">Student capacity</label><input class="input" type="number" name="capacity" min="1" max="5000" required value="${esc(savedClass.capacity || "")}">
            <button class="btn" type="submit">Save Class Details</button><p class="tiny" data-status role="status"></p>
          </form>`, "panel")}
        ${card(`<h2>Subject Code</h2><form id="subject-details-form">
          <label class="field-label">Subject</label><select class="select" name="subject_name" required>${state.subjects.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}</select>
          <label class="field-label">Official subject code</label><input class="input" name="subject_code" maxlength="40" required value="${esc(savedSubject.subject_code || "")}">
          <button class="btn" type="submit">Save Subject Code</button><p class="tiny" data-status role="status"></p>
        </form>`, "panel")}
        ${card(`<h2>Room Capacity</h2><form id="room-details-form">
          <label class="field-label">Room type</label><select class="select" name="room_type"><option value="classroom" ${roomDefaultType === "classroom" ? "selected" : ""}>Classroom</option><option value="laboratory" ${roomDefaultType === "laboratory" ? "selected" : ""}>Laboratory</option></select>
          <label class="field-label">Room</label><select class="select" name="room_name">${[...state.classrooms.map((name) => ({name, type: "classroom"})), ...state.labs.map((name) => ({name, type: "laboratory"}))].map((room) => `<option value="${esc(room.name)}" data-room-type="${room.type}" ${(room.name === savedRoom.room_name && room.type === savedRoom.room_type) ? "selected" : ""}>${esc(room.name)} (${room.type})</option>`).join("")}</select>
          <label class="field-label">Seats</label><input class="input" type="number" name="capacity" min="1" max="5000" required value="${esc(savedRoom.capacity || "")}">
          <button class="btn" type="submit">Save Room Capacity</button><p class="tiny" data-status role="status"></p>
        </form>`, "panel")}
        ${card(`<h2>Weekly Course Requirements</h2>
          <form id="requirement-form">
            <label class="field-label">Class / Section</label><select class="select" name="class_name" required>${state.classes.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}</select>
            <label class="field-label">Subject</label><select class="select" name="subject_name" required>${state.subjects.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}</select>
            <label class="field-label">Qualified teacher (or auto assign)</label><select class="select" name="teacher_name"><option value="">Auto-assign using Teacher Expertise</option>${state.teachers.map((teacher) => `<option value="${esc(teacher.name)}">${esc(teacher.name)}</option>`).join("")}</select>
            <div class="settings-grid"><label class="field-label">Actual weekly lectures<input class="input" type="number" name="lecture_count" min="0" max="42" placeholder="Enter actual count" required></label>
              <label class="field-label">Actual practical sessions<input class="input" type="number" name="practical_count" min="0" max="42" placeholder="Enter actual count" required></label></div>
            <label class="field-label">Consecutive periods per practical (required when practicals &gt; 0)<input class="input" type="number" name="practical_block_size" min="2" max="6" placeholder="Enter actual block size"></label>
            <label class="field-label"><input type="checkbox" name="requires_lab" checked> Practical sessions require a lab</label>
            <button class="btn" type="submit">Save Weekly Requirement</button><p class="tiny" data-status role="status"></p>
          </form><h3>Configured course loads</h3>${requirements}`, "panel")}
        ${card(`<h2>Teacher Unavailability</h2>
          <form id="availability-form">
            <label class="field-label">Teacher</label><select class="select" name="teacher_name">${state.teachers.map((teacher) => `<option value="${esc(teacher.name)}">${esc(teacher.name)}</option>`).join("")}</select>
            <label class="field-label">Unavailable slots (e.g. Monday:1, Thursday:3)</label><input class="input" name="slots" maxlength="500" value="${esc(savedUnavailability)}" placeholder="Leave empty if available all week">
            <label class="field-label">Periods per day used for slot validation</label><input class="input" type="number" name="periods_per_day" min="1" max="12" value="${preferences.periodsPerDay}" required>
            <button class="btn" type="submit">Save Availability</button><p class="tiny" data-status role="status"></p>
          </form><p class="subtle">If no unavailable slots are recorded for a teacher, the scheduler treats that teacher as available for all configured slots.</p>`, "panel")}
      </div>
    </div>`;
  }

  function generate() {
    const entries = (state.weekly_entries || []).filter((entry) => defaultDays.includes(entry.day));
    const classFilterOptions = [...new Set(entries.map((entry) => entry.class_name))];
    const departmentOptions = [...new Set(entries.map((entry) => entry.department).filter(Boolean))];
    const semesterOptions = [...new Set(entries.map((entry) => entry.semester).filter(Boolean))];
    const sectionOptions = [...new Set(entries.map((entry) => entry.section).filter(Boolean))];
    const teacherOptions = [...new Set(entries.map((entry) => entry.teacher))];
    const roomOptions = [...new Set(entries.map((entry) => entry.room))];
    const selectedDay = weeklyView ? "" : activeWeekday;
    const filteredEntries = entries.filter((entry) =>
      (!selectedDay || entry.day === selectedDay)
      && (!timetableFilters.department || entry.department === timetableFilters.department)
      && (!timetableFilters.semester || entry.semester === timetableFilters.semester)
      && (!timetableFilters.class || entry.class_name === timetableFilters.class)
      && (!timetableFilters.section || entry.section === timetableFilters.section)
      && (!timetableFilters.teacher || entry.teacher === timetableFilters.teacher)
      && (!timetableFilters.room || entry.room === timetableFilters.room),
    );
    const selectFilter = (id, filterKey, label, options) => `<label class="field-label">${label}
      <select class="select" id="${id}"><option value="">All</option>${options.map((item) => `<option value="${esc(item)}" ${timetableFilters[filterKey] === item ? "selected" : ""}>${esc(item)}</option>`).join("")}</select></label>`;
    const rows = filteredEntries.map((entry, index) => {
      const requirement = state.requirements.find((item) =>
        item.class_name === entry.class_name && item.subject_name === entry.subject,
      );
      const roomType = entry.entry_type === "practical" && requirement?.requires_lab
        ? "laboratory"
        : "classroom";
      const classCapacity = state.class_details[entry.class_name]?.capacity || 0;
      const qualifiedTeachers = state.teachers.filter((teacher) =>
        (state.teacher_expertise[teacher.name] || []).includes(entry.subject),
      );
      const usableRooms = state.room_details.filter((room) =>
        room.room_type === roomType && room.capacity >= classCapacity,
      );
      return `<tr>
      <td>${esc(entry.day)}</td><td>${esc(entry.department)}<small>${esc(entry.academic_year)} · ${esc(entry.semester)} · ${esc(entry.section)}</small></td>
      <td>${esc(entry.class_name)}</td><td>${esc(entry.subject)}<small>${esc(entry.subject_code)}</small></td>
      <td>${esc(entry.teacher)}</td><td>${esc(entry.start_time)}–${esc(entry.end_time)}</td>
      <td><span class="type-badge ${entry.entry_type === "practical" ? "practical" : "lecture"}">${entry.entry_type === "practical" ? "Practical / Lab" : "Lecture"}</span></td>
      <td>${esc(entry.room)}</td><td>${esc(entry.period)}</td>
      <td>${state.college_schedule_validated ? `<button class="btn timetable-edit" type="button" data-edit-row="${index}">Edit</button>` : `<span class="subtle">—</span>`}</td></tr>
      ${state.college_schedule_validated ? `<tr class="editor-row" id="editor-${index}" hidden><td colspan="10"><form class="timetable-edit-form" data-index="${index}">
        <label class="field-label">Qualified teacher<select class="select" name="teacher">${qualifiedTeachers.map((teacher) => `<option value="${esc(teacher.name)}" ${teacher.name === entry.teacher ? "selected" : ""}>${esc(teacher.name)}</option>`).join("")}</select></label>
        <label class="field-label">Room<select class="select" name="room">${usableRooms.map((room) => `<option value="${esc(room.room_name)}" ${room.room_name === entry.room ? "selected" : ""}>${esc(room.room_name)} (${room.capacity} seats)</option>`).join("")}</select></label>
        <button class="btn green" type="submit">Save change</button><button class="btn cancel-edit" type="button">Cancel</button><p class="tiny" data-status role="status"></p>
      </form></td></tr>` : ""}`;
    }).join("");
    const validation = state.weekly_entries?.length && state.college_schedule_validated
      ? card(`<p class="success-text">Saved and validated schedule: ${entries.length} entries across Monday–Saturday.</p>`, "panel")
      : state.weekly_entries?.length
        ? card(`<p class="notice">A legacy timetable is saved, but it has no complete college metadata and is not validated. Configure the college data and generate a new week.</p>`, "panel")
      : card(`<p class="notice">No validated college-wide schedule is saved yet. Configure academic data, then generate a week.</p>`, "panel");
    return `${heading("Generate Timetable")}<div class="page-content">
      ${card(`<form id="generate-form">
        <div class="settings-grid"><label class="field-label">Actual periods per day<input class="input" type="number" name="periods_per_day" min="1" max="12" placeholder="Enter actual count" required></label>
          <label class="field-label">Actual college start time<input class="input" type="time" name="start_time" required></label>
          <label class="field-label">Actual minutes per period<input class="input" type="number" name="period_minutes" min="1" max="240" placeholder="Enter duration" required></label></div>
        <p class="notice">The fixed schedule is Monday, Tuesday, Wednesday, Thursday, Friday, Saturday. Sunday is never generated. Set the actual start time and period duration used by your college.</p>
        <button class="btn" type="submit">Generate and Validate Full Week</button><p class="tiny" data-status role="status"></p><div id="generation-validation" aria-live="polite"></div>
      </form>`, "panel")}
      ${validation}
      ${entries.length ? `<div class="export-actions"><a class="btn" href="/api/export.pdf">Export PDF</a><a class="btn green" href="/api/export.xlsx">Export Excel</a></div>` : ""}
      <div class="week-tabs"><button class="tab ${weeklyView ? "active" : ""}" data-week-view="true">Full Week</button>${defaultDays.map((day) => `<button class="tab ${!weeklyView && activeWeekday === day ? "active" : ""}" data-day-view="${day}">${day}</button>`).join("")}</div>
      <div class="filters-grid">${selectFilter("department-filter", "department", "Department", departmentOptions)}
        ${selectFilter("semester-filter", "semester", "Semester / Year", semesterOptions)}
        ${selectFilter("class-filter", "class", "Class", classFilterOptions)}
        ${selectFilter("section-filter", "section", "Section", sectionOptions)}
        ${selectFilter("teacher-filter", "teacher", "Teacher", teacherOptions)}
        ${selectFilter("room-filter", "room", "Room", roomOptions)}</div>
      ${card(`<div class="table-wrap"><table class="weekly-table"><thead><tr><th>Day</th><th>Department / Semester</th><th>Class / Section</th><th>Subject / Code</th><th>Teacher</th><th>Time</th><th>Type</th><th>Room / Lab</th><th>Period</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10">No entries match this view. Setup warnings and required course loads are shown in College Setup.</td></tr>`}</tbody></table></div>`, "panel")}
    </div>`;
  }

  function history() {
    const rows = state.history.map((entry) => `<tr><td>${esc(entry.class_name)}</td><td>${esc(entry.day)}</td>
      <td>${esc(entry.period)}</td><td>${esc(entry.subject)}</td><td>${esc(entry.teacher)}</td>
      <td>${esc(entry.room)}</td><td>${esc(entry.created_at)}</td></tr>`).join("");
    return `${heading("View History")}<div class="page-content">${card(`<div class="table-wrap"><table>
      <thead><tr><th>CLASS</th><th>DAY</th><th>PERIOD</th><th>SUBJECT</th><th>TEACHER</th><th>ROOM</th><th>UPDATED</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7">No timetable entries saved yet.</td></tr>`}</tbody></table></div>`, "panel")}</div>`;
  }

  function analytics() {
    const timetable = allTimetable();
    const counts = Object.fromEntries(state.teachers.map((teacher) => [
      teacher.name, timetable.filter((entry) => entry.teacher === teacher.name).length,
    ]));
    const max = Math.max(1, ...Object.values(counts));
    const rows = state.teachers.map((teacher) => {
      const total = counts[teacher.name] || 0;
      const risk = Math.min(Math.round(((total / 40 * 0.4) + (Math.min(total / 2, 6) / 4 * 0.6)) * 100), 100);
      const color = risk > 70 ? "#ef4444" : risk > 40 ? "#f59e0b" : "#22c55e";
      return card(`<strong>${esc(teacher.name)}</strong>
        <span class="bar"><i style="width:${Math.max(4, total / max * 100)}%;background:${color}"></i></span>
        <span>${total} periods</span><b style="color:${color}">Risk: ${risk}%</b>`, "bar-row");
    }).join("");
    return `${heading("Workload Analytics")}<div class="page-content">${rows || `<p class="subtle">No teachers available.</p>`}</div>`;
  }

  function recycle() {
    const categories = Object.entries(state.deleted).flatMap(([key, names]) =>
      names.map((name) => `<div class="row-card"><strong>${esc(name)}<small>${esc(key)}</small></strong>
        <button class="btn green" type="button" data-restore="${key}" data-name="${esc(name)}">Restore</button></div>`),
    ).join("");
    return `${heading("Recycle Bin")}<div class="page-content">${categories || `<div class="empty">Recycle Bin is empty.</div>`}</div>`;
  }

  function teacherDetails() {
    const rows = state.teachers.map((teacher) => `<div class="row-card teacher-edit" data-teacher="${esc(teacher.name)}">
      <strong>${esc(teacher.name)}<small>Email: ${esc(teacher.email || "N/A")} | Phone: ${esc(teacher.phone || "N/A")}</small></strong>
      <button class="btn" type="button" data-edit="${esc(teacher.name)}">Edit</button></div>`).join("");
    return `${heading("Teacher Details")}<div class="page-content split">
      ${card(`<h2>Add/Update</h2><form id="teacher-form">
        <label class="field-label" for="teacher-name">Name</label><input class="input" name="name" id="teacher-name" maxlength="120" required>
        <label class="field-label" for="teacher-email">Email</label><input class="input" type="email" name="email" id="teacher-email" maxlength="254">
        <label class="field-label" for="teacher-phone">Phone</label><input class="input" name="phone" id="teacher-phone" maxlength="40">
        <button class="btn" type="submit">Save</button><p class="tiny" data-status role="status"></p>
      </form>`, "panel")}
      ${card(`<h2>All Teachers</h2>${rows || `<p class="subtle">No teachers yet.</p>`}`, "panel")}
    </div>`;
  }

  function feedback() {
    const rows = state.feedback.map((item) => `<div class="row-card"><strong>${esc(item.teacher || "General feedback")}
      <small>${esc(item.sentiment)} · ${esc(item.issue_type)} · ${esc(item.created_at)}</small><small>${esc(item.message)}</small></strong></div>`).join("");
    return `${heading("Teacher Feedback")}<div class="page-content split">
      ${card(`<h2>Add Feedback</h2><form id="feedback-form">
        <label class="field-label" for="feedback-teacher">Teacher (optional)</label>
        <select class="select" name="teacher" id="feedback-teacher"><option value="">General</option>
          ${state.teachers.map((teacher) => `<option value="${esc(teacher.name)}">${esc(teacher.name)}</option>`).join("")}</select>
        <label class="field-label" for="feedback-sentiment">Sentiment</label>
        <select class="select" name="sentiment" id="feedback-sentiment"><option>neutral</option><option>positive</option><option>negative</option></select>
        <label class="field-label" for="feedback-issue">Type</label>
        <input class="input" name="issue_type" id="feedback-issue" value="general" maxlength="80">
        <label class="field-label" for="feedback-message">Message</label>
        <textarea class="textarea" name="message" id="feedback-message" maxlength="4000" required></textarea>
        <button class="btn" type="submit">Save Feedback</button><p class="tiny" data-status role="status"></p>
      </form>`, "panel")}
      ${card(`<h2>Saved Feedback</h2>${rows || `<p class="subtle">No feedback saved yet.</p>`}`, "panel")}
    </div>`;
  }

  function whatsapp() {
    const messaging = state.messaging || {};
    const whatsappReady = messaging.whatsapp_ready;
    const emailReady = messaging.email_ready;
    return `${heading("WhatsApp Hub")}<div class="page-content messaging-page">
      ${card(`<h2>Twilio WhatsApp</h2>
      <p class="notice">${messaging.whatsapp_ready || messaging.email_ready ? "Server-side live messaging is configured. Sending contacts real recipients and may incur provider charges." : "Public demo · live messaging is off. Provider credentials are stored only as server environment secrets."}</p>
      <p class="subtle">For security and billing protection, only server-authorized recipients can receive live messages. Never enter provider credentials in this page.</p>`, "panel")}
      ${card(`<h2>Send WhatsApp Message</h2>
        <form id="whatsapp-form" data-channel="whatsapp">
          <label class="field-label" for="whatsapp-teacher">Recipient Teacher</label>
          <select class="select" id="whatsapp-teacher" name="teacher">
          ${state.teachers.map((teacher) => `<option value="${esc(teacher.name)}" data-phone="${esc(teacher.phone || "")}">${esc(teacher.name)}</option>`).join("")}
          </select>
          <label class="field-label" for="whatsapp-phone">Phone</label>
          <input class="input" id="whatsapp-phone" name="phone" type="tel" maxlength="40" placeholder="+91 98765 43210" required>
          <label class="field-label" for="whatsapp-message">Message</label>
          <textarea class="textarea messaging-textarea" id="whatsapp-message" name="message" maxlength="2000" required>Hello! Your timetable has been updated. Please check the Scheduler Pro portal.</textarea>
          <button class="btn wa-submit" type="submit">${whatsappReady ? "Send WhatsApp (Twilio)" : "Preview WhatsApp"}</button>
          <p class="tiny" data-status role="status"></p>
        </form>
        <p class="messaging-note">${whatsappReady ? "Live sending is allowed only to recipient numbers authorized on the server." : "Preview only: no message is sent and no details are saved."}</p>`, "panel")}
      ${card(`<h2>Send Email</h2>
        <form id="email-preview-form" data-channel="email">
          <label class="field-label" for="email-recipient">Recipient Email</label>
          <input class="input" id="email-recipient" name="email" type="email" maxlength="254" placeholder="teacher@example.com" required>
          <label class="field-label" for="email-subject">Subject</label>
          <input class="input" id="email-subject" name="subject" maxlength="200" value="Timetable update" required>
          <label class="field-label" for="email-message">Message</label>
          <textarea class="textarea messaging-textarea" id="email-message" name="message" maxlength="2000" required>Hello! Your timetable has been updated. Please check the Scheduler Pro portal.</textarea>
          <button class="btn email-submit" type="submit">${emailReady ? "Send Email" : "Preview Email"}</button>
          <p class="tiny" data-status role="status"></p>
        </form>
        <p class="messaging-note">${emailReady ? "Live sending is allowed only to recipient addresses authorized on the server." : "Preview only: no email is sent and no details are saved."}</p>`, "panel")}
    </div>`;
  }

  function settings() {
    const voiceAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const days = preferences.weekdays || (state.days.length ? state.days : defaultDays).join(", ");
    return `${heading("User Settings")}<div class="page-content">
      ${card(`<h2>Personal preferences</h2>
        <p class="subtle">These preferences are saved only in this browser and do not change other visitors’ settings.</p>
        <form id="settings-form" class="settings-form">
          <div class="settings-grid">
            <label class="field-label" for="settings-language">Assistant reply language
              <select class="select" id="settings-language" name="replyLanguage">
                <option value="hi" ${preferences.replyLanguage === "hi" ? "selected" : ""}>Hindi</option>
                <option value="en" ${preferences.replyLanguage === "en" ? "selected" : ""}>English</option>
              </select>
            </label>
            <label class="field-label" for="settings-theme">Theme
              <select class="select" id="settings-theme" name="theme">
                <option value="dark" ${preferences.theme === "dark" ? "selected" : ""}>Dark</option>
                <option value="light" ${preferences.theme === "light" ? "selected" : ""}>Light</option>
              </select>
            </label>
            <label class="field-label" for="settings-periods">Default periods per day
              <input class="input" id="settings-periods" name="periodsPerDay" type="number" min="1" max="12" value="${preferences.periodsPerDay}" required>
            </label>
            <label class="field-label" for="settings-days">Default timetable days (comma separated)
              <input class="input" id="settings-days" name="weekdays" maxlength="200" value="${esc(days)}" required>
            </label>
          </div>
          <div class="settings-actions">
            <button class="btn" type="submit">Save preferences</button>
            <p class="tiny" id="settings-status" role="status">${preferenceStorageError ? "Browser storage is unavailable; changes may not be saved." : ""}</p>
          </div>
        </form>`, "panel")}
      ${card(`<h2>Backup and data</h2>
        <p class="subtle">Download a JSON backup of the shared demo timetable data.</p>
        <a class="btn settings-backup" href="/api/backup">Download backup</a>
        <p class="notice">This demo shares its sample dataset between signed-in visitors. Only use fictional information.</p>`, "panel")}
      ${card(`<h2>Hosted demo account</h2>
        <p class="subtle">This browser session is protected by a server-side sign-in. The hosted demo uses its own fictional sample data and does not access the desktop database.</p>
        <p class="subtle">AI provider: ${state.ai_configured ? `${esc(state.ai_provider)} (API key configured on the server)` : "offline timetable helper"}</p>
        <p class="subtle">Speech input: ${voiceAvailable ? "supported by this browser; microphone permission is required" : "not supported by this browser"}</p>
        <p class="notice">Account and password changes are not available in this shared public demo.</p>`, "panel")}
    </div>`;
  }

  function assistant() {
    const messages = (state.ai_history || []).map((item) =>
      `<div class="bubble ${item.role === "user" ? "user" : ""}">${esc(item.content)}</div>`,
    ).join("");
    const speechSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const status = state.ai_configured
      ? `Configured provider · ${esc(state.ai_provider)} · key stays on server`
      : "Offline helper · timetable questions";
    return `<div class="ai-window"><h1 class="ai-title"><span class="assistant-mark" aria-hidden="true">🤖</span> AI Assistant</h1>
      <div class="ai-status"><span id="microphone-capability">Microphone · ${speechSupported ? "checking permission…" : "speech recognition not supported by this browser"}</span><span>${status}</span></div>
      <div class="ai-cloud-notice">${state.ai_configured
        ? "Cloud AI is enabled. Prompts and demo timetable context are sent to the configured provider."
        : "Offline timetable Q&A is available. For full AI chat, the admin must set TIMETABLE_ENABLE_CLOUD_AI and a provider API key in Render. Never paste keys in this chat."}</div>
      <div class="chat" id="chat">${messages || `<div class="bubble">Ask “list teachers”, “who teaches Mathematics?”, “what subjects does Kavita Rao teach?”, “teacher workload”, “which classes use Room 101?”, or “show Class 9-A timetable Monday”. You can also ask to generate a timetable.</div>`}</div>
      <form class="chat-inputs" id="assistant-form">
        <input class="input" id="assistant-input" name="prompt" maxlength="2000" placeholder="Ask about teachers, classes, or timetable…" autocomplete="off" required aria-label="Ask the timetable assistant">
        <label class="assistant-language-label" for="assistant-language">Reply language / जवाब की भाषा</label>
        <select class="select assistant-language" id="assistant-language" aria-label="Reply language">
          <option value="hi" ${replyLanguage === "hi" ? "selected" : ""}>हिन्दी में जवाब</option>
          <option value="en" ${replyLanguage === "en" ? "selected" : ""}>Answer in English</option>
        </select>
        <button class="btn" type="button" id="mic-button" ${speechSupported ? "" : "disabled"} aria-label="Start speech input">🎤 Mic</button>
        <button class="btn" type="submit">Send</button>
      </form><p class="tiny" id="assistant-status" role="status"></p>
    </div>`;
  }

  const pages = {
    dashboard, manage, "college-setup": collegeSetup, generate, history, analytics, recycle,
    teachers: teacherDetails, feedback, whatsapp, settings, assistant,
  };

  function render(next = page) {
    page = pages[next] ? next : "dashboard";
    main.innerHTML = pages[page]();
    document.querySelectorAll(".nav").forEach((button) =>
      button.classList.toggle("active", button.dataset.page === page),
    );
    document.querySelector(".assistant-nav").classList.toggle("active", page === "assistant");
    bindPageEvents();
  }

  function bindPageEvents() {
    main.querySelectorAll("[data-go]").forEach((button) =>
      button.addEventListener("click", () => render(button.dataset.go)),
    );
    if (page === "whatsapp") {
      const teacherSelect = $("#whatsapp-teacher");
      const fillTeacherDetails = () => {
        const teacher = state.teachers.find((item) => item.name === teacherSelect.value);
        const phone = $("#whatsapp-phone");
        if (teacher?.phone) phone.value = teacher.phone.startsWith("+")
          ? teacher.phone
          : `+91${teacher.phone.replace(/^0+/, "")}`;
      };
      teacherSelect.addEventListener("change", fillTeacherDetails);
      fillTeacherDetails();
      for (const [formId, recipientId, channel] of [
        ["whatsapp-form", "whatsapp-phone", "WhatsApp"],
        ["email-preview-form", "email-recipient", "email"],
      ]) {
        $(`#${formId}`).addEventListener("submit", (event) => {
          event.preventDefault();
          submitMessagingForm(event.currentTarget, recipientId, channel);
        });
      }
    }
    if (page === "settings") {
      $("#settings-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const status = $("#settings-status");
        const values = Object.fromEntries(new FormData(form));
        const days = values.weekdays.split(",").map((day) => day.trim()).filter(Boolean);
        const uniqueDays = new Set(days.map((day) => day.toLocaleLowerCase()));
        if (!days.length || days.length > 7 || days.some((day) => day.length > 30) || uniqueDays.size !== days.length) {
          status.textContent = "Enter 1–7 unique days, each no longer than 30 characters.";
          return;
        }
        preferences = {
          replyLanguage: values.replyLanguage,
          theme: values.theme,
          periodsPerDay: Number(values.periodsPerDay),
          weekdays: days.join(", "),
        };
        replyLanguage = preferences.replyLanguage;
        lightMode = preferences.theme === "light";
        syncThemeControls();
        status.textContent = savePreferences()
          ? "Preferences saved in this browser."
          : "Could not save preferences. Check this browser’s storage settings.";
      });
    }
    if (page === "manage") {
      main.querySelectorAll("[data-cat]").forEach((button) =>
        button.addEventListener("click", () => {
          category = button.dataset.cat;
          render("manage");
        }),
      );
      $("#asset-search").addEventListener("input", (event) => {
        const query = event.target.value.toLocaleLowerCase();
        document.querySelectorAll("#asset-list .row-card").forEach((row) => {
          row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
        });
      });
      $("#asset-form").addEventListener("submit", (event) => {
        event.preventDefault();
        submitForm(event.currentTarget, "/api/assets", (form) => form.reset());
      });
      main.querySelectorAll("[data-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
          if (!confirm(`Move "${button.dataset.delete}" to the Recycle Bin?`)) return;
          try {
            await api(`/api/assets/${encodeURIComponent(category)}/${encodeURIComponent(button.dataset.delete)}`, {
              method: "DELETE",
              headers: { "X-Asset-Name": button.dataset.delete },
            });
            await refresh();
          } catch (error) {
            alert(error.message);
          }
        });
      });
      if ($("#expertise-form")) {
        const form = $("#expertise-form");
        $("#expert-teacher").addEventListener("change", () => {
          expertiseTeacher = $("#expert-teacher").value;
          const selected = state.teacher_expertise[$("#expert-teacher").value] || [];
          form.querySelectorAll('input[name="subjects"]').forEach((input) => {
            input.checked = selected.includes(input.value);
          });
        });
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          submitForm(form, "/api/expertise");
        });
      }
    }
    if (page === "college-setup") {
      for (const [formId, kind] of [
        ["class-details-form", "class"],
        ["subject-details-form", "subject"],
        ["room-details-form", "room"],
        ["requirement-form", "requirement"],
        ["availability-form", "availability"],
      ]) {
        const form = $(`#${formId}`);
        if (form) {
          form.dataset.setupKind = kind;
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            submitForm(form, "/api/college-setup");
          });
        }
      }
      $("#class-details-form select[name=class_name]")?.addEventListener("change", (event) => {
        const details = state.class_details[event.currentTarget.value] || {};
        for (const field of ["department", "academic_year", "semester", "section", "capacity"]) {
          $(`#class-details-form [name=${field}]`).value = details[field] ?? "";
        }
      });
      $("#subject-details-form select[name=subject_name]")?.addEventListener("change", (event) => {
        const details = state.subject_details[event.currentTarget.value] || {};
        $("#subject-details-form [name=subject_code]").value = details.subject_code || "";
      });
      const roomType = $("#room-details-form [name=room_type]");
      const roomSelect = $("#room-details-form [name=room_name]");
      const syncRoomChoices = () => {
        const details = state.room_details.find((room) =>
          room.room_type === roomType.value && room.room_name === roomSelect.value,
        );
        [...roomSelect.options].forEach((option) => {
          option.hidden = option.dataset.roomType !== roomType.value;
        });
        const selected = roomSelect.selectedOptions[0];
        if (!selected || selected.dataset.roomType !== roomType.value) {
          const available = [...roomSelect.options].find((option) => option.dataset.roomType === roomType.value);
          if (available) roomSelect.value = available.value;
        }
        const current = state.room_details.find((room) =>
          room.room_name === roomSelect.value && room.room_type === roomType.value,
        );
        $("#room-details-form [name=capacity]").value = current?.capacity || "";
        if (details && details.room_name === roomSelect.value) {
          $("#room-details-form [name=capacity]").value = details.capacity || "";
        }
      };
      roomType?.addEventListener("change", syncRoomChoices);
      roomSelect?.addEventListener("change", syncRoomChoices);
      $("#availability-form [name=teacher_name]")?.addEventListener("change", (event) => {
        $("#availability-form [name=slots]").value = (state.teacher_unavailability[event.currentTarget.value] || [])
          .map((slot) => `${slot.day}:${slot.period}`).join(", ");
      });
      main.querySelectorAll("[data-delete-requirement]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await api("/api/college-requirements/delete", {
              method: "POST",
              body: JSON.stringify({
                class_name: button.dataset.deleteRequirement,
                subject_name: button.dataset.subject,
              }),
            });
            await refresh("college-setup");
          } catch (error) {
            alert(error.message);
          }
        });
      });
    }
    if (page === "generate") {
      main.querySelectorAll("[data-day-view]").forEach((button) =>
        button.addEventListener("click", () => {
          activeWeekday = button.dataset.dayView;
          weeklyView = false;
          render("generate");
        }),
      );
      main.querySelector("[data-week-view]")?.addEventListener("click", () => {
        weeklyView = true;
        render("generate");
      });
      for (const [id, key] of [
        ["department-filter", "department"],
        ["semester-filter", "semester"],
        ["class-filter", "class"],
        ["section-filter", "section"],
        ["teacher-filter", "teacher"],
        ["room-filter", "room"],
      ]) {
        $(`#${id}`).addEventListener("change", (event) => {
          timetableFilters[key] = event.currentTarget.value;
          render("generate");
        });
      }
      $("#generate-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const status = form.querySelector("[data-status]");
        const submit = form.querySelector('[type="submit"]');
        const values = Object.fromEntries(new FormData(form));
        values.periods_per_day = Number(values.periods_per_day);
        values.period_minutes = Number(values.period_minutes);
        submit.disabled = true;
        status.textContent = "Validating all classes and searching for a clash-free weekly schedule…";
        $("#generation-validation").replaceChildren();
        try {
          const result = await api("/api/timetable/generate", {
            method: "POST", body: JSON.stringify(values),
          });
          preferences.periodsPerDay = values.periods_per_day;
          savePreferences();
          activeWeekday = "Monday";
          weeklyView = true;
          await refresh();
          if ($("#generate-form")) {
            const warnings = result.warnings || [];
            $("#generate-form [data-status]").textContent =
              `Validated and saved ${result.entries} entries for all ${result.classes} classes, Monday–Saturday.${warnings.length ? ` ${warnings.length} warning(s) need review.` : ""}`;
            $("#generation-validation").innerHTML = `<p class="success-text">All configured weekly requirements and clash checks passed. Search explored ${result.search_nodes} placements.</p>${warnings.length ? `<ul class="validation-list">${warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}`;
          }
        } catch (error) {
          status.textContent = error.message;
          if (error.validation && $("#generation-validation")) {
            const issues = [
              ...(error.validation.missing_records || []),
              ...(error.validation.errors || []),
              ...(error.validation.conflicts || []).map((item) =>
                typeof item === "string"
                  ? item
                  : `${item.class_name} / ${item.subject_name} (${item.entry_type}, ${item.periods_required || 0} periods): ${item.reason}`,
              ),
              ...(error.validation.unscheduled || []).map((item) =>
                `${item.class_name} / ${item.subject_name} (${item.entry_type}, ${item.periods_required || 0} periods): ${item.reason}`,
              ),
            ];
            $("#generation-validation").innerHTML = issues.length
              ? `<ul class="validation-list">${issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>`
              : `<p class="notice">No schedule was saved; inspect the reported constraints.</p>`;
          }
        } finally {
          if (submit.isConnected) submit.disabled = false;
        }
      });
      main.querySelectorAll("[data-edit-row]").forEach((button) => {
        button.addEventListener("click", () => {
          const editor = $(`#editor-${button.dataset.editRow}`);
          editor.hidden = !editor.hidden;
        });
      });
      main.querySelectorAll(".cancel-edit").forEach((button) =>
        button.addEventListener("click", () => {
          button.closest(".editor-row").hidden = true;
        }),
      );
      main.querySelectorAll(".timetable-edit-form").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const index = Number(form.dataset.index);
          const entry = filteredEntries[index];
          const status = form.querySelector("[data-status]");
          const submit = form.querySelector('[type="submit"]');
          submit.disabled = true;
          status.textContent = "Checking conflicts and saving…";
          try {
            await api("/api/timetable/edit", {
              method: "POST",
              body: JSON.stringify({
                day: entry.day,
                period: entry.period,
                class_name: entry.class_name,
                teacher: form.elements.teacher.value,
                room: form.elements.room.value,
              }),
            });
            await refresh("generate");
          } catch (error) {
            status.textContent = error.message;
          } finally {
            if (submit.isConnected) submit.disabled = false;
          }
        });
      });
    }
    if (page === "recycle") {
      main.querySelectorAll("[data-restore]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await api(`/api/restore/${encodeURIComponent(button.dataset.restore)}/${encodeURIComponent(button.dataset.name)}`, {
              method: "PATCH", headers: { "X-Asset-Name": button.dataset.name },
            });
            await refresh();
          } catch (error) {
            alert(error.message);
          }
        });
      });
    }
    if (page === "teachers") {
      $("#teacher-form").addEventListener("submit", (event) => {
        event.preventDefault();
        submitForm(event.currentTarget, "/api/teacher-details", (form) => form.reset());
      });
      main.querySelectorAll("[data-edit]").forEach((button) => {
        button.addEventListener("click", () => {
          const teacher = state.teachers.find((item) => item.name === button.dataset.edit);
          $("#teacher-name").value = teacher.name;
          $("#teacher-email").value = teacher.email || "";
          $("#teacher-phone").value = teacher.phone || "";
          $("#teacher-name").focus();
        });
      });
    }
    if (page === "feedback") {
      $("#feedback-form").addEventListener("submit", (event) => {
        event.preventDefault();
        submitForm(event.currentTarget, "/api/feedback", (form) => form.reset());
      });
    }
    if (page === "assistant") {
      $("#assistant-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const prompt = $("#assistant-input").value.trim();
        if (!prompt) return;
        const language = $("#assistant-language").value;
        const chat = $("#chat");
        const userBubble = document.createElement("div");
        userBubble.className = "bubble user";
        userBubble.textContent = prompt;
        chat.append(userBubble);
        $("#assistant-status").textContent = "Working…";
        const send = form.querySelector('[type="submit"]');
        send.disabled = true;
        try {
          const result = await api("/api/assistant", {
            method: "POST", body: JSON.stringify({ prompt, language }),
          });
          await refresh("assistant");
          $("#assistant-status").textContent = result.ai_configured
            ? `Answered with ${result.ai_provider}.`
            : "Answered with the offline helper.";
        } catch (error) {
          const reply = document.createElement("div");
          reply.className = "bubble";
          reply.textContent = error.message;
          chat.append(reply);
          $("#assistant-status").textContent = "The request failed.";
        } finally {
          if (send.isConnected) send.disabled = false;
        }
      });
      const micButton = $("#mic-button");
      $("#assistant-language").addEventListener("change", (event) => {
        replyLanguage = event.currentTarget.value;
        preferences.replyLanguage = replyLanguage;
        savePreferences();
      });
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const capability = $("#microphone-capability");
        const status = $("#assistant-status");
        const updatePermissionStatus = async () => {
          if (!window.isSecureContext) {
            capability.textContent = "Microphone unavailable · open this app over HTTPS.";
            micButton.disabled = true;
            return;
          }
          if (!navigator.permissions?.query) {
            capability.textContent = "Microphone · allow access when your browser asks.";
            return;
          }
          try {
            const permission = await navigator.permissions.query({ name: "microphone" });
            if (!micButton.isConnected) return;
            if (permission.state === "denied") {
              capability.textContent = "Microphone blocked · allow it in browser site settings, then reload.";
              status.textContent = "Click the lock/site icon beside the address and set Microphone to Allow.";
              micButton.disabled = true;
              return;
            }
            capability.textContent = permission.state === "granted"
              ? "Microphone · permission allowed."
              : "Microphone · click Mic and allow browser access.";
            micButton.disabled = false;
            permission.addEventListener("change", updatePermissionStatus, { once: true });
          } catch {
            capability.textContent = "Microphone · click Mic and allow browser access.";
          }
        };
        void updatePermissionStatus();
        micButton.addEventListener("click", () => {
          const recognition = new SpeechRecognition();
          recognition.lang = replyLanguage === "hi" ? "hi-IN" : "en-IN";
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          micButton.disabled = true;
          status.textContent = "Starting microphone…";
          recognition.onstart = () => {
            status.textContent = "Listening… speak now.";
          };
          recognition.onresult = (event) => {
            $("#assistant-input").value = event.results[0][0].transcript;
            $("#assistant-input").focus();
            status.textContent = "Speech recognized. Review it, then press Send.";
          };
          recognition.onerror = (event) => {
            const messages = {
              "not-allowed": "Microphone blocked. Allow access in browser site settings, then reload.",
              "service-not-allowed": "Browser speech service is blocked. Check browser privacy/network settings.",
              "audio-capture": "No microphone was found. Connect or enable a microphone and try again.",
              network: "Speech recognition service is unreachable. Check your internet and try again.",
              "no-speech": "No speech was detected. Check the microphone and try again.",
              aborted: "Microphone listening was stopped.",
            };
            capability.textContent = "Microphone · recognition stopped.";
            status.textContent = messages[event.error] || `Microphone input failed: ${event.error}. You can type your question instead.`;
          };
          recognition.onend = () => {
            micButton.disabled = false;
            if (status.textContent === "Listening… speak now.") {
              status.textContent = "No speech was recognized. Check the microphone and try again.";
            }
          };
          try {
            recognition.start();
          } catch (error) {
            micButton.disabled = false;
            status.textContent = `Could not start microphone: ${error.message}. You can type your question instead.`;
          }
        });
      }
    }
  }

  async function submitMessagingForm(form, recipientId, channel) {
    const status = form.querySelector("[data-status]");
    const submit = form.querySelector('[type="submit"]');
    const recipient = form.querySelector(`#${recipientId}`).value.trim();
    const values = Object.fromEntries(new FormData(form));
    const liveReady = channel === "WhatsApp"
      ? state.messaging?.whatsapp_ready
      : state.messaging?.email_ready;
    if (!liveReady) {
      status.textContent = `${channel} preview ready for ${recipient}. Nothing was sent or saved.`;
      return;
    }
    submit.disabled = true;
    status.textContent = `Sending ${channel} message…`;
    try {
      const result = await api(`/api/messaging/${channel === "WhatsApp" ? "whatsapp" : "email"}`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      status.textContent = channel === "WhatsApp" && result.message_id
        ? `WhatsApp sent successfully (message ID ${result.message_id}).`
        : `${channel} sent successfully to ${recipient}.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  }

  document.querySelectorAll("[data-page]").forEach((button) =>
    button.addEventListener("click", () => render(button.dataset.page)),
  );
  document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);

  document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
      showLogin("You have been signed out.");
    } catch (error) {
      main.innerHTML = `<div class="page-head">Could not sign out</div><p class="notice">${esc(error.message)}</p>`;
    }
  });

  syncThemeControls();
  api("/api/session").then(() => refresh()).catch((error) => {
    if (error.status === 401) {
      showLogin();
      return;
    }
    main.innerHTML = `<div class="page-head">Web app could not load</div><p class="notice">${esc(error.message)}</p>
      <p class="subtle">Please reload this page or contact the demo administrator.</p>`;
  });
})();
