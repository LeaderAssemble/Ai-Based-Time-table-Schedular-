# Timetable Scheduler Pro — hosted web demo

**Live demo:** <https://timetable-scheduler-pro.onrender.com>

A browser version of the Timetable Scheduler Pro desktop app. It includes the
dashboard, asset management, teacher expertise, timetable generation and
history, workload analytics, feedback, backup, and assistant. The Render-hosted
demo uses fictional sample data and a separate SQLite database. The Windows
local launcher instead uses the existing desktop database and does not seed
fictional assets.

## Hosted demo

The app is deployed on Render from this repository using `render.yaml`.
Sign in with:

- **Username:** `admin`
- **Password:** `admin123`

This password is public by design for the fictional-data demo. Anyone can sign
in and change the shared sample data; do not enter real school information.

The web process binds to Render's assigned port and `0.0.0.0`. The server
requires the deployment secrets at startup, uses signed `HttpOnly`,
`SameSite=Lax`, `Secure` session cookies, checks request origins on changes,
and limits failed sign-in attempts. The demo is one shared account and one
shared dataset: only use fictional data.

The fictional starter assets include six teachers, six subjects, four classes,
four classrooms, and two labs. Teachers can be added from **Manage Assets**;
newly added starter assets are migrated once without re-adding them after a
user moves one to the Recycle Bin. The starter timetable is legacy illustrative
data, not a college-wide validated schedule.

## Generate a college-wide weekly timetable

The scheduler runs locally in the Python backend and does not require Groq or
any other AI provider. It generates a non-empty timetable for Monday, Tuesday,
Wednesday, Thursday, Friday, Saturday, in that order; Sunday is excluded. If
the configured weekly course loads cannot populate all six days, generation is
blocked with diagnostics instead of saving an incomplete week. Before
generation, sign in and:

1. In **Manage Assets**, add or verify every active class/section, subject,
   teacher, classroom, and lab. Set each teacher's subject expertise.
2. In **College Setup**, configure every class's department, academic year,
   semester/year, section/group, and student capacity.
3. Enter each subject's official subject code, then add the weekly lecture and
   practical-session counts for every class/subject. Practical sessions use
   consecutive periods; mark whether they require a laboratory, and assign a
   qualified teacher or choose automatic assignment from Teacher Expertise.
4. Record each active room's actual capacity and type. Confirm availability for
   every active teacher; an empty unavailable-slot list explicitly confirms
   full availability. Unavailable slots use `Day:period`, for example
   `Monday:1, Thursday:3`.
5. In **Generate Schedule**, set the college's actual start time, period
   duration, and periods per day, then select **Generate and Validate Full
   Week**.

Generation is blocked with a list of missing records or unsatisfied
constraints; an invalid attempt does not overwrite the previously saved
timetable. Hard checks cover weekly subject counts, class/teacher/room
collisions, room capacity and type, teacher expertise and availability, and
consecutive lab blocks. Successful generation also warns about active subjects
without a class requirement and active teachers without scheduled assignments,
so unused records are visible instead of silently omitted. Candidate placements
are ordered to spread workloads and avoid repeating the same
class/subject/teacher/time-slot pattern across days. **Full Week** and the six
day tabs show the saved schedule; filters select
department, semester, class, section, teacher, or room. Validated entries can
be edited (practical-session edits apply to the whole block) and exported to
PDF or Excel.

Consecutive college-wide day patterns are a hard constraint: if the configured
weekly requirements and available resources force identical adjacent schedules,
generation reports the conflict and leaves the last saved timetable unchanged.

SQLite is migrated automatically at startup. Existing college-specific
configuration is stored in `college_class_details`,
`college_subject_details`, `college_requirements`, `college_room_details`,
`teacher_availability_settings`, and `teacher_unavailability`; generated
entries retain department/year/semester/section, subject code, period times,
lecture/practical type, room, and practical-block identity. Existing assets
remain in the original `classes`, `subjects`, `teachers`, `classrooms`, and
`lab_rooms` tables. On Render's free ephemeral filesystem, configuration and
generated schedules can be reset by a service restart or redeploy.

### Run and test locally

Run `run-local.bat` and sign in using the local password it requests. Configure
the academic data using the steps above, then generate and review the week.
Run the focused backend tests from this directory with:

```powershell
python -m unittest discover -s tests -p "test_college_scheduler.py" -v
python -m unittest discover -s tests -p "test_web_features.py" -v
```

### Free-service data limits

The included Render service uses its free plan and a local SQLite database.
Render's free filesystem is ephemeral: sample or edited timetable data may be
reset after a redeploy, restart, or instance replacement. This is suitable for
a shareable demo, not real school records or reliable long-term storage. For
persistent multi-user data, replace SQLite with a managed database and add
proper per-user accounts before using real information. Do not enable paid
resources unless you choose them in Render.

## Run the hosted version locally

On Windows, run `Launch Timetable Pro.bat` and press Enter (or `W`) for the
updated browser UI; choose `D` only to open the legacy desktop UI. You can also
run `run-local.bat` from this directory directly. The web launcher asks for a
local password and creates a random session secret for that launch. It opens the existing
desktop database at `..\timetable_db.sqlite3`; it does not add fictional demo
teachers, subjects, classes, or rooms. Keep the terminal open while using
`http://127.0.0.1:8000`.

Back up that SQLite file before the first launch. Startup performs an additive
migration: it adds timetable metadata columns and the college setup tables
(`college_class_details`, `college_subject_details`, `college_requirements`,
`college_room_details`, `teacher_availability_settings`,
`teacher_unavailability`, and `app_metadata`). Existing assets and saved
entries are retained. The prior timetable remains viewable as unvalidated
legacy data until a complete schedule has been configured and generated.
Generation replaces the saved timetable only after all configured classes,
course requirements, and hard scheduling constraints validate successfully.

The desktop database does not yet contain department/semester data, official
subject codes, per-class weekly lecture/practical loads, room capacities, or
teacher availability. Complete those fields in **College Setup** and set each
teacher's subject expertise before generating. The setup page reports missing
records rather than inventing them or treating an old timetable as validated.
The Render-hosted demo continues to use its separate fictional dataset; it
does not read this local database.

## AI and privacy

The assistant uses an offline timetable Q&A helper by default; it can list and
count assets, look up teacher expertise, filter the saved timetable by class,
teacher, day, period, or room, and report teacher workload. Offline answers are
computed from the current demo database; this is not model training and chat
messages do not train or change an AI model. Full open-ended AI is opt-in: set
`TIMETABLE_ENABLE_CLOUD_AI=1` and the provider API key (for example,
`GROQ_API_KEY`) as Render environment secrets. Prompts and demo timetable
context are sent to that provider when enabled. Never put API keys or database
files in GitHub or the browser.

Choose **हिन्दी में जवाब** or **Answer in English** in the assistant to set both
the answer language and speech-recognition language. Speech input uses the
browser's speech-recognition service, not a server-side microphone package.
Open the demo over HTTPS, use a supported browser such as Chrome or Edge, and
allow microphone access in the site's browser settings. If speech recognition
is blocked or unavailable, type the question in the chat instead.

User Settings can save the assistant language, theme, and default timetable
days and periods in the current browser. These preferences are local to that
browser; generated timetables and backup data still use the shared demo dataset.
The settings page also provides a JSON backup download. Account/password changes
are unavailable for the shared public demo login.

The browser version includes PDF, Excel, and JSON data exports. WhatsApp and
email work as previews by default. Live sending is opt-in: set
`TIMETABLE_ENABLE_LIVE_MESSAGING=1`, configure Twilio with
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_FROM`, and set
`TIMETABLE_ALLOWED_WHATSAPP_RECIPIENTS` to comma-separated E.164 numbers.
For email, set `TIMETABLE_SMTP_HOST`, `TIMETABLE_SMTP_PORT`,
`TIMETABLE_SMTP_USER`, `TIMETABLE_SMTP_PASSWORD`, and
`TIMETABLE_ALLOWED_EMAIL_RECIPIENTS` to comma-separated addresses. Configure
these as private server environment secrets; the UI never handles provider
credentials. Only allowlisted recipients can receive messages, and sends are
rate-limited. Messaging may incur charges and contact real recipients.
Microphone input depends on browser support and permission.
